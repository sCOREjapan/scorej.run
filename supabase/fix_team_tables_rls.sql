-- supabase/fix_team_tables_rls.sql
--
-- 【発覚した問題】
--   teams / team_members / team_messages / team_videos / team_body_reports /
--   team_player_stats / team_sessions / team_events の全8テーブルが
--   `for all using (true) with check (true)` になっていた。
--   コメントには「コードを知っている人だけが参加できるため、テーブルレベルの
--   セキュリティは参加コードで担保する」とあったが、using(true)はコードでの
--   絞り込みを一切強制しない。アプリの公開anonキーさえあれば、team_codeを
--   一切知らなくても全チームのチャット・体調報告(team_body_reports)・
--   選手成績を無条件に読み書き削除できる状態だった。
--
-- 【方針】
--   team_membersにuser_id等のアカウント紐付けが無く(player_nameは自己申告の
--   文字列のみ)、この機能自体がログイン不要・招待コード方式で設計されているため、
--   「本人確認」ベースのRLSは組めない。代わりに、PostgRESTがリクエストヘッダーを
--   `current_setting('request.headers', true)`経由でRLSに渡せる仕組みを使い、
--   クライアントが `X-Team-Code` ヘッダーで自分の知っているteam_codeを申告し、
--   そのteam_codeに一致する行にしかアクセスできないようにする
--   (lib/supabaseTeam.ts側もこのヘッダーを付けたクライアントに変更する)。

create or replace function _request_team_code() returns text
language sql stable
as $$
  select nullif(current_setting('request.headers', true)::json ->> 'x-team-code', '')
$$;

do $$
declare
  t text;
begin
  foreach t in array array['teams', 'team_members', 'team_messages', 'team_videos',
                            'team_body_reports', 'team_player_stats', 'team_sessions', 'team_events']
  loop
    execute format('drop policy if exists %I on %I', t || '_public', t);
  end loop;
end $$;

-- teamsテーブルのみ code列自体がJOIN対象になるため、行自体のcodeで判定する
create policy "teams_by_code" on teams
  for all using (code = _request_team_code()) with check (code = _request_team_code());

create policy "team_members_by_code" on team_members
  for all using (team_code = _request_team_code()) with check (team_code = _request_team_code());

create policy "team_messages_by_code" on team_messages
  for all using (team_code = _request_team_code()) with check (team_code = _request_team_code());

create policy "team_videos_by_code" on team_videos
  for all using (team_code = _request_team_code()) with check (team_code = _request_team_code());

create policy "team_body_reports_by_code" on team_body_reports
  for all using (team_code = _request_team_code()) with check (team_code = _request_team_code());

create policy "team_player_stats_by_code" on team_player_stats
  for all using (team_code = _request_team_code()) with check (team_code = _request_team_code());

create policy "team_sessions_by_code" on team_sessions
  for all using (team_code = _request_team_code()) with check (team_code = _request_team_code());

create policy "team_events_by_code" on team_events
  for all using (team_code = _request_team_code()) with check (team_code = _request_team_code());

-- ════════════════════════════════════════════════════════════════════
-- 【重要】チーム新規作成(createTeam)だけは例外
--   まだteam_codeが存在しない状態で最初の行をinsertするため、上のポリシーでは
--   「これから作ろうとしているcode」を検証しようがない(コード生成はクライアント側)。
--   teamsテーブルへのinsertだけは「ヘッダーで申告したcodeと一致」を要求しつつ、
--   新規作成時はそのcodeがまだ存在しない行なのでcheckは通る(with checkは新しい行の
--   値のみを見るため、`code = _request_team_code()`は新規作成時も正しく機能する。
--   クライアント側は createTeam 呼び出し時に生成したcodeをヘッダーに載せること)。
-- ════════════════════════════════════════════════════════════════════

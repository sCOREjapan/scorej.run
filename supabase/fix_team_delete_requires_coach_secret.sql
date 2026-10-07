-- supabase/fix_team_delete_requires_coach_secret.sql
-- ⚠ 2026-10-07: fix_coach_secret_hash.sql を適用した後は、このファイルを再実行しないこと。
--   (古い削除ポリシー/トリガーに戻り、coach_secret の平文が再び保存・露出してしまう)
--
-- 【発覚した問題】(2026-09-30 セキュリティ監査)
--   teams(および関連7テーブル)は "teams_by_code" のような FOR ALL ポリシーで
--   team_code = _request_team_code() のみを要求していた。この機能はコーチと選手の
--   権限をDB側で一切区別しておらず、参加コード(選手全員が知っている)さえ分かれば
--   誰でも teams テーブルをDELETEでき、on delete cascadeで関連する全データ
--   (チャット・怪我報告・PB記録・レースプラン等)が連鎖削除されてしまう状態だった。
--   UI上は「チーム削除」ボタンがコーチ画面にしか無いだけで、DBレベルでは選手も
--   実行可能だった。
--
-- 【方針】
--   team_membersにアカウント紐付けが無い(本人確認ベースのRLSが組めない)設計は
--   変えられないため、参加コードとは別に「コーチの端末だけが持つ秘密値」
--   (teams.coach_secret)を新設し、破壊的操作(チーム削除)だけこれの一致を要求する。
--   通常のSELECT/INSERT/UPDATEは今まで通り参加コードのみで動く(選手の通常利用に
--   影響なし)。
--
--   coach_secretは新規作成チームでは必ず設定されるが、この修正より前に作られた
--   既存チームでは最初はNULLのまま。NULLの間は「まだバックフィルされていない
--   レガシーチーム」として従来通り参加コードのみでの削除を許可し(現状より悪化は
--   させない)、コーチの端末がダッシュボードを開くたびに自動でcoach_secretが
--   書き込まれる(lib/supabaseTeam.tsのcreateTeam経由)ため、時間とともに保護対象が
--   広がっていく。

alter table teams add column if not exists coach_secret text;

create or replace function _request_coach_secret() returns text
language sql stable
as $$
  select nullif(current_setting('request.headers', true)::json ->> 'x-coach-secret', '')
$$;

drop policy if exists "teams_by_code" on teams;

create policy "teams_select_by_code" on teams
  for select using (code = _request_team_code());

create policy "teams_insert_by_code" on teams
  for insert with check (code = _request_team_code());

create policy "teams_update_by_code" on teams
  for update using (code = _request_team_code()) with check (code = _request_team_code());

-- チーム削除だけは、参加コードに加えてコーチの端末秘密値の一致を要求する。
-- coach_secretがまだNULL(バックフィル前のレガシーチーム)の場合のみ、
-- 参加コード一致だけで許可する(現状からの後退にはならない)。
create policy "teams_delete_by_code_and_secret" on teams
  for delete using (
    code = _request_team_code()
    and (coach_secret is null or coach_secret = _request_coach_secret())
  );

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認
-- ════════════════════════════════════════════════════════════════════
-- select policyname, cmd from pg_policies where tablename = 'teams' order by cmd;

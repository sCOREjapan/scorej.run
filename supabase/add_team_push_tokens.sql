-- supabase/add_team_push_tokens.sql
--
-- 2026-09-09: チームのプッシュ通知(新着メッセージ・新規メンバー参加・動画投稿等)は
-- lib/notify.tsがOneSignal Web SDK(window.OneSignal)専用に作られており、ネイティブ
-- (iOS/Android)にはOneSignalのSDK自体が入っていなかったため、コーチ・選手には
-- 「送信できている」ように見えて実際には0件配信という不具合があった。
--
-- ios/sCORE/sCORE.entitlements に aps-environment が既に設定済み、EAS projectIdも
-- 紐付いているため、新しいネイティブ依存を追加せずにExpo自身のPush通知サービス
-- (expo-notifications, https://exp.host/--/api/v2/push/send) に乗り換える。
-- このテーブルはteam_codeごとに、コーチ・選手それぞれのExpo Push Tokenを保持する。

create table if not exists team_push_tokens (
  team_code   text not null references teams(code) on delete cascade,
  role        text not null check (role in ('coach','player')),
  push_token  text not null,
  updated_at  timestamptz default now(),
  primary key (team_code, push_token)
);

create index if not exists idx_team_push_tokens_code on team_push_tokens(team_code);

alter table team_push_tokens enable row level security;

-- 他のteam_*テーブルと同じ「X-Team-Codeヘッダーが一致する行だけ」方式
-- (supabase/fix_team_tables_rls.sql参照)
create policy "team_push_tokens_by_code" on team_push_tokens
  for all using (team_code = _request_team_code()) with check (team_code = _request_team_code());

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認
-- ════════════════════════════════════════════════════════════════════
select policyname from pg_policies where tablename = 'team_push_tokens';

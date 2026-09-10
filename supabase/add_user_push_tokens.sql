-- supabase/add_user_push_tokens.sql
--
-- 2026-09-09: api/daily-reminder.ts（毎朝7時/毎夕17時/毎晩20時のCronで動く、
-- アプリ全体のリテンション通知）もteam機能と全く同じ理由（lib/notify.tsがOneSignal
-- Web SDK専用で、ネイティブにはOneSignalのSDKが入っていない）で、実際には
-- ネイティブ端末に一件も配信されていなかった。チームに限らず全ユーザー向けの
-- 汎用プッシュトークンテーブルを追加し、Expo Push Notificationサービスへ切り替える。

create table if not exists user_push_tokens (
  user_id     uuid not null references users(id) on delete cascade,
  push_token  text not null,
  updated_at  timestamptz default now(),
  primary key (user_id, push_token)
);

create index if not exists idx_user_push_tokens_user on user_push_tokens(user_id);

alter table user_push_tokens enable row level security;

-- 本人の行だけ読み書きできる（他の個人データテーブルと同じ方針）
create policy "user_push_tokens_own" on user_push_tokens
  for all
  using (user_id = (select id from users where auth_id = auth.uid()))
  with check (user_id = (select id from users where auth_id = auth.uid()));

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認
-- ════════════════════════════════════════════════════════════════════
select policyname from pg_policies where tablename = 'user_push_tokens';

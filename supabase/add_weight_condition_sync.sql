-- supabase/add_weight_condition_sync.sql
-- 体重(trackmate_weight)と体調(trackmate_condition_map)は、これまでクラウド同期の
-- 対象外で端末ローカルにしか保存されていなかった（Web版とスマホ版で同じアカウントに
-- ログインしても反映されない原因の一つ）。この2つを同期対象に追加するためのテーブル。
--
-- Supabase の SQL Editor にそのまま貼り付けて実行してください。
-- 既に同名テーブルがある場合は "if not exists" によりスキップされ、安全に再実行できます。

-- ─────────────────────────────────────────
-- 体重記録
-- ─────────────────────────────────────────
create table if not exists weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  weight_kg numeric(5,1) not null,
  created_at timestamptz default now()
);

create index if not exists idx_weights_user_date
  on weights(user_id, date desc);

alter table weights enable row level security;

drop policy if exists "weights_own_data" on weights;
create policy "weights_own_data" on weights
  for all using (user_id = (select id from users where auth_id = auth.uid()));

-- ─────────────────────────────────────────
-- 体調記録（日次・1日1件）
-- ローカルは { "2026-08-20": 7, ... } のような日付→レベルのマップ形式のため、
-- 汎用の配列同期(syncTable)ではなく専用の syncConditionMap() で扱う。
-- ─────────────────────────────────────────
create table if not exists condition_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  condition_date date not null,
  level integer not null check (level between 1 and 10),
  created_at timestamptz default now(),
  unique (user_id, condition_date)
);

create index if not exists idx_condition_user_date
  on condition_records(user_id, condition_date desc);

alter table condition_records enable row level security;

drop policy if exists "condition_records_own_data" on condition_records;
create policy "condition_records_own_data" on condition_records
  for all using (user_id = (select id from users where auth_id = auth.uid()));

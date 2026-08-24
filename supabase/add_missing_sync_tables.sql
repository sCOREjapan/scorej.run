-- supabase/add_missing_sync_tables.sql
-- クラウド同期（機種変対応）で参照している race_records / calendar_events が
-- supabase/schema.sql に定義されておらず、実DBにも存在しない可能性が高い。
-- 存在しないテーブルへの同期は失敗するだけでアプリは壊れないが、
-- 該当データ（大会記録・カレンダー予定）はクラウドに保存されない。
--
-- Supabase の SQL Editor にそのまま貼り付けて実行してください。
-- 既に同名テーブルがある場合は "if not exists" によりスキップされ、安全に再実行できます。
--
-- 注: trackmate_workout_menus（workout_menus テーブル）は、現在どの画面からも
-- 書き込まれていない未使用のキーのため、このマイグレーションには含めていません。

-- ─────────────────────────────────────────
-- 大会記録（自己ベスト・シーズンベスト）
-- ─────────────────────────────────────────
create table if not exists race_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  event text not null,
  result_display text not null,
  result_ms integer,
  result_cm integer,
  race_date date not null,
  venue text,
  competition_name text,
  wind_ms numeric(4,1),
  hurdle_height_cm integer,
  is_pb boolean not null default false,
  is_sb boolean not null default false,
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_race_records_user_date
  on race_records(user_id, race_date desc);

alter table race_records enable row level security;

drop policy if exists "race_records_own_data" on race_records;
create policy "race_records_own_data" on race_records
  for all using (user_id = (select id from users where auth_id = auth.uid()));

-- ─────────────────────────────────────────
-- カレンダー予定（メモ・大会・休養日など）
-- ─────────────────────────────────────────
create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  title text not null,
  category text not null default 'memo'
    check (category in ('memo','competition','rest','medical','other')),
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_calendar_events_user_date
  on calendar_events(user_id, date asc);

alter table calendar_events enable row level security;

drop policy if exists "calendar_events_own_data" on calendar_events;
create policy "calendar_events_own_data" on calendar_events
  for all using (user_id = (select id from users where auth_id = auth.uid()));

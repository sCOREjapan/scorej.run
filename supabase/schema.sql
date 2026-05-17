-- supabase/schema.sql
-- TrackMate データベーススキーマ
-- Supabase の SQL Editor にそのまま貼り付けて実行

-- ─────────────────────────────────────────
-- 拡張機能
-- ─────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────
-- ユーザープロフィール
-- ─────────────────────────────────────────
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique references auth.users(id) on delete cascade,
  name text not null,
  primary_event text not null default '100m',
  secondary_events text[] default '{}',
  event_category text not null default 'sprint'
    check (event_category in ('sprint', 'middle', 'long')),
  personal_best_ms integer,
  target_time_ms integer,
  age integer,
  experience_years integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────
-- トレーニング記録
-- ─────────────────────────────────────────
create table if not exists training_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  session_date date not null,
  session_type text not null
    check (session_type in ('interval','tempo','easy','long','sprint','drill','strength','race','rest')),
  event text,
  time_ms integer,
  distance_m integer,
  reps integer,
  sets integer,
  rest_sec integer,
  fatigue_level integer not null default 5
    check (fatigue_level between 1 and 10),
  condition_level integer not null default 5
    check (condition_level between 1 and 10),
  weather text,
  temperature integer,
  notes text,
  video_url text,
  ai_feedback text,
  created_at timestamptz default now()
);

create index if not exists idx_sessions_user_date
  on training_sessions(user_id, session_date desc);

-- ─────────────────────────────────────────
-- 食事記録
-- ─────────────────────────────────────────
create table if not exists meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  meal_date date not null,
  meal_type text not null default 'lunch'
    check (meal_type in ('breakfast','lunch','dinner','snack','supplement')),
  photo_url text,
  foods jsonb not null default '[]',
  total_calories integer not null default 0,
  total_protein numeric(6,1) not null default 0,
  total_carb numeric(6,1) not null default 0,
  total_fat numeric(6,1) not null default 0,
  training_timing text default 'none'
    check (training_timing in ('pre','post','none')),
  advice text,
  created_at timestamptz default now()
);

create index if not exists idx_meals_user_date
  on meals(user_id, meal_date desc);

-- ─────────────────────────────────────────
-- 試合計画
-- ─────────────────────────────────────────
create table if not exists competition_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  competition_name text not null,
  competition_date date not null,
  event text not null,
  target_time_ms integer,
  days_until integer,
  plan_json jsonb not null default '{}',
  peak_week integer,
  taper_start_week integer,
  key_advice text,
  created_at timestamptz default now()
);

create index if not exists idx_competitions_user_date
  on competition_plans(user_id, competition_date asc);

-- ─────────────────────────────────────────
-- 睡眠記録
-- ─────────────────────────────────────────
create table if not exists sleep_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  sleep_date date not null,
  sleep_start timestamptz,
  sleep_end timestamptz,
  duration_min integer
    generated always as (
      extract(epoch from (sleep_end - sleep_start))::integer / 60
    ) stored,
  quality_score integer not null default 5
    check (quality_score between 1 and 10),
  deep_sleep_min integer,
  rhr integer,      -- resting heart rate
  hrv integer,      -- heart rate variability
  notes text,
  created_at timestamptz default now(),
  unique (user_id, sleep_date)
);

create index if not exists idx_sleep_user_date
  on sleep_records(user_id, sleep_date desc);

-- ─────────────────────────────────────────
-- Row Level Security（RLS）
-- ─────────────────────────────────────────
alter table users enable row level security;
alter table training_sessions enable row level security;
alter table meals enable row level security;
alter table competition_plans enable row level security;
alter table sleep_records enable row level security;

-- 自分のデータだけ読み書きできる
create policy "users_own_data" on users
  for all using (auth_id = auth.uid());

create policy "sessions_own_data" on training_sessions
  for all using (user_id = (select id from users where auth_id = auth.uid()));

create policy "meals_own_data" on meals
  for all using (user_id = (select id from users where auth_id = auth.uid()));

create policy "competitions_own_data" on competition_plans
  for all using (user_id = (select id from users where auth_id = auth.uid()));

create policy "sleep_own_data" on sleep_records
  for all using (user_id = (select id from users where auth_id = auth.uid()));

-- ─────────────────────────────────────────
-- Storage バケット（Supabase Dashboard で作成するか、ここで）
-- ─────────────────────────────────────────
-- insert into storage.buckets (id, name, public) values ('videos', 'videos', false);
-- insert into storage.buckets (id, name, public) values ('meal-photos', 'meal-photos', false);

-- ─────────────────────────────────────────
-- チーム機能テーブル
-- ─────────────────────────────────────────

-- チーム（コーチが作成）
create table if not exists teams (
  code        text primary key,              -- 6文字の参加コード
  team_name   text not null,
  coach_name  text not null,
  created_at  timestamptz default now()
);

-- チームメンバー（選手が参加）
create table if not exists team_members (
  id          text primary key,              -- "{code}_{playerName}"
  team_code   text not null references teams(code) on delete cascade,
  player_name text not null,
  event       text not null default '',
  joined_at   timestamptz default now()
);

create index if not exists idx_team_members_code
  on team_members(team_code);

-- チームメッセージ（コーチ → 選手）
create table if not exists team_messages (
  id          uuid primary key default gen_random_uuid(),
  team_code   text not null references teams(code) on delete cascade,
  content     text not null,
  author_name text not null,
  is_pinned   boolean not null default false,
  created_at  timestamptz default now()
);

create index if not exists idx_team_messages_code
  on team_messages(team_code, created_at desc);

-- チーム動画（選手 → コーチ）
create table if not exists team_videos (
  id          uuid primary key default gen_random_uuid(),
  team_code   text not null references teams(code) on delete cascade,
  player_name text not null,
  url         text not null,
  description text not null default '',
  watched     boolean not null default false,
  posted_at   timestamptz default now()
);

create index if not exists idx_team_videos_code
  on team_videos(team_code, posted_at desc);

-- 痛み報告（選手 → コーチ）
create table if not exists team_body_reports (
  team_code   text not null references teams(code) on delete cascade,
  player_name text not null,
  parts       text[] not null default '{}',
  updated_at  timestamptz default now(),
  primary key (team_code, player_name)
);

create index if not exists idx_body_reports_code
  on team_body_reports(team_code);

-- ─────────────────────────────────────────
-- RLS（チームテーブルは認証なしでも読み書き可）
-- ※ コードを知っている人だけが参加できるため、
--   テーブルレベルのセキュリティは参加コードで担保する
-- ─────────────────────────────────────────
alter table teams             enable row level security;
alter table team_members      enable row level security;
alter table team_messages     enable row level security;
alter table team_videos       enable row level security;
alter table team_body_reports enable row level security;

-- 全員が読み書き可（コード知っている前提）
create policy "teams_public"        on teams             for all using (true) with check (true);
create policy "members_public"      on team_members      for all using (true) with check (true);
create policy "messages_public"     on team_messages     for all using (true) with check (true);
create policy "videos_public"       on team_videos       for all using (true) with check (true);
create policy "body_reports_public" on team_body_reports for all using (true) with check (true);

-- 選手プロフィール（自己ベスト・レベル）
create table if not exists team_player_stats (
  team_code   text not null references teams(code) on delete cascade,
  player_name text not null,
  event       text not null default '',      -- 種目（例: 100m）
  pb_display  text not null default '',      -- 自己ベスト表示用（例: 10.83）
  level       integer not null default 1,    -- sCOREレベル
  updated_at  timestamptz default now(),
  primary key (team_code, player_name)
);

create index if not exists idx_player_stats_code on team_player_stats(team_code);

alter table team_player_stats enable row level security;
create policy "player_stats_public" on team_player_stats for all using (true) with check (true);

-- ─────────────────────────────────────────
-- 選手セッション共有（コーチが記録を確認）
-- ─────────────────────────────────────────
create table if not exists team_sessions (
  id          text primary key,             -- TrainingSession.id と同じ
  team_code   text not null references teams(code) on delete cascade,
  player_name text not null,
  session_date date not null,
  session_type text not null,
  fatigue_level   integer not null default 5,
  condition_level integer not null default 5,
  distance_m  integer,
  reps        integer,
  sets        integer,
  synced_at   timestamptz default now()
);

create index if not exists idx_team_sessions_code on team_sessions(team_code, player_name);

alter table team_sessions enable row level security;
create policy "team_sessions_public" on team_sessions for all using (true) with check (true);

-- 痛み詳細カラム（既存テーブルに追加）
alter table team_body_reports add column if not exists detail text not null default '';
-- コーチ確認フラグ（既存テーブルに追加）
alter table team_body_reports add column if not exists acked_by_coach boolean not null default false;

-- ─────────────────────────────────────────
-- チーム共有カレンダー
-- ─────────────────────────────────────────
create table if not exists team_events (
  id          uuid primary key default gen_random_uuid(),
  team_code   text not null references teams(code) on delete cascade,
  title       text not null,
  event_date  date not null,
  event_time  text not null default '',
  location    text not null default '',
  description text not null default '',
  event_type  text not null default 'practice'
    check (event_type in ('practice','race','rest','meeting','other')),
  created_by  text not null,
  created_at  timestamptz default now()
);

create index if not exists idx_team_events_code on team_events(team_code, event_date asc);
alter table team_events enable row level security;
create policy "team_events_public" on team_events for all using (true) with check (true);

-- 選手スタッツ追加カラム（コーチが最新体調を参照できるように）
alter table team_player_stats add column if not exists last_condition integer not null default 7;
alter table team_player_stats add column if not exists last_fatigue integer not null default 5;
alter table team_player_stats add column if not exists last_session_date text not null default '';
alter table team_player_stats add column if not exists sessions_30d integer not null default 0;

-- 選手目標・連続記録日数
alter table team_player_stats add column if not exists goal text not null default '';
alter table team_player_stats add column if not exists streak integer not null default 0;

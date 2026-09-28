-- supabase/add_team_meals.sql
-- 2026-09-26:「食事の時間と内容がコーチに分かるといい」との指示で追加。
--
-- 【設計】
--   既存のteam_sessions/team_body_reportsと同じ「X-Team-Codeヘッダーによるコード所持
--   ベースのRLS」パターンを踏襲する。共有レベル(trackmate_team_share_level)による
--   strip/skipは、team_sessionsのnotesと同様、呼び出し元(lib/teamAutoSync.ts)側で
--   行う（フル共有(shareLv>=2)の選手のみ同期する。部分共有・非公開の選手は同期しない）。
--   時刻情報はmeal_created_at(実際に記録した時刻)を保持し、コーチ側で「何時に何を
--   食べたか」を表示できるようにする。

create table if not exists team_meals (
  id               text primary key,             -- MealRecord.id と同じ
  team_code        text not null references teams(code) on delete cascade,
  player_name      text not null,
  meal_date        date not null,
  meal_type        text not null,                 -- breakfast/lunch/dinner/snack/supplement
  foods            jsonb not null default '[]',   -- FoodItem[]（name/calories/protein/carb/fat）
  total_calories   numeric not null default 0,
  total_protein    numeric not null default 0,
  total_carb       numeric not null default 0,
  total_fat        numeric not null default 0,
  training_timing  text,                          -- pre/post/none
  meal_created_at  timestamptz not null,           -- 選手が実際に記録した時刻
  synced_at        timestamptz default now()
);

create index if not exists idx_team_meals_code on team_meals(team_code, player_name, meal_date desc);

alter table team_meals enable row level security;

create or replace function _request_team_code() returns text
language sql stable
as $$
  select nullif(current_setting('request.headers', true)::json ->> 'x-team-code', '')
$$;

drop policy if exists "team_meals_by_code" on team_meals;
create policy "team_meals_by_code" on team_meals
  for all using (team_code = _request_team_code()) with check (team_code = _request_team_code());

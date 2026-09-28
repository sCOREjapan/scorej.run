-- supabase/team_race_plans_migration.sql
--
-- 2026-09-20: 「レース行動予定」機能用。実際のコーチ(みずの)からのLINE相談で出た
-- 「試合当日の行動予定表(何時に何をするか)を選手が作り、コーチに提出できるように
-- したい」という要望に基づく。ユーザー指定により、タイムラインの各ブロックを
-- バラバラに同期するのではなく、選手が「提出する」を押した瞬間に完成した予定
-- （ブロック配列＋目標タイム/ラップ＋意気込み）を1行＝1件のデータとしてまとめて
-- 保存する（=1レース分の提出が1行）。
--
-- RLSはteam_pb_events等と同じ「X-Team-Codeヘッダーが一致する行のみ」方式
-- (fix_team_tables_rls.sql の _request_team_code() を再利用)。

create table if not exists team_race_plans (
  id            text primary key,             -- クライアント側で生成: {team_code}_{player_name}_{timestamp}
  team_code     text not null references teams(code) on delete cascade,
  player_name   text not null,
  title         text not null default '',     -- 例: "◯◯記録会" "地区大会" など
  race_date     text not null default '',     -- YYYY-MM-DD（未定なら空文字）
  blocks        jsonb not null default '[]',  -- [{ time: "8:00", content: "朝アップ..." }, ...]
  target_time   text not null default '',
  splits        text not null default '',
  goal          text not null default '',
  submitted_at  timestamptz not null default now()
);

create index if not exists idx_race_plans_code_date
  on team_race_plans(team_code, submitted_at desc);

alter table team_race_plans enable row level security;

create policy "team_race_plans_by_code" on team_race_plans
  for all using (team_code = _request_team_code()) with check (team_code = _request_team_code());

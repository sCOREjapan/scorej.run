-- supabase/team_race_plans_event_id_migration.sql
--
-- 2026-09-21: 「個々人のプロフィールにだけではなく、登録した大会にもそれぞれの選手の
-- カードが紐づくように」との要望で追加。team_events(大会予定)とレース行動予定を
-- 紐付けるための列。team_race_plans_migration.sql は既に本番へ適用済みのため、
-- 追加カラムはこちらの別ファイルで当てる。

alter table team_race_plans add column if not exists event_id text;

create index if not exists idx_race_plans_event
  on team_race_plans(team_code, event_id);

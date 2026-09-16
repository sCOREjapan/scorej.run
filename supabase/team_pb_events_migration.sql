-- supabase/team_pb_events_migration.sql
--
-- 2026-09-16: コーチ向け機能拡充(P3)「チーム内の自己ベスト更新フィード」用。
-- team_player_stats は現在値(pb_display)しか持たず「いつ・誰が・何から何へ」
-- 更新したかの履歴がない。app/(tabs)/team.tsx の PlayerDashboard.saveStats()が
-- 唯一の実際のPB書き込み経路（自動同期のautoSyncTeam等は既存値を上書きしない
-- だけの引き継ぎ）なので、そこでPBが実際に変化した時だけこのテーブルに1行追加する。
--
-- RLSはteam_player_stats等と同じ「X-Team-Codeヘッダーが一致する行のみ」方式
-- (fix_team_tables_rls.sql の _request_team_code() を再利用)。

create table if not exists team_pb_events (
  id           text primary key,             -- クライアント側でuuid生成
  team_code    text not null references teams(code) on delete cascade,
  player_name  text not null,
  event        text not null default '',     -- 種目（例: 100m）
  old_pb       text not null default '',     -- 更新前の自己ベスト表示（初回記録時は空）
  new_pb       text not null default '',
  achieved_at  timestamptz not null default now()
);

create index if not exists idx_pb_events_code_date
  on team_pb_events(team_code, achieved_at desc);

alter table team_pb_events enable row level security;

create policy "team_pb_events_by_code" on team_pb_events
  for all using (team_code = _request_team_code()) with check (team_code = _request_team_code());

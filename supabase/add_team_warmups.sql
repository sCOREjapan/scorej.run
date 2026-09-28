-- supabase/add_team_warmups.sql
-- 2026-09-26:「アップ(ウォームアップ)の時間がコーチに分かるといい」との指示で追加。
-- 最小実装: 内容(実施メニュー)までは記録せず、完了時刻のみを1日1件のupsertで記録する。
--
-- app/warmup.tsxの既存の「完了」ボタン(押すとunlockAudio+Sounds.save+router.backのみ
-- だった)を押した瞬間に、フル共有(部分共有以上)の選手のみ同期する。

create table if not exists team_warmups (
  team_code    text not null references teams(code) on delete cascade,
  player_name  text not null,
  warmup_date  date not null,
  completed_at timestamptz not null,
  synced_at    timestamptz default now(),
  primary key (team_code, player_name, warmup_date)
);

create index if not exists idx_team_warmups_code on team_warmups(team_code, warmup_date desc);

alter table team_warmups enable row level security;

create or replace function _request_team_code() returns text
language sql stable
as $$
  select nullif(current_setting('request.headers', true)::json ->> 'x-team-code', '')
$$;

drop policy if exists "team_warmups_by_code" on team_warmups;
create policy "team_warmups_by_code" on team_warmups
  for all using (team_code = _request_team_code()) with check (team_code = _request_team_code());

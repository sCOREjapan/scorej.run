-- supabase/coach_trial_migration.sql
-- 2026-09-25:「コーチプランの15日間無料体験(1アカウント1回)」機能のための移行。
--
-- 【背景】
--   teams/team_membersテーブルはこれまでSupabase authアカウントと一切紐付いておらず
--   （X-Team-Codeヘッダーによるコード所持ベースのRLSのみ）、体験の「1アカウント1回」
--   強制や「課金後に同じチームを引き継ぐ」動作を実現できなかった。
--   teams.owner_user_idでauthアカウントに紐付け、coach_trialsテーブルで体験の
--   利用状況(1行=1アカウント)を管理する。
--
-- 【注意】このプロジェクトの慣例に従い、このSQLはSupabase SQL Editorで手動実行すること
--   （自動適用はしない）。

alter table teams add column if not exists owner_user_id uuid references auth.users(id) on delete set null;
create index if not exists teams_owner_user_id_idx on teams(owner_user_id);

create table if not exists coach_trials (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  team_code  text not null references teams(code) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table coach_trials enable row level security;

-- 本人は自分の体験状況を読めるだけ（書き込みはservice_role経由のapi/start-coach-trial.tsのみ）
drop policy if exists "coach_trials_select_own" on coach_trials;
create policy "coach_trials_select_own" on coach_trials
  for select using (auth.uid() = user_id);

grant select on coach_trials to authenticated;

-- teamsの既存ポリシー(X-Team-Codeヘッダー方式)はそのまま残し、
-- 「自分がownerのチームを探す」用途のポリシーを追加するだけ。
drop policy if exists "teams_select_by_owner" on teams;
create policy "teams_select_by_owner" on teams
  for select using (auth.uid() = owner_user_id);

-- 2026-09-25 追記: 実機検証で発覚したバグへの対応。
-- 【症状】無料体験開始時に「チームの作成に失敗しました」エラー。
-- 【原因】service_roleはRLSをバイパスするが、それとは別にPostgresのGRANTレベルで
--   teamsテーブルへのINSERT権限がservice_roleに付与されていなかった
--   (エラー: "permission denied for table teams" code=42501、Postgresのヒントが
--   "GRANT INSERT ON public.teams TO service_role;"と明示していた)。
--   teamsは従来クライアント側(anonキー)からしかinsertされたことがなく、
--   api/start-coach-trial.tsが初めてservice_role経由でteamsにinsertするため、
--   これまで気づかれていなかった。
grant insert, select, update on teams to service_role;
grant insert, select, update on coach_trials to service_role;
-- 2026-09-25追記: バグ巡りで指摘された通り、api/start-coach-trial.tsは
-- teams/coach_trialsの両方にSELECTも投げている(体験済みチェック・コード衝突チェック)。
-- INSERTだけでなくSELECTも明示的にgrantしておく(このテーブルはservice_roleへの
-- 権限自動付与が効いていなかった実績があるため、暗黙に任せない)。

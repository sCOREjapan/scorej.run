-- supabase/fix_team_tables_rls_v2.sql
--
-- 【発覚】fix_team_tables_rls.sql のDROP POLICY文が、実際のポリシー名を誤って
-- 推測していた(例: team_members の実際の名前は"members_public"だったが、
-- スクリプトは"team_members_public"を消そうとしていた)。DROP POLICY IF EXISTS
-- だったためエラーにはならず、古い全公開ポリシー(using(true))が消えずに残ったまま
-- 新しいポリシーが追加される形になっていた。
-- RLSポリシーはOR条件で評価されるため、古い全公開ポリシーが1つでも残っていると、
-- 新しい制限は実質的に何の効果も持たない。
--
-- 正しいポリシー名(実行結果で確認済み)を指定して確実に削除する。

drop policy if exists "teams_public"        on teams;
drop policy if exists "members_public"      on team_members;
drop policy if exists "messages_public"     on team_messages;
drop policy if exists "videos_public"       on team_videos;
drop policy if exists "body_reports_public" on team_body_reports;
drop policy if exists "player_stats_public" on team_player_stats;
drop policy if exists "team_sessions_public" on team_sessions;
drop policy if exists "team_events_public"  on team_events;

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認：各テーブルにつき "xxx_by_code" が1つだけ残っていればOK
-- ════════════════════════════════════════════════════════════════════
select tablename, policyname from pg_policies
where tablename like 'team%' or tablename = 'teams'
order by tablename;

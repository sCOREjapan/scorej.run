-- supabase/add_team_sessions_notes.sql
-- 2026-09-26:「選手からノートを集める機能」対応。
--
-- 【背景】
--   選手側(app/(tabs)/notebook.tsx)の自由記述の練習日誌はTrainingSession.notesとして
--   ローカルに保存され、共有レベルが「フル共有」(shareLv===2)の選手は
--   lib/teamAutoSync.ts側でnotesを含む完全なセッションをsyncTeamSessions()へ渡していた。
--   しかしteam_sessionsテーブル自体にnotesカラムが無く、lib/supabaseTeam.tsの
--   syncTeamSessions()もnotesを明示的に含めずにupsertしていたため、フル共有を選んでいる
--   選手のメモも実際にはコーチ側へ一切届いていなかった（サイレントな機能欠落）。
--
-- 【対応】
--   team_sessionsにnotesカラムを追加するだけ。共有レベルによるstrip/skipのロジックは
--   既にlib/teamAutoSync.ts・app/(tabs)/team.tsxのPlayerDashboard側にあるため、
--   このカラムを追加すれば「フル共有を選んだ選手のメモだけがコーチに届く」という
--   既存の設計がそのまま正しく機能するようになる。

alter table team_sessions add column if not exists notes text;

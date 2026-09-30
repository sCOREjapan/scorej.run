-- supabase/fix_team_push_tokens_no_select.sql
--
-- 【発覚した問題】(2026-09-30 セキュリティ監査)
--   team_push_tokens_by_code が FOR ALL (SELECT含む) だったため、参加コードさえ
--   知っていれば誰でも supabase.from('team_push_tokens').select('*') でコーチ・
--   全選手のExpo Push Tokenを閲覧できた。Push Tokenは単なる識別子ではなく、
--   Expoの公開送信API(https://exp.host/--/api/v2/push/send)に渡すだけで追加認証
--   無しにその端末へ任意の通知(なりすましメッセージ等)を送れてしまう実行可能な
--   資格情報に近い。
--
-- 【方針】
--   クライアント側は自分のトークンを登録(upsert)するだけで、他人の分を読み返す
--   処理は無い(lib/supabaseTeam.tsのregisterTeamPushTokenは.select()を呼んでいない)。
--   実際に一覧を必要とするのはapi/notify.ts(service_role経由、RLSをバイパス)のみ。
--   SELECTポリシーを撤去し、INSERT/UPDATEのみ(team_codeスコープ)を残す。

drop policy if exists "team_push_tokens_by_code" on team_push_tokens;

create policy "team_push_tokens_insert_by_code" on team_push_tokens
  for insert with check (team_code = _request_team_code());

create policy "team_push_tokens_update_by_code" on team_push_tokens
  for update using (team_code = _request_team_code()) with check (team_code = _request_team_code());

-- SELECT/DELETEポリシーは意図的に作らない(default deny)。
-- 一覧取得はapi/notify.tsがservice_role経由でのみ行う。

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認：cmdにSELECTが出てこなければOK
-- ════════════════════════════════════════════════════════════════════
-- select policyname, cmd from pg_policies where tablename = 'team_push_tokens';

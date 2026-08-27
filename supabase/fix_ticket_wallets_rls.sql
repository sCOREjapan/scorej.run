-- supabase/fix_ticket_wallets_rls.sql
-- 【バグ巡りで発覚】ticket_wallets に書き込み系(INSERT/UPDATE)のRLSポリシーが
-- 1つも存在しなかった疑いへの修正。
--
-- 【原因】
--   ticket_wallet_migration.sql では ticket_wallets に SELECT ポリシーしか
--   作っていなかった。書き込みは ticket_wallet_grant / grant_once / spend の
--   3関数を経由させる設計だが、この3関数は SECURITY INVOKER
--   （呼び出したユーザーの権限のまま実行＝RLSがそのままかかる）で定義されている。
--   このプロジェクトの他の書き込み系RPC(get_admin_stats等)は全て
--   SECURITY DEFINER（RLSを無視してオーナー権限で実行）であり、この3関数だけが
--   例外的にSECURITY INVOKERになっていた。
--
--   結果、UPDATE ... WHERE user_id = auth.uid() は対応するUPDATEポリシーが
--   無いため0件ヒットとしてRLSに弾かれる（エラーにはならず黙って0行更新で終わる）。
--   それでも関数はRETURN trueを返すため、クライアント側は「成功した」と
--   思い込んだまま、実際にはサーバー上のチケット残高が一切変化しない
--   （grant/grant_once/spendいずれも同じ構造）。
--
-- 【方針】
--   profiles テーブルと同じ「FOR ALL」1本の書式に揃える。
--   本人の行のみ読み書き可（auth.uid() = user_id）。
--
-- Supabase の SQL Editor に貼り付けて実行してください（1回でよい。既存ポリシーが
-- あっても DROP POLICY IF EXISTS で安全に上書きされるだけなので、実行しても害はない）。

DROP POLICY IF EXISTS "ticket_wallets_select_own" ON ticket_wallets;
DROP POLICY IF EXISTS "ticket_wallets_own" ON ticket_wallets;

CREATE POLICY "ticket_wallets_own" ON ticket_wallets
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON ticket_wallets TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認
-- ════════════════════════════════════════════════════════════════════

-- ① ポリシーが FOR ALL の1本だけになっていることを確認
select policyname, cmd, qual, with_check
from pg_policies
where tablename = 'ticket_wallets';

-- ② 実際に増減できるか、自分のアカウントで動作確認（Supabase SQL Editorは
--    postgres権限で動くため auth.uid() が NULL になり、これ自体はエラーで正常。
--    本当の確認はアプリから grantTickets(1) → getWalletSnapshot() を叩いて
--    サーバー側の tickets 列が実際に変化するかで行うこと）

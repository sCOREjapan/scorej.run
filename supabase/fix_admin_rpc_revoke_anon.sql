-- supabase/fix_admin_rpc_revoke_anon.sql
--
-- 【発覚した問題】(2026-09-30 セキュリティ監査)
--   get_admin_stats() / get_retention_cohorts() はSECURITY DEFINERかつ
--   `grant execute ... to anon` されており、関数内部にも認可チェックが無かった
--   （「認証はアプリ側で管理」という設計コメントのみ）。app/admin.tsxのパスワード
--   (EXPO_PUBLIC_ADMIN_PASSWORD)はJSバンドルに含まれ実質公開情報のため、
--   誰でもこのRPCを直接叩いて総ユーザー数・有料転換率・チーム成長曲線・
--   D1/D7/D30リテンション等の経営指標を取得できる状態だった。
--
-- 【方針】
--   get_churned_users_export()と同じ扱いに揃える: anon/authenticatedへのGRANTを
--   撤回し、service_role経由(api/admin-stats.ts、ADMIN_EXPORT_SECRETで保護)
--   でしか呼べないようにする。

revoke execute on function get_admin_stats() from anon;
revoke execute on function get_admin_stats() from authenticated;
revoke execute on function get_retention_cohorts() from anon;
revoke execute on function get_retention_cohorts() from authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認：grantee列にanon/authenticatedが出てこなければOK
-- ════════════════════════════════════════════════════════════════════
-- select routine_name, grantee, privilege_type
-- from information_schema.routine_privileges
-- where routine_name in ('get_admin_stats', 'get_retention_cohorts');

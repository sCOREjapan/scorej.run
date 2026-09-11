-- supabase/ranking_opt_in_migration.sql
-- Supabase の SQL Editor にそのまま貼り付けて実行してください。
-- 既存の同名カラム/関数がある場合は安全に上書き・スキップされます（再実行OK）。
--
-- 【背景】
-- これまでの全国ランキング(app/ranking.tsx)は、ログインさえしていれば
-- race_records(自己ベスト)が自動的にランキング取得クエリの対象になり、
-- profiles.name(オンボーディングで入力した本名)の頭文字が本人の同意なく
-- 表示される設計になっていた(infoBannerに「ログインすると自分の記録も
-- 登録されます」と明記されていたが、実際にはトグル等の同意UIが無かった)。
--
-- このマイグレーションは、
--   1. 参加を明示的なオプトイン(profiles.ranking_opt_in)に変更
--   2. 表示名も本名ではなく、参加時にユーザーが自分で決める
--      profiles.ranking_display_name に変更
--   3. クロスユーザーの読み取りを、race_records/profiles テーブルへの
--      直接アクセスではなく、オプトイン済みユーザーの最小限のフィールド
--      だけを返す SECURITY DEFINER 関数 get_event_ranking() 経由に限定
--      (admin_migration.sql の get_admin_stats() と同じ established pattern)
-- を行う。

-- ─────────────────────────────────────────────────────────────────
-- 1. profiles にランキング参加設定カラムを追加
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ranking_opt_in boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ranking_display_name text;

-- ─────────────────────────────────────────────────────────────────
-- 2. get_event_ranking(event) — 全国ランキング取得用 RPC
--    SECURITY DEFINER で実行することで、呼び出し元のRLS権限に関わらず
--    「ranking_opt_in=true のユーザーの、表示名と記録のみ」という
--    最小限の範囲だけをクロスユーザーで返す。race_records/profilesの
--    他のカラム(生年月日等は無いが将来追加されても)は一切露出しない。
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_event_ranking(p_event text)
RETURNS TABLE (
  user_id         uuid,
  display_name    text,
  result_display  text,
  result_ms       integer,
  result_cm       integer,
  race_date       date
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT r.user_id, p.ranking_display_name, r.result_display, r.result_ms, r.result_cm, r.race_date
  FROM race_records r
  JOIN profiles p ON p.user_id = r.user_id
  WHERE r.event = p_event
    AND r.is_pb = true
    AND p.ranking_opt_in = true
    AND p.ranking_display_name IS NOT NULL
    AND btrim(p.ranking_display_name) <> ''
  ORDER BY
    CASE WHEN r.result_ms IS NOT NULL THEN r.result_ms END ASC NULLS LAST,
    CASE WHEN r.result_cm IS NOT NULL THEN r.result_cm END DESC NULLS LAST
  LIMIT 100;
$$;

-- 認証済みユーザーなら誰でも呼べる(関数内部で公開範囲を絞っているため、
-- テーブルへの直接SELECT権限は一切付与しない)
GRANT EXECUTE ON FUNCTION get_event_ranking(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION get_event_ranking(text) FROM anon;

-- ─────────────────────────────────────────────────────────────────
-- 3. 既存ユーザーの移行に関する注意
-- ─────────────────────────────────────────────────────────────────
-- ranking_opt_in はデフォルト false のため、このマイグレーション実行時点で
-- 既にrace_recordsを持っている既存ユーザーも、明示的にオプトインするまで
-- 誰のランキングにも一切表示されなくなる(既存ユーザーを含めて全員が
-- 改めて同意を選ぶ形になる。これが今回の目的そのもの)。

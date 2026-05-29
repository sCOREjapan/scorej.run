-- supabase/admin_migration.sql
-- Supabase SQL Editor にそのまま貼り付けて実行してください。
-- sCORE 管理ダッシュボード + オンボーディングプロフィール同期のためのマイグレーション

-- ─────────────────────────────────────────────────────────────────
-- 1. profiles テーブル（オンボーディング情報を Supabase に同期）
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             text,
  primary_event    text,
  event_category   text,
  age              integer,
  experience_years integer,
  prefecture       text,
  updated_at       timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 本人のみ読み書き可能（管理ダッシュボードは SECURITY DEFINER RPC 経由）
DROP POLICY IF EXISTS "profiles_own" ON profiles;
CREATE POLICY "profiles_own" ON profiles
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 2. get_admin_stats() — 管理ダッシュボード用 RPC
--    呼び出し元: app/admin.tsx  supabase.rpc('get_admin_stats')
--    返却形式  : JSON オブジェクト1行
--    SECURITY DEFINER: 集計データのみ返す（個人情報なし）
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_admin_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_users    bigint;
  v_total_sessions bigint;
  v_active_7d      bigint;
  v_pref_dist      json;
  v_event_dist     json;
  v_weekly         json;
BEGIN
  -- 総ユーザー数（Supabase 認証アカウント数）
  SELECT COUNT(*) INTO v_total_users FROM auth.users;

  -- 累計練習記録数
  SELECT COUNT(*) INTO v_total_sessions FROM training_sessions;

  -- 直近7日間のアクティブユーザー数（練習を1回以上記録）
  SELECT COUNT(DISTINCT user_id)
  INTO v_active_7d
  FROM training_sessions
  WHERE created_at > (now() - INTERVAL '7 days');

  -- 都道府県分布（多い順）
  SELECT COALESCE(json_agg(t ORDER BY t.count DESC), '[]'::json)
  INTO v_pref_dist
  FROM (
    SELECT prefecture, COUNT(*)::int AS count
    FROM profiles
    WHERE prefecture IS NOT NULL AND prefecture <> ''
    GROUP BY prefecture
  ) t;

  -- 種目カテゴリ分布（多い順）
  SELECT COALESCE(json_agg(t ORDER BY t.count DESC), '[]'::json)
  INTO v_event_dist
  FROM (
    SELECT event_category AS event, COUNT(*)::int AS count
    FROM profiles
    WHERE event_category IS NOT NULL AND event_category <> ''
    GROUP BY event_category
  ) t;

  -- 週次練習記録数（直近8週、週の開始月曜日 MM/DD 形式）
  SELECT COALESCE(json_agg(t ORDER BY t.week), '[]'::json)
  INTO v_weekly
  FROM (
    SELECT
      to_char(date_trunc('week', session_date::date), 'MM/DD') AS week,
      COUNT(*)::int AS count
    FROM training_sessions
    WHERE session_date::date > (CURRENT_DATE - INTERVAL '8 weeks')
    GROUP BY date_trunc('week', session_date::date)
  ) t;

  RETURN json_build_object(
    'total_users',     v_total_users,
    'total_sessions',  v_total_sessions,
    'active_7d',       v_active_7d,
    'prefecture_dist', v_pref_dist,
    'event_dist',      v_event_dist,
    'weekly_sessions', v_weekly
  );
END;
$$;

-- RPC を anon ロールから呼べるようにする（認証はアプリ側で管理）
GRANT EXECUTE ON FUNCTION get_admin_stats() TO anon;
GRANT EXECUTE ON FUNCTION get_admin_stats() TO authenticated;

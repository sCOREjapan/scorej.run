-- supabase/admin_migration_v2.sql
-- 管理ダッシュボード拡張（有料率・チーム普及・リテンション）
-- Supabase の SQL Editor にそのまま貼り付けて実行してください。
-- admin_migration.sql の後に実行する前提（get_admin_stats を置き換えます）。

-- ─────────────────────────────────────────────────────────────────
-- 1. profiles に課金状態カラムを追加
--    PurchaseContext.tsx がプラン確定のたびに本人の行だけを更新する
--    （RLS の profiles_own ポリシーで本人のみ書き込み可）
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan_tier text DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS has_ticket_monthly boolean DEFAULT false;

-- ─────────────────────────────────────────────────────────────────
-- 2. get_admin_stats() を拡張（既存の集計に追加するだけ・個人情報は返さない）
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
  v_paid_pct       numeric;
  v_total_teams    bigint;
  v_total_members  bigint;
  v_teams_weekly   json;
BEGIN
  SELECT COUNT(*) INTO v_total_users FROM auth.users;
  SELECT COUNT(*) INTO v_total_sessions FROM training_sessions;

  SELECT COUNT(DISTINCT user_id)
  INTO v_active_7d
  FROM training_sessions
  WHERE created_at > (now() - INTERVAL '7 days');

  SELECT COALESCE(json_agg(t ORDER BY t.count DESC), '[]'::json)
  INTO v_pref_dist
  FROM (
    SELECT prefecture, COUNT(*)::int AS count
    FROM profiles
    WHERE prefecture IS NOT NULL AND prefecture <> ''
    GROUP BY prefecture
  ) t;

  SELECT COALESCE(json_agg(t ORDER BY t.count DESC), '[]'::json)
  INTO v_event_dist
  FROM (
    SELECT event_category AS event, COUNT(*)::int AS count
    FROM profiles
    WHERE event_category IS NOT NULL AND event_category <> ''
    GROUP BY event_category
  ) t;

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

  -- 有料率（plan_tier が free 以外、またはチケット月額加入中の割合）
  SELECT CASE WHEN COUNT(*) = 0 THEN 0
    ELSE ROUND(100.0 * COUNT(*) FILTER (
      WHERE plan_tier IS DISTINCT FROM 'free' OR has_ticket_monthly
    ) / COUNT(*), 1)
  END
  INTO v_paid_pct
  FROM profiles;

  SELECT COUNT(*) INTO v_total_teams FROM teams;
  SELECT COUNT(*) INTO v_total_members FROM team_members;

  SELECT COALESCE(json_agg(t ORDER BY t.week), '[]'::json)
  INTO v_teams_weekly
  FROM (
    SELECT
      to_char(date_trunc('week', created_at::date), 'MM/DD') AS week,
      COUNT(*)::int AS count
    FROM teams
    WHERE created_at::date > (CURRENT_DATE - INTERVAL '8 weeks')
    GROUP BY date_trunc('week', created_at::date)
  ) t;

  RETURN json_build_object(
    'total_users',     v_total_users,
    'total_sessions',  v_total_sessions,
    'active_7d',       v_active_7d,
    'prefecture_dist', v_pref_dist,
    'event_dist',      v_event_dist,
    'weekly_sessions', v_weekly,
    'paid_pct',        v_paid_pct,
    'total_teams',     v_total_teams,
    'total_members',   v_total_members,
    'teams_weekly',    v_teams_weekly
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_admin_stats() TO anon;
GRANT EXECUTE ON FUNCTION get_admin_stats() TO authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3. get_retention_cohorts() — 週次サインアップコホートのD1/D7/D30復帰率
--    「サインアップ日からN日以上経った後に、少なくとも1回練習記録をつけたか」の近似値。
--    厳密な「ちょうどN日目に開いたか」ではない点に注意（実データで計算可能な近似）。
--    こちらも集計のみ・個人情報は返さない。
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_retention_cohorts()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH cohort AS (
    SELECT
      u.id AS auth_id,
      date_trunc('week', u.created_at)::date AS signup_week,
      u.created_at AS signup_at
    FROM auth.users u
    WHERE u.created_at > (CURRENT_DATE - INTERVAL '10 weeks')
  ),
  activity AS (
    SELECT
      p.auth_id,
      MIN(ts.created_at) FILTER (
        WHERE ts.created_at > c.signup_at + INTERVAL '1 day'
      ) IS NOT NULL AS returned_d1,
      MIN(ts.created_at) FILTER (
        WHERE ts.created_at > c.signup_at + INTERVAL '7 days'
      ) IS NOT NULL AS returned_d7,
      MIN(ts.created_at) FILTER (
        WHERE ts.created_at > c.signup_at + INTERVAL '30 days'
      ) IS NOT NULL AS returned_d30
    FROM cohort c
    JOIN users p ON p.auth_id = c.auth_id
    LEFT JOIN training_sessions ts ON ts.user_id = p.id
    GROUP BY p.auth_id
  )
  SELECT COALESCE(json_agg(t ORDER BY t.signup_week), '[]'::json)
  FROM (
    SELECT
      to_char(c.signup_week, 'MM/DD') AS signup_week,
      COUNT(*)::int AS cohort_size,
      ROUND(100.0 * COUNT(*) FILTER (WHERE a.returned_d1)  / NULLIF(COUNT(*), 0), 1) AS d1_pct,
      ROUND(100.0 * COUNT(*) FILTER (WHERE a.returned_d7)  / NULLIF(COUNT(*), 0), 1) AS d7_pct,
      ROUND(100.0 * COUNT(*) FILTER (WHERE a.returned_d30) / NULLIF(COUNT(*), 0), 1) AS d30_pct
    FROM cohort c
    JOIN users p ON p.auth_id = c.auth_id
    LEFT JOIN activity a ON a.auth_id = c.auth_id
    GROUP BY c.signup_week
  ) t;
$$;

GRANT EXECUTE ON FUNCTION get_retention_cohorts() TO anon;
GRANT EXECUTE ON FUNCTION get_retention_cohorts() TO authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 4. get_churned_users_export() — 離脱ユーザーのメール一覧（個人情報を含む）
--    ⚠️ service_role 以外には絶対に EXECUTE 権限を与えない。
--    anon/authenticated への GRANT が無ければ、公開anonキーからは呼び出せない
--    （Supabaseの service_role キーはサーバー専用で、api/admin-churned-users.ts
--    からのみ使用する。クライアント[admin.tsx]は直接このRPCを呼ばない）。
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_churned_users_export(
  p_min_sessions int DEFAULT 3,
  p_inactive_days int DEFAULT 21
)
RETURNS TABLE (
  email text,
  name text,
  primary_event text,
  total_sessions bigint,
  last_session date
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    au.email,
    u.name,
    u.primary_event,
    COUNT(ts.id) AS total_sessions,
    MAX(ts.session_date) AS last_session
  FROM users u
  JOIN auth.users au ON au.id = u.auth_id
  LEFT JOIN training_sessions ts ON ts.user_id = u.id
  GROUP BY au.email, u.name, u.primary_event
  HAVING COUNT(ts.id) >= p_min_sessions
     AND MAX(ts.session_date) < (CURRENT_DATE - (p_inactive_days || ' days')::interval)
  ORDER BY MAX(ts.session_date) DESC;
$$;

-- 意図的に GRANT しない（service_role はデフォルトで全関数を実行できるため不要）。
-- 万一 anon/authenticated に付与されていないか、下のクエリで定期的に確認すること:
--   select grantee, privilege_type from information_schema.routine_privileges
--   where routine_name = 'get_churned_users_export';

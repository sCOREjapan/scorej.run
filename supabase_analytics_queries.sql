-- sCORE APP 分析クエリ集（企業スポンサー・事業判断用）
-- Supabase の SQL Editor に貼り付けて実行

-- ─────────────────────────────────────────────────────────
-- 1. DAU（日次アクティブユーザー）推移
-- ─────────────────────────────────────────────────────────
SELECT
  created_at::date AS day,
  count(DISTINCT user_id_hash) AS dau
FROM analytics_events
WHERE event_name = 'app_open'
GROUP BY day
ORDER BY day DESC
LIMIT 30;

-- ─────────────────────────────────────────────────────────
-- 2. プラン分布（FREE vs PRO vs ELITE vs COACH）
-- ─────────────────────────────────────────────────────────
SELECT
  plan_tier,
  count(DISTINCT user_id_hash) AS users,
  round(count(DISTINCT user_id_hash)::numeric / sum(count(DISTINCT user_id_hash)) OVER () * 100, 1) AS pct
FROM analytics_events
WHERE event_name = 'app_open'
  AND created_at >= now() - interval '30 days'
GROUP BY plan_tier
ORDER BY users DESC;

-- ─────────────────────────────────────────────────────────
-- 3. 練習種別ランキング（スポーツ用品メーカー向け）
-- ─────────────────────────────────────────────────────────
SELECT
  metadata->>'session_type' AS session_type,
  count(*) AS count,
  round(count(*)::numeric / sum(count(*)) OVER () * 100, 1) AS pct
FROM analytics_events
WHERE event_name = 'record_session'
  AND created_at >= now() - interval '30 days'
GROUP BY session_type
ORDER BY count DESC;

-- ─────────────────────────────────────────────────────────
-- 4. 怪我部位ランキング（テーピング・医療機器メーカー向け）
-- ─────────────────────────────────────────────────────────
SELECT
  jsonb_array_elements_text(metadata->'parts') AS body_part,
  count(*) AS report_count
FROM analytics_events
WHERE event_name = 'body_report'
GROUP BY body_part
ORDER BY report_count DESC;

-- ─────────────────────────────────────────────────────────
-- 5. ペイウォール → 購入コンバージョン率
-- ─────────────────────────────────────────────────────────
WITH views AS (
  SELECT count(DISTINCT user_id_hash) AS view_users
  FROM analytics_events WHERE event_name = 'upgrade_view'
    AND created_at >= now() - interval '30 days'
),
purchases AS (
  SELECT count(DISTINCT user_id_hash) AS buy_users
  FROM analytics_events WHERE event_name = 'upgrade_complete'
    AND created_at >= now() - interval '30 days'
)
SELECT
  view_users,
  buy_users,
  round(buy_users::numeric / NULLIF(view_users, 0) * 100, 1) AS conversion_pct
FROM views, purchases;

-- ─────────────────────────────────────────────────────────
-- 6. 機能別利用回数（AI機能の需要調査）
-- ─────────────────────────────────────────────────────────
SELECT
  feature,
  count(*) AS uses,
  count(DISTINCT user_id_hash) AS unique_users
FROM analytics_events
WHERE event_name = 'use_feature'
  AND created_at >= now() - interval '30 days'
GROUP BY feature
ORDER BY uses DESC;

-- ─────────────────────────────────────────────────────────
-- 7. チーム機能の普及度（コーチ vs 選手比率）
-- ─────────────────────────────────────────────────────────
SELECT
  metadata->>'role' AS role,
  count(*) AS count
FROM analytics_events
WHERE event_name = 'team_join'
GROUP BY role;

-- ─────────────────────────────────────────────────────────
-- 8. 月次成長率（MoM Growth）
-- ─────────────────────────────────────────────────────────
SELECT
  date_trunc('month', created_at) AS month,
  count(DISTINCT user_id_hash) AS mau
FROM analytics_events
WHERE event_name = 'app_open'
GROUP BY month
ORDER BY month DESC;

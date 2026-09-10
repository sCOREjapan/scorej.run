-- sCORE AI機能 実利用回数チェック（2026-09-09）
-- Supabase の SQL Editor に貼り付けて実行してください
-- （anon/authenticatedキーにはSELECT権限を与えていないため、Claude側からは実行できません）

-- ─────────────────────────────────────────────────────────
-- 1. 直近30日のAI機能別 利用回数・ユニークユーザー数
--    ※ video / meal / ai_analysis / meal_coach / csv は元々トラッキング済み。
--       workout / daily_insight / notebook_ai / injury_recovery / competition_plan は
--       2026-09-09の本番反映以降のデータしか無いので、しばらくは0件または少数のはず。
-- ─────────────────────────────────────────────────────────
SELECT
  feature,
  count(*) AS uses,
  count(DISTINCT user_id_hash) AS unique_users,
  round(count(*)::numeric / NULLIF(count(DISTINCT user_id_hash), 0), 1) AS uses_per_user
FROM analytics_events
WHERE event_name = 'use_feature'
  AND created_at >= now() - interval '30 days'
GROUP BY feature
ORDER BY uses DESC;

-- ─────────────────────────────────────────────────────────
-- 2. injury_recovery の要求日数分布（30日クランプの影響確認用）
--    ※ トラッキング追加後のデータのみ。しばらく経ってから確認してください。
--    total_days=30が多ければ「本当は90日欲しかった人がクランプに引っかかっている」
--    可能性がある。少なければクランプの実害はほぼ無い。
-- ─────────────────────────────────────────────────────────
SELECT
  (metadata->>'total_days')::int AS total_days,
  count(*) AS requests
FROM analytics_events
WHERE event_name = 'use_feature'
  AND feature = 'injury_recovery'
  AND created_at >= now() - interval '30 days'
GROUP BY total_days
ORDER BY total_days DESC;

-- ─────────────────────────────────────────────────────────
-- 3. competition_plan の申込み日数分布（チャンク回数の実態確認）
--    days_until が21超（3週間超）だとチャンク分割(複数回API呼び出し)が発生する
-- ─────────────────────────────────────────────────────────
SELECT
  CASE
    WHEN (metadata->>'days_until')::int <= 21 THEN '〜3週間（チャンクなし・1回呼び出し）'
    WHEN (metadata->>'days_until')::int <= 42 THEN '3〜6週間（2回呼び出し）'
    ELSE '6週間超（3回呼び出し）'
  END AS bucket,
  count(*) AS requests
FROM analytics_events
WHERE event_name = 'competition_plan'
  AND created_at >= now() - interval '30 days'
GROUP BY bucket
ORDER BY requests DESC;

-- ─────────────────────────────────────────────────────────
-- 4. 全体のイベント量感（このアプリのanalytics_events自体がどれくらい溜まっているか）
-- ─────────────────────────────────────────────────────────
SELECT count(*) AS total_events, min(created_at) AS earliest, max(created_at) AS latest
FROM analytics_events;

-- ════════════════════════════════════════════════════════════════════
-- sCORE 離脱・継続率クエリ集
-- Supabase の SQL Editor に貼り付けて実行
--
-- 【重要】アンインストール数そのものは Supabase では取れません。
--   アプリを消しても、あなたのDBには何の通知も来ないためです。
--   本当のアンインストール数は App Store Connect →
--   アナリティクス → 「削除数」でのみ確認できます。
--
--   ここで取れるのは「最終起動からN日経った＝実質離脱」という
--   代理指標です。実務上はこちらの方が行動につながります。
--
-- 【注意】user_id_hash は端末に保存された匿名IDです。
--   アンインストール→再インストールすると別IDになります。
--   つまり「消して入れ直した人」は新規ユーザーとして数えられます。
-- ════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────
-- 1. 離脱ユーザー数（最終起動からの経過日数別）★まずこれ
--    「何人が、どれくらい前から来ていないか」
-- ─────────────────────────────────────────────────────────
WITH last_open AS (
  SELECT user_id_hash, max(created_at)::date AS last_day
  FROM analytics_events
  WHERE event_name = 'app_open'
  GROUP BY 1
)
SELECT
  CASE
    WHEN current_date - last_day = 0            THEN '今日も起動'
    WHEN current_date - last_day BETWEEN 1 AND 2   THEN '1〜2日前'
    WHEN current_date - last_day BETWEEN 3 AND 6   THEN '3〜6日前'
    WHEN current_date - last_day BETWEEN 7 AND 13  THEN '7〜13日前（離脱の入口）'
    WHEN current_date - last_day BETWEEN 14 AND 29 THEN '14〜29日前（ほぼ離脱）'
    ELSE                                            '30日以上（実質アンインストール相当）'
  END AS 状態,
  count(*) AS 人数,
  round(count(*)::numeric / sum(count(*)) OVER () * 100, 1) AS 割合pct
FROM last_open
GROUP BY 1
ORDER BY min(current_date - last_day);


-- ─────────────────────────────────────────────────────────
-- 2. DAU / WAU / MAU とスティッキネス
--    スティッキネス = DAU/MAU。20%超えれば健全と言われる
-- ─────────────────────────────────────────────────────────
SELECT
  count(DISTINCT user_id_hash) FILTER (WHERE created_at >= current_date)                       AS dau,
  count(DISTINCT user_id_hash) FILTER (WHERE created_at >= current_date - interval '7 days')   AS wau,
  count(DISTINCT user_id_hash) FILTER (WHERE created_at >= current_date - interval '30 days')  AS mau,
  round(
    count(DISTINCT user_id_hash) FILTER (WHERE created_at >= current_date)::numeric
    / NULLIF(count(DISTINCT user_id_hash) FILTER (WHERE created_at >= current_date - interval '30 days'), 0) * 100
  , 1) AS スティッキネスpct
FROM analytics_events
WHERE event_name = 'app_open';


-- ─────────────────────────────────────────────────────────
-- 3. 生存曲線（初回起動から何日目まで残っているか）★最重要
--    「入れた人が何日で消えるか」が分かる。
--    D1が50%を切っていたらオンボーディングに問題がある。
-- ─────────────────────────────────────────────────────────
WITH first_seen AS (
  SELECT user_id_hash, min(created_at)::date AS day0
  FROM analytics_events
  WHERE event_name = 'app_open'
  GROUP BY 1
),
activity AS (
  SELECT DISTINCT f.user_id_hash, f.day0, e.created_at::date - f.day0 AS day_n
  FROM first_seen f
  JOIN analytics_events e ON e.user_id_hash = f.user_id_hash
  WHERE e.event_name = 'app_open'
),
base AS (SELECT count(*) AS total FROM first_seen)
SELECT
  day_n AS 初回からの日数,
  count(DISTINCT user_id_hash) AS 残存人数,
  round(count(DISTINCT user_id_hash)::numeric / (SELECT total FROM base) * 100, 1) AS 残存率pct
FROM activity
WHERE day_n BETWEEN 0 AND 30
GROUP BY day_n
ORDER BY day_n;


-- ─────────────────────────────────────────────────────────
-- 4. コホート別 継続率（インストールした週ごとの D1 / D7 / D30）
--    施策の効果が week 単位で見える
-- ─────────────────────────────────────────────────────────
WITH first_seen AS (
  SELECT user_id_hash, min(created_at)::date AS day0
  FROM analytics_events
  WHERE event_name = 'app_open'
  GROUP BY 1
),
act AS (
  SELECT DISTINCT f.user_id_hash, date_trunc('week', f.day0)::date AS cohort,
         e.created_at::date - f.day0 AS day_n
  FROM first_seen f
  JOIN analytics_events e ON e.user_id_hash = f.user_id_hash
  WHERE e.event_name = 'app_open'
)
SELECT
  cohort AS インストール週,
  count(DISTINCT user_id_hash) FILTER (WHERE day_n = 0)  AS 新規,
  round(count(DISTINCT user_id_hash) FILTER (WHERE day_n = 1)::numeric
      / NULLIF(count(DISTINCT user_id_hash) FILTER (WHERE day_n = 0), 0) * 100, 1) AS d1_pct,
  round(count(DISTINCT user_id_hash) FILTER (WHERE day_n = 7)::numeric
      / NULLIF(count(DISTINCT user_id_hash) FILTER (WHERE day_n = 0), 0) * 100, 1) AS d7_pct,
  round(count(DISTINCT user_id_hash) FILTER (WHERE day_n = 30)::numeric
      / NULLIF(count(DISTINCT user_id_hash) FILTER (WHERE day_n = 0), 0) * 100, 1) AS d30_pct
FROM act
GROUP BY cohort
ORDER BY cohort DESC
LIMIT 12;


-- ─────────────────────────────────────────────────────────
-- 5. 新規 / 復帰 / 離脱 の日次推移
--    「増えてるのか減ってるのか」を1枚で
-- ─────────────────────────────────────────────────────────
WITH opens AS (
  SELECT DISTINCT user_id_hash, created_at::date AS day
  FROM analytics_events
  WHERE event_name = 'app_open'
),
first_seen AS (
  SELECT user_id_hash, min(day) AS day0 FROM opens GROUP BY 1
),
tagged AS (
  SELECT o.day, o.user_id_hash,
    CASE
      WHEN o.day = f.day0 THEN '新規'
      WHEN o.day - lag(o.day) OVER (PARTITION BY o.user_id_hash ORDER BY o.day) > 7 THEN '復帰'
      ELSE '継続'
    END AS 区分
  FROM opens o JOIN first_seen f ON f.user_id_hash = o.user_id_hash
)
SELECT day AS 日付,
  count(*) FILTER (WHERE 区分 = '新規') AS 新規,
  count(*) FILTER (WHERE 区分 = '復帰') AS 復帰,
  count(*) FILTER (WHERE 区分 = '継続') AS 継続
FROM tagged
GROUP BY day
ORDER BY day DESC
LIMIT 30;


-- ─────────────────────────────────────────────────────────
-- 6. アプリバージョン分布（アップデートの浸透率）
--    11.0.0 がどれくらい行き渡ったか確認できる
-- ─────────────────────────────────────────────────────────
SELECT
  coalesce(app_version, '(不明)') AS バージョン,
  count(DISTINCT user_id_hash) AS 人数,
  round(count(DISTINCT user_id_hash)::numeric / sum(count(DISTINCT user_id_hash)) OVER () * 100, 1) AS pct
FROM analytics_events
WHERE event_name = 'app_open'
  AND created_at >= now() - interval '14 days'
GROUP BY 1
ORDER BY 人数 DESC;


-- ─────────────────────────────────────────────────────────
-- 7. 離脱者が「最後に使った機能」
--    どこで見限られているかの手がかり
-- ─────────────────────────────────────────────────────────
WITH last_open AS (
  SELECT user_id_hash, max(created_at) AS last_at
  FROM analytics_events WHERE event_name = 'app_open' GROUP BY 1
),
churned AS (
  SELECT user_id_hash, last_at FROM last_open
  WHERE last_at < now() - interval '14 days'
),
last_feature AS (
  SELECT DISTINCT ON (e.user_id_hash)
    e.user_id_hash, e.event_name, e.feature
  FROM analytics_events e
  JOIN churned c ON c.user_id_hash = e.user_id_hash
  WHERE e.event_name <> 'app_open'
  ORDER BY e.user_id_hash, e.created_at DESC
)
SELECT
  event_name AS 最後のイベント,
  coalesce(feature, '-') AS 機能,
  count(*) AS 離脱者数
FROM last_feature
GROUP BY 1, 2
ORDER BY 離脱者数 DESC
LIMIT 20;


-- ─────────────────────────────────────────────────────────
-- 8. プラン別の継続率（課金者は残るのか）
-- ─────────────────────────────────────────────────────────
WITH last_open AS (
  SELECT user_id_hash,
         max(created_at)::date AS last_day,
         (array_agg(plan_tier ORDER BY created_at DESC))[1] AS tier
  FROM analytics_events WHERE event_name = 'app_open' GROUP BY 1
)
SELECT
  coalesce(tier, '(不明)') AS プラン,
  count(*) AS 人数,
  count(*) FILTER (WHERE current_date - last_day <= 7) AS 直近7日に起動,
  round(count(*) FILTER (WHERE current_date - last_day <= 7)::numeric
      / NULLIF(count(*), 0) * 100, 1) AS 継続率pct
FROM last_open
GROUP BY 1
ORDER BY 人数 DESC;

-- supabase/add_ai_health_checks.sql
--
-- 2026-09-09: 「モデルが退役・404になっても誰も気づかず1ヶ月放置される」事故
-- （2026-08-27発覚、api/analyze.tsの冒頭コメント参照）の再発防止。
-- 毎日1回、Gemini本番/軽量モデルとAnthropicフォールバックへ固定の軽量プロンプトを
-- 送り、結果をこのテーブルに記録する（api/ai-health-check.ts）。
-- クライアントからは書けない（サーバーのservice_roleキーのみが書き込む想定）。

create table if not exists ai_health_checks (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null,           -- 'gemini_main' | 'gemini_lite' | 'anthropic_fallback'
  ok          boolean not null,
  latency_ms  integer,
  error       text,
  checked_at  timestamptz default now()
);

create index if not exists idx_ai_health_checks_checked_at on ai_health_checks(checked_at desc);

alter table ai_health_checks enable row level security;
-- クライアントには一切の権限を与えない（service_role専用。selectすら与えない）

-- ════════════════════════════════════════════════════════════════════
-- 開発者が確認する用のクエリ（Supabase SQL Editorで実行）
-- ════════════════════════════════════════════════════════════════════
-- 直近7日で失敗したチェック一覧
-- select * from ai_health_checks where ok = false and checked_at > now() - interval '7 days' order by checked_at desc;

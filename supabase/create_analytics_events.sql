-- ════════════════════════════════════════════════════════════════════
-- analytics_events テーブル作成
--
-- 【背景】
--   lib/analytics.ts は起動のたびにこのテーブルへ insert しているが、
--   テーブルが存在せず（42P01）、全て失敗していた。
--   analytics.ts は catch {} で握りつぶす作りのため、
--   アプリは無事だが、データは1件も溜まっていなかった。
--
-- 【設計方針】
--   クライアントからは「書き込み専用」にする。
--   分析は SQL Editor（postgres ロール = RLSを迂回）から行うため、
--   anon / authenticated に SELECT は与えない。
--   これにより、他人のイベントを覗かれる事故を防ぐ。
--
-- Supabase の SQL Editor に貼り付けて実行
-- ════════════════════════════════════════════════════════════════════

-- ── テーブル本体（列は lib/analytics.ts の insert と一致させる） ──
create table if not exists public.analytics_events (
  id           bigint generated always as identity primary key,
  event_name   text        not null,
  user_id_hash text,
  plan_tier    text,
  feature      text,
  metadata     jsonb,
  app_version  text,
  platform     text,
  created_at   timestamptz not null default now()
);

-- ── 分析クエリ用のインデックス ──
create index if not exists analytics_events_created_at_idx
  on public.analytics_events (created_at desc);

create index if not exists analytics_events_event_name_idx
  on public.analytics_events (event_name);

-- DAU / 継続率クエリは (user_id_hash, created_at) で引くので複合を張る
create index if not exists analytics_events_user_day_idx
  on public.analytics_events (user_id_hash, created_at desc);

-- ── 権限（GRANT）──
-- ここが今回の permission denied の根本原因。RLSより手前の関門。
grant usage on schema public to anon, authenticated;
grant insert on public.analytics_events to anon, authenticated;
-- ↑ select は敢えて与えない（クライアントに読ませない）

-- ── RLS ──
alter table public.analytics_events enable row level security;

-- 書き込みのみ許可。select ポリシーが無いので誰も読めない。
drop policy if exists "analytics_insert_only" on public.analytics_events;
create policy "analytics_insert_only"
  on public.analytics_events
  for insert
  to anon, authenticated
  with check (true);

-- ── 確認 ──
-- 実行後、アプリを起動し直してから以下で件数を確認する
--   select count(*), min(created_at), max(created_at) from analytics_events;

-- supabase/team_plan_codes_migration.sql
-- 2026-09-14: チーム/コーチプランをApp内課金からStripe外部決済+コード引き換え方式に
-- 切り替えるための新規テーブル。api/create-team-checkout.ts が決済セッションを作り、
-- api/team-checkout-verify.ts が決済確認後にコードを1件発行してここに書き込み、
-- api/redeem-team-code.ts がアプリ内からの引き換えリクエストでここを検証・使用済み化する。
--
-- RLSは有効化するがポリシーは作らない = anon/authenticatedキーからは一切読み書き不可、
-- SUPABASE_SERVICE_ROLE_KEYを使うAPIルート(サーバー側)からのみアクセス可能
-- （api/analyze.tsのTICKET_COST_SERVER検証などサーバー専用テーブルと同じ方針）。

create table if not exists team_plan_codes (
  code            text primary key,
  -- lib/purchaseService.ts の PRODUCT_IDS キー名と揃える
  -- (coach_monthly / coach_monthly_30 / coach_monthly_unlimited)。
  -- 実際にRevenueCatへ付与するentitlementは全tier共通で"coach"1本
  -- (isCoachはtier==='coach'の真偽値のみで判定しており、15/30/無制限の
  -- 人数上限自体はアプリ側で強制していないため。api/redeem-team-code.ts参照)
  tier            text not null check (tier in ('coach_monthly', 'coach_monthly_30', 'coach_monthly_unlimited')),
  status          text not null default 'unused' check (status in ('unused', 'redeemed')),
  stripe_session_id text unique,
  purchaser_email text,
  redeemed_by     uuid references auth.users(id),
  redeemed_at     timestamptz,
  created_at      timestamptz not null default now()
);

alter table team_plan_codes enable row level security;

comment on table team_plan_codes is
  'チームプラン外部決済(Stripe)の引き換えコード。service_role専用、RLSポリシーなし。';

-- 2026-09-14追記: コード自体に有効期限を追加。決済してから何ヶ月も経ってから
-- 誰かに転送されて使われる、といった事故を防ぐ(RevenueCat側のentitlement期間=yearlyとは
-- 別軸。こちらは「コードそのものをいつまでに引き換えないと失効するか」)。
-- 既存の行(このカラム追加前に発行済みのコード)はNULL=無期限のまま扱われるよう、
-- アプリ側(api/redeem-team-code.ts)はexpires_atがNULLなら失効判定をスキップする。
alter table team_plan_codes add column if not exists expires_at timestamptz;

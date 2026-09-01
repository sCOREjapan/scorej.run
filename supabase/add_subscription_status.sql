-- supabase/add_subscription_status.sql
--
-- 【背景】
--   課金プラン(tier)の判定が端末ローカル(AsyncStorage/Web版はlocalStorage)キャッシュのみに
--   依存しており、サーバー側(api/analyze.ts)は一切検証していなかった。Web版はブラウザの
--   開発者ツールでlocalStorageを書き換えるだけで「coach(無制限)」を自称でき、チケット消費・
--   絶対上限以外の全ての課金判定をすり抜けられる状態だった。
--
-- 【方針】
--   api/revenuecat-webhook.ts が RevenueCat から購読状態の変化を受け取るたびに、
--   RevenueCat REST APIで取得した「本当に有効なentitlement」をこのテーブルに書き込む。
--   書き込みは service_role キー経由(webhook)のみで行い、クライアントからの書き込みは
--   一切許可しない。api/analyze.ts はこのテーブルを見て、サーバー側でticket消費を強制するか
--   どうかを判定する。
--
-- 【安全な移行】
--   このテーブルに行が無い(webhookがまだ一度も届いていない)ユーザーについては、
--   api/analyze.ts側で「未確認」として扱い、今まで通りクライアントの自己申告を信用する
--   （行が無い＝即free扱いにして誤ってチケットを要求する、という regressive な実装は
--   絶対にしないこと。既存の有料ユーザーを誤ってブロックするリスクの方が大きい）。

create table if not exists subscription_status (
  user_id                   uuid primary key references auth.users(id) on delete cascade,
  tier                      text not null default 'free' check (tier in ('free', 'noad', 'coach')),
  expires_at                timestamptz,
  original_purchase_date    timestamptz,
  has_ticket_monthly        boolean not null default false,
  ticket_monthly_expires_at timestamptz,
  updated_at                timestamptz not null default now()
);

alter table subscription_status enable row level security;

-- 本人は自分の行を読めるだけ（書き込みはservice_role経由のwebhookのみ。
-- authenticated/anonにはINSERT/UPDATE/DELETEを一切与えない）
drop policy if exists "subscription_status_select_own" on subscription_status;
create policy "subscription_status_select_own" on subscription_status
  for select using (auth.uid() = user_id);

grant select on subscription_status to authenticated;

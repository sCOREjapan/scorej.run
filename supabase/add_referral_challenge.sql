-- supabase/add_referral_challenge.sql
-- 友達紹介チャレンジ: コードを発行した紹介者と、登録直後にそのコードを入力した
-- 被紹介者の双方にチケットを付与する機能。
--
-- チケットはAI機能の実質的な通貨のため、往復稼ぎ（自分で複数アカウントを作って
-- 自分のコードを入力する等）を防ぐ判定はすべてサーバー側（このテーブルの制約と
-- RLS）で行う。クライアントはinsertを試みるだけで、通れば成功・弾かれれば失敗。
--
-- Supabase の SQL Editor にそのまま貼り付けて実行してください。
-- 既に同名テーブルがある場合は "if not exists" によりスキップされ、安全に再実行できます。

-- ─────────────────────────────────────────
-- 紹介コード（1ユーザーにつき1つ、使い回し）
-- ─────────────────────────────────────────
create table if not exists referral_codes (
  code              text primary key,
  referrer_user_id  uuid not null unique references users(id) on delete cascade,
  created_at        timestamptz default now()
);

alter table referral_codes enable row level security;

-- 誰でも検索できる（友達がコード入力時に存在確認するため）
drop policy if exists "referral_codes_select_all" on referral_codes;
create policy "referral_codes_select_all" on referral_codes
  for select using (true);

-- 発行は本人の分のみ作成できる
drop policy if exists "referral_codes_insert_own" on referral_codes;
create policy "referral_codes_insert_own" on referral_codes
  for insert with check (referrer_user_id = (select id from users where auth_id = auth.uid()));

-- ─────────────────────────────────────────
-- 紹介成立記録（redeemer_user_id の unique 制約が「生涯1回だけ」の最終防衛線）
-- ─────────────────────────────────────────
create table if not exists referral_redemptions (
  id                uuid primary key default gen_random_uuid(),
  code              text not null references referral_codes(code) on delete cascade,
  referrer_user_id  uuid not null references users(id) on delete cascade,
  redeemer_user_id  uuid not null unique references users(id) on delete cascade,
  created_at        timestamptz default now(),
  constraint no_self_referral check (redeemer_user_id <> referrer_user_id)
);

create index if not exists idx_referral_redemptions_referrer
  on referral_redemptions(referrer_user_id);

alter table referral_redemptions enable row level security;

-- 自分が被紹介者として作る行のみinsert可。あわせて以下をDB側で強制する:
--   ・入力したコードの発行者(referrer_user_id)と一致しているか
--   ・アカウント作成から48時間以内か（既存ユーザーが後から友達のコードを
--     入力して回る "後付け紹介" を防ぐ弱いガード。主防衛線はunique制約の方）
drop policy if exists "referral_redemptions_insert_own" on referral_redemptions;
create policy "referral_redemptions_insert_own" on referral_redemptions
  for insert with check (
    redeemer_user_id = (select id from users where auth_id = auth.uid())
    and referrer_user_id = (
      select referral_codes.referrer_user_id from referral_codes
      where referral_codes.code = referral_redemptions.code
    )
    and (select created_at from users where id = redeemer_user_id) > now() - interval '48 hours'
  );

-- 自分が紹介者 or 被紹介者として関わった行は閲覧できる
-- （紹介者側はアプリ起動時に「未受け取りの紹介成立」をチェックしてチケット付与するため）
drop policy if exists "referral_redemptions_select_own" on referral_redemptions;
create policy "referral_redemptions_select_own" on referral_redemptions
  for select using (
    referrer_user_id = (select id from users where auth_id = auth.uid())
    or redeemer_user_id = (select id from users where auth_id = auth.uid())
  );

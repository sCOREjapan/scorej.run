-- supabase/fix_referral_codes_exposure.sql
--
-- 【発覚した問題（2026-09-09、PII漏洩の全体監査中に発見）】
--   referral_codes の SELECT ポリシーが `using (true)` になっており、
--   「友達がコード入力時に存在確認できるように」という意図（add_referral_challenge.sql
--   のコメント参照）で作られていた。しかし RLS の using(true) は行の可視性を
--   一切絞り込まないため、クライアントが `.eq('code', 'XXXXXX')` のような絞り込みを
--   付けずに `select *` を投げれば、認証なし・app公開anonキーのみで全件（発覚時点で102件）
--   が読み取れてしまっていた。取得できる列は code と referrer_user_id（内部usersテーブルの
--   実UUID）で、氏名やメールそのものではないが、ユーザーの実在数・内部IDを外部から
--   無制限に列挙できる状態だった。
--
--   実際のクライアント側の使い方（lib/referral.ts）を確認したところ、referral_codes への
--   select は以下の2箇所のみで、どちらもログイン済みユーザーしか呼んでいない
--   （getMyUserId() が null なら早期return）:
--     1. getMyReferralCode(): 自分の発行済みコードを取得（referrer_user_id = 自分）
--     2. redeemReferralCode(): 友達から渡された1件のコードの実在確認（code = 入力値）
--   「未ログインの第三者が任意にコード実在確認する」というユースケースは実際には
--   存在しないため、add_referral_challenge.sql のコメントにあった設計意図
--   （誰でも検索できる必要がある）は現状のクライアント実装とは一致していない。
--
-- 【方針】
--   1. 直接テーブルへの SELECT は「自分の行のみ」に制限する（using(true)を撤去）。
--   2. コード実在確認（redeemReferralCode）は、単一コードだけを引数に取り
--      referrer_user_id だけを返す SECURITY DEFINER 関数経由にする。
--      既存の claim_referral_rewards() / increment_feature_usage() と同じパターン。
--   3. lib/referral.ts 側もこの関数を呼ぶように変更する（同時に配布するコード差分を参照）。

drop policy if exists "referral_codes_select_all" on referral_codes;

create policy "referral_codes_select_own" on referral_codes
  for select using (referrer_user_id = (select id from users where auth_id = auth.uid()));

create or replace function lookup_referral_code(p_code text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select referrer_user_id from referral_codes where code = p_code limit 1
$$;

revoke all on function lookup_referral_code(text) from public;
grant execute on function lookup_referral_code(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認：
--   1. pg_policies で referral_codes に "referral_codes_select_own" だけが
--      残っていること（"referral_codes_select_all" が消えていること）
--   2. アプリの「友達の紹介コードを入力」フローが引き続き動作すること
--      （lib/referral.ts の対応する差分を先に反映してから検証する）
-- ════════════════════════════════════════════════════════════════════
select policyname from pg_policies where tablename = 'referral_codes';

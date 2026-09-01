-- supabase/fix_security_definer_and_direct_write.sql
--
-- 【発覚した2つの問題】
--
-- ① ticket_wallets への直接書き込みが可能だった（最重要）
--   fix_ticket_wallets_rls.sql は「ticket_wallet_grant/grant_once/spend が
--   SECURITY INVOKER のままだと書き込みRLSが無くて黙って0行更新になる」問題を、
--   関数をSECURITY DEFINERにする代わりに「テーブル自体への直接UPDATE権限とFOR ALL
--   ポリシーを開放する」方法で解決していた。
--   これにより、アプリのRPCを一切経由せず、Supabaseクライアントから
--     supabase.from('ticket_wallets').update({tickets: 999999}).eq('user_id', 自分のid)
--   のような直接呼び出しで、誰でも自分のチケット残高を好きな数値に書き換えられる
--   状態になっていた。
--
-- ② claim_referral_rewards()（今回追加）が同じ穴に落ちていた
--   referral_redemptions にはUPDATE用のRLSポリシーが元々無く、関数もSECURITY INVOKERで
--   書いてしまったため、内部の「UPDATE ... SET rewarded = true」が黙って0行更新に終わり、
--   rewardedが永遠にfalseのまま→次回起動のたびに同じ紹介報酬を再付与してしまう
--   （直そうとした不具合をそのまま再現してしまっていた）。
--
-- 【方針】
--   3つのticket_wallet関数とclaim_referral_rewardsを全てSECURITY DEFINERに変更し、
--   テーブルへの直接書き込み権限・広いRLSポリシーは撤回してSELECT/INSERTのみに戻す。
--   関数は全てauth.uid()のみを内部で使い、他人のuser_idを受け取るパラメータを
--   一切持たないため、SECURITY DEFINERにしても「自分の行しか触れない」設計は保たれる。

-- ── ① ticket_wallets: 直接書き込み権限を撤回し、SELECT専用に戻す ──
DROP POLICY IF EXISTS "ticket_wallets_own" ON ticket_wallets;
DROP POLICY IF EXISTS "ticket_wallets_select_own" ON ticket_wallets;
CREATE POLICY "ticket_wallets_select_own" ON ticket_wallets
  FOR SELECT USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON ticket_wallets FROM authenticated;
GRANT SELECT ON ticket_wallets TO authenticated;

CREATE OR REPLACE FUNCTION ticket_wallet_grant(p_amount int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tickets int;
BEGIN
  INSERT INTO ticket_wallets (user_id, tickets)
  VALUES (auth.uid(), GREATEST(p_amount, 0))
  ON CONFLICT (user_id) DO UPDATE
    SET tickets = ticket_wallets.tickets + p_amount,
        updated_at = now()
  RETURNING tickets INTO v_tickets;
  RETURN v_tickets;
END;
$$;

CREATE OR REPLACE FUNCTION ticket_wallet_grant_once(p_amount int, p_marker_name text, p_marker_value text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current text;
BEGIN
  INSERT INTO ticket_wallets (user_id) VALUES (auth.uid())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT dedup_markers ->> p_marker_name INTO v_current
  FROM ticket_wallets
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF v_current IS NOT DISTINCT FROM p_marker_value THEN
    RETURN false;
  END IF;

  UPDATE ticket_wallets
  SET tickets = tickets + p_amount,
      dedup_markers = jsonb_set(dedup_markers, ARRAY[p_marker_name], to_jsonb(p_marker_value)),
      updated_at = now()
  WHERE user_id = auth.uid();

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION ticket_wallet_spend(p_amount int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tickets int;
BEGIN
  INSERT INTO ticket_wallets (user_id) VALUES (auth.uid())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT tickets INTO v_tickets FROM ticket_wallets WHERE user_id = auth.uid() FOR UPDATE;

  IF v_tickets < p_amount THEN
    RETURN false;
  END IF;

  UPDATE ticket_wallets SET tickets = tickets - p_amount, updated_at = now()
  WHERE user_id = auth.uid();

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION ticket_wallet_grant(int) TO authenticated;
GRANT EXECUTE ON FUNCTION ticket_wallet_grant_once(int, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION ticket_wallet_spend(int) TO authenticated;

-- ── ② referral_redemptions: rewardedへの直接書き込みは開放せず、RPCをSECURITY DEFINERに ──
REVOKE UPDATE ON referral_redemptions FROM authenticated;

CREATE OR REPLACE FUNCTION claim_referral_rewards()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_month text;
  v_used_this_month int;
  v_granted_count int := 0;
BEGIN
  FOR r IN
    SELECT id, created_at
    FROM referral_redemptions
    WHERE referrer_user_id = auth.uid() AND rewarded = false
    ORDER BY created_at ASC
    FOR UPDATE
  LOOP
    v_month := to_char(r.created_at, 'YYYY-MM');
    SELECT count(*) INTO v_used_this_month
    FROM referral_redemptions
    WHERE referrer_user_id = auth.uid()
      AND rewarded = true
      AND to_char(created_at, 'YYYY-MM') = v_month;

    IF v_used_this_month < 5 THEN
      UPDATE referral_redemptions SET rewarded = true WHERE id = r.id;
      v_granted_count := v_granted_count + 1;
    END IF;
  END LOOP;

  IF v_granted_count > 0 THEN
    PERFORM ticket_wallet_grant(5 * v_granted_count);
  END IF;

  RETURN v_granted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_referral_rewards() TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認
-- ════════════════════════════════════════════════════════════════════

-- ① ticket_walletsはSELECTポリシーのみになっているはず
select policyname, cmd from pg_policies where tablename = 'ticket_wallets';

-- ② authenticatedロールがticket_wallets/referral_redemptionsに持つ権限を確認
--    （INSERT/UPDATE/DELETEが消えてSELECTだけになっていればOK。referral_redemptionsは
--     INSERT/SELECTは残ってよい＝UPDATEだけ消えていればOK）
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'authenticated'
  and table_name in ('ticket_wallets', 'referral_redemptions')
order by 1, 2;

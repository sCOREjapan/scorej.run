-- supabase/fix_ticket_wallet_rpc_amount_injection.sql
--
-- 【発覚した問題】(2026-09-30 セキュリティ監査で発覚)
-- ticket_wallet_grant / ticket_wallet_grant_once / ticket_wallet_spend は
-- auth.uid()の行しか触れない設計だが、金額(p_amount)をクライアントの言い値の
-- ままDBに反映していたため、以下がSupabaseの匿名キー+自分のJWTだけで可能だった:
--   - ticket_wallet_grant({p_amount: 999999})  → 残高が99万枚に
--   - ticket_wallet_spend({p_amount: -999999}) → 「消費」のはずが残高が増える
--     (v_tickets < p_amount のチェックが負数には効かないため)
--   - ticket_wallet_grant_once({p_amount: 50000, p_marker_name: <毎回ランダム>, ...})
--     → マーカー名を使い捨てにすれば「1回だけ」制限を無限に回避できる
--
-- 【方針】
--   金額はサーバー側で決め打ちにし、クライアントのp_amountは信用しない
--   (シグネチャ互換のため引数自体は残すが、値は無視 or 上限でクランプする)。
--   ・grant_once: p_marker_nameを既知の一覧に限定し、金額はマーカーごとに
--     サーバー側で固定する(lib/ticketWallet.tsの定数と対応させる)。
--   ・grant: 通常の少額付与(広告視聴1枚・ストリーク1/2/5枚)は上限10枚に
--     クランプ。ただし「ローカル→サーバー移行」(getWalletSnapshot)は
--     ウォレット行がまだ存在しない最初の1回に限り、上限1000枚まで許容する
--     (以前の端末ローカル運用で貯めていた分の一度きりの引き継ぎのため)。
--     2回目以降は行が存在するので自動的に上限10枚に戻る。
--   ・spend: p_amountが0以下なら即falseにする(負数で残高が増える不具合を修正)。

CREATE OR REPLACE FUNCTION ticket_wallet_grant(p_amount int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tickets int;
  v_exists  boolean;
  v_amount  int;
BEGIN
  SELECT EXISTS(SELECT 1 FROM ticket_wallets WHERE user_id = auth.uid()) INTO v_exists;

  v_amount := GREATEST(p_amount, 0);
  IF v_exists THEN
    v_amount := LEAST(v_amount, 10);    -- 通常付与(広告1枚・ストリーク最大5枚)の上限
  ELSE
    v_amount := LEAST(v_amount, 1000);  -- 初回のみ：旧ローカル残高の一度きりの移行上限
  END IF;

  INSERT INTO ticket_wallets (user_id, tickets)
  VALUES (auth.uid(), v_amount)
  ON CONFLICT (user_id) DO UPDATE
    SET tickets = ticket_wallets.tickets + v_amount,
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
  v_amount  int;
BEGIN
  -- p_amountは信用せず、マーカー名ごとにサーバー側で決め打ちの枚数を割り当てる
  -- (lib/ticketWallet.tsの各grant*関数が渡す定数と対応)。未知のマーカー名は拒否する
  -- ことで、任意のマーカー名を使い捨てて「1回だけ」制限を回避する手口を防ぐ。
  v_amount := CASE p_marker_name
    WHEN 'starter'                  THEN 5    -- STARTER_TICKETS
    WHEN 'share_bonus'               THEN 1
    WHEN 'mission_profile'           THEN 3   -- MISSION_BONUS
    WHEN 'mission_line'              THEN 3
    WHEN 'mission_goal'              THEN 3
    WHEN 'mission_day1'              THEN 5
    WHEN 'mission_day2'              THEN 2
    WHEN 'monthly_grant'             THEN 100 -- TICKET_MONTHLY_GRANT
    WHEN 'monthly_grant_trial_daily' THEN 5   -- TICKET_MONTHLY_TRIAL_DAILY_GRANT
    ELSE NULL
  END;
  IF v_amount IS NULL THEN
    RETURN false;
  END IF;

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
  SET tickets = tickets + v_amount,
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
  IF p_amount <= 0 THEN
    RETURN false;
  END IF;

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

-- 関数のシグネチャは変わっていないのでGRANTは既存のまま有効。念のため再実行しておく。
GRANT EXECUTE ON FUNCTION ticket_wallet_grant(int) TO authenticated;
GRANT EXECUTE ON FUNCTION ticket_wallet_grant_once(int, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION ticket_wallet_spend(int) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認（Supabase SQL Editorで手動確認する場合）
-- ════════════════════════════════════════════════════════════════════
-- 以下はいずれもfalse/元の残高のままになるはず:
--   select ticket_wallet_grant(999999);                            -- 上限10枚(既存行あり)にクランプされる
--   select ticket_wallet_spend(-999999);                           -- false（残高は変わらない）
--   select ticket_wallet_grant_once(50000, 'not_a_real_marker', gen_random_uuid()::text); -- false

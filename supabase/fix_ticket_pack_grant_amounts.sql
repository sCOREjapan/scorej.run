-- supabase/fix_ticket_pack_grant_amounts.sql
--
-- 【発覚した問題】(2026-10-05 バグ巡りで発覚)
-- fix_ticket_wallet_rpc_amount_injection.sql で ticket_wallet_grant の1回あたり付与量を
-- 「既存ウォレットは最大10枚にクランプ」としたが、チケットパックの購入
-- (app/tickets.tsx の handlePurchase → grantTickets(15 or 50)) もこの関数を通るため、
-- 購入者は 15枚パック→10枚、50枚パック→10枚 しか受け取れなくなっていた
-- （課金は成功しているのにトースト上は「+15」「+50」と表示されるが、実残高は+10）。
--
-- 【この修正】
-- 通常付与(広告1枚・ストリーク1/2/5枚・払い戻し2〜3枚・紹介5枚)は従来通り上限10枚。
-- ただし TICKET_PACK_COUNTS(lib/purchaseService.native.ts)と同じパック枚数
-- 15 / 50 だけは、そのままの値で通す。
--
-- 【既知の限界・要フォローアップ】
-- ticket_wallet_grant は「クライアントが自己申告した枚数」を信じる設計のままなので、
-- 有効なJWTを持つ技術者が繰り返し呼べばチケットを増やせる状態は変わらない
-- （従来も10枚×回数で同じことが可能だった。今回の変更で増える攻撃能力は無い）。
-- 根本対策は、購入分の付与を RevenueCat Webhook(api/revenuecat-webhook.ts)で
-- サーバー側確定(transaction_id で冪等化)し、クライアントからは grant を呼ばない形に
-- 移すこと（次のビルドと同時に行う）。
--
-- 実行方法: Supabase SQL Editor に貼り付けて Run（手動。冪等なので何度実行しても可）

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
  -- 同一ユーザーからの同時呼び出しを直列化（初回1000枚上限の競合防止。元の定義と同じ）
  PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text));

  SELECT EXISTS(SELECT 1 FROM ticket_wallets WHERE user_id = auth.uid()) INTO v_exists;

  v_amount := GREATEST(p_amount, 0);
  IF v_exists THEN
    IF v_amount IN (15, 50) THEN
      NULL;                               -- チケットパック購入の枚数(TICKET_PACK_COUNTS)はそのまま
    ELSE
      v_amount := LEAST(v_amount, 10);    -- 通常付与(広告1枚・ストリーク最大5枚等)の上限
    END IF;
  ELSE
    v_amount := LEAST(v_amount, 1000);    -- 初回のみ：旧ローカル残高の一度きりの移行上限
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

GRANT EXECUTE ON FUNCTION ticket_wallet_grant(int) TO authenticated;

-- 実行後の確認（ログイン済みユーザーのJWTで）:
--   select ticket_wallet_grant(15);   -- 残高が+15になる
--   select ticket_wallet_grant(16);   -- +10にクランプされる

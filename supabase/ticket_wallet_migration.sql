-- supabase/ticket_wallet_migration.sql
-- チケット残高をサーバー側(Supabase)で一元管理するための移行。
--
-- 【背景】
--   これまでチケット残高・各種ボーナスの「付与済みフラグ」は端末のAsyncStorageにのみ
--   保存されていた。このため、同じアカウントで別端末を使う・アプリを再インストールする
--   だけで「まだ付与していない」と誤判定され、月額プランの100枚付与や各種ワンタイム
--   ボーナスが何度でも再付与できてしまう不具合があった(2026-08-26に実際に発生・報告)。
--
-- 【方針】
--   ログイン済みユーザーはこのテーブルを唯一の真実(source of truth)とする。
--   ゲスト(未ログイン)はサーバー側の本人確認手段が無いため、従来通り端末ローカルのみで
--   動作させる(lib/ticketWallet.ts 側でログイン有無により分岐する)。
--   read-modify-write の競合を避けるため、増減は全てSQL関数内でロックして行う
--   (クライアント側で読んで足して書き戻す方式は取らない)。

CREATE TABLE IF NOT EXISTS ticket_wallets (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tickets       integer NOT NULL DEFAULT 0,
  dedup_markers jsonb   NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ticket_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ticket_wallets_select_own" ON ticket_wallets;
CREATE POLICY "ticket_wallets_select_own" ON ticket_wallets
  FOR SELECT USING (auth.uid() = user_id);

-- INSERT/UPDATEはクライアントから直接行わせず、必ず下記のSECURITY INVOKER関数経由にする
-- (残高の増減はロック付きのSQL関数内でしか許可しない。直接UPDATEされると二重付与と
--  同じ「read-modify-write競合」がクライアント側で再発するため)

-- ── 単純加算（広告視聴・ストリークボーナスなど、都度加算でよいもの） ──
CREATE OR REPLACE FUNCTION ticket_wallet_grant(p_amount int)
RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
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

-- ── 重複防止付き加算（初回ボーナス・月額付与など「同じキーでは1回だけ」のもの） ──
-- p_marker_value が前回保存値と同じなら何もせず false を返す（二重付与の防止）。
-- 値が変われば（例: 月額プランの更新期日が進む）再度付与できる。
CREATE OR REPLACE FUNCTION ticket_wallet_grant_once(p_amount int, p_marker_name text, p_marker_value text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
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

-- ── 消費（残高不足なら何もせず false） ──
CREATE OR REPLACE FUNCTION ticket_wallet_spend(p_amount int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
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
GRANT SELECT ON ticket_wallets TO authenticated;

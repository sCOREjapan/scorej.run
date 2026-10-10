-- supabase/fix_ticket_regular_grant_cap.sql
--
-- 【発覚した問題】(2026-10-10 セキュリティチェック)
--   広告視聴のチケット(1枚)・連続起動ボーナス・払い戻しなどの「通常付与」は、端末が「付与して」と申告するだけで、
--   サーバーは広告を本当に見たかを確認できない(AdMob のサーバー側検証=SSV は未実装)。
--   fix_ticket_grant_hardening.sql で「1回10枚・1日合計300枚」の上限を付けたが、300枚/日は、改造したアプリで
--   毎日タダで AI を使い続けるには十分に大きい(動画分析なら1日150回分)。
--
-- 【方針】
--   「通常付与」だけに、別の1日上限(60枚/日)を掛ける。正規の利用での最大は、概ね次のとおり:
--     広告 10枚(アプリ側の上限) + 連続起動ボーナス 最大5枚 + 紹介 5枚×数件 + 動画の払い戻し 2枚×数回  →  60枚あれば足りる。
--   ・300枚/日の合計上限は、そのまま残す(月額プランの100枚・ミッション報酬などの ticket_wallet_grant_once と
--     同じカウンター mint_today を共有)。通常付与の専用カウンターは、新しい列 regular_today に持つ。
--   ・grant_once(月額100枚・ミッション・シェア)と、パック枚数(15/50)の付与、初回の移行(最大1000枚)は変えない。
--   ・上限を変えたい時は、下の v_regular_cap の数字だけを変えて、このファイルをもう一度実行する。
--
-- 【実行方法】Supabase SQL エディタに貼って Run(冪等。何度実行してもよい)。アプリ/APIの旧版でも壊れない。
--   ※ 以前の ticket_wallet_grant を作るファイル(fix_ticket_wallet_rpc_amount_injection.sql /
--      fix_ticket_grant_hardening.sql)は、これより後に再実行しないこと(関数が古い版に戻る)。
--
-- 【元に戻す方法】fix_ticket_grant_hardening.sql の ticket_wallet_grant の定義だけを貼り直す。

alter table ticket_wallets add column if not exists regular_day   date;
alter table ticket_wallets add column if not exists regular_today int not null default 0;

create or replace function ticket_wallet_grant(p_amount int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_regular_cap constant int := 60;      -- 通常付与(広告・ストリーク・払い戻し等)の1日上限
  v_uid         uuid := auth.uid();
  v_today       date := (now() at time zone 'Asia/Tokyo')::date;
  v_exists      boolean := false;
  v_day         date;
  v_mint        int := 0;
  v_pack        int := 0;
  v_reg_day     date;
  v_regular     int := 0;
  v_amount      int;
  v_tickets     int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- 同一ユーザーからの同時呼び出しを直列化
  perform pg_advisory_xact_lock(hashtextextended('tw:' || v_uid::text, 0));

  select true, mint_day, mint_today, pack_today, regular_day, regular_today
    into v_exists, v_day, v_mint, v_pack, v_reg_day, v_regular
    from ticket_wallets where user_id = v_uid;
  v_exists  := coalesce(v_exists, false);
  v_mint    := coalesce(v_mint, 0);
  v_pack    := coalesce(v_pack, 0);
  v_regular := coalesce(v_regular, 0);
  if v_day is distinct from v_today then v_mint := 0; v_pack := 0; end if;
  if v_reg_day is distinct from v_today then v_regular := 0; end if;

  v_amount := greatest(coalesce(p_amount, 0), 0);

  if not v_exists then
    v_amount := least(v_amount, 1000);          -- 初回のみ: 旧ローカル残高の一度きりの移行上限
  elsif v_amount in (15, 50) then
    -- チケットパックの枚数。スイッチが 'on' の間だけクライアントの申告で付与し(1日6回まで)、
    -- 'off' になったら付与しない(Webhookが取引IDで付与する)。
    if private.flag('ticket_pack_client_grant') = 'on' and v_pack < 6 then
      v_pack := v_pack + 1;
    else
      v_amount := 0;
    end if;
  else
    v_amount := least(v_amount, 10);                          -- 通常付与(広告1枚・ストリーク最大5枚・払い戻し等)
    v_amount := least(v_amount, greatest(300 - v_mint, 0));   -- 1日の合計上限(grant_once と共有)
    v_amount := least(v_amount, greatest(v_regular_cap - v_regular, 0));   -- 通常付与だけの1日上限
    v_mint    := v_mint + v_amount;
    v_regular := v_regular + v_amount;
  end if;

  insert into ticket_wallets (user_id, tickets, mint_day, mint_today, pack_today, regular_day, regular_today)
  values (v_uid, v_amount, v_today, v_mint, v_pack, v_today, v_regular)
  on conflict (user_id) do update
    set tickets       = ticket_wallets.tickets + v_amount,
        mint_day      = v_today,
        mint_today    = v_mint,
        pack_today    = v_pack,
        regular_day   = v_today,
        regular_today = v_regular,
        updated_at    = now()
  returning tickets into v_tickets;
  return v_tickets;
end;
$$;

revoke execute on function ticket_wallet_grant(int) from public, anon;
grant  execute on function ticket_wallet_grant(int) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認
-- ════════════════════════════════════════════════════════════════════
-- 1) 関数が新しい版になっていること(60 が見える)
--    select position('v_regular_cap constant int := 60' in prosrc) > 0 as is_new
--      from pg_proc where proname = 'ticket_wallet_grant';
-- 2) 列が追加されていること
--    select column_name from information_schema.columns
--     where table_name = 'ticket_wallets' and column_name in ('regular_day', 'regular_today');

-- supabase/fix_ticket_grant_hardening.sql
--
-- 【発覚した問題】(2026-10-07 セキュリティ監査 + データベースレビュー)
--   1) ticket_wallet_grant_once の「1回だけ」判定は、クライアントが送る p_marker_value を信用していた。
--      'monthly_grant' に毎回違う値を渡せば、サブスク無しでも +100枚 を何度でも受け取れた
--      ('share_bonus' も任意の日付文字列で、日次制限を回避できた)。
--   2) ticket_wallet_grant は、パック購入量(15/50)を「クライアントの申告どおり」付与していた。
--      有効なJWTがあれば何度でも +50枚 を呼べた(購入していなくても)。
--   3) claim_referral_rewards() は referrer_user_id(=users.id。認証IDとは別のランダムID)を
--      auth.uid() と比較していたため、誰にも一致せず、紹介した側に報酬が一度も付与されていなかった。
--
-- 【方針(各ステップは、アプリ/APIの旧版でも動くようにしてある)】
--   ・server_flags テーブルのスイッチで、挙動を段階的に切り替える。初期値は「今と同じ」。
--       ticket_pack_client_grant = 'on'  → パックの付与は従来どおりクライアントの grant(15/50) が行う
--                                  'off' → grant(15/50) は付与せず、RevenueCat Webhook(api/revenuecat-webhook.ts)
--                                          がサーバー側で付与する(ストアの取引IDで二重付与なし)
--       grant_once_strict        = 'off' → 従来の判定(クライアントの値)。ただし1日の付与上限は新たに掛かる
--                                  'on'  → 月額チケットはサーバー(subscription_status)の期日で判定する
--   ・どちらの「on/off」も、下の「切り替え手順」を満たしてから変える。
--   ・全ての付与に「1日あたりの上限」を追加(小口の付与は合計300枚/日、パック枚数の付与は6回/日)。
--     正規の利用では届かない値なので、通常の利用者への影響は無い。
--   ・紹介報酬は、users.id に正しく変換して照合し、残高へ直接加算する(grant の上限を通さない)。
--     ※ 2026-09-01 以降に成立していた未付与の紹介は、この修正の後の最初のログインで、
--        月ごとの上限(5件)の範囲内で一度に付与される(本来受け取れていたはずの分)。
--
-- 【実行手順】
--   ① このファイルを SQL エディタに貼って Run(冪等。何度実行してもよい)。
--   ② api/revenuecat-webhook.ts の新版をデプロイする(①の前でも後でも壊れない作りにしてある)。
--   ③ 【パック購入をサーバー付与に切り替える】
--        a. RevenueCat の Webhook が「消耗型(NON_RENEWING_PURCHASE)」を送っていることを確認する
--        b. 実際にチケットパックを1回購入して、下の確認クエリ(ticket_credits)に行が入ることを確認する
--           (この間は 'on' のままなので、二重付与を避けるため行は「記録のみ(credited=false)」になる)
--        c. 問題なければ:  update server_flags set value = 'off' where key = 'ticket_pack_client_grant';
--   ④ 【月額チケットの判定をサーバー基準に切り替える】
--        a. 確認クエリ(subscription_status)で、ticket_monthly の加入者に行があり、
--           has_ticket_monthly=true と期日が入っていることを確認する
--        b. 問題なければ:  update server_flags set value = 'on' where key = 'grant_once_strict';
--
-- 【確認クエリ】
--   select * from server_flags;
--   select user_id, amount, ref, credited, created_at from ticket_credits order by created_at desc limit 20;
--   select user_id, has_ticket_monthly, ticket_monthly_expires_at, ticket_monthly_is_trial
--     from subscription_status where has_ticket_monthly;

create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

-- ── スイッチ ───────────────────────────────────────────────
create table if not exists server_flags (
  key   text primary key,
  value text not null
);
alter table server_flags enable row level security;
revoke all on server_flags from anon, authenticated;
insert into server_flags (key, value) values
  ('ticket_pack_client_grant', 'on'),
  ('grant_once_strict',        'off')
on conflict (key) do nothing;

create or replace function private.flag(p_key text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$ select value from public.server_flags where key = p_key $$;

-- ── 追加の列 ───────────────────────────────────────────────
alter table ticket_wallets add column if not exists mint_day   date;
alter table ticket_wallets add column if not exists mint_today int not null default 0;
alter table ticket_wallets add column if not exists pack_today int not null default 0;
alter table subscription_status add column if not exists ticket_monthly_is_trial boolean not null default false;

-- ── サーバー側付与の記録(RevenueCat の取引IDで冪等) ──────────────
create table if not exists ticket_credits (
  ref        text primary key,                                   -- ストアの取引ID(RevenueCat の transaction_id)
  user_id    uuid not null references auth.users(id) on delete cascade,
  amount     int  not null check (amount > 0),
  credited   boolean not null default true,                       -- false = 記録のみ(クライアント付与中のため加算していない)
  created_at timestamptz not null default now()
);
alter table ticket_credits enable row level security;
revoke all on ticket_credits from anon, authenticated;

-- Webhook(service_role)専用。同じ ref は二度と加算しない。
create or replace function ticket_wallet_credit(p_user uuid, p_amount int, p_ref text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user is null or p_amount is null or p_amount <= 0 or p_ref is null or p_ref = '' then
    return false;
  end if;
  insert into ticket_credits (ref, user_id, amount) values (p_ref, p_user, p_amount)
    on conflict (ref) do nothing;
  if not found then
    return false;                                                  -- 付与済み(Webhookの再送など)
  end if;
  insert into ticket_wallets (user_id, tickets) values (p_user, p_amount)
    on conflict (user_id) do update
      set tickets = ticket_wallets.tickets + p_amount, updated_at = now();
  return true;
end;
$$;
revoke execute on function ticket_wallet_credit(uuid, int, text) from public, anon, authenticated;
grant  execute on function ticket_wallet_credit(uuid, int, text) to service_role;

-- 取引の「記録のみ」(スイッチが 'on' の間。後で突き合わせられるように残す)
create or replace function ticket_wallet_note_purchase(p_user uuid, p_amount int, p_ref text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into ticket_credits (ref, user_id, amount, credited) values (p_ref, p_user, p_amount, false)
  on conflict (ref) do nothing
$$;
revoke execute on function ticket_wallet_note_purchase(uuid, int, text) from public, anon, authenticated;
grant  execute on function ticket_wallet_note_purchase(uuid, int, text) to service_role;

-- ── ticket_wallet_grant ───────────────────────────────────────
create or replace function ticket_wallet_grant(p_amount int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_today   date := (now() at time zone 'Asia/Tokyo')::date;
  v_exists  boolean := false;
  v_day     date;
  v_mint    int := 0;
  v_pack    int := 0;
  v_amount  int;
  v_tickets int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- 同一ユーザーからの同時呼び出しを直列化
  perform pg_advisory_xact_lock(hashtextextended('tw:' || v_uid::text, 0));

  select true, mint_day, mint_today, pack_today
    into v_exists, v_day, v_mint, v_pack
    from ticket_wallets where user_id = v_uid;
  v_exists := coalesce(v_exists, false);
  if v_day is distinct from v_today then v_mint := 0; v_pack := 0; end if;

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
    v_amount := least(v_amount, greatest(300 - v_mint, 0));   -- 1日の合計上限
    v_mint := v_mint + v_amount;
  end if;

  insert into ticket_wallets (user_id, tickets, mint_day, mint_today, pack_today)
  values (v_uid, v_amount, v_today, v_mint, v_pack)
  on conflict (user_id) do update
    set tickets    = ticket_wallets.tickets + v_amount,
        mint_day   = v_today,
        mint_today = v_mint,
        pack_today = v_pack,
        updated_at = now()
  returning tickets into v_tickets;
  return v_tickets;
end;
$$;

-- ── ticket_wallet_grant_once ──────────────────────────────────
create or replace function ticket_wallet_grant_once(p_amount int, p_marker_name text, p_marker_value text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_today   date := (now() at time zone 'Asia/Tokyo')::date;
  v_jst     text := to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM-DD');
  v_strict  boolean := coalesce(private.flag('grant_once_strict'), 'off') = 'on';
  v_amount  int;
  v_value   text := p_marker_value;
  v_current text;
  v_day     date;
  v_mint    int := 0;
  v_pack    int := 0;
  v_has     boolean;
  v_expires timestamptz;
  v_trial   boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- p_amount は信用せず、マーカー名ごとにサーバー側で決め打ちの枚数を割り当てる(lib/ticketWallet.ts と対応)
  v_amount := case p_marker_name
    when 'starter'                   then 5
    when 'share_bonus'               then 1
    when 'mission_profile'           then 3
    when 'mission_line'              then 3
    when 'mission_goal'              then 3
    when 'mission_day1'              then 5
    when 'mission_day2'              then 2
    when 'monthly_grant'             then 100
    when 'monthly_grant_trial_daily' then 5
    else null
  end;
  if v_amount is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tw:' || v_uid::text, 0));

  insert into ticket_wallets (user_id) values (v_uid) on conflict (user_id) do nothing;
  select dedup_markers ->> p_marker_name, mint_day, mint_today, pack_today
    into v_current, v_day, v_mint, v_pack
    from ticket_wallets where user_id = v_uid for update;
  if v_day is distinct from v_today then v_mint := 0; v_pack := 0; end if;

  if p_marker_name in ('starter', 'mission_profile', 'mission_line', 'mission_goal', 'mission_day1', 'mission_day2') then
    -- アカウントにつき一度きり。クライアントの値(開始日など)は見ず、保存済みの値があれば付与済みとみなす。
    if v_current is not null then return false; end if;
    v_value := '1';
  elsif p_marker_name = 'share_bonus' then
    v_value := v_jst;                                           -- 日本時間の日付で1日1回
  else
    -- monthly_grant / monthly_grant_trial_daily
    if v_strict then
      select has_ticket_monthly, ticket_monthly_expires_at, coalesce(ticket_monthly_is_trial, false)
        into v_has, v_expires, v_trial
        from subscription_status where user_id = v_uid;
      if not found or not coalesce(v_has, false) or v_expires is null or v_expires <= now() then
        return false;                                           -- サーバーが「加入中」と確認できない
      end if;
      if p_marker_name = 'monthly_grant' then
        if v_trial then return false; end if;                   -- 無料トライアル中は本付与しない
        -- 旧方式で保存済みの期日(クライアント由来)と同じ期日なら付与済み
        if v_current is not null then
          begin
            if v_current::timestamptz = v_expires then return false; end if;
          exception when others then null;
          end;
        end if;
        v_value := v_expires::text;
      else
        if not v_trial then return false; end if;               -- トライアル中だけ1日5枚
        v_value := v_expires::text || ':' || v_jst;
      end if;
    end if;
  end if;

  if v_current is not distinct from v_value then
    return false;
  end if;

  -- 1日の合計上限(正規の利用では届かない値)
  if v_mint + v_amount > 300 then
    return false;
  end if;

  update ticket_wallets
     set tickets       = tickets + v_amount,
         dedup_markers = jsonb_set(dedup_markers, array[p_marker_name], to_jsonb(v_value)),
         mint_day      = v_today,
         mint_today    = v_mint + v_amount,
         pack_today    = v_pack,
         updated_at    = now()
   where user_id = v_uid;
  return true;
end;
$$;

-- ── ticket_wallet_spend(NULL/未ログインを明示的に拒否) ─────────────
create or replace function ticket_wallet_spend(p_amount int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_tickets int;
begin
  if v_uid is null or p_amount is null or p_amount <= 0 then
    return false;
  end if;

  insert into ticket_wallets (user_id) values (v_uid) on conflict (user_id) do nothing;
  select tickets into v_tickets from ticket_wallets where user_id = v_uid for update;
  if v_tickets < p_amount then
    return false;
  end if;
  update ticket_wallets set tickets = tickets - p_amount, updated_at = now() where user_id = v_uid;
  return true;
end;
$$;

-- ── 紹介報酬(users.id への変換 + 残高へ直接加算) ──────────────────
create or replace function claim_referral_rewards()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r         record;
  v_uid     uuid := auth.uid();
  v_app     uuid;
  v_month   text;
  v_used    int;
  v_granted int := 0;
begin
  if v_uid is null then return 0; end if;
  select id into v_app from users where auth_id = v_uid;
  if v_app is null then return 0; end if;

  for r in
    select id, created_at
      from referral_redemptions
     where referrer_user_id = v_app and rewarded = false
     order by created_at asc
       for update
  loop
    v_month := to_char(r.created_at, 'YYYY-MM');
    select count(*) into v_used
      from referral_redemptions
     where referrer_user_id = v_app
       and rewarded = true
       and to_char(created_at, 'YYYY-MM') = v_month;

    if v_used < 5 then
      update referral_redemptions set rewarded = true where id = r.id;
      v_granted := v_granted + 1;
    end if;
    -- 月次上限を超えた分は rewarded=false のまま(付与しない)
  end loop;

  if v_granted > 0 then
    insert into ticket_wallets (user_id, tickets) values (v_uid, 5 * v_granted)
      on conflict (user_id) do update
        set tickets = ticket_wallets.tickets + 5 * v_granted, updated_at = now();
  end if;
  return v_granted;
end;
$$;

-- 実行権限: ログイン済みユーザーのみ(匿名・PUBLICからは外す)
revoke execute on function ticket_wallet_grant(int)                  from public, anon;
revoke execute on function ticket_wallet_grant_once(int, text, text) from public, anon;
revoke execute on function ticket_wallet_spend(int)                  from public, anon;
revoke execute on function claim_referral_rewards()                  from public, anon;
grant  execute on function ticket_wallet_grant(int)                  to authenticated;
grant  execute on function ticket_wallet_grant_once(int, text, text) to authenticated;
grant  execute on function ticket_wallet_spend(int)                  to authenticated;
grant  execute on function claim_referral_rewards()                  to authenticated;

notify pgrst, 'reload schema';

-- ⚠ このファイルの適用後は、fix_ticket_pack_grant_amounts.sql / fix_ticket_wallet_rpc_amount_injection.sql /
--   fix_referral_reward_tracking.sql を再実行しないこと(上の関数が古い版に戻る)。

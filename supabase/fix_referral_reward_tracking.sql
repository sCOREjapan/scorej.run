-- supabase/fix_referral_reward_tracking.sql
--
-- 【背景】
--   友達紹介報酬の「受け取り済みフラグ」がlib/referral.ts側のAsyncStorage(端末ローカル)
--   にしか記録されていなかった。claimReferralRewards()はログインのたびに自動実行され、
--   未受け取り分(ローカルのclaimedリストに無いもの)を見つけて都度チケットを付与する設計。
--
--   このため、紹介実績のあるアカウントが再インストール・別端末ログイン・アプリデータ削除を
--   行うと、ローカルの受け取り済み記録が消え、referral_redemptionsテーブル自体はサーバーに
--   残ったままなので、同じ紹介報酬を何度でも再受け取りできてしまう不具合があった
--   (2026-08-26/27に発生したチケット二重付与と同じ原因パターン)。
--
-- 【方針】
--   受け取り済みかどうかをreferral_redemptionsテーブル自体にサーバー側で記録し、
--   RPC関数claim_referral_rewards()で一元的に判定・付与する。
--   月次上限(REFERRAL_MONTHLY_CAP=5)のチェックもサーバー側で行う。
--
-- 【注意】このSQLは既存の正当な受け取り実績を「既に受け取り済み」として保護してから
--   新方式に切り替える。実行順序を変えないこと（先にrewarded=falseで列を作り、
--   既存行だけ一括でtrueにする。この順序を守らないと、今まで正しく受け取っていた
--   紹介報酬が全ユーザー分、次回ログイン時に丸ごと再付与されてしまう）。

-- ① 受け取り済みフラグの列を追加（新規行はデフォルトfalse＝未受け取り）
alter table referral_redemptions
  add column if not exists rewarded boolean not null default false;

-- ② 実行時点で既に存在する行は、旧方式（端末ローカル）で既に正しく受け取り済みのはずなので
--    「受け取り済み」として保護する（これをやらないと全既存ユーザーに再付与されてしまう）
update referral_redemptions set rewarded = true where rewarded = false;

-- ③ サーバー側で受け取り判定・チケット付与を一元化するRPC
create or replace function claim_referral_rewards()
returns int
language plpgsql
security invoker
as $$
declare
  r record;
  v_month text;
  v_used_this_month int;
  v_granted_count int := 0;
begin
  for r in
    select id, created_at
    from referral_redemptions
    where referrer_user_id = auth.uid() and rewarded = false
    order by created_at asc
    for update
  loop
    v_month := to_char(r.created_at, 'YYYY-MM');
    select count(*) into v_used_this_month
    from referral_redemptions
    where referrer_user_id = auth.uid()
      and rewarded = true
      and to_char(created_at, 'YYYY-MM') = v_month;

    if v_used_this_month < 5 then
      update referral_redemptions set rewarded = true where id = r.id;
      v_granted_count := v_granted_count + 1;
    end if;
    -- 月次上限を超えた分はrewarded=falseのまま残す（rewarded=trueにしないので
    -- チケットは付与しない。次回呼び出し時も同じ月内なら再度上限判定される
    -- だけで、誤って付与されることはない）
  end loop;

  if v_granted_count > 0 then
    perform ticket_wallet_grant(5 * v_granted_count);
  end if;

  return v_granted_count;
end;
$$;

grant execute on function claim_referral_rewards() to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認（既存の紹介報酬件数と一致していればOK。急に増えていないか確認）
-- ════════════════════════════════════════════════════════════════════
select count(*) as total_redemptions, count(*) filter (where rewarded) as rewarded_count
from referral_redemptions;

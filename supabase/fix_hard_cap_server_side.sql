-- supabase/fix_hard_cap_server_side.sql
--
-- 【背景】
--   lib/adGate.ts の HARD_DAILY_CAP / HARD_MONTHLY_CAP（tier・チケット残高に関係なく
--   適用される「悪用/暴走防止のためのAI APIコスト絶対上限」。例: 動画分析1日8回・月40回）が、
--   端末ローカル(AsyncStorage)にしかカウントされていなかった。
--   ログイン中のアカウントであっても、アプリの再インストール・別端末ログインで
--   このカウントがリセットされてしまい、絶対上限のはずが際限なく回避できてしまう
--   不具合があった（referral_redemptionsの受け取り済みフラグと同じ原因パターン）。
--
-- 【方針】
--   ログイン中のユーザーについては、利用回数をこのテーブルでサーバー側に記録する。
--   ゲスト(未ログイン)はサーバー側の本人確認手段が無いため、従来通り端末ローカルのみで
--   動作させる（lib/ticketWallet.ts と同じ方針）。

create table if not exists feature_usage_counts (
  user_id     uuid not null references auth.users(id) on delete cascade,
  feature     text not null,
  period_key  text not null,  -- 日次なら 'YYYY-MM-DD'、月次なら 'YYYY-MM'
  count       integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, feature, period_key)
);

alter table feature_usage_counts enable row level security;

drop policy if exists "feature_usage_counts_select_own" on feature_usage_counts;
create policy "feature_usage_counts_select_own" on feature_usage_counts
  for select using (auth.uid() = user_id);

-- INSERT/UPDATEはクライアントから直接行わせず、必ず下記の関数経由にする
-- （read-modify-write競合を避けるため。ticket_wallet_grantと同じ作法）
create or replace function increment_feature_usage(p_feature text, p_period_key text)
returns int
language plpgsql
security invoker
as $$
declare
  v_count int;
begin
  insert into feature_usage_counts (user_id, feature, period_key, count)
  values (auth.uid(), p_feature, p_period_key, 1)
  on conflict (user_id, feature, period_key) do update
    set count = feature_usage_counts.count + 1,
        updated_at = now()
  returning count into v_count;
  return v_count;
end;
$$;

grant execute on function increment_feature_usage(text, text) to authenticated;
grant select on feature_usage_counts to authenticated;

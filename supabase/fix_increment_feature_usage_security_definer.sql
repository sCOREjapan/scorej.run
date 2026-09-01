-- supabase/fix_increment_feature_usage_security_definer.sql
--
-- 【発覚】fix_hard_cap_server_side.sql で追加した increment_feature_usage() が
--   SECURITY INVOKER のまま書かれていた（ticket_wallets/claim_referral_rewards と
--   全く同じミスの再発）。feature_usage_counts にはSELECTポリシーしか無いため、
--   関数内部の INSERT ... ON CONFLICT DO UPDATE が黙って失敗し、
--   絶対上限(HARD_DAILY_CAP/HARD_MONTHLY_CAP)のカウント自体が一切増えず、
--   上限チェックが事実上無効化された状態になっていた。
--
-- 【方針】SECURITY DEFINERに変更。テーブル自体への書き込み権限は開放しない
--   （SELECTのみのまま。ticket_wallets/referral_redemptionsと同じ形に揃える）。

create or replace function increment_feature_usage(p_feature text, p_period_key text)
returns int
language plpgsql
security definer
set search_path = public
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

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認（authenticatedにINSERT/UPDATEの直接権限が付いていないことを確認）
-- ════════════════════════════════════════════════════════════════════
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'authenticated'
  and table_name = 'feature_usage_counts'
order by 1, 2;

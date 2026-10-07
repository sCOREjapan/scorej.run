-- supabase/fix_coach_secret_immutable.sql
-- ⚠ 2026-10-07: fix_coach_secret_hash.sql を適用した後は、このファイルを再実行しないこと。
--   (古い削除ポリシー/トリガーに戻り、coach_secret の平文が再び保存・露出してしまう)
--
-- 【発覚した問題】(2026-09-30 追加監査で発覚。fix_team_delete_requires_coach_secret.sqlの
-- 直後に見つかった、その修正自体の欠陥)
--   teams_update_by_code ポリシーは code の一致だけを要求し、どの列を変更してよいかを
--   一切制限していなかった。そのため、参加コードさえ知っていれば誰でも
--     supabase.from('teams').update({ coach_secret: null }).eq('code', code)
--   を直接叩いてcoach_secretをNULLに戻せてしまい、その後
--     supabase.from('teams').delete().eq('code', code)
--   が「coach_secretがNULL(=レガシーチーム)」扱いで通ってしまう。
--   つまり fix_team_delete_requires_coach_secret.sql が閉じたはずの「参加コードだけで
--   チーム削除」の穴が、そのまま再現できてしまっていた（api/notify.tsの
--   コーチ→選手一斉配信ガードも同様に無効化される）。
--
-- 【方針】
--   coach_secretは「NULLから一度だけ値を設定でき、その後は同じ値でのUPDATEしか
--   通らない」よう、BEFORE UPDATEトリガーで強制する。RLSポリシーは列単位の制御が
--   できないため、トリガーで担保する。
--   ・旧値がNULL → 新しい値を許可（コーチ端末の初回自己修復upsertが成功する）
--   ・旧値が非NULL かつ 新しい値が旧値と同じ → 許可（同じコーチが再度upsertしても問題ない）
--   ・旧値が非NULL かつ 新しい値が異なる（NULLに戻す場合も含む） → 拒否せず、
--     単に新しい値を旧値のまま据え置く（サイレントに無視。エラーにすると
--     setCoachAvatar等、coach_secretに触れない他列だけの更新まで失敗させてしまうため）

create or replace function _protect_coach_secret() returns trigger
language plpgsql
as $$
begin
  if old.coach_secret is not null and new.coach_secret is distinct from old.coach_secret then
    new.coach_secret := old.coach_secret;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_coach_secret on teams;
create trigger protect_coach_secret
  before update on teams
  for each row
  execute function _protect_coach_secret();

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認
-- ════════════════════════════════════════════════════════════════════
-- 1) 一度目のcoach_secret設定は通る
--    update teams set coach_secret = 'abc' where code = '<test-code>';  -- 旧がNULLなら成功
-- 2) 別の値への書き換えは黙って無視される(エラーにはならないが値は変わらない)
--    update teams set coach_secret = 'evil' where code = '<test-code>';
--    select coach_secret from teams where code = '<test-code>';  -- 'abc'のままのはず

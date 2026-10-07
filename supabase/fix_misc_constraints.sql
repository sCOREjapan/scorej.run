-- supabase/fix_misc_constraints.sql
--
-- 【発覚した問題】(2026-10-07 データベースレビュー)
--   1) team_plan_codes.redeemed_by が auth.users(id) を「削除時の動作の指定なし」で参照していた。
--      チームプランのコードを使ったことのあるアカウントは、アカウント削除(api/delete-account.ts →
--      auth.admin.deleteUser)が外部キー制約違反で失敗し、削除できなかった(ストアのアカウント削除要件に抵触)。
--   2) coach_trials.team_code が teams(code) を ON DELETE CASCADE で参照していた。コーチが自分のチームを
--      削除すると「体験を使った」記録(coach_trials)まで消え、体験を何度でも作り直せた。
--   3) increment_feature_usage が、任意の feature / period_key の文字列で行を作れた
--      (ログイン済みなら誰でも、意味のない行を無制限に作れる)。
--   4) 匿名(anon)や一般ユーザー(authenticated)に、サーバーだけが書くべきテーブルへの書き込み権限が
--      既定で付いていた(行レベルセキュリティの「方針なし」で守られているだけの状態)。権限そのものを外す。
--   5) 管理用の関数(退会ユーザーのメール一覧・経営指標)が PUBLIC(全員)に実行可能のまま残っていた。
--   6) analytics_events に、認証なしで無制限・無検証に書き込めた。
--   7) 失効後も「有料」のまま残っている契約状態(Webhook の不具合の名残)。
--
-- 【実行方法】Supabase SQL エディタに貼って Run(冪等。存在しないテーブルは自動でスキップ)。
--
-- ⚠ 実行後も、支払い・体験・削除の各APIは従来どおり動く(service_role は影響を受けない)。

-- ── 1) チームプランのコード: ユーザー削除時は紐付けを外すだけにする ────────────
do $$
begin
  if to_regclass('public.team_plan_codes') is not null then
    alter table team_plan_codes drop constraint if exists team_plan_codes_redeemed_by_fkey;
    alter table team_plan_codes
      add constraint team_plan_codes_redeemed_by_fkey
      foreign key (redeemed_by) references auth.users(id) on delete set null;
  end if;
end $$;

-- ── 2) コーチ体験: チームを消しても「体験済み」の記録は残す ───────────────────
do $$
begin
  if to_regclass('public.coach_trials') is not null then
    alter table coach_trials alter column team_code drop not null;
    alter table coach_trials drop constraint if exists coach_trials_team_code_fkey;
    alter table coach_trials
      add constraint coach_trials_team_code_fkey
      foreign key (team_code) references teams(code) on delete set null;
  end if;
end $$;

-- ── 3) 利用回数カウンタ: 形式と日付を検証し、1日あたりの行数を制限する ─────────────
-- アプリは feature=英小文字とアンダースコア、period_key=端末の日付(YYYY-MM-DD)で呼ぶ。
-- api/analyze.ts の払い戻しカウンタは period_key='refund:YYYY-MM-DD'(UTC)で呼ぶ。
-- 端末の日付は日本時間と±1日ずれ得るため、±2日以内を許可する。
create or replace function increment_feature_usage(p_feature text, p_period_key text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_count   int;
  v_date    date;
  v_today   date := (now() at time zone 'Asia/Tokyo')::date;
  v_rows    int;
begin
  if v_uid is null then
    return 0;
  end if;
  -- 形式チェック（不正な値は何も記録せず 0 を返す。アプリは戻り値を使わないので画面には影響しない）
  if p_feature is null or p_feature !~ '^[a-z][a-z0-9_]{0,48}$' then return 0; end if;
  if p_period_key is null or p_period_key !~ '^(refund:)?[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return 0; end if;
  begin
    v_date := (regexp_replace(p_period_key, '^refund:', ''))::date;
  exception when others then
    return 0;
  end;
  if abs(v_date - v_today) > 2 then return 0; end if;

  -- 同じ日付キーに作れる行(機能の種類)を制限（意味のない行を大量に作られないように）
  if not exists (select 1 from feature_usage_counts
                  where user_id = v_uid and feature = p_feature and period_key = p_period_key) then
    select count(*) into v_rows from feature_usage_counts
     where user_id = v_uid and period_key = p_period_key;
    if v_rows >= 60 then return 0; end if;
  end if;

  insert into feature_usage_counts (user_id, feature, period_key, count)
  values (v_uid, p_feature, p_period_key, 1)
  on conflict (user_id, feature, period_key) do update
    set count = feature_usage_counts.count + 1,
        updated_at = now()
  returning count into v_count;
  return v_count;
end;
$$;
revoke execute on function increment_feature_usage(text, text) from public, anon;
grant  execute on function increment_feature_usage(text, text) to authenticated;

-- ── 4) サーバー専用テーブルの書き込み権限を外す ────────────────────────────────
-- 読み取り(SELECT)は、本人の行だけを読むポリシーがあるため authenticated に残す。
-- 書き込みは service_role(API)と SECURITY DEFINER の関数だけが行う。
do $$
declare t text;
begin
  -- 匿名は、これらのテーブルに一切アクセスさせない
  foreach t in array array['ticket_wallets', 'feature_usage_counts', 'subscription_status', 'coach_trials', 'team_plan_codes'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from anon', t);
    end if;
  end loop;
  -- ログイン済みユーザーは、書き込めない(読み取りのみ)
  foreach t in array array['feature_usage_counts', 'subscription_status', 'coach_trials', 'ticket_wallets'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete on public.%I from authenticated', t);
    end if;
  end loop;
  -- team_plan_codes は service_role 専用(ポリシーも無い)。ログイン済みにも一切見せない
  if to_regclass('public.team_plan_codes') is not null then
    revoke all on public.team_plan_codes from authenticated;
  end if;
end $$;

-- ── 5) 管理用の関数(会員のメール一覧・経営指標)を、PUBLIC からも実行できないようにする ──
-- Postgres の関数は、作成時に PUBLIC(全員)へ実行権限が付く。fix_admin_rpc_revoke_anon.sql は anon と
-- authenticated から外しただけで、PUBLIC の分は残っていたため、匿名キーだけで呼べた可能性がある
-- (get_churned_users_export は退会ユーザーのメールアドレスを返す)。PUBLIC・anon・authenticated から外し、
-- API(service_role。ADMIN_EXPORT_SECRET で保護)だけが呼べるようにする。search_path も固定する。
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('get_admin_stats', 'get_retention_cohorts', 'get_churned_users_export')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;

-- ── 6) analytics_events: 匿名でも書き込めるが、1行の大きさと形式には上限を設ける ───────────
-- 誰でも(認証なしで)書き込める設計のため、巨大な値や変な名前のイベントでデータを膨らませたり
-- 集計を汚したりできた。アプリが送る値(英小文字とアンダースコアのイベント名・短い文字列・小さな
-- metadata)に収まる範囲に制限する。既存の行は検証しない(not valid)。件数の増加そのものを止めるには、
-- Supabase のプラン上限と、定期的な古い行の削除(例: created_at が180日より前の行)で管理してください。
do $$
begin
  if to_regclass('public.analytics_events') is not null then
    alter table analytics_events drop constraint if exists analytics_events_shape_chk;
    alter table analytics_events add constraint analytics_events_shape_chk check (
          event_name ~ '^[a-z][a-z0-9_]{0,63}$'
      and (user_id_hash is null or char_length(user_id_hash) <= 128)
      and (plan_tier    is null or char_length(plan_tier)    <= 24)
      and (feature      is null or char_length(feature)      <= 64)
      and (app_version  is null or char_length(app_version)  <= 32)
      and (platform     is null or char_length(platform)     <= 24)
      and (metadata     is null or pg_column_size(metadata)  <= 4096)
    ) not valid;
  end if;
end $$;

-- ── 7) 期限が切れているのに「有料」のまま残っている契約状態を、無料に戻す ───────────────
-- api/revenuecat-webhook.ts は以前、失効時に NOT NULL の列へ null を書いて毎回失敗していたため、
-- 解約・失効後も tier='coach'/'noad' のまま残り、api/analyze.ts が「有料(無制限・上位モデル)」と
-- 判定し続けていた。Webhook は修正済みで、今後の失効は自動で戻る。すでに残っている行を、期限から
-- 2日以上過ぎたものだけ戻す(更新の通知が遅れている人を誤って戻さないための余裕)。
update subscription_status
   set tier = 'free', expires_at = null, original_purchase_date = null, updated_at = now()
 where tier in ('coach', 'noad')
   and expires_at is not null
   and expires_at < now() - interval '2 days';
update subscription_status
   set has_ticket_monthly = false, ticket_monthly_expires_at = null, updated_at = now()
 where has_ticket_monthly
   and ticket_monthly_expires_at is not null
   and ticket_monthly_expires_at < now() - interval '2 days';

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認
-- ════════════════════════════════════════════════════════════════════
-- 1) FK の削除時動作が 'n'(set null)になっていること
--    select conname, confdeltype from pg_constraint
--     where conname in ('team_plan_codes_redeemed_by_fkey', 'coach_trials_team_code_fkey');
-- 2) 書き込み権限が外れていること(authenticated は SELECT のみのはず)
--    select table_name, grantee, privilege_type from information_schema.role_table_grants
--     where table_schema = 'public' and grantee in ('anon', 'authenticated')
--       and table_name in ('ticket_wallets', 'feature_usage_counts', 'subscription_status', 'coach_trials', 'team_plan_codes')
--     order by 1, 2, 3;

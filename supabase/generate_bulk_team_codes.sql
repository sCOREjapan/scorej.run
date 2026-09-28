-- supabase/generate_bulk_team_codes.sql
-- 2026-09-25:「チームコードを100個くらい発行しておいて」との指示で作成。
-- api/admin-generate-team-code.ts のgenerateCode()と同じ形式(12文字・紛らわしい
-- I/O/0/1を除いた文字種・4-4-4のダッシュ区切り)のコードをSQL側で一括生成する。
-- ADMIN_CODE_SECRET(Vercel環境変数)を知らなくても、このプロジェクトの慣例通り
-- Supabase SQL Editorで直接実行できるようにした。

-- ── コード生成ヘルパー(admin-generate-team-code.tsのgenerateCode()と同一仕様) ──
create or replace function _gen_team_plan_code() returns text
language plpgsql as $$
declare
  chars  text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  raw    text := '';
  i      int;
begin
  for i in 1..12 loop
    raw := raw || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  end loop;
  return substr(raw, 1, 4) || '-' || substr(raw, 5, 4) || '-' || substr(raw, 9, 4);
end;
$$;

-- ── 100件発行 ──
-- tier は 'coach_monthly'(Standard/~15人) / 'coach_monthly_30'(Advance/~30人) /
-- 'coach_monthly_unlimited'(Premium/無制限) のいずれか。下の一括生成はデフォルトで
-- Standardにしているので、別プランで発行したい場合は 'coach_monthly' の部分を書き換えてから
-- 実行すること(枚数を分けたい場合は各tierごとにこのINSERT文をコピーして繰り返せばよい)。
-- 有効期限はadmin-generate-team-code.tsと同じ90日。
insert into team_plan_codes (code, tier, expires_at)
select _gen_team_plan_code(), 'coach_monthly', now() + interval '90 days'
from generate_series(1, 100)
on conflict (code) do nothing;

-- ── 発行結果の確認・コピー用(直近生成分) ──
select code, tier, status, expires_at
from team_plan_codes
where created_at > now() - interval '10 minutes'
order by created_at desc;

-- ════════════════════════════════════════════════════════════════════
-- 【開発者本人が何度でも使える特別コード】
--   api/redeem-team-code.ts側に対応する特例(UNLIMITED_TEST_CODE)を追加済み。
--   このコードだけは「使用済み(redeemed)」にならず、何度でも引き換え直せる
--   (実機テストで複数アカウント・複数端末から繰り返し使う想定)。
--   コード自体はここで固定値として発行する(admin-generate-team-code.ts経由ではなく)。
-- ════════════════════════════════════════════════════════════════════
insert into team_plan_codes (code, tier, expires_at, purchaser_email)
values ('FNDR-TEST-0001', 'coach_monthly_unlimited', null, '開発者本人用・何度でも引き換え可')
on conflict (code) do nothing;

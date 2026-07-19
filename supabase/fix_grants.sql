-- ════════════════════════════════════════════════════════════════════
-- 【緊急】テーブル権限(GRANT)の修復
--
-- 【原因】
--   public スキーマの全テーブルで、anon / authenticated に
--   SELECT / INSERT / UPDATE / DELETE が一切付与されていなかった。
--   付いていたのは REFERENCES / TRIGGER / TRUNCATE のみで、
--   アプリからは読むことも書くこともできない状態だった。
--
--   PostgreSQL の権限チェックは2段構え:
--     ① テーブルへのGRANT があるか   ← ここで落ちていた（42501）
--     ② RLSポリシーで、どの行を見せるか ← ここまで到達していなかった
--
--   RLSとポリシーは13テーブル全てに正しく設定済みだったので、
--   GRANTさえ通れば「自分のデータだけ」に正しく絞られる。
--
-- 【安全性】
--   実行前の確認で、public の全14テーブルが rls_on = true、
--   ポリシー1個ずつを保持していることを確認済み。
--   よってDML権限を与えても、行レベルではRLSが守る。
--
-- Supabase の SQL Editor に貼り付けて実行（1回でよい）
-- ════════════════════════════════════════════════════════════════════

-- ── ① スキーマの USAGE（これが無いと中のテーブルが見えない） ──
grant usage on schema public to anon, authenticated;

-- ── ② 既存テーブルに DML 権限を付与（本命） ──
grant select, insert, update, delete
  on all tables in schema public
  to anon, authenticated;

-- ── ③ シーケンス（id の自動採番に必要。無いと insert が失敗する） ──
grant usage, select
  on all sequences in schema public
  to anon, authenticated;

-- ── ④ 今後作るテーブルにも自動で付与（同じ事故の再発防止） ──
--    これが無いと、次に新しいテーブルを作った時に同じ問題が再発する。
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;

alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;


-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認
-- 全テーブルで DELETE, INSERT, SELECT, UPDATE が並べば成功
-- ════════════════════════════════════════════════════════════════════
select
  g.table_name,
  g.grantee,
  string_agg(distinct g.privilege_type, ', ' order by g.privilege_type) as privileges
from information_schema.role_table_grants g
where g.table_schema = 'public'
  and g.grantee in ('anon', 'authenticated')
group by 1, 2
order by 1, 2;

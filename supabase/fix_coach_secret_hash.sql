-- supabase/fix_coach_secret_hash.sql
--
-- 【発覚した問題】(2026-10-07 セキュリティ監査 + データベースレビュー)
--   teams.coach_secret(コーチだけが持つはずの秘密値)は平文で保存され、teamsの SELECT ポリシーは
--   「参加コードが一致する行」を丸ごと返すため、参加コードを知っている選手(や参加コードを
--   入手した第三者)が `select('*')` するだけでコーチの秘密値を読めてしまう。秘密値が読めると
--     ・チーム全員への一斉通知(api/notify.ts の target='players')
--     ・チームの削除(teams_delete_by_code_and_secret)
--   というコーチ専用の操作が、コーチ以外にもできる。
--
-- 【方針】
--   ・秘密値は SHA-256 のハッシュ(coach_secret_hash)だけをDBに持ち、平文(coach_secret)は常にNULLにする。
--   ・古いビルドのアプリは `upsert({code, ..., coach_secret})` と `select('*')` を使うため、
--     coach_secret 列そのものは残す(消すと古いビルドのupsertが壊れる)。常にNULLになるだけ。
--   ・照合は DB(削除ポリシー)と api/notify.ts の両方で、平文の入力値をハッシュして比較する。
--
-- 【実行順序(重要)。各ステップは前のステップの状態でも安全に動くようにしてあります】
--   ① 下の「パートA」を実行する。何も壊れない(列と関数を足してハッシュを計算するだけ)。
--   ② api/notify.ts の新版をデプロイする(コミット後にVercelへ反映)。
--      新版は「ハッシュ → 平文 → どちらも無い(従来通り許可)」の順に照合するので、
--      パートA実行前でも後でも動く。
--   ③ 「パートB」を実行する(1つのトランザクション)。実行後すぐ、末尾の確認クエリを流す。
--   ④ 古いビルドで ①チーム作成/ダッシュボードを開く ②お知らせ送信 ③捨てチームの削除 を試す。
--
-- 【この修正で直らない/残ること】
--   ・既に漏れていた可能性がある現在の秘密値は、ハッシュ化しても「過去に読まれた」事実は消えない。
--     秘密値の再発行(ローテーション)はアプリ側の対応(新ビルド)が必要。下の rotate_coach_secret は
--     そのための土台(今回は呼び出し側なし)。
--   ・coach_secret が元々NULLのチーム(体験で作ったチーム等)は「最初に設定した人が勝つ」状態のまま。
--     `select count(*) from teams where coach_secret_hash is null;` で件数を確認できる。
--
-- ════════════════════════════════════════════════════════════════════
-- パートA(先に実行。何も壊れない)
-- ════════════════════════════════════════════════════════════════════

create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

-- api/notify.ts の hashCoachSecret() と同じ計算にすること(接頭辞 'coach_secret:v1:' + SHA-256 の16進)
create or replace function private.hash_coach_secret(p text)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select encode(sha256(convert_to('coach_secret:v1:' || p, 'UTF8')), 'hex')
$$;

alter table teams add column if not exists coach_secret_hash text;
-- start-coach-trial.ts / コーチ体験機能で使う列(coach_trial_migration.sql)。未適用のDBでも下のトリガーが動くよう念のため。
alter table teams add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

update teams
   set coach_secret_hash = private.hash_coach_secret(coach_secret)
 where coach_secret is not null
   and coach_secret_hash is null;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- パートB(api/notify.ts の新版をデプロイした「後」に実行)
-- ════════════════════════════════════════════════════════════════════
begin;

-- 削除ポリシー用の照合関数。SECURITY DEFINER なので、平文/ハッシュの列を直接読ませずに結果(true/false)だけ返す。
create or replace function private.coach_secret_ok(p_code text, p_secret text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.teams t
     where t.code = p_code
       and (   (t.coach_secret_hash is null and t.coach_secret is null)           -- 秘密値が無い旧チーム: 従来通り参加コードだけで許可
            or (p_secret is not null and t.coach_secret_hash = private.hash_coach_secret(p_secret))
            or (p_secret is not null and t.coach_secret = p_secret))              -- 移行期間の保険(平文が残っている行)
  )
$$;
grant execute on function private.coach_secret_ok(text, text) to anon, authenticated;

drop policy if exists "teams_delete_by_code_and_secret" on teams;
create policy "teams_delete_by_code_and_secret" on teams
  for delete using (
    code = _request_team_code()
    and private.coach_secret_ok(code, _request_coach_secret())
  );

-- 平文を保存させず、ハッシュだけを持たせるトリガー(INSERT/UPDATE の両方)。
create or replace function private.teams_coach_secret_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    new.coach_secret_hash := null;          -- クライアントが送ったハッシュは受け付けない
    if new.coach_secret is not null
       and not exists (select 1 from public.teams t where t.code = new.code) then
      -- 本当に新しい行: その場でハッシュ化し、平文は保存しない。
      new.coach_secret_hash := private.hash_coach_secret(new.coach_secret);
      new.coach_secret := null;
    end if;
    -- 既に同じ code の行がある(= upsert の更新側に回る)場合は、平文を残したまま返す。
    -- ON CONFLICT DO UPDATE の EXCLUDED は BEFORE INSERT トリガーの結果を引き継ぐため、ここで
    -- NULL にすると更新側(下)が秘密値を受け取れず、旧チームの自己修復が黙って効かなくなる。
    return new;
  end if;

  -- UPDATE(ON CONFLICT DO UPDATE を含む)
  if old.coach_secret_hash is not null then
    -- 設定済みのハッシュは変更不可(rotate_coach_secret が private.rotating を立てた時だけ例外)
    if coalesce(current_setting('private.rotating', true), '') <> 'on' then
      new.coach_secret_hash := old.coach_secret_hash;
    end if;
  elsif old.coach_secret is not null then
    new.coach_secret_hash := private.hash_coach_secret(old.coach_secret);   -- 未移行の旧平文をその場でハッシュ化して固定
  elsif new.coach_secret is not null then
    new.coach_secret_hash := private.hash_coach_secret(new.coach_secret);   -- 最初の設定(旧チームの自己修復)
  else
    new.coach_secret_hash := null;
  end if;
  new.coach_secret := null;                                                  -- 平文は絶対に保存しない

  -- 選手が参加コードだけで owner_user_id を書き換えるのを防ぐ(service_role=APIは変更可)
  if old.owner_user_id is not null
     and new.owner_user_id is distinct from old.owner_user_id
     and coalesce(auth.role(), '') <> 'service_role' then
    new.owner_user_id := old.owner_user_id;
  end if;
  return new;
end;
$$;

-- 旧トリガー(fix_coach_secret_immutable.sql)は新トリガーに置き換える
drop trigger if exists protect_coach_secret on teams;
drop function if exists _protect_coach_secret();
drop trigger if exists teams_coach_secret_guard on teams;
create trigger teams_coach_secret_guard
  before insert or update on teams
  for each row
  execute function private.teams_coach_secret_guard();

-- 残っている平文を一括でハッシュに移す(トリガーが平文をNULLにする)
update teams set coach_secret = coach_secret where coach_secret is not null;

commit;

-- ════════════════════════════════════════════════════════════════════
-- 秘密値の再発行用(任意。今回のアプリは呼び出さない。次のビルドで使う想定の土台)
-- ════════════════════════════════════════════════════════════════════
-- create or replace function public.rotate_coach_secret(p_code text, p_old text, p_new text)
-- returns boolean
-- language plpgsql
-- security definer
-- set search_path = pg_catalog, public
-- as $$
-- begin
--   if p_new is null or length(p_new) < 32 then return false; end if;
--   perform set_config('private.rotating', 'on', true);
--   update public.teams
--      set coach_secret_hash = private.hash_coach_secret(p_new)
--    where code = p_code and coach_secret_hash = private.hash_coach_secret(p_old);
--   return found;
-- end;
-- $$;

-- ════════════════════════════════════════════════════════════════════
-- 実行後の確認(パートB実行後)
-- ════════════════════════════════════════════════════════════════════
-- 1) 平文が1件も残っていないこと(0 が返る)
--    select count(*) from teams where coach_secret is not null;
-- 2) ハッシュが入っていること / まだ秘密値が無い旧チームの件数
--    select count(*) filter (where coach_secret_hash is not null) as hashed,
--           count(*) filter (where coach_secret_hash is null)     as legacy_no_secret
--      from teams;
-- 3) 動作確認(1つのトランザクション。最後に rollback するので何も残らない)
--    begin; set local role anon;
--    select set_config('request.headers', '{"x-team-code":"ZZTEST"}', true);
--    insert into teams(code, team_name, coach_name, coach_secret) values ('ZZTEST','t','c','sekret');
--    insert into teams(code, team_name, coach_name, coach_secret) values ('ZZTEST','t','c','sekret')
--      on conflict (code) do update set team_name = excluded.team_name, coach_name = excluded.coach_name,
--                                       coach_secret = excluded.coach_secret;
--    select coach_secret, coach_secret_hash from teams where code = 'ZZTEST';   -- NULL | 64文字の16進
--    select set_config('request.headers', '{"x-team-code":"ZZTEST","x-coach-secret":"nope"}', true);
--    delete from teams where code = 'ZZTEST';                                    -- DELETE 0
--    select set_config('request.headers', '{"x-team-code":"ZZTEST","x-coach-secret":"sekret"}', true);
--    delete from teams where code = 'ZZTEST';                                    -- DELETE 1
--    rollback;
--
-- ⚠ このファイルの適用後は、fix_team_delete_requires_coach_secret.sql と
--   fix_coach_secret_immutable.sql を再実行しないこと(古い削除ポリシー/トリガーに戻り、
--   平文が再び保存・露出してしまう)。

-- supabase_app_config.sql
-- アプリの強制アップデート判定用の設定テーブル（1行のみ運用）
-- 管理はSupabaseダッシュボードのテーブルエディタから直接行う想定
-- （min_version_ios / min_version_android を上げると、それ未満のクライアントに強制アップデート画面が出る）

create table if not exists app_config (
  id int primary key default 1,
  min_version_ios int,
  min_version_android int,
  update_message text,
  updated_at timestamptz not null default now(),
  constraint app_config_single_row check (id = 1)
);

insert into app_config (id) values (1) on conflict (id) do nothing;

alter table app_config enable row level security;

-- 未ログインユーザーでも起動時にチェックする必要があるため、誰でも読み取り可能にする
drop policy if exists "app_config is publicly readable" on app_config;
create policy "app_config is publicly readable"
  on app_config for select
  using (true);

-- 書き込みはSupabaseダッシュボード（service role）からのみ。anon/authenticatedへのinsert/update/deleteポリシーは意図的に作らない。

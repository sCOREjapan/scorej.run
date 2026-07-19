-- supabase/fix_training_sessions_id_type.sql
-- training_sessions.id を uuid → text に変更（ローカルID "local-<timestamp>" が
-- uuid 型に弾かれて同期が常に失敗していたため）
-- Supabase SQL Editor にそのまま貼り付けて実行してください。

alter table training_sessions
  alter column id drop default,
  alter column id type text using id::text;

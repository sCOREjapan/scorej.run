-- supabase/team_avatars_migration.sql
--
-- 2026-09-21: 「選手・コーチのアカウントにそれぞれ写真を登録できるように」との要望で追加。
-- 当初は実写アップロード(Storage)を検討したが、部員に未成年が多いこと・肖像権への
-- 配慮から方針転換し、ChatGPTで生成した20種類の「親しみやすいキャラクター」プリセット
-- から選ぶ方式にした(実写アップロードは行わない)。そのため保存するのは実ファイルの
-- URLではなく、アプリに同梱された画像を指す固定キー文字列(例: "avatar_07"。
-- lib/avatarAssets.ts参照)のみで、Supabase Storageは使わない。

alter table team_members add column if not exists avatar_key text;
alter table teams        add column if not exists coach_avatar_key text;

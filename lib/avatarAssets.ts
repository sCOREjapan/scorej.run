// lib/avatarAssets.ts — 選手・コーチ用プリセットアバター（ChatGPT生成・20種）
//
// 2026-09-21: 実写アップロードは部員の肖像権・未成年配慮の観点で見送り、
// あらかじめ用意した20種のキャラクターイラストから選ぶ方式にした。
// team_members.avatar_key / teams.coach_avatar_key にはここのキー文字列のみを保存する
// （supabase/team_avatars_migration.sql参照）。Metroのrequire()は静的文字列が必須のため、
// 動的require不可 → 1枚ずつ列挙する。
//
// 2026-09-21: 元のPNG書き出しは表示サイズ(最大72px程度)に対して過大（250px前後・
// 平均85KB×20枚=約1.7MB）だったため、240pxにリサイズしJPEG化（アバターは透過不要）。
// 合計294KB(約17%)に削減。アバターサイズでの見た目の劣化は無し（確認済み）。
export const AVATAR_IMAGES: Record<string, any> = {
  avatar_01: require('../assets/illustrations/avatars/avatar_01.jpg'),
  avatar_02: require('../assets/illustrations/avatars/avatar_02.jpg'),
  avatar_03: require('../assets/illustrations/avatars/avatar_03.jpg'),
  avatar_04: require('../assets/illustrations/avatars/avatar_04.jpg'),
  avatar_05: require('../assets/illustrations/avatars/avatar_05.jpg'),
  avatar_06: require('../assets/illustrations/avatars/avatar_06.jpg'),
  avatar_07: require('../assets/illustrations/avatars/avatar_07.jpg'),
  avatar_08: require('../assets/illustrations/avatars/avatar_08.jpg'),
  avatar_09: require('../assets/illustrations/avatars/avatar_09.jpg'),
  avatar_10: require('../assets/illustrations/avatars/avatar_10.jpg'),
  avatar_11: require('../assets/illustrations/avatars/avatar_11.jpg'),
  avatar_12: require('../assets/illustrations/avatars/avatar_12.jpg'),
  avatar_13: require('../assets/illustrations/avatars/avatar_13.jpg'),
  avatar_14: require('../assets/illustrations/avatars/avatar_14.jpg'),
  avatar_15: require('../assets/illustrations/avatars/avatar_15.jpg'),
  avatar_16: require('../assets/illustrations/avatars/avatar_16.jpg'),
  avatar_17: require('../assets/illustrations/avatars/avatar_17.jpg'),
  avatar_18: require('../assets/illustrations/avatars/avatar_18.jpg'),
  avatar_19: require('../assets/illustrations/avatars/avatar_19.jpg'),
  avatar_20: require('../assets/illustrations/avatars/avatar_20.jpg'),
}

export const AVATAR_KEYS: string[] = Object.keys(AVATAR_IMAGES)

// 選手が選んだアバターのAsyncStorageキー（チームに未参加でも設定画面から保存できるよう、
// team_codeに紐付けない端末共通の値。app/(tabs)/team.tsxのjoined選手表示と
// app/(tabs)/mypage.tsxの設定画面が同じキーを読み書きすることで自動的に同期する）。
export const PLAYER_AVATAR_KEY = 'score_player_avatar_key'

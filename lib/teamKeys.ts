// lib/teamKeys.ts — チーム機能のAsyncStorageキー・型の共有定義
// 2026-09-24: 元々app/(tabs)/team.tsx内にしか無かったが、設定(マイページ)画面から
// コーチ/選手どちらのアバターかを判定するのに同じキーが必要になったため切り出した。
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'

export const ROLE_KEY  = 'trackmate_team_role'
export const SETUP_KEY = 'trackmate_team_setup'
export const JOINED_KEY = 'trackmate_team_joined'

// trialExpiresAt: 2026-09-25追加。無料体験(lib/coachTrial.ts)経由で作成されたチームにのみ
// 入る、体験期限のISO文字列。通常課金のチームには存在しない（undefined）。
export interface TeamSetup  { teamName: string; coachName: string; code: string; createdAt: string; trialExpiresAt?: string }
export interface JoinedTeam { code: string; teamName: string; coachName: string; playerName: string; joinedAt: string }

// 2026-09-30セキュリティ修正:「参加コードさえ知っていれば選手でもチーム全体を削除できる」
// 脆弱性への対応。参加コードは選手全員が知っている前提の共有値のため、これとは別に
// コーチの端末だけが持つ秘密値を用意し、破壊的操作(チーム削除)だけこれを要求する
// (supabase/fix_team_delete_requires_coach_secret.sql参照)。1端末1チーム運用の
// 現在のデータモデルに合わせ、チームごとではなく端末ごとに1つ持てば十分とする。
const COACH_SECRET_KEY = 'trackmate_team_coach_secret'

export async function getOrCreateCoachSecret(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(COACH_SECRET_KEY)
    if (existing) return existing
  } catch {}
  const fresh = Crypto.randomUUID()
  await AsyncStorage.setItem(COACH_SECRET_KEY, fresh).catch(() => {})
  return fresh
}

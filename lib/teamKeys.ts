// lib/teamKeys.ts — チーム機能のAsyncStorageキー・型の共有定義
// 2026-09-24: 元々app/(tabs)/team.tsx内にしか無かったが、設定(マイページ)画面から
// コーチ/選手どちらのアバターかを判定するのに同じキーが必要になったため切り出した。
export const ROLE_KEY  = 'trackmate_team_role'
export const SETUP_KEY = 'trackmate_team_setup'
export const JOINED_KEY = 'trackmate_team_joined'

// trialExpiresAt: 2026-09-25追加。無料体験(lib/coachTrial.ts)経由で作成されたチームにのみ
// 入る、体験期限のISO文字列。通常課金のチームには存在しない（undefined）。
export interface TeamSetup  { teamName: string; coachName: string; code: string; createdAt: string; trialExpiresAt?: string }
export interface JoinedTeam { code: string; teamName: string; coachName: string; playerName: string; joinedAt: string }

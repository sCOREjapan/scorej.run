// lib/teamAutoSync.ts — 練習記録をチームへ自動同期
// セッションが保存されるたびに呼ぶ。チームに未参加なら何もしない。
import AsyncStorage from '@react-native-async-storage/async-storage'
import { syncTeamSessions, upsertPlayerStats } from './supabaseTeam'
import { calcLevelInfo } from './gamification'
import type { TrainingSession } from '../types'

const JOINED_KEY  = 'trackmate_team_joined'

interface JoinedTeam {
  code:       string
  playerName: string
  [key: string]: any
}

/**
 * セッション保存後に呼ぶ。
 * - team_sessions へセッションをupsert（直近14日）
 * - team_player_stats のレベルを自動更新
 */
export async function autoSyncTeam(sessions: TrainingSession[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(JOINED_KEY)
    if (!raw) return
    const joined: JoinedTeam = JSON.parse(raw)
    if (!joined?.code || !joined?.playerName) return

    await Promise.all([
      syncTeamSessions(joined.code, joined.playerName, sessions),
      (async () => {
        const lvInfo = calcLevelInfo(sessions.length)
        // 既存のPB・種目は上書きしない（event/pb_displayは空で渡すと上書きしてしまうので
        // upsertPlayerStats の中で onConflict='team_code,player_name' なので
        // event/pb_display を空で送ると上書きされてしまう。
        // そのため level だけ更新するラッパーを使う）
        await upsertPlayerStatsLevelOnly(joined.code, joined.playerName, lvInfo.level)
      })(),
    ])
  } catch {
    // 同期エラーはサイレントに無視（ローカル記録を妨げない）
  }
}

// level だけ更新（event / pb_display は既存値を保持）
async function upsertPlayerStatsLevelOnly(teamCode: string, playerName: string, level: number) {
  try {
    const { fetchPlayerStats, upsertPlayerStats } = await import('./supabaseTeam')
    const stats = await fetchPlayerStats(teamCode)
    const mine  = stats.find(s => s.player_name === playerName)
    await upsertPlayerStats(teamCode, playerName, mine?.event ?? '', mine?.pb_display ?? '', level)
  } catch { /* ignore */ }
}

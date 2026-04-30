// lib/teamAutoSync.ts — 練習記録をチームへ自動同期
// セッションが保存されるたびに呼ぶ。チームに未参加なら何もしない。
import AsyncStorage from '@react-native-async-storage/async-storage'
import { syncTeamSessions, upsertPlayerStats, fetchPlayerStats } from './supabaseTeam'
import { calcLevelInfo } from './gamification'
import type { TrainingSession } from '../types'

const JOINED_KEY = 'trackmate_team_joined'

interface JoinedTeam {
  code:       string
  playerName: string
  [key: string]: any
}

/**
 * セッション保存後に呼ぶ。
 * - team_sessions へセッションをupsert（直近14日）
 * - team_player_stats のレベルを自動更新（既存PB・種目は上書きしない）
 */
export async function autoSyncTeam(sessions: TrainingSession[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(JOINED_KEY)
    if (!raw) return
    const joined: JoinedTeam = JSON.parse(raw)
    if (!joined?.code || !joined?.playerName) return

    // セッション同期
    await syncTeamSessions(joined.code, joined.playerName, sessions)

    // レベル + 最新コンディションを更新（PB・種目は既存値を保持）
    const lvInfo  = calcLevelInfo(sessions.length)
    const stats   = await fetchPlayerStats(joined.code)
    const mine    = stats.find(s => s.player_name === joined.playerName)
    const cutoff  = new Date(Date.now() - 30*24*60*60*1000).toISOString().slice(0,10)
    const recent  = sessions.filter(s => s.session_date >= cutoff)
    const lastS   = sessions[0]
    await upsertPlayerStats(
      joined.code,
      joined.playerName,
      mine?.event      ?? '',
      mine?.pb_display ?? '',
      lvInfo.level,
      lastS?.condition_level ?? 7,
      lastS?.fatigue_level   ?? 5,
      lastS?.session_date    ?? '',
      recent.length,
      mine?.goal ?? '',
    )
  } catch {
    // 同期エラーはサイレントに無視（ローカル記録を妨げない）
  }
}

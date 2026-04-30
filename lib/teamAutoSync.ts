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

/** 連続記録日数を計算（今日 or 昨日から遡る） */
function calcStreak(sessions: { session_date: string }[]): number {
  if (!sessions.length) return 0
  const dates = [...new Set(sessions.map(s => s.session_date))].sort((a, b) => b.localeCompare(a))
  const today     = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  if (dates[0] !== today && dates[0] !== yesterday) return 0
  let streak = 1
  for (let i = 1; i < dates.length; i++) {
    const expected = new Date(new Date(dates[i-1] + 'T00:00:00').getTime() - 86400000).toISOString().slice(0, 10)
    if (dates[i] === expected) streak++
    else break
  }
  return streak
}

/**
 * セッション保存後に呼ぶ。
 * - team_sessions へセッションをupsert（直近30日）
 * - team_player_stats のレベル・連続記録を自動更新（既存PB・種目は上書きしない）
 */
export async function autoSyncTeam(sessions: TrainingSession[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(JOINED_KEY)
    if (!raw) return
    const joined: JoinedTeam = JSON.parse(raw)
    if (!joined?.code || !joined?.playerName) return

    // セッション同期
    await syncTeamSessions(joined.code, joined.playerName, sessions)

    // レベル + 最新コンディション + 連続記録日数を更新（PB・種目は既存値を保持）
    const lvInfo  = calcLevelInfo(sessions.length)
    const stats   = await fetchPlayerStats(joined.code)
    const mine    = stats.find(s => s.player_name === joined.playerName)
    const cutoff  = new Date(Date.now() - 30*24*60*60*1000).toISOString().slice(0,10)
    const recent  = sessions.filter(s => s.session_date >= cutoff)
    const lastS   = sessions[0]
    const streak  = calcStreak(sessions)   // 全履歴から計算（正確な連続日数）
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
      mine?.goal   ?? '',
      streak,
    )
  } catch {
    // 同期エラーはサイレントに無視（ローカル記録を妨げない）
  }
}

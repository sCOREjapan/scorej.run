// lib/teamAutoSync.ts — 練習記録をチームへ自動同期
// セッションが保存されるたびに呼ぶ。チームに未参加なら何もしない。
import AsyncStorage from '@react-native-async-storage/async-storage'
import { syncTeamSessions, upsertPlayerStats, fetchPlayerStats, clearPlayerPrivateData } from './supabaseTeam'
import { calcLevelInfo } from './gamification'
import type { TrainingSession } from '../types'
import { localDateStr, todayLocalISO } from './dateLocal'

const JOINED_KEY      = 'trackmate_team_joined'
const LAST_SYNC_KEY   = 'trackmate_team_last_sync'
const THROTTLE_MS     = 30 * 60 * 1000   // 30分（IO節約）
// 2026-09-09: このファイルは共有レベル(trackmate_team_share_level)を一切見ずに
// syncTeamSessions()へ生のsessionsをそのまま渡していたため、選手が「部分共有」
// (疲労度・体調のみ)や「非公開」を選んでいても、練習記録を保存するたびに距離・
// 本数・メモまで含む完全なデータがコーチ側へ送られ続けるバグがあった
// （app/(tabs)/team.tsx の PlayerDashboard 側は同じ場面で正しくstrip/skipして
// いたのに、この自動同期経路だけ共有レベルを見ていなかった）。
// team.tsx側と同じstrip/skipロジックをここにも適用する。
const SHARE_LEVEL_KEY  = 'trackmate_team_share_level'

interface JoinedTeam {
  code:       string
  playerName: string
  [key: string]: any
}

/** 連続記録日数を計算（今日 or 昨日から遡る） */
function calcStreak(sessions: { session_date: string }[]): number {
  if (!sessions.length) return 0
  const dates = [...new Set(sessions.map(s => s.session_date))].sort((a, b) => b.localeCompare(a))
  const today     = todayLocalISO()
  const yesterday = localDateStr(new Date(Date.now() - 86400000))
  if (dates[0] !== today && dates[0] !== yesterday) return 0
  let streak = 1
  for (let i = 1; i < dates.length; i++) {
    const expected = localDateStr(new Date(new Date(dates[i-1] + 'T00:00:00').getTime() - 86400000))
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
export async function autoSyncTeam(
  sessions: TrainingSession[],
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(JOINED_KEY)
    if (!raw) return
    const joined: JoinedTeam = JSON.parse(raw)
    if (!joined?.code || !joined?.playerName) return

    // ── 30分スロットル ──
    // force=true（練習記録直後の意図的な保存）はバイパスして即同期する。
    // → コーチ側に記録がすぐ反映される。バックグラウンドの自動同期のみ制限。
    {
      const lastRaw = await AsyncStorage.getItem(LAST_SYNC_KEY)
      if (!force && lastRaw) {
        const lastSync = parseInt(lastRaw, 10)
        if (!isNaN(lastSync) && Date.now() - lastSync < THROTTLE_MS) return
      }
      // Supabase 呼び出し前にタイムスタンプを書く（並列呼び出し防止）
      await AsyncStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
    }

    // セッション同期（共有レベルに応じてstrip/skip。既定値2=フル共有は未設定時の後方互換）
    const shareLvRaw = await AsyncStorage.getItem(SHARE_LEVEL_KEY)
    const shareLv = (shareLvRaw ? Number(shareLvRaw) : 2) as 0 | 1 | 2
    if (shareLv >= 2) {
      await syncTeamSessions(joined.code, joined.playerName, sessions)
    } else if (shareLv === 1) {
      const lite = sessions.map(s => ({ ...s, distance_m: undefined, reps: undefined, sets: undefined, notes: undefined }))
      await syncTeamSessions(joined.code, joined.playerName, lite)
    } else {
      // 非公開: 既存のteam_sessions行も残さない
      await clearPlayerPrivateData(joined.code, joined.playerName)
      return
    }

    // レベル + 最新コンディション + 連続記録日数を更新（PB・種目は既存値を保持）
    const lvInfo  = calcLevelInfo(sessions.length)
    const stats   = await fetchPlayerStats(joined.code)
    const mine    = stats.find(s => s.player_name === joined.playerName)
    const cutoff  = localDateStr(new Date(Date.now() - 30*24*60*60*1000))
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

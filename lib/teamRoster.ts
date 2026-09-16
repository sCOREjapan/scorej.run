// lib/teamRoster.ts — コーチ向けホーム画面「今日のチーム状況」集計(P1)
//
// 2026-09-16: app/(tabs)/team.tsx の CoachDashboard は既に選手ごとの怪我リスク・
// 未確認の痛みを計算しているが、その計算結果はチームタブを開かないと見えず、
// 新設したCoachHomeScreen(ホームタブ)からは見えていなかった。
// ここではCoachDashboardの memberData 計算(displayMembers→risk算出)と同じ考え方を、
// ホーム画面から単独で呼び出せる形で複製する。完全に一本化する場合はCoachDashboard側の
// 計算をこの関数に置き換える大きめのリファクタが必要になるため、まずは複製にとどめ、
// 計算式を変える時は両方に反映すること。
import { calcInjuryRisk } from './injuryRisk'
import { localDateStr } from './dateLocal'
import { fetchMembers, fetchBodyReports, fetchTeamSessions, fetchPlayerStats, type TeamSessionRow } from './supabaseTeam'
import type { TrainingSession } from '../types'

export interface TeamRosterSummary {
  totalMembers:     number
  highRiskCount:    number   // riskScore >= 70
  unackedPainCount: number   // 未確認の痛み報告
  notLoggedCount:   number   // 直近7日に記録が無い人数
  notLoggedNames:   string[] // 表示用（最大5件）
}

const EMPTY_SUMMARY: TeamRosterSummary = {
  totalMembers: 0, highRiskCount: 0, unackedPainCount: 0, notLoggedCount: 0, notLoggedNames: [],
}

function toTrainingSession(row: TeamSessionRow): TrainingSession {
  return {
    id: row.id, user_id: row.player_name, session_date: row.session_date,
    session_type: row.session_type as TrainingSession['session_type'],
    fatigue_level: row.fatigue_level, condition_level: row.condition_level,
    distance_m: row.distance_m ?? undefined, reps: row.reps ?? undefined, sets: row.sets ?? undefined,
    created_at: row.synced_at,
  }
}

export async function getTeamRosterSummary(teamCode: string): Promise<TeamRosterSummary> {
  if (!teamCode) return EMPTY_SUMMARY
  try {
    const [members, bodyReports, teamSessions, playerStats] = await Promise.all([
      fetchMembers(teamCode), fetchBodyReports(teamCode), fetchTeamSessions(teamCode), fetchPlayerStats(teamCode),
    ])
    if (members.length === 0) return EMPTY_SUMMARY

    // player_nameごとにセッションをグルーピング（fetchTeamSessionsは既にsession_date降順）
    const sessionsByPlayer: Record<string, TrainingSession[]> = {}
    for (const row of teamSessions) {
      (sessionsByPlayer[row.player_name] ??= []).push(toTrainingSession(row))
    }

    const now = Date.now()
    const cutoff7d = now - 7 * 86_400_000
    let highRiskCount = 0
    let unackedPainCount = 0
    const notLoggedNames: string[] = []

    for (const m of members) {
      const rpt = bodyReports.find(r => r.player_name === m.player_name)
      const hasPainReport = (rpt?.parts?.length ?? 0) > 0
      if (hasPainReport && !rpt?.acked_by_coach) unackedPainCount++

      const sessions = sessionsByPlayer[m.player_name] ?? []
      const pStat = playerStats.find(s => s.player_name === m.player_name)

      // ホーム画面・CoachDashboardと同じ: 直近7日間の平均コンディションを使用
      const recentCondLevels = Array.from({ length: 7 }, (_, i) => {
        const key = localDateStr(new Date(now - i * 86_400_000))
        return sessions.find(s => s.session_date === key)?.condition_level
      }).filter((v): v is number => v !== undefined)
      const condLevel = recentCondLevels.length > 0
        ? recentCondLevels.reduce((a, b) => a + b, 0) / recentCondLevels.length
        : (pStat?.last_condition ?? 7)

      let sessionsForRisk = sessions
      if (sessions.length === 0 && pStat?.last_session_date) {
        sessionsForRisk = [{
          id: 'proxy', user_id: m.player_name, session_date: pStat.last_session_date,
          session_type: 'easy', fatigue_level: pStat.last_fatigue ?? 5,
          condition_level: condLevel, created_at: pStat.updated_at,
        }]
      }
      const risk = calcInjuryRisk(sessionsForRisk, [], condLevel, hasPainReport)
      if (risk.riskScore >= 70) highRiskCount++

      const lastDate = sessions[0]?.session_date ?? pStat?.last_session_date ?? ''
      const loggedRecently = !!lastDate && new Date(lastDate).getTime() >= cutoff7d
      if (!loggedRecently) notLoggedNames.push(m.player_name)
    }

    return {
      totalMembers: members.length,
      highRiskCount,
      unackedPainCount,
      notLoggedCount: notLoggedNames.length,
      notLoggedNames: notLoggedNames.slice(0, 5),
    }
  } catch {
    return EMPTY_SUMMARY
  }
}

// lib/weeklyReport.ts — Day7週次レポート（テンプレート集計・AIを使わない）
// sCORE_課金タイミング設計_Day0-7.md のDay7に対応。直近7日間の記録から
// 平均コンディション・平均睡眠時間・練習回数・怪我リスクの週内推移を集計するだけで、
// Gemini/Anthropicは一切呼ばない（安価・高速・オフラインでも計算可能）。
import AsyncStorage from '@react-native-async-storage/async-storage'
import { localDateStr } from './dateLocal'
import { calcInjuryRisk } from './injuryRisk'
import type { TrainingSession, SleepRecord } from '../types'

const LAST_SHOWN_KEY = 'trackmate_weekly_report_last_shown'
const MIN_GAP_MS = 7 * 24 * 60 * 60 * 1000

export interface WeeklyTrend {
  daysLogged: number          // コンディション記録がある日数（直近7日中）
  avgCondition: number | null // 1-10
  avgSleepHours: number | null
  sessionCount: number
  riskStart: number           // 7日前時点のリスクスコア
  riskEnd: number             // 今日時点のリスクスコア
}

export function computeWeeklyTrend(
  sessions: TrainingSession[],
  sleepRecords: SleepRecord[],
  conditionMap: Record<string, number>,
  asOfMs: number = Date.now(),
): WeeklyTrend {
  const MS_DAY = 86_400_000
  const days: string[] = []
  for (let i = 6; i >= 0; i--) days.push(localDateStr(new Date(asOfMs - i * MS_DAY)))

  const conditionVals = days.map(d => conditionMap[d]).filter((v): v is number => typeof v === 'number')
  const avgCondition = conditionVals.length ? conditionVals.reduce((a, b) => a + b, 0) / conditionVals.length : null

  const weekSleep = sleepRecords.filter(r => days.includes(r.sleep_date.slice(0, 10)) && (r.duration_min ?? 0) > 0)
  const avgSleepHours = weekSleep.length
    ? weekSleep.reduce((a, r) => a + (r.duration_min ?? 0), 0) / weekSleep.length / 60
    : null

  const sessionCount = sessions.filter(s => days.includes(s.session_date.slice(0, 10)) && s.session_type !== 'rest').length

  const avgConditionForRisk = avgCondition ?? 6
  const riskEnd = calcInjuryRisk(sessions, sleepRecords, avgConditionForRisk, false, {}, asOfMs).riskScore
  const riskStart = calcInjuryRisk(sessions, sleepRecords, avgConditionForRisk, false, {}, asOfMs - 6 * MS_DAY).riskScore

  return { daysLogged: conditionVals.length, avgCondition, avgSleepHours, sessionCount, riskStart, riskEnd }
}

/** 直近7日間、コンディションを何日記録したか（オンボーディングDay0からの累計ではなく直近週） */
export async function shouldShowWeeklyReport(trend: WeeklyTrend): Promise<boolean> {
  if (trend.daysLogged < 4) return false // 週の半分未満しか記録が無ければまだ出さない
  const lastShown = await AsyncStorage.getItem(LAST_SHOWN_KEY).catch(() => null)
  if (!lastShown) return true
  return Date.now() - new Date(lastShown).getTime() >= MIN_GAP_MS
}

export async function markWeeklyReportShown(): Promise<void> {
  await AsyncStorage.setItem(LAST_SHOWN_KEY, new Date().toISOString()).catch(() => {})
}

export type WeeklyInsightKey =
  | 'weeklyReport.insight.improving'
  | 'weeklyReport.insight.worsening'
  | 'weeklyReport.insight.shortSleep'
  | 'weeklyReport.insight.stable'

export function buildWeeklyInsightKey(trend: WeeklyTrend): WeeklyInsightKey {
  if (trend.avgSleepHours !== null && trend.avgSleepHours < 6) return 'weeklyReport.insight.shortSleep'
  if (trend.riskEnd - trend.riskStart >= 10) return 'weeklyReport.insight.worsening'
  if (trend.riskStart - trend.riskEnd >= 10) return 'weeklyReport.insight.improving'
  return 'weeklyReport.insight.stable'
}

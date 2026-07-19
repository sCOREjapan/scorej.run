// lib/fatigue.ts — 疲労・リカバリースコア計算

import type { TrainingSession, SleepRecord, RecoveryStatus } from '../types'
import { localDateStr } from './dateLocal'

// ── ユーティリティ ───────────────────────────────────────
function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v))
}

// ── 各スコア計算 ─────────────────────────────────────────

/**
 * 睡眠スコア: 直近3泊の quality_score (1-10) → 0-100
 * データなし: 60点（中立）
 */
function calcSleepScore(records: SleepRecord[]): number {
  if (!records.length) return 60
  const recent = records.slice(0, 3)
  const avg = recent.reduce((s, r) => s + r.quality_score, 0) / recent.length
  return clamp(Math.round((avg / 10) * 100))
}

/**
 * 疲労スコア: 直近3セッションの fatigue_level (1=楽, 10=超疲労) を逆転 → 0-100
 * fatigue 1 → 100 (回復済), fatigue 10 → 0 (限界)
 * データなし: 65点
 */
function calcFatigueScore(sessions: TrainingSession[]): number {
  const recent = sessions.filter(s => s.session_type !== 'rest').slice(0, 3)
  if (!recent.length) return 65
  const avg = recent.reduce((s, r) => s + r.fatigue_level, 0) / recent.length
  return clamp(Math.round(((10 - avg) / 9) * 100))
}

/**
 * 体調スコア: 直近3セッションの condition_level (1-10) → 0-100
 * データなし: 65点
 */
function calcConditionScore(sessions: TrainingSession[]): number {
  const recent = sessions.filter(s => s.session_type !== 'rest').slice(0, 3)
  if (!recent.length) return 65
  const avg = recent.reduce((s, r) => s + r.condition_level, 0) / recent.length
  return clamp(Math.round((avg / 10) * 100))
}

// ── 総合リカバリースコア ──────────────────────────────────

/**
 * 3指標から総合リカバリースコアを算出
 * @param sessions      直近の練習記録
 * @param sleepRecords  直近の睡眠記録
 * @param manualCondition  手動体調入力 (1-10)。省略時はセッションから算出
 */
export function calcRecoveryStatus(
  sessions: TrainingSession[],
  sleepRecords: SleepRecord[],
  manualCondition?: number,
): RecoveryStatus {
  const sleepScore = calcSleepScore(sleepRecords)
  const fatigueScore = calcFatigueScore(sessions)
  const conditionScore = manualCondition != null
    ? clamp(Math.round((manualCondition / 10) * 100))
    : calcConditionScore(sessions)

  // 疲労40% / 睡眠35% / 体調25%
  const overall = clamp(
    Math.round(fatigueScore * 0.40 + sleepScore * 0.35 + conditionScore * 0.25)
  )

  const readiness: 'high' | 'moderate' | 'low' =
    overall >= 70 ? 'high' : overall >= 45 ? 'moderate' : 'low'

  const advice =
    readiness === 'high'
      ? '回復良好。高強度メニューに最適な状態です。'
      : readiness === 'moderate'
      ? '回復中。中強度で質を重視したトレーニングを。'
      : '疲労蓄積中。軽ジョグかリカバリーを優先しましょう。'

  return { overall, sleep_score: sleepScore, fatigue_score: fatigueScore, readiness, advice }
}

// ── 7日間疲労トレンド ────────────────────────────────────

export interface DailyFatigue {
  date: string       // YYYY-MM-DD
  fatigue: number    // 1-10 (0 = データなし)
  condition: number  // 1-10 (0 = データなし)
}

/**
 * 直近7日の疲労・体調トレンドを返す（今日を含む）
 */
export function getFatigueTrend(sessions: TrainingSession[]): DailyFatigue[] {
  const trend: DailyFatigue[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = localDateStr(d)
    const s = sessions.find(ss => ss.session_date === dateStr)
    trend.push({
      date: dateStr,
      fatigue: s ? s.fatigue_level : 0,
      condition: s ? s.condition_level : 0,
    })
  }
  return trend
}

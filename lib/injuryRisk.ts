// lib/injuryRisk.ts — 怪我リスク計算エンジン v2
// ATL/CTL/TSB (EWMA) + 10%ルール + 体調 + 睡眠 + 連続高負荷 + 休養なし

import type { TrainingSession, SleepRecord } from '../types'

export type RiskLevel = 'low' | 'moderate' | 'high'

export interface RiskFactor {
  key: string
  name: string
  emoji: string
  score: number     // 0–100（そのファクターの問題度）
  maxScore: number  // このファクターの最大寄与点数
  description: string
}

export interface InjuryRiskResult {
  riskLevel: RiskLevel
  riskScore: number
  signalColor: string
  label: string
  recommendation: string
  reasons: string[]
  factors: RiskFactor[]
  weeklyKm: number
  prevWeeklyKm: number
  loadIncreasePct: number
  atl: number
  ctl: number
  tsb: number
}

// ── セッションTSS（改良版） ────────────────────────────────────
// RPE²モデル：高強度の疲労を指数的に評価
// 種目別倍率：スプリント/インターバルは同じ距離でも疲労が大きい
function sessionTSS(s: TrainingSession): number {
  const rpe = s.fatigue_level ?? 5

  const typeMultiplier: Record<string, number> = {
    sprint:   1.5,
    interval: 1.4,
    race:     1.3,
    tempo:    1.2,
    long:     1.0,
    easy:     1.0,
    drill:    0.9,
    strength: 0.8,
    rest:     0.0,
  }
  const mult = typeMultiplier[s.session_type] ?? 1.0

  // 距離から推定時間（種目別ペース）
  const pacePerKm: Record<string, number> = {
    sprint: 2, interval: 4, race: 3.5, tempo: 4.5,
    long: 6, easy: 6, drill: 5, strength: 0, rest: 0,
  }
  const pace = pacePerKm[s.session_type] ?? 6
  const durationMin = s.distance_m
    ? Math.min((s.distance_m / 1000) * pace, 150)
    : s.reps
    ? Math.min(s.reps * 3, 90)   // 本数×3分を仮定
    : 50

  // RPE² × duration × 種目倍率 / 10 = TSS
  return ((rpe * rpe) / 10) * durationMin * mult
}

export interface RiskInputExtra {
  mealQualityScore?: number
  screenTimeMinutes?: number
  restDaysThisWeek?: number
}

export function calcInjuryRisk(
  sessions: TrainingSession[],
  sleepRecords: SleepRecord[],
  conditionLevel: number,
  hasRecentSymptom = false,
  extra: RiskInputExtra = {},
): InjuryRiskResult {
  const now = Date.now()
  const MS_DAY = 86_400_000

  // ── 週間km（10%ルール） ────────────────────────────────────
  const thisWeek = sessions.filter(s =>
    now - new Date(s.session_date).getTime() <= 7 * MS_DAY
  )
  const prevWeek = sessions.filter(s => {
    const age = now - new Date(s.session_date).getTime()
    return age > 7 * MS_DAY && age <= 14 * MS_DAY
  })
  const weeklyKm     = thisWeek.reduce((a, s) => a + (s.distance_m ?? 0), 0) / 1000
  const prevWeeklyKm = prevWeek.reduce((a, s) => a + (s.distance_m ?? 0), 0) / 1000
  const loadIncreasePct = prevWeeklyKm > 0.5
    ? Math.round(((weeklyKm - prevWeeklyKm) / prevWeeklyKm) * 100)
    : 0

  // ── ATL / CTL / TSB（EWMA 7/42日） ───────────────────────
  const α7  = 2 / 8
  const α42 = 2 / 43
  let atl = 0, ctl = 0
  const dailyTSS: Record<string, number> = {}
  sessions.forEach(s => {
    const d = s.session_date.slice(0, 10)
    dailyTSS[d] = (dailyTSS[d] ?? 0) + sessionTSS(s)
  })
  for (let i = 41; i >= 0; i--) {
    const d = new Date(now - i * MS_DAY).toISOString().slice(0, 10)
    const tss = dailyTSS[d] ?? 0
    atl = atl + α7  * (tss - atl)
    ctl = ctl + α42 * (tss - ctl)
  }
  const tsb = Math.round(ctl - atl)

  // ── 睡眠（品質 + 時間） ────────────────────────────────────
  const recentSleep = sleepRecords
    .filter(r => now - new Date(r.sleep_date).getTime() <= 4 * MS_DAY)
    .slice(0, 4)
  const avgSleepQ = recentSleep.length
    ? recentSleep.reduce((a, r) => a + r.quality_score, 0) / recentSleep.length
    : 7

  const sleepWithDur = recentSleep.filter(r => r.duration_min && r.duration_min > 0)
  const avgSleepDur = sleepWithDur.length
    ? sleepWithDur.reduce((a, r) => a + (r.duration_min ?? 0), 0) / sleepWithDur.length
    : null

  // ── 直近疲労（最新3セッション） ────────────────────────────
  const recentFatigue = sessions.slice(0, 3).map(s => s.fatigue_level ?? 5)
  const avgRecentFatigue = recentFatigue.length
    ? recentFatigue.reduce((a, v) => a + v, 0) / recentFatigue.length
    : 5

  // ── 連続高負荷日数 ────────────────────────────────────────
  // 最近N日でfatigue >= 7の日が連続しているか（日付ベース、重複除去）
  const sortedDates = [...new Set(
    sessions
      .filter(s => now - new Date(s.session_date).getTime() <= 14 * MS_DAY)
      .sort((a, b) => b.session_date.localeCompare(a.session_date))
      .map(s => s.session_date.slice(0, 10))
  )]
  let consecutiveHardDays = 0
  for (const date of sortedDates) {
    const daySessions = sessions.filter(s => s.session_date.slice(0, 10) === date)
    const maxFatigue = Math.max(...daySessions.map(s => s.fatigue_level ?? 0))
    if (maxFatigue >= 7) {
      consecutiveHardDays++
    } else {
      break
    }
  }

  // ── 休養なしペナルティ ────────────────────────────────────
  const hasRestDay = thisWeek.some(s => s.session_type === 'rest')
  const uniqueTrainingDays = new Set(thisWeek.map(s => s.session_date.slice(0, 10))).size
  const noRestPenalty = !hasRestDay && uniqueTrainingDays >= 6

  // ── スコア計算 ────────────────────────────────────────────

  // 練習負荷増加（max 30）
  let loadScore = 0
  if      (loadIncreasePct > 40) loadScore = 30
  else if (loadIncreasePct > 20) loadScore = 20
  else if (loadIncreasePct > 10) loadScore = 10
  else if (loadIncreasePct > 5)  loadScore = 5

  // 疲労蓄積 TSB（max 25）
  let tsbScore = 0
  if      (tsb < -40) tsbScore = 25
  else if (tsb < -20) tsbScore = 16
  else if (tsb < -8)  tsbScore = 8
  else if (tsb < 0)   tsbScore = 3

  // 体調（max 20）
  let condScore = 0
  if      (conditionLevel <= 2) condScore = 20
  else if (conditionLevel <= 4) condScore = 12
  else if (conditionLevel <= 5) condScore = 5

  // 睡眠品質（max 12）
  let sleepQScore = 0
  if      (avgSleepQ < 4) sleepQScore = 12
  else if (avgSleepQ < 6) sleepQScore = 7
  else if (avgSleepQ < 7) sleepQScore = 3

  // 睡眠時間（max 10）
  let sleepDurScore = 0
  if (avgSleepDur !== null) {
    if      (avgSleepDur < 300) sleepDurScore = 10   // 5時間未満
    else if (avgSleepDur < 360) sleepDurScore = 7    // 6時間未満
    else if (avgSleepDur < 420) sleepDurScore = 3    // 7時間未満
  }

  // 直近疲労度（max 15）
  let fatigueScore = 0
  if      (avgRecentFatigue >= 9) fatigueScore = 15
  else if (avgRecentFatigue >= 8) fatigueScore = 10
  else if (avgRecentFatigue >= 7) fatigueScore = 5
  else if (avgRecentFatigue >= 6) fatigueScore = 2

  // 連続高負荷（max 20）
  let consecutiveScore = 0
  if      (consecutiveHardDays >= 5) consecutiveScore = 20
  else if (consecutiveHardDays >= 4) consecutiveScore = 14
  else if (consecutiveHardDays >= 3) consecutiveScore = 8
  else if (consecutiveHardDays >= 2) consecutiveScore = 3

  // 休養なし（max 8）
  const noRestScore = noRestPenalty ? 8 : 0

  // 食事（max 10）
  let mealScore = 0
  const mealQ = extra.mealQualityScore
  if (mealQ !== undefined) {
    if      (mealQ <= 3) mealScore = 10
    else if (mealQ <= 5) mealScore = 5
    else if (mealQ <= 7) mealScore = 2
  }

  // スクリーンタイム（max 8）
  let screenScore = 0
  const st = extra.screenTimeMinutes
  if (st !== undefined) {
    if      (st >= 360) screenScore = 8
    else if (st >= 240) screenScore = 5
    else if (st >= 180) screenScore = 2
  }

  // 違和感・痛み（max 20）
  const symptomScore = hasRecentSymptom ? 20 : 0

  // 合計（上限100）
  let score = loadScore + tsbScore + condScore + sleepQScore + sleepDurScore
            + fatigueScore + consecutiveScore + noRestScore
            + mealScore + screenScore + symptomScore
  score = Math.min(100, Math.round(score))

  // ── 理由リスト ────────────────────────────────────────────
  const reasons: string[] = []
  if (symptomScore > 0)            reasons.push('最近の違和感・痛みの記録あり ⚠️')
  if (consecutiveScore >= 14)      reasons.push(`${consecutiveHardDays}日連続で高強度練習（蓄積疲労危険域）`)
  else if (consecutiveScore >= 8)  reasons.push(`${consecutiveHardDays}日連続で高強度練習が続いている`)
  if (loadScore >= 20)             reasons.push(`週間負荷が先週比 +${loadIncreasePct}%（急増・怪我リスク高）`)
  else if (loadScore >= 10)        reasons.push(`先週比 +${loadIncreasePct}%（10%ルール超過）`)
  if (tsbScore >= 16)              reasons.push('累積疲労が限界値 — 今すぐ休養必要')
  else if (tsbScore >= 8)          reasons.push('疲労蓄積が多い — 調整週を検討')
  if (condScore >= 12)             reasons.push('体調がかなり悪い状態')
  else if (condScore > 0)          reasons.push('体調が低調')
  if (sleepDurScore >= 7)          reasons.push('睡眠時間が慢性的に不足している')
  if (sleepQScore >= 7)            reasons.push('睡眠の質が低い状態が続いている')
  else if (sleepQScore > 0)        reasons.push('睡眠の質が低め')
  if (fatigueScore >= 10)          reasons.push('直近の練習疲労が非常に高い')
  if (noRestScore > 0)             reasons.push('今週は休養日がない — 翌日にオフを入れること')
  if (mealScore >= 5)              reasons.push('食事の質が低い — エネルギー不足に注意')
  if (screenScore >= 5)            reasons.push('スクリーンタイムが多い — 睡眠に悪影響の可能性')

  // ── ファクター詳細 ────────────────────────────────────────
  const factors: RiskFactor[] = [
    {
      key: 'load',
      name: '練習負荷',
      emoji: '🏃',
      score: Math.round((loadScore / 30) * 100),
      maxScore: 30,
      description: weeklyKm > 0
        ? `今週 ${Math.round(weeklyKm * 10) / 10}km · 先週比 ${loadIncreasePct > 0 ? '+' : ''}${loadIncreasePct}%`
        : '記録なし',
    },
    {
      key: 'fatigue',
      name: '疲労蓄積',
      emoji: '⚡',
      score: Math.round((tsbScore / 25) * 100),
      maxScore: 25,
      description: `TSB ${tsb > 0 ? '+' : ''}${tsb} · 直近疲労 ${avgRecentFatigue.toFixed(1)}/10`,
    },
    {
      key: 'consecutive',
      name: '連続高負荷',
      emoji: '🔥',
      score: Math.round((consecutiveScore / 20) * 100),
      maxScore: 20,
      description: consecutiveHardDays > 0
        ? `${consecutiveHardDays}日連続で疲労7以上`
        : '連続高負荷なし',
    },
    {
      key: 'condition',
      name: '体調',
      emoji: '💪',
      score: Math.round((condScore / 20) * 100),
      maxScore: 20,
      description: `体調スコア ${conditionLevel}/10`,
    },
    {
      key: 'sleep',
      name: '睡眠',
      emoji: '😴',
      score: Math.round(((sleepQScore + sleepDurScore) / 22) * 100),
      maxScore: 22,
      description: avgSleepDur !== null
        ? `${Math.floor(avgSleepDur / 60)}h${Math.round(avgSleepDur % 60)}m · 品質 ${avgSleepQ.toFixed(1)}/10`
        : recentSleep.length
        ? `睡眠品質 ${avgSleepQ.toFixed(1)}/10`
        : '睡眠記録なし',
    },
    {
      key: 'recentFatigue',
      name: '直近疲労度',
      emoji: '🔋',
      score: Math.round((fatigueScore / 15) * 100),
      maxScore: 15,
      description: recentFatigue.length
        ? `直近${recentFatigue.length}回平均 ${avgRecentFatigue.toFixed(1)}/10`
        : '記録なし',
    },
    {
      key: 'meal',
      name: '食事',
      emoji: '🍽️',
      score: mealQ !== undefined ? Math.round((mealScore / 10) * 100) : -1,
      maxScore: 10,
      description: mealQ !== undefined ? `食事品質 ${mealQ}/10` : '未記録',
    },
    {
      key: 'screen',
      name: 'スクリーン',
      emoji: '📱',
      score: st !== undefined ? Math.round((screenScore / 8) * 100) : -1,
      maxScore: 8,
      description: st !== undefined ? `1日 ${Math.floor(st / 60)}時間${st % 60}分` : '未記録',
    },
  ]

  const riskLevel: RiskLevel = score >= 50 ? 'high' : score >= 25 ? 'moderate' : 'low'
  const signalColor = riskLevel === 'high' ? '#FF3B30' : riskLevel === 'moderate' ? '#FF9500' : '#34C759'
  const label =
    riskLevel === 'high'     ? '怪我リスク 高' :
    riskLevel === 'moderate' ? '注意が必要'    : 'コンディション良好'
  const recommendation =
    riskLevel === 'high'     ? '練習強度を下げるか休養を強く推奨' :
    riskLevel === 'moderate' ? '強度を落として様子を見ましょう' :
                               '通常通りの練習OK！'

  return {
    riskLevel, riskScore: score, signalColor, label, recommendation,
    reasons, factors,
    weeklyKm: Math.round(weeklyKm * 10) / 10,
    prevWeeklyKm: Math.round(prevWeeklyKm * 10) / 10,
    loadIncreasePct,
    atl: Math.round(atl), ctl: Math.round(ctl), tsb,
  }
}

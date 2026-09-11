// lib/dailyDecision.ts — 60秒状態チェックの「今日の一手」をルールベースで返す
//
// 2026-09-09: 設計書§3-2。高価なLLMを毎回叩かず、説明可能なルールで即座に返す。
// 同じ入力からは必ず同じ判定になる（AIのブレがない）ため、ホーム・通知・チーム画面
// （コーチが選手の状態を見る画面）で判定がずれることもない。
// AIは週次の要約や、ユーザーが明示的に深掘りしたい場面（recovery.tsx等）に限定する。

export type DailyDecisionLevel = 'ready' | 'caution' | 'recover'
export type PlannedIntensity = 'rest' | 'light' | 'normal' | 'high'
export type PainSeverity = 'none' | 'mild' | 'strong'

export interface DailyCheckinInput {
  sleepHours:        number            // 睡眠時間（時間）
  fatigue:           number            // 疲労度 1(楽)〜5(きつい)
  condition:         number            // 体調スコア 1〜10
  pain:              PainSeverity      // 痛み・違和感
  plannedIntensity:  PlannedIntensity  // 今日の練習予定強度
}

export interface DailyDecision {
  level:                 DailyDecisionLevel
  headline:              string
  reasons:               string[]   // 入力値に対応する説明（なぜこの判定か）
  recommendedAction:     string
  requiresCoachAttention: boolean
}

const LOW_SLEEP_H   = 6      // これ未満は睡眠不足とみなす
const HIGH_FATIGUE  = 4      // 5段階中4以上は高疲労
const LOW_CONDITION = 4      // 10段階中4以下は低調

/**
 * 60秒チェックの回答から「今日の一手」を返す。
 * 優先順位: 強い痛み(強制recover) > 睡眠+疲労+強度の組み合わせ > 単独要因
 */
export function decideDailyAction(input: DailyCheckinInput): DailyDecision {
  const reasons: string[] = []
  const lowSleep    = input.sleepHours < LOW_SLEEP_H
  const highFatigue = input.fatigue >= HIGH_FATIGUE
  const lowCond      = input.condition <= LOW_CONDITION
  const highIntensityPlanned = input.plannedIntensity === 'high' || input.plannedIntensity === 'normal'

  if (lowSleep)    reasons.push(`睡眠${input.sleepHours}時間（目安6時間未満）`)
  if (highFatigue) reasons.push('疲労度が高い')
  if (lowCond)      reasons.push('体調スコアが低め')
  // 軽い違和感は他の要因と重なった場合も理由から漏らさない（以前は睡眠不足+高疲労+
  // 高強度予定の複合判定に先に該当すると、mild painを報告していたことが結果に一切
  // 反映されないまま消えていた）
  if (input.pain === 'mild') reasons.push('軽い違和感がある')

  // ── 強い痛みは他の要因に関わらず最優先で休養判定 ──
  if (input.pain === 'strong') {
    return {
      level: 'recover',
      headline: '今日は無理をしない日',
      reasons: ['強い痛み・違和感がある'],
      recommendedAction: '練習を中止し、安静または軽いケアのみに。痛みが続く場合は指導者・保護者・医療専門職への相談を検討してください。',
      requiresCoachAttention: true,
    }
  }

  const riskCount = [lowSleep, highFatigue, lowCond].filter(Boolean).length

  // ── 睡眠不足+高疲労+高強度予定の重なりは要注意 ──
  if (riskCount >= 2 && highIntensityPlanned) {
    return {
      level: 'caution',
      headline: '今日は強度を1段階落とすのがおすすめ',
      reasons,
      recommendedAction: '予定していた練習より少し強度を落とすか、休養を検討してください。',
      requiresCoachAttention: riskCount >= 2,
    }
  }

  if (input.pain === 'mild') {
    return {
      level: 'caution',
      headline: '違和感のある部位に無理をかけない',
      reasons,
      recommendedAction: '練習は予定通りでも、違和感のある部位は様子を見ながら。悪化するようなら中止を。',
      requiresCoachAttention: false,
    }
  }

  if (riskCount >= 1) {
    return {
      level: 'caution',
      headline: '無理のない範囲で',
      reasons,
      recommendedAction: '予定通り練習してよいですが、きついと感じたら早めに切り上げましょう。',
      requiresCoachAttention: false,
    }
  }

  return {
    level: 'ready',
    headline: '今日はしっかり追い込める状態',
    reasons: ['睡眠・疲労・体調すべて良好'],
    recommendedAction: '予定通り練習を進めましょう。',
    requiresCoachAttention: false,
  }
}

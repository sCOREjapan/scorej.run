// lib/onboardingReadiness.ts — オンボーディング「初回チェック」用の簡易スコア（AIを使わない）
//
// 本番の怪我リスク計算(lib/injuryRisk.ts の calcInjuryRisk)は直近1〜6週間の練習・睡眠履歴を
// 必要とするため、登録直後で記録が0件のユーザーには使えない。
// ここではオンボーディングの状態チェック画面で聞く3問（昨日の練習・疲労感・睡眠時間、
// 任意で痛みの有無）だけから、あらかじめ決めたテンプレート（ルールベースの点数表）で
// 「初回チェック」の目安スコアを出す。AI（LLM）は一切呼ばない。
//
// スケールと意味は calcInjuryRisk と統一している（0=リスク低・良好 〜 100=リスク高）。
// 記録を重ねるほど、この簡易スコアから本番の calcInjuryRisk に置き換わっていく想定。
//
// 2026-09-07: 選択肢の粒度を4段階(練習)/5段階(疲労)/4段階(睡眠)に見直し。

export type YesterdayPractice = 'rest' | 'light' | 'normal' | 'hard'
export type FatigueLevel = 'veryLight' | 'light' | 'normal' | 'heavy' | 'veryHeavy'
export type SleepBand = 'under4' | 'h5to6' | 'h7to8' | 'over9'
export type ReadinessBand = 'low' | 'caution' | 'warning' | 'high'

export interface OnboardingConditionInput {
  practice: YesterdayPractice
  fatigue: FatigueLevel
  sleep: SleepBand
  hasPain: boolean
}

export interface OnboardingReadinessResult {
  /** 0-100。calcInjuryRiskと同じ意味（高いほどリスク高・要注意） */
  score: number
  band: ReadinessBand
  /** i18nキー（onboarding.condition.advice.*）。呼び出し側で t() して表示する */
  adviceKey: string
}

// ── 点数表（テンプレート） ──────────────────────────────────
const PRACTICE_PTS: Record<YesterdayPractice, number> = { rest: 0, light: 3, normal: 10, hard: 22 }
const FATIGUE_PTS: Record<FatigueLevel, number> = { veryLight: 0, light: 5, normal: 10, heavy: 16, veryHeavy: 22 }
const SLEEP_PTS: Record<SleepBand, number> = { over9: 0, h7to8: 3, h5to6: 14, under4: 25 }
const PAIN_PTS = 25

export function computeOnboardingReadiness(input: OnboardingConditionInput): OnboardingReadinessResult {
  let score = PRACTICE_PTS[input.practice] + FATIGUE_PTS[input.fatigue] + SLEEP_PTS[input.sleep]
  if (input.hasPain) score += PAIN_PTS
  score = Math.max(0, Math.min(100, Math.round(score)))

  const band: ReadinessBand =
    score <= 24 ? 'low' : score <= 49 ? 'caution' : score <= 74 ? 'warning' : 'high'

  // 痛み・違和感の申告がある場合は、スコア帯によらず注意喚起のテンプレートを優先する
  // （calcInjuryRiskのsymptomScoreと同じ考え方＝違和感は最優先シグナル）
  const adviceKey = input.hasPain
    ? 'onboarding.condition.advice.pain'
    : `onboarding.condition.advice.${band}`

  return { score, band, adviceKey }
}

// ホーム画面のRISK_CFGと同じ帯色（lib/theme.tsのBRAND/ALERT + 中間2色）
export const READINESS_BAND_COLOR: Record<ReadinessBand, string> = {
  low: '#166534',
  caution: '#f59e0b',
  warning: '#f97316',
  high: '#E53935',
}

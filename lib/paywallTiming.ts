// lib/paywallTiming.ts — Day0/1/3/5/7 条件ゲート型の課金訴求タイミング判定
// 「登録からN日後」という日数固定ではなく、本人の利用実績（記録回数・スコア閲覧・
// 練習/睡眠記録の有無）で判定する。詳細仕様: sCORE_課金タイミング設計_Day0-7.md
//
// - Day0（オンボーディングのreveal画面）: 課金なし。app/onboarding.tsx で実装済み
// - Day1（2回目の記録を促す）: 既存のホーム画面「今日まだ入力していないこと」バナーが
//   日数を問わず毎日出るため、これで代替する（新規実装は不要と判断）
// - Day3: コンディション記録3回＋初回スコア閲覧＋練習or睡眠記録1回以上を満たした
//   FREEユーザーだけに、最初のチケット月額プラン案内を1回出す
// - Day5: Day3の条件を満たしたが未購入で継続中のユーザーに、2日以上空けて1回だけ再案内
// - Day7（週次レポート）: 未着手（週次レポート機能自体がまだ無い。別途実装予定）
import AsyncStorage from '@react-native-async-storage/async-storage'

const FIRST_SCORE_VIEWED_KEY = 'trackmate_first_score_viewed'
const DAY3_SHOWN_AT_KEY = 'trackmate_day3_offer_shown_at'
const DAY5_SHOWN_AT_KEY = 'trackmate_day5_offer_shown_at'
const DAY5_MIN_GAP_MS = 2 * 24 * 60 * 60 * 1000 // Day3表示から最低2日空けてDay5

export async function markFirstScoreViewed(): Promise<void> {
  const existing = await AsyncStorage.getItem(FIRST_SCORE_VIEWED_KEY)
  if (!existing) await AsyncStorage.setItem(FIRST_SCORE_VIEWED_KEY, '1').catch(() => {})
}

export async function hasViewedFirstScore(): Promise<boolean> {
  return (await AsyncStorage.getItem(FIRST_SCORE_VIEWED_KEY).catch(() => null)) === '1'
}

export interface OfferGateInput {
  /** コンディション記録した日数（全期間・累計） */
  conditionRecordCount: number
  /** 練習または睡眠の記録が1件以上あるか */
  hasPracticeOrSleepLog: boolean
  /** FREEプランのユーザーか（noad/ticket_monthly/coach加入者には出さない） */
  isFreeTier: boolean
}

// ── Day3: 最初のチケット月額プラン案内 ──────────────────────
export async function shouldShowDay3Offer(input: OfferGateInput): Promise<boolean> {
  if (!input.isFreeTier) return false
  if (input.conditionRecordCount < 3) return false
  if (!input.hasPracticeOrSleepLog) return false
  if (!(await hasViewedFirstScore())) return false
  const shown = await AsyncStorage.getItem(DAY3_SHOWN_AT_KEY).catch(() => null)
  return !shown
}

export async function markDay3OfferShown(): Promise<void> {
  await AsyncStorage.setItem(DAY3_SHOWN_AT_KEY, new Date().toISOString()).catch(() => {})
}

// ── Day5: Day3を見送ったが継続中のユーザーへの再案内（1回だけ） ──
export async function shouldShowDay5Offer(isFreeTier: boolean): Promise<boolean> {
  if (!isFreeTier) return false
  const day3At = await AsyncStorage.getItem(DAY3_SHOWN_AT_KEY).catch(() => null)
  if (!day3At) return false // Day3の条件をまだ満たしていない人には出さない
  const day5At = await AsyncStorage.getItem(DAY5_SHOWN_AT_KEY).catch(() => null)
  if (day5At) return false
  const elapsed = Date.now() - new Date(day3At).getTime()
  return elapsed >= DAY5_MIN_GAP_MS
}

export async function markDay5OfferShown(): Promise<void> {
  await AsyncStorage.setItem(DAY5_SHOWN_AT_KEY, new Date().toISOString()).catch(() => {})
}

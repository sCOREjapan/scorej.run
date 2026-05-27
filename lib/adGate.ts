// lib/adGate.ts — 機能利用制限管理
// FREE / PRO / ELITE / COACH 制限仕様
//
// 機能             FREE                    PRO            ELITE/COACH
// AI機能全般       1日3回・毎回広告視聴   月30回         無制限
// CSVエクスポート   累計1回（無料）         月1回          無制限

import AsyncStorage from '@react-native-async-storage/async-storage'

export type Feature = 'ai_analysis' | 'video' | 'meal' | 'csv' | 'recovery' | 'workout'

// ── FREE：AI機能は1日3回まで ──────────────────────────────────
// 1回目：無料（広告不要）
// 2〜3回目：広告視聴が必要（needsAd: true）
// 3回使用後は hardLimited（当日は利用不可）
const FREE_DAILY_AI_FEATURES: Feature[] = ['ai_analysis', 'video', 'meal', 'recovery', 'workout']
const FREE_DAILY_AI_LIMIT    = 3
const FREE_CSV_TOTAL_LIMIT   = 1

// ── PRO：月30回（AI全機能）・csv月1回 ──────────────────────
const PRO_MONTHLY_LIMITS: Partial<Record<Feature, number>> = {
  ai_analysis: 30,
  video:       30,
  meal:        30,
  csv:         1,
  recovery:    30,
  workout:     30,
}

// ── ストレージキー ────────────────────────────────────────────
const TOTAL_KEY   = 'score_feature_total_usage'
const DAILY_KEY   = 'score_feature_daily_usage'
const MONTHLY_KEY = 'score_feature_monthly_usage'
const REWARD_KEY  = 'score_feature_reward_uses'   // 広告視聴で獲得したリワード回数

// ── 日付・月ヘルパー ──────────────────────────────────────────
const todayStr    = () => new Date().toISOString().slice(0, 10)  // YYYY-MM-DD
const currentMonth = () => new Date().toISOString().slice(0, 7)  // YYYY-MM

// ── Tier 取得 ─────────────────────────────────────────────────
export async function getTier(): Promise<'free' | 'pro' | 'elite' | 'coach'> {
  try {
    const raw = await AsyncStorage.getItem('trackmate_subscription')
    if (!raw) return 'free'
    const p = JSON.parse(raw)
    if (p.plan === 'coach') return 'coach'
    if (p.plan === 'elite') return 'elite'
    if (p.plan === 'pro' || p.isPremium) return 'pro'
  } catch {}
  return 'free'
}

// ── 累計 ──────────────────────────────────────────────────────
async function getTotalUsage(): Promise<Record<Feature, number>> {
  try {
    const raw = await AsyncStorage.getItem(TOTAL_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { ai_analysis: 0, video: 0, meal: 0, csv: 0, recovery: 0, workout: 0 }
}
async function saveTotalUsage(u: Record<Feature, number>) {
  await AsyncStorage.setItem(TOTAL_KEY, JSON.stringify(u)).catch(() => {})
}

// ── 日次 ──────────────────────────────────────────────────────
async function getDailyUsage(): Promise<{ date: string; counts: Record<string, number> }> {
  try {
    const raw = await AsyncStorage.getItem(DAILY_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p.date === todayStr()) return p
    }
  } catch {}
  return { date: todayStr(), counts: {} }
}
async function saveDailyUsage(d: { date: string; counts: Record<string, number> }) {
  await AsyncStorage.setItem(DAILY_KEY, JSON.stringify(d)).catch(() => {})
}

// ── 月次 ──────────────────────────────────────────────────────
async function getMonthlyUsage(): Promise<{ month: string; counts: Record<string, number> }> {
  try {
    const raw = await AsyncStorage.getItem(MONTHLY_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p.month === currentMonth()) return p
    }
  } catch {}
  return { month: currentMonth(), counts: {} }
}
async function saveMonthlyUsage(d: { month: string; counts: Record<string, number> }) {
  await AsyncStorage.setItem(MONTHLY_KEY, JSON.stringify(d)).catch(() => {})
}

// ── リワード回数管理 ──────────────────────────────────────────
async function getRewardUses(): Promise<Record<Feature, number>> {
  try {
    const raw = await AsyncStorage.getItem(REWARD_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { ai_analysis: 0, video: 0, meal: 0, csv: 0, recovery: 0, workout: 0 }
}

/** 広告視聴でリワード1回を付与 */
export async function grantRewardUse(feature: Feature): Promise<void> {
  const uses = await getRewardUses()
  uses[feature] = (uses[feature] ?? 0) + 1
  await AsyncStorage.setItem(REWARD_KEY, JSON.stringify(uses)).catch(() => {})
}

/** リワード1回を消費（残りがあればtrue） */
export async function consumeRewardUse(feature: Feature): Promise<boolean> {
  const uses = await getRewardUses()
  if ((uses[feature] ?? 0) > 0) {
    uses[feature] -= 1
    await AsyncStorage.setItem(REWARD_KEY, JSON.stringify(uses)).catch(() => {})
    return true
  }
  return false
}

// ── メイン：利用可否チェック ──────────────────────────────────
export async function checkAdGate(feature: Feature): Promise<{
  allowed:        boolean
  remaining:      number   // 残り回数（999 = 無制限）
  needsAd:        boolean
  hardLimited:    boolean
  limitType:      'none' | 'daily' | 'monthly' | 'total'
  rewardUses:     number   // 互換用（常に0）
}> {
  const tier = await getTier()

  // ELITE / COACH：AI含む全機能無制限
  if (tier === 'elite' || tier === 'coach') {
    return { allowed: true, remaining: 999, needsAd: false, hardLimited: false, limitType: 'none', rewardUses: 0 }
  }

  // PRO：月次制限
  if (tier === 'pro') {
    const monthlyLimit = PRO_MONTHLY_LIMITS[feature]
    if (monthlyLimit !== undefined) {
      const monthly = await getMonthlyUsage()
      const used = monthly.counts[feature] ?? 0
      const remaining = Math.max(0, monthlyLimit - used)
      if (remaining > 0) return { allowed: true, remaining, needsAd: false, hardLimited: false, limitType: 'monthly', rewardUses: 0 }
      return { allowed: false, remaining: 0, needsAd: false, hardLimited: true, limitType: 'monthly', rewardUses: 0 }
    }
    return { allowed: true, remaining: 999, needsAd: false, hardLimited: false, limitType: 'none', rewardUses: 0 }
  }

  // FREE
  // csv は累計1回無料（広告不要）
  if (feature === 'csv') {
    const total = await getTotalUsage()
    const used = total[feature] ?? 0
    if (used < FREE_CSV_TOTAL_LIMIT) return { allowed: true, remaining: FREE_CSV_TOTAL_LIMIT - used, needsAd: false, hardLimited: false, limitType: 'total', rewardUses: 0 }
    return { allowed: false, remaining: 0, needsAd: false, hardLimited: true, limitType: 'total', rewardUses: 0 }
  }

  // FREE AI機能：1回目は無料、2回目以降は広告視聴が必要（1日最大3回）
  if (FREE_DAILY_AI_FEATURES.includes(feature)) {
    const daily = await getDailyUsage()
    const usedToday = daily.counts[feature] ?? 0
    if (usedToday >= FREE_DAILY_AI_LIMIT) {
      // 今日の上限
      return { allowed: false, remaining: 0, needsAd: false, hardLimited: true, limitType: 'daily', rewardUses: 0 }
    }
    if (usedToday === 0) {
      // 1回目は無料（広告不要）
      return { allowed: true, remaining: FREE_DAILY_AI_LIMIT - usedToday, needsAd: false, hardLimited: false, limitType: 'daily', rewardUses: 0 }
    }
    // 2回目以降は広告視聴が必要
    return { allowed: false, remaining: FREE_DAILY_AI_LIMIT - usedToday, needsAd: true, hardLimited: false, limitType: 'daily', rewardUses: 0 }
  }

  return { allowed: true, remaining: 999, needsAd: false, hardLimited: false, limitType: 'none', rewardUses: 0 }
}

// ── 利用を記録 ─────────────────────────────────────────────────
export async function recordUsage(feature: Feature): Promise<void> {
  const tier = await getTier()
  if (tier === 'elite' || tier === 'coach') return

  if (tier === 'pro') {
    if (PRO_MONTHLY_LIMITS[feature] !== undefined) {
      const monthly = await getMonthlyUsage()
      monthly.counts[feature] = (monthly.counts[feature] ?? 0) + 1
      await saveMonthlyUsage(monthly)
    }
    return
  }

  // FREE：csv は累計、AI機能は日次
  if (feature === 'csv') {
    const total = await getTotalUsage()
    total[feature] = (total[feature] ?? 0) + 1
    await saveTotalUsage(total)
    return
  }
  if (FREE_DAILY_AI_FEATURES.includes(feature)) {
    const daily = await getDailyUsage()
    daily.counts[feature] = (daily.counts[feature] ?? 0) + 1
    await saveDailyUsage(daily)
  }
}

// ── 残り回数ラベル ────────────────────────────────────────────
export function remainingLabel(feature: Feature, remaining: number, tier: string): string {
  if (tier === 'elite' || tier === 'coach') return '無制限'
  if (tier === 'pro') {
    if (PRO_MONTHLY_LIMITS[feature]) return remaining >= 999 ? '無制限' : `今月残り${remaining}回`
    return '無制限'
  }
  if (remaining >= 999) return '無制限'
  if (remaining === FREE_DAILY_AI_LIMIT) return `今日残り${remaining}回（1回目無料）`
  return `今日残り${remaining}回（広告視聴で使用）`
}

// ── 残り1回の警告が必要か ────────────────────────────────────
export function shouldWarn(remaining: number): boolean {
  return remaining === 1
}

export { getDailyUsage }

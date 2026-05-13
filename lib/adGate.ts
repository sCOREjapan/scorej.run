// lib/adGate.ts — 機能利用制限管理
// FREE / PRO / ELITE 制限仕様（確定版）
//
// 機能             FREE           PRO              ELITE
// AI練習分析       累計3回        無制限           無制限
// 動画フォーム分析  累計2回        1日1回           無制限
// AI食事分析       累計3回        1日3回           無制限
// CSVエクスポート   累計1回        1ヶ月1回         無制限

import AsyncStorage from '@react-native-async-storage/async-storage'

export type Feature = 'ai_analysis' | 'video' | 'meal' | 'csv' | 'recovery'

// ── FREE：累計上限 ────────────────────────────────────────────
const FREE_TOTAL_LIMITS: Record<Feature, number> = {
  ai_analysis: 3,
  video:       2,
  meal:        2,
  csv:         1,
  recovery:    999,
}

// ── PRO：日次上限（video/meal）・月次上限（csv） ─────────────
const PRO_DAILY_LIMITS: Partial<Record<Feature, number>> = {
  video: 1,   // 1日1回
  meal:  3,   // 1日3回
}
const PRO_MONTHLY_LIMITS: Partial<Record<Feature, number>> = {
  csv: 1,     // 1ヶ月1回
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
    if (p.plan === 'elite') return 'elite'
    if (p.plan === 'coach') return 'coach'
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
  return { ai_analysis: 0, video: 0, meal: 0, csv: 0, recovery: 0 }
}
async function saveTotalUsage(u: Record<Feature, number>) {
  await AsyncStorage.setItem(TOTAL_KEY, JSON.stringify(u))
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
  await AsyncStorage.setItem(DAILY_KEY, JSON.stringify(d))
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
  await AsyncStorage.setItem(MONTHLY_KEY, JSON.stringify(d))
}

// ── リワード回数管理 ──────────────────────────────────────────
async function getRewardUses(): Promise<Record<Feature, number>> {
  try {
    const raw = await AsyncStorage.getItem(REWARD_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { ai_analysis: 0, video: 0, meal: 0, csv: 0, recovery: 0 }
}

/** 広告視聴でリワード1回を付与 */
export async function grantRewardUse(feature: Feature): Promise<void> {
  const uses = await getRewardUses()
  uses[feature] = (uses[feature] ?? 0) + 1
  await AsyncStorage.setItem(REWARD_KEY, JSON.stringify(uses))
}

/** リワード1回を消費（残りがあればtrue） */
export async function consumeRewardUse(feature: Feature): Promise<boolean> {
  const uses = await getRewardUses()
  if ((uses[feature] ?? 0) > 0) {
    uses[feature] -= 1
    await AsyncStorage.setItem(REWARD_KEY, JSON.stringify(uses))
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
  rewardUses:     number   // 広告視聴で獲得済みの残りリワード回数
}> {
  const tier = await getTier()

  // ELITE / コーチ：全機能無制限
  if (tier === 'elite' || tier === 'coach') {
    return { allowed: true, remaining: 999, needsAd: false, hardLimited: false, limitType: 'none', rewardUses: 0 }
  }

  // PRO
  if (tier === 'pro') {
    // 日次制限（video/meal）
    const dailyLimit = PRO_DAILY_LIMITS[feature]
    if (dailyLimit !== undefined) {
      const daily = await getDailyUsage()
      const used = daily.counts[feature] ?? 0
      const remaining = Math.max(0, dailyLimit - used)
      if (remaining > 0) return { allowed: true, remaining, needsAd: false, hardLimited: false, limitType: 'daily', rewardUses: 0 }
      return { allowed: false, remaining: 0, needsAd: false, hardLimited: true, limitType: 'daily', rewardUses: 0 }
    }
    // 月次制限（csv）
    const monthlyLimit = PRO_MONTHLY_LIMITS[feature]
    if (monthlyLimit !== undefined) {
      const monthly = await getMonthlyUsage()
      const used = monthly.counts[feature] ?? 0
      const remaining = Math.max(0, monthlyLimit - used)
      if (remaining > 0) return { allowed: true, remaining, needsAd: false, hardLimited: false, limitType: 'monthly', rewardUses: 0 }
      return { allowed: false, remaining: 0, needsAd: false, hardLimited: true, limitType: 'monthly', rewardUses: 0 }
    }
    // それ以外は無制限
    return { allowed: true, remaining: 999, needsAd: false, hardLimited: false, limitType: 'none', rewardUses: 0 }
  }

  // FREE：累計上限
  const totalUsage = await getTotalUsage()
  const used = totalUsage[feature] ?? 0
  const limit = FREE_TOTAL_LIMITS[feature]
  const freeRemaining = Math.max(0, limit - used)
  const rewardUses = (await getRewardUses())[feature] ?? 0

  if (freeRemaining > 0) return { allowed: true, remaining: freeRemaining, needsAd: false, hardLimited: false, limitType: 'total', rewardUses }
  // 無料枠ゼロ：リワードがあれば使用可
  if (rewardUses > 0)    return { allowed: true,  remaining: 0, needsAd: false, hardLimited: false, limitType: 'total', rewardUses }
  // 完全ブロック（広告を見て解除が必要）
  return { allowed: false, remaining: 0, needsAd: false, hardLimited: false, limitType: 'total', rewardUses: 0 }
}

// ── 利用を記録 ─────────────────────────────────────────────────
export async function recordUsage(feature: Feature): Promise<void> {
  const tier = await getTier()
  if (tier === 'elite' || tier === 'coach') return

  if (tier === 'pro') {
    if (PRO_DAILY_LIMITS[feature] !== undefined) {
      const daily = await getDailyUsage()
      daily.counts[feature] = (daily.counts[feature] ?? 0) + 1
      await saveDailyUsage(daily)
      return
    }
    if (PRO_MONTHLY_LIMITS[feature] !== undefined) {
      const monthly = await getMonthlyUsage()
      monthly.counts[feature] = (monthly.counts[feature] ?? 0) + 1
      await saveMonthlyUsage(monthly)
      return
    }
    return
  }

  // FREE：累計
  const total = await getTotalUsage()
  total[feature] = (total[feature] ?? 0) + 1
  await saveTotalUsage(total)
}

// ── 残り回数ラベル ────────────────────────────────────────────
export function remainingLabel(feature: Feature, remaining: number, tier: string): string {
  if (tier === 'elite' || tier === 'coach') return '無制限'
  if (tier === 'pro') {
    if (PRO_DAILY_LIMITS[feature])   return remaining >= 999 ? '無制限' : `今日残り${remaining}回`
    if (PRO_MONTHLY_LIMITS[feature]) return remaining >= 999 ? '無制限' : `今月残り${remaining}回`
    return '無制限'
  }
  if (remaining >= 999) return '無制限'
  return `残り${remaining}回（無料枠）`
}

// ── 残り1回の警告が必要か ────────────────────────────────────
export function shouldWarn(remaining: number): boolean {
  return remaining === 1
}

export { getDailyUsage }

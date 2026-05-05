// lib/adGate.ts — 機能利用制限管理
// 表の仕様に基づいた FREE / PRO / ELITE 制限を実装

import AsyncStorage from '@react-native-async-storage/async-storage'

export type Feature = 'ai_analysis' | 'video' | 'meal' | 'csv' | 'recovery'

// ── 無料ユーザーの生涯利用上限 ───────────────────────────────
// 「初回XX回」= 累計上限
const FREE_TOTAL_LIMITS: Record<Feature, number> = {
  ai_analysis: 2,   // AI練習分析：初回2回
  video:       2,   // 動画フォーム分析：初回2回
  meal:        3,   // AI食事分析：初回3回
  csv:         1,   // CSVエクスポート：初回1回
  recovery:    999, // AIリカバリー相談：無制限
}

// ── PRO ユーザーの月次上限 ────────────────────────────────────
// 動画フォーム分析のみ月5回制限
const PRO_MONTHLY_LIMITS: Partial<Record<Feature, number>> = {
  video: 5,  // 動画フォーム分析：月5回
}

// ── ストレージキー ────────────────────────────────────────────
const TOTAL_KEY   = 'score_feature_total_usage'    // 累計（FREEユーザー用）
const MONTHLY_KEY = 'score_feature_monthly_usage'  // 月次（PROユーザー用）

// ── PurchaseContext から tier を取得するヘルパー ──────────────
// AsyncStorage に PurchaseContext がキャッシュしたデータを参照
async function getTier(): Promise<'free' | 'pro' | 'elite' | 'coach'> {
  try {
    const raw = await AsyncStorage.getItem('trackmate_subscription')
    if (!raw) return 'free'
    const parsed = JSON.parse(raw)
    if (parsed.plan === 'elite') return 'elite'
    if (parsed.plan === 'coach') return 'coach'
    if (parsed.plan === 'pro' || parsed.isPremium) return 'pro'
  } catch {}
  return 'free'
}

// ── 累計利用数を取得・保存 ────────────────────────────────────
async function getTotalUsage(): Promise<Record<Feature, number>> {
  try {
    const raw = await AsyncStorage.getItem(TOTAL_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { ai_analysis: 0, video: 0, meal: 0, csv: 0, recovery: 0 }
}

async function saveTotalUsage(usage: Record<Feature, number>): Promise<void> {
  await AsyncStorage.setItem(TOTAL_KEY, JSON.stringify(usage))
}

// ── 月次利用数を取得・保存 ────────────────────────────────────
const currentMonth = () => new Date().toISOString().slice(0, 7) // YYYY-MM

async function getMonthlyUsage(): Promise<{ month: string; counts: Record<string, number> }> {
  try {
    const raw = await AsyncStorage.getItem(MONTHLY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.month === currentMonth()) return parsed
    }
  } catch {}
  return { month: currentMonth(), counts: {} }
}

async function saveMonthlyUsage(data: { month: string; counts: Record<string, number> }): Promise<void> {
  await AsyncStorage.setItem(MONTHLY_KEY, JSON.stringify(data))
}

// ── メイン：利用可否チェック ──────────────────────────────────
export async function checkAdGate(feature: Feature): Promise<{
  allowed: boolean
  remaining: number
  needsAd: boolean
  hardLimited: boolean
}> {
  const tier = await getTier()

  // ELITE / コーチ：全機能無制限
  if (tier === 'elite' || tier === 'coach') {
    return { allowed: true, remaining: 999, needsAd: false, hardLimited: false }
  }

  // PRO：動画のみ月次制限、それ以外無制限
  if (tier === 'pro') {
    const monthlyLimit = PRO_MONTHLY_LIMITS[feature]
    if (!monthlyLimit) {
      return { allowed: true, remaining: 999, needsAd: false, hardLimited: false }
    }
    const monthly = await getMonthlyUsage()
    const used = monthly.counts[feature] ?? 0
    const remaining = Math.max(0, monthlyLimit - used)
    if (remaining > 0) return { allowed: true, remaining, needsAd: false, hardLimited: false }
    return { allowed: false, remaining: 0, needsAd: false, hardLimited: true }
  }

  // FREE：累計上限チェック
  const totalUsage = await getTotalUsage()
  const used = totalUsage[feature] ?? 0
  const limit = FREE_TOTAL_LIMITS[feature]
  const remaining = Math.max(0, limit - used)

  if (remaining > 0) return { allowed: true, remaining, needsAd: false, hardLimited: false }
  return { allowed: false, remaining: 0, needsAd: false, hardLimited: true }
}

// ── 利用を記録 ─────────────────────────────────────────────────
export async function recordUsage(feature: Feature): Promise<void> {
  const tier = await getTier()

  // PROは月次カウント
  if (tier === 'pro' && PRO_MONTHLY_LIMITS[feature]) {
    const monthly = await getMonthlyUsage()
    monthly.counts[feature] = (monthly.counts[feature] ?? 0) + 1
    await saveMonthlyUsage(monthly)
    return
  }

  // FREE は累計カウント
  if (tier === 'free') {
    const total = await getTotalUsage()
    total[feature] = (total[feature] ?? 0) + 1
    await saveTotalUsage(total)
  }
  // ELITE/コーチは記録不要
}

// ── 残り回数のラベル文字列 ────────────────────────────────────
export function remainingLabel(feature: Feature, remaining: number, tier: string): string {
  if (tier === 'elite' || tier === 'coach') return '無制限'
  if (tier === 'pro') {
    if (feature === 'video') return `今月残り${remaining}回`
    return '無制限'
  }
  if (remaining >= 999) return '無制限'
  return `残り${remaining}回（無料枠）`
}

// 後方互換：既存コードが grantRewardUse を呼んでいる箇所向け
export async function grantRewardUse(_feature: Feature): Promise<boolean> {
  return false
}

// 後方互換：getDailyUsage
export async function getDailyUsage() {
  return getTotalUsage()
}

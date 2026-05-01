import AsyncStorage from '@react-native-async-storage/async-storage'
import { isPremium } from './subscription'

const KEY = 'trackmate_daily_usage'

export type Feature = 'video' | 'meal' | 'recovery'

// 広告なしで使える回数（無料枠）
export const FREE_LIMITS: Record<Feature, number> = {
  video:    999,
  meal:     999,
  recovery: 999,
}

// 広告を見ても超えられない1日の絶対上限
export const HARD_LIMITS: Record<Feature, number> = {
  video:    999,
  meal:     999,
  recovery: 999,
}

interface DailyUsage {
  date: string
  video: number
  meal: number
  recovery: number
}

export async function getDailyUsage(): Promise<DailyUsage> {
  const today = new Date().toISOString().slice(0, 10)
  const raw = await AsyncStorage.getItem(KEY)
  if (raw) {
    const parsed: DailyUsage = JSON.parse(raw)
    if (parsed.date === today) return parsed
  }
  return { date: today, video: 0, meal: 0, recovery: 0 }
}

export async function checkAdGate(feature: Feature): Promise<{
  allowed: boolean       // 広告なしで即使える
  remaining: number      // 広告なし残り回数
  needsAd: boolean       // 広告を見れば使える
  hardLimited: boolean   // 絶対上限に達した（今日はもう使えない）
}> {
  if (await isPremium()) return { allowed: true, remaining: 999, needsAd: false, hardLimited: false }

  const usage = await getDailyUsage()
  const used  = usage[feature] ?? 0
  const free  = FREE_LIMITS[feature]
  const hard  = HARD_LIMITS[feature]

  // 絶対上限に達している
  if (used >= hard) return { allowed: false, remaining: 0, needsAd: false, hardLimited: true }

  // 無料枠が残っている
  const remaining = Math.max(0, free - used)
  if (remaining > 0) return { allowed: true, remaining, needsAd: false, hardLimited: false }

  // 無料枠はないが広告で使える
  return { allowed: false, remaining: 0, needsAd: true, hardLimited: false }
}

export async function recordUsage(feature: Feature): Promise<void> {
  const usage = await getDailyUsage()
  usage[feature] = (usage[feature] ?? 0) + 1
  await AsyncStorage.setItem(KEY, JSON.stringify(usage))
}

// 広告視聴後の +1 付与（ただし絶対上限は超えない）
export async function grantRewardUse(feature: Feature): Promise<boolean> {
  const usage = await getDailyUsage()
  const used  = usage[feature] ?? 0
  if (used >= HARD_LIMITS[feature]) return false  // 付与できない
  // usageを1減らすことで実質+1回増やす
  usage[feature] = Math.max(0, used - 1)
  await AsyncStorage.setItem(KEY, JSON.stringify(usage))
  return true
}

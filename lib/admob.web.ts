/**
 * admob.web.ts — Web スタブ
 * Web では広告は一切表示しない。全関数はno-op / false を返す。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

const DAILY_INSIGHT_KEY = 'score_daily_insight_claimed'
const todayStr = () => new Date().toISOString().slice(0, 10)

export function setAdSuppressed(_value: boolean): void {}
export async function shouldShowInterstitial(): Promise<boolean> { return false }
export async function initAdmob(): Promise<void> {}
export async function showRewardedAd(): Promise<boolean> { return true }  // web開発時は成功扱い
export async function showInterstitialAd(): Promise<boolean> { return false }
export async function showAppOpenAd(): Promise<void> {}
export function getBannerUnitId(): string { return '' }

export async function hasDailyInsightClaimed(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(DAILY_INSIGHT_KEY)
    return raw === todayStr()
  } catch { return false }
}

export async function markDailyInsightClaimed(): Promise<void> {
  try {
    await AsyncStorage.setItem(DAILY_INSIGHT_KEY, todayStr())
  } catch {}
}

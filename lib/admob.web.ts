/**
 * admob.web.ts — Web スタブ
 * Web では広告は一切表示しない。全関数はno-op / false を返す。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { todayLocalISO } from './dateLocal'

const DAILY_INSIGHT_KEY = 'score_daily_insight_claimed'
// 2026-09-11バグ修正: toISOString()はUTC日付を返すため、JST 0-9時のユーザーだけ
// 「今日」判定が前日のままになり、既に見た日次コンテンツが再表示されない（最大9時間の
// 遅延）不具合があった。JSTローカル日付を返すtodayLocalISO()に差し替える。
const todayStr = () => todayLocalISO()

export function setAdSuppressed(_value: boolean): void {}
export async function shouldShowInterstitial(): Promise<boolean> { return false }
export async function initAdmob(): Promise<void> {}
export async function showRewardedAd(): Promise<boolean> { return true }  // web開発時は成功扱い
export async function showInterstitialAd(): Promise<boolean> { return false }
export async function showAppOpenAd(): Promise<void> {}
export function preloadInterstitialAd(): void {}
export async function preloadInterstitialIfDue(_discard = false): Promise<void> {}
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

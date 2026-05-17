/**
 * admob.ts — Google AdMob ラッパー
 *
 * ネイティブ（iOS/Android）のみ動作。
 * Web / Expo Go では広告をスキップして成功扱いにする。
 */

import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

// ── ストレージキー ─────────────────────────────────────────────
const SAVE_COUNT_KEY        = 'score_save_count_interstitial'
const APP_OPEN_LAST_KEY     = 'score_app_open_last_shown'
const DAILY_INSIGHT_KEY     = 'score_daily_insight_claimed'

const todayStr = () => new Date().toISOString().slice(0, 10)

// ── AdMob 広告ユニットID ───────────────────────────────────────
const AD_UNIT_IDS = {
  rewarded: {
    ios:     __DEV__
      ? 'ca-app-pub-3940256099942544/1712485313'   // Googleテスト用ID (iOS)
      : 'ca-app-pub-6225795381877305/7530247097',   // ✅ 本番 iOS リワード
    android: __DEV__
      ? 'ca-app-pub-3940256099942544/5224354917'   // Googleテスト用ID (Android)
      : 'ca-app-pub-6225795381877305/5184344841',   // ✅ 本番 Android リワード
  },
  banner: {
    ios:     __DEV__
      ? 'ca-app-pub-3940256099942544/2934735716'   // Googleテスト用ID (iOS)
      : 'ca-app-pub-6225795381877305/9296737831',   // ✅ 本番 iOS バナー
    android: __DEV__
      ? 'ca-app-pub-3940256099942544/6300978111'   // Googleテスト用ID (Android)
      : 'ca-app-pub-6225795381877305/2277920411',   // ✅ 本番 Android バナー
  },
  interstitial: {
    ios:     __DEV__
      ? 'ca-app-pub-3940256099942544/4411468910'   // Googleテスト用ID (iOS)
      : 'ca-app-pub-6225795381877305/INTERSTITIAL_IOS',   // ⚠️ AdMobで作成後差し替え
    android: __DEV__
      ? 'ca-app-pub-3940256099942544/1033173712'   // Googleテスト用ID (Android)
      : 'ca-app-pub-6225795381877305/INTERSTITIAL_ANDROID', // ⚠️ AdMobで作成後差し替え
  },
  appOpen: {
    ios:     __DEV__
      ? 'ca-app-pub-3940256099942544/5575463023'   // Googleテスト用ID (iOS)
      : 'ca-app-pub-6225795381877305/APP_OPEN_IOS',   // ⚠️ AdMobで作成後差し替え
    android: __DEV__
      ? 'ca-app-pub-3940256099942544/9257395921'   // Googleテスト用ID (Android)
      : 'ca-app-pub-6225795381877305/APP_OPEN_ANDROID', // ⚠️ AdMobで作成後差し替え
  },
}

// ── ライブラリ取得（Web/Expo Go では null）─────────────────────
function getAdmob() {
  if (Platform.OS === 'web') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-google-mobile-ads')
  } catch {
    return null
  }
}

// ── SDK初期化 ─────────────────────────────────────────────────
let _initialized = false

/** AdMob SDK を初期化（ネイティブのみ）。アプリ起動時に1回呼ぶ */
export async function initAdmob(): Promise<void> {
  const lib = getAdmob()
  if (!lib || _initialized) return
  try {
    await lib.MobileAds().initialize()
    _initialized = true
  } catch (e) {
    console.warn('[admob] initialize failed:', e)
  }
}

// ── インタースティシャル カウンター（2回に1回）─────────────────
/** 練習保存のたびに呼ぶ。2回に1回 true を返す */
export async function shouldShowInterstitial(): Promise<boolean> {
  if (Platform.OS === 'web') return false
  try {
    const raw = await AsyncStorage.getItem(SAVE_COUNT_KEY)
    const count = raw ? parseInt(raw, 10) : 0
    const newCount = count + 1
    await AsyncStorage.setItem(SAVE_COUNT_KEY, String(newCount))
    return newCount % 2 === 0   // 3→2 に変更
  } catch { return false }
}

// ── リワード広告 ───────────────────────────────────────────────
/**
 * リワード広告を表示する。
 * @returns true = 動画を最後まで視聴した（報酬付与OK）
 */
export async function showRewardedAd(): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (__DEV__) { console.log('[admob] web: reward skipped (dev mode)'); return true }
    return false
  }

  const lib = getAdmob()
  if (!lib) return false

  const unitId = Platform.OS === 'ios' ? AD_UNIT_IDS.rewarded.ios : AD_UNIT_IDS.rewarded.android

  try {
    const { RewardedAd, RewardedAdEventType, AdEventType } = lib
    const rewarded = RewardedAd.createForAdRequest(unitId, { requestNonPersonalizedAdsOnly: true })

    return await new Promise<boolean>((resolve) => {
      let earned = false
      let settled = false
      const settle = (val: boolean) => {
        if (settled) return
        settled = true
        unsubLoaded(); unsubEarned(); unsubClosed(); unsubError()
        resolve(val)
      }

      const unsubLoaded  = rewarded.addAdEventListener(RewardedAdEventType.LOADED,        () => { rewarded.show() })
      const unsubEarned  = rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => { earned = true })
      const unsubClosed  = rewarded.addAdEventListener(AdEventType.CLOSED,  () => settle(earned))
      const unsubError   = rewarded.addAdEventListener(AdEventType.ERROR, (e: Error) => {
        console.warn('[admob] rewarded error:', e)
        settle(false)
      })

      // 15秒タイムアウト（ロードが長引いたときの安全弁）
      setTimeout(() => settle(false), 15000)
      rewarded.load()
    })
  } catch (e) {
    console.warn('[admob] showRewardedAd exception:', e)
    return false
  }
}

// ── バナー広告ユニットID ───────────────────────────────────────
export function getBannerUnitId(): string {
  if (Platform.OS === 'ios') return AD_UNIT_IDS.banner.ios
  return AD_UNIT_IDS.banner.android
}

// ── インタースティシャル広告 ───────────────────────────────────
/**
 * インタースティシャル広告を表示する（フリープランの練習保存後に呼ぶ）。
 * @returns 表示完了で true、スキップ or エラーで false
 */
export async function showInterstitialAd(): Promise<boolean> {
  if (Platform.OS === 'web') return false

  const lib = getAdmob()
  if (!lib) return false

  const unitId = Platform.OS === 'ios' ? AD_UNIT_IDS.interstitial.ios : AD_UNIT_IDS.interstitial.android

  try {
    const { InterstitialAd, AdEventType } = lib
    const interstitial = InterstitialAd.createForAdRequest(unitId, { requestNonPersonalizedAdsOnly: true })

    return await new Promise<boolean>((resolve) => {
      let settled = false
      const settle = (val: boolean) => {
        if (settled) return
        settled = true
        unsubLoaded(); unsubClosed(); unsubError()
        resolve(val)
      }

      const unsubLoaded = interstitial.addAdEventListener(AdEventType.LOADED,  () => { interstitial.show() })
      const unsubClosed = interstitial.addAdEventListener(AdEventType.CLOSED,  () => settle(true))
      const unsubError  = interstitial.addAdEventListener(AdEventType.ERROR, (e: Error) => {
        console.warn('[admob] interstitial error:', e)
        settle(false)
      })

      // 10秒タイムアウト（ロード失敗でもブロックしない）
      setTimeout(() => settle(false), 10000)
      interstitial.load()
    })
  } catch (e) {
    console.warn('[admob] showInterstitialAd exception:', e)
    return false
  }
}

// ── App Open 広告（1日1回）────────────────────────────────────
/**
 * アプリ起動時に1日1回 App Open 広告を表示する。
 * 初回起動・すでに今日表示済みの場合はスキップ。
 */
export async function showAppOpenAd(): Promise<void> {
  if (Platform.OS === 'web') return

  const lib = getAdmob()
  if (!lib) return

  // 今日すでに表示したかチェック
  try {
    const lastShown = await AsyncStorage.getItem(APP_OPEN_LAST_KEY)
    if (lastShown === todayStr()) return  // 今日は表示済み
  } catch {}

  const unitId = Platform.OS === 'ios' ? AD_UNIT_IDS.appOpen.ios : AD_UNIT_IDS.appOpen.android

  try {
    const { AppOpenAd, AdEventType } = lib
    const appOpen = AppOpenAd.createForAdRequest(unitId, { requestNonPersonalizedAdsOnly: true })

    await new Promise<void>((resolve) => {
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        unsubLoaded(); unsubClosed(); unsubError()
        resolve()
      }

      const unsubLoaded = appOpen.addAdEventListener(AdEventType.LOADED, () => { appOpen.show() })
      const unsubClosed = appOpen.addAdEventListener(AdEventType.CLOSED, () => settle())
      const unsubError  = appOpen.addAdEventListener(AdEventType.ERROR, (e: Error) => {
        console.warn('[admob] appOpen error:', e)
        settle()
      })

      // 12秒タイムアウト
      setTimeout(() => settle(), 12000)
      appOpen.load()
    })

    // 表示完了 → 今日の日付を記録
    await AsyncStorage.setItem(APP_OPEN_LAST_KEY, todayStr())
  } catch (e) {
    console.warn('[admob] showAppOpenAd exception:', e)
  }
}

// ── デイリーAIインサイト 取得済みフラグ ──────────────────────
/** 今日のAIインサイトをすでに取得済みか確認 */
export async function hasDailyInsightClaimed(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(DAILY_INSIGHT_KEY)
    return raw === todayStr()
  } catch { return false }
}

/** 今日のAIインサイト取得済みとしてマーク */
export async function markDailyInsightClaimed(): Promise<void> {
  try {
    await AsyncStorage.setItem(DAILY_INSIGHT_KEY, todayStr())
  } catch {}
}

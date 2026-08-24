/**
 * admob.ts — Google AdMob ラッパー
 *
 * ネイティブ（iOS/Android）のみ動作。
 * Web / Expo Go では広告をスキップして成功扱いにする。
 */

import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { isAnyAdShowing, setAnyAdShowing } from './adLock'

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
      : 'ca-app-pub-6225795381877305/7262812886',   // ✅ 本番 iOS インタースティシャル
    android: __DEV__
      ? 'ca-app-pub-3940256099942544/1033173712'   // Googleテスト用ID (Android)
      : 'ca-app-pub-6225795381877305/5702319206',   // ✅ 本番 Android インタースティシャル
  },
  appOpen: {
    ios:     __DEV__
      ? 'ca-app-pub-3940256099942544/5575463023'   // Googleテスト用ID (iOS)
      : 'ca-app-pub-6225795381877305/3136094522',   // ✅ 本番 iOS App Open
    android: __DEV__
      ? 'ca-app-pub-3940256099942544/9257395921'   // Googleテスト用ID (Android)
      : 'ca-app-pub-6225795381877305/4197665841',   // ✅ 本番 Android App Open
  },
}

// ── 広告抑制フラグ（noad / coach プランは全広告を非表示）─────────
let _isNoad = false
/** PurchaseContext から呼ぶ。isNoad が true の間、全広告関数はノーオペになる */
export function setAdSuppressed(value: boolean) { _isNoad = value }

// ── Expo Go 判定（ネイティブAdMobモジュールが存在しない環境）──────
// Expo Go では appOwnership === 'expo'。この環境で require すると
// TurboModuleRegistry が Invariant Violation を投げて赤画面になるため
// require 自体を実行しない。
let _isExpoGo = false
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Constants = require('expo-constants').default
  // appOwnership: 'expo' / executionEnvironment: 'storeClient' のどちらかが Expo Go
  _isExpoGo = Constants?.appOwnership === 'expo'
    || Constants?.executionEnvironment === 'storeClient'
} catch {}

// ── ライブラリ取得（Web/Expo Go では null）─────────────────────
let _admobCache: any = null
function getAdmob() {
  if (Platform.OS === 'web' || _isExpoGo) return null
  if (_admobCache) return _admobCache
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _admobCache = require('react-native-google-mobile-ads')
    return _admobCache
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
    // シミュレーター・エミュレーターでは必ずテスト広告を表示
    // （'EMULATOR' は iOS Simulator / Android Emulator に自動適用される特殊ID）
    await lib.MobileAds().setRequestConfiguration({
      testDeviceIdentifiers: ['EMULATOR'],
    })
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
  if (_isNoad) return false
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
  if (_isNoad) return true   // 有料プランはリワード不要 → 即付与
  if (Platform.OS === 'web') {
    if (__DEV__) { console.log('[admob] web: reward skipped (dev mode)'); return true }
    return false
  }

  const lib = getAdmob()
  if (!lib) return false

  // 他の広告（インタースティシャル/App Open）が表示中なら多重起動しない
  if (isAnyAdShowing()) return false

  const unitId = Platform.OS === 'ios' ? AD_UNIT_IDS.rewarded.ios : AD_UNIT_IDS.rewarded.android

  setAnyAdShowing(true)
  try {
    const { RewardedAd, RewardedAdEventType, AdEventType } = lib
    const rewarded = RewardedAd.createForAdRequest(unitId, { requestNonPersonalizedAdsOnly: true })

    return await new Promise<boolean>((resolve) => {
      let earned = false
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      let closeTimer: ReturnType<typeof setTimeout>  // CLOSEDの50msタイマーを保持
      const settle = (val: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearTimeout(closeTimer)  // CLOSEDタイマーもキャンセル
        try { unsubLoaded(); unsubEarned(); unsubClosed(); unsubError() } catch {}
        resolve(val)
      }

      const unsubLoaded  = rewarded.addAdEventListener(RewardedAdEventType.LOADED, async () => {
        // ロード完了 → リワード動画は最大90秒（視聴時間 + バッファ）
        clearTimeout(timer)
        timer = setTimeout(() => settle(false), 90000)
        try { await rewarded.show() } catch (e) { settle(false) }
      })
      const unsubEarned  = rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => { earned = true })
      // EARNED_REWARD と CLOSED がほぼ同時に発火する場合、CLOSED が先に来ると earned=false のまま
      // 50ms 待って EARNED_REWARD ハンドラーを先に処理させる。タイマーIDを保持してキャンセル可能に。
      const unsubClosed  = rewarded.addAdEventListener(AdEventType.CLOSED, () => { closeTimer = setTimeout(() => settle(earned), 50) })
      const unsubError   = rewarded.addAdEventListener(AdEventType.ERROR, (e: Error) => {
        console.warn('[admob] rewarded error:', e)
        settle(false)
      })

      // ロード開始から5秒でフォールバック（ロード失敗時 / 審査環境対応）
      timer = setTimeout(() => settle(false), 5000)
      rewarded.load()
    })
  } catch (e) {
    console.warn('[admob] showRewardedAd exception:', e)
    return false
  } finally {
    setAnyAdShowing(false)
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
  if (_isNoad) return false
  if (Platform.OS === 'web') return false

  const lib = getAdmob()
  if (!lib) return false

  // 他の広告（リワード/App Open）が表示中なら多重起動しない
  if (isAnyAdShowing()) return false

  const unitId = Platform.OS === 'ios' ? AD_UNIT_IDS.interstitial.ios : AD_UNIT_IDS.interstitial.android

  setAnyAdShowing(true)
  try {
    const { InterstitialAd, AdEventType } = lib
    const interstitial = InterstitialAd.createForAdRequest(unitId, { requestNonPersonalizedAdsOnly: true })

    return await new Promise<boolean>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      const settle = (val: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        unsubLoaded(); unsubClosed(); unsubError()
        resolve(val)
      }

      const unsubLoaded = interstitial.addAdEventListener(AdEventType.LOADED, async () => {
        // ロード完了 → タイマーをshow+閉じる時間に延長（30秒）
        clearTimeout(timer)
        timer = setTimeout(() => settle(false), 30000)
        try { await interstitial.show() } catch (e) { settle(false) }
      })
      const unsubClosed = interstitial.addAdEventListener(AdEventType.CLOSED, () => settle(true))
      const unsubError  = interstitial.addAdEventListener(AdEventType.ERROR, (e: Error) => {
        console.warn('[admob] interstitial error:', e)
        settle(false)
      })

      // ロード開始から10秒でフォールバック（ロード失敗時）
      timer = setTimeout(() => settle(false), 10000)
      interstitial.load()
    })
  } catch (e) {
    console.warn('[admob] showInterstitialAd exception:', e)
    return false
  } finally {
    setAnyAdShowing(false)
  }
}

// ── App Open 広告（1日1回）────────────────────────────────────
/**
 * アプリ起動時に1日1回 App Open 広告を表示する。
 * 初回起動・すでに今日表示済みの場合はスキップ。
 */
// App Open広告のロード〜表示〜クローズの間、他のポップアップ（レビュー依頼・
// 広告なしプラン案内など）が同時に present されて画面が反応しなくなるのを防ぐためのフラグ。
let _appOpenAdShowing = false
export function isAppOpenAdShowing() { return _appOpenAdShowing }

export async function showAppOpenAd(): Promise<void> {
  if (_isNoad) return
  if (Platform.OS === 'web') return

  const lib = getAdmob()
  if (!lib) return

  // 今日すでに表示したかチェック
  try {
    const lastShown = await AsyncStorage.getItem(APP_OPEN_LAST_KEY)
    if (lastShown === todayStr()) return  // 今日は表示済み
  } catch {}

  // 他の広告（インタースティシャル/リワード）が表示中なら多重起動しない
  if (isAnyAdShowing()) return

  const unitId = Platform.OS === 'ios' ? AD_UNIT_IDS.appOpen.ios : AD_UNIT_IDS.appOpen.android

  _appOpenAdShowing = true
  setAnyAdShowing(true)
  try {
    const { AppOpenAd, AdEventType } = lib
    const appOpen = AppOpenAd.createForAdRequest(unitId, { requestNonPersonalizedAdsOnly: true })

    let actuallyShown = false

    await new Promise<void>((resolve) => {
      let settled = false
      // タイムアウトは「show() 後にユーザーが閉じる時間」を考慮して長めに設定（60秒）
      // ロード失敗は ERROR イベントで即時 resolve するため実害なし
      let timer: ReturnType<typeof setTimeout>
      const settle = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        unsubLoaded(); unsubClosed(); unsubError()
        resolve()
      }

      const unsubLoaded = appOpen.addAdEventListener(AdEventType.LOADED, async () => {
        // show() 成功後はユーザーが閉じるまで待つ（タイマーを延長）
        clearTimeout(timer)
        timer = setTimeout(() => settle(), 60000)
        try { await appOpen.show() } catch (showErr) {
          console.warn('[admob] appOpen.show() error:', showErr)
          settle()
        }
      })
      // CLOSED は実際に表示・ユーザーが閉じた後にのみ発火する
      const unsubClosed = appOpen.addAdEventListener(AdEventType.CLOSED, () => {
        actuallyShown = true
        settle()
      })
      const unsubError = appOpen.addAdEventListener(AdEventType.ERROR, (e: Error) => {
        console.warn('[admob] appOpen error:', e)
        settle()
      })

      // ロード開始から12秒でタイムアウト（ロード失敗時のフォールバック）
      timer = setTimeout(() => settle(), 12000)
      appOpen.load()
    })

    // 実際に表示・閉じた場合のみ「今日表示済み」と記録
    if (actuallyShown) {
      await AsyncStorage.setItem(APP_OPEN_LAST_KEY, todayStr())
    }
  } catch (e) {
    console.warn('[admob] showAppOpenAd exception:', e)
  } finally {
    _appOpenAdShowing = false
    setAnyAdShowing(false)
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

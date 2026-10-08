/**
 * admob.ts — Google AdMob ラッパー
 *
 * ネイティブ（iOS/Android）のみ動作。
 * Web / Expo Go では広告をスキップして成功扱いにする。
 */

import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { isAnyAdShowing, setAnyAdShowing } from './adLock'
import { todayLocalISO } from './dateLocal'
import { adRequestOptions } from './adPersonalization'

// ── ストレージキー ─────────────────────────────────────────────
const SAVE_COUNT_KEY        = 'score_save_count_interstitial'
const APP_OPEN_LAST_KEY     = 'score_app_open_last_shown'
const DAILY_INSIGHT_KEY     = 'score_daily_insight_claimed'
const FIRST_SEEN_KEY        = 'score_ad_first_seen_v1'

// 2026-09-11バグ修正: toISOString()はUTC日付を返すため、JST 0-9時のユーザーだけ
// 「今日」判定が前日のままになり、App Open広告の1日1回表示や日次コンテンツの
// 「今日はもう見た」判定が最大9時間ズレる不具合があった。JSTローカル日付を返す
// todayLocalISO()に差し替える。
const todayStr = () => todayLocalISO()

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
  await isNewUserGrace()   // 初回起動の日時を記録しておく(新規ユーザーの猶予期間の起点)。結果は使わない
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

// ── 全画面広告の出し方（離脱を増やさず、収益は落とさない）──────────
// 2026-10-07: 広告収益の減少を受けた見直し。
//  ・先読み: 「次の保存で出す番」になった時点で読み込みを始め、保存の瞬間は待たせない
//    (以前は保存した瞬間に読み込み、最大10秒、保存後の流れを止めていた。読み込みが遅いと失敗して出なかった)。
//  ・読み込めていなければ、短く待って、間に合わなければ黙ってスキップする。読み込みは続け、次の機会に出す。
//  ・間隔: 直前の全画面広告(インタースティシャル/App Open)から一定時間は出さない。
//  ・猶予: 初回起動から24時間は出さない(最初の1日の離脱を避ける)。すでに広告を見た記録のある既存ユーザーは対象外。
const INTERSTITIAL_EVERY    = 2                  // 練習保存2回に1回
const INTERSTITIAL_MIN_GAP  = 150 * 1000         // 全画面広告どうしの最短間隔
const INTERSTITIAL_WAIT_MS  = 3000               // 読み込み中のときに待つ上限
const NEW_USER_GRACE_MS     = 24 * 60 * 60 * 1000
const AD_TTL_MS             = 50 * 60 * 1000     // 読み込み済みの広告は約1時間で失効する

let _lastFullscreenAt = 0
let _firstSeen: number | null = null

/** 初回起動の日時(ms)。すでに広告を見た記録のある既存ユーザーは 0（猶予なし） */
async function readFirstSeen(): Promise<number> {
  if (_firstSeen != null) return _firstSeen
  let raw = await AsyncStorage.getItem(FIRST_SEEN_KEY)
  if (raw == null) {
    const [saves, appOpen] = await Promise.all([
      AsyncStorage.getItem(SAVE_COUNT_KEY),
      AsyncStorage.getItem(APP_OPEN_LAST_KEY),
    ])
    raw = String(saves != null || appOpen != null ? 0 : Date.now())
    await AsyncStorage.setItem(FIRST_SEEN_KEY, raw)
  }
  const n = parseInt(raw, 10)
  _firstSeen = Number.isFinite(n) ? n : 0
  return _firstSeen
}

/** 初回起動から24時間以内（新規ユーザーの猶予期間）か */
async function isNewUserGrace(): Promise<boolean> {
  try {
    const first = await readFirstSeen()
    return first > 0 && Date.now() - first < NEW_USER_GRACE_MS
  } catch { return false }
}

interface PreloadedAd {
  ad: any
  loaded: boolean
  loadedAt: number
  waiters: Array<() => void>
}
let _interstitial: PreloadedAd | null = null

/** 読み込み中、または読み込み済みで未失効か */
function isUsable(p: PreloadedAd | null): p is PreloadedAd {
  return !!p && (!p.loaded || Date.now() - p.loadedAt < AD_TTL_MS)
}

/** インタースティシャルを先読みする。読み込み中・読み込み済み(未失効)なら何もしない */
export function preloadInterstitialAd(): void {
  if (_isNoad || Platform.OS === 'web') return
  const lib = getAdmob()
  if (!lib) return
  if (isUsable(_interstitial)) return
  try {
    const { InterstitialAd, AdEventType } = lib
    const unitId = Platform.OS === 'ios' ? AD_UNIT_IDS.interstitial.ios : AD_UNIT_IDS.interstitial.android
    const ad = InterstitialAd.createForAdRequest(unitId, adRequestOptions())
    const rec: PreloadedAd = { ad, loaded: false, loadedAt: 0, waiters: [] }
    _interstitial = rec
    const wake = () => {
      const w = rec.waiters
      rec.waiters = []
      w.forEach(fn => { try { fn() } catch {} })
    }
    const unsubLoaded = ad.addAdEventListener(AdEventType.LOADED, () => {
      rec.loaded = true
      rec.loadedAt = Date.now()
      try { unsubLoaded(); unsubError() } catch {}
      wake()
    })
    const unsubError = ad.addAdEventListener(AdEventType.ERROR, (e: Error) => {
      console.warn('[admob] interstitial preload error:', e)
      try { unsubLoaded(); unsubError() } catch {}
      if (_interstitial === rec) _interstitial = null
      wake()
    })
    ad.load()
  } catch (e) {
    console.warn('[admob] preloadInterstitialAd exception:', e)
  }
}

/**
 * 次の保存でインタースティシャルを出す番なら、先読みしておく（起動時・ATT確認後に呼ぶ）。
 * discard=true なら、読み込み済みの広告も捨てて読み直す（ATTの結果が出る前に読んだ広告は識別子がないため）。
 */
export async function preloadInterstitialIfDue(discard = false): Promise<void> {
  if (_isNoad || Platform.OS === 'web') return
  try {
    if (discard) _interstitial = null
    if (await isNewUserGrace()) return
    const raw = await AsyncStorage.getItem(SAVE_COUNT_KEY)
    const parsed = raw ? parseInt(raw, 10) : 0
    const count = Number.isFinite(parsed) ? parsed : 0
    if ((count + 1) % INTERSTITIAL_EVERY === 0) preloadInterstitialAd()
  } catch {}
}

// ── インタースティシャル カウンター（2回に1回）─────────────────
/** 練習保存のたびに呼ぶ。2回に1回、間隔・猶予の条件を満たす時だけ true を返す */
export async function shouldShowInterstitial(): Promise<boolean> {
  if (Platform.OS === 'web') return false
  if (_isNoad) return false
  try {
    // 保存カウントを書く前に判定する（既存ユーザーの判定が、保存カウントの有無を見るため）
    const grace = await isNewUserGrace()
    const raw = await AsyncStorage.getItem(SAVE_COUNT_KEY)
    const parsed = raw ? parseInt(raw, 10) : 0
    const newCount = (Number.isFinite(parsed) ? parsed : 0) + 1
    await AsyncStorage.setItem(SAVE_COUNT_KEY, String(newCount))
    if (newCount % INTERSTITIAL_EVERY !== 0) {
      // 次の保存が表示の番: 今のうちに先読みして、その時は待たせない
      if (!grace && (newCount + 1) % INTERSTITIAL_EVERY === 0) preloadInterstitialAd()
      return false
    }
    if (grace) return false
    return Date.now() - _lastFullscreenAt >= INTERSTITIAL_MIN_GAP
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
    const rewarded = RewardedAd.createForAdRequest(unitId, adRequestOptions())

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
 * 先読み済みならその場で出す。読み込み中なら短く待ち、間に合わなければ黙ってスキップする。
 * @returns 表示完了で true、スキップ or エラーで false
 */
export async function showInterstitialAd(): Promise<boolean> {
  if (_isNoad) return false
  if (Platform.OS === 'web') return false

  const lib = getAdmob()
  if (!lib) return false

  // 他の広告（リワード/App Open）が表示中なら多重起動しない
  if (isAnyAdShowing()) return false

  if (!isUsable(_interstitial)) { _interstitial = null; preloadInterstitialAd() }
  const rec = _interstitial as PreloadedAd | null
  if (!rec) return false
  if (!rec.loaded) {
    // 読み込み中: 短く待つ。間に合わなければ、読み込みは続けたまま今回はスキップ（次の機会に出る）
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, INTERSTITIAL_WAIT_MS)
      rec.waiters.push(() => { clearTimeout(timer); resolve() })
    })
    if (!rec.loaded || _interstitial !== rec || isAnyAdShowing()) return false
  }
  _interstitial = null   // 1回表示したら使えない

  setAnyAdShowing(true)
  try {
    const { AdEventType } = lib
    return await new Promise<boolean>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      const settle = (val: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { unsubClosed(); unsubError() } catch {}
        resolve(val)
      }
      const unsubClosed = rec.ad.addAdEventListener(AdEventType.CLOSED, () => settle(true))
      const unsubError  = rec.ad.addAdEventListener(AdEventType.ERROR, (e: Error) => {
        console.warn('[admob] interstitial error:', e)
        settle(false)
      })
      // 表示してから閉じるまでの保険（2分）
      timer = setTimeout(() => settle(false), 120000)
      Promise.resolve(rec.ad.show()).catch(() => settle(false))
    })
  } catch (e) {
    console.warn('[admob] showInterstitialAd exception:', e)
    return false
  } finally {
    _lastFullscreenAt = Date.now()
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

  // 初回起動から24時間は出さない（最初の1日の離脱を避ける。2日目以降は1日1回）
  if (await isNewUserGrace()) return

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
    const appOpen = AppOpenAd.createForAdRequest(unitId, adRequestOptions())

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
      _lastFullscreenAt = Date.now()
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

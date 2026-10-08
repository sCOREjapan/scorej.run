// lib/rewardedAd.ts — Google AdMob リワード広告
// react-native-google-mobile-ads は遅延ロード（Expo Go / シミュレーターで crash しないよう）
import { Platform } from 'react-native'
import { isAnyAdShowing, setAnyAdShowing } from './adLock'
import { adRequestOptions } from './adPersonalization'

// ── 広告ユニットID ────────────────────────────────────────────
export const AD_UNIT_IDS = {
  ios: {
    rewarded: 'ca-app-pub-6225795381877305/7530247097',
    banner:   'ca-app-pub-6225795381877305/9296737831',
  },
  android: {
    rewarded: 'ca-app-pub-6225795381877305/5184344841',
    banner:   'ca-app-pub-6225795381877305/2277920411',
  },
}

const TEST_REWARDED_ID = 'ca-app-pub-3940256099942544/1712485313'
const TEST_BANNER_ID   = 'ca-app-pub-3940256099942544/2934735716'

export const REWARDED_AD_UNIT_ID = __DEV__
  ? TEST_REWARDED_ID
  : (Platform.select({ ios: AD_UNIT_IDS.ios.rewarded, android: AD_UNIT_IDS.android.rewarded }) ?? TEST_REWARDED_ID)

export const BANNER_AD_UNIT_ID = __DEV__
  ? TEST_BANNER_ID
  : (Platform.select({ ios: AD_UNIT_IDS.ios.banner, android: AD_UNIT_IDS.android.banner }) ?? TEST_BANNER_ID)

// ── Expo Go 判定（ネイティブモジュール不在環境）─────────────────
let _isExpoGo = false
try {
  const Constants = require('expo-constants').default
  _isExpoGo = Constants?.appOwnership === 'expo'
    || Constants?.executionEnvironment === 'storeClient'
} catch {}

// ── ライブラリ安全取得 ────────────────────────────────────────
function getAdLib() {
  if (Platform.OS === 'web' || _isExpoGo) return null
  try { return require('react-native-google-mobile-ads') } catch { return null }
}

// 1本の広告表示結果:
//   'earned'    … 報酬獲得（最後まで視聴）
//   'no_ad'     … 広告が出せなかった（ロード失敗 / 在庫なし=no-fill / 表示前エラー）
//   'dismissed' … 広告は表示されたが報酬未獲得（途中で閉じた）
export type AdOutcome = 'earned' | 'no_ad' | 'dismissed'

// ── 先読み ─────────────────────────────────────────────────────
// 2026-10-07: 以前は「広告を見る」を押した瞬間に読み込みを始めていたため、読み込みが遅いと
// 15秒待たされ、在庫がないと何も起きないように見えた。モーダル/画面を開いた時点で先読みしておき、
// 押した瞬間に出す。先読み済みの広告は約1時間で失効するため、古いものは使わず読み直す。
const AD_TTL_MS = 50 * 60 * 1000
interface PreloadedReward { ad: any; loaded: boolean; loadedAt: number }
let _preloaded: PreloadedReward | null = null

function isUsable(p: PreloadedReward | null): p is PreloadedReward {
  return !!p && (!p.loaded || Date.now() - p.loadedAt < AD_TTL_MS)
}

/** 先読み済みのリワード広告を捨てる（ATTの結果が出る前に読んだ広告は広告識別子がないため） */
export function discardPreloadedRewardedAd(): void { _preloaded = null }

/** リワード広告を先読みする。読み込み中・読み込み済み(未失効)なら何もしない */
export function preloadRewardedAd(): void {
  const lib = getAdLib()
  if (!lib) return
  if (isUsable(_preloaded)) return
  try {
    const { RewardedAd, RewardedAdEventType, AdEventType } = lib
    const ad = RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID, adRequestOptions())
    const rec: PreloadedReward = { ad, loaded: false, loadedAt: 0 }
    _preloaded = rec
    const unsubLoaded = ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
      rec.loaded = true
      rec.loadedAt = Date.now()
      try { unsubLoaded(); unsubError() } catch {}
    })
    const unsubError = ad.addAdEventListener(AdEventType.ERROR, () => {
      try { unsubLoaded(); unsubError() } catch {}
      if (_preloaded === rec) _preloaded = null
    })
    ad.load()
  } catch {}
}

/** 先読みの広告を1本取り出す（取り出したら使い切り。未失効のものだけ） */
function takePreloaded(): PreloadedReward | null {
  const p = _preloaded
  _preloaded = null
  return isUsable(p) ? p : null
}

/** リワード広告を1本ロード＆表示し、結果を詳細に返す（先読み済みならすぐ出す） */
function showOneRewardedAdDetailed(): Promise<AdOutcome> {
  return new Promise((resolve) => {
    const lib = getAdLib()
    if (!lib) { resolve('no_ad'); return }

    // 他の広告（インタースティシャル/App Open）が表示中なら多重起動しない
    if (isAnyAdShowing()) { resolve('no_ad'); return }

    const { RewardedAd, RewardedAdEventType, AdEventType } = lib
    const taken = takePreloaded()
    const ad = taken ? taken.ad : RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID, adRequestOptions())

    let earnedReward = false
    let shown = false          // 広告が実際に表示されたか
    let settled = false
    let timer: ReturnType<typeof setTimeout>

    setAnyAdShowing(true)
    const cleanup = () => { try { unsubLoaded(); unsubEarned(); unsubClosed(); unsubError() } catch {}; setAnyAdShowing(false) }
    const done = (result: AdOutcome) => {
      if (!settled) { settled = true; clearTimeout(timer); cleanup(); resolve(result) }
    }

    // ロード待ちタイムアウト（表示前に出なければ no_ad → 上位でリトライ）
    timer = setTimeout(() => done('no_ad'), 15000)

    const present = () => {
      clearTimeout(timer)
      shown = true
      // 表示後のハングに備えた保険タイムアウト
      timer = setTimeout(() => done(earnedReward ? 'earned' : 'dismissed'), 90000)
      ad.show().catch(() => done('no_ad'))
    }
    const unsubLoaded = ad.addAdEventListener(RewardedAdEventType.LOADED, present)
    const unsubEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
      earnedReward = true
    })
    const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
      // EARNED_REWARD が CLOSED より後に届く取りこぼし対策として 600ms 待つ
      setTimeout(() => done(earnedReward ? 'earned' : 'dismissed'), 600)
    })
    const unsubError = ad.addAdEventListener(AdEventType.ERROR, () => {
      // 表示済みなら earnedReward を尊重、未表示ならロード失敗=no_ad
      done(earnedReward ? 'earned' : (shown ? 'dismissed' : 'no_ad'))
    })

    if (taken && taken.loaded) present()   // 先読み済み: すぐ表示
    else if (!taken) ad.load()             // 先読みなし: 今から読み込む（先読み中なら LOADED を待つだけ）
  })
}

/** no_ad（ロード失敗・在庫なし）の場合は最大3回までリトライ */
async function showOneWithRetry(): Promise<AdOutcome> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await showOneRewardedAdDetailed()
    if (r !== 'no_ad') return r
    await new Promise(res => setTimeout(res, 600))  // 在庫補充を少し待つ
  }
  return 'no_ad'
}

/** リワード広告を1本表示して、結果を詳しく返す（no_ad は3回までリトライ済み）。
 *  「広告が出せなかった」と「途中で閉じた」を画面側で区別して案内するために使う */
export async function watchOneRewardedAd(): Promise<AdOutcome> {
  return showOneWithRetry()
}

/** リワード広告を1本表示（後方互換: 報酬獲得で true） */
export async function showOneRewardedAd(): Promise<boolean> {
  return (await showOneWithRetry()) === 'earned'
}

/**
 * リワード広告を指定本数連続表示。
 * - 各本: 報酬獲得でカウント
 * - ユーザーが途中で閉じた(dismissed) → 報酬なし（false）
 * - 広告在庫が尽きた(no_ad) → 既に1本以上見ていれば「罠」を避けるため付与(true)、
 *   1本も見ていなければ false（広告自体が出せない状態）
 */
export async function watchAdsForReward(
  count = 3,
  onProgress?: (watched: number) => void,
): Promise<boolean> {
  let earned = 0
  for (let i = 0; i < count; i++) {
    const r = await showOneWithRetry()
    if (r === 'earned') { earned++; onProgress?.(earned); if (i < count - 1) preloadRewardedAd(); continue }
    if (r === 'dismissed') return false          // 自分の意思でスキップ → 付与しない
    // r === 'no_ad'（リトライしても在庫なし）
    if (earned >= 1) { onProgress?.(count); return true }  // 視聴済みを無駄にしない
    return false                                  // 広告が1本も出せない
  }
  return true
}

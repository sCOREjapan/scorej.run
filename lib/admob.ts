/**
 * admob.ts — Google AdMob ラッパー
 *
 * ネイティブ（iOS/Android）のみ動作。
 * Web / Expo Go では広告をスキップして成功扱いにする。
 *
 * 使い方:
 *   const ok = await showRewardedAd()
 *   if (ok) { await grantRewardUse(feature) }
 */

import { Platform } from 'react-native'

// AdMob 広告ユニットID
// ⚠️ リリース前に AdMob コンソール (https://admob.google.com) で取得した本番IDに差し替えること
const AD_UNIT_IDS = {
  rewarded: {
    ios:     __DEV__
      ? 'ca-app-pub-3940256099942544/1712485313'   // Googleテスト用ID (iOS)
      : 'ca-app-pub-6225795381877305/7530247097',   // ✅ 本番 iOS リワード
    android: __DEV__
      ? 'ca-app-pub-3940256099942544/5224354917'   // Googleテスト用ID (Android)
      : 'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX',   // ← Android 本番IDに差し替え（AdMobでAndroidアプリを別途登録）
  },
  banner: {
    ios:     __DEV__
      ? 'ca-app-pub-3940256099942544/2934735716'   // Googleテスト用ID (iOS)
      : 'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX',   // ← iOS バナー広告ユニットIDに差し替え
    android: __DEV__
      ? 'ca-app-pub-3940256099942544/6300978111'   // Googleテスト用ID (Android)
      : 'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX',   // ← Android バナー広告ユニットIDに差し替え
  },
}

// Web / Expo Go では module が存在しない → 動的 require でエラーを回避
function getAdmob() {
  if (Platform.OS === 'web') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-google-mobile-ads')
  } catch {
    return null
  }
}

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

/**
 * リワード広告を表示する。
 * @returns true = 動画を最後まで視聴した（報酬付与OK）
 *          false = キャンセル or エラー or 未対応環境
 */
export async function showRewardedAd(): Promise<boolean> {
  // Web / Expo Go は広告なしで成功扱い（開発時の動作確認用）
  if (Platform.OS === 'web') {
    if (__DEV__) {
      console.log('[admob] web: reward skipped (dev mode)')
      return true
    }
    return false
  }

  const lib = getAdmob()
  if (!lib) return false

  const unitId = Platform.OS === 'ios'
    ? AD_UNIT_IDS.rewarded.ios
    : AD_UNIT_IDS.rewarded.android

  try {
    const { RewardedAd, RewardedAdEventType, AdEventType } = lib

    const rewarded = RewardedAd.createForAdRequest(unitId, {
      requestNonPersonalizedAdsOnly: true,
    })

    return await new Promise<boolean>((resolve) => {
      let earned = false

      const unsubLoaded = rewarded.addAdEventListener(
        RewardedAdEventType.LOADED,
        () => { rewarded.show() }
      )
      const unsubEarned = rewarded.addAdEventListener(
        RewardedAdEventType.EARNED_REWARD,
        () => { earned = true }
      )
      const unsubClosed = rewarded.addAdEventListener(
        AdEventType.CLOSED,
        () => {
          unsubLoaded()
          unsubEarned()
          unsubClosed()
          unsubError()
          resolve(earned)
        }
      )
      const unsubError = rewarded.addAdEventListener(
        AdEventType.ERROR,
        (error: Error) => {
          console.warn('[admob] rewarded error:', error)
          unsubLoaded()
          unsubEarned()
          unsubClosed()
          unsubError()
          resolve(false)
        }
      )

      rewarded.load()
    })
  } catch (e) {
    console.warn('[admob] showRewardedAd exception:', e)
    return false
  }
}

/** バナー広告ユニットIDを返す（BannerAdコンポーネント用） */
export function getBannerUnitId(): string {
  if (Platform.OS === 'ios') return AD_UNIT_IDS.banner.ios
  return AD_UNIT_IDS.banner.android
}

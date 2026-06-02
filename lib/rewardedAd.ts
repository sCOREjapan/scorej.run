// lib/rewardedAd.ts — Google AdMob リワード広告
// react-native-google-mobile-ads は遅延ロード（Expo Go / シミュレーターで crash しないよう）
import { Platform } from 'react-native'

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

// ── ライブラリ安全取得 ────────────────────────────────────────
function getAdLib() {
  if (Platform.OS === 'web') return null
  try { return require('react-native-google-mobile-ads') } catch { return null }
}

/**
 * リワード広告を1本ロード＆表示
 */
export function showOneRewardedAd(): Promise<boolean> {
  return new Promise((resolve) => {
    const lib = getAdLib()
    if (!lib) { resolve(false); return }

    const { RewardedAd, RewardedAdEventType, AdEventType } = lib
    const ad = RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID, {
      requestNonPersonalizedAdsOnly: false,
    })

    let earnedReward = false
    let settled = false
    let timer: ReturnType<typeof setTimeout>

    const done = (result: boolean) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(result) }
    }

    timer = setTimeout(() => done(false), 15000)

    const unsubLoaded = ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
      clearTimeout(timer)
      timer = setTimeout(() => done(false), 90000)
      ad.show().catch(() => done(false))
    })
    const unsubEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
      earnedReward = true
    })
    const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
      try { unsubLoaded(); unsubEarned(); unsubClosed(); unsubError() } catch {}
      // EARNED_REWARD が CLOSED より後に来る場合があるため少し待つ
      setTimeout(() => done(earnedReward), 50)
    })
    const unsubError = ad.addAdEventListener(AdEventType.ERROR, () => {
      try { unsubLoaded(); unsubEarned(); unsubClosed(); unsubError() } catch {}
      done(false)
    })

    ad.load()
  })
}

/**
 * リワード広告を指定本数連続表示
 */
export async function watchAdsForReward(
  count = 3,
  onProgress?: (watched: number) => void,
): Promise<boolean> {
  for (let i = 0; i < count; i++) {
    const watched = await showOneRewardedAd()
    if (!watched) return false
    onProgress?.(i + 1)
  }
  return true
}

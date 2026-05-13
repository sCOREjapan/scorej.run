// lib/rewardedAd.ts — Google AdMob リワード広告
import { Platform } from 'react-native'
import { RewardedAd, RewardedAdEventType, AdEventType, TestIds } from 'react-native-google-mobile-ads'

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

export const REWARDED_AD_UNIT_ID = __DEV__
  ? TestIds.REWARDED
  : (Platform.select({
      ios:     AD_UNIT_IDS.ios.rewarded,
      android: AD_UNIT_IDS.android.rewarded,
    }) ?? TestIds.REWARDED)

export const BANNER_AD_UNIT_ID = __DEV__
  ? TestIds.BANNER
  : (Platform.select({
      ios:     AD_UNIT_IDS.ios.banner,
      android: AD_UNIT_IDS.android.banner,
    }) ?? TestIds.BANNER)

/**
 * リワード広告を1本ロード＆表示
 * @returns true = 最後まで視聴完了 / false = 途中終了 or エラー
 */
export function showOneRewardedAd(): Promise<boolean> {
  return new Promise((resolve) => {
    const ad = RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID, {
      requestNonPersonalizedAdsOnly: false,
    })

    let settled = false
    const done = (result: boolean) => {
      if (!settled) { settled = true; resolve(result) }
    }

    ad.addAdEventListener(RewardedAdEventType.LOADED,        () => { ad.show().catch(() => done(false)) })
    ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => done(true))
    ad.addAdEventListener(AdEventType.CLOSED,                () => done(false))
    ad.addAdEventListener(AdEventType.ERROR,                 () => done(false))

    ad.load()
  })
}

/**
 * リワード広告を指定本数連続表示し、全部視聴したか返す
 * @param count    必要な視聴本数（デフォルト3）
 * @param onProgress 各本完了後に呼ばれる (watched / total)
 */
export async function watchAdsForReward(
  count = 3,
  onProgress?: (watched: number, total: number) => void,
): Promise<boolean> {
  for (let i = 0; i < count; i++) {
    const watched = await showOneRewardedAd()
    if (!watched) return false          // 途中離脱 → 失敗
    onProgress?.(i + 1, count)
  }
  return true
}

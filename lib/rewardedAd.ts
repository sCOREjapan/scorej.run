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

// DEV → テストID、PROD → 本番ID
export const REWARDED_AD_UNIT_ID = __DEV__
  ? TestIds.REWARDED
  : (Platform.select({ ios: AD_UNIT_IDS.ios.rewarded, android: AD_UNIT_IDS.android.rewarded }) ?? TestIds.REWARDED)

export const BANNER_AD_UNIT_ID = __DEV__
  ? TestIds.BANNER
  : (Platform.select({ ios: AD_UNIT_IDS.ios.banner, android: AD_UNIT_IDS.android.banner }) ?? TestIds.BANNER)

/**
 * リワード広告を1本ロード＆表示
 * @returns true = 最後まで視聴完了 / false = 途中終了 or エラー
 */
export function showOneRewardedAd(): Promise<boolean> {
  return new Promise((resolve) => {
    const ad = RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID, {
      requestNonPersonalizedAdsOnly: false,
    })

    // EARNED_REWARD は CLOSED より前に来ることもあるのでフラグで管理
    let earnedReward = false
    let settled = false
    const done = (result: boolean) => {
      if (!settled) { settled = true; resolve(result) }
    }

    ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
      ad.show().catch(() => done(false))
    })
    // リワード獲得（最後まで視聴） → フラグを立てるだけ
    ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
      earnedReward = true
    })
    // 広告が閉じられたタイミングで結果を確定（EARNED_REWARDより必ず後に呼ばれる）
    ad.addAdEventListener(AdEventType.CLOSED, () => {
      done(earnedReward)
    })
    // 読み込みエラー or 表示エラー → 失敗
    ad.addAdEventListener(AdEventType.ERROR, () => {
      done(false)
    })

    ad.load()
  })
}

/**
 * リワード広告を指定本数連続表示し、全部視聴したか返す
 * @param count      必要な視聴本数（デフォルト3）
 * @param onProgress 各本完了後に呼ばれる (watched)
 */
export async function watchAdsForReward(
  count = 3,
  onProgress?: (watched: number) => void,
): Promise<boolean> {
  for (let i = 0; i < count; i++) {
    const watched = await showOneRewardedAd()
    if (!watched) return false   // 途中離脱 → 失敗
    onProgress?.(i + 1)
  }
  return true
}

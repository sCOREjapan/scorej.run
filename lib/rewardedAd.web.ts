// lib/rewardedAd.web.ts — Web stub (react-native-google-mobile-ads is native-only)
// Expo automatically resolves .web.ts over .ts for web builds,
// so this file prevents native AdMob imports from breaking the Vercel build.

export const AD_UNIT_IDS = {
  ios:     { rewarded: '', banner: '' },
  android: { rewarded: '', banner: '' },
}

export const REWARDED_AD_UNIT_ID = ''
export const BANNER_AD_UNIT_ID   = ''

export type AdOutcome = 'earned' | 'no_ad' | 'dismissed'

export function preloadRewardedAd(): void {}
export function discardPreloadedRewardedAd(): void {}
export async function watchOneRewardedAd(): Promise<AdOutcome> { return 'no_ad' }

export function showOneRewardedAd(): Promise<boolean> {
  return Promise.resolve(false)
}

export async function watchAdsForReward(
  count = 3,
  onProgress?: (watched: number) => void,
): Promise<boolean> {
  return false
}

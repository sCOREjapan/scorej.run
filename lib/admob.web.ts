/**
 * admob.web.ts — Web スタブ
 * Web では広告は一切表示しない。全関数はno-op / false を返す。
 */

export async function shouldShowInterstitial(): Promise<boolean> { return false }
export async function initAdmob(): Promise<void> {}
export async function showRewardedAd(): Promise<boolean> { return true }  // web開発時は成功扱い
export async function showInterstitialAd(): Promise<boolean> { return false }
export function getBannerUnitId(): string { return '' }

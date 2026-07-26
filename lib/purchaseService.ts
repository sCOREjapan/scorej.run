// lib/purchaseService.ts — Web スタブ（Metro が web ビルド時に使用）
// Native ビルドでは purchaseService.native.ts が自動的に使われる

export const ENTITLEMENT_NOAD  = 'noad'
export const ENTITLEMENT_COACH = 'coach'

// App Store Connect で作成するプロダクト ID（2件）
export const PRODUCT_IDS = {
  noad_monthly:   'score_noad_monthly_v2',   // ¥980/月  広告なしプラン
  coach_monthly:  'score_coach_monthly_v2',  // ¥1,980/月 コーチプラン
}

export type PlanTier = 'free' | 'noad' | 'coach'

export async function initPurchases(_userId?: string): Promise<void> {}

export async function getPremiumStatus(): Promise<{ tier: PlanTier; expiresAt?: string }> {
  return { tier: 'free' }
}

export async function getPackages(): Promise<any[]> {
  return []
}

export function getLastPackagesDiagnostic(): string | null {
  return null
}

export async function purchasePackage(_pkg: any): Promise<PlanTier | false> {
  return false
}

export async function restoreAndCheck(): Promise<PlanTier | false> {
  return false
}

export async function logOutPurchases(): Promise<void> {}

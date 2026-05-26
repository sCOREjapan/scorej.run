// lib/purchaseService.ts — Web スタブ（Metro が web ビルド時に使用）
// Native ビルドでは purchaseService.native.ts が自動的に使われる

export const ENTITLEMENT_PRO       = 'pro'
export const ENTITLEMENT_ELITE     = 'elite'
export const ENTITLEMENT_COACH     = 'coach'
export const ENTITLEMENT_COACH_PRO = 'coach_pro'

// App Store Connect で作成するプロダクト ID
export const PRODUCT_IDS = {
  pro_monthly:        'score_pro_monthly',        // ¥480/月
  pro_annual:         'score_pro_annual',         // ¥4,800/年
  elite_monthly:      'score_elite_monthly',      // ¥980/月
  elite_annual:       'score_elite_annual',       // ¥8,820/年
  coach_monthly:      'score_coach_monthly',      // ¥2,980/月
  coach_annual:       'score_coach_annual',       // ¥29,800/年
  coach_pro_monthly:  'score_coach_pro_monthly',  // ¥4,980/月
  coach_pro_annual:   'score_coach_pro_annual',   // ¥49,800/年
}

export type PlanTier = 'free' | 'pro' | 'elite' | 'coach' | 'coach_pro'

export async function initPurchases(_userId?: string): Promise<void> {}

export async function getPremiumStatus(): Promise<{ tier: PlanTier; expiresAt?: string }> {
  return { tier: 'free' }
}

export async function getPackages(): Promise<any[]> {
  return []
}

export async function purchasePackage(_pkg: any): Promise<PlanTier | false> {
  return false
}

export async function restoreAndCheck(): Promise<PlanTier | false> {
  return false
}

export async function logOutPurchases(): Promise<void> {}

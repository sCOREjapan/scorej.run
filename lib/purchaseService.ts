// lib/purchaseService.ts — Web スタブ（Metro が web ビルド時に使用）
// Native ビルドでは purchaseService.native.ts が自動的に使われる

export const ENTITLEMENT_NOAD           = 'noad'
export const ENTITLEMENT_COACH          = 'coach'
export const ENTITLEMENT_TICKET_MONTHLY = 'ticket_monthly'

// App Store Connect で作成するプロダクト ID
export const PRODUCT_IDS = {
  noad_monthly:   'score_noad_monthly_v2',    // ¥480/月    広告なしプラン
  noad_yearly:    'score_noad_yearly_v2',      // ¥4,800/年
  coach_monthly:  'score_coach_monthly_v2',    // ¥1,980/月  コーチプラン
  coach_yearly:   'score_coach_yearly_v1',     // ¥19,800/年
  ticket_monthly: 'score_ticket_monthly_v1',   // ¥980/月  チケット月額（広告なし＋毎月チケット100枚）
  tickets_light:  'score_tickets_15_v1',       // ¥370  チケット15枚（消耗型）
  tickets_value:  'score_tickets_50_v1',       // ¥730  チケット50枚（消耗型）
}

// 消耗型チケットプロダクト → 付与枚数
export const TICKET_PACK_COUNTS: Record<string, number> = {
  [PRODUCT_IDS.tickets_light]: 15,
  [PRODUCT_IDS.tickets_value]: 50,
}

// チケット月額プランで毎月付与されるチケット枚数
export const TICKET_MONTHLY_GRANT = 100

export type PlanTier = 'free' | 'noad' | 'coach'

export type PremiumStatus = {
  tier: PlanTier
  expiresAt?: string
  originalPurchaseDate?: string
  hasTicketMonthly: boolean
  ticketMonthlyExpiresAt?: string
  ticketMonthlyIsTrial?: boolean
}

export type PurchaseResult = { tier: PlanTier; hasTicketMonthly: boolean } | false

export async function initPurchases(_userId?: string): Promise<void> {}

export async function getPremiumStatus(): Promise<PremiumStatus> {
  return { tier: 'free', hasTicketMonthly: false }
}

export async function getPackages(): Promise<any[]> {
  return []
}

export function getLastPackagesDiagnostic(): string | null {
  return null
}

export async function purchasePackage(_pkg: any): Promise<PurchaseResult> {
  return false
}

/** 消耗型チケットパックの購入。成功時は付与すべき枚数を返す */
export async function purchaseConsumable(_pkg: any): Promise<number | false> {
  return false
}

export async function restoreAndCheck(): Promise<PurchaseResult> {
  return false
}

export async function logOutPurchases(): Promise<void> {}

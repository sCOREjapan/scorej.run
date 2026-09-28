// lib/purchaseService.ts — Web スタブ（Metro が web ビルド時に使用）
// Native ビルドでは purchaseService.native.ts が自動的に使われる

export const ENTITLEMENT_NOAD           = 'noad'
export const ENTITLEMENT_COACH          = 'coach'
export const ENTITLEMENT_TICKET_MONTHLY = 'ticket_monthly'

// App Store Connect で作成するプロダクト ID
export const PRODUCT_IDS = {
  noad_monthly:   'score_noad_monthly_v2',    // ¥480/月    広告なしプラン
  noad_yearly:    'score_noad_yearly_v2',      // ¥4,800/年
  coach_monthly:  'score_coach_monthly_v2',    // ¥1,980/月  コーチプラン(〜15人)
  coach_yearly:   'score_coach_yearly_v1',     // ¥19,800/年
  // lib/purchaseService.native.tsの同名エントリと同じ説明を参照（Webスタブなので実際には未使用）
  coach_monthly_30:        'score_coach_monthly_30_v1',        // ¥2,980/月  コーチプラン(〜30人)
  coach_monthly_unlimited: 'score_coach_monthly_unlimited_v1', // ¥4,980/月  コーチプラン(無制限)
  ticket_monthly: 'score_ticket_monthly_v1',   // ¥980/月  チケット月額（広告なし＋毎月チケット100枚）
  // lib/purchaseService.native.tsの同名エントリと同じ説明を参照（Webスタブなので実際には未使用）
  ticket_monthly_sale: 'score_ticket_monthly_sale_v1', // ¥680/月 チケット月額(3日間ミッション限定オファー)
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

// 2026-09-25: app/paywall.tsxにあった無料体験日数の算出ロジックを、
// app/mission-offer.tsxからも同じ基準で使えるよう共有化した。
// StoreKit/Play Consoleの導入価格(Introductory Offer、price=0)から日数を読み取る。
export function trialDaysFromPackage(pkg: any): number | null {
  const intro = pkg?.product?.introPrice
  if (!intro || intro.price !== 0) return null
  const n = intro.periodNumberOfUnits ?? 1
  switch (intro.periodUnit) {
    case 'DAY':   return n
    case 'WEEK':  return n * 7
    case 'MONTH': return n * 30
    case 'YEAR':  return n * 365
    default:      return null
  }
}

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

// 2026-09-21: Web版にはRevenueCat SDKの実体が無いため常にtier:'free'固定だったが、
// これによりapi/redeem-team-code.tsで実際にコーチ権限を付与しても、Web版だけは
// 反映されず永久にコーチ設定画面へ弾き返されるバグがあった(実ユーザーで再現確認済み)。
// api/check-coach-status.tsでサーバー側からRevenueCatの実権限を確認する
// (Secret keyはクライアントに出せないため必ずサーバー経由)。
export async function getPremiumStatus(): Promise<PremiumStatus> {
  const FREE: PremiumStatus = { tier: 'free', hasTicketMonthly: false }
  try {
    const { getAiAuthHeader } = await import('./supabase')
    const authHeader = await getAiAuthHeader()
    if (!authHeader.Authorization) return FREE // ゲストは問い合わせ不要
    const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
    const res = await fetch(`${API_BASE_URL}/api/check-coach-status`, { headers: authHeader })
    if (!res.ok) return FREE
    const json = await res.json()
    if (!json?.isCoach) return FREE
    return { tier: 'coach', hasTicketMonthly: false, expiresAt: json?.expiresAt }
  } catch {
    return FREE
  }
}

export async function getPackages(): Promise<any[]> {
  // 2026-09-07: Web版にはStoreKit/RevenueCatの実体が無いため常に空配列だったが、
  // それだとpaywall.tsxが即座に「商品の読み込みに失敗しました」を出してしまい、
  // 開発中にWebプレビューで購入導線のUIを確認できなかった。__DEV__時だけ、
  // 実購入はできないダミーパッケージを返し、[DEV] 購入をスキップ（開発用）まで
  // 到達できるようにする（本番ビルドでは__DEV__=falseなのでこれまで通り空配列）。
  if (!__DEV__) return []
  return Object.values(PRODUCT_IDS).map(identifier => ({
    product: { identifier, introPrice: null },
  }))
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

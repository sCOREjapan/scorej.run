// lib/purchaseService.native.ts — RevenueCat ネイティブ実装
// Metro は iOS/Android ビルド時にこちらを使用する

import Purchases, { LOG_LEVEL, type PurchasesPackage } from 'react-native-purchases'
import { Platform } from 'react-native'

export const ENTITLEMENT_NOAD           = 'noad'
export const ENTITLEMENT_COACH          = 'coach'
export const ENTITLEMENT_TICKET_MONTHLY = 'ticket_monthly'

export const PRODUCT_IDS = {
  noad_monthly:   'score_noad_monthly_v2',    // ¥480/月    広告なしプラン
  noad_yearly:    'score_noad_yearly_v2',      // ¥4,800/年
  coach_monthly:  'score_coach_monthly_v2',    // ¥1,980/月  コーチプラン
  coach_yearly:   'score_coach_yearly_v1',     // ¥19,800/年
  ticket_monthly: 'score_ticket_monthly_v1',   // ¥980/月  チケット月額（広告なし＋毎月チケット100枚）
  tickets_light:  'score_tickets_15_v1',       // ¥370  チケット15枚（消耗型）
  tickets_value:  'score_tickets_50_v1',       // ¥730  チケット50枚（消耗型）
}
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
}

export type PurchaseResult = { tier: PlanTier; hasTicketMonthly: boolean } | false

const RC_IOS_KEY     = 'appl_iBIPuhRoGelxcbQXFMKglAFPyMs'
const RC_ANDROID_KEY = 'goog_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'

const ENT_NOAD           = 'noad'
const ENT_COACH          = 'coach'
const ENT_TICKET_MONTHLY = 'ticket_monthly'

// coach > noad > free（基本tier）。ticket_monthly はどのtierとも独立に併存できるので別扱い。
function resolveTier(entitlements: { active: Record<string, { expirationDate?: string | null; originalPurchaseDate?: string | null }> }): PremiumStatus {
  const coach         = entitlements.active[ENT_COACH]
  const noad          = entitlements.active[ENT_NOAD]
  const ticketMonthly = entitlements.active[ENT_TICKET_MONTHLY]

  let tier: PlanTier = 'free'
  let expiresAt: string | undefined
  let originalPurchaseDate: string | undefined
  if (coach) {
    tier = 'coach'; expiresAt = coach.expirationDate ?? undefined; originalPurchaseDate = coach.originalPurchaseDate ?? undefined
  } else if (noad) {
    tier = 'noad'; expiresAt = noad.expirationDate ?? undefined; originalPurchaseDate = noad.originalPurchaseDate ?? undefined
  }

  return {
    tier, expiresAt, originalPurchaseDate,
    hasTicketMonthly: !!ticketMonthly,
    ticketMonthlyExpiresAt: ticketMonthly?.expirationDate ?? undefined,
  }
}

// ── 初期化 ──────────────────────────────────────────────────────────
// PurchaseContext（認証状態の変化時）と各画面（paywall.tsx等のマウント時）の両方が
// 独立に initPurchases() を呼べる作りのため、ほぼ同時に呼ばれると Purchases.configure()
// が完了する前に別の呼び出しが getOfferings()/getCustomerInfo() を叩いてしまい
// 「There is no singleton instance」で失敗することがあった（App Storeレビューで報告された
// 「商品の読み込みができない」不具合の原因）。configure/logIn を直列化して防ぐ。
let _initChain: Promise<void> = Promise.resolve()
let _configured = false

export async function initPurchases(userId?: string): Promise<void> {
  _initChain = _initChain.then(async () => {
    try {
      if (!_configured) {
        const apiKey = Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY
        Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN)
        // isConfigured() は Promise<boolean> を返すため await が必須。
        // 同期的に `if (!Purchases.isConfigured())` と書くと Promise は常に truthy になり
        // configure() が一度も呼ばれないまま getOfferings 等が失敗し続けるバグがあった。
        const alreadyConfigured = await Purchases.isConfigured()
        if (!alreadyConfigured) {
          Purchases.configure({ apiKey })
        }
        _configured = true
      }
      if (userId) {
        try { await Purchases.logIn(userId) } catch {}
      }
    } catch (e) {
      console.warn('[RevenueCat] initPurchases failed (non-fatal):', e)
    }
  })
  await _initChain
}

// ── プラン状態を取得 ─────────────────────────────────────────────
export async function getPremiumStatus(): Promise<PremiumStatus> {
  try {
    const info = await Purchases.getCustomerInfo()
    return resolveTier(info.entitlements as any)
  } catch {
    return { tier: 'free', hasTicketMonthly: false }
  }
}

// ── 診断情報（画面上に直接表示するため、Xcodeコンソールが見れない環境でも原因を確認できるようにする） ──
let _lastDiagnostic: string | null = null
export function getLastPackagesDiagnostic(): string | null {
  return _lastDiagnostic
}

// ── 購入可能パッケージ一覧 ──────────────────────────────────────
export async function getPackages(): Promise<PurchasesPackage[]> {
  try {
    const offerings = await Purchases.getOfferings()
    const pkgs = offerings.current?.availablePackages ?? []
    if (pkgs.length === 0) {
      // RevenueCat自体は成功しているが、商品が0件の場合の原因切り分け用。
      // Apple側で商品がまだ「販売可能」状態になっていない（初回サブスクリプション審査待ち等）と
      // ここが常に空になるため、実機・TestFlightで購入できない時はまずこの内容を確認する。
      const currentId = offerings.current ? `id=${offerings.current.identifier}` : 'null（Current Offeringが未設定）'
      const allIds = Object.keys(offerings.all ?? {}).join(',') || 'なし'
      _lastDiagnostic = `offerings.current=${currentId} / all=[${allIds}]`
      console.warn('[RevenueCat] availablePackages が0件です。', _lastDiagnostic)
    } else {
      _lastDiagnostic = null
    }
    return pkgs
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    _lastDiagnostic = `getOfferings失敗: ${msg}`
    console.warn('[RevenueCat] getOfferings failed:', e)
    return []
  }
}

// ── 購入 ─────────────────────────────────────────────────────────
// tier(noad/coach)を持つサブスクだけでなく、ticket_monthly（tierとは独立したエンタイトルメント）
// 単体の購入も「成功」として扱う必要があるため、tierがfreeのままでも hasTicketMonthly を見て判定する。
export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseResult> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg)
    const resolved = resolveTier(customerInfo.entitlements as any)
    if (resolved.tier === 'free' && !resolved.hasTicketMonthly) return false
    return { tier: resolved.tier, hasTicketMonthly: resolved.hasTicketMonthly }
  } catch (e: any) {
    if (e?.userCancelled) return false
    throw e
  }
}

// ── 消耗型チケットパックの購入 ───────────────────────────────────
// エンタイトルメントを持たないため、購入成功時のプロダクトIDから付与枚数を引いて返す。
export async function purchaseConsumable(pkg: PurchasesPackage): Promise<number | false> {
  try {
    await Purchases.purchasePackage(pkg)
    const productId = pkg.product?.identifier
    return TICKET_PACK_COUNTS[productId] ?? false
  } catch (e: any) {
    if (e?.userCancelled) return false
    throw e
  }
}

// ── 復元 ─────────────────────────────────────────────────────────
export async function restoreAndCheck(): Promise<PurchaseResult> {
  try {
    const info = await Purchases.restorePurchases()
    const resolved = resolveTier(info.entitlements as any)
    if (resolved.tier === 'free' && !resolved.hasTicketMonthly) return false
    return { tier: resolved.tier, hasTicketMonthly: resolved.hasTicketMonthly }
  } catch {
    return false
  }
}

// ── ログアウト ────────────────────────────────────────────────────
export async function logOutPurchases(): Promise<void> {
  try { await Purchases.logOut() } catch {}
}

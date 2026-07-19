// lib/purchaseService.native.ts — RevenueCat ネイティブ実装
// Metro は iOS/Android ビルド時にこちらを使用する

import Purchases, { LOG_LEVEL, type PurchasesPackage } from 'react-native-purchases'
import { Platform } from 'react-native'

export const ENTITLEMENT_NOAD  = 'noad'
export const ENTITLEMENT_COACH = 'coach'
export const PRODUCT_IDS = {
  noad_monthly:   'score_noad_monthly_v2',   // ¥980/月
  coach_monthly:  'score_coach_monthly_v2',  // ¥2,980/月
}
export type PlanTier = 'free' | 'noad' | 'coach'

const RC_IOS_KEY     = 'appl_iBIPuhRoGelxcbQXFMKglAFPyMs'
const RC_ANDROID_KEY = 'goog_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'

const ENT_NOAD  = 'noad'
const ENT_COACH = 'coach'

// ── 初期化 ──────────────────────────────────────────────────────────
export async function initPurchases(userId?: string): Promise<void> {
  try {
    const apiKey = Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY
    Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN)
    // isConfigured() は Promise<boolean> を返すため await が必須。
    // 同期的に `if (!Purchases.isConfigured())` と書くと Promise は常に truthy になり
    // configure() が一度も呼ばれないまま getOfferings 等が失敗し続けるバグがあった。
    const alreadyConfigured = await Purchases.isConfigured()
    if (!alreadyConfigured) {
      Purchases.configure({ apiKey })
    }
    if (userId) {
      try { await Purchases.logIn(userId) } catch {}
    }
  } catch (e) {
    console.warn('[RevenueCat] initPurchases failed (non-fatal):', e)
  }
}

// ── プラン状態を取得 ─────────────────────────────────────────────
export async function getPremiumStatus(): Promise<{ tier: PlanTier; expiresAt?: string }> {
  try {
    const info  = await Purchases.getCustomerInfo()
    const coach = info.entitlements.active[ENT_COACH]
    const noad  = info.entitlements.active[ENT_NOAD]
    // coach > noad > free
    if (coach) return { tier: 'coach', expiresAt: coach.expirationDate ?? undefined }
    if (noad)  return { tier: 'noad',  expiresAt: noad.expirationDate  ?? undefined }
    return { tier: 'free' }
  } catch {
    return { tier: 'free' }
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
export async function purchasePackage(pkg: PurchasesPackage): Promise<PlanTier | false> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg)
    if (customerInfo.entitlements.active[ENT_COACH]) return 'coach'
    if (customerInfo.entitlements.active[ENT_NOAD])  return 'noad'
    return false
  } catch (e: any) {
    if (e?.userCancelled) return false
    throw e
  }
}

// ── 復元 ─────────────────────────────────────────────────────────
export async function restoreAndCheck(): Promise<PlanTier | false> {
  try {
    const info = await Purchases.restorePurchases()
    if (info.entitlements.active[ENT_COACH]) return 'coach'
    if (info.entitlements.active[ENT_NOAD])  return 'noad'
    return false
  } catch {
    return false
  }
}

// ── ログアウト ────────────────────────────────────────────────────
export async function logOutPurchases(): Promise<void> {
  try { await Purchases.logOut() } catch {}
}

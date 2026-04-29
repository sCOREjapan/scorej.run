// lib/purchaseService.native.ts — RevenueCat ネイティブ実装
// Metro は iOS/Android ビルド時にこちらを使用する

import Purchases, { LOG_LEVEL, type PurchasesPackage } from 'react-native-purchases'
import { Platform } from 'react-native'
import type { PlanTier } from './purchaseService'

export { ENTITLEMENT_PRO, ENTITLEMENT_ELITE, PRODUCT_IDS } from './purchaseService'
export type { PlanTier }

// ── RevenueCat API キー ─────────────────────────────────────────────
// RevenueCat ダッシュボード → Projects → API Keys で取得して差し替え
const RC_IOS_KEY     = 'appl_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'  // ← 要置換
const RC_ANDROID_KEY = 'goog_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'  // ← 要置換

const ENT_PRO   = 'pro'
const ENT_ELITE = 'elite'

// ── 初期化 ──────────────────────────────────────────────────────────
export async function initPurchases(userId?: string): Promise<void> {
  const apiKey = Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY
  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN)
  await Purchases.configure({ apiKey })
  if (userId) {
    try { await Purchases.logIn(userId) } catch {}
  }
}

// ── プラン状態を取得 ─────────────────────────────────────────────
export async function getPremiumStatus(): Promise<{ tier: PlanTier; expiresAt?: string }> {
  try {
    const info  = await Purchases.getCustomerInfo()
    const elite = info.entitlements.active[ENT_ELITE]
    const pro   = info.entitlements.active[ENT_PRO]

    if (elite) return { tier: 'elite', expiresAt: elite.expirationDate ?? undefined }
    if (pro)   return { tier: 'pro',   expiresAt: pro.expirationDate   ?? undefined }
    return { tier: 'free' }
  } catch {
    return { tier: 'free' }
  }
}

// ── 購入可能パッケージ一覧 ──────────────────────────────────────
export async function getPackages(): Promise<PurchasesPackage[]> {
  try {
    const offerings = await Purchases.getOfferings()
    return offerings.current?.availablePackages ?? []
  } catch {
    return []
  }
}

// ── 購入 ─────────────────────────────────────────────────────────
export async function purchasePackage(pkg: PurchasesPackage): Promise<PlanTier | false> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg)
    if (customerInfo.entitlements.active[ENT_ELITE]) return 'elite'
    if (customerInfo.entitlements.active[ENT_PRO])   return 'pro'
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
    if (info.entitlements.active[ENT_ELITE]) return 'elite'
    if (info.entitlements.active[ENT_PRO])   return 'pro'
    return false
  } catch {
    return false
  }
}

// ── ログアウト ────────────────────────────────────────────────────
export async function logOutPurchases(): Promise<void> {
  try { await Purchases.logOut() } catch {}
}

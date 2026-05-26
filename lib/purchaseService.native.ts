// lib/purchaseService.native.ts — RevenueCat ネイティブ実装
// Metro は iOS/Android ビルド時にこちらを使用する

import Purchases, { LOG_LEVEL, type PurchasesPackage } from 'react-native-purchases'
import { Platform } from 'react-native'
// 定数を直接定義（./purchaseService への再エクスポートは循環インポートになるため）
export const ENTITLEMENT_PRO       = 'pro'
export const ENTITLEMENT_ELITE     = 'elite'
export const ENTITLEMENT_COACH     = 'coach'
export const ENTITLEMENT_COACH_PRO = 'coach_pro'
export const PRODUCT_IDS = {
  pro_monthly:        'score_pro_monthly',
  pro_annual:         'score_pro_annual',
  elite_monthly:      'score_elite_monthly',
  elite_annual:       'score_elite_annual',
  coach_monthly:      'score_coach_monthly',
  coach_annual:       'score_coach_annual',
  coach_pro_monthly:  'score_coach_pro_monthly',
  coach_pro_annual:   'score_coach_pro_annual',
}
export type PlanTier = 'free' | 'pro' | 'elite' | 'coach' | 'coach_pro'

// ── RevenueCat API キー ─────────────────────────────────────────────
// RevenueCat ダッシュボード → Projects → API Keys で取得して差し替え
const RC_IOS_KEY     = 'appl_iBIPuhRoGelxcbQXFMKglAFPyMs'  // ✅ RevenueCat iOS 本番キー
const RC_ANDROID_KEY = 'goog_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'  // ← Android用（後で設定）

const ENT_PRO       = 'pro'
const ENT_ELITE     = 'elite'
const ENT_COACH     = 'coach'
const ENT_COACH_PRO = 'coach_pro'

// ── 初期化 ──────────────────────────────────────────────────────────
export async function initPurchases(userId?: string): Promise<void> {
  try {
    const apiKey = Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY
    Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN)
    // 二重 configure を防ぐ（2回目の呼び出しは logIn のみ実行）
    if (!Purchases.isConfigured()) {
      Purchases.configure({ apiKey })
    }
    if (userId) {
      try { await Purchases.logIn(userId) } catch {}
    }
  } catch (e) {
    // RevenueCat 初期化失敗は非致命的エラー（アプリ起動はブロックしない）
    console.warn('[RevenueCat] initPurchases failed (non-fatal):', e)
  }
}

// ── プラン状態を取得 ─────────────────────────────────────────────
export async function getPremiumStatus(): Promise<{ tier: PlanTier; expiresAt?: string }> {
  try {
    const info  = await Purchases.getCustomerInfo()
    const coach_pro = info.entitlements.active[ENT_COACH_PRO]
    const elite     = info.entitlements.active[ENT_ELITE]
    const pro       = info.entitlements.active[ENT_PRO]
    const coach     = info.entitlements.active[ENT_COACH]

    if (coach_pro) return { tier: 'coach_pro', expiresAt: coach_pro.expirationDate ?? undefined }
    if (elite)     return { tier: 'elite',     expiresAt: elite.expirationDate     ?? undefined }
    if (pro)       return { tier: 'pro',       expiresAt: pro.expirationDate       ?? undefined }
    if (coach)     return { tier: 'coach',     expiresAt: coach.expirationDate     ?? undefined }
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
    if (customerInfo.entitlements.active[ENT_COACH_PRO]) return 'coach_pro'
    if (customerInfo.entitlements.active[ENT_ELITE])     return 'elite'
    if (customerInfo.entitlements.active[ENT_PRO])       return 'pro'
    if (customerInfo.entitlements.active[ENT_COACH])     return 'coach'
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
    if (info.entitlements.active[ENT_COACH_PRO]) return 'coach_pro'
    if (info.entitlements.active[ENT_ELITE])     return 'elite'
    if (info.entitlements.active[ENT_PRO])       return 'pro'
    if (info.entitlements.active[ENT_COACH])     return 'coach'
    return false
  } catch {
    return false
  }
}

// ── ログアウト ────────────────────────────────────────────────────
export async function logOutPurchases(): Promise<void> {
  try { await Purchases.logOut() } catch {}
}

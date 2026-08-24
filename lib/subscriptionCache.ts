// lib/subscriptionCache.ts — 購入プランのローカルキャッシュ（PurchaseContext / adGate 共通）
//
// RevenueCat の検証結果をローカルにキャッシュしておき、アプリ起動直後や
// PurchaseContext の外（adGate.ts）からも「現在のプラン」を即座に参照できるようにする。
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { PlanTier } from './purchaseService'

export const SUB_CACHE_KEY = 'trackmate_subscription'

type CachedSubscription = {
  isPremium: boolean
  plan: PlanTier
  expiresAt?: string
  originalPurchaseDate?: string
  hasTicketMonthly?: boolean
  ticketMonthlyExpiresAt?: string
}

export async function cacheSubscriptionStatus(
  tier: PlanTier,
  expiresAt?: string,
  originalPurchaseDate?: string,
  hasTicketMonthly?: boolean,
  ticketMonthlyExpiresAt?: string,
): Promise<void> {
  await AsyncStorage.setItem(SUB_CACHE_KEY, JSON.stringify({
    isPremium: tier !== 'free',
    plan: tier,
    expiresAt,
    originalPurchaseDate,
    hasTicketMonthly,
    ticketMonthlyExpiresAt,
  } satisfies CachedSubscription)).catch(() => {})
}

/**
 * キャッシュされたプランを返す。
 * expiresAt はRevenueCatのプロモーション付与・生涯购入等では null になることがあり、
 * 「無い＝即free扱い」にすると本来有効な課金ユーザーを誤ってfree判定してしまう
 * （2026-08: 広告なしプラン加入者が無料枠扱いされる不具合の原因だった）。
 * expiresAt が実際に取得できていて、かつ過去日付の場合のみ失効とみなす。
 */
export async function readCachedTier(): Promise<{
  tier: PlanTier
  expiresAt?: string
  originalPurchaseDate?: string
  hasTicketMonthly: boolean
  ticketMonthlyExpiresAt?: string
}> {
  try {
    const raw = await AsyncStorage.getItem(SUB_CACHE_KEY)
    if (!raw) return { tier: 'free', hasTicketMonthly: false }
    const cached: CachedSubscription = JSON.parse(raw)
    const ticketMonthlyExpired = !!cached.ticketMonthlyExpiresAt && new Date(cached.ticketMonthlyExpiresAt) < new Date()
    const hasTicketMonthly = !!cached.hasTicketMonthly && !ticketMonthlyExpired

    if (!cached.plan || cached.plan === 'free') {
      return { tier: 'free', hasTicketMonthly, ticketMonthlyExpiresAt: cached.ticketMonthlyExpiresAt }
    }
    if (cached.expiresAt && new Date(cached.expiresAt) < new Date()) {
      return { tier: 'free', hasTicketMonthly, ticketMonthlyExpiresAt: cached.ticketMonthlyExpiresAt }
    }
    return {
      tier: cached.plan,
      expiresAt: cached.expiresAt,
      originalPurchaseDate: cached.originalPurchaseDate,
      hasTicketMonthly,
      ticketMonthlyExpiresAt: cached.ticketMonthlyExpiresAt,
    }
  } catch {
    return { tier: 'free', hasTicketMonthly: false }
  }
}

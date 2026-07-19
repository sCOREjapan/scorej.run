// lib/subscriptionCache.ts — 購入プランのローカルキャッシュ（PurchaseContext / adGate 共通）
//
// RevenueCat の検証結果をローカルにキャッシュしておき、アプリ起動直後や
// PurchaseContext の外（adGate.ts）からも「現在のプラン」を即座に参照できるようにする。
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { PlanTier } from './purchaseService'

export const SUB_CACHE_KEY = 'trackmate_subscription'

type CachedSubscription = { isPremium: boolean; plan: PlanTier; expiresAt?: string }

export async function cacheSubscriptionStatus(tier: PlanTier, expiresAt?: string): Promise<void> {
  await AsyncStorage.setItem(SUB_CACHE_KEY, JSON.stringify({
    isPremium: tier !== 'free',
    plan: tier,
    expiresAt,
  } satisfies CachedSubscription)).catch(() => {})
}

/**
 * キャッシュされたプランを返す。
 * expiresAt が無い（RevenueCat から取得できなかった等）場合は期限を保証できないため、
 * 安全側に倒して free 扱いにする（誤って無期限に有効判定してしまうのを防ぐ）。
 */
export async function readCachedTier(): Promise<{ tier: PlanTier; expiresAt?: string }> {
  try {
    const raw = await AsyncStorage.getItem(SUB_CACHE_KEY)
    if (!raw) return { tier: 'free' }
    const cached: CachedSubscription = JSON.parse(raw)
    if (!cached.plan || cached.plan === 'free') return { tier: 'free' }
    if (!cached.expiresAt) return { tier: 'free' }
    if (new Date(cached.expiresAt) < new Date()) return { tier: 'free' }
    return { tier: cached.plan, expiresAt: cached.expiresAt }
  } catch {
    return { tier: 'free' }
  }
}

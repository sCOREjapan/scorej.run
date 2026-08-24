// context/PurchaseContext.tsx — プラン状態グローバル管理（FREE / NOAD / COACH + チケット月額）
import React, {
  createContext, useContext, useEffect, useRef, useState, useCallback,
} from 'react'
import Toast from 'react-native-toast-message'
import type { PlanTier } from '../lib/purchaseService'
import {
  initPurchases,
  getPremiumStatus,
  getPackages,
  getLastPackagesDiagnostic,
  purchasePackage as _purchasePackage,
  restoreAndCheck,
  logOutPurchases,
} from '../lib/purchaseService'
import { cacheSubscriptionStatus, readCachedTier } from '../lib/subscriptionCache'
import { setAdSuppressed } from '../lib/admob'
import { grantMonthlyTicketsIfNeeded } from '../lib/ticketWallet'
import { trackUpgrade } from '../lib/analytics'
import { useAuth } from './AuthContext'

const PLAN_LABELS: Record<PlanTier, string> = {
  free: '', noad: '広告なしプラン', coach: 'コーチプラン',
}

interface PurchaseContextType {
  tier:            PlanTier
  isNoad:          boolean   // 広告なしプラン以上（チケット月額プラン加入者も含む）
  isCoach:         boolean   // コーチプランのみ
  hasTicketMonthly: boolean  // チケット月額プランに加入中か
  ticketMonthlyExpiresAt: string | undefined
  expiresAt:       string | undefined
  packages:        any[]
  packagesDiagnostic: string | null
  loading:         boolean
  packagesReady:   boolean
  purchase:        (pkg: any) => Promise<boolean>
  restore:         () => Promise<{ tier: PlanTier; hasTicketMonthly: boolean } | false>
  refreshStatus:   () => Promise<void>
  onUserChanged:   (userId?: string) => Promise<void>
  onUserSignedOut: () => Promise<void>
}

const PurchaseContext = createContext<PurchaseContextType>({
  tier: 'free', isNoad: false, isCoach: false, hasTicketMonthly: false, ticketMonthlyExpiresAt: undefined,
  expiresAt: undefined, packages: [], packagesDiagnostic: null, loading: true, packagesReady: false,
  purchase:        async () => false,
  restore:         async () => false,
  refreshStatus:   async () => {},
  onUserChanged:   async () => {},
  onUserSignedOut: async () => {},
})

// チケット月額の更新を検知したら wallet に付与し、付与されていればトーストで知らせる
async function syncTicketMonthlyGrant(hasTicketMonthly: boolean, ticketMonthlyExpiresAt?: string) {
  if (!hasTicketMonthly) return
  try {
    const granted = await grantMonthlyTicketsIfNeeded(ticketMonthlyExpiresAt)
    if (granted) {
      Toast.show({ type: 'success', text1: '🎫 チケット100枚を付与しました', text2: 'チケット月額プランの更新分です' })
    }
  } catch {}
}

export function PurchaseProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  // undefined = 「まだ一度も初期化していない」の目印（null=ゲスト確定 と区別するため）
  const prevUserIdRef = useRef<string | null | undefined>(undefined)

  const [tier,         setTier]         = useState<PlanTier>('free')
  const [expiresAt,    setExpiresAt]    = useState<string | undefined>(undefined)
  const [hasTicketMonthly, setHasTicketMonthly] = useState(false)
  const [ticketMonthlyExpiresAt, setTicketMonthlyExpiresAt] = useState<string | undefined>(undefined)
  const [packages,     setPackages]     = useState<any[]>([])
  const [packagesDiagnostic, setPackagesDiagnostic] = useState<string | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [packagesReady, setPackagesReady] = useState(false)

  const isNoad  = tier === 'noad' || tier === 'coach' || hasTicketMonthly
  const isCoach = tier === 'coach'

  // 広告抑制フラグを admob モジュールに同期（React コンテキスト外からも参照できるよう）
  useEffect(() => { setAdSuppressed(isNoad) }, [isNoad])

  // ── 起動時：キャッシュ即読み → RevenueCat をバックグラウンドで確認 ──
  useEffect(() => {
    ;(async () => {
      // キャッシュから tier を即反映（UIブロックなし）。
      // expiresAt が無い/失効済みのキャッシュは readCachedTier 側で free 扱いになる。
      const cached = await readCachedTier()
      if (cached.tier !== 'free') {
        setTier(cached.tier)
        setExpiresAt(cached.expiresAt)
      }
      if (cached.hasTicketMonthly) {
        setHasTicketMonthly(true)
        setTicketMonthlyExpiresAt(cached.ticketMonthlyExpiresAt)
        syncTicketMonthlyGrant(true, cached.ticketMonthlyExpiresAt)
      }
      setLoading(false)
    })()
  }, [])

  // ── ユーザーIDが変わったとき RevenueCat に紐付け ──────────────
  // ゲスト（未ログイン）でも Purchases SDK 自体は必ず初期化する。
  // RevenueCat は userId 未指定なら匿名ユーザーとして動作するため、
  // ゲストのまま課金しようとしても正しく動く必要がある。
  useEffect(() => {
    const currentId = user?.id ?? null
    const prevId    = prevUserIdRef.current
    if (currentId === prevId) return
    prevUserIdRef.current = currentId

    initPurchases(currentId ?? undefined)
      .then(() => getPremiumStatus())
      .then(status => {
        setTier(status.tier); setExpiresAt(status.expiresAt)
        setHasTicketMonthly(status.hasTicketMonthly); setTicketMonthlyExpiresAt(status.ticketMonthlyExpiresAt)
        cacheSubscriptionStatus(status.tier, status.expiresAt, status.originalPurchaseDate, status.hasTicketMonthly, status.ticketMonthlyExpiresAt)
        syncTicketMonthlyGrant(status.hasTicketMonthly, status.ticketMonthlyExpiresAt)
      })
      .then(() => getPackages())
      .then(pkgs => { setPackages(pkgs); setPackagesDiagnostic(getLastPackagesDiagnostic()); setPackagesReady(true) })
      .catch(() => { setPackagesReady(true) })

    // ログアウトでゲスト/未ログインに戻ったときは RevenueCat 側もログアウトさせる
    // （匿名ユーザーへの切り戻しは configure し直すのではなく logOut で十分）
    if (!currentId && prevId) {
      logOutPurchases().catch(() => {})
    }
  }, [user?.id])

  const refreshStatus = useCallback(async () => {
    try {
      // 呼び出し元（paywall等）が起動直後に呼んでも安全なよう、
      // Purchases SDK が未設定なら先に初期化する（initPurchases は configure 済みなら何もしない）
      await initPurchases(user?.id ?? undefined)
      const status = await getPremiumStatus()
      setTier(status.tier); setExpiresAt(status.expiresAt)
      setHasTicketMonthly(status.hasTicketMonthly); setTicketMonthlyExpiresAt(status.ticketMonthlyExpiresAt)
      await cacheSubscriptionStatus(status.tier, status.expiresAt, status.originalPurchaseDate, status.hasTicketMonthly, status.ticketMonthlyExpiresAt)
      await syncTicketMonthlyGrant(status.hasTicketMonthly, status.ticketMonthlyExpiresAt)
      const pkgs = await getPackages()
      setPackages(pkgs)
      setPackagesDiagnostic(getLastPackagesDiagnostic())
    } catch {} finally {
      setPackagesReady(true)
    }
  }, [user?.id])

  const onUserChanged = useCallback(async (userId?: string) => {
    try {
      await initPurchases(userId)
      await refreshStatus()
    } catch {}
  }, [refreshStatus])

  const onUserSignedOut = useCallback(async () => {
    try {
      await logOutPurchases()
      setTier('free'); setExpiresAt(undefined)
      setHasTicketMonthly(false); setTicketMonthlyExpiresAt(undefined)
      await cacheSubscriptionStatus('free')
    } catch {}
  }, [])

  const purchase = useCallback(async (pkg: any): Promise<boolean> => {
    try {
      const result = await _purchasePackage(pkg)
      if (result) {
        await refreshStatus()
        const planKey = result.hasTicketMonthly && result.tier === 'free' ? 'ticket_monthly' : result.tier
        trackUpgrade(planKey)
        const label = result.hasTicketMonthly && result.tier === 'free'
          ? 'チケット月額プラン'
          : (PLAN_LABELS[result.tier] || 'プラン')
        Toast.show({
          type: 'success',
          text1: `🎉 ${label} 有効化！`,
          text2: result.tier === 'coach'
            ? '全機能が無制限で使えるようになりました'
            : result.hasTicketMonthly
              ? '広告が非表示になり、毎月チケットが届きます'
              : '広告が非表示になりました',
        })
        return true
      }
      return false
    } catch (e: any) {
      // userCancelled は静かに処理
      if (e?.userCancelled) return false
      // 決済自体は成立しているのにレシート検証等でエラーになるケースに備え、
      // 最新のエンタイトルメント状態を確認しておく（反映漏れの防止）
      refreshStatus().catch(() => {})
      Toast.show({ type: 'error', text1: '購入エラー', text2: e?.message ?? '購入に失敗しました' })
      return false
    }
  }, [refreshStatus])

  const restore = useCallback(async (): Promise<{ tier: PlanTier; hasTicketMonthly: boolean } | false> => {
    try {
      const result = await restoreAndCheck()
      await refreshStatus()
      if (result) {
        const label = result.hasTicketMonthly && result.tier === 'free'
          ? 'チケット月額プラン'
          : (PLAN_LABELS[result.tier] || 'プラン')
        Toast.show({ type: 'success', text1: '購入を復元しました ✅', text2: `${label}が有効になりました` })
      } else {
        Toast.show({ type: 'info', text1: '復元できる購入がありません', text2: '以前の購入が見つかりませんでした' })
      }
      return result
    } catch (e: any) {
      Toast.show({ type: 'error', text1: '復元エラー', text2: e?.message ?? '復元に失敗しました' })
      return false
    }
  }, [refreshStatus])

  return (
    <PurchaseContext.Provider value={{
      tier, isNoad, isCoach, hasTicketMonthly, ticketMonthlyExpiresAt,
      expiresAt, packages, packagesDiagnostic, loading, packagesReady,
      purchase, restore, refreshStatus, onUserChanged, onUserSignedOut,
    }}>
      {children}
    </PurchaseContext.Provider>
  )
}

export const usePurchase = () => useContext(PurchaseContext)

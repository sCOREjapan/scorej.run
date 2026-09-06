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
import { supabase } from '../lib/supabase'
import { useTranslation } from 'react-i18next'

function getPlanLabel(tier: PlanTier, t: (key: string, opts?: any) => string): string {
  return t(`purchase.planLabels.${tier}`, { defaultValue: t('purchase.planLabels.default') })
}

interface PurchaseContextType {
  tier:            PlanTier
  isNoad:          boolean   // 広告なしプラン以上（チケット月額プラン加入者も含む）
  isCoach:         boolean   // コーチプランのみ
  hasTicketMonthly: boolean  // チケット月額プランに加入中か
  ticketMonthlyExpiresAt: string | undefined
  ticketMonthlyIsTrial: boolean   // 無料トライアル期間中か（まだ課金は発生していない）
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
  ticketMonthlyIsTrial: false,
  expiresAt: undefined, packages: [], packagesDiagnostic: null, loading: true, packagesReady: false,
  purchase:        async () => false,
  restore:         async () => false,
  refreshStatus:   async () => {},
  onUserChanged:   async () => {},
  onUserSignedOut: async () => {},
})

// チケット月額の更新を検知したら wallet に付与し、付与されていればトーストで知らせる
// トライアル中(isTrial)は少量の日次付与になるため、通知トーストは通常付与の時だけ出す
// （毎日ポップアップされるとうるさいため）
async function syncTicketMonthlyGrant(hasTicketMonthly: boolean, t: (key: string, opts?: any) => string, ticketMonthlyExpiresAt?: string, isTrial?: boolean) {
  if (!hasTicketMonthly) return
  try {
    const granted = await grantMonthlyTicketsIfNeeded(ticketMonthlyExpiresAt, isTrial)
    if (granted && !isTrial) {
      Toast.show({ type: 'success', text1: t('purchase.ticketMonthlyGranted'), text2: t('purchase.ticketMonthlyGrantedSub') })
    }
  } catch {}
}

// getPackages() は端末側のRevenueCat SDKがまだ準備完了していないタイミング
// （特に新規インストール・アップデート直後）で呼ばれると一時的に0件を返すことがある。
// 従来は1回失敗したらそのまま諦めていたため、「商品が読み込めない」という
// 再現性の低い不具合報告が繰り返されていた。ここで短い間隔を空けて数回リトライする。
// getPackages()単体のリトライだけでなく、initPurchases()自体（＝configure()）が
// 失敗していたケースにも効くよう、リトライのたびにinitPurchasesもやり直す。
async function getPackagesWithRetry(userId: string | undefined, maxAttempts = 4, delayMs = 1500): Promise<any[]> {
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
      await initPurchases(userId).catch(() => {})
    }
    const pkgs = await getPackages()
    if (pkgs.length > 0) return pkgs
  }
  return []
}

// プラン確定のたびに profiles.plan_tier / has_ticket_monthly を同期する。
// 管理ダッシュボード（app/admin.tsx）の有料率集計はこの値を数えるだけなので、
// ここで同期していないユーザーは「未課金」として計上される。ゲストは
// profiles 行を持たないため userId が無ければ何もしない。
async function syncPlanTierToSupabase(userId: string | undefined, tier: PlanTier, hasTicketMonthly: boolean) {
  if (!userId) return
  try {
    await supabase
      .from('profiles')
      .update({ plan_tier: tier, has_ticket_monthly: hasTicketMonthly, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
  } catch {}
}

export function PurchaseProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  // undefined = 「まだ一度も初期化していない」の目印（null=ゲスト確定 と区別するため）
  const prevUserIdRef = useRef<string | null | undefined>(undefined)

  const [tier,         setTier]         = useState<PlanTier>('free')
  const [expiresAt,    setExpiresAt]    = useState<string | undefined>(undefined)
  const [hasTicketMonthly, setHasTicketMonthly] = useState(false)
  const [ticketMonthlyExpiresAt, setTicketMonthlyExpiresAt] = useState<string | undefined>(undefined)
  const [ticketMonthlyIsTrial, setTicketMonthlyIsTrial] = useState(false)
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
        setTicketMonthlyIsTrial(!!cached.ticketMonthlyIsTrial)
        syncTicketMonthlyGrant(true, t, cached.ticketMonthlyExpiresAt, cached.ticketMonthlyIsTrial)
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
        setTicketMonthlyIsTrial(!!status.ticketMonthlyIsTrial)
        cacheSubscriptionStatus(status.tier, status.expiresAt, status.originalPurchaseDate, status.hasTicketMonthly, status.ticketMonthlyExpiresAt, status.ticketMonthlyIsTrial)
        syncTicketMonthlyGrant(status.hasTicketMonthly, t, status.ticketMonthlyExpiresAt, status.ticketMonthlyIsTrial)
        syncPlanTierToSupabase(currentId ?? undefined, status.tier, status.hasTicketMonthly)
      })
      .then(() => getPackagesWithRetry(currentId ?? undefined))
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
      setTicketMonthlyIsTrial(!!status.ticketMonthlyIsTrial)
      await cacheSubscriptionStatus(status.tier, status.expiresAt, status.originalPurchaseDate, status.hasTicketMonthly, status.ticketMonthlyExpiresAt, status.ticketMonthlyIsTrial)
      await syncTicketMonthlyGrant(status.hasTicketMonthly, t, status.ticketMonthlyExpiresAt, status.ticketMonthlyIsTrial)
      await syncPlanTierToSupabase(user?.id, status.tier, status.hasTicketMonthly)
      const pkgs = await getPackagesWithRetry(user?.id)
      setPackages(pkgs)
      setPackagesDiagnostic(getLastPackagesDiagnostic())
    } catch {} finally {
      setPackagesReady(true)
    }
  }, [user?.id, t])

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
      setTicketMonthlyIsTrial(false)
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
          ? t('purchase.planLabels.ticketMonthly')
          : getPlanLabel(result.tier, t)
        Toast.show({
          type: 'success',
          text1: t('purchase.planActivated', { label }),
          text2: result.tier === 'coach'
            ? t('purchase.coachUnlocked')
            : result.hasTicketMonthly
              ? t('purchase.ticketMonthlyUnlocked')
              : t('purchase.noadUnlocked'),
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
      Toast.show({ type: 'error', text1: t('purchase.purchaseErrorTitle'), text2: e?.message ?? t('purchase.purchaseErrorBody') })
      return false
    }
  }, [refreshStatus, t])

  const restore = useCallback(async (): Promise<{ tier: PlanTier; hasTicketMonthly: boolean } | false> => {
    try {
      const result = await restoreAndCheck()
      await refreshStatus()
      if (result) {
        const label = result.hasTicketMonthly && result.tier === 'free'
          ? t('purchase.planLabels.ticketMonthly')
          : getPlanLabel(result.tier, t)
        Toast.show({ type: 'success', text1: t('purchase.restoreSuccessTitle'), text2: t('purchase.restoreSuccessBody', { label }) })
      } else {
        Toast.show({ type: 'info', text1: t('purchase.restoreNoneTitle'), text2: t('purchase.restoreNoneBody') })
      }
      return result
    } catch (e: any) {
      Toast.show({ type: 'error', text1: t('purchase.restoreErrorTitle'), text2: e?.message ?? t('purchase.restoreErrorBody') })
      return false
    }
  }, [refreshStatus, t])

  return (
    <PurchaseContext.Provider value={{
      tier, isNoad, isCoach, hasTicketMonthly, ticketMonthlyExpiresAt, ticketMonthlyIsTrial,
      expiresAt, packages, packagesDiagnostic, loading, packagesReady,
      purchase, restore, refreshStatus, onUserChanged, onUserSignedOut,
    }}>
      {children}
    </PurchaseContext.Provider>
  )
}

export const usePurchase = () => useContext(PurchaseContext)

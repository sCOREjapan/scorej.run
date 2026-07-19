// context/PurchaseContext.tsx — プラン状態グローバル管理（FREE / NOAD / COACH）
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
import { useAuth } from './AuthContext'

interface PurchaseContextType {
  tier:            PlanTier
  isNoad:          boolean   // 広告なしプラン以上
  isCoach:         boolean   // コーチプランのみ
  expiresAt:       string | undefined
  packages:        any[]
  packagesDiagnostic: string | null
  loading:         boolean
  packagesReady:   boolean
  purchase:        (pkg: any) => Promise<boolean>
  restore:         () => Promise<void>
  refreshStatus:   () => Promise<void>
  onUserChanged:   (userId?: string) => Promise<void>
  onUserSignedOut: () => Promise<void>
}

const PurchaseContext = createContext<PurchaseContextType>({
  tier: 'free', isNoad: false, isCoach: false,
  expiresAt: undefined, packages: [], packagesDiagnostic: null, loading: true, packagesReady: false,
  purchase:        async () => false,
  restore:         async () => {},
  refreshStatus:   async () => {},
  onUserChanged:   async () => {},
  onUserSignedOut: async () => {},
})

export function PurchaseProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  // undefined = 「まだ一度も初期化していない」の目印（null=ゲスト確定 と区別するため）
  const prevUserIdRef = useRef<string | null | undefined>(undefined)

  const [tier,         setTier]         = useState<PlanTier>('free')
  const [expiresAt,    setExpiresAt]    = useState<string | undefined>(undefined)
  const [packages,     setPackages]     = useState<any[]>([])
  const [packagesDiagnostic, setPackagesDiagnostic] = useState<string | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [packagesReady, setPackagesReady] = useState(false)

  const isNoad  = tier === 'noad' || tier === 'coach'
  const isCoach = tier === 'coach'

  // 広告抑制フラグを admob モジュールに同期（React コンテキスト外からも参照できるよう）
  useEffect(() => { setAdSuppressed(isNoad) }, [isNoad])

  // ── 起動時：キャッシュ即読み → RevenueCat をバックグラウンドで確認 ──
  useEffect(() => {
    ;(async () => {
      // キャッシュから tier を即反映（UIブロックなし）。
      // expiresAt が無い/失効済みのキャッシュは readCachedTier 側で free 扱いになる。
      const { tier: cachedTier, expiresAt: cachedExpiresAt } = await readCachedTier()
      if (cachedTier !== 'free') {
        setTier(cachedTier)
        setExpiresAt(cachedExpiresAt)
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
      .then(({ tier: t, expiresAt: exp }) => {
        setTier(t); setExpiresAt(exp)
        cacheSubscriptionStatus(t, exp)
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
      const { tier: t, expiresAt: exp } = await getPremiumStatus()
      setTier(t); setExpiresAt(exp)
      await cacheSubscriptionStatus(t, exp)
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
      await cacheSubscriptionStatus('free')
    } catch {}
  }, [])

  const purchase = useCallback(async (pkg: any): Promise<boolean> => {
    try {
      const result = await _purchasePackage(pkg)
      if (result) {
        await refreshStatus()
        const label = result === 'coach' ? 'コーチプラン' : '広告なしプラン'
        Toast.show({
          type: 'success',
          text1: `🎉 ${label} 有効化！`,
          text2: result === 'coach' ? '全機能が使えるようになりました' : '広告が非表示になりました',
        })
        return true
      }
      return false
    } catch (e: any) {
      // userCancelled は静かに処理
      if (e?.userCancelled) return false
      Toast.show({ type: 'error', text1: '購入エラー', text2: e?.message ?? '購入に失敗しました' })
      return false
    }
  }, [refreshStatus])

  const restore = useCallback(async () => {
    try {
      const result = await restoreAndCheck()
      await refreshStatus()
      if (result) {
        const label = result === 'coach' ? 'コーチプラン' : '広告なしプラン'
        Toast.show({ type: 'success', text1: '購入を復元しました ✅', text2: `${label}が有効になりました` })
      } else {
        Toast.show({ type: 'info', text1: '復元できる購入がありません', text2: '以前の購入が見つかりませんでした' })
      }
    } catch (e: any) {
      Toast.show({ type: 'error', text1: '復元エラー', text2: e?.message ?? '復元に失敗しました' })
    }
  }, [refreshStatus])

  return (
    <PurchaseContext.Provider value={{
      tier, isNoad, isCoach, expiresAt, packages, packagesDiagnostic, loading, packagesReady,
      purchase, restore, refreshStatus, onUserChanged, onUserSignedOut,
    }}>
      {children}
    </PurchaseContext.Provider>
  )
}

export const usePurchase = () => useContext(PurchaseContext)

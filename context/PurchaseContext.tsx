// context/PurchaseContext.tsx — プラン状態グローバル管理（FREE / PRO / ELITE）

import React, {
  createContext, useContext, useEffect, useState, useCallback,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import type { PlanTier } from '../lib/purchaseService'
import {
  initPurchases,
  getPremiumStatus,
  getPackages,
  purchasePackage as _purchasePackage,
  restoreAndCheck,
  logOutPurchases,
} from '../lib/purchaseService'

const SUB_KEY = 'trackmate_subscription'

// ── アクセスコード一覧（ハードコード秘密コード）───────────────────
// これらのコードを入力するとコーチプランが有効になります
const ACCESS_CODE_MAP: Record<string, PlanTier> = {
  'SCOREJAPAN2026': 'coach',   // 管理者コード
  'COACHDEMO2026':  'coach',   // デモコード
  'FOCUSLANE2026':  'coach',   // 代替管理者コード
  'COLLAB001': 'coach', 'COLLAB002': 'coach', 'COLLAB003': 'coach',
  'COLLAB004': 'coach', 'COLLAB005': 'coach', 'COLLAB006': 'coach',
  'COLLAB007': 'coach', 'COLLAB008': 'coach', 'COLLAB009': 'coach',
  'COLLAB010': 'coach', 'COLLAB011': 'coach', 'COLLAB012': 'coach',
  'COLLAB013': 'coach', 'COLLAB014': 'coach', 'COLLAB015': 'coach',
  'COLLAB016': 'coach', 'COLLAB017': 'coach', 'COLLAB018': 'coach',
  'COLLAB019': 'coach', 'COLLAB020': 'coach',
}

// ── 型定義 ─────────────────────────────────────────────────────────
interface PurchaseContextType {
  tier:            PlanTier          // 'free' | 'pro' | 'elite' | 'coach'
  isPro:           boolean           // pro または elite
  isElite:         boolean
  isCoach:         boolean           // coach プラン
  expiresAt:       string | undefined
  packages:        any[]
  loading:         boolean
  purchase:        (pkg: any) => Promise<boolean>
  restore:         () => Promise<void>
  refreshStatus:   () => Promise<void>
  onUserChanged:   (userId?: string) => Promise<void>
  onUserSignedOut: () => Promise<void>
  applyAccessCode: (code: string) => Promise<boolean>
}

const PurchaseContext = createContext<PurchaseContextType>({
  tier: 'free', isPro: false, isElite: false, isCoach: false,
  expiresAt: undefined, packages: [], loading: true,
  purchase:        async () => false,
  restore:         async () => {},
  refreshStatus:   async () => {},
  onUserChanged:   async () => {},
  onUserSignedOut: async () => {},
  applyAccessCode: async () => false,
})

// ── AsyncStorage にキャッシュ（adGate.ts との互換性維持） ──────────
async function cacheStatus(tier: PlanTier, expiresAt?: string) {
  await AsyncStorage.setItem(SUB_KEY, JSON.stringify({
    isPremium: tier !== 'free',
    plan: tier,
    expiresAt,
  })).catch(() => {})
}

export function PurchaseProvider({ children }: { children: React.ReactNode }) {
  const [tier,       setTier]       = useState<PlanTier>('free')
  const [expiresAt,  setExpiresAt]  = useState<string | undefined>(undefined)
  const [packages,   setPackages]   = useState<any[]>([])
  const [loading,    setLoading]    = useState(true)

  const isPro   = tier === 'pro'   || tier === 'elite'
  const isElite = tier === 'elite'
  const isCoach = tier === 'coach'

  // ── 起動時: キャッシュから即読み + RevenueCat で更新 ──────────
  useEffect(() => {
    ;(async () => {
      // キャッシュ即読み
      const raw = await AsyncStorage.getItem(SUB_KEY).catch(() => null)
      if (raw) {
        const cached = JSON.parse(raw)
        const expired = cached.expiresAt && new Date(cached.expiresAt) < new Date()
        if (!expired && cached.plan && cached.plan !== 'free') {
          setTier(cached.plan)
          setExpiresAt(cached.expiresAt)
        }
      }

      // RevenueCat から最新
      try {
        await initPurchases()
        await refreshStatus()
      } catch {}

      setLoading(false)
    })()
  }, [])

  // ── ステータス更新 ─────────────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    try {
      // アクセスコードが保存されている場合はcoachティアを優先（RevenueCatで上書きさせない）
      const savedCode = await AsyncStorage.getItem('score_access_code').catch(() => null)
      if (savedCode) {
        const clean = savedCode.trim().toUpperCase().replace(/[-\s]/g, '')
        if (ACCESS_CODE_MAP[clean] === 'coach') {
          setTier('coach')
          setExpiresAt('2099-12-31T00:00:00.000Z')
          await cacheStatus('coach', '2099-12-31T00:00:00.000Z')
          const pkgs = await getPackages()
          setPackages(pkgs)
          return
        }
      }

      const { tier: t, expiresAt: exp } = await getPremiumStatus()
      setTier(t)
      setExpiresAt(exp)
      await cacheStatus(t, exp)

      const pkgs = await getPackages()
      setPackages(pkgs)
    } catch {}
  }, [])

  // ── ログイン時 ─────────────────────────────────────────────────
  const onUserChanged = useCallback(async (userId?: string) => {
    try {
      await initPurchases(userId)
      await refreshStatus()
    } catch {}
  }, [refreshStatus])

  // ── ログアウト時 ───────────────────────────────────────────────
  const onUserSignedOut = useCallback(async () => {
    try {
      await logOutPurchases()
      setTier('free')
      setExpiresAt(undefined)
      await cacheStatus('free')
    } catch {}
  }, [])

  // ── 購入 ───────────────────────────────────────────────────────
  const purchase = useCallback(async (pkg: any): Promise<boolean> => {
    try {
      const result = await _purchasePackage(pkg)
      if (result) {
        await refreshStatus()
        const label = result === 'elite' ? 'ELITE' : 'PRO'
        Toast.show({
          type: 'success',
          text1: `🎉 sCORE ${label} 有効化！`,
          text2: 'すべての機能が使えるようになりました',
        })
        return true
      }
      return false
    } catch (e: any) {
      Toast.show({ type: 'error', text1: '購入エラー', text2: e?.message ?? '購入に失敗しました' })
      return false
    }
  }, [refreshStatus])

  // ── アクセスコード適用 ─────────────────────────────────────────
  const applyAccessCode = useCallback(async (code: string): Promise<boolean> => {
    const clean = code.trim().toUpperCase().replace(/[-\s]/g, '')
    const grantTier = ACCESS_CODE_MAP[clean]
    if (!grantTier) return false
    const expiresAt = '2099-12-31T00:00:00.000Z'
    await cacheStatus(grantTier, expiresAt)
    setTier(grantTier)
    setExpiresAt(expiresAt)
    await AsyncStorage.setItem('score_access_code', code.trim().toUpperCase()).catch(() => {})
    Toast.show({
      type: 'success',
      text1: '🎉 アクセスコード認証完了！',
      text2: 'コーチ機能がすべて有効になりました',
    })
    return true
  }, [])

  // ── 復元 ───────────────────────────────────────────────────────
  const restore = useCallback(async () => {
    try {
      const result = await restoreAndCheck()
      await refreshStatus()
      if (result) {
        Toast.show({ type: 'success', text1: '購入を復元しました ✅', text2: `sCORE ${result.toUpperCase()} が有効になりました` })
      } else {
        Toast.show({ type: 'info', text1: '復元できる購入がありません', text2: '以前のご購入を確認してください' })
      }
    } catch (e: any) {
      Toast.show({ type: 'error', text1: '復元エラー', text2: e?.message ?? '復元に失敗しました' })
    }
  }, [refreshStatus])

  return (
    <PurchaseContext.Provider value={{
      tier, isPro, isElite, isCoach, expiresAt, packages, loading,
      purchase, restore, refreshStatus, onUserChanged, onUserSignedOut, applyAccessCode,
    }}>
      {children}
    </PurchaseContext.Provider>
  )
}

export const usePurchase = () => useContext(PurchaseContext)

// context/PurchaseContext.tsx — プラン状態グローバル管理（FREE / PRO / ELITE）

import React, {
  createContext, useContext, useEffect, useRef, useState, useCallback,
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
import { useAuth } from './AuthContext'

const SUB_KEY   = 'trackmate_subscription'
const TRIAL_KEY = 'score_trial_coupon'   // トライアルクーポン使用履歴

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

// ── マーケティング用 3日間トライアルクーポン ──────────────────────
// キャンペーン期間: 2026年6月1日 00:00 JST まで有効
// 各コードは1デバイス1回のみ使用可能
// 6月になると isTrialCampaignActive() が false を返し一斉無効化
const TRIAL_CAMPAIGN_EXPIRY = new Date('2026-06-01T00:00:00+09:00')  // JST 6/1 0:00
const TRIAL_DAYS            = 3

export function isTrialCampaignActive(): boolean {
  return new Date() < TRIAL_CAMPAIGN_EXPIRY
}

// 100件のトライアルコード（SCR-XXXXX 形式、1デバイス1回）
const TRIAL_COUPON_SET = new Set([
  'SCR-00FJ0','SCR-0V3BO','SCR-1U1S5','SCR-1UON4','SCR-1USWP',
  'SCR-2HY3I','SCR-2O8HE','SCR-2WOGS','SCR-4G3MJ','SCR-4GBLE',
  'SCR-4HH6Z','SCR-557X9','SCR-5NH45','SCR-6NID3','SCR-754L2',
  'SCR-9PP7R','SCR-ATTOI','SCR-BC12C','SCR-BGPJV','SCR-C1O0H',
  'SCR-C1OED','SCR-C3MB3','SCR-C43PE','SCR-CQUY0','SCR-CU9ID',
  'SCR-D4QXY','SCR-D6TDB','SCR-DEXNR','SCR-DH0R2','SCR-DP8UY',
  'SCR-DYSP4','SCR-EEUG5','SCR-EMNOB','SCR-EUCCZ','SCR-F5BST',
  'SCR-F5TOB','SCR-FHX7Q','SCR-FY88U','SCR-G9WKZ','SCR-GBYMB',
  'SCR-GJS1R','SCR-GLSBL','SCR-GVSMR','SCR-GWBBT','SCR-H1MXH',
  'SCR-HMNO1','SCR-HNRHD','SCR-HR5CG','SCR-I19F8','SCR-IHV5B',
  'SCR-IIK4L','SCR-IU45J','SCR-J0UA0','SCR-JBNB7','SCR-JG4M9',
  'SCR-JPZBG','SCR-JWKO6','SCR-K9NRI','SCR-KBLVZ','SCR-KL59F',
  'SCR-KNFT8','SCR-L3DMC','SCR-LF17Y','SCR-LI2UY','SCR-LTYGF',
  'SCR-MFCCP','SCR-ML4LM','SCR-MT525','SCR-NF494','SCR-NMHNK',
  'SCR-O651G','SCR-O7R1R','SCR-OWQXE','SCR-P0ML2','SCR-P7PMV',
  'SCR-QKYJH','SCR-RED0G','SCR-RLJDR','SCR-RQ4NR','SCR-S2A2E',
  'SCR-SG6YC','SCR-TKY07','SCR-UW2RK','SCR-UX4T6','SCR-UZ6N9',
  'SCR-V5UPK','SCR-VVPW0','SCR-VYN9D','SCR-W7D48','SCR-WLR0I',
  'SCR-WOYDY','SCR-WUGC0','SCR-XNZ9U','SCR-XQN7X','SCR-XR6ZU',
  'SCR-YJD5C','SCR-YSNYU','SCR-YTYDP','SCR-Z5B2D','SCR-ZDL6S',
])

// トライアルクーポンの使用状況を確認（期限内かどうかも）
export async function getActiveTrial(): Promise<{ expiresAt: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(TRIAL_KEY)
    if (!raw) return null
    const saved: { code: string; usedAt: string; expiresAt: string } = JSON.parse(raw)
    // 3日間の期限チェック
    if (new Date(saved.expiresAt) < new Date()) return null
    return { expiresAt: saved.expiresAt }
  } catch {
    return null
  }
}

// ── 型定義 ─────────────────────────────────────────────────────────
interface PurchaseContextType {
  tier:            PlanTier
  isPro:           boolean
  isElite:         boolean
  isCoach:         boolean
  expiresAt:       string | undefined
  isTrial:         boolean           // トライアル中かどうか
  packages:        any[]
  loading:         boolean
  purchase:        (pkg: any) => Promise<boolean>
  restore:         () => Promise<void>
  refreshStatus:   () => Promise<void>
  onUserChanged:   (userId?: string) => Promise<void>
  onUserSignedOut: () => Promise<void>
  applyAccessCode: (code: string) => Promise<boolean>
  applyCoupon:     (code: string) => Promise<'ok' | 'already_used' | 'campaign_expired' | 'invalid'>
}

const PurchaseContext = createContext<PurchaseContextType>({
  tier: 'free', isPro: false, isElite: false, isCoach: false,
  expiresAt: undefined, isTrial: false, packages: [], loading: true,
  purchase:        async () => false,
  restore:         async () => {},
  refreshStatus:   async () => {},
  onUserChanged:   async () => {},
  onUserSignedOut: async () => {},
  applyAccessCode: async () => false,
  applyCoupon:     async () => 'invalid',
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
  const { user } = useAuth()
  const prevUserIdRef = useRef<string | null>(null)

  const [tier,      setTier]      = useState<PlanTier>('free')
  const [expiresAt, setExpiresAt] = useState<string | undefined>(undefined)
  const [isTrial,   setIsTrial]   = useState(false)
  const [packages,  setPackages]  = useState<any[]>([])
  const [loading,   setLoading]   = useState(true)

  const isPro   = tier === 'pro'   || tier === 'elite' || tier === 'coach'
  const isElite = tier === 'elite' || tier === 'coach'
  const isCoach = tier === 'coach'

  // ── 起動時: キャッシュから即読み + RevenueCat はバックグラウンドで更新 ──────────
  useEffect(() => {
    ;(async () => {
      // trial と キャッシュを並列読み（直列だと 2x かかる）
      const [trial, raw] = await Promise.all([
        getActiveTrial(),
        AsyncStorage.getItem(SUB_KEY).catch(() => null),
      ])

      if (trial) {
        setTier('elite')
        setExpiresAt(trial.expiresAt)
        setIsTrial(true)
        cacheStatus('elite', trial.expiresAt)   // await不要
      } else if (raw) {
        try {
          const cached = JSON.parse(raw)
          const expired = cached.expiresAt && new Date(cached.expiresAt) < new Date()
          if (!expired && cached.plan && cached.plan !== 'free') {
            setTier(cached.plan)
            setExpiresAt(cached.expiresAt)
          }
        } catch {}
      }

      // キャッシュ読み終わったら即 loading=false → UIを即表示
      setLoading(false)

      // RevenueCat + アクセスコードチェックはバックグラウンドで更新（UIブロックしない）
      try {
        await initPurchases()
        if (!trial) {
          // アクセスコードが保存されている場合
          const savedCode = await AsyncStorage.getItem('score_access_code').catch(() => null)
          if (savedCode) {
            const clean = savedCode.trim().toUpperCase().replace(/[-\s]/g, '')
            if (ACCESS_CODE_MAP[clean] === 'coach') {
              setTier('coach')
              setExpiresAt('2099-12-31T00:00:00.000Z')
              setIsTrial(false)
              cacheStatus('coach', '2099-12-31T00:00:00.000Z')
              const pkgs = await getPackages()
              setPackages(pkgs)
              return
            }
          }
          const { tier: t, expiresAt: exp } = await getPremiumStatus()
          setTier(t)
          setExpiresAt(exp)
          setIsTrial(false)
          cacheStatus(t, exp)
        }
        const pkgs = await getPackages()
        setPackages(pkgs)
      } catch {}
    })()
  }, [])

  // ── ユーザーIDが変わったとき RevenueCat に紐付け ────────────────
  // ログイン → RevenueCat に userId を渡してサブスクを引き継ぐ
  // ログアウト → RevenueCat を匿名状態に戻す
  useEffect(() => {
    const currentId = user?.id ?? null
    const prevId    = prevUserIdRef.current
    if (currentId === prevId) return
    prevUserIdRef.current = currentId

    if (currentId) {
      // 新しいユーザーがログイン
      initPurchases(currentId)
        .then(() => getPremiumStatus())
        .then(({ tier: t, expiresAt: exp }) => {
          setTier(t); setExpiresAt(exp); setIsTrial(false)
          cacheStatus(t, exp)
        })
        .catch(() => {})
    } else if (prevId) {
      // ログアウト
      logOutPurchases().catch(() => {})
    }
  }, [user?.id])

  // ── ステータス更新 ─────────────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    try {
      // トライアルクーポンが有効な場合は最優先
      const trial = await getActiveTrial()
      if (trial) {
        setTier('elite')
        setExpiresAt(trial.expiresAt)
        setIsTrial(true)
        await cacheStatus('elite', trial.expiresAt)
        const pkgs = await getPackages()
        setPackages(pkgs)
        return
      }

      // アクセスコードが保存されている場合はcoachティアを優先
      const savedCode = await AsyncStorage.getItem('score_access_code').catch(() => null)
      if (savedCode) {
        const clean = savedCode.trim().toUpperCase().replace(/[-\s]/g, '')
        if (ACCESS_CODE_MAP[clean] === 'coach') {
          setTier('coach')
          setExpiresAt('2099-12-31T00:00:00.000Z')
          setIsTrial(false)
          await cacheStatus('coach', '2099-12-31T00:00:00.000Z')
          const pkgs = await getPackages()
          setPackages(pkgs)
          return
        }
      }

      const { tier: t, expiresAt: exp } = await getPremiumStatus()
      setTier(t)
      setExpiresAt(exp)
      setIsTrial(false)
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
      setIsTrial(false)
      await cacheStatus('free')
      // アクセスコード・トライアルクーポンも削除（次のゲスト/別ユーザーに引き継がせない）
      await AsyncStorage.multiRemove(['score_access_code', TRIAL_KEY]).catch(() => {})
    } catch {}
  }, [])

  // ── 購入 ───────────────────────────────────────────────────────
  const purchase = useCallback(async (pkg: any): Promise<boolean> => {
    try {
      const result = await _purchasePackage(pkg)
      if (result) {
        await refreshStatus()
        const label = result === 'coach' ? 'COACH' : result === 'elite' ? 'ELITE' : 'PRO'
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

  // ── アクセスコード適用（コーチ用・永続） ──────────────────────
  const applyAccessCode = useCallback(async (code: string): Promise<boolean> => {
    const clean = code.trim().toUpperCase().replace(/[-\s]/g, '')
    const grantTier = ACCESS_CODE_MAP[clean]
    if (!grantTier) return false
    const exp = '2099-12-31T00:00:00.000Z'
    await cacheStatus(grantTier, exp)
    setTier(grantTier)
    setExpiresAt(exp)
    setIsTrial(false)
    await AsyncStorage.setItem('score_access_code', code.trim().toUpperCase()).catch(() => {})
    Toast.show({
      type: 'success',
      text1: '🎉 アクセスコード認証完了！',
      text2: 'コーチ機能がすべて有効になりました',
    })
    return true
  }, [])

  // ── マーケティングクーポン適用（3日間トライアル） ─────────────
  const applyCoupon = useCallback(async (
    code: string
  ): Promise<'ok' | 'already_used' | 'campaign_expired' | 'invalid'> => {
    const clean = code.trim().toUpperCase()

    // ① コードが有効なトライアルクーポンか確認
    if (!TRIAL_COUPON_SET.has(clean)) return 'invalid'

    // ② キャンペーン期間チェック（6月になったら一斉無効）
    if (!isTrialCampaignActive()) return 'campaign_expired'

    // ③ このデバイスで既にトライアルを使用済みか確認
    const existingTrial = await AsyncStorage.getItem(TRIAL_KEY).catch(() => null)
    if (existingTrial) return 'already_used'

    // ④ 3日間のトライアルを付与
    const now       = new Date()
    const expiresAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()

    await AsyncStorage.setItem(TRIAL_KEY, JSON.stringify({
      code:      clean,
      usedAt:    now.toISOString(),
      expiresAt,
    })).catch(() => {})

    setTier('elite')
    setExpiresAt(expiresAt)
    setIsTrial(true)
    await cacheStatus('elite', expiresAt)

    return 'ok'
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
      tier, isPro, isElite, isCoach, expiresAt, isTrial, packages, loading,
      purchase, restore, refreshStatus, onUserChanged, onUserSignedOut,
      applyAccessCode, applyCoupon,
    }}>
      {children}
    </PurchaseContext.Provider>
  )
}

export const usePurchase = () => useContext(PurchaseContext)

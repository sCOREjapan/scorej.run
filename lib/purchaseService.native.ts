// lib/purchaseService.native.ts — RevenueCat ネイティブ実装
// Metro は iOS/Android ビルド時にこちらを使用する

import Purchases, { LOG_LEVEL, type PurchasesPackage } from 'react-native-purchases'
import { Platform } from 'react-native'

export const ENTITLEMENT_NOAD           = 'noad'
export const ENTITLEMENT_COACH          = 'coach'
export const ENTITLEMENT_TICKET_MONTHLY = 'ticket_monthly'

export const PRODUCT_IDS = {
  noad_monthly:   'score_noad_monthly_v2',    // ¥480/月    広告なしプラン
  noad_yearly:    'score_noad_yearly_v2',      // ¥4,800/年
  coach_monthly:  'score_coach_monthly_v2',    // ¥1,980/月  コーチプラン
  coach_yearly:   'score_coach_yearly_v1',     // ¥19,800/年
  ticket_monthly: 'score_ticket_monthly_v1',   // ¥980/月  チケット月額（広告なし＋毎月チケット100枚）
  tickets_light:  'score_tickets_15_v1',       // ¥370  チケット15枚（消耗型）
  tickets_value:  'score_tickets_50_v1',       // ¥730  チケット50枚（消耗型）
}
export const TICKET_PACK_COUNTS: Record<string, number> = {
  [PRODUCT_IDS.tickets_light]: 15,
  [PRODUCT_IDS.tickets_value]: 50,
}

// チケット月額プランで毎月付与されるチケット枚数
export const TICKET_MONTHLY_GRANT = 100

export type PlanTier = 'free' | 'noad' | 'coach'

export type PremiumStatus = {
  tier: PlanTier
  expiresAt?: string
  originalPurchaseDate?: string
  hasTicketMonthly: boolean
  ticketMonthlyExpiresAt?: string
  // true の間は無料トライアル期間中（=まだ課金が発生していない）。
  // トライアル中に月額分の100枚を丸ごと付与すると、決済前にキャンセルされた場合
  // 無料でチケットだけ持ち逃げされてしまうため、付与ロジック側で参照する。
  ticketMonthlyIsTrial?: boolean
}

export type PurchaseResult = { tier: PlanTier; hasTicketMonthly: boolean } | false

const RC_IOS_KEY     = 'appl_iBIPuhRoGelxcbQXFMKglAFPyMs'
const RC_ANDROID_KEY = 'goog_KyXgRwWIIGphPyBkhtGUKvuDolK'

const ENT_NOAD           = 'noad'
const ENT_COACH          = 'coach'
const ENT_TICKET_MONTHLY = 'ticket_monthly'

// coach > noad > free（基本tier）。ticket_monthly はどのtierとも独立に併存できるので別扱い。
function resolveTier(entitlements: { active: Record<string, { expirationDate?: string | null; originalPurchaseDate?: string | null; periodType?: string }> }): PremiumStatus {
  const coach         = entitlements.active[ENT_COACH]
  const noad          = entitlements.active[ENT_NOAD]
  const ticketMonthly = entitlements.active[ENT_TICKET_MONTHLY]

  let tier: PlanTier = 'free'
  let expiresAt: string | undefined
  let originalPurchaseDate: string | undefined
  if (coach) {
    tier = 'coach'; expiresAt = coach.expirationDate ?? undefined; originalPurchaseDate = coach.originalPurchaseDate ?? undefined
  } else if (noad) {
    tier = 'noad'; expiresAt = noad.expirationDate ?? undefined; originalPurchaseDate = noad.originalPurchaseDate ?? undefined
  }

  return {
    tier, expiresAt, originalPurchaseDate,
    hasTicketMonthly: !!ticketMonthly,
    ticketMonthlyExpiresAt: ticketMonthly?.expirationDate ?? undefined,
    // periodType: 'TRIAL' の間は無料トライアル中（'INTRO'=有料の割引導入価格期間は課金済みなので対象外）
    ticketMonthlyIsTrial: ticketMonthly?.periodType === 'TRIAL',
  }
}

// ── 初期化 ──────────────────────────────────────────────────────────
// PurchaseContext（認証状態の変化時）と各画面（paywall.tsx等のマウント時）の両方が
// 独立に initPurchases() を呼べる作りのため、ほぼ同時に呼ばれると Purchases.configure()
// が完了する前に別の呼び出しが getOfferings()/getCustomerInfo() を叩いてしまい
// 「There is no singleton instance」で失敗することがあった（App Storeレビューで報告された
// 「商品の読み込みができない」不具合の原因）。configure/logIn を直列化して防ぐ。
let _initChain: Promise<void> = Promise.resolve()
let _configured = false
let _configuredKeyPrefix: string | null = null   // 診断用：実際にどちらの鍵で configure したか（appl_ / goog_ の接頭辞のみ）
let _lastConfigureError: string | null = null     // 診断用：configure() 自体が例外を投げていた場合の内容

export async function initPurchases(userId?: string): Promise<void> {
  _initChain = _initChain.then(async () => {
    try {
      if (!_configured) {
        const apiKey = Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY
        Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN)
        // isConfigured() は Promise<boolean> を返すため await が必須。
        // 同期的に `if (!Purchases.isConfigured())` と書くと Promise は常に truthy になり
        // configure() が一度も呼ばれないまま getOfferings 等が失敗し続けるバグがあった。
        const alreadyConfigured = await Purchases.isConfigured()
        if (!alreadyConfigured) {
          // 重要: Purchases.configure() は Promise を返さない同期(void)関数。
          // 以前ここに await を付けていたが、そもそも待つ対象が無いため意味が
          // 無かった（「There is no singleton instance」が直らなかった直接の原因）。
          // 正しくは、configure() を呼んだ後に isConfigured()（本当にPromiseを返す）
          // が実際に true になるまで短い間隔でポーリングして確認する。
          Purchases.configure({ apiKey })
          let confirmed = false
          for (let i = 0; i < 10; i++) {
            if (await Purchases.isConfigured()) { confirmed = true; break }
            await new Promise(resolve => setTimeout(resolve, 200))
          }
          if (!confirmed) {
            _lastConfigureError = 'configure()後にisConfigured()がtrueになりませんでした（タイムアウト2秒）'
            throw new Error(_lastConfigureError)
          }
          _lastConfigureError = null
        }
        _configured = true
        _configuredKeyPrefix = apiKey.split('_')[0] + '_'   // "appl_" or "goog_" のみ記録（鍵本体は含めない）
      }
      if (userId) {
        try { await Purchases.logIn(userId) } catch {}
      }
    } catch (e) {
      console.warn('[RevenueCat] initPurchases failed (non-fatal):', e)
    }
  })
  await _initChain
}

// ── プラン状態を取得 ─────────────────────────────────────────────
export async function getPremiumStatus(): Promise<PremiumStatus> {
  try {
    const info = await Purchases.getCustomerInfo()
    return resolveTier(info.entitlements as any)
  } catch (e) {
    // getPackages() と同じ自己修復: 未初期化系エラーなら次回作り直させる
    if (isUninitializedError(e)) {
      _configured = false
      console.warn('[RevenueCat] getCustomerInfoで未初期化エラーを検知。_configuredをリセットします。')
    }
    return { tier: 'free', hasTicketMonthly: false }
  }
}

// ── 診断情報（画面上に直接表示するため、Xcodeコンソールが見れない環境でも原因を確認できるようにする） ──
let _lastDiagnostic: string | null = null
export function getLastPackagesDiagnostic(): string | null {
  return _lastDiagnostic
}

// 「There is no singleton instance」等、ネイティブ側の未初期化を示すエラーかどうかの判定。
// これに該当する場合は、事前の対策（await/ポーリング）を重ねるのではなく、
// エラーが実際に起きた瞬間に _configured を強制的にリセットして configure() から
// やり直す方針に転換する（何が原因で未初期化状態になるのか特定できていないため、
// 「起きたら即座に作り直す」自己修復を優先する）。
function isUninitializedError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /singleton instance|not.*configured|configure.*Purchases/i.test(msg)
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
    let nativeConfigured: string
    try {
      nativeConfigured = String(await Purchases.isConfigured())
    } catch (e2) {
      nativeConfigured = `確認失敗:${e2 instanceof Error ? e2.message : String(e2)}`
    }
    _lastDiagnostic = `getOfferings失敗: ${msg} [_configured=${_configured} / isConfigured()=${nativeConfigured} / key=${_configuredKeyPrefix ?? '未設定'} / configureErr=${_lastConfigureError ?? 'なし'}]`
    console.warn('[RevenueCat] getOfferings failed:', e)

    // 自己修復: 未初期化系のエラーだった場合、JS側の状態を強制リセットして
    // 次回 initPurchases() が呼ばれた時に configure() から完全にやり直させる。
    // 呼び出し元（PurchaseContext の getPackagesWithRetry）が initPurchases を
    // 挟んでリトライする作りになっているため、これだけで自動的に再試行される。
    if (isUninitializedError(e)) {
      _configured = false
      console.warn('[RevenueCat] 未初期化エラーを検知。_configuredをリセットして再初期化を促します。')
    }
    return []
  }
}

// ── 購入 ─────────────────────────────────────────────────────────
// tier(noad/coach)を持つサブスクだけでなく、ticket_monthly（tierとは独立したエンタイトルメント）
// 単体の購入も「成功」として扱う必要があるため、tierがfreeのままでも hasTicketMonthly を見て判定する。
export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseResult> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg)
    const resolved = resolveTier(customerInfo.entitlements as any)
    if (resolved.tier === 'free' && !resolved.hasTicketMonthly) return false
    return { tier: resolved.tier, hasTicketMonthly: resolved.hasTicketMonthly }
  } catch (e: any) {
    if (e?.userCancelled) return false
    throw e
  }
}

// ── 消耗型チケットパックの購入 ───────────────────────────────────
// エンタイトルメントを持たないため、購入成功時のプロダクトIDから付与枚数を引いて返す。
export async function purchaseConsumable(pkg: PurchasesPackage): Promise<number | false> {
  try {
    await Purchases.purchasePackage(pkg)
    const productId = pkg.product?.identifier
    return TICKET_PACK_COUNTS[productId] ?? false
  } catch (e: any) {
    if (e?.userCancelled) return false
    throw e
  }
}

// ── 復元 ─────────────────────────────────────────────────────────
export async function restoreAndCheck(): Promise<PurchaseResult> {
  try {
    const info = await Purchases.restorePurchases()
    const resolved = resolveTier(info.entitlements as any)
    if (resolved.tier === 'free' && !resolved.hasTicketMonthly) return false
    return { tier: resolved.tier, hasTicketMonthly: resolved.hasTicketMonthly }
  } catch {
    return false
  }
}

// ── ログアウト ────────────────────────────────────────────────────
export async function logOutPurchases(): Promise<void> {
  try { await Purchases.logOut() } catch {}
}

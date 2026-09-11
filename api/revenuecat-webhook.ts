// api/revenuecat-webhook.ts — RevenueCat Webhook受信 → subscription_status(Supabase)への同期
//
// 【目的】
//   課金プラン(tier)の判定は端末ローカルキャッシュのみに依存しており、Web版はlocalStorageを
//   書き換えるだけで「coach(無制限)」を自称できた。サーバー側(api/analyze.ts)で
//   「本当にtier免除対象か」を検証できるよう、RevenueCatのWebhookを受けて
//   Supabaseのsubscription_statusテーブルを更新する。
//
// 【設定が必要】(2026-09-10: REVENUECAT_SECRET_API_KEY は不要になった)
//   1. Vercel環境変数 REVENUECAT_WEBHOOK_SECRET: 自分で決めた任意の文字列。
//      RevenueCatダッシュボード → Project settings → Integrations → Webhooks の
//      「Authorization header」に、同じ文字列を設定する
//   2. Vercel環境変数 SUPABASE_SERVICE_ROLE_KEY: Supabaseダッシュボードの
//      Settings → API → service_role key（既に設定済み）
//   3. RevenueCatのWebhook URL を https://scorej-run.vercel.app/api/revenuecat-webhook に設定
//
// 【設計方針】(2026-09-10 変更、2026-09-11 期限切れの扱いを修正)
//   以前は app_user_id を取り出して RevenueCat REST API に問い合わせ「今の全entitlement」を
//   再取得していたが、そのために Secret API Key(sk_...) が必要で、その鍵はダッシュボード上で
//   一度しか表示されず取得が困難だった。
//   代わりに Webhook のイベントペイロードだけから判定する方式に変更:
//     ・課金/更新/復活などのアクティブ化イベント → 確定した tier で upsert
//     ・キャンセル/請求問題/一時停止 → 期限切れまではアクセス維持のため upsert(期限を更新)
//     ・期限切れ(EXPIRATION) → イベントに含まれる entitlement 分のフィールドだけを
//       null/false にクリアする upsert(行自体は削除しない)。
//       2026-09-11: 以前は行ごとDELETEしていたが、同じuser_idの行に同居している
//       「今回のイベントに無関係な entitlement」の情報（例: coachが切れた瞬間に
//       ticket_monthlyの記録まで一緒に消える）を巻き込んで失う上、行が無くなると
//       api/analyze.tsのサーバー側チケット残高チェックがまるごとスキップされ
//       (fail open)、期限切れ直後という一番厳しくすべきタイミングで逆に緩く
//       なってしまうバグがあった。イベントで名前が挙がった entitlement のフィールド
//       だけをクリアし、行自体とそれ以外のフィールドは残すことで両方を防ぐ。
export const config = { runtime: 'nodejs' }

// アクティブ化とみなすイベント種別
const ACTIVATE_TYPES = new Set([
  'INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE',
  'PRODUCT_CHANGE', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT', 'TRANSFER',
])
// アクセスは維持されるが「解約予約中/猶予中」のイベント種別（期限まではupsertで維持）
const KEEP_TYPES = new Set(['CANCELLATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED'])
// アクセス終了イベント種別
const DEACTIVATE_TYPES = new Set(['EXPIRATION'])

// product_id から entitlement を推定（entitlement_ids が空のイベント対策）
function inferEntitlementsFromProduct(productId: string | undefined): string[] {
  if (!productId) return []
  if (productId.includes('coach')) return ['coach']
  if (productId.includes('noad')) return ['noad']
  if (productId.includes('ticket_monthly')) return ['ticket_monthly']
  return []
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed')
    return
  }

  const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET
  if (!webhookSecret) {
    res.status(500).json({ error: 'REVENUECAT_WEBHOOK_SECRET not configured' })
    return
  }
  const incoming = req.headers?.['authorization'] ?? ''
  if (incoming !== webhookSecret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) ?? {}
    const event = body?.event ?? {}
    const type: string = event?.type ?? ''
    const appUserId: string | undefined = event?.app_user_id
    if (!appUserId || type === 'TEST') {
      res.status(200).json({ status: 'ignored', reason: !appUserId ? 'no app_user_id' : 'test event' })
      return
    }

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) {
      res.status(500).json({ error: 'Supabase service role未設定' })
      return
    }
    const sbHeaders = {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    }

    // このイベントが関係する entitlement 群
    let entIds: string[] = Array.isArray(event?.entitlement_ids) ? event.entitlement_ids
      : (typeof event?.entitlement_id === 'string' ? [event.entitlement_id] : [])
    if (entIds.length === 0) entIds = inferEntitlementsFromProduct(event?.product_id)

    // ── tier / ticket_monthly を判定 ──
    const hasCoach = entIds.includes('coach')
    const hasNoad = entIds.includes('noad')
    const hasTicketMonthly = entIds.includes('ticket_monthly')

    // ── 期限切れ → 該当entitlementのフィールドだけをクリア(行は消さない) ──
    // ファイル冒頭コメント参照。無関係なentitlementやフィールドは触らない。
    if (DEACTIVATE_TYPES.has(type)) {
      if (!hasCoach && !hasNoad && !hasTicketMonthly) {
        res.status(200).json({ status: 'ignored', reason: 'expiration for unrecognized entitlement' })
        return
      }
      const clearPatch: Record<string, unknown> = { user_id: appUserId, updated_at: new Date().toISOString() }
      if (hasCoach || hasNoad) {
        clearPatch.tier = null
        clearPatch.expires_at = null
        clearPatch.original_purchase_date = null
      }
      if (hasTicketMonthly) {
        clearPatch.has_ticket_monthly = false
        clearPatch.ticket_monthly_expires_at = null
      }
      const clearRes = await fetch(`${supabaseUrl}/rest/v1/subscription_status`, {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(clearPatch),
      })
      if (!clearRes.ok) {
        const errText = await clearRes.text().catch(() => '')
        res.status(500).json({ error: `Supabase upsert失敗: ${errText}` })
        return
      }
      res.status(200).json({ status: 'ok', action: 'cleared', user_id: appUserId, type, clearPatch })
      return
    }

    // アクティブ化 or 維持イベント以外（未知の種別）は無視
    if (!ACTIVATE_TYPES.has(type) && !KEEP_TYPES.has(type)) {
      res.status(200).json({ status: 'ignored', reason: `unhandled type: ${type}` })
      return
    }

    const expiresAt = typeof event?.expiration_at_ms === 'number'
      ? new Date(event.expiration_at_ms).toISOString() : null
    const purchasedAt = typeof event?.purchased_at_ms === 'number'
      ? new Date(event.purchased_at_ms).toISOString() : null

    // このイベントが coach/noad どちらにも関係しない（ticket_monthly単体等）場合、
    // tier は変更せず、既存行があれば ticket 情報だけ更新する
    const patch: Record<string, unknown> = { user_id: appUserId, updated_at: new Date().toISOString() }
    if (hasCoach) {
      patch.tier = 'coach'
      patch.expires_at = expiresAt
      patch.original_purchase_date = purchasedAt
    } else if (hasNoad) {
      patch.tier = 'noad'
      patch.expires_at = expiresAt
      patch.original_purchase_date = purchasedAt
    }
    if (hasTicketMonthly) {
      patch.has_ticket_monthly = true
      patch.ticket_monthly_expires_at = expiresAt
    }

    // coach/noad も ticket_monthly も無い（推定もできない）イベントは無視
    if (!hasCoach && !hasNoad && !hasTicketMonthly) {
      res.status(200).json({ status: 'ignored', reason: 'no known entitlement in event' })
      return
    }

    // upsert（merge-duplicates で既存行の他フィールドは保持）
    const upsertRes = await fetch(`${supabaseUrl}/rest/v1/subscription_status`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(patch),
    })
    if (!upsertRes.ok) {
      const errText = await upsertRes.text().catch(() => '')
      res.status(500).json({ error: `Supabase upsert失敗: ${errText}` })
      return
    }

    res.status(200).json({ status: 'ok', action: 'upserted', user_id: appUserId, type, patch })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Unknown error' })
  }
}

// api/revenuecat-webhook.ts — RevenueCat Webhook受信 → subscription_status(Supabase)への同期
//
// 【目的】
//   これまで課金プラン(tier)の判定は端末ローカル(AsyncStorage)キャッシュのみに依存していた。
//   Web版はlocalStorageを直接書き換えるだけで「coach(無制限)」を自称でき、サーバー側
//   (api/analyze.ts)はそれを一切検証していなかった。
//   RevenueCatのWebhookを受け、購読状態の変化のたびにRevenueCat REST APIで該当ユーザーの
//   最新のCustomerInfoを取得し、Supabaseのsubscription_statusテーブルに書き込むことで、
//   サーバー側で「本当にtier免除対象か」を検証できるようにする。
//
// 【設定が必要】
//   1. Vercel環境変数 REVENUECAT_WEBHOOK_SECRET: RevenueCatダッシュボードの
//      Webhook設定で「Authorization header」に設定する値と同じ文字列にする
//   2. Vercel環境変数 REVENUECAT_SECRET_API_KEY: RevenueCatダッシュボードの
//      API Keys → 新規Secret Keyを発行(sk_で始まる。SDKキーappl_/goog_とは別物)
//   3. Vercel環境変数 SUPABASE_SERVICE_ROLE_KEY: Supabaseダッシュボードの
//      Settings → API → service_role key
//   4. RevenueCatダッシュボード → Project settings → Integrations → Webhooks で
//      URLを https://scorej-run.vercel.app/api/revenuecat-webhook に設定し、
//      Authorization headerを1のREVENUECAT_WEBHOOK_SECRETと同じ値にする
//
// 【安全性】
//   webhook自体のペイロードは信用せず、app_user_idだけを取り出してRevenueCat REST APIに
//   問い合わせ、そこで返る「今まさに有効な」entitlementsのみを真実として扱う
//   （webhookのイベント種別ごとのフィールド差異を解釈する必要がなく、実装ミスに強い）。
export const config = { runtime: 'nodejs' }

const ENTITLEMENTS = ['coach', 'noad', 'ticket_monthly'] as const

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
    const appUserId: string | undefined = body?.event?.app_user_id
    if (!appUserId) {
      // 匿名ユーザー(RevenueCatの自動生成ID)やapp_user_idが取れないイベントは無視して200を返す
      // （RevenueCat側はエラー応答が続くとwebhookを無効化するため、無視できるケースは200が正しい）
      res.status(200).json({ status: 'ignored', reason: 'no app_user_id' })
      return
    }

    const secretApiKey = process.env.REVENUECAT_SECRET_API_KEY
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!secretApiKey || !supabaseUrl || !serviceKey) {
      res.status(500).json({ error: 'RevenueCat secret key or Supabase service role未設定' })
      return
    }

    // ── RevenueCat REST APIで「今まさに有効な」CustomerInfoを取得する ──
    // webhookのペイロード自体は「何かが変わった」という通知としてのみ使い、
    // 実際の判定材料はここで取得する最新情報だけを信用する
    const rcRes = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
      headers: { Authorization: `Bearer ${secretApiKey}` },
    })
    if (!rcRes.ok) {
      // 該当ユーザーが見つからない等。エラーにするとRevenueCat側のwebhook再送ループになりうるため200で受ける
      res.status(200).json({ status: 'ignored', reason: `RevenueCat API ${rcRes.status}` })
      return
    }
    const rcData = await rcRes.json()
    const entitlements = rcData?.subscriber?.entitlements ?? {}

    const now = Date.now()
    const isActive = (key: string) => {
      const e = entitlements[key]
      if (!e) return false
      // expires_date が null = 生涯購入/プロモーション付与など無期限
      if (!e.expires_date) return true
      return new Date(e.expires_date).getTime() > now
    }

    let tier: 'free' | 'noad' | 'coach' = 'free'
    if (isActive('coach')) tier = 'coach'
    else if (isActive('noad')) tier = 'noad'

    const hasTicketMonthly = isActive('ticket_monthly')
    const primaryKey = tier !== 'free' ? tier : (hasTicketMonthly ? 'ticket_monthly' : null)
    const primaryEnt = primaryKey ? entitlements[primaryKey] : null

    const row = {
      user_id: appUserId,
      tier,
      expires_at: primaryEnt?.expires_date ?? null,
      original_purchase_date: primaryEnt?.purchase_date ?? null,
      has_ticket_monthly: hasTicketMonthly,
      ticket_monthly_expires_at: entitlements['ticket_monthly']?.expires_date ?? null,
      updated_at: new Date().toISOString(),
    }

    // service_role keyで直接REST APIを叩く（RLSを迂回する必要があるため。
    // このプロジェクトは@supabase/supabase-jsに依存済みだが、Vercel Functionでの
    // 軽量化のためここではfetchで直接PostgRESTを呼ぶ）
    const upsertRes = await fetch(`${supabaseUrl}/rest/v1/subscription_status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(row),
    })
    if (!upsertRes.ok) {
      const errText = await upsertRes.text().catch(() => '')
      res.status(500).json({ error: `Supabase upsert失敗: ${errText}` })
      return
    }

    res.status(200).json({ status: 'ok', user_id: appUserId, tier, hasTicketMonthly })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Unknown error' })
  }
}

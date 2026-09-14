// api/redeem-team-code.ts — アプリ内でチームプランのコードを引き換える
//
// 2026-09-14: Stripe外部決済(api/create-team-checkout.ts)で発行したコードを、
// アプリ内(app/(tabs)/team.tsxのコーチ設定画面)から入力してもらい、コーチプランの
// 権限を付与する。
//
// 【権限付与の方式】
//   context/PurchaseContext.tsx の tier 判定は RevenueCat SDK の getCustomerInfo() しか
//   見ておらず、Supabase側のフラグは一切参照していない(lib/purchaseService.native.ts参照)。
//   そのため、Supabase側に独自の権限テーブルを作ってもアプリは気づけない。
//   代わりにRevenueCatの「Promotional Entitlement」をREST APIで直接付与する
//   (既に¥980プラン加入者への半年無料補償で使ったのと同じ仕組み)。これなら
//   ・端末側のtier判定(PurchaseContext)はrefreshStatus()を呼ぶだけで自動的に反映される
//   ・api/revenuecat-webhook.tsは既に TEMPORARY_ENTITLEMENT_GRANT をACTIVATE_TYPESとして
//     扱っているため、サーバー側subscription_statusへの同期も無改修で動く
//   という二重のメリットがある。
//
// 【設定が必要】(Vercel環境変数)
//   REVENUECAT_SECRET_API_KEY: RevenueCatダッシュボード → Project settings → API keys →
//   Secret keys で発行(sk_...)。付与(Grant)系のAPIはSecret keyでないと呼べない。
//
// ⚠️ エンドポイントURL: 下記 REVENUECAT_GRANT_URL はRevenueCat API v1の
//   "Grant a promotional entitlement" 仕様に基づく。本番投入前に
//   https://www.revenuecat.com/docs (Promotionals / API Reference) で
//   最新のURL・durationの許容値("daily"|"three_day"|"weekly"|"monthly"|
//   "two_month"|"three_month"|"six_month"|"yearly"|"lifetime")を必ず確認すること。
export const config = { runtime: 'nodejs' }

const VALID_TIERS = new Set(['coach_monthly', 'coach_monthly_30', 'coach_monthly_unlimited'])
const COACH_ENTITLEMENT_ID = 'coach' // RevenueCatダッシュボードで設定済みのentitlement識別子と一致させること

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const code = (body?.code ?? '').toString().trim().toUpperCase()
    if (!code) { res.status(400).json({ error: 'コードを入力してください' }); return }

    // ── ログイン必須 ──
    // RevenueCatのapp_user_id = Supabaseのuser_id (lib/purchaseService.native.tsの
    // Purchases.logIn(userId)で紐付け済み)。未ログインでは付与先のapp_user_idが
    // 定まらない(匿名IDは端末が変わると失われる)ため、ここではログインを必須にする。
    const authHeader: string = req.headers?.['authorization'] ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'コードの引き換えにはログインが必要です' }); return
    }
    const token = authHeader.slice('Bearer '.length)

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const revenueCatSecret = process.env.REVENUECAT_SECRET_API_KEY
    if (!supabaseUrl || !anonKey || !serviceKey || !revenueCatSecret) {
      res.status(500).json({ error: 'サーバー設定が不足しています' }); return
    }

    const { createClient } = await import('@supabase/supabase-js')
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: userData, error: userErr } = await userClient.auth.getUser(token)
    const userId = userData?.user?.id
    if (userErr || !userId) { res.status(401).json({ error: 'ログイン情報を確認できませんでした' }); return }

    const svcHeaders = { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

    // ── コードを検証(service role経由。未使用チェックも兼ねる) ──
    const lookupRes = await fetch(
      `${supabaseUrl}/rest/v1/team_plan_codes?code=eq.${encodeURIComponent(code)}&select=*`,
      { headers: svcHeaders },
    )
    const rows = await lookupRes.json()
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row) { res.status(404).json({ error: 'そのコードは見つかりませんでした' }); return }
    if (row.status === 'redeemed') { res.status(409).json({ error: 'このコードは既に使用されています' }); return }
    if (!VALID_TIERS.has(row.tier)) { res.status(400).json({ error: '不正なプランです' }); return }
    // 2026-09-14: 「コードに有効期限を発行」との指示で追加。expires_atがNULL
    // (このカラム追加前に発行された古いコード)は無期限として扱い、判定をスキップする。
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      res.status(410).json({ error: 'このコードは有効期限が切れています。発行元にお問い合わせください' })
      return
    }

    // ── RevenueCatへpromotional entitlementを付与 ──
    const grantRes = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}/entitlements/${COACH_ENTITLEMENT_ID}/promotional`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${revenueCatSecret}` },
        body: JSON.stringify({ duration: 'yearly' }),
      },
    )
    if (!grantRes.ok) {
      const errText = await grantRes.text().catch(() => '')
      res.status(502).json({ error: `権限の付与に失敗しました。時間をおいて再度お試しください: ${errText}` })
      return
    }

    // ── コードを使用済みにする(付与成功後にだけ確定させる) ──
    await fetch(`${supabaseUrl}/rest/v1/team_plan_codes?code=eq.${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: svcHeaders,
      body: JSON.stringify({ status: 'redeemed', redeemed_by: userId, redeemed_at: new Date().toISOString() }),
    })

    res.status(200).json({ status: 'ok', tier: row.tier })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Unknown error' })
  }
}

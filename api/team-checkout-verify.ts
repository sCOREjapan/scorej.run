// api/team-checkout-verify.ts — Stripe決済完了後、コードを1件発行する
//
// 2026-09-14: Webhookの生ボディ署名検証(raw body)はVercelのNode.jsランタイムでの
// 扱いに気をつけるべき落とし穴が多いため、MVPでは「決済完了後のリダイレクト画面
// (app/team-plan-success.tsx)が自分のsession_idを持ってこのAPIを叩き、サーバー側で
// Stripeにsession_idを再照会して支払い済みを確認する」方式にした。webhookより
// 到達性は落ちる(ユーザーが決済直後にタブを閉じるとコードが発行されない)が、
// 低頻度・対面に近いB2B販売の初期段階では十分。件数が増えてきたら
// checkout.session.completed のWebhookを別途追加するのが望ましい。
//
// 同じsession_idで複数回呼ばれても(ページ再読み込み等)コードが重複発行されないよう、
// stripe_session_id にUNIQUE制約(supabase/team_plan_codes_migration.sql参照)を付けて
// 冪等にしている。
export const config = { runtime: 'nodejs' }

import Stripe from 'stripe'

// 2026-09-14: 「コードに有効期限を発行」との指示。api/admin-generate-team-code.tsと
// 同じ日数に揃える。
const CODE_VALIDITY_DAYS = 90

function generateCode(): string {
  // 0/O・1/I/l 等の見間違えやすい文字を除いた文字セットから12桁、4桁区切りで発行
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET') { res.status(405).send('Method not allowed'); return }

  try {
    const sessionId = (req.query?.session_id ?? '').toString()
    if (!sessionId) { res.status(400).json({ error: 'session_id が必要です' }); return }

    const secretKey = process.env.STRIPE_SECRET_KEY
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!secretKey || !supabaseUrl || !serviceKey) {
      res.status(500).json({ error: 'サーバー設定が不足しています' }); return
    }
    const svcHeaders = { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

    // ── 既にこのsession_idでコード発行済みなら、新規発行せずそれを返す(冪等) ──
    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/team_plan_codes?stripe_session_id=eq.${encodeURIComponent(sessionId)}&select=code,tier`,
      { headers: svcHeaders },
    )
    const existingRows = await existingRes.json()
    if (Array.isArray(existingRows) && existingRows[0]) {
      res.status(200).json({ code: existingRows[0].code, tier: existingRows[0].tier })
      return
    }

    // ── Stripeに支払い済みかを再照会(クライアントの自己申告を信用しない) ──
    const stripe = new Stripe(secretKey)
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.payment_status !== 'paid') {
      res.status(402).json({ error: 'お支払いが確認できませんでした' }); return
    }
    const tier = session.metadata?.tier
    if (!tier) { res.status(400).json({ error: 'プラン情報が見つかりませんでした' }); return }

    const code = generateCode()
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/team_plan_codes`, {
      method: 'POST',
      headers: svcHeaders,
      body: JSON.stringify({
        code, tier, status: 'unused',
        stripe_session_id: sessionId,
        purchaser_email: session.customer_details?.email ?? null,
        expires_at: new Date(Date.now() + CODE_VALIDITY_DAYS * 86400000).toISOString(),
      }),
    })
    if (!insertRes.ok) {
      const errText = await insertRes.text().catch(() => '')
      res.status(500).json({ error: `コード発行に失敗しました: ${errText}` })
      return
    }

    res.status(200).json({ code, tier })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Unknown error' })
  }
}

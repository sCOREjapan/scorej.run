// api/admin-generate-team-code.ts — 手動でチームプランの引き換えコードを1件発行する
//
// 2026-09-14: 「決済ページ自体はBASE(https://thebase.in/)で作りたい、自作サイトのバグが
// 怖い」との判断を受けて追加。BASEにはStripeのようなWebhook/API連携が(現時点で)無いため、
// 「BASEで注文が入ったのを見たら、ここで手動でコードを1件発行してメールで送る」という
// 運用にする。api/create-team-checkout.ts・api/team-checkout-verify.ts(Stripe用)と
// 発行先テーブル(supabase/team_plan_codes_migration.sql)は共通のため、決済経路を
// Stripe/BASE/銀行振込のどれにしても、アプリ側(api/redeem-team-code.ts・
// app/(tabs)/team.tsxのコード入力欄)は一切変更不要。
//
// 【使い方】ブラウザで https://scorej-run.vercel.app/admin-generate-code を開き、
// パスコード(下記ADMIN_CODE_SECRET)・プラン・購入者メールを入れて発行するだけ。
//
// 【設定が必要】(Vercel環境変数)
//   ADMIN_CODE_SECRET: 自分で決めた任意の文字列(この画面に入力する合言葉)
export const config = { runtime: 'nodejs' }

const VALID_TIERS = new Set(['coach_monthly', 'coach_monthly_30', 'coach_monthly_unlimited'])
// 2026-09-14: 「コードに有効期限を発行」との指示で追加。決済からあまりに時間が経ってから
// 転送されて使われる事故を防ぐため、発行から90日で失効させる(api/redeem-team-code.tsで検証)。
const CODE_VALIDITY_DAYS = 90

function generateCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return }

  try {
    const adminSecret = process.env.ADMIN_CODE_SECRET
    if (!adminSecret) { res.status(500).json({ error: 'ADMIN_CODE_SECRET が未設定です' }); return }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    if (body?.passcode !== adminSecret) { res.status(401).json({ error: '合言葉が違います' }); return }

    const tier = body?.tier as string
    if (!VALID_TIERS.has(tier)) { res.status(400).json({ error: '不正なプランです' }); return }
    const note = (body?.note ?? '').toString().slice(0, 200) // 購入者メール等のメモ(任意)

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) { res.status(500).json({ error: 'サーバー設定が不足しています' }); return }

    const code = generateCode()
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/team_plan_codes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        code, tier, status: 'unused', purchaser_email: note || null,
        expires_at: new Date(Date.now() + CODE_VALIDITY_DAYS * 86400000).toISOString(),
      }),
    })
    if (!insertRes.ok) {
      const errText = await insertRes.text().catch(() => '')
      res.status(500).json({ error: `コード発行に失敗しました: ${errText}` })
      return
    }

    res.status(200).json({ code })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Unknown error' })
  }
}

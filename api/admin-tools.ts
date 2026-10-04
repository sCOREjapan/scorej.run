// api/admin-tools.ts — 管理用API3種を1つのServerless Functionにまとめたもの
//
// 2026-10-05: 以下3ファイルを統合した。Vercel Hobbyプランは1デプロイあたり
// Serverless Functionを12個までしか許さず(exceeded_serverless_functions_per_deployment)、
// admin-statsの追加とadmin-churned-usersのedge→nodejs変更で14個になり、本番デプロイが
// 失敗していた(その間、9/30以降のセキュリティ修正が本番に一切出ていなかった)。
// URLは ?tool= で振り分ける:
//   /api/admin-tools?tool=stats      旧 api/admin-stats.ts           (ADMIN_EXPORT_SECRET)
//   /api/admin-tools?tool=churned    旧 api/admin-churned-users.ts   (ADMIN_EXPORT_SECRET)
//   /api/admin-tools?tool=team-code  旧 api/admin-generate-team-code.ts (ADMIN_CODE_SECRET)
// 各ツールの経緯・設計意図の詳細は旧ファイルのコメント(git履歴)を参照。
// ⚠️ 関数を新規追加する前に必ず `ls api | wc -l` が12以下に収まるか確認すること。
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


// ── stats: 管理画面の集計統計(get_admin_stats/get_retention_cohorts) ──
async function handleStats(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed')
    return
  }

  const exportSecret = process.env.ADMIN_EXPORT_SECRET
  if (!exportSecret) {
    res.status(500).json({ error: 'ADMIN_EXPORT_SECRET未設定' })
    return
  }
  const incoming = req.headers?.['x-admin-export-secret'] ?? ''
  if (incoming !== exportSecret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Supabase service role未設定' })
    return
  }

  let rpcName: 'get_admin_stats' | 'get_retention_cohorts' = 'get_admin_stats'
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    if (body?.rpc === 'get_retention_cohorts') rpcName = 'get_retention_cohorts'
  } catch {}

  try {
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({}),
    })
    if (!rpcRes.ok) {
      const errText = await rpcRes.text()
      res.status(502).json({ error: `Supabase RPC失敗: ${errText}` })
      return
    }
    const data = await rpcRes.json()
    res.status(200).json(data)
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'リクエスト失敗' })
  }
}


// ── churned: 離脱ユーザーのメール一覧CSV（個人情報のため専用の秘密鍵で保護） ──
async function handleChurned(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed')
    return
  }

  const exportSecret = process.env.ADMIN_EXPORT_SECRET
  if (!exportSecret) {
    res.status(500).json({ error: 'ADMIN_EXPORT_SECRET未設定' })
    return
  }
  const incoming = req.headers?.['x-admin-export-secret'] ?? ''
  if (incoming !== exportSecret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Supabase service role未設定' })
    return
  }

  let minSessions = 3, inactiveDays = 21
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    if (typeof body?.minSessions === 'number') minSessions = body.minSessions
    if (typeof body?.inactiveDays === 'number') inactiveDays = body.inactiveDays
  } catch {}

  try {
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/get_churned_users_export`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ p_min_sessions: minSessions, p_inactive_days: inactiveDays }),
    })
    if (!rpcRes.ok) {
      const errText = await rpcRes.text()
      res.status(502).json({ error: `Supabase RPC失敗: ${errText}` })
      return
    }
    const rows = await rpcRes.json() as Array<{
      email: string; name: string; primary_event: string
      total_sessions: number; last_session: string
    }>

    const header = 'email,name,primary_event,total_sessions,last_session'
    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csvLines = rows.map(r =>
      [escape(r.email), escape(r.name), escape(r.primary_event), r.total_sessions, escape(r.last_session)].join(',')
    )
    const csv = [header, ...csvLines].join('\n')

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="churned_users.csv"')
    res.status(200).send(csv)
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'リクエスト失敗' })
  }
}


// ── team-code: チームプランの引き換えコードを手動で1件発行 ──
async function handleTeamCode(req: any, res: any) {
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


export default async function handler(req: any, res: any) {
  const tool = (req.query?.tool ?? new URL(req.url ?? '', 'http://x').searchParams.get('tool') ?? '').toString()
  if (tool === 'stats') return handleStats(req, res)
  if (tool === 'churned') return handleChurned(req, res)
  if (tool === 'team-code') return handleTeamCode(req, res)
  res.status(404).json({ error: 'Unknown tool' })
}

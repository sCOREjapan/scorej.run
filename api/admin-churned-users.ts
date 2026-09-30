// api/admin-churned-users.ts — 離脱ユーザーのメール一覧をCSVで返す（個人情報を扱うため専用の秘密鍵で保護）
//
// app/admin.tsx の管理画面パスワード（EXPO_PUBLIC_ADMIN_PASSWORD）はクライアントの
// JSバンドルに含まれるため、実質的に「秘密」ではない。集計値（人数など）を見せる
// だけならリスクは低いが、実際のメールアドレス一覧はそれとは別次元の情報のため、
// このエンドポイントは絶対にクライアントへ出さない ADMIN_EXPORT_SECRET（Vercelの
// サーバー専用環境変数）でしか通さない。Supabaseへの問い合わせも SERVICE_ROLE_KEY
// （同じくサーバー専用）を使い、get_churned_users_export() は anon/authenticated に
// 一切 GRANT していない関数を呼ぶ。
//
// 2026-09-30: edge runtimeだとEXPO_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEYが
// 読めず機能停止する、このリポジトリで過去3回発生した既知の不具合パターン
// （api/notify.ts・api/daily-reminder.ts・api/admin-stats.ts）を踏んでいたため、
// 同じくnodejs runtimeに変更する。
export const config = { runtime: 'nodejs' }

export default async function handler(req: any, res: any) {
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

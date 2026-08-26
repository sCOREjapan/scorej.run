// api/admin-churned-users.ts — 離脱ユーザーのメール一覧をCSVで返す（個人情報を扱うため専用の秘密鍵で保護）
//
// app/admin.tsx の管理画面パスワード（EXPO_PUBLIC_ADMIN_PASSWORD）はクライアントの
// JSバンドルに含まれるため、実質的に「秘密」ではない。集計値（人数など）を見せる
// だけならリスクは低いが、実際のメールアドレス一覧はそれとは別次元の情報のため、
// このエンドポイントは絶対にクライアントへ出さない ADMIN_EXPORT_SECRET（Vercelの
// サーバー専用環境変数）でしか通さない。Supabaseへの問い合わせも SERVICE_ROLE_KEY
// （同じくサーバー専用）を使い、get_churned_users_export() は anon/authenticated に
// 一切 GRANT していない関数を呼ぶ。
export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const exportSecret = process.env.ADMIN_EXPORT_SECRET
  if (!exportSecret) {
    return new Response(JSON.stringify({ error: 'ADMIN_EXPORT_SECRET未設定' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
  const incoming = request.headers.get('X-Admin-Export-Secret') ?? ''
  if (incoming !== exportSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl  = process.env.EXPO_PUBLIC_SUPABASE_URL
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Supabase service role未設定' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  let minSessions = 3, inactiveDays = 21
  try {
    const body = await request.json().catch(() => ({})) as { minSessions?: number; inactiveDays?: number }
    if (typeof body.minSessions === 'number') minSessions = body.minSessions
    if (typeof body.inactiveDays === 'number') inactiveDays = body.inactiveDays
  } catch {}

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_churned_users_export`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ p_min_sessions: minSessions, p_inactive_days: inactiveDays }),
    })
    if (!res.ok) {
      const errText = await res.text()
      return new Response(JSON.stringify({ error: `Supabase RPC失敗: ${errText}` }), {
        status: 502, headers: { 'Content-Type': 'application/json' },
      })
    }
    const rows = await res.json() as Array<{
      email: string; name: string; primary_event: string
      total_sessions: number; last_session: string
    }>

    const header = 'email,name,primary_event,total_sessions,last_session'
    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csvLines = rows.map(r =>
      [escape(r.email), escape(r.name), escape(r.primary_event), r.total_sessions, escape(r.last_session)].join(',')
    )
    const csv = [header, ...csvLines].join('\n')

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="churned_users.csv"',
      },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? 'リクエスト失敗' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}

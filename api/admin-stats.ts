// api/admin-stats.ts — 管理画面の集計統計(get_admin_stats/get_retention_cohorts)を返す
//
// 2026-09-30セキュリティ修正: これまでapp/admin.tsxがsupabase.rpc('get_admin_stats')/
// supabase.rpc('get_retention_cohorts')を匿名キーのクライアントから直接呼んでおり、
// 両RPCはSECURITY DEFINERかつanonにGRANTされていて呼び出し側の認可チェックを一切
// 行っていなかった。ゲート役だったEXPO_PUBLIC_ADMIN_PASSWORDはJSバンドルに含まれる
// ため実質「秘密」ではなく、誰でもログイン画面を経由せずRPCを直接叩いて全ユーザー数・
// 有料転換率・チーム成長曲線・D1/D7/D30リテンション等の経営指標を取得できた。
// api/admin-churned-users.ts と同じ ADMIN_EXPORT_SECRET（Vercelのサーバー専用環境変数）
// でしか通さないようにし、RPC自体もSERVICE_ROLE_KEY経由でのみ呼ぶ
// （supabase/fix_admin_rpc_revoke_anon.sql でanon/authenticatedへのGRANTを撤回済み）。
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

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Supabase service role未設定' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  let rpcName: 'get_admin_stats' | 'get_retention_cohorts' = 'get_admin_stats'
  try {
    const body = await request.json().catch(() => ({})) as { rpc?: string }
    if (body.rpc === 'get_retention_cohorts') rpcName = 'get_retention_cohorts'
  } catch {}

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({}),
    })
    if (!res.ok) {
      const errText = await res.text()
      return new Response(JSON.stringify({ error: `Supabase RPC失敗: ${errText}` }), {
        status: 502, headers: { 'Content-Type': 'application/json' },
      })
    }
    const data = await res.json()
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? 'リクエスト失敗' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}

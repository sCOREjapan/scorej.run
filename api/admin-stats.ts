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
//
// 2026-09-30追記: 初版はruntime:'edge'で書いたが、このプロジェクトでは
// EXPO_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEYがedge runtimeから読めず
// 本番で無言のまま機能停止する不具合が過去に2回実際に発生している
// (api/notify.ts、api/daily-reminder.tsのコメント参照)。同じ地雷を踏むため
// 他の全エンドポイントに合わせてnodejs runtimeに変更する。
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

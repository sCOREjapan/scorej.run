// api/notify.ts — Vercel Node.js Function でチームのプッシュ通知を送信
//
// 2026-09-09: OneSignalベースの実装は、ネイティブ端末が一度もOneSignal購読者として
// 登録されない(lib/notify.ts参照)ため実質0件配信だった。Expo Push Notification
// サービス(Supabaseのteam_push_tokensに登録済みのExpo Push Token宛)へ切り替える。
// 2026-09-09追記: 当初はedge runtimeで書いたが、本番で動作確認したところ
// EXPO_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEYがedge runtimeからは
// 読めておらず（{"skipped":true,"reason":"Supabase not configured"}を返し続けた）
// 常に0件配信になっていた。同じ2変数をnodejs runtimeで確実に読めている
// api/delete-account.ts/api/revenuecat-webhook.tsに合わせ、nodejs runtimeに変更。
export const config = { runtime: 'nodejs' }

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed')
    return
  }

  // ── 共有シークレット認証（APP_SECRET が設定されている場合のみ検証） ──
  const appSecret = process.env.APP_SECRET
  if (appSecret) {
    const incoming = req.headers?.['x-app-secret'] ?? ''
    if (incoming !== appSecret) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(200).json({ skipped: true, reason: 'Supabase not configured' })
    return
  }

  let title: string, message: string, target: 'players' | 'coaches' | 'all', teamCode: string | undefined
  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as { title: string; message: string; target: 'players' | 'coaches' | 'all'; teamCode?: string }
    title = body.title; message = body.message; target = body.target; teamCode = body.teamCode
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  if (!teamCode) {
    res.status(400).json({ error: 'teamCode required' })
    return
  }

  // 2026-09-30セキュリティ修正: 選手→コーチ(target='coaches')は選手が自分のチームに
  // 対して行う正当な日常操作(動画送信・痛み報告等)のためteam_codeのみで許可するが、
  // コーチ→選手(target='players')は1回の呼び出しでチーム全員の端末に配信される
  // 影響範囲の大きい操作のため、参加コードとは別のコーチ端末だけが持つ秘密値
  // (X-Coach-Secret。lib/teamKeys.tsのgetOrCreateCoachSecret、teams.coach_secretと
  // 対応)の一致を追加で要求する。coach_secretがまだ無い(この修正より前に作られた)
  // レガシーチームは、現状からの後退にならないよう従来通り通す。
  if (target === 'players') {
    try {
      const teamRes = await fetch(
        `${SUPABASE_URL}/rest/v1/teams?select=coach_secret&code=eq.${encodeURIComponent(teamCode)}`,
        { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
      )
      const teamRows = await teamRes.json().catch(() => []) as { coach_secret: string | null }[]
      const coachSecret = teamRows?.[0]?.coach_secret ?? null
      const incomingCoachSecret = req.headers?.['x-coach-secret'] ?? ''
      if (coachSecret && incomingCoachSecret !== coachSecret) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
    } catch (e: any) {
      res.status(500).json({ error: `coach secret verification failed: ${e?.message ?? e}` })
      return
    }
  }

  // team_push_tokensから対象トークンを取得（service_roleでRLSをバイパスして直接読む）
  const roleFilter = target === 'players' ? '&role=eq.player' : target === 'coaches' ? '&role=eq.coach' : ''
  const url = `${SUPABASE_URL}/rest/v1/team_push_tokens?select=push_token&team_code=eq.${encodeURIComponent(teamCode)}${roleFilter}`
  let tokens: string[] = []
  try {
    const tokenRes = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    })
    const rows = await tokenRes.json() as { push_token: string }[]
    tokens = Array.isArray(rows) ? rows.map(r => r.push_token) : []
  } catch (e: any) {
    res.status(500).json({ error: `token fetch failed: ${e?.message ?? e}` })
    return
  }

  if (tokens.length === 0) {
    res.status(200).json({ sent: 0, reason: 'no registered tokens' })
    return
  }

  // Expo Push APIは1リクエストあたり最大100件まで推奨のためチャンク分割
  const chunks: string[][] = []
  for (let i = 0; i < tokens.length; i += 100) chunks.push(tokens.slice(i, i + 100))

  const results: any[] = []
  try {
    for (const chunk of chunks) {
      const messages = chunk.map(to => ({
        to, title, body: message,
        data: { teamCode, url: 'score://team' },
        sound: 'default' as const,
      }))
      const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      })
      results.push(await pushRes.json())
    }
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Expo push request failed' })
    return
  }

  res.status(200).json({ sent: tokens.length, results })
}

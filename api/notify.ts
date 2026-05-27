// api/notify.ts — Vercel Edge Function でプッシュ通知を送信
export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // ── 共有シークレット認証（APP_SECRET が設定されている場合のみ検証） ──
  const appSecret = process.env.APP_SECRET
  if (appSecret) {
    const incoming = request.headers.get('X-App-Secret') ?? ''
    if (incoming !== appSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  const appId  = process.env.ONESIGNAL_APP_ID
  const apiKey = process.env.ONESIGNAL_REST_API_KEY

  // 未設定の場合はスキップ（エラーにしない）
  if (!appId || !apiKey) {
    return new Response(JSON.stringify({ skipped: true, reason: 'OneSignal not configured' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let title: string, message: string, target: 'players' | 'coaches' | 'all', teamCode: string | undefined
  try {
    const body = await request.json() as { title: string; message: string; target: 'players' | 'coaches' | 'all'; teamCode?: string }
    title = body.title; message = body.message; target = body.target; teamCode = body.teamCode
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // ロール + チームコードで絞り込む
  const filters: object[] = []
  if (target === 'players' || target === 'coaches') {
    const role = target === 'players' ? 'player' : 'coach'
    filters.push({ field: 'tag', key: 'role', relation: '=', value: role })
    if (teamCode) {
      filters.push({ operator: 'AND' })
      filters.push({ field: 'tag', key: 'teamCode', relation: '=', value: teamCode })
    }
  }

  const payload: Record<string, unknown> = {
    app_id:   appId,
    headings: { en: title, ja: title },
    contents: { en: message, ja: message },
    url:      'https://scorej-run.vercel.app/(tabs)/team',
  }

  if (filters.length > 0) {
    payload.filters = filters
  } else {
    payload.included_segments = ['All']
  }

  try {
    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Basic ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? 'OneSignal request failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}

// api/analyze.ts — Anthropic API proxy (Vercel Edge Function)
// ANTHROPIC_API_KEY を Vercel の環境変数に設定してください（EXPO_PUBLIC_ なしで）
export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await request.json()
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })

    const data = await res.json()
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? 'Unknown error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}

// api/daily-reminder.ts — 毎日19時に練習記録リマインダーを送信（Vercel Cron）
export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  const appId  = process.env.ONESIGNAL_APP_ID
  const apiKey = process.env.ONESIGNAL_REST_API_KEY

  if (!appId || !apiKey) {
    return new Response(JSON.stringify({ skipped: true, reason: 'OneSignal not configured' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const payload = {
    app_id:            appId,
    headings:          { en: '📝 sCORE', ja: '📝 sCORE' },
    contents:          { en: '今日の練習を記録しましょう 💪', ja: '今日の練習を記録しましょう 💪' },
    url:               'https://track-mate-murex.vercel.app',
    included_segments: ['All'],
  }

  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method:  'POST',
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
}

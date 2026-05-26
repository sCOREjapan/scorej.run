// api/daily-reminder.ts — Vercel Cron 通知ハンドラー
// スケジュール（JST）:
//   morning  → 毎朝  7:00（UTC 22:00 前日）
//   practice → 毎夕 17:00（UTC  8:00）
//   sleep    → 毎晩 20:00（UTC 11:00）
export const config = { runtime: 'edge' }

interface NotifContent {
  heading: string
  body:    string
  tag:     string
}

const CONTENTS: Record<string, NotifContent> = {
  morning: {
    heading: 'sCORE 🟢 おはようございます！',
    body:    '今日の怪我リスクを確認しましょう。記録を続けることで精度が上がります。',
    tag:     'morning',
  },
  practice: {
    heading: 'sCORE 📝 練習を記録しよう',
    body:    '今日の練習はもう記録しましたか？記録するとAIがより精度の高いアドバイスを提供します。',
    tag:     'practice',
  },
  sleep: {
    heading: 'sCORE 💤 そろそろ寝ましょう',
    body:    '23時までに就寝すると明日の怪我リスクが下がります。今夜は7〜8時間の睡眠を目指そう。',
    tag:     'sleep',
  },
}

export default async function handler(request: Request): Promise<Response> {
  const appId  = process.env.ONESIGNAL_APP_ID
  const apiKey = process.env.ONESIGNAL_REST_API_KEY

  if (!appId || !apiKey) {
    return new Response(JSON.stringify({ skipped: true, reason: 'OneSignal not configured' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ?type= パラメータで通知種別を切り替え（デフォルト: practice）
  const url  = new URL(request.url)
  const type = url.searchParams.get('type') ?? 'practice'
  const notif = CONTENTS[type] ?? CONTENTS.practice

  const payload = {
    app_id:            appId,
    headings:          { en: notif.heading, ja: notif.heading },
    contents:          { en: notif.body,    ja: notif.body    },
    url:               'https://scorej-run.vercel.app',
    included_segments: ['All'],
    web_push_topic:    notif.tag,   // 同じタグは1日1回に集約
  }

  try {
    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Basic ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    return new Response(JSON.stringify({ type, ...data }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? 'OneSignal request failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}

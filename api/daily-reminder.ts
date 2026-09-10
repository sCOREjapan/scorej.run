// api/daily-reminder.ts — Vercel Cron 通知ハンドラー
// スケジュール（JST）:
//   morning  → 毎朝  7:00（UTC 22:00 前日）
//   practice → 毎夕 17:00（UTC  8:00）
//   sleep    → 毎晩 20:00（UTC 11:00）
//
// 2026-09-09: OneSignal Web SDK専用の実装だったため、ネイティブ端末には
// OneSignalのSDKが入っておらず実質0件配信だった（lib/notify.ts参照）。
// user_push_tokens(supabase/add_user_push_tokens.sql)に登録されたExpo Push Token
// 宛にExpo Push Notificationサービスで配信する方式へ切り替える。
// 2026-09-09追記: 当初はedge runtimeで書いたが、本番で動作確認したところ
// EXPO_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEYがedge runtimeからは
// 読めておらず常に0件配信になっていた（api/notify.ts参照）。nodejs runtimeに変更。
export const config = { runtime: 'nodejs' }

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

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

export default async function handler(req: any, res: any) {
  // ── Vercel Cron 認証（CRON_SECRET が設定されている場合のみ検証） ──
  // Vercel は cron 呼び出し時に Authorization: Bearer <CRON_SECRET> を自動付与する
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers?.['authorization'] ?? ''
    if (auth !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(200).json({ skipped: true, reason: 'Supabase not configured' })
    return
  }

  const type = (req.query?.type as string) ?? 'practice'
  const notif = CONTENTS[type] ?? CONTENTS.practice

  // 全ユーザーのExpo Push Tokenを取得（service_roleでRLSをバイパス）
  let tokens: string[] = []
  try {
    const tokenRes = await fetch(`${SUPABASE_URL}/rest/v1/user_push_tokens?select=push_token`, {
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
    res.status(200).json({ type, sent: 0, reason: 'no registered tokens' })
    return
  }

  const chunks: string[][] = []
  for (let i = 0; i < tokens.length; i += 100) chunks.push(tokens.slice(i, i + 100))

  const results: any[] = []
  try {
    for (const chunk of chunks) {
      const messages = chunk.map(to => ({
        to, title: notif.heading, body: notif.body,
        data: { tag: notif.tag, url: 'score://(tabs)' },
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

  res.status(200).json({ type, sent: tokens.length, results })
}

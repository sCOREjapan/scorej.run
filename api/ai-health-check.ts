// api/ai-health-check.ts — AIモデルの日次死活監視 (Vercel Cron)
//
// 2026-09-09: 「gemini-3-flash-previewが2026-07-15に廃止されて以降ずっと404を
// 返し続け、約1ヶ月間AI機能が実質全滅していたことに誰も気づかなかった」事故
// （api/analyze.ts冒頭コメント参照）の再発防止。
// Gemini本番/軽量モデルへ固定の軽量プロンプトを送り、結果をai_health_checksテーブルに
// 記録する（2026-09-24: Anthropicフォールバック撤去に伴いAnthropicチェックも削除。
// api/analyze.ts冒頭コメント参照）。1つでも失敗すればHTTP 500を返す
// ——Vercelのcronダッシュボードで失敗として記録され、Vercelプランによっては
// メール通知の対象になる。専用のWebhook/メール送信サービスは未導入のため、
// 「開発者に能動的にプッシュ通知する」までは実装していない
// （必要ならDiscord Webhook等を導入して拡張する）。
export const config = { runtime: 'nodejs' }
export const maxDuration = 30

const GEMINI_MODEL      = 'gemini-3.5-flash'
const GEMINI_MODEL_LITE = 'gemini-3.5-flash-lite'
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const TEST_PROMPT = '「ok」という文字列だけを含むJSON({"status":"ok"})を出力してください。説明や装飾は不要です。'

async function logResult(provider: string, ok: boolean, latencyMs: number | null, error: string | null) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/ai_health_checks`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ provider, ok, latency_ms: latencyMs, error }),
    })
  } catch { /* ログ失敗はチェック自体の結果に影響させない */ }
}

async function checkGemini(model: string, apiKey: string): Promise<{ ok: boolean; error: string | null; latencyMs: number }> {
  const started = Date.now()
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: TEST_PROMPT }] }] }),
      },
    )
    const latencyMs = Date.now() - started
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status}: ${errText.slice(0, 300)}`, latencyMs }
    }
    const data = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? ''
    if (!text.trim()) return { ok: false, error: 'empty response', latencyMs }
    return { ok: true, error: null, latencyMs }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e), latencyMs: Date.now() - started }
  }
}

export default async function handler(req: any, res: any) {
  // 2026-10-07: CRON_SECRET が本番に未設定のため、以前はこのURLを誰でも叩けた(全端末へ通知を送れる/
  // Geminiを呼ばせられる)。CRON_SECRET を設定すれば Vercel の cron が自動で Authorization: Bearer を付けるので
  // 完全に守られる。未設定の間は、少なくとも Vercel の cron 以外(User-Agent が vercel-cron/ でない呼び出し)は
  // 拒否する(User-Agent は偽装できるため、これは暫定。`vercel env add CRON_SECRET production` を必ず設定すること)。
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers?.['authorization'] ?? ''
    if (auth !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
  } else {
    const ua = String(req.headers?.['user-agent'] ?? '')
    if (!ua.startsWith('vercel-cron/')) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    console.warn('[cron] CRON_SECRET is not set; accepting by user-agent only')
  }

  const geminiKey = process.env.GEMINI_API_KEY

  const checks: Record<string, { ok: boolean; error: string | null; latencyMs: number }> = {}

  if (geminiKey) {
    checks.gemini_main = await checkGemini(GEMINI_MODEL, geminiKey)
    checks.gemini_lite = await checkGemini(GEMINI_MODEL_LITE, geminiKey)
  }

  await Promise.all(
    Object.entries(checks).map(([provider, r]) => logResult(provider, r.ok, r.latencyMs, r.error)),
  )

  const anyFailed = Object.values(checks).some(r => !r.ok)
  res.status(anyFailed ? 500 : 200).json({ checks })
}

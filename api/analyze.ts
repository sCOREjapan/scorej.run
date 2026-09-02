// api/analyze.ts — AI分析プロキシ (Vercel Node.js Serverless Function)
// 2026-07-28: 動画分析(複数画像+大きめのJSON応答)がEdge Functionの実行時間上限
// (maxDurationの設定値に関わらず実測25秒前後で強制打ち切り)に達し504になる不具合が
// 発生したため、Node.js runtimeに変更。maxDuration=60はNode.js runtimeでのみ有効。
// ⚠️ Node.js runtimeでは (req, res) 形式のハンドラを使うこと。Fetch API形式
// (request: Request) => Response) のままruntimeだけnodejsに変えると、関数が
// レスポンスを返せず全リクエストがハングする（2026-07-28に実際に発生・復旧済み）。
//
// ルーティング方針（2026-07 Gemini全面移行）:
//   GEMINI_API_KEY が設定されていれば全AI機能（動画分析・食事分析・大会プラン・
//   リカバリー助言・週次サマリー・怪我復帰プラン）を Gemini に振り分ける。
//   クライアント側（lib/claude.ts）は無改修 — リクエスト/レスポンスは Anthropic Messages API 形式のまま。
//   GEMINI_API_KEY未設定時は自動的に全リクエストが従来のAnthropic経路にフォールバックする。
//   ⚠️ 2026-07-25: gemini-2.5-flash が新規キーで404（新規ユーザーには提供終了）になったため
//   gemini-3-flash-preview に切替。→ その gemini-3-flash-preview も2026-07-15に廃止され、
//   以降ずっと404を返し続けていたことが2026-08-27に発覚（Instagram DM経由のユーザー報告で判明。
//   下のAnthropicフォールバックが機能していなかった/ANTHROPIC_API_KEY未設定だった可能性が高く、
//   約1ヶ月間、動画分析等のAI機能が実質的に全滅していたとみられる）。gemini-3.5-flash に切替済み。
//   Geminiのモデル世代交代が非常に速いため、404が再発したら
//   generativelanguage.googleapis.com/v1beta/models?key=... で実際に呼べるモデルを確認し、
//   この定数だけ差し替えること。あわせて、Anthropicフォールバックが実際に機能しているか
//   （ANTHROPIC_API_KEYがVercelの環境変数に設定・有効か）も定期的に確認すること。
export const config = { runtime: 'nodejs' }
export const maxDuration = 60

const GEMINI_MODEL = 'gemini-3.5-flash'

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

interface AnthropicRequestBody {
  model?: string
  max_tokens?: number
  system?: string
  messages?: AnthropicMessage[]
  // 2026-09-01: サーバー側チケット消費強制のため追加。lib/ticketWallet.ts の
  // TicketFeature と合わせること。recovery/injury_recovery は無料開放機能のため含めない
  feature?: string
}

// lib/ticketWallet.ts の TICKET_COST と同じ値に保つこと（recovery/injury_recovery は
// adGate.ts 側で無料開放されており、実際にはチケット消費されないためここには含めない）
const TICKET_COST_SERVER: Record<string, number> = {
  video: 2, workout: 2, meal: 1,
  ai_analysis: 2, meal_coach: 2, daily_insight: 1,
  notebook_ai: 1, competition_plan: 3,
}
// lib/adGate.ts の TICKET_SYSTEM_CUTOVER と一致させる
const TICKET_SYSTEM_CUTOVER = new Date('2026-08-06T00:00:00.000Z')

interface ProxyResult {
  status: number
  body: any
}

// Anthropic Messages形式 → Gemini generateContent形式に変換
function toGeminiRequest(body: AnthropicRequestBody) {
  const contents = (body.messages ?? []).map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: typeof msg.content === 'string'
      ? [{ text: msg.content }]
      : msg.content.map(block =>
          block.type === 'image'
            ? { inline_data: { mime_type: block.source.media_type, data: block.source.data } }
            : { text: block.text }
        ),
  }))

  return {
    ...(body.system ? { system_instruction: { parts: [{ text: body.system }] } } : {}),
    contents,
    generationConfig: {
      maxOutputTokens: body.max_tokens ?? 2048,
      // JSON抽出タスクに思考は不要。無効化しないとthinkingトークンが非表示のまま出力課金され、
      // 想定コスト削減効果が崩れるため明示的にオフにする。
      thinkingConfig: { thinkingBudget: 0 },
    },
  }
}

// Gemini応答 → Anthropic Messages形式のレスポンスに変換（lib/claude.ts の解析コードをそのまま通すため）
function fromGeminiResponse(data: any): { content: Array<{ type: 'text'; text: string }> } {
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? ''
  return { content: [{ type: 'text', text }] }
}

async function callGemini(body: AnthropicRequestBody, apiKey: string): Promise<ProxyResult> {
  const geminiBody = toGeminiRequest(body)
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    }
  )

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    return { status: res.status, body: { error: `Gemini API エラー (${res.status}): ${errText}` } }
  }

  const data = await res.json()
  return { status: 200, body: fromGeminiResponse(data) }
}

async function callAnthropic(body: AnthropicRequestBody, apiKey: string): Promise<ProxyResult> {
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
  return { status: res.status, body: data }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed')
    return
  }

  // ── 共有シークレット認証（APP_SECRET が設定されている場合のみ検証） ──
  // Vercel 環境変数 APP_SECRET をセットすることで不正利用を防止する
  const appSecret = process.env.APP_SECRET
  if (appSecret) {
    const incoming = req.headers?.['x-app-secret'] ?? ''
    if (incoming !== appSecret) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as AnthropicRequestBody

    // ── ペイロード上限チェック（APP_SECRET未設定でも効く安全弁） ──
    // 2026-08-29に判明: このエンドポイントはAPP_SECRET未設定だと認証なしで誰でも叩ける状態
    // だった。正規クライアントは画像最大6枚(動画分析)・メッセージ1件しか送らないため、
    // 十分な余裕を持たせた上限を超えるリクエストは弾く。認証の有無に関わらず被害の上限を
    // 絞るための対策で、正規利用への影響はない。
    const MAX_IMAGES = 12
    const MAX_MESSAGES = 4
    const MAX_BASE64_CHARS = 20_000_000 // 概算20MB相当
    const messages = body?.messages ?? []
    if (messages.length > MAX_MESSAGES) {
      res.status(400).json({ error: 'Too many messages' })
      return
    }
    let imageCount = 0
    let base64Total = 0
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const block of msg.content) {
        if (block?.type === 'image') {
          imageCount++
          base64Total += block?.source?.data?.length ?? 0
        }
      }
    }
    if (imageCount > MAX_IMAGES || base64Total > MAX_BASE64_CHARS) {
      res.status(400).json({ error: 'Payload too large' })
      return
    }

    // ── サーバー側でのtier検証・チケット消費強制 ──
    // 2026-09-01に判明: tier判定(coach/noad等)が端末ローカルキャッシュのみに依存しており、
    // Web版はブラウザのlocalStorageを書き換えるだけで「coach(無制限)」を自称してチケット消費を
    // 完全に回避できる状態だった。サーバー側は一切検証していなかった。
    // ログイン中のユーザーについては、ここでサーバー側の真実(subscription_status。
    // api/revenuecat-webhook.ts経由でRevenueCatと同期)を見て、tier免除対象でなければ
    // チケット消費をサーバー側で強制する。subscription_statusにまだ行が無い
    // (webhookが一度も届いていない)ユーザーは、既存の有料ユーザーを誤ってブロックしないよう
    // 従来通りクライアントの自己申告を信用する(fail open。行が無い＝freeとは絶対に扱わない)。
    const authHeader: string = req.headers?.['authorization'] ?? ''
    const feature = body?.feature
    if (authHeader.startsWith('Bearer ') && typeof feature === 'string' && TICKET_COST_SERVER[feature]) {
      const token = authHeader.slice('Bearer '.length)
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
      if (supabaseUrl && anonKey) {
        try {
          const { createClient } = await import('@supabase/supabase-js')
          const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: `Bearer ${token}` } },
          })
          const { data: userData } = await userClient.auth.getUser(token)
          const userId = userData?.user?.id
          if (userId) {
            const { data: statusRow } = await userClient
              .from('subscription_status').select('tier, original_purchase_date')
              .eq('user_id', userId).maybeSingle()
            if (statusRow) {
              const isLegacyNoad = statusRow.tier === 'noad'
                && !!statusRow.original_purchase_date
                && new Date(statusRow.original_purchase_date) < TICKET_SYSTEM_CUTOVER
              const isExempt = statusRow.tier === 'coach' || isLegacyNoad
              if (!isExempt) {
                // 消費はクライアント側(recordUsage)が成功後に行う既存フローと二重消費に
                // ならないよう、ここでは残高の読み取り確認のみ行う(消費はしない)。
                // tier詐称があっても、残高不足なら高コストなAI呼び出し自体をここで止められる。
                const { data: wallet } = await userClient
                  .from('ticket_wallets').select('tickets').eq('user_id', userId).maybeSingle()
                const balance = wallet?.tickets ?? 0
                if (balance < TICKET_COST_SERVER[feature]) {
                  res.status(402).json({ error: 'チケットが不足しています' })
                  return
                }
              }
            }
            // statusRow が無い(webhook未同期)場合は何もしない＝クライアントの自己申告を信用する
          }
        } catch (e) {
          console.warn('[analyze] tier verification failed, falling back to client-trust:', e)
        }
      }
    }

    // featureはこのプロキシ内でのtier検証専用のフィールドで、Anthropic/Geminiの実APIは
    // 知らない。callAnthropicはbodyをそのまま転送するため、消し忘れると本物のAPIから
    // 「未知のフィールド」として400 invalid_request_errorで拒否される
    // (2026-09-02に実際に発生、全AI機能が停止した)。
    delete (body as any).feature

    // max_tokens を 4096 に上限設定（意図しない高コスト呼び出しを防止／出力は入力の5倍高いため上限を絞る）。
    // 2026-08-29: 3000のままだと、動画分析のレーダーチャート方式スキーマ(7項目×詳細な理由文+
    // strength/focus/nextStep/practice)で、実際の走行フォーム画像(情報量が多い)を渡すと応答が
    // 途中で切れてJSONパース失敗になる不具合が発生。gemini-3.5-flashへの切替でモデルの応答の
    // 冗長さが変わったことも一因とみられる。4096に引き上げて余裕を持たせる。
    if (body && typeof body.max_tokens === 'number' && body.max_tokens > 4096) {
      body.max_tokens = 4096
    }

    // GEMINI_API_KEY があれば全リクエストを Gemini に振り分ける（コスト優先）。
    // ただし無予告のモデル退役・一時障害でGeminiがエラーを返した場合は、
    // その場でAnthropicへ自動フォールバックする（2026-07-25にgemini-2.5-flashが
    // 無予告で404になった際、手動でモデル定数を書き換えるまで全AI機能が止まった
    // 教訓を踏まえた対応。フォールバックは失敗時のみ発生するため通常時のコストは変わらない）。
    const geminiKey = process.env.GEMINI_API_KEY
    const anthropicKey = process.env.ANTHROPIC_API_KEY ?? process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY
    let result: ProxyResult
    if (geminiKey) {
      result = await callGemini(body, geminiKey)
      // ステータス200でもセーフティフィルタ等で本文が空のことがあり、その場合は
      // クライアントが「空応答なのに課金・キャッシュされる」不具合の温床になるため
      // エラー扱いと同様にAnthropicへフォールバックする。
      const geminiText = (result.body as any)?.content?.[0]?.text
      const isEmpty = result.status === 200 && (!geminiText || !String(geminiText).trim())
      if ((result.status >= 400 || isEmpty) && anthropicKey) {
        console.warn('[analyze] Gemini failed or returned empty content, falling back to Anthropic:', result.status)
        result = await callAnthropic(body, anthropicKey)
      }
    } else {
      if (!anthropicKey) {
        res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })
        return
      }
      result = await callAnthropic(body, anthropicKey)
    }
    res.status(result.status).json(result.body)
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Unknown error' })
  }
}

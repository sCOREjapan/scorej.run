// api/analyze.ts — AI分析プロキシ (Vercel Edge Function)
// Edge ランタイムを使用: グローバル分散・低レイテンシ・fetch/Request/Response がネイティブ利用可
//
// ルーティング方針（2026-07 Gemini移行 Phase1）:
//   1メッセージ内に画像が2枚以上含まれるリクエスト＝動画分析（analyzeVideo）とみなし、
//   GEMINI_API_KEY が設定されていれば Gemini 2.5 Flash に振り分ける（コスト目安 -65%）。
//   それ以外（食事分析=画像1枚・大会プラン等のテキスト系）は従来どおり Anthropic Haiku。
//   クライアント側（lib/claude.ts）は無改修 — リクエスト/レスポンスは Anthropic Messages API 形式のまま。
//   GEMINI_API_KEY未設定時は自動的に全リクエストが従来のAnthropic経路にフォールバックする。
//   ⚠️ gemini-2.5-flash は2026-10-16提供終了予定。後継モデルへの差し替えはGEMINI_MODEL定数の変更のみで完結する。
export const config = { runtime: 'edge' }
export const maxDuration = 60

const GEMINI_MODEL = 'gemini-2.5-flash'

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
}

// メッセージ全体に含まれる画像ブロック数をカウント（動画分析＝複数フレーム画像を判定するため）
function countImageBlocks(body: AnthropicRequestBody): number {
  if (!body?.messages) return 0
  let count = 0
  for (const msg of body.messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'image') count++
      }
    }
  }
  return count
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

async function callGemini(body: AnthropicRequestBody, apiKey: string): Promise<Response> {
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
    return new Response(JSON.stringify({ error: `Gemini API エラー (${res.status}): ${errText}` }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const data = await res.json()
  return new Response(JSON.stringify(fromGeminiResponse(data)), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function callAnthropic(body: AnthropicRequestBody, apiKey: string): Promise<Response> {
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
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // ── 共有シークレット認証（APP_SECRET が設定されている場合のみ検証） ──
  // Vercel 環境変数 APP_SECRET をセットすることで不正利用を防止する
  const appSecret = process.env.APP_SECRET
  if (appSecret) {
    const incoming = request.headers.get('X-App-Secret') ?? ''
    if (incoming !== appSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  try {
    const body = (await request.json()) as AnthropicRequestBody
    // max_tokens を 3000 に上限設定（意図しない高コスト呼び出しを防止／出力は入力の5倍高いため上限を絞る）
    if (body && typeof body.max_tokens === 'number' && body.max_tokens > 3000) {
      body.max_tokens = 3000
    }

    // 画像2枚以上＝動画分析。GEMINI_API_KEY があれば Gemini 2.5 Flash に振り分ける
    const geminiKey = process.env.GEMINI_API_KEY
    const isVideoAnalysis = countImageBlocks(body) >= 2
    if (isVideoAnalysis && geminiKey) {
      return await callGemini(body, geminiKey)
    }

    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }
    return await callAnthropic(body, apiKey)
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? 'Unknown error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}

// api/analyze.ts — AI分析プロキシ (Vercel Node.js Serverless Function)
// 2026-07-28: 動画分析(複数画像+大きめのJSON応答)がEdge Functionの実行時間上限
// (maxDurationの設定値に関わらず実測25秒前後で強制打ち切り)に達し504になる不具合が
// 発生したため、Node.js runtimeに変更。maxDuration=60はNode.js runtimeでのみ有効。
// ⚠️ Node.js runtimeでは (req, res) 形式のハンドラを使うこと。Fetch API形式
// (request: Request) => Response) のままruntimeだけnodejsに変えると、関数が
// レスポンスを返せず全リクエストがハングする（2026-07-28に実際に発生・復旧済み）。
//
// ルーティング方針（2026-09-24: Gemini専用に一本化）:
//   全AI機能（動画分析・食事分析・大会プラン・リカバリー助言・週次サマリー・怪我復帰プラン等）
//   は常に Gemini を呼ぶ。クライアント側（lib/claude.ts）は無改修 — リクエスト/レスポンスは
//   Anthropic Messages API 形式のまま（fromGeminiResponse()でその形に変換して返す）。
//   「Anthropicのクレジットはもう使わない」との方針により、以前あったAnthropicへの
//   自動フォールバックは撤去済み。GEMINI_API_KEY未設定/Gemini側の失敗時はそのままエラーを返す。
//   ⚠️ 2026-07-25: gemini-2.5-flash が新規キーで404（新規ユーザーには提供終了）になったため
//   gemini-3-flash-preview に切替。→ その gemini-3-flash-preview も2026-07-15に廃止され、
//   以降ずっと404を返し続けていたことが2026-08-27に発覚（Instagram DM経由のユーザー報告で判明。
//   当時はAnthropicフォールバックがあったが機能しておらず、約1ヶ月間AI機能が実質的に
//   全滅していたとみられる）。gemini-3.5-flash に切替済み。Anthropicフォールバックが
//   無くなった今、Geminiのモデル退役は即座に全AI機能停止に直結するため、404が起きたら
//   generativelanguage.googleapis.com/v1beta/models?key=... で実際に呼べるモデルを確認し、
//   この定数だけ速やかに差し替えること。
export const config = { runtime: 'nodejs' }
export const maxDuration = 60

const GEMINI_MODEL = 'gemini-3.5-flash'
// 2026-09-09: 無料/チケット利用ユーザーには軽量モデル、有料サブスク(coach/レガシーnoad)には
// 現行モデルを使う設計を追加。gemini-3.5-flash-liteで実際にJSON出力の安定性をテスト済み
// （lib/claude.tsの各AI機能と同じプロンプトで3パターン検証、全て正常にJSONを返した）。
// ただし thinkingConfig パラメータを渡すと400 INVALID_ARGUMENTで拒否される
// （lite系モデルはthinking機能自体を持たないため）ので、liteモデル使用時は省略する必要がある
// （toGeminiRequest参照）。
// 画像を送る機能(video/meal)は画像理解の品質差を未検証のため対象外とし、常にGEMINI_MODELを使う。
const GEMINI_MODEL_LITE = 'gemini-3.5-flash-lite'
// 'video_frame' = Web版動画分析のフレームごとの画像分析(課金なし。最後の 'video_web' で1回分だけ課金する)
const IMAGE_FEATURES = new Set(['video', 'meal', 'video_frame'])

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
  // スコッピー会話で「チケット1枚=5メッセージ」の残り回数(クライアントのローカルバンク)を使って送る
  // メッセージかどうか。trueならサーバーは課金しない(最初の1通だけが課金対象)。
  banked?: boolean
}

// lib/adGate.ts の HARD_DAILY_CAP/HARD_MONTHLY_CAP と同じ値に保つこと。
// 2026-09-09: この絶対上限（tier・チケット残高に関係なく悪用/暴走防止のため必ずかかる上限）は
// これまでlib/adGate.tsのcheckAdGate()というクライアント側の事前チェックでしか
// 検証されておらず、/api/analyzeを直接叩けばBearerトークンさえ有効なら無制限に
// AI呼び出しができてしまう抜け穴だった。ここでは（下のチケット残高チェックと同じ方針で）
// 読み取り確認のみ行い、加算はしない — 加算は引き続きクライアント成功後のrecordUsage()
// （lib/adGate.ts）が担う。二重加算を避けるための意図的な設計。
const HARD_DAILY_CAP_SERVER: Record<string, number> = {
  video: 4, meal: 6, ai_analysis: 3, recovery: 2, workout: 3,
  meal_coach: 3, daily_insight: 2, notebook_ai: 6, competition_plan: 3, injury_recovery: 2,
}
const HARD_MONTHLY_CAP_SERVER: Record<string, number> = { video: 20 }

// lib/ticketWallet.ts の TICKET_COST と同じ値に保つこと（recovery/injury_recovery は
// adGate.ts 側で無料開放されており、実際にはチケット消費されないためここには含めない）
//
// 2026-09-07に判明: lib/ticketWallet.ts側で2026-09-03に video/ai_analysis/meal_coach を
// 2→3枚に増額した際、このサーバー側ミラーの更新が漏れていた。結果、残高2枚のユーザーが
// サーバー側の残高チェック(balance < cost)を通過してしまい（2 >= 2の旧値で許可）、
// 実際に高コストなAI API呼び出しが発生した後でクライアント側のspendTicketsForFeature()が
// 残高不足で消費に失敗する、という「APIコストだけ発生してチケットは減らない」抜け穴になっていた。
// 2026-09-09: meal 1→2, daily_insight 1→2, video 3→2 に改定（lib/ticketWallet.ts と同時更新。理由は同ファイル参照）
const TICKET_COST_SERVER: Record<string, number> = {
  video: 2, workout: 2, meal: 2,
  ai_analysis: 3, meal_coach: 3, daily_insight: 2,
  notebook_ai: 1, competition_plan: 3,
  // 2026-10-07: Web版動画分析の総合評価(=1回の分析につき1回だけ送られる)。ネイティブ版 video と同額
  video_web: 2,
  // 2026-09-13: スコッピーとの会話機能。lib/ticketWallet.ts の TICKET_COST と同値
  scoppy_chat: 1,
}
// lib/adGate.ts の TICKET_SYSTEM_CUTOVER と一致させる
const TICKET_SYSTEM_CUTOVER = new Date('2026-08-06T00:00:00.000Z')
// 2026-10-05: コーチ無料体験中の「チケット不要ボーナス枠」(lib/adGate.ts の TRIAL_HARD_DAILY_CAP と
// 同値に保つこと)。この枠は元々クライアント(AsyncStorageのtrialExpiresAt)だけで判定していたが、
// 9/30のサーバー側チケット消費強制が初めて本番に出た結果、サーバーは体験中ユーザーを
// 無料ユーザーとして扱い、枠内の利用でもチケットを引く/残高0なら402で拒否していた。
// サーバーも coach_trials(体験期限)と feature_usage_counts(当日の利用回数)を見て同じ判定をする。
const TRIAL_BONUS_DAILY_CAP_SERVER: Record<string, number> = {
  video: 1, meal: 2, ai_analysis: 1, workout: 1,
  meal_coach: 1, daily_insight: 1, notebook_ai: 2, competition_plan: 1, scoppy_chat: 5, video_web: 1,
}

interface ProxyResult {
  status: number
  body: any
}

// Anthropic Messages形式 → Gemini generateContent形式に変換
// 2026-09-09: liteモデルは thinkingConfig を渡すと400 INVALID_ARGUMENTになるため
// （thinking機能自体を持たないモデルのため）、useLite時は省略する。
//
// 2026-10-05: 動画分析(feature=video)で「AIの応答を解析できませんでした」が頻発していた件。
// 実写真で8回再現テストしたところ約3回に1回、Geminiがstrength/focus/nextStepを
// 「オブジェクト」ではなく配列要素のように
//   "strength":{...},{"id":"focus",...}
// と書いてJSONが壊れていた(プロンプトだけではスキーマ遵守が安定しない)。
// 動画分析だけGeminiの構造化出力(responseMimeType+responseSchema)を使い、形式を保証する。
// dimensionsのidは種目で変わるため、スキーマ上はidを自由な文字列にしてある。
const _bbox = {
  type: 'OBJECT',
  properties: { f: { type: 'NUMBER' }, x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, w: { type: 'NUMBER' }, h: { type: 'NUMBER' } },
  required: ['f', 'x', 'y', 'w', 'h'],
}
const _confidence = { type: 'STRING', enum: ['low', 'medium', 'high'] }
const _card = (withBbox: boolean) => ({
  type: 'OBJECT',
  properties: { title: { type: 'STRING' }, text: { type: 'STRING' }, ...(withBbox ? { bbox: _bbox } : {}) },
  required: ['title', 'text'],
})
const VIDEO_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    score: { type: 'NUMBER' },
    headline: { type: 'STRING' },
    confidenceOverall: _confidence,
    dimensions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING' }, score: { type: 'NUMBER' }, confidence: _confidence, reason: { type: 'STRING' }, bbox: _bbox },
        required: ['id', 'score', 'confidence', 'reason'],
      },
    },
    strength: _card(true),
    focus: _card(true),
    nextStep: _card(false),
    practice: {
      type: 'OBJECT',
      properties: { theme: { type: 'STRING' }, drill: { type: 'STRING' }, drillDetail: { type: 'STRING' } },
      required: ['theme', 'drill', 'drillDetail'],
    },
    frameNotes: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { f: { type: 'NUMBER' }, note: { type: 'STRING' } }, required: ['f', 'note'] },
    },
  },
  required: ['score', 'headline', 'confidenceOverall', 'dimensions', 'strength', 'focus', 'nextStep', 'practice'],
}

function toGeminiRequest(body: AnthropicRequestBody, useLite: boolean, responseSchema?: object) {
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
      // 想定コスト削減効果が崩れるため明示的にオフにする（liteモデルはパラメータ自体非対応）。
      ...(useLite ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
      ...(responseSchema ? { responseMimeType: 'application/json', responseSchema } : {}),
    },
  }
}

// Gemini応答 → Anthropic Messages形式のレスポンスに変換（lib/claude.ts の解析コードをそのまま通すため）
// 2026-09-13: finishReasonを握りつぶしていたため、クライアント側は「JSONが途中で切れて
// パース失敗した」場合と「そもそも変な応答だった」場合を区別できなかった。Anthropicは
// もともとトップレベルに stop_reason（'max_tokens'等）を返すので、GeminiのfinishReasonも
// 同じ形に変換して合わせる。これでクライアントは呼び出し先(Gemini/Anthropic)を意識せず
// 「max_tokensで切れたか」だけを見て、途中で切れた場合の自動リトライ等ができる。
function fromGeminiResponse(data: any): { content: Array<{ type: 'text'; text: string }>; stop_reason: string } {
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? ''
  const finishReason = data?.candidates?.[0]?.finishReason
  return { content: [{ type: 'text', text }], stop_reason: finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn' }
}

// 2026-10-07: Gemini呼び出しにタイムアウトが無く、応答が遅い時は関数全体(maxDuration=60s)が
// 強制終了されてチケットの払い戻し処理まで到達できなかった（課金されたまま結果なし）。
// 1回ごとにタイムアウトを設け、超過時は例外→呼び出し側でチケットを払い戻して504を返す。
const FUNCTION_BUDGET_MS = 55_000 // maxDuration(60s)より少し手前で自分から諦める
const GEMINI_CALL_TIMEOUT_MS = 40_000
const MIN_RETRY_BUDGET_MS = 20_000 // 残り時間がこれ未満なら再試行しない

async function callGemini(body: AnthropicRequestBody, apiKey: string, useLite: boolean, responseSchema?: object, timeoutMs: number = GEMINI_CALL_TIMEOUT_MS): Promise<ProxyResult> {
  const model = useLite ? GEMINI_MODEL_LITE : GEMINI_MODEL
  const geminiBody = toGeminiRequest(body, useLite, responseSchema)
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
      signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
    }
  )

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    return { status: res.status, body: { error: `Gemini API エラー (${res.status}): ${errText}` } }
  }

  const data = await res.json()
  return { status: 200, body: fromGeminiResponse(data) }
}

// ── IP/分の簡易バーストガード + 同一リクエストの短時間重複防止 ──
// 2026-09-09: どちらもVercelのNode.jsサーバーレス関数はウォームインスタンスの間
// モジュールスコープの変数を保持する（コールドスタートでリセットされる）ことを
// 利用したベストエフォート実装。Redis/KV等の永続ストアは未導入のため、複数
// インスタンスに分散された場合は完全には防げないが、ループ状の連打・誤操作による
// 二重送信を実用上十分に抑止できる。定期的にエントリを間引いてメモリを解放する。
const _ipHits = new Map<string, number[]>()
const IP_WINDOW_MS = 60_000
const IP_MAX_PER_MIN = 20
function isIpRateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (_ipHits.get(ip) ?? []).filter(t => now - t < IP_WINDOW_MS)
  hits.push(now)
  _ipHits.set(ip, hits)
  if (_ipHits.size > 5000) { // メモリ膨張防止（異常系の簡易ガード）
    for (const [k, v] of _ipHits) if (v.every(t => now - t > IP_WINDOW_MS)) _ipHits.delete(k)
  }
  return hits.length > IP_MAX_PER_MIN
}

const _recentRequests = new Map<string, number>()
const DEDUP_WINDOW_MS = 8_000 // ダブルタップ・クライアント自動リトライ程度の短時間重複を想定
function isDuplicateRequest(key: string): boolean {
  const now = Date.now()
  for (const [k, t] of _recentRequests) if (now - t > DEDUP_WINDOW_MS) _recentRequests.delete(k)
  const last = _recentRequests.get(key)
  _recentRequests.set(key, now)
  return typeof last === 'number' && now - last < DEDUP_WINDOW_MS
}

// 2026-10-07: 大会プランは長い期間を3週間ずつ複数回のリクエストに分けて生成する
// (lib/claude.ts generateCompetitionPlan。遠い週→近い週の順で、依頼文に「のうち、week_number=8・7・6」の
// ように週番号を列挙する)。以前は各リクエストが別々に3枚ずつ課金され、4〜8週間先の大会だと
// 6〜9枚かかっていた(表示は3枚)。分割リクエストは「week_number=1(試合直前週)を含む最後の1回」だけを
// 課金対象にする。途中のリクエストが失敗しても課金されず、古いバージョンのアプリにもサーバー側だけで効く。
// ⚠️ 依頼文の書式(lib/claude.ts)を変える時は、ここの正規表現も合わせること。
function isNonFinalCompetitionChunk(body: AnthropicRequestBody): boolean {
  const msgs = body.messages ?? []
  let last: AnthropicMessage | undefined
  for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].role === 'user') { last = msgs[i]; break } }
  if (!last) return false
  const text = typeof last.content === 'string'
    ? last.content
    : last.content.map(b => (b.type === 'text' ? b.text : '')).join('')
  const found = [...text.matchAll(/のうち、week_number=([0-9・]+)/g)]
  if (found.length === 0) return false
  const weeks = found[found.length - 1][1].split('・').map(Number).filter(n => Number.isFinite(n))
  return weeks.length > 0 && !weeks.includes(1)
}

export default async function handler(req: any, res: any) {
  // 2026-09-13: スコッピー会話機能のデバッグ中に発覚。このAPIはOPTIONSプリフライトに
  // 一切応答しておらず(即405)、かつCORSヘッダーも返していなかった。ネイティブアプリの
  // fetch()はCORSの対象外なので気づかれなかったが、Web版(localhost:8082等の開発環境や、
  // 将来別オリジンから叩くケース)でContent-Type: application/json付きのPOSTを送ると
  // ブラウザが先に送るOPTIONSプリフライトが405で弾かれ、実際のPOSTが送信される前に
  // ブラウザ側で「Failed to fetch」として握りつぶされる（本番のscorej-run.vercel.app
  // 自身から見れば同一オリジンなので問題化していなかった）。
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-App-Secret')
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed')
    return
  }

  // ── IP/分のバーストガード（無効化済み） ──
  // 2026-09-10: 当初 IP_MAX_PER_MIN=20 で有効化したが、モバイル回線はキャリアグレードNATで
  // 多数の実ユーザーが同一の egress IP を共有するため、正規ユーザーが巻き添えで429になり
  // 「AI機能が全て使えない」という本番障害を起こした。IP単位の制限は実用にならないため無効化。
  // 悪用対策は「ペイロード上限チェック(下)」＋「チケット残高チェック(tier検証ブロック内)」＋
  // クライアント側 lib/adGate.ts の checkAdGate() に一本化する。
  void isIpRateLimited

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

  const startedAt = Date.now()
  const remainingMs = () => FUNCTION_BUDGET_MS - (Date.now() - startedAt)

  // 2026-09-30セキュリティ修正: サーバー自身がticketを消費する唯一の主体になったため、
  // Gemini呼び出しが失敗した場合に払い戻せるよう、消費に使ったクライアント/金額を
  // 外側のスコープで保持しておく。
  // 2026-10-07: 以前はここがtryの中にあり、①払い戻しの書き方が誤っていて(下記)一度も実行されず、
  // ②Geminiの通信エラー/タイムアウトで例外になると外側のcatchまで払い戻しが届かなかった。
  // 外側のスコープに出し、どの失敗経路(例外含む)からも refundTicket() を呼べるようにした。
  let spentTicketClient: any = null
  let spentTicketAmount = 0
  // 払い戻し。supabase-jsのrpc()は PostgrestBuilder で、.then しか持たず .catch が無い。
  // 以前の `rpc(...).catch(() => {})` は呼ぶ前にTypeErrorで落ち、払い戻しは一度も送信されず、
  // 失敗した利用者に「...catch is not a function」の500が返っていた。必ず await して error を見る。
  const refundTicket = async (bypassCap: boolean) => {
    if (!spentTicketClient) return
    const client = spentTicketClient
    spentTicketClient = null // 二重払い戻し防止
    // 2026-09-30セキュリティ修正: 意図的に非JSON応答を誘発して「1回の消費でGeminiに2回無料アクセス」を
    // 繰り返す悪用を抑えるため、HTTP 200の応答不良(空/非JSON/途中切れ)による払い戻しは1日の上限を設ける。
    // 2026-10-07: 上限はGemini側の障害(5xx/429/404)や通信エラー・タイムアウトには適用しない
    // (利用者が起こせない失敗であり、生成コストも発生していないため)。
    const refundPeriodKey = `refund:${new Date().toISOString().slice(0, 10)}`
    const REFUND_DAILY_CAP = 5
    try {
      if (!bypassCap) {
        let refundCount = 0
        try {
          const { data: refundRow } = await client
            .from('feature_usage_counts').select('count')
            .eq('feature', 'analyze_refund').eq('period_key', refundPeriodKey).maybeSingle()
          refundCount = refundRow?.count ?? 0
        } catch {}
        if (refundCount >= REFUND_DAILY_CAP) {
          console.warn('[analyze] refund daily cap reached, not refunding:', spentTicketAmount)
          return
        }
      }
      const { error: grantErr } = await client.rpc('ticket_wallet_grant', { p_amount: spentTicketAmount })
      if (grantErr) { console.error('[analyze] refund grant failed:', grantErr.message ?? grantErr); return }
      if (!bypassCap) {
        const { error: incErr } = await client.rpc('increment_feature_usage', { p_feature: 'analyze_refund', p_period_key: refundPeriodKey })
        if (incErr) console.warn('[analyze] refund counter increment failed:', incErr.message ?? incErr)
      }
    } catch (e) {
      console.error('[analyze] refund threw:', e)
    }
  }

  try {
    let body: AnthropicRequestBody
    try {
      body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as AnthropicRequestBody
    } catch {
      res.status(400).json({ error: 'Invalid JSON' })
      return
    }
    // 2026-10-07: チケットを消費する前に形式を検証する。以前は messages が配列でない/空/
    // contentが不正な場合でも先にチケットを消費してから500で落ちていた。
    if (!body || typeof body !== 'object' || !Array.isArray(body.messages) || body.messages.length === 0
        || body.messages.some((m: any) => !m || (typeof m.content !== 'string' && !Array.isArray(m.content)))) {
      res.status(400).json({ error: 'Invalid messages' })
      return
    }

    // ── ペイロード上限チェック（APP_SECRET未設定でも効く安全弁） ──
    // 2026-08-29に判明: このエンドポイントはAPP_SECRET未設定だと認証なしで誰でも叩ける状態
    // だった。正規クライアントは画像最大6枚(動画分析)・メッセージ1件しか送らないため、
    // 十分な余裕を持たせた上限を超えるリクエストは弾く。認証の有無に関わらず被害の上限を
    // 絞るための対策で、正規利用への影響はない。
    // 2026-09-13に判明: この前提が崩れていた。scoppy_chat(スコッピーとの会話機能)は
    // 会話が続くほどlib/claude.tsのaskScoppy()が直近16件の履歴をmessagesにまとめて送るため、
    // 3往復目には5件を超えて即400 "Too many messages"になり、以後の会話が全て失敗していた
    // (実機で「毎回失敗する」として報告された不具合の真因)。scoppy_chatだけ上限を緩和する。
    const MAX_IMAGES = 12
    const MAX_MESSAGES_DEFAULT = 4
    const MAX_MESSAGES_CHAT = 20 // lib/claude.tsのaskScoppy()側のslice(-8)（2026-09-14に16→8へ削減）に余裕を持たせた値
    const MAX_MESSAGES = body?.feature === 'scoppy_chat' ? MAX_MESSAGES_CHAT : MAX_MESSAGES_DEFAULT
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
    // 2026-10-07: 画像は画像用の機能(video/meal/video_frame)でだけ受け付ける。`feature` はクライアントの
    // 自己申告なので、以前は無料の機能名(recovery等)を名乗って画像を送れば、チケットを引かれずに
    // 画像分析ができてしまった。
    if (imageCount > 0 && !(typeof body.feature === 'string' && IMAGE_FEATURES.has(body.feature))) {
      res.status(400).json({ error: 'Images are not allowed for this feature' })
      return
    }
    // 2026-10-07: 画像以外の文章量にも上限を設ける。以前は画像だけが制限対象で、巨大なテキストを
    // 1回のリクエストで送って1回分のチケットで高額なトークンを使わせられた。正規の最大(ノートや
    // 動画分析のプロンプト)は数千文字なので、十分な余裕を持たせた上限にする。
    const MAX_TEXT_CHARS = 60_000
    let textTotal = typeof body.system === 'string' ? body.system.length : 0
    for (const msg of messages) {
      if (typeof msg.content === 'string') textTotal += msg.content.length
      else for (const block of msg.content) if (block?.type === 'text') textTotal += (block.text ?? '').length
    }
    if (textTotal > MAX_TEXT_CHARS) {
      res.status(400).json({ error: 'Payload too large' })
      return
    }

    // ── 短時間重複防止 ──
    // 2026-09-10: 当初、未ログイン(ゲスト)ユーザーはauthヘッダーが空のため dedupKey が
    // 「''：feature：本文冒頭200字」となり、別々のゲストが似た内容を8秒以内に投げると
    // 2人目が誤って弾かれる不具合があった（recovery/daily_insight等はプロンプトが定型で
    // 冒頭が一致しやすい）。IP制限と合わせて「AI機能が使えない」障害の一因になったため無効化。
    // ダブルタップ対策はクライアント側(各画面のsubmitロック)で担保する。
    void isDuplicateRequest

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
    // 2026-09-09: 元々はTICKET_COST_SERVER[feature]（チケット消費機能）の時だけこのtier検証を
    // 走らせていたが、isPaidTierをモデル選択（下のuseLiteModel算出）にも使うため、feature名さえ
    // 分かれば（無料機能のrecovery/injury_recoveryも含めて）常にtierを引くように広げた。
    let isPaidTier = false
    // ログイン(JWT)をサーバーが確認できたユーザーID。画像を使う高コストな機能は、確認できた場合だけ許可する
    let verifiedUserId: string | null = null
    // featureはクライアント申告の文字列。'constructor'/'__proto__' 等のプロトタイプ上のキーで
    // テーブルを引いてしまわないよう、自前のプロパティだけを見る。
    const own = (o: Record<string, number>, k: unknown): number | undefined =>
      typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined
    // 2026-10-07: GEMINI_API_KEY未設定の検出は、チケットを消費する「前」に行う。
    // 以前は消費の後で確認していたため、未設定時は払い戻しなしで利用者のチケットだけ減っていた。
    const geminiKey = process.env.GEMINI_API_KEY
    if (!geminiKey) {
      res.status(500).json({ error: 'GEMINI_API_KEY not configured' })
      return
    }
    if (authHeader.startsWith('Bearer ') && typeof feature === 'string') {
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
            verifiedUserId = userId
            // 2026-09-10: ここに「サーバー側の絶対上限チェック」を追加していたが、以下の理由で撤去した。
            //  ① period_keyの日付をUTC(now.toISOString())で作っていたのに対し、クライアント側
            //     (lib/adGate.ts)はローカル日付(todayLocalISO / JST)で書き込んでおり、
            //     JST 00:00〜09:00 の間は参照する行がズレて「前日の到達済みカウント」を読み、
            //     朝の時間帯だけ正規ユーザーが誤って429になるバグがあった
            //     （IP制限・dedupと同じ「実利用で初めて壊れる」障害の系統）。
            //  ② 通常ユーザーの上限は既にクライアント側 checkAdGate() が担保しており、
            //     ここでの追加チェックは「有効なJWTを盗んで生APIを叩く」ケースにしか効かない割に
            //     リスクが高い。悪用対策は下のチケット残高チェックに一本化する。
            void HARD_DAILY_CAP_SERVER; void HARD_MONTHLY_CAP_SERVER
            const { data: statusRow, error: statusErr } = await userClient
              .from('subscription_status').select('tier, original_purchase_date')
              .eq('user_id', userId).maybeSingle()
            // 2026-10-07: 読み取りエラーを「行なし＝free」と同一視していたため、DBの一時的な不調で
            // 有料(コーチ)ユーザーにチケットが課金されていた。課金対象の機能では誤課金も無料開放も
            // 避けるため503で止める(クライアントは5xxを自動で再試行する)。無料機能はそのまま続行。
            if (statusErr) {
              console.warn('[analyze] subscription_status read failed:', statusErr.message)
              if (own(TICKET_COST_SERVER, feature)) {
                res.status(503).json({ error: '契約状態を確認できませんでした。少し時間をおいてもう一度お試しください' })
                return
              }
            }
            // 2026-09-30セキュリティ修正: 以前は statusRow が無い(webhookが一度も届いていない=
            // IAPに一度も触れていない大半の無料ユーザーが該当)場合、チケット判定ブロック自体を
            // 丸ごとスキップしており、それらのユーザーは無制限にAI機能を叩けてしまっていた。
            // 「行が無い」を「free扱い」として明示的に判定するよう変更(fail openを廃止)。
            // 2026-10-07: 購入日が取れない/不正な場合はクライアント(lib/adGate.ts isLegacyUnlimitedNoad)と
            // 同じく旧仕様(無制限)側に倒す。サーバーだけ「通常課金」にすると、クライアントが無料と
            // 判断した既存の広告なし課金者がチケット0で402になってしまう。
            const isLegacyNoad = !!statusRow
              && statusRow.tier === 'noad'
              && (() => {
                const d = statusRow.original_purchase_date ? new Date(statusRow.original_purchase_date) : null
                return !d || isNaN(d.getTime()) || d < TICKET_SYSTEM_CUTOVER
              })()
            isPaidTier = statusRow?.tier === 'coach' || isLegacyNoad
            // コーチ無料体験中かつ当日のボーナス枠内なら、チケットを引かない(クライアントと同じ判定)。
            // 利用回数はクライアントが成功後に feature_usage_counts へ加算する(period_key=端末ローカル日付)ので、
            // ここでは日本時間(JST)の今日を見る。読み取りに失敗した場合は無料扱いにせず通常課金に倒す。
            let trialBonusFree = false
            const trialCap = own(TRIAL_BONUS_DAILY_CAP_SERVER, feature)
            if (!isPaidTier && trialCap !== undefined) {
              try {
                const { data: trialRow } = await userClient
                  .from('coach_trials').select('expires_at').eq('user_id', userId).maybeSingle()
                if (trialRow?.expires_at && new Date(trialRow.expires_at).getTime() > Date.now()) {
                  const jstToday = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
                  const { data: usageRow } = await userClient
                    .from('feature_usage_counts').select('count')
                    .eq('user_id', userId).eq('feature', feature).eq('period_key', jstToday).maybeSingle()
                  trialBonusFree = (usageRow?.count ?? 0) < trialCap
                }
              } catch {}
            }
            const ticketCost = (feature === 'competition_plan' && isNonFinalCompetitionChunk(body))
              ? undefined
              : own(TICKET_COST_SERVER, feature)
            // 2026-10-07: スコッピーは「チケット1枚で5回質問できる」仕様(lib/scoppyChatStore.ts)だが、
            // サーバーは全メッセージを1枚ずつ課金していたため、実際は5倍の料金になり、残り枚数が0になると
            // 「残り4回」と表示されたまま送れなくなっていた。クライアントが残り回数を使う送信には
            // banked:true を付け、サーバーはその送信を課金しない(課金されるのは5通に1通だけ)。
            // クライアント申告を信用する点は他のfeature申告と同じ扱いで、悪用されても
            // 最安のliteモデル・400トークンの会話に限られる。
            const bankedFree = feature === 'scoppy_chat' && body.banked === true
            if (!isPaidTier && !trialBonusFree && !bankedFree && ticketCost) {
              // 2026-09-30セキュリティ修正: 以前はここで残高の読み取り確認のみ行い、実際の
              // 消費はクライアント側(recordUsage、成功後に別途呼ばれる)に委ねていた。
              // アプリを経由せずこのAPIを直接叩く経路では、その後続のrecordUsage呼び出しが
              // 一切発生しないため、チケットが一切減らないまま何度でも無料で呼べてしまっていた。
              // ここでサーバー自身が唯一の消費者となるよう、実際にRPCで消費まで行う
              // (client側のrecordUsageはticket機能について消費処理をスキップするよう変更済み。
              // lib/adGate.ts参照。二重消費にはならない)。
              const { data: spent, error: spendErr } = await userClient
                .rpc('ticket_wallet_spend', { p_amount: ticketCost })
              // 2026-10-07: 以前はDB/通信エラーも「チケット不足」(402)として返していたため、
              // 残高があるのに「チケットが足りません」と表示されていた。エラーは503で区別する。
              if (spendErr) {
                console.warn('[analyze] ticket_wallet_spend failed:', spendErr.message)
                res.status(503).json({ error: 'チケットの処理に失敗しました。少し時間をおいてもう一度お試しください' })
                return
              }
              if (!spent) {
                res.status(402).json({ error: 'チケットが不足しています' })
                return
              }
              // Gemini呼び出しが失敗した場合はここで払い戻す（元々「失敗時は課金しない」
              // 挙動だったため、成功時のみ課金される状態を維持する）
              spentTicketClient = userClient
              spentTicketAmount = ticketCost
            }
          }
        } catch (e) {
          console.warn('[analyze] tier verification failed, falling back to client-trust:', e)
        }
      }
    }

    // 2026-10-07: 画像を使う機能(動画分析・食事分析・Web版フレーム分析)は最も高額で、アプリ側でも
    // ログイン必須。Authorization なし(または確認できないトークン)でも通ってしまうと、誰でも・無料で・
    // 無制限に画像分析を呼べる。サーバー側でも、ログインを確認できた場合だけ許可する。
    if (typeof feature === 'string' && IMAGE_FEATURES.has(feature) && !verifiedUserId) {
      res.status(authHeader.startsWith('Bearer ') ? 503 : 401).json({
        error: authHeader.startsWith('Bearer ')
          ? 'ログイン状態を確認できませんでした。少し待ってからもう一度お試しください'
          : 'ログインが必要です',
      })
      return
    }

    // ── モデル選択（無料/チケット利用は軽量モデル、有料サブスクは現行モデル） ──
    // 画像を送る機能(video/meal)は品質未検証のため対象外とし、常に現行モデルを使う。
    // 2026-09-13: 「一番やっすいAIにしておいて」との指示で、scoppy_chat(陸上の一般知識Q&A、
    // 個人データを使わない雑談寄りの機能)はコーチプラン等の有料tierでも常にliteモデルを使う
    // ようisPaidTier判定を無視する(他の分析系AI機能は品質維持のため有料tierは現行モデルのまま)
    const useLiteModel = feature === 'scoppy_chat'
      || (typeof feature === 'string' && !IMAGE_FEATURES.has(feature) && !isPaidTier)

    // featureはこのプロキシ内でのtier検証専用のフィールドで、Gemini/Anthropicの実APIは
    // 知らない。以前Anthropicへそのまま転送していた際、消し忘れて本物のAPIから
    // 「未知のフィールド」として400 invalid_request_errorで拒否された事故があった
    // (2026-09-02に実際に発生、全AI機能が停止した)。Gemini専用になった今もbodyに
    // 余計なフィールドを残さない習慣として維持する。
    delete (body as any).feature
    delete (body as any).banked

    // max_tokens を 4096 に上限設定（意図しない高コスト呼び出しを防止／出力は入力の5倍高いため上限を絞る）。
    // 2026-08-29: 3000のままだと、動画分析のレーダーチャート方式スキーマ(7項目×詳細な理由文+
    // strength/focus/nextStep/practice)で、実際の走行フォーム画像(情報量が多い)を渡すと応答が
    // 途中で切れてJSONパース失敗になる不具合が発生。gemini-3.5-flashへの切替でモデルの応答の
    // 冗長さが変わったことも一因とみられる。4096に引き上げて余裕を持たせる。
    // 2026-10-07: 数値以外("99999"等の文字列や0/負数/小数)は上限をすり抜けていたため、整数に正規化する。
    {
      const mt: any = typeof body.max_tokens === 'string' ? Number(body.max_tokens) : body.max_tokens
      body.max_tokens = (typeof mt === 'number' && Number.isFinite(mt) && mt >= 1) ? Math.min(Math.floor(mt), 4096) : undefined
    }

    // 2026-09-24: 「Anthropicのクレジットはもう使わない、全部Geminiに繋がるように」との
    // 指示でAnthropicフォールバックを撤去。以前はGeminiが失敗/空/非JSON応答の時に
    // Anthropicへ自動フォールバックしていたが、今後は一切呼ばない。GEMINI_API_KEY未設定
    // 時もエラーを返すのみ（Anthropicへの切替は行わない）。キーの確認はチケット消費の前に済ませてある。
    // 2026-10-05: 「JSONが無い応答は失敗」という判定は、応答が元々JSONの機能にだけ適用する。
    // 以前は scoppy_chat 以外の全機能に適用していたため、文章(散文)で返すのが正しい
    // ai_analysis(今週の総評)・workout・meal_coach・daily_insightが毎回「失敗」と誤判定され、
    // ①Geminiを毎回2回呼んでコストが倍に、②使ったチケットが払い戻される(1日3回まで)、
    // という不具合になっていた。
    const JSON_RESPONSE_FEATURES = new Set([
      'video', 'meal', 'competition_plan', 'recovery', 'injury_recovery', 'mission_summary', 'notebook_ai',
      'video_frame', 'video_web',
    ])
    const expectsJson = typeof feature === 'string' && JSON_RESPONSE_FEATURES.has(feature)
    // 動画分析は構造化出力を指定する(上のVIDEO_RESPONSE_SCHEMA参照)。
    const responseSchema = feature === 'video' ? VIDEO_RESPONSE_SCHEMA : undefined
    const callBudget = () => Math.min(GEMINI_CALL_TIMEOUT_MS, remainingMs() - 2_000)
    let result = await callGemini(body, geminiKey, useLiteModel, responseSchema, callBudget())
    // 構造化出力のスキーマ自体をGeminiが400で拒否した場合に備えた安全装置:
    // 従来方式(スキーマ無し)に自動で切り替えて続行する（動画分析が全滅しないように）。
    let activeSchema = responseSchema
    if (activeSchema && result.status === 400 && remainingMs() > MIN_RETRY_BUDGET_MS) {
      console.warn('[analyze] structured output rejected, falling back to plain generation:', JSON.stringify(result.body).slice(0, 300))
      activeSchema = undefined
      result = await callGemini(body, geminiKey, useLiteModel, activeSchema, callBudget())
    }
    const checkSoftFailure = (r: typeof result) => {
      const text = (r.body as any)?.content?.[0]?.text
      const empty = r.status === 200 && (!text || !String(text).trim())
      const hasJson = typeof text === 'string' && /\{[\s\S]*\}/.test(text)
      let nonJson = expectsJson && r.status === 200 && !empty && !hasJson
      // 動画分析はクライアント(app/video-analysis.tsx)が厳密にパースするため、
      // 「波括弧はあるがJSONとして壊れている/scoreが無い/項目が少なすぎる」応答もここで失敗扱いにして
      // サーバー側で1回だけ再試行する(それでもダメならチケットを払い戻す)。
      if (feature === 'video' && r.status === 200 && !empty && hasJson) {
        try {
          const p = JSON.parse(String(text).match(/\{[\s\S]*\}/)![0])
          if (typeof p?.score !== 'number' || !Array.isArray(p?.dimensions) || p.dimensions.length < 3) nonJson = true
        } catch { nonJson = true }
      }
      // 大会プランは phases(週ごとの計画)が空だと使えない。「JSONだが計画が空」も失敗として扱い、
      // 再試行→払い戻しの対象にする(以前は計画が空のまま「作成しました」と表示され課金されていた)。
      if (feature === 'competition_plan' && r.status === 200 && !empty && hasJson && !nonJson) {
        try {
          const p = JSON.parse(String(text).match(/\{[\s\S]*\}/)![0])
          if (!Array.isArray(p?.phases) || p.phases.length === 0) nonJson = true
        } catch { nonJson = true }
      }
      // 2026-10-07: 出力上限で途中切れした応答は、中に '}' が残っているため「成功」扱いになり、
      // クライアントのJSON解析で失敗してもチケットだけ引かれていた(食事・大会プラン等)。
      // 再試行しても同じ長さで切れやすくコストが増えるだけなので、再試行はせず払い戻し対象にする。
      const truncated = expectsJson && r.status === 200 && !empty && !nonJson
        && (r.body as any)?.stop_reason === 'max_tokens'
      return { text, empty, nonJson, truncated }
    }
    let check = checkSoftFailure(result)
    // 2026-09-25: 「食事分析がめっちゃ時間かかる/反応しない」の原因調査で判明。Anthropic
    // フォールバック撤去(2026-09-24)後、Geminiがステータス200のまま空応答/非JSON応答を
    // 返すケース(実際にVercelログで確認済み)がそのままクライアントへ素通りするようになった。
    // これはHTTPエラーではないためlib/claude.tsのRETRYABLE_STATUSにも引っかからず、
    // クライアント側は一切リトライせず即座に失敗表示していた。Anthropicは使わない方針の
    // ため、代わりにGemini自身へその場でもう1回だけ投げ直す（同一プロバイダなのでコストは
    // 増えるが小さく、ユーザー体験としては「たまに遅い」で済み、「反応しない」よりずっと良い）。
    // 2026-10-07: 残り時間が少ない時は再試行しない(関数の強制終了で払い戻しが漏れるのを避ける)。
    if ((check.empty || check.nonJson) && remainingMs() > MIN_RETRY_BUDGET_MS) {
      // 2026-10-07: AIの回答本文(健康・練習の内容を含み得る)はログに残さない。長さだけ記録する
      console.warn('[analyze] Gemini soft-failure, retrying once:', result.status, check.nonJson ? `(non-JSON, ${String(check.text ?? '').length} chars)` : '(empty)')
      result = await callGemini(body, geminiKey, useLiteModel, activeSchema, callBudget())
      check = checkSoftFailure(result)
      if (check.empty || check.nonJson) {
        console.warn('[analyze] Gemini soft-failure again after retry:', result.status, check.nonJson ? `(non-JSON, ${String(check.text ?? '').length} chars)` : '(empty)')
      }
    }
    // Gemini呼び出しが最終的に失敗(非200 or 空/非JSON/途中切れ応答)に終わった場合、事前に消費した
    // チケットを払い戻す。元々「失敗時は課金しない」挙動だったため、これで維持する。
    // 上限(1日5回)が効くのは「HTTP 200なのに応答が不良」の場合だけ(refundTicket参照)。
    // Gemini側のエラー(非200)はいつでも払い戻す。
    if (result.status !== 200 || check.empty || check.nonJson || check.truncated) {
      await refundTicket(result.status !== 200)
    }
    res.status(result.status).json(result.body)
  } catch (e: any) {
    // 通信エラー/タイムアウト/想定外の例外: ここまでにチケットを消費していれば必ず返す。
    await refundTicket(true)
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    console.error('[analyze] handler failed:', e?.name, e?.message)
    if (timedOut) {
      res.status(504).json({ error: 'AIの応答が時間内に返りませんでした。もう一度お試しください' })
    } else {
      res.status(500).json({ error: e?.message ?? 'Unknown error' })
    }
  }
}

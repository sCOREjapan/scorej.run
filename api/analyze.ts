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
// 2026-09-09: 無料/チケット利用ユーザーには軽量モデル、有料サブスク(coach/レガシーnoad)には
// 現行モデルを使う設計を追加。gemini-3.5-flash-liteで実際にJSON出力の安定性をテスト済み
// （lib/claude.tsの各AI機能と同じプロンプトで3パターン検証、全て正常にJSONを返した）。
// ただし thinkingConfig パラメータを渡すと400 INVALID_ARGUMENTで拒否される
// （lite系モデルはthinking機能自体を持たないため）ので、liteモデル使用時は省略する必要がある
// （toGeminiRequest参照）。
// 画像を送る機能(video/meal)は画像理解の品質差を未検証のため対象外とし、常にGEMINI_MODELを使う。
const GEMINI_MODEL_LITE = 'gemini-3.5-flash-lite'
const IMAGE_FEATURES = new Set(['video', 'meal'])

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
  // 2026-09-13: スコッピーとの会話機能。lib/ticketWallet.ts の TICKET_COST と同値
  scoppy_chat: 1,
}
// lib/adGate.ts の TICKET_SYSTEM_CUTOVER と一致させる
const TICKET_SYSTEM_CUTOVER = new Date('2026-08-06T00:00:00.000Z')

interface ProxyResult {
  status: number
  body: any
}

// Anthropic Messages形式 → Gemini generateContent形式に変換
// 2026-09-09: liteモデルは thinkingConfig を渡すと400 INVALID_ARGUMENTになるため
// （thinking機能自体を持たないモデルのため）、useLite時は省略する。
function toGeminiRequest(body: AnthropicRequestBody, useLite: boolean) {
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

async function callGemini(body: AnthropicRequestBody, apiKey: string, useLite: boolean): Promise<ProxyResult> {
  const model = useLite ? GEMINI_MODEL_LITE : GEMINI_MODEL
  const geminiBody = toGeminiRequest(body, useLite)
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as AnthropicRequestBody

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
            const { data: statusRow } = await userClient
              .from('subscription_status').select('tier, original_purchase_date')
              .eq('user_id', userId).maybeSingle()
            if (statusRow) {
              const isLegacyNoad = statusRow.tier === 'noad'
                && !!statusRow.original_purchase_date
                && new Date(statusRow.original_purchase_date) < TICKET_SYSTEM_CUTOVER
              isPaidTier = statusRow.tier === 'coach' || isLegacyNoad
              if (!isPaidTier && TICKET_COST_SERVER[feature]) {
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
            // （isPaidTierはfalseのままなのでliteモデルに倒れるが、これは「有料と証明できない
            // 場合は安全側(lite)に倒す」という意図であり、既存ユーザーを誤ブロックするチケット消費
            // 判定とは性質が違うため許容する）
          }
        } catch (e) {
          console.warn('[analyze] tier verification failed, falling back to client-trust:', e)
        }
      }
    }

    // ── モデル選択（無料/チケット利用は軽量モデル、有料サブスクは現行モデル） ──
    // 画像を送る機能(video/meal)は品質未検証のため対象外とし、常に現行モデルを使う。
    // 2026-09-13: 「一番やっすいAIにしておいて」との指示で、scoppy_chat(陸上の一般知識Q&A、
    // 個人データを使わない雑談寄りの機能)はコーチプラン等の有料tierでも常にliteモデルを使う
    // ようisPaidTier判定を無視する(他の分析系AI機能は品質維持のため有料tierは現行モデルのまま)
    const useLiteModel = feature === 'scoppy_chat'
      || (typeof feature === 'string' && !IMAGE_FEATURES.has(feature) && !isPaidTier)

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
      result = await callGemini(body, geminiKey, useLiteModel)
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

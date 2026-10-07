// lib/claude.ts — Claude API 全呼び出しをここに集約
// SDK の代わりに fetch を直接使用（React Native 互換性のため）

import type {
  MealAnalysisResult,
  RecoveryStatus,
  UserProfile,
  SleepRecord,
  TrainingSession,
  AthleticsEvent,
  InjuryDayPlan,
  WeekPlan,
} from '../types'
import { getMealAnalysisPrompt, getCompetitionPlanPrompt, getCompetitionPlanChunkPrompt, getSleepAdvicePrompt } from '../prompts/index'
import { narrativeLanguageInstruction } from './aiLanguage'
import type { Language } from '../context/LanguageContext'
import { getAiAuthHeader } from './supabase'
import { trackAiRequestFailed } from './analytics'

const MODEL = 'claude-haiku-4-5-20251001'
// Vercel proxy URL（APIキーをクライアントに持たせない）
const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
const PROXY_URL = `${API_BASE}/api/analyze`

// ─────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

interface MessagesRequest {
  model: string
  max_tokens: number
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }>
  // 2026-09-01: サーバー側でのtier検証・残高確認のため追加。api/analyze.ts の
  // TICKET_COST_SERVER と一致するfeature名を渡す（対象外の機能は省略可）
  feature?: string
  // スコッピー: ローカルの残り回数(1チケット=5メッセージ)で送る場合 true（サーバーは課金しない）
  banked?: boolean
}

// ─────────────────────────────────────────
// fetch を使った直接 API 呼び出し（React Native 対応）
// ─────────────────────────────────────────
// タイムアウト付きfetch（Hermesの AbortSignal.timeout 非対応に対応）
function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return fetch(url, { ...options, signal: AbortSignal.timeout(ms) })
  }
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Gemini側の一時的な高負荷（429/503）や、サーバー内部の一時的な失敗（500/502）は、
// 同じリクエストを間隔を空けて再送すると成功することが多いため自動リトライする。
// 2026-10-07: 504 は再試行しない。サーバーは Gemini が約40秒以内に返らない時に 504 を返すため
// （api/analyze.ts）、もう一度投げても同じ結果になりやすく、体感の待ち時間が2分を超えてしまう。
// なお失敗した呼び出しのチケットはサーバー側で払い戻される（api/analyze.ts の refundTicket）。
const RETRYABLE_STATUS = new Set([429, 500, 502, 503])

// 2026-10-07: AI呼び出しの失敗を HTTP ステータス付きで扱えるようにする。
// 以前は「Anthropic API エラー (402): {json}」という生の文字列しか投げず、残高不足(402)でも
// 画面側は「チケットが不足しています」を出せず、プロバイダ名も実際はGeminiなのにAnthropicと表示されていた。
export class AiRequestError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AiRequestError'
    this.status = status
  }
}
/** チケット不足(サーバーが402を返した)かどうか。画面側でチケット獲得モーダルを出す判定に使う */
export function isTicketShortageError(e: unknown): boolean {
  return e instanceof AiRequestError && e.status === 402
}
/** サーバーのエラー応答({error:"..."})から利用者向けの文言を取り出す */
export function describeAiHttpError(status: number, bodyText: string): string {
  if (status === 402) return 'チケットが不足しています。チケットを獲得してからもう一度お試しください。'
  let detail = ''
  try { const j = JSON.parse(bodyText); detail = typeof j?.error === 'string' ? j.error : '' } catch { detail = bodyText.slice(0, 200) }
  if (status === 504) return 'AIの応答に時間がかかりすぎました。少し待ってからもう一度お試しください。'
  if (status === 429 || status === 503) return 'AIが混み合っています。少し待ってからもう一度お試しください。'
  return `AIサーバーエラー (${status})${detail ? `: ${detail}` : ''}`
}

// クライアントの待ち時間はサーバーの上限(api/analyze.ts の FUNCTION_BUDGET_MS=55秒)より長くする。
// 短いと「クライアントだけ諦めたのにサーバーは処理を続けて課金される」状態になる。
export const AI_CLIENT_TIMEOUT_MS = 58_000

async function callClaudeOnce(req: MessagesRequest): Promise<Response> {
  const body = JSON.stringify({
    model: req.model,
    max_tokens: req.max_tokens,
    ...(req.system ? { system: req.system } : {}),
    messages: req.messages,
    ...(req.feature ? { feature: req.feature } : {}),
    ...(req.banked ? { banked: true } : {}),
  })

  const appSecret = process.env.EXPO_PUBLIC_APP_SECRET ?? ''
  const authHeader = await getAiAuthHeader()
  try {
    return await fetchWithTimeout(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(appSecret ? { 'X-App-Secret': appSecret } : {}),
        ...authHeader,
      },
      body,
    }, AI_CLIENT_TIMEOUT_MS)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isTimeout = msg.includes('abort') || msg.includes('timeout') || msg.includes('Abort')
    throw new Error(isTimeout ? 'AI応答がタイムアウトしました。再試行してください。' : `ネットワークエラー: ${msg}`)
  }
}

async function callClaude(req: MessagesRequest): Promise<string> {
  let res = await callClaudeOnce(req)

  // 間隔を空けて再送すると成功することが多いため最大2回リトライする（計3回試行）。
  for (let attempt = 0; !res.ok && RETRYABLE_STATUS.has(res.status) && attempt < 2; attempt++) {
    await sleep(1500 * (attempt + 1))
    res = await callClaudeOnce(req)
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    if (req.feature) trackAiRequestFailed(req.feature, `http_${res.status}`)
    throw new AiRequestError(res.status, describeAiHttpError(res.status, errText))
  }

  const json = await res.json()
  const block = json?.content?.[0]
  const text = block?.type === 'text' && block.text ? block.text : ''
  // 2026-09-09: 空応答はHTTPレベルでは200(成功)なので、上のエラー分岐だけでは
  // 検知できない。api/analyze.ts側でGemini空応答→Anthropicフォールバック済みの
  // はずだが、両方失敗した場合はここに空文字が届く。呼び出し元(safeParseJSON等)は
  // 個別にエラーを投げるが、feature名が分かるのはここだけなので先に記録しておく。
  if (!text.trim() && req.feature) trackAiRequestFailed(req.feature, 'empty_response')
  return text
}

// ─────────────────────────────────────────
// base64からMIMEタイプを自動検出
// ─────────────────────────────────────────
function detectMediaType(base64: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  const head = base64.slice(0, 12)
  if (head.startsWith('/9j/')) return 'image/jpeg'
  if (head.startsWith('iVBOR')) return 'image/png'
  if (head.startsWith('R0lGOD')) return 'image/gif'
  if (head.startsWith('UklGR')) return 'image/webp'
  // デフォルトはJPEG
  return 'image/jpeg'
}

// ─────────────────────────────────────────
// JSONパース（安全版）
// ─────────────────────────────────────────
function safeParseJSON<T>(text: string): T {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
  const arrStart = cleaned.indexOf('[')
  const objStart = cleaned.indexOf('{')
  // 配列とオブジェクトのどちらが先に現れるかで分岐
  const isArray = arrStart !== -1 && (objStart === -1 || arrStart < objStart)
  if (isArray) {
    const end = cleaned.lastIndexOf(']')
    if (end === -1) throw new Error('AIの応答にJSONが含まれていません')
    try { return JSON.parse(cleaned.slice(arrStart, end + 1)) as T } catch {
      throw new Error('AIの応答の解析に失敗しました。もう一度お試しください。')
    }
  }
  const start = cleaned.indexOf('{')
  const end   = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('AIの応答にJSONが含まれていません')
  try { return JSON.parse(cleaned.slice(start, end + 1)) as T } catch {
    throw new Error('AIの応答の解析に失敗しました。もう一度お試しください。')
  }
}

// 2026-09-14: 動画分析(analyzeVideo)はこのファイル上に定義されていたが、実際の呼び出しは
// app/video-analysis.tsx内で直接fetchする独自実装(6フレーム均等割り・複数フォールバック・
// truncation自動リトライ付き)に置き換わっており、この関数はコードベース全体を検索しても
// 呼び出し元が1件も無い完全なデッドコードだった（2026-09-09に削除したgetWeeklySummaryと
// 同じパターン）。API費用の見直し中に発見・削除。ContentBlock型・detectMediaType・
// safeParseJSONは他機能でも使うため残す。

// ─────────────────────────────────────────
// 2. 食事分析
// ─────────────────────────────────────────
export async function analyzeMeal(
  imageBase64: string,
  profile: UserProfile,
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'supplement',
  trainingTiming: 'pre' | 'post' | 'none',
  language: Language = 'ja'
): Promise<MealAnalysisResult> {
  const systemPrompt = getMealAnalysisPrompt(mealType, profile.event_category, trainingTiming) + narrativeLanguageInstruction(language)

  const text = await callClaude({
    model: MODEL,
    max_tokens: 1100,
    feature: 'meal',
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: detectMediaType(imageBase64), data: imageBase64 } },
          { type: 'text', text: '食事内容を分析してJSONで返してください。' },
        ],
      },
    ],
  })

  const raw = safeParseJSON<any>(text)
  // 2026-10-07: 応答の型を検証していなかったため、total_calories 等が欠けたり文字列で返ると、
  // 1日の合計が NaN になったり「120」+「80」のように文字列連結されて画面に出ていた。
  // 数値項目は必ず数値にそろえ、合計が無い/不正なら食品ごとの値から計算し直す。
  const num = (v: any): number => { const n = typeof v === 'number' ? v : parseFloat(String(v)); return Number.isFinite(n) && n >= 0 ? n : 0 }
  const foods = Array.isArray(raw?.foods) ? raw.foods.filter((f: any) => f && typeof f === 'object') : []
  const sum = (key: string) => foods.reduce((a: number, f: any) => a + num(f[key]), 0)
  const total = (key: string, foodKey: string) => {
    const t = num(raw?.[key])
    return t > 0 ? t : sum(foodKey)
  }
  return {
    ...raw,
    foods,
    total_calories: total('total_calories', 'calories'),
    total_protein: total('total_protein', 'protein'),
    total_carb: total('total_carb', 'carb'),
    total_fat: total('total_fat', 'fat'),
    advice: typeof raw?.advice === 'string' ? raw.advice : '',
  } as MealAnalysisResult
}

// ─────────────────────────────────────────
// 3. 試合計画生成
// ─────────────────────────────────────────
// 5週間以上のプランは、Vercel Edge Function のプラン上の実行時間上限
// （実測でFUNCTION_INVOCATION_TIMEOUTが25秒前後で発生することを確認済み）を超えないよう、
// 数週間ずつに分割して生成する。
const COMPETITION_PLAN_CHUNK_WEEKS = 3

export async function generateCompetitionPlan(
  competitionDate: Date,
  competitionName: string,
  profile: UserProfile,
  event: AthleticsEvent,
  language: Language = 'ja',
  environment = ''
): Promise<{ phases: WeekPlan[]; peak_week: number; taper_start_week: number; key_advice: string }> {
  const daysLeft = Math.ceil((competitionDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 1) throw new Error('試合日が過去です')

  // 週数を最大8週に丸める（トークン超過防止）
  const cappedDays = Math.min(daysLeft, 56)
  const weeksLeft = Math.min(Math.ceil(cappedDays / 7), 8)

  if (weeksLeft <= COMPETITION_PLAN_CHUNK_WEEKS) {
    const systemPrompt = getCompetitionPlanPrompt(cappedDays, profile, competitionName, event, environment) + narrativeLanguageInstruction(language)
    const text = await callClaude({
      model: MODEL,
      max_tokens: 4096,
      feature: 'competition_plan',
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `${cappedDays}日後（${weeksLeft}週間）の試合「${competitionName}」に向けた計画をJSONで作成してください。`,
        },
      ],
    })
    if (!text) throw new Error('AIからの応答が空でした。しばらく待ってから再試行してください。')
    return safeParseJSON(text)
  }

  // week_number は降順（weeksLeft → 1、1が試合直前週）。遠い週から近い週の順にチャンク分割する。
  const weekNumbers = Array.from({ length: weeksLeft }, (_, i) => weeksLeft - i)
  const weekChunks: number[][] = []
  for (let i = 0; i < weekNumbers.length; i += COMPETITION_PLAN_CHUNK_WEEKS) {
    weekChunks.push(weekNumbers.slice(i, i + COMPETITION_PLAN_CHUNK_WEEKS))
  }

  const allPhases: WeekPlan[] = []
  let keyAdvice = ''
  for (const chunkWeeks of weekChunks) {
    const systemPrompt = getCompetitionPlanChunkPrompt(chunkWeeks, weeksLeft, profile, competitionName, event, environment) + narrativeLanguageInstruction(language)
    const text = await callClaude({
      model: MODEL,
      max_tokens: 2048,
      feature: 'competition_plan',
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `「${competitionName}」に向けた${weeksLeft}週間計画のうち、week_number=${chunkWeeks.join('・')}をJSONで作成してください。`,
        },
      ],
    })
    if (!text) throw new Error('AIからの応答が空でした。しばらく待ってから再試行してください。')
    const parsed = safeParseJSON<{ phases: WeekPlan[]; key_advice?: string }>(text)
    allPhases.push(...parsed.phases)
    if (chunkWeeks.includes(1) && parsed.key_advice) keyAdvice = parsed.key_advice
  }

  return {
    phases: allPhases,
    peak_week: Math.max(2, weeksLeft - 1),
    taper_start_week: 2,
    key_advice: keyAdvice,
  }
}

// ─────────────────────────────────────────
// 4. 睡眠・回復アドバイス
// ─────────────────────────────────────────
export async function getRecoveryAdvice(
  recentSleep: SleepRecord[],
  recentSessions: TrainingSession[]
): Promise<RecoveryStatus> {
  const systemPrompt = getSleepAdvicePrompt(recentSleep, recentSessions)

  const text = await callClaude({
    model: MODEL,
    max_tokens: 512,
    // 2026-09-09: feature名が無いとサーバー側(api/analyze.ts)のtier判定・軽量モデル振り分けの
    // 対象にならないため追加（この機能自体は無料だが、モデル選択には使われる）
    feature: 'recovery',
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: '直近の睡眠とトレーニングデータに基づいて、今日のコンディションをJSONで評価してください。',
      },
    ],
  })

  return safeParseJSON<RecoveryStatus>(text)
}

// ─────────────────────────────────────────
// 4-2. 3日間ミッション結果カードのAIコメント
// ─────────────────────────────────────────
// 2026-09-11: 「実際に3日間記録したデータから統計を見せてほしい」との指示。
// 数字自体(セッション数・体調推移等)はlib/missionStore.tsのgetMissionStats()で
// 確定的に計算し、ここではAIに「その数字をどう解釈するか」の短いコメントだけを
// 作らせる（数字の生成をAIに任せると桁を間違える/生成のたびに違う値を言う
// リスクがあるため、事実はコードで確定させ、AIは解釈担当に限定する）。
export interface MissionSummaryInsight {
  headline: string  // 一言見出し（例:「3日間、着実に積み上げましたね」）
  comment:  string  // 2〜3文の personalized コメント
}

export async function getMissionSummaryInsight(
  stats: {
    totalSessions: number
    conditionFirst: number | null
    conditionLast: number | null
    videoScore: number | null
    hasMealAnalysis: boolean
    hasCompetitionRegistered: boolean
    riskReduction: number | null
  },
  language: Language,
): Promise<MissionSummaryInsight> {
  const systemPrompt = `あなたは陸上競技の親しみやすいAIコーチです。選手が3日間のミッションで記録した実データが与えられます。
数字を書き換えたり新しい数値を作らないでください（与えられた数字だけを根拠にしてください）。
以下のJSON形式で、短く前向きなコメントだけを返してください:
{"headline":"10〜20文字程度の一言見出し","comment":"2〜3文の personalized なコメント。データに基づいた具体的な気づきと、次の3日間も続けたくなるような前向きな一言を含める"}
医学的な診断や断定は避け、あくまで練習記録に基づく一般的な励ましに留めてください。${narrativeLanguageInstruction(language)}`

  const text = await callClaude({
    model: MODEL,
    max_tokens: 300,
    feature: 'mission_summary',
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `3日間の記録データ: ${JSON.stringify(stats)}`,
      },
    ],
  })

  return safeParseJSON<MissionSummaryInsight>(text)
}

// 2026-09-09: 「週次トレーニングサマリー」(getWeeklySummary)はコードベース全体を
// 検索してもimport/呼び出し元が1件も無い完全なデッドコードだったため削除した
// （formatMsもこの関数専用のヘルパーだったため合わせて削除）。API課金対象なのに
// 使われていない=無駄な保守コストだった。将来同機能を作る場合はticketWallet.ts/
// adGate.tsにfeature名を登録し、チケット消費・利用回数上限を必ず設定すること。

// ─────────────────────────────────────────
// 4.5. スコッピーとの会話（陸上競技の一般知識Q&A）
// ─────────────────────────────────────────
// 2026-09-13: 「AIスコッピー(メインキャラ)と会話ができる機能」の要望で新規追加。
// ユーザーの決定: ①ホーム画面のスコッピータップから開く ②回答範囲は陸上競技の
// 一般知識のみ（本人の記録データは今回は使わない。将来の拡張候補）③他のAI機能と
// 同じくチケット消費(1枚/メッセージ。lib/ticketWallet.ts/lib/adGate.ts/
// api/analyze.tsのTICKET_COST_SERVERにscoppy_chatとして登録済み)。
export interface ScoppyChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// 陸上競技と無関係な質問（雑談・他分野の相談等）にAPIコストを使わせないための
// システムプロンプト側のガードレール。JSONではなく自然文で返す通常のチャットのため
// safeParseJSONは使わず、callClaude()の戻り値(text)をそのまま表示する。
const SCOPPY_SYSTEM_PROMPT = `あなたは陸上競技アプリ「sCORE」のマスコットキャラクター「スコッピー」です。
明るく親しみやすい、選手を励ますコーチのような口調で話してください（絵文字は使わない。一人称は「ボク」）。

回答してよい範囲:
- 陸上競技の種目・ルール・フォーム・トレーニング理論・ウォームアップ/クールダウン・栄養・怪我予防など、
  陸上競技に関する一般的な知識のみ。
- 特定の個人の記録データは与えられていないため、「あなたの場合は」のような断定はせず、
  一般論として答える。

回答してはいけない範囲:
- 陸上競技と無関係な話題（雑談・他競技・時事・プログラミング等）を聞かれたら、丁寧に
  「陸上競技のことなら何でも聞いてね！」と伝えて話題を戻す。知っていても答えない。
- 医学的診断・断定的な治療方針は述べない（怪我については「早めに専門家に相談してね」で締める）。

回答の長さは3〜5文程度に収め、長文で説明しすぎない（チャット形式のため）。`

export async function askScoppy(history: ScoppyChatMessage[], language: Language, opts?: { banked?: boolean }): Promise<string> {
  // トークンコスト増大を防ぐため、直近の会話だけをAPIに送る（表示用の全履歴は
  // 呼び出し元(lib/scoppyChatStore.ts)がAsyncStorage側で別途保持する）。
  // 2026-09-14: 「API費用をもっと抑えられないか」との指示でAPIコストを再点検した際、
  // このチャットは長く続くほど毎ターン過去分を丸ごと再送する構造(会話が伸びるほど
  // 1メッセージあたりのコストが線形に増える)だと判明。SCOPPY_SYSTEM_PROMPTで既に
  // 「陸上の一般知識のみ・個人データは使わない」と範囲を絞っているため、直近8件
  // (往復4ターン分)でも回答品質はほぼ変わらない想定で16→8に削減。
  // 2026-10-07: 直近8件で切ると先頭が assistant になることがあり、また失敗した送信の
  // user 発言が残って user が連続することもある(Geminiが拒否/回答劣化する恐れ)ため、
  // 先頭の assistant を落とし、同じ役割が連続する場合は1つにまとめる。
  const normalized: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const m of history.slice(-8)) {
    if (normalized.length === 0 && m.role !== 'user') continue
    const last = normalized[normalized.length - 1]
    if (last && last.role === m.role) last.content += `\n${m.content}`
    else normalized.push({ role: m.role, content: m.content })
  }
  const text = await callClaude({
    model: MODEL,
    max_tokens: 400,
    feature: 'scoppy_chat',
    ...(opts?.banked ? { banked: true } : {}),
    system: SCOPPY_SYSTEM_PROMPT + narrativeLanguageInstruction(language),
    messages: normalized,
  })
  if (!text.trim()) throw new Error('スコッピーからの返答を取得できませんでした。もう一度お試しください。')
  return text.trim()
}

// ─────────────────────────────────────────
// 5. 怪我復帰プラン生成
// ─────────────────────────────────────────
// Vercel Edge Function のプラン上の実行時間上限（コード上のmaxDuration=60とは別に、
// 実測でFUNCTION_INVOCATION_TIMEOUTが25秒前後で発生することを確認済み）を超えないよう、
// 長期間（>10日）のプランは複数回に分割して生成し、後で結合する。
const INJURY_PLAN_CHUNK_DAYS = 6

export async function generateInjuryRecoveryPlan(params: {
  side: string
  parts: string[]
  injuryType: string
  description: string
  painLevel: number
  hasSwelling: boolean
  totalDays: number
  language?: Language
}): Promise<InjuryDayPlan[]> {
  const { side, parts, injuryType, description, painLevel, hasSwelling, language = 'ja' } = params
  // 呼び出し元の入力チェックに関わらず、ここでも上限をかける（防御的多層化）。
  // 2026-09-09: 90日だと6日ごとのチャンク分割で最大15回のAPI呼び出しが発生し、
  // 「1日2回まで無料」の想定を大きく超えていたため30日(最大5チャンク)に縮小
  // （呼び出し元 app/(tabs)/competition.tsx の同名クランプと揃えること）。
  const totalDays = Math.min(Math.max(params.totalDays, 1), 30)

  const bodyInfo = `部位: ${side}${parts.join('・')}
種類: ${injuryType}
痛み: ${painLevel}/10
腫れ: ${hasSwelling ? 'あり' : 'なし'}
状況: ${description || 'なし'}`

  if (totalDays <= INJURY_PLAN_CHUNK_DAYS) {
    return generateInjuryRecoveryPlanChunk(bodyInfo, 1, totalDays, totalDays, language)
  }

  const results: InjuryDayPlan[] = []
  for (let start = 1; start <= totalDays; start += INJURY_PLAN_CHUNK_DAYS) {
    const end = Math.min(start + INJURY_PLAN_CHUNK_DAYS - 1, totalDays)
    const chunk = await generateInjuryRecoveryPlanChunk(bodyInfo, start, end, totalDays, language)
    results.push(...chunk)
  }
  return results
}

async function generateInjuryRecoveryPlanChunk(
  bodyInfo: string,
  startDay: number,
  endDay: number,
  totalDays: number,
  language: Language = 'ja'
): Promise<InjuryDayPlan[]> {
  const days = endDay - startDay + 1

  const system = `あなたは陸上競技のコンディショニングアドバイザーです。医療診断や治療の代わりではなく、一般的な練習調整の目安として、選手の怪我情報をもとに回復プランの一部をJSON配列で返してください。
全体では受傷からday=1〜day=${totalDays}までの回復プランを作成中で、今回はそのうちday=${startDay}〜day=${endDay}（${days}日分）だけを生成してください。

返却形式（${days}要素の配列、day番号は${startDay}から${endDay}まで）:
[{"day":${startDay},"phase":"急性期","exercises":[{"name":"アイシング","detail":"15分×3回"}],"avoid":["走ること"],"advice":"安静を保ちましょう"},...]

ルール:
- 必ずday=${startDay}からday=${endDay}まで全日分、過不足なく出力すること
- phaseは「急性期」「亜急性期」「リハビリ期」「復帰準備期」から、全体day=1〜${totalDays}の中でのこの日数帯にふさわしい段階を割り当てること（例:序盤は急性期、終盤は復帰準備期）
- exercisesは具体的な動作名と回数・時間を含めること
- avoidには絶対NGな動作を列挙すること
- JSON以外は一切出力しないこと` + narrativeLanguageInstruction(language)

  const user = `${bodyInfo}
回復日数（全体）: ${totalDays}日
今回生成する範囲: day=${startDay}〜day=${endDay}`

  const text = await callClaude({
    model: MODEL,
    max_tokens: 3000,
    // 2026-09-09: recoveryと同じ理由でfeature名を追加（軽量モデル振り分け対象にするため）
    feature: 'injury_recovery',
    system,
    messages: [{ role: 'user', content: user }],
  })

  if (!text) throw new Error('AIからの応答が空でした')
  return safeParseJSON<InjuryDayPlan[]>(text)
}

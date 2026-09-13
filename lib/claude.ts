// lib/claude.ts — Claude API 全呼び出しをここに集約
// SDK の代わりに fetch を直接使用（React Native 互換性のため）

import type {
  VideoAnalysisResult,
  MealAnalysisResult,
  RecoveryStatus,
  UserProfile,
  SleepRecord,
  TrainingSession,
  AthleticsEvent,
  InjuryDayPlan,
  WeekPlan,
} from '../types'
import { getVideoAnalysisPrompt } from '../prompts/video'
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

// Vercel Edge Function のプラン上の実行時間上限（実測で25秒前後）や、Gemini側の
// 一時的な高負荷（503）により生成が失敗することがある。同じリクエストを再送すると
// 生成時間にばらつきがあり成功することが多いため、5xx系エラーは1回だけ自動リトライする。
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

async function callClaudeOnce(req: MessagesRequest): Promise<Response> {
  const body = JSON.stringify({
    model: req.model,
    max_tokens: req.max_tokens,
    ...(req.system ? { system: req.system } : {}),
    messages: req.messages,
    ...(req.feature ? { feature: req.feature } : {}),
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
    }, 50000) // 50秒タイムアウト（Vercel maxDuration=60に合わせて余裕を持たせる）
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isTimeout = msg.includes('abort') || msg.includes('timeout') || msg.includes('Abort')
    throw new Error(isTimeout ? 'AI応答がタイムアウトしました。再試行してください。' : `ネットワークエラー: ${msg}`)
  }
}

async function callClaude(req: MessagesRequest): Promise<string> {
  let res = await callClaudeOnce(req)

  // Geminiの一時的な高負荷（503）やVercelの実行時間上限（504）は、
  // 間隔を空けて再送すると成功することが多いため最大2回リトライする（計3回試行）。
  for (let attempt = 0; !res.ok && RETRYABLE_STATUS.has(res.status) && attempt < 2; attempt++) {
    await sleep(1500 * (attempt + 1))
    res = await callClaudeOnce(req)
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    if (req.feature) trackAiRequestFailed(req.feature, `http_${res.status}`)
    throw new Error(`Anthropic API エラー (${res.status}): ${errText}`)
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

// ─────────────────────────────────────────
// 1. 動画分析
// ─────────────────────────────────────────
export async function analyzeVideo(
  frameBase64List: string[],
  event: AthleticsEvent
): Promise<VideoAnalysisResult> {
  const systemPrompt = getVideoAnalysisPrompt(event)

  const imageContents: ContentBlock[] = frameBase64List.map(base64 => ({
    type: 'image',
    source: { type: 'base64', media_type: detectMediaType(base64), data: base64 },
  }))

  const text = await callClaude({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          ...imageContents,
          { type: 'text', text: `種目: ${event}。この種目のコーチとして詳しくフォームを分析し、JSONで返してください。` },
        ],
      },
    ],
  })

  return safeParseJSON<VideoAnalysisResult>(text)
}

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

  return safeParseJSON<MealAnalysisResult>(text)
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

export async function askScoppy(history: ScoppyChatMessage[], language: Language): Promise<string> {
  // トークンコスト増大を防ぐため、直近の会話だけをAPIに送る（表示用の全履歴は
  // 呼び出し元(lib/scoppyChatStore.ts)がAsyncStorage側で別途保持する）
  const recent = history.slice(-16)
  const text = await callClaude({
    model: MODEL,
    max_tokens: 400,
    feature: 'scoppy_chat',
    system: SCOPPY_SYSTEM_PROMPT + narrativeLanguageInstruction(language),
    messages: recent.map(m => ({ role: m.role, content: m.content })),
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

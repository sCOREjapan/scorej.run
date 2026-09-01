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
    throw new Error(`Anthropic API エラー (${res.status}): ${errText}`)
  }

  const json = await res.json()
  const block = json?.content?.[0]
  const text = block?.type === 'text' && block.text ? block.text : ''
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
  language: Language = 'ja'
): Promise<{ phases: WeekPlan[]; peak_week: number; taper_start_week: number; key_advice: string }> {
  const daysLeft = Math.ceil((competitionDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 1) throw new Error('試合日が過去です')

  // 週数を最大8週に丸める（トークン超過防止）
  const cappedDays = Math.min(daysLeft, 56)
  const weeksLeft = Math.min(Math.ceil(cappedDays / 7), 8)

  if (weeksLeft <= COMPETITION_PLAN_CHUNK_WEEKS) {
    const systemPrompt = getCompetitionPlanPrompt(cappedDays, profile, competitionName, event) + narrativeLanguageInstruction(language)
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
    const systemPrompt = getCompetitionPlanChunkPrompt(chunkWeeks, weeksLeft, profile, competitionName, event) + narrativeLanguageInstruction(language)
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
// 5. 週次トレーニングサマリー
// ─────────────────────────────────────────
export async function getWeeklySummary(
  sessions: TrainingSession[],
  profile: UserProfile
): Promise<{ summary: string; next_week_focus: string; praise: string }> {
  const sessionText = sessions
    .map(s =>
      `${s.session_date}: ${s.session_type} ${s.event ?? ''} ` +
      `${s.time_ms ? formatMs(s.time_ms) : ''} 疲労${s.fatigue_level}/10`
    )
    .join('\n')

  const text = await callClaude({
    model: MODEL,
    max_tokens: 512,
    system: `あなたは${profile.event_category === 'sprint' ? '短距離' : '中長距離'}専門の陸上コーチです。
選手の1週間の練習記録を見て、以下のJSONを返してください：
{
  "summary": "1週間の練習の総評（2文）",
  "next_week_focus": "来週取り組むべきこと（1文）",
  "praise": "選手への具体的な褒め言葉（1文）"
}`,
    messages: [
      {
        role: 'user',
        content: `先週の練習記録：\n${sessionText || 'データなし'}`,
      },
    ],
  })

  return safeParseJSON(text)
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
  // 90日を超える指定は現実的な復帰プランの範囲を超え、チャンク数が際限なく増えて
  // トークン消費が膨れ上がるため強制的にクランプする。
  const totalDays = Math.min(Math.max(params.totalDays, 1), 90)

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

  const system = `あなたはスポーツ医学の専門家です。選手の怪我情報をもとに、回復プランの一部をJSON配列で返してください。
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
    system,
    messages: [{ role: 'user', content: user }],
  })

  if (!text) throw new Error('AIからの応答が空でした')
  return safeParseJSON<InjuryDayPlan[]>(text)
}

// ─────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────
function formatMs(ms: number): string {
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec.toFixed(2)}秒`
  const min = Math.floor(totalSec / 60)
  const sec = (totalSec % 60).toFixed(2)
  return `${min}分${sec}秒`
}

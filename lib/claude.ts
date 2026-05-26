// lib/claude.ts — Claude API 全呼び出しをここに集約
// SDK の代わりに fetch を直接使用（React Native 互換性のため）

import type {
  VideoAnalysisResult,
  MealAnalysisResult,
  CompetitionPlan,
  RecoveryStatus,
  UserProfile,
  SleepRecord,
  TrainingSession,
  AthleticsEvent,
} from '../types'
import { getVideoAnalysisPrompt } from '../prompts/video'
import { getMealAnalysisPrompt, getCompetitionPlanPrompt, getSleepAdvicePrompt } from '../prompts/index'

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

async function callClaude(req: MessagesRequest): Promise<string> {
  const body = JSON.stringify({
    model: req.model,
    max_tokens: req.max_tokens,
    ...(req.system ? { system: req.system } : {}),
    messages: req.messages,
  })

  let res: Response
  try {
    res = await fetchWithTimeout(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }, 50000) // 50秒タイムアウト（Vercel maxDuration=60に合わせて余裕を持たせる）
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isTimeout = msg.includes('abort') || msg.includes('timeout') || msg.includes('Abort')
    throw new Error(isTimeout ? 'AI応答がタイムアウトしました。再試行してください。' : `ネットワークエラー: ${msg}`)
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
  // コードブロック除去後、JSON抽出（AIが余計なテキストを返す場合に対応）
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
  // JSON オブジェクトの先頭・末尾を特定して取り出す
  const start = cleaned.indexOf('{')
  const end   = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('AIの応答にJSONが含まれていません')
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T
  } catch {
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
  trainingTiming: 'pre' | 'post' | 'none'
): Promise<MealAnalysisResult> {
  const systemPrompt = getMealAnalysisPrompt(mealType, profile.event_category, trainingTiming)

  const text = await callClaude({
    model: MODEL,
    max_tokens: 2048,
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
export async function generateCompetitionPlan(
  competitionDate: Date,
  competitionName: string,
  profile: UserProfile
): Promise<CompetitionPlan['phases'] & { peak_week: number; taper_start_week: number; key_advice: string }> {
  const daysLeft = Math.ceil((competitionDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 1) throw new Error('試合日が過去です')

  // 週数を最大8週に丸める（トークン超過防止）
  const cappedDays = Math.min(daysLeft, 56)
  const systemPrompt = getCompetitionPlanPrompt(cappedDays, profile, competitionName)

  const text = await callClaude({
    model: MODEL,
    max_tokens: 4096,   // 8週×7日分のJSONが収まる上限
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `${cappedDays}日後（${Math.ceil(cappedDays/7)}週間）の試合「${competitionName}」に向けた計画をJSONで作成してください。`,
      },
    ],
  })

  if (!text) throw new Error('AIからの応答が空でした。しばらく待ってから再試行してください。')
  return safeParseJSON(text)
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
// ユーティリティ
// ─────────────────────────────────────────
function formatMs(ms: number): string {
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec.toFixed(2)}秒`
  const min = Math.floor(totalSec / 60)
  const sec = (totalSec % 60).toFixed(2)
  return `${min}分${sec}秒`
}

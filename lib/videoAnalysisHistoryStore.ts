// lib/videoAnalysisHistoryStore.ts — 動画フォーム分析の結果履歴を直列化する共有ストア
//
// 背景: 分析結果は24時間TTLの再分析キャッシュ(score_va_cache_v2_*)にしか保存されておらず、
// 過去の分析結果をアプリ内で振り返る手段が無かった。キャッシュとは別に、有効期限なしの
// 履歴リストとして保存する。
import { createStorageQueue } from './storageQueue'

type Confidence = 'low' | 'medium' | 'high'
type FrameRef = { f: number; x: number; y: number; w: number; h: number }
type DimensionScore = { id: string; label: string; score: number; confidence: Confidence; reason: string; bbox?: FrameRef }
type FeedbackCard = { title: string; text: string; bbox?: FrameRef }

export interface VideoAnalysisHistoryEntry {
  id: string
  event: string
  created_at: string
  shot_date?: string   // 動画の撮影日（YYYY-MM-DD）。未入力時はcreated_atの日付を表示にフォールバック
  score: number
  // v2スキーマ（レーダーチャート方式）。旧エントリにはこれらが無いためoptional
  headline?: string
  dimensions?: DimensionScore[]
  confidenceOverall?: Confidence
  strength?: FeedbackCard
  focus?: FeedbackCard
  nextStep?: FeedbackCard
  practice?: { theme: string; drill: string; drillDetail: string }
  // 旧スキーマ（互換表示用）
  overall?: string
  positives?: string[]
  improvements?: string[]
  menu?: { name: string; detail: string }[]
  thumbBase64?: string   // 代表フレーム(先頭フレーム)のJPEG base64。一覧のサムネイル表示用
}

export const VIDEO_ANALYSIS_HISTORY_KEY = 'trackmate_video_analysis_history'
const MAX_ENTRIES = 30

const store = createStorageQueue<VideoAnalysisHistoryEntry[]>(VIDEO_ANALYSIS_HISTORY_KEY, [])

/**
 * 履歴を取得する。以前のバージョンではサムネイル画像(thumbBase64)を各エントリに
 * 保存しており、エントリが増えるほどJSON全体が肥大化してAsyncStorage.setItemの
 * 書き込みが失敗しやすくなっていた（失敗は呼び出し側で握りつぶされ、保存されて
 * いるはずの分析結果が実は保存されていない、という不具合の原因になっていた）。
 * 読み込み時に古いエントリの thumbBase64 を検知したら取り除いて書き戻す（自己修復）。
 */
export async function getVideoAnalysisHistory(): Promise<VideoAnalysisHistoryEntry[]> {
  const current = await store.get()
  if (!current.some(e => e.thumbBase64)) return current
  const cleaned = current.map(({ thumbBase64, ...rest }) => rest)
  await store.update(() => cleaned).catch(() => {})
  return cleaned
}

export function addVideoAnalysisHistory(entry: Omit<VideoAnalysisHistoryEntry, 'id' | 'created_at'>) {
  return store.update(current => {
    const next: VideoAnalysisHistoryEntry = {
      ...entry,
      id: `va_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      created_at: new Date().toISOString(),
    }
    return [next, ...current].slice(0, MAX_ENTRIES)
  })
}

export function deleteVideoAnalysisHistory(id: string) {
  return store.update(current => current.filter(e => e.id !== id))
}

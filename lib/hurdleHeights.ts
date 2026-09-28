// lib/hurdleHeights.ts — ハードル種目の高さプリセット（日本陸連規格に準拠）
import type { AthleticsEvent, RaceRecord } from '../types'

export const STANDARD_HURDLE_HEIGHTS = [
  { label: '106.7cm（一般・大学）', cm: 106.7, category: '一般・大学' },
  { label: '99.1cm（高校・ユース）', cm: 99.1, category: '高校・ユース' },
  { label: '91.4cm（中学）', cm: 91.4, category: '中学' },
] as const

const HURDLE_EVENTS: readonly AthleticsEvent[] = ['110mH', '100mH', '400mH']

export function isHurdleEvent(e: AthleticsEvent): boolean {
  return HURDLE_EVENTS.includes(e)
}

// 2026-09-24:「中学ハードルとジュニア(高校・一般)ハードルのベストは高さが違うので別扱いに
// してほしい」との指示で追加。ハードルは同じ種目コード(例:110mH)でもカテゴリーによって
// 高さ・間隔の規格が異なり、記録として比較できない別種目に近い。自己ベスト集計
// (app/(tabs)/records.tsx PBSummary・app/(tabs)/mypage.tsx eventPBs・app/coach-view.tsx)で
// 種目コードだけをキーにすると、高さ違いのベストが同じ枠に上書きされて片方が消えてしまう
// バグがあった。高さも含めたキーでグループ化することで、高さごとに別のベストとして残す。
export function pbGroupKey(event: AthleticsEvent, hurdleHeightCm?: number | null): string {
  return isHurdleEvent(event) && hurdleHeightCm ? `${event}_${hurdleHeightCm}` : event
}

// PBサマリー等の表示用に、ハードル種目だけ高さのカテゴリー名を種目ラベルに付け足す
// （例:「110mH」→「110mH（中学）」）。非ハードル種目や高さ未記録の場合は空文字。
export function hurdleCategorySuffix(event: AthleticsEvent, hurdleHeightCm?: number | null): string {
  if (!isHurdleEvent(event) || !hurdleHeightCm) return ''
  const preset = STANDARD_HURDLE_HEIGHTS.find(h => h.cm === hurdleHeightCm)
  return preset ? `（${preset.category}）` : ''
}

// records配列から「種目(+ハードルは高さ別)ごとの自己ベスト」1件ずつのMapを作る共通ヘルパー。
// 同じ種目コード・同じ高さの中でis_pbが複数あった場合は最初に見つかったものを採用する
// （既存の各画面の挙動をそのまま踏襲。is_pbは記録時にユーザー自身がトグルする自己申告値）。
export function collectPbMap<T extends Pick<RaceRecord, 'event' | 'hurdle_height_cm' | 'is_pb'>>(
  records: T[],
): Map<string, T> {
  const map = new Map<string, T>()
  records.filter(r => r.is_pb).forEach(r => {
    const key = pbGroupKey(r.event, r.hurdle_height_cm)
    if (!map.has(key)) map.set(key, r)
  })
  return map
}

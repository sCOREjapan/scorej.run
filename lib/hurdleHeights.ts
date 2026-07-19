// lib/hurdleHeights.ts — ハードル種目の高さプリセット（日本陸連規格に準拠）
import type { AthleticsEvent } from '../types'

export const STANDARD_HURDLE_HEIGHTS = [
  { label: '106.7cm（一般・大学）', cm: 106.7 },
  { label: '99.1cm（高校・ユース）', cm: 99.1 },
  { label: '91.4cm（中学）', cm: 91.4 },
] as const

const HURDLE_EVENTS: readonly AthleticsEvent[] = ['110mH', '100mH', '400mH']

export function isHurdleEvent(e: AthleticsEvent): boolean {
  return HURDLE_EVENTS.includes(e)
}

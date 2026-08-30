// lib/sessionTypeLabels.ts — 練習タイプ(session_type)の内部識別子(日本語固定値。変更不可)→ 表示ラベル・表示色
import type { Language } from '../context/LanguageContext'

export const SESSION_TYPE_LABEL: Record<string, string> = {
  interval: 'インターバル', tempo: 'テンポ走', easy: 'ジョグ',
  long: 'ロング走', sprint: 'スプリント', drill: 'ドリル',
  strength: 'ウェイト', race: '試合', rest: '休養',
}

const SESSION_TYPE_LABEL_EN: Record<string, string> = {
  interval: 'Interval', tempo: 'Tempo run', easy: 'Easy jog',
  long: 'Long run', sprint: 'Sprint', drill: 'Drill',
  strength: 'Strength', race: 'Race', rest: 'Rest',
}

export const SESSION_TYPE_COLOR: Record<string, string> = {
  interval: '#F5A623', tempo: '#FF9500', easy: '#4ECDC4',
  long: '#5AC8FA', sprint: '#FF6B6B', drill: '#AF52DE',
  strength: '#FF6B35', race: '#FFD700', rest: '#888',
}

export function getSessionTypeLabel(type: string, lang: Language = 'ja'): string {
  const map = lang === 'en' ? SESSION_TYPE_LABEL_EN : SESSION_TYPE_LABEL
  return map[type] ?? type
}

export function sessionTypeInfo(type: string, lang: Language = 'ja'): { color: string; label: string } {
  return { color: SESSION_TYPE_COLOR[type] ?? '#888', label: getSessionTypeLabel(type, lang) }
}

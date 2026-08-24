// lib/sessionTypeLabels.ts — 練習タイプ(session_type)の内部識別子 → 日本語表示ラベル・表示色
export const SESSION_TYPE_LABEL: Record<string, string> = {
  interval: 'インターバル', tempo: 'テンポ走', easy: 'ジョグ',
  long: 'ロング走', sprint: 'スプリント', drill: 'ドリル',
  strength: 'ウェイト', race: '試合', rest: '休養',
}

export const SESSION_TYPE_COLOR: Record<string, string> = {
  interval: '#F5A623', tempo: '#FF9500', easy: '#4ECDC4',
  long: '#5AC8FA', sprint: '#FF6B6B', drill: '#AF52DE',
  strength: '#FF6B35', race: '#FFD700', rest: '#888',
}

export function sessionTypeInfo(type: string): { color: string; label: string } {
  return { color: SESSION_TYPE_COLOR[type] ?? '#888', label: SESSION_TYPE_LABEL[type] ?? type }
}

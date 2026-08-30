// lib/eventLabels.ts — 種目コード（内部値=日本語、記録データ・AIプロンプトの実体なので変更不可）→ 表示ラベル
import type { AthleticsEvent } from '../types'
import type { Language } from '../context/LanguageContext'

const EVENT_LABEL_EN: Partial<Record<string, string>> = {
  '走幅跳': 'Long Jump', '三段跳': 'Triple Jump', '走高跳': 'High Jump', '棒高跳': 'Pole Vault',
  '砲丸投': 'Shot Put', 'やり投': 'Javelin Throw', '円盤投': 'Discus Throw', 'ハンマー投': 'Hammer Throw',
  '十種競技': 'Decathlon', '七種競技': 'Heptathlon', '八種競技': 'Octathlon',
  '競歩': 'Race Walk', 'ハーフ': 'Half Marathon', 'マラソン': 'Marathon',
  '4×100mR': '4x100m Relay', '4×400mR': '4x400m Relay',
  '400mH': '400m Hurdles', '110mH': '110m Hurdles', '100mH': '100m Hurdles', '300mH': '300m Hurdles',
  '3000mSC': '3000m Steeplechase',
  'half_marathon': 'Half Marathon', 'marathon': 'Marathon',
}

// half_marathon/marathon は AthleticsEvent 型上の内部値が英語トークンのため
// （他の種目は'走幅跳'等の日本語がそのまま内部値）、ja表示でも変換が必要。
const EVENT_LABEL_JA_OVERRIDE: Partial<Record<string, string>> = {
  'half_marathon': 'ハーフ', 'marathon': 'マラソン',
}

// 100m/800m等の数字+単位の距離種目は言語非依存なので EVENT_LABEL_EN に含めず、
// 未登録キーはそのまま返すフォールバックに任せる。
export function getEventLabel(event: AthleticsEvent | string, lang: Language): string {
  if (lang === 'ja') return EVENT_LABEL_JA_OVERRIDE[event] ?? event
  return EVENT_LABEL_EN[event] ?? event
}

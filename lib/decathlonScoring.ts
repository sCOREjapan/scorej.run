// lib/decathlonScoring.ts — 混成競技の得点計算（World Athletics 採点表の公式係数）
//
// 公式: トラック種目   P = INT(A × (B − T)^C)   T=記録(秒)
//       跳躍・投てき   P = INT(A × (M − B)^C)   M=記録(跳躍はcm／投てきはm)
// 係数(A・B・C)はWorld Athletics（旧IAAF）採点表に基づく国際共通の公開係数。
// 男子十種競技・女子七種競技の標準種目のみ対応（ジュニア八種競技等の特殊種目は非対応）。

export type ScoringUnit = 'sec' | 'cm' | 'm'

export type EventDef = {
  key: string
  label: string
  unit: ScoringUnit
  A: number
  B: number
  C: number
  isTrack: boolean   // true: P=A(B-T)^C（記録が小さいほど高得点）／false: P=A(M-B)^C（記録が大きいほど高得点）
}

// ── 男子十種競技（10種目・記載順=競技順） ──────────────────────────
export const DECATHLON_MEN: EventDef[] = [
  { key: '100m',   label: '100m',    unit: 'sec', A: 25.4347,  B: 18,  C: 1.81, isTrack: true  },
  { key: 'lj',     label: '走幅跳',   unit: 'cm',  A: 0.14354,  B: 220, C: 1.4,  isTrack: false },
  { key: 'sp',     label: '砲丸投',   unit: 'm',   A: 51.39,    B: 1.5, C: 1.05, isTrack: false },
  { key: 'hj',     label: '走高跳',   unit: 'cm',  A: 0.8465,   B: 75,  C: 1.42, isTrack: false },
  { key: '400m',   label: '400m',    unit: 'sec', A: 1.53775,  B: 82,  C: 1.81, isTrack: true  },
  { key: '110mh',  label: '110mH',   unit: 'sec', A: 5.74352,  B: 28.5,C: 1.92, isTrack: true  },
  { key: 'dt',     label: '円盤投',   unit: 'm',   A: 12.91,    B: 4,   C: 1.1,  isTrack: false },
  { key: 'pv',     label: '棒高跳',   unit: 'cm',  A: 0.2797,   B: 100, C: 1.35, isTrack: false },
  { key: 'jt',     label: 'やり投',   unit: 'm',   A: 10.14,    B: 7,   C: 1.08, isTrack: false },
  { key: '1500m',  label: '1500m',   unit: 'sec', A: 0.03768,  B: 480, C: 1.85, isTrack: true  },
]

// ── 女子七種競技（7種目・記載順=競技順） ────────────────────────────
export const HEPTATHLON_WOMEN: EventDef[] = [
  { key: '100mh',  label: '100mH',   unit: 'sec', A: 9.23076,  B: 26.7, C: 1.835, isTrack: true  },
  { key: 'hj',     label: '走高跳',   unit: 'cm',  A: 1.84523,  B: 75,   C: 1.348, isTrack: false },
  { key: 'sp',     label: '砲丸投',   unit: 'm',   A: 56.0211,  B: 1.5,  C: 1.05,  isTrack: false },
  { key: '200m',   label: '200m',    unit: 'sec', A: 4.99087,  B: 42.5, C: 1.81,  isTrack: true  },
  { key: 'lj',     label: '走幅跳',   unit: 'cm',  A: 0.188807, B: 210,  C: 1.41,  isTrack: false },
  { key: 'jt',     label: 'やり投',   unit: 'm',   A: 15.9803,  B: 3.8,  C: 1.04,  isTrack: false },
  { key: '800m',   label: '800m',    unit: 'sec', A: 0.11193,  B: 254,  C: 1.88,  isTrack: true  },
]

// ── 中学男子四種競技（4種目・記載順=競技順） ──────────────────────────
// 係数は公式のIAAF/JAAF公表値ではなく、NPO法人高知陸上競技協会が公開する
// 「中学男子四種競技得点表（電気計時）」(http://npo-kochi.sports.coocan.jp/iinkai/joho_i/4shu_table_m.pdf)
// の記録⇔得点の対応表（約70点）から P=A(B−T)^C / P=A(M−B)^C の係数を最小二乗法で逆算したもの。
// 元表との誤差は最大でも1点未満（多くの記録で完全一致）。公式記録会等の正式採点には
// 必ず日本陸連発行の得点表を使用すること。
export const TETRATHLON_JHS_MEN: EventDef[] = [
  { key: '110mh',  label: '110mH',        unit: 'sec', A: 5.691035, B: 28.502862, C: 1.923110, isTrack: true  },
  { key: 'sp4kg',  label: '砲丸投(4kg)',  unit: 'm',   A: 51.695864,B: 1.519118,  C: 1.047921,  isTrack: false },
  { key: 'hj',     label: '走高跳',       unit: 'cm',  A: 0.860274,  B: 75.292400, C: 1.417203, isTrack: false },
  { key: '400m',   label: '400m',         unit: 'sec', A: 1.577679, B: 81.888468, C: 1.804349,  isTrack: true  },
]

/** 1種目の記録(mark)から得点を計算する。マイナス値は0点に丸める。 */
export function calcEventScore(event: EventDef, mark: number): number {
  if (!(mark > 0)) return 0
  const diff = event.isTrack ? event.B - mark : mark - event.B
  if (diff <= 0) return 0
  const raw = event.A * Math.pow(diff, event.C)
  return Math.max(0, Math.floor(raw))
}

/** 全種目の合計点を計算する。記録未入力(undefined/0)の種目は0点として扱う。 */
export function calcTotalScore(events: EventDef[], marks: Record<string, number | undefined>): number {
  return events.reduce((sum, e) => sum + calcEventScore(e, marks[e.key] ?? 0), 0)
}

export function unitLabel(unit: ScoringUnit, lang: 'ja' | 'en' = 'ja'): string {
  if (unit === 'sec') return lang === 'en' ? 's' : '秒'
  if (unit === 'cm')  return 'cm'
  return 'm'
}

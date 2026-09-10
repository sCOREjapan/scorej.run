// lib/windConversion.ts — 風速による参考タイム換算（無風換算・追い風+2.0m/s換算）
//
// 【背景】テスター(りお)からのフィードバック:「風の強さも記入出来るようにして、かつ
// ＋2.0換算、無風換算でのタイムが出るようになればより良い」。風速自体は既に
// app/(tabs)/records.tsx の記録フォーム(wind_ms)に実装済みだったが、換算タイムの
// 表示が無かったため、この換算ロジックのみを追加する。
//
// 【計算方法・免責】厳密な空気力学モデル(風洞実験や個々の走者の空気抵抗係数まで
// 考慮したもの)ではなく、指導現場で目安として使われる単純な線形近似
// 「追い風1m/sあたり約0.01秒速くなる」を採用した“参考値”。あくまで目安であり、
// 公認記録の判定などに使うものではない（表示側でも「目安」であることを明示する）。
//
// 【対象種目】World Athleticsの競技規則で風の影響が記録に関わるのは100m/200m/
// 100mH/110mHのみ（400m以上は1周のうち向かい風・追い風が相殺されるため対象外、
// 跳躍種目はタイムでなく距離への换算になり別の物理モデルが必要なため今回は対象外）。
const WIND_ELIGIBLE_EVENTS = new Set(['100m', '200m', '100mH', '110mH'])

// 1m/s の追い風あたり何秒速くなるか、の近似係数
const COEFFICIENT_SEC_PER_MS = 0.01

export function isWindConvertibleEvent(event: string): boolean {
  return WIND_ELIGIBLE_EVENTS.has(event)
}

export type WindAdjustedTimes = { noWindSec: number; plus2Sec: number }

/**
 * 記録タイム(秒)と実測風速(m/s、追い風を+とする)から、
 * 無風換算タイム・追い風+2.0m/s換算タイム(いずれも秒)を返す。
 * 対象外種目・不正な入力の場合は null。
 */
export function windAdjustedTimes(resultSeconds: number, windMs: number, event: string): WindAdjustedTimes | null {
  if (!isWindConvertibleEvent(event)) return null
  if (!Number.isFinite(resultSeconds) || !Number.isFinite(windMs)) return null
  // 追い風(+)は実タイムを本来より速く(小さく)しているので、無風相当に戻すには時間を足す。
  // +2.0換算も同様に「実際の風」と「目標の風(0 or 2.0)」との差分だけ補正する。
  return {
    noWindSec: resultSeconds + COEFFICIENT_SEC_PER_MS * windMs,
    plus2Sec:  resultSeconds + COEFFICIENT_SEC_PER_MS * (windMs - 2.0),
  }
}

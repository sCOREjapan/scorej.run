// lib/parseWorkoutDistance.ts — 自由入力テキストから距離・本数を抽出する共通ロジック
//
// practice-input.tsx / QuickLogModal.tsx / notebook.tsx のフォールバックパーサーで
// それぞれ個別に距離・本数を抽出していたが、「300×6」のような掛け算表記が
// 合計距離として計算されずに片方の数値しか保存されないバグがあったため、
// ロジックを1箇所に集約する。

export function parseDistanceAndReps(t: string): { distance_m: number | null; reps: number | null; multiplied: boolean } {
  const kmMatch = t.match(/(\d+(?:\.\d+)?)\s*km/i)
  const mMatch  = t.match(/(\d+)\s*m(?!H|SC)\b/)

  // 距離×本数（例: 300×6 / 300m×6 / 300m×6本 / 1km×3）→ 1本あたりの距離×本数を合計距離として扱う
  // 「30×4、60×3、100×2」のように複数セットが並記されることがあるため、最初の1件だけでなく
  // 出現する全パターンを合計する（global match。以前は最初の1件しか拾えず、
  // 後続セットの距離が合計距離・怪我リスク計算から欠落するバグがあった）
  const multMatches = Array.from(t.matchAll(/(\d+(?:\.\d+)?)\s*(km|m)?\s*[×xX*]\s*(\d+)\s*(?:本|set|本セット)?/gi))

  let distance_m: number | null = null
  let reps: number | null = null
  let multiplied = false

  if (multMatches.length > 0) {
    let totalDistance = 0
    let totalReps = 0
    for (const m of multMatches) {
      const unit    = m[2]?.toLowerCase()
      const perUnit = unit === 'km' ? parseFloat(m[1]) * 1000 : parseInt(m[1], 10)
      const count   = parseInt(m[3], 10)
      if (perUnit > 0 && count > 0) {
        totalDistance += perUnit * count
        totalReps += count
      }
    }
    if (totalDistance > 0) {
      distance_m = Math.round(totalDistance)
      reps = totalReps
      multiplied = true
    }
  }

  if (distance_m === null) {
    if (kmMatch) distance_m = Math.round(parseFloat(kmMatch[1]) * 1000)
    else if (mMatch && parseInt(mMatch[1], 10) > 50) distance_m = parseInt(mMatch[1], 10)
  }

  if (reps === null) {
    const repsMatch = t.match(/(\d+)\s*(本|set|本セット)/)
    reps = repsMatch ? parseInt(repsMatch[1], 10) : null
  }

  return { distance_m, reps, multiplied }
}

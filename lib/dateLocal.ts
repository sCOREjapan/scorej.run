// lib/dateLocal.ts — ローカルタイムゾーンの日付ヘルパー
// toISOString().slice(0,10) は UTC 日付になるため、JST など UTC+ の地域では
// 深夜0〜9時に「前日」として記録されてしまう。記録の session_date には必ずこれを使う。

/** Date → ローカル "YYYY-MM-DD" */
export function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 今日のローカル "YYYY-MM-DD" */
export function todayLocalISO(): string {
  return localDateStr(new Date())
}

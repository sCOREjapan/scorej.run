// lib/aiLanguage.ts — AIプロンプトの自由記述部分だけを英語化するための指示サフィックス
// JSONスキーマの固定値(phase等)は日本語のまま扱われる前提のプロンプトが多いため、
// プロンプト全体を翻訳させるのではなく「自由記述の説明文だけ英語にする」よう
// 末尾に追記する形にする（api/analyze.ts 側は system/messages をそのまま中継するだけなので変更不要）。
import type { Language } from '../context/LanguageContext'

export function narrativeLanguageInstruction(lang: Language): string {
  if (lang !== 'en') return ''
  return `

[IMPORTANT] Write only the free-text narrative fields (e.g. advice, summary, comments, feedback text) in natural, fluent English. Do NOT translate any JSON field name, and do NOT translate any field whose allowed values were explicitly listed above in quotes (enums like intensity, phase, category labels) — keep those exactly as specified.`
}

// prompts/meal.ts
import type { MealType, EventCategory } from '../types'

export function getMealAnalysisPrompt(
  mealType: MealType,
  eventCategory: EventCategory,
  trainingTiming: 'pre' | 'post' | 'none'
): string {
  const athleteContext = eventCategory === 'sprint'
    ? '短距離選手（爆発系・筋肥大・クレアチン燐酸系エネルギー重視）'
    : '中長距離選手（有酸素系・グリコーゲン補給・鉄分・抗酸化重視）'

  const timingNote = trainingTiming === 'pre'
    ? 'トレーニング前の食事です。消化しやすさと素早いエネルギー補給を評価してください。'
    : trainingTiming === 'post'
    ? 'トレーニング後の食事です。筋肉の回復とグリコーゲン再合成を最優先に評価してください。'
    : ''

  return `あなたはスポーツ栄養士で、${athleteContext}の食事指導の専門家です。
${timingNote}

写真の食事内容を分析し、以下のJSONのみを返してください（前後のテキスト不要）：

{
  "foods": [
    {
      "name": "食品名（日本語）",
      "calories": カロリー（kcal、整数）,
      "protein": タンパク質（g、小数第1位）,
      "carb": 炭水化物（g、小数第1位）,
      "fat": 脂質（g、小数第1位）,
      "confidence": 推定の確信度（0.0〜1.0）
    }
  ],
  "total_calories": 合計カロリー（kcal）,
  "total_protein": 合計タンパク質（g）,
  "total_carb": 合計炭水化物（g）,
  "total_fat": 合計脂質（g）,
  "advice": "陸上選手として食事内容への短評（1〜2文、具体的な改善提案か称賛）",
  "hydration_reminder": "水分補給が必要そうなら一言（不要なら null）"
}`
}

// prompts/competition.ts
import type { TrackEvent, UserProfile } from '../types'

export function getCompetitionPlanPrompt(
  daysLeft: number,
  profile: UserProfile,
  competitionName: string
): string {
  const weeksLeft = Math.min(Math.ceil(daysLeft / 7), 8) // 最大8週
  const category = profile.event_category === 'sprint' ? '短距離' : '中長距離'

  const pbInfo = profile.personal_best_ms
    ? `PB:${formatTime(profile.personal_best_ms, profile.primary_event)}`
    : 'PB未設定'

  const targetInfo = profile.target_time_ms
    ? ` 目標:${formatTime(profile.target_time_ms, profile.primary_event)}`
    : ''

  return `${category}専門コーチ。${profile.primary_event}選手(${pbInfo}${targetInfo}, 経験${profile.experience_years ?? '?'}年)の「${competitionName}」まで${weeksLeft}週間の計画をJSONのみで返せ。

必須ルール:
- phases配列は必ず${weeksLeft}要素（多くも少なくもNG）
- week_number=1が試合直前週
- sessionsは各週5〜6件（月〜土、詳細は簡潔に20文字以内）
- intensityは easy/moderate/hard/race のみ
- 前後の説明文・マークダウン不要、JSONだけ返す

{"phases":[{"week_number":1,"theme":"テーマ","total_volume_km":30,"sessions":[{"day":"月曜","type":"easy","detail":"jog 30min","duration_min":40,"intensity":"easy"},{"day":"火曜","type":"interval","detail":"400m×5 r3min","duration_min":60,"intensity":"hard"}],"key_workout":"週のメインワークアウト"}],"peak_week":${Math.max(2, weeksLeft-1)},"taper_start_week":2,"key_advice":"アドバイス2文"}`
}

function formatTime(ms: number, event: TrackEvent): string {
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec.toFixed(2)}秒`
  const min = Math.floor(totalSec / 60)
  const sec = (totalSec % 60).toFixed(2)
  return `${min}分${sec}秒`
}

// prompts/sleep.ts
import type { SleepRecord, TrainingSession } from '../types'

export function getSleepAdvicePrompt(
  recentSleep: SleepRecord[],
  recentSessions: TrainingSession[]
): string {
  const sleepSummary = recentSleep.slice(-7).map(s =>
    `${s.sleep_date}: ${s.duration_min ?? '?'}分, 質=${s.quality_score}/10`
  ).join('\n')

  const sessionSummary = recentSessions.slice(-7).map(s =>
    `${s.session_date}: ${s.session_type}, 疲労=${s.fatigue_level}/10`
  ).join('\n')

  return `あなたはスポーツ科学者でコンディショニング専門家です。
以下の直近7日間のデータを分析してください。

【睡眠記録】
${sleepSummary || 'データなし'}

【トレーニング疲労】
${sessionSummary || 'データなし'}

回復状態を評価し、以下のJSONのみを返してください：

{
  "overall": 0から100の総合コンディションスコア,
  "sleep_score": 睡眠スコア（0〜100）,
  "fatigue_score": 疲労スコア（0〜100、低いほど疲労大）,
  "readiness": "high/moderate/low のいずれか",
  "advice": "今日のトレーニング強度への具体的なアドバイス（1〜2文）",
  "warning": "注意が必要な点（問題なければ null）"
}`
}

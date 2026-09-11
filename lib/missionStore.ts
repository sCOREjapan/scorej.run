// lib/missionStore.ts — 3日間アクティベーションミッション
//
// 2026-09-11: components/FirstRunChecklist.tsx（「いつでもいい」常駐チェックリスト）を
// 置き換える。Day1〜Day3に分けてタスクを提示し、日をまたぐたびに再訪する理由を作る
// （ポケポケのデイリーミッション形式を参考にした設計）。
//
// 【設計方針】
// ・タスクの完了判定は既存データ（練習記録・体調・動画分析履歴・食事記録・大会登録・
//   ストレッチ）から都度導出する。ミッション専用の完了フラグを別に持つと元データと
//   ズレるため、ここで永続化するのは「いつ始まったか」と「チケット報酬を渡したか」だけ。
// ・日の切り替えは必ずJSTローカル日付(todayLocalISO)の差分で判定する。UTCで判定すると
//   JST 0-9時のユーザーだけ日付がズレて誤判定する（api/analyze.tsのHARD_CAPで実際に
//   起きた障害と同根の落とし穴なので、ここでは最初から踏まない）。
// ・日をまたいでもタスクを取り戻せるようにする（Day1をサボった翌日にDay2を強制されて
//   詰むと離脱するので、進んだ日までのタスクは常に遡って達成扱いにできる）。
import AsyncStorage from '@react-native-async-storage/async-storage'
import { todayLocalISO, localDateStr } from './dateLocal'
import { VIDEO_ANALYSIS_HISTORY_KEY, type VideoAnalysisHistoryEntry, addVideoAnalysisHistory } from './videoAnalysisHistoryStore'
import { getConditionMap, updateConditionMap } from './conditionStore'
import { getStretchResult, updateStretchResult } from './stretchResultStore'
import { grantMissionDay1BonusIfNeeded, grantMissionDay2BonusIfNeeded } from './ticketWallet'
import type { TrainingSession, MealRecord, CompetitionPlan } from '../types'

const MISSION_STATE_KEY  = 'score_mission_state_v1'
const SESSIONS_KEY       = 'trackmate_sessions'
const MEALS_KEY          = 'trackmate_meals'
const COMPETITIONS_KEY   = 'trackmate_competitions'

export type MissionDay = 1 | 2 | 3

export interface MissionState {
  startDate: string        // ミッション開始日（JSTローカル、YYYY-MM-DD）
  claimedDay1: boolean      // Day1報酬(チケット5枚)を受け取り済みか
  claimedDay2: boolean      // Day2報酬(チケット2枚)を受け取り済みか
  finished: boolean         // Day3の結果カード〜セールまで見終えた（以後二度と出さない）
  saleExpiresAt?: string    // Day3の「続ける」を押した瞬間に確定する24時間セールの期限(ISO)
}

const DEFAULT_STATE: MissionState = { startDate: '', claimedDay1: false, claimedDay2: false, finished: false }

export interface MissionTaskStatus {
  key: 'practice' | 'condition' | 'video' | 'competition' | 'meal' | 'stretch'
  done: boolean
}

export interface MissionDayProgress {
  day: MissionDay
  date: string              // このDayに対応するJSTローカル日付
  tasks: MissionTaskStatus[]
  allDone: boolean
  // 2026-09-11: 「動画分析(Day1)・食事分析(Day2)はチケットが無いとできないのに、
  // その日の報酬(チケット)自体がそのタスク込みの全タスク完了を条件にしている」という
  // 鶏卵問題が発覚（新規ユーザーはチケット0枚で詰む）。Day1・Day2は、チケット不要な
  // 練習・体調の2タスクが終わった時点でrewardEligible=trueにし、先にチケットを
  // 受け取ってからチケット消費タスクに進めるようにする。Day3はチケットを使う
  // タスクを含まないため、この後払い分割は不要（rewardEligible=allDoneのまま）。
  rewardEligible: boolean
  rewardTickets: number      // このDayを全部終えた時に貰えるチケット枚数（Day3は0=結果カードが報酬）
  rewardClaimed: boolean
}

function daysBetweenLocal(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00')
  const db = new Date(b + 'T00:00:00')
  return Math.round((db.getTime() - da.getTime()) / 86400000)
}

async function readState(): Promise<MissionState> {
  try {
    const raw = await AsyncStorage.getItem(MISSION_STATE_KEY)
    if (raw) return { ...DEFAULT_STATE, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULT_STATE }
}
async function writeState(s: MissionState): Promise<void> {
  await AsyncStorage.setItem(MISSION_STATE_KEY, JSON.stringify(s)).catch(() => {})
}

/** 初回ホーム到達時に呼ぶ。まだ始まっていなければ今日を開始日として記録する */
export async function ensureMissionStarted(): Promise<MissionState> {
  const state = await readState()
  if (!state.startDate) {
    state.startDate = todayLocalISO()
    await writeState(state)
  }
  return state
}

export async function getMissionState(): Promise<MissionState> {
  return readState()
}

/** ミッション自体を今後表示しない（本人が閉じた／結果カードまで見終えた） */
export async function finishMission(): Promise<void> {
  const state = await readState()
  state.finished = true
  await writeState(state)
}

/**
 * Day3の結果カードから「続ける」を押した瞬間に24時間セールの期限を確定する。
 * 既に確定済みなら上書きしない（画面を出入りするたびに24時間が延長されるのを防ぐ）。
 */
export async function startSaleWindowIfNeeded(): Promise<string> {
  const state = await readState()
  if (!state.saleExpiresAt) {
    state.saleExpiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    await writeState(state)
  }
  return state.saleExpiresAt
}

/** Day1/Day2のタスクを全部終えた時に呼ぶ。チケット付与+受け取り済みフラグの更新を一括で行う */
export async function claimDayReward(day: 1 | 2, startDate: string): Promise<{ granted: boolean; tickets: number }> {
  const { granted } = day === 1
    ? await grantMissionDay1BonusIfNeeded(startDate)
    : await grantMissionDay2BonusIfNeeded(startDate)
  if (granted) {
    const state = await readState()
    if (day === 1) state.claimedDay1 = true
    if (day === 2) state.claimedDay2 = true
    await writeState(state)
  }
  return { granted, tickets: day === 1 ? 5 : 2 }
}

/** 現在アクティブなDay（開始日からの経過日数で決まる。3日目に到達したらそのまま3に固定） */
export function currentMissionDay(startDate: string, today: string = todayLocalISO()): MissionDay {
  const diff = daysBetweenLocal(startDate, today)
  if (diff <= 0) return 1
  if (diff === 1) return 2
  return 3
}

// ── 各タスクの完了判定（既存ストアから導出。ミッション専用フラグは持たない） ──

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

async function hasLoggedPracticeOn(date: string): Promise<boolean> {
  const sessions = await readJson<TrainingSession[]>(SESSIONS_KEY, [])
  return sessions.some(s => s.session_date === date)
}

async function hasLoggedConditionOn(date: string): Promise<boolean> {
  const map = await getConditionMap().catch(() => ({} as Record<string, number>))
  return map?.[date] != null
}

async function hasAnalyzedVideoOn(date: string): Promise<boolean> {
  const list = await readJson<VideoAnalysisHistoryEntry[]>(VIDEO_ANALYSIS_HISTORY_KEY, [])
  // created_at はISO(UTC)のため、JSTローカル日付に変換してから比較する
  // （UTC文字列を素朴にsliceすると深夜0-9時のユーザーだけ前日扱いになる不具合の系統）
  return list.some(v => v.created_at && localDateStr(new Date(v.created_at)) === date)
}

async function hasRegisteredCompetitionEver(): Promise<boolean> {
  const list = await readJson<Array<{ competition_date?: string }>>(COMPETITIONS_KEY, [])
  return list.length > 0
}

async function hasAnalyzedMealOn(date: string): Promise<boolean> {
  const list = await readJson<MealRecord[]>(MEALS_KEY, [])
  return list.some(m => m.meal_date === date && !!m.advice)
}

async function hasStretchedOn(date: string): Promise<boolean> {
  const r = await getStretchResult().catch(() => null)
  return r?.date === date
}

/** 指定したDayのタスク一覧と達成状況を返す */
export async function getMissionDayProgress(day: MissionDay, startDate: string, state: MissionState): Promise<MissionDayProgress> {
  const date = localDateStr(new Date(new Date(startDate + 'T00:00:00').getTime() + (day - 1) * 86400000))

  if (day === 1) {
    const [practice, condition, video, competition] = await Promise.all([
      hasLoggedPracticeOn(date), hasLoggedConditionOn(date), hasAnalyzedVideoOn(date), hasRegisteredCompetitionEver(),
    ])
    const tasks: MissionTaskStatus[] = [
      { key: 'practice', done: practice }, { key: 'condition', done: condition },
      { key: 'video', done: video }, { key: 'competition', done: competition },
    ]
    // 動画分析はチケット消費タスクなので、チケット不要な練習・体調の2つが終わった時点で
    // 報酬を受け取れるようにする（受け取ったチケットでそのまま動画分析に進めるように）
    return {
      day, date, tasks, allDone: tasks.every(t => t.done),
      rewardEligible: practice && condition,
      rewardTickets: 5, rewardClaimed: state.claimedDay1,
    }
  }
  if (day === 2) {
    const [practice, condition, meal] = await Promise.all([
      hasLoggedPracticeOn(date), hasLoggedConditionOn(date), hasAnalyzedMealOn(date),
    ])
    const tasks: MissionTaskStatus[] = [
      { key: 'practice', done: practice }, { key: 'condition', done: condition }, { key: 'meal', done: meal },
    ]
    // 2026-09-11:「食事分析も同じ」との指摘で、Day1と同じ理由(食事分析はチケット消費
    // タスク)によりDay2もrewardEligibleを練習・体調の2つだけで満たすようにした。
    // 理屈上はDay1の報酬(5枚)が残っていれば食事分析(1枚)は賄えるはずだが、Day1の
    // チケットを他の用途に使い切っていた場合でもDay2で詰まないようにする防御的な統一。
    return {
      day, date, tasks, allDone: tasks.every(t => t.done),
      rewardEligible: practice && condition,
      rewardTickets: 2, rewardClaimed: state.claimedDay2,
    }
  }
  // day === 3（チケットを使うタスクが無いため後払い分割は不要）
  const [condition, stretch] = await Promise.all([hasLoggedConditionOn(date), hasStretchedOn(date)])
  const tasks: MissionTaskStatus[] = [{ key: 'condition', done: condition }, { key: 'stretch', done: stretch }]
  const day3AllDone = tasks.every(t => t.done)
  return { day, date, tasks, allDone: day3AllDone, rewardEligible: day3AllDone, rewardTickets: 0, rewardClaimed: true }
}

/**
 * 結果カード用に、Day1〜3を通じて実際に達成したタスクだけをまとめて返す。
 * （日をまたぐ判定はカレンダー日付だけで進むため、途中の日をサボっていても
 * Day3には到達できる。結果カードには「本当にやったこと」だけを出す）
 */
export async function getMissionAchievements(startDate: string, state: MissionState): Promise<MissionTaskStatus['key'][]> {
  const [d1, d2, d3] = await Promise.all([
    getMissionDayProgress(1, startDate, state),
    getMissionDayProgress(2, startDate, state),
    getMissionDayProgress(3, startDate, state),
  ])
  const doneKeys = new Set<MissionTaskStatus['key']>()
  for (const day of [d1, d2, d3]) {
    for (const task of day.tasks) if (task.done) doneKeys.add(task.key)
  }
  return Array.from(doneKeys)
}

// ── 結果カード用の実データ集計（AIに渡す・そのまま数字として表示する両方に使う） ──
// 2026-09-11: 「実際に3日間記録したデータから統計を出してほしい」との指示。
// AIには「解釈」だけをさせ、数字自体はここで確定的に計算する
// （AIの生成に数字を委ねると桁を間違える/日によって違う値を言うブレのリスクがあるため）。
export interface MissionStats {
  totalSessions: number             // 3日間の練習記録数
  conditionFirst: number | null     // Day1の体調スコア
  conditionLast: number | null      // 記録がある最後の日の体調スコア
  videoScore: number | null         // 動画分析のスコア（あれば）
  hasMealAnalysis: boolean
  hasCompetitionRegistered: boolean
  riskReduction: number | null      // ストレッチによる怪我リスク軽減(%)
}

export async function getMissionStats(startDate: string): Promise<MissionStats> {
  const dates = [0, 1, 2].map(i => localDateStr(new Date(new Date(startDate + 'T00:00:00').getTime() + i * 86400000)))
  const [sessions, condMap, videoList, meals, competitions, stretch] = await Promise.all([
    readJson<TrainingSession[]>(SESSIONS_KEY, []),
    getConditionMap().catch(() => ({} as Record<string, number>)),
    readJson<VideoAnalysisHistoryEntry[]>(VIDEO_ANALYSIS_HISTORY_KEY, []),
    readJson<MealRecord[]>(MEALS_KEY, []),
    readJson<Array<{ competition_date?: string }>>(COMPETITIONS_KEY, []),
    getStretchResult().catch(() => null),
  ])

  const totalSessions = sessions.filter(s => dates.includes(s.session_date)).length
  const conditionValues = dates.map(d => condMap?.[d]).filter((v): v is number => v != null)
  const videoEntry = videoList.find(v => v.created_at && dates.includes(localDateStr(new Date(v.created_at))))
  const hasMealAnalysis = meals.some(m => dates.includes(m.meal_date) && !!m.advice)

  return {
    totalSessions,
    conditionFirst: conditionValues[0] ?? null,
    conditionLast: conditionValues[conditionValues.length - 1] ?? null,
    videoScore: videoEntry?.score ?? null,
    hasMealAnalysis,
    hasCompetitionRegistered: competitions.length > 0,
    riskReduction: dates.includes(stretch?.date ?? '') ? (stretch?.reduction ?? null) : null,
  }
}

// ══════════════════════════════════════════════════════════════════════
// DEV専用: 「Day Nのタスクを全部達成扱いにする」ワンタップボタン用。
// 2026-09-11: 実際に動画分析・食事分析・ストレッチ等を最後まで行わないと
// ミッションのタスク完了フローを試せず、Day1/2/3プレビュー(forceDay)だけでは
// 「タスクが全部終わった状態」を検証しきれないとの指摘で追加。
// 各タスクは実データストアに「今日の分」のダミー記録を1件足すだけなので、
// 判定ロジック(hasLoggedPracticeOn等)は本番と完全に同じ経路を通る。
// startDateを「今日がDay Nになる日付」へ付け替えてから書き込むことで、
// video(created_at基準)のように日付を後から偽装できないタスクも含めて
// 常に「今日」のデータとして矛盾なく成立させる。
// __DEV__ビルドのボタンからのみ呼ばれる想定。
// ══════════════════════════════════════════════════════════════════════
async function devMarkPracticeToday(): Promise<void> {
  const date = todayLocalISO()
  const sessions = await readJson<TrainingSession[]>(SESSIONS_KEY, [])
  if (sessions.some(s => s.session_date === date)) return
  const entry: TrainingSession = {
    id: `dev_${Date.now()}`,
    user_id: 'dev',
    session_date: date,
    session_type: 'easy',
    fatigue_level: 3,
    condition_level: 7,
    notes: 'DEVテスト用のダミー練習記録です。',
    created_at: new Date().toISOString(),
  }
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify([entry, ...sessions])).catch(() => {})
}

async function devMarkConditionToday(): Promise<void> {
  const date = todayLocalISO()
  await updateConditionMap(current => ({ ...current, [date]: 7 }))
}

async function devMarkVideoAnalyzedToday(): Promise<void> {
  await addVideoAnalysisHistory({ event: 'DEVテスト', score: 80, headline: 'DEV: 動画分析タスクを達成扱いにしました' })
}

async function devMarkCompetitionRegistered(): Promise<void> {
  const list = await readJson<Array<{ competition_date?: string }>>(COMPETITIONS_KEY, [])
  if (list.length > 0) return
  const compDate = localDateStr(new Date(Date.now() + 90 * 86400000))
  const entry: CompetitionPlan = {
    id: `dev_${Date.now()}`,
    user_id: 'dev',
    competition_name: 'DEVテスト大会',
    competition_date: compDate,
    event: '100m',
    target_time_ms: 12000,
    days_until: 90,
    phases: [],
    peak_week: 1,
    taper_start_week: 1,
    key_advice: 'DEVテスト用のダミー大会です。',
    created_at: new Date().toISOString(),
  }
  await AsyncStorage.setItem(COMPETITIONS_KEY, JSON.stringify([entry, ...list])).catch(() => {})
}

async function devMarkMealAnalyzedToday(): Promise<void> {
  const date = todayLocalISO()
  const list = await readJson<MealRecord[]>(MEALS_KEY, [])
  const entry: MealRecord = {
    id: `dev_${Date.now()}`,
    user_id: 'dev',
    meal_date: date,
    meal_type: 'lunch',
    foods: [],
    total_calories: 0,
    total_protein: 0,
    total_carb: 0,
    total_fat: 0,
    advice: 'DEVテスト用のダミー食事分析コメントです。',
    created_at: new Date().toISOString(),
  }
  await AsyncStorage.setItem(MEALS_KEY, JSON.stringify([entry, ...list])).catch(() => {})
}

async function devMarkStretchToday(): Promise<void> {
  const date = todayLocalISO()
  await updateStretchResult(() => ({ date, reduction: 12, showBanner: false, lastReduction: 12 }))
}

/**
 * DEV専用: Day Nのタスクを全部達成扱いにする。まずstartDateを「今日がDay Nに
 * 当たる日付」へ付け替え(既にその条件を満たしていれば変更しない)、その上で
 * そのDayが必要とするタスク分のダミー記録を書き込む。
 */
export async function devCompleteDayTasks(day: MissionDay): Promise<void> {
  const state = await readState()
  const today = todayLocalISO()
  const wantStartDate = localDateStr(new Date(new Date(today + 'T00:00:00').getTime() - (day - 1) * 86400000))
  if (currentMissionDay(state.startDate || wantStartDate, today) !== day || !state.startDate) {
    state.startDate = wantStartDate
    await writeState(state)
  }

  if (day === 1) {
    await Promise.all([devMarkPracticeToday(), devMarkConditionToday(), devMarkVideoAnalyzedToday(), devMarkCompetitionRegistered()])
  } else if (day === 2) {
    await Promise.all([devMarkPracticeToday(), devMarkConditionToday(), devMarkMealAnalyzedToday()])
  } else {
    await Promise.all([devMarkConditionToday(), devMarkStretchToday()])
  }
}

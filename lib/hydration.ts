// lib/hydration.ts — 水分補給リマインダー：表示条件判定・押下記録・リスク軽減ポイント管理
// 気温・練習強度から表示要否を判定し、押すと当日の怪我リスクスコアを少し下げる。
// 新規APIは使わず、既存の getCachedWeather() のキャッシュ値をそのまま利用する。
import AsyncStorage from '@react-native-async-storage/async-storage'

const STATE_KEY = 'score_hydration_state_v1'

const REDUCTION_PER_PRESS  = 2   // 1回あたりの軽減pt
const DAILY_REDUCTION_CAP  = 6   // 1日の軽減pt上限
const SHOW_WINDOWS         = [10, 13, 16]              // 表示候補の時間帯（時）
const MIN_INTERVAL_MS      = 3 * 60 * 60 * 1000        // 最低間隔3時間

const HIGH_INTENSITY_TYPES = new Set(['interval', 'sprint', 'race'])

const MESSAGES = [
  'そろそろ水分補給を🚰',
  '暑いね、水は飲んだ？',
  '練習前にコップ1杯、飲んでおこう',
  '汗かいてない？水分チェックの時間だよ',
  '脱水は思ってるより静かに来る。今、一口いこう',
]

type HydrationState = {
  date: string
  shownCount: number
  pressCount: number
  reductionPts: number
  lastShownAt: number
  messageIdx: number
}

function todayKey(): string {
  return new Date().toLocaleDateString('sv-SE')
}

function emptyState(date: string): HydrationState {
  return { date, shownCount: 0, pressCount: 0, reductionPts: 0, lastShownAt: 0, messageIdx: 0 }
}

async function getState(): Promise<HydrationState> {
  const today = todayKey()
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY)
    if (!raw) return emptyState(today)
    const parsed = JSON.parse(raw) as HydrationState
    if (parsed.date !== today) return emptyState(today)
    return parsed
  } catch {
    return emptyState(today)
  }
}

async function saveState(s: HydrationState): Promise<void> {
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(s)).catch(() => {})
}

// 今日の最大表示回数（気温・練習強度から判定）
function computeMaxShows(temp: number | null, todaySessionTypes: string[]): number {
  const hasTrainingToday  = todaySessionTypes.length > 0
  const hasHighIntensity  = todaySessionTypes.some(t => HIGH_INTENSITY_TYPES.has(t))
  const t = temp ?? 20
  if (t >= 32 || (hasHighIntensity && t >= 30)) return 3
  if (t >= 28 || hasHighIntensity)              return 2
  if (!hasTrainingToday)                        return 0
  return 0
}

export interface HydrationEligibility {
  show: boolean
  message: string
  showSaltTip: boolean
  pressCount: number
  reductionPts: number
}

// 表示すべきかどうかを判定（副作用なし）
export async function getHydrationEligibility(
  temp: number | null,
  todaySessionTypes: string[],
): Promise<HydrationEligibility> {
  const state    = await getState()
  const maxShows = computeMaxShows(temp, todaySessionTypes)
  const hour     = new Date().getHours()
  const inWindow = SHOW_WINDOWS.includes(hour)
  const intervalOk = state.lastShownAt === 0 || (Date.now() - state.lastShownAt) >= MIN_INTERVAL_MS
  const t = temp ?? 20
  const hasHighIntensity = todaySessionTypes.some(x => HIGH_INTENSITY_TYPES.has(x))
  const showSaltTip = (t >= 30 && hasHighIntensity) || state.pressCount >= 2
  const show = maxShows > 0 && state.shownCount < maxShows && inWindow && intervalOk

  return {
    show,
    message: MESSAGES[state.messageIdx % MESSAGES.length],
    showSaltTip,
    pressCount: state.pressCount,
    reductionPts: state.reductionPts,
  }
}

// 実際にバナーを表示した時に1回だけ呼ぶ（表示回数・最終表示時刻・次回メッセージを更新）
export async function markHydrationShown(): Promise<void> {
  const state = await getState()
  await saveState({
    ...state,
    shownCount: state.shownCount + 1,
    lastShownAt: Date.now(),
    messageIdx: (state.messageIdx + 1) % MESSAGES.length,
  })
}

// 「飲んだ」ボタン押下時：軽減ptを加算（1日上限あり）
export async function logHydrationPress(): Promise<{ pressCount: number; reductionPts: number }> {
  const state = await getState()
  const reductionPts = Math.min(DAILY_REDUCTION_CAP, state.reductionPts + REDUCTION_PER_PRESS)
  const next = { ...state, pressCount: state.pressCount + 1, reductionPts }
  await saveState(next)
  return { pressCount: next.pressCount, reductionPts: next.reductionPts }
}

// 今日すでに獲得している軽減pt（calcInjuryRisk に渡す用）
export async function getHydrationReductionPts(): Promise<number> {
  const state = await getState()
  return state.reductionPts
}

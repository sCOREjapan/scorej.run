// lib/trainingTimerSettings.ts — トレーニング用タイマーの設定（永続化）
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'score_training_timer_settings'
const HISTORY_KEY = 'score_training_timer_history'

export type TimerMode = 'interval' | 'normal'

export type TrainingTimerSettings = {
  mode: TimerMode
  workSec: number             // 実施時間（トレーニング/通常タイマー共通）
  restSec: number              // 回と回の間の休憩（インターバルのみ）
  reps: number                  // 1セットあたりの回数（インターバルのみ）
  sets: number                  // セット数（インターバルのみ）
  restBetweenSetsSec: number   // セット間の休憩（インターバルのみ）
}

export const TIMER_DEFAULTS: TrainingTimerSettings = {
  mode: 'interval',
  workSec: 30,
  restSec: 30,
  reps: 5,
  sets: 1,
  restBetweenSetsSec: 90,
}

export async function getTimerSettings(): Promise<TrainingTimerSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return TIMER_DEFAULTS
    return { ...TIMER_DEFAULTS, ...JSON.parse(raw) }
  } catch { return TIMER_DEFAULTS }
}

export async function saveTimerSettings(s: TrainingTimerSettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {})
}

export type TimerHistoryEntry = {
  id: string
  date: string
  mode: TimerMode
  workSec: number
  restSec: number
  reps: number
  sets: number
  completed: boolean
}

export async function getTimerHistory(): Promise<TimerHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export async function addTimerHistory(entry: TimerHistoryEntry): Promise<void> {
  const list = await getTimerHistory()
  list.unshift(entry)
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 50))).catch(() => {})
}

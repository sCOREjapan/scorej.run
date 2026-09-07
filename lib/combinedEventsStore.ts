// lib/combinedEventsStore.ts — 混成競技ツールの記録保存（試合ログ・自己ベスト/目標）
import AsyncStorage from '@react-native-async-storage/async-storage'

const LOG_KEY   = 'score_combined_events_log'
const GOALS_KEY = 'score_combined_events_goals'

export type CombinedCategory = 'men' | 'women' | 'tetrathlon_jhs_men'

export type SavedCompetition = {
  id: string
  category: CombinedCategory
  date: string                       // YYYY-MM-DD
  name?: string
  marks: Record<string, number>      // event key -> raw mark
  totalScore: number
}

async function readLog(): Promise<SavedCompetition[]> {
  try {
    const raw = await AsyncStorage.getItem(LOG_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export async function getCompetitions(category: CombinedCategory): Promise<SavedCompetition[]> {
  const all = await readLog()
  return all.filter(c => c.category === category).sort((a, b) => b.date.localeCompare(a.date))
}

export async function saveCompetition(entry: SavedCompetition): Promise<void> {
  const all = await readLog()
  all.unshift(entry)
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify(all)).catch(() => {})
}

export async function deleteCompetition(id: string): Promise<void> {
  const all = await readLog()
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify(all.filter(c => c.id !== id))).catch(() => {})
}

/** 種目ごとの自己ベスト記録(mark)を、保存済み試合ログから算出する */
export async function getPersonalBests(category: CombinedCategory, isTrack: (key: string) => boolean): Promise<Record<string, number>> {
  const list = await getCompetitions(category)
  const pb: Record<string, number> = {}
  for (const comp of list) {
    for (const [key, mark] of Object.entries(comp.marks)) {
      if (!(mark > 0)) continue
      const current = pb[key]
      const better = isTrack(key) ? (current === undefined || mark < current) : (current === undefined || mark > current)
      if (better) pb[key] = mark
    }
  }
  return pb
}

async function readGoals(): Promise<Record<string, Record<string, number>>> {
  try {
    const raw = await AsyncStorage.getItem(GOALS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export async function getGoals(category: CombinedCategory): Promise<Record<string, number>> {
  const all = await readGoals()
  return all[category] ?? {}
}

export async function setGoal(category: CombinedCategory, eventKey: string, mark: number): Promise<void> {
  const all = await readGoals()
  all[category] = { ...(all[category] ?? {}), [eventKey]: mark }
  await AsyncStorage.setItem(GOALS_KEY, JSON.stringify(all)).catch(() => {})
}

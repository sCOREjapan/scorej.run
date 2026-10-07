// lib/combinedEventsStore.ts — 混成競技ツールの記録保存（試合ログ・自己ベスト/目標）
//
// 2026-10-01追記: 元々は生のAsyncStorage.getItem/setItemで読み込み→加工→書き込みしており、
// 保存ボタンを連打する等でread-modify-writeが競合すると、後勝ちの書き込みが前の保存を
// 上書きして消してしまう(lost update)リスクがあった。lib/sessionsStore.ts等と同じ
// createStorageQueueで読み書きを直列化する。
import { createStorageQueue } from './storageQueue'

const LOG_KEY   = 'score_combined_events_log'
const GOALS_KEY = 'score_combined_events_goals'

export type CombinedCategory = 'men' | 'women' | 'tetrathlon_jhs_men' | 'octathlon_hs_men'

export type SavedCompetition = {
  id: string
  category: CombinedCategory
  date: string                       // YYYY-MM-DD
  name?: string
  marks: Record<string, number>      // event key -> raw mark
  totalScore: number
}

const logStore   = createStorageQueue<SavedCompetition[]>(LOG_KEY, [])
const goalsStore = createStorageQueue<Record<string, Record<string, number>>>(GOALS_KEY, {})

export async function getCompetitions(category: CombinedCategory): Promise<SavedCompetition[]> {
  const all = await logStore.get()
  return all.filter(c => c.category === category).sort((a, b) => b.date.localeCompare(a.date))
}

export async function saveCompetition(entry: SavedCompetition): Promise<void> {
  await logStore.update(current => [entry, ...current])
}

export async function deleteCompetition(id: string): Promise<void> {
  await logStore.update(current => current.filter(c => c.id !== id))
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

export async function getGoals(category: CombinedCategory): Promise<Record<string, number>> {
  const all = await goalsStore.get()
  return all[category] ?? {}
}

export async function setGoal(category: CombinedCategory, eventKey: string, mark: number): Promise<void> {
  await goalsStore.update(current => ({
    ...current,
    [category]: { ...(current[category] ?? {}), [eventKey]: mark },
  }))
}

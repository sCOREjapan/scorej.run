// lib/tasksStore.ts — 改善タスク(trackmate_tasks)の読み書きを直列化する共有ストア
//
// 背景: TASKS_KEY への read-modify-write が notebook.tsx / practice-input.tsx /
// QuickLogModal.tsx / index.tsx の4ファイルで独立に行われており、
// SESSIONS_KEY と同じ lost update の危険があった。特に index.tsx の
// toggleTask は React state (取得後に他の画面が書き込んでいれば古い) を
// 基点にそのまま書き戻すため最も影響が大きい。
import { createStorageQueue } from './storageQueue'

export interface ImprovementTask {
  id: string
  text: string
  completed: boolean
  created_at: string
}

export const TASKS_KEY = 'trackmate_tasks'

const store = createStorageQueue<ImprovementTask[]>(TASKS_KEY, [])

export const getTasks = store.get
export const updateTasks = store.update

/** 新しいタスクテキストを先頭に追加し、最大20件に切り詰める */
export function addTasks(newTexts: string[]): Promise<ImprovementTask[]> {
  if (newTexts.length === 0) return getTasks()
  return updateTasks(existing => {
    const newTasks: ImprovementTask[] = newTexts.map(text => ({
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text, completed: false, created_at: new Date().toISOString(),
    }))
    return [...newTasks, ...existing].slice(0, 20)
  })
}

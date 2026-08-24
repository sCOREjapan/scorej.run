// lib/sessionsStore.ts — 練習記録(trackmate_sessions)の読み書きを直列化する共有ストア
//
// 背景: SESSIONS_KEY への読み込み→加工→書き込みが8ファイル以上でそれぞれ独立に
// 行われており、直列化されていなかった。削除直後に別画面の保存処理が古い
// スナップショットを読んだまま書き戻すと、削除が消えて復活する（lost update）。
// adGate.ts と同じキュー方式で、読み込みから書き込みまでを1つの操作として直列化する。
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { TrainingSession } from '../types'

export const SESSIONS_KEY = 'trackmate_sessions'

let _queue: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = _queue.then(fn, fn)
  _queue = run.then(() => undefined, () => undefined)
  return run
}

async function readSessions(): Promise<TrainingSession[]> {
  const raw = await AsyncStorage.getItem(SESSIONS_KEY)
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

/** 現在の全セッションを取得する（直列化キュー経由・常に最新を返す） */
export function getSessions(): Promise<TrainingSession[]> {
  return serialize(readSessions)
}

/**
 * 読み込み→加工→書き込みを1つの直列化された操作として実行する。
 * updater は最新のセッション配列を受け取り、保存したい新しい配列を返す。
 * 呼び出しが重なっても、必ず「直前の書き込み後の状態」を基に加工されることを保証する。
 */
export function updateSessions(
  updater: (current: TrainingSession[]) => TrainingSession[],
): Promise<TrainingSession[]> {
  return serialize(async () => {
    const current = await readSessions()
    const next = updater(current)
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(next))
    return next
  })
}

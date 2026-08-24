// lib/storageQueue.ts — AsyncStorage の読み込み→加工→書き込みを直列化する共通ファクトリ
//
// 背景: 同一キーへの read-modify-write が複数ファイルで独立に行われると、
// 片方の書き込み後にもう片方が古いスナップショットを書き戻して更新が消える
// (lost update)。lib/sessionsStore.ts / lib/adGate.ts で検証済みのキュー方式
// を汎用化したもの。
import AsyncStorage from '@react-native-async-storage/async-storage'

export function createStorageQueue<T>(key: string, empty: T) {
  let queue: Promise<unknown> = Promise.resolve()
  function serialize<R>(fn: () => Promise<R>): Promise<R> {
    const run = queue.then(fn, fn)
    queue = run.then(() => undefined, () => undefined)
    return run
  }

  async function read(): Promise<T> {
    const raw = await AsyncStorage.getItem(key)
    if (!raw) return empty
    try { return JSON.parse(raw) as T } catch { return empty }
  }

  function get(): Promise<T> {
    return serialize(read)
  }

  function update(updater: (current: T) => T): Promise<T> {
    return serialize(async () => {
      const current = await read()
      const next = updater(current)
      await AsyncStorage.setItem(key, JSON.stringify(next))
      return next
    })
  }

  return { get, update }
}

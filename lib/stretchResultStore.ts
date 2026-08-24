// lib/stretchResultStore.ts — ストレッチ結果(trackmate_stretch_result)の読み書きを
// 直列化する共有ストア
//
// 背景: STRETCH_RESULT_KEY への read-modify-write が stretch-recovery.tsx
// (1日の累計軽減量を加算) と index.tsx (バナー表示後に showBanner を false に
// 書き戻す) の2ファイルで独立に行われており、ストレッチ完了直後にホーム画面
// 側が古いスナップショットを書き戻すと、その日の累計加算が消える危険があった。
import { createStorageQueue } from './storageQueue'

export interface StretchResult {
  date: string
  reduction: number
  showBanner: boolean
  lastReduction: number
}

export const STRETCH_RESULT_KEY = 'trackmate_stretch_result'

const EMPTY: StretchResult = { date: '', reduction: 0, showBanner: false, lastReduction: 0 }

const store = createStorageQueue<StretchResult>(STRETCH_RESULT_KEY, EMPTY)

export const getStretchResult = store.get
export const updateStretchResult = store.update

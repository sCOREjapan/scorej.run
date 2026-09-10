// lib/stretchResultStore.ts — ストレッチ結果(trackmate_stretch_result)の読み書きを
// 直列化する共有ストア
//
// 背景: STRETCH_RESULT_KEY への read-modify-write が stretch-recovery.tsx
// (1日の累計軽減量を加算) と index.tsx (バナー表示後に showBanner を false に
// 書き戻す) の2ファイルで独立に行われており、ストレッチ完了直後にホーム画面
// 側が古いスナップショットを書き戻すと、その日の累計加算が消える危険があった。
import AsyncStorage from '@react-native-async-storage/async-storage'
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

// 2026-09-09追記: 「はじめのNステップ」チェックリスト(components/FirstRunChecklist.tsx)の
// 「ストレッチをしてスコアを下げる」項目用。STRETCH_RESULT_KEYは1日ごとにリセットされる
// 累計値なので、そちらでは「一度でも完了したか」という永続フラグを表現できない。
// このフラグは一度trueになったら消さない（日をまたいでも他の項目と同じく達成済み扱い）。
export const EVER_STRETCHED_KEY = 'trackmate_stretch_ever_completed'

export async function hasEverStretched(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(EVER_STRETCHED_KEY)) === '1'
  } catch {
    return false
  }
}

export async function markStretchedOnce(): Promise<void> {
  try {
    await AsyncStorage.setItem(EVER_STRETCHED_KEY, '1')
  } catch {}
}

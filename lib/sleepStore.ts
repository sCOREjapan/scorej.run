// lib/sleepStore.ts — 睡眠記録(trackmate_sleep)の読み書きを直列化する共有ストア
//
// 背景: SLEEP_KEY への read-modify-write が sleep.tsx と QuickConditionModal.tsx
// の2ファイルで、しかもどちらも React state (records) を書き込みの基点にして
// おり、もう一方が直後に書き込んでいると lost update が起きる。
import { createStorageQueue } from './storageQueue'
import type { SleepRecord } from '../types'

export const SLEEP_KEY = 'trackmate_sleep'

const store = createStorageQueue<SleepRecord[]>(SLEEP_KEY, [])

export const getSleepRecords = store.get
export const updateSleepRecords = store.update

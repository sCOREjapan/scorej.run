// lib/weightStore.ts — 体重記録(trackmate_weight)の読み書きを直列化する共有ストア
//
// 背景: WEIGHT_KEY への read-modify-write が records.tsx (React state を基点に
// 書き込み) と QuickConditionModal.tsx の2ファイルで独立に行われており、
// クイック記録での体重保存が記録タブ側の古い state 書き戻しで消える危険があった。
import { createStorageQueue } from './storageQueue'

export type WeightRecord = { id: string; date: string; weight_kg: number }

export const WEIGHT_KEY = 'trackmate_weight'

const store = createStorageQueue<WeightRecord[]>(WEIGHT_KEY, [])

export const getWeights = store.get
export const updateWeights = store.update

// lib/conditionStore.ts — 日次体調マップ(trackmate_condition_map)の読み書きを直列化する共有ストア
//
// 背景: CONDITION_MAP_KEY への read-modify-write が index.tsx (React state を
// 基点に書き込み) と QuickConditionModal.tsx の2ファイルで独立に行われており、
// クイック記録モーダルでの保存直後にホーム画面側の古い state が書き戻すと
// 更新が消える lost update の危険があった。
import { createStorageQueue } from './storageQueue'

export const CONDITION_MAP_KEY = 'trackmate_condition_map'

const store = createStorageQueue<Record<string, number>>(CONDITION_MAP_KEY, {})

export const getConditionMap = store.get
export const updateConditionMap = store.update

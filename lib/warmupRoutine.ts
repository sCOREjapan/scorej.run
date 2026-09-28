// lib/warmupRoutine.ts — ユーザーが自由に作成する「マイルーティン」の保存
// 2026-09-24: 「ウォームアップを自由に変更・登録できるように」との指示で追加。
// プリセット(app/warmup.tsxのITEMS、リスクレベル別・多言語対応)とは別に、
// ユーザー自身が種目名・内容を自由入力するルーティンを1つだけ端末に保存する。
import AsyncStorage from '@react-native-async-storage/async-storage'

export interface CustomWarmupItem {
  id: string
  name: string
  detail: string
}

export const CUSTOM_ROUTINE_KEY = 'trackmate_custom_warmup_routine'

export async function loadCustomRoutine(): Promise<CustomWarmupItem[]> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_ROUTINE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function saveCustomRoutine(items: CustomWarmupItem[]): Promise<void> {
  await AsyncStorage.setItem(CUSTOM_ROUTINE_KEY, JSON.stringify(items))
}

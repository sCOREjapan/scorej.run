// lib/starterSettings.ts — スタート合図ツールのタイミング設定（永続化）
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'score_starter_settings'

export type StarterSettings = {
  startToMarksSec: number   // スタート → On your marks（秒）
  marksToSetSec:   number   // On your marks → Set（秒）
  gunRandom:       boolean  // Set → 号砲 をランダムにするか
  gunFixedSec:      number  // ランダムOFF時の固定秒数
}

export const STARTER_DEFAULTS: StarterSettings = {
  startToMarksSec: 3.0,
  marksToSetSec:   20.0,
  gunRandom:       true,
  gunFixedSec:      1.8,
}

export const GUN_RANDOM_MIN = 1.5
export const GUN_RANDOM_MAX = 2.0

export async function getStarterSettings(): Promise<StarterSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return STARTER_DEFAULTS
    return { ...STARTER_DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return STARTER_DEFAULTS
  }
}

export async function saveStarterSettings(s: StarterSettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {})
}

/** ランダム時の待ち時間(ミリ秒)を1回だけ決定する */
export function randomGunDelayMs(): number {
  return (GUN_RANDOM_MIN + Math.random() * (GUN_RANDOM_MAX - GUN_RANDOM_MIN)) * 1000
}

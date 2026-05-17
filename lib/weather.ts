// lib/weather.ts — Open-Meteo API（無料・APIキー不要）天気取得 + キャッシュ管理
// ルール：
//   1. その日初めて開いたとき → APIを叩いて「今日の天気」として保存
//   2. 昼12:00〜12:59 → もう1回だけ更新（午後の天気に合わせる）
//   3. それ以外 → 保存済みキャッシュをそのまま表示

import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type WeatherData = {
  temp: number       // 気温°C
  humidity: number   // 湿度%
  windspeed: number  // 風速km/h
  weathercode: number // WMO code
  icon: string       // 絵文字
  label: string      // 晴れ/曇り/雨/雪など
}

const CACHE_KEY = 'weather_cache_v3'

// ─────────────────────────────────────────
// WMO weathercode → emoji + label
// ─────────────────────────────────────────
function decodeWeatherCode(code: number): { icon: string; label: string } {
  if (code === 0)             return { icon: '☀️', label: '快晴' }
  if (code <= 3)              return { icon: '🌤️', label: '晴れ〜曇り' }
  if (code <= 48)             return { icon: '🌫️', label: '霧' }
  if (code <= 67)             return { icon: '🌧️', label: '雨' }
  if (code <= 77)             return { icon: '❄️', label: '雪' }
  if (code <= 82)             return { icon: '🌦️', label: 'にわか雨' }
  if (code === 95)            return { icon: '⛈️', label: '雷雨' }
  if (code >= 96)             return { icon: '⛈️', label: '雷雨（雹）' }
  return { icon: '🌡️', label: '不明' }
}

// ─────────────────────────────────────────
// スロット判定：1日2スロット
//   morning: 00:00〜11:59（初回起動時に取得）
//   noon:    12:00〜23:59（昼以降に1回だけ更新）
// ─────────────────────────────────────────
function getDaySlot(): string {
  const dateStr = new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD
  const h = new Date().getHours()
  return h >= 12 ? `${dateStr}_noon` : `${dateStr}_morning`
}

// ─────────────────────────────────────────
// 生のAPI呼び出し（キャッシュなし）
// ─────────────────────────────────────────
export async function getWeather(lat: number, lon: number): Promise<WeatherData> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,windspeed_10m,weathercode&timezone=Asia/Tokyo`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Open-Meteo API error: ${res.status}`)
  const data = await res.json()
  const current = data.current
  const { icon, label } = decodeWeatherCode(current.weathercode)
  return {
    temp: current.temperature_2m,
    humidity: current.relative_humidity_2m,
    windspeed: current.windspeed_10m,
    weathercode: current.weathercode,
    icon,
    label,
  }
}

// ─────────────────────────────────────────
// キャッシュ付き天気取得
//   - 同じスロット内（morningなら午前中ずっと、noonなら午後ずっと）はキャッシュを返す
//   - スロットが変わったとき（= 初回起動 or 昼12時以降の初回）だけAPIを叩く
// ─────────────────────────────────────────
export async function getCachedWeather(): Promise<WeatherData | null> {
  const currentSlot = getDaySlot()

  // キャッシュ確認
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY)
    if (raw) {
      const cached: { data: WeatherData; slot: string } = JSON.parse(raw)
      if (cached.slot === currentSlot) {
        // 同じスロット内 → そのまま返す（API不要）
        return cached.data
      }
    }
  } catch { /* キャッシュ読み取り失敗は無視 */ }

  // 新しいスロット（初回起動 or 昼の更新）→ APIを叩く
  const weather = await fetchWeatherFromLocation()

  if (weather) {
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ data: weather, slot: currentSlot }))
    } catch { /* 保存失敗は無視 */ }
    return weather
  }

  // 取得失敗 → 古いキャッシュをフォールバックとして返す
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY)
    if (raw) return (JSON.parse(raw) as { data: WeatherData }).data
  } catch {}
  return null
}

// ─────────────────────────────────────────
// 位置情報を使って天気を取得（内部用）
// ─────────────────────────────────────────
async function fetchWeatherFromLocation(): Promise<WeatherData | null> {
  try {
    if (Platform.OS !== 'web') {
      const Location = await import('expo-location')
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return null
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
      })
      return await getWeather(pos.coords.latitude, pos.coords.longitude)
    }

    // Web: navigator.geolocation
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(null); return
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try { resolve(await getWeather(pos.coords.latitude, pos.coords.longitude)) }
          catch { resolve(null) }
        },
        () => resolve(null),
        { timeout: 8000 }
      )
    })
  } catch {
    return null
  }
}

// ─────────────────────────────────────────
// 後方互換 — 既存コードが getCurrentLocationWeather() を呼んでいる箇所用
// ─────────────────────────────────────────
export async function getCurrentLocationWeather(): Promise<WeatherData | null> {
  return getCachedWeather()
}

// キャッシュを強制クリア（手動リフレッシュボタン用）
export async function clearWeatherCache(): Promise<void> {
  await AsyncStorage.removeItem(CACHE_KEY).catch(() => {})
}

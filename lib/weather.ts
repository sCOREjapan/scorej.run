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

// デフォルト位置（東京）— 位置情報権限なし時のフォールバック
const DEFAULT_LAT = 35.6895
const DEFAULT_LON = 139.6917

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
// スロット判定：1日1回だけ取得
//   同じ日（YYYY-MM-DD）なら何時でもキャッシュを返す
// ─────────────────────────────────────────
function getDaySlot(): string {
  return new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD のみ
}

// ─────────────────────────────────────────
// タイムアウト付き fetch（AbortSignal.timeout は Hermes 非対応の可能性あり）
// ─────────────────────────────────────────
function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  // AbortSignal.timeout が利用可能な場合はそちらを使う
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return fetch(url, { signal: AbortSignal.timeout(ms) })
  }
  // フォールバック：手動タイムアウト
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id))
}

// ─────────────────────────────────────────
// 生のAPI呼び出し（キャッシュなし）
// ─────────────────────────────────────────
export async function getWeather(lat: number, lon: number): Promise<WeatherData> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,windspeed_10m,weathercode&timezone=Asia/Tokyo`
  const res = await fetchWithTimeout(url, 12000)
  if (!res.ok) throw new Error(`Open-Meteo API error: ${res.status}`)
  const data = await res.json()
  const current = data?.current
  if (!current) throw new Error('Open-Meteo: unexpected response format')
  const { icon, label } = decodeWeatherCode(current.weathercode ?? 0)
  return {
    temp:        current.temperature_2m        ?? 20,
    humidity:    current.relative_humidity_2m  ?? 50,
    windspeed:   current.windspeed_10m         ?? 0,
    weathercode: current.weathercode           ?? 0,
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
// 位置情報権限なし時は東京デフォルトでAPIを叩く（天気だけでも取得）
// ─────────────────────────────────────────
async function fetchWeatherFromLocation(): Promise<WeatherData | null> {
  try {
    if (Platform.OS !== 'web') {
      const Location = await import('expo-location')

      // まず現在権限を確認（requestせずに確認）
      const { status: existingStatus } = await Location.getForegroundPermissionsAsync()

      let lat = DEFAULT_LAT
      let lon = DEFAULT_LON

      if (existingStatus === 'granted') {
        // 既に許可済み → 位置情報を取得（タイムアウト付き）
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Low,
            timeInterval: 5000,
            mayShowUserSettingsDialog: false,
          })
          lat = pos.coords.latitude
          lon = pos.coords.longitude
        } catch {
          // 位置取得失敗 → デフォルト位置を使用
        }
      } else if (existingStatus === 'undetermined') {
        // まだ確認していない → リクエスト
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status === 'granted') {
          try {
            const pos = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Low,
              timeInterval: 5000,
              mayShowUserSettingsDialog: false,
            })
            lat = pos.coords.latitude
            lon = pos.coords.longitude
          } catch {
            // 位置取得失敗 → デフォルト位置
          }
        }
        // denied → デフォルト位置（東京）で天気取得継続
      }
      // denied の場合もデフォルト位置（東京）で天気取得

      return await getWeather(lat, lon)
    }

    // Web: navigator.geolocation
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        // 位置情報なし → 東京デフォルト
        getWeather(DEFAULT_LAT, DEFAULT_LON).then(resolve).catch(() => resolve(null))
        return
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try { resolve(await getWeather(pos.coords.latitude, pos.coords.longitude)) }
          catch { resolve(null) }
        },
        async () => {
          // 位置情報拒否 → 東京デフォルト
          try { resolve(await getWeather(DEFAULT_LAT, DEFAULT_LON)) }
          catch { resolve(null) }
        },
        { timeout: 10000 }
      )
    })
  } catch {
    // 最終フォールバック：東京の天気
    try { return await getWeather(DEFAULT_LAT, DEFAULT_LON) } catch { return null }
  }
}

// ─────────────────────────────────────────
// 後方互換 — 既存コードが getCurrentLocationWeather() を呼んでいる箇所用
// ─────────────────────────────────────────
export async function getCurrentLocationWeather(): Promise<WeatherData | null> {
  return getCachedWeather()
}

// ─────────────────────────────────────────
// キャッシュのみ即時読み込み（API呼び出しなし・起動直後の即表示用）
// ─────────────────────────────────────────
export async function getWeatherCacheOnly(): Promise<WeatherData | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached: { data: WeatherData; slot: string } = JSON.parse(raw)
    return cached.data ?? null
  } catch {
    return null
  }
}

// キャッシュを強制クリア（手動リフレッシュボタン用）
export async function clearWeatherCache(): Promise<void> {
  await AsyncStorage.removeItem(CACHE_KEY).catch(() => {})
}

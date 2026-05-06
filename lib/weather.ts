// Open-Meteo API（無料・APIキー不要）を使った天気取得
// https://api.open-meteo.com/v1/forecast?latitude=35.68&longitude=139.69&current=temperature_2m,relative_humidity_2m,windspeed_10m,weathercode&timezone=Asia/Tokyo

import { Platform } from 'react-native'

export type WeatherData = {
  temp: number       // 気温°C
  humidity: number   // 湿度%
  windspeed: number  // 風速km/h
  weathercode: number // WMO code
  icon: string       // 絵文字
  label: string      // 晴れ/曇り/雨/雪など
}

// WMO weathercode → emoji + label のマッピング
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

export async function getWeather(lat: number, lon: number): Promise<WeatherData> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,windspeed_10m,weathercode&timezone=Asia/Tokyo`
  const res = await fetch(url)
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

export async function getCurrentLocationWeather(): Promise<WeatherData | null> {
  try {
    if (Platform.OS !== 'web') {
      // Native: use expo-location (already installed: expo-location@19.0.8)
      const Location = await import('expo-location')
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return null
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
      })
      return await getWeather(pos.coords.latitude, pos.coords.longitude)
    }
  } catch {
    return null
  }

  // Web: navigator.geolocation
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null); return
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          resolve(await getWeather(pos.coords.latitude, pos.coords.longitude))
        } catch { resolve(null) }
      },
      () => resolve(null),
      { timeout: 10000 }
    )
  })
}

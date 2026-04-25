// lib/weatherRisk.ts — 天気による怪我リスク加算ロジック

import type { WeatherData } from './weather'

export function calcWeatherRiskBonus(weather: WeatherData): number {
  let bonus = 0

  if      (weather.temp <= 5)  bonus += 15
  else if (weather.temp <= 10) bonus += 10
  else if (weather.temp <= 15) bonus += 5
  else if (weather.temp >= 35) bonus += 10

  if      (weather.humidity >= 85) bonus += 8
  else if (weather.humidity >= 75) bonus += 4

  const isRain = (weather.weathercode >= 61 && weather.weathercode <= 67) ||
                 (weather.weathercode >= 80 && weather.weathercode <= 82)
  const isSnow =  weather.weathercode >= 71 && weather.weathercode <= 77

  if (isRain) bonus += 8
  if (isSnow) bonus += 15
  if (weather.windspeed >= 36) bonus += 5

  return Math.min(bonus, 25)
}

export function getWeatherRiskText(weather: WeatherData, bonus: number): string | null {
  if (bonus <= 0) return null
  const temp = Math.round(weather.temp)
  const isRain = (weather.weathercode >= 61 && weather.weathercode <= 67) ||
                 (weather.weathercode >= 80 && weather.weathercode <= 82)
  const isSnow =  weather.weathercode >= 71 && weather.weathercode <= 77

  if (isSnow) return `❄️ 降雪のためリスク+${bonus}加算`
  if (isRain) return `🌧️ 雨天のためリスク+${bonus}加算`
  if (weather.temp <= 10) return `🌡️ 今日${temp}℃・気温が低いためリスク+${bonus}加算`
  if (weather.temp >= 35) return `🥵 猛暑のためリスク+${bonus}加算`
  if (weather.humidity >= 85) return `💧 高湿度のためリスク+${bonus}加算`
  return `⚠️ 天候によりリスク+${bonus}加算`
}

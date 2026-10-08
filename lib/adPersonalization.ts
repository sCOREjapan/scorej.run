// lib/adPersonalization.ts — 広告のパーソナライズ可否（広告単価に直結する設定の一元管理）
//
// 2026-10-07: バナー・インタースティシャル・App Open の全リクエストが
// `requestNonPersonalizedAdsOnly: true`(非パーソナライズ広告のみ)に固定されており、単価が大きく下がる
// 非パーソナライズ広告だけを出していた(リワード広告だけは false だった)。
// 同意フォーム(UMP)が必要な地域以外では、AdMob の通常設定(パーソナライズ可)で要求する:
//   ・EEA(EU+アイスランド・リヒテンシュタイン・ノルウェー)・英国・スイス … 従来どおり非パーソナライズ
//     (同意フォームを実装していないため)。端末の「地域」設定だけでは居住地を判別できないので、
//     タイムゾーンが欧州のものも同じ扱いにする。
//   ・地域もタイムゾーンも判別できない場合は安全側(非パーソナライズ)
//   ・iOS の ATT(追跡の許可)は、このフラグではなく広告SDKが扱う。拒否された端末では広告識別子
//     (IDFA)が渡らず、SDK が識別子なしで配信する(従来のリワード広告と同じ挙動)。
// プライバシーポリシー(app/privacy.tsx)の広告に関する記載と必ず合わせること。
import { Platform } from 'react-native'

// EEA(EU加盟国+アイスランド・リヒテンシュタイン・ノルウェー)・英国・スイス
const CONSENT_REQUIRED_REGIONS = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT',
  'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
])
// 欧州以外の接頭辞(Europe/)に入らない EEA の地域のタイムゾーン
const CONSENT_REQUIRED_TIMEZONES = new Set([
  'Atlantic/Reykjavik', 'Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Azores', 'Atlantic/Faroe',
  'Africa/Ceuta',
])

/** 端末の地域(例: 'JP')。判別できなければ null */
export function deviceRegion(): string | null {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale   // 例: 'ja-JP' / 'en-US'
    const m = /[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(loc)
    return m ? m[1].toUpperCase() : null
  } catch {
    return null
  }
}

/** 端末のタイムゾーン(例: 'Asia/Tokyo')。判別できなければ null */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

/** 同意フォームが必要な地域(EEA・英国・スイス)か。地域設定とタイムゾーンのどちらかが該当すれば true */
export function isConsentRegion(region: string | null, timeZone: string | null): boolean {
  if (region && CONSENT_REQUIRED_REGIONS.has(region)) return true
  if (timeZone && (timeZone.startsWith('Europe/') || CONSENT_REQUIRED_TIMEZONES.has(timeZone))) return true
  return false
}

/** パーソナライズ広告を要求してよいか（同期。バナーの描画中にも使える） */
export function isPersonalizedAdsAllowed(
  region: string | null = deviceRegion(),
  timeZone: string | null = deviceTimeZone(),
): boolean {
  if (Platform.OS === 'web') return false
  if (!region && !timeZone) return false            // 判別不能は安全側
  return !isConsentRegion(region, timeZone)
}

/** AdMob の requestOptions にそのまま渡す */
export function adRequestOptions(): { requestNonPersonalizedAdsOnly: boolean } {
  return { requestNonPersonalizedAdsOnly: !isPersonalizedAdsAllowed() }
}

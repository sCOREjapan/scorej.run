// lib/prefectureLabels.ts — 都道府県名（内部値=日本語）→ 表示ラベル
import type { Language } from '../context/LanguageContext'

const PREFECTURE_LABEL_EN: Record<string, string> = {
  '北海道': 'Hokkaido',
  '青森': 'Aomori', '岩手': 'Iwate', '宮城': 'Miyagi', '秋田': 'Akita', '山形': 'Yamagata', '福島': 'Fukushima',
  '茨城': 'Ibaraki', '栃木': 'Tochigi', '群馬': 'Gunma', '埼玉': 'Saitama', '千葉': 'Chiba', '東京': 'Tokyo', '神奈川': 'Kanagawa',
  '新潟': 'Niigata', '富山': 'Toyama', '石川': 'Ishikawa', '福井': 'Fukui', '山梨': 'Yamanashi', '長野': 'Nagano', '岐阜': 'Gifu', '静岡': 'Shizuoka', '愛知': 'Aichi',
  '三重': 'Mie', '滋賀': 'Shiga', '京都': 'Kyoto', '大阪': 'Osaka', '兵庫': 'Hyogo', '奈良': 'Nara', '和歌山': 'Wakayama',
  '鳥取': 'Tottori', '島根': 'Shimane', '岡山': 'Okayama', '広島': 'Hiroshima', '山口': 'Yamaguchi',
  '徳島': 'Tokushima', '香川': 'Kagawa', '愛媛': 'Ehime', '高知': 'Kochi',
  '福岡': 'Fukuoka', '佐賀': 'Saga', '長崎': 'Nagasaki', '熊本': 'Kumamoto', '大分': 'Oita', '宮崎': 'Miyazaki', '鹿児島': 'Kagoshima', '沖縄': 'Okinawa',
}

const REGION_LABEL_EN: Record<string, string> = {
  '北海道': 'Hokkaido', '東北': 'Tohoku', '関東': 'Kanto', '中部': 'Chubu',
  '近畿': 'Kinki', '中国': 'Chugoku', '四国': 'Shikoku', '九州・沖縄': 'Kyushu & Okinawa',
}

export function getPrefectureLabel(pref: string, lang: Language): string {
  if (lang === 'ja') return pref
  return PREFECTURE_LABEL_EN[pref] ?? pref
}

export function getRegionLabel(region: string, lang: Language): string {
  if (lang === 'ja') return region
  return REGION_LABEL_EN[region] ?? region
}

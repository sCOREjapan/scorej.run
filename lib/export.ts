import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'

// ── ネイティブ共有ヘルパー ───────────────────────────────────────────
async function shareFileNative(content: string, filename: string, mimeType: string): Promise<void> {
  const path = (FileSystem.cacheDirectory ?? '') + filename
  await FileSystem.writeAsStringAsync(path, content, { encoding: FileSystem.EncodingType.UTF8 })
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType, dialogTitle: filename })
  }
}

// ── CSVエクスポート（web / native 両対応）──────────────────────────
export async function exportAllDataCSV(): Promise<void> {

  const [sessionsRaw, recordsRaw, bodyRaw] = await Promise.all([
    AsyncStorage.getItem('trackmate_sessions'),
    AsyncStorage.getItem('trackmate_race_records'),
    AsyncStorage.getItem('trackmate_body_records'),
  ])

  let csv = ''

  // === GPS記録 ===
  csv += '=== GPS記録 ===\n'
  csv += '日付,練習タイプ,種目,タイム(ms),距離(m),本数,疲労度,体調,メモ\n'
  if (sessionsRaw) {
    try {
      const sessions = JSON.parse(sessionsRaw) as any[]
      for (const s of sessions) {
        csv += [
          s.session_date ?? '',
          s.session_type ?? '',
          s.event ?? '',
          s.time_ms ?? '',
          s.distance_m ?? '',
          s.reps ?? '',
          s.fatigue_level ?? '',
          s.condition_level ?? '',
          `"${(s.notes ?? '').replace(/"/g, '""')}"`,
        ].join(',') + '\n'
      }
    } catch {}
  }

  csv += '\n=== タイム記録 ===\n'
  csv += '日付,種目,記録,PB,SB,大会名,会場,風速,メモ\n'
  if (recordsRaw) {
    try {
      const records = JSON.parse(recordsRaw) as any[]
      for (const r of records) {
        csv += [
          r.race_date ?? '',
          r.event ?? '',
          r.result_display ?? '',
          r.is_pb ? 'PB' : '',
          r.is_sb ? 'SB' : '',
          `"${(r.competition_name ?? '').replace(/"/g, '""')}"`,
          `"${(r.venue ?? '').replace(/"/g, '""')}"`,
          r.wind_ms ?? '',
          `"${(r.notes ?? '').replace(/"/g, '""')}"`,
        ].join(',') + '\n'
      }
    } catch {}
  }

  csv += '\n=== 体調記録 ===\n'
  csv += '日付,体重(kg),疲労度(RPE),メモ\n'
  if (bodyRaw) {
    try {
      const bodyRecords = JSON.parse(bodyRaw) as any[]
      for (const b of bodyRecords) {
        csv += [
          b.date ?? '',
          b.weight ?? '',
          b.fatigue ?? '',
          `"${(b.note ?? '').replace(/"/g, '""')}"`,
        ].join(',') + '\n'
      }
    } catch {}
  }

  const dateStr = new Date().toISOString().slice(0, 10)
  const filename = `score_export_${dateStr}.csv`

  if (Platform.OS === 'web') {
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Safari でダウンロード開始前にURLが解放されることを防ぐため遅延解放
    setTimeout(() => URL.revokeObjectURL(url), 100)
  } else {
    await shareFileNative('\uFEFF' + csv, filename, 'text/csv')
  }
}

// ── JSON全エクスポート（バックアップ・web / native 両対応）───────────
export async function exportAllDataJSON(): Promise<void> {

  const keys = [
    'trackmate_sessions',
    'trackmate_race_records',
    'trackmate_sleep',
    'trackmate_competitions',
    'trackmate_entry_status',
    'trackmate_team',
    'trackmate_my_profile',
    'trackmate_body_records',
    'trackmate_workout_menus',
    'trackmate_timeline',
  ]

  const entries = await AsyncStorage.multiGet(keys)
  const result: Record<string, any> = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
  }

  for (const [key, value] of entries) {
    if (value) {
      try {
        result[key] = JSON.parse(value)
      } catch {
        result[key] = value
      }
    }
  }

  const json = JSON.stringify(result, null, 2)
  const dateStr = new Date().toISOString().slice(0, 10)
  const filename = `score_backup_${dateStr}.json`

  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Safari でダウンロード開始前にURLが解放されることを防ぐため遅延解放
    setTimeout(() => URL.revokeObjectURL(url), 100)
  } else {
    await shareFileNative(json, filename, 'application/json')
  }
}

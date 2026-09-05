// lib/widgetSync.ts — ホーム画面ウィジェット(iOS WidgetKit)へのデータ同期
// targets/widget/Widget.swift の ScoreWidgetData と型を一致させること
import { Platform } from 'react-native'

const APP_GROUP = 'group.com.scorejapan.score'
const STORAGE_KEY = 'scoreWidgetData'

export type ScoreWidgetData = {
  riskScore: number
  riskLabel: string
  daysUntilCompetition?: number
  competitionName?: string
  streak: number
  recoveryPhase?: string
  recoveryDay?: number
  recoveryTotalDays?: number
  recoveryProgressPercent?: number
}

export function syncWidgetData(data: ScoreWidgetData): void {
  if (Platform.OS !== 'ios') return
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ExtensionStorage } = require('@bacons/apple-targets')
    const storage = new ExtensionStorage(APP_GROUP)
    storage.set(STORAGE_KEY, JSON.stringify(data))
    ExtensionStorage.reloadWidget()
  } catch {
    // ウィジェット未対応ビルド(Expo Go等)では何もしない
  }
}

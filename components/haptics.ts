// lib/haptics.ts — 触覚フィードバックヘルパー
import * as Haptics from 'expo-haptics'
import { Platform } from 'react-native'

const isNative = Platform.OS !== 'web'

/** 軽いタップ感（ボタン押下） */
export const lightTap = () => {
  if (!isNative) return
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
}

/** 中くらいの押し感（カード選択・トグル） */
export const mediumTap = () => {
  if (!isNative) return
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
}

/** 強い達成感（PB更新・保存完了） */
export const heavyTap = () => {
  if (!isNative) return
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})
}

/** 成功通知バイブ（保存完了） */
export const successNotify = () => {
  if (!isNative) return
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
}

/** 警告バイブ（エラー・制限） */
export const warningNotify = () => {
  if (!isNative) return
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
}

/** PB達成！（連打バイブ） */
export const pbCelebration = async () => {
  if (!isNative) return
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})
  await new Promise(r => setTimeout(r, 80))
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
  await new Promise(r => setTimeout(r, 60))
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
}

/** 連続記録節目（ドドン） */
export const streakMilestone = async () => {
  if (!isNative) return
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})
  await new Promise(r => setTimeout(r, 100))
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})
}

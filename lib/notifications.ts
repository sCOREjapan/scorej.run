// lib/notifications.ts — Web Notification API ラッパー
// SSR / Notification API 非対応環境では安全に noop

import type { CompetitionPlan } from '../types'

// ── ユーティリティ ─────────────────────────────────────────────────
function isSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window
  )
}

// ── パーミッション取得 ─────────────────────────────────────────────
export async function requestPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isSupported()) return 'unsupported'
  const result = await Notification.requestPermission()
  return result
}

// ── 現在のパーミッション状態を取得 ────────────────────────────────
export function getPermission(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!isSupported()) return 'unsupported'
  return Notification.permission as 'granted' | 'denied' | 'default'
}

// ── 即時通知 ──────────────────────────────────────────────────────
export function showNow(title: string, body: string, icon = '/icon.png'): void {
  if (!isSupported()) return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, { body, icon })
  } catch {
    // 一部ブラウザで失敗することがある（Service Worker 必須等）
  }
}

// ── 大会リマインダー ───────────────────────────────────────────────
// 各大会の7日前・1日前に通知をスケジュール（簡易: 当日差分が7or1なら即通知）
export function scheduleCompetitionReminder(competitions: CompetitionPlan[]): void {
  if (!isSupported()) return
  if (Notification.permission !== 'granted') return

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  competitions.forEach(comp => {
    const compDate = new Date(comp.competition_date)
    compDate.setHours(0, 0, 0, 0)
    const diffDays = Math.round((compDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 7) {
      showNow(
        '🏆 大会まで1週間！',
        `「${comp.competition_name}」まであと7日。コンディション調整を始めましょう。`,
      )
    } else if (diffDays === 1) {
      showNow(
        '🏃 明日は大会！',
        `「${comp.competition_name}」は明日です。今夜は早めに休みましょう。`,
      )
    }
  })
}

// ── 練習記録リマインダー（毎日20時） ──────────────────────────────
let _trainingReminderTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleTrainingReminder(): void {
  if (!isSupported()) return

  // 既存タイマーをクリア
  if (_trainingReminderTimer !== null) {
    clearTimeout(_trainingReminderTimer)
    _trainingReminderTimer = null
  }

  const now = new Date()
  const target = new Date()
  target.setHours(20, 0, 0, 0)

  // 今日の20時が過ぎていたら翌日にスケジュール
  if (now >= target) {
    target.setDate(target.getDate() + 1)
  }

  const msUntil = target.getTime() - now.getTime()

  _trainingReminderTimer = setTimeout(() => {
    showNow(
      '📝 練習記録をつけよう',
      '今日のトレーニングを記録して、成長を可視化しましょう！',
    )
    // 翌日もスケジュール（再帰）
    scheduleTrainingReminder()
  }, msUntil)
}

// ── タイマーをキャンセル ───────────────────────────────────────────
export function cancelTrainingReminder(): void {
  if (_trainingReminderTimer !== null) {
    clearTimeout(_trainingReminderTimer)
    _trainingReminderTimer = null
  }
}

// ── 朝のリマインダー（毎朝 7:00） ──────────────────────────────
let _morningTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleMorningReminder(): void {
  if (!isSupported()) return
  if (_morningTimer !== null) { clearTimeout(_morningTimer); _morningTimer = null }

  const now = new Date()
  const target = new Date()
  target.setHours(7, 0, 0, 0)
  if (now >= target) target.setDate(target.getDate() + 1)

  _morningTimer = setTimeout(() => {
    showNow(
      '🟢 おはようございます！',
      'sCOREで今日の怪我リスクを確認しましょう。',
    )
    scheduleMorningReminder()
  }, target.getTime() - now.getTime())
}

// ── 睡眠リマインダー（毎晩 22:00） ─────────────────────────────
let _sleepTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleSleepReminder(): void {
  if (!isSupported()) return
  if (_sleepTimer !== null) { clearTimeout(_sleepTimer); _sleepTimer = null }

  const now = new Date()
  const target = new Date()
  target.setHours(22, 0, 0, 0)
  if (now >= target) target.setDate(target.getDate() + 1)

  _sleepTimer = setTimeout(() => {
    showNow(
      '😴 睡眠を記録しよう',
      '睡眠データが怪我リスク計算に使われます。今夜の睡眠を記録してください。',
    )
    scheduleSleepReminder()
  }, target.getTime() - now.getTime())
}

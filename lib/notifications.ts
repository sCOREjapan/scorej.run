// lib/notifications.ts — Web Notification API ラッパー
// SSR / Notification API 非対応環境では安全に noop

import type { CompetitionPlan } from '../types'

const NOTIF_ASKED_KEY     = 'score_notif_asked'
const NOTIF_SENT_KEY      = 'score_notif_sent'   // JSON: { sleep:"2026-04-27", practice:"...", ... }

// ── ユーティリティ ─────────────────────────────────────────────────
function isSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function getSentMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(NOTIF_SENT_KEY) ?? '{}') } catch { return {} }
}

function markSent(key: string) {
  try {
    const m = getSentMap()
    localStorage.setItem(NOTIF_SENT_KEY, JSON.stringify({ ...m, [key]: todayStr() }))
  } catch {}
}

function notSentToday(key: string): boolean {
  return getSentMap()[key] !== todayStr()
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
export function showNow(title: string, body: string, tag?: string): void {
  if (!isSupported()) return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, { body, icon: '/icon.png', tag })
  } catch {}
}

// ──────────────────────────────────────────────────────────────────
// 初回起動 — 通知許可ダイアログを表示してスケジューラを開始
// ──────────────────────────────────────────────────────────────────
export async function initNotificationsOnFirstLaunch(): Promise<void> {
  if (!isSupported()) return

  // 既に許可済み / 拒否済みならスケジューラのみ起動
  if (Notification.permission === 'granted') {
    startAllSchedulers()
    return
  }
  if (Notification.permission === 'denied') return

  // 初回のみ聞く（'default' 状態）
  const asked = localStorage.getItem(NOTIF_ASKED_KEY)
  if (asked) return   // 既に一度聞いた

  // 2秒後に iOS ネイティブダイアログを表示
  await new Promise(r => setTimeout(r, 2000))
  localStorage.setItem(NOTIF_ASKED_KEY, '1')

  const result = await Notification.requestPermission()
  if (result === 'granted') {
    startAllSchedulers()
    setTimeout(() => {
      showNow('sCORE 通知をONにしました 🎉',
        '練習リマインダー・怪我リスクアラート・大会通知をお届けします。', 'welcome')
    }, 800)
  }
}

// ──────────────────────────────────────────────────────────────────
// 全スケジューラ一括起動
// ──────────────────────────────────────────────────────────────────
export function startAllSchedulers(): void {
  scheduleSleepReminder()
  schedulePracticeReminder()
}

// ── 睡眠リマインダー（毎晩 20:00） ────────────────────────────────
let _sleepTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleSleepReminder(): void {
  if (!isSupported()) return
  if (_sleepTimer) { clearTimeout(_sleepTimer); _sleepTimer = null }

  const now    = new Date()
  const target = new Date()
  target.setHours(20, 0, 0, 0)
  if (now >= target) target.setDate(target.getDate() + 1)

  _sleepTimer = setTimeout(() => {
    if (Notification.permission === 'granted' && notSentToday('sleep')) {
      showNow('sCORE 💤 そろそろ寝ましょう',
        '23時までに就寝すると明日の怪我リスクが下がります。今夜は7〜8時間の睡眠を目指そう。', 'sleep')
      markSent('sleep')
    }
    scheduleSleepReminder()  // 翌日も
  }, target.getTime() - now.getTime())
}

// ── 練習記録リマインダー（毎日 17:00） ────────────────────────────
let _practiceTimer: ReturnType<typeof setTimeout> | null = null

export function schedulePracticeReminder(): void {
  if (!isSupported()) return
  if (_practiceTimer) { clearTimeout(_practiceTimer); _practiceTimer = null }

  const now    = new Date()
  const target = new Date()
  target.setHours(17, 0, 0, 0)
  if (now >= target) target.setDate(target.getDate() + 1)

  _practiceTimer = setTimeout(() => {
    if (Notification.permission === 'granted' && notSentToday('practice')) {
      showNow('sCORE 📝 練習を記録しよう',
        '今日の練習はもう記録しましたか？記録するとAIがより精度の高いアドバイスを提供します。', 'practice')
      markSent('practice')
    }
    schedulePracticeReminder()  // 翌日も
  }, target.getTime() - now.getTime())
}

// ── 朝のリマインダー（毎朝 7:00）※オプション ──────────────────────
let _morningTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleMorningReminder(): void {
  if (!isSupported()) return
  if (_morningTimer) { clearTimeout(_morningTimer); _morningTimer = null }

  const now    = new Date()
  const target = new Date()
  target.setHours(7, 0, 0, 0)
  if (now >= target) target.setDate(target.getDate() + 1)

  _morningTimer = setTimeout(() => {
    if (Notification.permission === 'granted' && notSentToday('morning')) {
      showNow('sCORE 🟢 おはようございます！',
        '今日の怪我リスクを確認しましょう。', 'morning')
      markSent('morning')
    }
    scheduleMorningReminder()
  }, target.getTime() - now.getTime())
}

// ── 怪我リスクアラート（リスク ≥60 の時に呼び出す） ──────────────
export function sendRiskAlertIfNeeded(riskScore: number): void {
  if (!isSupported() || Notification.permission !== 'granted') return
  if (riskScore < 60) return
  if (!notSentToday('risk')) return

  const isHigh = riskScore >= 75
  showNow(
    `sCORE ${isHigh ? '🔴 高リスク' : '🟠 要注意'} 怪我に注意`,
    isHigh
      ? `怪我リスクスコアが${riskScore}です。今日は強度を大幅に落とすか休養しましょう。`
      : `怪我リスクスコアが${riskScore}です。練習強度を落として体を休めましょう。`,
    'risk'
  )
  markSent('risk')
}

// ── ストレッチ推奨通知 ────────────────────────────────────────────
export function sendStretchReminderIfNeeded(riskScore: number, stretchDoneToday: boolean): void {
  if (!isSupported() || Notification.permission !== 'granted') return
  if (stretchDoneToday || riskScore < 50 || !notSentToday('stretch')) return

  showNow(
    'sCORE 🏃 ストレッチでリスクを下げよう',
    `現在の怪我リスク: ${riskScore}。今日のストレッチで最大20ポイント下げられます！`,
    'stretch'
  )
  markSent('stretch')
}

// ── 大会リマインダー ───────────────────────────────────────────────
export function scheduleCompetitionReminder(competitions: CompetitionPlan[]): void {
  if (!isSupported() || Notification.permission !== 'granted') return

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  competitions.forEach(comp => {
    const compDate = new Date(comp.competition_date)
    compDate.setHours(0, 0, 0, 0)
    const diffDays = Math.round((compDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    const key      = `race-${comp.competition_name}-${diffDays}`

    if ((diffDays === 7 || diffDays === 3 || diffDays === 1 || diffDays === 0) && notSentToday(key)) {
      const msgs: Record<number, string> = {
        7: `「${comp.competition_name}」まであと7日。コンディション調整を始めましょう。`,
        3: `「${comp.competition_name}」まであと3日。今週は強度を落として疲労を抜きましょう。`,
        1: `「${comp.competition_name}」はいよいよ明日！今夜は早めに就寝しましょう。`,
        0: `今日は「${comp.competition_name}」の当日！全力を出し切ろう！🏆`,
      }
      showNow(`sCORE 🏆 大会リマインダー`, msgs[diffDays], `race-${diffDays}`)
      markSent(key)
    }
  })
}

// ── タイマーを全キャンセル ─────────────────────────────────────────
export function cancelAllSchedulers(): void {
  if (_sleepTimer)    { clearTimeout(_sleepTimer);    _sleepTimer    = null }
  if (_practiceTimer) { clearTimeout(_practiceTimer); _practiceTimer = null }
  if (_morningTimer)  { clearTimeout(_morningTimer);  _morningTimer  = null }
}

// legacy alias
export const cancelTrainingReminder = cancelAllSchedulers

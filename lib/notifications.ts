// lib/notifications.ts — 通知管理（ネイティブ: expo-notifications / Web: Notification API）
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { CompetitionPlan } from '../types'

// ── ネイティブ用（expo-notifications） ────────────────────────────
let ExpoNotif: typeof import('expo-notifications') | null = null

async function getExpoNotif() {
  if (Platform.OS === 'web') return null
  if (!ExpoNotif) {
    try { ExpoNotif = await import('expo-notifications') } catch { return null }
  }
  return ExpoNotif
}

// ── Web 用 ────────────────────────────────────────────────────────
const NOTIF_ASKED_KEY    = 'score_notif_asked'
const NOTIF_SENT_KEY     = 'score_notif_sent'
// ── ネイティブ用レート制限（AsyncStorage） ─────────────────────────
const NATIVE_SENT_KEY    = 'score_native_notif_sent'

function isWebNotifSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function getSentMap(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(NOTIF_SENT_KEY) ?? '{}') } catch { return {} }
}

function markSent(key: string) {
  if (typeof localStorage === 'undefined') return
  try {
    const m = getSentMap()
    localStorage.setItem(NOTIF_SENT_KEY, JSON.stringify({ ...m, [key]: todayStr() }))
  } catch {}
}

function notSentToday(key: string): boolean {
  return getSentMap()[key] !== todayStr()
}

// ── ネイティブ用1日1回チェック ─────────────────────────────────────
async function nativeNotSentToday(key: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(NATIVE_SENT_KEY)
    const map: Record<string, string> = raw ? JSON.parse(raw) : {}
    return map[key] !== todayStr()
  } catch { return true }
}

async function nativeMarkSent(key: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(NATIVE_SENT_KEY)
    const map: Record<string, string> = raw ? JSON.parse(raw) : {}
    map[key] = todayStr()
    await AsyncStorage.setItem(NATIVE_SENT_KEY, JSON.stringify(map))
  } catch {}
}

// ── パーミッション取得 ─────────────────────────────────────────────
export async function requestPermission(): Promise<'granted' | 'denied' | 'default' | 'unsupported'> {
  if (Platform.OS !== 'web') {
    const notif = await getExpoNotif()
    if (!notif) return 'unsupported'
    const { status: existing } = await notif.getPermissionsAsync()
    if (existing === 'granted') return 'granted'
    const { status } = await notif.requestPermissionsAsync()
    return status === 'granted' ? 'granted' : 'denied'
  }
  if (!isWebNotifSupported()) return 'unsupported'
  const result = await Notification.requestPermission()
  return result as 'granted' | 'denied' | 'default'
}

// ── 現在のパーミッション状態 ──────────────────────────────────────
export function getPermission(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (Platform.OS !== 'web') {
    // 同期での取得が難しいので granted と仮定（初回は requestPermission で確認）
    return 'granted'
  }
  if (!isWebNotifSupported()) return 'unsupported'
  return Notification.permission as 'granted' | 'denied' | 'default'
}

// ── 即時通知 ──────────────────────────────────────────────────────
export async function showNow(title: string, body: string, _tag?: string): Promise<void> {
  if (Platform.OS !== 'web') {
    const notif = await getExpoNotif()
    if (!notif) return
    await notif.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: null,
    }).catch(() => {})
    return
  }
  if (!isWebNotifSupported() || Notification.permission !== 'granted') return
  try { new Notification(title, { body, icon: '/icon.png', tag: _tag }) } catch {}
}

// ── デイリートリガーでスケジュール（ネイティブ専用） ───────────────
async function scheduleDailyNative(
  id: string,
  title: string,
  body: string,
  hour: number,
  minute: number,
): Promise<void> {
  const notif = await getExpoNotif()
  if (!notif) return
  try {
    // 同じIDのものをキャンセルしてから再スケジュール
    await notif.cancelScheduledNotificationAsync(id).catch(() => {})
    await notif.scheduleNotificationAsync({
      identifier: id,
      content: { title, body, sound: true },
      trigger: { type: notif.SchedulableTriggerInputTypes.DAILY, hour, minute },
    })
  } catch {}
}

// ── 練習リマインダー（毎日 17:00） ────────────────────────────────
let _practiceTimer: ReturnType<typeof setTimeout> | null = null

export async function schedulePracticeReminder(): Promise<void> {
  if (Platform.OS !== 'web') {
    await scheduleDailyNative(
      'practice-reminder',
      'sCORE 📝 練習を記録しよう',
      '今日の練習はもう記録しましたか？記録するとAIがより精度の高いアドバイスを提供します。',
      17, 0,
    )
    return
  }
  if (!isWebNotifSupported()) return
  if (_practiceTimer) { clearTimeout(_practiceTimer); _practiceTimer = null }
  const now = new Date(), target = new Date()
  target.setHours(17, 0, 0, 0)
  if (now >= target) target.setDate(target.getDate() + 1)
  _practiceTimer = setTimeout(async () => {
    if (Notification.permission === 'granted' && notSentToday('practice')) {
      showNow('sCORE 📝 練習を記録しよう',
        '今日の練習はもう記録しましたか？記録するとAIがより精度の高いアドバイスを提供します。', 'practice')
      markSent('practice')
    }
    schedulePracticeReminder()
  }, target.getTime() - now.getTime())
}

// 後方互換エイリアス
export const scheduleTrainingReminder = schedulePracticeReminder

// ── 睡眠リマインダー（毎晩 22:00） ────────────────────────────────
let _sleepTimer: ReturnType<typeof setTimeout> | null = null

export async function scheduleSleepReminder(): Promise<void> {
  if (Platform.OS !== 'web') {
    await scheduleDailyNative(
      'sleep-reminder',
      'sCORE 💤 そろそろ寝ましょう',
      '22時です。今夜は早めに就寝して明日の練習に備えましょう。7〜8時間の睡眠が怪我予防に効果的です。',
      22, 0,
    )
    return
  }
  if (!isWebNotifSupported()) return
  if (_sleepTimer) { clearTimeout(_sleepTimer); _sleepTimer = null }
  const now = new Date(), target = new Date()
  target.setHours(22, 0, 0, 0)
  if (now >= target) target.setDate(target.getDate() + 1)
  _sleepTimer = setTimeout(async () => {
    if (Notification.permission === 'granted' && notSentToday('sleep')) {
      showNow('sCORE 💤 そろそろ寝ましょう',
        '22時です。今夜は早めに就寝して明日の練習に備えましょう。7〜8時間の睡眠が怪我予防に効果的です。', 'sleep')
      markSent('sleep')
    }
    scheduleSleepReminder()
  }, target.getTime() - now.getTime())
}

// ── 朝の天気・リスクチェック通知（毎朝 7:00） ─────────────────────
let _morningTimer: ReturnType<typeof setTimeout> | null = null

export async function scheduleMorningRiskReminder(): Promise<void> {
  if (Platform.OS !== 'web') {
    await scheduleDailyNative(
      'morning-risk-reminder',
      'sCORE ☀️ 今日のコンディションをチェック',
      'おはようございます！今日の天気・体調を確認して練習の強度を決めましょう。',
      7, 0,
    )
    return
  }
  if (!isWebNotifSupported()) return
  if (_morningTimer) { clearTimeout(_morningTimer); _morningTimer = null }
  const now = new Date(), target = new Date()
  target.setHours(7, 0, 0, 0)
  if (now >= target) target.setDate(target.getDate() + 1)
  _morningTimer = setTimeout(async () => {
    if (Notification.permission === 'granted' && notSentToday('morning')) {
      showNow('sCORE ☀️ 今日のコンディションをチェック',
        'おはようございます！今日の天気・体調を確認して練習の強度を決めましょう。', 'morning')
      markSent('morning')
    }
    scheduleMorningRiskReminder()
  }, target.getTime() - now.getTime())
}

// ── 全スケジューラ一括起動 ────────────────────────────────────────
export function startAllSchedulers(): void {
  scheduleMorningRiskReminder()   // 毎朝 7:00
  schedulePracticeReminder()      // 毎日 17:00
  scheduleSleepReminder()         // 毎晩 22:00
}

// ── 初回起動通知セットアップ ──────────────────────────────────────
export async function initNotificationsOnFirstLaunch(): Promise<void> {
  if (Platform.OS !== 'web') {
    const notif = await getExpoNotif()
    if (!notif) return
    notif.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    })
    const { status: existing } = await notif.getPermissionsAsync()
    if (existing === 'granted') {
      startAllSchedulers()
      return
    }
    // まだ確認していない（undetermined）→ 2秒後にダイアログを表示
    if (existing === 'undetermined') {
      await new Promise(r => setTimeout(r, 2000))
      const { status } = await notif.requestPermissionsAsync()
      if (status === 'granted') {
        startAllSchedulers()
      }
    }
    // denied の場合は何もしない
    return
  }
  if (!isWebNotifSupported()) return
  if (Notification.permission === 'granted') { startAllSchedulers(); return }
  if (Notification.permission === 'denied') return
  const asked = typeof localStorage !== 'undefined' ? localStorage.getItem(NOTIF_ASKED_KEY) : '1'
  if (asked) return
  await new Promise(r => setTimeout(r, 2000))
  if (typeof localStorage !== 'undefined') localStorage.setItem(NOTIF_ASKED_KEY, '1')
  const result = await Notification.requestPermission()
  if (result === 'granted') {
    startAllSchedulers()
    setTimeout(() => showNow('sCORE 通知をONにしました 🎉',
      '練習リマインダー・怪我リスクアラート・大会通知をお届けします。', 'welcome'), 800)
  }
}

// ── 怪我リスクアラート（高リスク 80+ のみ・1日1回） ─────────────
export async function sendRiskAlertIfNeeded(riskScore: number): Promise<void> {
  if (riskScore < 80) return
  if (Platform.OS === 'web') {
    if (!isWebNotifSupported() || Notification.permission !== 'granted' || !notSentToday('risk')) return
    await showNow(
      'sCORE 🔴 怪我リスクが高い状態です',
      `怪我リスクスコアが${riskScore}です。今日は強度を大幅に落とすか休養しましょう。`,
      'risk',
    )
    markSent('risk')
  } else {
    if (!(await nativeNotSentToday('risk'))) return   // 今日もう送った
    await showNow(
      'sCORE 🔴 怪我リスクが高い状態です',
      `怪我リスクスコアが${riskScore}です。今日は強度を大幅に落とすか休養しましょう。`,
      'risk',
    )
    await nativeMarkSent('risk')
  }
}

// ── ストレッチ推奨通知（高リスク 75+ かつ今日未実施・1日1回） ──────
export async function sendStretchReminderIfNeeded(riskScore: number, stretchDoneToday: boolean): Promise<void> {
  if (stretchDoneToday || riskScore < 75) return
  if (Platform.OS === 'web') {
    if (!isWebNotifSupported() || Notification.permission !== 'granted' || !notSentToday('stretch')) return
    await showNow(
      'sCORE 🧘 ストレッチでリスクを下げよう',
      `怪我リスク${riskScore}。今日のストレッチで最大20ポイント改善できます！`,
      'stretch',
    )
    markSent('stretch')
  } else {
    if (!(await nativeNotSentToday('stretch'))) return  // 今日もう送った
    await showNow(
      'sCORE 🧘 ストレッチでリスクを下げよう',
      `怪我リスク${riskScore}。今日のストレッチで最大20ポイント改善できます！`,
      'stretch',
    )
    await nativeMarkSent('stretch')
  }
}

// ── 大会リマインダー ──────────────────────────────────────────────
export async function scheduleCompetitionReminder(competitions: CompetitionPlan[]): Promise<void> {
  if (Platform.OS !== 'web') {
    const notif = await getExpoNotif()
    if (!notif) return
    const today = new Date(); today.setHours(0, 0, 0, 0)
    for (const comp of competitions) {
      const compDate = new Date(comp.competition_date); compDate.setHours(0, 0, 0, 0)
      const diffDays = Math.round((compDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      const msgs: Record<number, string> = {
        7: `「${comp.competition_name}」まであと7日。コンディション調整を始めましょう。`,
        3: `「${comp.competition_name}」まであと3日。今週は強度を落として疲労を抜きましょう。`,
        1: `「${comp.competition_name}」はいよいよ明日！今夜は早めに就寝しましょう。`,
        0: `今日は「${comp.competition_name}」の当日！全力を出し切ろう！🏆`,
      }
      if (msgs[diffDays]) {
        await notif.scheduleNotificationAsync({
          content: { title: 'sCORE 🏆 大会リマインダー', body: msgs[diffDays], sound: true },
          trigger: null,
        }).catch(() => {})
      }
    }
    return
  }
  if (!isWebNotifSupported() || Notification.permission !== 'granted') return
  const today = new Date(); today.setHours(0, 0, 0, 0)
  competitions.forEach(comp => {
    const compDate = new Date(comp.competition_date); compDate.setHours(0, 0, 0, 0)
    const diffDays = Math.round((compDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    const key = `race-${comp.competition_name}-${diffDays}`
    if ((diffDays === 7 || diffDays === 3 || diffDays === 1 || diffDays === 0) && notSentToday(key)) {
      const msgs: Record<number, string> = {
        7: `「${comp.competition_name}」まであと7日。コンディション調整を始めましょう。`,
        3: `「${comp.competition_name}」まであと3日。今週は強度を落として疲労を抜きましょう。`,
        1: `「${comp.competition_name}」はいよいよ明日！今夜は早めに就寝しましょう。`,
        0: `今日は「${comp.competition_name}」の当日！全力を出し切ろう！🏆`,
      }
      showNow('sCORE 🏆 大会リマインダー', msgs[diffDays], `race-${diffDays}`)
      markSent(key)
    }
  })
}

// ── 試合計画作成通知 ──────────────────────────────────────────────
export async function sendCompetitionPlanCreatedNotification(
  planName: string,
  daysUntil: number,
): Promise<void> {
  const body = daysUntil > 0
    ? `「${planName}」まであと${daysUntil}日。今日から計画的なトレーニングを開始しよう！`
    : `「${planName}」は今日！全力を出し切ろう🏆`
  await showNow('sCORE 🏆 試合計画を作成しました', body, 'plan-created')
}

// ── タイマーキャンセル ────────────────────────────────────────────
export function cancelAllSchedulers(): void {
  if (_morningTimer)  { clearTimeout(_morningTimer);  _morningTimer  = null }
  if (_sleepTimer)    { clearTimeout(_sleepTimer);    _sleepTimer    = null }
  if (_practiceTimer) { clearTimeout(_practiceTimer); _practiceTimer = null }
}


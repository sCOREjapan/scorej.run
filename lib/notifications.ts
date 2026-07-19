// lib/notifications.ts — 通知管理（ネイティブ: expo-notifications / Web: Notification API）
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { CompetitionPlan } from '../types'
import { todayLocalISO } from './dateLocal'

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
  return todayLocalISO()
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

// ── 文面の鮮度：日替わりローテーション ─────────────────────────────
// 同じ文面は数週間で無視される → 日替わりで回して通知の寿命を延ばす
function dayOfYear(): number {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 0)
  return Math.floor((now.getTime() - start.getTime()) / 86400000)
}
/** 当日のインデックスでプールから1つ選ぶ（日替わりローテ） */
function pick(pool: string[]): string {
  return pool[dayOfYear() % pool.length]
}

const MORNING_MSGS = [
  'おはようございます！今日の天気・体調を確認して練習の強度を決めましょう。',
  'おはよう！今日の怪我リスクをチェックしてから動き出そう。',
  '今日のコンディションは？1タップで体調を記録して1日をスタート。',
  '今日の天気、練習に向いてる？開いて確認しよう。',
  'おはよう。今日の自分の状態を知ることが、自己ベストへの第一歩。',
]
const PRACTICE_MSGS = [
  '今日の練習はもう記録した？記録するとAIのアドバイス精度が上がります。',
  'お疲れさま！今日の練習を30秒で記録しておこう。',
  '練習の記録、忘れてない？積み重ねが自己ベストを作る。',
  '今日のメニュー、記録した？後で見返すと成長が見える。',
  '練習終わり？コンディションと一緒にサッと記録しよう。',
]
const SLEEP_MSGS = [
  '20時です。早めに就寝の準備をして明日の練習に備えましょう。7〜8時間の睡眠を意識すると、コンディションが整いやすくなります。',
  '今夜の睡眠が明日のパフォーマンスを決める。そろそろ寝る準備を。',
  'お疲れさま。今日の睡眠を記録して、回復の質を上げよう。',
  '強くなるのは練習中じゃなく、寝てる間。今夜はしっかり休もう。',
]
const SHARE_MSGS = [
  '今日の練習、シェアカードにして残そう。仲間にも刺激になるよ。',
  'PB・連続記録・今日のメニュー、カードでシェアしてみない？',
  'あなたの記録、1タップでオシャレなカードに。ストーリーに載せよう。',
  '今日の頑張り、シェアカードで世界に見せよう。',
]
const WINBACK_MSGS = [
  'おかえり！しばらく空いたね。今日からまた記録を再開しよう。',
  '記録が止まってるよ。1分でいいから今日の練習を残しておこう。',
  '自己ベストは継続から。久しぶりに開いて、また走り出そう。',
]

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

// ── カレンダー予定の事前通知（前日20:00 + 当日7:00） ───────────────
/** 予定追加・更新時に呼ぶ。前日夜と当日朝にローカル通知を予約（過去分はスキップ） */
export async function scheduleEventReminders(
  eventId: string,
  dateYMD: string,   // YYYY-MM-DD
  title: string,
): Promise<void> {
  if (Platform.OS === 'web') return
  const notif = await getExpoNotif()
  if (!notif) return
  // 通知許可を確認（未許可なら一度だけリクエスト）
  try {
    const { status } = await notif.getPermissionsAsync()
    if (status !== 'granted') {
      const r = await notif.requestPermissionsAsync()
      if (r.status !== 'granted') return
    }
  } catch { return }

  const parts = dateYMD.split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return
  const [y, m, d] = parts
  const eve     = new Date(y, m - 1, d - 1, 20, 0, 0, 0)  // 前日20:00
  const morning = new Date(y, m - 1, d,     7, 0, 0, 0)   // 当日7:00
  const now = Date.now()

  // 既存の同イベント通知を消してから再予約（更新対応）
  await cancelEventReminders(eventId)
  try {
    if (eve.getTime() > now) {
      await notif.scheduleNotificationAsync({
        identifier: `event-${eventId}-eve`,
        content: { title: '明日の予定', body: `明日は「${title}」があります`, sound: true },
        trigger: { type: notif.SchedulableTriggerInputTypes.DATE, date: eve },
      })
    }
    if (morning.getTime() > now) {
      await notif.scheduleNotificationAsync({
        identifier: `event-${eventId}-morning`,
        content: { title: '今日の予定', body: `今日は「${title}」があります`, sound: true },
        trigger: { type: notif.SchedulableTriggerInputTypes.DATE, date: morning },
      })
    }
  } catch {}
}

/** 予定削除時に呼ぶ。予約済みの事前通知を取り消す */
export async function cancelEventReminders(eventId: string): Promise<void> {
  if (Platform.OS === 'web') return
  const notif = await getExpoNotif()
  if (!notif) return
  await notif.cancelScheduledNotificationAsync(`event-${eventId}-eve`).catch(() => {})
  await notif.cancelScheduledNotificationAsync(`event-${eventId}-morning`).catch(() => {})
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
      pick(PRACTICE_MSGS),
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
      showNow('sCORE 📝 練習を記録しよう', pick(PRACTICE_MSGS), 'practice')
      markSent('practice')
    }
    schedulePracticeReminder()
  }, target.getTime() - now.getTime())
}

// 後方互換エイリアス
export const scheduleTrainingReminder = schedulePracticeReminder

// ── 睡眠リマインダー（毎晩 20:00） ────────────────────────────────
let _sleepTimer: ReturnType<typeof setTimeout> | null = null

export async function scheduleSleepReminder(): Promise<void> {
  if (Platform.OS !== 'web') {
    await scheduleDailyNative(
      'sleep-reminder',
      'sCORE 💤 そろそろ寝ましょう',
      pick(SLEEP_MSGS),
      20, 0,
    )
    return
  }
  if (!isWebNotifSupported()) return
  if (_sleepTimer) { clearTimeout(_sleepTimer); _sleepTimer = null }
  const now = new Date(), target = new Date()
  target.setHours(20, 0, 0, 0)
  if (now >= target) target.setDate(target.getDate() + 1)
  _sleepTimer = setTimeout(async () => {
    if (Notification.permission === 'granted' && notSentToday('sleep')) {
      showNow('sCORE 💤 そろそろ寝ましょう', pick(SLEEP_MSGS), 'sleep')
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
      pick(MORNING_MSGS),
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
      showNow('sCORE ☀️ 今日のコンディションをチェック', pick(MORNING_MSGS), 'morning')
      markSent('morning')
    }
    scheduleMorningRiskReminder()
  }, target.getTime() - now.getTime())
}

// ── シェアカード通知（2日に1回・夜19:30／拡散ループ） ─────────────
// 偶数日のみ予約することで「2日に1回」を実現。起動毎に再アームし文面はローテ。
let _shareTimer: ReturnType<typeof setTimeout> | null = null

export async function scheduleShareCardReminder(): Promise<void> {
  const now = new Date()
  const isShareDay = dayOfYear() % 2 === 0
  if (Platform.OS !== 'web') {
    const notif = await getExpoNotif()
    if (!notif) return
    await notif.cancelScheduledNotificationAsync('sharecard-reminder').catch(() => {})
    if (!isShareDay) return  // 奇数日はスキップ＝2日に1回
    let target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 30, 0, 0)
    if (target.getTime() <= now.getTime()) target = new Date(target.getTime() + 2 * 86400000) // 過ぎてたら2日後
    try {
      await notif.scheduleNotificationAsync({
        identifier: 'sharecard-reminder',
        content: { title: 'sCORE 📣 今日の記録、シェアしよう', body: pick(SHARE_MSGS), sound: true },
        trigger: { type: notif.SchedulableTriggerInputTypes.DATE, date: target },
      })
    } catch {}
    return
  }
  if (!isWebNotifSupported()) return
  if (_shareTimer) { clearTimeout(_shareTimer); _shareTimer = null }
  const target = new Date(); target.setHours(19, 30, 0, 0)
  if (now >= target) target.setDate(target.getDate() + 1)
  _shareTimer = setTimeout(async () => {
    if (Notification.permission === 'granted' && dayOfYear() % 2 === 0 && notSentToday('sharecard')) {
      showNow('sCORE 📣 今日の記録、シェアしよう', pick(SHARE_MSGS), 'sharecard')
      markSent('sharecard')
    }
    scheduleShareCardReminder()
  }, target.getTime() - now.getTime())
}

// ── 復帰ナッジ（3日間アプリ未起動なら発火・win-back） ──────────────
// 起動毎に「3日後」の通知を再予約。戻ってこなければ発火、戻れば再アームでキャンセル。
export async function scheduleWinBackReminder(): Promise<void> {
  if (Platform.OS === 'web') return  // Webはタブを閉じると予約が消えるため対象外
  const notif = await getExpoNotif()
  if (!notif) return
  await notif.cancelScheduledNotificationAsync('winback-reminder').catch(() => {})
  const target = new Date(Date.now() + 3 * 86400000)  // 3日後
  target.setHours(18, 0, 0, 0)
  try {
    await notif.scheduleNotificationAsync({
      identifier: 'winback-reminder',
      content: { title: 'sCORE 👋 久しぶり！', body: pick(WINBACK_MSGS), sound: true },
      trigger: { type: notif.SchedulableTriggerInputTypes.DATE, date: target },
    })
  } catch {}
}

// ── 連続記録ストリーク通知（途切れそうな夜21:00に予約・1日1回） ──────
// streakDays>=2 かつ 今日未記録なら、今夜21:00に「継続を切らさないで」を予約。
// ホーム画面で streak/今日の記録状況を計算して毎回呼ぶ（記録すれば自動でキャンセル）。
export async function scheduleStreakReminder(streakDays: number, recordedToday: boolean): Promise<void> {
  if (Platform.OS === 'web') return  // Webは予約保持できないため対象外
  const notif = await getExpoNotif()
  if (!notif) return
  // 既存予約をクリア（記録済み・条件外なら張り直さない＝実質キャンセル）
  await notif.cancelScheduledNotificationAsync('streak-reminder').catch(() => {})
  if (recordedToday || streakDays < 2) return
  const now = new Date()
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0, 0) // 今夜21:00
  if (target.getTime() <= now.getTime()) return  // もう21時を過ぎてたら今夜は予約しない
  try {
    await notif.scheduleNotificationAsync({
      identifier: 'streak-reminder',
      content: {
        title: 'sCORE 🔥 連続記録を切らさないで',
        body: `${streakDays}日連続で記録中！今日もう記録した？今日中に記録して継続しよう。`,
        sound: true,
      },
      trigger: { type: notif.SchedulableTriggerInputTypes.DATE, date: target },
    })
  } catch {}
}

// ── 怪我回復プラン 1日ごと通知 ──────────────────────────────────────
export async function scheduleInjuryDailyNotifications(
  injuryId: string,
  startDateYMD: string,   // YYYY-MM-DD
  plans: Array<{ day: number; phase: string; exercises: Array<{ name: string; detail: string }>; advice: string }>,
): Promise<void> {
  if (Platform.OS === 'web') return
  const notif = await getExpoNotif()
  if (!notif) return
  try {
    const { status } = await notif.getPermissionsAsync()
    if (status !== 'granted') return
  } catch { return }

  // 先にこの怪我の既存通知を全キャンセル
  await cancelInjuryNotifications(injuryId)

  const [y, m, d] = startDateYMD.split('-').map(Number)
  const now = Date.now()
  // iOS上限64件 → 最大30日分に絞る
  const target = plans.slice(0, 30)

  for (const plan of target) {
    const date = new Date(y, m - 1, d + plan.day - 1, 7, 0, 0, 0)
    if (date.getTime() <= now) continue
    const mainEx = plan.exercises[0]
    const body = mainEx
      ? `${mainEx.name}（${mainEx.detail}）`
      : plan.advice.slice(0, 40)
    try {
      await notif.scheduleNotificationAsync({
        identifier: `injury-${injuryId}-day${plan.day}`,
        content: {
          title: `🩹 Day ${plan.day} · ${plan.phase}`,
          body,
          sound: true,
        },
        trigger: { type: notif.SchedulableTriggerInputTypes.DATE, date },
      })
    } catch {}
  }
}

/** 怪我完治 / 削除時に呼ぶ */
export async function cancelInjuryNotifications(injuryId: string): Promise<void> {
  if (Platform.OS === 'web') return
  const notif = await getExpoNotif()
  if (!notif) return
  try {
    const scheduled = await notif.getAllScheduledNotificationsAsync()
    const prefix = `injury-${injuryId}-day`
    await Promise.all(
      scheduled
        .filter(n => n.identifier.startsWith(prefix))
        .map(n => notif.cancelScheduledNotificationAsync(n.identifier).catch(() => {}))
    )
  } catch {}
}

// ── 全スケジューラ一括起動 ────────────────────────────────────────
export function startAllSchedulers(): void {
  scheduleMorningRiskReminder()   // 毎朝 7:00（文面ローテ）
  schedulePracticeReminder()      // 毎日 17:00（文面ローテ）
  scheduleSleepReminder()         // 毎晩 20:00（文面ローテ）
  scheduleShareCardReminder()     // 2日に1回 19:30（拡散ループ）
  scheduleWinBackReminder()       // 3日未起動で復帰ナッジ
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
      'sCORE 🧘 ストレッチでコンディションを整えよう',
      `怪我リスク${riskScore}。今日のストレッチでスコアが最大20ポイント変化します。`,
      'stretch',
    )
    markSent('stretch')
  } else {
    if (!(await nativeNotSentToday('stretch'))) return  // 今日もう送った
    await showNow(
      'sCORE 🧘 ストレッチでコンディションを整えよう',
      `怪我リスク${riskScore}。今日のストレッチでスコアが最大20ポイント変化します。`,
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
  if (_shareTimer)    { clearTimeout(_shareTimer);    _shareTimer    = null }
}


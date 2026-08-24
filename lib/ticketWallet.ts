// lib/ticketWallet.ts — チケット残高・月額付与・ストリークボーナス管理
//
// チケット: AI機能すべてを消費する唯一の通貨（無料10枚→単発パック→チケット月額プランで補充）。
// チケット月額プラン: 更新のたびに100枚を自動付与する（lib/purchaseService の ticket_monthly エンタイトルメント）。
// ストリーク: 連続起動日数に応じたボーナス付与（3日=チケット+1 / 7日=チケット+2 / 30日=チケット+5）。
import AsyncStorage from '@react-native-async-storage/async-storage'
import { todayLocalISO } from './dateLocal'
import { TICKET_MONTHLY_GRANT } from './purchaseService'

const WALLET_KEY           = 'score_ticket_wallet'
const STREAK_KEY           = 'score_ticket_streak'
const STARTER_KEY          = 'score_ticket_starter_granted'
const SHARE_BONUS_KEY      = 'score_ticket_share_bonus_daily'
const MONTHLY_GRANT_KEY    = 'score_ticket_monthly_last_granted'   // 直近で付与済みの更新期日(ticketMonthlyExpiresAt)
const MISSION_PROFILE_KEY  = 'score_ticket_mission_profile'
const MISSION_LINE_KEY     = 'score_ticket_mission_line'
const MISSION_GOAL_KEY     = 'score_ticket_mission_goal'

const STARTER_TICKETS = 10  // オンボーディング完了時に1回だけ付与する初期チケット
const MISSION_BONUS   = 5   // 各ワンタイムミッション（プロフィール完成/LINE参加/目標設定）の付与枚数

// AIを使う機能はすべてチケット制
export type TicketFeature =
  | 'video' | 'workout' | 'meal' | 'ai_analysis' | 'recovery'
  | 'meal_coach' | 'daily_insight' | 'notebook_ai' | 'competition_plan' | 'injury_recovery'
export const TICKET_COST: Record<TicketFeature, number> = {
  video: 2, workout: 2, meal: 1,
  ai_analysis: 2, recovery: 1, meal_coach: 2, daily_insight: 1,
  notebook_ai: 1, competition_plan: 3, injury_recovery: 3,
}

type Wallet = { tickets: number }

// ── 書き込み直列化（adGate.ts と同じ作法。read-modify-writeの競合を防ぐ） ──
let _writeQueue: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = _writeQueue.then(fn, fn)
  _writeQueue = run.then(() => undefined, () => undefined)
  return run
}

async function getWallet(): Promise<Wallet> {
  try {
    const raw = await AsyncStorage.getItem(WALLET_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { tickets: parsed.tickets ?? 0 }
    }
  } catch {}
  return { tickets: 0 }
}
async function saveWallet(w: Wallet) {
  await AsyncStorage.setItem(WALLET_KEY, JSON.stringify(w)).catch(() => {})
}

export async function getWalletSnapshot(): Promise<Wallet> {
  return getWallet()
}
export async function getTicketBalance(): Promise<number> {
  return (await getWallet()).tickets
}

/** チケットを付与する（IAP購入・ストリークボーナス・広告視聴共通） */
export async function grantTickets(count: number): Promise<number> {
  return serialize(async () => {
    const w = await getWallet()
    w.tickets += count
    await saveWallet(w)
    return w.tickets
  })
}

/** オンボーディング完了時に1回だけ初期チケットを付与する（2回目以降は何もしない） */
export async function grantStarterTicketsIfNeeded(): Promise<void> {
  return serialize(async () => {
    const already = await AsyncStorage.getItem(STARTER_KEY)
    if (already) return
    const w = await getWallet()
    w.tickets += STARTER_TICKETS
    await saveWallet(w)
    await AsyncStorage.setItem(STARTER_KEY, '1').catch(() => {})
  })
}

/** シェアカード投稿でチケット1枚を付与（1日1回まで） */
export async function grantShareBonusTicket(): Promise<{ granted: boolean; atCap: boolean }> {
  return serialize(async () => {
    const today = todayLocalISO()
    const last = await AsyncStorage.getItem(SHARE_BONUS_KEY).catch(() => null)
    if (last === today) return { granted: false, atCap: true }
    await AsyncStorage.setItem(SHARE_BONUS_KEY, today).catch(() => {})
    const w = await getWallet()
    w.tickets += 1
    await saveWallet(w)
    return { granted: true, atCap: false }
  })
}

/** プロフィール（種目・自己ベスト等）を初めて完成させたらチケットを1回だけ付与する */
export async function grantProfileCompleteBonusIfNeeded(): Promise<{ granted: boolean }> {
  return serialize(async () => {
    const already = await AsyncStorage.getItem(MISSION_PROFILE_KEY)
    if (already) return { granted: false }
    await AsyncStorage.setItem(MISSION_PROFILE_KEY, '1').catch(() => {})
    const w = await getWallet()
    w.tickets += MISSION_BONUS
    await saveWallet(w)
    return { granted: true }
  })
}

/** LINEオープンチャットへの参加ボタンを押したらチケットを1回だけ付与する（自己申告） */
export async function grantLineJoinBonusIfNeeded(): Promise<{ granted: boolean }> {
  return serialize(async () => {
    const already = await AsyncStorage.getItem(MISSION_LINE_KEY)
    if (already) return { granted: false }
    await AsyncStorage.setItem(MISSION_LINE_KEY, '1').catch(() => {})
    const w = await getWallet()
    w.tickets += MISSION_BONUS
    await saveWallet(w)
    return { granted: true }
  })
}

/** 初めて目標を設定したらチケットを1回だけ付与する */
export async function grantFirstGoalBonusIfNeeded(): Promise<{ granted: boolean }> {
  return serialize(async () => {
    const already = await AsyncStorage.getItem(MISSION_GOAL_KEY)
    if (already) return { granted: false }
    await AsyncStorage.setItem(MISSION_GOAL_KEY, '1').catch(() => {})
    const w = await getWallet()
    w.tickets += MISSION_BONUS
    await saveWallet(w)
    return { granted: true }
  })
}

/** チケットを消費する。残高不足なら何もせず false を返す */
export async function spendTickets(count: number): Promise<boolean> {
  return serialize(async () => {
    const w = await getWallet()
    if (w.tickets < count) return false
    w.tickets -= count
    await saveWallet(w)
    return true
  })
}

/** 機能に応じた重み付きコストでチケットを消費する */
export async function spendTicketsForFeature(feature: TicketFeature): Promise<boolean> {
  return spendTickets(TICKET_COST[feature])
}

// ── 広告視聴でチケットを直接獲得（1日10回まで） ───────────────────
const AD_TICKET_DAILY_CAP = 10
const AD_TICKET_DAILY_KEY = 'score_ticket_ad_daily'

async function getAdTicketDaily(): Promise<{ date: string; count: number }> {
  try {
    const raw = await AsyncStorage.getItem(AD_TICKET_DAILY_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p.date === todayLocalISO()) return p
    }
  } catch {}
  return { date: todayLocalISO(), count: 0 }
}
async function saveAdTicketDaily(d: { date: string; count: number }) {
  await AsyncStorage.setItem(AD_TICKET_DAILY_KEY, JSON.stringify(d)).catch(() => {})
}

/** 本日あと何回、広告視聴でチケットを獲得できるか */
export async function getAdTicketRemainingToday(): Promise<number> {
  const daily = await getAdTicketDaily()
  return Math.max(0, AD_TICKET_DAILY_CAP - daily.count)
}

/** 広告視聴でチケットを1枚獲得（1日上限あり） */
export async function earnTicketFromAd(): Promise<{ granted: boolean; atCap: boolean; tickets: number }> {
  return serialize(async () => {
    const daily = await getAdTicketDaily()
    if (daily.count >= AD_TICKET_DAILY_CAP) {
      const w = await getWallet()
      return { granted: false, atCap: true, tickets: w.tickets }
    }
    daily.count += 1
    await saveAdTicketDaily(daily)
    const w = await getWallet()
    w.tickets += 1
    await saveWallet(w)
    return { granted: true, atCap: false, tickets: w.tickets }
  })
}

// ── チケット月額プラン：更新のたびに100枚を自動付与 ───────────────
/**
 * チケット月額プランが有効なとき、更新期日(periodExpiresAt)が前回付与時と変わっていれば
 * 100枚を追加付与する（残高リセットではなく加算——単発パックで買い足した分を消さないため）。
 * 同じ期日内での複数回呼び出しは何もしない（起動のたびに呼んでも安全）。
 */
export async function grantMonthlyTicketsIfNeeded(periodExpiresAt: string | undefined): Promise<boolean> {
  if (!periodExpiresAt) return false
  return serialize(async () => {
    const last = await AsyncStorage.getItem(MONTHLY_GRANT_KEY).catch(() => null)
    if (last === periodExpiresAt) return false
    const w = await getWallet()
    w.tickets += TICKET_MONTHLY_GRANT
    await saveWallet(w)
    await AsyncStorage.setItem(MONTHLY_GRANT_KEY, periodExpiresAt).catch(() => {})
    return true
  })
}

// ── ストリークボーナス（連続起動日数） ───────────────────────────
type StreakStore = { lastDate: string; streak: number; lastBonusStreak: number }
type StreakBonus = { amount: number }

async function getStreakStore(): Promise<StreakStore> {
  try {
    const raw = await AsyncStorage.getItem(STREAK_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { lastDate: '', streak: 0, lastBonusStreak: 0 }
}
async function saveStreakStore(s: StreakStore) {
  await AsyncStorage.setItem(STREAK_KEY, JSON.stringify(s)).catch(() => {})
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00')
  const db = new Date(b + 'T00:00:00')
  return Math.round((db.getTime() - da.getTime()) / 86400000)
}

/**
 * 1日1回（アプリ起動時など）呼ぶチェックイン。連続起動日数を更新し、
 * 3日/7日/30日の節目でチケットボーナスを付与する。同日内の再呼び出しは何もしない。
 */
export async function checkInStreak(): Promise<{ streak: number; bonus: StreakBonus | null }> {
  return serialize(async () => {
    const today = todayLocalISO()
    const s = await getStreakStore()
    if (s.lastDate === today) {
      return { streak: s.streak, bonus: null }
    }

    const diff = s.lastDate ? daysBetween(s.lastDate, today) : 999
    const streak = diff === 1 ? s.streak + 1 : 1
    s.lastDate = today
    s.streak = streak

    let bonus: StreakBonus | null = null
    if (streak !== s.lastBonusStreak && (streak === 3 || streak === 7 || streak === 30)) {
      const w = await getWallet()
      const amount = streak === 30 ? 5 : streak === 7 ? 2 : 1
      w.tickets += amount
      bonus = { amount }
      await saveWallet(w)
      s.lastBonusStreak = streak
    }
    await saveStreakStore(s)
    return { streak, bonus }
  })
}

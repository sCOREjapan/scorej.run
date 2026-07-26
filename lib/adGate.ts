// lib/adGate.ts — 機能利用制限管理 v1.0（IAP無効化・広告中心モデル）
//
// 機能               制限
// 動画分析           3日間1回無料 → 以降は広告視聴で無制限（ただし月40回・1日8回はtier不問の絶対上限）
// 食事分析           3日間1回無料 → 以降は広告視聴で無制限
// AI分析・回復・練習  1日1回無料 → 以降は広告視聴で無制限
// CSVエクスポート     累計1回無料 → 以降はハードリミット

import AsyncStorage from '@react-native-async-storage/async-storage'
import { readCachedTier } from './subscriptionCache'
import { todayLocalISO } from './dateLocal'

export type Feature = 'ai_analysis' | 'video' | 'meal' | 'csv' | 'recovery' | 'workout'

// ── 3日間ウィンドウ設定 ──────────────────────────────────────
// 3日間ウィンドウ：エポックからの日数を3で割った商が同じ期間
const WINDOW_DAYS = 3

// 3日間ウィンドウで1回無料。以降は広告視聴で無制限利用可能。


// ── ストレージキー ────────────────────────────────────────────
const WINDOW_KEY = 'score_feature_window_usage'  // video / meal 用
const DAILY_KEY  = 'score_feature_daily_usage'   // ai_analysis / recovery / workout 用
const TOTAL_KEY  = 'score_feature_total_usage'   // csv 用
const BONUS_KEY  = 'score_feature_bonus'         // シェア/招待で獲得した無料枠

// シェアで獲得できる無料枠の1日上限（広告収益の過剰消費を防ぐ）
const SHARE_BONUS_DAILY_CAP: Partial<Record<Feature, number>> = { video: 1, meal: 2 }

// ── 書き込み直列化キュー ─────────────────────────────────────────
// AsyncStorageのread-modify-writeはアトミックではないため、連打や複数画面からの
// 同時呼び出しでカウントの取りこぼし/二重消費が起きうる。同一プロセス内の
// 書き込み系呼び出しをこのキューで直列化して競合を防ぐ。
let _writeQueue: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = _writeQueue.then(fn, fn)
  _writeQueue = run.then(() => undefined, () => undefined)
  return run
}

// ── 絶対上限（AI APIコスト超過防止）─────────────────────────────
// 無料プランの広告視聴による「実質無制限」、有料プランの「完全無制限」を悪用/暴走から守るため、
// tier に関係なく1日あたりの絶対上限を設ける。通常の利用ではまず到達しない値。
const HARD_DAILY_CAP: Partial<Record<Feature, number>> = {
  video: 8, meal: 10, ai_analysis: 5, recovery: 5, workout: 5,
}
const HARD_DAILY_KEY = 'score_feature_hard_daily_usage'

async function getHardDailyUsage(): Promise<{ date: string; counts: Partial<Record<Feature, number>> }> {
  try {
    const raw = await AsyncStorage.getItem(HARD_DAILY_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p.date === todayStr()) return p
    }
  } catch {}
  return { date: todayStr(), counts: {} }
}
async function saveHardDailyUsage(d: { date: string; counts: Partial<Record<Feature, number>> }) {
  await AsyncStorage.setItem(HARD_DAILY_KEY, JSON.stringify(d)).catch(() => {})
}

// ── 絶対上限（月間）─────────────────────────────────────────────
// 動画分析は1日あたりの上限だけでは月間の乱用（毎日上限まで使い続ける等）を防げないため、
// tier に関係なく月間の絶対上限も設ける（AI APIコスト超過防止）
const HARD_MONTHLY_CAP: Partial<Record<Feature, number>> = { video: 40 }
const HARD_MONTHLY_KEY = 'score_feature_hard_monthly_usage'

function currentMonthStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function getHardMonthlyUsage(): Promise<{ month: string; counts: Partial<Record<Feature, number>> }> {
  try {
    const raw = await AsyncStorage.getItem(HARD_MONTHLY_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p.month === currentMonthStr()) return p
    }
  } catch {}
  return { month: currentMonthStr(), counts: {} }
}
async function saveHardMonthlyUsage(d: { month: string; counts: Partial<Record<Feature, number>> }) {
  await AsyncStorage.setItem(HARD_MONTHLY_KEY, JSON.stringify(d)).catch(() => {})
}

// ── 3日間ウィンドウ番号 ───────────────────────────────────────
function currentWindow(): number {
  const daysSinceEpoch = Math.floor(Date.now() / (1000 * 60 * 60 * 24))
  return Math.floor(daysSinceEpoch / WINDOW_DAYS)
}

// ── 3日間ウィンドウストレージ ─────────────────────────────────
async function getWindowUsage(): Promise<{ window: number; counts: Partial<Record<Feature, number>> }> {
  try {
    const raw = await AsyncStorage.getItem(WINDOW_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p.window === currentWindow()) return p
    }
  } catch {}
  return { window: currentWindow(), counts: {} }
}
async function saveWindowUsage(d: { window: number; counts: Partial<Record<Feature, number>> }) {
  await AsyncStorage.setItem(WINDOW_KEY, JSON.stringify(d)).catch(() => {})
}

// ── 日次ストレージ ────────────────────────────────────────────
const todayStr = () => todayLocalISO()

async function getDailyUsage(): Promise<{ date: string; counts: Record<string, number> }> {
  try {
    const raw = await AsyncStorage.getItem(DAILY_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p.date === todayStr()) return p
    }
  } catch {}
  return { date: todayStr(), counts: {} }
}
async function saveDailyUsage(d: { date: string; counts: Record<string, number> }) {
  await AsyncStorage.setItem(DAILY_KEY, JSON.stringify(d)).catch(() => {})
}

// ── 累計ストレージ（CSV）─────────────────────────────────────
async function getTotalUsage(): Promise<Record<Feature, number>> {
  try {
    const raw = await AsyncStorage.getItem(TOTAL_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { ai_analysis: 0, video: 0, meal: 0, csv: 0, recovery: 0, workout: 0 }
}
async function saveTotalUsage(u: Record<Feature, number>) {
  await AsyncStorage.setItem(TOTAL_KEY, JSON.stringify(u)).catch(() => {})
}

// ── ボーナス無料枠（シェア/招待で獲得）────────────────────────
type BonusStore = { credits: Partial<Record<Feature, number>>; grantedDate: string; grantedToday: Partial<Record<Feature, number>> }

async function getBonusStore(): Promise<BonusStore> {
  try {
    const raw = await AsyncStorage.getItem(BONUS_KEY)
    if (raw) {
      const p: BonusStore = JSON.parse(raw)
      // 日付が変わっていたら「本日付与数」をリセット（クレジット残高は維持）
      if (p.grantedDate !== todayStr()) {
        return { credits: p.credits ?? {}, grantedDate: todayStr(), grantedToday: {} }
      }
      return { credits: p.credits ?? {}, grantedDate: p.grantedDate, grantedToday: p.grantedToday ?? {} }
    }
  } catch {}
  return { credits: {}, grantedDate: todayStr(), grantedToday: {} }
}
async function saveBonusStore(s: BonusStore) {
  await AsyncStorage.setItem(BONUS_KEY, JSON.stringify(s)).catch(() => {})
}

/** 現在のボーナス無料枠の残数 */
export async function getBonusCredits(feature: Feature): Promise<number> {
  const s = await getBonusStore()
  return s.credits[feature] ?? 0
}

/**
 * シェア（または招待）でボーナス無料枠を1回付与する。1日上限あり。
 * @returns { granted, atCap } granted=付与できたか, atCap=本日上限に達していたか
 */
export async function grantShareBonus(feature: Feature): Promise<{ granted: boolean; atCap: boolean; credits: number }> {
  return serialize(async () => {
    const cap = SHARE_BONUS_DAILY_CAP[feature] ?? 0
    const s = await getBonusStore()
    const today = s.grantedToday[feature] ?? 0
    if (cap <= 0 || today >= cap) {
      return { granted: false, atCap: true, credits: s.credits[feature] ?? 0 }
    }
    s.credits[feature]      = (s.credits[feature] ?? 0) + 1
    s.grantedToday[feature] = today + 1
    await saveBonusStore(s)
    return { granted: true, atCap: false, credits: s.credits[feature]! }
  })
}

/** ボーナス無料枠を1回消費する */
async function consumeBonus(feature: Feature): Promise<void> {
  const s = await getBonusStore()
  if ((s.credits[feature] ?? 0) > 0) {
    s.credits[feature] = (s.credits[feature] ?? 0) - 1
    await saveBonusStore(s)
  }
}

/** その機能が「広告なしの無料枠（通常の無料回数）」を今使えるか */
async function isFreeAvailable(feature: Feature): Promise<boolean> {
  if (feature === 'video' || feature === 'meal') {
    const w = await getWindowUsage()
    return (w.counts[feature] ?? 0) === 0
  }
  if (feature === 'csv') {
    const total = await getTotalUsage()
    return (total['csv'] ?? 0) === 0
  }
  const daily = await getDailyUsage()
  return (daily.counts[feature] ?? 0) === 0
}

// ── Tier 取得（PurchaseContext がキャッシュした検証済みプランを読む） ───────────────
export async function getTier(): Promise<'free' | 'noad' | 'coach'> {
  const { tier } = await readCachedTier()
  return tier
}

// ── メイン：利用可否チェック ──────────────────────────────────
export async function checkAdGate(feature: Feature): Promise<{
  allowed:     boolean
  remaining:   number      // 残り無料回数
  needsAd:     boolean
  hardLimited: boolean
  limitType:   'none' | 'daily' | 'monthly' | 'total' | 'window'
}> {
  // tier・広告視聴に関わらず適用される1日の絶対上限（コスト超過防止）
  const cap = HARD_DAILY_CAP[feature]
  if (cap !== undefined) {
    const hard = await getHardDailyUsage()
    if ((hard.counts[feature] ?? 0) >= cap) {
      return { allowed: false, remaining: 0, needsAd: false, hardLimited: true, limitType: 'daily' }
    }
  }
  // tier・広告視聴に関わらず適用される月間の絶対上限（毎日上限まで使い続ける形の乱用を防止）
  const monthlyCap = HARD_MONTHLY_CAP[feature]
  if (monthlyCap !== undefined) {
    const hardMonthly = await getHardMonthlyUsage()
    if ((hardMonthly.counts[feature] ?? 0) >= monthlyCap) {
      return { allowed: false, remaining: 0, needsAd: false, hardLimited: true, limitType: 'monthly' }
    }
  }
  // 有料プラン（広告なし/コーチ）は回数制限・広告視聴要求の対象外
  const tier = await getTier()
  if (tier !== 'free') {
    return { allowed: true, remaining: 999, needsAd: false, hardLimited: false, limitType: 'none' }
  }
  // ── 通常の判定（無料枠 or 広告） ───────────────────────────
  const normal = await computeNormalGate(feature)
  // 通常無料枠が無く広告が必要だが、シェア/招待のボーナス無料枠があるなら広告スキップ
  if (normal.needsAd) {
    const bonus = await getBonusCredits(feature)
    if (bonus > 0) {
      return { allowed: true, remaining: 0, needsAd: false, hardLimited: false, limitType: 'none' }
    }
  }
  return normal
}

async function computeNormalGate(feature: Feature): Promise<{
  allowed: boolean; remaining: number; needsAd: boolean; hardLimited: boolean
  limitType: 'none' | 'daily' | 'monthly' | 'total' | 'window'
}> {
  // ── video: 3日間1回無料 → 以降は広告視聴で無制限 ──────────
  if (feature === 'video') {
    const w = await getWindowUsage()
    const used = w.counts['video'] ?? 0
    if (used === 0) {
      return { allowed: true, remaining: 1, needsAd: false, hardLimited: false, limitType: 'window' }
    }
    return { allowed: false, remaining: 0, needsAd: true, hardLimited: false, limitType: 'window' }
  }

  // ── meal: 3日間1回無料 → 以降は広告視聴で無制限 ─────────
  if (feature === 'meal') {
    const w = await getWindowUsage()
    const used = w.counts['meal'] ?? 0
    if (used === 0) {
      return { allowed: true, remaining: 1, needsAd: false, hardLimited: false, limitType: 'window' }
    }
    return { allowed: false, remaining: 0, needsAd: true, hardLimited: false, limitType: 'window' }
  }

  // ── csv: 累計1回無料 → 以降ハードリミット ────────────────────
  if (feature === 'csv') {
    const total = await getTotalUsage()
    const used = total['csv'] ?? 0
    if (used === 0) {
      return { allowed: true, remaining: 1, needsAd: false, hardLimited: false, limitType: 'total' }
    }
    return { allowed: false, remaining: 0, needsAd: true, hardLimited: false, limitType: 'total' }
  }

  // ── ai_analysis / recovery / workout: 1日1回無料 → 以降は広告視聴で無制限 ──
  const daily = await getDailyUsage()
  const usedToday = daily.counts[feature] ?? 0
  if (usedToday === 0) {
    return { allowed: true, remaining: 1, needsAd: false, hardLimited: false, limitType: 'daily' }
  }
  return { allowed: false, remaining: 0, needsAd: true, hardLimited: false, limitType: 'daily' }
}

// ── 利用を記録 ─────────────────────────────────────────────────
export async function recordUsage(feature: Feature): Promise<void> {
  return serialize(async () => {
    // 絶対上限カウント（tier・経路に関わらず必ず加算）
    if (HARD_DAILY_CAP[feature] !== undefined) {
      const hard = await getHardDailyUsage()
      hard.counts[feature] = (hard.counts[feature] ?? 0) + 1
      await saveHardDailyUsage(hard)
    }
    if (HARD_MONTHLY_CAP[feature] !== undefined) {
      const hardMonthly = await getHardMonthlyUsage()
      hardMonthly.counts[feature] = (hardMonthly.counts[feature] ?? 0) + 1
      await saveHardMonthlyUsage(hardMonthly)
    }
    // 通常無料枠が無く、ボーナス枠で利用した場合はボーナスを消費して終了
    // （通常無料枠がある場合は下の通常カウントを優先消費＝ボーナスは温存）
    if (!(await isFreeAvailable(feature)) && (await getBonusCredits(feature)) > 0) {
      await consumeBonus(feature)
      return
    }
    if (feature === 'video' || feature === 'meal') {
      const w = await getWindowUsage()
      w.counts[feature] = (w.counts[feature] ?? 0) + 1
      await saveWindowUsage(w)
      return
    }
    if (feature === 'csv') {
      const total = await getTotalUsage()
      total['csv'] = (total['csv'] ?? 0) + 1
      await saveTotalUsage(total)
      return
    }
    // ai_analysis / recovery / workout: 日次
    const daily = await getDailyUsage()
    daily.counts[feature] = (daily.counts[feature] ?? 0) + 1
    await saveDailyUsage(daily)
  })
}

// ── 残り回数ラベル ────────────────────────────────────────────
export function remainingLabel(feature: Feature, remaining: number, _tier: string): string {
  if (feature === 'video') {
    if (remaining > 0) return `3日間で残り${remaining}回`
    return '3日間の上限に達しました'
  }
  if (feature === 'meal') {
    if (remaining > 0) return `3日間で残り${remaining}回`
    return '3日間の上限に達しました'
  }
  if (remaining > 0) return '今日残り1回'
  return '明日また使えます'
}

// ── 残り1回の警告が必要か ────────────────────────────────────
export function shouldWarn(remaining: number): boolean {
  return remaining === 1
}

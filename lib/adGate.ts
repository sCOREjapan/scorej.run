// lib/adGate.ts — 機能利用制限管理 v4.0（無料10枚チケット制に統一）
//
// AI機能はすべて共通のチケットプールを消費する（機能ごとの無料回数は廃止）。
// 無料ユーザーはオンボーディング時にチケット10枚が付与され（lib/ticketWallet.ts）、
// 使い切ったら以降は機能を使うたびにチケット購入・チケット月額プランへの導線が表示される。
//
// 機能               チケットコスト
// 動画分析           3枚
// AIメニュー作成      2枚
// AI食事分析          1枚
// AI食事コーチ        2枚
// AI練習分析コーチ    2枚
// AIリカバリー相談    無料（1日2回まで。怪我系機能のため2026-08開放。FREE_INJURY_FEATURES参照）
// 今日のAIアドバイス  1枚
// 練習ノートAI解析     1枚
// 大会プラン生成       3枚
// 復帰プラン生成       無料（1日2回まで。怪我系機能のため2026-08開放。FREE_INJURY_FEATURES参照）
// CSVエクスポート     累計1回無料 → 以降は課金プランのみ（AI機能ではないためチケット対象外）
//
// コーチプランは全機能チケット不要で無制限。
// 2026-08-06 より前から広告なしプランに加入していたユーザーは、全機能引き続き無制限
//（グランドファザリング。詳細は isLegacyUnlimitedNoad を参照）。
// 広告なしプラン（新規）・チケット月額プランはチケットの要不要に影響しない
// （広告なしプラン＝広告のみ非表示。チケット月額プラン＝チケット残高への定期補充）。

import AsyncStorage from '@react-native-async-storage/async-storage'
import { readCachedTier } from './subscriptionCache'
import { todayLocalISO } from './dateLocal'
import { getTicketBalance, spendTicketsForFeature, TICKET_COST, type TicketFeature } from './ticketWallet'
import type { PlanTier } from './purchaseService'
import { supabase } from './supabase'

// ── ログイン状態の判定（lib/ticketWallet.ts と同じ作法。ローカルキャッシュのセッションを
//    見るだけなのでネットワーク待ちは発生しない） ─────────────────────────
async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.user?.id ?? null
  } catch {
    return null
  }
}

// 2026-09-01: HARD_DAILY_CAP/HARD_MONTHLY_CAP（悪用/暴走防止の絶対上限）が
// 端末ローカル(AsyncStorage)にしかカウントされておらず、再インストールや別端末ログインで
// 際限なく回避できてしまう不具合があったため、ログイン中のユーザーはサーバー側
// (feature_usage_counts テーブル)でカウントする。ゲストは従来通りローカルのみ
// （supabase/fix_hard_cap_server_side.sql 参照）。
async function getServerUsageCount(userId: string, feature: string, periodKey: string): Promise<number> {
  const { data, error } = await supabase
    .from('feature_usage_counts')
    .select('count')
    .eq('user_id', userId).eq('feature', feature).eq('period_key', periodKey)
    .maybeSingle()
  if (error || !data) return 0
  return data.count
}
async function incrementServerUsageCount(feature: string, periodKey: string): Promise<void> {
  try {
    await supabase.rpc('increment_feature_usage', { p_feature: feature, p_period_key: periodKey })
  } catch {}
}

/**
 * feature_usage_counts を使った汎用の「1日あたり回数制限」チェック＋消費。
 * ログイン中のみサーバー側でカウント（ゲストは呼び出し元で個別に検討すること）。
 * 動画分析の「誤認識申告による払い戻し」など、TICKET_COSTのような固定機能表とは
 * 別に、乱用防止のためだけの緩い回数制限をかけたい箇所向け。
 */
export async function checkAndConsumeDailyAllowance(key: string, dailyCap: number): Promise<boolean> {
  const userId = await getCurrentUserId()
  if (!userId) return false // ゲストはサーバー側での本人確認手段が無いため許可しない
  const count = await getServerUsageCount(userId, key, todayStr())
  if (count >= dailyCap) return false
  await incrementServerUsageCount(key, todayStr())
  return true
}

export type Feature =
  | 'ai_analysis' | 'video' | 'meal' | 'csv' | 'recovery' | 'workout'
  | 'meal_coach' | 'daily_insight' | 'notebook_ai' | 'competition_plan' | 'injury_recovery'

// チケット制導入日：これより前に広告なしプランに加入していたユーザーは
// 全機能引き続き無制限にする（既存加入者の体験を変えないため）
const TICKET_SYSTEM_CUTOVER = new Date('2026-08-06T00:00:00.000Z')

// ── 書き込み直列化キュー ─────────────────────────────────────────
let _writeQueue: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = _writeQueue.then(fn, fn)
  _writeQueue = run.then(() => undefined, () => undefined)
  return run
}

// ── 怪我系機能は無料開放（チケット不要）。ただしAI APIコスト超過防止のため
// 1日2回までの上限のみ残す。上限の数値はUIには表示しない。 ────────────────
const FREE_INJURY_FEATURES: Feature[] = ['recovery', 'injury_recovery']
function isFreeInjuryFeature(feature: Feature): boolean {
  return FREE_INJURY_FEATURES.includes(feature)
}

// ── 絶対上限（AI APIコスト超過防止）─────────────────────────────
// tier・チケット残高に関係なく1日あたりの絶対上限を設ける（悪用/暴走防止）
const HARD_DAILY_CAP: Partial<Record<Feature, number>> = {
  video: 8, meal: 10, ai_analysis: 5, recovery: 2, workout: 5,
  meal_coach: 5, daily_insight: 3, notebook_ai: 10, competition_plan: 3, injury_recovery: 2,
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

const todayStr = () => todayLocalISO()

// ── CSV専用：累計1回無料のシンプルなフラグ（AI機能のチケットプールとは無関係） ──
const CSV_USED_KEY = 'score_csv_used_once'

// ── Tier 取得（PurchaseContext がキャッシュした検証済みプランを読む） ───────────────
export async function getTier(): Promise<PlanTier> {
  const { tier } = await readCachedTier()
  return tier
}

/**
 * 広告なしプランが「全機能無制限」だった旧仕様のまま使えるかどうか。
 * originalPurchaseDate がカットオーバー日より前ならグランドファザリング対象。
 * 日付が取得できない場合（プロモーション付与等）は、既存の有料ユーザーを不利にしないため
 * 無制限側に倒す（読み取れない＝free扱いにしていた過去の不具合と同じ理由で、疑わしきは既存課金者を保護）。
 */
async function isLegacyUnlimitedNoad(): Promise<boolean> {
  const { originalPurchaseDate } = await readCachedTier()
  if (!originalPurchaseDate) return true
  const d = new Date(originalPurchaseDate)
  if (isNaN(d.getTime())) return true
  return d < TICKET_SYSTEM_CUTOVER
}

/** この tier がこの機能を完全無制限で使えるか（チケット残高の判定を一切しない） */
async function isUnlimitedBypass(feature: Feature, tier: PlanTier): Promise<boolean> {
  if (tier === 'coach') return true
  if (feature === 'csv') {
    // csv は非AI機能。noad以上で無制限だが、tier='free'のままチケット月額プランのみ
    // 加入しているユーザーも同格（広告なし＋α）として扱う必要がある
    if (tier !== 'free') return true
    const { hasTicketMonthly } = await readCachedTier()
    return !!hasTicketMonthly
  }
  if (tier === 'noad') return isLegacyUnlimitedNoad()   // 新規noadは広告のみ・AI機能はチケット制。既存加入者のみグランドファザリング
  return false
}

function isTicketFeature(feature: Feature): feature is TicketFeature {
  return feature !== 'csv'
}

// ── メイン：利用可否チェック ──────────────────────────────────
export async function checkAdGate(feature: Feature): Promise<{
  allowed:       boolean
  remaining:     number      // 非チケット機能(csv)の残り無料回数。チケット機能では常に0（チケット残高は ticketBalance を参照）
  needsAd:       boolean     // 常に false（広告視聴による解除機能は廃止済み）
  needsTicket:   boolean
  ticketCost:    number
  ticketBalance: number
  hardLimited:   boolean
  limitType:     'none' | 'daily' | 'monthly' | 'total' | 'window'
}> {
  // tier・チケット残高に関わらず適用される1日の絶対上限（コスト超過防止）。
  // ログイン中はサーバー側カウントを見る（再インストールで回避できないようにするため）
  const userId = await getCurrentUserId()
  const cap = HARD_DAILY_CAP[feature]
  if (cap !== undefined) {
    const count = userId
      ? await getServerUsageCount(userId, feature, todayStr())
      : (await getHardDailyUsage()).counts[feature] ?? 0
    if (count >= cap) {
      return { allowed: false, remaining: 0, needsAd: false, needsTicket: false, ticketCost: 0, ticketBalance: 0, hardLimited: true, limitType: 'daily' }
    }
  }
  const monthlyCap = HARD_MONTHLY_CAP[feature]
  if (monthlyCap !== undefined) {
    const count = userId
      ? await getServerUsageCount(userId, feature, currentMonthStr())
      : (await getHardMonthlyUsage()).counts[feature] ?? 0
    if (count >= monthlyCap) {
      return { allowed: false, remaining: 0, needsAd: false, needsTicket: false, ticketCost: 0, ticketBalance: 0, hardLimited: true, limitType: 'monthly' }
    }
  }

  const tier = await getTier()
  if (await isUnlimitedBypass(feature, tier)) {
    return { allowed: true, remaining: 999, needsAd: false, needsTicket: false, ticketCost: 0, ticketBalance: 0, hardLimited: false, limitType: 'none' }
  }

  // ── 怪我系機能：チケット不要で無料開放（1日2回の絶対上限は上のHARD_DAILY_CAPで既にチェック済み） ──
  if (isFreeInjuryFeature(feature)) {
    return { allowed: true, remaining: 999, needsAd: false, needsTicket: false, ticketCost: 0, ticketBalance: 0, hardLimited: false, limitType: 'none' }
  }

  // ── チケット対象機能（csv以外の全AI機能）：無料枠の概念はなく、常にチケット残高で判定 ──
  if (isTicketFeature(feature)) {
    const cost = TICKET_COST[feature]
    const balance = await getTicketBalance()
    return {
      allowed:       balance >= cost,
      remaining:     0,
      needsAd:       false,
      needsTicket:   true,
      ticketCost:    cost,
      ticketBalance: balance,
      hardLimited:   false,
      limitType:     'total',
    }
  }

  // ── csv: 累計1回無料 → 以降は課金プランのみ（非AI機能・チケット対象外） ─────
  const used = await AsyncStorage.getItem(CSV_USED_KEY).catch(() => null)
  if (!used) {
    return { allowed: true, remaining: 1, needsAd: false, needsTicket: false, ticketCost: 0, ticketBalance: 0, hardLimited: false, limitType: 'total' }
  }
  return { allowed: false, remaining: 0, needsAd: false, needsTicket: false, ticketCost: 0, ticketBalance: 0, hardLimited: true, limitType: 'total' }
}

// ── 利用を記録 ─────────────────────────────────────────────────
export async function recordUsage(feature: Feature): Promise<void> {
  return serialize(async () => {
    // 絶対上限カウント（tier・経路に関わらず必ず加算）。
    // ログイン中はサーバー側でカウントする（checkAdGateと同じ判定基準に揃える）
    const userId = await getCurrentUserId()
    if (HARD_DAILY_CAP[feature] !== undefined) {
      if (userId) {
        await incrementServerUsageCount(feature, todayStr())
      } else {
        const hard = await getHardDailyUsage()
        hard.counts[feature] = (hard.counts[feature] ?? 0) + 1
        await saveHardDailyUsage(hard)
      }
    }
    if (HARD_MONTHLY_CAP[feature] !== undefined) {
      if (userId) {
        await incrementServerUsageCount(feature, currentMonthStr())
      } else {
        const hardMonthly = await getHardMonthlyUsage()
        hardMonthly.counts[feature] = (hardMonthly.counts[feature] ?? 0) + 1
        await saveHardMonthlyUsage(hardMonthly)
      }
    }

    const tier = await getTier()
    if (await isUnlimitedBypass(feature, tier)) return   // 無制限プラン/グランドファザリング対象は記録不要
    if (isFreeInjuryFeature(feature)) return              // 怪我系は無料開放のためチケット消費なし

    if (isTicketFeature(feature)) {
      await spendTicketsForFeature(feature)
      return
    }

    // csv
    await AsyncStorage.setItem(CSV_USED_KEY, '1').catch(() => {})
  })
}

// ── 残り回数ラベル（csv専用。チケット機能はチケット残高表示に置き換え済み） ──
export function remainingLabel(feature: Feature, remaining: number, _tier: string): string {
  if (remaining > 0) return `無料で残り${remaining}回`
  return '無料枠を使い切りました'
}

// ── 残り1回の警告が必要か ────────────────────────────────────
export function shouldWarn(remaining: number): boolean {
  return remaining === 1
}

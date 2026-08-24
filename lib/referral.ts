// lib/referral.ts — 友達紹介チャレンジ（紹介コード発行・受け取り・チケット付与）
// 不正防止(自己紹介禁止・1アカウント生涯1回まで・登録48時間以内のみ)は
// すべて supabase/add_referral_challenge.sql 側のDB制約・RLSで担保する。
// このファイルはinsertを試みて成否をハンドリングするだけで、判定ロジックは持たない。
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { resolveAppUserId } from './cloudSync'
import { grantTickets } from './ticketWallet'

const CLAIMED_KEY = 'score_referral_claimed_ids'
const GRANTED_MONTHLY_KEY = 'score_referral_granted_by_month'
export const REFERRAL_BONUS_TICKETS = 5
/** 紹介した側が報酬を受け取れる人数の上限（暦月ごと。超えた分の紹介は成立するが報酬は付与されない） */
export const REFERRAL_MONTHLY_CAP = 5

function monthKey(iso: string): string {
  return iso.slice(0, 7) // "2026-08"
}

function generateCode(): string {
  return Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6).padEnd(6, '0')
}

async function getMyUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  const authId = data.session?.user?.id
  if (!authId) return null
  return resolveAppUserId(authId)
}

/** 自分の紹介コードを取得する（無ければサーバー側で発行して返す） */
export async function getMyReferralCode(): Promise<string | null> {
  const userId = await getMyUserId()
  if (!userId) return null

  const { data: existing } = await supabase
    .from('referral_codes').select('code').eq('referrer_user_id', userId).maybeSingle()
  if (existing?.code) return existing.code

  // 衝突（同じコードが既に他ユーザーに割り当て済み）時は別コードで最大5回まで再試行
  for (let i = 0; i < 5; i++) {
    const code = generateCode()
    const { error } = await supabase.from('referral_codes').insert({ code, referrer_user_id: userId })
    if (!error) return code
    // 自分の分がすでに(別リクエスト等で)作られていないか確認してから再試行
    const { data: race } = await supabase
      .from('referral_codes').select('code').eq('referrer_user_id', userId).maybeSingle()
    if (race?.code) return race.code
  }
  return null
}

export type RedeemResult = 'granted' | 'invalid_code' | 'self_code' | 'already_used' | 'rejected' | 'not_logged_in'

/** 友達の紹介コードを入力してチケットを受け取る */
export async function redeemReferralCode(rawCode: string): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase()
  if (code.length !== 6) return 'invalid_code'
  const userId = await getMyUserId()
  if (!userId) return 'not_logged_in'

  const { data: codeRow } = await supabase
    .from('referral_codes').select('referrer_user_id').eq('code', code).maybeSingle()
  if (!codeRow) return 'invalid_code'
  if (codeRow.referrer_user_id === userId) return 'self_code'

  const { error } = await supabase.from('referral_redemptions').insert({
    code, referrer_user_id: codeRow.referrer_user_id, redeemer_user_id: userId,
  })
  if (error) {
    // unique制約違反(23505) = このアカウントは既に紹介報酬を受け取り済み
    if (error.code === '23505') return 'already_used'
    // それ以外はRLSで弾かれた(登録から48時間経過等)
    return 'rejected'
  }
  await grantTickets(REFERRAL_BONUS_TICKETS)
  return 'granted'
}

/**
 * 自分が紹介者として得た未反映の報酬をチェックしてチケット付与する（画面表示時に呼ぶ）。
 * 紹介成立自体（redeemer側の報酬）は無制限に記録されるが、referrer側が報酬を
 * 受け取れるのは暦月ごとに REFERRAL_MONTHLY_CAP 人までに制限する。
 * 上限超過分は「成立はしたが報酬なし」として処理済み扱いにする（次回以降も再付与しない）。
 */
export async function claimReferralRewards(): Promise<number> {
  const userId = await getMyUserId()
  if (!userId) return 0

  const { data: rows } = await supabase
    .from('referral_redemptions').select('id, created_at').eq('referrer_user_id', userId)
  if (!rows || rows.length === 0) return 0

  const [claimedRaw, grantedRaw] = await Promise.all([
    AsyncStorage.getItem(CLAIMED_KEY).catch(() => null),
    AsyncStorage.getItem(GRANTED_MONTHLY_KEY).catch(() => null),
  ])
  const claimed: string[] = claimedRaw ? JSON.parse(claimedRaw) : []
  const claimedSet = new Set(claimed)
  const grantedByMonth: Record<string, number> = grantedRaw ? JSON.parse(grantedRaw) : {}

  const unclaimed = rows
    .filter(r => !claimedSet.has(r.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at)) // 早い者勝ちで枠を消費する

  if (unclaimed.length === 0) return 0

  let grantedCount = 0
  for (const r of unclaimed) {
    const key = monthKey(r.created_at)
    const usedThisMonth = grantedByMonth[key] ?? 0
    if (usedThisMonth < REFERRAL_MONTHLY_CAP) {
      grantedByMonth[key] = usedThisMonth + 1
      grantedCount++
    }
    // 上限超過分も claimed には積む（毎回このループを回さないようにするため）
  }

  if (grantedCount > 0) await grantTickets(REFERRAL_BONUS_TICKETS * grantedCount)
  await Promise.all([
    AsyncStorage.setItem(CLAIMED_KEY, JSON.stringify([...claimed, ...unclaimed.map(r => r.id)])).catch(() => {}),
    AsyncStorage.setItem(GRANTED_MONTHLY_KEY, JSON.stringify(grantedByMonth)).catch(() => {}),
  ])
  return grantedCount
}

/** 紹介実績（紹介した人数）を表示用に取得する */
export async function getReferralCount(): Promise<number> {
  const userId = await getMyUserId()
  if (!userId) return 0
  const { count } = await supabase
    .from('referral_redemptions').select('id', { count: 'exact', head: true }).eq('referrer_user_id', userId)
  return count ?? 0
}

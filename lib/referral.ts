// lib/referral.ts — 友達紹介チャレンジ（紹介コード発行・受け取り・チケット付与）
// 不正防止(自己紹介禁止・1アカウント生涯1回まで・登録48時間以内のみ)は
// すべて supabase/add_referral_challenge.sql 側のDB制約・RLSで担保する。
// このファイルはinsertを試みて成否をハンドリングするだけで、判定ロジックは持たない。
import { supabase } from './supabase'
import { resolveAppUserId } from './cloudSync'
import { grantTickets } from './ticketWallet'

export const REFERRAL_BONUS_TICKETS = 5
/** 紹介した側が報酬を受け取れる人数の上限（暦月ごと。超えた分の紹介は成立するが報酬は付与されない）。
 * 実際の上限判定は supabase/fix_referral_reward_tracking.sql の claim_referral_rewards() 内で
 * サーバー側に行うため、この定数の値を変える場合はSQL側の定数(5)も合わせて変更すること。 */
export const REFERRAL_MONTHLY_CAP = 5

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

  // 2026-09-01: 受け取り済み判定を端末ローカル(AsyncStorage)からサーバー側RPCに移行。
  // 以前は再インストール・別端末ログインでローカルの「受け取り済み」記録が消え、
  // 同じ紹介報酬を無限に再受け取りできてしまう不具合があった
  // （supabase/fix_referral_reward_tracking.sql 参照）。
  const { data, error } = await supabase.rpc('claim_referral_rewards')
  if (error || typeof data !== 'number') return 0
  return data
}

/** 紹介実績（紹介した人数）を表示用に取得する */
export async function getReferralCount(): Promise<number> {
  const userId = await getMyUserId()
  if (!userId) return 0
  const { count } = await supabase
    .from('referral_redemptions').select('id', { count: 'exact', head: true }).eq('referrer_user_id', userId)
  return count ?? 0
}

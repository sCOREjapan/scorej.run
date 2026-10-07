// lib/ticketWallet.ts — チケット残高・月額付与・ストリークボーナス管理
//
// チケット: AI機能すべてを消費する唯一の通貨（無料10枚→単発パック→チケット月額プランで補充）。
// チケット月額プラン: 更新のたびに100枚を自動付与する（lib/purchaseService の ticket_monthly エンタイトルメント）。
// ストリーク: 連続起動日数に応じたボーナス付与（3日=チケット+1 / 7日=チケット+2 / 30日=チケット+5）。
//
// ログイン済みユーザーは Supabase の ticket_wallets テーブルを唯一の真実（source of truth）とする。
// 以前は全てAsyncStorage（端末ローカル）のみで管理しており、別端末で開く・再インストールする
// だけで「まだ付与していない」と誤判定され、月額100枚などが何度でも再付与できてしまう
// 不具合があった（2026-08-26に実際に発生）。ゲスト（未ログイン）はサーバー側の本人確認手段が
// 無いため、従来通り端末ローカルのみで動作する（悪用余地は残るが、アカウントが無い以上
// サーバー側で防ぎようがないため許容する）。
import AsyncStorage from '@react-native-async-storage/async-storage'
import { todayLocalISO } from './dateLocal'
import { TICKET_MONTHLY_GRANT } from './purchaseService'
import { supabase } from './supabase'

const WALLET_KEY           = 'score_ticket_wallet'
const STREAK_KEY           = 'score_ticket_streak'
const STARTER_KEY          = 'score_ticket_starter_granted'
const SHARE_BONUS_KEY      = 'score_ticket_share_bonus_daily'
const MONTHLY_GRANT_KEY    = 'score_ticket_monthly_last_granted'   // 直近で付与済みの更新期日(ticketMonthlyExpiresAt)
const MONTHLY_TRIAL_DAILY_KEY = 'score_ticket_monthly_trial_daily_last_granted'  // トライアル中の直近付与マーカー(期日+日付)
const MISSION_PROFILE_KEY  = 'score_ticket_mission_profile'
const MISSION_LINE_KEY     = 'score_ticket_mission_line'
const MISSION_GOAL_KEY     = 'score_ticket_mission_goal'
const MISSION_DAY1_KEY     = 'score_ticket_mission_day1'
const MISSION_DAY2_KEY     = 'score_ticket_mission_day2'

// 2026-09-03: APIコスト(600円/日)が広告収益(500円/日)を上回り赤字だったため、
// 無料付与量を見直し（10→5枚、ミッション5→3枚）。既存ユーザーの体験は変えず、
// 新規ユーザーの無料枠を圧縮する方針。
const STARTER_TICKETS = 5   // オンボーディング完了時に1回だけ付与する初期チケット
const MISSION_BONUS   = 3   // 各ワンタイムミッション（プロフィール完成/LINE参加/目標設定）の付与枚数

// AIを使う機能はすべてチケット制
export type TicketFeature =
  | 'video' | 'workout' | 'meal' | 'ai_analysis' | 'recovery'
  | 'meal_coach' | 'daily_insight' | 'notebook_ai' | 'competition_plan' | 'injury_recovery'
  | 'scoppy_chat'
export const TICKET_COST: Record<TicketFeature, number> = {
  // 2026-09-03: 動画分析・AI診断・食事コーチは1回あたりのAPIコストが高いため増額(2→3枚)
  // 2026-09-09: 出力トークン量あたりの価格を機能間で見直し。
  //   meal: 画像1枚を送信するがnotebook_ai等のテキスト専用機能と同額(1枚)だったため2枚に増額
  //   daily_insight: max_tokens=1400と出力量が多い割に1枚のままで、800トークンのworkout(2枚)
  //   より割安になっていたため2枚に増額
  //   video: フレーム数を8→6枚に削減し1回あたりの画像トークンが約25%減ったため3→2枚に減額
  // 変更する場合は api/analyze.ts の TICKET_COST_SERVER も必ず同時に更新すること
  // （片方だけ更新すると「APIコストだけ発生してチケットは減らない」不具合の原因になる）
  video: 2, workout: 2, meal: 2,
  ai_analysis: 3, recovery: 1, meal_coach: 3, daily_insight: 2,
  notebook_ai: 1, competition_plan: 3, injury_recovery: 3,
  // 2026-09-13: スコッピーとの会話機能。max_tokens=400・画像なしのテキストのみで
  // notebook_ai(1枚)と同等のコストのため同額にした
  scoppy_chat: 1,
}

type Wallet = { tickets: number }

// ── 書き込み直列化（adGate.ts と同じ作法。read-modify-writeの競合を防ぐ。ゲスト経路のみで使用） ──
let _writeQueue: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = _writeQueue.then(fn, fn)
  _writeQueue = run.then(() => undefined, () => undefined)
  return run
}

// ── ログイン状態の判定 ─────────────────────────────────────────
// getSession() はローカルにキャッシュされたセッションを見るだけなのでネットワーク待ちが発生しない
async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.user?.id ?? null
  } catch {
    return null
  }
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

// サーバーへのローカル残高引き継ぎは「一度だけ」しか行ってはいけない操作。
// 以前はサーバー呼び出しが失敗するたびに grantTickets(local.tickets) を呼んでいたが、
// grantTickets() 自体もサーバー失敗時にローカルへフォールバックして「w.tickets += count」
// する作りだったため、local.tickets を自分自身に足す形になり、呼ばれるたびに残高が
// 倍々に増えていく重大な不具合になっていた（2026-08-27に実機で発生・数値が天文学的になった）。
const MIGRATED_KEY = 'score_ticket_server_migrated'

// ── 付与の保留キュー ────────────────────────────────────────
// 2026-10-07: ログイン中にサーバーへの付与(ticket_wallet_grant)が失敗した時、以前は端末ローカルの
// 残高に足していた。しかしログイン中のユーザーはサーバー残高しか参照しないため、そのチケットは
// 二度と表示も消費もされず消えていた(課金した購入分・広告報酬・払い戻し・紹介報酬すべて)。
// 失敗した付与は「保留」として端末に記録し、次にサーバーへ到達できた時に必ず送り直す。
// 別アカウントに誤って付与されないよう、保留はユーザーIDごとに持つ。
const PENDING_GRANTS_KEY = 'score_ticket_pending_grants'
type PendingGrant = { userId: string; amount: number }
let _pendingQueue: Promise<unknown> = Promise.resolve()
function serializePending<T>(fn: () => Promise<T>): Promise<T> {
  const run = _pendingQueue.then(fn, fn)
  _pendingQueue = run.then(() => undefined, () => undefined)
  return run
}
async function readPendingGrants(): Promise<PendingGrant[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_GRANTS_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        return arr.filter((g: any) => g && typeof g.userId === 'string' && typeof g.amount === 'number' && g.amount > 0)
      }
    }
  } catch {}
  return []
}
async function writePendingGrants(list: PendingGrant[]) {
  await AsyncStorage.setItem(PENDING_GRANTS_KEY, JSON.stringify(list)).catch(() => {})
}
function enqueuePendingGrant(userId: string, amount: number): Promise<void> {
  return serializePending(async () => {
    const list = await readPendingGrants()
    list.push({ userId, amount })
    await writePendingGrants(list)
  })
}
/** 保留中の付与をサーバーへ送り直す。残高を読む前に呼ぶ（失敗したら次回に持ち越し） */
export async function flushPendingGrants(): Promise<void> {
  const userId = await getCurrentUserId()
  if (!userId) return
  await serializePending(async () => {
    const list = await readPendingGrants()
    if (!list.some(g => g.userId === userId)) return
    const remaining: PendingGrant[] = []
    let blocked = false
    for (const g of list) {
      if (g.userId !== userId || blocked) { remaining.push(g); continue }
      const { data, error } = await supabase.rpc('ticket_wallet_grant', { p_amount: g.amount })
      if (error || typeof data !== 'number') { blocked = true; remaining.push(g) }
    }
    await writePendingGrants(remaining)
  })
}
async function getPendingTotal(userId: string): Promise<number> {
  return (await readPendingGrants()).filter(g => g.userId === userId).reduce((a, g) => a + g.amount, 0)
}

export async function getWalletSnapshot(): Promise<Wallet> {
  const userId = await getCurrentUserId()
  if (userId) {
    await flushPendingGrants().catch(() => {})
    const { data, error } = await supabase.from('ticket_wallets').select('tickets').eq('user_id', userId).maybeSingle()
    if (error) {
      // サーバーに到達できない時は、残高を勝手に増減させず直近のローカルキャッシュ値を
      // そのまま返すだけにする（ここで何かを足す処理は絶対に入れない）
      return getWallet()
    }
    // まだ送れていない保留分は、実際にはもう持っているものとして表示に含める
    if (data) return { tickets: data.tickets + await getPendingTotal(userId) }

    // サーバー側にまだ行が無い＝このアカウントでまだ一度もサーバー同期していない端末。
    // 端末ローカルの残高を「1回だけ」引き継ぐ（フラグで二重引き継ぎを防止し、
    // 通常のgrantTickets()は経由しない＝ローカルへの二重加算経路に入らせない）。
    // serialize()で直列化し、同一セッション内で複数箇所から同時に呼ばれても
    // 移行処理が二重に走らないようにする（フラグの読み書き自体に競合の隙間があるため）
    return serialize(async () => {
      const alreadyMigrated = await AsyncStorage.getItem(MIGRATED_KEY)
      if (alreadyMigrated) return { tickets: await getPendingTotal(userId) }
      const local = await getWallet()
      // 過去の不具合で端末側の残高が異常な値まで壊れているケースに備え、
      // 現実的にあり得る上限を超える値はサーバーに引き継がず破棄する（安全弁）
      const LOCAL_SANITY_CAP = 100000
      if (local.tickets > 0 && local.tickets <= LOCAL_SANITY_CAP) {
        const { data: granted, error: grantErr } = await supabase.rpc('ticket_wallet_grant', { p_amount: local.tickets })
        // 2026-10-07: 以前は引き継ぎの「前」に完了フラグを立てていたため、通信失敗で引き継ぎに
        // 失敗するとフラグだけ残り、端末のチケットが二度と引き継がれず消えていた。
        // 成功した時だけフラグを立てる（失敗時は次回また試す）。
        if (grantErr || typeof granted !== 'number') return { tickets: await getPendingTotal(userId) }
        await AsyncStorage.setItem(MIGRATED_KEY, '1').catch(() => {})
        return { tickets: granted + await getPendingTotal(userId) }
      }
      await AsyncStorage.setItem(MIGRATED_KEY, '1').catch(() => {})
      return { tickets: await getPendingTotal(userId) }
    })
  }
  return getWallet()
}
export async function getTicketBalance(): Promise<number> {
  return (await getWalletSnapshot()).tickets
}

// 2026-10-07: serialize() は入れ子で呼ぶとデッドロックする（内側が外側の完了を待ち、外側は内側を待つ）。
// 以前は earnTicketFromAd / checkInStreak が serialize の中から grantTickets() を呼び、ゲスト
// (または付与RPC失敗時)に広告報酬・ストリークボーナスの付与が永久に終わらず、以降のローカル
// チケット処理もすべて止まっていた。既に serialize の中にいる呼び出し元は locked=true で呼ぶ。
async function grantTicketsImpl(count: number, locked: boolean): Promise<number> {
  const userId = await getCurrentUserId()
  if (userId) {
    const { data, error } = await supabase.rpc('ticket_wallet_grant', { p_amount: count })
    if (!error && typeof data === 'number') return data
    // サーバーに付与できなかった: ローカルへは足さず（ログイン中は参照されない）、保留として必ず送り直す
    await enqueuePendingGrant(userId, count)
    const w = await getWallet()
    return w.tickets + await getPendingTotal(userId)
  }
  const addLocal = async () => {
    const w = await getWallet()
    w.tickets += count
    await saveWallet(w)
    return w.tickets
  }
  return locked ? addLocal() : serialize(addLocal)
}

/** チケットを付与する（IAP購入・ストリークボーナス・広告視聴共通） */
export async function grantTickets(count: number): Promise<number> {
  return grantTicketsImpl(count, false)
}

/** キー付き重複防止の付与。ログイン中はサーバーの ticket_wallet_grant_once で判定する */
async function grantOnceGeneric(
  amount: number,
  markerName: string,
  markerValue: string,
  localKey: string,
): Promise<boolean> {
  const userId = await getCurrentUserId()
  if (userId) {
    const { data, error } = await supabase.rpc('ticket_wallet_grant_once', {
      p_amount: amount, p_marker_name: markerName, p_marker_value: markerValue,
    })
    if (!error) return !!data
    // 2026-10-07: ログイン中にサーバー判定が失敗した時、ローカルへ付与すると（ログイン中は参照されないため）
    // チケットが消える上に「付与済み」の印だけ残る。付与せず false を返し、次の機会に再判定させる。
    return false
  }
  return serialize(async () => {
    const last = await AsyncStorage.getItem(localKey).catch(() => null)
    if (last === markerValue) return false
    const w = await getWallet()
    w.tickets += amount
    await saveWallet(w)
    await AsyncStorage.setItem(localKey, markerValue).catch(() => {})
    return true
  })
}

// 2026-09-11: 呼び出し元(app/onboarding.tsx)を撤去した。3日間ミッション(lib/missionStore.ts)の
// Day1報酬(🎫5枚)が実質的な後継のため、両方呼ぶと初日に二重付与(5+5枚)になってしまう。
// 関数自体は元に戻す時のために残してある。
/** オンボーディング完了時に1回だけ初期チケットを付与する（2回目以降は何もしない） */
export async function grantStarterTicketsIfNeeded(): Promise<void> {
  await grantOnceGeneric(STARTER_TICKETS, 'starter', '1', STARTER_KEY)
}

/** シェアカード投稿でチケット1枚を付与（1日1回まで） */
export async function grantShareBonusTicket(): Promise<{ granted: boolean; atCap: boolean }> {
  const today = todayLocalISO()
  const granted = await grantOnceGeneric(1, 'share_bonus', today, SHARE_BONUS_KEY)
  return { granted, atCap: !granted }
}

/** プロフィール（種目・自己ベスト等）を初めて完成させたらチケットを1回だけ付与する */
export async function grantProfileCompleteBonusIfNeeded(): Promise<{ granted: boolean }> {
  const granted = await grantOnceGeneric(MISSION_BONUS, 'mission_profile', '1', MISSION_PROFILE_KEY)
  return { granted }
}

/** LINEオープンチャットへの参加ボタンを押したらチケットを1回だけ付与する（自己申告） */
export async function grantLineJoinBonusIfNeeded(): Promise<{ granted: boolean }> {
  const granted = await grantOnceGeneric(MISSION_BONUS, 'mission_line', '1', MISSION_LINE_KEY)
  return { granted }
}

/** 初めて目標を設定したらチケットを1回だけ付与する */
export async function grantFirstGoalBonusIfNeeded(): Promise<{ granted: boolean }> {
  const granted = await grantOnceGeneric(MISSION_BONUS, 'mission_goal', '1', MISSION_GOAL_KEY)
  return { granted }
}

// 2026-09-11: 3日間アクティベーションミッション(lib/missionStore.ts)のDay1/Day2報酬。
// マーカーはミッション開始日(startDate)込みにして、ミッションが再スタートしても
// （原則しない設計だが将来のリセット機能を見越して）同じstartDateに対しては
// 1回しか付与しないようにする。
export async function grantMissionDay1BonusIfNeeded(startDate: string): Promise<{ granted: boolean }> {
  const granted = await grantOnceGeneric(5, 'mission_day1', startDate, MISSION_DAY1_KEY)
  return { granted }
}
export async function grantMissionDay2BonusIfNeeded(startDate: string): Promise<{ granted: boolean }> {
  const granted = await grantOnceGeneric(2, 'mission_day2', startDate, MISSION_DAY2_KEY)
  return { granted }
}

/** チケットを消費する。残高不足なら何もせず false を返す */
export async function spendTickets(count: number): Promise<boolean> {
  const userId = await getCurrentUserId()
  if (userId) {
    const { data, error } = await supabase.rpc('ticket_wallet_spend', { p_amount: count })
    if (!error) return !!data
  }
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
// 1日の上限カウント自体は（乱用されても影響が小さいため）端末ローカルのままとするが、
// 実際に加算されるチケット残高は grantTickets() 経由でログイン中はサーバーに反映される。
// 2026-09-07: 旧上限10枚は「広告収益よりAPIコストの方が高い」問題を悪化させる方向
// だったため5枚に引き下げていたが、2026-09-09に10枚へ戻すことになった。
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
  // 上限カウントの更新と付与だけを直列化し、残高の読み取り(内部でもserializeを使う)は外で行う
  const { granted, atCap } = await serialize(async () => {
    const daily = await getAdTicketDaily()
    if (daily.count >= AD_TICKET_DAILY_CAP) return { granted: false, atCap: true }
    daily.count += 1
    await saveAdTicketDaily(daily)
    await grantTicketsImpl(1, true)
    return { granted: true, atCap: false }
  })
  const tickets = await getTicketBalance()
  return { granted, atCap, tickets }
}

// ── チケット月額プラン：更新のたびに100枚を自動付与 ───────────────
// 2026-09-05: 無料トライアル中は periodType='TRIAL' のエンタイトルメントが即座に
// active になるため、これまでの実装だとトライアル開始した瞬間に100枚を丸ごと
// 付与してしまっていた。決済が発生する前にキャンセルされると、ノーコストで
// 100枚だけ持ち逃げできる抜け穴になるため、トライアル中は「1日ごとに少量ずつ」
// 付与する方式に変更する（本付与100枚は、実際に課金される本番期間に入って
// 初めて行う＝その時点で periodExpiresAt がトライアルのものから変わるため、
// 下の通常分岐が自然に発火する）。
const TICKET_MONTHLY_TRIAL_DAILY_GRANT = 5   // トライアル中に1日あたり付与する枚数

/**
 * チケット月額プランが有効なとき、更新期日(periodExpiresAt)が前回付与時と変わっていれば
 * 100枚を追加付与する（残高リセットではなく加算——単発パックで買い足した分を消さないため）。
 * 同じ期日内での複数回呼び出しは何もしない（起動のたびに呼んでも安全）。
 * ログイン中はサーバー側の重複防止マーカーを見るため、別端末・再インストールでも
 * 二重付与されない。
 *
 * isTrial=true（無料トライアル中）の場合は、本付与の代わりに1日1回だけ
 * TICKET_MONTHLY_TRIAL_DAILY_GRANT 枚を付与する（マーカーを期日+当日日付にすることで
 * 同じ日の二重付与を防ぎつつ、日をまたぐたびに再度呼び出し可能にする）。
 */
export async function grantMonthlyTicketsIfNeeded(periodExpiresAt: string | undefined, isTrial?: boolean): Promise<boolean> {
  if (!periodExpiresAt) return false
  if (isTrial) {
    const dailyMarker = `${periodExpiresAt}:${todayLocalISO()}`
    return grantOnceGeneric(TICKET_MONTHLY_TRIAL_DAILY_GRANT, 'monthly_grant_trial_daily', dailyMarker, MONTHLY_TRIAL_DAILY_KEY)
  }
  return grantOnceGeneric(TICKET_MONTHLY_GRANT, 'monthly_grant', periodExpiresAt, MONTHLY_GRANT_KEY)
}

// ── ストリークボーナス（連続起動日数） ───────────────────────────
// 連続日数のカウント自体は端末ローカルのままとするが（複数端末を行き来する使い方は
// 想定外のため）、加算されるチケットは grantTickets() 経由でログイン中はサーバーに反映される。
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
      const amount = streak === 30 ? 5 : streak === 7 ? 2 : 1
      await grantTicketsImpl(amount, true)
      bonus = { amount }
      s.lastBonusStreak = streak
    }
    await saveStreakStore(s)
    return { streak, bonus }
  })
}

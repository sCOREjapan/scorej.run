// lib/cloudSync.ts — AsyncStorage ↔ Supabase 双方向同期
//
// 戦略：
//   1. ログイン時に syncAll(userId) を呼ぶ
//   2. クラウド優先でマージ（クラウドにあるIDは上書き、ローカル専用は追加）
//   3. 各 save 後に saveItem() を呼べばリアルタイム同期も可
//
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { getConditionMap, updateConditionMap } from './conditionStore'
import { getSessions, updateSessions } from './sessionsStore'
import { getSleepRecords, updateSleepRecords } from './sleepStore'
import { getWeights, updateWeights } from './weightStore'
import { createStorageQueue } from './storageQueue'

// ── ストレージキー ↔ Supabase テーブル のマッピング ─────────────────────────
// 注意: race_records / calendar_events / workout_menus は supabase/schema.sql に
// テーブル定義が見当たらない（実DBの状態は未確認）。存在しない場合は
// syncTable() が select エラーを検知して早期returnするだけで、アプリには
// 影響しない。sleep_records / meals は schema.sql 上に定義があり、
// フィールド構成もローカルの型と一致することを確認済み。
const SYNC_MAP = [
  { key: 'trackmate_race_records',    table: 'race_records'      },
  { key: 'trackmate_sessions',        table: 'training_sessions' },
  { key: 'trackmate_competitions',    table: 'competition_plans' },
  { key: 'trackmate_calendar_events', table: 'calendar_events'   },
  { key: 'trackmate_workout_menus',   table: 'workout_menus'     },
  { key: 'trackmate_sleep',           table: 'sleep_records', toCloud: sleepToCloud },
  { key: 'trackmate_meals',           table: 'meals'              },
  { key: 'trackmate_weight',          table: 'weights'            },
] as const

type SyncTable = typeof SYNC_MAP[number]['table']

// 2026-09-30追記【重大バグ修正】: syncTable()は元々ここで生のAsyncStorage.getItem/
// setItemを直接使っていたが、lib/sessionsStore.ts・lib/sleepStore.ts・lib/weightStore.ts
// が読み書きを直列化キューで保護しているのと同じキーに対して、このsyncTable()だけが
// キューの外から読み書きしていた。syncAll()はログイン直後にawaitされずに(fire-and-forget)
// 呼ばれるため、その最中にユーザーが練習記録等を保存すると、syncTable()が保存前に
// 読み込んだ古いスナップショットで上書き保存してしまい、保存したはずの記録が消える
// (lost update)。専用ストアがあるキーはそちら経由にし、無いキーもcloudSync内での
// 同時実行(例: syncAllの多重呼び出し)に備えてキュー化する。
const QUEUED_KEYS: Partial<Record<string, { get: () => Promise<any[]>; update: (fn: (cur: any[]) => any[]) => Promise<any[]> }>> = {
  trackmate_sessions: { get: getSessions, update: updateSessions },
  trackmate_sleep:    { get: getSleepRecords, update: updateSleepRecords },
  trackmate_weight:   { get: getWeights, update: updateWeights },
}
const fallbackQueues = new Map<string, ReturnType<typeof createStorageQueue<any[]>>>()
function storeFor(key: string) {
  const dedicated = QUEUED_KEYS[key]
  if (dedicated) return dedicated
  if (!fallbackQueues.has(key)) fallbackQueues.set(key, createStorageQueue<any[]>(key, []))
  return fallbackQueues.get(key)!
}

// sleep_records.duration_min は sleep_start/sleep_end からDB側で自動計算される
// 生成列のため、クイック記録（duration_minのみで作られたローカル記録）を
// そのまま送ると sleep_start/sleep_end が無く duration_min が失われる。
// そのため送信時だけ、sleep_date を基準にした仮の開始・終了時刻を合成する。
function sleepToCloud(item: any): any {
  if (item.sleep_start && item.sleep_end) return item
  const durationMin = typeof item.duration_min === 'number' ? item.duration_min : null
  if (durationMin == null) return item
  const end = new Date(`${item.sleep_date}T07:00:00`)
  const start = new Date(end.getTime() - durationMin * 60_000)
  return { ...item, sleep_start: start.toISOString(), sleep_end: end.toISOString() }
}

// ── auth.users.id → 内部 users.id の解決 ────────────────────────────────
// training_sessions 等の user_id は internal users.id を参照しており、
// auth の user id をそのまま渡すと外部キー/RLSの不整合で upsert が
// 常に失敗する（エラーは握りつぶされ気づきにくい）。該当行が無ければ作成する。
export async function resolveAppUserId(authUserId: string): Promise<string | null> {
  try {
    const { data: existing } = await supabase
      .from('users').select('id').eq('auth_id', authUserId).maybeSingle()
    if (existing?.id) return existing.id

    let name = ''
    try {
      const raw = await AsyncStorage.getItem('trackmate_my_profile')
      if (raw) name = JSON.parse(raw)?.name ?? ''
    } catch {}

    const { data: created } = await supabase
      .from('users')
      .insert({ auth_id: authUserId, name: name || 'ユーザー' })
      .select('id')
      .single()
    return created?.id ?? null
  } catch {
    // users テーブルが想定と異なる/存在しない場合はnullを返し、
    // 呼び出し元で同期をスキップする（アプリを壊さない）
    return null
  }
}

// ── メイン同期関数（ログイン時に呼ぶ） ─────────────────────────────────────
// マージ戦略：クラウドにあるIDは信頼（別デバイス編集を保持）、
// ローカルにしかないIDはクラウドに追加（ゲスト→ログイン移行を保持）
export async function syncAll(authUserId: string): Promise<void> {
  const userId = await resolveAppUserId(authUserId)
  if (!userId) return
  await Promise.allSettled([
    ...SYNC_MAP.map(m => syncTable(userId, m.key, m.table, 'toCloud' in m ? m.toCloud : undefined)),
    syncConditionMap(userId),
  ])
}

// ── 体調記録の同期（日付→レベルのマップ形式のため専用処理） ─────────────────
// マージ戦略は syncTable と同じ（クラウドにある日付は信頼、ローカル専用の
// 日付だけクラウドに追加）だが、対象が配列+idではなく Record<date, level> のため
// 汎用の syncTable() には乗せられない。
async function syncConditionMap(userId: string): Promise<void> {
  try {
    const { data: cloudRows, error } = await supabase
      .from('condition_records')
      .select('condition_date, level')
      .eq('user_id', userId)
    if (error) return // テーブル未作成などは無視（アプリを壊さない）

    const cloudMap: Record<string, number> = {}
    for (const r of cloudRows ?? []) cloudMap[r.condition_date] = r.level

    const localMap = await getConditionMap()
    const localOnlyDates = Object.keys(localMap).filter(d => !(d in cloudMap))

    const merged = { ...localMap, ...cloudMap }
    await updateConditionMap(() => merged)

    if (localOnlyDates.length > 0) {
      const rows = localOnlyDates.map(d => ({ user_id: userId, condition_date: d, level: localMap[d] }))
      await supabase
        .from('condition_records')
        .upsert(rows, { onConflict: 'user_id,condition_date' })
        .then(() => {})
    }
  } catch {
    // ネットワークエラー等は全て無視 — アプリを壊さない
  }
}

async function syncTable(
  userId: string,
  storageKey: string,
  table: SyncTable,
  toCloud?: (item: any) => any,
): Promise<void> {
  try {
    // ① クラウドから取得
    const { data: cloudRows, error } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', userId)

    if (error) return // テーブルが存在しない場合なども握りつぶす

    const cloudData: any[] = cloudRows ?? []

    // ②③④ ローカルの読み込み・マージ・書き込みを1つの直列化されたupdate()内で行う。
    // update()のupdater関数は実行時点(=キューが実際にこの処理の番を迎えた時点)の
    // 最新ローカルデータをcurrentLocalとして受け取るため、この処理を待っている間に
    // 他の保存処理(sessionsStore.updateSessions等、同じキューを共有するもの)が
    // 割り込んでいても、その内容を取りこぼさずマージできる。
    let localOnly: any[] = []
    await storeFor(storageKey).update((currentLocal) => {
      const cloudIds = new Set(cloudData.map((r) => r.id))
      localOnly = currentLocal.filter((r) => !cloudIds.has(r.id))
      let m = [...cloudData, ...localOnly]

      // sleep_records は1日1件の想定だが、保存のたびに新しいidを発行しているため
      // 同じ sleep_date のレコードがクラウド版・ローカル版で別idとして両方残り、
      // 表示時にどちらが選ばれるか不定になる（=数値が勝手に変わって見える）。
      // 同じ sleep_date が複数あれば created_at が最新のものだけ残す。
      if (table === 'sleep_records') {
        const latestByDate = new Map<string, any>()
        for (const r of m) {
          const existing = latestByDate.get(r.sleep_date)
          if (!existing || (r.created_at ?? '') > (existing.created_at ?? '')) {
            latestByDate.set(r.sleep_date, r)
          }
        }
        m = Array.from(latestByDate.values())
      }

      // 元の実装は「マージ結果が空なら書き込まない」挙動だったため、
      // 空になるケースは現在の状態をそのまま返して無用な書き込みを避ける
      return m.length > 0 ? m : currentLocal
    })

    // ⑤ ローカルにしかなかったアイテムをクラウドに追加
    if (localOnly.length > 0) {
      const rows = localOnly.map((item) => {
        const withUser = { ...item, user_id: userId }
        return toCloud ? toCloud(withUser) : withUser
      })
      await supabase
        .from(table)
        .upsert(rows, { onConflict: 'id' })
        // エラーは無視（テーブルなし・RLS エラー等）
        .then(() => {})
    }
  } catch {
    // ネットワークエラー等は全て無視 — アプリを壊さない
  }
}

// ── プロフィールをクラウドに同期（オンボーディング→ログインの順でも必ず送る） ──
// オンボーディング完了時点ではまだ未ログインのケースがあるため、
// ログイン成功のたびにローカルの trackmate_my_profile を profiles テーブルへ upsert する
export async function syncProfileToCloud(userId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem('trackmate_my_profile')
    if (!raw) return
    const profile = JSON.parse(raw)
    await supabase.from('profiles').upsert({
      user_id: userId,
      name: profile.name ?? null,
      primary_event: profile.primary_event ?? null,
      event_category: profile.event_category ?? null,
      age: profile.age ?? null,
      experience_years: profile.experience_years ?? null,
      prefecture: profile.prefecture ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }).then(() => {})
  } catch {
    // 同期失敗はサイレント（アプリを壊さない）
  }
}

// ── 単一アイテムをリアルタイムでクラウドに保存 ─────────────────────────────
// 各画面の save 処理の後に呼ぶことでリアルタイム同期が可能
// 現状どの画面からも呼ばれていない（未使用）。呼び出す場合は userId に
// auth の user id ではなく resolveAppUserId() で解決した内部IDを渡すこと。
export async function saveItem(
  table: SyncTable,
  item: any,
  userId: string,
): Promise<void> {
  try {
    await supabase
      .from(table)
      .upsert({ ...item, user_id: userId }, { onConflict: 'id' })
      .then(() => {})
  } catch {
    // silently fail
  }
}

// ── アイテムをクラウドから削除 ─────────────────────────────────────────────
export async function deleteItem(
  table: SyncTable,
  id: string,
): Promise<void> {
  try {
    await supabase.from(table).delete().eq('id', id).then(() => {})
  } catch {
    // silently fail
  }
}

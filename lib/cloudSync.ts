// lib/cloudSync.ts — AsyncStorage ↔ Supabase 双方向同期
//
// 戦略：
//   1. ログイン時に syncAll(userId) を呼ぶ
//   2. クラウド優先でマージ（クラウドにあるIDは上書き、ローカル専用は追加）
//   3. 各 save 後に saveItem() を呼べばリアルタイム同期も可
//
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

// ── ストレージキー ↔ Supabase テーブル のマッピング ─────────────────────────
const SYNC_MAP = [
  { key: 'trackmate_race_records',    table: 'race_records'      },
  { key: 'trackmate_sessions',        table: 'training_sessions' },
  { key: 'trackmate_competitions',    table: 'competition_plans' },
  { key: 'trackmate_calendar_events', table: 'calendar_events'   },
  { key: 'trackmate_workout_menus',   table: 'workout_menus'     },
] as const

type SyncTable = typeof SYNC_MAP[number]['table']

// ── メイン同期関数（ログイン時に呼ぶ） ─────────────────────────────────────
// マージ戦略：クラウドにあるIDは信頼（別デバイス編集を保持）、
// ローカルにしかないIDはクラウドに追加（ゲスト→ログイン移行を保持）
export async function syncAll(userId: string): Promise<void> {
  await Promise.allSettled(
    SYNC_MAP.map(({ key, table }) => syncTable(userId, key, table))
  )
}

async function syncTable(
  userId: string,
  storageKey: string,
  table: SyncTable,
): Promise<void> {
  try {
    // ① クラウドから取得
    const { data: cloudRows, error } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', userId)

    if (error) return // テーブルが存在しない場合なども握りつぶす

    const cloudData: any[] = cloudRows ?? []

    // ② ローカルから取得
    const raw = await AsyncStorage.getItem(storageKey)
    let localData: any[] = []
    try { localData = raw ? JSON.parse(raw) : [] } catch { localData = [] }

    // ③ マージ
    const cloudIds  = new Set(cloudData.map((r) => r.id))
    const localOnly = localData.filter((r) => !cloudIds.has(r.id))
    const merged    = [...cloudData, ...localOnly]

    // ④ マージ結果をローカルに保存
    if (merged.length > 0) {
      await AsyncStorage.setItem(storageKey, JSON.stringify(merged))
    }

    // ⑤ ローカルにしかなかったアイテムをクラウドに追加
    if (localOnly.length > 0) {
      const rows = localOnly.map((item) => ({ ...item, user_id: userId }))
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

// ── 単一アイテムをリアルタイムでクラウドに保存 ─────────────────────────────
// 各画面の save 処理の後に呼ぶことでリアルタイム同期が可能
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

// lib/scoppyChatStore.ts — スコッピーとの会話履歴を保存する共有ストア
//
// 2026-09-13: 「AIスコッピーと会話できる機能」用に新規作成。実際のAI呼び出し
// (askScoppy)はlib/claude.tsに置き、ここでは表示用の会話履歴の永続化だけを担う。
// lib/videoAnalysisHistoryStore.tsと同じcreateStorageQueue方式（read-modify-writeの
// 直列化）を踏襲。
//
// 2026-09-13追記: 「チケット制の設定、1チケット5質問とか」との指示で、他のAI機能
// (1回=1チケット消費の単純な仕組み)とは別に、ここだけ「チケット1枚で5回ぶんまとめて
// 使える」バンク方式を追加した。lib/adGate.tsのTICKET_COST自体は1のままで、
// app/scoppy-chat.tsx側がこのローカル残数を先にチェックし、残数が0の時だけ
// 通常のチケット消費フロー(checkAdGate/recordUsage)を1回走らせて5回分をチャージし直す。
// 端末ローカル(AsyncStorage)のみで管理する軽量な仕組みのため、機種変更等では
// 残数はリセットされる(消費済みチケット自体はサーバー側のticket_walletsで正しく
// 減っているので二重付与/二重消費にはならない。あくまで「気前よく使える」UX上の工夫)。
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createStorageQueue } from './storageQueue'
import type { ScoppyChatMessage } from './claude'

export interface ScoppyChatEntry extends ScoppyChatMessage {
  id: string
  created_at: string
}

export const SCOPPY_CHAT_KEY = 'trackmate_scoppy_chat_history'
// 会話が伸び続けてAsyncStorageの書き込みが重くなるのを防ぐため、表示用の保存件数にも
// 上限を設ける（APIに送る件数はlib/claude.ts側でさらに直近16件に絞っている）
const MAX_ENTRIES = 60

const store = createStorageQueue<ScoppyChatEntry[]>(SCOPPY_CHAT_KEY, [])

export async function getScoppyChatHistory(): Promise<ScoppyChatEntry[]> {
  return store.get()
}

export function addScoppyChatMessage(message: ScoppyChatMessage): Promise<ScoppyChatEntry[]> {
  return store.update(current => {
    const next: ScoppyChatEntry = {
      ...message,
      id: `sc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      created_at: new Date().toISOString(),
    }
    // 表示は時系列順(古い→新しい)で使うため末尾に追加。上限超過分は古い方から間引く
    return [...current, next].slice(-MAX_ENTRIES)
  })
}

export function clearScoppyChatHistory(): Promise<ScoppyChatEntry[]> {
  return store.update(() => [])
}

// ── チケット1枚=5メッセージのローカル残数バンク ─────────────────────────
export const MESSAGES_PER_TICKET = 5
const CREDITS_KEY = 'trackmate_scoppy_chat_credits'

export async function getScoppyChatCredits(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(CREDITS_KEY)
    const n = raw ? parseInt(raw, 10) : 0
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

// 送信成功後にだけ呼ぶこと(失敗時に残数だけ減って損をする不具合を避けるため、
// 他のAI機能と同じ「成功した場合のみ消費する」方針に合わせる)
export async function consumeScoppyChatCredit(): Promise<void> {
  const current = await getScoppyChatCredits()
  await AsyncStorage.setItem(CREDITS_KEY, String(Math.max(0, current - 1))).catch(() => {})
}

// チケット1枚を使い切った直後に呼ぶ。今回の1回分は既にこのメッセージで使うため、
// MESSAGES_PER_TICKET - 1 をチャージする(例: 5枚チャージして今回分の1を引くのではなく、
// 「残り4回、今回で合計5回目」という数え方にする方が呼び出し元の実装がシンプルになる)
export async function rechargeScoppyChatCredits(): Promise<void> {
  await AsyncStorage.setItem(CREDITS_KEY, String(MESSAGES_PER_TICKET - 1)).catch(() => {})
}

// lib/rankingOptIn.ts — 全国ランキングへの参加可否・表示名の管理
//
// 2026-09-11: これまでランキングは「ログインしていれば自動的に参加」だった
// (自己ベストが自動でランキング取得対象になり、本名の頭文字が表示されていた)。
// 参加を明示的なオプトインにし、表示名も本名ではなくユーザー自身が決める
// 形に変更(詳細はsupabase/ranking_opt_in_migration.sqlのコメント参照)。
import { supabase } from './supabase'

export interface RankingSettings {
  optIn: boolean
  displayName: string
}

const EMPTY: RankingSettings = { optIn: false, displayName: '' }

/** 現在ログイン中ユーザーのランキング参加設定を取得する。未ログイン/取得失敗時はEMPTYを返す */
export async function getMyRankingSettings(userId: string | null | undefined): Promise<RankingSettings> {
  if (!userId) return EMPTY
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('ranking_opt_in, ranking_display_name')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return EMPTY
    return {
      optIn: !!(data as { ranking_opt_in?: boolean }).ranking_opt_in,
      displayName: (data as { ranking_display_name?: string }).ranking_display_name ?? '',
    }
  } catch {
    return EMPTY
  }
}

/**
 * ランキング参加設定を保存する。
 * profiles行が(オンボーディング未完了などで)まだ無いケースに備えてupsertする
 * （lib/cloudSync.ts syncProfileToCloud() と同じ理由）。
 * name/primary_event等の他フィールドは触らない(upsertは渡したキーだけを更新する)。
 */
export async function setMyRankingSettings(userId: string, settings: RankingSettings): Promise<{ ok: boolean; debugMessage?: string }> {
  try {
    const { error } = await supabase.from('profiles').upsert({
      user_id: userId,
      ranking_opt_in: settings.optIn,
      ranking_display_name: settings.displayName.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (error) {
      // 2026-09-13: 「ランキング参加できない」との報告でエラーを握りつぶしていたことが
      // 判明。supabase/ranking_opt_in_migration.sqlが未実行だとprofilesテーブルに
      // ranking_opt_in/ranking_display_name列が存在せず失敗する可能性が高いため、
      // 原因切り分けのため一時的に実際のエラーを返す(呼び出し元でデバッグ表示に使う)
      console.error('[rankingOptIn] upsert failed:', error)
      return { ok: false, debugMessage: error.message }
    }
    return { ok: true }
  } catch (e: any) {
    console.error('[rankingOptIn] upsert exception:', e)
    return { ok: false, debugMessage: e?.message ?? String(e) }
  }
}

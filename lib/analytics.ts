// lib/analytics.ts — 匿名イベント収集（企業向けデータ活用）
//
// 送信されるデータはすべて匿名化済み（user_id_hash = SHA256の先頭12文字）
// 個人を特定できる情報は一切送信しない
//
// 主要イベント一覧:
//   app_open          アプリ起動
//   record_session    練習記録
//   use_ai_analysis   AI練習分析
//   use_meal          AI食事分析
//   use_video         動画フォーム分析
//   use_csv           CSVエクスポート
//   use_recovery      AIリカバリー
//   upgrade_view      ペイウォール表示
//   upgrade_complete  課金完了
//   body_report       痛み報告（部位のみ）
//   team_join         チーム参加（選手）
//   team_create       チーム作成（コーチ）
//   competition_plan  試合計画作成

import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

const ANON_ID_KEY = 'score_anon_id'

// ── 匿名ID生成（端末固有・永続化・個人と紐付けない） ────────────
async function getAnonId(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(ANON_ID_KEY)
    if (stored) return stored
    // ランダムな12桁のIDを生成
    const id = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8)
    await AsyncStorage.setItem(ANON_ID_KEY, id)
    return id
  } catch {
    return 'unknown'
  }
}

// ── プラン取得（adGate.ts と同じロジック） ───────────────────────
async function getCachedTier(): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem('trackmate_subscription')
    if (!raw) return 'free'
    const p = JSON.parse(raw)
    return p?.plan ?? 'free'
  } catch {
    return 'free'
  }
}

// ── メイン送信関数 ────────────────────────────────────────────────
export async function trackEvent(
  eventName: string,
  options?: {
    feature?:    string
    metadata?:   Record<string, unknown>
    platform?:   string
    appVersion?: string
  },
): Promise<void> {
  try {
    const [anonId, tier] = await Promise.all([getAnonId(), getCachedTier()])

    await supabase.from('analytics_events').insert({
      event_name:    eventName,
      user_id_hash:  anonId,
      plan_tier:     tier,
      feature:       options?.feature ?? null,
      metadata:      options?.metadata ?? null,
      app_version:   options?.appVersion ?? null,
      platform:      options?.platform ?? null,
    })
    // エラーは無視（分析データの失敗でアプリを止めない）
  } catch {
    // サイレントに失敗
  }
}

// ── よく使うイベントのショートカット ─────────────────────────────

/** アプリ起動（ホーム画面表示） */
export function trackAppOpen() {
  trackEvent('app_open')
}

/** 練習記録保存 */
export function trackSessionRecord(sessionType: string) {
  trackEvent('record_session', {
    feature: 'session',
    metadata: { session_type: sessionType },
  })
}

/** AI機能使用 */
export function trackFeatureUse(
  feature: 'ai_analysis' | 'meal' | 'video' | 'csv' | 'recovery',
) {
  trackEvent('use_feature', { feature })
}

/** ペイウォール表示 */
export function trackPaywallView(source: string) {
  trackEvent('upgrade_view', {
    feature: 'paywall',
    metadata: { source },
  })
}

/** 課金完了 */
export function trackUpgrade(plan: string) {
  trackEvent('upgrade_complete', {
    feature: 'purchase',
    metadata: { plan },
  })
}

/** 痛み報告（部位名のみ・詳細テキストは送らない） */
export function trackBodyReport(partCount: number, parts: string[]) {
  trackEvent('body_report', {
    feature: 'pain',
    metadata: { part_count: partCount, parts },
  })
}

/** チーム参加 */
export function trackTeamJoin(role: 'coach' | 'player') {
  trackEvent('team_join', {
    feature: 'team',
    metadata: { role },
  })
}

/** 試合計画作成 */
export function trackCompetitionPlan(daysUntil: number) {
  trackEvent('competition_plan', {
    feature: 'competition',
    metadata: { days_until: daysUntil },
  })
}

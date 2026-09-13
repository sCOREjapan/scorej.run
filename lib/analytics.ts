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
// 2026-09-09: workout/daily_insight/notebook_ai/injury_recoveryは
// これまで一切トラッキングされておらず、実際の利用回数が0件しか分からなかった
// （APIコスト是正の議論で判明）ため追加。呼び出し元も合わせて追加した。
export function trackFeatureUse(
  feature: 'ai_analysis' | 'meal' | 'video' | 'csv' | 'recovery' | 'meal_coach'
    | 'workout' | 'daily_insight' | 'notebook_ai' | 'injury_recovery' | 'scoppy_chat',
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

/** ペイウォール/アップセルを閉じた（購入せず離脱） */
// 2026-09-07: marketing-council（Hopkins）の指摘を受けて追加。
// 表示理由(source)ごとにimpression→closeの離脱率を追えるようにする。
export function trackPaywallDismiss(source: string) {
  trackEvent('upgrade_dismiss', {
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

// ── オンボーディング（2026-09-07再設計）の各ステップ通過ログ ─────────
// 北極星指標「登録から24時間以内に初回スコア閲覧＋2回目の記録に到達した割合」を
// 追うための計測。sCORE_成長収益化戦略_v1.md / sCORE_オンボーディング再設計_v2.md 参照。
export type OnboardingStep =
  | 'language_selected' | 'consent_completed' | 'goal_selected' | 'event_selected'
  | 'baseline_started' | 'baseline_completed' | 'readiness_viewed' | 'goal_saved'
  | 'auth_prompt_viewed' | 'auth_completed' | 'guest_selected' | 'home_reached'
  | 'checklist_completed'

export function trackOnboardingStep(step: OnboardingStep, metadata?: Record<string, unknown>) {
  trackEvent(`onboarding_${step}`, { feature: 'onboarding', metadata })
}

/** 無料トライアル開始（購入完了とは別に、トライアル開始の瞬間を計測） */
export function trackTrialStarted(plan: string) {
  trackEvent('trial_started', { feature: 'purchase', metadata: { plan } })
}

/** 週次レポート閲覧（Day7機能。lib/paywallTiming.ts参照。機能実装後に呼び出す） */
export function trackWeeklyReportViewed() {
  trackEvent('weekly_report_viewed', { feature: 'weekly_report' })
}

// 2026-09-09: 設計書§6の必須イベント一覧のうち、既存機能に対応するが未実装だった
// ものを追加。daily_checkin_completed/daily_decision_viewed/video_action_saved等、
// まだ存在しない機能に紐づくものはPhase2でその機能を作る際に追加する。

/** チーム作成（コーチ）。trackTeamJoin('coach'から改称・分離: 「参加」ではなく「作成」なので別イベントにする */
export function trackTeamCreated() {
  trackEvent('team_created', { feature: 'team' })
}

/** チームダッシュボード表示（コーチ・選手どちらの画面か） */
export function trackTeamDashboardViewed(role: 'coach' | 'player') {
  trackEvent('team_dashboard_viewed', { feature: 'team', metadata: { role } })
}

/** 購入フロー開始（ペイウォールのボタンを押し、ストアの購入シートを開いた瞬間。
 *  impression(表示)→checkout_started(購入試行)→purchase_completed(成立)の
 *  どこで離脱したかを追うため、upgrade_view/upgrade_completeとは別に必要） */
export function trackCheckoutStarted(plan: string, source: string) {
  trackEvent('checkout_started', { feature: 'purchase', metadata: { plan, source } })
}

/** AIリクエスト失敗（モデル無応答・空応答・JSON解析失敗など）。
 *  api/ai-health-check.tsの日次死活監視とは別に、実際のユーザートラフィックで
 *  発生している失敗率を機能別に見るためのもの。lib/claude.tsのcallClaude()から
 *  一括で呼ぶため、個別のAI機能側で呼び出しを追加する必要はない。 */
export function trackAiRequestFailed(feature: string, errorType: string) {
  trackEvent('ai_request_failed', { feature, metadata: { error_type: errorType } })
}

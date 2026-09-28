// lib/coachTrial.ts — コーチプラン15日間無料体験の開始（api/start-coach-trial.tsの薄いラッパー）
import { getAiAuthHeader } from './supabase'

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')

// app/(tabs)/team.tsxのgenerateCode()と同じ生成ロジック（6文字の英数字）
function generateTrialTeamCode(): string {
  return Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6).padEnd(6, '0')
}

export interface CoachTrialResult {
  code: string
  teamName: string
  coachName: string
  trialExpiresAt: string
}

export class CoachTrialAlreadyUsedError extends Error {}

/**
 * コーチプランの無料体験を開始する。サーバー側(api/start-coach-trial.ts)で
 * ・ログイン必須の確認
 * ・1アカウント1回のみ（coach_trialsテーブル）
 * ・teams.owner_user_idでのアカウント紐付け
 * を行う。コード衝突時（同時作成等の稀なケース）は最大3回まで再試行する。
 *
 * 2026-09-25バグ修正: 以前は「体験済み(ALREADY_USED)以外は全部リトライ」だったため、
 * コード衝突ではない本物のサーバーエラー(例: coach_trials insert失敗でteamsだけ
 * 孤児化するケース。api/start-coach-trial.ts参照)でも毎回新しいコードでteamsを
 * 作り直そうとし、孤児レコードを最大3件量産しかねなかった。
 * サーバー側がres.body.codeで返す機械可読な種別だけを見て判定するように変更
 * (CODE_TAKEN=コード衝突のみリトライ、ALREADY_USED=専用エラー、それ以外は即失敗)。
 */
export async function startCoachTrial(teamName: string, coachName: string): Promise<CoachTrialResult> {
  let lastError = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateTrialTeamCode()
    const res = await fetch(`${API_BASE}/api/start-coach-trial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAiAuthHeader()) },
      body: JSON.stringify({ code, teamName, coachName }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      return { code: json.code, teamName: json.teamName, coachName: json.coachName, trialExpiresAt: json.trialExpiresAt }
    }
    if (json?.code === 'ALREADY_USED') {
      throw new CoachTrialAlreadyUsedError(json.error)
    }
    lastError = json?.error ?? `HTTP ${res.status}`
    if (json?.code !== 'CODE_TAKEN') {
      // コード衝突以外の失敗は再試行しても直らない可能性が高く、孤児レコードを
      // 増やすだけなので即座に諦める。
      throw new Error(lastError)
    }
    // CODE_TAKEN の場合だけ、新しいコードで再試行する。
  }
  throw new Error(lastError || '体験の開始に失敗しました')
}

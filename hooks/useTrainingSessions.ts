// hooks/useTrainingSessions.ts — トレーニングセッション CRUD フック
//
// addSession/updateSession は以前、このフックインスタンス自身のローカルstate(prev)を
// 基点に read-modify-write していた。このフックを「fetchSessionsを呼ばずに
// addSessionだけ呼ぶ」使い方（例: app/(tabs)/team.tsx の欠席報告）をすると、
// prevが常に空配列のまま書き込まれ、trackmate_sessionsの実データが
// [新規セッションのみ]で上書きされて消える実害が出た（本番レビューで報告された
// データ消失バグ）。lib/sessionsStore.ts の直列化キュー経由に統一し、
// 常に最新の永続化データを起点に書き込むようにする。

import { useState, useCallback } from 'react'
import type { TrainingSession, LoadingState } from '../types'
import { autoSyncTeam } from '../lib/teamAutoSync'
import { getSessions, updateSessions } from '../lib/sessionsStore'

interface UseTrainingSessionsReturn {
  sessions: TrainingSession[]
  loading: LoadingState
  error: string | null
  fetchSessions: (userId: string, days?: number) => Promise<void>
  addSession: (session: Omit<TrainingSession, 'id' | 'created_at'>) => Promise<TrainingSession | null>
  updateSession: (id: string, updates: Partial<Omit<TrainingSession, 'id' | 'created_at'>>) => Promise<void>
  getSessionById: (id: string) => TrainingSession | undefined
}

export function useTrainingSessions(): UseTrainingSessionsReturn {
  const [sessions, setSessions] = useState<TrainingSession[]>([])
  const [loading, setLoading] = useState<LoadingState>('idle')
  const [error, setError] = useState<string | null>(null)

  // ─────────────────────────────────────────
  // セッション一覧取得
  // ─────────────────────────────────────────
  const fetchSessions = useCallback(async (_userId: string, _days = 30): Promise<void> => {
    setLoading('loading')
    setError(null)
    try {
      const data = await getSessions()
      // 最新順（session_date 降順）に正規化 — クラウド同期後に順序が乱れることがあるため
      data.sort((a, b) => b.session_date.localeCompare(a.session_date))
      setSessions(data)
      setLoading('success')
    } catch (err) {
      const message = err instanceof Error ? err.message : '練習記録の取得に失敗しました'
      setError(message)
      setSessions([])
      setLoading('success') // エラーでも空配列で続行
    }
  }, [])

  // ─────────────────────────────────────────
  // セッション追加（直列化キュー経由。常に最新の永続化データを起点に書き込む）
  // ─────────────────────────────────────────
  const addSession = useCallback(
    async (
      session: Omit<TrainingSession, 'id' | 'created_at'>
    ): Promise<TrainingSession | null> => {
      try {
        const newSession: TrainingSession = {
          ...session,
          id: `local-${Date.now()}`,
          created_at: new Date().toISOString(),
        }
        const next = await updateSessions(current => [newSession, ...current])
        setSessions(next)
        autoSyncTeam(next, { force: true }).catch(() => {})
        return newSession
      } catch {
        return null
      }
    },
    []
  )

  // ─────────────────────────────────────────
  // セッション更新（直列化キュー経由。常に最新の永続化データを起点に書き込む）
  // ─────────────────────────────────────────
  const updateSession = useCallback(
    async (
      id: string,
      updates: Partial<Omit<TrainingSession, 'id' | 'created_at'>>
    ): Promise<void> => {
      const next = await updateSessions(current => current.map(s => (s.id === id ? { ...s, ...updates } : s)))
      setSessions(next)
      autoSyncTeam(next, { force: true }).catch(() => {})
    },
    []
  )

  // ─────────────────────────────────────────
  // ID によるセッション検索（ローカルキャッシュから）
  // ─────────────────────────────────────────
  const getSessionById = useCallback(
    (id: string): TrainingSession | undefined => {
      return sessions.find(s => s.id === id)
    },
    [sessions]
  )

  return {
    sessions,
    loading,
    error,
    fetchSessions,
    addSession,
    updateSession,
    getSessionById,
  }
}

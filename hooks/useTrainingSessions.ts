// hooks/useTrainingSessions.ts — トレーニングセッション CRUD フック

import { useState, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { TrainingSession, LoadingState } from '../types'
import { autoSyncTeam } from '../lib/teamAutoSync'

const SESSIONS_KEY = 'trackmate_sessions'

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
      const raw = await AsyncStorage.getItem(SESSIONS_KEY)
      let data: TrainingSession[] = []
      try { if (raw) data = JSON.parse(raw) } catch {}  // データ破損でも空配列で継続
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
  // セッション追加（AsyncStorage に保存）
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
        setSessions(prev => {
          const next = [newSession, ...prev]
          AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(next))
            .then(() => autoSyncTeam(next, { force: true }))
            .catch(() => {})
          return next
        })
        return newSession
      } catch {
        return null
      }
    },
    []
  )

  // ─────────────────────────────────────────
  // セッション更新（AsyncStorage に保存）
  // ─────────────────────────────────────────
  const updateSession = useCallback(
    async (
      id: string,
      updates: Partial<Omit<TrainingSession, 'id' | 'created_at'>>
    ): Promise<void> => {
      setSessions(prev => {
        const next = prev.map(s => (s.id === id ? { ...s, ...updates } : s))
        AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(next))
          .then(() => autoSyncTeam(next, { force: true }))
          .catch(() => {})
        return next
      })
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

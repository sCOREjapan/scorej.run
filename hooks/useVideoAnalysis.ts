// hooks/useVideoAnalysis.ts — 動画フォーム分析フック

import { useState, useCallback } from 'react'
import { Platform } from 'react-native'
import Toast from 'react-native-toast-message'
import { analyzeVideo } from '../lib/claude'
import { extractVideoFrames } from '../lib/storage'
import type { VideoAnalysisResult, AthleticsEvent } from '../types'
import { Sounds } from '../lib/sounds'

interface UseVideoAnalysisReturn {
  analyzing: boolean
  result: VideoAnalysisResult | null
  error: string | null
  progress: number  // 0–100
  analyzeFromVideo: (videoUri: string, event: AthleticsEvent, durationMs?: number) => Promise<VideoAnalysisResult | null>
  clearResult: () => void
}

export function useVideoAnalysis(): UseVideoAnalysisReturn {
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<VideoAnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  // ─────────────────────────────────────────
  // 動画 URI からフレームを抽出し AI 分析を実行
  // ─────────────────────────────────────────
  const analyzeFromVideo = useCallback(
    async (
      videoUri: string,
      event: AthleticsEvent,
      durationMs?: number
    ): Promise<VideoAnalysisResult | null> => {
      setAnalyzing(true)
      setError(null)
      setResult(null)
      setProgress(0)

      try {
        // ステップ 1: フレーム抽出（0 → 40%）
        setProgress(10)
        const frames = await extractVideoFrames(videoUri, 4, durationMs)
        setProgress(40)

        if (!frames || frames.length === 0) {
          throw new Error('動画からフレームを抽出できませんでした')
        }

        // ステップ 2: Claude API に送信（40 → 90%）
        setProgress(50)
        const analysisResult = await analyzeVideo(frames, event)
        setProgress(90)

        // レスポンスバリデーション
        if (
          !analysisResult ||
          typeof analysisResult.technique_score !== 'number' ||
          !Array.isArray(analysisResult.strengths) ||
          !Array.isArray(analysisResult.improvements) ||
          !Array.isArray(analysisResult.drills)
        ) {
          throw new Error('AI からの応答が不正な形式です')
        }

        setResult(analysisResult)
        setProgress(100)
        if (Platform.OS === 'web') Sounds.ding()
        return analysisResult
      } catch (err) {
        const message = err instanceof Error ? err.message : '動画分析に失敗しました'
        setError(message)
        setProgress(0)
        Toast.show({
          type: 'error',
          text1: '動画分析に失敗',
          text2: message,
        })
        return null
      } finally {
        setAnalyzing(false)
      }
    },
    []
  )

  // ─────────────────────────────────────────
  // 結果・状態をリセット
  // ─────────────────────────────────────────
  const clearResult = useCallback(() => {
    setResult(null)
    setError(null)
    setProgress(0)
  }, [])

  return {
    analyzing,
    result,
    error,
    progress,
    analyzeFromVideo,
    clearResult,
  }
}

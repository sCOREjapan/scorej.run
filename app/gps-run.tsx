// app/gps-run.tsx — GPS練習記録（全画面）

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  StatusBar,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { Ionicons } from '@expo/vector-icons'
import { BRAND, TEXT, SURFACE, SURFACE2, DIVIDER } from '../lib/theme'
import type { TrainingSession } from '../types'

// ─── 定数 ──────────────────────────────────────────────────────────────
const SESSIONS_KEY = 'trackmate_sessions'
const MOCK_USER_ID = 'mock-user-1'
// 体重70kgを仮定したカロリー計算係数（kcal/km）
const CALORIES_PER_KM = 70

// ─── ユーティリティ ─────────────────────────────────────────────────────
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatPace(distM: number, ms: number): string {
  if (distM < 10 || ms < 1000) return '--:--'
  const distKm = distM / 1000
  const minPerKm = ms / 1000 / 60 / distKm
  if (!isFinite(minPerKm) || minPerKm > 99) return '--:--'
  const paceMin = Math.floor(minPerKm)
  const paceSec = Math.round((minPerKm - paceMin) * 60)
  return `${paceMin}'${String(paceSec).padStart(2, '0')}"`
}

type RunState = 'idle' | 'running' | 'paused'

interface Coord {
  latitude: number
  longitude: number
}

// ─── メイン ─────────────────────────────────────────────────────────────
export default function GpsRunScreen() {
  const router = useRouter()

  const [runState, setRunState] = useState<RunState>('idle')
  const [permissionStatus, setPermissionStatus] = useState<'unknown' | 'granted' | 'denied'>('unknown')

  // 計測値
  const [elapsedMs, setElapsedMs] = useState(0)
  const [distanceM, setDistanceM] = useState(0)

  // 内部 ref（再レンダリングを最小化）
  const startTimeRef      = useRef<number>(0)
  const accumulatedMsRef  = useRef<number>(0)
  const lastCoordRef      = useRef<Coord | null>(null)
  const distanceMRef      = useRef<number>(0)
  const timerRef          = useRef<ReturnType<typeof setInterval> | null>(null)
  const locationSubRef    = useRef<Location.LocationSubscription | null>(null)

  // ─── 権限チェック ─────────────────────────────────────────────────
  useEffect(() => {
    ;(async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      setPermissionStatus(status === 'granted' ? 'granted' : 'denied')
    })()
    return () => {
      stopTimer()
      stopLocationWatch()
    }
  }, [])

  // ─── タイマー制御 ─────────────────────────────────────────────────
  function startTimer() {
    startTimeRef.current = Date.now()
    timerRef.current = setInterval(() => {
      setElapsedMs(accumulatedMsRef.current + (Date.now() - startTimeRef.current))
    }, 200)
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  function pauseTimer() {
    stopTimer()
    accumulatedMsRef.current += Date.now() - startTimeRef.current
  }

  // ─── GPS制御 ─────────────────────────────────────────────────────
  async function startLocationWatch() {
    if (permissionStatus !== 'granted') return
    locationSubRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 5,
        timeInterval: 1000,
      },
      (loc) => {
        const coord: Coord = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        }
        if (lastCoordRef.current) {
          const delta = haversine(
            lastCoordRef.current.latitude,
            lastCoordRef.current.longitude,
            coord.latitude,
            coord.longitude,
          )
          // 100m以上の異常値を除外
          if (delta < 100) {
            distanceMRef.current += delta
            setDistanceM(distanceMRef.current)
          }
        }
        lastCoordRef.current = coord
      }
    )
  }

  function stopLocationWatch() {
    if (locationSubRef.current) {
      locationSubRef.current.remove()
      locationSubRef.current = null
    }
  }

  // ─── ボタン操作 ─────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (permissionStatus !== 'granted') {
      Alert.alert('位置情報エラー', 'GPS追跡には位置情報の権限が必要です。設定から有効にしてください。')
      return
    }
    setRunState('running')
    startTimer()
    await startLocationWatch()
  }, [permissionStatus])

  const handlePause = useCallback(() => {
    setRunState('paused')
    pauseTimer()
    stopLocationWatch()
  }, [])

  const handleResume = useCallback(async () => {
    setRunState('running')
    startTimer()
    await startLocationWatch()
  }, [permissionStatus])

  const handleStop = useCallback(() => {
    stopTimer()
    stopLocationWatch()

    const finalMs = accumulatedMsRef.current
    const finalDistM = distanceMRef.current

    Alert.alert(
      '練習を終了しますか？',
      `距離: ${(finalDistM / 1000).toFixed(2)} km\n時間: ${formatElapsed(finalMs)}`,
      [
        {
          text: 'キャンセル',
          style: 'cancel',
          onPress: () => {
            // 一時停止状態のまま残す
            setRunState('paused')
          },
        },
        {
          text: '保存',
          style: 'default',
          onPress: () => saveSession(finalDistM, finalMs),
        },
        {
          text: '破棄',
          style: 'destructive',
          onPress: resetAll,
        },
      ]
    )
  }, [])

  async function saveSession(distM: number, ms: number) {
    try {
      const raw = await AsyncStorage.getItem(SESSIONS_KEY)
      const existing: TrainingSession[] = raw ? JSON.parse(raw) : []
      const newSession: TrainingSession = {
        id: `gps_${Date.now()}`,
        user_id: MOCK_USER_ID,
        session_date: new Date().toISOString().slice(0, 10),
        session_type: 'easy',
        distance_m: Math.round(distM),
        time_ms: Math.round(ms),
        fatigue_level: 5,
        condition_level: 7,
        created_at: new Date().toISOString(),
      }
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify([newSession, ...existing]))
      Toast.show({ type: 'success', text1: '練習を保存しました', text2: `${(distM / 1000).toFixed(2)} km / ${formatElapsed(ms)}` })
      resetAll()
      router.back()
    } catch {
      Toast.show({ type: 'error', text1: '保存に失敗しました' })
      resetAll()
    }
  }

  function resetAll() {
    setRunState('idle')
    setElapsedMs(0)
    setDistanceM(0)
    accumulatedMsRef.current = 0
    distanceMRef.current = 0
    lastCoordRef.current = null
  }

  // ─── 計算値 ───────────────────────────────────────────────────
  const distKm = distanceM / 1000
  const paceStr = formatPace(distanceM, elapsedMs)
  const calories = Math.round(distKm * CALORIES_PER_KM)

  // ─── UI ───────────────────────────────────────────────────────
  if (permissionStatus === 'denied') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />
        <View style={styles.errorContainer}>
          <Ionicons name="location-outline" size={64} color={TEXT.hint} />
          <Text style={styles.errorTitle}>位置情報が無効です</Text>
          <Text style={styles.errorBody}>
            GPS追跡を使用するには、設定アプリから sCORE の位置情報アクセスを許可してください。
          </Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>← 戻る</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (runState !== 'idle') {
            Alert.alert('練習中です', '戻ると練習データが失われます。', [
              { text: 'キャンセル', style: 'cancel' },
              { text: '破棄して戻る', style: 'destructive', onPress: () => { stopTimer(); stopLocationWatch(); router.back() } },
            ])
          } else {
            router.back()
          }
        }} style={styles.headerBack}>
          <Ionicons name="chevron-down" size={28} color={TEXT.secondary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>GPS練習記録</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* 大時計 */}
      <View style={styles.clockContainer}>
        <Text style={styles.clockText}>{formatElapsed(elapsedMs)}</Text>
        <View style={[styles.statusDot, runState === 'running' && styles.statusDotActive]} />
      </View>

      {/* メトリクス */}
      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{distKm.toFixed(2)}</Text>
          <Text style={styles.metricUnit}>km</Text>
          <Text style={styles.metricLabel}>距離</Text>
        </View>

        <View style={styles.metricDivider} />

        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{paceStr}</Text>
          <Text style={styles.metricUnit}>min/km</Text>
          <Text style={styles.metricLabel}>ペース</Text>
        </View>

        <View style={styles.metricDivider} />

        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{calories}</Text>
          <Text style={styles.metricUnit}>kcal</Text>
          <Text style={styles.metricLabel}>消費カロリー</Text>
        </View>
      </View>

      {/* GPS状態インジケーター */}
      {runState === 'running' && (
        <View style={styles.gpsIndicator}>
          <Ionicons name="locate" size={14} color={BRAND} />
          <Text style={styles.gpsIndicatorText}>GPS追跡中</Text>
        </View>
      )}

      {/* ボタン */}
      <View style={styles.buttonContainer}>
        {runState === 'idle' && (
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: BRAND }]}
            onPress={handleStart}
            activeOpacity={0.85}
          >
            <Ionicons name="play" size={28} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>開始</Text>
          </TouchableOpacity>
        )}

        {runState === 'running' && (
          <View style={styles.runningButtons}>
            <TouchableOpacity
              style={[styles.secondaryButton]}
              onPress={handlePause}
              activeOpacity={0.85}
            >
              <Ionicons name="pause" size={24} color={TEXT.primary} />
              <Text style={styles.secondaryButtonText}>一時停止</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, styles.stopButton]}
              onPress={handleStop}
              activeOpacity={0.85}
            >
              <Ionicons name="stop" size={24} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>停止</Text>
            </TouchableOpacity>
          </View>
        )}

        {runState === 'paused' && (
          <View style={styles.runningButtons}>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: BRAND }]}
              onPress={handleResume}
              activeOpacity={0.85}
            >
              <Ionicons name="play" size={24} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>再開</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton]}
              onPress={handleStop}
              activeOpacity={0.85}
            >
              <Ionicons name="stop" size={24} color={TEXT.primary} />
              <Text style={styles.secondaryButtonText}>停止・保存</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* 注意書き */}
      {runState === 'idle' && (
        <Text style={styles.hint}>
          ※ GPS精度の確保のため、屋外での使用を推奨します
        </Text>
      )}
    </SafeAreaView>
  )
}

// ─── スタイル ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f6f6f8',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerBack: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: TEXT.primary,
    fontSize: 17,
    fontWeight: '700',
  },
  clockContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  clockText: {
    color: TEXT.primary,
    fontSize: 80,
    fontWeight: '200',
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: TEXT.hint,
  },
  statusDotActive: {
    backgroundColor: BRAND,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginBottom: 24,
    backgroundColor: SURFACE,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  metricCard: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  metricValue: {
    color: TEXT.primary,
    fontSize: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricUnit: {
    color: TEXT.hint,
    fontSize: 11,
    fontWeight: '600',
  },
  metricLabel: {
    color: TEXT.secondary,
    fontSize: 12,
    marginTop: 4,
  },
  metricDivider: {
    width: 1,
    height: 48,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  gpsIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 16,
  },
  gpsIndicatorText: {
    color: BRAND,
    fontSize: 13,
    fontWeight: '600',
  },
  buttonContainer: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 12,
  },
  runningButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
    borderRadius: 16,
    backgroundColor: BRAND,
  },
  stopButton: {
    backgroundColor: SURFACE2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
    borderRadius: 16,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  secondaryButtonText: {
    color: TEXT.primary,
    fontSize: 17,
    fontWeight: '600',
  },
  hint: {
    color: TEXT.hint,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  // エラー表示
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 16,
  },
  errorTitle: {
    color: TEXT.primary,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorBody: {
    color: TEXT.secondary,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
  },
  backButton: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  backButtonText: {
    color: BRAND,
    fontSize: 16,
    fontWeight: '700',
  },
})

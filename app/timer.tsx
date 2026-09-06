// app/timer.tsx — タイム計測タイマー（全画面）

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
  StatusBar,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { Ionicons } from '@expo/vector-icons'
import { BRAND } from '../lib/theme'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { todayLocalISO } from '../lib/dateLocal'
import type { AthleticsEvent, TrainingSession } from '../types'
import { autoSyncTeam } from '../lib/teamAutoSync'
import { updateSessions } from '../lib/sessionsStore'
import { useTranslation } from 'react-i18next'

// ─── 定数 ───────────────────────────────────────────────────────────────
const SESSIONS_KEY = 'trackmate_sessions'

const SPLIT_EVENTS: AthleticsEvent[] = [
  '100m', '200m', '300m', '400m', '110mH', '100mH', '300mH', '400mH', '800m', '1000m', '1500m', '3000m',
]

// ─── ユーティリティ ─────────────────────────────────────────────────────
function formatStopwatch(ms: number): string {
  const totalMs = Math.floor(ms)
  const minutes = Math.floor(totalMs / 60000)
  const seconds = Math.floor((totalMs % 60000) / 1000)
  const centiseconds = Math.floor((totalMs % 1000) / 10)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`
}

interface Split {
  lap: number
  lapMs: number       // このラップのタイム
  totalMs: number     // 累計タイム
}

type TimerState = 'idle' | 'running' | 'paused'

// ─── スプリット行 ─────────────────────────────────────────────────────
const SplitRow: React.FC<{ split: Split; highlight: boolean }> = ({ split, highlight }) => {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={[styles.splitRow, highlight && styles.splitRowHighlight]}>
      <Text style={[styles.splitLap, highlight && { color: BRAND }]}>
        Lap {split.lap}
      </Text>
      <Text style={[styles.splitLapTime, highlight && { color: BRAND }]}>
        {formatStopwatch(split.lapMs)}
      </Text>
      <Text style={styles.splitTotal}>
        {formatStopwatch(split.totalMs)}
      </Text>
    </View>
  )
}

// ─── メイン ─────────────────────────────────────────────────────────────
export default function TimerScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()
  const { colors, scheme } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [timerState, setTimerState] = useState<TimerState>('idle')
  const [displayMs, setDisplayMs]   = useState(0)
  const [splits, setSplits]         = useState<Split[]>([])
  const [saveModalVisible, setSaveModalVisible] = useState(false)
  const [selectedEvent, setSelectedEvent]       = useState<AthleticsEvent>('100m')
  const [saving, setSaving] = useState(false)

  // 内部 ref
  const intervalRef        = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef       = useRef<number>(0)
  const accumulatedMsRef   = useRef<number>(0)
  const lastSplitTotalRef  = useRef<number>(0)  // 直前スプリット時点の累計

  // ─── タイマー制御 ─────────────────────────────────────────────
  function startTick() {
    startTimeRef.current = Date.now()
    intervalRef.current = setInterval(() => {
      setDisplayMs(accumulatedMsRef.current + (Date.now() - startTimeRef.current))
    }, 67) // ~15fps
  }

  function stopTick() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  // コンポーネントのアンマウント時にインターバルをクリア（メモリリーク防止）
  useEffect(() => {
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null } }
  }, [])

  const handleStart = useCallback(() => {
    setTimerState('running')
    startTick()
  }, [])

  const handlePause = useCallback(() => {
    stopTick()
    accumulatedMsRef.current += Date.now() - startTimeRef.current
    setDisplayMs(accumulatedMsRef.current)
    setTimerState('paused')
  }, [])

  const handleResume = useCallback(() => {
    setTimerState('running')
    startTick()
  }, [])

  const handleReset = useCallback(() => {
    stopTick()
    setTimerState('idle')
    setDisplayMs(0)
    setSplits([])
    accumulatedMsRef.current = 0
    lastSplitTotalRef.current = 0
  }, [])

  const handleSplit = useCallback(() => {
    if (timerState !== 'running') return
    const nowTotal = accumulatedMsRef.current + (Date.now() - startTimeRef.current)
    const lapMs = nowTotal - lastSplitTotalRef.current
    lastSplitTotalRef.current = nowTotal
    setSplits(prev => [
      { lap: prev.length + 1, lapMs, totalMs: nowTotal },
      ...prev,
    ])
  }, [timerState])

  // ─── 保存 ────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (splits.length === 0 && displayMs === 0) {
      Toast.show({ type: 'error', text1: t('timer.noRecordToast') })
      return
    }
    setSaveModalVisible(true)
  }, [splits, displayMs, t])

  const confirmSave = useCallback(async () => {
    setSaving(true)
    try {
      // Lap 1 があればそのタイム、なければ全体タイムを使用
      const firstSplit = splits.find(s => s.lap === 1)
      const resultMs = firstSplit ? firstSplit.lapMs : displayMs

      const today = todayLocalISO()  // ローカル日付（UTCだと深夜に前日扱いになる）

      const newSession: TrainingSession = {
        id: `timer_${Date.now()}`,
        user_id: (await AsyncStorage.getItem('userId').catch(() => null)) ?? 'local',
        session_date: today,
        session_type: 'sprint',
        event: selectedEvent,
        time_ms: Math.round(resultMs),
        fatigue_level: 5,
        condition_level: 7,
        created_at: new Date().toISOString(),
      }

      const saved = await updateSessions(current => [newSession, ...current])
      autoSyncTeam(saved, { force: true }).catch(() => {})

      const totalSec = resultMs / 1000
      const display = totalSec < 60
        ? `${totalSec.toFixed(2)}秒`
        : `${Math.floor(totalSec / 60)}:${(totalSec % 60).toFixed(2).padStart(5, '0')}`

      Toast.show({
        type: 'success',
        text1: t('timer.savedToast', { event: selectedEvent, time: display }),
      })
      setSaveModalVisible(false)
      handleReset()
      router.back()
    } catch {
      Toast.show({ type: 'error', text1: t('timer.saveFailedToast') })
    } finally {
      setSaving(false)
    }
  }, [splits, displayMs, selectedEvent, handleReset, t])

  const fastestLap = splits.length > 0
    ? splits.reduce((a, b) => (a.lapMs < b.lapMs ? a : b)).lap
    : -1

  // ─── UI ───────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />

      {/* ヘッダー */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.headerBack}
          accessibilityLabel={t('timer.closeLabel')}
          onPress={() => {
            if (timerState !== 'idle') {
              Alert.alert(t('timer.runningConfirmTitle'), t('timer.runningConfirmBody'), [
                { text: t('timer.cancel'), style: 'cancel' },
                { text: t('timer.back'), style: 'destructive', onPress: () => { stopTick(); router.back() } },
              ])
            } else {
              router.back()
            }
          }}
        >
          <Ionicons name="chevron-down" size={28} color={colors.textSec} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('timer.headerTitle')}</Text>
        <TouchableOpacity
          style={styles.saveHeaderBtn}
          onPress={handleSave}
          disabled={timerState === 'idle' && splits.length === 0}
        >
          <Text style={[
            styles.saveHeaderBtnText,
            (timerState === 'idle' && splits.length === 0) && { opacity: 0.3 },
          ]}>
            {t('timer.save')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ストップウォッチ */}
      <View style={styles.watchContainer}>
        <Text style={styles.watchText}>{formatStopwatch(displayMs)}</Text>
      </View>

      {/* コントロールボタン */}
      <View style={styles.controlRow}>
        {/* 左: リセット or スプリット */}
        {timerState === 'idle' ? (
          <View style={styles.sideButton} />
        ) : timerState === 'running' ? (
          <TouchableOpacity style={styles.sideButton} onPress={handleSplit} activeOpacity={0.8}>
            <View style={styles.splitBtn}>
              <Ionicons name="flag" size={22} color={colors.text} />
              <Text style={styles.sideButtonText}>{t('timer.split')}</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.sideButton} onPress={handleReset} activeOpacity={0.8}>
            <View style={styles.resetBtn}>
              <Ionicons name="refresh" size={22} color={colors.text} />
              <Text style={styles.sideButtonText}>{t('timer.reset')}</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* 中央: 開始/停止 */}
        <TouchableOpacity
          style={[
            styles.mainButton,
            timerState === 'running' ? styles.mainButtonPause : styles.mainButtonStart,
          ]}
          onPress={
            timerState === 'idle' ? handleStart
            : timerState === 'running' ? handlePause
            : handleResume
          }
          activeOpacity={0.85}
          accessibilityLabel={timerState === 'running' ? t('timer.pauseLabel') : timerState === 'paused' ? t('timer.resumeLabel') : t('timer.startLabel')}
        >
          <Ionicons
            name={timerState === 'running' ? 'pause' : 'play'}
            size={36}
            color="#FFFFFF"
          />
        </TouchableOpacity>

        {/* 右: 空 (対称レイアウト用) */}
        <View style={styles.sideButton} />
      </View>

      {/* スプリット一覧 */}
      <ScrollView
        style={styles.splitList}
        contentContainerStyle={styles.splitListContent}
        showsVerticalScrollIndicator={false}
      >
        {splits.length === 0 ? (
          <View style={styles.splitsEmpty}>
            <Ionicons name="flag-outline" size={32} color={colors.textHint} />
            <Text style={styles.splitsEmptyText}>{t('timer.splitsEmptyText')}</Text>
          </View>
        ) : (
          <>
            {/* ヘッダー行 */}
            <View style={styles.splitHeader}>
              <Text style={styles.splitHeaderText}>{t('timer.splitHeaderLap')}</Text>
              <Text style={styles.splitHeaderText}>{t('timer.splitHeaderLapTime')}</Text>
              <Text style={styles.splitHeaderText}>{t('timer.splitHeaderTotal')}</Text>
            </View>
            {splits.map((s) => (
              <SplitRow
                key={s.lap}
                split={s}
                highlight={s.lap === fastestLap}
              />
            ))}
          </>
        )}
      </ScrollView>

      {/* 保存モーダル */}
      <Modal
        visible={saveModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSaveModalVisible(false)}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setSaveModalVisible(false)}>
              <Text style={styles.modalCancel}>{t('timer.cancel')}</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{t('timer.modalTitle')}</Text>
            <TouchableOpacity onPress={confirmSave} disabled={saving}>
              <Text style={[styles.modalSave, saving && { opacity: 0.4 }]}>
                {saving ? t('timer.saving') : t('timer.save')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* タイム確認 */}
          <View style={styles.confirmTimeCard}>
            <Text style={styles.confirmTimeLabel}>{t('timer.confirmTimeLabel')}</Text>
            <Text style={styles.confirmTimeValue}>
              {formatStopwatch(splits.find(s => s.lap === 1)?.lapMs ?? displayMs)}
            </Text>
          </View>

          {/* 種目選択 */}
          <Text style={styles.modalLabel}>{t('timer.modalLabelEvent')}</Text>
          <ScrollView
            contentContainerStyle={styles.eventGrid}
            showsVerticalScrollIndicator={false}
          >
            {SPLIT_EVENTS.map(e => (
              <TouchableOpacity
                key={e}
                style={[styles.eventChip, selectedEvent === e && styles.eventChipActive]}
                onPress={() => setSelectedEvent(e)}
              >
                <Text style={[styles.eventChipText, selectedEvent === e && styles.eventChipTextActive]}>
                  {e}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

// ─── スタイル ────────────────────────────────────────────────────────────
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  headerBack: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  saveHeaderBtn: {
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  saveHeaderBtnText: {
    color: BRAND,
    fontSize: 16,
    fontWeight: '700',
  },

  // ストップウォッチ
  watchContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  watchText: {
    color: colors.text,
    fontSize: 72,
    fontWeight: '200',
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },

  // コントロールボタン
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
    marginBottom: 32,
  },
  sideButton: {
    width: 72,
    alignItems: 'center',
  },
  splitBtn: {
    alignItems: 'center',
    gap: 4,
  },
  resetBtn: {
    alignItems: 'center',
    gap: 4,
  },
  sideButtonText: {
    color: colors.textSec,
    fontSize: 12,
    fontWeight: '600',
  },
  mainButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainButtonStart: {
    backgroundColor: BRAND,
  },
  mainButtonPause: {
    backgroundColor: colors.surface2,
    borderWidth: 2,
    borderColor: colors.border,
  },

  // スプリット一覧
  splitList: {
    flex: 1,
    marginHorizontal: 16,
  },
  splitListContent: {
    paddingBottom: 32,
  },
  splitHeader: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  splitHeaderText: {
    flex: 1,
    color: colors.textHint,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  splitRowHighlight: {
    backgroundColor: `${BRAND}11`,
  },
  splitLap: {
    flex: 1,
    color: colors.textSec,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  splitLapTime: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  splitTotal: {
    flex: 1,
    color: colors.textSec,
    fontSize: 14,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  splitsEmpty: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  splitsEmptyText: {
    color: colors.textSec,
    fontSize: 14,
    textAlign: 'center',
  },

  // モーダル
  modalSafe: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  modalCancel: {
    color: colors.textSec,
    fontSize: 16,
  },
  modalSave: {
    color: BRAND,
    fontSize: 16,
    fontWeight: '700',
  },
  confirmTimeCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  confirmTimeLabel: {
    color: colors.textSec,
    fontSize: 13,
    marginBottom: 8,
  },
  confirmTimeValue: {
    color: colors.text,
    fontSize: 40,
    fontWeight: '200',
    fontVariant: ['tabular-nums'],
  },
  modalLabel: {
    color: colors.textSec,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  eventGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  eventChip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  eventChipActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  eventChipText: {
    color: colors.textSec,
    fontSize: 14,
    fontWeight: '600',
  },
  eventChipTextActive: {
    color: '#FFFFFF',
  },
})

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
import PressableScale from '../components/PressableScale'
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
// 2026-09-13: 最速ラップの目印を「行全体をうっすら塗る」(気づきにくい)から、
// 左端に色帯+トロフィーアイコンを添える方式に変更してひと目で分かるようにした
const SplitRow: React.FC<{ split: Split; highlight: boolean }> = ({ split, highlight }) => {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={[styles.splitRow, highlight && styles.splitRowHighlight]}>
      {highlight && <View style={styles.splitRowAccent} />}
      <View style={styles.splitLapWrap}>
        {highlight && <Ionicons name="trophy" size={13} color={BRAND} style={{ marginRight: 4 }} />}
        <Text style={[styles.splitLap, highlight && { color: BRAND, fontWeight: '800' }]}>
          Lap {split.lap}
        </Text>
      </View>
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
      {/* 2026-09-24: training-timer.tsxと同じ実機バグ(fullScreenModal提示時にinsets.topが
          0で返ることがある)への対応。最低保証値でステータスバー下まで確実に押し下げる。 */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 50) + 8 }]}>
        <TouchableOpacity
          style={styles.headerBack}
          accessibilityLabel={t('timer.closeLabel')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
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

      {/* 2026-09-13: 「もっといいデザインにして」との指示で全面刷新。
          数字がむき出しで背景に浮いていただけだったのを、影付きの白カードに収めて
          存在感を出し、左右の副ボタンも「アイコン+文字が浮いているだけ」から
          塗りつぶしの丸ボタンに変えてタップ対象であることを分かりやすくした。
          中央ボタンはtraining-timer.tsxで確立した「濃色ボーダー+強めの影」の
          立体感を流用し、2画面の見た目を揃えている(timer-hub.tsxで並んで案内されるため) */}
      <View style={styles.watchCardWrap}>
        <View style={styles.watchCard}>
          <Text style={styles.watchLabel}>
            {timerState === 'running' ? t('timer.statusRunning') : timerState === 'paused' ? t('timer.statusPaused') : t('timer.statusReady')}
          </Text>
          <Text style={styles.watchText}>{formatStopwatch(displayMs)}</Text>
        </View>
      </View>

      {/* コントロールボタン */}
      <View style={styles.controlRow}>
        {/* 左: リセット or スプリット */}
        {timerState === 'idle' ? (
          <View style={styles.sideButtonSlot} />
        ) : timerState === 'running' ? (
          <View style={styles.sideButtonSlot}>
            <PressableScale onPress={handleSplit} scaleAmount={0.92} haptic="light" style={styles.sideButtonPressable} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <View style={styles.sideButton}>
                <Ionicons name="flag" size={20} color={colors.text} />
              </View>
              <Text style={styles.sideButtonText}>{t('timer.split')}</Text>
            </PressableScale>
          </View>
        ) : (
          <View style={styles.sideButtonSlot}>
            <PressableScale onPress={handleReset} scaleAmount={0.92} haptic="light" style={styles.sideButtonPressable} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <View style={styles.sideButton}>
                <Ionicons name="refresh" size={20} color={colors.text} />
              </View>
              <Text style={styles.sideButtonText}>{t('timer.reset')}</Text>
            </PressableScale>
          </View>
        )}

        {/* 中央: 開始/停止 */}
        <PressableScale
          onPress={
            timerState === 'idle' ? handleStart
            : timerState === 'running' ? handlePause
            : handleResume
          }
          scaleAmount={0.94}
          haptic="medium"
          accessibilityLabel={timerState === 'running' ? t('timer.pauseLabel') : timerState === 'paused' ? t('timer.resumeLabel') : t('timer.startLabel')}
        >
          <View style={[
            styles.mainButton,
            timerState === 'running' ? styles.mainButtonPause : styles.mainButtonStart,
          ]}>
            <Ionicons
              name={timerState === 'running' ? 'pause' : 'play'}
              size={34}
              color="#FFFFFF"
            />
          </View>
        </PressableScale>

        {/* 右: 空 (対称レイアウト用) */}
        <View style={styles.sideButtonSlot} />
      </View>

      {/* スプリット一覧 */}
      <ScrollView
        style={styles.splitList}
        contentContainerStyle={styles.splitListContent}
        showsVerticalScrollIndicator={false}
      >
        {splits.length === 0 ? (
          <View style={styles.splitsEmpty}>
            <View style={styles.splitsEmptyIconWrap}>
              <Ionicons name="flag-outline" size={26} color={BRAND} />
            </View>
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
    // 2026-09-13バグ修正: rgba(0,0,0,...)固定だったためダークモードで見えなくなっていた。
    // colors.border(テーマ側のトークン)に差し替えて両テーマで正しく見えるようにした
    borderBottomColor: colors.border,
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
  // 2026-09-13: 数字が背景に裸で浮いているだけだったのを、影付きのカードに収めて
  // 画面の主役としての存在感を出した(training-timer.tsxのカード刷新と揃えた見た目)
  watchCardWrap: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  watchCard: {
    backgroundColor: colors.surface,
    borderRadius: 28,
    paddingVertical: 36,
    alignItems: 'center',
    gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 18, elevation: 6,
  },
  watchLabel: {
    color: colors.textHint,
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  watchText: {
    color: colors.text,
    fontSize: 64,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },

  // コントロールボタン
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
    marginTop: 28,
    marginBottom: 32,
  },
  sideButtonSlot: {
    width: 72,
    alignItems: 'center',
  },
  sideButtonPressable: {
    alignItems: 'center',
    gap: 6,
  },
  // 2026-09-13: 「アイコン+文字が浮いているだけ」から塗りつぶしの丸ボタンに変更し、
  // タップ対象であることを見た目で分かるようにした
  // 2026-09-14バグ修正:「スプリットボタンが埋もれて押せない」との実機報告。機能自体は
  // 正常(handleSplitは動作確認済み)だったため、原因はcolors.surface2(#f0f2f5)と
  // 画面背景colors.bg(#f6f6f8)の差がRGBで数ポイントしか無く、ボタンが画面に溶け込んで
  // 見えていたこと(=タップ対象の位置が視認しづらく、正確に狙えていなかった)と判断。
  // 白背景+影で他のボタン類と同じ「浮いて見える」立体感を持たせ、はっきり独立した
  // タップ対象だとわかるようにする。
  sideButton: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 6, elevation: 3,
  },
  sideButtonText: {
    color: colors.textSec,
    fontSize: 12,
    fontWeight: '600',
  },
  // 2026-09-13: training-timer.tsxで確立した「濃色ボーダー+強めの影」の立体感を流用し、
  // 2画面(timer-hub.tsxで並んで案内される)の見た目を揃えた
  mainButton: {
    width: 92, height: 92, borderRadius: 46,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderBottomWidth: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 14, elevation: 8,
  },
  mainButtonStart: {
    backgroundColor: BRAND,
    borderColor: BRAND,
    borderBottomColor: '#0f4525',
  },
  mainButtonPause: {
    backgroundColor: '#d97706',
    borderColor: '#d97706',
    borderBottomColor: '#92400e',
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
    borderBottomColor: colors.border,
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
    borderBottomColor: colors.border,
  },
  // 2026-09-13: 最速ラップの目印を、行全体のうっすらした塗り(気づきにくい)から
  // 左端の色帯+トロフィーアイコンに変更(SplitRowコンポーネント側で追加)
  splitRowHighlight: {
    backgroundColor: `${BRAND}0d`,
  },
  splitRowAccent: {
    position: 'absolute', left: 0, top: 6, bottom: 6, width: 3,
    backgroundColor: BRAND, borderRadius: 2,
  },
  splitLapWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  splitLap: {
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
  splitsEmptyIconWrap: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: `${BRAND}14`,
    alignItems: 'center', justifyContent: 'center',
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
    borderColor: colors.border,
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
    borderColor: colors.border,
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

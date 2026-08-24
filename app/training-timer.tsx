// app/training-timer.tsx — トレーニング用タイマー（インターバル／通常）
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Crypto from 'expo-crypto'
import SimpleSlider from '../components/SimpleSlider'
import { unlockAudio, Sounds, preloadStarterSounds, playTimerBeep, playTimerEnd } from '../lib/sounds'
import { todayLocalISO } from '../lib/dateLocal'
import {
  getTimerSettings, saveTimerSettings, TIMER_DEFAULTS, type TrainingTimerSettings, type TimerMode,
  getTimerHistory, addTimerHistory, type TimerHistoryEntry,
} from '../lib/trainingTimerSettings'

const BRAND = '#16a34a'
const REST_COLOR = '#f59e0b'
const SET_REST_COLOR = '#3b82f6'
const BG = '#f6f6f8'
const CARD = '#ffffff'
const BORDER = 'rgba(0,0,0,0.08)'
const TEXT_PRIMARY = '#111827'
const TEXT_SECONDARY = '#6b7280'
const TEXT_HINT = '#9ca3af'

type Phase = 'idle' | 'work' | 'rest' | 'setRest' | 'done'

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function TrainingTimerScreen() {
  const router = useRouter()
  const [settings, setSettings] = useState<TrainingTimerSettings>(TIMER_DEFAULTS)
  const [loaded, setLoaded] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [remaining, setRemaining] = useState(0)
  const [paused, setPaused] = useState(false)
  const [curSet, setCurSet] = useState(1)
  const [curRep, setCurRep] = useState(1)
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [historyVisible, setHistoryVisible] = useState(false)
  const [history, setHistory] = useState<TimerHistoryEntry[]>([])

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stateRef = useRef({ phase: 'idle' as Phase, curSet: 1, curRep: 1 })

  useEffect(() => {
    preloadStarterSounds().catch(() => {})
    getTimerSettings().then(s => { setSettings(s); setLoaded(true) })
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  const stopTick = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
  }, [])

  const finish = useCallback(async () => {
    stopTick()
    setPhase('done')
    stateRef.current.phase = 'done'
    playTimerEnd()
    await addTimerHistory({
      id: Crypto.randomUUID(), date: todayLocalISO(), mode: settings.mode,
      workSec: settings.workSec, restSec: settings.restSec, reps: settings.reps, sets: settings.sets,
      completed: true,
    })
  }, [settings, stopTick])

  const advance = useCallback(() => {
    const s = settings
    const cur = stateRef.current

    if (s.mode === 'normal') { finish(); return }

    if (cur.phase === 'work') {
      const moreReps = cur.curRep < s.reps
      if (moreReps) {
        stateRef.current = { ...cur, phase: 'rest' }
        setPhase('rest'); setRemaining(s.restSec)
        playTimerBeep()
      } else {
        const moreSets = cur.curSet < s.sets
        if (moreSets) {
          stateRef.current = { phase: 'setRest', curSet: cur.curSet, curRep: cur.curRep }
          setPhase('setRest'); setRemaining(s.restBetweenSetsSec)
          playTimerBeep()
        } else {
          finish()
        }
      }
    } else if (cur.phase === 'rest') {
      const nextRep = cur.curRep + 1
      stateRef.current = { phase: 'work', curSet: cur.curSet, curRep: nextRep }
      setCurRep(nextRep); setPhase('work'); setRemaining(s.workSec)
      playTimerBeep()
    } else if (cur.phase === 'setRest') {
      const nextSet = cur.curSet + 1
      stateRef.current = { phase: 'work', curSet: nextSet, curRep: 1 }
      setCurSet(nextSet); setCurRep(1); setPhase('work'); setRemaining(s.workSec)
      playTimerBeep()
    }
  }, [settings, finish])

  const startTick = useCallback(() => {
    stopTick()
    intervalRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) { advance(); return 0 }
        return prev - 1
      })
    }, 1000)
  }, [advance, stopTick])

  const handleStart = useCallback(() => {
    unlockAudio()
    const s = settings
    stateRef.current = { phase: 'work', curSet: 1, curRep: 1 }
    setCurSet(1); setCurRep(1); setPhase('work'); setRemaining(s.workSec); setPaused(false)
    playTimerBeep()
    startTick()
  }, [settings, startTick])

  const handlePauseResume = useCallback(() => {
    unlockAudio(); Sounds.tap()
    if (paused) { setPaused(false); startTick() }
    else { setPaused(true); stopTick() }
  }, [paused, startTick, stopTick])

  const handleReset = useCallback(() => {
    unlockAudio(); Sounds.tap()
    stopTick()
    stateRef.current = { phase: 'idle', curSet: 1, curRep: 1 }
    setPhase('idle'); setRemaining(0); setPaused(false); setCurSet(1); setCurRep(1)
  }, [stopTick])

  const openHistory = useCallback(async () => {
    setHistory(await getTimerHistory())
    setHistoryVisible(true)
  }, [])

  const updateSettings = useCallback((patch: Partial<TrainingTimerSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      saveTimerSettings(next)
      return next
    })
  }, [])

  if (!loaded) return <View style={{ flex: 1, backgroundColor: BG }} />

  const running = phase !== 'idle' && phase !== 'done'
  const phaseColor = phase === 'work' ? BRAND : phase === 'rest' ? REST_COLOR : phase === 'setRest' ? SET_REST_COLOR : phase === 'done' ? BRAND : TEXT_HINT
  const phaseLabel = phase === 'work' ? 'トレーニング' : phase === 'rest' ? '休憩' : phase === 'setRest' ? 'セット間休憩' : phase === 'done' ? '完了！' : ''

  return (
    <SafeAreaView style={tt.safe} edges={['top', 'bottom']}>
      <View style={tt.header}>
        <TouchableOpacity onPress={() => router.back()} style={tt.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityLabel="戻る">
          <Ionicons name="chevron-back" size={26} color={TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={tt.headerTitle}>タイマー</Text>
        <TouchableOpacity onPress={() => setSettingsVisible(true)} style={tt.editBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={tt.editBtnText}>編集</Text>
        </TouchableOpacity>
      </View>

      <View style={tt.modeRow}>
        {([
          { key: 'interval' as TimerMode, label: 'インターバル' },
          { key: 'normal' as TimerMode,   label: '通常' },
        ]).map(m => (
          <TouchableOpacity
            key={m.key}
            style={[tt.modeBtn, settings.mode === m.key && tt.modeBtnActive]}
            disabled={running}
            onPress={() => { unlockAudio(); Sounds.tabSwitch(); updateSettings({ mode: m.key }) }}
            activeOpacity={0.8}
          >
            <Text style={[tt.modeText, settings.mode === m.key && tt.modeTextActive]}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={tt.body}>
        {phase !== 'idle' && <Text style={[tt.phaseLabel, { color: phaseColor }]}>{phaseLabel}</Text>}
        <View style={[tt.circle, { borderColor: phaseColor, backgroundColor: phaseColor + '14' }]}>
          {phase === 'idle' ? (
            <>
              <Text style={tt.idleSummary}>{settings.mode === 'interval' ? `${settings.workSec}秒 × ${settings.reps}回 × ${settings.sets}セット` : `${settings.workSec}秒`}</Text>
              <TouchableOpacity style={tt.startBtn} onPress={handleStart} activeOpacity={0.85}>
                <Ionicons name="play" size={22} color="#fff" />
              </TouchableOpacity>
            </>
          ) : (
            <Text style={[tt.timeText, { color: phaseColor }]}>{phase === 'done' ? '🎉' : formatTime(remaining)}</Text>
          )}
        </View>

        {settings.mode === 'interval' && phase !== 'idle' && (
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text style={tt.progressText}>セット {curSet}/{settings.sets}</Text>
            <Text style={tt.progressText}>{curRep}/{settings.reps} 回</Text>
          </View>
        )}
      </View>

      <View style={tt.btnRow}>
        <TouchableOpacity style={tt.secondaryBtn} onPress={handleReset} activeOpacity={0.8}>
          <Text style={tt.secondaryBtnText}>リセット</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[tt.primaryBtn, !running && { opacity: 0.4 }]}
          onPress={handlePauseResume}
          disabled={!running}
          activeOpacity={0.85}
        >
          <Text style={tt.primaryBtnText}>{paused ? '再開' : '一時停止'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={tt.secondaryBtn} onPress={openHistory} activeOpacity={0.8}>
          <Text style={tt.secondaryBtnText}>履歴</Text>
        </TouchableOpacity>
      </View>

      {/* ── 設定モーダル ── */}
      <Modal visible={settingsVisible} animationType="slide" transparent onRequestClose={() => setSettingsVisible(false)}>
        <View style={tt.modalOverlay}>
          <View style={tt.modalCard}>
            <View style={tt.modalHeader}>
              <Text style={tt.modalTitle}>タイマー設定</Text>
              <TouchableOpacity onPress={() => setSettingsVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={24} color={TEXT_PRIMARY} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ gap: 18 }}>
              <SettingSlider label="実施時間" value={settings.workSec} min={5} max={180} step={5} unit="秒" onChange={(v) => updateSettings({ workSec: v })} />
              {settings.mode === 'interval' && (
                <>
                  <SettingStepper label="回数" value={settings.reps} min={1} max={30} onChange={(v) => updateSettings({ reps: v })} />
                  <SettingSlider label="回の間の休憩" value={settings.restSec} min={0} max={180} step={5} unit="秒" onChange={(v) => updateSettings({ restSec: v })} />
                  <SettingStepper label="セット数" value={settings.sets} min={1} max={10} onChange={(v) => updateSettings({ sets: v })} />
                  <SettingSlider label="セット間の休憩" value={settings.restBetweenSetsSec} min={0} max={300} step={10} unit="秒" onChange={(v) => updateSettings({ restBetweenSetsSec: v })} />
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── 履歴モーダル ── */}
      <Modal visible={historyVisible} animationType="slide" transparent onRequestClose={() => setHistoryVisible(false)}>
        <View style={tt.modalOverlay}>
          <View style={tt.modalCard}>
            <View style={tt.modalHeader}>
              <Text style={tt.modalTitle}>履歴</Text>
              <TouchableOpacity onPress={() => setHistoryVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={24} color={TEXT_PRIMARY} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ gap: 8 }}>
              {history.length === 0 ? (
                <Text style={{ color: TEXT_HINT, fontSize: 13, textAlign: 'center', paddingVertical: 30 }}>まだ履歴がありません</Text>
              ) : history.map(h => (
                <View key={h.id} style={tt.historyRow}>
                  <Text style={tt.historyDate}>{h.date}</Text>
                  <Text style={tt.historySub}>
                    {h.mode === 'interval' ? `${h.workSec}秒 × ${h.reps}回 × ${h.sets}セット` : `通常 ${h.workSec}秒`}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function SettingSlider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void
}) {
  return (
    <View>
      <View style={tt.settingRow}>
        <Text style={tt.settingLabel}>{label}</Text>
        <Text style={tt.settingValue}>{value}{unit}</Text>
      </View>
      <SimpleSlider value={value} min={min} max={max} step={step} color={BRAND} onChange={onChange} />
    </View>
  )
}

function SettingStepper({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void
}) {
  return (
    <View style={tt.settingRow}>
      <Text style={tt.settingLabel}>{label}</Text>
      <View style={tt.stepper}>
        <TouchableOpacity style={tt.stepperBtn} onPress={() => onChange(Math.max(min, value - 1))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="remove" size={16} color={TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={tt.stepperValue}>{value}</Text>
        <TouchableOpacity style={tt.stepperBtn} onPress={() => onChange(Math.min(max, value + 1))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="add" size={16} color={TEXT_PRIMARY} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

const CIRCLE_SIZE = 260

const tt = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: BG },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT_PRIMARY },
  editBtn:     { paddingHorizontal: 14, paddingVertical: 8 },
  editBtnText: { fontSize: 15, fontWeight: '700', color: '#3b82f6' },

  modeRow:     { flexDirection: 'row', marginHorizontal: 16, backgroundColor: '#eef0f3', borderRadius: 14, padding: 3, gap: 3 },
  modeBtn:     { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' },
  modeBtnActive: { backgroundColor: CARD, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  modeText:    { fontSize: 13, fontWeight: '700', color: TEXT_SECONDARY },
  modeTextActive: { color: TEXT_PRIMARY },

  body:        { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
  phaseLabel:  { fontSize: 18, fontWeight: '800' },
  circle: {
    width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 3, alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  timeText:    { fontSize: 52, fontWeight: '900', fontVariant: ['tabular-nums'] },
  idleSummary: { fontSize: 14, fontWeight: '700', color: TEXT_SECONDARY, textAlign: 'center', paddingHorizontal: 24 },
  startBtn:    { width: 64, height: 64, borderRadius: 32, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
  progressText:{ fontSize: 14, fontWeight: '700', color: TEXT_SECONDARY },

  btnRow:      { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 16 },
  secondaryBtn:{ flex: 1, backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER, borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  secondaryBtnText: { fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY },
  primaryBtn:  { flex: 1.4, backgroundColor: '#fff', borderWidth: 1.5, borderColor: TEXT_PRIMARY, borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { fontSize: 14, fontWeight: '800', color: TEXT_PRIMARY },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard:   { backgroundColor: BG, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '75%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle:  { fontSize: 17, fontWeight: '800', color: TEXT_PRIMARY },

  settingRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  settingLabel:{ fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY },
  settingValue:{ fontSize: 15, fontWeight: '800', color: BRAND, fontVariant: ['tabular-nums'] },
  stepper:     { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepperBtn:  { width: 30, height: 30, borderRadius: 15, backgroundColor: '#eef0f3', alignItems: 'center', justifyContent: 'center' },
  stepperValue:{ fontSize: 16, fontWeight: '800', color: TEXT_PRIMARY, minWidth: 24, textAlign: 'center', fontVariant: ['tabular-nums'] },

  historyRow:  { backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER, borderRadius: 14, padding: 12 },
  historyDate: { fontSize: 13, fontWeight: '700', color: TEXT_PRIMARY },
  historySub:  { fontSize: 12, color: TEXT_HINT, marginTop: 2 },
})

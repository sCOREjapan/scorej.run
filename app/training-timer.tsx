// app/training-timer.tsx — トレーニング用タイマー（インターバル／通常）
// 2026-09-04: reaction-start.tsx/reaction-start-settings.tsxと統一した「タイミング系ツール」の
// ダーク基調デザインに刷新（配色・レイアウトを一新、機能・ロジックは不変）
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
import { useTranslation } from 'react-i18next'

const BG = '#171326'
const CARD = '#231d38'
const BORDER = 'rgba(255,255,255,0.08)'
const TEXT_PRIMARY = '#ffffff'
const TEXT_SECONDARY = '#b5aed0'
const TEXT_HINT = '#8b85a8'
const IDLE_COLOR = '#8b85a8'
const BRAND = '#22d3ee'        // work（シアン）
const REST_COLOR = '#fb923c'   // rest（オレンジ）
const SET_REST_COLOR = '#a78bfa' // setRest（バイオレット）

type Phase = 'idle' | 'work' | 'rest' | 'setRest' | 'done'

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function TrainingTimerScreen() {
  const router = useRouter()
  const { t } = useTranslation()
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
  const phaseColor = phase === 'work' ? BRAND : phase === 'rest' ? REST_COLOR : phase === 'setRest' ? SET_REST_COLOR : phase === 'done' ? BRAND : IDLE_COLOR
  const phaseLabel = phase === 'work' ? t('trainingTimer.phaseWork') : phase === 'rest' ? t('trainingTimer.phaseRest') : phase === 'setRest' ? t('trainingTimer.phaseSetRest') : phase === 'done' ? t('trainingTimer.phaseDone') : ''

  const STEPS: { key: Exclude<Phase, 'idle' | 'done'>; label: string; color: string }[] = [
    { key: 'work', label: t('trainingTimer.phaseWork'), color: BRAND },
    { key: 'rest', label: t('trainingTimer.phaseRest'), color: REST_COLOR },
    { key: 'setRest', label: t('trainingTimer.phaseSetRest'), color: SET_REST_COLOR },
  ]

  return (
    <SafeAreaView style={tt.safe} edges={['top', 'bottom']}>
      <View style={tt.header}>
        <TouchableOpacity onPress={() => router.back()} style={tt.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityLabel={t('trainingTimer.backLabel')}>
          <Ionicons name="chevron-back" size={26} color={TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={tt.headerTitle}>{t('trainingTimer.headerTitle')}</Text>
        <TouchableOpacity onPress={() => setSettingsVisible(true)} style={tt.editBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={tt.editBtnText}>{t('trainingTimer.edit')}</Text>
        </TouchableOpacity>
      </View>

      <View style={tt.modeRow}>
        {([
          { key: 'interval' as TimerMode, label: t('trainingTimer.modeInterval') },
          { key: 'normal' as TimerMode,   label: t('trainingTimer.modeNormal') },
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
        {settings.mode === 'interval' && (
          <View style={tt.stepBar}>
            {STEPS.map(stg => {
              const active = phase === stg.key
              return (
                <View key={stg.key} style={tt.stepSegmentWrap}>
                  <View style={[tt.stepSegment, active && { backgroundColor: stg.color }]} />
                  <Text style={[tt.stepLabel, active && { color: stg.color, fontWeight: '800' }]}>{stg.label}</Text>
                </View>
              )
            })}
          </View>
        )}

        <View style={[tt.card, { borderColor: phaseColor, backgroundColor: phaseColor + '14' }]}>
          {phase === 'idle' ? (
            <>
              <Text style={tt.idleSummary}>{settings.mode === 'interval' ? t('trainingTimer.idleSummaryInterval', { work: settings.workSec, reps: settings.reps, sets: settings.sets }) : t('trainingTimer.idleSummaryNormal', { work: settings.workSec })}</Text>
              <TouchableOpacity style={tt.startBtn} onPress={handleStart} activeOpacity={0.85}>
                <Ionicons name="play" size={24} color="#171326" />
              </TouchableOpacity>
            </>
          ) : (
            <>
              {phase !== 'done' && <Text style={[tt.phaseLabel, { color: phaseColor }]}>{phaseLabel}</Text>}
              <Text style={[tt.timeText, { color: phaseColor }]}>{phase === 'done' ? '🎉' : formatTime(remaining)}</Text>
              {settings.mode === 'interval' && (
                <View style={tt.progressRow}>
                  <View style={tt.progressBadge}><Text style={tt.progressBadgeText}>{t('trainingTimer.setProgress', { cur: curSet, total: settings.sets })}</Text></View>
                  <View style={tt.progressBadge}><Text style={tt.progressBadgeText}>{t('trainingTimer.repProgress', { cur: curRep, total: settings.reps })}</Text></View>
                </View>
              )}
            </>
          )}
        </View>
      </View>

      <View style={tt.btnRow}>
        <TouchableOpacity style={tt.secondaryBtn} onPress={handleReset} activeOpacity={0.8}>
          <Text style={tt.secondaryBtnText}>{t('trainingTimer.reset')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[tt.primaryBtn, !running && { opacity: 0.35 }]}
          onPress={handlePauseResume}
          disabled={!running}
          activeOpacity={0.85}
        >
          <Text style={tt.primaryBtnText}>{paused ? t('trainingTimer.resume') : t('trainingTimer.pause')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={tt.secondaryBtn} onPress={openHistory} activeOpacity={0.8}>
          <Text style={tt.secondaryBtnText}>{t('trainingTimer.history')}</Text>
        </TouchableOpacity>
      </View>

      {/* ── 設定モーダル ── */}
      <Modal visible={settingsVisible} animationType="slide" transparent onRequestClose={() => setSettingsVisible(false)}>
        <View style={tt.modalOverlay}>
          <View style={tt.modalCard}>
            <View style={tt.modalHeader}>
              <Text style={tt.modalTitle}>{t('trainingTimer.settingsTitle')}</Text>
              <TouchableOpacity onPress={() => setSettingsVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={24} color={TEXT_PRIMARY} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ gap: 18 }}>
              <SettingSlider label={t('trainingTimer.workDuration')} value={settings.workSec} min={5} max={180} step={5} unit={t('trainingTimer.sec')} onChange={(v) => updateSettings({ workSec: v })} />
              {settings.mode === 'interval' && (
                <>
                  <SettingStepper label={t('trainingTimer.reps')} value={settings.reps} min={1} max={30} onChange={(v) => updateSettings({ reps: v })} />
                  <SettingSlider label={t('trainingTimer.restBetweenReps')} value={settings.restSec} min={0} max={180} step={5} unit={t('trainingTimer.sec')} onChange={(v) => updateSettings({ restSec: v })} />
                  <SettingStepper label={t('trainingTimer.sets')} value={settings.sets} min={1} max={10} onChange={(v) => updateSettings({ sets: v })} />
                  <SettingSlider label={t('trainingTimer.restBetweenSets')} value={settings.restBetweenSetsSec} min={0} max={300} step={10} unit={t('trainingTimer.sec')} onChange={(v) => updateSettings({ restBetweenSetsSec: v })} />
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
              <Text style={tt.modalTitle}>{t('trainingTimer.historyTitle')}</Text>
              <TouchableOpacity onPress={() => setHistoryVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={24} color={TEXT_PRIMARY} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ gap: 8 }}>
              {history.length === 0 ? (
                <Text style={{ color: TEXT_HINT, fontSize: 13, textAlign: 'center', paddingVertical: 30 }}>{t('trainingTimer.noHistory')}</Text>
              ) : history.map(h => (
                <View key={h.id} style={tt.historyRow}>
                  <Text style={tt.historyDate}>{h.date}</Text>
                  <Text style={tt.historySub}>
                    {h.mode === 'interval' ? t('trainingTimer.historyInterval', { work: h.workSec, reps: h.reps, sets: h.sets }) : t('trainingTimer.historyNormal', { work: h.workSec })}
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
        <View style={tt.valueBadge}><Text style={tt.settingValue}>{value}{unit}</Text></View>
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

const tt = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: BG },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT_PRIMARY },
  editBtn:     { paddingHorizontal: 14, paddingVertical: 8 },
  editBtnText: { fontSize: 15, fontWeight: '700', color: '#38bdf8' },

  modeRow:     { flexDirection: 'row', marginHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 14, padding: 3, gap: 3 },
  modeBtn:     { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' },
  modeBtnActive: { backgroundColor: CARD },
  modeText:    { fontSize: 13, fontWeight: '700', color: TEXT_SECONDARY },
  modeTextActive: { color: TEXT_PRIMARY },

  body:        { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28, paddingHorizontal: 28, width: '100%' },

  stepBar:     { flexDirection: 'row', width: '100%', gap: 10 },
  stepSegmentWrap: { flex: 1, alignItems: 'center', gap: 8 },
  stepSegment: { width: '100%', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)' },
  stepLabel:   { fontSize: 11.5, fontWeight: '600', color: TEXT_HINT },

  card: {
    width: '100%', aspectRatio: 1.15, borderRadius: 32,
    borderWidth: 3, alignItems: 'center', justifyContent: 'center', gap: 14,
  },
  phaseLabel:  { fontSize: 16, fontWeight: '800' },
  timeText:    { fontSize: 52, fontWeight: '900', fontVariant: ['tabular-nums'] },
  idleSummary: { fontSize: 14, fontWeight: '700', color: TEXT_SECONDARY, textAlign: 'center', paddingHorizontal: 24 },
  startBtn:    { width: 64, height: 64, borderRadius: 32, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
  progressRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  progressBadge: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  progressBadgeText: { fontSize: 13, fontWeight: '700', color: TEXT_SECONDARY },

  btnRow:      { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 16 },
  secondaryBtn:{ flex: 1, backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER, borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  secondaryBtnText: { fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY },
  primaryBtn:  { flex: 1.4, backgroundColor: BRAND, borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { fontSize: 14, fontWeight: '800', color: '#171326' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalCard:   { backgroundColor: BG, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '75%', borderWidth: 1, borderColor: BORDER, borderBottomWidth: 0 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle:  { fontSize: 17, fontWeight: '800', color: TEXT_PRIMARY },

  settingRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  settingLabel:{ fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY },
  valueBadge:  { backgroundColor: 'rgba(34,211,238,0.16)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  settingValue:{ fontSize: 15, fontWeight: '800', color: BRAND, fontVariant: ['tabular-nums'] },
  stepper:     { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepperBtn:  { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  stepperValue:{ fontSize: 16, fontWeight: '800', color: TEXT_PRIMARY, minWidth: 24, textAlign: 'center', fontVariant: ['tabular-nums'] },

  historyRow:  { backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER, borderRadius: 14, padding: 12 },
  historyDate: { fontSize: 13, fontWeight: '700', color: TEXT_PRIMARY },
  historySub:  { fontSize: 12, color: TEXT_HINT, marginTop: 2 },
})

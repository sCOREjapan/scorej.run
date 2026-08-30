// app/starter.tsx — スタート合図練習ツール（On your marks → Set → 号砲）
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import {
  unlockAudio, preloadStarterSounds,
  playStarterMarksCue, playStarterSetCue, playStarterGunCue,
} from '../lib/sounds'
import { getStarterSettings, randomGunDelayMs, type StarterSettings, STARTER_DEFAULTS } from '../lib/starterSettings'
import { useTranslation } from 'react-i18next'

const BG = '#f6f6f8'
const TEXT_PRIMARY = '#111827'
const TEXT_HINT = '#9ca3af'
const IDLE_COLOR  = '#9ca3af'
const MARKS_COLOR = '#f59e0b'
const SET_COLOR   = '#f97316'
const GO_COLOR    = '#16a34a'

type Phase = 'idle' | 'marks' | 'set' | 'go'

const STAGES: { key: Exclude<Phase, 'idle'>; label: string; color: string }[] = [
  { key: 'marks', label: 'On your marks', color: MARKS_COLOR },
  { key: 'set',   label: 'Set',           color: SET_COLOR },
  { key: 'go',    label: 'GO!',           color: GO_COLOR },
]

// idleだけ言語依存(他はOn your marks/Set/GO!という国際共通の陸上競技号令なので不変)。
// t()はレンダー内でしか呼べないため、idleは空にしておきコンポーネント側で差し替える
const PHASE_TEXT: Record<Phase, string> = {
  idle:  '',
  marks: 'On your marks',
  set:   'Set',
  go:    'GO!',
}
const PHASE_COLOR: Record<Phase, string> = {
  idle: IDLE_COLOR, marks: MARKS_COLOR, set: SET_COLOR, go: GO_COLOR,
}

export default function StarterScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('idle')
  const [running, setRunning] = useState(false)
  const settingsRef = useRef<StarterSettings>(STARTER_DEFAULTS)
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    preloadStarterSounds().catch(() => {})
    getStarterSettings().then(s => { settingsRef.current = s })
    return () => clearAll()
  }, [])

  function clearAll() {
    timeoutsRef.current.forEach(clearTimeout)
    timeoutsRef.current = []
  }

  const handleStart = useCallback(() => {
    unlockAudio()
    if (running) return
    clearAll()
    setRunning(true)
    setPhase('idle')
    const s = settingsRef.current

    const t1 = setTimeout(() => {
      setPhase('marks')
      playStarterMarksCue()

      const t2 = setTimeout(() => {
        setPhase('set')
        playStarterSetCue()

        const gunDelayMs = s.gunRandom ? randomGunDelayMs() : s.gunFixedSec * 1000
        const t3 = setTimeout(() => {
          setPhase('go')
          playStarterGunCue()

          const t4 = setTimeout(() => {
            setPhase('idle')
            setRunning(false)
          }, 2500)
          timeoutsRef.current.push(t4)
        }, gunDelayMs)
        timeoutsRef.current.push(t3)
      }, s.marksToSetSec * 1000)
      timeoutsRef.current.push(t2)
    }, s.startToMarksSec * 1000)
    timeoutsRef.current.push(t1)
  }, [running])

  const handleCancel = useCallback(() => {
    clearAll()
    setRunning(false)
    setPhase('idle')
  }, [])

  const color = PHASE_COLOR[phase]

  return (
    <SafeAreaView style={ss.safe} edges={['top', 'bottom']}>
      <View style={ss.header}>
        <TouchableOpacity onPress={() => router.back()} style={ss.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityLabel={t('starter.backLabel')}>
          <Ionicons name="chevron-back" size={26} color={TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={ss.headerTitle}>{t('starter.headerTitle')}</Text>
        <TouchableOpacity onPress={() => router.push('/starter-settings' as any)} style={ss.editBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={ss.editBtnText}>{t('starter.edit')}</Text>
        </TouchableOpacity>
      </View>

      <View style={ss.body}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={running ? undefined : handleStart}
          disabled={running}
          style={[ss.circle, { borderColor: color, backgroundColor: color + '14' }]}
        >
          <Text style={[ss.circleText, { color }]}>{phase === 'idle' ? t('starter.idle') : PHASE_TEXT[phase]}</Text>
          {running && (
            <TouchableOpacity onPress={handleCancel} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={ss.cancelText}>{t('starter.cancel')}</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>

        <View style={ss.stagesRow}>
          {STAGES.map(stg => {
            const active = phase === stg.key
            return (
              <View key={stg.key} style={ss.stageItem}>
                <View style={[ss.stageDot, { borderColor: stg.color }, active && { backgroundColor: stg.color }]} />
                <Text style={[ss.stageLabel, active && { color: stg.color, fontWeight: '800' }]}>{stg.label}</Text>
              </View>
            )
          })}
        </View>
      </View>
    </SafeAreaView>
  )
}

const CIRCLE_SIZE = 280

const ss = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: BG },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT_PRIMARY },
  editBtn:     { paddingHorizontal: 14, paddingVertical: 8 },
  editBtnText: { fontSize: 15, fontWeight: '700', color: '#3b82f6' },
  body:        { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 40, paddingBottom: 40 },
  circle: {
    width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 3, alignItems: 'center', justifyContent: 'center', gap: 14,
  },
  circleText:  { fontSize: 26, fontWeight: '800', textAlign: 'center', paddingHorizontal: 20 },
  cancelText:  { fontSize: 14, fontWeight: '600', color: TEXT_HINT },
  stagesRow:   { flexDirection: 'row', gap: 40 },
  stageItem:   { alignItems: 'center', gap: 6 },
  stageDot:    { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  stageLabel:  { fontSize: 12, fontWeight: '600', color: TEXT_HINT },
})

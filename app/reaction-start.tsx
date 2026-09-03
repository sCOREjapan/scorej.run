// app/reaction-start.tsx — スタート反応練習ツール（On your marks → Set → 号砲）
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

// 2026-09-03: 配色を全面的に刷新（暖色系グラデーション基調に変更）
const BG = '#171326'
const TEXT_PRIMARY = '#ffffff'
const TEXT_HINT = '#8b85a8'
const IDLE_COLOR  = '#8b85a8'
const MARKS_COLOR = '#38bdf8'
const SET_COLOR   = '#fb923c'
const GO_COLOR    = '#f43f5e'

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
        <TouchableOpacity onPress={() => router.push('/reaction-start-settings' as any)} style={ss.editBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={ss.editBtnText}>{t('starter.edit')}</Text>
        </TouchableOpacity>
      </View>

      <View style={ss.body}>
        {/* 進行状況は上部の横長ステップバーで表現（丸ドット→バー形式に変更） */}
        <View style={ss.stepBar}>
          {STAGES.map((stg, i) => {
            const active = phase === stg.key
            const passed = STAGES.findIndex(s => s.key === phase) > i
            return (
              <View key={stg.key} style={ss.stepSegmentWrap}>
                <View style={[ss.stepSegment, (active || passed) && { backgroundColor: stg.color }]} />
                <Text style={[ss.stepLabel, active && { color: stg.color, fontWeight: '800' }]}>{stg.label}</Text>
              </View>
            )
          })}
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={running ? undefined : handleStart}
          disabled={running}
          style={[ss.card, { borderColor: color, backgroundColor: color + '14' }]}
        >
          <Text style={[ss.cardText, { color }]}>{phase === 'idle' ? t('starter.idle') : PHASE_TEXT[phase]}</Text>
          {running && (
            <TouchableOpacity onPress={handleCancel} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={ss.cancelBadge}>
              <Text style={ss.cancelText}>{t('starter.cancel')}</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const ss = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: BG },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT_PRIMARY },
  editBtn:     { paddingHorizontal: 14, paddingVertical: 8 },
  editBtnText: { fontSize: 15, fontWeight: '700', color: '#3b82f6' },
  body:        { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 36, paddingBottom: 40, paddingHorizontal: 28, width: '100%' },
  stepBar:     { flexDirection: 'row', width: '100%', gap: 10 },
  stepSegmentWrap: { flex: 1, alignItems: 'center', gap: 8 },
  stepSegment: { width: '100%', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)' },
  stepLabel:   { fontSize: 11.5, fontWeight: '600', color: TEXT_HINT },
  card: {
    width: '100%', aspectRatio: 1.15, borderRadius: 32,
    borderWidth: 3, alignItems: 'center', justifyContent: 'center', gap: 14,
  },
  cardText:    { fontSize: 30, fontWeight: '800', textAlign: 'center', paddingHorizontal: 20 },
  cancelBadge: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)' },
  cancelText:  { fontSize: 14, fontWeight: '600', color: TEXT_HINT },
})

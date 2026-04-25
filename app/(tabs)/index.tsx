// app/(tabs)/index.tsx — シンプルホーム（ゲーミフィケーション + 改善タスク + 総合リスク）
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import {
  ActivityIndicator, Animated, Easing, Modal,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../context/ThemeContext'
import { useTrainingSessions } from '../../hooks/useTrainingSessions'
import { calcInjuryRisk } from '../../lib/injuryRisk'
import { calcRecoveryStatus } from '../../lib/fatigue'
import { calcLevelInfo } from '../../lib/gamification'
import GlassCard from '../../components/GlassCard'
import PressableScale from '../../components/PressableScale'
import { BRAND, TEXT, NEON, SURFACE, SURFACE2, DIVIDER } from '../../lib/theme'
import { Sounds, unlockAudio } from '../../lib/sounds'
import Logo from '../../components/Logo'
import PWAInstallPrompt from '../../components/PWAInstallPrompt'
import QuickLogModal from '../../components/QuickLogModal'
import StretchHoldButton from '../../components/StretchHoldButton'
import { registerHomeScroll, unregisterHomeScroll } from '../../lib/homeScroll'
import { setQuickLogListener, clearQuickLogListener } from '../../lib/quickLogEvent'
import { getCurrentLocationWeather } from '../../lib/weather'
import { calcWeatherRiskBonus, getWeatherRiskText } from '../../lib/weatherRisk'
import type { SleepRecord } from '../../types'

// ── AsyncStorage keys ───────────────────────────────────
const CONDITION_KEY     = 'trackmate_condition'      // 旧フォーマット（マイグレーション用）
const CONDITION_MAP_KEY = 'trackmate_condition_map'  // 新フォーマット: { "2026-04-15": 6, ... }
const STRETCH_RESULT_KEY = 'trackmate_stretch_result'
const SLEEP_KEY         = 'trackmate_sleep'
const RECOVERY_KEY  = 'trackmate_recovery_records'
const TASKS_KEY     = 'trackmate_tasks'
const GOALS_KEY     = 'trackmate_goals'

export interface Goal {
  id: string
  text: string
  deadline?: string   // ISO date "YYYY-MM-DD"
  progress: number    // 0-100
  achieved: boolean
  created_at: string
}

export interface ImprovementTask {
  id: string
  text: string
  completed: boolean
  created_at: string
}

// ── 定数 ────────────────────────────────────────────────
const SESSION_TYPE_LABEL: Record<string, string> = {
  interval: 'インターバル', tempo: 'テンポ走', easy: 'ジョグ',
  long: 'ロング走', sprint: 'スプリント', drill: 'ドリル',
  strength: 'ウェイト', race: '試合', rest: '休養',
}

const CONDITION_EMOJIS = [
  { emoji: '😫', label: 'きつい',   value: 2 },
  { emoji: '😕', label: 'しんどい', value: 4 },
  { emoji: '😐', label: 'ふつう',   value: 6 },
  { emoji: '😊', label: 'いい感じ', value: 8 },
  { emoji: '💪', label: '絶好調',   value: 10 },
] as const

const MOCK_USER_ID = 'mock-user-1'

// ────────────────────────────────────────────────────────
// AnimatedEntry
// ────────────────────────────────────────────────────────
function AnimatedEntry({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const fadeY = useRef(new Animated.Value(0)).current
  useFocusEffect(
    useCallback(() => {
      fadeY.setValue(0)
      const anim = Animated.timing(fadeY, {
        toValue: 1, duration: 420, delay,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      })
      anim.start()
      return () => anim.stop()
    }, [delay])
  )
  return (
    <Animated.View style={{
      opacity: fadeY,
      transform: [{ translateY: fadeY.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
    }}>
      {children}
    </Animated.View>
  )
}

// ────────────────────────────────────────────────────────
// WeekDateBar — 7日間横スクロール日付バー
// ────────────────────────────────────────────────────────
const TODAY_ISO = new Date().toISOString().slice(0, 10)

function WeekDateBar({
  selected, onChange, conditionMap = {},
}: {
  selected: string
  onChange: (d: string) => void
  conditionMap?: Record<string, number>
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - 3 + i)
    return d
  })
  const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']
  const AMBER = '#F5A623'

  // 体調値に応じた色
  const conditionColor = (v: number) => v >= 8 ? '#34C759' : v >= 6 ? AMBER : '#FF6B6B'

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 8, gap: 4 }}
      style={{ marginBottom: 4 }}
    >
      {days.map(d => {
        const iso     = d.toISOString().slice(0, 10)
        const isToday = iso === TODAY_ISO
        const isSel   = iso === selected
        const cond    = conditionMap[iso]
        const dayName = DAY_NAMES[d.getDay()]
        const dayNum  = d.getDate()

        return (
          <TouchableOpacity
            key={iso}
            onPress={() => { Sounds.tap(); onChange(iso) }}
            style={wb.cell}
            activeOpacity={0.8}
          >
            <Text style={[wb.dayName, isToday && { color: AMBER }]}>{dayName}</Text>
            <View style={[
              wb.numCircle,
              isSel && { backgroundColor: BRAND },
              isToday && !isSel && { borderWidth: 1.5, borderColor: AMBER },
            ]}>
              <Text style={[wb.numText, isSel && { color: '#fff', fontWeight: '900' }]}>{dayNum}</Text>
            </View>
            {/* 体調入力済みインジケーター */}
            {cond != null ? (
              <View style={[wb.dot, { backgroundColor: conditionColor(cond) }]} />
            ) : (
              <View style={wb.dotEmpty} />
            )}
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

const wb = StyleSheet.create({
  cell:      { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, gap: 3 },
  dayName:   { color: '#888', fontSize: 11, fontWeight: '600' },
  numCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  numText:   { color: '#fff', fontSize: 14, fontWeight: '700' },
  dot:       { width: 5, height: 5, borderRadius: 3 },
  dotEmpty:  { width: 5, height: 5 },
})

// ────────────────────────────────────────────────────────
// LevelBadge — ヘッダー右側のレベル表示
// ────────────────────────────────────────────────────────
function LevelBadge({ sessionCount }: { sessionCount: number }) {
  const info = calcLevelInfo(sessionCount)
  return (
    <View style={lb.wrap}>
      <Text style={lb.emoji}>{info.emoji}</Text>
      <View>
        <Text style={lb.lv}>Lv.{info.level} <Text style={lb.title}>{info.title}</Text></Text>
        <View style={lb.barBg}>
          <View style={[lb.barFill, { width: `${Math.round(info.progress * 100)}%` as any }]} />
        </View>
      </View>
    </View>
  )
}
const lb = StyleSheet.create({
  wrap:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: 'rgba(229,57,53,0.12)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(229,57,53,0.25)' },
  emoji:  { fontSize: 16 },
  lv:     { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  title:  { color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  barBg:  { height: 3, width: 60, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 2, marginTop: 2 },
  barFill:{ height: 3, backgroundColor: BRAND, borderRadius: 2 },
})

// ────────────────────────────────────────────────────────
// ScoreOverviewCard — コンディションスコア + 総合アドバイス統合
// ────────────────────────────────────────────────────────
const READINESS_CFG = [
  { max: 24,  color: '#34C759', bgColor: 'rgba(52,199,89,0.10)',  emoji: '🏃', phrase: '全力で追い込もう！',  detail: 'コンディション最高' },
  { max: 49,  color: '#FF9500', bgColor: 'rgba(255,149,0,0.10)',  emoji: '⚡', phrase: '軽めを意識しよう',    detail: '疲労に注意' },
  { max: 74,  color: '#FF6B00', bgColor: 'rgba(255,107,0,0.10)',  emoji: '⚠️', phrase: '強度を落とそう',      detail: '積み重ね疲労あり' },
  { max: 100, color: '#FF3B30', bgColor: 'rgba(255,59,48,0.10)',  emoji: '🛑', phrase: '今日は休養が必要',    detail: '回復を優先して' },
]

function ScoreOverviewCard({
  sessions, sleepRecords, conditionLevel, riskResult,
  effectiveRiskScore, weatherText, onStretchStart,
}: {
  sessions: import('../../types').TrainingSession[]
  sleepRecords: import('../../types').SleepRecord[]
  conditionLevel: number
  riskResult: ReturnType<typeof calcInjuryRisk> | null
  effectiveRiskScore?: number
  weatherText?: string | null
  onStretchStart?: () => void
}) {
  const { colors } = useTheme()
  const status = calcRecoveryStatus(sessions, sleepRecords, conditionLevel)

  const items = [
    {
      label: '睡眠スコア',
      val: status.sleep_score,
      color: status.sleep_score >= 70 ? '#5AC8FA' : status.sleep_score >= 45 ? '#FF9500' : '#FF3B30',
      icon: '😴',
      noData: sleepRecords.length === 0,
    },
    {
      label: '疲労度',
      val: status.fatigue_score,
      color: status.fatigue_score >= 70 ? '#34C759' : status.fatigue_score >= 45 ? '#FF9500' : '#FF3B30',
      icon: '⚡',
      noData: sessions.length === 0,
    },
    {
      label: 'コンディション',
      val: Math.round((conditionLevel / 10) * 100),
      color: conditionLevel >= 8 ? '#34C759' : conditionLevel >= 5 ? '#FF9500' : '#FF3B30',
      icon: '💪',
      noData: false,
    },
  ]

  // 総合準備度（effectiveRiskScore優先、なければriskResult、なければrecoveryStatusのoverall）
  const riskScore = effectiveRiskScore ?? (riskResult ? riskResult.riskScore : 100 - status.overall)
  const readiness = Math.max(0, 100 - riskScore)
  const cfg = READINESS_CFG.find(c => riskScore <= c.max) ?? READINESS_CFG[3]

  return (
    <View style={[so.card, { backgroundColor: colors.surface, borderColor: cfg.color + '40' }]}>

      {/* ── 総合バナー ── */}
      <View style={[so.banner, { backgroundColor: cfg.bgColor }]}>
        <Text style={so.bannerEmoji}>{cfg.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[so.bannerPhrase, { color: cfg.color }]}>{cfg.phrase}</Text>
          <Text style={[so.bannerDetail, { color: cfg.color }]}>{cfg.detail}</Text>
        </View>
        <View style={[so.readinessBox, { borderColor: cfg.color + '55', backgroundColor: cfg.color + '18' }]}>
          <Text style={[so.readinessNum, { color: cfg.color }]}>{readiness}</Text>
          <Text style={[so.readinessLabel, { color: cfg.color }]}>準備度</Text>
        </View>
      </View>

      {/* 準備度バー */}
      <View style={[so.barWrap, { backgroundColor: colors.surface2 }]}>
        <View style={[so.barFill, { width: `${readiness}%` as any, backgroundColor: cfg.color }]} />
      </View>

      {/* ── 3指標バッジ ── */}
      <View style={so.badgesRow}>
        {items.map(item => (
          <View key={item.label} style={[so.badge, { borderColor: item.color + '35', backgroundColor: colors.surface2 }]}>
            <Text style={{ fontSize: 18 }}>{item.icon}</Text>
            {item.noData ? (
              <Text style={[so.valNo, { color: colors.textHint }]}>—</Text>
            ) : (
              <Text style={[so.val, { color: item.color }]}>{item.val}</Text>
            )}
            <View style={[so.minBar, { backgroundColor: colors.border }]}>
              <View style={[so.minBarFill, { width: `${item.noData ? 0 : item.val}%` as any, backgroundColor: item.color }]} />
            </View>
            <Text style={[so.badgeLabel, { color: colors.textHint }]}>{item.label}</Text>
          </View>
        ))}
      </View>

      {/* 天気リスクテキスト */}
      {weatherText && (
        <View style={[so.weatherRow, { borderTopColor: colors.border }]}>
          <Text style={so.weatherText}>{weatherText}</Text>
        </View>
      )}

      {/* ── アドバイス ── */}
      <View style={[so.adviceRow, { borderTopColor: colors.border }]}>
        <Ionicons name="information-circle-outline" size={13} color={colors.textHint} />
        <Text style={[so.advice, { color: colors.textHint }]}>
          {riskResult ? riskResult.recommendation : status.advice}
        </Text>
        {(sleepRecords.length === 0 || sessions.length === 0) && (
          <Text style={[so.hint, { color: colors.textHint }]}>記録↑で精度UP</Text>
        )}
      </View>

      {/* ストレッチ長押しボタン（リスク40以上） */}
      {riskScore >= 40 && onStretchStart && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
          <StretchHoldButton riskScore={riskScore} onComplete={onStretchStart} />
        </View>
      )}
    </View>
  )
}

const so = StyleSheet.create({
  card:           { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  banner:         { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  bannerEmoji:    { fontSize: 32 },
  bannerPhrase:   { fontSize: 16, fontWeight: '900', letterSpacing: -0.3 },
  bannerDetail:   { fontSize: 11, fontWeight: '600', opacity: 0.75, marginTop: 2 },
  readinessBox:   { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center', minWidth: 56 },
  readinessNum:   { fontSize: 26, fontWeight: '900', letterSpacing: -1, lineHeight: 28 },
  readinessLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginTop: 1, opacity: 0.7 },
  barWrap:        { height: 4, marginHorizontal: 16, borderRadius: 2, overflow: 'hidden', marginBottom: 12 },
  barFill:        { height: 4, borderRadius: 2 },
  badgesRow:      { flexDirection: 'row', paddingHorizontal: 10, paddingBottom: 12, gap: 8 },
  badge:          { flex: 1, borderRadius: 14, borderWidth: 1, padding: 12, alignItems: 'center', gap: 3 },
  val:            { fontSize: 24, fontWeight: '900', lineHeight: 26 },
  valNo:          { fontSize: 18, fontWeight: '700', lineHeight: 22 },
  minBar:         { width: '100%', height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 5 },
  minBarFill:     { height: 3, borderRadius: 2 },
  badgeLabel:     { fontSize: 9, fontWeight: '700', textAlign: 'center', letterSpacing: 0.3, marginTop: 3 },
  adviceRow:      { flexDirection: 'row', alignItems: 'center', gap: 5,
    borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10 },
  advice:         { fontSize: 11, lineHeight: 16, flex: 1 },
  hint:           { fontSize: 10, fontWeight: '600' },
  weatherRow:     { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 8 },
  weatherText:    { color: '#F5A623', fontSize: 11, fontWeight: '600' },
})


// ────────────────────────────────────────────────────────
// ConditionRow — コンパクトな体調入力
// ────────────────────────────────────────────────────────
function ConditionRow({ value, onChange, dateLabel }: { value: number; onChange: (v: number) => void; dateLabel?: string }) {
  const selected = CONDITION_EMOJIS.findIndex(e => e.value === value)
  return (
    <View style={cr.row}>
      <Text style={cr.label}>{dateLabel ?? '今日の体調'}</Text>
      <View style={cr.emojis}>
        {CONDITION_EMOJIS.map((e, i) => (
          <TouchableOpacity
            key={e.value}
            onPress={() => { unlockAudio(); Sounds.pop(); onChange(e.value) }}
            style={[cr.btn, i === selected && cr.btnActive]}
            activeOpacity={0.7}
          >
            <Text style={[cr.emoji, i !== selected && { opacity: 0.4 }]}>{e.emoji}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}
const cr = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label:     { color: TEXT.hint, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  emojis:    { flexDirection: 'row', gap: 4 },
  btn:       { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  btnActive: { backgroundColor: SURFACE2, borderColor: 'rgba(255,255,255,0.2)' },
  emoji:     { fontSize: 22 },
})

// ────────────────────────────────────────────────────────
// TasksCard — 改善タスク（チェックリスト）
// ────────────────────────────────────────────────────────
function TasksCard({
  tasks, onToggle,
}: {
  tasks: ImprovementTask[]
  onToggle: (id: string) => void
}) {
  const { colors } = useTheme()
  const pending = tasks.filter(t => !t.completed)
  if (pending.length === 0) return null

  return (
    <GlassCard>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Text style={{ fontSize: 14 }}>✅</Text>
        <Text style={[tk.title, { color: colors.text }]}>改善タスク</Text>
        <View style={tk.badge}>
          <Text style={tk.badgeText}>{pending.length}</Text>
        </View>
      </View>
      {pending.slice(0, 5).map((task, idx) => (
        <TouchableOpacity
          key={task.id}
          onPress={() => { unlockAudio(); Sounds.pop(); onToggle(task.id) }}
          activeOpacity={0.7}
          style={[tk.row, idx > 0 && { borderTopWidth: 1, borderTopColor: DIVIDER }]}
        >
          <View style={[tk.check, { borderColor: colors.border }]}>
            {task.completed && <Ionicons name="checkmark" size={12} color={NEON.green} />}
          </View>
          <Text style={[tk.text, { color: colors.text }]}>{task.text}</Text>
        </TouchableOpacity>
      ))}
    </GlassCard>
  )
}
const tk = StyleSheet.create({
  title:     { color: '#fff', fontSize: 13, fontWeight: '800', flex: 1 },
  badge:     { backgroundColor: BRAND, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  row:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  check:     { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  text:      { fontSize: 13, lineHeight: 18, flex: 1 },
})

// ────────────────────────────────────────────────────────
// DeadlinePicker — インラインカレンダー式期日選択
// ────────────────────────────────────────────────────────
const DOW = ['日','月','火','水','木','金','土']

function DeadlinePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { colors } = useTheme()
  const today = new Date()
  today.setHours(0,0,0,0)

  const initMonth = value ? new Date(value + 'T00:00:00') : new Date()
  const [viewYear,  setViewYear]  = useState(initMonth.getFullYear())
  const [viewMonth, setViewMonth] = useState(initMonth.getMonth())

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  // カレンダーグリッドの日付を生成
  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // 6行に揃える
  while (cells.length % 7 !== 0) cells.push(null)

  function toISO(day: number) {
    const m = String(viewMonth + 1).padStart(2, '0')
    const d = String(day).padStart(2, '0')
    return `${viewYear}-${m}-${d}`
  }

  const selectedISO = value

  return (
    <View style={[dp.wrap, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
      {/* ── 月ナビ ── */}
      <View style={dp.nav}>
        <TouchableOpacity onPress={prevMonth} style={dp.navBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={colors.text} />
        </TouchableOpacity>
        <Text style={[dp.navTitle, { color: colors.text }]}>{viewYear}年 {viewMonth + 1}月</Text>
        <TouchableOpacity onPress={nextMonth} style={dp.navBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-forward" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* ── 曜日ヘッダー ── */}
      <View style={dp.row}>
        {DOW.map((d, i) => (
          <Text key={d} style={[dp.dowCell, { color: i === 0 ? '#FF6B6B' : i === 6 ? '#5AC8FA' : colors.textHint }]}>{d}</Text>
        ))}
      </View>

      {/* ── 日付グリッド ── */}
      {Array.from({ length: cells.length / 7 }, (_, row) => (
        <View key={row} style={dp.row}>
          {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
            if (!day) return <View key={col} style={dp.cell} />
            const iso = toISO(day)
            const isSelected = iso === selectedISO
            const isPast = new Date(iso + 'T00:00:00') < today
            const isToday = iso === today.toISOString().slice(0, 10)
            const isSun = col === 0, isSat = col === 6
            return (
              <TouchableOpacity
                key={col}
                onPress={() => onChange(isSelected ? '' : iso)}
                disabled={isPast}
                style={[dp.cell, isSelected && { backgroundColor: BRAND, borderRadius: 20 }]}
                activeOpacity={0.7}
              >
                <Text style={[
                  dp.dayText,
                  { color: isPast ? colors.textHint : isSun ? '#FF6B6B' : isSat ? '#5AC8FA' : colors.text },
                  isSelected && { color: '#fff', fontWeight: '900' },
                  isToday && !isSelected && { color: BRAND, fontWeight: '800' },
                  isPast && { opacity: 0.3 },
                ]}>{day}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      ))}

      {/* 選択済み表示 + クリアボタン */}
      {value ? (
        <View style={dp.selectedRow}>
          <Text style={{ color: BRAND, fontSize: 12, fontWeight: '700' }}>📅 {value}</Text>
          <TouchableOpacity onPress={() => onChange('')} activeOpacity={0.7}>
            <Text style={{ color: colors.textHint, fontSize: 11 }}>クリア</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={{ color: colors.textHint, fontSize: 11, textAlign: 'center', paddingVertical: 4 }}>日付を選択してください（任意）</Text>
      )}
    </View>
  )
}

const dp = StyleSheet.create({
  wrap:        { borderWidth: 1, borderRadius: 14, padding: 10, marginBottom: 14, gap: 4 },
  nav:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 4 },
  navBtn:      { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  navTitle:    { fontSize: 14, fontWeight: '800' },
  row:         { flexDirection: 'row' },
  dowCell:     { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700', paddingVertical: 4 },
  cell:        { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center' },
  dayText:     { fontSize: 13, fontWeight: '600' },
  selectedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, paddingHorizontal: 4 },
})

// ────────────────────────────────────────────────────────
// GoalCard — 目標の可視化
// ────────────────────────────────────────────────────────
function GoalCard({
  goals,
  onUpdate,
}: {
  goals: Goal[]
  onUpdate: (goals: Goal[]) => void
}) {
  const { colors } = useTheme()
  const [showModal, setShowModal] = useState(false)
  const [editGoal, setEditGoal] = useState<Goal | null>(null)
  const [inputText, setInputText] = useState('')
  const [inputDeadline, setInputDeadline] = useState('')
  const [inputProgress, setInputProgress] = useState(0)
  const [showAchieved, setShowAchieved] = useState(false)

  const active   = goals.filter(g => !g.achieved)
  const achieved = goals.filter(g => g.achieved)

  function openAdd() {
    setEditGoal(null)
    setInputText('')
    setInputDeadline('')
    setInputProgress(0)
    setShowModal(true)
  }

  function openEdit(g: Goal) {
    setEditGoal(g)
    setInputText(g.text)
    setInputDeadline(g.deadline ?? '')
    setInputProgress(g.progress)
    setShowModal(true)
  }

  function handleSave() {
    if (!inputText.trim()) return
    let next: Goal[]
    if (editGoal) {
      next = goals.map(g => g.id === editGoal.id
        ? { ...g, text: inputText.trim(), deadline: inputDeadline || undefined, progress: inputProgress }
        : g)
    } else {
      const newGoal: Goal = {
        id: `goal-${Date.now()}`,
        text: inputText.trim(),
        deadline: inputDeadline || undefined,
        progress: 0,
        achieved: false,
        created_at: new Date().toISOString(),
      }
      next = [newGoal, ...goals]
    }
    onUpdate(next)
    setShowModal(false)
  }

  function handleDelete() {
    if (!editGoal) return
    onUpdate(goals.filter(g => g.id !== editGoal.id))
    setShowModal(false)
  }

  function handleAchieve() {
    if (!editGoal) return
    onUpdate(goals.map(g => g.id === editGoal.id
      ? { ...g, progress: 100, achieved: true } : g))
    setShowModal(false)
  }

  function progressColor(p: number) {
    if (p >= 100) return '#34C759'
    if (p >= 60)  return '#5AC8FA'
    if (p >= 30)  return '#FF9500'
    return BRAND
  }

  function daysLeft(deadline?: string) {
    if (!deadline) return null
    const d = new Date(deadline.includes('T') ? deadline : deadline + 'T00:00:00')
    const diff = Math.ceil((d.getTime() - Date.now()) / 86400000)
    if (diff < 0)  return { text: '期限切れ', color: '#FF3B30' }
    if (diff === 0) return { text: '今日が期限', color: '#FF9500' }
    return { text: `残${diff}日`, color: diff <= 7 ? '#FF9500' : '#888' }
  }

  return (
    <>
      <View style={[gc.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* ヘッダー */}
        <View style={gc.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 16 }}>🎯</Text>
            <Text style={[gc.title, { color: colors.text }]}>目標</Text>
            {active.length > 0 && (
              <View style={{ backgroundColor: BRAND + '22', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ color: BRAND, fontSize: 10, fontWeight: '800' }}>{active.length}件</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            onPress={openAdd}
            style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' }}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* 目標リスト */}
        {active.length === 0 ? (
          <TouchableOpacity onPress={openAdd} activeOpacity={0.7} style={gc.emptyRow}>
            <Text style={{ color: colors.textHint, fontSize: 13 }}>タップして目標を設定しよう</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ gap: 10 }}>
            {active.map((g, idx) => {
              const dl  = daysLeft(g.deadline)
              const col = progressColor(g.progress)
              return (
                <TouchableOpacity
                  key={g.id}
                  onPress={() => openEdit(g)}
                  activeOpacity={0.75}
                  style={[gc.goalRow, idx > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                >
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[gc.goalText, { color: colors.text }]} numberOfLines={2}>{g.text}</Text>
                      {dl && <Text style={{ color: dl.color, fontSize: 10, fontWeight: '700', flexShrink: 0 }}>{dl.text}</Text>}
                    </View>
                    {/* 進捗バー */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={[gc.barBg, { backgroundColor: colors.surface2, flex: 1 }]}>
                        <View style={[gc.barFill, { width: `${g.progress}%` as any, backgroundColor: col }]} />
                      </View>
                      <Text style={{ color: col, fontSize: 11, fontWeight: '800', width: 32, textAlign: 'right' }}>{g.progress}%</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.textHint} style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              )
            })}
          </View>
        )}

        {/* 達成済み表示トグル */}
        {achieved.length > 0 && (
          <TouchableOpacity onPress={() => setShowAchieved(v => !v)} style={gc.achievedToggle} activeOpacity={0.7}>
            <Ionicons name={showAchieved ? 'chevron-up' : 'trophy-outline'} size={12} color="#34C759" />
            <Text style={{ color: '#34C759', fontSize: 11, fontWeight: '700' }}>
              {showAchieved ? '達成済みを隠す' : `達成済み ${achieved.length}件`}
            </Text>
          </TouchableOpacity>
        )}
        {showAchieved && achieved.map(g => (
          <TouchableOpacity key={g.id} onPress={() => openEdit(g)} activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={{ fontSize: 14 }}>🏆</Text>
            <Text style={{ color: '#34C759', fontSize: 12, fontWeight: '700', flex: 1 }} numberOfLines={1}>{g.text}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── 編集モーダル ── */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <View style={gc.overlay}>
          <View style={[gc.sheet, { backgroundColor: colors.surface }]}>
            <View style={gc.sheetHeader}>
              <Text style={[gc.sheetTitle, { color: colors.text }]}>{editGoal ? '目標を編集' : '目標を追加'}</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={22} color={colors.textSec} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* 目標テキスト */}
              <Text style={[gc.label, { color: colors.textSec }]}>目標</Text>
              <TextInput
                value={inputText}
                onChangeText={setInputText}
                placeholder="例: 100m 11秒台を切る"
                placeholderTextColor={colors.textHint}
                style={[gc.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface2 }]}
                multiline
              />

              {/* 期日 */}
              <Text style={[gc.label, { color: colors.textSec }]}>期日（任意）</Text>
              <DeadlinePicker value={inputDeadline} onChange={setInputDeadline} />

              {/* 達成率スライダー（+/-ボタン） */}
              <Text style={[gc.label, { color: colors.textSec }]}>
                達成率: <Text style={{ color: progressColor(inputProgress), fontWeight: '800' }}>{inputProgress}%</Text>
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <TouchableOpacity onPress={() => setInputProgress(Math.max(0, inputProgress - 10))} style={gc.stepBtn} activeOpacity={0.7}>
                  <Ionicons name="remove" size={18} color="#fff" />
                </TouchableOpacity>
                <View style={[gc.barBg, { flex: 1, backgroundColor: colors.surface2, height: 8 }]}>
                  <View style={[gc.barFill, { width: `${inputProgress}%` as any, backgroundColor: progressColor(inputProgress), height: 8 }]} />
                </View>
                <TouchableOpacity onPress={() => setInputProgress(Math.min(100, inputProgress + 10))} style={gc.stepBtn} activeOpacity={0.7}>
                  <Ionicons name="add" size={18} color="#fff" />
                </TouchableOpacity>
              </View>

              {/* ボタン群 */}
              <TouchableOpacity
                style={[gc.saveBtn, !inputText.trim() && { opacity: 0.4 }]}
                onPress={handleSave}
                disabled={!inputText.trim()}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{editGoal ? '保存' : '追加'}</Text>
              </TouchableOpacity>

              {editGoal && !editGoal.achieved && (
                <TouchableOpacity style={gc.achieveBtn} onPress={handleAchieve} activeOpacity={0.85}>
                  <Text style={{ fontSize: 16 }}>🏆</Text>
                  <Text style={{ color: '#34C759', fontWeight: '800', fontSize: 14 }}>達成！</Text>
                </TouchableOpacity>
              )}

              {editGoal && (
                <TouchableOpacity style={gc.deleteBtn} onPress={handleDelete} activeOpacity={0.85}>
                  <Ionicons name="trash-outline" size={15} color="#FF3B30" />
                  <Text style={{ color: '#FF3B30', fontWeight: '700', fontSize: 13 }}>削除</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  )
}

const gc = StyleSheet.create({
  card:         { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:        { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  emptyRow:     { paddingVertical: 14, alignItems: 'center' },
  goalRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  goalText:     { fontSize: 13, fontWeight: '700', flex: 1, lineHeight: 18 },
  barBg:        { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill:      { height: 6, borderRadius: 3 },
  achievedToggle:{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(52,199,89,0.2)' },

  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet:        { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: '80%' },
  sheetHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  sheetTitle:   { fontSize: 17, fontWeight: '800' },
  label:        { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  input:        { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, marginBottom: 14, minHeight: 44 },
  stepBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  saveBtn:      { backgroundColor: BRAND, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 10 },
  achieveBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: '#34C759', borderRadius: 14, paddingVertical: 13, marginBottom: 10 },
  deleteBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
})

// ────────────────────────────────────────────────────────
// DashboardScreen
// ────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { sessions, loading, fetchSessions } = useTrainingSessions()
  const [selectedDate,    setSelectedDate]    = useState(TODAY_ISO)
  const [showQuickLog,    setShowQuickLog]    = useState(false)
  const [conditionMap,    setConditionMap]    = useState<Record<string,number>>({})
  const conditionLevel = conditionMap[selectedDate] ?? 6
  // 直近7日の平均体調（リスク計算用）
  const avgConditionLevel = useMemo(() => {
    const today = new Date()
    const vals = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today); d.setDate(d.getDate() - i)
      return conditionMap[d.toISOString().slice(0, 10)]
    }).filter((v): v is number => v !== undefined)
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : conditionLevel
  }, [conditionMap, conditionLevel])
  const [sleepRecords,    setSleepRecords]    = useState<SleepRecord[]>([])
  const [hasSymptom,      setHasSymptom]      = useState(false)
  const [tasks,           setTasks]           = useState<ImprovementTask[]>([])
  const [goals,           setGoals]           = useState<Goal[]>([])
  const [showAIAdvice,    setShowAIAdvice]    = useState(false)
  const [aiAdvice,        setAiAdvice]        = useState('')
  const [loadingAI,       setLoadingAI]       = useState(false)
  const [weatherBonus,    setWeatherBonus]    = useState(0)
  const [weatherText,     setWeatherText]     = useState<string | null>(null)
  const [stretchReduction,setStretchReduction]= useState(0)
  const [recoveryBanner,  setRecoveryBanner]  = useState<{ reduction: number } | null>(null)

  // ── 永続データ読み込み ──
  useEffect(() => {
    // 体調マップを読み込み（旧フォーマットからマイグレーション）
    AsyncStorage.multiGet([CONDITION_MAP_KEY, CONDITION_KEY]).then(([[, mapStr], [, oldVal]]) => {
      if (mapStr) {
        setConditionMap(JSON.parse(mapStr))
      } else if (oldVal) {
        // 旧データを今日の体調として移行
        const migrated = { [TODAY_ISO]: Number(oldVal) }
        setConditionMap(migrated)
        AsyncStorage.setItem(CONDITION_MAP_KEY, JSON.stringify(migrated)).catch(() => {})
      }
    }).catch(() => {})
    AsyncStorage.getItem(SLEEP_KEY).then(r => { if (r) setSleepRecords(JSON.parse(r)) }).catch(() => {})
    AsyncStorage.getItem(RECOVERY_KEY).then(r => {
      if (!r) return
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
      const records = JSON.parse(r) as Array<{ date: string }>
      setHasSymptom(records.some(rec => rec.date >= sevenDaysAgo))
    }).catch(() => {})
    AsyncStorage.getItem(GOALS_KEY).then(r => { if (r) setGoals(JSON.parse(r)) }).catch(() => {})
    loadTasks()
    fetchSessions(MOCK_USER_ID)
  }, [])

  // ── 天気取得 ──
  useEffect(() => {
    getCurrentLocationWeather().then(w => {
      if (!w) return
      const bonus = calcWeatherRiskBonus(w)
      setWeatherBonus(bonus)
      setWeatherText(getWeatherRiskText(w, bonus))
    }).catch(() => {})
  }, [])

  function handleGoalsUpdate(next: Goal[]) {
    setGoals(next)
    AsyncStorage.setItem(GOALS_KEY, JSON.stringify(next)).catch(() => {})
  }

  const reloadAll = useCallback(() => {
    fetchSessions(MOCK_USER_ID)
    // ストレッチ結果読み込み
    const today = new Date().toISOString().slice(0, 10)
    AsyncStorage.getItem(STRETCH_RESULT_KEY).then(raw => {
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (parsed.date !== today) { setStretchReduction(0); return }
      setStretchReduction(parsed.reduction ?? 0)
      if (parsed.showBanner) {
        setRecoveryBanner({ reduction: parsed.lastReduction ?? parsed.reduction })
        AsyncStorage.setItem(STRETCH_RESULT_KEY, JSON.stringify({ ...parsed, showBanner: false })).catch(() => {})
      }
    }).catch(() => {})
    AsyncStorage.multiGet([CONDITION_MAP_KEY, SLEEP_KEY, TASKS_KEY, RECOVERY_KEY, GOALS_KEY]).then(
      ([[, mapStr], [, sleepStr], [, tasksStr], [, recovStr], [, goalsStr]]) => {
        if (mapStr)   { try { setConditionMap(JSON.parse(mapStr)) }    catch {} }
        if (sleepStr) { try { setSleepRecords(JSON.parse(sleepStr)) }  catch {} }
        if (tasksStr) { try { setTasks(JSON.parse(tasksStr)) }         catch {} }
        if (goalsStr) { try { setGoals(JSON.parse(goalsStr)) }         catch {} }
        if (recovStr) {
          try {
            const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
            const recs = JSON.parse(recovStr) as Array<{ date: string }>
            setHasSymptom(recs.some(r => r.date >= sevenDaysAgo))
          } catch {}
        }
      }
    ).catch(() => {})
  }, [fetchSessions])
  useFocusEffect(useCallback(() => { reloadAll() }, [reloadAll]))

  function loadTasks() {
    AsyncStorage.getItem(TASKS_KEY).then(r => {
      if (r) setTasks(JSON.parse(r))
    }).catch(() => {})
  }

  function toggleTask(id: string) {
    setTasks(prev => {
      const next = prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t)
      AsyncStorage.setItem(TASKS_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }

  // ── AIコーチアドバイス ──────────────────────────────────
  async function handleGetAIAdvice() {
    setLoadingAI(true)
    setShowAIAdvice(true)
    setAiAdvice('')
    try {
      const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY
      const today  = new Date().toISOString().slice(0, 10)

      // 直近7日の練習データ
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
      const recentSessions = sessions.filter(s => s.session_date >= sevenDaysAgo).slice(0, 10)

      // 睡眠データ
      const recentSleep = sleepRecords.slice(0, 7)

      // リスクスコア
      const riskLabel = riskResult
        ? `${riskResult.riskScore}/100（${riskResult.label}）`
        : '未計算'

      const conditionLabel = ['きつい','','しんどい','','ふつう','','いい感じ','','絶好調',''][conditionLevel - 1] ?? 'ふつう'

      const sessionsText = recentSessions.length > 0
        ? recentSessions.map(s =>
            `${s.session_date}: ${SESSION_TYPE_LABEL[s.session_type] ?? s.session_type}` +
            (s.distance_m ? ` ${(s.distance_m/1000).toFixed(1)}km` : '') +
            (s.fatigue_level ? ` 疲労${s.fatigue_level}` : '') +
            (s.notes ? ` 備考:${s.notes.slice(0, 30)}` : '')
          ).join('\n')
        : '記録なし'

      const sleepText = recentSleep.length > 0
        ? recentSleep.map(r => `${r.sleep_date}: ${r.duration_min ? (r.duration_min/60).toFixed(1) : '?'}h`).join(', ')
        : '記録なし'

      const prompt = `あなたは陸上競技の専門コーチです。以下のデータをもとに、選手へのアドバイスを日本語で3〜5項目、具体的かつ実践的に提供してください。

【今日の日付】${today}
【今日の体調】${conditionLabel}（${conditionLevel}/10）
【怪我リスクスコア】${riskLabel}
【直近7日の練習記録】
${sessionsText}
【直近7日の睡眠】${sleepText}
【体の痛み・違和感】${hasSymptom ? 'あり（直近7日以内）' : 'なし'}

アドバイスは以下の観点を含めてください：
1. 今週の練習の評価・総評
2. 疲労・リカバリーへのアドバイス
3. 来週に向けての練習方針
4. 食事・睡眠・生活習慣のアドバイス（あれば）
5. 注意すべき点

回答は各項目を絵文字＋見出し付きで、読みやすくまとめてください。`

      if (apiKey) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 800,
            messages: [{ role: 'user', content: prompt }],
          }),
        })
        if (res.ok) {
          const data = await res.json()
          setAiAdvice(data.content?.[0]?.text ?? 'アドバイスを取得できませんでした')
        } else {
          setAiAdvice('APIエラーが発生しました。しばらくしてから再試行してください。')
        }
      } else {
        // APIキー未設定時のデモアドバイス
        setAiAdvice(
          `🏃 **今週の練習評価**\n記録データをもとに分析しました。\n\n💪 **リカバリーについて**\n疲労度が高い日が続いているため、明日は軽いジョグかオフにしましょう。\n\n📅 **来週の練習方針**\n強度の高い練習（インターバルなど）は週2回以内に抑え、ジョグ・ドリルを中心に体を整えましょう。\n\n🍽️ **食事・睡眠**\n練習後30分以内にたんぱく質（鶏肉・牛乳など）を補給すると回復が早まります。睡眠は7〜8時間を目標に。\n\n⚠️ **注意点**\n体に違和感がある場合は無理せず休養を優先してください。AIコーチ機能はAPIキー設定後にフル活用できます。`
        )
      }
    } catch {
      setAiAdvice('データの取得に失敗しました。もう一度お試しください。')
    } finally {
      setLoadingAI(false)
    }
  }

  const handleConditionChange = useCallback((v: number) => {
    setConditionMap(prev => {
      const next = { ...prev, [selectedDate]: v }
      AsyncStorage.setItem(CONDITION_MAP_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [selectedDate])

  // ── 怪我リスク計算 ──
  const riskResult = useMemo(() => {
    if (loading === 'loading' || loading === 'idle') return null
    return calcInjuryRisk(sessions, sleepRecords, avgConditionLevel, hasSymptom)
  }, [sessions, sleepRecords, avgConditionLevel, hasSymptom, loading])

  // 天気ボーナス + ストレッチ減算を反映した有効リスクスコア
  const effectiveRiskScore = useMemo(() => {
    if (!riskResult) return null
    return Math.min(100, Math.max(0, riskResult.riskScore + weatherBonus - stretchReduction))
  }, [riskResult, weatherBonus, stretchReduction])

  const handleStretchStart = useCallback(() => {
    router.push({ pathname: '/stretch-recovery', params: { riskScore: (effectiveRiskScore ?? 50).toString() } } as any)
  }, [effectiveRiskScore])

  // ── スクロールトップ ──
  const scrollRef = useRef<ScrollView>(null)
  useEffect(() => {
    registerHomeScroll(() => scrollRef.current?.scrollTo({ y: 0, animated: true }))
    setQuickLogListener(() => setShowQuickLog(true))
    return () => { unregisterHomeScroll(); clearQuickLogListener() }
  }, [])

  const todayStr = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  })

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* ── ヘッダー ── */}
          <AnimatedEntry delay={0}>
            <View style={s.header}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View>
                  <Text style={[s.appTitle, { color: colors.text }]}>sCORE</Text>
                  <Text style={[s.dateText, { color: colors.textSec }]}>{todayStr}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <PressableScale haptic="light" scaleAmount={0.95} onPress={() => { unlockAudio(); Sounds.tap(); router.push('/level-roadmap') }}>
                  <LevelBadge sessionCount={sessions.length} />
                </PressableScale>
                <PressableScale haptic="medium" scaleAmount={0.9} onPress={() => { unlockAudio(); Sounds.tap(); router.push('/(tabs)/mypage') }}>
                  <View style={[s.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Ionicons name="person-circle-outline" size={20} color={colors.textSec} />
                  </View>
                </PressableScale>
              </View>
            </View>
          </AnimatedEntry>

          {/* ── 週間日付バー ── */}
          <AnimatedEntry delay={30}>
            <WeekDateBar selected={selectedDate} onChange={setSelectedDate} conditionMap={conditionMap} />
          </AnimatedEntry>

          {/* ── 体調入力 ── */}
          <AnimatedEntry delay={60}>
            <GlassCard>
              <ConditionRow
                value={conditionLevel}
                onChange={handleConditionChange}
                dateLabel={selectedDate === TODAY_ISO ? '今日の体調' : `${selectedDate.slice(5).replace('-', '/')} の体調`}
              />
            </GlassCard>
          </AnimatedEntry>

          {/* ── コンディションスコア（総合アドバイス統合） ── */}
          <AnimatedEntry delay={90}>
            <ScoreOverviewCard
              sessions={sessions}
              sleepRecords={sleepRecords}
              conditionLevel={avgConditionLevel}
              riskResult={riskResult}
              effectiveRiskScore={effectiveRiskScore ?? undefined}
              weatherText={weatherText}
              onStretchStart={handleStretchStart}
            />
          </AnimatedEntry>

          {/* ── 目標 ── */}
          <AnimatedEntry delay={120}>
            <GoalCard goals={goals} onUpdate={handleGoalsUpdate} />
          </AnimatedEntry>

          {/* ── 改善タスク（ある場合のみ表示） ── */}
          <AnimatedEntry delay={180}>
            <TasksCard tasks={tasks} onToggle={toggleTask} />
          </AnimatedEntry>

          {/* ── クイックリンク ── */}
          <AnimatedEntry delay={240}>
            <View style={s.quickLinks}>
              {[
                { icon: '📹', label: '動画分析',     route: '/video-analysis' },
                { icon: '📋', label: 'メニュー',     route: '/workout-menu' },
                { icon: '🏆', label: '試合計画',     route: '/(tabs)/competition' },
                { icon: '📅', label: 'カレンダー',   route: '/(tabs)/calendar' },
              ].map(item => (
                <PressableScale
                  key={item.label}
                  haptic="light"
                  scaleAmount={0.94}
                  onPress={() => { unlockAudio(); Sounds.tap(); router.push(item.route as any) }}
                  style={{ flex: 1 }}
                >
                  <View style={[s.quickLink, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={{ fontSize: 20 }}>{item.icon}</Text>
                    <Text style={[s.quickLinkLabel, { color: colors.textSec }]}>{item.label}</Text>
                  </View>
                </PressableScale>
              ))}
            </View>
          </AnimatedEntry>

          {/* ── AIコーチ ── */}
          <AnimatedEntry delay={300}>
            <TouchableOpacity
              style={[s.aiCoachBtn, { backgroundColor: colors.surface, borderColor: 'rgba(74,159,255,0.4)' }]}
              activeOpacity={0.85}
              onPress={() => { unlockAudio(); Sounds.tap(); handleGetAIAdvice() }}
            >
              <View style={s.aiCoachInner}>
                <View style={s.aiCoachIcon}>
                  <Text style={{ fontSize: 22 }}>🤖</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.aiCoachTitle, { color: colors.text }]}>AIコーチにアドバイスをもらう</Text>
                  <Text style={[s.aiCoachSub, { color: colors.textHint }]}>体調・練習・睡眠データから総合分析</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textHint} />
              </View>
            </TouchableOpacity>
          </AnimatedEntry>

          {/* ── 練習一覧（全件・スクロール形式） ── */}
          <AnimatedEntry delay={360}>
            <GlassCard>
              <View style={s.sectionRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="list" size={14} color={BRAND} />
                  <Text style={[s.sectionLabel, { color: colors.text }]}>練習一覧</Text>
                  {sessions.length > 0 && (
                    <View style={{ backgroundColor: BRAND + '22', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ color: BRAND, fontSize: 10, fontWeight: '800' }}>{sessions.length}件</Text>
                    </View>
                  )}
                </View>
                <PressableScale haptic="light" onPress={() => router.push('/(tabs)/records')}>
                  <Text style={{ color: BRAND, fontSize: 12, fontWeight: '700' }}>進捗へ →</Text>
                </PressableScale>
              </View>

              {loading === 'loading' || loading === 'idle' ? (
                <View style={{ gap: 10 }}>
                  {[0,1,2].map(i => (
                    <View key={i} style={{ height: 44, backgroundColor: SURFACE2, borderRadius: 8, opacity: 0.4 }} />
                  ))}
                </View>
              ) : sessions.length === 0 ? (
                <View style={{ alignItems: 'center', gap: 6, paddingVertical: 24 }}>
                  <Ionicons name="barbell-outline" size={32} color={colors.textHint} />
                  <Text style={{ color: colors.textHint, fontSize: 14 }}>まだ記録なし</Text>
                  <Text style={{ color: colors.textHint, fontSize: 12 }}>下の＋ボタンから記録しよう！</Text>
                </View>
              ) : (
                <>
                  {sessions.map((sess, idx) => {
                    const typeInfo = {
                      interval: { color: '#F5A623', label: 'インターバル' },
                      tempo:    { color: '#FF9500', label: 'テンポ走' },
                      easy:     { color: '#4ECDC4', label: 'ジョグ' },
                      long:     { color: '#5AC8FA', label: 'ロング走' },
                      sprint:   { color: '#FF6B6B', label: 'スプリント' },
                      drill:    { color: '#AF52DE', label: 'ドリル' },
                      strength: { color: '#FF6B35', label: 'ウェイト' },
                      race:     { color: '#FFD700', label: '試合' },
                      rest:     { color: '#888',    label: '休養' },
                    }[sess.session_type] ?? { color: '#888', label: sess.session_type }
                    const fat = sess.fatigue_level ?? 5
                    const fatColor = fat >= 8 ? '#FF6B6B' : fat >= 6 ? '#FF9500' : '#4ECDC4'
                    const fmtTime = (ms: number) => {
                      const sec = ms / 1000
                      if (sec < 60) return `${sec.toFixed(2)}"`
                      return `${Math.floor(sec/60)}'${(sec%60).toFixed(2).padStart(5,'0')}"`
                    }
                    return (
                      <View
                        key={sess.id}
                        style={[s.sessRow, idx > 0 && { borderTopWidth: 1, borderTopColor: DIVIDER }]}
                      >
                        <View style={[s.typeBar, { backgroundColor: typeInfo.color }]} />
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={[s.sessType, { color: colors.text }]}>{typeInfo.label}</Text>
                            {sess.event ? <Text style={{ color: colors.textHint, fontSize: 11 }}>{sess.event}</Text> : null}
                          </View>
                          <Text style={[s.sessDate, { color: colors.textHint }]}>
                            {sess.session_date}
                            {sess.distance_m ? ` · ${sess.distance_m >= 1000 ? `${(sess.distance_m/1000).toFixed(1)}km` : `${sess.distance_m}m`}` : ''}
                          </Text>
                        </View>
                        {sess.time_ms ? (
                          <Text style={[s.sessStat, { color: colors.textSec }]}>{fmtTime(sess.time_ms)}</Text>
                        ) : null}
                        <View style={[s.fatiguePill, { backgroundColor: fatColor + '22' }]}>
                          <Text style={{ fontSize: 10, fontWeight: '800', color: fatColor }}>疲労{fat}</Text>
                        </View>
                      </View>
                    )
                  })}
                </>
              )}
            </GlassCard>
          </AnimatedEntry>

          {/* ── リカバリー ── */}
          <AnimatedEntry delay={420}>
            <TouchableOpacity
              style={[s.recoveryBtn, { backgroundColor: colors.surface, borderColor: 'rgba(52,199,89,0.35)' }]}
              activeOpacity={0.85}
              onPress={() => { unlockAudio(); Sounds.tap(); router.push('/recovery' as any) }}
            >
              <View style={s.recoveryInner}>
                <View style={[s.recoveryIcon, { backgroundColor: 'rgba(52,199,89,0.12)' }]}>
                  <Text style={{ fontSize: 22 }}>🩹</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.recoveryTitle, { color: colors.text }]}>リカバリー記録</Text>
                  <Text style={[s.recoverySub, { color: colors.textHint }]}>痛み・違和感・アイシングなどを記録</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textHint} />
              </View>
            </TouchableOpacity>
          </AnimatedEntry>

        </ScrollView>
      </SafeAreaView>

      {/* ── リカバリー完了バナー ── */}
      {recoveryBanner && (
        <TouchableOpacity
          style={s.recovBanner}
          onPress={() => setRecoveryBanner(null)}
          activeOpacity={0.8}
        >
          <Text style={s.recovBannerText}>
            ✅ リカバリー完了！怪我リスクが{recoveryBanner.reduction}ポイント下がりました
          </Text>
          <Ionicons name="close" size={14} color="#34C759" />
        </TouchableOpacity>
      )}

      <QuickLogModal
        visible={showQuickLog}
        onClose={() => setShowQuickLog(false)}
        onSaved={() => {
          fetchSessions(MOCK_USER_ID)
          loadTasks()
        }}
      />

      {/* ── AIコーチ アドバイスモーダル ── */}
      <Modal visible={showAIAdvice} transparent animationType="slide" onRequestClose={() => setShowAIAdvice(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { backgroundColor: colors.surface }]}>
            {/* ヘッダー */}
            <View style={s.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 22 }}>🤖</Text>
                <Text style={[s.modalTitle, { color: colors.text }]}>AIコーチからのアドバイス</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAIAdvice(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={22} color={colors.textSec} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              {loadingAI ? (
                <View style={{ alignItems: 'center', paddingVertical: 60, gap: 16 }}>
                  <ActivityIndicator size="large" color={BRAND} />
                  <Text style={{ color: colors.textHint, fontSize: 13 }}>データを分析中…</Text>
                </View>
              ) : (
                <View style={{ paddingBottom: 40 }}>
                  {aiAdvice.split('\n').map((line, i) => {
                    const isBold = line.startsWith('**') || /^[🏃💪📅🍽️⚠️🎯🔥💤]/.test(line)
                    return (
                      <Text
                        key={i}
                        style={[
                          s.adviceText,
                          { color: isBold ? colors.text : colors.textSec },
                          isBold && { fontWeight: '700', fontSize: 14, marginTop: 14 },
                        ]}
                      >
                        {line.replace(/\*\*/g, '')}
                      </Text>
                    )
                  })}
                </View>
              )}
            </ScrollView>

            {!loadingAI && (
              <TouchableOpacity
                style={[s.reloadBtn, { borderColor: 'rgba(74,159,255,0.4)' }]}
                onPress={handleGetAIAdvice}
              >
                <Ionicons name="refresh" size={15} color="#4A9FFF" />
                <Text style={{ color: '#4A9FFF', fontSize: 13, fontWeight: '700' }}>再取得</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      <PWAInstallPrompt />
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────
const s = StyleSheet.create({
  content:   { padding: 16, gap: 10, paddingBottom: 110 },

  header:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  appTitle:  { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  dateText:  { fontSize: 11, marginTop: 1 },
  iconBtn:   { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  sectionRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  sessRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  typeBar:    { width: 4, height: 36, borderRadius: 2, flexShrink: 0 },
  sessType:   { fontSize: 13, fontWeight: '700' },
  sessDate:   { fontSize: 11, marginTop: 2 },
  sessStat:   { fontSize: 12, fontWeight: '600' },
  fatiguePill:{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },

  quickLinks: { flexDirection: 'row', gap: 8 },
  quickLink:  { borderRadius: 12, borderWidth: 1, paddingVertical: 12, alignItems: 'center', gap: 5 },
  quickLinkLabel: { fontSize: 10, fontWeight: '700', textAlign: 'center' },

  // PRバッジ
  prBadge: {
    backgroundColor: '#F5A623', borderRadius: 5,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  prText: { color: '#000', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },

  // リカバリーボタン
  recoveryBtn:   { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  recoveryInner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  recoveryIcon:  { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  recoveryTitle: { fontSize: 14, fontWeight: '800' },
  recoverySub:   { fontSize: 11, marginTop: 2 },

  // AIコーチボタン
  aiCoachBtn: {
    borderRadius: 14, borderWidth: 1, overflow: 'hidden',
  },
  aiCoachInner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  aiCoachIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: 'rgba(74,159,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  aiCoachTitle: { fontSize: 14, fontWeight: '800' },
  aiCoachSub:   { fontSize: 11, marginTop: 2 },

  // リカバリーバナー
  recovBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(52,199,89,0.15)', borderTopWidth: 1,
    borderTopColor: 'rgba(52,199,89,0.3)', paddingHorizontal: 16, paddingVertical: 10,
  },
  recovBannerText: { color: '#34C759', fontSize: 12, fontWeight: '700', flex: 1 },

  // AIアドバイスモーダル
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, marginBottom: 8,
  },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  adviceText: { fontSize: 13, lineHeight: 21 },
  reloadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderWidth: 1, borderRadius: 12, paddingVertical: 12, marginTop: 8,
  },
})

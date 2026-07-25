// app/(tabs)/index.tsx — シンプルホーム（ゲーミフィケーション + 改善タスク + 総合リスク）
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import {
  ActivityIndicator, Alert, Animated, Easing, Image, KeyboardAvoidingView, Linking, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../context/ThemeContext'
import { useTrainingSessions } from '../../hooks/useTrainingSessions'
import { calcInjuryRisk } from '../../lib/injuryRisk'
import { calcLevelInfo } from '../../lib/gamification'
import GlassCard from '../../components/GlassCard'
import PressableScale from '../../components/PressableScale'
import { BRAND, ALERT, TEXT, NEON, SURFACE, SURFACE2, DIVIDER } from '../../lib/theme'
import { Sounds, unlockAudio } from '../../lib/sounds'
import HapticTouch from '../../components/HapticTouch'
import Logo from '../../components/Logo'
import PWAInstallPrompt from '../../components/PWAInstallPrompt'
import QuickLogModal from '../../components/QuickLogModal'
import QuickConditionModal from '../../components/QuickConditionModal'
import PracticeShareCard, { PracticeShareData } from '../../components/PracticeShareCard'
import StretchHoldButton from '../../components/StretchHoldButton'
import { registerHomeScroll, unregisterHomeScroll } from '../../lib/homeScroll'
import { setQuickLogListener, clearQuickLogListener } from '../../lib/quickLogEvent'
import { getCachedWeather, getWeatherCacheOnly, clearWeatherCache } from '../../lib/weather'
import { calcWeatherRiskBonus, getWeatherRiskText } from '../../lib/weatherRisk'
import { autoSyncTeam } from '../../lib/teamAutoSync'
import { trackAppOpen, trackPaywallView } from '../../lib/analytics'
import { usePurchase } from '../../context/PurchaseContext'
import TutorialSpot from '../../components/TutorialSpot'
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg'
import { LinearGradient as ScreenGradient } from 'expo-linear-gradient'
import { useTutorial, isTutorialDone } from '../../lib/tutorialContext'
import { sendRiskAlertIfNeeded, sendStretchReminderIfNeeded, scheduleCompetitionReminder, scheduleStreakReminder } from '../../lib/notifications'
import { fetchTeamEvents, sendCoachNotification, type TeamEventRow } from '../../lib/supabaseTeam'
import type { SleepRecord } from '../../types'
import ReviewWall, { shouldShowReviewWall } from '../../components/ReviewWall'
import NoadUpsellModal, { shouldShowNoadUpsell } from '../../components/NoadUpsellModal'
import { showRewardedAd, hasDailyInsightClaimed, markDailyInsightClaimed, showInterstitialAd, isAppOpenAdShowing } from '../../lib/admob'
import { todayLocalISO, localDateStr } from '../../lib/dateLocal'

// Hermesの AbortSignal.timeout 非対応に対応したタイムアウト付きfetch
function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return fetch(url, { ...options, signal: AbortSignal.timeout(ms) })
  }
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id))
}

// ── AsyncStorage keys ───────────────────────────────────
const CONDITION_KEY      = 'trackmate_condition'
const CONDITION_MAP_KEY  = 'trackmate_condition_map'
const STRETCH_RESULT_KEY = 'trackmate_stretch_result'
const SLEEP_KEY          = 'trackmate_sleep'
const RECOVERY_KEY       = 'trackmate_recovery_records'
const TASKS_KEY          = 'trackmate_tasks'
const GOALS_KEY          = 'trackmate_goals'
const JOINED_KEY          = 'trackmate_team_joined'
const EVENT_CONFIRMED_KEY = 'event_confirmed_ids'
const NOTIF_READ_KEY      = 'notif_read_ids'

// アプリお知らせIDリスト（通知画面と同期）
const APP_NOTICE_IDS = ['v1.0.1-date-fix','v1.0.1-load-fix','v1.0.1-injury-model','welcome-v1']
const APP_NOTICE_DATES: Record<string, string> = {
  'v1.0.1-date-fix': '2026-05-14', 'v1.0.1-load-fix': '2026-05-14',
  'v1.0.1-injury-model': '2026-05-14', 'welcome-v1': '2026-04-01',
}

// ── チーム予定ヘルパー ────────────────────────────────────
const EVENT_CFG_HOME: Record<string, { emoji: string; color: string }> = {
  practice: { emoji: '🏃', color: '#34C759' },
  race:     { emoji: '🏁', color: BRAND     },
  rest:     { emoji: '😴', color: '#5856D6' },
  meeting:  { emoji: '💬', color: '#FF9500' },
  other:    { emoji: '📌', color: '#8E8E93' },
}
function isPastEvent(d: string) {
  const dt = new Date(d + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return dt.getTime() < today.getTime()
}
function isNewTeamEvent(createdAt: string) {
  return Date.now() - new Date(createdAt).getTime() < 3 * 24 * 60 * 60 * 1000
}
function fmtEventDateHome(d: string) {
  const dt = new Date(d + 'T00:00:00')
  const today = new Date(); today.setHours(0,0,0,0)
  const diff = Math.round((dt.getTime() - today.getTime()) / 86400000)
  const JP = ['日','月','火','水','木','金','土']
  if (diff === 0) return '今日'
  if (diff === 1) return '明日'
  if (diff === 2) return '明後日'
  return `${dt.getMonth()+1}/${dt.getDate()}（${JP[dt.getDay()]}）`
}

export interface GoalTask {
  id: string
  text: string
  done: boolean
}

export interface Goal {
  id: string
  text: string
  deadline?: string   // ISO date "YYYY-MM-DD"
  progress: number    // 0-100
  achieved: boolean
  created_at: string
  tasks?: GoalTask[]  // サブタスク
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

// ────────────────────────────────────────────────────────
// AnimatedEntry
// ────────────────────────────────────────────────────────
function AnimatedEntry({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const fadeY = useRef(new Animated.Value(0)).current
  useFocusEffect(
    useCallback(() => {
      fadeY.setValue(0)
      const anim = Animated.spring(fadeY, {
        toValue: 1, delay,
        speed: 16, bounciness: 8,
        useNativeDriver: true,
      })
      anim.start()
      return () => anim.stop()
    }, [delay])
  )
  return (
    <Animated.View style={{
      opacity: fadeY,
      transform: [
        { translateY: fadeY.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
        { scale: fadeY.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
      ],
    }}>
      {children}
    </Animated.View>
  )
}

// ────────────────────────────────────────────────────────
// WeekDateBar — 7日間横スクロール日付バー
// ────────────────────────────────────────────────────────
// 今日の日付を毎回生成（モジュール定数にすると日付またぎで古いまま）
// UTC基準の toISOString() だと JST 深夜0〜9時に前日扱いになるため、
// ローカルタイムゾーンで正しく「今日」を返す共通ヘルパーを使う
function getTodayISO() { return todayLocalISO() }

function WeekDateBar({
  selected, onChange, conditionMap = {},
}: {
  selected: string
  onChange: (d: string) => void
  conditionMap?: Record<string, number>
}) {
  const todayISO = getTodayISO()  // レンダー時に毎回生成（日付またぎ対応）
  // 過去10日〜未来3日まで表示（左にスクロールすると過去の日付も見える）
  const PAST_DAYS = 10
  const FUTURE_DAYS = 3
  const CELL_W = 56  // paddingHorizontal(10*2) + numCircle(32) + gap(4) の概算
  const days = Array.from({ length: PAST_DAYS + FUTURE_DAYS + 1 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - PAST_DAYS + i)
    return d
  })
  const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']
  const AMBER = '#F5A623'
  const scrollRef = useRef<ScrollView>(null)

  // 初回表示時は「今日の3日前」が先頭に来る位置までスクロール（従来の見え方を維持）
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: (PAST_DAYS - 3) * CELL_W, animated: false })
  }, [])

  // 体調値に応じた色
  const conditionColor = (v: number) => v >= 8 ? '#34C759' : v >= 6 ? AMBER : '#FF6B6B'

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 8, gap: 4 }}
      style={{ marginBottom: 4 }}
    >
      {days.map(d => {
        const iso     = localDateStr(d)
        const isToday = iso === todayISO
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
  // イラスト背景の上でも読めるよう、白のテキストシャドウでコントラストを補強
  dayName:   {
    color: '#4b5563', fontSize: 11, fontWeight: '700',
    textShadowColor: 'rgba(255,255,255,0.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 4,
  },
  numCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  numText:   {
    color: '#111827', fontSize: 14, fontWeight: '800',
    textShadowColor: 'rgba(255,255,255,0.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 4,
  },
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
  wrap:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: BRAND + '12', borderRadius: 20, borderWidth: 1, borderColor: BRAND + '30' },
  emoji:  { fontSize: 16 },
  lv:     { color: BRAND, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  title:  { color: '#6b7280', fontWeight: '600' },
  barBg:  { height: 3, width: 60, backgroundColor: 'rgba(0,0,0,0.10)', borderRadius: 2, marginTop: 2 },
  barFill:{ height: 3, backgroundColor: BRAND, borderRadius: 2 },
})

// ────────────────────────────────────────────────────────
// ScoreOverviewCard — W3スタイル INJURY RISK SCORE
// ────────────────────────────────────────────────────────
const RISK_CFG = [
  { max: 24,  color: BRAND,     label: '低リスク',   phrase: '全力で追い込もう！' },
  { max: 49,  color: '#f59e0b', label: 'やや注意',   phrase: '軽めを意識しよう' },
  { max: 74,  color: '#f97316', label: '要注意',     phrase: '強度を落とそう' },
  { max: 100, color: ALERT,     label: '高リスク',   phrase: '今日は休養が必要' },
]

// hexカラーを明るく/暗くする（グラデーション用）
function shadeColor(hex: string, percent: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + Math.round(255 * percent)))
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + Math.round(255 * percent)))
  const b = Math.min(255, Math.max(0, (n & 0xff) + Math.round(255 * percent)))
  return `rgb(${r}, ${g}, ${b})`
}

// リング型ゲージ（中央に数値）
function RiskRing({ score, color, trackColor, size = 132 }: { score: number; color: string; trackColor: string; size?: number }) {
  const strokeWidth = 18
  const gradId = `riskRingGrad-${color.replace('#', '')}`
  const r = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * r
  const pct = Math.min(100, Math.max(0, score)) / 100
  const dashOffset = circumference * (1 - pct)

  // 外周の目盛りドット（12個）
  const tickCount  = 12
  const tickRadius = size / 2 - 2
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const angle = (i / tickCount) * 2 * Math.PI - Math.PI / 2
    return {
      cx: size / 2 + tickRadius * Math.cos(angle),
      cy: size / 2 + tickRadius * Math.sin(angle),
    }
  })

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={shadeColor(color, 0.18)} />
            <Stop offset="100%" stopColor={shadeColor(color, -0.12)} />
          </LinearGradient>
        </Defs>
        {ticks.map((t, i) => (
          <Circle key={i} cx={t.cx} cy={t.cy} r={1.4} fill={trackColor} />
        ))}
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Text style={[so.scoreNum, { fontSize: 44, lineHeight: 48 }]}>{score}</Text>
    </View>
  )
}

function ScoreOverviewCard({
  sessions, sleepRecords, conditionLevel, riskResult,
  effectiveRiskScore, weatherBonus, onStretchStart,
  onRefreshWeather, weatherLoading, onPressBreakdown,
}: {
  sessions: import('../../types').TrainingSession[]
  sleepRecords: import('../../types').SleepRecord[]
  conditionLevel: number
  riskResult: ReturnType<typeof calcInjuryRisk> | null
  effectiveRiskScore?: number
  weatherBonus?: number
  onStretchStart?: () => void
  onRefreshWeather?: () => void
  weatherLoading?: boolean
  onPressBreakdown?: () => void
}) {
  const { colors } = useTheme()
  const riskScore = effectiveRiskScore ?? (riskResult ? riskResult.riskScore : 0)
  const cfg = RISK_CFG.find(c => riskScore <= c.max) ?? RISK_CFG[3]

  return (
    <>
      {/* ── INJURY RISK SCORE カード（タップで内訳） ── */}
      <TutorialSpot spotKey="home_risk_card">
      <PressableScale
        onPress={onPressBreakdown}
        haptic={onPressBreakdown ? 'light' : 'none'}
        scaleAmount={0.97}
        sound="tap"
        style={[so.card, { backgroundColor: colors.surface }]}
      >
        {/* スコア行：リング＋（見出し・内訳リンク／バッジ・フレーズ／天気） */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <RiskRing score={riskScore} color={cfg.color} trackColor={colors.surface2} />
          <View style={{ gap: 8, flex: 1 }}>
            <Text style={so.riskLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>今日の怪我リスク</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <View style={[so.riskBadge, { backgroundColor: cfg.color + '18', borderColor: cfg.color + '40' }]}>
                <View style={[so.riskDot, { backgroundColor: cfg.color }]} />
                <Text style={[so.riskBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
              </View>
              <Text style={[so.phrase, { color: cfg.color }]}>{cfg.phrase}</Text>
            </View>
            {!!weatherBonus && (
              <Text style={so.weatherPt}>天気 {weatherBonus > 0 ? '+' : ''}{weatherBonus}</Text>
            )}
          </View>
        </View>
      </PressableScale>
      </TutorialSpot>

      {/* ── ストレッチバナー（リスク40以上 or チュートリアル中は常時表示） ── */}
      {(riskScore >= 40 || !!onStretchStart) && onStretchStart && (
        <TutorialSpot spotKey="home_stretch_banner">
        <PressableScale
          onPress={onStretchStart}
          haptic="medium"
          sound="whoosh"
          scaleAmount={0.97}
          style={[so.stretchBanner, { backgroundColor: colors.surface }]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
            <Text style={[so.stretchText, { color: colors.text }]}>🏃 ストレッチでスコアを下げる</Text>
            <View style={[so.stretchBtn, { backgroundColor: BRAND }]}>
              <Text style={so.stretchBtnText}>開始 →</Text>
            </View>
          </View>
        </PressableScale>
        </TutorialSpot>
      )}
    </>
  )
}

const so = StyleSheet.create({
  // メインカード — Apple UI Skills準拠（21pxスケール角丸・1pxボーダー・淡い影）
  card: {
    borderRadius: 21, padding: 20,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04, shadowRadius: 12, elevation: 2,
  },
  cardHeader:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  riskLabel:     { fontSize: 22, fontWeight: '700', letterSpacing: 0.2, color: '#111827' },
  riskBadge:     { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 21, paddingHorizontal: 12, paddingVertical: 4 },
  riskDot:       { width: 7, height: 7, borderRadius: 4 },
  riskBadgeText: { fontSize: 11, fontWeight: '700' },
  scoreNum:      { fontSize: 72, fontWeight: '700', letterSpacing: -3, color: '#111827', lineHeight: 80, marginVertical: 2, fontVariant: ['tabular-nums'] },
  phraseRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  phrase:        { fontSize: 16, fontWeight: '500' },
  weatherPt:     { fontSize: 12, color: '#808080', fontWeight: '400' },
  barTrack:      { height: 4, borderRadius: 2, overflow: 'hidden' },
  barFill:       { height: 4, borderRadius: 2 },
  // 4ステータス（カード内埋め込み 2×2）
  statInline:      { width: 64, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center', gap: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  statInlineVal:   { fontSize: 16, fontWeight: '700', letterSpacing: -0.5, color: '#111827', fontVariant: ['tabular-nums'] },
  statInlineLabel: { fontSize: 9, fontWeight: '400', color: '#808080' },
  // ストレッチバナー（ピル型CTA）
  stretchBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 21, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03, shadowRadius: 8, elevation: 1,
  },
  stretchText:   { fontSize: 14, fontWeight: '500', flex: 1 },
  stretchBtn:    { borderRadius: 21, paddingHorizontal: 20, paddingVertical: 8 },
  stretchBtnText:{ color: '#fff', fontSize: 13, fontWeight: '700' },
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
  btnActive: { backgroundColor: '#f0f2f5', borderColor: 'rgba(0,0,0,0.12)' },
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
  title:     { fontSize: 13, fontWeight: '800', flex: 1 },
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
            const isToday = iso === localDateStr(today)
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
// GoalCard — 目標 + タスク管理
// ────────────────────────────────────────────────────────
function GoalCard({
  goals,
  onUpdate,
}: {
  goals: Goal[]
  onUpdate: (goals: Goal[]) => void
}) {
  const { colors } = useTheme()
  const [showModal,     setShowModal]     = useState(false)
  const [editGoal,      setEditGoal]      = useState<Goal | null>(null)
  const [inputText,     setInputText]     = useState('')
  const [inputDeadline, setInputDeadline] = useState('')
  const [editTasks,     setEditTasks]     = useState<GoalTask[]>([])
  const [newTaskText,   setNewTaskText]   = useState('')
  const [showAchieved,  setShowAchieved]  = useState(false)
  const [expandedId,    setExpandedId]    = useState<string | null>(null)
  const [confettiGoalId, setConfettiGoalId] = useState<string | null>(null)
  const [longPressGoalId, setLongPressGoalId] = useState<string | null>(null)
  const longPressProgress = useRef(new Animated.Value(0)).current
  const longPressAnim = useRef<Animated.CompositeAnimation | null>(null)

  // confetti パーティクル
  const PARTICLES = 18
  const particleAnims = useRef(
    Array.from({ length: PARTICLES }, () => ({
      x:  new Animated.Value(0),
      y:  new Animated.Value(0),
      op: new Animated.Value(0),
      rot: new Animated.Value(0),
      scale: new Animated.Value(0),
    }))
  ).current
  const EMOJIS = ['🏆','⭐','✨','🎉','🎊','💫','🌟','🔥']

  function triggerConfetti(goalId: string) {
    setConfettiGoalId(goalId)
    particleAnims.forEach((p, i) => {
      const angle = (i / PARTICLES) * Math.PI * 2
      const dist  = 60 + Math.random() * 80
      p.x.setValue(0); p.y.setValue(0); p.op.setValue(1); p.rot.setValue(0); p.scale.setValue(0)
      Animated.parallel([
        Animated.timing(p.x,     { toValue: Math.cos(angle) * dist,   duration: 900, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
        Animated.timing(p.y,     { toValue: Math.sin(angle) * dist - 40, duration: 900, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
        Animated.timing(p.scale, { toValue: 1,    duration: 200, useNativeDriver: true }),
        Animated.timing(p.rot,   { toValue: 2,    duration: 900, useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(500),
          Animated.timing(p.op, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]),
      ]).start()
    })
    setTimeout(() => setConfettiGoalId(null), 1200)
  }

  function startLongPress(goalId: string) {
    setLongPressGoalId(goalId)
    longPressProgress.setValue(0)
    longPressAnim.current = Animated.timing(longPressProgress, {
      toValue: 1, duration: 700, useNativeDriver: false,
    })
    longPressAnim.current.start(({ finished }) => {
      if (finished) {
        achieveGoal(goalId)
        setLongPressGoalId(null)
        longPressProgress.setValue(0)
      }
    })
  }

  function cancelLongPress() {
    longPressAnim.current?.stop()
    setLongPressGoalId(null)
    longPressProgress.setValue(0)
  }

  function achieveGoal(goalId: string) {
    onUpdate(goals.map(g => g.id === goalId ? { ...g, progress: 100, achieved: true } : g))
    triggerConfetti(goalId)
  }

  const active   = goals.filter(g => !g.achieved)
  const achieved = goals.filter(g => g.achieved)

  // タスク完了数からprogress自動計算
  function calcProgress(tasks: GoalTask[]): number {
    if (tasks.length === 0) return 0
    return Math.round((tasks.filter(t => t.done).length / tasks.length) * 100)
  }

  function openAdd() {
    setEditGoal(null)
    setInputText('')
    setInputDeadline('')
    setEditTasks([])
    setNewTaskText('')
    setShowModal(true)
  }

  function openEdit(g: Goal) {
    setEditGoal(g)
    setInputText(g.text)
    setInputDeadline(g.deadline ?? '')
    setEditTasks(g.tasks ? [...g.tasks] : [])
    setNewTaskText('')
    setShowModal(true)
  }

  function addTask() {
    if (!newTaskText.trim()) return
    setEditTasks(prev => [...prev, { id: `task-${Date.now()}`, text: newTaskText.trim(), done: false }])
    setNewTaskText('')
  }

  function toggleEditTask(id: string) {
    setEditTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t))
  }

  function removeTask(id: string) {
    setEditTasks(prev => prev.filter(t => t.id !== id))
  }

  // カード上でタスクを直接チェック（モーダルを開かず）
  function toggleTaskInline(goalId: string, taskId: string) {
    const next = goals.map(g => {
      if (g.id !== goalId) return g
      const tasks = (g.tasks ?? []).map(t => t.id === taskId ? { ...t, done: !t.done } : t)
      return { ...g, tasks, progress: calcProgress(tasks) }
    })
    onUpdate(next)
  }

  function handleSave() {
    if (!inputText.trim()) return
    const progress = editTasks.length > 0 ? calcProgress(editTasks) : 0
    if (editGoal) {
      onUpdate(goals.map(g => g.id === editGoal.id
        ? { ...g, text: inputText.trim(), deadline: inputDeadline || undefined, tasks: editTasks, progress }
        : g))
    } else {
      const newGoal: Goal = {
        id: `goal-${Date.now()}`,
        text: inputText.trim(),
        deadline: inputDeadline || undefined,
        progress: 0,
        achieved: false,
        created_at: new Date().toISOString(),
        tasks: editTasks,
      }
      onUpdate([newGoal, ...goals])
    }
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
          <HapticTouch haptic="whoosh" onPress={openAdd}
            style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' }}
            activeOpacity={0.8}>
            <Ionicons name="add" size={18} color="#fff" />
          </HapticTouch>
        </View>

        {/* 目標リスト */}
        {active.length === 0 ? (
          <TouchableOpacity onPress={openAdd} activeOpacity={0.7} style={gc.emptyRow}>
            <Text style={{ color: colors.textHint, fontSize: 13 }}>タップして目標を追加しよう</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ gap: 12 }}>
            {active.map((g, idx) => {
              const dl       = daysLeft(g.deadline)
              const tasks    = g.tasks ?? []
              const done     = tasks.filter(t => t.done).length
              const total    = tasks.length
              const progress = total > 0 ? calcProgress(tasks) : g.progress
              const col      = progressColor(progress)
              const expanded = expandedId === g.id

              return (
                <View key={g.id} style={[gc.goalBlock, idx > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                  {/* 目標ヘッダー行 */}
                  <TouchableOpacity
                    onPress={() => setExpandedId(expanded ? null : g.id)}
                    activeOpacity={0.75}
                    style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}
                  >
                    <View style={{ flex: 1, gap: 5 }}>
                      {/* タイトル + 期日 */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={[gc.goalText, { color: colors.text }]} numberOfLines={expanded ? 10 : 2}>{g.text}</Text>
                        {dl && <Text style={{ color: dl.color, fontSize: 10, fontWeight: '700', flexShrink: 0 }}>{dl.text}</Text>}
                      </View>

                      {/* タスクカウンター + プログレスバー */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {total > 0 && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: col + '18', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 }}>
                            <Ionicons name="checkmark-circle" size={11} color={col} />
                            <Text style={{ color: col, fontSize: 11, fontWeight: '800' }}>{done}/{total} タスク</Text>
                          </View>
                        )}
                        <View style={[gc.barBg, { flex: 1, backgroundColor: colors.surface2 }]}>
                          <View style={[gc.barFill, { width: `${progress}%` as any, backgroundColor: col }]} />
                        </View>
                        <Text style={{ color: col, fontSize: 11, fontWeight: '800', width: 32, textAlign: 'right' }}>{progress}%</Text>
                      </View>
                    </View>

                    {/* 右側ボタン群 */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {/* 達成ボタン（長押し or onLongPress で達成） */}
                      <View style={{ position: 'relative', alignItems: 'center' }}>
                        {/* 長押し中の進行バー */}
                        <View style={{ width: 52, height: 44, borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
                          <Animated.View style={{
                            position: 'absolute', top: 0, left: 0, bottom: 0,
                            borderRadius: 10,
                            backgroundColor: '#34C75966',
                            width: longPressGoalId === g.id
                              ? longPressProgress.interpolate({ inputRange: [0,1], outputRange: ['0%','100%'] })
                              : '0%',
                          }} />
                          <TouchableOpacity
                            onPressIn={() => startLongPress(g.id)}
                            onPressOut={cancelLongPress}
                            onLongPress={() => { cancelLongPress(); achieveGoal(g.id) }}
                            delayLongPress={600}
                            activeOpacity={0.75}
                            style={{
                              width: 52, height: 44, borderRadius: 10,
                              backgroundColor: 'transparent',
                              borderWidth: 1.5,
                              borderColor: longPressGoalId === g.id ? '#34C759' : colors.border,
                              alignItems: 'center', justifyContent: 'center',
                              gap: 1,
                            }}
                          >
                            <Text style={{ fontSize: 14 }}>🏆</Text>
                            <Text style={{ fontSize: 9, color: longPressGoalId === g.id ? '#34C759' : colors.textSec, fontWeight: '600' }}>
                              {longPressGoalId === g.id ? '達成！' : '長押し'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                        {/* confetti パーティクル */}
                        {confettiGoalId === g.id && particleAnims.map((p, i) => (
                          <Animated.Text
                            key={i}
                            style={{
                              position: 'absolute', top: 8, left: 8,
                              fontSize: 14, opacity: p.op,
                              transform: [
                                { translateX: p.x },
                                { translateY: p.y },
                                { scale: p.scale },
                                { rotate: p.rot.interpolate({ inputRange: [0,2], outputRange: ['0deg','720deg'] }) },
                              ],
                            }}
                          >
                            {EMOJIS[i % EMOJIS.length]}
                          </Animated.Text>
                        ))}
                      </View>
                      {/* 編集ボタン */}
                      <TouchableOpacity
                        onPress={() => openEdit(g)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{ padding: 4 }}
                      >
                        <Ionicons name="create-outline" size={15} color={colors.textHint} />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>

                  {/* タスクリスト（展開時） */}
                  {expanded && total > 0 && (
                    <View style={{ marginTop: 8, gap: 4, paddingLeft: 4 }}>
                      {tasks.map(t => (
                        <TouchableOpacity
                          key={t.id}
                          onPress={() => toggleTaskInline(g.id, t.id)}
                          activeOpacity={0.7}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5 }}
                        >
                          <View style={[gc.checkbox, t.done && { backgroundColor: '#34C759', borderColor: '#34C759' }]}>
                            {t.done && <Ionicons name="checkmark" size={11} color="#fff" />}
                          </View>
                          <Text style={{ color: t.done ? colors.textHint : colors.text, fontSize: 13, flex: 1, textDecorationLine: t.done ? 'line-through' : 'none' }}>
                            {t.text}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {/* タスクなし＋展開済み → タスク追加を促す */}
                  {expanded && total === 0 && (
                    <TouchableOpacity onPress={() => openEdit(g)} activeOpacity={0.7}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingLeft: 4 }}>
                      <Ionicons name="add-circle-outline" size={14} color={BRAND} />
                      <Text style={{ color: BRAND, fontSize: 12, fontWeight: '700' }}>タスクを追加</Text>
                    </TouchableOpacity>
                  )}
                </View>
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
            {(g.tasks?.length ?? 0) > 0 && (
              <Text style={{ color: '#888', fontSize: 10 }}>{g.tasks!.filter(t=>t.done).length}/{g.tasks!.length}</Text>
            )}
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

              {/* ─ タスクセクション ─ */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 8 }}>
                <Text style={[gc.label, { color: colors.textSec, marginBottom: 0 }]}>
                  タスク {editTasks.length > 0 && (
                    <Text style={{ color: BRAND }}>
                      {editTasks.filter(t => t.done).length}/{editTasks.length} 完了
                    </Text>
                  )}
                </Text>
              </View>

              {/* タスク入力行 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <TextInput
                  value={newTaskText}
                  onChangeText={setNewTaskText}
                  placeholder="新しいタスクを入力..."
                  placeholderTextColor={colors.textHint}
                  style={[gc.input, { flex: 1, marginBottom: 0, minHeight: 40 }, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface2 }]}
                  returnKeyType="done"
                  onSubmitEditing={addTask}
                />
                <TouchableOpacity onPress={addTask} style={[gc.stepBtn, { backgroundColor: BRAND, borderColor: BRAND }]} activeOpacity={0.8}>
                  <Ionicons name="add" size={18} color="#fff" />
                </TouchableOpacity>
              </View>

              {/* タスクリスト */}
              {editTasks.length > 0 && (
                <View style={{ gap: 4, marginBottom: 14, backgroundColor: colors.surface2, borderRadius: 12, padding: 10 }}>
                  {/* 全体進捗バー */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <View style={[gc.barBg, { flex: 1, backgroundColor: colors.border }]}>
                      <View style={[gc.barFill, {
                        width: `${calcProgress(editTasks)}%` as any,
                        backgroundColor: progressColor(calcProgress(editTasks)),
                      }]} />
                    </View>
                    <Text style={{ color: progressColor(calcProgress(editTasks)), fontSize: 12, fontWeight: '800', width: 36, textAlign: 'right' }}>
                      {calcProgress(editTasks)}%
                    </Text>
                  </View>

                  {editTasks.map((t, i) => (
                    <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8,
                      paddingVertical: 6, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.border }}>
                      <TouchableOpacity onPress={() => toggleEditTask(t.id)} style={[gc.checkbox, t.done && { backgroundColor: '#34C759', borderColor: '#34C759' }]}>
                        {t.done && <Ionicons name="checkmark" size={11} color="#fff" />}
                      </TouchableOpacity>
                      <Text style={{ flex: 1, fontSize: 13, color: t.done ? colors.textHint : colors.text, textDecorationLine: t.done ? 'line-through' : 'none' }}>
                        {t.text}
                      </Text>
                      <TouchableOpacity onPress={() => removeTask(t.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close-circle" size={16} color="#d1d5db" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* ボタン群 */}
              <HapticTouch haptic="save" style={[gc.saveBtn, !inputText.trim() && { opacity: 0.4 }]}
                onPress={handleSave} disabled={!inputText.trim()} activeOpacity={0.85}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{editGoal ? '保存' : '追加'}</Text>
              </HapticTouch>

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
  card:          { borderRadius: 18, borderWidth: 1, padding: 12, gap: 6 },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:         { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  emptyRow:      { paddingVertical: 14, alignItems: 'center' },
  goalBlock:     { paddingVertical: 6, gap: 0 },
  goalText:      { fontSize: 15, fontWeight: '700', flex: 1, lineHeight: 22 },
  barBg:         { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill:       { height: 6, borderRadius: 3 },
  checkbox:      { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#d1d5db', alignItems: 'center', justifyContent: 'center' },
  achievedToggle:{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(52,199,89,0.2)' },

  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet:        { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: '88%' },
  sheetHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  sheetTitle:   { fontSize: 17, fontWeight: '800' },
  label:        { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  input:        { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, marginBottom: 14, minHeight: 44 },
  stepBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f0f2f5', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  saveBtn:      { backgroundColor: BRAND, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 10 },
  achieveBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: '#34C759', borderRadius: 14, paddingVertical: 13, marginBottom: 10 },
  deleteBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
})

// ────────────────────────────────────────────────────────
// DashboardScreen
// ────────────────────────────────────────────────────────
const APP_OPEN_COUNT_KEY = 'score_app_open_count'

export default function DashboardScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { tier: purchaseTier, isNoad: purchaseIsNoad } = usePurchase()
  const { active: tutorialActive, stepId: tutStepId, nextStep: tutNext, onConditionModalClose, startTutorial } = useTutorial()
  const { sessions, loading, fetchSessions } = useTrainingSessions()
  const [appOpenCount,     setAppOpenCount]     = useState(0)
  const [selectedDate,    setSelectedDate]    = useState(getTodayISO())
  const [showQuickLog,    setShowQuickLog]    = useState(false)
  const [showQuickCondition, setShowQuickCondition] = useState(false)
  const [showRiskBreakdown, setShowRiskBreakdown] = useState(false)
  const [conditionMap,    setConditionMap]    = useState<Record<string,number>>({})
  const conditionLevel = conditionMap[selectedDate] ?? 6
  // 今日以外の日付を見ているか（過去/未来の日付タップ時は表示を絞る）
  const isViewingToday = selectedDate === getTodayISO()
  useEffect(() => { setDoneBannerDismissed(false) }, [selectedDate])
  // 選択中の日付を基準にした、直近7日の平均体調（リスク計算用）
  // 日付バーで別の日をタップすると、その日を基準に7日分を遡って計算し直す
  const avgConditionLevel = useMemo(() => {
    const asOf = new Date(selectedDate + 'T12:00:00')
    const vals = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(asOf); d.setDate(d.getDate() - i)
      return conditionMap[localDateStr(d)]
    }).filter((v): v is number => v !== undefined)
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : conditionLevel
  }, [conditionMap, selectedDate, conditionLevel])
  const [sleepRecords,    setSleepRecords]    = useState<SleepRecord[]>([])
  const [recoveryRecords, setRecoveryRecords] = useState<Array<{ date: string }>>([])
  // 選択中の日付を基準に、直近7日以内の違和感・痛み記録があるかを判定
  const hasSymptom = useMemo(() => {
    const sevenDaysAgo = localDateStr(new Date(new Date(selectedDate + 'T12:00:00').getTime() - 7 * 86400000))
    return recoveryRecords.some(r => r.date >= sevenDaysAgo && r.date <= selectedDate)
  }, [recoveryRecords, selectedDate])
  // 今日まだ入力していない項目（ホーム画面トップのCTA用）
  const todayUnfilled = useMemo(() => {
    const today = getTodayISO()
    const items: { key: string; icon: string; label: string; onPress: () => void }[] = []
    if (conditionMap[today] === undefined) {
      items.push({ key: 'condition', icon: '🙂', label: '今日の体調を記録しよう', onPress: () => setShowQuickCondition(true) })
    }
    if (!sleepRecords.some(r => r.sleep_date === today)) {
      items.push({ key: 'sleep', icon: '😴', label: '睡眠記録を入力しよう', onPress: () => setShowQuickCondition(true) })
    }
    if (!sessions.some(sess => sess.session_date === today)) {
      items.push({ key: 'practice', icon: '🏃', label: '今日の練習を記録しよう', onPress: () => setShowQuickLog(true) })
    }
    return items
  }, [conditionMap, sleepRecords, sessions])
  const [tasks,           setTasks]           = useState<ImprovementTask[]>([])
  const [goals,           setGoals]           = useState<Goal[]>([])
  const [showAIAdvice,    setShowAIAdvice]    = useState(false)
  const [aiAdvice,        setAiAdvice]        = useState('')
  const [loadingAI,       setLoadingAI]       = useState(false)
  const [insightClaimed,  setInsightClaimed]  = useState<boolean | null>(null)  // null = チェック中
  const [insightLoading,  setInsightLoading]  = useState(false)
  const [weatherBonus,    setWeatherBonus]    = useState(0)
  const [weatherText,     setWeatherText]     = useState<string | null>(null)
  const [weatherLoading,  setWeatherLoading]  = useState(false)
  const [stretchReduction,setStretchReduction]= useState(0)
  const [recoveryBanner,  setRecoveryBanner]  = useState<{ reduction: number } | null>(null)
  const [teamNotifs,      setTeamNotifs]      = useState<TeamEventRow[]>([])
  const [reviewWallVisible, setReviewWallVisible] = useState(false)
  const [noadUpsellVisible, setNoadUpsellVisible] = useState(false)
  const [confirmedIds,    setConfirmedIds]    = useState<Set<string>>(new Set())
  const [notifReadIds,    setNotifReadIds]    = useState<Set<string>>(new Set())
  const [shareSession,    setShareSession]    = useState<PracticeShareData | null>(null)
  const [injuryDaysLeft,     setInjuryDaysLeft]     = useState<number | null>(null)
  const [injuryFreeDays,     setInjuryFreeDays]     = useState<number>(0)
  const [compDaysLeft,       setCompDaysLeft]       = useState<{ name: string; days: number } | null>(null)
  const [showCountdownModal, setShowCountdownModal] = useState(false)
  const [igBannerVisible, setIgBannerVisible] = useState(false)
  const [doneBannerDismissed, setDoneBannerDismissed] = useState(false)

  // AdGate async チェック中の二重タップ防止
  const insightCallRef = useRef(false)
  // ── アプリ起動トラッキング（1日1回） ──
  // 初回起動時（チュートリアル未完了）にチュートリアルを起動
  useEffect(() => {
    isTutorialDone().then(done => {
      if (!done) setTimeout(() => startTutorial(), 600)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Instagramバナー：閉じたことがなければ表示
  useEffect(() => {
    AsyncStorage.getItem('score_ig_banner_dismissed').then(v => {
      if (!v) setIgBannerVisible(true)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const TODAY = todayLocalISO()
    AsyncStorage.getItem('score_last_open_tracked').then(last => {
      if (last !== TODAY) {
        trackAppOpen()
        AsyncStorage.setItem('score_last_open_tracked', TODAY).catch(() => {})
        // アプリ起動回数をインクリメント
        AsyncStorage.getItem(APP_OPEN_COUNT_KEY).then(raw => {
          const newCount = (raw ? parseInt(raw, 10) : 0) + 1
          setAppOpenCount(newCount)
          AsyncStorage.setItem(APP_OPEN_COUNT_KEY, String(newCount)).catch(() => {})
        }).catch(() => {})
      } else {
        AsyncStorage.getItem(APP_OPEN_COUNT_KEY).then(raw => {
          setAppOpenCount(raw ? parseInt(raw, 10) : 0)
        }).catch(() => {})
      }
    }).catch(() => {})
  }, [])

  // カウントダウンデータは reloadAll（useFocusEffect）で取得するため個別useEffectは不要

  useEffect(() => {
    AsyncStorage.multiGet([CONDITION_MAP_KEY, CONDITION_KEY]).then(([[, mapStr], [, oldVal]]) => {
      if (mapStr) {
        try { setConditionMap(JSON.parse(mapStr)) } catch {}
      } else if (oldVal) {
        const migrated = { [getTodayISO()]: Number(oldVal) }
        setConditionMap(migrated)
        AsyncStorage.setItem(CONDITION_MAP_KEY, JSON.stringify(migrated)).catch(() => {})
      }
    }).catch(() => {})
  }, [])

  // ── 天気：キャッシュを即反映するヘルパー ──────────────────────────────────
  const applyWeather = useCallback((w: import('../../lib/weather').WeatherData) => {
    const bonus = calcWeatherRiskBonus(w)
    setWeatherBonus(bonus)
    setWeatherText(getWeatherRiskText(w, bonus))
  }, [])

  // ── 天気取得（1日1回のみAPI呼び出し、それ以外はキャッシュ）────────────────
  const fetchWeather = useCallback(async (forceRefresh = false) => {
    setWeatherLoading(true)
    try {
      if (forceRefresh) await clearWeatherCache()
      const w = await getCachedWeather()
      if (w) applyWeather(w)
    } catch {}
    finally { setWeatherLoading(false) }
  }, [applyWeather])

  // 起動直後：キャッシュがあれば遅延なしで即表示 → その後バックグラウンドで更新チェック
  useEffect(() => {
    // ① まずキャッシュのみ即読み（画面が開いた瞬間に表示）
    getWeatherCacheOnly().then(w => { if (w) applyWeather(w) }).catch(() => {})
    // ② 600ms後にAPI or キャッシュ有効期限チェック（当日まだ未取得なら取得）
    const t = setTimeout(() => fetchWeather(), 600)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // レビューウォール：起動5回目以降に表示（4秒後に）
  // チュートリアル中・App Open広告表示中は表示しない（複数の Modal/native広告が
  // 同時に present されると、片方を閉じてももう片方の presentation が残って
  // 画面全体がタップ無反応になることがあるため、必ず1つずつ表示する）
  useEffect(() => {
    if (tutorialActive) return
    const t = setTimeout(async () => {
      try {
        if (tutorialActive || isAppOpenAdShowing()) return
        const show = await shouldShowReviewWall()
        if (show) setReviewWallVisible(true)
      } catch {}
    }, 4000)
    return () => clearTimeout(t)
  }, [tutorialActive])

  // 広告なしプランの案内：FREEユーザーのみ、週1回程度
  // （チュートリアル中・レビューウォール表示中・App Open広告表示中は重ならないよう見送る）
  useEffect(() => {
    if (purchaseTier !== 'free' || tutorialActive || reviewWallVisible) return
    const t = setTimeout(async () => {
      try {
        if (tutorialActive || reviewWallVisible || isAppOpenAdShowing()) return
        const show = await shouldShowNoadUpsell()
        if (show) setNoadUpsellVisible(true)
      } catch {}
    }, 6000)
    return () => clearTimeout(t)
  }, [purchaseTier, tutorialActive, reviewWallVisible])

  function handleGoalsUpdate(next: Goal[]) {
    setGoals(next)
    AsyncStorage.setItem(GOALS_KEY, JSON.stringify(next)).catch(() => {})
  }

  const reloadAll = useCallback(() => {
    // カウントダウンデータ（怪我・試合）
    const todayMs = (() => { const d = new Date(); d.setHours(0,0,0,0); return d })()
    AsyncStorage.getItem('trackmate_injury_records').then(raw => {
      if (!raw) { setInjuryDaysLeft(null); setInjuryFreeDays(0); return }
      try {
        const recs = JSON.parse(raw) as Array<{ status: string; startDate: string; totalDays: number; createdAt?: string }>
        const active = recs.find(r => r.status === 'active')
        if (active) {
          const start = new Date(active.startDate); start.setHours(0,0,0,0)
          const elapsed = Math.floor((todayMs.getTime() - start.getTime()) / 86400000)
          setInjuryDaysLeft(Math.max(0, active.totalDays - elapsed))
          setInjuryFreeDays(0)
        } else {
          setInjuryDaysLeft(null)
          const completed = recs.filter(r => r.status === 'completed')
          if (completed.length > 0) {
            const last = completed.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0]
            const endDate = new Date(last.startDate); endDate.setDate(endDate.getDate() + last.totalDays); endDate.setHours(0,0,0,0)
            setInjuryFreeDays(Math.max(0, Math.floor((todayMs.getTime() - endDate.getTime()) / 86400000)))
          } else { setInjuryFreeDays(0) }
        }
      } catch { setInjuryDaysLeft(null); setInjuryFreeDays(0) }
    }).catch(() => { setInjuryDaysLeft(null); setInjuryFreeDays(0) })
    AsyncStorage.getItem('trackmate_competitions').then(raw => {
      if (!raw) { setCompDaysLeft(null); return }
      try {
        const all = JSON.parse(raw) as Array<{ competition_name: string; competition_date: string }>
        const todayStr = localDateStr(todayMs)
        const upcoming = all.filter(c => c.competition_date >= todayStr).sort((a,b) => a.competition_date.localeCompare(b.competition_date))[0]
        if (!upcoming) { setCompDaysLeft(null); return }
        const compDate = new Date(upcoming.competition_date); compDate.setHours(0,0,0,0)
        setCompDaysLeft({ name: upcoming.competition_name, days: Math.ceil((compDate.getTime() - todayMs.getTime()) / 86400000) })
      } catch { setCompDaysLeft(null) }
    }).catch(() => { setCompDaysLeft(null) })
    fetchSessions('')
    // ストレッチ結果読み込み
    const today = todayLocalISO()
    AsyncStorage.getItem(STRETCH_RESULT_KEY).then(raw => {
      if (!raw) return
      let parsed: any
      try { parsed = JSON.parse(raw) } catch { return }
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
            const recs = JSON.parse(recovStr) as Array<{ date: string }>
            setRecoveryRecords(recs)
          } catch {}
        }
      }
    ).catch(() => {})
  }, [fetchSessions])
  // App Open Ad — 離脱率が高くなるため無効化

  useFocusEffect(useCallback(() => {
    reloadAll()
    // デイリーインサイト 取得済みかチェック
    hasDailyInsightClaimed().then(claimed => setInsightClaimed(claimed)).catch(() => {})
    // ホーム画面が表示されるたびにチームへセッションを同期
    AsyncStorage.getItem('trackmate_sessions').then(raw => {
      if (raw) { try { autoSyncTeam(JSON.parse(raw)).catch(() => {}) } catch {} }
    }).catch(() => {})
    // チーム予定 + 確認済みIDを取得
    Promise.all([
      AsyncStorage.getItem(JOINED_KEY),
      AsyncStorage.getItem(EVENT_CONFIRMED_KEY),
    ]).then(([joinedRaw, confirmedRaw]) => {
      try { setConfirmedIds(new Set(confirmedRaw ? JSON.parse(confirmedRaw) : [])) } catch {}
      if (!joinedRaw) return
      let joined: any
      try { joined = JSON.parse(joinedRaw) } catch { return }
      if (!joined?.code) return
      if (Date.now() - lastTeamEventsFetch.current >= 5 * 60 * 1000) {
        lastTeamEventsFetch.current = Date.now()
        fetchTeamEvents(joined.code).then(evts => {
          // 未来 or 今日の予定のみ（過去は除外）
          setTeamNotifs(evts.filter(e => !isPastEvent(e.event_date)))
        }).catch(() => {})
      }
    }).catch(() => {})
    // 通知画面から戻ったとき用：既読IDを再ロードしてバッジを消す
    AsyncStorage.getItem(NOTIF_READ_KEY).then(raw => {
      try { setNotifReadIds(new Set(raw ? JSON.parse(raw) : [])) } catch {}
    }).catch(() => {})
  }, [reloadAll]))

  function loadTasks() {
    AsyncStorage.getItem(TASKS_KEY).then(r => {
      if (r) { try { setTasks(JSON.parse(r)) } catch {} }
    }).catch(() => {})
  }

  function toggleTask(id: string) {
    setTasks(prev => {
      const next = prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t)
      AsyncStorage.setItem(TASKS_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }

  // ── デイリーAIインサイト（広告視聴で取得）────────────────────
  async function handleDailyInsight() {
    if (insightCallRef.current) return  // 二重タップ防止
    if (insightClaimed === true || insightClaimed === null || insightLoading) return
    insightCallRef.current = true
    try {
      // 広告なしプラン以上は広告視聴不要で直接取得
      if (purchaseIsNoad) {
        await markDailyInsightClaimed()
        setInsightClaimed(true)
        handleGetAIAdvice()
        return
      }
      // FREEは広告視聴が必要
      setInsightLoading(true)
      try {
        const watched = await showRewardedAd()
        if (watched) {
          await markDailyInsightClaimed()
          setInsightClaimed(true)
          handleGetAIAdvice()
        } else {
          // 広告が読み込めなかった場合（審査環境・圏外など）はフォールバックUIを表示
          Alert.alert(
            '広告を読み込めませんでした',
            '通信環境をご確認のうえ、しばらく後にお試しください。',
            [{ text: 'OK', style: 'cancel' }]
          )
        }
      } finally {
        setInsightLoading(false)
      }
    } finally {
      insightCallRef.current = false
    }
  }

  const AI_ADVICE_CACHE_KEY = 'score_ai_advice_daily_cache'

  // ── AIコーチアドバイス ──────────────────────────────────
  async function handleGetAIAdvice() {
    setLoadingAI(true)
    setShowAIAdvice(true)
    setAiAdvice('')
    try {
      const today  = todayLocalISO()

      // 日次キャッシュチェック（同日は API を呼ばない）
      try {
        const cached = await AsyncStorage.getItem(AI_ADVICE_CACHE_KEY)
        if (cached) {
          const { date, advice } = JSON.parse(cached)
          if (date === today && advice) {
            setAiAdvice(advice)
            setLoadingAI(false)
            return
          }
        }
      } catch {}

      // 直近7日の練習データ
      const sevenDaysAgo = localDateStr(new Date(Date.now() - 7 * 86400000))
      const recentSessions = sessions.filter(s => s.session_date >= sevenDaysAgo).slice(0, 10)

      // 睡眠データ
      const recentSleep = sleepRecords.slice(0, 7)

      // リスクスコア
      const riskLabel = riskResult
        ? `${riskResult.riskScore}/100（${riskResult.label}）`
        : '未計算'

      const conditionLabel = ['きつい','きつめ','しんどい','やや重い','ふつう','まあまあ','いい感じ','好調','絶好調','最高'][conditionLevel - 1] ?? 'ふつう'

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

      const systemPrompt = `あなたは陸上競技専門のエリートコーチです。オリンピック選手も指導した経験を持ち、スポーツ科学・栄養学・スポーツ心理学の知識を統合した高度なアドバイスができます。

コーチとしてのスタイル：
- 選手のデータを深く読み解き、表面的でない本質的な課題を指摘する
- 具体的な数値・種目名・タイムを出して語る（「もっと走れ」ではなく「火曜の400m×6本はインターバルを90秒に縮めてみよう」）
- 選手の頑張りをちゃんと認め、自信を持たせてから改善点を伝える
- 科学的根拠を簡潔に添える（「睡眠不足は成長ホルモンの分泌を30%下げる」など）
- 語尾は「〜だ」「〜しよう」「〜が大切」など、コーチらしい力強い言葉で締める
- 絶対にテンプレっぽい文章にしない。その選手のデータを見て初めて言える言葉を選ぶ`

      const prompt = `今日は${today}。以下の選手データを見て、このコーチとしての分析・アドバイスをしてください。

━━━ 選手の現在地 ━━━
体調スコア：${conditionLevel}/10（${conditionLabel}）
怪我リスク：${riskLabel}
痛み・違和感：${hasSymptom ? '⚠️ あり（直近7日以内に記録あり）' : 'なし'}

━━━ 直近7日の練習 ━━━
${sessionsText || '記録なし（まだ練習ログがない）'}

━━━ 睡眠 ━━━
${sleepText || 'データなし'}

━━━━━━━━━━━━━━━━━━━━━

以下の構成で、このコーチとしてのリアルな言葉でアドバイスしてください。

🔍 **今週の総評**
（練習量・強度・体調の変化を具体的に読み解く。数字を使う。）

💪 **よくやった点・強み**
（認めるべき努力や成果を正直に伝える。具体的に。）

⚡ **今すぐ変えるべきこと**
（最も重要な改善点1〜2個を、理由と一緒にズバリ言う。）

🗓 **明日〜来週の練習方針**
（今週のデータを踏まえた具体的な練習提案。種目・セット数・強度まで）

🌙 **リカバリー・コンディション**
（睡眠・栄養・疲労管理について、今のデータに基づいた具体策）

最後に、コーチとしての一言メッセージ（1〜2文。熱く、でも的確に）`

      {
        const apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
        const endpoint = `${apiBase}/api/analyze`
        const res = await fetchWithTimeout(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1400,
            system: systemPrompt,
            messages: [{ role: 'user', content: prompt }],
          }),
        }, 35000)
        if (res.ok) {
          const data = await res.json()
          const txt = data.content?.[0]?.text
          const advice = txt && txt.trim().length > 0 ? txt : 'アドバイスを取得できませんでした。練習・体調データを記録してから再試行してください。'
          setAiAdvice(advice)
          // 当日分をキャッシュ保存（次回から API 不要）
          AsyncStorage.setItem(AI_ADVICE_CACHE_KEY, JSON.stringify({ date: today, advice })).catch(() => {})
          showInterstitialAd().catch(() => {})
        } else {
          const errBody = await res.text().catch(() => '')
          setAiAdvice(`⚠️ APIエラー (${res.status})。しばらくしてから再試行してください。\n${errBody.slice(0,80)}`)
        }
      }
    } catch (err: any) {
      setAiAdvice(`⚠️ 接続エラー: ${err?.message ?? 'もう一度お試しください。'}`)
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

  // ── 怪我リスク計算（選択中の日付を基準に、それ以降の記録は無視して計算） ──
  // ストレッチ・リカバリーの軽減分は、疲労蓄積(TSB)・直近疲労度のスコアに直接反映する
  const riskResult = useMemo(() => {
    if (loading === 'loading' || loading === 'idle') return null
    const asOfMs = new Date(selectedDate + 'T23:59:59').getTime()
    const filteredSessions = isViewingToday ? sessions : sessions.filter(s => s.session_date.slice(0, 10) <= selectedDate)
    const filteredSleep    = isViewingToday ? sleepRecords : sleepRecords.filter(s => s.sleep_date.slice(0, 10) <= selectedDate)
    const recoveryReductionPts = isViewingToday ? stretchReduction : 0
    return calcInjuryRisk(filteredSessions, filteredSleep, avgConditionLevel, hasSymptom, { recoveryReductionPts }, asOfMs)
  }, [sessions, sleepRecords, avgConditionLevel, hasSymptom, loading, selectedDate, isViewingToday, stretchReduction])

  // 天気ボーナスを反映した有効リスクスコア（ストレッチ軽減はriskResult内で計算済み）
  const effectiveRiskScore = useMemo(() => {
    if (!riskResult) return null
    const bonus = isViewingToday ? weatherBonus : 0
    return Math.min(100, Math.max(0, riskResult.riskScore + bonus))
  }, [riskResult, weatherBonus, isViewingToday])

  // 怪我リスクが高い場合に通知を送る（初回マウント + スコアが閾値を超えた時のみ）
  const prevRiskRef = useRef<number | null>(null)
  useEffect(() => {
    if (effectiveRiskScore == null) return
    const prev = prevRiskRef.current
    prevRiskRef.current = effectiveRiskScore
    // 前回から閾値をまたいで上昇した場合のみ通知（再マウントやリフレッシュでは発火しない）
    const crossedRisk    = prev !== null && prev < 80 && effectiveRiskScore >= 80
    const crossedStretch = prev !== null && prev < 75 && effectiveRiskScore >= 75
    if (crossedRisk) {
      sendRiskAlertIfNeeded(effectiveRiskScore)
      // コーチに怪我リスクを通知
      AsyncStorage.getItem(JOINED_KEY).then(raw => {
        if (!raw) return
        let joined: any
        try { joined = JSON.parse(raw) } catch { return }
        if (joined?.code && joined?.playerName) {
          sendCoachNotification(
            joined.code,
            'risk_alert',
            joined.playerName,
            `${joined.playerName}の怪我リスクが高くなっています（スコア: ${effectiveRiskScore}）`,
          ).catch(() => {})
        }
      }).catch(() => {})
    }
    if (crossedStretch) sendStretchReminderIfNeeded(effectiveRiskScore, stretchReduction > 0)
  }, [effectiveRiskScore, stretchReduction])

  // 連続記録ストリーク通知：今日未記録で連続中なら今夜21:00に予約（記録すれば自動キャンセル）
  useEffect(() => {
    const ds = new Set(sessions.map(s => s.session_date))
    const today = todayLocalISO()
    const recordedToday = ds.has(today)
    let streak = 0
    for (let i = 0; i < 365; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      if (ds.has(localDateStr(d))) streak++
      else if (i > 0) break
    }
    scheduleStreakReminder(streak, recordedToday).catch(() => {})
  }, [sessions])

  const handleStretchStart = useCallback(() => {
    router.push({ pathname: '/stretch-recovery', params: { riskScore: (effectiveRiskScore ?? 50).toString() } } as any)
  }, [effectiveRiskScore])

  // ── スクロールトップ ──
  const scrollRef            = useRef<ScrollView>(null)
  const lastTeamEventsFetch  = useRef<number>(0)
  useEffect(() => {
    registerHomeScroll(() => scrollRef.current?.scrollTo({ y: 0, animated: true }))
    setQuickLogListener(() => setShowQuickLog(true))
    return () => { unregisterHomeScroll(); clearQuickLogListener() }
  }, [])

  const todayStr = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  })

  return (
    <ScreenGradient colors={['#e8e8ec', '#dbe0cd', '#d8d8de']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
      {/* ── ホーム画面ヘッダーイラスト（陸上選手・グリーン基調、下端は透明にフェード） ── */}
      <Image
        source={require('../../assets/illustrations/home-header.png')}
        style={s.headerIllustration}
        resizeMode="cover"
      />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* ── 週間日付バー ── */}
          <AnimatedEntry delay={30}>
            <WeekDateBar selected={selectedDate} onChange={setSelectedDate} conditionMap={conditionMap} />
          </AnimatedEntry>

          {/* ── ここから：今日を見ている時だけ表示するセクション群 ── */}
          {isViewingToday && (<>
          {/* ── 今日まだ入力していないことCTA（未入力があれば最優先で表示） ── */}
          {todayUnfilled.length > 0 ? (
            <AnimatedEntry delay={35}>
              <View style={{
                backgroundColor: colors.surface,
                borderRadius: 14,
                borderWidth: 1.5,
                borderColor: BRAND + '55',
                overflow: 'hidden',
                marginBottom: 10,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 }}>
                  <Ionicons name="alert-circle" size={16} color={BRAND} />
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>今日まだ入力していないこと</Text>
                </View>
                {todayUnfilled.map((item, i) => (
                  <TouchableOpacity
                    key={item.key}
                    activeOpacity={0.75}
                    onPress={() => { unlockAudio(); item.onPress() }}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 10,
                      paddingHorizontal: 14, paddingVertical: 12,
                      borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 18 }}>{item.icon}</Text>
                    <Text style={{ flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' }}>{item.label}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textHint} />
                  </TouchableOpacity>
                ))}
              </View>
            </AnimatedEntry>
          ) : !doneBannerDismissed && (
            <AnimatedEntry delay={35}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 14, borderWidth: 1, borderColor: BRAND + '40',
                paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
                shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
              }}>
                <Ionicons name="checkmark-circle" size={18} color={BRAND} />
                <Text style={{ flex: 1, color: colors.text, fontSize: 13, fontWeight: '700' }}>今日の記録は完了！お疲れさまでした 🎉</Text>
                <TouchableOpacity onPress={() => setDoneBannerDismissed(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={18} color={colors.textHint} />
                </TouchableOpacity>
              </View>
            </AnimatedEntry>
          )}
          {/* ── Instagram フォロー促進バナー ── */}
          {igBannerVisible && (
            <AnimatedEntry delay={40}>
              <TouchableOpacity
                activeOpacity={0.88}
                onPress={() => Linking.openURL('https://www.instagram.com/score.app.japan/')}
                style={{
                  marginHorizontal: 0, marginBottom: 10,
                  borderRadius: 14,
                  overflow: 'hidden',
                  backgroundColor: '#1a1a1a',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.1)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  gap: 12,
                }}
              >
                {/* Instagramグラデーションアイコン */}
                <View style={{
                  width: 40, height: 40, borderRadius: 12,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: '#E1306C22',
                }}>
                  <Text style={{ fontSize: 22 }}>📸</Text>
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800', marginBottom: 2 }}>
                    @score.app.japan フォローしてますか？
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, lineHeight: 15 }}>
                    Monthly Challenge 開催中🎯 参加してベストを更新しよう
                  </Text>
                </View>

                {/* 閉じるボタン */}
                <TouchableOpacity
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={(e) => {
                    e.stopPropagation()
                    setIgBannerVisible(false)
                    AsyncStorage.setItem('score_ig_banner_dismissed', '1').catch(() => {})
                  }}
                >
                  <Ionicons name="close" size={18} color="rgba(255,255,255,0.35)" />
                </TouchableOpacity>
              </TouchableOpacity>
            </AnimatedEntry>
          )}

          {/* ── チーム通知バナー ── */}
          {teamNotifs.length > 0 && (() => {
            const newUnconfirmed = teamNotifs.filter(e => isNewTeamEvent(e.created_at) && !confirmedIds.has(e.id))
            const upcoming = [...teamNotifs].sort((a, b) => a.event_date.localeCompare(b.event_date))
            const featured = newUnconfirmed[0] ?? upcoming[0]
            if (!featured) return null
            const cfg = EVENT_CFG_HOME[featured.event_type] ?? EVENT_CFG_HOME.other
            const isNew = isNewTeamEvent(featured.created_at) && !confirmedIds.has(featured.id)
            const extraCount = teamNotifs.length - 1
            return (
              <AnimatedEntry delay={45}>
                <HapticTouch
                  haptic="whoosh"
                  activeOpacity={0.85}
                  onPress={() => router.push('/(tabs)/team')}
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: isNew ? BRAND + '60' : colors.border,
                    overflow: 'hidden',
                  }}
                >
                  {/* NEW帯（新着があるときのみ） */}
                  {isNew && (
                    <View style={{ backgroundColor: BRAND, paddingHorizontal: 14, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>新しい予定が追加されました</Text>
                      {newUnconfirmed.length > 1 && (
                        <View style={{ marginLeft: 'auto', backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}>
                          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>+{newUnconfirmed.length - 1}件</Text>
                        </View>
                      )}
                    </View>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 }}>
                    {/* イベントアイコン */}
                    <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: cfg.color + '18', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 20 }}>{cfg.emoji}</Text>
                    </View>
                    {/* 内容 */}
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{featured.title}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Text style={{ color: cfg.color, fontSize: 12, fontWeight: '700' }}>{fmtEventDateHome(featured.event_date)}</Text>
                        {!!featured.event_time && <Text style={{ color: colors.textSec, fontSize: 11 }}>{featured.event_time}</Text>}
                        {!!featured.location && <Text style={{ color: colors.textSec, fontSize: 11 }}>📍{featured.location}</Text>}
                      </View>
                      {extraCount > 0 && (
                        <Text style={{ color: colors.textHint, fontSize: 11 }}>他{extraCount}件の予定 →</Text>
                      )}
                    </View>
                    {/* 矢印 */}
                    <Ionicons name="chevron-forward" size={16} color={colors.textHint} />
                  </View>
                </HapticTouch>
              </AnimatedEntry>
            )
          })()}
          </>)}
          {/* ── ここまで：今日限定セクション ── */}

          {/* ── INJURY RISK SCORE ── */}
          <AnimatedEntry delay={90}>
            <ScoreOverviewCard
              sessions={sessions}
              sleepRecords={sleepRecords}
              conditionLevel={avgConditionLevel}
              riskResult={riskResult}
              effectiveRiskScore={effectiveRiskScore ?? undefined}
              weatherBonus={weatherBonus}
              onStretchStart={handleStretchStart}
              onRefreshWeather={() => fetchWeather(true)}
              weatherLoading={weatherLoading}
              onPressBreakdown={() => setShowRiskBreakdown(true)}
            />
          </AnimatedEntry>

          {/* ── 選択中の日（今日以外）の記録内容 ── */}
          {!isViewingToday && (
            <AnimatedEntry delay={100}>
              <GlassCard>
                <View style={s.sectionRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="calendar-outline" size={14} color={BRAND} />
                    <Text style={[s.sectionLabel, { color: colors.text }]}>
                      {selectedDate.slice(5).replace('-', '/')} の記録
                    </Text>
                  </View>
                </View>
                {(() => {
                  const daySessions = sessions.filter(sess => sess.session_date === selectedDate)
                  if (daySessions.length === 0) {
                    return (
                      <View style={{ alignItems: 'center', gap: 6, paddingVertical: 20 }}>
                        <Ionicons name="barbell-outline" size={28} color={colors.textHint} />
                        <Text style={{ color: colors.textHint, fontSize: 13 }}>この日の記録はありません</Text>
                      </View>
                    )
                  }
                  const SESSION_TYPE_MAP: Record<string, { color: string; label: string }> = {
                    interval: { color: '#F5A623', label: 'インターバル' },
                    tempo:    { color: '#FF9500', label: 'テンポ走' },
                    easy:     { color: '#4ECDC4', label: 'ジョグ' },
                    long:     { color: '#5AC8FA', label: 'ロング走' },
                    sprint:   { color: '#FF6B6B', label: 'スプリント' },
                    drill:    { color: '#AF52DE', label: 'ドリル' },
                    strength: { color: '#FF6B35', label: 'ウェイト' },
                    race:     { color: '#FFD700', label: '試合' },
                    rest:     { color: '#888',    label: '休養' },
                  }
                  const fmtTime = (ms: number) => {
                    const sec = ms / 1000
                    if (sec < 60) return `${sec.toFixed(2)}"`
                    return `${Math.floor(sec/60)}'${(sec%60).toFixed(2).padStart(5,'0')}"`
                  }
                  return daySessions.map((sess, idx) => {
                    const typeInfo = SESSION_TYPE_MAP[sess.session_type] ?? { color: '#888', label: sess.session_type }
                    const fat = sess.fatigue_level ?? 5
                    const fatColor = fat >= 8 ? '#FF6B6B' : fat >= 6 ? '#FF9500' : '#4ECDC4'
                    return (
                      <View key={sess.id} style={[s.sessRow, idx > 0 && { borderTopWidth: 1, borderTopColor: DIVIDER }]}>
                        <View style={[s.typeBar, { backgroundColor: typeInfo.color }]} />
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={[s.sessType, { color: colors.text }]}>{typeInfo.label}</Text>
                            {sess.event ? <Text style={{ color: colors.textHint, fontSize: 11 }}>{sess.event}</Text> : null}
                          </View>
                          {sess.notes ? (
                            <Text style={[s.sessDate, { color: colors.textHint }]} numberOfLines={2}>{sess.notes}</Text>
                          ) : sess.distance_m ? (
                            <Text style={[s.sessDate, { color: colors.textHint }]}>
                              {sess.distance_m >= 1000 ? `${(sess.distance_m/1000).toFixed(1)}km` : `${sess.distance_m}m`}
                            </Text>
                          ) : null}
                        </View>
                        {sess.time_ms ? (
                          <Text style={[s.sessStat, { color: colors.textSec }]}>{fmtTime(sess.time_ms)}</Text>
                        ) : null}
                        <View style={[s.fatiguePill, { backgroundColor: fatColor + '22' }]}>
                          <Text style={{ fontSize: 10, fontWeight: '800', color: fatColor }}>疲労{fat}</Text>
                        </View>
                      </View>
                    )
                  })
                })()}
              </GlassCard>
            </AnimatedEntry>
          )}

          {/* ── ここから：今日を見ている時だけ表示するセクション群 ── */}
          {isViewingToday && (<>
          {/* ── 目標 ── */}
          <AnimatedEntry delay={100}>
            <TutorialSpot spotKey="home_goal_section">
              <GoalCard goals={goals} onUpdate={handleGoalsUpdate} />
            </TutorialSpot>
          </AnimatedEntry>

          {/* ── サクッと入力 ＋ カウントダウン ── */}
          <AnimatedEntry delay={120}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {/* サクッと入力（常時・緑背景） */}
              <TutorialSpot spotKey="home_quick_input" style={{ flex: 1 }}>
              <TouchableOpacity
                style={[s.halfCard, { flex: 1, flexDirection: 'row', backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 }]}
                onPress={() => { unlockAudio(); setShowQuickCondition(true); if (tutStepId === 'quick_input') tutNext() }}
                activeOpacity={0.78}
              >
                <Ionicons name="flash" size={18} color="#fff" />
                <Text style={{ fontSize: 13, fontWeight: '900', color: '#fff' }}>サクッと入力</Text>
              </TouchableOpacity>
              </TutorialSpot>

              {/* カウントダウンカード */}
              <TouchableOpacity
                style={[s.halfCard, { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 }]}
                onPress={() => setShowCountdownModal(true)}
                activeOpacity={0.78}
              >
                {injuryDaysLeft !== null ? (
                  <>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#FF6B6B' }}>怪我復帰まで</Text>
                    <Text style={{ fontSize: 26, fontWeight: '900', color: '#FF6B6B', letterSpacing: -1 }}>
                      {injuryDaysLeft}<Text style={{ fontSize: 14 }}> 日</Text>
                    </Text>
                  </>
                ) : compDaysLeft !== null ? (
                  <>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: BRAND }} numberOfLines={1}>{compDaysLeft.name}</Text>
                    <Text style={{ fontSize: 26, fontWeight: '900', color: BRAND, letterSpacing: -1 }}>
                      {compDaysLeft.days}<Text style={{ fontSize: 14 }}> 日</Text>
                    </Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="timer-outline" size={18} color={colors.textHint} />
                    <Text style={{ fontSize: 12, fontWeight: '800', color: colors.textHint }}>カウントダウン</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </AnimatedEntry>

          {/* ── 動画分析 ＋ メニュー ＋ カレンダー ── */}
          <AnimatedEntry delay={160}>
            <View style={{ backgroundColor: 'rgba(163,230,53,0.16)', borderRadius: 20, padding: 8 }}>
              <View style={s.quickLinks}>
                {[
                  { icon: '📹', label: '動画分析', route: '/video-analysis',  spotKey: undefined },
                  { icon: '📋', label: 'メニュー', route: '/workout-menu',    spotKey: 'notebook_menu_link' as const },
                  { icon: '📅', label: 'カレンダー', route: '/(tabs)/calendar', spotKey: undefined },
                ].map(item => {
                  const btn = (
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
                  )
                  return item.spotKey
                    ? <TutorialSpot key={item.label} spotKey={item.spotKey} style={{ flex: 1 }}>{btn}</TutorialSpot>
                    : btn
                })}
              </View>
            </View>
          </AnimatedEntry>

          {/* ── 改善タスク（ある場合のみ表示） ── */}
          <AnimatedEntry delay={180}>
            <TasksCard tasks={tasks} onToggle={toggleTask} />
          </AnimatedEntry>

          {/* ── クイックリンク（食事分析・試合計画） ── */}
          <AnimatedEntry delay={240}>
            <View style={s.quickLinks}>
              {[
                { icon: '🍽️', label: '食事分析',  route: '/(tabs)/nutrition',   spotKey: undefined },
                { icon: '🏆', label: '試合計画',  route: '/(tabs)/competition', spotKey: 'competition_tab' as const },
              ].map(item => {
                const btn = (
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
                )
                return item.spotKey
                  ? <TutorialSpot key={item.label} spotKey={item.spotKey} style={{ flex: 1 }}>{btn}</TutorialSpot>
                  : btn
              })}
            </View>
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
                    <View key={i} style={{ height: 44, backgroundColor: '#e8eaed', borderRadius: 8, opacity: 0.8 }} />
                  ))}
                </View>
              ) : sessions.length === 0 ? (
                <View style={{ alignItems: 'center', gap: 6, paddingVertical: 24 }}>
                  <Ionicons name="barbell-outline" size={32} color={colors.textHint} />
                  <Text style={{ color: colors.textHint, fontSize: 14 }}>まだ記録なし</Text>
                  <Text style={{ color: colors.textHint, fontSize: 12 }}>下の＋ボタンから記録しよう！</Text>
                </View>
              ) : (() => {
                const SESSION_TYPE_MAP: Record<string, { color: string; label: string }> = {
                  interval: { color: '#F5A623', label: 'インターバル' },
                  tempo:    { color: '#FF9500', label: 'テンポ走' },
                  easy:     { color: '#4ECDC4', label: 'ジョグ' },
                  long:     { color: '#5AC8FA', label: 'ロング走' },
                  sprint:   { color: '#FF6B6B', label: 'スプリント' },
                  drill:    { color: '#AF52DE', label: 'ドリル' },
                  strength: { color: '#FF6B35', label: 'ウェイト' },
                  race:     { color: '#FFD700', label: '試合' },
                  rest:     { color: '#888',    label: '休養' },
                }
                const fmtTime = (ms: number) => {
                  const sec = ms / 1000
                  if (sec < 60) return `${sec.toFixed(2)}"`
                  return `${Math.floor(sec/60)}'${(sec%60).toFixed(2).padStart(5,'0')}"`
                }
                const renderRow = (sess: typeof sessions[0], idx: number) => {
                  const typeInfo = SESSION_TYPE_MAP[sess.session_type] ?? { color: '#888', label: sess.session_type }
                  const fat = sess.fatigue_level ?? 5
                  const fatColor = fat >= 8 ? '#FF6B6B' : fat >= 6 ? '#FF9500' : '#4ECDC4'
                  const openShare = () => {
                    const dt = new Date(sess.session_date + 'T00:00:00')
                    const weekdays = ['日','月','火','水','木','金','土']
                    setShareSession({
                      date:      `${dt.getFullYear()}年${dt.getMonth()+1}月${dt.getDate()}日（${weekdays[dt.getDay()]}）`,
                      title:     typeInfo.label,
                      menu:      sess.notes ?? undefined,
                      distance:  sess.distance_m ? sess.distance_m / 1000 : undefined,
                      sets:      sess.reps ?? undefined,
                      time:      sess.time_ms ? fmtTime(sess.time_ms) : undefined,
                      fatigue:   sess.fatigue_level,
                      condition: sess.condition_level,
                      weather:   sess.weather ?? undefined,
                      streak:    (() => { let sk=0; const ds=new Set(sessions.map(s=>s.session_date)); for(let i=0;i<365;i++){const d=new Date();d.setDate(d.getDate()-i);if(ds.has(localDateStr(d)))sk++;else if(i>0)break}; return sk })(),
                      rank:      `${calcLevelInfo(sessions.length).emoji} ${calcLevelInfo(sessions.length).title}`,
                    })
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
                      <TouchableOpacity onPress={openShare} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginLeft: 6 }}>
                        <Ionicons name="share-outline" size={16} color={BRAND} />
                      </TouchableOpacity>
                    </View>
                  )
                }
                return (
                  <ScrollView
                    style={{ maxHeight: 275 }}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={sessions.length > 5}
                  >
                    {sessions.map((sess, idx) => renderRow(sess, idx))}
                  </ScrollView>
                )
              })()}
            </GlassCard>
          </AnimatedEntry>

          {/* ── チームアップセルカード（v1.0: チーム機能は近日公開のため非表示） ── */}
          {false && purchaseTier === 'noad' && appOpenCount >= 3 && (
            <AnimatedEntry delay={410}>
              <TouchableOpacity
                style={{
                  backgroundColor: '#f0fdf4',
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: 'rgba(22,101,52,0.2)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  marginBottom: 10,
                }}
                onPress={() => router.push('/(tabs)/team')}
                activeOpacity={0.85}
              >
                <View style={{ width: 46, height: 46, borderRadius: 13, backgroundColor: 'rgba(22,101,52,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 22 }}>👥</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#166534', fontSize: 14, fontWeight: '800' }}>部員全員で使うと ¥149/人</Text>
                  <Text style={{ color: '#4b7c5a', fontSize: 12, lineHeight: 17, marginTop: 2 }}>ELITEチームプランで部員全員の{'\n'}コンディションを一括管理できます</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#166534" />
              </TouchableOpacity>
            </AnimatedEntry>
          )}
          </>)}
          {/* ── ここまで：今日限定セクション ── */}

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
          fetchSessions('')
          loadTasks()
        }}
      />

      <QuickConditionModal
        visible={showQuickCondition}
        date={selectedDate}
        onClose={() => { setShowQuickCondition(false); onConditionModalClose() }}
        onSaved={() => reloadAll()}
      />

      {/* ── 怪我リスク内訳モーダル ── */}
      <Modal visible={showRiskBreakdown} transparent animationType="slide" onRequestClose={() => setShowRiskBreakdown(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { backgroundColor: colors.surface }]}>
            <View style={s.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 20 }}>📊</Text>
                <Text style={[s.modalTitle, { color: colors.text }]}>怪我リスクの内訳</Text>
              </View>
              <TouchableOpacity onPress={() => setShowRiskBreakdown(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={22} color={colors.textSec} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: '80%' }} showsVerticalScrollIndicator={false}>
              {riskResult && (
                <View style={{
                  flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 16,
                  padding: 14, borderRadius: 14, backgroundColor: colors.surface2,
                }}>
                  <Text style={{ fontSize: 13, color: colors.textSec }}>
                    基礎 {riskResult.riskScore + riskResult.recoveryApplied}
                  </Text>
                  {isViewingToday && riskResult.recoveryApplied > 0 && (
                    <Text style={{ fontSize: 13, color: BRAND, fontWeight: '700' }}>
                      − ストレッチ{riskResult.recoveryApplied}
                    </Text>
                  )}
                  {!!weatherBonus && (
                    <Text style={{ fontSize: 13, color: colors.textSec }}>
                      {weatherBonus > 0 ? '+' : ''}天気{weatherBonus}
                    </Text>
                  )}
                  <Text style={{ fontSize: 13, color: colors.text, fontWeight: '800', marginLeft: 'auto' }}>
                    現在 {effectiveRiskScore ?? riskResult.riskScore}
                  </Text>
                </View>
              )}
              {riskResult?.reasons && riskResult.reasons.length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  {riskResult.reasons.map((r, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
                      <Text style={{ fontSize: 13, color: colors.textSec }}>・</Text>
                      <Text style={{ fontSize: 13, color: colors.textSec, flex: 1, lineHeight: 19 }}>{r}</Text>
                    </View>
                  ))}
                </View>
              )}
              {isViewingToday && riskResult && riskResult.recoveryApplied > 0 && (
                <Text style={{ fontSize: 11, color: colors.textHint, marginBottom: 10, lineHeight: 16 }}>
                  ※ ストレッチの軽減分は「疲労蓄積」「直近疲労度」の内訳にも反映されています。
                </Text>
              )}
              {riskResult?.factors.map(f => {
                // 未記録(-1)は棒を出さない。0以上は最低でも視認できる幅を確保する。
                const pct = f.score < 0 ? null : Math.max(3, Math.min(100, f.score))
                const barColor = pct === null ? colors.textHint
                  : f.score >= 60 ? ALERT : f.score >= 30 ? '#f59e0b' : BRAND
                return (
                  <View key={f.key} style={{
                    marginBottom: 10, padding: 12, borderRadius: 14,
                    backgroundColor: colors.surface2,
                  }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{f.emoji} {f.name}</Text>
                      {pct !== null && (
                        <Text style={{ fontSize: 12, fontWeight: '700', color: barColor }}>{f.score}%</Text>
                      )}
                    </View>
                    <Text style={{ fontSize: 12, color: colors.textSec, marginBottom: 8, lineHeight: 17 }}>{f.description}</Text>
                    <View style={{ height: 6, backgroundColor: colors.border ?? 'rgba(128,128,128,0.2)', borderRadius: 3, overflow: 'hidden' }}>
                      {pct !== null && (
                        <View style={{
                          width: `${pct}%` as any, height: '100%', borderRadius: 3,
                          backgroundColor: barColor,
                        }} />
                      )}
                    </View>
                  </View>
                )
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

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
                style={[s.reloadBtn, { borderColor: 'rgba(59,130,246,0.3)' }]}
                onPress={handleGetAIAdvice}
              >
                <Ionicons name="refresh" size={15} color="#3b82f6" />
                <Text style={{ color: '#3b82f6', fontSize: 13, fontWeight: '700' }}>再取得</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* ── 練習記録シェアカード ── */}
      <Modal visible={!!shareSession} transparent animationType="fade" onRequestClose={() => setShareSession(null)}>
        {shareSession ? (
          <PracticeShareCard
            data={shareSession}
            visible={true}
            onClose={() => setShareSession(null)}
          />
        ) : <View />}
      </Modal>

      {/* ── カウントダウン選択モーダル ── */}
      <Modal visible={showCountdownModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCountdownModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 }}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: '#111' }}>カウントダウン</Text>
            <TouchableOpacity onPress={() => setShowCountdownModal(false)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#e8eaed', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={18} color="#555" />
            </TouchableOpacity>
          </View>

          <Text style={{ fontSize: 13, color: '#888', paddingHorizontal: 20, marginBottom: 20 }}>プランを選択してください</Text>

          <View style={{ paddingHorizontal: 16, gap: 14 }}>
            {/* 試合計画カード */}
            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => { setShowCountdownModal(false); router.push({ pathname: '/(tabs)/competition', params: { tab: 'race' } }) }}
              style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 3 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: BRAND + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 26 }}>🏁</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: '#111' }}>試合計画</Text>
                  {compDaysLeft !== null ? (
                    <>
                      <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{compDaysLeft.name}</Text>
                      <Text style={{ fontSize: 24, fontWeight: '900', color: BRAND, letterSpacing: -1, marginTop: 4 }}>
                        あと {compDaysLeft.days} 日
                      </Text>
                    </>
                  ) : (
                    <Text style={{ fontSize: 13, color: '#aaa', marginTop: 4 }}>試合を登録してカウントダウンを開始</Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={20} color="#ccc" />
              </View>
              {compDaysLeft === null && (
                <View style={{ marginTop: 14, backgroundColor: BRAND, borderRadius: 12, paddingVertical: 11, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>試合を登録する</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* 怪我復帰計画カード */}
            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => { setShowCountdownModal(false); router.push({ pathname: '/(tabs)/competition', params: { tab: 'injury' } }) }}
              style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 3 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: '#FF6B6B18', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 26 }}>🩹</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: '#111' }}>怪我復帰計画</Text>
                  {injuryDaysLeft !== null ? (
                    <>
                      <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>回復プラン進行中</Text>
                      <Text style={{ fontSize: 24, fontWeight: '900', color: '#FF6B6B', letterSpacing: -1, marginTop: 4 }}>
                        あと {injuryDaysLeft} 日
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={{ fontSize: 13, color: '#aaa', marginTop: 2 }}>怪我なし継続</Text>
                      <Text style={{ fontSize: 22, fontWeight: '900', color: '#34C759', letterSpacing: -1, marginTop: 2 }}>
                        {injuryFreeDays} 日
                      </Text>
                    </>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={20} color="#ccc" />
              </View>
              {injuryDaysLeft === null && (
                <View style={{ marginTop: 14, backgroundColor: '#FF6B6B', borderRadius: 12, paddingVertical: 11, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>怪我を記録する</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      <PWAInstallPrompt />

      {/* レビューウォール */}
      <ReviewWall
        visible={reviewWallVisible}
        onClose={() => setReviewWallVisible(false)}
      />

      {/* 広告なしプラン案内（週1回程度・FREEユーザーのみ） */}
      <NoadUpsellModal
        visible={noadUpsellVisible}
        onClose={() => setNoadUpsellVisible(false)}
        onUpgrade={() => router.push('/paywall')}
      />
    </ScreenGradient>
  )
}

// ── Styles ──────────────────────────────────────────────
const s = StyleSheet.create({
  content:   { paddingHorizontal: 16, paddingTop: 4, gap: 6, paddingBottom: 110 },
  headerIllustration: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 340,
    width: '100%',
    pointerEvents: 'none',
  },

  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  scorePill:    { backgroundColor: '#111827', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8 },
  scorePillText:{ color: '#ffffff', fontSize: 16, fontWeight: '900', letterSpacing: -0.3 },
  iconBtn:      { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  sectionRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  sessRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  typeBar:    { width: 4, height: 36, borderRadius: 2, flexShrink: 0 },
  sessType:   { fontSize: 13, fontWeight: '700' },
  sessDate:   { fontSize: 11, marginTop: 2 },
  sessStat:   { fontSize: 12, fontWeight: '600' },
  fatiguePill:{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },

  quickLinks: { flexDirection: 'row', gap: 10 },
  quickLink:  { borderRadius: 16, borderWidth: 0, paddingVertical: 12, alignItems: 'center', gap: 5,
               shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.09, shadowRadius: 16, elevation: 5 },
  quickLinkLabel: { fontSize: 11, fontWeight: '700', textAlign: 'center' },

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

  halfCard: {
    flex: 1, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14,
    alignItems: 'center', gap: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.09, shadowRadius: 16, elevation: 5,
  },
  // AIコーチカード（W3スタイル）— 案A ソフト浮き上がり
  aiCoachCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 16, paddingHorizontal: 16, paddingVertical: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10, shadowRadius: 20, elevation: 6,
  },
  aiCoachDarkIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#111827',
    alignItems: 'center', justifyContent: 'center',
  },
  aiCoachLabel: { fontSize: 13, fontWeight: '900', color: '#111827', letterSpacing: 0.5, marginBottom: 3 },
  aiCoachSub:   { fontSize: 12, lineHeight: 17 },

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
    flex: 1,
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

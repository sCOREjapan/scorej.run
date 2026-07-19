// app/growth-report.tsx — 成長レポート（広告なしプラン限定）
//
// Council 5賢人会議での決定に基づく設計:
//   - 配置は「記録」タブの無料グラフ直下からの導線のみ（新規タブ・チーム連携は9月以降に温存）
//   - AI呼び出しは一切なし。既存の練習記録・睡眠記録・怪我リスクエンジンを再集計するだけ
//   - 専門用語（ATL/CTL等）を前面に出さず、結果が一言で伝わる見出しを添える
//
// UI: 天気アプリの「地点ごとのウィンドウ」のように、指標ごとのカードを一覧表示し、
// タップするとその指標の詳細（全期間グラフ）が開く構成（白基調）
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, LayoutChangeEvent, Animated } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Svg, { Path, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg'
import { LinearGradient } from 'expo-linear-gradient'
import TrainingChart from '../components/TrainingChart'
import PressableScale from '../components/PressableScale'
import { calcInjuryRisk } from '../lib/injuryRisk'
import { localDateStr } from '../lib/dateLocal'
import { usePurchase } from '../context/PurchaseContext'
import { BRAND } from '../lib/theme'
import type { RaceRecord, TrainingSession, SleepRecord, ChartDataPoint, AthleticsEvent } from '../types'

// ── 入場アニメーション用ヘルパー: フェード+下からスライド+ふわっと拡大 ──
function entranceStyle(anim: Animated.Value) {
  return {
    opacity: anim,
    transform: [
      { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
      { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
    ],
  }
}

const RECORDS_KEY        = 'trackmate_race_records'
const SESSIONS_KEY       = 'trackmate_sessions'
const SLEEP_KEY          = 'trackmate_sleep'
const CONDITION_MAP_KEY  = 'trackmate_condition_map'

const GOLD = '#d97706'
const RISK_COLOR = '#E53935'
const LOAD_COLOR = '#3b82f6'
// 画面全体の背景（黒基調・斜めに沈み込む薄いグラデーション）
const SCREEN_BG: [string, string] = ['#1c1c22', '#000000']

// ── フィールド種目判定（distance_m基準 vs result_ms基準の切り替え） ──────────
const FIELD_EVENTS = ['走幅跳', '三段跳', '走高跳', '棒高跳', '砲丸投', 'やり投', '円盤投', 'ハンマー投']

type ViewMode = 'list' | 'pb' | 'risk' | 'load'

// ── 滑らかな波形パスを生成（隣接点の中点をQ制御点でつなぐ簡易スムージング） ──
function smoothLinePath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2
    const midY = (pts[i].y + pts[i + 1].y) / 2
    d += ` Q ${pts[i].x} ${pts[i].y} ${midX} ${midY}`
  }
  const last = pts[pts.length - 1]
  d += ` Q ${last.x} ${last.y} ${last.x} ${last.y}`
  return d
}

// ── 天気アプリ風ウィジェットカード（一覧画面の「窓」） ──────────────────
function GrowthWidgetCard({
  icon, title, value, valueColor, trend, data, color, onPress,
}: {
  icon: string
  title: string
  value: string
  valueColor: string
  trend: string | null
  data: ChartDataPoint[]
  color: string
  onPress: () => void
}) {
  const [w, setW] = useState(300)
  const H = 64
  const gradId = `wgrad-${title}`

  const chart = useMemo(() => {
    if (data.length < 2) return null
    const values = data.map(p => p.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const padY = H * 0.16
    const pts = data.map((p, i) => ({
      x: (i / (data.length - 1)) * w,
      y: H - padY - ((p.value - min) / range) * (H - padY * 2),
    }))
    const line = smoothLinePath(pts)
    const area = `${line} L ${pts[pts.length - 1].x} ${H} L ${pts[0].x} ${H} Z`
    return { line, area }
  }, [data, w])

  function onLayout(e: LayoutChangeEvent) {
    const width = e.nativeEvent.layout.width
    if (width > 0 && Math.abs(width - w) > 1) setW(width)
  }

  return (
    <PressableScale style={wc.shadowWrap} onPress={onPress} haptic="light" scaleAmount={0.97} sound="tap">
      <LinearGradient
        colors={['#ffffff', `${color}14`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={wc.card}
      >
        <View style={wc.headerRow}>
          <View style={wc.titleRow}>
            <Text style={{ fontSize: 15 }}>{icon}</Text>
            <Text style={wc.title}>{title}</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color="#c9c9ce" />
        </View>

        <View style={wc.valueRow}>
          <Text style={[wc.value, { color: valueColor }]}>{value}</Text>
        </View>
        <Text style={wc.trend} numberOfLines={1}>{trend ?? 'データを蓄積中'}</Text>

        <View style={wc.chartWrap} onLayout={onLayout}>
          {chart ? (
            <Svg width="100%" height={H} viewBox={`0 0 ${w} ${H}`} preserveAspectRatio="none">
              <Defs>
                <SvgLinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={color} stopOpacity={0.28} />
                  <Stop offset="1" stopColor={color} stopOpacity={0} />
                </SvgLinearGradient>
              </Defs>
              <Path d={chart.area} fill={`url(#${gradId})`} />
              <Path d={chart.line} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          ) : (
            <View style={wc.chartEmpty}>
              <Text style={wc.chartEmptyTxt}>記録が増えるとグラフが表示されます</Text>
            </View>
          )}
        </View>
      </LinearGradient>
    </PressableScale>
  )
}

export default function GrowthReportScreen() {
  const router = useRouter()
  const { isNoad, loading: purchaseLoading } = usePurchase()

  const [view, setView] = useState<ViewMode>('list')
  const [records,  setRecords]  = useState<RaceRecord[]>([])
  const [sessions, setSessions] = useState<TrainingSession[]>([])
  const [sleep,    setSleep]    = useState<SleepRecord[]>([])
  const [conditionMap, setConditionMap] = useState<Record<string, number>>({})
  const [loading,  setLoading]  = useState(true)
  const [selectedEvent, setSelectedEvent] = useState<AthleticsEvent | null>(null)

  // ── 入場アニメーション: 一覧は3枚を少しずつずらしてポップイン、詳細はふわっと1枚 ──
  const cardAnim1  = useRef(new Animated.Value(0)).current
  const cardAnim2  = useRef(new Animated.Value(0)).current
  const cardAnim3  = useRef(new Animated.Value(0)).current
  const detailAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (view === 'list') {
      cardAnim1.setValue(0); cardAnim2.setValue(0); cardAnim3.setValue(0)
      const spring = (v: Animated.Value) => Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 8 })
      Animated.stagger(90, [spring(cardAnim1), spring(cardAnim2), spring(cardAnim3)]).start()
    } else {
      detailAnim.setValue(0)
      Animated.spring(detailAnim, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 8 }).start()
    }
  }, [view])

  useEffect(() => {
    ;(async () => {
      try {
        const [rRaw, sRaw, slRaw, cRaw] = await AsyncStorage.multiGet([
          RECORDS_KEY, SESSIONS_KEY, SLEEP_KEY, CONDITION_MAP_KEY,
        ]).then(pairs => pairs.map(([, v]) => v))

        const allRecords: RaceRecord[]     = rRaw  ? JSON.parse(rRaw)  : []
        const allSessions: TrainingSession[] = sRaw ? JSON.parse(sRaw) : []
        const allSleep: SleepRecord[]      = slRaw ? JSON.parse(slRaw) : []
        const cMap: Record<string, number> = cRaw  ? JSON.parse(cRaw) : {}

        setRecords(allRecords)
        setSessions(allSessions)
        setSleep(allSleep)
        setConditionMap(cMap)
        if (allRecords.length > 0) {
          const events = Array.from(new Set(allRecords.map(r => r.event)))
          setSelectedEvent(events[0] as AthleticsEvent)
        }
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // ── ① 自己ベスト推移（全期間） ──────────────────────────────────────
  const eventList = useMemo(
    () => Array.from(new Set(records.map(r => r.event))) as AthleticsEvent[],
    [records]
  )
  const isFieldEvent = selectedEvent ? FIELD_EVENTS.includes(selectedEvent) : false
  const pbChartData: ChartDataPoint[] = useMemo(() => {
    if (!selectedEvent) return []
    return records
      .filter(r => r.event === selectedEvent)
      .sort((a, b) => a.race_date.localeCompare(b.race_date))
      .map(r => ({
        date: r.race_date,
        value: isFieldEvent ? (r.result_cm ?? 0) : (r.result_ms ?? 0),
        label: r.result_display,
      }))
  }, [records, selectedEvent, isFieldEvent])

  const pbCount = useMemo(
    () => records.filter(r => selectedEvent && r.event === selectedEvent && r.is_pb).length,
    [records, selectedEvent]
  )

  // ── ② 怪我リスクの推移（過去90日） ───────────────────────────────────
  // AI不使用。既存の calcInjuryRisk を各日付を基準に再計算するだけ（追加コストゼロ）
  const riskHistory: ChartDataPoint[] = useMemo(() => {
    if (loading) return []
    const DAYS = 90
    const out: ChartDataPoint[] = []
    const now = new Date()
    for (let i = DAYS - 1; i >= 0; i -= 3) { // 3日おきに間引いて計算量を抑える
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dateStr = localDateStr(d)
      const asOfMs = new Date(dateStr + 'T23:59:59').getTime()
      const filteredSessions = sessions.filter(s => s.session_date.slice(0, 10) <= dateStr)
      const filteredSleep    = sleep.filter(s => s.sleep_date.slice(0, 10) <= dateStr)
      const condition = conditionMap[dateStr] ?? 6 // 記録が無い日は中間値（ホーム画面と同じフォールバック）
      const result = calcInjuryRisk(filteredSessions, filteredSleep, condition, false, {}, asOfMs)
      out.push({ date: dateStr, value: result.riskScore })
    }
    return out
  }, [sessions, sleep, conditionMap, loading])

  const riskTrendLabel = useMemo(() => {
    if (riskHistory.length < 2) return null
    const recent = riskHistory.slice(-5).reduce((a, p) => a + p.value, 0) / Math.min(5, riskHistory.length)
    const early   = riskHistory.slice(0, 5).reduce((a, p) => a + p.value, 0) / Math.min(5, riskHistory.length)
    const diff = Math.round(recent - early)
    if (Math.abs(diff) < 3) return '怪我リスクは横ばいです'
    return diff < 0 ? `90日前より ${Math.abs(diff)}pt 下がっています` : `90日前より ${diff}pt 上がっています`
  }, [riskHistory])

  const highRiskDays = useMemo(
    () => riskHistory.filter(p => p.value >= 70).length,
    [riskHistory]
  )

  // ── ③ 月間練習負荷トレンド（週別走行距離） ───────────────────────────
  const weeklyVolume: ChartDataPoint[] = useMemo(() => {
    if (sessions.length === 0) return []
    const weeks: Record<string, number> = {}
    for (const s of sessions) {
      const d = new Date(s.session_date)
      const weekStart = new Date(d)
      weekStart.setDate(d.getDate() - d.getDay())
      const key = localDateStr(weekStart)
      weeks[key] = (weeks[key] ?? 0) + (s.distance_m ?? 0) / 1000
    }
    return Object.entries(weeks)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([date, km]) => ({ date, value: Math.round(km * 10) / 10 }))
  }, [sessions])

  const loadTrendLabel = useMemo(() => {
    if (weeklyVolume.length < 2) return null
    const last = weeklyVolume[weeklyVolume.length - 1].value
    const prev = weeklyVolume[weeklyVolume.length - 2].value
    if (prev < 0.5) return null
    const pct = Math.round(((last - prev) / prev) * 100)
    if (Math.abs(pct) < 10) return '練習量は先週と同程度です'
    return pct > 0 ? `先週より ${pct}% 増えています` : `先週より ${Math.abs(pct)}% 減っています`
  }, [weeklyVolume])

  // ── ウィジェットカード用の要約値 ─────────────────────────────────────
  const pbValue = pbChartData.length > 0 ? pbChartData[pbChartData.length - 1].label ?? '' : '―'
  const pbTrend = pbChartData.length > 0
    ? `${selectedEvent ?? ''}・自己ベスト更新 ${pbCount}回`
    : (eventList.length > 0 ? 'この種目の記録がまだ2件未満です' : null)

  const riskValue = riskHistory.length > 0 ? `${riskHistory[riskHistory.length - 1].value}pt` : '―'
  const loadValue = weeklyVolume.length > 0 ? `${weeklyVolume[weeklyVolume.length - 1].value}km/週` : '―'

  // ── ペイウォールガード ──────────────────────────────────────────────
  if (purchaseLoading || loading) {
    return (
      <LinearGradient colors={SCREEN_BG} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={BRAND} size="large" />
      </LinearGradient>
    )
  }

  if (!isNoad) {
    return (
      <LinearGradient colors={SCREEN_BG} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.screen}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={st.header}>
            <TouchableOpacity style={st.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/records')}>
              <Ionicons name="chevron-back" size={26} color={'#ffffff'} />
            </TouchableOpacity>
            <Text style={st.headerTitle}>成長レポート</Text>
            <View style={{ width: 44 }} />
          </View>
          <View style={[st.center, { paddingHorizontal: 32 }]}>
            <Ionicons name="lock-closed" size={40} color={GOLD} />
            <Text style={st.lockTitle}>成長レポートは広告なしプラン限定です</Text>
            <Text style={st.lockSub}>自己ベストの推移・怪我リスクの90日間の履歴・練習負荷のトレンドを、いつでも振り返れます</Text>
            <TouchableOpacity style={st.unlockBtn} onPress={() => router.push('/paywall?plan=noad')} activeOpacity={0.85}>
              <Text style={st.unlockBtnTxt}>アンロックする</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </LinearGradient>
    )
  }

  const detailTitle: Record<Exclude<ViewMode, 'list'>, string> = {
    pb:   '自己ベストの推移',
    risk: '怪我リスクの90日間',
    load: '練習負荷のトレンド',
  }

  return (
    <LinearGradient colors={SCREEN_BG} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.screen}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={st.header}>
          <TouchableOpacity
            style={st.backBtn}
            onPress={() => {
              if (view !== 'list') { setView('list'); return }
              router.canGoBack() ? router.back() : router.replace('/(tabs)/records')
            }}
          >
            <Ionicons name="chevron-back" size={26} color={'#ffffff'} />
          </TouchableOpacity>
          <Text style={st.headerTitle}>{view === 'list' ? '成長レポート' : detailTitle[view]}</Text>
          <View style={{ width: 44 }} />
        </View>

        {view === 'list' && (
          <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
            <Animated.View style={entranceStyle(cardAnim1)}>
            <GrowthWidgetCard
              icon="🏅"
              title="自己ベストの推移"
              value={pbValue}
              valueColor={BRAND}
              trend={pbTrend}
              data={pbChartData}
              color={BRAND}
              onPress={() => setView('pb')}
            />
            </Animated.View>
            <Animated.View style={entranceStyle(cardAnim2)}>
            <GrowthWidgetCard
              icon="🩹"
              title="怪我リスク"
              value={riskValue}
              valueColor={RISK_COLOR}
              trend={riskTrendLabel}
              data={riskHistory}
              color={RISK_COLOR}
              onPress={() => setView('risk')}
            />
            </Animated.View>
            <Animated.View style={entranceStyle(cardAnim3)}>
            <GrowthWidgetCard
              icon="📈"
              title="練習負荷"
              value={loadValue}
              valueColor={LOAD_COLOR}
              trend={loadTrendLabel}
              data={weeklyVolume}
              color={LOAD_COLOR}
              onPress={() => setView('load')}
            />
            </Animated.View>
            <Text style={st.footnote}>
              このレポートは、これまでに記録した練習・睡眠・大会記録から自動的に計算されています。AIは使用していません。
            </Text>
          </ScrollView>
        )}

        {view === 'pb' && (
          <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
            <Animated.View style={entranceStyle(detailAnim)}>
            <LinearGradient colors={['#ffffff', `${BRAND}14`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.card}>
              {eventList.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
                  {eventList.map(ev => (
                    <TouchableOpacity
                      key={ev}
                      onPress={() => setSelectedEvent(ev)}
                      style={[st.eventChip, selectedEvent === ev && st.eventChipActive]}
                    >
                      <Text style={[st.eventChipTxt, selectedEvent === ev && st.eventChipTxtActive]}>{ev}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              {pbChartData.length >= 2 ? (
                <>
                  <TrainingChart
                    data={pbChartData}
                    title={selectedEvent ?? ''}
                    color={BRAND}
                    unit={isFieldEvent ? 'm' : ''}
                    maxPoints={200}
                    showYear
                  />
                  <Text style={st.summaryTxt}>
                    {selectedEvent} の自己ベスト更新: {pbCount}回(全{pbChartData.length}記録中)
                  </Text>
                </>
              ) : (
                <Text style={st.emptyTxt}>この種目の記録がまだ2件未満です。大会記録を追加すると推移が見られます</Text>
              )}
            </LinearGradient>
            </Animated.View>
          </ScrollView>
        )}

        {view === 'risk' && (
          <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
            <Animated.View style={entranceStyle(detailAnim)}>
            <LinearGradient colors={['#ffffff', `${RISK_COLOR}14`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.card}>
              {riskHistory.length >= 2 ? (
                <>
                  <TrainingChart
                    data={riskHistory}
                    title="リスクスコア"
                    color={RISK_COLOR}
                    unit="pt"
                    maxPoints={30}
                  />
                  {riskTrendLabel && <Text style={st.summaryTxt}>{riskTrendLabel}</Text>}
                  <Text style={st.summarySub}>高リスク(70pt以上)だった日: {highRiskDays}日</Text>
                </>
              ) : (
                <Text style={st.emptyTxt}>練習記録が増えると、リスクの推移が見られるようになります</Text>
              )}
            </LinearGradient>
            </Animated.View>
          </ScrollView>
        )}

        {view === 'load' && (
          <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
            <Animated.View style={entranceStyle(detailAnim)}>
            <LinearGradient colors={['#ffffff', `${LOAD_COLOR}14`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.card}>
              {weeklyVolume.length >= 2 ? (
                <>
                  <TrainingChart
                    data={weeklyVolume}
                    title="週間走行距離"
                    color={LOAD_COLOR}
                    unit="km"
                    maxPoints={12}
                  />
                  {loadTrendLabel && <Text style={st.summaryTxt}>{loadTrendLabel}</Text>}
                </>
              ) : (
                <Text style={st.emptyTxt}>週2件以上の練習記録が溜まると、トレンドが見られるようになります</Text>
              )}
            </LinearGradient>
            </Animated.View>
          </ScrollView>
        )}
      </SafeAreaView>
    </LinearGradient>
  )
}

const st = StyleSheet.create({
  screen:      { flex: 1 },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn:     { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#ffffff', fontSize: 17, fontWeight: '800' },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  lockTitle:   { color: '#ffffff', fontSize: 18, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  lockSub:     { color: '#9ca3af', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  unlockBtn:   { marginTop: 12, backgroundColor: GOLD, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  unlockBtnTxt:{ color: '#fff', fontSize: 15, fontWeight: '800' },

  scroll: { padding: 16, paddingBottom: 48, gap: 14 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
  },
  sectionTitle: { color: '#111827', fontSize: 15, fontWeight: '800', marginBottom: 12 },
  summaryTxt:   { color: '#111827', fontSize: 13, fontWeight: '700', marginTop: 10 },
  summarySub:   { color: '#6b7280', fontSize: 12, marginTop: 4 },
  emptyTxt:     { color: '#9ca3af', fontSize: 13, textAlign: 'center', paddingVertical: 24 },

  eventChip:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: '#f0f2f5' },
  eventChipActive: { backgroundColor: BRAND },
  eventChipTxt:       { color: '#6b7280', fontSize: 12, fontWeight: '700' },
  eventChipTxtActive: { color: '#fff' },

  footnote: { color: '#9ca3af', fontSize: 11, textAlign: 'center', marginTop: 4, lineHeight: 16 },
})

// ── ウィジェットカードのスタイル ─────────────────────────────────────
const wc = StyleSheet.create({
  // 影(shadow)は overflow:hidden と同じViewに置くとネイティブ側でクリップされて消えるため、
  // 影担当の外側Viewと、角丸クリップ担当の内側Viewを分けている
  shadowWrap: {
    borderRadius: 18,
    backgroundColor: '#f7f7f9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  card: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title:     { color: '#111827', fontSize: 13.5, fontWeight: '800' },
  valueRow:  { marginTop: 10 },
  value:     { fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  trend:     { color: '#9ca3af', fontSize: 12, fontWeight: '600', marginTop: 2 },
  chartWrap: { height: 64, marginTop: 10, marginHorizontal: -16, marginBottom: -16 },
  chartEmpty:{ flex: 1, alignItems: 'center', justifyContent: 'center' },
  chartEmptyTxt: { color: '#c9c9ce', fontSize: 11 },
})

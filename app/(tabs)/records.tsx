import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Modal, KeyboardAvoidingView, Platform, Animated, Alert, Dimensions, Pressable,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { BG_GRADIENT, BRAND, TEXT, NEON } from '../../lib/theme'
import { Sounds, unlockAudio } from '../../lib/sounds'
import HapticTouch from '../../components/HapticTouch'
import AnimatedSection from '../../components/AnimatedSection'
import DateSelector from '../../components/DateSelector'
import TrainingChart from '../../components/TrainingChart'
import type { RaceRecord, AthleticsEvent, ChartDataPoint, TrainingSession } from '../../types'
import type { SleepRecord } from '../../types'
import { exportAllDataCSV, exportAllDataJSON } from '../../lib/export'
import { checkAdGate, recordUsage, consumeRewardUse } from '../../lib/adGate'
import AdGateModal from '../../components/AdGateModal'
import { useAuth } from '../../context/AuthContext'
import { trackFeatureUse } from '../../lib/analytics'
import ConfettiEffect from '../../components/ConfettiEffect'
import { pbCelebration } from '../../lib/haptics'
import PracticeShareCard, { PracticeShareData } from '../../components/PracticeShareCard'
import { calcLevelInfo } from '../../lib/gamification'

const RECORDS_KEY       = 'trackmate_race_records'
const SESSIONS_KEY      = 'trackmate_sessions'
const CONDITION_MAP_KEY = 'trackmate_condition_map'
const SLEEP_KEY         = 'trackmate_sleep'
const WEIGHT_KEY        = 'trackmate_weight'
const MOCK_USER_ID      = 'mock-user-1'

type WeightRecord = { id: string; date: string; weight_kg: number }
const SCREEN_W          = Dimensions.get('window').width

// ── 種目定義 ──────────────────────────────────────────────────────
const TRACK_EVENTS: AthleticsEvent[] = [
  '100m','200m','400m','800m','1500m','3000m',
  '5000m','10000m','110mH','100mH','400mH','3000mSC',
  'half_marathon','marathon','競歩',
]
const FIELD_EVENTS: AthleticsEvent[] = [
  '走幅跳','三段跳','走高跳','棒高跳',
  '砲丸投','やり投','円盤投','ハンマー投',
]
const ALL_EVENTS: AthleticsEvent[] = [...TRACK_EVENTS, ...FIELD_EVENTS]

const WIND_EVENTS: AthleticsEvent[] = ['100m','200m','110mH','100mH','走幅跳','三段跳']
const FIELD_EVENT_SET = new Set<AthleticsEvent>(FIELD_EVENTS)

function isField(e: AthleticsEvent) { return FIELD_EVENT_SET.has(e) }
function hasWind(e: AthleticsEvent)  { return WIND_EVENTS.includes(e) }

// ── フォーマット ──────────────────────────────────────────────────
function msToDisplay(ms: number, event: AthleticsEvent): string {
  if (isField(event)) return ''
  const totalSec = ms / 1000
  if (totalSec < 60) return totalSec.toFixed(2)
  const min = Math.floor(totalSec / 60)
  const sec = (totalSec % 60).toFixed(2).padStart(5, '0')
  if (totalSec < 3600) return `${min}:${sec}`
  const hr = Math.floor(min / 60)
  const m  = min % 60
  return `${hr}:${String(m).padStart(2,'0')}:${sec}`
}
function cmToDisplay(cm: number): string {
  const m = Math.floor(cm / 100)
  const rest = cm % 100
  return `${m}m${String(rest).padStart(2,'0')}`
}

// ── パース (入力 → ms/cm) ─────────────────────────────────────────
function parseTrackInput(min: string, sec: string): number {
  const m = parseInt(min || '0', 10)
  const s = parseFloat(sec || '0')
  return Math.round((m * 60 + s) * 1000)
}
function parseFieldInput(meter: string, cm: string): number {
  return parseInt(meter || '0', 10) * 100 + parseInt(cm || '0', 10)
}

// ── スケルトン ────────────────────────────────────────────────────
function SkeletonRect({ h = 16, w = '100%' as any }) {
  const op = useRef(new Animated.Value(0.3)).current
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(op, { toValue: 0.9, duration: 700, useNativeDriver: true }),
      Animated.timing(op, { toValue: 0.3, duration: 700, useNativeDriver: true }),
    ]))
    a.start(); return () => a.stop()
  }, [op])
  return <Animated.View style={{ height: h, width: w, borderRadius: 8, backgroundColor: '#e8eaed', opacity: op }} />
}

// ── PBバッジ ──────────────────────────────────────────────────────
function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  )
}

// ── 記録カード ────────────────────────────────────────────────────
function RecordCard({ record, onDelete }: { record: RaceRecord; onDelete: () => void }) {
  const router = useRouter()
  return (
    <View style={[styles.recordCard, record.is_pb && styles.recordCardPB]}>
      <View style={styles.recordLeft}>
        <View style={styles.eventBadgeWrap}>
          <Text style={styles.eventBadgeText}>{record.event}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
          {record.is_pb && <Badge label="PB" color={NEON.green} />}
          {record.is_sb && !record.is_pb && <Badge label="SB" color={NEON.blue} />}
        </View>
      </View>

      <View style={styles.recordMid}>
        <Text style={[styles.recordResult, record.is_pb && { color: NEON.green }]}>
          {record.result_display}
        </Text>
        {record.wind_ms !== undefined && (
          <Text style={styles.windText}>
            {record.wind_ms >= 0 ? `+${record.wind_ms}` : record.wind_ms}m/s
          </Text>
        )}
        {record.competition_name
          ? <Text style={styles.recordVenue} numberOfLines={1}>{record.competition_name}</Text>
          : record.venue
            ? <Text style={styles.recordVenue} numberOfLines={1}>{record.venue}</Text>
            : null}
      </View>

      <View style={styles.recordRight}>
        <Text style={styles.recordDate}>{record.race_date}</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/share-card', params: { recordId: record.id } })}
            style={styles.shareBtn}
            activeOpacity={0.75}
          >
            <Ionicons name="share-social-outline" size={13} color="#fff" />
            <Text style={styles.shareBtnTxt}>シェア</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDelete} style={{ padding: 4 }}>
            <Ionicons name="trash-outline" size={14} color={TEXT.hint} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

// ── PBサマリーカード ───────────────────────────────────────────────
function PBSummary({ records }: { records: RaceRecord[] }) {
  // 種目ごとのPBを取得
  const pbMap = new Map<string, RaceRecord>()
  records.filter(r => r.is_pb).forEach(r => {
    if (!pbMap.has(r.event)) pbMap.set(r.event, r)
  })
  const pbs = Array.from(pbMap.values())
  if (pbs.length === 0) return null

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name="trophy" size={16} color={NEON.green} />
        <Text style={styles.cardTitle}>自己ベスト一覧</Text>
      </View>
      <View style={styles.pbGrid}>
        {pbs.map(r => (
          <View key={r.id} style={styles.pbItem}>
            <Text style={styles.pbEvent}>{r.event}</Text>
            <Text style={styles.pbResult}>{r.result_display}</Text>
            <Text style={styles.pbDate}>{r.race_date}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

// ── 練習ノート + 進捗タブ ─────────────────────────────────────────
const TYPE_COLORS: Record<string,string> = {
  interval:'#E53935', tempo:'#FF9500', easy:'#4ECDC4', long:'#5AC8FA',
  sprint:'#FF6B6B', drill:'#AF52DE', strength:'#FF6B35', race:'#FFD700', rest:'#555',
}
const TYPE_LABELS: Record<string,string> = {
  interval:'インターバル', tempo:'テンポ走', easy:'ジョグ', long:'ロング走',
  sprint:'スプリント', drill:'ドリル', strength:'ウェイト', race:'試合', rest:'休養',
}
const TYPE_EMOJIS: Record<string,string> = {
  interval:'⚡', tempo:'🏃', easy:'🌿', long:'🛣️',
  sprint:'💨', drill:'🔧', strength:'🏋️', race:'🏆', rest:'😴',
}
const FATIGUE_EMOJI = (v: number) => v >= 9 ? '🥵' : v >= 7 ? '😰' : v >= 5 ? '😐' : v >= 3 ? '🙂' : '😊'

// マイルストーン定義
const MILESTONES = [
  { key:'first',   label:'初練習',  emoji:'🎉', check: (s: TrainingSession[]) => s.length >= 1    },
  { key:'5th',     label:'5回達成', emoji:'✨', check: (s: TrainingSession[]) => s.length >= 5    },
  { key:'10th',    label:'10回！',  emoji:'🔥', check: (s: TrainingSession[]) => s.length >= 10   },
  { key:'30th',    label:'30回',    emoji:'💪', check: (s: TrainingSession[]) => s.length >= 30   },
  { key:'100th',   label:'100回',   emoji:'🏅', check: (s: TrainingSession[]) => s.length >= 100  },
  { key:'km10',    label:'10km',    emoji:'👟', check: (s: TrainingSession[]) => s.reduce((a,x)=>a+(x.distance_m??0),0) >= 10000 },
  { key:'km100',   label:'100km',   emoji:'🗺️', check: (s: TrainingSession[]) => s.reduce((a,x)=>a+(x.distance_m??0),0) >= 100000 },
  { key:'km500',   label:'500km',   emoji:'🌏', check: (s: TrainingSession[]) => s.reduce((a,x)=>a+(x.distance_m??0),0) >= 500000 },
]

// ヒートマップ: 全練習記録を横スクロールで表示（週ごとの列、今日が右端）
function Heatmap({ sessions }: { sessions: TrainingSession[] }) {
  const scrollRef = useRef<any>(null)
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const countByDay: Record<string,number> = {}
  const typeByDay: Record<string,string> = {}
  sessions.forEach(s => {
    countByDay[s.session_date] = (countByDay[s.session_date] ?? 0) + 1
    if (!typeByDay[s.session_date]) typeByDay[s.session_date] = s.session_type
  })

  const CELL = 14
  const GAP  = 3
  const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

  // 最も古い練習日から今日まで全部カバー（最低52週）
  const oldestDate = sessions.length > 0
    ? sessions.reduce((a, s) => s.session_date < a ? s.session_date : a, sessions[0].session_date)
    : todayStr
  const oldest = new Date(oldestDate)
  const minWeeks = 52
  const weeksNeeded = Math.max(minWeeks, Math.ceil((today.getTime() - oldest.getTime()) / (7 * 86400000)) + 2)
  const numDays = weeksNeeded * 7

  // 今日の曜日（0=日）に合わせて、今日が右端最下行になるよう末尾パディング
  const todayDow = today.getDay()
  const trailingPad = 6 - todayDow  // 土曜まで埋める

  const days: (string | null)[] = []
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  for (let i = 0; i < trailingPad; i++) days.push(null)

  // 7行 × N列のグリッド（列 = 週）
  const totalCols = Math.ceil(days.length / 7)
  const cols: (string | null)[][] = Array.from({ length: totalCols }, (_, c) =>
    days.slice(c * 7, c * 7 + 7)
  )

  const cellColor = (d: string | null) => {
    if (!d) return 'transparent'
    const n = countByDay[d] ?? 0
    if (n === 0) return '#e5e7eb'
    const type = typeByDay[d]
    const base =
      type === 'interval' || type === 'sprint' ? '#E53935' :
      type === 'tempo'    ? '#FF9500' :
      type === 'long'     ? '#5AC8FA' :
      type === 'strength' ? '#FF6B35' :
      type === 'race'     ? '#FFD700' :
      type === 'rest'     ? '#5a5a8a' :
      '#34C759'
    return n >= 2 ? base : base + '88'
  }

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={() => { scrollRef.current?.scrollToEnd({ animated: false }) }}
        contentContainerStyle={{ paddingRight: 4 }}
      >
        <View>
          {/* 月ラベル行 */}
          <View style={{ flexDirection: 'row', marginLeft: 16 }}>
            {cols.map((col, ci) => {
              const firstReal = col.find(d => d !== null)
              const showMonth = firstReal && new Date(firstReal).getDate() <= 7
              return (
                <View key={ci} style={{ width: CELL + GAP, alignItems: 'flex-start' }}>
                  {showMonth ? (
                    <Text style={{ color: TEXT.hint, fontSize: 8 }}>
                      {`${new Date(firstReal!).getMonth()+1}月`}
                    </Text>
                  ) : <View style={{ height: 10 }} />}
                </View>
              )
            })}
          </View>

          {/* セルグリッド */}
          {DOW_LABELS.map((dow, di) => (
            <View key={dow} style={{ flexDirection: 'row', alignItems: 'center', marginTop: GAP }}>
              <Text style={{ color: TEXT.hint, fontSize: 8, width: 16, textAlign: 'right', marginRight: 2 }}>
                {di % 2 === 0 ? dow : ''}
              </Text>
              {cols.map((col, ci) => {
                const d = col[di] ?? null
                const isToday = d === todayStr
                return (
                  <View
                    key={ci}
                    style={{
                      width: CELL, height: CELL, borderRadius: 3,
                      marginRight: GAP,
                      backgroundColor: cellColor(d),
                      borderWidth: isToday ? 1.5 : 0,
                      borderColor: BRAND,
                      opacity: d === null ? 0 : 1,
                    }}
                  />
                )
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* 凡例 */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {[
          { color: '#34C759', label: 'ジョグ' },
          { color: '#E53935', label: 'スプリント' },
          { color: '#FF9500', label: 'テンポ走' },
          { color: '#5AC8FA', label: 'ロング走' },
          { color: '#FFD700', label: '試合' },
        ].map(l => (
          <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: l.color }} />
            <Text style={{ color: TEXT.hint, fontSize: 9 }}>{l.label}</Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: BRAND }} />
          <Text style={{ color: TEXT.hint, fontSize: 9 }}>今日</Text>
        </View>
      </View>
    </View>
  )
}

// ── セッション詳細シート ────────────────────────────────────────────
function SessionDetailSheet({ session, onClose, onDelete }: {
  session: TrainingSession
  onClose: () => void
  onDelete: (id: string) => void
}) {
  const color = TYPE_COLORS[session.session_type] ?? '#888'
  const label = TYPE_LABELS[session.session_type] ?? session.session_type
  const emoji = TYPE_EMOJIS[session.session_type] ?? '📝'
  const fat   = session.fatigue_level ?? 5
  const cond  = session.condition_level ?? null

  const fmtMs = (ms: number) => {
    const s = ms / 1000
    if (s < 60) return `${s.toFixed(2)}"`
    return `${Math.floor(s/60)}'${(s%60).toFixed(2).padStart(5,'0')}"`
  }
  const fmtDist = (m: number) => m >= 1000 ? `${(m/1000).toFixed(2)}km` : `${m}m`

  const CONDITION_LABELS: Record<number, string> = {2:'最悪',3:'悪い',4:'やや悪',5:'普通',6:'まあまあ',7:'良い',8:'かなり良い',9:'絶好調',10:'最高'}

  const stats: { icon: string; label: string; value: string; color?: string }[] = [
    ...(session.event     ? [{ icon:'🏟️', label:'種目',   value: session.event }] : []),
    ...(session.time_ms   ? [{ icon:'⏱',  label:'タイム', value: fmtMs(session.time_ms) }] : []),
    ...(session.distance_m? [{ icon:'📏', label:'距離',   value: fmtDist(session.distance_m) }] : []),
    ...(session.reps      ? [{ icon:'🔁', label:'本数',   value: `${session.reps}本` }] : []),
    { icon: FATIGUE_EMOJI(fat),  label:'疲労度',   value: `${fat}/10` },
    ...(cond != null      ? [{ icon: cond >= 7 ? '😊' : cond >= 5 ? '😐' : '😕', label:'体調', value: `${cond}/10  ${CONDITION_LABELS[cond] ?? ''}` }] : []),
  ]

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end', zIndex: 999 }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
        padding: 20, paddingBottom: 48, borderTopWidth: 1, borderColor: 'rgba(0,0,0,0.08)' }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.12)', alignSelf: 'center', marginBottom: 16 }} />

        {/* ヘッダー */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: color + '20',
            borderWidth: 2, borderColor: color + '60', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 22 }}>{emoji}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color, fontSize: 16, fontWeight: '900' }}>{label}</Text>
            <Text style={{ color: TEXT.hint, fontSize: 12, marginTop: 2 }}>
              {session.session_date}{'  '}
              {['日','月','火','水','木','金','土'][new Date(session.session_date).getDay()]}曜日
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={22} color={TEXT.secondary} />
          </TouchableOpacity>
        </View>

        {/* スタッツグリッド */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
          {stats.map((s, i) => (
            <View key={i} style={{ backgroundColor: '#f0f2f5', borderRadius: 12,
              paddingVertical: 12, paddingHorizontal: 14, gap: 4, minWidth: '44%', flex: 1 }}>
              <Text style={{ color: TEXT.hint, fontSize: 11 }}>{s.icon} {s.label}</Text>
              <Text style={{ color: s.color ?? TEXT.primary, fontSize: 15, fontWeight: '800' }}>{s.value}</Text>
            </View>
          ))}
        </View>

        {/* ノート（元の入力テキスト） */}
        {session.notes ? (
          <View style={{ backgroundColor: '#f8f8fa', borderRadius: 12, padding: 14,
            borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', marginBottom: 12 }}>
            <Text style={{ color: TEXT.hint, fontSize: 11, fontWeight: '700', marginBottom: 8 }}>📝 メモ</Text>
            <Text style={{ color: TEXT.secondary, fontSize: 13, lineHeight: 22 }}>{session.notes}</Text>
          </View>
        ) : null}
        {/* 削除ボタン */}
        <TouchableOpacity
          onPress={() => { onDelete(session.id); onClose() }}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            paddingVertical: 13, borderRadius: 12, borderWidth: 1,
            borderColor: 'rgba(255,59,48,0.35)', backgroundColor: 'rgba(255,59,48,0.08)' }}
          activeOpacity={0.8}
        >
          <Ionicons name="trash-outline" size={16} color="#FF3B30" />
          <Text style={{ color: '#FF3B30', fontWeight: '700', fontSize: 14 }}>この記録を削除</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ── グローカレンダー ──────────────────────────────────────────────
const TYPE_GLOW_COLORS: Record<string,string> = {
  interval: '#E53935', tempo: '#FF9500', easy: '#34C759',
  long: '#5AC8FA', sprint: '#FF3B30', drill: '#AF52DE',
  strength: '#FF6B35', race: '#FFD700', rest: '#94a3b8',
}

function GlowCalendar({ sessions }: { sessions: TrainingSession[] }) {
  const now = new Date()
  const [viewYear, setViewYear]   = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())

  const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

  // date → sessions map
  const sessionMap: Record<string, TrainingSession[]> = {}
  sessions.forEach(s => {
    sessionMap[s.session_date] = sessionMap[s.session_date] ?? []
    sessionMap[s.session_date].push(s)
  })

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    const curY = now.getFullYear(), curM = now.getMonth()
    if (viewYear > curY || (viewYear === curY && viewMonth >= curM)) return
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDow    = new Date(viewYear, viewMonth, 1).getDay()
  const today       = now.toISOString().slice(0, 10)
  const canNext     = viewYear < now.getFullYear() || (viewYear === now.getFullYear() && viewMonth < now.getMonth())

  return (
    <View>
      {/* 月ナビ */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <TouchableOpacity onPress={prevMonth} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={18} color={TEXT.secondary} />
        </TouchableOpacity>
        <Text style={{ color: TEXT.primary, fontSize: 14, fontWeight: '800' }}>
          {viewYear}年 {viewMonth + 1}月
        </Text>
        <TouchableOpacity onPress={nextMonth} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ opacity: canNext ? 1 : 0.3 }}>
          <Ionicons name="chevron-forward" size={18} color={TEXT.secondary} />
        </TouchableOpacity>
      </View>

      {/* 曜日ヘッダー */}
      <View style={{ flexDirection: 'row', marginBottom: 2 }}>
        {DOW_LABELS.map((d, i) => (
          <Text key={d} style={{
            flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700',
            color: i === 0 ? '#EF4444' : i === 6 ? '#5AC8FA' : TEXT.hint,
          }}>{d}</Text>
        ))}
      </View>

      {/* 日付グリッド */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: firstDow }).map((_, i) => (
          <View key={`e${i}`} style={{ width: `${100 / 7}%` as any, aspectRatio: 1 }} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day     = i + 1
          const mm      = String(viewMonth + 1).padStart(2, '0')
          const dd      = String(day).padStart(2, '0')
          const dateStr = `${viewYear}-${mm}-${dd}`
          const isToday = dateStr === today
          const dow     = (firstDow + i) % 7
          const daySess = sessionMap[dateStr]
          const hasSession = daySess && daySess.length > 0

          // glow params
          let glowColor = '#34C759'
          let glowOpacity = 0
          let glowSize = 30
          if (hasSession) {
            const primary = daySess[0]
            glowColor = TYPE_GLOW_COLORS[primary.session_type] ?? '#34C759'
            const fatigue = primary.fatigue_level ?? 5
            glowOpacity = 0.22 + (fatigue / 10) * 0.5   // 0.22 ~ 0.72
            glowSize = daySess.length >= 2 ? 36 : 30
          }

          return (
            <View key={day} style={{ width: `${100 / 7}%` as any, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
              {hasSession && (
                <View style={{
                  position: 'absolute',
                  width: glowSize, height: glowSize, borderRadius: glowSize / 2,
                  backgroundColor: glowColor,
                  opacity: glowOpacity,
                  shadowColor: glowColor,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 1,
                  shadowRadius: 8,
                  elevation: 4,
                }} />
              )}
              <Text style={{
                fontSize: 12, fontWeight: isToday ? '900' : hasSession ? '800' : '400',
                color: isToday ? BRAND
                  : hasSession ? (glowOpacity > 0.5 ? '#fff' : TEXT.primary)
                  : dow === 0 ? '#EF4444' : dow === 6 ? '#5AC8FA' : TEXT.primary,
                zIndex: 1,
              }}>{day}</Text>
              {isToday && !hasSession && (
                <View style={{ position: 'absolute', bottom: 1, width: 3, height: 3, borderRadius: 1.5, backgroundColor: BRAND }} />
              )}
            </View>
          )
        })}
      </View>

      {/* 凡例 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' }}>
        {[
          { label: 'ジョグ', color: '#34C759' },
          { label: 'インターバル', color: '#E53935' },
          { label: 'テンポ走', color: '#FF9500' },
          { label: 'スプリント', color: '#FF3B30' },
          { label: 'ロング走', color: '#5AC8FA' },
          { label: '試合', color: '#FFD700' },
        ].map(item => (
          <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.color }} />
            <Text style={{ color: TEXT.hint, fontSize: 9 }}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

// セッション1件のタイムラインカード（タップで詳細表示）
function SessionTimelineCard({ session, onTap, onShare }: { session: TrainingSession; onTap: () => void; onShare: () => void }) {
  const color = TYPE_COLORS[session.session_type] ?? '#888'
  const label = TYPE_LABELS[session.session_type] ?? session.session_type
  const emoji = TYPE_EMOJIS[session.session_type] ?? '📝'
  const fat   = session.fatigue_level ?? 5
  const fmtMs = (ms: number) => {
    const s = ms / 1000
    if (s < 60) return `${s.toFixed(2)}"`
    return `${Math.floor(s/60)}'${(s%60).toFixed(2).padStart(5,'0')}"`
  }
  return (
    <TouchableOpacity onPress={onTap} activeOpacity={0.7} style={{ flexDirection: 'row', gap: 12, paddingVertical: 8 }}>
      {/* 左: タイムライン線 + ドット */}
      <View style={{ alignItems: 'center', width: 28 }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: color + '22',
          borderWidth: 2, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 13 }}>{emoji}</Text>
        </View>
        <View style={{ width: 2, flex: 1, backgroundColor: 'rgba(0,0,0,0.08)', marginTop: 4 }} />
      </View>
      {/* 右: 内容 */}
      <View style={{ flex: 1, gap: 4, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color, fontSize: 13, fontWeight: '800' }}>{label}</Text>
          {session.event ? <Text style={{ color: TEXT.hint, fontSize: 12 }}>{session.event}</Text> : null}
          <Text style={{ color: TEXT.hint, fontSize: 11, marginLeft: 'auto' as any }}>
            {FATIGUE_EMOJI(fat)} {fat}/10
          </Text>
        </View>
        {/* メトリクス */}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {session.time_ms ? (
            <View style={{ backgroundColor: '#f0f2f5', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: TEXT.primary, fontSize: 12, fontWeight: '700' }}>⏱ {fmtMs(session.time_ms)}</Text>
            </View>
          ) : null}
          {session.distance_m ? (
            <View style={{ backgroundColor: '#f0f2f5', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: TEXT.primary, fontSize: 12, fontWeight: '700' }}>
                📏 {session.distance_m >= 1000 ? `${(session.distance_m/1000).toFixed(1)}km` : `${session.distance_m}m`}
              </Text>
            </View>
          ) : null}
          {session.reps ? (
            <View style={{ backgroundColor: '#f0f2f5', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: TEXT.primary, fontSize: 12, fontWeight: '700' }}>🔁 {session.reps}本</Text>
            </View>
          ) : null}
        </View>
        {/* メモ (1行プレビュー) */}
        {session.notes ? (
          <Text style={{ color: TEXT.secondary, fontSize: 12, lineHeight: 18 }} numberOfLines={1}>
            {session.notes}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: TEXT.hint, fontSize: 10 }}>詳細を見る</Text>
            <Ionicons name="chevron-forward" size={10} color={TEXT.hint} />
          </View>
          <TouchableOpacity
            onPress={e => { e.stopPropagation?.(); onShare() }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(229,57,53,0.08)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}
          >
            <Ionicons name="share-outline" size={11} color={BRAND} />
            <Text style={{ color: BRAND, fontSize: 10, fontWeight: '700' }}>シェア</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  )
}

// 日付グループヘッダー
function DateHeader({ dateStr }: { dateStr: string }) {
  const now = new Date()
  const d   = new Date(dateStr)
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  const label = diffDays === 0 ? '今日' : diffDays === 1 ? '昨日' : diffDays < 7 ? `${diffDays}日前` : dateStr.slice(5).replace('-', '/')
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 2 }}>
      <Text style={{ color: diffDays === 0 ? BRAND : TEXT.secondary, fontSize: 12, fontWeight: '800' }}>{label}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
      <Text style={{ color: TEXT.hint, fontSize: 10 }}>
        {['日','月','火','水','木','金','土'][d.getDay()]}
      </Text>
    </View>
  )
}

function PracticeTab({ sessions, loading, weightRecords, onAddWeight, onDeleteWeight, onDeleteSession }: {
  sessions: TrainingSession[]
  loading: boolean
  weightRecords: WeightRecord[]
  onAddWeight: (kg: number, date: string) => void
  onDeleteWeight: (id: string) => void
  onDeleteSession: (id: string) => void
}) {
  const router = useRouter()
  const [selectedSession, setSelectedSession] = useState<TrainingSession | null>(null)
  const [shareSession,    setShareSession]    = useState<PracticeShareData | null>(null)
  if (loading) return <View style={{ gap: 10 }}>{[1,2,3].map(i => <SkeletonRect key={i} h={80} />)}</View>

  const totalKm     = sessions.reduce((a,s) => a+(s.distance_m??0), 0) / 1000
  const thisWeekSessions = sessions.filter(s => {
    const d = new Date(s.session_date)
    return (Date.now() - d.getTime()) <= 7 * 86400000
  })

  // 連続練習日数
  let streak = 0
  const today = new Date().toISOString().slice(0, 10)
  const dateSet = new Set(sessions.map(s => s.session_date))
  for (let i = 0; i < 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const dStr = d.toISOString().slice(0, 10)
    if (dateSet.has(dStr)) streak++
    else if (i > 0) break  // streak ends (today OK to be 0)
  }

  // セッション→シェアデータ変換
  const TYPE_LABEL_MAP: Record<string, string> = {
    interval:'インターバル', tempo:'テンポ走', easy:'ジョグ', long:'ロング走',
    sprint:'スプリント', drill:'ドリル', strength:'ウェイト', race:'試合', rest:'休養',
  }
  const fmtMsShare = (ms: number) => {
    const s = ms / 1000
    if (s < 60) return `${s.toFixed(2)}"`
    return `${Math.floor(s/60)}'${(s%60).toFixed(2).padStart(5,'0')}"`
  }
  const buildShare = (sess: TrainingSession): PracticeShareData => {
    const dt = new Date(sess.session_date + 'T00:00:00')
    const weekdays = ['日','月','火','水','木','金','土']
    const levelInfo = calcLevelInfo(sessions.length)
    return {
      date:      `${dt.getFullYear()}年${dt.getMonth()+1}月${dt.getDate()}日（${weekdays[dt.getDay()]}）`,
      title:     TYPE_LABEL_MAP[sess.session_type] ?? sess.session_type,
      menu:      sess.notes ?? undefined,
      distance:  sess.distance_m ? sess.distance_m / 1000 : undefined,
      sets:      sess.reps ?? undefined,
      time:      sess.time_ms ? fmtMsShare(sess.time_ms) : undefined,
      fatigue:   sess.fatigue_level,
      condition: sess.condition_level,
      weather:   sess.weather ?? undefined,
      streak,
      rank:      `${levelInfo.emoji} ${levelInfo.title}`,
    }
  }

  // タイムライン：日付ごとにグループ化
  const byDate: Record<string, TrainingSession[]> = {}
  sessions.forEach(s => {
    byDate[s.session_date] = byDate[s.session_date] ?? []
    byDate[s.session_date].push(s)
  })
  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a)).slice(0, 60)

  const unlockedCount = MILESTONES.filter(m => m.check(sessions)).length

  return (
    <>
    <View style={{ gap: 14 }}>

      {/* ── 入力ボタン（手動 / AI）── */}
      <AnimatedSection delay={0} type="fade-up">
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TouchableOpacity
          style={[styles.inputShortcut, { borderColor: 'rgba(90,200,250,0.4)' }]}
          activeOpacity={0.8}
          onPress={() => { unlockAudio(); Sounds.tap(); router.push('/manual-log' as any) }}
        >
          <Ionicons name="create-outline" size={20} color="#5AC8FA" />
          <Text style={[styles.inputShortcutText, { color: '#5AC8FA' }]}>手動入力</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.inputShortcut, { borderColor: 'rgba(229,57,53,0.4)', backgroundColor: 'rgba(229,57,53,0.07)' }]}
          activeOpacity={0.8}
          onPress={() => { unlockAudio(); Sounds.whoosh(); router.push('/practice-input' as any) }}
        >
          <Text style={{ fontSize: 18 }}>🤖</Text>
          <Text style={[styles.inputShortcutText, { color: BRAND }]}>AI入力</Text>
        </TouchableOpacity>
      </View>
      </AnimatedSection>

      {/* ── ストリーク＋統計 ── */}
      <AnimatedSection delay={0} type="fade-up">
      <View style={[styles.card, { padding: 16 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: TEXT.hint, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>TRAINING STREAK</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 4 }}>
              <Text style={{ color: streak > 0 ? BRAND : '#aaa', fontSize: 40, fontWeight: '900', lineHeight: 44 }}>
                {streak}
              </Text>
              <Text style={{ color: TEXT.secondary, fontSize: 14, marginBottom: 6 }}>日連続</Text>
              {streak >= 7  && <Text style={{ fontSize: 20, marginBottom: 4 }}>🔥</Text>}
              {streak >= 30 && <Text style={{ fontSize: 20, marginBottom: 4 }}>💎</Text>}
            </View>
          </View>
          <View style={{ gap: 10 }}>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={{ color: TEXT.primary, fontSize: 18, fontWeight: '900' }}>{sessions.length}</Text>
              <Text style={{ color: TEXT.hint, fontSize: 10 }}>総練習数</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={{ color: TEXT.primary, fontSize: 18, fontWeight: '900' }}>{totalKm.toFixed(0)}km</Text>
              <Text style={{ color: TEXT.hint, fontSize: 10 }}>累計距離</Text>
            </View>
          </View>
        </View>
        <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)', flexDirection: 'row', gap: 12 }}>
          <Text style={{ color: TEXT.hint, fontSize: 11 }}>今週</Text>
          <Text style={{ color: TEXT.primary, fontSize: 11, fontWeight: '700' }}>{thisWeekSessions.length}回</Text>
          <Text style={{ color: TEXT.hint, fontSize: 11, marginLeft: 8 }}>今月</Text>
          <Text style={{ color: TEXT.primary, fontSize: 11, fontWeight: '700' }}>
            {sessions.filter(s => new Date(s.session_date).getMonth() === new Date().getMonth()).length}回
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={{ color: TEXT.hint, fontSize: 11 }}>🏅 {unlockedCount}/{MILESTONES.length}</Text>
        </View>
      </View>
      </AnimatedSection>

      {/* ── グローカレンダー ── */}
      <AnimatedSection delay={60} type="fade-up">
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={{ fontSize: 14 }}>📅</Text>
          <Text style={styles.cardTitle}>練習カレンダー</Text>
        </View>
        <GlowCalendar sessions={sessions} />
      </View>
      </AnimatedSection>

      {/* ── 練習ノート ── */}
      <AnimatedSection delay={120} type="fade-up">
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={{ fontSize: 14 }}>📒</Text>
          <Text style={styles.cardTitle}>練習ノート</Text>
          <Text style={{ color: TEXT.hint, fontSize: 12 }}>{sessions.length}件</Text>
        </View>
        {loading ? (
          <View style={{ gap: 10 }}>{[1,2,3].map(i => <SkeletonRect key={i} h={80} />)}</View>
        ) : sessions.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 36 }}>📝</Text>
            <Text style={styles.emptyText}>まだ練習記録がありません</Text>
            <Text style={[styles.emptyText, { fontSize: 12, marginTop: 4 }]}>＋ボタンから今日の練習を記録しよう</Text>
          </View>
        ) : (
          <ScrollView
            style={{ maxHeight: 340 }}
            nestedScrollEnabled
            showsVerticalScrollIndicator={sessions.length > 4}
            contentContainerStyle={{ gap: 4 }}
          >
            {sortedDates.map(date => (
              <View key={date}>
                <DateHeader dateStr={date} />
                {byDate[date].map(s => (
                  <SessionTimelineCard key={s.id} session={s} onTap={() => setSelectedSession(s)} onShare={() => setShareSession(buildShare(s))} />
                ))}
              </View>
            ))}
            {sessions.length > 60 && (
              <Text style={{ color: TEXT.hint, fontSize: 12, textAlign: 'center', paddingTop: 8 }}>
                直近60件を表示中（全{sessions.length}件）
              </Text>
            )}
          </ScrollView>
        )}
      </View>
      </AnimatedSection>

      {/* ── マイルストーン ── */}
      <AnimatedSection delay={180} type="fade-up">
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={{ fontSize: 14 }}>🎯</Text>
          <Text style={styles.cardTitle}>マイルストーン</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {MILESTONES.map(m => {
              const unlocked = m.check(sessions)
              return (
                <View key={m.key} style={{
                  alignItems: 'center', gap: 5, padding: 12, borderRadius: 12,
                  backgroundColor: unlocked ? 'rgba(229,57,53,0.1)' : '#f0f2f5',
                  borderWidth: 1, borderColor: unlocked ? BRAND + '40' : 'rgba(0,0,0,0.06)',
                  minWidth: 68, opacity: unlocked ? 1 : 0.45,
                }}>
                  <Text style={{ fontSize: 22 }}>{m.emoji}</Text>
                  <Text style={{ color: unlocked ? BRAND : TEXT.secondary, fontSize: 11, fontWeight: '800' }}>{m.label}</Text>
                </View>
              )
            })}
          </View>
        </ScrollView>
      </View>
      </AnimatedSection>

    </View>

  {/* 体重 */}
  <WeightSection records={weightRecords} onAdd={onAddWeight} onDelete={onDeleteWeight} />

  {selectedSession && (
    <SessionDetailSheet session={selectedSession} onClose={() => setSelectedSession(null)} onDelete={onDeleteSession} />
  )}
  <Modal visible={!!shareSession} transparent animationType="fade" onRequestClose={() => setShareSession(null)}>
    {shareSession ? (
      <PracticeShareCard data={shareSession} visible={true} onClose={() => setShareSession(null)} />
    ) : <View />}
  </Modal>
  </>
)
}

// ── 体重折れ線グラフ ──────────────────────────────────────────────
const Y_AXIS_W = 38
const PLOT_H   = 110
const X_AXIS_H = 16

function WeightLineChart({ records }: { records: WeightRecord[] }) {
  const data = records.slice(-30)  // 最大30件
  if (data.length === 0) return null

  const PLOT_W = SCREEN_W - 80 - Y_AXIS_W  // card/scroll padding × 2 + y-axis

  const vals = data.map(r => r.weight_kg)
  const rawMax = Math.max(...vals)
  const rawMin = Math.min(...vals)
  const pad    = (rawMax - rawMin) * 0.18 || 1.5
  const yMax   = rawMax + pad
  const yMin   = rawMin - pad
  const yRange = yMax - yMin

  // 3段のY目盛り
  const yTicks = [yMax, (yMax + yMin) / 2, yMin].map(v => Math.round(v * 10) / 10)

  function xFor(i: number) {
    return data.length === 1 ? PLOT_W / 2 : (i / (data.length - 1)) * PLOT_W
  }
  function yFor(kg: number) {
    return PLOT_H - ((kg - yMin) / yRange) * PLOT_H
  }

  // x軸ラベル表示インデックス（最大6個）
  const step = Math.max(1, Math.floor(data.length / 6))

  return (
    <View style={{ flexDirection: 'row', marginTop: 4 }}>
      {/* Y軸ラベル */}
      <View style={{ width: Y_AXIS_W, height: PLOT_H, justifyContent: 'space-between', alignItems: 'flex-end', paddingRight: 5 }}>
        {yTicks.map((v, i) => (
          <Text key={i} style={{ color: TEXT.hint, fontSize: 9 }}>{v}</Text>
        ))}
      </View>

      {/* プロット領域 */}
      <View style={{ width: PLOT_W, height: PLOT_H + X_AXIS_H }}>
        {/* グリッド横線 */}
        {yTicks.map((_, i) => {
          const y = i === 0 ? 0 : i === 1 ? PLOT_H / 2 : PLOT_H - 1
          return (
            <View key={i} style={{
              position: 'absolute', left: 0, right: 0, top: y, height: 1,
              backgroundColor: 'rgba(0,0,0,0.07)',
            }} />
          )
        })}

        {/* 折れ線 */}
        {data.slice(0, -1).map((r, i) => {
          const x1 = xFor(i),     y1 = yFor(r.weight_kg)
          const x2 = xFor(i + 1), y2 = yFor(data[i + 1].weight_kg)
          const dx = x2 - x1, dy = y2 - y1
          const len   = Math.sqrt(dx * dx + dy * dy)
          const angle = Math.atan2(dy, dx) * 180 / Math.PI
          const midX  = (x1 + x2) / 2
          const midY  = (y1 + y2) / 2
          return (
            <View key={`l${i}`} style={{
              position: 'absolute',
              left: midX - len / 2,
              top:  midY - 1,
              width: len, height: 2,
              backgroundColor: '#5AC8FA',
              borderRadius: 1,
              transform: [{ rotate: `${angle}deg` }],
            }} />
          )
        })}

        {/* ドット */}
        {data.map((r, i) => {
          const x = xFor(i), y = yFor(r.weight_kg)
          const isLatest = i === data.length - 1
          return (
            <View key={`d${i}`} style={{
              position: 'absolute',
              left: x - 4, top: y - 4,
              width: 8, height: 8, borderRadius: 4,
              backgroundColor: isLatest ? BRAND : '#3b82f6',
              borderWidth: isLatest ? 2 : 1,
              borderColor: isLatest ? '#fff' : 'rgba(0,0,0,0.25)',
            }} />
          )
        })}

        {/* X軸日付ラベル */}
        {data.map((r, i) => {
          if (i % step !== 0 && i !== data.length - 1) return null
          const x = xFor(i)
          const d = new Date(r.date)
          const label = `${d.getMonth()+1}/${d.getDate()}`
          return (
            <Text key={`x${i}`} style={{
              position: 'absolute',
              left: x - 12, top: PLOT_H + 2,
              width: 24, textAlign: 'center',
              color: TEXT.hint, fontSize: 8,
            }}>{label}</Text>
          )
        })}
      </View>
    </View>
  )
}

// ── 体重セクション（練習履歴タブ末尾 & 体調・睡眠タブ共用）───────────
function WeightSection({
  records, onAdd, onDelete,
}: {
  records: WeightRecord[]
  onAdd: (kg: number, date: string) => void
  onDelete: (id: string) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [input, setInput] = useState('')
  const [selectedDate, setSelectedDate] = useState(today)

  // ±7日の日付リスト
  const dateRange = Array.from({ length: 15 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 7 + i)
    return d.toISOString().slice(0, 10)
  })

  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date))
  const latest = sorted[sorted.length - 1]

  // 選択日に既存記録があれば表示
  const existingForDate = records.find(r => r.date === selectedDate)

  function handleAdd() {
    const kg = parseFloat(input)
    if (isNaN(kg) || kg < 20 || kg > 300) return
    onAdd(kg, selectedDate)
    setInput('')
  }

  function formatDateLabel(dateStr: string) {
    const d = new Date(dateStr)
    const diff = Math.round((d.getTime() - new Date(today).getTime()) / 86400000)
    if (diff === 0) return '今日'
    if (diff === -1) return '昨日'
    if (diff === 1) return '明日'
    const dow = ['日','月','火','水','木','金','土'][d.getDay()]
    return `${d.getMonth()+1}/${d.getDate()}(${dow})`
  }

  return (
    <AnimatedSection delay={160} type="fade-up">
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={{ fontSize: 15 }}>⚖️</Text>
        <Text style={styles.cardTitle}>体重の推移</Text>
        {latest && (
          <Text style={{ color: BRAND, fontSize: 14, fontWeight: '800', marginLeft: 'auto' as any }}>
            {latest.weight_kg}kg
          </Text>
        )}
      </View>

      {/* 日付セレクター */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}
        contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
        {dateRange.map(d => {
          const isSelected = d === selectedDate
          const hasRecord = records.some(r => r.date === d)
          return (
            <TouchableOpacity
              key={d}
              onPress={() => { setSelectedDate(d); setInput(records.find(r => r.date === d)?.weight_kg.toString() ?? '') }}
              style={{
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
                backgroundColor: isSelected ? BRAND : '#f0f2f5',
                borderWidth: 1,
                borderColor: isSelected ? BRAND : hasRecord ? 'rgba(59,130,246,0.4)' : 'rgba(0,0,0,0.08)',
              }}
            >
              <Text style={{ color: isSelected ? '#fff' : hasRecord ? '#3b82f6' : TEXT.hint, fontSize: 11, fontWeight: '700' }}>
                {formatDateLabel(d)}
              </Text>
              {hasRecord && (
                <Text style={{ color: isSelected ? 'rgba(255,255,255,0.8)' : '#3b82f6', fontSize: 9, textAlign: 'center' }}>
                  {records.find(r => r.date === d)?.weight_kg}kg
                </Text>
              )}
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {/* 入力 */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={existingForDate ? `現在: ${existingForDate.weight_kg}kg` : `${formatDateLabel(selectedDate)}の体重 (kg)`}
          placeholderTextColor={TEXT.hint}
          keyboardType="decimal-pad"
          style={[styles.weightInput]}
        />
        <TouchableOpacity
          style={[styles.weightAddBtn, (!input.trim()) && { opacity: 0.4 }]}
          onPress={handleAdd}
          disabled={!input.trim()}
          activeOpacity={0.8}
        >
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>記録</Text>
        </TouchableOpacity>
        {existingForDate && (
          <TouchableOpacity
            onPress={() => onDelete(existingForDate.id)}
            style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(255,59,48,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,59,48,0.3)' }}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={18} color="#FF3B30" />
          </TouchableOpacity>
        )}
      </View>

      {/* グラフ */}
      {sorted.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>体重データがありません{'\n'}毎日記録しましょう</Text>
        </View>
      ) : (
        <WeightLineChart records={sorted} />
      )}
    </View>
    </AnimatedSection>
  )
}

// ── 体調・睡眠タブ ────────────────────────────────────────────────
function TrendLineChart({ data, color, format }: {
  data: { date: string; value: number }[]
  color: string
  format: (v: number) => string
}) {
  const displayed = data.slice(-30)
  if (displayed.length === 0) return null

  const TL_YW  = 38
  const TL_H   = 110
  const TL_XH  = 18
  const TL_W   = SCREEN_W - 80 - TL_YW

  const vals   = displayed.map(d => d.value)
  const rawMax = Math.max(...vals)
  const rawMin = Math.min(...vals)
  const pad    = (rawMax - rawMin) * 0.18 || 1
  const yMax   = rawMax + pad
  const yMin   = rawMin - pad
  const yRange = yMax - yMin

  const yTicks = [yMax, (yMax + yMin) / 2, yMin].map(v => Math.round(v * 10) / 10)

  const xFor = (i: number) =>
    displayed.length === 1 ? TL_W / 2 : (i / (displayed.length - 1)) * TL_W
  const yFor = (v: number) => TL_H - ((v - yMin) / yRange) * TL_H

  const step = Math.max(1, Math.floor(displayed.length / 6))

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', marginTop: 4 }}>
        {/* Y軸ラベル */}
        <View style={{ width: TL_YW, height: TL_H, justifyContent: 'space-between', alignItems: 'flex-end', paddingRight: 5 }}>
          {yTicks.map((v, i) => (
            <Text key={i} style={{ color: TEXT.hint, fontSize: 9 }}>{format(v)}</Text>
          ))}
        </View>
        {/* プロット領域 */}
        <View style={{ width: TL_W, height: TL_H + TL_XH }}>
          {/* グリッド横線 */}
          {yTicks.map((_, i) => {
            const y = i === 0 ? 0 : i === 1 ? TL_H / 2 : TL_H - 1
            return <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: y, height: 1, backgroundColor: 'rgba(0,0,0,0.07)' }} />
          })}
          {/* 折れ線 */}
          {displayed.slice(0, -1).map((d, i) => {
            const x1 = xFor(i),     y1 = yFor(d.value)
            const x2 = xFor(i + 1), y2 = yFor(displayed[i + 1].value)
            const dx = x2 - x1, dy = y2 - y1
            const len   = Math.sqrt(dx * dx + dy * dy)
            const angle = Math.atan2(dy, dx) * 180 / Math.PI
            return (
              <View key={`l${i}`} style={{
                position: 'absolute',
                left: (x1 + x2) / 2 - len / 2,
                top:  (y1 + y2) / 2 - 1,
                width: len, height: 2,
                backgroundColor: color, borderRadius: 1,
                transform: [{ rotate: `${angle}deg` }],
              }} />
            )
          })}
          {/* ドット */}
          {displayed.map((d, i) => {
            const x = xFor(i), y = yFor(d.value)
            const isLatest = i === displayed.length - 1
            return (
              <View key={`d${i}`} style={{
                position: 'absolute', left: x - 4, top: y - 4,
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: isLatest ? color : color + 'cc',
                borderWidth: isLatest ? 2 : 1,
                borderColor: isLatest ? '#fff' : 'rgba(0,0,0,0.2)',
              }} />
            )
          })}
          {/* X軸日付ラベル */}
          {displayed.map((d, i) => {
            if (i % step !== 0 && i !== displayed.length - 1) return null
            const x  = xFor(i)
            const dt = new Date(d.date)
            return (
              <Text key={`x${i}`} style={{
                position: 'absolute', left: x - 12, top: TL_H + 2,
                width: 24, textAlign: 'center',
                color: TEXT.hint, fontSize: 8,
              }}>{`${dt.getMonth() + 1}/${dt.getDate()}`}</Text>
            )
          })}
        </View>
      </View>
      {/* 統計 */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: TEXT.hint, fontSize: 11 }}>
          平均: <Text style={{ color: TEXT.primary, fontWeight: '700' }}>
            {format(vals.reduce((a, v) => a + v, 0) / vals.length)}
          </Text>
        </Text>
        <Text style={{ color: TEXT.hint, fontSize: 11 }}>
          最高: <Text style={{ color, fontWeight: '700' }}>{format(rawMax)}</Text>
        </Text>
      </View>
    </View>
  )
}

function HealthTab({ conditionMap, sleepRecords, weightRecords, onAddWeight, onDeleteWeight, loading }: {
  conditionMap: Record<string,number>
  sleepRecords: SleepRecord[]
  weightRecords: WeightRecord[]
  onAddWeight: (kg: number, date: string) => void
  onDeleteWeight: (id: string) => void
  loading: boolean
}) {
  if (loading) return <View style={{ gap: 10 }}>{[1,2].map(i => <SkeletonRect key={i} h={120} />)}</View>

  // 体調データ（日付順）
  const condData = Object.entries(conditionMap)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }))

  // 睡眠データ（直近14件）
  const sleepData = [...sleepRecords]
    .sort((a,b) => a.sleep_date.localeCompare(b.sleep_date))
    .slice(-14)
    .map(s => ({ date: s.sleep_date, value: s.duration_min ? s.duration_min / 60 : 0 }))
    .filter(d => d.value > 0)

  const COND_EMOJIS = ['😫','😕','😐','😊','💪']

  return (
    <View style={{ gap: 12 }}>
      {/* 体調トレンド */}
      <AnimatedSection delay={0} type="fade-up">
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={{ fontSize: 15 }}>💪</Text>
          <Text style={styles.cardTitle}>体調の推移</Text>
        </View>
        {condData.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>体調データがありません{'\n'}ホームで毎日入力しましょう</Text>
          </View>
        ) : (
          <>
            <TrendLineChart
              data={condData}
              color={NEON.green}
              format={v => `${v.toFixed(1)}`}
            />
            {/* 今日の体調 */}
            {condData.length > 0 && (
              <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 24 }}>
                  {COND_EMOJIS[Math.min(4, Math.round((condData[condData.length-1].value - 1) / 2))]}
                </Text>
                <View>
                  <Text style={{ color: TEXT.secondary, fontSize: 11 }}>直近の体調</Text>
                  <Text style={{ color: TEXT.primary, fontSize: 16, fontWeight: '800' }}>
                    {condData[condData.length-1].value}/10
                  </Text>
                </View>
              </View>
            )}
          </>
        )}
      </View>
      </AnimatedSection>

      {/* 睡眠トレンド */}
      <AnimatedSection delay={80} type="fade-up">
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={{ fontSize: 15 }}>😴</Text>
          <Text style={styles.cardTitle}>睡眠時間の推移</Text>
        </View>
        {sleepData.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>睡眠データがありません{'\n'}睡眠タブで記録しましょう</Text>
          </View>
        ) : (
          <TrendLineChart
            data={sleepData}
            color={NEON.purple}
            format={v => `${v.toFixed(1)}h`}
          />
        )}
      </View>
      </AnimatedSection>

      {/* 体重トレンド */}
      <WeightSection records={weightRecords} onAdd={onAddWeight} onDelete={onDeleteWeight} />

    </View>
  )
}

// ── メイン ────────────────────────────────────────────────────────
export default function RecordsScreen() {
  const router = useRouter()
  const { isGuest } = useAuth()
  const [activeTab, setActiveTab] = useState<'practice'|'records'|'health'>('practice')
  const [csvGateVisible,     setCsvGateVisible]     = useState(false)
  const [csvGateRemaining,   setCsvGateRemaining]   = useState(0)
  const [csvGateHardLimited, setCsvGateHardLimited] = useState(false)
  const [csvGateRewardUses,  setCsvGateRewardUses]  = useState(0)
  const [records, setRecords] = useState<RaceRecord[]>([])
  const [sessions, setSessions] = useState<TrainingSession[]>([])
  const [conditionMap, setConditionMap] = useState<Record<string,number>>({})
  const [sleepRecords, setSleepRecords] = useState<SleepRecord[]>([])
  const [weightRecords, setWeightRecords] = useState<WeightRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [filterEvent, setFilterEvent] = useState<AthleticsEvent | '全種目'>('全種目')
  const [chartEvent, setChartEvent] = useState<AthleticsEvent | null>(null)

  // フォーム状態
  const [fEvent, setFEvent]   = useState<AthleticsEvent>('100m')
  const [fDate, setFDate]     = useState(new Date().toISOString().slice(0, 10))
  const [fMin, setFMin]       = useState('')
  const [fSec, setFSec]       = useState('')
  const [fMeter, setFMeter]   = useState('')
  const [fCm, setFCm]         = useState('')
  const [fWind, setFWind]     = useState('')
  const [fWindPos, setFWindPos] = useState(true)   // true=+ / false=-
  const [fVenue, setFVenue]   = useState('')
  const [fComp, setFComp]     = useState('')
  const [fIsPB, setFIsPB]     = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)
  const [fIsSB, setFIsSB]     = useState(false)
  const [fNotes, setFNotes]   = useState('')
  const [saving, setSaving]   = useState(false)

  // ロード（フォーカス時にも再ロード：manual-log等から戻った時に反映）
  const loadData = useCallback(() => {
    Promise.all([
      AsyncStorage.getItem(RECORDS_KEY),
      AsyncStorage.getItem(SESSIONS_KEY),
      AsyncStorage.getItem(CONDITION_MAP_KEY),
      AsyncStorage.getItem(SLEEP_KEY),
      AsyncStorage.getItem(WEIGHT_KEY),
    ]).then(([recRaw, sessRaw, condRaw, sleepRaw, weightRaw]) => {
      if (recRaw)    { try { setRecords(JSON.parse(recRaw)) }         catch {} }
      if (sessRaw)   { try { setSessions(JSON.parse(sessRaw)) }       catch {} }
      if (condRaw)   { try { setConditionMap(JSON.parse(condRaw)) }   catch {} }
      if (sleepRaw)  { try { setSleepRecords(JSON.parse(sleepRaw)) }  catch {} }
      if (weightRaw) { try { setWeightRecords(JSON.parse(weightRaw)) }catch {} }
      setLoading(false)
    })
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useFocusEffect(useCallback(() => { loadData() }, [loadData]))

  const handleAddWeight = useCallback(async (kg: number, date: string) => {
    const newRec: WeightRecord = { id: `w_${Date.now()}`, date, weight_kg: kg }
    const next = [...weightRecords.filter(r => r.date !== date), newRec]
      .sort((a, b) => a.date.localeCompare(b.date))
    setWeightRecords(next)
    await AsyncStorage.setItem(WEIGHT_KEY, JSON.stringify(next)).catch(() => {})
    Toast.show({ type: 'success', text1: `${kg}kg を記録しました`, visibilityTime: 1500 })
  }, [weightRecords])

  const handleDeleteWeight = useCallback(async (id: string) => {
    const next = weightRecords.filter(r => r.id !== id)
    setWeightRecords(next)
    await AsyncStorage.setItem(WEIGHT_KEY, JSON.stringify(next)).catch(() => {})
    Toast.show({ type: 'success', text1: '削除しました', visibilityTime: 1200 })
  }, [weightRecords])

  const handleDeleteSession = useCallback(async (id: string) => {
    const next = sessions.filter(s => s.id !== id)
    setSessions(next)
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(next)).catch(() => {})
    Toast.show({ type: 'success', text1: '練習記録を削除しました', visibilityTime: 1500 })
  }, [sessions])

  function resetForm() {
    setFEvent('100m'); setFDate(new Date().toISOString().slice(0, 10))
    setFMin(''); setFSec(''); setFMeter(''); setFCm(''); setFWind(''); setFWindPos(true)
    setFVenue(''); setFComp(''); setFIsPB(false); setFIsSB(false); setFNotes('')
  }

  const handleSave = useCallback(async () => {
    const field = isField(fEvent)
    const result_ms  = field ? undefined : parseTrackInput(fMin, fSec)
    const result_cm  = field ? parseFieldInput(fMeter, fCm) : undefined
    if (!field && (!result_ms || result_ms <= 0)) {
      Toast.show({ type: 'error', text1: 'タイムを入力してください' }); return
    }
    if (field && (!result_cm || result_cm <= 0)) {
      Toast.show({ type: 'error', text1: '記録を入力してください' }); return
    }

    const display = field
      ? cmToDisplay(result_cm!)
      : msToDisplay(result_ms!, fEvent)

    setSaving(true)
    try {
      const newRec: RaceRecord = {
        id: `rec_${Date.now()}`,
        user_id: MOCK_USER_ID,
        event: fEvent,
        result_display: display,
        result_ms,
        result_cm,
        race_date: fDate,
        venue: fVenue || undefined,
        competition_name: fComp || undefined,
        wind_ms: fWind !== '' ? parseFloat(fWind) * (fWindPos ? 1 : -1) : undefined,
        is_pb: fIsPB,
        is_sb: fIsSB,
        notes: fNotes || undefined,
        created_at: new Date().toISOString(),
      }
      const updated = [newRec, ...records].sort((a, b) => b.race_date.localeCompare(a.race_date))
      await AsyncStorage.setItem(RECORDS_KEY, JSON.stringify(updated))
      setRecords(updated)
      if (fIsPB) { Sounds.pb(); pbCelebration(); setShowConfetti(true); setTimeout(() => setShowConfetti(false), 3000) } else { Sounds.save() }
      Toast.show({ type: 'success', text1: `✅ ${fEvent}  ${display}${fIsPB ? '  🏆 PB！' : ''}` })
      resetForm(); setModalVisible(false)
    } catch {
      Sounds.error()
      Toast.show({ type: 'error', text1: '保存に失敗しました' })
    } finally { setSaving(false) }
  }, [fEvent, fDate, fMin, fSec, fMeter, fCm, fWind, fVenue, fComp, fIsPB, fIsSB, fNotes, records])

  const handleDelete = useCallback(async (id: string) => {
    Sounds.delete()
    const updated = records.filter(r => r.id !== id)
    await AsyncStorage.setItem(RECORDS_KEY, JSON.stringify(updated))
    setRecords(updated)
  }, [records])

  // フィルター適用
  const filtered = filterEvent === '全種目'
    ? records
    : records.filter(r => r.event === filterEvent)

  // 記録のある種目リスト
  const usedEvents = Array.from(new Set(records.map(r => r.event)))

  // グラフデータ（選択種目のタイム推移）
  const targetEvent = chartEvent ?? (usedEvents.find(e => !isField(e)) ?? null)
  const chartData: ChartDataPoint[] = targetEvent
    ? records
        .filter(r => r.event === targetEvent && r.result_ms)
        .slice(0, 8).reverse()
        .map(r => ({ date: r.race_date, value: r.result_ms! / 1000 }))
    : []

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
      <SafeAreaView style={styles.safe}>

        {/* ── ヘッダー ── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>進捗</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={async () => {
                Sounds.whoosh()
                if (isGuest) { setCsvGateRemaining(0); setCsvGateHardLimited(false); setCsvGateVisible(true); return }
                const gate = await checkAdGate('csv')
                if (!gate.allowed) { setCsvGateRemaining(0); setCsvGateRewardUses(gate.rewardUses); setCsvGateHardLimited(gate.hardLimited); setCsvGateVisible(true); return }
                if (gate.remaining === 0 && gate.rewardUses > 0) {
                  await consumeRewardUse('csv')
                } else if (gate.remaining === 1) {
                  setCsvGateRemaining(1); setCsvGateVisible(true); return
                } else {
                  await recordUsage('csv')
                }
                trackFeatureUse('csv')
                Alert.alert('エクスポート', '形式を選択してください', [
                  { text: 'CSV',  onPress: () => exportAllDataCSV().catch(() => Toast.show({ type: 'error', text1: 'エクスポートに失敗しました' })) },
                  { text: 'JSON', onPress: () => exportAllDataJSON().catch(() => Toast.show({ type: 'error', text1: 'エクスポートに失敗しました' })) },
                  { text: 'キャンセル', style: 'cancel' },
                ])
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="download-outline" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => { Sounds.whoosh(); router.push('/video-analysis') }} activeOpacity={0.8}>
              <Ionicons name="film-outline" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => { Sounds.whoosh(); router.push('/timer') }} activeOpacity={0.8}>
              <Ionicons name="timer-outline" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.addBtn} onPress={() => { unlockAudio(); Sounds.whoosh(); setModalVisible(true) }} activeOpacity={0.8}>
              <Ionicons name="add" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── タブバー ── */}
        <View style={styles.tabBar}>
          {([
            { key: 'practice', label: '練習履歴' },
            { key: 'records',  label: 'タイム記録' },
            { key: 'health',   label: '体調・睡眠' },
          ] as const).map(t => (
            <HapticTouch
              key={t.key}
              haptic="tabSwitch"
              style={[styles.tabItem, activeTab === t.key && styles.tabItemActive]}
              onPress={() => setActiveTab(t.key)}
            >
              <Text style={[styles.tabLabel, activeTab === t.key && styles.tabLabelActive]}>{t.label}</Text>
            </HapticTouch>
          ))}
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ════ 練習履歴タブ ════ */}
          {activeTab === 'practice' && (
            <PracticeTab sessions={sessions} loading={loading} weightRecords={weightRecords} onAddWeight={handleAddWeight} onDeleteWeight={handleDeleteWeight} onDeleteSession={handleDeleteSession} />
          )}

          {/* ════ タイム記録タブ ════ */}
          {activeTab === 'records' && <>

          {/* ── タイム入力ボタン ── */}
          <AnimatedSection delay={0} type="fade-up">
            <TouchableOpacity
              style={styles.bigAddBtn}
              onPress={() => { unlockAudio(); Sounds.whoosh(); setModalVisible(true) }}
              activeOpacity={0.85}
            >
              <Ionicons name="stopwatch-outline" size={22} color="#fff" />
              <Text style={styles.bigAddBtnText}>タイムを入力する</Text>
              <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
            </TouchableOpacity>
          </AnimatedSection>

          {/* ── PBサマリー ── */}
          <AnimatedSection delay={0} type="fade-up">
          {loading ? (
            <View style={styles.card}><SkeletonRect h={80} /></View>
          ) : (
            <PBSummary records={records} />
          )}
          </AnimatedSection>

          {/* ── タイム推移グラフ ── */}
          {!loading && chartData.length >= 2 && (
            <AnimatedSection delay={80} type="fade-up">
            <View style={styles.card}>
              {/* 種目切替 */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {usedEvents.filter(e => !isField(e)).map(e => (
                    <HapticTouch
                      key={e}
                      haptic="toggleOn"
                      style={[styles.filterChip, (targetEvent === e) && styles.filterChipActive]}
                      onPress={() => setChartEvent(e)}
                    >
                      <Text style={[styles.filterChipText, (targetEvent === e) && styles.filterChipTextActive]}>{e}</Text>
                    </HapticTouch>
                  ))}
                </View>
              </ScrollView>
              <TrainingChart
                data={chartData}
                title={`${targetEvent} タイム推移`}
                color={BRAND}
                unit="秒"
                isLoading={false}
              />
            </View>
            </AnimatedSection>
          )}

          {/* ── 種目フィルター ── */}
          {!loading && records.length > 0 && (
            <AnimatedSection delay={160} type="fade-up">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 6, paddingBottom: 4 }}>
                {(['全種目', ...usedEvents] as const).map(e => (
                  <HapticTouch
                    key={e}
                    haptic="toggleOn"
                    style={[styles.filterChip, filterEvent === e && styles.filterChipActive]}
                    onPress={() => setFilterEvent(e as any)}
                  >
                    <Text style={[styles.filterChipText, filterEvent === e && styles.filterChipTextActive]}>{e}</Text>
                  </HapticTouch>
                ))}
              </View>
            </ScrollView>
            </AnimatedSection>
          )}

          {/* ── 記録リスト ── */}
          <AnimatedSection delay={240} type="fade-up">
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="list" size={16} color={BRAND} />
              <Text style={styles.cardTitle}>記録一覧</Text>
              <Text style={styles.countText}>{filtered.length}件</Text>
            </View>

            {loading ? (
              <View style={{ gap: 8 }}>
                {[1,2,3].map(i => <SkeletonRect key={i} h={64} />)}
              </View>
            ) : filtered.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="timer-outline" size={40} color={TEXT.hint} />
                <Text style={styles.emptyText}>まだ記録がありません</Text>
                <HapticTouch haptic="whoosh" style={styles.emptyBtn} onPress={() => setModalVisible(true)}>
                  <Text style={styles.emptyBtnText}>最初の記録を追加</Text>
                </HapticTouch>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {filtered.map(r => (
                  <RecordCard key={r.id} record={r} onDelete={() => handleDelete(r.id)} />
                ))}
              </View>
            )}
          </View>
          </AnimatedSection>

          </> /* end タイム記録タブ */}

          {/* ════ 体調・睡眠タブ ════ */}
          {activeTab === 'health' && (
            <HealthTab conditionMap={conditionMap} sleepRecords={sleepRecords} weightRecords={weightRecords} onAddWeight={handleAddWeight} onDeleteWeight={handleDeleteWeight} loading={loading} />
          )}

        </ScrollView>

        {/* ── 記録追加モーダル ── */}
        <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={styles.modalSafe}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>

                {/* ヘッダー */}
                <View style={styles.modalHeader}>
                  <TouchableOpacity onPress={() => { resetForm(); setModalVisible(false) }}>
                    <Text style={styles.cancelText}>キャンセル</Text>
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>記録を追加</Text>
                  <TouchableOpacity onPress={handleSave} disabled={saving}>
                    <Text style={[styles.saveText, saving && { opacity: 0.4 }]}>{saving ? '保存中...' : '保存'}</Text>
                  </TouchableOpacity>
                </View>

                {/* 日付 */}
                <Text style={styles.label}>日付</Text>
                <DateSelector date={fDate} onChange={setFDate} />

                {/* 種目 */}
                <Text style={styles.label}>種目</Text>
                <Text style={styles.subLabel}>トラック</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  <View style={styles.chipRow}>
                    {TRACK_EVENTS.map(e => (
                      <HapticTouch key={e} haptic="toggleOn" style={[styles.chip, fEvent === e && styles.chipActive]} onPress={() => setFEvent(e)}>
                        <Text style={[styles.chipText, fEvent === e && styles.chipTextActive]}>{e}</Text>
                      </HapticTouch>
                    ))}
                  </View>
                </ScrollView>
                <Text style={styles.subLabel}>フィールド</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                  <View style={styles.chipRow}>
                    {FIELD_EVENTS.map(e => (
                      <HapticTouch key={e} haptic="toggleOn" style={[styles.chip, fEvent === e && styles.chipActive]} onPress={() => setFEvent(e)}>
                        <Text style={[styles.chipText, fEvent === e && styles.chipTextActive]}>{e}</Text>
                      </HapticTouch>
                    ))}
                  </View>
                </ScrollView>

                {/* タイム or 記録 */}
                {isField(fEvent) ? (
                  <>
                    <Text style={styles.label}>記録</Text>
                    <View style={styles.timeRow}>
                      <View style={styles.timeCol}>
                        <Text style={styles.timeUnit}>m</Text>
                        <TextInput style={styles.timeNumInput} value={fMeter} onChangeText={setFMeter}
                          keyboardType="number-pad" placeholder="7" placeholderTextColor="#445577" textAlign="center" />
                      </View>
                      <Text style={styles.timeSep}>.</Text>
                      <View style={styles.timeCol}>
                        <Text style={styles.timeUnit}>cm</Text>
                        <TextInput style={styles.timeNumInput} value={fCm} onChangeText={setFCm}
                          keyboardType="number-pad" placeholder="32" placeholderTextColor="#445577" maxLength={2} textAlign="center" />
                      </View>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.label}>タイム</Text>
                    <View style={styles.timeRow}>
                      <View style={styles.timeCol}>
                        <Text style={styles.timeUnit}>分</Text>
                        <TextInput style={styles.timeNumInput} value={fMin} onChangeText={setFMin}
                          keyboardType="number-pad" placeholder="0" placeholderTextColor="#445577" maxLength={2} textAlign="center" />
                      </View>
                      <Text style={styles.timeSep}>:</Text>
                      <View style={styles.timeCol}>
                        <Text style={styles.timeUnit}>秒</Text>
                        <TextInput style={styles.timeNumInput} value={fSec} onChangeText={setFSec}
                          keyboardType="decimal-pad" placeholder="10.85" placeholderTextColor="#445577" maxLength={5} textAlign="center" />
                      </View>
                    </View>
                  </>
                )}

                {/* 風速 */}
                {hasWind(fEvent) && (
                  <>
                    <Text style={styles.label}>風速（m/s）</Text>
                    <View style={styles.windRow}>
                      {/* +/- トグルボタン */}
                      <TouchableOpacity
                        style={[styles.windSignBtn, !fWindPos && styles.windSignBtnMinus]}
                        onPress={() => setFWindPos(v => !v)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.windSignTxt, !fWindPos && { color: '#ef4444' }]}>
                          {fWindPos ? '+' : '−'}
                        </Text>
                      </TouchableOpacity>
                      <TextInput
                        style={[styles.input, styles.windInput]}
                        value={fWind}
                        onChangeText={t => setFWind(t.replace(/[^0-9.]/g, ''))}
                        keyboardType="decimal-pad"
                        placeholder="1.2"
                        placeholderTextColor="#445577"
                      />
                      <Text style={styles.windUnit}>m/s</Text>
                    </View>
                  </>
                )}

                {/* PB / SB トグル */}
                <View style={styles.toggleRow}>
                  <TouchableOpacity style={[styles.toggleBtn, fIsPB && styles.toggleBtnPB]} onPress={() => { fIsPB ? Sounds.toggleOff() : Sounds.toggleOn(); setFIsPB(v => !v); if (!fIsPB) setFIsSB(false) }}>
                    <Ionicons name={fIsPB ? 'trophy' : 'trophy-outline'} size={16} color={fIsPB ? NEON.green : TEXT.secondary} />
                    <Text style={[styles.toggleText, fIsPB && { color: NEON.green }]}>PB（自己ベスト）</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.toggleBtn, fIsSB && styles.toggleBtnSB]} onPress={() => { fIsSB ? Sounds.toggleOff() : Sounds.toggleOn(); setFIsSB(v => !v); if (!fIsSB) setFIsPB(false) }}>
                    <Ionicons name={fIsSB ? 'star' : 'star-outline'} size={16} color={fIsSB ? NEON.blue : TEXT.secondary} />
                    <Text style={[styles.toggleText, fIsSB && { color: NEON.blue }]}>SB（シーズンベスト）</Text>
                  </TouchableOpacity>
                </View>

                {/* 大会名・会場 */}
                <Text style={styles.label}>大会名（任意）</Text>
                <TextInput style={styles.input} value={fComp} onChangeText={setFComp}
                  placeholder="例: 春季陸上競技大会" placeholderTextColor="#445577" />

                <Text style={styles.label}>会場（任意）</Text>
                <TextInput style={styles.input} value={fVenue} onChangeText={setFVenue}
                  placeholder="例: 国立競技場" placeholderTextColor="#445577" />

                {/* メモ */}
                <Text style={styles.label}>メモ（任意）</Text>
                <TextInput style={[styles.input, styles.textArea]} value={fNotes} onChangeText={setFNotes}
                  multiline numberOfLines={3} placeholder="コンディション・気づきなど..." placeholderTextColor="#445577" />

              </ScrollView>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </Modal>

      </SafeAreaView>

      {/* CSV AdGate モーダル */}
      <AdGateModal
        visible={csvGateVisible}
        feature="csv"
        remaining={csvGateRemaining}
        rewardUses={csvGateRewardUses}
        hardLimited={csvGateHardLimited}
        isGuest={isGuest}
        onClose={() => setCsvGateVisible(false)}
        onAdWatched={async () => {
          setCsvGateVisible(false)
          const g = await checkAdGate('csv')
          if (g.rewardUses > 0) {
            await consumeRewardUse('csv')
          } else {
            await recordUsage('csv')
          }
          trackFeatureUse('csv')
          exportAllDataCSV().catch(() => Toast.show({ type: 'error', text1: 'エクスポートに失敗しました' }))
        }}
        onUpgrade={() => { setCsvGateVisible(false); router.push('/paywall') }}
      />
    <ConfettiEffect visible={showConfetti} onDone={() => setShowConfetti(false)} />
    </View>
  )
}

// ── スタイル ──────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: 'transparent' },
  scroll:  { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.08)', backgroundColor: '#ffffff' },
  headerTitle: { color: TEXT.primary, fontSize: 20, fontWeight: '800' },
  addBtn:  { width: 36, height: 36, borderRadius: 18, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f0f2f5', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', alignItems: 'center', justifyContent: 'center' },

  card:    { backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle:  { color: TEXT.primary, fontSize: 15, fontWeight: '700', flex: 1 },
  countText:  { color: TEXT.hint, fontSize: 13 },

  // PBサマリー
  pbGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pbItem:  { backgroundColor: 'rgba(34,197,94,0.08)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(34,197,94,0.25)', padding: 10, minWidth: 90, alignItems: 'center' },
  pbEvent: { color: TEXT.secondary, fontSize: 11, fontWeight: '600', marginBottom: 2 },
  pbResult:{ color: NEON.green, fontSize: 16, fontWeight: '800' },
  pbDate:  { color: TEXT.hint, fontSize: 10, marginTop: 2 },

  // 記録カード
  recordCard:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f8fa', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', padding: 12, gap: 10 },
  recordCardPB: { borderColor: 'rgba(34,197,94,0.4)', backgroundColor: 'rgba(34,197,94,0.04)' },
  recordLeft:   { width: 62, gap: 4 },
  eventBadgeWrap: { backgroundColor: `${BRAND}15`, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  eventBadgeText: { color: BRAND, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  badge:        { borderRadius: 4, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText:    { fontSize: 10, fontWeight: '800' },
  recordMid:    { flex: 1, gap: 2 },
  recordResult: { color: TEXT.primary, fontSize: 22, fontWeight: '800' },
  windText:     { color: TEXT.hint, fontSize: 11 },
  windRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  windSignBtn:  { width: 44, height: 44, borderRadius: 10, backgroundColor: '#f0f2f5', borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)', alignItems: 'center', justifyContent: 'center' },
  windSignBtnMinus: { backgroundColor: '#fee2e2', borderColor: '#fca5a5' },
  windSignTxt:  { fontSize: 22, fontWeight: '700', color: '#374151', lineHeight: 26 },
  windInput:    { flex: 1, marginTop: 0 },
  windUnit:     { color: '#6b7280', fontSize: 14, fontWeight: '600' },
  recordVenue:  { color: TEXT.secondary, fontSize: 12 },
  recordRight:  { alignItems: 'flex-end', gap: 6 },
  shareBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BRAND, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  shareBtnTxt:  { color: '#fff', fontSize: 11, fontWeight: '700' },
  recordDate:   { color: TEXT.hint, fontSize: 11 },

  // フィルター
  filterChip:       { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#f0f2f5', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  filterChipActive: { backgroundColor: BRAND, borderColor: BRAND },
  filterChipText:   { color: TEXT.secondary, fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#FFFFFF' },

  // 空状態
  empty:      { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyText:  { color: TEXT.hint, fontSize: 14 },
  emptyBtn:   { backgroundColor: BRAND, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },

  // 体重入力
  weightInput:   { flex: 1, backgroundColor: '#f8f8fa', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, color: TEXT.primary, fontSize: 15, borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)' },
  weightAddBtn:  { backgroundColor: NEON.blue, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11, justifyContent: 'center' },

  // 入力ショートカット
  inputShortcut:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#f0f2f5', borderRadius: 14, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  inputShortcutText: { fontSize: 14, fontWeight: '800' },

  // モーダル
  modalSafe:    { flex: 1, backgroundColor: '#f6f6f8' },
  modalContent: { padding: 20, paddingBottom: 48, gap: 4 },
  modalHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle:   { color: TEXT.primary, fontSize: 17, fontWeight: '700' },
  cancelText:   { color: TEXT.secondary, fontSize: 16 },
  saveText:     { color: BRAND, fontSize: 16, fontWeight: '700' },

  label:    { color: TEXT.secondary, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  subLabel: { color: TEXT.hint, fontSize: 11, fontWeight: '600', marginBottom: 4 },
  input:    { backgroundColor: '#f8f8fa', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: TEXT.primary, fontSize: 15, borderWidth: 1, borderColor: 'rgba(59,130,246,0.25)', marginBottom: 14 },
  textArea: { height: 80, textAlignVertical: 'top' },

  chipRow:      { flexDirection: 'row', gap: 8 },
  chip:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', backgroundColor: '#f0f2f5' },
  chipActive:   { backgroundColor: BRAND, borderColor: BRAND },
  chipText:     { color: TEXT.secondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },

  timeRow:     { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 14 },
  timeCol:     { flex: 1, gap: 4 },
  timeNumInput:{ backgroundColor: '#f8f8fa', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: TEXT.primary, fontSize: 20, fontWeight: '700', borderWidth: 1, borderColor: 'rgba(59,130,246,0.25)' },
  timeUnit:    { color: TEXT.secondary, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  timeSep:     { color: TEXT.secondary, fontSize: 24, fontWeight: '300', paddingBottom: 10 },

  toggleRow:   { flexDirection: 'row', gap: 8, marginBottom: 14 },
  toggleBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, backgroundColor: '#f0f2f5', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  toggleBtnPB: { backgroundColor: 'rgba(34,197,94,0.08)', borderColor: NEON.green },
  toggleBtnSB: { backgroundColor: 'rgba(59,130,246,0.08)', borderColor: NEON.blue },
  toggleText:  { color: TEXT.secondary, fontSize: 12, fontWeight: '600' },

  // タイム入力大ボタン
  bigAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: BRAND, borderRadius: 16,
    paddingVertical: 18, paddingHorizontal: 20,
    shadowColor: BRAND, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },
  bigAddBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', flex: 1 },

  // タブバー
  tabBar:          { flexDirection: 'row', backgroundColor: '#ffffff', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.08)', paddingHorizontal: 16 },
  tabItem:         { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabItemActive:   { borderBottomWidth: 2, borderBottomColor: BRAND },
  tabLabel:        { color: TEXT.hint, fontSize: 12, fontWeight: '700' },
  tabLabelActive:  { color: BRAND },
})

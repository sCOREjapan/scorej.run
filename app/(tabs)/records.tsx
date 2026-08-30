import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../../context/LanguageContext'
import { getEventLabel } from '../../lib/eventLabels'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Modal, KeyboardAvoidingView, Platform, Animated, Alert, Dimensions, Pressable,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
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
import { checkAdGate, recordUsage } from '../../lib/adGate'
import { localDateStr, todayLocalISO } from '../../lib/dateLocal'
import AdGateModal from '../../components/AdGateModal'
import QuickLogModal from '../../components/QuickLogModal'
import { useAuth } from '../../context/AuthContext'
import { trackFeatureUse } from '../../lib/analytics'
import ConfettiEffect from '../../components/ConfettiEffect'
import { pbCelebration } from '../../lib/haptics'
import PracticeShareCard, { PracticeShareData } from '../../components/PracticeShareCard'
import { calcLevelInfo } from '../../lib/gamification'
import TutorialSpot from '../../components/TutorialSpot'
import { STANDARD_HURDLE_HEIGHTS, isHurdleEvent } from '../../lib/hurdleHeights'
import { usePurchase } from '../../context/PurchaseContext'
import { getSessions, updateSessions } from '../../lib/sessionsStore'
import { getWeights, updateWeights, type WeightRecord } from '../../lib/weightStore'

const RECORDS_KEY       = 'trackmate_race_records'
const SESSIONS_KEY      = 'trackmate_sessions'
const CONDITION_MAP_KEY = 'trackmate_condition_map'
const SLEEP_KEY         = 'trackmate_sleep'
const SCREEN_W          = Dimensions.get('window').width

// ── 種目定義 ──────────────────────────────────────────────────────
const TRACK_EVENTS: AthleticsEvent[] = [
  '100m','200m','300m','400m','800m','1000m','1500m','3000m',
  '5000m','10000m','110mH','100mH','300mH','400mH','3000mSC',
  'half_marathon','marathon','競歩',
  '4×100mR','4×400mR',
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

// ── 記録追加モーダル：種目ブロック（1種目=1ブロック、本数分だけ記録欄が並ぶ）───
const REPS_PRESETS = [1, 2, 3, 4, 5, 6, 8, 10]
const MAX_REPS = 20

type TimeBlock = {
  key: string
  event: AthleticsEvent
  reps: string        // 表示・入力用の文字列（'1'〜'20'）
  mins: string[]
  secs: string[]
  meters: string[]
  cms: string[]
  wind: string
  windPos: boolean
  hurdleHeight: number | null
  isPB: boolean
  isSB: boolean
}

function newTimeBlock(): TimeBlock {
  return {
    key: `blk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    event: '100m', reps: '1',
    mins: [''], secs: [''], meters: [''], cms: [''],
    wind: '', windPos: true, hurdleHeight: null, isPB: false, isSB: false,
  }
}

// 本数変更時、各配列を新しい本数に合わせて伸縮する（既存の入力値は保持）
function resizeBlockReps(b: TimeBlock, nextReps: number): TimeBlock {
  const resize = (arr: string[]) => {
    const next = arr.slice(0, nextReps)
    while (next.length < nextReps) next.push('')
    return next
  }
  return {
    ...b, reps: String(nextReps),
    mins: resize(b.mins), secs: resize(b.secs), meters: resize(b.meters), cms: resize(b.cms),
  }
}


// ── 日付+時刻ソート ───────────────────────────────────────────────
// 同日に複数記録がある場合、race_time（任意入力）があればそれで並び替える。
// race_timeが無い記録は '' 扱いとなり、date_ascでは時刻ありの記録より前に並ぶ
// （どちらが先か判断できないため、安定ソートで既存の並び順を尊重する）。
function dateTimeKey(r: RaceRecord): string {
  return `${r.race_date}T${r.race_time ?? ''}`
}
function dateTimeAsc(a: RaceRecord, b: RaceRecord): number {
  return dateTimeKey(a).localeCompare(dateTimeKey(b))
}
function dateTimeDesc(a: RaceRecord, b: RaceRecord): number {
  return dateTimeKey(b).localeCompare(dateTimeKey(a))
}

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
function RecordCard({ record, onDelete, onEdit }: { record: RaceRecord; onDelete: () => void; onEdit: () => void }) {
  const router = useRouter()
  const { t } = useTranslation()
  const { language } = useLanguage()
  return (
    <View style={[styles.recordCard, record.is_pb && styles.recordCardPB]}>
      <View style={styles.recordLeft}>
        <View style={styles.eventBadgeWrap}>
          <Text style={styles.eventBadgeText}>{getEventLabel(record.event, language)}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
          {record.is_pb && <Badge label="PB" color={NEON.green} />}
          {record.is_sb && <Badge label="SB" color={NEON.blue} />}
          {record.is_official && <Badge label={t('records.recordCard.official')} color={BRAND} />}
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
        {record.hurdle_height_cm !== undefined && (
          <Text style={styles.windText}>H{record.hurdle_height_cm}cm</Text>
        )}
        {record.competition_name
          ? <Text style={styles.recordVenue} numberOfLines={1}>{record.competition_name}</Text>
          : record.venue
            ? <Text style={styles.recordVenue} numberOfLines={1}>{record.venue}</Text>
            : null}
      </View>

      <View style={styles.recordRight}>
        <Text style={styles.recordDate}>{record.race_date}{record.race_time ? `  ${record.race_time}` : ''}</Text>
        <Text style={styles.windText}>
          {(() => {
            const days = Math.floor((Date.now() - new Date(record.race_date + 'T00:00:00').getTime()) / 86400000)
            return days <= 0 ? t('records.recordCard.today') : t('records.recordCard.daysAgo', { n: days })
          })()}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TutorialSpot spotKey="records_share_btn">
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/share-card', params: { recordId: record.id } })}
            style={styles.shareBtn}
            activeOpacity={0.75}
          >
            <Ionicons name="share-social-outline" size={13} color="#fff" />
            <Text style={styles.shareBtnTxt}>{t('records.recordCard.share')}</Text>
          </TouchableOpacity>
          </TutorialSpot>
          <TouchableOpacity onPress={onEdit} style={{ padding: 4 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={t('records.recordCard.edit')}>
            <Ionicons name="pencil-outline" size={14} color={BRAND} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onDelete} style={{ padding: 4 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={t('records.recordCard.delete')}>
            <Ionicons name="trash-outline" size={14} color={TEXT.hint} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

// ── PBサマリーカード ───────────────────────────────────────────────
function PBSummary({ records }: { records: RaceRecord[] }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
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
        <Text style={styles.cardTitle}>{t('records.pbSummary.title')}</Text>
      </View>
      <View style={styles.pbGrid}>
        {pbs.map(r => (
          <View key={r.id} style={styles.pbItem}>
            <Text style={styles.pbEvent}>{getEventLabel(r.event, language)}</Text>
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
function buildSessionTypeLabels(t: (key: string) => string): Record<string,string> {
  return {
    interval: t('records.sessionType.interval'), tempo: t('records.sessionType.tempo'),
    easy: t('records.sessionType.easy'), long: t('records.sessionType.long'),
    sprint: t('records.sessionType.sprint'), drill: t('records.sessionType.drill'),
    strength: t('records.sessionType.strength'), race: t('records.sessionType.race'), rest: t('records.sessionType.rest'),
  }
}
const TYPE_EMOJIS: Record<string,string> = {
  interval:'⚡', tempo:'🏃', easy:'🌿', long:'🛣️',
  sprint:'💨', drill:'🔧', strength:'🏋️', race:'🏆', rest:'😴',
}
const FATIGUE_EMOJI = (v: number) => v >= 9 ? '🥵' : v >= 7 ? '😰' : v >= 5 ? '😐' : v >= 3 ? '🙂' : '😊'

// ヒートマップ: 全練習記録を横スクロールで表示（週ごとの列、今日が右端）
function Heatmap({ sessions }: { sessions: TrainingSession[] }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const scrollRef = useRef<any>(null)
  const today = new Date()
  const todayStr = localDateStr(today)
  const countByDay: Record<string,number> = {}
  const typeByDay: Record<string,string> = {}
  sessions.forEach(s => {
    countByDay[s.session_date] = (countByDay[s.session_date] ?? 0) + 1
    if (!typeByDay[s.session_date]) typeByDay[s.session_date] = s.session_type
  })

  const CELL = 14
  const GAP  = 3
  const DOW_LABELS = t('records.dow', { returnObjects: true }) as string[]

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
    days.push(localDateStr(d))
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
                      {language === 'ja' ? `${new Date(firstReal!).getMonth()+1}月` : new Date(firstReal!).toLocaleDateString('en-US', { month: 'short' })}
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
          { color: '#34C759', label: t('records.heatmap.legendJog') },
          { color: '#E53935', label: t('records.heatmap.legendSprint') },
          { color: '#FF9500', label: t('records.heatmap.legendTempo') },
          { color: '#5AC8FA', label: t('records.heatmap.legendLong') },
          { color: '#FFD700', label: t('records.heatmap.legendRace') },
        ].map(l => (
          <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: l.color }} />
            <Text style={{ color: TEXT.hint, fontSize: 9 }}>{l.label}</Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: BRAND }} />
          <Text style={{ color: TEXT.hint, fontSize: 9 }}>{t('records.heatmap.legendToday')}</Text>
        </View>
      </View>
    </View>
  )
}

// ── セッション詳細シート ────────────────────────────────────────────
function SessionDetailSheet({ session, onClose, onDelete, onEdit }: {
  session: TrainingSession
  onClose: () => void
  onDelete: (id: string) => void
  onEdit: (session: TrainingSession) => void
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const TYPE_LABELS = buildSessionTypeLabels(t)
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

  const CONDITION_LABELS: Record<number, string> = {
    2: t('records.sessionDetail.condition2'), 3: t('records.sessionDetail.condition3'), 4: t('records.sessionDetail.condition4'),
    5: t('records.sessionDetail.condition5'), 6: t('records.sessionDetail.condition6'), 7: t('records.sessionDetail.condition7'),
    8: t('records.sessionDetail.condition8'), 9: t('records.sessionDetail.condition9'), 10: t('records.sessionDetail.condition10'),
  }

  const stats: { icon: string; label: string; value: string; color?: string }[] = [
    ...(session.event     ? [{ icon:'🏟️', label: t('records.sessionDetail.statEvent'),   value: getEventLabel(session.event, language) }] : []),
    ...(session.time_ms   ? [{ icon:'⏱',  label: t('records.sessionDetail.statTime'), value: fmtMs(session.time_ms) }] : []),
    ...(session.distance_m? [{ icon:'📏', label: t('records.sessionDetail.statDistance'),   value: fmtDist(session.distance_m) }] : []),
    ...(session.reps      ? [{ icon:'🔁', label: t('records.sessionDetail.statReps'),   value: `${session.reps}${t('records.sessionDetail.statRepsUnit')}` }] : []),
    { icon: FATIGUE_EMOJI(fat),  label: t('records.sessionDetail.statFatigue'),   value: `${fat}/10` },
    ...(cond != null      ? [{ icon: cond >= 7 ? '😊' : cond >= 5 ? '😐' : '😕', label: t('records.sessionDetail.statCondition'), value: `${cond}/10  ${CONDITION_LABELS[cond] ?? ''}` }] : []),
  ]

  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
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
              {language === 'ja'
                ? `${session.session_date}  ${(t('records.dow', { returnObjects: true }) as string[])[new Date(session.session_date).getDay()]}曜日`
                : new Date(session.session_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', weekday: 'long' })}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityLabel={t('records.sessionDetail.close')}>
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
            <Text style={{ color: TEXT.hint, fontSize: 11, fontWeight: '700', marginBottom: 8 }}>📝 {t('records.sessionDetail.memo')}</Text>
            <Text style={{ color: TEXT.secondary, fontSize: 13, lineHeight: 22 }}>{session.notes}</Text>
          </View>
        ) : null}
        {/* 編集・削除ボタン */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            onPress={() => onEdit(session)}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              paddingVertical: 13, borderRadius: 12,
              backgroundColor: '#166534' }}
            activeOpacity={0.85}
          >
            <Ionicons name="create-outline" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>{t('records.sessionDetail.editButton')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { onDelete(session.id); onClose() }}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              paddingVertical: 13, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1,
              borderColor: 'rgba(255,59,48,0.35)', backgroundColor: 'rgba(255,59,48,0.08)' }}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={16} color="#FF3B30" />
            <Text style={{ color: '#FF3B30', fontWeight: '700', fontSize: 14 }}>{t('records.sessionDetail.deleteButton')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

// ── 練習カレンダー ─────────────────────────────────────────────────
// 疲労レベル → 背景色（intensity tier）
function getIntensityBg(fatigue: number | null | undefined): string {
  const f = fatigue ?? 0
  if (f === 0)  return 'transparent'
  if (f <= 2)   return '#DCFCE7'
  if (f <= 4)   return '#BBF7D0'
  if (f <= 6)   return '#FEF9C3'
  if (f <= 8)   return '#FED7AA'
  return '#FECACA'
}

function GlowCalendar({ sessions, selectedDate, onSelectDate }: {
  sessions: TrainingSession[]
  selectedDate?: string | null
  onSelectDate?: (d: string) => void
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const now = new Date()
  const [viewYear, setViewYear]   = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())

  const DOW_LABELS = t('records.dow', { returnObjects: true }) as string[]

  // date → max fatigue map
  const fatigueMap: Record<string, number> = {}
  sessions.forEach(s => {
    const f = s.fatigue_level ?? 0
    fatigueMap[s.session_date] = Math.max(fatigueMap[s.session_date] ?? 0, f)
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
  const today       = localDateStr(now)
  const canNext     = viewYear < now.getFullYear() || (viewYear === now.getFullYear() && viewMonth < now.getMonth())

  // 週ごとの行を構築
  const totalSlots = firstDow + daysInMonth
  const weekCount  = Math.ceil(totalSlots / 7)
  const weeks: (number | null)[][] = Array.from({ length: weekCount }, (_, wi) =>
    Array.from({ length: 7 }, (_, di) => {
      const slot = wi * 7 + di
      const day  = slot - firstDow + 1
      return (day >= 1 && day <= daysInMonth) ? day : null
    })
  )

  return (
    <View>
      {/* 月ナビ */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <TouchableOpacity onPress={prevMonth} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('records.calendar.prevMonth')}>
          <Ionicons name="chevron-back" size={18} color={TEXT.secondary} />
        </TouchableOpacity>
        <Text style={{ color: TEXT.primary, fontSize: 14, fontWeight: '800' }}>
          {language === 'ja' ? `${viewYear}年 ${viewMonth + 1}月` : new Date(viewYear, viewMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </Text>
        <TouchableOpacity onPress={nextMonth} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ opacity: canNext ? 1 : 0.3 }} accessibilityLabel={t('records.calendar.nextMonth')}>
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

      {/* 日付グリッド（週ごとの行） */}
      {weeks.map((week, wi) => (
        <View key={wi} style={{ flexDirection: 'row' }}>
          {week.map((day, di) => {
            if (day === null) {
              return <View key={`e${di}`} style={{ flex: 1, aspectRatio: 1 }} />
            }
            const mm      = String(viewMonth + 1).padStart(2, '0')
            const dd      = String(day).padStart(2, '0')
            const dateStr = `${viewYear}-${mm}-${dd}`
            const isToday = dateStr === today
            const isSelected = dateStr === selectedDate
            const fat     = fatigueMap[dateStr]
            const bgColor = isToday ? '#3B82F6' : getIntensityBg(fat)
            const textColor = isToday ? '#fff'
              : di === 0 ? '#EF4444'
              : di === 6 ? '#5AC8FA'
              : TEXT.primary

            return (
              <TouchableOpacity
                key={day}
                activeOpacity={0.7}
                onPress={() => { Sounds.tap(); onSelectDate?.(dateStr) }}
                style={{
                  flex: 1, aspectRatio: 1,
                  margin: 1.5,
                  borderRadius: 6,
                  backgroundColor: bgColor,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: isSelected ? 2 : 0,
                  borderColor: isSelected ? '#166534' : 'transparent',
                }}>
                <Text style={{
                  fontSize: 12,
                  fontWeight: isToday || isSelected ? '900' : fat ? '700' : '400',
                  color: textColor,
                }}>{day}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      ))}

      {/* 凡例 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' }}>
        {[
          { label: t('records.calendar.legendLow'), color: '#DCFCE7' },
          { label: t('records.calendar.legendLight'), color: '#BBF7D0' },
          { label: t('records.calendar.legendMedium'), color: '#FEF9C3' },
          { label: t('records.calendar.legendHard'), color: '#FED7AA' },
          { label: t('records.calendar.legendVeryHard'), color: '#FECACA' },
        ].map(item => (
          <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: item.color, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' }} />
            <Text style={{ color: TEXT.hint, fontSize: 9 }}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

// セッション1件のタイムラインカード（タップで詳細表示）
function SessionTimelineCard({ session, onTap, onShare }: { session: TrainingSession; onTap: () => void; onShare: () => void }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const TYPE_LABELS = buildSessionTypeLabels(t)
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
          {session.event ? <Text style={{ color: TEXT.hint, fontSize: 12 }}>{getEventLabel(session.event, language)}</Text> : null}
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
              <Text style={{ color: TEXT.primary, fontSize: 12, fontWeight: '700' }}>🔁 {session.reps}{t('records.sessionDetail.statRepsUnit')}</Text>
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
            <Text style={{ color: TEXT.hint, fontSize: 10 }}>{t('records.timeline.viewDetail')}</Text>
            <Ionicons name="chevron-forward" size={10} color={TEXT.hint} />
          </View>
          <TouchableOpacity
            onPress={e => { e.stopPropagation?.(); onShare() }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(229,57,53,0.08)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}
          >
            <Ionicons name="share-outline" size={11} color={BRAND} />
            <Text style={{ color: BRAND, fontSize: 10, fontWeight: '700' }}>{t('records.timeline.share')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  )
}

// 日付グループヘッダー
function DateHeader({ dateStr }: { dateStr: string }) {
  const { t } = useTranslation()
  const now = new Date()
  const d   = new Date(dateStr)
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  const label = diffDays === 0 ? t('records.dateHeader.today') : diffDays === 1 ? t('records.dateHeader.yesterday') : diffDays < 7 ? t('records.dateHeader.daysAgo', { n: diffDays }) : dateStr.slice(5).replace('-', '/')
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 2 }}>
      <Text style={{ color: diffDays === 0 ? BRAND : TEXT.secondary, fontSize: 12, fontWeight: '800' }}>{label}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
      <Text style={{ color: TEXT.hint, fontSize: 10 }}>
        {(t('records.dow', { returnObjects: true }) as string[])[d.getDay()]}
      </Text>
    </View>
  )
}

function PracticeTab({ sessions, loading, weightRecords, onAddWeight, onDeleteWeight, onDeleteSession, onReload }: {
  sessions: TrainingSession[]
  loading: boolean
  weightRecords: WeightRecord[]
  onAddWeight: (kg: number, date: string) => void
  onDeleteWeight: (id: string) => void
  onDeleteSession: (id: string) => void
  onReload: () => void
}) {
  const router = useRouter()
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [selectedSession, setSelectedSession] = useState<TrainingSession | null>(null)
  const [shareSession,    setShareSession]    = useState<PracticeShareData | null>(null)
  const [selectedDate,    setSelectedDate]    = useState<string | null>(null)
  const [freeEditSession, setFreeEditSession] = useState<TrainingSession | null>(null)

  // 編集ルーティング: 自由入力(ql_)は自由入力モーダル、手動入力(manual_)はフォーム画面
  const handleEdit = (s: TrainingSession) => {
    setSelectedSession(null)
    if (s.id.startsWith('ql_')) {
      setFreeEditSession(s)
    } else {
      router.push(`/manual-log?id=${s.id}` as any)
    }
  }
  if (loading) return <View style={{ gap: 10 }}>{[1,2,3].map(i => <SkeletonRect key={i} h={80} />)}</View>

  const totalKm     = sessions.reduce((a,s) => a+(s.distance_m??0), 0) / 1000
  const thisWeekSessions = sessions.filter(s => {
    const d = new Date(s.session_date)
    return (Date.now() - d.getTime()) <= 7 * 86400000
  })

  // 連続練習日数
  let streak = 0
  const today = todayLocalISO()
  const dateSet = new Set(sessions.map(s => s.session_date))
  for (let i = 0; i < 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const dStr = localDateStr(d)
    if (dateSet.has(dStr)) streak++
    else if (i > 0) break  // streak ends (today OK to be 0)
  }

  // セッション→シェアデータ変換
  const TYPE_LABEL_MAP = buildSessionTypeLabels(t)
  const fmtMsShare = (ms: number) => {
    const s = ms / 1000
    if (s < 60) return `${s.toFixed(2)}"`
    return `${Math.floor(s/60)}'${(s%60).toFixed(2).padStart(5,'0')}"`
  }
  const buildShare = (sess: TrainingSession): PracticeShareData => {
    const dt = new Date(sess.session_date + 'T00:00:00')
    const weekdays = ['日','月','火','水','木','金','土']
    const levelInfo = calcLevelInfo(sessions.length, language)
    const dateLabel = language === 'ja'
      ? `${dt.getFullYear()}年${dt.getMonth()+1}月${dt.getDate()}日（${weekdays[dt.getDay()]}）`
      : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
    return {
      date:      dateLabel,
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
          <Text style={[styles.inputShortcutText, { color: '#5AC8FA' }]}>{t('records.practiceTab.manualInput')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.inputShortcut, { borderColor: 'rgba(229,57,53,0.4)', backgroundColor: 'rgba(229,57,53,0.07)' }]}
          activeOpacity={0.8}
          onPress={() => { unlockAudio(); Sounds.whoosh(); router.push('/practice-input' as any) }}
        >
          <Text style={{ fontSize: 18 }}>✏️</Text>
          <Text style={[styles.inputShortcutText, { color: BRAND }]}>{t('records.practiceTab.freeInput')}</Text>
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
              <Text style={{ color: TEXT.secondary, fontSize: 14, marginBottom: 6 }}>{t('records.practiceTab.streakUnit')}</Text>
              {streak >= 7  && <Text style={{ fontSize: 20, marginBottom: 4 }}>🔥</Text>}
              {streak >= 30 && <Text style={{ fontSize: 20, marginBottom: 4 }}>💎</Text>}
            </View>
          </View>
          <View style={{ gap: 10 }}>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={{ color: TEXT.primary, fontSize: 18, fontWeight: '900' }}>{sessions.length}</Text>
              <Text style={{ color: TEXT.hint, fontSize: 10 }}>{t('records.practiceTab.totalSessions')}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={{ color: TEXT.primary, fontSize: 18, fontWeight: '900' }}>{totalKm.toFixed(0)}km</Text>
              <Text style={{ color: TEXT.hint, fontSize: 10 }}>{t('records.practiceTab.totalDistance')}</Text>
            </View>
          </View>
        </View>
        <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)', flexDirection: 'row', gap: 12 }}>
          <Text style={{ color: TEXT.hint, fontSize: 11 }}>{t('records.practiceTab.thisWeek')}</Text>
          <Text style={{ color: TEXT.primary, fontSize: 11, fontWeight: '700' }}>{t('records.practiceTab.timesUnit', { n: thisWeekSessions.length })}</Text>
          <Text style={{ color: TEXT.hint, fontSize: 11, marginLeft: 8 }}>{t('records.practiceTab.thisMonth')}</Text>
          <Text style={{ color: TEXT.primary, fontSize: 11, fontWeight: '700' }}>
            {t('records.practiceTab.timesUnit', { n: sessions.filter(s => new Date(s.session_date).getMonth() === new Date().getMonth()).length })}
          </Text>
        </View>
      </View>
      </AnimatedSection>

      {/* ── グローカレンダー ── */}
      <AnimatedSection delay={60} type="fade-up">
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={{ fontSize: 14 }}>📅</Text>
          <Text style={styles.cardTitle}>{t('records.practiceTab.calendarTitle')}</Text>
          {selectedDate && (
            <TouchableOpacity onPress={() => setSelectedDate(null)} style={{ marginLeft: 'auto' as any }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: TEXT.hint, fontSize: 12 }}>{t('records.practiceTab.clearSelection')}</Text>
            </TouchableOpacity>
          )}
        </View>
        <GlowCalendar
          sessions={sessions}
          selectedDate={selectedDate}
          onSelectDate={d => setSelectedDate(prev => prev === d ? null : d)}
        />

        {/* 選択した日の練習内容 */}
        {selectedDate && (
          <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' }}>
            <Text style={{ color: TEXT.primary, fontSize: 13, fontWeight: '800', marginBottom: 6 }}>
              {(() => {
                const dt = new Date(selectedDate + 'T00:00:00')
                const dateLabel = language === 'ja'
                  ? `${dt.getMonth()+1}月${dt.getDate()}日（${['日','月','火','水','木','金','土'][dt.getDay()]}）`
                  : dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', weekday: 'short' })
                return t('records.practiceTab.selectedDayTitle', { date: dateLabel })
              })()}
            </Text>
            {(byDate[selectedDate] ?? []).length === 0 ? (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                <Text style={{ color: TEXT.hint, fontSize: 12 }}>{t('records.practiceTab.noSessionsThisDay')}</Text>
              </View>
            ) : (
              byDate[selectedDate].map(s => (
                <SessionTimelineCard
                  key={s.id}
                  session={s}
                  onTap={() => setSelectedSession(s)}
                  onShare={() => setShareSession(buildShare(s))}
                />
              ))
            )}
          </View>
        )}
      </View>
      </AnimatedSection>

      {/* ── 練習ノート ── */}
      <AnimatedSection delay={120} type="fade-up">
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={{ fontSize: 14 }}>📒</Text>
          <Text style={styles.cardTitle}>{t('records.practiceTab.notebookTitle')}</Text>
          <Text style={{ color: TEXT.hint, fontSize: 12 }}>{t('records.practiceTab.countUnit', { n: sessions.length })}</Text>
        </View>
        {loading ? (
          <View style={{ gap: 10 }}>{[1,2,3].map(i => <SkeletonRect key={i} h={80} />)}</View>
        ) : sessions.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 36 }}>📝</Text>
            <Text style={styles.emptyText}>{t('records.practiceTab.emptyTitle')}</Text>
            <Text style={[styles.emptyText, { fontSize: 12, marginTop: 4 }]}>{t('records.practiceTab.emptyHint')}</Text>
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
                {t('records.practiceTab.showingRecent', { n: 60, total: sessions.length })}
              </Text>
            )}
          </ScrollView>
        )}
      </View>
      </AnimatedSection>

    </View>

  {/* 体重 */}
  <WeightSection records={weightRecords} onAdd={onAddWeight} onDelete={onDeleteWeight} />

  <Modal visible={!!selectedSession} transparent animationType="slide" onRequestClose={() => setSelectedSession(null)}>
    {selectedSession ? (
      <SessionDetailSheet
        session={selectedSession}
        onClose={() => setSelectedSession(null)}
        onDelete={onDeleteSession}
        onEdit={handleEdit}
      />
    ) : <View />}
  </Modal>

  {/* 自由入力の編集（ql_ レコード） */}
  <QuickLogModal
    visible={!!freeEditSession}
    editSession={freeEditSession}
    onClose={() => setFreeEditSession(null)}
    onSaved={() => { setFreeEditSession(null); onReload() }}
  />

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
  const { t } = useTranslation()
  const today = todayLocalISO()
  const [input, setInput] = useState('')
  const [selectedDate, setSelectedDate] = useState(today)

  // ±7日の日付リスト
  const dateRange = Array.from({ length: 15 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 7 + i)
    return localDateStr(d)
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
    if (diff === 0) return t('records.weight.today')
    if (diff === -1) return t('records.weight.yesterday')
    if (diff === 1) return t('records.weight.tomorrow')
    const dow = (t('records.dow', { returnObjects: true }) as string[])[d.getDay()]
    return `${d.getMonth()+1}/${d.getDate()}(${dow})`
  }

  return (
    <AnimatedSection delay={160} type="fade-up">
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={{ fontSize: 15 }}>⚖️</Text>
        <Text style={styles.cardTitle}>{t('records.weight.title')}</Text>
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
          placeholder={existingForDate ? t('records.weight.placeholderExisting', { kg: existingForDate.weight_kg }) : t('records.weight.placeholderNew', { date: formatDateLabel(selectedDate) })}
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
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{t('records.weight.save')}</Text>
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
          <Text style={styles.emptyText}>{t('records.weight.empty')}</Text>
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
  const { t } = useTranslation()
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
          {t('records.trend.avg')}: <Text style={{ color: TEXT.primary, fontWeight: '700' }}>
            {format(vals.reduce((a, v) => a + v, 0) / vals.length)}
          </Text>
        </Text>
        <Text style={{ color: TEXT.hint, fontSize: 11 }}>
          {t('records.trend.max')}: <Text style={{ color, fontWeight: '700' }}>{format(rawMax)}</Text>
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
  const { t } = useTranslation()
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
          <Text style={styles.cardTitle}>{t('records.health.conditionTitle')}</Text>
        </View>
        {condData.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t('records.health.conditionEmpty')}</Text>
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
                  <Text style={{ color: TEXT.secondary, fontSize: 11 }}>{t('records.health.recentCondition')}</Text>
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
          <Text style={styles.cardTitle}>{t('records.health.sleepTitle')}</Text>
        </View>
        {sleepData.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t('records.health.sleepEmpty')}</Text>
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
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { isGuest } = useAuth()
  const { isNoad } = usePurchase()
  const [activeTab, setActiveTab] = useState<'practice'|'records'|'health'>('practice')
  const [csvGateVisible,     setCsvGateVisible]     = useState(false)
  const [csvGateRemaining,   setCsvGateRemaining]   = useState(0)
  const [csvGateHardLimited, setCsvGateHardLimited] = useState(false)
  const [csvGateLimitType,   setCsvGateLimitType]   = useState<'none'|'daily'|'monthly'|'total'|'window'>('none')
  const [records, setRecords] = useState<RaceRecord[]>([])
  const [sessions, setSessions] = useState<TrainingSession[]>([])
  const [conditionMap, setConditionMap] = useState<Record<string,number>>({})
  const [sleepRecords, setSleepRecords] = useState<SleepRecord[]>([])
  const [weightRecords, setWeightRecords] = useState<WeightRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [toolsMenuVisible, setToolsMenuVisible] = useState(false)
  const [filterEvent, setFilterEvent] = useState<AthleticsEvent | '全種目'>('全種目')
  const [chartEvent, setChartEvent] = useState<AthleticsEvent | null>(null)
  const [sortOrder, setSortOrder] = useState<'date_desc' | 'date_asc' | 'result'>('date_desc')
  const [editId, setEditId] = useState<string | null>(null)

  // フォーム状態（日付・大会名・会場・メモは1回の保存セッションで共通）
  const [fDate, setFDate]     = useState(todayLocalISO())
  const [fTime, setFTime]     = useState('')   // HH:MM（任意。同日複数記録の並び替え用）
  const [fVenue, setFVenue]   = useState('')
  const [fComp, setFComp]     = useState('')
  const [fNotes, setFNotes]   = useState('')
  const [fOfficial, setFOfficial] = useState(false)   // 公認記録かどうか
  const [recordFilter, setRecordFilter] = useState<'all' | 'official' | 'manual'>('all')
  const [showConfetti, setShowConfetti] = useState(false)
  const [saving, setSaving]   = useState(false)
  // 種目ブロック（1保存セッションで複数種目・各種目で複数本を入力できる）
  const [blocks, setBlocks]   = useState<TimeBlock[]>([newTimeBlock()])

  // ロード（フォーカス時にも再ロード：manual-log等から戻った時に反映）
  const loadData = useCallback(() => {
    Promise.all([
      AsyncStorage.getItem(RECORDS_KEY),
      getSessions(),
      AsyncStorage.getItem(CONDITION_MAP_KEY),
      AsyncStorage.getItem(SLEEP_KEY),
      getWeights(),
    ]).then(([recRaw, sess, condRaw, sleepRaw, weights]) => {
      if (recRaw)    { try { setRecords(JSON.parse(recRaw)) }         catch {} }
      setSessions(sess)
      if (condRaw)   { try { setConditionMap(JSON.parse(condRaw)) }   catch {} }
      if (sleepRaw)  { try { setSleepRecords(JSON.parse(sleepRaw)) }  catch {} }
      setWeightRecords(weights)
      setLoading(false)
    }).catch(() => setLoading(false))  // エラー時もローディングを解除
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useFocusEffect(useCallback(() => { loadData() }, [loadData]))

  const handleAddWeight = useCallback(async (kg: number, date: string) => {
    const newRec: WeightRecord = { id: `w_${Date.now()}`, date, weight_kg: kg }
    const next = await updateWeights(current =>
      [...current.filter(r => r.date !== date), newRec].sort((a, b) => a.date.localeCompare(b.date))
    )
    setWeightRecords(next)
    Toast.show({ type: 'success', text1: t('records.toast.weightSaved', { kg }), visibilityTime: 1500 })
  }, [t])

  const handleDeleteWeight = useCallback(async (id: string) => {
    const next = await updateWeights(current => current.filter(r => r.id !== id))
    setWeightRecords(next)
    Toast.show({ type: 'success', text1: t('records.toast.deleted'), visibilityTime: 1200 })
  }, [t])

  const handleDeleteSession = useCallback(async (id: string) => {
    // 直列化キュー経由で削除する: 他画面がちょうど保存中でも、その完了を待ってから
    // 最新の状態を読み直して削除するため、削除が古いスナップショットで上書きされない
    const next = await updateSessions(current => current.filter(s => s.id !== id))
    setSessions(next)
    Toast.show({ type: 'success', text1: t('records.toast.sessionDeleted'), visibilityTime: 1500 })
  }, [t])

  function resetForm() {
    setEditId(null)
    setFDate(todayLocalISO())
    setFTime('')
    setFVenue(''); setFComp(''); setFNotes('')
    setFOfficial(false)
    setBlocks([newTimeBlock()])
  }

  function openEdit(r: RaceRecord) {
    setEditId(r.id)
    setFDate(r.race_date)
    setFTime(r.race_time ?? '')
    setFVenue(r.venue ?? '')
    setFComp(r.competition_name ?? '')
    setFNotes(r.notes ?? '')
    setFOfficial(r.is_official ?? false)
    const b = newTimeBlock()
    b.event = r.event
    if (isField(r.event)) {
      const totalCm = r.result_cm ?? 0
      b.meters = [String(Math.floor(totalCm / 100))]
      b.cms    = [String(totalCm % 100)]
    } else {
      const totalSec = (r.result_ms ?? 0) / 1000
      const m = Math.floor(totalSec / 60)
      b.mins = [m > 0 ? String(m) : '']
      b.secs = [(totalSec % 60).toFixed(2)]
    }
    b.wind = r.wind_ms !== undefined ? String(Math.abs(r.wind_ms)) : ''
    b.windPos = (r.wind_ms ?? 1) >= 0
    b.isPB = r.is_pb ?? false
    b.isSB = r.is_sb ?? false
    b.hurdleHeight = r.hurdle_height_cm ?? null
    setBlocks([b])
    setModalVisible(true)
  }

  // 種目ブロックを更新するヘルパー
  function updateBlock(key: string, patch: Partial<TimeBlock>) {
    setBlocks(prev => prev.map(b => b.key === key ? { ...b, ...patch } : b))
  }
  function updateBlockReps(key: string, nextReps: number) {
    const clamped = Math.max(1, Math.min(MAX_REPS, nextReps))
    setBlocks(prev => prev.map(b => b.key === key ? resizeBlockReps(b, clamped) : b))
  }
  function addBlock() {
    setBlocks(prev => [...prev, newTimeBlock()])
  }
  function removeBlock(key: string) {
    setBlocks(prev => prev.length <= 1 ? prev : prev.filter(b => b.key !== key))
  }

  const handleSave = useCallback(async () => {
    // 全ブロック・全本数分のレコードを組み立てながらバリデーションする
    type Built = { event: AthleticsEvent; result_ms?: number; result_cm?: number; display: string
      wind_ms?: number; hurdle_height_cm?: number; is_pb: boolean; is_sb: boolean }
    const built: Built[] = []
    for (const b of blocks) {
      const field = isField(b.event)
      const repCount = field ? b.meters.length : b.mins.length
      for (let i = 0; i < repCount; i++) {
        const result_ms = field ? undefined : parseTrackInput(b.mins[i], b.secs[i])
        const result_cm = field ? parseFieldInput(b.meters[i], b.cms[i]) : undefined
        const repSuffix = repCount > 1 ? ` ${t('records.modal.repN', { n: i + 1 })}` : ''
        if (!field && (!result_ms || result_ms <= 0)) {
          Toast.show({ type: 'error', text1: t('records.toast.enterTime', { event: getEventLabel(b.event, language), rep: repSuffix }) })
          return
        }
        if (field && (!result_cm || result_cm <= 0)) {
          Toast.show({ type: 'error', text1: t('records.toast.enterResult', { event: getEventLabel(b.event, language), rep: repSuffix }) })
          return
        }
        built.push({
          event: b.event, result_ms, result_cm,
          display: field ? cmToDisplay(result_cm!) : msToDisplay(result_ms!, b.event),
          wind_ms: b.wind !== '' ? parseFloat(b.wind) * (b.windPos ? 1 : -1) : undefined,
          hurdle_height_cm: isHurdleEvent(b.event) ? b.hurdleHeight ?? undefined : undefined,
          is_pb: repCount === 1 ? b.isPB : false,
          is_sb: repCount === 1 ? b.isSB : false,
        })
      }
    }
    if (built.length === 0) {
      Toast.show({ type: 'error', text1: t('records.toast.enterRecord') }); return
    }

    setSaving(true)
    try {
      const userId = (await AsyncStorage.getItem('userId').catch(() => null)) ?? 'local'
      const now = new Date().toISOString()
      const newRecs: RaceRecord[] = built.map((x, i) => ({
        id: editId && i === 0 ? editId : Crypto.randomUUID(),
        user_id: userId,
        event: x.event,
        result_display: x.display,
        result_ms: x.result_ms,
        result_cm: x.result_cm,
        race_date: fDate,
        race_time: fTime || undefined,
        venue: fVenue || undefined,
        competition_name: fComp || undefined,
        wind_ms: x.wind_ms,
        hurdle_height_cm: x.hurdle_height_cm,
        is_pb: x.is_pb,
        is_sb: x.is_sb,
        is_official: fOfficial,
        notes: fNotes || undefined,
        created_at: editId ? (records.find(r => r.id === editId)?.created_at ?? now) : now,
      }))
      const updated = editId
        ? records.map(r => r.id === editId ? newRecs[0] : r).sort(dateTimeDesc)
        : [...newRecs, ...records].sort(dateTimeDesc)
      await AsyncStorage.setItem(RECORDS_KEY, JSON.stringify(updated))
      setRecords(updated)
      const anyPB = newRecs.some(r => r.is_pb)
      if (anyPB && !editId) { Sounds.pb(); pbCelebration(); setShowConfetti(true); setTimeout(() => setShowConfetti(false), 3000) } else { Sounds.save() }
      const summary = newRecs.length === 1
        ? `${getEventLabel(newRecs[0].event, language)}  ${newRecs[0].result_display}`
        : t('records.toast.recordsCount', { n: newRecs.length })
      Toast.show({ type: 'success', text1: `✅ ${summary}${anyPB && !editId ? t('records.toast.pbCelebration') : ''}` })
      resetForm(); setModalVisible(false)
    } catch {
      Sounds.error()
      Toast.show({ type: 'error', text1: t('records.toast.saveFailed') })
    } finally { setSaving(false) }
  }, [blocks, fDate, fTime, fVenue, fComp, fNotes, fOfficial, editId, records, t, language])

  const handleDelete = useCallback(async (id: string) => {
    Sounds.delete()
    const updated = records.filter(r => r.id !== id)
    setRecords(updated)
    await AsyncStorage.setItem(RECORDS_KEY, JSON.stringify(updated)).catch(() => {})
  }, [records])

  // 記録のある種目リスト
  const usedEvents = Array.from(new Set(records.map(r => r.event)))

  // フィルター＋ソート適用
  const filtered = (() => {
    let base = filterEvent === '全種目' ? records : records.filter(r => r.event === filterEvent)
    if (recordFilter === 'official') base = base.filter(r => r.is_official)
    else if (recordFilter === 'manual') base = base.filter(r => !r.is_official)
    if (sortOrder === 'date_asc') return [...base].sort(dateTimeAsc)
    if (sortOrder === 'result') {
      return [...base].sort((a, b) => {
        if (a.result_ms !== undefined && b.result_ms !== undefined) return a.result_ms - b.result_ms
        if (a.result_cm !== undefined && b.result_cm !== undefined) return b.result_cm - a.result_cm
        return 0
      })
    }
    return [...base].sort(dateTimeDesc) // date_desc（デフォルト）
  })()

  // グラフデータ（フィルター種目 or 最初のトラック/フィールド種目）
  const targetEvent = filterEvent !== '全種目'
    ? filterEvent
    : (chartEvent ?? usedEvents.find(e => !isField(e)) ?? usedEvents[0] ?? null)
  const isFieldChart = targetEvent ? isField(targetEvent) : false
  const chartData: ChartDataPoint[] = targetEvent
    ? records
        .filter(r => r.event === targetEvent && (isFieldChart ? r.result_cm : r.result_ms))
        .slice(0, 8).reverse()
        .map(r => ({ date: r.race_date, value: isFieldChart ? (r.result_cm! / 100) : (r.result_ms! / 1000) }))
    : []

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
      <SafeAreaView style={styles.safe}>

        {/* ── ヘッダー ── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('records.header.title')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={async () => {
                Sounds.whoosh()
                if (isGuest) { setCsvGateRemaining(0); setCsvGateHardLimited(false); setCsvGateVisible(true); return }
                const gate = await checkAdGate('csv')
                if (!gate.allowed) { setCsvGateRemaining(gate.remaining); setCsvGateHardLimited(gate.hardLimited); setCsvGateLimitType(gate.limitType); setCsvGateVisible(true); return }
                await recordUsage('csv')
                trackFeatureUse('csv')
                Alert.alert(t('records.header.exportAlertTitle'), t('records.header.exportAlertMessage'), [
                  { text: 'CSV',  onPress: () => exportAllDataCSV().catch(() => Toast.show({ type: 'error', text1: t('records.header.exportFailed') })) },
                  { text: 'JSON', onPress: () => exportAllDataJSON().catch(() => Toast.show({ type: 'error', text1: t('records.header.exportFailed') })) },
                  { text: t('common.cancel'), style: 'cancel' },
                ])
              }}
              activeOpacity={0.8}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              accessibilityLabel={t('records.header.export')}
            >
              <Ionicons name="download-outline" size={18} color={TEXT.secondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => { Sounds.whoosh(); router.push('/video-analysis') }} activeOpacity={0.8} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }} accessibilityLabel={t('records.header.videoAnalysis')}>
              <Ionicons name="film-outline" size={18} color={TEXT.secondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => { Sounds.whoosh(); router.push('/timer') }} activeOpacity={0.8} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }} accessibilityLabel={t('records.header.timer')}>
              <Ionicons name="timer-outline" size={18} color={TEXT.secondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => { unlockAudio(); Sounds.whoosh(); setToolsMenuVisible(true) }} activeOpacity={0.8} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }} accessibilityLabel={t('records.header.tools')}>
              <Ionicons name="construct-outline" size={18} color={TEXT.secondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.addBtn} onPress={() => { unlockAudio(); Sounds.whoosh(); setModalVisible(true) }} activeOpacity={0.8} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }} accessibilityLabel={t('records.header.add')}>
              <Ionicons name="add" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── ツールメニュー（スターター・混成競技・トレーニングタイマー） ── */}
        <Modal visible={toolsMenuVisible} animationType="fade" transparent onRequestClose={() => setToolsMenuVisible(false)}>
          <Pressable style={toolsMenu.overlay} onPress={() => setToolsMenuVisible(false)}>
            <Pressable style={toolsMenu.card} onPress={() => {}}>
              <Text style={toolsMenu.title}>{t('records.toolsMenu.title')}</Text>
              {([
                { icon: 'flag-outline' as const, label: t('records.toolsMenu.starterLabel'), sub: t('records.toolsMenu.starterSub'), route: '/starter' },
                { icon: 'calculator-outline' as const, label: t('records.toolsMenu.combinedLabel'), sub: t('records.toolsMenu.combinedSub'), route: '/combined-events' },
                { icon: 'stopwatch-outline' as const, label: t('records.toolsMenu.timerLabel'), sub: t('records.toolsMenu.timerSub'), route: '/training-timer' },
              ]).map(item => (
                <TouchableOpacity
                  key={item.route}
                  style={toolsMenu.row}
                  activeOpacity={0.7}
                  onPress={() => { setToolsMenuVisible(false); unlockAudio(); Sounds.tap(); router.push(item.route as any) }}
                >
                  <View style={toolsMenu.rowIconWrap}>
                    <Ionicons name={item.icon} size={20} color={BRAND} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={toolsMenu.rowLabel}>{item.label}</Text>
                    <Text style={toolsMenu.rowSub}>{item.sub}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
                </TouchableOpacity>
              ))}
            </Pressable>
          </Pressable>
        </Modal>

        {/* ── タブバー ── */}
        <View style={styles.tabBar}>
          {([
            { key: 'practice', label: t('records.tabs.practice') },
            { key: 'records',  label: t('records.tabs.records') },
            { key: 'health',   label: t('records.tabs.health') },
          ] as const).map(tabItem => (
            <HapticTouch
              key={tabItem.key}
              haptic="tabSwitch"
              style={[styles.tabItem, activeTab === tabItem.key && styles.tabItemActive]}
              onPress={() => setActiveTab(tabItem.key)}
            >
              <Text style={[styles.tabLabel, activeTab === tabItem.key && styles.tabLabelActive]}>{tabItem.label}</Text>
            </HapticTouch>
          ))}
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ════ 練習履歴タブ ════ */}
          {activeTab === 'practice' && (
            <PracticeTab sessions={sessions} loading={loading} weightRecords={weightRecords} onAddWeight={handleAddWeight} onDeleteWeight={handleDeleteWeight} onDeleteSession={handleDeleteSession} onReload={loadData} />
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
              <Text style={styles.bigAddBtnText}>{t('records.bigAddButton')}</Text>
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
          {!loading && chartData.length >= 1 && (
            <AnimatedSection delay={80} type="fade-up">
            <View style={styles.card}>
              {/* 種目切替 */}
              {filterEvent === '全種目' && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {usedEvents.map(e => (
                    <HapticTouch
                      key={e}
                      haptic="toggleOn"
                      style={[styles.filterChip, (targetEvent === e) && styles.filterChipActive]}
                      onPress={() => setChartEvent(e)}
                    >
                      <Text style={[styles.filterChipText, (targetEvent === e) && styles.filterChipTextActive]}>{getEventLabel(e, language)}</Text>
                    </HapticTouch>
                  ))}
                </View>
              </ScrollView>
              )}
              <TrainingChart
                data={chartData}
                title={`${getEventLabel(targetEvent!, language)} ${t(isFieldChart ? 'records.chartKindField' : 'records.chartKindTime')}`}
                color={BRAND}
                unit={isFieldChart ? 'm' : t('records.chartUnitSeconds')}
                invertY={!isFieldChart}
                isLoading={false}
              />
            </View>
            </AnimatedSection>
          )}

          {/* ── 成長レポート 導線カード ── */}
          {!loading && records.length > 0 && (
            <AnimatedSection delay={120} type="fade-up">
            <HapticTouch
              haptic="tap"
              style={growthReportSt.card}
              onPress={() => router.push('/growth-report')}
            >
              <View style={growthReportSt.iconWrap}>
                <Ionicons name="trending-up" size={20} color="#d97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={growthReportSt.title}>{t('records.growthReport.title')}</Text>
                <Text style={growthReportSt.sub}>{t('records.growthReport.desc')}</Text>
              </View>
              {!isNoad && (
                <View style={growthReportSt.badge}>
                  <Text style={growthReportSt.badgeText}>PRO</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
            </HapticTouch>
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
                    <Text style={[styles.filterChipText, filterEvent === e && styles.filterChipTextActive]}>{e === '全種目' ? t('records.allEventsFilter') : getEventLabel(e, language)}</Text>
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
              <Text style={styles.cardTitle}>{t('records.list.title')}</Text>
              <Text style={styles.countText}>{t('records.list.countUnit', { n: filtered.length })}</Text>
            </View>

            {/* ソート */}
            {!loading && filtered.length > 0 && (
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 4 }}>
                {([['date_desc',t('records.sort.dateDesc')],['date_asc',t('records.sort.dateAsc')],['result',t('records.sort.result')]] as const).map(([v,l]) => (
                  <TouchableOpacity
                    key={v}
                    style={[styles.filterChip, sortOrder === v && styles.filterChipActive, { paddingHorizontal: 10, paddingVertical: 4 }]}
                    onPress={() => setSortOrder(v)}
                  >
                    <Text style={[styles.filterChipText, sortOrder === v && styles.filterChipTextActive, { fontSize: 11 }]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* 手動・公認フィルター */}
            {!loading && records.length > 0 && (
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 4 }}>
                {([['all',t('records.officialFilter.all')],['official',t('records.officialFilter.official')],['manual',t('records.officialFilter.manual')]] as const).map(([v,l]) => (
                  <TouchableOpacity
                    key={v}
                    style={[styles.filterChip, recordFilter === v && styles.filterChipActive, { paddingHorizontal: 10, paddingVertical: 4 }]}
                    onPress={() => setRecordFilter(v)}
                  >
                    <Text style={[styles.filterChipText, recordFilter === v && styles.filterChipTextActive, { fontSize: 11 }]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {loading ? (
              <View style={{ gap: 8 }}>
                {[1,2,3].map(i => <SkeletonRect key={i} h={64} />)}
              </View>
            ) : filtered.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="timer-outline" size={40} color={TEXT.hint} />
                <Text style={styles.emptyText}>{t('records.list.empty')}</Text>
                <HapticTouch haptic="whoosh" style={styles.emptyBtn} onPress={() => setModalVisible(true)}>
                  <Text style={styles.emptyBtnText}>{t('records.list.addFirst')}</Text>
                </HapticTouch>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {filtered.map(r => (
                  <RecordCard key={r.id} record={r} onDelete={() => handleDelete(r.id)} onEdit={() => openEdit(r)} />
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
                    <Text style={styles.cancelText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>{t(editId ? 'records.modal.editTitle' : 'records.modal.addTitle')}</Text>
                  <TouchableOpacity onPress={handleSave} disabled={saving}>
                    <Text style={[styles.saveText, saving && { opacity: 0.4 }]}>{saving ? t('records.modal.saving') : t('common.save')}</Text>
                  </TouchableOpacity>
                </View>

                {/* 日付・時刻 */}
                <View style={styles.metaRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>{t('records.modal.dateLabel')}</Text>
                    <DateSelector date={fDate} onChange={setFDate} />
                  </View>
                  <View style={{ width: 96 }}>
                    <Text style={styles.label}>{t('records.modal.raceTimeLabel')}</Text>
                    <TextInput
                      style={styles.input}
                      value={fTime}
                      onChangeText={val => {
                        const digits = val.replace(/[^0-9]/g, '').slice(0, 4)
                        setFTime(digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits)
                      }}
                      placeholder="14:30"
                      placeholderTextColor="#9aa5b1"
                      keyboardType="number-pad"
                      maxLength={5}
                    />
                  </View>
                </View>

                {/* 大会名・会場（1回の保存で全種目共通） */}
                <View style={styles.metaRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>{t('records.modal.competitionLabel')}</Text>
                    <TextInput style={styles.input} value={fComp} onChangeText={setFComp}
                      placeholder={t('records.modal.competitionPlaceholder')} placeholderTextColor="#9aa5b1" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>{t('records.modal.venueLabel')}</Text>
                    <TextInput style={styles.input} value={fVenue} onChangeText={setFVenue}
                      placeholder={t('records.modal.venuePlaceholder')} placeholderTextColor="#9aa5b1" />
                  </View>
                </View>

                {/* 公認記録トグル（1回の保存で全種目共通） */}
                <TouchableOpacity
                  onPress={() => setFOfficial(v => !v)}
                  style={[
                    styles.toggleBtn,
                    { flex: 0, alignSelf: 'flex-start', paddingHorizontal: 16, marginBottom: 14 },
                    fOfficial && { backgroundColor: `${BRAND}15`, borderColor: BRAND },
                  ]}
                >
                  <Ionicons name={fOfficial ? 'ribbon' : 'ribbon-outline'} size={16} color={fOfficial ? BRAND : TEXT.secondary} />
                  <Text style={[styles.toggleText, fOfficial && { color: BRAND }]}>{t('records.modal.officialToggle')}</Text>
                </TouchableOpacity>

                {/* 種目ブロック（複数追加可・各ブロックで本数を指定すると入力欄が増える） */}
                {blocks.map((b, bi) => {
                  const field = isField(b.event)
                  const repCount = field ? b.meters.length : b.mins.length
                  return (
                    <View key={b.key} style={styles.eventBlock}>
                      <View style={styles.eventBlockHeader}>
                        <Text style={styles.eventBlockTitle}>{t('records.modal.eventBlockTitle', { n: bi + 1 })}</Text>
                        {blocks.length > 1 && (
                          <TouchableOpacity onPress={() => removeBlock(b.key)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Ionicons name="close-circle" size={20} color="#9aa5b1" />
                          </TouchableOpacity>
                        )}
                      </View>

                      <Text style={styles.subLabel}>{t('records.modal.trackLabel')}</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                        <View style={styles.chipRow}>
                          {TRACK_EVENTS.map(e => (
                            <HapticTouch key={e} haptic="toggleOn" style={[styles.chip, b.event === e && styles.chipActive]} onPress={() => updateBlock(b.key, { event: e })}>
                              <Text style={[styles.chipText, b.event === e && styles.chipTextActive]}>{getEventLabel(e, language)}</Text>
                            </HapticTouch>
                          ))}
                        </View>
                      </ScrollView>
                      <Text style={styles.subLabel}>{t('records.modal.fieldLabel')}</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                        <View style={styles.chipRow}>
                          {FIELD_EVENTS.map(e => (
                            <HapticTouch key={e} haptic="toggleOn" style={[styles.chip, b.event === e && styles.chipActive]} onPress={() => updateBlock(b.key, { event: e })}>
                              <Text style={[styles.chipText, b.event === e && styles.chipTextActive]}>{getEventLabel(e, language)}</Text>
                            </HapticTouch>
                          ))}
                        </View>
                      </ScrollView>

                      {/* 本数（複数レース・複数本のインターバルをまとめて入力） */}
                      <Text style={styles.label}>{t('records.modal.repsLabel')}</Text>
                      <View style={[styles.chipRow, { marginBottom: 14 }]}>
                        {REPS_PRESETS.map(n => (
                          <HapticTouch key={n} haptic="toggleOn" style={[styles.repsChip, repCount === n && styles.chipActive]} onPress={() => updateBlockReps(b.key, n)}>
                            <Text style={[styles.chipText, repCount === n && styles.chipTextActive]}>{n}</Text>
                          </HapticTouch>
                        ))}
                        <TextInput
                          style={styles.repsInput}
                          value={String(repCount)}
                          onChangeText={val => updateBlockReps(b.key, parseInt(val.replace(/[^0-9]/g, '') || '1', 10))}
                          keyboardType="number-pad" maxLength={2} textAlign="center"
                        />
                        <Text style={styles.repsUnit}>{t('records.modal.repsUnit')}</Text>
                      </View>

                      {/* タイム or 記録（本数分だけ行が並ぶ） */}
                      <Text style={styles.label}>{t(field ? 'records.modal.resultLabel' : 'records.modal.timeLabel')}</Text>
                      <View style={{ gap: 8, marginBottom: 4 }}>
                        {Array.from({ length: repCount }, (_, i) => (
                          <View key={i} style={styles.repRow}>
                            {repCount > 1 && <Text style={styles.repRowLabel}>{t('records.modal.repN', { n: i + 1 })}</Text>}
                            {field ? (
                              <View style={styles.timeRow}>
                                <View style={styles.timeCol}>
                                  <Text style={styles.timeUnit}>m</Text>
                                  <TextInput style={styles.timeNumInput} value={b.meters[i]}
                                    onChangeText={t => { const m = [...b.meters]; m[i] = t.replace(/[^0-9]/g, '').slice(0, 2); updateBlock(b.key, { meters: m }) }}
                                    editable keyboardType="number-pad" returnKeyType="done" maxLength={2}
                                    placeholder="7" placeholderTextColor="#9aa5b1" textAlign="center" />
                                </View>
                                <Text style={styles.timeSep}>.</Text>
                                <View style={styles.timeCol}>
                                  <Text style={styles.timeUnit}>cm</Text>
                                  <TextInput style={styles.timeNumInput} value={b.cms[i]}
                                    onChangeText={t => { const c = [...b.cms]; c[i] = t.replace(/[^0-9]/g, '').slice(0, 2); updateBlock(b.key, { cms: c }) }}
                                    editable keyboardType="number-pad" returnKeyType="done" maxLength={2}
                                    placeholder="32" placeholderTextColor="#9aa5b1" textAlign="center" />
                                </View>
                              </View>
                            ) : (
                              <View style={styles.timeRow}>
                                <View style={styles.timeCol}>
                                  <Text style={styles.timeUnit}>{t('records.modal.minUnit')}</Text>
                                  <TextInput style={styles.timeNumInput} value={b.mins[i]}
                                    onChangeText={val => { const m = [...b.mins]; m[i] = val.replace(/[^0-9]/g, ''); updateBlock(b.key, { mins: m }) }}
                                    keyboardType="number-pad" placeholder="0" placeholderTextColor="#9aa5b1" maxLength={2} textAlign="center" />
                                </View>
                                <Text style={styles.timeSep}>:</Text>
                                <View style={styles.timeCol}>
                                  <Text style={styles.timeUnit}>{t('records.modal.secUnit')}</Text>
                                  <TextInput style={styles.timeNumInput} value={b.secs[i]}
                                    onChangeText={val => { const s = [...b.secs]; s[i] = val.replace(/[^0-9.]/g, ''); updateBlock(b.key, { secs: s }) }}
                                    keyboardType="decimal-pad" placeholder="10.85" placeholderTextColor="#9aa5b1" maxLength={5} textAlign="center" />
                                </View>
                              </View>
                            )}
                          </View>
                        ))}
                      </View>

                      {/* 風速 */}
                      {hasWind(b.event) && (
                        <>
                          <Text style={styles.label}>{t('records.modal.windLabel')}</Text>
                          <View style={styles.windRow}>
                            <TouchableOpacity
                              style={[styles.windSignBtn, !b.windPos && styles.windSignBtnMinus]}
                              onPress={() => updateBlock(b.key, { windPos: !b.windPos })}
                              activeOpacity={0.7}
                            >
                              <Text style={[styles.windSignTxt, !b.windPos && { color: '#ef4444' }]}>
                                {b.windPos ? '+' : '−'}
                              </Text>
                            </TouchableOpacity>
                            <TextInput
                              style={[styles.input, styles.windInput]}
                              value={b.wind}
                              onChangeText={t => updateBlock(b.key, { wind: t.replace(/[^0-9.]/g, '') })}
                              keyboardType="decimal-pad"
                              placeholder="1.2"
                              placeholderTextColor="#9aa5b1"
                            />
                            <Text style={styles.windUnit}>m/s</Text>
                          </View>
                        </>
                      )}

                      {/* ハードルの高さ */}
                      {isHurdleEvent(b.event) && (
                        <>
                          <Text style={styles.label}>{t('records.modal.hurdleHeightLabel')}</Text>
                          <View style={[styles.chipRow, { flexWrap: 'wrap', marginBottom: 14 }]}>
                            {STANDARD_HURDLE_HEIGHTS.map(h => (
                              <HapticTouch key={h.cm} haptic="toggleOn" style={[styles.chip, b.hurdleHeight === h.cm && styles.chipActive]} onPress={() => updateBlock(b.key, { hurdleHeight: h.cm })}>
                                <Text style={[styles.chipText, b.hurdleHeight === h.cm && styles.chipTextActive]}>{h.label}</Text>
                              </HapticTouch>
                            ))}
                          </View>
                        </>
                      )}

                      {/* PB / SB トグル（1本のみの記録の場合だけ表示） */}
                      {repCount === 1 && (
                        <View style={styles.toggleRow}>
                          {/* PB・SBは同時に成立しうる（自己ベスト更新は必ずシーズンベストでもある）ため、
                              互いを排他的にクリアせず独立してON/OFFできるようにする */}
                          <TouchableOpacity style={[styles.toggleBtn, b.isPB && styles.toggleBtnPB]} onPress={() => { b.isPB ? Sounds.toggleOff() : Sounds.toggleOn(); updateBlock(b.key, { isPB: !b.isPB }) }}>
                            <Ionicons name={b.isPB ? 'trophy' : 'trophy-outline'} size={16} color={b.isPB ? NEON.green : TEXT.secondary} />
                            <Text style={[styles.toggleText, b.isPB && { color: NEON.green }]}>{t('records.modal.pbToggle')}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.toggleBtn, b.isSB && styles.toggleBtnSB]} onPress={() => { b.isSB ? Sounds.toggleOff() : Sounds.toggleOn(); updateBlock(b.key, { isSB: !b.isSB }) }}>
                            <Ionicons name={b.isSB ? 'star' : 'star-outline'} size={16} color={b.isSB ? NEON.blue : TEXT.secondary} />
                            <Text style={[styles.toggleText, b.isSB && { color: NEON.blue }]}>{t('records.modal.sbToggle')}</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  )
                })}

                {/* 種目を追加 */}
                {!editId && (
                  <HapticTouch haptic="tap" style={styles.addEventBtn} onPress={addBlock}>
                    <Ionicons name="add-circle-outline" size={18} color={BRAND} />
                    <Text style={styles.addEventBtnText}>{t('records.modal.addEvent')}</Text>
                  </HapticTouch>
                )}

                {/* メモ */}
                <Text style={styles.label}>{t('records.modal.noteLabel')}</Text>
                <TextInput style={[styles.input, styles.textArea]} value={fNotes} onChangeText={setFNotes}
                  multiline numberOfLines={3} placeholder={t('records.modal.notePlaceholder')} placeholderTextColor="#445577" />

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
        hardLimited={csvGateHardLimited}
        limitType={csvGateLimitType}
        isGuest={isGuest}
        onClose={() => setCsvGateVisible(false)}
        onAdWatched={async () => {
          setCsvGateVisible(false)
          await recordUsage('csv')
          trackFeatureUse('csv')
          exportAllDataCSV().catch(() => Toast.show({ type: 'error', text1: t('records.header.exportFailed') }))
        }}
        onUpgrade={() => { setCsvGateVisible(false); router.push('/paywall') }}
      />
    <ConfettiEffect visible={showConfetti} onDone={() => setShowConfetti(false)} />
    </View>
  )
}

// ── 成長レポート導線カードのスタイル ─────────────────────────────
const growthReportSt = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fffbeb',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(217,119,6,0.25)',
  },
  iconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(217,119,6,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: '#111827', fontSize: 14, fontWeight: '800' },
  sub:   { color: '#6b7280', fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  badge: { backgroundColor: '#d97706', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
})

// ── スタイル ──────────────────────────────────────────────────────
const toolsMenu = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  card:        { backgroundColor: '#f6f6f8', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, gap: 4 },
  title:       { fontSize: 17, fontWeight: '800', color: TEXT.primary, marginBottom: 10 },
  row:         { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#ffffff', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.08)', borderRadius: 16, padding: 14, marginBottom: 8 },
  rowIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: BRAND + '14', alignItems: 'center', justifyContent: 'center' },
  rowLabel:    { fontSize: 14, fontWeight: '800', color: TEXT.primary },
  rowSub:      { fontSize: 11.5, color: '#9ca3af', marginTop: 2 },
})

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: 'transparent' },
  scroll:  { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.08)', backgroundColor: '#ffffff' },
  headerTitle: { color: TEXT.primary, fontSize: 20, fontWeight: '800' },
  addBtn:  { width: 36, height: 36, borderRadius: 18, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f0f2f5', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', alignItems: 'center', justifyContent: 'center' },

  card:    { backgroundColor: '#ffffff', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle:  { color: TEXT.primary, fontSize: 15, fontWeight: '700', flex: 1 },
  countText:  { color: TEXT.hint, fontSize: 13 },

  // PBサマリー
  pbGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pbItem:  { backgroundColor: 'rgba(34,197,94,0.08)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(34,197,94,0.25)', padding: 10, minWidth: 90, alignItems: 'center' },
  pbEvent: { color: TEXT.secondary, fontSize: 11, fontWeight: '600', marginBottom: 2 },
  pbResult:{ color: NEON.green, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  pbDate:  { color: TEXT.hint, fontSize: 10, marginTop: 2 },

  // 記録カード
  recordCard:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f8fa', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', padding: 12, gap: 10 },
  recordCardPB: { borderColor: 'rgba(34,197,94,0.4)', backgroundColor: 'rgba(34,197,94,0.04)' },
  recordLeft:   { width: 62, gap: 4 },
  eventBadgeWrap: { backgroundColor: `${BRAND}15`, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  eventBadgeText: { color: BRAND, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  badge:        { borderRadius: 4, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText:    { fontSize: 10, fontWeight: '800' },
  recordMid:    { flex: 1, gap: 2 },
  recordResult: { color: TEXT.primary, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  windText:     { color: TEXT.hint, fontSize: 11 },
  windRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  windSignBtn:  { width: 44, height: 44, borderRadius: 14, backgroundColor: '#f0f2f5', borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)', alignItems: 'center', justifyContent: 'center' },
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
  filterChip:       { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#f0f2f5', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  filterChipActive: { backgroundColor: BRAND, borderColor: BRAND },
  filterChipText:   { color: TEXT.secondary, fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#FFFFFF' },

  // 空状態
  empty:      { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyText:  { color: TEXT.secondary, fontSize: 14 },
  emptyBtn:   { backgroundColor: BRAND, borderRadius: 21, paddingHorizontal: 20, paddingVertical: 10 },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },

  // 体重入力
  weightInput:   { flex: 1, backgroundColor: '#f8f8fa', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, color: TEXT.primary, fontSize: 15, borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)' },
  weightAddBtn:  { backgroundColor: NEON.blue, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 11, justifyContent: 'center' },

  // 入力ショートカット
  inputShortcut:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#f0f2f5', borderRadius: 18, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
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
  input:    { backgroundColor: '#f8f8fa', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: TEXT.primary, fontSize: 15, borderWidth: 1, borderColor: 'rgba(59,130,246,0.25)', marginBottom: 14 },
  textArea: { height: 80, textAlignVertical: 'top' },

  chipRow:      { flexDirection: 'row', gap: 8 },
  chip:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', backgroundColor: '#f0f2f5' },
  chipActive:   { backgroundColor: BRAND, borderColor: BRAND },
  chipText:     { color: TEXT.secondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },

  timeRow:     { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 14 },
  timeCol:     { flex: 1, gap: 4 },
  timeNumInput:{ backgroundColor: '#f8f8fa', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: TEXT.primary, fontSize: 20, fontWeight: '700', borderWidth: 1, borderColor: 'rgba(59,130,246,0.25)', fontVariant: ['tabular-nums'] },
  timeUnit:    { color: TEXT.secondary, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  timeSep:     { color: TEXT.secondary, fontSize: 24, fontWeight: '300', paddingBottom: 10 },

  toggleRow:   { flexDirection: 'row', gap: 8, marginBottom: 14 },
  toggleBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, backgroundColor: '#f0f2f5', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  toggleBtnPB: { backgroundColor: 'rgba(34,197,94,0.08)', borderColor: NEON.green },
  toggleBtnSB: { backgroundColor: 'rgba(59,130,246,0.08)', borderColor: NEON.blue },
  toggleText:  { color: TEXT.secondary, fontSize: 12, fontWeight: '600' },

  // 大会名・会場（横並び）
  metaRow: { flexDirection: 'row', gap: 10 },

  // 種目ブロック（1種目=1カード。複数追加すると縦に並ぶ）
  eventBlock: {
    backgroundColor: '#fbfbfd', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)',
    padding: 14, marginBottom: 14, gap: 2,
  },
  eventBlockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  eventBlockTitle:  { color: TEXT.primary, fontSize: 13, fontWeight: '800' },

  // 本数チップ・入力
  repsChip:  { width: 36, height: 32, borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', backgroundColor: '#f0f2f5', alignItems: 'center', justifyContent: 'center' },
  repsInput: { width: 44, height: 32, borderRadius: 21, borderWidth: 1, borderColor: 'rgba(59,130,246,0.25)', backgroundColor: '#f8f8fa', color: TEXT.primary, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  repsUnit:  { color: TEXT.hint, fontSize: 12, fontWeight: '600', alignSelf: 'center' },

  // 本数分の記録行
  repRow:      { gap: 4 },
  repRowLabel: { color: TEXT.hint, fontSize: 11, fontWeight: '700' },

  // 種目を追加ボタン
  addEventBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: `${BRAND}55`,
    marginBottom: 14,
  },
  addEventBtnText: { color: BRAND, fontSize: 13, fontWeight: '700' },

  // タイム入力大ボタン
  bigAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: BRAND, borderRadius: 21,
    paddingVertical: 18, paddingHorizontal: 20,
    shadowColor: BRAND, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 8,
  },
  bigAddBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', flex: 1 },

  // タブバー
  tabBar:          { flexDirection: 'row', backgroundColor: '#ffffff', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.08)', paddingHorizontal: 16 },
  tabItem:         { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabItemActive:   { borderBottomWidth: 2, borderBottomColor: BRAND },
  tabLabel:        { color: TEXT.hint, fontSize: 12, fontWeight: '700' },
  tabLabelActive:  { color: BRAND },
})

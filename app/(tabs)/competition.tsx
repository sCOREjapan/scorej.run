import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../../context/LanguageContext'
import { getEventLabel } from '../../lib/eventLabels'
import i18n from '../../lib/i18n'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BRAND, NEON, TEXT, GLASS } from '../../lib/theme'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Ionicons } from '@expo/vector-icons'
import Toast from 'react-native-toast-message'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Sounds, unlockAudio } from '../../lib/sounds'
import HapticTouch from '../../components/HapticTouch'
import AnimatedSection from '../../components/AnimatedSection'
import {
  requestPermission,
  getPermission,
  scheduleCompetitionReminder,
  scheduleTrainingReminder,
  sendCompetitionPlanCreatedNotification,
  scheduleInjuryDailyNotifications,
  cancelInjuryNotifications,
} from '../../lib/notifications'

const COMP_KEY = 'trackmate_competitions'
const ENTRY_KEY = 'trackmate_entry_status'
const INJURY_KEY = 'trackmate_injury_records'
import { generateCompetitionPlan, generateInjuryRecoveryPlan } from '../../lib/claude'
import { checkAdGate, recordUsage } from '../../lib/adGate'
import { TICKET_COST } from '../../lib/ticketWallet'
import TicketGateModal from '../../components/TicketGateModal'
import { todayLocalISO } from '../../lib/dateLocal'
import type { CompetitionPlan, TrackEvent, AthleticsEvent, WeekPlan, UserProfile, InjuryRecord, InjuryDayPlan, TreatmentLogEntry } from '../../types'

const PROFILE_KEY = 'trackmate_my_profile'

const EVENTS: AthleticsEvent[] = [
  // トラック
  '100m', '200m', '300m', '400m', '110mH', '100mH', '300mH', '400mH',
  '800m', '1000m', '1500m', '3000m', '5000m', '10000m', 'half_marathon', 'marathon', '3000mSC', '競歩',
  // フィールド・跳躍
  '走幅跳', '三段跳', '走高跳', '棒高跳',
  // 投擲
  '砲丸投', 'やり投', '円盤投', 'ハンマー投',
  // 混成（得点制）
  '十種競技', '七種競技', '八種競技',
  // リレー
  '4×100mR', '4×400mR',
]

function buildEventCategories(t: (key: string) => string) {
  return [
    { key: 'sprint',   label: t('competition.eventCategories.sprint'),   icon: '⚡', events: ['100m','200m','300m','400m','110mH','100mH','300mH','400mH'] },
    { key: 'middle',   label: t('competition.eventCategories.middle'),   icon: '🏃', events: ['800m','1000m','1500m','3000m','5000m','10000m','half_marathon','marathon','3000mSC','競歩'] },
    { key: 'jump',     label: t('competition.eventCategories.jump'),     icon: '🦘', events: ['走幅跳','三段跳','走高跳','棒高跳'] },
    { key: 'throw',    label: t('competition.eventCategories.throw'),    icon: '🥏', events: ['砲丸投','やり投','円盤投','ハンマー投'] },
    { key: 'combined', label: t('competition.eventCategories.combined'), icon: '🏅', events: ['十種競技','七種競技','八種競技','4×100mR','4×400mR'] },
  ] as const
}

const INTENSITY_COLORS: Record<string, string> = {
  easy: '#34C759',
  moderate: '#FF9500',
  hard: BRAND,
  race: '#FFD700',
}

// ── エントリー状態 ────────────────────────────────────────────────
type EntryStatus = '未確認' | '申込済' | '出場予定' | '欠場' | '完走'
type EntryStatusMap = Record<string, EntryStatus>

const ENTRY_STATUSES: EntryStatus[] = ['未確認', '申込済', '出場予定', '欠場', '完走']

const STATUS_COLOR: Record<EntryStatus, string> = {
  '未確認': '#555',
  '申込済': NEON.blue,
  '出場予定': NEON.green,
  '欠場': '#FF3B30',
  '完走': NEON.amber,
}

// フィルターオプション
type FilterOption = '全て' | '申込済' | '出場予定' | '完走'
const FILTER_OPTIONS: FilterOption[] = ['全て', '申込済', '出場予定', '完走']

// EntryStatus/FilterOptionは内部データ（AsyncStorage永続化・比較用）なので日本語のまま保持し、
// 表示時だけこの関数で言語に応じたラベルに変換する（種目名のgetEventLabelと同じ方針）
function getEntryStatusLabel(status: EntryStatus | FilterOption, t: (key: string) => string): string {
  const map: Record<string, string> = {
    '全て': t('competition.filter.all'),
    '未確認': t('competition.entryStatus.unconfirmed'),
    '申込済': t('competition.entryStatus.applied'),
    '出場予定': t('competition.entryStatus.entering'),
    '欠場': t('competition.entryStatus.absent'),
    '完走': t('competition.entryStatus.finished'),
  }
  return map[status] ?? status
}

// InjuryDayPlan.phaseはAI/テンプレート双方で常に日本語の固定4値（グルーピング・ソートに使う内部データ）。
// 表示時だけ言語に応じたラベルに変換する。
function getPhaseLabel(phase: string, t: (key: string) => string): string {
  const map: Record<string, string> = {
    '急性期': t('competition.phase.acute'),
    '亜急性期': t('competition.phase.subacute'),
    'リハビリ期': t('competition.phase.rehab'),
    '復帰準備期': t('competition.phase.prep'),
  }
  return map[phase] ?? phase
}

// injSide/injParts/injuryTypeは内部データ（AsyncStorage永続化・怪我プランの元テキスト生成に使う）なので
// 日本語のまま保持し、表示時だけこの関数群で言語に応じたラベルに変換する
const BODY_PART_KEYS: Record<string, string> = {
  'ハムストリング': 'hamstring', '膝': 'knee', 'ふくらはぎ': 'calf', 'アキレス腱': 'achilles',
  '足首': 'ankle', '腰': 'lowBack', '股関節': 'hip', '大腿四頭筋': 'quadriceps',
  '脛': 'shin', '肩': 'shoulder', '肘': 'elbow', 'その他': 'other',
}
const INJURY_TYPE_KEYS: Record<string, string> = {
  '肉離れ': 'muscleTear', '捻挫': 'sprain', '打撲': 'bruise', '腱炎': 'tendinitis',
  '疲労骨折疑い': 'stressFractureSuspected', 'シンスプリント': 'shinSplints', 'その他': 'other',
}
const SIDE_KEYS: Record<string, string> = { '左': 'left', '右': 'right', '両方': 'both' }

function getBodyPartLabel(part: string, t: (key: string) => string): string {
  const key = BODY_PART_KEYS[part]
  return key ? t(`competition.injuryForm.parts.${key}`) : part
}
function getInjuryTypeLabel(type: string, t: (key: string) => string): string {
  const key = INJURY_TYPE_KEYS[type]
  return key ? t(`competition.injuryForm.types.${key}`) : type
}
function getSideLabel(side: string, t: (key: string) => string): string {
  const key = SIDE_KEYS[side]
  return key ? t(`competition.injuryForm.side.${key}`) : side
}

// AI応答のdayフィールドは言語設定に関わらず常に日本語の曜日表記（月曜〜日曜）で固定される
// （prompts/index.tsのプロンプト指示・TodayWorkoutCardの一致判定のため）。表示時だけ変換する。
function getDowLabel(day: string, t: (key: string, opts?: any) => any): string {
  const JA_DOW = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜']
  const idx = JA_DOW.indexOf(day)
  if (idx === -1) return day
  return (t('competition.dowFull', { returnObjects: true }) as string[])[idx]
}

// ── スケルトン ────────────────────────────────────────────────────
function SkeletonRect({ height = 16, width = '100%' as number | string, radius = 8 }) {
  const opacity = useRef(new Animated.Value(0.3)).current
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [opacity])
  return (
    <Animated.View
      style={{ height, width: width as any, borderRadius: radius, backgroundColor: '#e8eaed', opacity }}
    />
  )
}

// ── エントリーバッジ ─────────────────────────────────────────────
function EntryBadge({ status }: { status: EntryStatus }) {
  const { t } = useTranslation()
  const color = STATUS_COLOR[status]
  return (
    <View style={[styles.entryBadge, { backgroundColor: color + '22', borderColor: color }]}>
      <Text style={[styles.entryBadgeText, { color }]}>{getEntryStatusLabel(status, t)}</Text>
    </View>
  )
}

// ── カード単位のエラーバウンダリ（1件の描画エラーで画面全体を壊さない） ──
class CardErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={[styles.card, { alignItems: 'center', paddingVertical: 20 }]}>
          <Text style={{ color: TEXT.hint, fontSize: 12 }}>{i18n.t('competition.cardError')}</Text>
        </View>
      )
    }
    return this.props.children
  }
}

// ── カウントダウンカード ──────────────────────────────────────────
function CountdownCard({
  competition,
  entryStatus,
  onEntryPress,
}: {
  competition: CompetitionPlan
  entryStatus: EntryStatus
  onEntryPress: () => void
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const calcDays = useCallback(() => {
    const target = new Date(competition.competition_date)
    const now = new Date()
    return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  }, [competition.competition_date])

  const [days, setDays] = useState(calcDays)

  useEffect(() => {
    setDays(calcDays())
    const id = setInterval(() => setDays(calcDays()), 60 * 1000)
    return () => clearInterval(id)
  }, [calcDays])

  const isPast = days < 0

  return (
    <View style={styles.countdownCard}>
      <View style={styles.countdownTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.compName}>{competition.competition_name}</Text>
          <Text style={styles.compMeta}>
            {getEventLabel(competition.event, language)} · {competition.competition_date}
          </Text>
        </View>
        <View style={styles.daysBox}>
          <Text style={styles.daysNum}>{isPast ? Math.abs(days) : Math.max(0, days)}</Text>
          <Text style={styles.daysLabel}>{isPast ? t('competition.countdown.daysAgo') : t('competition.countdown.daysLeft')}</Text>
        </View>
      </View>
      {competition.key_advice ? (
        <View style={styles.adviceBox}>
          <Ionicons name="sparkles" size={14} color={BRAND} />
          <Text style={styles.adviceText}>{competition.key_advice}</Text>
        </View>
      ) : null}
      {/* エントリー状態バッジ */}
      <View style={styles.entryRow}>
        <TouchableOpacity onPress={onEntryPress} activeOpacity={0.8}>
          <EntryBadge status={entryStatus} />
        </TouchableOpacity>
        <Text style={{ color: TEXT.hint, fontSize: 11 }}>{t('competition.countdown.tapToChange')}</Text>
      </View>
    </View>
  )
}

// ── 週カード ─────────────────────────────────────────────────────
function WeekCard({ week }: { week: WeekPlan }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(week.week_number === 1)

  return (
    <View style={styles.weekCard}>
      <TouchableOpacity style={styles.weekHeader} onPress={() => setOpen(v => !v)} activeOpacity={0.7}>
        <View style={styles.weekNumBadge}>
          <Text style={styles.weekNumText}>
            {week.week_number === 1 ? t('competition.week.weekBeforeRace') : t('competition.week.nWeeksBefore', { n: week.week_number })}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.weekTheme}>{week.theme}</Text>
          {week.total_volume_km ? (
            <Text style={styles.weekVolume}>{week.total_volume_km}km</Text>
          ) : null}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={TEXT.hint} />
      </TouchableOpacity>

      {open && (
        <View style={styles.weekBody}>
          <Text style={styles.keyWorkout}>
            <Text style={{ color: BRAND }}>KEY: </Text>{week.key_workout}
          </Text>
          {week.sessions.map((s, i) => (
            <View key={i} style={styles.sessionRow}>
              <View style={[styles.intensityDot, { backgroundColor: INTENSITY_COLORS[s.intensity] ?? '#888' }]} />
              <Text style={styles.sessionDay}>{getDowLabel(s.day, t)}</Text>
              <Text style={styles.sessionDetail} numberOfLines={2}>{s.detail}</Text>
              <Text style={styles.sessionDuration}>{s.duration_min}{t('competition.minutesUnit')}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

// ══════════════════════════════════════════════════════════════════
// メイン
// ══════════════════════════════════════════════════════════════════
export default function CompetitionScreen() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>()

  const [competitions, setCompetitions] = useState<CompetitionPlan[]>([])
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  // setGenerating(state)は次のレンダーまで反映されないため、連打防止は同期的なrefで行う
  const generatingRef = useRef(false)
  // アンマウント後のsetState・インターバルリークを防ぐためのマウント状態ref
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const [ticketGateVisible, setTicketGateVisible] = useState(false)
  const [ticketGateCost,    setTicketGateCost]    = useState(0)
  const [ticketGateBalance, setTicketGateBalance] = useState(0)
  const [ticketGateFeature, setTicketGateFeature] = useState<'competition_plan' | 'injury_recovery'>('competition_plan')
  const [modalVisible, setModalVisible] = useState(false)
  const [selectedComp, setSelectedComp] = useState<CompetitionPlan | null>(null)

  // 通知
  const [notifGranted, setNotifGranted] = useState(false)

  // エントリー状態
  const [entryStatusMap, setEntryStatusMap] = useState<EntryStatusMap>({})
  const [entryModalComp, setEntryModalComp] = useState<CompetitionPlan | null>(null)

  // タブ
  const [activeTab, setActiveTab] = useState<'race' | 'injury'>('race')

  // 怪我復帰
  const [injuries,         setInjuries]         = useState<InjuryRecord[]>([])
  const [showInjuryForm,   setShowInjuryForm]   = useState(false)
  const [injuryGenerating, setInjuryGenerating] = useState(false)
  const [injGenProgress,   setInjGenProgress]   = useState(0)
  const [injViewDetail,    setInjViewDetail]    = useState<InjuryRecord | null>(null)
  // フォーム
  const [injSide,       setInjSide]       = useState('左')
  const [injParts,      setInjParts]      = useState<string[]>([])
  const [injType,       setInjType]       = useState('')
  const [injDesc,       setInjDesc]       = useState('')
  const [injPain,       setInjPain]       = useState(5)
  const [injSwelling,   setInjSwelling]   = useState(false)
  const [injDaysMode,   setInjDaysMode]   = useState<'ai' | 'manual'>('ai')
  const [injManualDays, setInjManualDays] = useState('21')
  const [injCoachShare, setInjCoachShare] = useState(false)
  const [injExtDays,    setInjExtDays]    = useState('7')
  const [showExtModal,  setShowExtModal]  = useState(false)
  const [extTargetId,   setExtTargetId]   = useState<string | null>(null)
  const [treatmentNote, setTreatmentNote] = useState('')
  const [treatmentModalId, setTreatmentModalId] = useState<string | null>(null)

  // フィルター
  const [activeFilter, setActiveFilter] = useState<FilterOption>('全て')

  // フォーム
  const [compName,       setCompName]       = useState('')
  const [compDate,       setCompDate]       = useState('')
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [compEvent,      setCompEvent]      = useState<AthleticsEvent>('400m')
  const [openCategory,   setOpenCategory]   = useState<string | null>('sprint')
  const [targetMin,    setTargetMin]    = useState('')
  const [targetSec,    setTargetSec]    = useState('')
  const [targetDistM,  setTargetDistM]  = useState('')  // 投擲・跳躍用（m）

  const FIELD_EVENTS = ['走幅跳','三段跳','走高跳','棒高跳','砲丸投','やり投','円盤投','ハンマー投']
  const isFieldEvent = FIELD_EVENTS.includes(compEvent)

  // ── 通知許可確認 ────────────────────────────────────────────────
  useEffect(() => {
    setNotifGranted(getPermission() === 'granted')
  }, [])

  const handleNotifRequest = useCallback(async () => {
    Sounds.tap()
    const result = await requestPermission()
    if (result === 'granted') {
      setNotifGranted(true)
      scheduleTrainingReminder()
      Toast.show({ type: 'success', text1: t('competition.notif.enabledToast') })
    } else if (result === 'denied') {
      Toast.show({ type: 'error', text1: t('competition.notif.deniedToast') })
    }
  }, [t])

  // ── ロード ──────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rawComp, rawEntry, rawProfile, rawInjury] = await Promise.all([
        AsyncStorage.getItem(COMP_KEY),
        AsyncStorage.getItem(ENTRY_KEY),
        AsyncStorage.getItem(PROFILE_KEY),
        AsyncStorage.getItem(INJURY_KEY),
      ])
      if (rawComp) {
        try {
          const all: CompetitionPlan[] = JSON.parse(rawComp)
          // 直近の大会が先頭に来るよう並べる（開催予定は近い順、過去の記録は新しい順で自然に混在する）
          setCompetitions([...all].sort((a, b) => a.competition_date.localeCompare(b.competition_date)))
        } catch {}
      }
      if (rawEntry) {
        try { setEntryStatusMap(JSON.parse(rawEntry)) } catch {}
      }
      if (rawProfile) {
        try { setUserProfile(JSON.parse(rawProfile)) } catch {}
      }
      if (rawInjury) {
        try {
          const recs: InjuryRecord[] = JSON.parse(rawInjury)
          setInjuries(recs)
          if (recs.some(r => r.status === 'active')) setActiveTab('injury')
        } catch {}
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  // プロフィール・大会予定等は他画面（設定・ホーム等）からも書き込まれるため、
  // マウント時だけでなくタブに戻るたびに再読み込みする
  useFocusEffect(useCallback(() => { load() }, [load]))

  // URL パラメータでタブを上書き（ホーム画面からの遷移時）
  useEffect(() => {
    if (tabParam === 'injury') setActiveTab('injury')
    else if (tabParam === 'race') setActiveTab('race')
  }, [tabParam])

  // ── エントリー状態保存 ─────────────────────────────────────────
  const saveEntryStatus = useCallback(async (compId: string, status: EntryStatus) => {
    const next: EntryStatusMap = { ...entryStatusMap, [compId]: status }
    setEntryStatusMap(next)
    await AsyncStorage.setItem(ENTRY_KEY, JSON.stringify(next)).catch(() => {})
    Sounds.tap()
    setEntryModalComp(null)
    Toast.show({ type: 'success', text1: t('competition.toast.entryStatusChanged', { status: getEntryStatusLabel(status, t) }) })
  }, [entryStatusMap, t])

  // ── 試合計画削除 ────────────────────────────────────────────────
  const handleDeleteComp = useCallback((comp: CompetitionPlan) => {
    Alert.alert(
      t('competition.deleteConfirm.title'),
      t('competition.deleteConfirm.message', { name: comp.competition_name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('competition.deleteConfirm.confirm'),
          style: 'destructive',
          onPress: () => {
            setCompetitions(prev => {
              const next = prev.filter(c => c.id !== comp.id)
              AsyncStorage.setItem(COMP_KEY, JSON.stringify(next)).catch(() => {})
              return next
            })
            if (selectedComp?.id === comp.id) setSelectedComp(null)
            Toast.show({ type: 'success', text1: t('competition.toast.compDeleted') })
          },
        },
      ]
    )
  }, [selectedComp, t])

  // ── フィルター適用 ─────────────────────────────────────────────
  const filteredCompetitions = activeFilter === '全て'
    ? competitions
    : competitions.filter(c => (entryStatusMap[c.id] ?? '未確認') === activeFilter)

  // ── 生成 ────────────────────────────────────────────────────────
  async function handleGenerate() {
    // 二重タップ防止（checkAdGate等のawait中に連打されると重複生成されるため。setGeneratingは非同期反映なのでrefで同期的に防ぐ）
    if (generatingRef.current) return
    if (!compName.trim() || !compDate.trim()) {
      Toast.show({ type: 'error', text1: t('competition.toast.validationNameDate') })
      return
    }
    const dateObj = new Date(compDate)
    if (isNaN(dateObj.getTime())) {
      Toast.show({ type: 'error', text1: t('competition.toast.invalidDate') })
      return
    }
    generatingRef.current = true
    // 過去の日付（アプリ利用前に行った大会など）は、AIによる週間プラン生成をスキップし、
    // 記録としてそのまま保存する（生成しても既に終わった大会には意味がないため）
    const isPastCompetition = dateObj < new Date(new Date().setHours(0, 0, 0, 0))

    setGenerating(true)

    if (isPastCompetition) {
      const minN = parseInt(targetMin || '0', 10)
      const secN = parseFloat(targetSec || '0')
      const target_time_ms = isFieldEvent
        ? (parseFloat(targetDistM || '0') * 1000)
        : (minN * 60 + secN) * 1000 || 0
      const realUserId = (await AsyncStorage.getItem('userId').catch(() => null)) ?? 'local'
      const pastPlan: CompetitionPlan = {
        id: `local-${Date.now()}`,
        user_id: realUserId,
        competition_name: compName,
        competition_date: compDate,
        event: compEvent,
        target_time_ms,
        days_until: 0,
        phases: [],
        peak_week: 0,
        taper_start_week: 0,
        key_advice: t('competition.pastPlanNote'),
        created_at: new Date().toISOString(),
      }
      setCompetitions(prev => {
        const next = [pastPlan, ...prev]
        AsyncStorage.setItem(COMP_KEY, JSON.stringify(next)).catch(() => {})
        return next
      })
      setModalVisible(false)
      Sounds.save()
      Toast.show({ type: 'success', text1: t('competition.toast.pastRecorded') })
      setCompName(''); setCompDate(''); setTargetMin(''); setTargetSec('')
      generatingRef.current = false
      setGenerating(false)
      return
    }

    const gate = await checkAdGate('competition_plan')
    if (!gate.allowed) {
      generatingRef.current = false
      setGenerating(false)
      if (gate.needsTicket) { setTicketGateFeature('competition_plan'); setTicketGateCost(gate.ticketCost); setTicketGateBalance(gate.ticketBalance); setTicketGateVisible(true) }
      else { Toast.show({ type: 'error', text1: t('competition.toast.dailyLimitReached') }) }
      return
    }

    setModalVisible(false)

    try {
      const minN = parseInt(targetMin || '0', 10)
      const secN = parseFloat(targetSec || '0')
      const target_time_ms = isFieldEvent
        ? (parseFloat(targetDistM || '0') * 1000)  // 投擲・跳躍はm→疑似ms保存
        : (minN * 60 + secN) * 1000 || 0

      const realUserId = (await AsyncStorage.getItem('userId').catch(() => null)) ?? 'local'
      const profile: UserProfile = {
        id: realUserId,
        name: userProfile?.name ?? '',
        primary_event: isFieldEvent ? '100m' : (compEvent as TrackEvent),
        secondary_events: userProfile?.secondary_events ?? [],
        event_category: ['100m','200m','300m','400m','110mH','100mH','300mH','400mH'].includes(compEvent) ? 'sprint' : 'middle',
        personal_best_ms: userProfile?.personal_best_ms,
        target_time_ms,
        experience_years: userProfile?.experience_years,
        created_at: new Date().toISOString(),
      }

      const planData = await generateCompetitionPlan(dateObj, compName, profile, compEvent, language)

      const daysUntil = Math.ceil((dateObj.getTime() - Date.now()) / (1000 * 60 * 60 * 24))

      const newPlan: CompetitionPlan = {
        id: `local-${Date.now()}`,
        user_id: realUserId,
        competition_name: compName,
        competition_date: compDate,
        event: compEvent,
        target_time_ms,
        days_until: daysUntil,
        phases: Array.isArray(planData) ? planData : (planData as { phases?: WeekPlan[] }).phases ?? [],
        peak_week: (planData as { peak_week?: number }).peak_week ?? 3,
        taper_start_week: (planData as { taper_start_week?: number }).taper_start_week ?? 1,
        key_advice: (planData as { key_advice?: string }).key_advice ?? '',
        created_at: new Date().toISOString(),
      }

      // 永続保存を、画面状態の更新・チケット消費より必ず先に完了させる。
      // 以前はチケット消費 → setCompetitions内でfire-and-forget保存、の順で、
      // 保存が完了しないうちに新しい計画の画面へ遷移していたため、遷移直後に
      // クラッシュするとチケットだけ消費されて生成した計画が消える不具合があった。
      // AI生成の待ち時間中に他の操作（削除等）が行われている可能性があるため、
      // reactの古いクロージャではなく保存直前に最新の永続データを読み直してから書き込む。
      const rawExisting = await AsyncStorage.getItem(COMP_KEY).catch(() => null)
      const existingList: CompetitionPlan[] = rawExisting ? JSON.parse(rawExisting) : competitions
      const next = [newPlan, ...existingList]
      await AsyncStorage.setItem(COMP_KEY, JSON.stringify(next))
      setCompetitions(next)
      setSelectedComp(newPlan)

      // 計画生成・保存に成功した場合のみ利用回数・チケットを消費する（失敗時に課金しないため）
      await recordUsage('competition_plan')
      if (gate.needsTicket) Toast.show({ type: 'info', text1: t('competition.toast.ticketUsed', { n: gate.ticketCost }), visibilityTime: 1800 })

      // 通知がONなら大会リマインダー + 計画作成通知
      if (notifGranted) {
        scheduleCompetitionReminder([newPlan])
        sendCompetitionPlanCreatedNotification(compName, daysUntil)
      }

      Sounds.save()
      Toast.show({ type: 'success', text1: t('competition.toast.planCreated') })

      setCompName('')
      setCompDate('')
      setTargetMin('')
      setTargetSec('')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('competition.toast.planFailed')
      Toast.show({ type: 'error', text1: msg })
    } finally {
      generatingRef.current = false
      setGenerating(false)
    }
  }

  // ── 怪我プラン生成 ──────────────────────────────────────────────
  // phaseは常に日本語の固定4値で保存する（表示専用のgetPhaseLabelで変換する内部データ）。
  // advice/exercises/avoidは表示専用のAI非依存テキストなのでtで直接言語対応する。
  function buildTemplatePlan(totalDays: number, parts: string[], injType: string, painLevel: number): InjuryDayPlan[] {
    const safeDays = Math.max(1, totalDays)
    const acute   = Math.max(1, Math.round(safeDays * 0.2))
    const subAcute= Math.max(1, Math.round(safeDays * 0.25))
    const rehab   = Math.max(1, Math.round(safeDays * 0.35))
    const plans: InjuryDayPlan[] = []
    const partsLabel = parts.map(p => getBodyPartLabel(p, t)).join('・')
    const typeLabel = getInjuryTypeLabel(injType, t)
    for (let day = 1; day <= safeDays; day++) {
      let phase = '復帰準備期'
      if (day <= acute)                        phase = '急性期'
      else if (day <= acute + subAcute)        phase = '亜急性期'
      else if (day <= acute + subAcute + rehab) phase = 'リハビリ期'

      const exercises: { name: string; detail: string }[] = []
      const avoid: string[] = []
      let advice = ''

      if (phase === '急性期') {
        exercises.push({ name: t('competition.template.icing'), detail: t('competition.template.icingDetail') })
        if (painLevel >= 6) exercises.push({ name: t('competition.template.elevation'), detail: t('competition.template.elevationDetail') })
        avoid.push(t('competition.template.avoidLoad'), t('competition.template.avoidRunning'), t('competition.template.avoidStretching'))
        advice = t('competition.template.acuteAdvice', { parts: partsLabel, type: typeLabel })
      } else if (phase === '亜急性期') {
        exercises.push({ name: t('competition.template.lightWalk'), detail: t('competition.template.lightWalkDetail') })
        exercises.push({ name: t('competition.template.lightStretch'), detail: t('competition.template.lightStretchDetail') })
        avoid.push(t('competition.template.avoidJogging'), t('competition.template.avoidDirectionChange'))
        advice = t('competition.template.subacuteAdvice')
      } else if (phase === 'リハビリ期') {
        exercises.push({ name: t('competition.template.lightJog'), detail: t('competition.template.lightJogDetail') })
        exercises.push({ name: t('competition.template.strength'), detail: t('competition.template.strengthDetail') })
        avoid.push(t('competition.template.avoidSprint'), t('competition.template.avoidSuddenDirectionChange'))
        advice = t('competition.template.rehabAdvice')
      } else {
        exercises.push({ name: t('competition.template.jogBuildup'), detail: t('competition.template.jogBuildupDetail') })
        exercises.push({ name: t('competition.template.sportSpecific'), detail: t('competition.template.sportSpecificDetail') })
        avoid.push(t('competition.template.avoidConsecutiveMatches'))
        advice = t('competition.template.prepAdvice')
      }
      plans.push({ day, phase, exercises, avoid, advice })
    }
    return plans
  }

  async function handleSaveInjury() {
    if (!injParts.length || !injType) {
      Alert.alert(t('competition.toast.injuryFormIncompleteTitle'), t('competition.toast.injuryFormIncompleteMsg'))
      return
    }
    setShowInjuryForm(false)
    setInjuryGenerating(true)
    setInjGenProgress(0)
    const timer = setInterval(() => { if (mountedRef.current) setInjGenProgress(p => Math.min(p + 10, 85)) }, 400)

    try {
      const totalDays = injDaysMode === 'manual' ? (parseInt(injManualDays) || 21) : 21

      let plans: InjuryDayPlan[]
      let shouldConsumeTicket = false
      const injGate = await checkAdGate('injury_recovery')
      if (injGate.allowed) {
        try {
          plans = await generateInjuryRecoveryPlan({
            side: injSide, parts: injParts, injuryType: injType,
            description: injDesc, painLevel: injPain,
            hasSwelling: injSwelling, totalDays, language,
          })
          shouldConsumeTicket = true
        } catch {
          // AI失敗時はテンプレートプランを使用（チケットは消費しない）
          plans = buildTemplatePlan(totalDays, injParts, injType, injPain)
        }
      } else {
        // チケット不足時はAI呼び出しをスキップし、テンプレートプランで復帰記録自体は継続する
        if (injGate.needsTicket) {
          Toast.show({ type: 'info', text1: t('competition.toast.templatePlanCreated'), text2: t('competition.toast.templatePlanSub'), visibilityTime: 2400 })
        }
        plans = buildTemplatePlan(totalDays, injParts, injType, injPain)
      }

      if (!mountedRef.current) return  // 生成中に画面を離れた場合はここで打ち切る（finallyでインターバルは必ず解除される）

      setInjGenProgress(100)
      try {
        const record: InjuryRecord = {
          id: `inj_${Date.now()}`,
          side: injSide, parts: injParts, injuryType: injType,
          description: injDesc, painLevel: injPain,
          hasSwelling: injSwelling, totalDays: plans.length,
          startDate: todayLocalISO(),
          plans, coachShare: injCoachShare,
          status: 'active', createdAt: new Date().toISOString(),
          treatmentLog: [],
        }
        // 永続保存を、画面状態の更新・チケット消費より必ず先に完了させる
        // （保存前に状態更新で再描画が走り、そこでクラッシュするとチケットだけ
        // 消費されて生成したプランが消える不具合を避けるため）。
        // AI生成の待ち時間中に他の操作が行われている可能性があるため、
        // 古いクロージャではなく保存直前に最新の永続データを読み直す。
        const rawExistingInj = await AsyncStorage.getItem(INJURY_KEY).catch(() => null)
        const existingInjuries: InjuryRecord[] = rawExistingInj ? JSON.parse(rawExistingInj) : injuries
        const next = [record, ...existingInjuries]
        await AsyncStorage.setItem(INJURY_KEY, JSON.stringify(next))
        setInjuries(next)
        scheduleInjuryDailyNotifications(record.id, record.startDate, record.plans).catch(() => {})
        // 保存に成功した場合のみ利用回数・チケットを消費する（失敗時に課金しないため）
        if (shouldConsumeTicket) {
          await recordUsage('injury_recovery')
          if (injGate.needsTicket) Toast.show({ type: 'info', text1: t('competition.toast.ticketUsed', { n: injGate.ticketCost }), visibilityTime: 1800 })
        }
      } catch {}
      setTimeout(() => { if (mountedRef.current) { setInjuryGenerating(false); setInjGenProgress(0) } }, 700)
    } finally {
      clearInterval(timer)
    }
  }

  async function handleCompleteInjury(id: string) {
    const next = injuries.map(r => r.id === id ? { ...r, status: 'completed' as const } : r)
    setInjuries(next)
    await AsyncStorage.setItem(INJURY_KEY, JSON.stringify(next))
    setInjViewDetail(null)
    // 完治時は通知をキャンセル
    cancelInjuryNotifications(id).catch(() => {})
    Toast.show({ type: 'success', text1: t('competition.injury.recoveredToast') })
  }

  async function handleExtendInjury(id: string) {
    const addDays = parseInt(injExtDays) || 7
    const next = injuries.map(r => {
      if (r.id !== id) return r
      const lastPlan = r.plans[r.plans.length - 1]
      const ext: InjuryDayPlan[] = Array.from({ length: addDays }, (_, i) => ({
        ...lastPlan, day: r.plans.length + i + 1,
      }))
      return { ...r, totalDays: r.totalDays + addDays, plans: [...r.plans, ...ext] }
    })
    setInjuries(next)
    await AsyncStorage.setItem(INJURY_KEY, JSON.stringify(next))
    setShowExtModal(false)
    // 延長後にプランを再スケジュール
    const updated = next.find(r => r.id === id)
    if (updated) scheduleInjuryDailyNotifications(updated.id, updated.startDate, updated.plans).catch(() => {})
    Toast.show({ type: 'success', text1: t('competition.injury.extendedToast', { n: addDays }) })
  }

  // ── 治療（通院・施術）記録の追加 ──────────────────────────────────
  async function handleAddTreatmentLog(id: string, note: string) {
    const entry: TreatmentLogEntry = { date: todayLocalISO(), note: note.trim() || undefined }
    const next = injuries.map(r =>
      r.id === id ? { ...r, treatmentLog: [...(r.treatmentLog ?? []), entry] } : r
    )
    setInjuries(next)
    await AsyncStorage.setItem(INJURY_KEY, JSON.stringify(next))
    setTreatmentModalId(null)
    setTreatmentNote('')
    Toast.show({ type: 'success', text1: t('competition.injury.treatmentAddedToast') })
  }

  async function handleDeleteTreatmentLog(id: string, index: number) {
    const next = injuries.map(r => {
      if (r.id !== id) return r
      const log = [...(r.treatmentLog ?? [])]
      log.splice(index, 1)
      return { ...r, treatmentLog: log }
    })
    setInjuries(next)
    await AsyncStorage.setItem(INJURY_KEY, JSON.stringify(next))
  }

  // ── 今日のプラン取得 ──────────────────────────────────────────────
  function getTodayPlan(inj: InjuryRecord): InjuryDayPlan | null {
    const start = new Date(inj.startDate + 'T00:00:00')
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const dayIndex = Math.floor((today.getTime() - start.getTime()) / 86400000)
    return inj.plans[dayIndex] ?? null
  }

  function getDaysLeft(inj: InjuryRecord) {
    const start = new Date(inj.startDate + 'T00:00:00')
    const end = new Date(start); end.setDate(end.getDate() + inj.totalDays)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86400000))
  }

  function getElapsedDays(inj: InjuryRecord) {
    const start = new Date(inj.startDate + 'T00:00:00')
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86400000))
  }

  const activeInjuries = injuries.filter(r => r.status === 'active')

  // ── 怪我入力フォームのリセット ───────────────────────────────────
  function resetInjuryForm() {
    setInjSide('左'); setInjParts([]); setInjType(''); setInjDesc('')
    setInjPain(5); setInjSwelling(false); setInjDaysMode('ai')
    setInjManualDays('21'); setInjCoachShare(false)
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{activeTab === 'race' ? t('competition.header.raceTitle') : t('competition.header.injuryTitle')}</Text>
        {activeTab === 'race' && (
          <HapticTouch
            haptic="whoosh"
            style={styles.addBtn}
            onPress={() => { unlockAudio(); setModalVisible(true) }}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t('competition.header.registerCompetition')}
          >
            <Ionicons name="add" size={22} color="#fff" />
          </HapticTouch>
        )}
        {activeTab === 'injury' && (
          <HapticTouch
            haptic="whoosh"
            style={styles.addBtn}
            onPress={() => { unlockAudio(); resetInjuryForm(); setShowInjuryForm(true) }}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t('competition.header.recordInjury')}
          >
            <Ionicons name="add" size={22} color="#fff" />
          </HapticTouch>
        )}
      </View>

      {/* ── タブセレクター ── */}
      <View style={{ flexDirection: 'row', marginHorizontal: 16, marginBottom: 4, backgroundColor: '#e8eaed', borderRadius: 12, padding: 3 }}>
        <TouchableOpacity
          style={[{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' }, activeTab === 'race' && { backgroundColor: '#fff' }]}
          onPress={() => setActiveTab('race')}
        >
          <Text style={{ fontSize: 13, fontWeight: activeTab === 'race' ? '800' : '600', color: activeTab === 'race' ? '#111' : '#888' }}>{t('competition.tabSelector.race')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' }, activeTab === 'injury' && { backgroundColor: '#fff' }]}
          onPress={() => setActiveTab('injury')}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text style={{ fontSize: 13, fontWeight: activeTab === 'injury' ? '800' : '600', color: activeTab === 'injury' ? '#111' : '#888' }}>{t('competition.tabSelector.injury')}</Text>
            {activeInjuries.length > 0 && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF6B6B' }} />}
          </View>
        </TouchableOpacity>
      </View>

      {/* ── 試合計画タブ ── */}
      {activeTab === 'race' && (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── 通知設定 ── */}
        <AnimatedSection delay={0} type="fade-up">
          <View style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
            <Ionicons name="notifications-outline" size={20} color={NEON.amber} />
            <Text style={{ color: TEXT.secondary, fontSize: 13, flex: 1 }}>{t('competition.notif.label')}</Text>
            <TouchableOpacity
              style={{ backgroundColor: notifGranted ? NEON.green : BRAND, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 }}
              onPress={handleNotifRequest}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                {notifGranted ? t('competition.notif.enabled') : t('competition.notif.allow')}
              </Text>
            </TouchableOpacity>
          </View>
        </AnimatedSection>

        {/* ── フィルターチップ ── */}
        <AnimatedSection delay={50} type="fade-up">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.filterRow}>
              {FILTER_OPTIONS.map(f => (
                <HapticTouch
                  key={f}
                  haptic="toggleOn"
                  style={[
                    styles.filterChip,
                    activeFilter === f && { backgroundColor: BRAND, borderColor: BRAND },
                  ]}
                  onPress={() => setActiveFilter(f)}
                  activeOpacity={0.8}
                >
                  <Text style={[
                    styles.filterChipText,
                    activeFilter === f && { color: '#fff' },
                  ]}>{getEntryStatusLabel(f, t)}</Text>
                </HapticTouch>
              ))}
            </View>
          </ScrollView>
        </AnimatedSection>

        {/* 生成中スケルトン */}
        {generating && (
          <View style={styles.card}>
            <Text style={styles.generatingText}>
              {compDate ? t('competition.generating.withWeeks', { n: Math.ceil((new Date(compDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 7)) }) : t('competition.generating.default')}
            </Text>
            <View style={{ gap: 10 }}>
              <SkeletonRect height={80} />
              <SkeletonRect height={60} />
              <SkeletonRect height={60} />
              <SkeletonRect height={20} width="60%" />
            </View>
          </View>
        )}

        {/* カウントダウン一覧 */}
        <AnimatedSection delay={100} type="fade-up">
        {loading ? (
          <View style={{ gap: 12 }}>
            {[1, 2].map(i => <SkeletonRect key={i} height={88} />)}
          </View>
        ) : filteredCompetitions.length === 0 && !generating ? (
          competitions.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="trophy-outline" size={56} color={TEXT.hint} />
              <Text style={styles.emptyTitle}>{t('competition.empty.noCompTitle')}</Text>
              <Text style={styles.emptyText}>{t('competition.empty.noCompText')}</Text>
              <HapticTouch haptic="whoosh" style={styles.emptyBtn} onPress={() => setModalVisible(true)}>
                <Text style={styles.emptyBtnText}>{t('competition.empty.noCompBtn')}</Text>
              </HapticTouch>
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="filter-outline" size={44} color={TEXT.hint} />
              <Text style={styles.emptyTitle}>{t('competition.empty.noFilterTitle')}</Text>
            </View>
          )
        ) : (
          <>
            {filteredCompetitions.map(c => (
              <CardErrorBoundary key={c.id}>
                <View>
                  <HapticTouch
                    haptic="tap"
                    onPress={() => setSelectedComp(prev => prev?.id === c.id ? null : c)}
                    activeOpacity={0.85}
                  >
                    <CountdownCard
                      competition={c}
                      entryStatus={entryStatusMap[c.id] ?? '未確認'}
                      onEntryPress={() => { Sounds.pop(); setEntryModalComp(c) }}
                    />
                  </HapticTouch>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleDeleteComp(c)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="trash-outline" size={14} color={TEXT.hint} />
                    <Text style={styles.deleteBtnText}>{t('competition.delete')}</Text>
                  </TouchableOpacity>
                </View>
              </CardErrorBoundary>
            ))}

            {/* 選択中の試合の週別計画 */}
            {selectedComp && selectedComp.phases.length > 0 && (
              <AnimatedSection delay={0} type="scale">
                {/* 今日・明日のメニューカード */}
                <TodayWorkoutCard competition={selectedComp} />

                {/* 週別スケジュール */}
                <View style={[styles.card, { marginTop: 10 }]}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="calendar" size={18} color={BRAND} />
                    <Text style={styles.sectionTitle}>
                      {t('competition.weekSchedule.title', { n: selectedComp.phases.length })}
                      {'  '}
                      <Text style={{ color: TEXT.hint, fontSize: 12, fontWeight: '400' }}>
                        {t('competition.weekSchedule.daysUntil', { n: Math.max(0, Math.ceil((new Date(selectedComp.competition_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) })}
                      </Text>
                    </Text>
                  </View>
                  <View style={{ gap: 8 }}>
                    {selectedComp.phases.map(week => (
                      <WeekCard key={week.week_number} week={week} />
                    ))}
                  </View>
                </View>
              </AnimatedSection>
            )}
          </>
        )}
        </AnimatedSection>
      </ScrollView>
      )} {/* end activeTab === 'race' */}

      {/* ── 怪我復帰タブ ── */}
      {activeTab === 'injury' && (
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: 40 }]} showsVerticalScrollIndicator={false}>
          {injuryGenerating ? (
            /* 生成中アニメーション */
            <View style={{ alignItems: 'center', paddingVertical: 60, gap: 16 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#FF6B6B22', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 28 }}>🩹</Text>
              </View>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#111' }}>{t('competition.injury.generatingTitle')}</Text>
              <Text style={{ fontSize: 12, color: '#888' }}>{t('competition.injury.generatingSub')}</Text>
              <View style={{ width: '100%', height: 5, backgroundColor: '#e8eaed', borderRadius: 3, overflow: 'hidden' }}>
                <View style={{ height: 5, backgroundColor: '#FF6B6B', borderRadius: 3, width: `${injGenProgress}%` as any }} />
              </View>
            </View>
          ) : activeInjuries.length > 0 ? (
            /* アクティブ怪我の表示（複数同時進行に対応） */
            <>
              {activeInjuries.map((activeInjury, injIdx) => {
                const daysLeft = getDaysLeft(activeInjury)
                const elapsed  = getElapsedDays(activeInjury)
                const progress = Math.min(100, Math.round((elapsed / activeInjury.totalDays) * 100))
                const todayPlan = getTodayPlan(activeInjury)
                const treatmentLog = activeInjury.treatmentLog ?? []
                return (
                  <View key={activeInjury.id} style={{ gap: 12, marginBottom: injIdx < activeInjuries.length - 1 ? 20 : 0 }}>
                    <View style={[styles.card, { gap: 10 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ backgroundColor: '#FF6B6B22', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                          <Text style={{ fontSize: 12, color: '#FF6B6B', fontWeight: '700' }}>{getSideLabel(activeInjury.side, t)}{activeInjury.parts.map(p => getBodyPartLabel(p, t)).join('・')} {getInjuryTypeLabel(activeInjury.injuryType, t)}</Text>
                        </View>
                        <Text style={{ fontSize: 12, color: '#888' }}>{t('competition.injury.painLabel', { n: activeInjury.painLevel })}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                        <View>
                          <Text style={{ fontSize: 11, color: '#888' }}>{t('competition.injury.untilRecovery')}</Text>
                          <Text style={{ fontSize: 36, fontWeight: '900', color: '#FF6B6B', letterSpacing: -1 }}>{t('competition.injury.daysLeftLabel', { n: daysLeft })}</Text>
                        </View>
                        <Text style={{ fontSize: 12, color: '#888' }}>Day {elapsed + 1} / {activeInjury.totalDays}</Text>
                      </View>
                      <View style={{ height: 6, backgroundColor: '#e8eaed', borderRadius: 3, overflow: 'hidden' }}>
                        <View style={{ height: 6, backgroundColor: '#FF6B6B', borderRadius: 3, width: `${progress}%` as any }} />
                      </View>
                      {/* アクション */}
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                        <TouchableOpacity
                          style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' }}
                          onPress={() => { setInjExtDays('7'); setExtTargetId(activeInjury.id); setShowExtModal(true) }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#555' }}>{t('competition.injury.extend')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#34C759', alignItems: 'center' }}
                          onPress={() => Alert.alert(t('competition.injury.recoveredConfirmTitle'), t('competition.injury.recoveredConfirmMessage'), [
                            { text: t('common.cancel'), style: 'cancel' },
                            { text: t('competition.injury.recoveredConfirmYes'), onPress: () => handleCompleteInjury(activeInjury.id) }
                          ])}
                        >
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>{t('competition.injury.recoveredButton')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* 今日のプラン */}
                    {todayPlan && (
                      <View style={[styles.card, { gap: 10 }]}>
                        <Text style={{ fontSize: 11, color: BRAND, fontWeight: '700' }}>{t('competition.injury.todayPlanTitle', { day: todayPlan.day, phase: getPhaseLabel(todayPlan.phase, t) })}</Text>
                        <Text style={{ fontSize: 13, color: '#555', lineHeight: 20 }}>{todayPlan.advice}</Text>
                        {todayPlan.exercises.map((ex, i) => (
                          <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingTop: 8, borderTopWidth: i === 0 ? 1 : 0, borderTopColor: '#e8eaed' }}>
                            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: BRAND + '22', alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ fontSize: 11, color: BRAND, fontWeight: '800' }}>{i + 1}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 14, fontWeight: '700', color: '#111' }}>{ex.name}</Text>
                              <Text style={{ fontSize: 12, color: '#888', marginTop: 1 }}>{ex.detail}</Text>
                            </View>
                          </View>
                        ))}
                        {todayPlan.avoid.length > 0 && (
                          <View style={{ backgroundColor: '#FF6B6B12', borderRadius: 8, padding: 10, flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                            <Ionicons name="alert-circle" size={16} color="#FF6B6B" />
                            <Text style={{ fontSize: 12, color: '#FF6B6B', flex: 1 }}>{todayPlan.avoid.join('・')}{t('competition.injury.avoidSuffix')}</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* 治療（通院・施術）記録 */}
                    <View style={[styles.card, { gap: 10 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#111' }}>{t('competition.injury.treatmentLogTitle', { n: treatmentLog.length })}</Text>
                        <TouchableOpacity
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BRAND + '15', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                          onPress={() => { setTreatmentNote(''); setTreatmentModalId(activeInjury.id) }}
                        >
                          <Ionicons name="add" size={14} color={BRAND} />
                          <Text style={{ fontSize: 12, color: BRAND, fontWeight: '700' }}>{t('competition.injury.treatmentLogAdd')}</Text>
                        </TouchableOpacity>
                      </View>
                      {treatmentLog.length === 0 ? (
                        <Text style={{ fontSize: 12, color: '#aaa' }}>{t('competition.injury.treatmentLogEmpty')}</Text>
                      ) : (
                        <View style={{ gap: 6 }}>
                          {[...treatmentLog].reverse().map((log, i) => {
                            const realIndex = treatmentLog.length - 1 - i
                            return (
                              <View key={realIndex} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                                <Ionicons name="medkit-outline" size={14} color={BRAND} />
                                <Text style={{ fontSize: 12, color: '#555', flex: 1 }}>
                                  {log.date}{log.note ? `　${log.note}` : ''}
                                </Text>
                                <TouchableOpacity onPress={() => handleDeleteTreatmentLog(activeInjury.id, realIndex)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('competition.injury.deleteTreatmentLog')}>
                                  <Ionicons name="close" size={14} color="#ccc" />
                                </TouchableOpacity>
                              </View>
                            )
                          })}
                        </View>
                      )}
                    </View>

                    {/* フェーズ別タイムライン */}
                    <View style={[styles.card, { gap: 8 }]}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#111', marginBottom: 4 }}>{t('competition.injury.overallSchedule')}</Text>
                      {Array.from(new Set(activeInjury.plans.map(p => p.phase))).map(phase => {
                        const phasePlans = activeInjury.plans.filter(p => p.phase === phase)
                        const firstDay = phasePlans[0].day
                        const lastDay  = phasePlans[phasePlans.length - 1].day
                        const elapsed2 = getElapsedDays(activeInjury) + 1
                        const isDone   = lastDay < elapsed2
                        const isCurrent = firstDay <= elapsed2 && elapsed2 <= lastDay
                        return (
                          <View key={phase} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#e8eaed' }}>
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isDone ? '#34C759' : isCurrent ? '#FF6B6B' : '#ddd' }} />
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13, fontWeight: isCurrent ? '800' : '600', color: isCurrent ? '#111' : '#888' }}>{getPhaseLabel(phase, t)}</Text>
                              <Text style={{ fontSize: 11, color: '#aaa' }}>{t('competition.injury.dayRange', { first: firstDay, last: lastDay })}</Text>
                            </View>
                            {isDone && <Text style={{ fontSize: 11, color: '#34C759', fontWeight: '700' }}>{t('competition.injury.done')}</Text>}
                            {isCurrent && <Text style={{ fontSize: 11, color: '#FF6B6B', fontWeight: '700' }}>{t('competition.injury.current')}</Text>}
                          </View>
                        )
                      })}
                    </View>
                  </View>
                )
              })}
            </>
          ) : (
            /* 怪我なし → 記録ボタン */
            <View style={{ alignItems: 'center', paddingVertical: 50, gap: 16 }}>
              <Text style={{ fontSize: 48 }}>🩹</Text>
              <Text style={{ fontSize: 18, fontWeight: '800', color: '#111' }}>{t('competition.injury.noInjuryTitle')}</Text>
              <Text style={{ fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 22 }}>{t('competition.injury.noInjuryText')}</Text>
              <TouchableOpacity
                style={{ backgroundColor: '#FF6B6B', borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14, marginTop: 8 }}
                onPress={() => { resetInjuryForm(); setShowInjuryForm(true) }}
              >
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{t('competition.injury.recordButton')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 過去の怪我履歴 */}
          {injuries.filter(r => r.status === 'completed').length > 0 && (
            <View style={[styles.card, { gap: 6, marginTop: 8 }]}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#111', marginBottom: 4 }}>{t('competition.injury.pastHistory')}</Text>
              {injuries.filter(r => r.status === 'completed').map(r => (
                <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#e8eaed' }}>
                  <Text style={{ fontSize: 18 }}>✅</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#34C759' }}>{getSideLabel(r.side, t)}{r.parts.map(p => getBodyPartLabel(p, t)).join('・')} {getInjuryTypeLabel(r.injuryType, t)}</Text>
                    <Text style={{ fontSize: 11, color: '#888' }}>{r.startDate} · {r.totalDays}{t('competition.injury.daysUnit')}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── 怪我入力モーダル ── */}
      <Modal visible={showInjuryForm} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setShowInjuryForm(false)}>
                  <Text style={styles.cancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <Text style={styles.modalTitle}>{t('competition.injuryForm.title')}</Text>
                <View style={{ width: 60 }} />
              </View>

              {/* 左右 */}
              <Text style={styles.label}>{t('competition.injuryForm.sideLabel')}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                {['左', '右', '両方'].map(s => (
                  <TouchableOpacity key={s} onPress={() => setInjSide(s)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: injSide === s ? '#FF6B6B' : '#ddd', backgroundColor: injSide === s ? '#FF6B6B12' : '#fff', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '700', color: injSide === s ? '#FF6B6B' : '#888' }}>{getSideLabel(s, t)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 部位 */}
              <Text style={styles.label}>{t('competition.injuryForm.partsLabel')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {['ハムストリング','膝','ふくらはぎ','アキレス腱','足首','腰','股関節','大腿四頭筋','脛','肩','肘','その他'].map(p => {
                  const sel = injParts.includes(p)
                  return (
                    <TouchableOpacity key={p} onPress={() => setInjParts(prev => sel ? prev.filter(x => x !== p) : [...prev, p])}
                      style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? '#FF6B6B' : '#ddd', backgroundColor: sel ? '#FF6B6B12' : '#fff' }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: sel ? '#FF6B6B' : '#888' }}>{getBodyPartLabel(p, t)}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>

              {/* 種類 */}
              {injDaysMode === 'manual' ? (
                <>
                  <Text style={styles.label}>{t('competition.injuryForm.typeManualLabel')}</Text>
                  <TextInput
                    value={injType} onChangeText={setInjType}
                    placeholder={t('competition.injuryForm.typeManualPlaceholder')}
                    placeholderTextColor="#aaa"
                    style={[styles.input, { marginBottom: 16 }]}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.label}>{t('competition.injuryForm.typeLabel')}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {['肉離れ','捻挫','打撲','腱炎','疲労骨折疑い','シンスプリント','その他'].map(injTypeOpt => {
                      const sel = injType === injTypeOpt
                      return (
                        <TouchableOpacity key={injTypeOpt} onPress={() => setInjType(injTypeOpt)}
                          style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? '#FF6B6B' : '#ddd', backgroundColor: sel ? '#FF6B6B12' : '#fff' }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: sel ? '#FF6B6B' : '#888' }}>{getInjuryTypeLabel(injTypeOpt, t)}</Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                </>
              )}

              {/* 症状 */}
              <Text style={styles.label}>{t('competition.injuryForm.descLabel')}</Text>
              <TextInput
                value={injDesc} onChangeText={setInjDesc}
                placeholder={t('competition.injuryForm.descPlaceholder')}
                placeholderTextColor="#aaa"
                multiline style={[styles.input, { minHeight: 70 }]}
              />

              {/* 痛みの強さ */}
              <Text style={styles.label}>{t('competition.injuryForm.painLabel', { n: injPain })}</Text>
              <View style={{ flexDirection: 'row', gap: 4, marginBottom: 16 }}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                  <TouchableOpacity key={n} onPress={() => setInjPain(n)}
                    style={{ flex: 1, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: injPain >= n ? (n <= 3 ? '#34C759' : n <= 6 ? '#FF9500' : '#FF6B6B') : '#e8eaed' }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: injPain >= n ? '#fff' : '#aaa' }}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 腫れ */}
              <Text style={styles.label}>{t('competition.injuryForm.swellingLabel')}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                {[{ label: t('competition.injuryForm.swellingYes'), val: true }, { label: t('competition.injuryForm.swellingNo'), val: false }].map(({ label, val }) => (
                  <TouchableOpacity key={label} onPress={() => setInjSwelling(val)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5,
                      borderColor: injSwelling === val ? '#FF6B6B' : '#ddd',
                      backgroundColor: injSwelling === val ? '#FF6B6B12' : '#fff', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '700', color: injSwelling === val ? '#FF6B6B' : '#888' }}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 日数モード */}
              <Text style={styles.label}>{t('competition.injuryForm.recoveryDaysLabel')}</Text>
              <View style={{ gap: 8, marginBottom: 16 }}>
                {([['ai', t('competition.injuryForm.aiMode')], ['manual', t('competition.injuryForm.manualMode')]] as const).map(([mode, label]) => (
                  <TouchableOpacity key={mode} onPress={() => setInjDaysMode(mode)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12,
                      borderWidth: 1.5, borderColor: injDaysMode === mode ? BRAND : '#ddd',
                      backgroundColor: injDaysMode === mode ? BRAND + '10' : '#fff' }}>
                    <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2,
                      borderColor: injDaysMode === mode ? BRAND : '#ccc',
                      backgroundColor: injDaysMode === mode ? BRAND : 'transparent',
                      alignItems: 'center', justifyContent: 'center' }}>
                      {injDaysMode === mode && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' }} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: injDaysMode === mode ? BRAND : '#555' }}>{label}</Text>
                      {mode === 'ai' && <Text style={{ fontSize: 11, color: '#888' }}>{t('competition.injuryForm.aiModeSub')}</Text>}
                    </View>
                  </TouchableOpacity>
                ))}
                {injDaysMode === 'manual' && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
                    <TextInput
                      value={injManualDays} onChangeText={setInjManualDays}
                      keyboardType="number-pad" style={[styles.input, { width: 70, textAlign: 'center', marginBottom: 0 }]}
                    />
                    <Text style={{ color: '#555' }}>{t('competition.injuryForm.manualDaysUnit')}</Text>
                  </View>
                )}
              </View>

              <View style={[styles.ticketCostBadge, { backgroundColor: '#16653422', borderColor: '#166534', alignSelf: 'center', marginTop: 8 }]}>
                <Text style={[styles.ticketCostBadgeText, { color: '#166534' }]}>{t('competition.injuryForm.free')}</Text>
              </View>
              <TouchableOpacity
                style={{ backgroundColor: '#FF6B6B', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8 }}
                onPress={handleSaveInjury}
                disabled={!injParts.length || !injType}
              >
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{t('competition.injuryForm.submit')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── 延長モーダル ── */}
      <Modal visible={showExtModal} transparent animationType="fade">
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 32 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, gap: 16 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: '#111' }}>{t('competition.extendModal.title')}</Text>
            <Text style={{ fontSize: 13, color: '#888' }}>{t('competition.extendModal.desc')}</Text>
            {/* クイック選択 */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {['7', '14', '21'].map(d => (
                <TouchableOpacity key={d} onPress={() => setInjExtDays(d)}
                  style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5,
                    borderColor: injExtDays === d ? '#FF6B6B' : '#ddd',
                    backgroundColor: injExtDays === d ? '#FF6B6B12' : '#fff', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '700', color: injExtDays === d ? '#FF6B6B' : '#888' }}>+{d}{t('competition.extendModal.dayUnit')}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* カスタム入力 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f8f8fa', borderRadius: 12, borderWidth: 1.5, borderColor: '#e0e0e0', paddingHorizontal: 14, paddingVertical: 4 }}>
              <Text style={{ fontSize: 13, color: '#888', flex: 1 }}>{t('competition.extendModal.customLabel')}</Text>
              <TextInput
                value={injExtDays}
                onChangeText={v => setInjExtDays(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                style={{ fontSize: 20, fontWeight: '900', color: '#FF6B6B', width: 60, textAlign: 'right' }}
                placeholder="0"
                placeholderTextColor="#ccc"
                maxLength={3}
              />
              <Text style={{ fontSize: 13, color: '#888' }}>{t('competition.extendModal.dayUnit')}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' }} onPress={() => setShowExtModal(false)}>
                <Text style={{ color: '#888', fontWeight: '700' }}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: parseInt(injExtDays) > 0 ? '#FF6B6B' : '#ddd', alignItems: 'center' }}
                onPress={() => extTargetId && parseInt(injExtDays) > 0 && handleExtendInjury(extTargetId)}
              >
                <Text style={{ color: '#fff', fontWeight: '800' }}>{t('competition.extendModal.submit')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── 治療記録モーダル ── */}
      <Modal visible={!!treatmentModalId} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 14 }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: '#111' }}>{t('competition.treatmentModal.title')}</Text>
              <Text style={{ fontSize: 13, color: '#888' }}>{t('competition.treatmentModal.desc')}</Text>
              <TextInput
                value={treatmentNote}
                onChangeText={setTreatmentNote}
                placeholder={t('competition.treatmentModal.placeholder')}
                placeholderTextColor="#ccc"
                style={{ backgroundColor: '#f8f8fa', borderRadius: 12, borderWidth: 1.5, borderColor: '#e0e0e0', paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#111' }}
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' }} onPress={() => setTreatmentModalId(null)}>
                  <Text style={{ color: '#888', fontWeight: '700' }}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: BRAND, alignItems: 'center' }}
                  onPress={() => treatmentModalId && handleAddTreatmentLog(treatmentModalId, treatmentNote)}
                >
                  <Text style={{ color: '#fff', fontWeight: '800' }}>{t('competition.treatmentModal.submit')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── 試合登録モーダル ── */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setModalVisible(false)}>
                  <Text style={styles.cancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <Text style={styles.modalTitle}>{t('competition.compModal.title')}</Text>
                <View style={{ width: 60 }} />
              </View>

              <Text style={styles.label}>{t('competition.compModal.nameLabel')}</Text>
              <TextInput
                style={styles.input}
                value={compName}
                onChangeText={setCompName}
                placeholder={t('competition.compModal.namePlaceholder')}
                placeholderTextColor="#9ca3af"
              />

              <Text style={styles.label}>{t('competition.compModal.dateLabel')}</Text>
              {Platform.OS === 'web' ? (
                // Web版はブラウザネイティブの日付入力を使う（Apple仕様のピッカーは非表示）
                React.createElement('input', {
                  type: 'date',
                  value: compDate || '',
                  onChange: (e: any) => setCompDate(e.target.value),
                  style: {
                    backgroundColor: '#f8f8fa',
                    borderRadius: 10,
                    padding: '12px 14px',
                    color: TEXT.primary,
                    fontSize: 15,
                    border: '1px solid rgba(59,130,246,0.25)',
                    marginBottom: 14,
                    width: '100%',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  },
                })
              ) : (
              <TouchableOpacity
                style={[styles.input, { justifyContent: 'center' }]}
                onPress={() => setShowDatePicker(true)}
                activeOpacity={0.7}
              >
                <Text style={{ color: compDate ? TEXT.primary : '#9ca3af', fontSize: 15 }}>
                  {compDate || t('competition.compModal.datePlaceholder')}
                </Text>
              </TouchableOpacity>
              )}
              {Platform.OS !== 'web' && showDatePicker && (
                <>
                  <DateTimePicker
                    value={compDate ? new Date(compDate) : new Date()}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_, date) => {
                      if (Platform.OS !== 'ios') setShowDatePicker(false)
                      if (date) {
                        const y = date.getFullYear()
                        const m = String(date.getMonth() + 1).padStart(2, '0')
                        const d = String(date.getDate()).padStart(2, '0')
                        setCompDate(`${y}-${m}-${d}`)
                      }
                    }}
                    style={{ backgroundColor: 'transparent' }}
                    themeVariant="light"
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity
                      style={{ alignSelf: 'flex-end', paddingHorizontal: 18, paddingVertical: 8, backgroundColor: BRAND, borderRadius: 10, marginBottom: 8 }}
                      onPress={() => setShowDatePicker(false)}
                    >
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>{t('competition.compModal.dateDone')}</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              <Text style={styles.label}>{t('competition.compModal.eventLabel')}</Text>
              <View style={{ marginBottom: 16, gap: 6 }}>
                {buildEventCategories(t).map(cat => {
                  const isOpen = openCategory === cat.key
                  const hasSelected = (cat.events as readonly string[]).includes(compEvent)
                  return (
                    <View key={cat.key} style={{ borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: hasSelected ? BRAND : 'rgba(0,0,0,0.1)' }}>
                      {/* カテゴリヘッダー */}
                      <TouchableOpacity
                        onPress={() => setOpenCategory(isOpen ? null : cat.key)}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, backgroundColor: hasSelected ? BRAND + '22' : '#f8f8fa' }}
                        activeOpacity={0.7}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ fontSize: 16 }}>{cat.icon}</Text>
                          <Text style={{ color: hasSelected ? BRAND : TEXT.primary, fontWeight: '700', fontSize: 14 }}>{cat.label}</Text>
                          {hasSelected && (
                            <View style={{ backgroundColor: BRAND, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
                              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{getEventLabel(compEvent, language)}</Text>
                            </View>
                          )}
                        </View>
                        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={hasSelected ? BRAND : TEXT.hint} />
                      </TouchableOpacity>
                      {/* イベントチップ */}
                      {isOpen && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12, backgroundColor: '#f6f6f8' }}>
                          {cat.events.map(e => (
                            <HapticTouch
                              key={e}
                              haptic="toggleOn"
                              style={[styles.chip, compEvent === e && { backgroundColor: BRAND, borderColor: BRAND }]}
                              onPress={() => setCompEvent(e as AthleticsEvent)}
                            >
                              <Text style={[styles.chipText, compEvent === e && { color: '#FFFFFF' }]}>{getEventLabel(e, language)}</Text>
                            </HapticTouch>
                          ))}
                        </View>
                      )}
                    </View>
                  )
                })}
              </View>

              {isFieldEvent ? (
                <>
                  <Text style={styles.label}>{t('competition.compModal.fieldTargetLabel')}</Text>
                  <View style={styles.timeRow}>
                    <TextInput
                      style={[styles.timeInput, { flex: 1, textAlign: 'left', paddingHorizontal: 12 }]}
                      value={targetDistM}
                      onChangeText={setTargetDistM}
                      keyboardType="decimal-pad"
                      placeholder={t('competition.compModal.fieldTargetPlaceholder')}
                      placeholderTextColor="#9ca3af"
                    />
                    <Text style={[styles.timeUnit, { marginLeft: 8 }]}>m</Text>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.label}>{t('competition.compModal.timeTargetLabel')}</Text>
                  <View style={styles.timeRow}>
                    <View style={styles.timeCol}>
                      <Text style={styles.timeUnit}>{t('competition.compModal.minUnit')}</Text>
                      <TextInput
                        style={styles.timeInput}
                        value={targetMin}
                        onChangeText={setTargetMin}
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor="#9ca3af"
                        maxLength={2}
                        textAlign="center"
                      />
                    </View>
                    <Text style={styles.timeSep}>:</Text>
                    <View style={styles.timeCol}>
                      <Text style={styles.timeUnit}>{t('competition.compModal.secUnit')}</Text>
                      <TextInput
                        style={styles.timeInput}
                        value={targetSec}
                        onChangeText={setTargetSec}
                        keyboardType="decimal-pad"
                        placeholder="47.00"
                        placeholderTextColor="#9ca3af"
                        maxLength={5}
                        textAlign="center"
                      />
                    </View>
                  </View>
                </>
              )}

              <View style={[styles.ticketCostBadge, { backgroundColor: BRAND + '22', borderColor: BRAND }]}>
                <Text style={[styles.ticketCostBadgeText, { color: BRAND }]}>{t('competition.compModal.ticketCost', { n: TICKET_COST.competition_plan })}</Text>
              </View>
              <HapticTouch
                haptic="save"
                style={[styles.generateBtn, generating && { opacity: 0.6 }]}
                onPress={handleGenerate}
                disabled={generating}
                activeOpacity={0.85}
              >
                {generating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="sparkles" size={20} color="#fff" />
                    <Text style={styles.generateBtnText}>{t('competition.compModal.generate')}</Text>
                  </>
                )}
              </HapticTouch>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── エントリー状態変更モーダル ── */}
      <Modal
        visible={entryModalComp !== null}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setEntryModalComp(null)}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setEntryModalComp(null)}>
                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{t('competition.entryModal.title')}</Text>
              <View style={{ width: 60 }} />
            </View>
            {entryModalComp && (
              <Text style={[styles.label, { marginBottom: 16 }]}>
                {entryModalComp.competition_name}
              </Text>
            )}
            <View style={{ gap: 10 }}>
              {ENTRY_STATUSES.map(status => {
                const color = STATUS_COLOR[status]
                const isCurrent = entryModalComp ? (entryStatusMap[entryModalComp.id] ?? '未確認') === status : false
                return (
                  <TouchableOpacity
                    key={status}
                    style={[
                      styles.entryStatusBtn,
                      { borderColor: color, backgroundColor: isCurrent ? color + '20' : '#f0f2f5' },
                    ]}
                    onPress={() => entryModalComp && saveEntryStatus(entryModalComp.id, status)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.entryStatusDot, { backgroundColor: color }]} />
                    <Text style={[styles.entryStatusText, { color: isCurrent ? color : TEXT.primary }]}>
                      {getEntryStatusLabel(status, t)}
                    </Text>
                    {isCurrent && (
                      <Ionicons name="checkmark-circle" size={18} color={color} />
                    )}
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      <TicketGateModal
        visible={ticketGateVisible}
        feature={ticketGateFeature}
        ticketCost={ticketGateCost}
        ticketBalance={ticketGateBalance}
        onClose={() => setTicketGateVisible(false)}
      />
    </SafeAreaView>
    </View>
  )
}

// ── 今日のメニューカード ──────────────────────────────────────────
const DOW_FULL = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜']

function TodayWorkoutCard({ competition }: { competition: CompetitionPlan }) {
  const { t } = useTranslation()
  const today = new Date()
  const compDate = new Date(competition.competition_date)
  const daysUntil = Math.max(0, Math.ceil((compDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))

  // phases は week_number=1 が「試合直前週」（試合に最も近い週）。
  // 試合から遠い週ほど week_number が大きい（＝最初に取り組む週）。
  // つまり week_number はそのまま「残り何週か」と一致するので、
  // 残り週数をそのまま週番号として使う（配列の範囲内にクランプする）。
  const totalWeeks = competition.phases.length
  const weeksLeft = Math.max(1, Math.ceil(daysUntil / 7))
  const currentWeekNum = Math.min(Math.max(1, weeksLeft), totalWeeks)
  const currentWeek = competition.phases.find(p => p.week_number === currentWeekNum)
    ?? competition.phases[competition.phases.length - 1]
  if (!currentWeek) return null

  const todayDow    = DOW_FULL[today.getDay()]
  const tomorrowDow = DOW_FULL[(today.getDay() + 1) % 7]

  const todaySession    = currentWeek.sessions.find(s => s.day === todayDow)
  const tomorrowSession = currentWeek.sessions.find(s => s.day === tomorrowDow)

  const dietAdvice = daysUntil === 0
    ? t('competition.dietAdvice.dayOf')
    : daysUntil <= 2
    ? t('competition.dietAdvice.within2')
    : daysUntil <= 7
    ? t('competition.dietAdvice.within7')
    : null

  return (
    <View style={tw.card}>
      {/* 今日 */}
      <View style={tw.sectionRow}>
        <Ionicons name="today" size={16} color={BRAND} />
        <Text style={tw.sectionTitle}>{t('competition.todayWorkout.todayMenu', { dow: getDowLabel(todayDow, t) })}</Text>
      </View>
      {todaySession ? (
        <View style={tw.sessionBox}>
          <View style={[tw.intensityBar, { backgroundColor: INTENSITY_COLORS[todaySession.intensity] ?? '#888' }]} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={tw.sessionType}>{todaySession.type}</Text>
              <Text style={tw.sessionDur}>{todaySession.duration_min}{t('competition.minutesUnit')}</Text>
            </View>
            <Text style={tw.sessionDetail}>{todaySession.detail}</Text>
          </View>
        </View>
      ) : (
        <View style={tw.restBox}>
          <Text style={{ fontSize: 18 }}>💤</Text>
          <Text style={tw.restText}>{t('competition.todayWorkout.restDay')}</Text>
        </View>
      )}

      {/* 明日 */}
      <View style={[tw.sectionRow, { marginTop: 10 }]}>
        <Ionicons name="calendar-outline" size={14} color={TEXT.secondary} />
        <Text style={[tw.sectionTitle, { color: TEXT.secondary, fontSize: 12, fontWeight: '600' }]}>
          {t('competition.todayWorkout.tomorrow', { dow: getDowLabel(tomorrowDow, t) })}
        </Text>
      </View>
      {tomorrowSession ? (
        <View style={[tw.sessionBox, { opacity: 0.72 }]}>
          <View style={[tw.intensityBar, { backgroundColor: INTENSITY_COLORS[tomorrowSession.intensity] ?? '#888' }]} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
              <Text style={[tw.sessionType, { fontSize: 12 }]}>{tomorrowSession.type}</Text>
              <Text style={tw.sessionDur}>{tomorrowSession.duration_min}{t('competition.minutesUnit')}</Text>
            </View>
            <Text style={tw.sessionDetail} numberOfLines={1}>{tomorrowSession.detail}</Text>
          </View>
        </View>
      ) : (
        <Text style={{ color: TEXT.hint, fontSize: 13, paddingLeft: 4 }}>{t('competition.todayWorkout.tomorrowRestDay')}</Text>
      )}

      {/* 今週テーマ */}
      <View style={tw.themeBox}>
        <Text style={tw.themeLabel}>{t('competition.todayWorkout.weekTheme')}</Text>
        <Text style={tw.themeText}>{currentWeek.theme}</Text>
        {currentWeek.key_workout ? (
          <Text style={tw.keyText}>🎯 {currentWeek.key_workout}</Text>
        ) : null}
      </View>

      {/* 食事アドバイス（試合7日前以内） */}
      {dietAdvice ? (
        <View style={tw.dietBox}>
          <Ionicons name="restaurant-outline" size={14} color={NEON.amber} />
          <Text style={tw.dietText}>{dietAdvice}</Text>
        </View>
      ) : null}
    </View>
  )
}

const tw = StyleSheet.create({
  card:       { backgroundColor: '#ffffff', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16, gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { color: TEXT.primary, fontSize: 14, fontWeight: '800' },
  sessionBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#f8f8fa', borderRadius: 14, padding: 12 },
  intensityBar: { width: 4, alignSelf: 'stretch', borderRadius: 2, minHeight: 36 },
  sessionType:  { color: TEXT.primary, fontSize: 13, fontWeight: '700' },
  sessionDur:   { color: TEXT.hint, fontSize: 12 },
  sessionDetail:{ color: TEXT.secondary, fontSize: 13, lineHeight: 19 },
  restBox:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f0f2f5', borderRadius: 14, padding: 10 },
  restText:   { color: TEXT.secondary, fontSize: 13, fontWeight: '600' },
  themeBox:   { backgroundColor: BRAND + '08', borderRadius: 14, borderWidth: 1, borderColor: BRAND + '20', padding: 10, gap: 3 },
  themeLabel: { color: BRAND, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  themeText:  { color: TEXT.primary, fontSize: 13, fontWeight: '700' },
  keyText:    { color: TEXT.secondary, fontSize: 12 },
  dietBox:    { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: 'rgba(245,158,11,0.08)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)', borderRadius: 14, padding: 10 },
  dietText:   { color: TEXT.secondary, fontSize: 12, lineHeight: 18, flex: 1 },
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
    backgroundColor: '#ffffff',
  },
  headerTitle: { color: TEXT.primary, fontSize: 20, fontWeight: '800' },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  card: { backgroundColor: '#ffffff', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2 },

  generatingText: { color: TEXT.primary, fontSize: 15, fontWeight: '700', textAlign: 'center' },

  // フィルター
  filterRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: '#f0f2f5',
  },
  filterChipText: { color: TEXT.secondary, fontSize: 13, fontWeight: '600' },

  // カウントダウン
  countdownCard: { backgroundColor: '#ffffff', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2 },
  countdownTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  compName: { color: TEXT.primary, fontSize: 17, fontWeight: '700' },
  compMeta: { color: TEXT.secondary, fontSize: 13, marginTop: 3 },
  daysBox: { alignItems: 'center', backgroundColor: BRAND + '12', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: BRAND + '40' },
  daysNum: { color: BRAND, fontSize: 28, fontWeight: '900', lineHeight: 30, fontVariant: ['tabular-nums'] },
  daysLabel: { color: BRAND, fontSize: 11, fontWeight: '700' },
  adviceBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: 'rgba(59,130,246,0.06)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.15)', borderRadius: 14, padding: 10 },
  adviceText: { color: TEXT.secondary, fontSize: 13, lineHeight: 20, flex: 1 },

  // エントリーバッジ
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'flex-end' },
  entryBadge: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  entryBadgeText: { fontSize: 12, fontWeight: '700' },

  // エントリーモーダル
  entryStatusBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  entryStatusDot: { width: 10, height: 10, borderRadius: 5 },
  entryStatusText: { flex: 1, fontSize: 15, fontWeight: '600' },

  // 週カード
  weekCard: { backgroundColor: '#f8f8fa', borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', borderRadius: 16, overflow: 'hidden' },
  weekHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  weekNumBadge: { minWidth: 56, height: 28, borderRadius: 14, paddingHorizontal: 8, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
  weekNumText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  weekTheme: { color: TEXT.primary, fontSize: 14, fontWeight: '700' },
  weekVolume: { color: TEXT.secondary, fontSize: 12 },
  weekBody: { paddingHorizontal: 12, paddingBottom: 12, gap: 8, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.07)' },
  keyWorkout: { color: TEXT.secondary, fontSize: 13, lineHeight: 19, paddingTop: 8 },
  sessionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  intensityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  sessionDay: { color: TEXT.primary, fontSize: 13, fontWeight: '600', width: 28 },
  sessionDetail: { color: TEXT.secondary, fontSize: 13, flex: 1, lineHeight: 19 },
  sessionDuration: { color: TEXT.hint, fontSize: 12 },

  // セクション
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { color: TEXT.primary, fontSize: 15, fontWeight: '700' },

  // 空状態
  empty: { alignItems: 'center', paddingVertical: 48, gap: 14 },
  emptyTitle: { color: TEXT.primary, fontSize: 18, fontWeight: '700' },
  emptyText: { color: TEXT.secondary, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { backgroundColor: BRAND, borderRadius: 21, paddingHorizontal: 28, paddingVertical: 14 },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 8, marginTop: -4, marginBottom: 4 },
  deleteBtnText: { fontSize: 12, color: TEXT.hint },

  // モーダル
  modalSafe: { flex: 1, backgroundColor: '#f6f6f8' },
  modalContent: { padding: 20, paddingBottom: 40, gap: 4 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle: { color: TEXT.primary, fontSize: 17, fontWeight: '700' },
  cancelText: { color: TEXT.secondary, fontSize: 16 },
  label: { color: TEXT.secondary, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: { backgroundColor: '#f8f8fa', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: TEXT.primary, fontSize: 15, borderWidth: 1, borderColor: 'rgba(59,130,246,0.25)', marginBottom: 14 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', backgroundColor: '#f0f2f5' },
  chipText: { color: TEXT.secondary, fontSize: 13, fontWeight: '600' },
  timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 14 },
  timeCol: { flex: 1, gap: 4 },
  timeInput: { backgroundColor: '#f8f8fa', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: TEXT.primary, fontSize: 18, fontWeight: '700', borderWidth: 1, borderColor: 'rgba(59,130,246,0.25)', fontVariant: ['tabular-nums'] },
  timeUnit: { color: TEXT.secondary, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  timeSep: { color: TEXT.secondary, fontSize: 24, fontWeight: '300', paddingBottom: 10 },
  generateBtn: {
    marginTop: 8,
    backgroundColor: BRAND,
    borderRadius: 21,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  generateBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  ticketCostBadge: { alignSelf: 'flex-start', borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  ticketCostBadgeText: { fontSize: 11, fontWeight: '700' },
})

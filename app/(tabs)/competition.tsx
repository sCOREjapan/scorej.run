import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useLocalSearchParams } from 'expo-router'
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
import { todayLocalISO } from '../../lib/dateLocal'
import type { CompetitionPlan, TrackEvent, AthleticsEvent, WeekPlan, UserProfile, InjuryRecord, InjuryDayPlan, TreatmentLogEntry } from '../../types'

const PROFILE_KEY = 'trackmate_my_profile'

const EVENTS: AthleticsEvent[] = [
  // トラック
  '100m', '200m', '300m', '400m', '110mH', '100mH', '300mH', '400mH',
  '800m', '1500m', '3000m', '5000m', '10000m', 'half_marathon', 'marathon', '3000mSC', '競歩',
  // フィールド・跳躍
  '走幅跳', '三段跳', '走高跳', '棒高跳',
  // 投擲
  '砲丸投', 'やり投', '円盤投', 'ハンマー投',
  // 混成（得点制）
  '十種競技', '七種競技', '八種競技',
  // リレー
  '4×100mR', '4×400mR',
]

const EVENT_CATEGORIES = [
  { key: 'sprint',   label: '短距離・ハードル', icon: '⚡', events: ['100m','200m','300m','400m','110mH','100mH','300mH','400mH'] },
  { key: 'middle',   label: '中・長距離',       icon: '🏃', events: ['800m','1500m','3000m','5000m','10000m','half_marathon','marathon','3000mSC','競歩'] },
  { key: 'jump',     label: '跳躍',             icon: '🦘', events: ['走幅跳','三段跳','走高跳','棒高跳'] },
  { key: 'throw',    label: '投擲',             icon: '🥏', events: ['砲丸投','やり投','円盤投','ハンマー投'] },
  { key: 'combined', label: '混成・リレー',     icon: '🏅', events: ['十種競技','七種競技','八種競技','4×100mR','4×400mR'] },
] as const

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
  const color = STATUS_COLOR[status]
  return (
    <View style={[styles.entryBadge, { backgroundColor: color + '22', borderColor: color }]}>
      <Text style={[styles.entryBadgeText, { color }]}>{status}</Text>
    </View>
  )
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
  const [days, setDays] = useState(0)

  useEffect(() => {
    function calc() {
      const target = new Date(competition.competition_date)
      const now = new Date()
      const diff = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      setDays(Math.max(0, diff))
    }
    calc()
    const id = setInterval(calc, 60 * 1000)
    return () => clearInterval(id)
  }, [competition.competition_date])

  return (
    <View style={styles.countdownCard}>
      <View style={styles.countdownTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.compName}>{competition.competition_name}</Text>
          <Text style={styles.compMeta}>
            {competition.event} · {competition.competition_date}
          </Text>
        </View>
        <View style={styles.daysBox}>
          <Text style={styles.daysNum}>{days}</Text>
          <Text style={styles.daysLabel}>日後</Text>
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
        <Text style={{ color: TEXT.hint, fontSize: 11 }}>タップで変更</Text>
      </View>
    </View>
  )
}

// ── 週カード ─────────────────────────────────────────────────────
function WeekCard({ week }: { week: WeekPlan }) {
  const [open, setOpen] = useState(week.week_number === 1)

  return (
    <View style={styles.weekCard}>
      <TouchableOpacity style={styles.weekHeader} onPress={() => setOpen(v => !v)} activeOpacity={0.7}>
        <View style={styles.weekNumBadge}>
          <Text style={styles.weekNumText}>
            {week.week_number === 1 ? '直前週' : `${week.week_number}週前`}
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
              <Text style={styles.sessionDay}>{s.day}</Text>
              <Text style={styles.sessionDetail} numberOfLines={2}>{s.detail}</Text>
              <Text style={styles.sessionDuration}>{s.duration_min}分</Text>
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
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>()

  const [competitions, setCompetitions] = useState<CompetitionPlan[]>([])
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
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
      Toast.show({ type: 'success', text1: '通知を有効にしました' })
    } else if (result === 'denied') {
      Toast.show({ type: 'error', text1: 'ブラウザの設定から通知を許可してください' })
    }
  }, [])

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
          const today = todayLocalISO()
          setCompetitions(all.filter(c => c.competition_date >= today))
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

  useEffect(() => { load() }, [load])

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
    Toast.show({ type: 'success', text1: `エントリー状態を「${status}」に変更しました` })
  }, [entryStatusMap])

  // ── 試合計画削除 ────────────────────────────────────────────────
  const handleDeleteComp = useCallback((comp: CompetitionPlan) => {
    Alert.alert(
      '試合計画を削除',
      `「${comp.competition_name}」を削除しますか？`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: () => {
            setCompetitions(prev => {
              const next = prev.filter(c => c.id !== comp.id)
              AsyncStorage.setItem(COMP_KEY, JSON.stringify(next)).catch(() => {})
              return next
            })
            if (selectedComp?.id === comp.id) setSelectedComp(null)
            Toast.show({ type: 'success', text1: '試合計画を削除しました' })
          },
        },
      ]
    )
  }, [selectedComp])

  // ── フィルター適用 ─────────────────────────────────────────────
  const filteredCompetitions = activeFilter === '全て'
    ? competitions
    : competitions.filter(c => (entryStatusMap[c.id] ?? '未確認') === activeFilter)

  // ── 生成 ────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!compName.trim() || !compDate.trim()) {
      Toast.show({ type: 'error', text1: '試合名と日付を入力してください' })
      return
    }
    const dateObj = new Date(compDate)
    if (isNaN(dateObj.getTime()) || dateObj <= new Date()) {
      Toast.show({ type: 'error', text1: '未来の日付を入力してください（例: 2026-05-01）' })
      return
    }

    setGenerating(true)
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

      const planData = await generateCompetitionPlan(dateObj, compName, profile, compEvent)

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

      setCompetitions(prev => {
        const next = [newPlan, ...prev]
        AsyncStorage.setItem(COMP_KEY, JSON.stringify(next)).catch(() => {})
        return next
      })
      setSelectedComp(newPlan)

      // 通知がONなら大会リマインダー + 計画作成通知
      if (notifGranted) {
        scheduleCompetitionReminder([newPlan])
        sendCompetitionPlanCreatedNotification(compName, daysUntil)
      }

      Sounds.save()
      Toast.show({ type: 'success', text1: '試合計画を作成しました' })

      setCompName('')
      setCompDate('')
      setTargetMin('')
      setTargetSec('')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '計画生成に失敗しました'
      Toast.show({ type: 'error', text1: msg })
    } finally {
      setGenerating(false)
    }
  }

  // ── 怪我プラン生成 ──────────────────────────────────────────────
  function buildTemplatePlan(totalDays: number, parts: string[], injType: string, painLevel: number): InjuryDayPlan[] {
    const safeDays = Math.max(1, totalDays)
    const acute   = Math.max(1, Math.round(safeDays * 0.2))
    const subAcute= Math.max(1, Math.round(safeDays * 0.25))
    const rehab   = Math.max(1, Math.round(safeDays * 0.35))
    const plans: InjuryDayPlan[] = []
    for (let day = 1; day <= safeDays; day++) {
      let phase = '復帰準備期'
      if (day <= acute)                        phase = '急性期'
      else if (day <= acute + subAcute)        phase = '亜急性期'
      else if (day <= acute + subAcute + rehab) phase = 'リハビリ期'

      const exercises: { name: string; detail: string }[] = []
      const avoid: string[] = []
      let advice = ''

      if (phase === '急性期') {
        exercises.push({ name: 'アイシング', detail: '15分 × 3回/日' })
        if (painLevel >= 6) exercises.push({ name: '患部挙上', detail: '心臓より高く保つ' })
        avoid.push('患部への負荷', '走ること', 'ストレッチ')
        advice = `${parts.join('・')}の${injType}の急性期です。安静と冷却を最優先にしてください。`
      } else if (phase === '亜急性期') {
        exercises.push({ name: '軽いウォーキング', detail: '痛みが出ない範囲で10〜15分' })
        exercises.push({ name: '患部周辺の軽いストレッチ', detail: '痛みが出ない角度まで、10秒×3回' })
        avoid.push('ジョギング', '急な方向転換')
        advice = '炎症が落ち着いてきています。無理のない範囲で少しずつ動かしましょう。'
      } else if (phase === 'リハビリ期') {
        exercises.push({ name: '軽ジョグ', detail: '5〜10分から徐々に延長' })
        exercises.push({ name: '筋力トレーニング', detail: '患部周辺の筋肉を鍛える（体重負荷から）' })
        avoid.push('全力スプリント', '急激な方向転換')
        advice = '段階的に負荷を上げていきましょう。痛みが戻ったらすぐに中止してください。'
      } else {
        exercises.push({ name: 'ジョグ〜ビルドアップ走', detail: '60〜80%強度で実施' })
        exercises.push({ name: '競技特有の動作確認', detail: 'スタート・切り返しなど徐々に再開' })
        avoid.push('無理な連戦')
        advice = 'もうすぐ復帰です。最終確認として競技動作を慎重に行いましょう。'
      }
      plans.push({ day, phase, exercises, avoid, advice })
    }
    return plans
  }

  async function handleSaveInjury() {
    if (!injParts.length || !injType) {
      Alert.alert('入力不足', '部位と種類を選択してください')
      return
    }
    setShowInjuryForm(false)
    setInjuryGenerating(true)
    setInjGenProgress(0)
    const timer = setInterval(() => setInjGenProgress(p => Math.min(p + 10, 85)), 400)

    const totalDays = injDaysMode === 'manual' ? (parseInt(injManualDays) || 21) : 21

    let plans: InjuryDayPlan[]
    try {
      plans = await generateInjuryRecoveryPlan({
        side: injSide, parts: injParts, injuryType: injType,
        description: injDesc, painLevel: injPain,
        hasSwelling: injSwelling, totalDays,
      })
    } catch {
      // AI失敗時はテンプレートプランを使用
      plans = buildTemplatePlan(totalDays, injParts, injType, injPain)
    }

    clearInterval(timer)
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
      const next = [record, ...injuries]
      setInjuries(next)
      await AsyncStorage.setItem(INJURY_KEY, JSON.stringify(next))
      scheduleInjuryDailyNotifications(record.id, record.startDate, record.plans).catch(() => {})
    } catch {}
    setTimeout(() => { setInjuryGenerating(false); setInjGenProgress(0) }, 700)
  }

  async function handleCompleteInjury(id: string) {
    const next = injuries.map(r => r.id === id ? { ...r, status: 'completed' as const } : r)
    setInjuries(next)
    await AsyncStorage.setItem(INJURY_KEY, JSON.stringify(next))
    setInjViewDetail(null)
    // 完治時は通知をキャンセル
    cancelInjuryNotifications(id).catch(() => {})
    Toast.show({ type: 'success', text1: '回復おめでとう！' })
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
    Toast.show({ type: 'success', text1: `${addDays}日延長しました` })
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
    Toast.show({ type: 'success', text1: '治療の記録を追加しました' })
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
        <Text style={styles.headerTitle}>{activeTab === 'race' ? '試合計画' : '怪我復帰'}</Text>
        {activeTab === 'race' && (
          <HapticTouch haptic="whoosh" style={styles.addBtn} onPress={() => { unlockAudio(); setModalVisible(true) }} activeOpacity={0.8}>
            <Ionicons name="add" size={22} color="#fff" />
          </HapticTouch>
        )}
        {activeTab === 'injury' && (
          <HapticTouch haptic="whoosh" style={styles.addBtn} onPress={() => { unlockAudio(); resetInjuryForm(); setShowInjuryForm(true) }} activeOpacity={0.8}>
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
          <Text style={{ fontSize: 13, fontWeight: activeTab === 'race' ? '800' : '600', color: activeTab === 'race' ? '#111' : '#888' }}>🏁 試合計画</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' }, activeTab === 'injury' && { backgroundColor: '#fff' }]}
          onPress={() => setActiveTab('injury')}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text style={{ fontSize: 13, fontWeight: activeTab === 'injury' ? '800' : '600', color: activeTab === 'injury' ? '#111' : '#888' }}>🩹 怪我復帰</Text>
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
            <Text style={{ color: TEXT.secondary, fontSize: 13, flex: 1 }}>大会リマインダー通知</Text>
            <TouchableOpacity
              style={{ backgroundColor: notifGranted ? NEON.green : BRAND, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 }}
              onPress={handleNotifRequest}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                {notifGranted ? '✓ 有効' : '許可する'}
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
                  ]}>{f}</Text>
                </HapticTouch>
              ))}
            </View>
          </ScrollView>
        </AnimatedSection>

        {/* 生成中スケルトン */}
        {generating && (
          <View style={styles.card}>
            <Text style={styles.generatingText}>
              {compDate ? `AIが${Math.ceil((new Date(compDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 7))}週間計画を作成中...` : 'AI計画を作成中...'}
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
              <Text style={styles.emptyTitle}>試合を登録しよう</Text>
              <Text style={styles.emptyText}>試合日を入力すれば、AIが残り日数に合わせた最適なトレーニング計画を作成します</Text>
              <HapticTouch haptic="whoosh" style={styles.emptyBtn} onPress={() => setModalVisible(true)}>
                <Text style={styles.emptyBtnText}>試合を登録する</Text>
              </HapticTouch>
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="filter-outline" size={44} color={TEXT.hint} />
              <Text style={styles.emptyTitle}>該当する試合がありません</Text>
            </View>
          )
        ) : (
          <>
            {filteredCompetitions.map(c => (
              <View key={c.id}>
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
                >
                  <Ionicons name="trash-outline" size={14} color={TEXT.hint} />
                  <Text style={styles.deleteBtnText}>削除</Text>
                </TouchableOpacity>
              </View>
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
                      {selectedComp.phases.length}週間スケジュール
                      {'  '}
                      <Text style={{ color: TEXT.hint, fontSize: 12, fontWeight: '400' }}>
                        （試合{Math.max(0, Math.ceil((new Date(selectedComp.competition_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))}日前）
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
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#111' }}>回復プランを生成中...</Text>
              <Text style={{ fontSize: 12, color: '#888' }}>AIが症状を分析しています</Text>
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
                          <Text style={{ fontSize: 12, color: '#FF6B6B', fontWeight: '700' }}>{activeInjury.side}{activeInjury.parts.join('・')} {activeInjury.injuryType}</Text>
                        </View>
                        <Text style={{ fontSize: 12, color: '#888' }}>痛み {activeInjury.painLevel}/10</Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                        <View>
                          <Text style={{ fontSize: 11, color: '#888' }}>回復まで</Text>
                          <Text style={{ fontSize: 36, fontWeight: '900', color: '#FF6B6B', letterSpacing: -1 }}>あと{daysLeft}日</Text>
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
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#555' }}>＋延長</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#34C759', alignItems: 'center' }}
                          onPress={() => Alert.alert('完治確認', '回復が完了しましたか？', [
                            { text: 'キャンセル', style: 'cancel' },
                            { text: '完治した！', onPress: () => handleCompleteInjury(activeInjury.id) }
                          ])}
                        >
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>✓ 回復した</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* 今日のプラン */}
                    {todayPlan && (
                      <View style={[styles.card, { gap: 10 }]}>
                        <Text style={{ fontSize: 11, color: BRAND, fontWeight: '700' }}>今日のプラン — Day {todayPlan.day} · {todayPlan.phase}</Text>
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
                            <Text style={{ fontSize: 12, color: '#FF6B6B', flex: 1 }}>{todayPlan.avoid.join('・')} は絶対NG</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* 治療（通院・施術）記録 */}
                    <View style={[styles.card, { gap: 10 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#111' }}>治療の記録（{treatmentLog.length}回）</Text>
                        <TouchableOpacity
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BRAND + '15', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                          onPress={() => { setTreatmentNote(''); setTreatmentModalId(activeInjury.id) }}
                        >
                          <Ionicons name="add" size={14} color={BRAND} />
                          <Text style={{ fontSize: 12, color: BRAND, fontWeight: '700' }}>治療に行った</Text>
                        </TouchableOpacity>
                      </View>
                      {treatmentLog.length === 0 ? (
                        <Text style={{ fontSize: 12, color: '#aaa' }}>まだ記録がありません</Text>
                      ) : (
                        <View style={{ gap: 6 }}>
                          {[...treatmentLog].reverse().map((t, i) => {
                            const realIndex = treatmentLog.length - 1 - i
                            return (
                              <View key={realIndex} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                                <Ionicons name="medkit-outline" size={14} color={BRAND} />
                                <Text style={{ fontSize: 12, color: '#555', flex: 1 }}>
                                  {t.date}{t.note ? `　${t.note}` : ''}
                                </Text>
                                <TouchableOpacity onPress={() => handleDeleteTreatmentLog(activeInjury.id, realIndex)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
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
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#111', marginBottom: 4 }}>全体スケジュール</Text>
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
                              <Text style={{ fontSize: 13, fontWeight: isCurrent ? '800' : '600', color: isCurrent ? '#111' : '#888' }}>{phase}</Text>
                              <Text style={{ fontSize: 11, color: '#aaa' }}>Day {firstDay}〜{lastDay}</Text>
                            </View>
                            {isDone && <Text style={{ fontSize: 11, color: '#34C759', fontWeight: '700' }}>完了</Text>}
                            {isCurrent && <Text style={{ fontSize: 11, color: '#FF6B6B', fontWeight: '700' }}>今ここ</Text>}
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
              <Text style={{ fontSize: 18, fontWeight: '800', color: '#111' }}>怪我は記録されていません</Text>
              <Text style={{ fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 22 }}>怪我をしたときに記録すると{'\n'}AIが回復プランを自動で作ります</Text>
              <TouchableOpacity
                style={{ backgroundColor: '#FF6B6B', borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14, marginTop: 8 }}
                onPress={() => { resetInjuryForm(); setShowInjuryForm(true) }}
              >
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>怪我を記録する</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 過去の怪我履歴 */}
          {injuries.filter(r => r.status === 'completed').length > 0 && (
            <View style={[styles.card, { gap: 6, marginTop: 8 }]}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#111', marginBottom: 4 }}>過去の怪我</Text>
              {injuries.filter(r => r.status === 'completed').map(r => (
                <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#e8eaed' }}>
                  <Text style={{ fontSize: 18 }}>✅</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#34C759' }}>{r.side}{r.parts.join('・')} {r.injuryType}</Text>
                    <Text style={{ fontSize: 11, color: '#888' }}>{r.startDate} · {r.totalDays}日間</Text>
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
                  <Text style={styles.cancelText}>キャンセル</Text>
                </TouchableOpacity>
                <Text style={styles.modalTitle}>怪我を記録</Text>
                <View style={{ width: 60 }} />
              </View>

              {/* 左右 */}
              <Text style={styles.label}>左右</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                {['左', '右', '両方'].map(s => (
                  <TouchableOpacity key={s} onPress={() => setInjSide(s)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: injSide === s ? '#FF6B6B' : '#ddd', backgroundColor: injSide === s ? '#FF6B6B12' : '#fff', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '700', color: injSide === s ? '#FF6B6B' : '#888' }}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 部位 */}
              <Text style={styles.label}>部位（複数可）</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {['ハムストリング','膝','ふくらはぎ','アキレス腱','足首','腰','股関節','大腿四頭筋','脛','肩','肘','その他'].map(p => {
                  const sel = injParts.includes(p)
                  return (
                    <TouchableOpacity key={p} onPress={() => setInjParts(prev => sel ? prev.filter(x => x !== p) : [...prev, p])}
                      style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? '#FF6B6B' : '#ddd', backgroundColor: sel ? '#FF6B6B12' : '#fff' }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: sel ? '#FF6B6B' : '#888' }}>{p}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>

              {/* 種類 */}
              {injDaysMode === 'manual' ? (
                <>
                  <Text style={styles.label}>怪我の名前・診断名</Text>
                  <TextInput
                    value={injType} onChangeText={setInjType}
                    placeholder="例：肉離れ（グレード2）、腸脛靭帯炎 など"
                    placeholderTextColor="#aaa"
                    style={[styles.input, { marginBottom: 16 }]}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.label}>種類</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {['肉離れ','捻挫','打撲','腱炎','疲労骨折疑い','シンスプリント','その他'].map(t => {
                      const sel = injType === t
                      return (
                        <TouchableOpacity key={t} onPress={() => setInjType(t)}
                          style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? '#FF6B6B' : '#ddd', backgroundColor: sel ? '#FF6B6B12' : '#fff' }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: sel ? '#FF6B6B' : '#888' }}>{t}</Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                </>
              )}

              {/* 症状 */}
              <Text style={styles.label}>症状の説明（任意）</Text>
              <TextInput
                value={injDesc} onChangeText={setInjDesc}
                placeholder="例：走中にブチっという感覚、歩行時も痛み"
                placeholderTextColor="#aaa"
                multiline style={[styles.input, { minHeight: 70 }]}
              />

              {/* 痛みの強さ */}
              <Text style={styles.label}>痛みの強さ（{injPain}/10）</Text>
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
              <Text style={styles.label}>腫れ</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                {[{ label: 'あり', val: true }, { label: 'なし', val: false }].map(({ label, val }) => (
                  <TouchableOpacity key={label} onPress={() => setInjSwelling(val)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5,
                      borderColor: injSwelling === val ? '#FF6B6B' : '#ddd',
                      backgroundColor: injSwelling === val ? '#FF6B6B12' : '#fff', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '700', color: injSwelling === val ? '#FF6B6B' : '#888' }}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 日数モード */}
              <Text style={styles.label}>回復日数</Text>
              <View style={{ gap: 8, marginBottom: 16 }}>
                {([['ai', 'AIに診断させる（推奨）'], ['manual', '自分で入力']] as const).map(([mode, label]) => (
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
                      {mode === 'ai' && <Text style={{ fontSize: 11, color: '#888' }}>症状から回復日数を推定して全プランを生成</Text>}
                    </View>
                  </TouchableOpacity>
                ))}
                {injDaysMode === 'manual' && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
                    <TextInput
                      value={injManualDays} onChangeText={setInjManualDays}
                      keyboardType="number-pad" style={[styles.input, { width: 70, textAlign: 'center', marginBottom: 0 }]}
                    />
                    <Text style={{ color: '#555' }}>日間</Text>
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={{ backgroundColor: '#FF6B6B', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8 }}
                onPress={handleSaveInjury}
                disabled={!injParts.length || !injType}
              >
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>保存してプランを生成</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── 延長モーダル ── */}
      <Modal visible={showExtModal} transparent animationType="fade">
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 32 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, gap: 16 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: '#111' }}>日数を延長</Text>
            <Text style={{ fontSize: 13, color: '#888' }}>追加したい日数を入力してください</Text>
            {/* クイック選択 */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {['7', '14', '21'].map(d => (
                <TouchableOpacity key={d} onPress={() => setInjExtDays(d)}
                  style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5,
                    borderColor: injExtDays === d ? '#FF6B6B' : '#ddd',
                    backgroundColor: injExtDays === d ? '#FF6B6B12' : '#fff', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '700', color: injExtDays === d ? '#FF6B6B' : '#888' }}>+{d}日</Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* カスタム入力 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f8f8fa', borderRadius: 12, borderWidth: 1.5, borderColor: '#e0e0e0', paddingHorizontal: 14, paddingVertical: 4 }}>
              <Text style={{ fontSize: 13, color: '#888', flex: 1 }}>カスタム日数</Text>
              <TextInput
                value={injExtDays}
                onChangeText={v => setInjExtDays(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                style={{ fontSize: 20, fontWeight: '900', color: '#FF6B6B', width: 60, textAlign: 'right' }}
                placeholder="0"
                placeholderTextColor="#ccc"
                maxLength={3}
              />
              <Text style={{ fontSize: 13, color: '#888' }}>日</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' }} onPress={() => setShowExtModal(false)}>
                <Text style={{ color: '#888', fontWeight: '700' }}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: parseInt(injExtDays) > 0 ? '#FF6B6B' : '#ddd', alignItems: 'center' }}
                onPress={() => extTargetId && parseInt(injExtDays) > 0 && handleExtendInjury(extTargetId)}
              >
                <Text style={{ color: '#fff', fontWeight: '800' }}>延長する</Text>
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
              <Text style={{ fontSize: 17, fontWeight: '800', color: '#111' }}>治療の記録を追加</Text>
              <Text style={{ fontSize: 13, color: '#888' }}>今日、治療（通院・施術など）に行きましたか？メモは任意です。</Text>
              <TextInput
                value={treatmentNote}
                onChangeText={setTreatmentNote}
                placeholder="例: 整形外科でリハビリ（任意）"
                placeholderTextColor="#ccc"
                style={{ backgroundColor: '#f8f8fa', borderRadius: 12, borderWidth: 1.5, borderColor: '#e0e0e0', paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#111' }}
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' }} onPress={() => setTreatmentModalId(null)}>
                  <Text style={{ color: '#888', fontWeight: '700' }}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: BRAND, alignItems: 'center' }}
                  onPress={() => treatmentModalId && handleAddTreatmentLog(treatmentModalId, treatmentNote)}
                >
                  <Text style={{ color: '#fff', fontWeight: '800' }}>記録する</Text>
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
                  <Text style={styles.cancelText}>キャンセル</Text>
                </TouchableOpacity>
                <Text style={styles.modalTitle}>試合を登録</Text>
                <View style={{ width: 60 }} />
              </View>

              <Text style={styles.label}>試合名</Text>
              <TextInput
                style={styles.input}
                value={compName}
                onChangeText={setCompName}
                placeholder="例: 春季陸上競技大会"
                placeholderTextColor="#9ca3af"
              />

              <Text style={styles.label}>試合日</Text>
              {Platform.OS === 'web' ? (
                // Web版はブラウザネイティブの日付入力を使う（Apple仕様のピッカーは非表示）
                React.createElement('input', {
                  type: 'date',
                  value: compDate || '',
                  min: todayLocalISO(),
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
                  {compDate || '日付を選択'}
                </Text>
              </TouchableOpacity>
              )}
              {Platform.OS !== 'web' && showDatePicker && (
                <>
                  <DateTimePicker
                    value={compDate ? new Date(compDate) : new Date()}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    minimumDate={new Date()}
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
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>完了</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              <Text style={styles.label}>種目</Text>
              <View style={{ marginBottom: 16, gap: 6 }}>
                {EVENT_CATEGORIES.map(cat => {
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
                              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{compEvent}</Text>
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
                              <Text style={[styles.chipText, compEvent === e && { color: '#FFFFFF' }]}>{e}</Text>
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
                  <Text style={styles.label}>目標記録（m・任意）</Text>
                  <View style={styles.timeRow}>
                    <TextInput
                      style={[styles.timeInput, { flex: 1, textAlign: 'left', paddingHorizontal: 12 }]}
                      value={targetDistM}
                      onChangeText={setTargetDistM}
                      keyboardType="decimal-pad"
                      placeholder="例: 7.50"
                      placeholderTextColor="#9ca3af"
                    />
                    <Text style={[styles.timeUnit, { marginLeft: 8 }]}>m</Text>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.label}>目標タイム（任意）</Text>
                  <View style={styles.timeRow}>
                    <View style={styles.timeCol}>
                      <Text style={styles.timeUnit}>分</Text>
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
                      <Text style={styles.timeUnit}>秒</Text>
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

              <HapticTouch haptic="save" style={styles.generateBtn} onPress={handleGenerate} activeOpacity={0.85}>
                <Ionicons name="sparkles" size={20} color="#fff" />
                <Text style={styles.generateBtnText}>AIで計画を作成する</Text>
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
                <Text style={styles.cancelText}>キャンセル</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>エントリー状態</Text>
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
                      {status}
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
    </SafeAreaView>
    </View>
  )
}

// ── 今日のメニューカード ──────────────────────────────────────────
const DOW_FULL = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜']

function TodayWorkoutCard({ competition }: { competition: CompetitionPlan }) {
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
    ? '試合当日: 3時間前までに消化の良い炭水化物（おにぎり・バナナ）を。試合直前は水分補給のみ。'
    : daysUntil <= 2
    ? '試合直前: 消化の良いもの（うどん・ご飯・鶏肉）を中心に。揚げ物・乳製品・高脂質は控えよう。'
    : daysUntil <= 7
    ? '試合1週間前: 炭水化物の割合を増やしグリコーゲンを蓄えよう。脂質・食物繊維は控えめに。'
    : null

  return (
    <View style={tw.card}>
      {/* 今日 */}
      <View style={tw.sectionRow}>
        <Ionicons name="today" size={16} color={BRAND} />
        <Text style={tw.sectionTitle}>今日のメニュー（{todayDow}）</Text>
      </View>
      {todaySession ? (
        <View style={tw.sessionBox}>
          <View style={[tw.intensityBar, { backgroundColor: INTENSITY_COLORS[todaySession.intensity] ?? '#888' }]} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={tw.sessionType}>{todaySession.type}</Text>
              <Text style={tw.sessionDur}>{todaySession.duration_min}分</Text>
            </View>
            <Text style={tw.sessionDetail}>{todaySession.detail}</Text>
          </View>
        </View>
      ) : (
        <View style={tw.restBox}>
          <Text style={{ fontSize: 18 }}>💤</Text>
          <Text style={tw.restText}>今日は休養日</Text>
        </View>
      )}

      {/* 明日 */}
      <View style={[tw.sectionRow, { marginTop: 10 }]}>
        <Ionicons name="calendar-outline" size={14} color={TEXT.secondary} />
        <Text style={[tw.sectionTitle, { color: TEXT.secondary, fontSize: 12, fontWeight: '600' }]}>
          明日（{tomorrowDow}）
        </Text>
      </View>
      {tomorrowSession ? (
        <View style={[tw.sessionBox, { opacity: 0.72 }]}>
          <View style={[tw.intensityBar, { backgroundColor: INTENSITY_COLORS[tomorrowSession.intensity] ?? '#888' }]} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
              <Text style={[tw.sessionType, { fontSize: 12 }]}>{tomorrowSession.type}</Text>
              <Text style={tw.sessionDur}>{tomorrowSession.duration_min}分</Text>
            </View>
            <Text style={tw.sessionDetail} numberOfLines={1}>{tomorrowSession.detail}</Text>
          </View>
        </View>
      ) : (
        <Text style={{ color: TEXT.hint, fontSize: 13, paddingLeft: 4 }}>明日は休養日</Text>
      )}

      {/* 今週テーマ */}
      <View style={tw.themeBox}>
        <Text style={tw.themeLabel}>今週のテーマ</Text>
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
  emptyText: { color: TEXT.hint, fontSize: 13, textAlign: 'center', lineHeight: 20 },
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
})

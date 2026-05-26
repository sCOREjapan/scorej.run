import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
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
} from '../../lib/notifications'

const COMP_KEY = 'trackmate_competitions'
const ENTRY_KEY = 'trackmate_entry_status'
import { generateCompetitionPlan } from '../../lib/claude'
import type { CompetitionPlan, TrackEvent, AthleticsEvent, WeekPlan, UserProfile } from '../../types'

const PROFILE_KEY = 'trackmate_my_profile'

const EVENTS: AthleticsEvent[] = [
  // トラック
  '100m', '200m', '400m', '110mH', '100mH', '400mH',
  '800m', '1500m', '3000m', '5000m', '10000m', '3000mSC', '競歩',
  // フィールド・跳躍
  '走幅跳', '三段跳', '走高跳', '棒高跳',
  // 投擲
  '砲丸投', 'やり投', '円盤投', 'ハンマー投',
]

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
      style={{ height, width: width as number, borderRadius: radius, backgroundColor: '#e8eaed', opacity }}
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
          <Text style={styles.weekNumText}>W{week.week_number}</Text>
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

  // フィルター
  const [activeFilter, setActiveFilter] = useState<FilterOption>('全て')

  // フォーム
  const [compName,       setCompName]       = useState('')
  const [compDate,       setCompDate]       = useState('')
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [compEvent,      setCompEvent]      = useState<AthleticsEvent>('400m')
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
      const [rawComp, rawEntry, rawProfile] = await Promise.all([
        AsyncStorage.getItem(COMP_KEY),
        AsyncStorage.getItem(ENTRY_KEY),
        AsyncStorage.getItem(PROFILE_KEY),
      ])
      if (rawComp) {
        try {
          const all: CompetitionPlan[] = JSON.parse(rawComp)
          const today = new Date().toISOString().slice(0, 10)
          setCompetitions(all.filter(c => c.competition_date >= today))
        } catch {}
      }
      if (rawEntry) {
        try { setEntryStatusMap(JSON.parse(rawEntry)) } catch {}
      }
      if (rawProfile) {
        try { setUserProfile(JSON.parse(rawProfile)) } catch {}
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── エントリー状態保存 ─────────────────────────────────────────
  const saveEntryStatus = useCallback(async (compId: string, status: EntryStatus) => {
    const next: EntryStatusMap = { ...entryStatusMap, [compId]: status }
    setEntryStatusMap(next)
    await AsyncStorage.setItem(ENTRY_KEY, JSON.stringify(next))
    Sounds.tap()
    setEntryModalComp(null)
    Toast.show({ type: 'success', text1: `エントリー状態を「${status}」に変更しました` })
  }, [entryStatusMap])

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
        event_category: ['100m','200m','400m','110mH','100mH','400mH'].includes(compEvent) ? 'sprint' : 'middle',
        personal_best_ms: userProfile?.personal_best_ms,
        target_time_ms,
        experience_years: userProfile?.experience_years,
        created_at: new Date().toISOString(),
      }

      const planData = await generateCompetitionPlan(dateObj, compName, profile)

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

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>試合モード</Text>
        <HapticTouch haptic="whoosh" style={styles.addBtn} onPress={() => { unlockAudio(); setModalVisible(true) }} activeOpacity={0.8}>
          <Ionicons name="add" size={22} color="#fff" />
        </HapticTouch>
      </View>

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
              <HapticTouch
                key={c.id}
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
              <TouchableOpacity
                style={[styles.input, { justifyContent: 'center' }]}
                onPress={() => setShowDatePicker(true)}
                activeOpacity={0.7}
              >
                <Text style={{ color: compDate ? TEXT.primary : '#9ca3af', fontSize: 15 }}>
                  {compDate || '日付を選択'}
                </Text>
              </TouchableOpacity>
              {showDatePicker && (
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
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <View style={styles.chipRow}>
                  {EVENTS.map(e => (
                    <HapticTouch
                      key={e}
                      haptic="toggleOn"
                      style={[styles.chip, compEvent === e && { backgroundColor: BRAND, borderColor: BRAND }]}
                      onPress={() => setCompEvent(e)}
                    >
                      <Text style={[styles.chipText, compEvent === e && { color: '#FFFFFF' }]}>{e}</Text>
                    </HapticTouch>
                  ))}
                </View>
              </ScrollView>

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
  const weeksLeft = Math.max(1, Math.ceil(daysUntil / 7))

  const currentWeek = competition.phases.find(p => p.week_number === weeksLeft)
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
  card:       { backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16, gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { color: TEXT.primary, fontSize: 14, fontWeight: '800' },
  sessionBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#f8f8fa', borderRadius: 10, padding: 12 },
  intensityBar: { width: 4, alignSelf: 'stretch', borderRadius: 2, minHeight: 36 },
  sessionType:  { color: TEXT.primary, fontSize: 13, fontWeight: '700' },
  sessionDur:   { color: TEXT.hint, fontSize: 12 },
  sessionDetail:{ color: TEXT.secondary, fontSize: 13, lineHeight: 19 },
  restBox:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f0f2f5', borderRadius: 10, padding: 10 },
  restText:   { color: TEXT.secondary, fontSize: 13, fontWeight: '600' },
  themeBox:   { backgroundColor: BRAND + '08', borderRadius: 10, borderWidth: 1, borderColor: BRAND + '20', padding: 10, gap: 3 },
  themeLabel: { color: BRAND, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  themeText:  { color: TEXT.primary, fontSize: 13, fontWeight: '700' },
  keyText:    { color: TEXT.secondary, fontSize: 12 },
  dietBox:    { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: 'rgba(245,158,11,0.08)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)', borderRadius: 10, padding: 10 },
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
  card: { backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },

  generatingText: { color: TEXT.primary, fontSize: 15, fontWeight: '700', textAlign: 'center' },

  // フィルター
  filterRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: '#f0f2f5',
  },
  filterChipText: { color: TEXT.secondary, fontSize: 13, fontWeight: '600' },

  // カウントダウン
  countdownCard: { backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  countdownTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  compName: { color: TEXT.primary, fontSize: 17, fontWeight: '700' },
  compMeta: { color: TEXT.secondary, fontSize: 13, marginTop: 3 },
  daysBox: { alignItems: 'center', backgroundColor: BRAND + '12', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: BRAND + '40' },
  daysNum: { color: BRAND, fontSize: 28, fontWeight: '900', lineHeight: 30 },
  daysLabel: { color: BRAND, fontSize: 11, fontWeight: '700' },
  adviceBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: 'rgba(59,130,246,0.06)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.15)', borderRadius: 10, padding: 10 },
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
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  entryStatusDot: { width: 10, height: 10, borderRadius: 5 },
  entryStatusText: { flex: 1, fontSize: 15, fontWeight: '600' },

  // 週カード
  weekCard: { backgroundColor: '#f8f8fa', borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', borderRadius: 10, overflow: 'hidden' },
  weekHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  weekNumBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
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
  emptyBtn: { backgroundColor: BRAND, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14 },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },

  // モーダル
  modalSafe: { flex: 1, backgroundColor: '#f6f6f8' },
  modalContent: { padding: 20, paddingBottom: 40, gap: 4 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle: { color: TEXT.primary, fontSize: 17, fontWeight: '700' },
  cancelText: { color: TEXT.secondary, fontSize: 16 },
  label: { color: TEXT.secondary, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: { backgroundColor: '#f8f8fa', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: TEXT.primary, fontSize: 15, borderWidth: 1, borderColor: 'rgba(59,130,246,0.25)', marginBottom: 14 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', backgroundColor: '#f0f2f5' },
  chipText: { color: TEXT.secondary, fontSize: 13, fontWeight: '600' },
  timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 14 },
  timeCol: { flex: 1, gap: 4 },
  timeInput: { backgroundColor: '#f8f8fa', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: TEXT.primary, fontSize: 18, fontWeight: '700', borderWidth: 1, borderColor: 'rgba(59,130,246,0.25)' },
  timeUnit: { color: TEXT.secondary, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  timeSep: { color: TEXT.secondary, fontSize: 24, fontWeight: '300', paddingBottom: 10 },
  generateBtn: {
    marginTop: 8,
    backgroundColor: BRAND,
    borderRadius: 14,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  generateBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
})

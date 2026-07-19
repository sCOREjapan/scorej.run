// app/(tabs)/calendar.tsx — カレンダー（自由入力予定対応）
import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Animated, Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { TEXT, SURFACE, SURFACE2, DIVIDER, NEON, BRAND } from '../../lib/theme'
import { useTheme } from '../../context/ThemeContext'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Sounds, unlockAudio } from '../../lib/sounds'
import HapticTouch from '../../components/HapticTouch'
import Toast from 'react-native-toast-message'
import { scheduleEventReminders, cancelEventReminders } from '../../lib/notifications'

// ── ストレージキー ──────────────────────────────────────────
const SESSIONS_KEY    = 'trackmate_sessions'
const RACE_KEY        = 'trackmate_race_records'
const WORKOUT_KEY     = 'trackmate_workout_menus'
const COMPETITION_KEY = 'trackmate_competitions'
const EVENTS_KEY      = 'trackmate_calendar_events'

// ── 型定義 ─────────────────────────────────────────────────
type DotType = 'race' | 'gps' | 'workout' | 'competition' | 'event'

type EventCategory = 'memo' | 'competition' | 'rest' | 'medical' | 'other'

interface CalendarEvent {
  id: string
  date: string         // YYYY-MM-DD
  title: string
  category: EventCategory
  notes?: string
  created_at: string
}

type DayRecord = {
  type: DotType
  label: string
  sub?: string
  eventId?: string     // CalendarEvent の場合のみ
  fatigue?: number     // 練習強度（1-10）
}

// ── カテゴリ定義 ────────────────────────────────────────────
const EVENT_CATEGORIES: { value: EventCategory; label: string; emoji: string; color: string }[] = [
  { value: 'memo',        label: '練習メモ',   emoji: '📝', color: '#9B6BFF' },
  { value: 'competition', label: '大会・記録会', emoji: '🏁', color: '#FFD700' },
  { value: 'rest',        label: '休養日',     emoji: '😴', color: '#4A9FFF' },
  { value: 'medical',     label: '通院・治療', emoji: '🏥', color: '#FF3B30' },
  { value: 'other',       label: 'その他',     emoji: '✨', color: '#888'    },
]

function getCatInfo(cat: EventCategory) {
  return EVENT_CATEGORIES.find(c => c.value === cat) ?? EVENT_CATEGORIES[4]
}

// ── ドットカラー ────────────────────────────────────────────
const DOT_COLORS: Record<DotType, string> = {
  race:        '#E53935',
  gps:         '#2196F3',
  workout:     '#4CAF50',
  competition: '#FFC107',
  event:       '#9B6BFF',
}
const DOT_LABELS: Record<DotType, string> = {
  race:        'タイム計測',
  gps:         'GPS練習',
  workout:     '練習メニュー',
  competition: '大会',
  event:       '予定',
}
const DOT_ICONS: Record<DotType, string> = {
  race:        'timer-outline',
  gps:         'navigate-outline',
  workout:     'barbell-outline',
  competition: 'trophy-outline',
  event:       'calendar-outline',
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function getDaysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate() }
function getFirstDow(y: number, m: number)    { return new Date(y, m, 1).getDay() }

/** 疲労度（1-10）→ セル背景色 */
function getIntensityBg(fatigue: number): string {
  if (fatigue <= 2) return '#DCFCE7'  // 超軽め: 薄緑
  if (fatigue <= 4) return '#BBF7D0'  // 軽め: 緑
  if (fatigue <= 6) return '#FEF9C3'  // 中程度: 薄黄
  if (fatigue <= 8) return '#FED7AA'  // きつい: 薄オレンジ
  return '#FECACA'                     // 超きつい: 薄赤
}

// ────────────────────────────────────────────────────────────
// AddEventModal
// ────────────────────────────────────────────────────────────
function AddEventModal({
  visible, date, editEvent, onClose, onSaved,
}: {
  visible: boolean
  date: string
  editEvent: CalendarEvent | null
  onClose: () => void
  onSaved: () => void
}) {
  const [title,    setTitle]    = useState('')
  const [category, setCategory] = useState<EventCategory>('memo')
  const [notes,    setNotes]    = useState('')
  const [saving,   setSaving]   = useState(false)
  const slideAnim = useRef(new Animated.Value(400)).current

  useEffect(() => {
    if (visible) {
      if (editEvent) {
        setTitle(editEvent.title)
        setCategory(editEvent.category)
        setNotes(editEvent.notes ?? '')
      } else {
        setTitle(''); setCategory('memo'); setNotes('')
      }
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 11, useNativeDriver: true }).start()
    } else {
      slideAnim.setValue(400)
    }
  }, [visible, editEvent])

  async function handleSave() {
    if (!title.trim()) {
      Toast.show({ type: 'error', text1: 'タイトルを入力してください' })
      return
    }
    unlockAudio(); setSaving(true)
    try {
      const raw = await AsyncStorage.getItem(EVENTS_KEY)
      let events: CalendarEvent[] = []
      try { if (raw) events = JSON.parse(raw) } catch {}  // データ破損でも新規保存を継続
      const savedId   = editEvent ? editEvent.id : `ev_${Date.now()}`
      const savedDate = editEvent ? editEvent.date : date
      if (editEvent) {
        events = events.map(e => e.id === editEvent.id
          ? { ...e, title: title.trim(), category, notes: notes.trim() || undefined }
          : e
        )
      } else {
        events.push({
          id: savedId,
          date,
          title: title.trim(),
          category,
          notes: notes.trim() || undefined,
          created_at: new Date().toISOString(),
        })
      }
      await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(events))
      // 前日夜＋当日朝のリマインダーを予約（休養日・大会・通院など全予定対象）
      scheduleEventReminders(savedId, savedDate, title.trim()).catch(() => {})
      Sounds.save()
      Toast.show({ type: 'success', text1: editEvent ? '予定を更新しました ✓' : '予定を追加しました ✓', visibilityTime: 1600 })
      onSaved(); onClose()
    } catch {
      Toast.show({ type: 'error', text1: '保存に失敗しました' })
    } finally { setSaving(false) }
  }

  const formattedDate = date.replace(/-/g, '/').slice(5) // MM/DD

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <TouchableOpacity style={m.overlay} activeOpacity={1} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={m.kvWrap}
        pointerEvents="box-none"
      >
        <Animated.View style={[m.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={m.handle} />

          {/* ヘッダー */}
          <View style={m.header}>
            <View>
              <Text style={m.title}>{editEvent ? '予定を編集' : '予定を追加'}</Text>
              <Text style={m.dateLbl}>{formattedDate}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={TEXT.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* カテゴリ */}
            <Text style={m.label}>カテゴリ</Text>
            <View style={m.catRow}>
              {EVENT_CATEGORIES.map(cat => {
                const active = category === cat.value
                return (
                  <HapticTouch
                    key={cat.value}
                    haptic="toggleOn"
                    activeOpacity={0.7}
                    onPress={() => { unlockAudio(); setCategory(cat.value) }}
                    style={[m.catBtn, active && { backgroundColor: cat.color + '22', borderColor: cat.color }]}
                  >
                    <Text style={m.catEmoji}>{cat.emoji}</Text>
                    <Text style={[m.catLabel, { color: active ? cat.color : TEXT.secondary }]}>{cat.label}</Text>
                  </HapticTouch>
                )
              })}
            </View>

            {/* タイトル */}
            <Text style={m.label}>タイトル</Text>
            <TextInput
              style={m.input}
              value={title}
              onChangeText={setTitle}
              placeholder="例: 県大会・体幹トレ・病院 など"
              placeholderTextColor={TEXT.hint}
              maxLength={50}
              autoFocus
            />

            {/* メモ */}
            <Text style={m.label}>メモ（任意）</Text>
            <TextInput
              style={[m.input, m.inputMulti]}
              value={notes}
              onChangeText={setNotes}
              placeholder="詳細・場所・持ち物など..."
              placeholderTextColor={TEXT.hint}
              multiline
              numberOfLines={3}
              maxLength={200}
            />

            {/* 保存 */}
            <HapticTouch
              haptic="save"
              style={[m.saveBtn, saving && { opacity: 0.6 }]}
              activeOpacity={0.85}
              onPress={handleSave}
              disabled={saving}
            >
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={m.saveTxt}>{saving ? '保存中...' : editEvent ? '更新する' : '追加する'}</Text>
            </HapticTouch>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ────────────────────────────────────────────────────────────
// CalendarScreen
// ────────────────────────────────────────────────────────────
export default function CalendarScreen() {
  const today = new Date()
  const [year,         setYear]         = useState(today.getFullYear())
  const [month,        setMonth]        = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState(toYMD(today))
  const [dayMap,       setDayMap]       = useState<Record<string, DotType[]>>({})
  const [recordMap,    setRecordMap]    = useState<Record<string, DayRecord[]>>({})
  const [colorMap,     setColorMap]     = useState<Record<string, string>>({})   // 日付 → 強度色
  const [modalVisible, setModalVisible] = useState(false)
  const [editEvent,    setEditEvent]    = useState<CalendarEvent | null>(null)
  const fadeAnim = useRef(new Animated.Value(1)).current

  const load = useCallback(async () => {
    try {
      const [sessionsRaw, raceRaw, workoutRaw, compRaw, eventsRaw] = await Promise.all([
        AsyncStorage.getItem(SESSIONS_KEY),
        AsyncStorage.getItem(RACE_KEY),
        AsyncStorage.getItem(WORKOUT_KEY),
        AsyncStorage.getItem(COMPETITION_KEY),
        AsyncStorage.getItem(EVENTS_KEY),
      ])

      const newDayMap:    Record<string, DotType[]>    = {}
      const newRecordMap: Record<string, DayRecord[]> = {}
      const newColorMap:  Record<string, string>       = {}
      // 同日複数セッション時は最高疲労度を採用
      const maxFatigueMap: Record<string, number>      = {}

      function addDot(date: string, type: DotType, label: string, sub?: string, eventId?: string, fatigue?: number) {
        if (!date) return
        const ymd = date.slice(0, 10)
        if (!newDayMap[ymd]) newDayMap[ymd] = []
        if (!newDayMap[ymd].includes(type)) newDayMap[ymd].push(type)
        if (!newRecordMap[ymd]) newRecordMap[ymd] = []
        newRecordMap[ymd].push({ type, label, sub, eventId, fatigue })
      }

      // 練習セッション
      if (sessionsRaw) {
        try {
          (JSON.parse(sessionsRaw) as any[]).forEach(s => {
            const fatigue = s.fatigue_level ?? 5
            addDot(
              s.session_date ?? s.created_at, 'gps',
              s.session_type ?? 'GPS練習',
              s.distance_m ? `${(s.distance_m / 1000).toFixed(1)}km` : undefined,
              undefined, fatigue,
            )
            const ymd = (s.session_date ?? s.created_at ?? '').slice(0, 10)
            if (ymd && (maxFatigueMap[ymd] === undefined || fatigue > maxFatigueMap[ymd])) {
              maxFatigueMap[ymd] = fatigue
              newColorMap[ymd]   = getIntensityBg(fatigue)
            }
          })
        } catch {}
      }
      // タイム計測
      if (raceRaw) {
        try {
          (JSON.parse(raceRaw) as any[]).forEach(r =>
            addDot(r.date ?? r.created_at, 'race', r.event ?? 'タイム計測', r.time)
          )
        } catch {}
      }
      // 練習メニュー
      if (workoutRaw) {
        try {
          (JSON.parse(workoutRaw) as any[]).forEach(w =>
            addDot(w.date ?? w.created_at, 'workout', w.title ?? '練習メニュー')
          )
        } catch {}
      }
      // 大会
      if (compRaw) {
        try {
          (JSON.parse(compRaw) as any[]).forEach(c =>
            addDot(c.date ?? c.competition_date ?? c.created_at, 'competition', c.name ?? '大会', c.event)
          )
        } catch {}
      }
      // 自由入力予定
      if (eventsRaw) {
        try {
          (JSON.parse(eventsRaw) as CalendarEvent[]).forEach(ev => {
            const cat = getCatInfo(ev.category)
            addDot(ev.date, 'event', `${cat.emoji} ${ev.title}`, ev.notes, ev.id)
          })
        } catch {}
      }

      setDayMap(newDayMap)
      setRecordMap(newRecordMap)
      setColorMap(newColorMap)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])

  // タブに戻ったときも再読み込み（他の画面で記録を追加した場合に反映）
  useFocusEffect(useCallback(() => { load() }, [load]))

  async function deleteEvent(eventId: string) {
    try {
      const raw = await AsyncStorage.getItem(EVENTS_KEY)
      if (!raw) return
      const events: CalendarEvent[] = JSON.parse(raw)
      await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(events.filter(e => e.id !== eventId)))
      cancelEventReminders(eventId).catch(() => {})
      Sounds.delete()
      Toast.show({ type: 'success', text1: '予定を削除しました', visibilityTime: 1400 })
      load()
    } catch { /* ignore */ }
  }

  async function openEdit(eventId: string) {
    try {
      const raw = await AsyncStorage.getItem(EVENTS_KEY)
      if (!raw) return
      const events: CalendarEvent[] = JSON.parse(raw)
      const ev = events.find(e => e.id === eventId)
      if (!ev) return
      setEditEvent(ev)
      setModalVisible(true)
    } catch { /* ignore */ }
  }

  // 過去制限なし・未来は5ヶ月先まで
  const maxYear  = today.getFullYear() + Math.floor((today.getMonth() + 5) / 12)
  const maxMonth = (today.getMonth() + 5) % 12
  const isAtMax  = year > maxYear || (year === maxYear && month >= maxMonth)
  const isAtMin  = year === 2020 && month === 0  // 2020年1月より前には戻れない

  function changeMonth(delta: number) {
    if (delta > 0 && isAtMax) return   // 5ヶ月先以上は進めない
    if (delta < 0 && isAtMin) return
    Animated.timing(fadeAnim, { toValue: 0, duration: 110, useNativeDriver: true }).start(() => {
      let nm = month + delta, ny = year
      if (nm < 0)  { nm = 11; ny -= 1 }
      if (nm > 11) { nm = 0;  ny += 1 }
      setMonth(nm)
      setYear(ny)
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start()
    })
  }

  const todayYMD     = toYMD(today)
  const daysInMonth  = getDaysInMonth(year, month)
  const firstDow     = getFirstDow(year, month)
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const monthPrefix    = `${year}-${String(month + 1).padStart(2, '0')}`
  const monthEntries   = Object.entries(dayMap).filter(([d]) => d.startsWith(monthPrefix))
  const trainingCount  = Object.keys(colorMap).filter(d => d.startsWith(monthPrefix)).length
  const restCount      = monthEntries.filter(([, d]) => d.includes('event')).length  // 予定件数

  const { colors } = useTheme()
  // 予定（event/competition）を先頭に、練習記録は後ろに並べる
  const selectedRecords = [...(recordMap[selectedDate] ?? [])].sort((a, b) => {
    const priority = (t: DotType) => t === 'event' ? 0 : t === 'competition' ? 1 : t === 'race' ? 2 : t === 'workout' ? 3 : 4
    return priority(a.type) - priority(b.type)
  })
  const selectedIsEvent = (r: DayRecord) => r.type === 'event'

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={st.scroll}>

          {/* ── 月ナビ ── */}
          <View style={st.monthNav}>
            <HapticTouch haptic="tabSwitch" onPress={() => changeMonth(-1)} style={[st.navBtn, { backgroundColor: colors.surface2, borderColor: colors.border, opacity: isAtMin ? 0.3 : 1 }]} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </HapticTouch>
            <Text style={[st.monthTitle, { color: colors.text }]}>{year}年{month + 1}月</Text>
            <HapticTouch haptic="tabSwitch" onPress={() => changeMonth(1)} style={[st.navBtn, { backgroundColor: colors.surface2, borderColor: colors.border, opacity: isAtMax ? 0.3 : 1 }]} activeOpacity={0.7}>
              <Ionicons name="chevron-forward" size={22} color={colors.text} />
            </HapticTouch>
          </View>

          {/* ── カレンダーグリッド ── */}
          <Animated.View style={[st.calCard, { opacity: fadeAnim }]}>

            {/* 月サマリーチップ */}
            <View style={st.summaryChips}>
              <View style={st.chipTraining}>
                <Ionicons name="flash" size={13} color="#F59E0B" />
                <Text style={st.chipTrainingTxt}>Training: {trainingCount}</Text>
              </View>
              <View style={st.chipRest}>
                <Ionicons name="bed-outline" size={13} color="#3B82F6" />
                <Text style={st.chipRestTxt}>Rest: {restCount}</Text>
              </View>
            </View>

            {/* 曜日ヘッダー */}
            <View style={st.weekRow}>
              {WEEKDAYS.map((w, i) => (
                <Text key={w} style={[st.weekLbl,
                  i === 0 && { color: '#EF4444' },
                  i === 6 && { color: '#3B82F6' },
                ]}>{w}</Text>
              ))}
            </View>

            {/* グリッド（週単位行：flexWrap廃止でズレ防止） */}
            <View style={st.grid}>
              {Array.from({ length: Math.ceil(cells.length / 7) }, (_, wi) => (
                <View key={wi} style={st.weekRowGrid}>
                  {cells.slice(wi * 7, wi * 7 + 7).map((day, di) => {
                    if (day === null) return <View key={`e${wi}-${di}`} style={st.cellEmpty} />
                    const ymd = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                    return (
                      <DayCell
                        key={ymd}
                        day={day}
                        isToday={ymd === todayYMD}
                        isSelected={ymd === selectedDate}
                        bgColor={colorMap[ymd]}
                        records={recordMap[ymd] ?? []}
                        dow={di}
                        onPress={() => setSelectedDate(ymd)}
                      />
                    )
                  })}
                </View>
              ))}
            </View>

            {/* 強度凡例 */}
            <View style={st.intensityLegend}>
              {[
                { label: '軽', color: '#DCFCE7' },
                { label: '中', color: '#FEF9C3' },
                { label: '強', color: '#FED7AA' },
                { label: '超', color: '#FECACA' },
              ].map(({ label, color }) => (
                <View key={label} style={st.intensityItem}>
                  <View style={[st.intensityBox, { backgroundColor: color }]} />
                  <Text style={st.intensityTxt}>{label}</Text>
                </View>
              ))}
              <View style={st.intensityItem}>
                <View style={[st.intensityBox, { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB' }]} />
                <Text style={st.intensityTxt}>なし</Text>
              </View>
            </View>
          </Animated.View>

          {/* ── 選択日の詳細 ── */}
          <View style={[st.detailCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={st.detailHeader}>
              <Ionicons name="calendar-outline" size={16} color={colors.textHint} />
              <Text style={[st.detailTitle, { color: colors.text }]}>{selectedDate.replace(/-/g, '/')} の予定・記録</Text>
              <HapticTouch
                haptic="whoosh"
                style={st.addBtn}
                activeOpacity={0.8}
                onPress={() => { unlockAudio(); setEditEvent(null); setModalVisible(true) }}
              >
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={st.addBtnTxt}>予定を追加</Text>
              </HapticTouch>
            </View>

            {selectedRecords.length === 0 ? (
              <View style={st.emptyBox}>
                <Text style={st.emptyEmoji}>📅</Text>
                <Text style={[st.emptyTxt, { color: colors.textSec }]}>この日の記録はありません</Text>
                <Text style={[st.emptySub, { color: colors.textHint }]}>「予定を追加」で自由に入力できます</Text>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: 300 }}
                nestedScrollEnabled
                showsVerticalScrollIndicator={selectedRecords.length > 5}
                contentContainerStyle={{ gap: 8 }}
              >
                {selectedRecords.map((rec, idx) => {
                  const isEv  = selectedIsEvent(rec)
                  const dotColor = isEv ? '#9B6BFF' : DOT_COLORS[rec.type]
                  return (
                    <View key={idx} style={st.recordRow}>
                      <View style={[st.recordIcon, { backgroundColor: dotColor + '22' }]}>
                        <Ionicons name={DOT_ICONS[rec.type] as any} size={16} color={dotColor} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[st.recordLbl, { color: colors.text }]}>{rec.label}</Text>
                        {rec.sub ? <Text style={[st.recordSub, { color: colors.textHint }]}>{rec.sub}</Text> : null}
                      </View>
                      {isEv && rec.eventId ? (
                        <View style={st.eventActions}>
                          <TouchableOpacity
                            onPress={() => openEdit(rec.eventId!)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="pencil-outline" size={16} color={TEXT.secondary} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => deleteEvent(rec.eventId!)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="trash-outline" size={16} color="#FF3B30" />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={[st.badge, { backgroundColor: dotColor + '22', borderColor: dotColor }]}>
                          <Text style={[st.badgeTxt, { color: dotColor }]}>{DOT_LABELS[rec.type]}</Text>
                        </View>
                      )}
                    </View>
                  )
                })}
              </ScrollView>
            )}
          </View>

          {/* ── 月間サマリー ── */}
          <View style={st.summaryCard}>
            <Text style={st.summaryTitle}>{month + 1}月のサマリー</Text>
            <View style={st.summaryRow}>
              <SummaryItem icon="flame-outline"    color="#E53935" value={monthEntries.length}                                                           label="活動日数"  unit="日" />
              <SummaryItem icon="navigate-outline" color="#2196F3" value={monthEntries.filter(([, d]) => d.includes('gps')).length}         label="練習"      unit="回" />
              <SummaryItem icon="calendar-outline" color="#9B6BFF" value={monthEntries.filter(([, d]) => d.includes('event')).length}       label="予定"      unit="件" />
              <SummaryItem icon="trophy-outline"   color="#FFC107" value={monthEntries.filter(([, d]) => d.includes('competition')).length} label="大会"      unit="回" />
            </View>
          </View>

        </ScrollView>
      </SafeAreaView>

      {/* ── 予定追加モーダル ── */}
      <AddEventModal
        visible={modalVisible}
        date={selectedDate}
        editEvent={editEvent}
        onClose={() => { setModalVisible(false); setEditEvent(null) }}
        onSaved={load}
      />
    </View>
  )
}

// ── レコード種別 → 絵文字 ──────────────────────────────────
function recEmoji(type: DotType): string {
  switch (type) {
    case 'race':        return '⏱'
    case 'gps':         return '🏃'
    case 'workout':     return '💪'
    case 'competition': return '🏁'
    case 'event':       return '📝'
  }
}

// ── DayCell ────────────────────────────────────────────────
function DayCell({ day, isToday, isSelected, bgColor, records, dow, onPress }: {
  day: number; isToday: boolean; isSelected: boolean
  bgColor?: string; records: DayRecord[]; dow: number; onPress: () => void
}) {
  const scale = useRef(new Animated.Value(1)).current
  function press() {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.88, duration: 55, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 8, useNativeDriver: true }),
    ]).start()
    onPress()
  }

  const txtColor = dow === 0 ? '#EF4444'
    : dow === 6   ? '#3B82F6'
    : '#111827'

  // 重複を除いた表示レコード（最大2件）
  const seen = new Set<DotType>()
  const displayRecs = records.filter(r => {
    if (seen.has(r.type)) return false
    seen.add(r.type); return true
  }).slice(0, 2)

  // 予定系（event/competition）の最初のラベル（短縮）
  const evRec = records.find(r => r.type === 'event' || r.type === 'competition')

  return (
    <TouchableOpacity style={st.cellWrap} onPress={press} activeOpacity={1}>
      <Animated.View style={[
        st.cell,
        bgColor ? { backgroundColor: bgColor } : {},
        isSelected && st.cellSelected,
        { transform: [{ scale }] },
      ]}>
        {/* 上部：日付数字（今日 = 青丸） */}
        <View style={st.cellTop}>
          <View style={[st.numWrap, isToday && st.todayCircle]}>
            <Text style={[st.numTxt, { color: isToday ? '#fff' : txtColor }]}>{day}</Text>
          </View>
        </View>

        {/* 下部：予定・記録ラベル */}
        {displayRecs.length > 0 && (
          <View style={st.cellBottom}>
            {evRec ? (
              // 予定がある場合：絵文字＋短縮タイトル
              <View style={[st.cellTag, { backgroundColor: DOT_COLORS[evRec.type] + '22' }]}>
                <Text style={st.cellTagEmoji}>{recEmoji(evRec.type)}</Text>
                <Text style={[st.cellTagTxt, { color: DOT_COLORS[evRec.type] }]} numberOfLines={1}>
                  {evRec.label.replace(/^[^\s]+\s/, '').slice(0, 5)}
                </Text>
              </View>
            ) : (
              // 練習のみ：絵文字ドット
              <View style={st.cellDots}>
                {displayRecs.map((r, i) => (
                  <View key={i} style={[st.cellDot, { backgroundColor: DOT_COLORS[r.type] }]} />
                ))}
              </View>
            )}
          </View>
        )}
      </Animated.View>
    </TouchableOpacity>
  )
}

// ── SummaryItem ────────────────────────────────────────────
function SummaryItem({ icon, color, value, label, unit }: {
  icon: string; color: string; value: number; label: string; unit: string
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      <Text style={{ color: '#111827', fontSize: 18, fontWeight: '800' }}>
        {value}<Text style={{ fontSize: 12, fontWeight: '400', color: '#6b7280' }}>{unit}</Text>
      </Text>
      <Text style={{ color: '#6b7280', fontSize: 11 }}>{label}</Text>
    </View>
  )
}

// ── Modal styles ───────────────────────────────────────────
const m = StyleSheet.create({
  overlay:  { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.65)' },
  kvWrap:   { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingBottom: 44, maxHeight: '88%',
    borderTopWidth: 1, borderColor: 'rgba(0,0,0,0.1)',
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 12,
  },
  handle:   { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.1)', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  header:   { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 12 },
  title:    { color: '#111827', fontSize: 17, fontWeight: '800' },
  dateLbl:  { color: TEXT.secondary, fontSize: 12, marginTop: 2 },
  label:    { color: TEXT.hint, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 16, marginBottom: 8 },
  catRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catBtn:   { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: DIVIDER, backgroundColor: SURFACE2, flexDirection: 'row', alignItems: 'center', gap: 5 },
  catEmoji: { fontSize: 16 },
  catLabel: { fontSize: 12, fontWeight: '700' },
  input:    { backgroundColor: SURFACE2, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: '#111827', fontSize: 15, borderWidth: 1, borderColor: DIVIDER },
  inputMulti: { height: 72, textAlignVertical: 'top', paddingTop: 10 },
  saveBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1c1c1e', borderRadius: 50, paddingVertical: 16, marginTop: 20,
              shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 5 },
  saveTxt:  { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
})

// ── Calendar styles ────────────────────────────────────────
const st = StyleSheet.create({
  scroll:      { padding: 16, gap: 14, paddingBottom: 48 },
  monthNav:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 4 },
  navBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  monthTitle:  { color: '#fff', fontSize: 20, fontWeight: '800', minWidth: 140, textAlign: 'center' },

  // カレンダーカード（常にホワイト）
  calCard:        { backgroundColor: '#fff', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', paddingHorizontal: 8, paddingTop: 12, paddingBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 3 },
  summaryChips:   { flexDirection: 'row', gap: 8, marginBottom: 10, paddingHorizontal: 4 },
  chipTraining:   { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FEF9C3', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  chipTrainingTxt:{ color: '#92400E', fontSize: 12, fontWeight: '700' },
  chipRest:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#DBEAFE', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  chipRestTxt:    { color: '#1D4ED8', fontSize: 12, fontWeight: '700' },

  // 曜日ヘッダー
  weekRow:     { flexDirection: 'row', marginBottom: 4, paddingHorizontal: 2 },
  weekLbl:     { flex: 1, textAlign: 'center', color: '#6B7280', fontSize: 11, fontWeight: '700' },

  // グリッド（週単位行）
  grid:        { paddingHorizontal: 2 },
  weekRowGrid: { flexDirection: 'row' },
  cellWrap:    { flex: 1, aspectRatio: 0.72, padding: 2 },
  cellEmpty:   { flex: 1, aspectRatio: 0.72 },
  cell:        { flex: 1, borderRadius: 10, flexDirection: 'column', justifyContent: 'space-between', backgroundColor: '#F9FAFB', paddingTop: 5, paddingBottom: 4, overflow: 'hidden' },
  cellSelected:{ borderWidth: 2, borderColor: '#111827' },
  cellTop:     { alignItems: 'center' },
  numWrap:     { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  numTxt:      { fontSize: 15, fontWeight: '700', color: '#111827' },
  todayCircle: { backgroundColor: '#3B82F6' },
  // 下部イベント表示
  cellBottom:  { alignSelf: 'stretch', paddingHorizontal: 3, paddingBottom: 1 },
  cellTag:     { flexDirection: 'row', alignItems: 'center', gap: 1, borderRadius: 4, paddingHorizontal: 3, paddingVertical: 2, overflow: 'hidden' },
  cellTagEmoji:{ fontSize: 9, flexShrink: 0 },
  cellTagTxt:  { fontSize: 9, fontWeight: '700', flexShrink: 1, flexGrow: 0 },
  cellDots:    { flexDirection: 'row', gap: 3, alignItems: 'center' },
  cellDot:     { width: 5, height: 5, borderRadius: 2.5 },

  // 強度凡例
  intensityLegend: { flexDirection: 'row', gap: 10, marginTop: 10, paddingHorizontal: 4, justifyContent: 'flex-end', alignItems: 'center' },
  intensityItem:   { flexDirection: 'row', alignItems: 'center', gap: 3 },
  intensityBox:    { width: 12, height: 12, borderRadius: 3 },
  intensityTxt:    { fontSize: 10, color: '#9CA3AF' },

  // Detail
  detailCard:   { backgroundColor: '#fff', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 14, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailTitle:  { color: '#111827', fontSize: 14, fontWeight: '700', flex: 1 },
  addBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BRAND, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  addBtnTxt:    { color: '#fff', fontSize: 12, fontWeight: '700' },
  emptyBox:     { alignItems: 'center', paddingVertical: 16, gap: 5 },
  emptyEmoji:   { fontSize: 28, marginBottom: 2 },
  emptyTxt:     { color: '#444', fontSize: 13 },
  emptySub:     { color: '#6B7280', fontSize: 12 },
  recordRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 8, padding: 10 },
  recordIcon:   { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  recordLbl:    { color: '#111827', fontSize: 13, fontWeight: '600' },
  recordSub:    { color: '#6B7280', fontSize: 11 },
  eventActions: { flexDirection: 'row', gap: 12, paddingHorizontal: 4 },
  badge:        { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  badgeTxt:     { fontSize: 10, fontWeight: '700' },

  // Summary
  summaryCard:  { backgroundColor: '#fff', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2 },
  summaryTitle: { color: '#111827', fontSize: 15, fontWeight: '700' },
  summaryRow:   { flexDirection: 'row', gap: 8 },
})

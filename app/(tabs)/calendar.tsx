// app/(tabs)/calendar.tsx — カレンダー（自由入力予定対応）
import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Animated, Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TEXT, SURFACE, SURFACE2, DIVIDER, NEON, BRAND } from '../../lib/theme'
import { useTheme } from '../../context/ThemeContext'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Sounds, unlockAudio } from '../../lib/sounds'
import HapticTouch from '../../components/HapticTouch'
import Toast from 'react-native-toast-message'

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
      let events: CalendarEvent[] = raw ? JSON.parse(raw) : []
      if (editEvent) {
        events = events.map(e => e.id === editEvent.id
          ? { ...e, title: title.trim(), category, notes: notes.trim() || undefined }
          : e
        )
      } else {
        events.push({
          id: `ev_${Date.now()}`,
          date,
          title: title.trim(),
          category,
          notes: notes.trim() || undefined,
          created_at: new Date().toISOString(),
        })
      }
      await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(events))
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

      function addDot(date: string, type: DotType, label: string, sub?: string, eventId?: string) {
        if (!date) return
        const ymd = date.slice(0, 10)
        if (!newDayMap[ymd]) newDayMap[ymd] = []
        if (!newDayMap[ymd].includes(type)) newDayMap[ymd].push(type)
        if (!newRecordMap[ymd]) newRecordMap[ymd] = []
        newRecordMap[ymd].push({ type, label, sub, eventId })
      }

      // 練習セッション
      if (sessionsRaw) {
        (JSON.parse(sessionsRaw) as any[]).forEach(s =>
          addDot(s.session_date ?? s.created_at, 'gps',
            s.session_type ?? 'GPS練習',
            s.distance_m ? `${(s.distance_m / 1000).toFixed(1)}km` : undefined)
        )
      }
      // タイム計測
      if (raceRaw) {
        (JSON.parse(raceRaw) as any[]).forEach(r =>
          addDot(r.date ?? r.created_at, 'race', r.event ?? 'タイム計測', r.time)
        )
      }
      // 練習メニュー
      if (workoutRaw) {
        (JSON.parse(workoutRaw) as any[]).forEach(w =>
          addDot(w.date ?? w.created_at, 'workout', w.title ?? '練習メニュー')
        )
      }
      // 大会
      if (compRaw) {
        (JSON.parse(compRaw) as any[]).forEach(c =>
          addDot(c.date ?? c.competition_date ?? c.created_at, 'competition', c.name ?? '大会', c.event)
        )
      }
      // 自由入力予定
      if (eventsRaw) {
        (JSON.parse(eventsRaw) as CalendarEvent[]).forEach(ev => {
          const cat = getCatInfo(ev.category)
          addDot(ev.date, 'event', `${cat.emoji} ${ev.title}`, ev.notes, ev.id)
        })
      }

      setDayMap(newDayMap)
      setRecordMap(newRecordMap)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])

  async function deleteEvent(eventId: string) {
    try {
      const raw = await AsyncStorage.getItem(EVENTS_KEY)
      if (!raw) return
      const events: CalendarEvent[] = JSON.parse(raw)
      await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(events.filter(e => e.id !== eventId)))
      Sounds.delete()
      Toast.show({ type: 'success', text1: '予定を削除しました', visibilityTime: 1400 })
      load()
    } catch { /* ignore */ }
  }

  async function openEdit(eventId: string) {
    const raw = await AsyncStorage.getItem(EVENTS_KEY)
    if (!raw) return
    const events: CalendarEvent[] = JSON.parse(raw)
    const ev = events.find(e => e.id === eventId)
    if (!ev) return
    setEditEvent(ev)
    setModalVisible(true)
  }

  function changeMonth(delta: number) {
    Animated.timing(fadeAnim, { toValue: 0, duration: 110, useNativeDriver: true }).start(() => {
      setMonth(prev => {
        let nm = prev + delta, ny = year
        if (nm < 0)  { nm = 11; ny -= 1; setYear(ny) }
        if (nm > 11) { nm = 0;  ny += 1; setYear(ny) }
        return nm
      })
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

  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`
  const monthEntries = Object.entries(dayMap).filter(([d]) => d.startsWith(monthPrefix))

  const { colors } = useTheme()
  const selectedRecords = recordMap[selectedDate] ?? []
  const selectedIsEvent = (r: DayRecord) => r.type === 'event'

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={st.scroll}>

          {/* ── 月ナビ ── */}
          <View style={st.monthNav}>
            <HapticTouch haptic="tabSwitch" onPress={() => changeMonth(-1)} style={[st.navBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </HapticTouch>
            <Text style={[st.monthTitle, { color: colors.text }]}>{year}年{month + 1}月</Text>
            <HapticTouch haptic="tabSwitch" onPress={() => changeMonth(1)} style={[st.navBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]} activeOpacity={0.7}>
              <Ionicons name="chevron-forward" size={22} color={colors.text} />
            </HapticTouch>
          </View>

          {/* ── 凡例 ── */}
          <View style={st.legend}>
            {(Object.entries(DOT_COLORS) as [DotType, string][]).map(([type, color]) => (
              <View key={type} style={st.legendItem}>
                <View style={[st.legendDot, { backgroundColor: color }]} />
                <Text style={[st.legendTxt, { color: colors.textHint }]}>{DOT_LABELS[type]}</Text>
              </View>
            ))}
          </View>

          {/* ── カレンダーグリッド ── */}
          <Animated.View style={[st.calCard, { opacity: fadeAnim, backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={st.weekRow}>
              {WEEKDAYS.map((w, i) => (
                <Text key={w} style={[st.weekLbl, { color: colors.textHint },
                  i === 0 && { color: '#E53935' },
                  i === 6 && { color: '#2196F3' },
                ]}>{w}</Text>
              ))}
            </View>
            <View style={st.grid}>
              {cells.map((day, idx) => {
                if (day === null) return <View key={`e${idx}`} style={st.dayCell} />
                const ymd = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                return (
                  <DayCell
                    key={ymd}
                    day={day}
                    isToday={ymd === todayYMD}
                    isSelected={ymd === selectedDate}
                    dots={dayMap[ymd] ?? []}
                    dow={(firstDow + day - 1) % 7}
                    onPress={() => setSelectedDate(ymd)}
                    previewLabel={recordMap[ymd]?.[0]?.label}
                  />
                )
              })}
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
              <View style={{ gap: 8 }}>
                {selectedRecords.map((rec, idx) => {
                  const isEv  = selectedIsEvent(rec)
                  const color = isEv ? getCatInfo(rec.label.split(' ')[1] as any)?.color ?? '#9B6BFF' : DOT_COLORS[rec.type]
                  // For events, color comes from category stored on the event
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
              </View>
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

// ── DayCell ────────────────────────────────────────────────
function DayCell({ day, isToday, isSelected, dots, dow, onPress, previewLabel }: {
  day: number; isToday: boolean; isSelected: boolean
  dots: DotType[]; dow: number; onPress: () => void
  previewLabel?: string
}) {
  const scale = useRef(new Animated.Value(1)).current
  function press() {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.82, duration: 70, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1,    duration: 100, useNativeDriver: true }),
    ]).start()
    onPress()
  }
  const dayColor = isToday ? '#fff'
    : dow === 0 ? '#E53935'
    : dow === 6 ? '#2196F3'
    : '#374151'

  // Strip leading emoji (e.g. "📝 ") and take first 5 chars
  const preview = previewLabel
    ? previewLabel.replace(/^[\p{Emoji}\s]+/u, '').slice(0, 5)
    : undefined

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={press} style={st.dayCell}>
      <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
        <View style={[st.dayNum, isToday && st.todayBg, isSelected && !isToday && st.selBg]}>
          <Text style={[{ fontSize: 13, fontWeight: '500', color: dayColor }, isToday && { color: '#fff', fontWeight: '800' }]}>
            {day}
          </Text>
        </View>
        {dots.length > 0 && (
          <View style={st.dotsRow}>
            {dots.slice(0, 3).map(t => (
              <View key={t} style={[st.dot, { backgroundColor: DOT_COLORS[t] }]} />
            ))}
          </View>
        )}
        {preview ? (
          <Text style={st.dayPreview} numberOfLines={1}>{preview}</Text>
        ) : null}
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
  catBtn:   { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: DIVIDER, backgroundColor: SURFACE2, flexDirection: 'row', alignItems: 'center', gap: 5 },
  catEmoji: { fontSize: 16 },
  catLabel: { fontSize: 12, fontWeight: '700' },
  input:    { backgroundColor: SURFACE2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: '#111827', fontSize: 15, borderWidth: 1, borderColor: DIVIDER },
  inputMulti: { height: 72, textAlignVertical: 'top', paddingTop: 10 },
  saveBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 14, paddingVertical: 15, marginTop: 20 },
  saveTxt:  { color: '#fff', fontSize: 16, fontWeight: '800' },
})

// ── Calendar styles ────────────────────────────────────────
const st = StyleSheet.create({
  scroll:      { padding: 16, gap: 14, paddingBottom: 48 },
  monthNav:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 4 },
  navBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  monthTitle:  { color: '#fff', fontSize: 20, fontWeight: '800', minWidth: 140, textAlign: 'center' },
  legend:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 2 },
  legendItem:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:   { width: 7, height: 7, borderRadius: 3.5 },
  legendTxt:   { color: '#666', fontSize: 10 },
  calCard:     { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  weekRow:     { flexDirection: 'row', marginBottom: 6 },
  weekLbl:     { flex: 1, textAlign: 'center', color: '#666', fontSize: 12, fontWeight: '700' },
  grid:        { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell:     { width: `${100 / 7}%`, aspectRatio: 0.75, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 4 },
  dayNum:      { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  todayBg:     { backgroundColor: '#166534' },
  selBg:       { backgroundColor: 'rgba(22,101,52,0.12)', borderWidth: 1, borderColor: '#166534' },
  dotsRow:     { flexDirection: 'row', gap: 2, marginTop: 2, height: 5, alignItems: 'center' },
  dot:         { width: 4, height: 4, borderRadius: 2 },
  dayPreview:  { fontSize: 8, color: '#888', marginTop: 2, maxWidth: 36, textAlign: 'center' },

  // Detail
  detailCard:   { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 14, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailTitle:  { color: '#fff', fontSize: 14, fontWeight: '700', flex: 1 },
  addBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BRAND, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  addBtnTxt:    { color: '#fff', fontSize: 12, fontWeight: '700' },
  emptyBox:     { alignItems: 'center', paddingVertical: 16, gap: 5 },
  emptyEmoji:   { fontSize: 28, marginBottom: 2 },
  emptyTxt:     { color: '#444', fontSize: 13 },
  emptySub:     { color: '#333', fontSize: 12 },
  recordRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 8, padding: 10 },
  recordIcon:   { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  recordLbl:    { color: '#fff', fontSize: 13, fontWeight: '600' },
  recordSub:    { color: '#666', fontSize: 11 },
  eventActions: { flexDirection: 'row', gap: 12, paddingHorizontal: 4 },
  badge:        { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  badgeTxt:     { fontSize: 10, fontWeight: '700' },

  // Summary
  summaryCard:  { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  summaryTitle: { color: '#111827', fontSize: 15, fontWeight: '700' },
  summaryRow:   { flexDirection: 'row', gap: 8 },
})

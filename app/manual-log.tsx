// app/manual-log.tsx — 手動練習入力画面
import React, { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { useTheme } from '../context/ThemeContext'
import { Sounds, unlockAudio } from '../lib/sounds'
import type { TrainingSession, AthleticsEvent } from '../types'

const SESSIONS_KEY      = 'trackmate_sessions'
const CONDITION_MAP_KEY = 'trackmate_condition_map'
const MOCK_USER_ID      = 'mock-user-1'
const BRAND             = '#E53935'

// ── 種目定義 ──────────────────────────────────────────────
const SESSION_TYPES = [
  { key: 'sprint',   label: 'スプリント', emoji: '⚡', color: '#FF6B6B' },
  { key: 'interval', label: 'インターバル', emoji: '🔁', color: '#E53935' },
  { key: 'tempo',    label: 'テンポ走',   emoji: '🏃', color: '#FF9500' },
  { key: 'easy',     label: 'ジョグ',     emoji: '🌿', color: '#4ECDC4' },
  { key: 'long',     label: 'ロング走',   emoji: '🛣️', color: '#5AC8FA' },
  { key: 'drill',    label: 'ドリル',     emoji: '🔧', color: '#AF52DE' },
  { key: 'strength', label: 'ウェイト',   emoji: '🏋️', color: '#FF6B35' },
  { key: 'race',     label: '試合',       emoji: '🏆', color: '#FFD700' },
  { key: 'rest',     label: '休養',       emoji: '💤', color: '#666'    },
] as const

const EVENTS: AthleticsEvent[] = [
  '100m','200m','400m','800m','1500m','3000m','5000m','10000m',
  '110mH','100mH','400mH','3000mSC','競歩',
  '走幅跳','三段跳','走高跳','棒高跳','砲丸投','やり投','円盤投',
]

const FATIGUE = [
  { v: 2,  emoji: '😴', label: '完全元気' },
  { v: 4,  emoji: '😊', label: '軽め'     },
  { v: 6,  emoji: '😐', label: '普通'     },
  { v: 8,  emoji: '😰', label: 'キツい'   },
  { v: 10, emoji: '🤯', label: '限界'     },
]

// ── カレンダーピッカー ────────────────────────────────────
function CalendarPicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const today = new Date()
  const [viewYear,  setViewYear]  = useState(() => parseInt(value.slice(0, 4)))
  const [viewMonth, setViewMonth] = useState(() => parseInt(value.slice(5, 7)) - 1)

  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const todayStr = today.toISOString().slice(0, 10)

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    const ny = viewMonth === 11 ? viewYear + 1 : viewYear
    const nm = viewMonth === 11 ? 0 : viewMonth + 1
    if (ny > today.getFullYear() || (ny === today.getFullYear() && nm > today.getMonth())) return
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null)

  const DOW = ['日','月','火','水','木','金','土']

  return (
    <View style={cal.wrap}>
      {/* ヘッダー（月移動） */}
      <View style={cal.header}>
        <TouchableOpacity onPress={prevMonth} style={cal.arrow}>
          <Ionicons name="chevron-back" size={18} color="#fff" />
        </TouchableOpacity>
        <Text style={cal.monthLabel}>{viewYear}年 {viewMonth + 1}月</Text>
        <TouchableOpacity onPress={nextMonth} style={cal.arrow}>
          <Ionicons name="chevron-forward" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* 曜日ヘッダー */}
      <View style={cal.dowRow}>
        {DOW.map((d, i) => (
          <Text key={d} style={[cal.dow, i === 0 && { color: '#FF6B6B' }, i === 6 && { color: '#5AC8FA' }]}>{d}</Text>
        ))}
      </View>

      {/* 日付グリッド */}
      {Array.from({ length: cells.length / 7 }, (_, row) => (
        <View key={row} style={cal.row}>
          {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
            if (!day) return <View key={col} style={cal.cell} />
            const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const isSelected = iso === value
            const isToday    = iso === todayStr
            const isFuture   = iso > todayStr
            return (
              <TouchableOpacity
                key={col}
                style={[
                  cal.cell,
                  isSelected && { backgroundColor: BRAND, borderRadius: 20 },
                  isToday && !isSelected && { borderWidth: 1.5, borderColor: BRAND, borderRadius: 20 },
                  isFuture && { opacity: 0.3 },
                ]}
                onPress={() => { if (!isFuture) { onChange(iso); Sounds.tap() } }}
                disabled={isFuture}
                activeOpacity={0.7}
              >
                <Text style={[
                  cal.dayText,
                  col === 0 && { color: '#FF6B6B' },
                  col === 6 && { color: '#5AC8FA' },
                  isSelected && { color: '#fff', fontWeight: '900' },
                ]}>{day}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      ))}
    </View>
  )
}

const cal = StyleSheet.create({
  wrap:       { borderRadius: 14, overflow: 'hidden', backgroundColor: '#1a1a1a' },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
  arrow:      { padding: 6 },
  monthLabel: { color: '#fff', fontSize: 15, fontWeight: '800' },
  dowRow:     { flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 4 },
  dow:        { flex: 1, textAlign: 'center', color: '#888', fontSize: 11, fontWeight: '700' },
  row:        { flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 2 },
  cell:       { flex: 1, height: 36, alignItems: 'center', justifyContent: 'center' },
  dayText:    { color: '#ddd', fontSize: 13, fontWeight: '600' },
})

// ── タイム変換: mm:ss:cs → ms ────────────────────────────
function toMs(min: string, sec: string, cs: string) {
  const m = Number(min  || '0')
  const s = Number(sec  || '0')
  const c = Number(cs   || '0')
  return (m * 60 + s) * 1000 + c * 10
}

export default function ManualLogScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const today = new Date().toISOString().slice(0, 10)

  // ── フォーム状態 ──────────────────────────────────────
  const [sessionType, setSessionType] = useState<typeof SESSION_TYPES[number]['key']>('sprint')
  const [selectedEvent, setSelectedEvent] = useState<AthleticsEvent | null>(null)
  const [date,          setDate]          = useState(today)
  const [timeMin,       setTimeMin]       = useState('')
  const [timeSec,       setTimeSec]       = useState('')
  const [timeCs,        setTimeCs]        = useState('')
  const [distanceM,     setDistanceM]     = useState('')
  const [repsStr,       setRepsStr]       = useState('')
  const [fatigue,       setFatigue]       = useState(6)
  const [notes,         setNotes]         = useState('')
  const [condLevel,     setCondLevel]     = useState(6)
  const [saving,        setSaving]        = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(CONDITION_MAP_KEY).then(r => {
      if (!r) return
      const map = JSON.parse(r)
      if (map[today]) setCondLevel(map[today])
    }).catch(() => {})
  }, [])

  const typeInfo = SESSION_TYPES.find(t => t.key === sessionType)!
  const hasTime  = sessionType !== 'rest' && sessionType !== 'strength'
  const hasReps  = ['sprint','interval','drill','strength'].includes(sessionType)
  const hasDist  = ['tempo','easy','long','interval'].includes(sessionType)

  async function handleSave() {
    unlockAudio(); Sounds.tap()
    setSaving(true)
    try {
      const time_ms = (timeMin || timeSec || timeCs)
        ? toMs(timeMin, timeSec, timeCs)
        : undefined

      const newSession: TrainingSession = {
        id:             `manual-${Date.now()}`,
        user_id:        MOCK_USER_ID,
        created_at:     new Date().toISOString(),
        session_date:   date,
        session_type:   sessionType,
        event:          selectedEvent ?? undefined,
        time_ms:        time_ms,
        distance_m:     distanceM ? Number(distanceM) : undefined,
        reps:           repsStr   ? Number(repsStr)   : undefined,
        fatigue_level:  fatigue,
        condition_level: condLevel,
        notes:          notes.trim() || undefined,
      }

      const raw = await AsyncStorage.getItem(SESSIONS_KEY)
      const sessions: TrainingSession[] = raw ? JSON.parse(raw) : []
      sessions.unshift(newSession)
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
      Toast.show({ type: 'success', text1: '練習を記録しました ✓', visibilityTime: 1500 })
      setTimeout(() => router.back(), 400)
    } catch {
      Toast.show({ type: 'error', text1: '保存に失敗しました', visibilityTime: 2000 })
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* ── ヘッダー ── */}
          <View style={[s.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[s.headerTitle, { color: colors.text }]}>手動入力</Text>
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={[s.saveBtn, { backgroundColor: BRAND, opacity: saving ? 0.6 : 1 }]}
            >
              <Text style={s.saveBtnText}>{saving ? '保存中...' : '保存'}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

            {/* ── 日付選択（カレンダー） ── */}
            <Section title="日付">
              <Text style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>
                選択中: <Text style={{ color: '#fff', fontWeight: '700' }}>{date === today ? `今日 (${date})` : date}</Text>
              </Text>
              <CalendarPicker value={date} onChange={setDate} />
            </Section>

            {/* ── 練習タイプ ── */}
            <Section title="練習タイプ">
              <View style={s.typeGrid}>
                {SESSION_TYPES.map(t => (
                  <TouchableOpacity
                    key={t.key}
                    onPress={() => { setSessionType(t.key); Sounds.tap() }}
                    style={[
                      s.typeBtn,
                      { borderColor: t.color + '44' },
                      sessionType === t.key && { backgroundColor: t.color + '22', borderColor: t.color },
                    ]}
                  >
                    <Text style={{ fontSize: 18 }}>{t.emoji}</Text>
                    <Text style={[s.typeBtnLabel, { color: sessionType === t.key ? t.color : colors.textSec }]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Section>

            {/* ── 種目選択（スプリント・インターバル・試合の時） ── */}
            {['sprint','interval','race','tempo'].includes(sessionType) && (
              <Section title="種目（任意）">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {EVENTS.map(ev => (
                    <TouchableOpacity
                      key={ev}
                      onPress={() => { setSelectedEvent(selectedEvent === ev ? null : ev); Sounds.tap() }}
                      style={[
                        s.eventChip,
                        selectedEvent === ev && { backgroundColor: typeInfo.color + '22', borderColor: typeInfo.color },
                      ]}
                    >
                      <Text style={[s.eventChipText, { color: selectedEvent === ev ? typeInfo.color : colors.textSec }]}>
                        {ev}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </Section>
            )}

            {/* ── タイム入力 ── */}
            {hasTime && (
              <Section title="タイム（任意）">
                <View style={s.timeRow}>
                  <TimeField value={timeMin} onChange={setTimeMin} placeholder="0" label="分" colors={colors} />
                  <Text style={[s.timeSep, { color: colors.textHint }]}>:</Text>
                  <TimeField value={timeSec} onChange={setTimeSec} placeholder="00" label="秒" colors={colors} />
                  <Text style={[s.timeSep, { color: colors.textHint }]}>.</Text>
                  <TimeField value={timeCs}  onChange={setTimeCs}  placeholder="00" label="CS" colors={colors} />
                </View>
              </Section>
            )}

            {/* ── 本数 / セット ── */}
            {hasReps && (
              <Section title="本数">
                <View style={s.inlineRow}>
                  <TextInput
                    value={repsStr}
                    onChangeText={setRepsStr}
                    placeholder="例: 6"
                    placeholderTextColor={colors.textHint}
                    style={[s.shortInput, { backgroundColor: colors.surface2, color: colors.text }]}
                  />
                  <Text style={[s.unitLabel, { color: colors.textSec }]}>本</Text>
                </View>
              </Section>
            )}

            {/* ── 距離 ── */}
            {hasDist && (
              <Section title="距離（m）">
                <View style={s.inlineRow}>
                  <TextInput
                    value={distanceM}
                    onChangeText={setDistanceM}
                    placeholder="例: 5000"
                    placeholderTextColor={colors.textHint}
                    style={[s.shortInput, { backgroundColor: colors.surface2, color: colors.text }]}
                  />
                  <Text style={[s.unitLabel, { color: colors.textSec }]}>m</Text>
                </View>
              </Section>
            )}

            {/* ── 疲労度 ── */}
            <Section title="疲労度">
              <View style={s.fatigueRow}>
                {FATIGUE.map(f => (
                  <TouchableOpacity
                    key={f.v}
                    onPress={() => { setFatigue(f.v); Sounds.tap() }}
                    style={[s.fatigueBtn, fatigue === f.v && { backgroundColor: BRAND + '22', borderColor: BRAND }]}
                  >
                    <Text style={{ fontSize: 22 }}>{f.emoji}</Text>
                    <Text style={[s.fatigueBtnLabel, { color: fatigue === f.v ? BRAND : colors.textHint }]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Section>

            {/* ── メモ ── */}
            <Section title="メモ（任意）">
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="練習の感想、気づきなど..."
                placeholderTextColor={colors.textHint}
                multiline
                numberOfLines={3}
                style={[s.notesInput, { backgroundColor: colors.surface2, color: colors.text }]}
              />
            </Section>

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  )
}

// ── サブコンポーネント ─────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme()
  return (
    <View style={s.section}>
      <Text style={[s.sectionTitle, { color: '#888' }]}>{title}</Text>
      {children}
    </View>
  )
}

function TimeField({ value, onChange, placeholder, label, colors }: {
  value: string; onChange: (v: string) => void; placeholder: string; label: string; colors: any
}) {
  return (
    <View style={s.timeFieldWrap}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textHint}
        maxLength={3}
        style={[s.timeInput, { backgroundColor: colors.surface2, color: colors.text }]}
        textAlign="center"
      />
      <Text style={[s.timeLabel, { color: colors.textHint }]}>{label}</Text>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────
const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
  },
  backBtn:      { padding: 4 },
  headerTitle:  { fontSize: 17, fontWeight: '800' },
  saveBtn:      { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
  saveBtnText:  { color: '#fff', fontSize: 14, fontWeight: '800' },

  content:  { padding: 16, gap: 8 },
  section:  { gap: 10, marginBottom: 4 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },

  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 12, borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  typeBtnLabel: { fontSize: 12, fontWeight: '700' },

  dateChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'transparent',
  },
  dateChipText: { fontSize: 12, fontWeight: '700' },

  eventChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  eventChipText: { fontSize: 12, fontWeight: '700' },

  timeRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  timeSep:      { fontSize: 22, fontWeight: '800', marginBottom: 8 },
  timeFieldWrap:{ alignItems: 'center', gap: 4 },
  timeInput: {
    width: 56, height: 52, borderRadius: 10,
    fontSize: 22, fontWeight: '800',
  },
  timeLabel: { fontSize: 10, fontWeight: '600' },

  inlineRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shortInput: {
    width: 100, height: 46, borderRadius: 10,
    fontSize: 18, fontWeight: '700', paddingHorizontal: 12,
  },
  unitLabel:  { fontSize: 14, fontWeight: '700' },

  fatigueRow: { flexDirection: 'row', gap: 6 },
  fatigueBtn: {
    flex: 1, alignItems: 'center', gap: 4,
    paddingVertical: 10, borderRadius: 12,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)',
  },
  fatigueBtnLabel: { fontSize: 9, fontWeight: '700', textAlign: 'center' },

  notesInput: {
    borderRadius: 10, padding: 12,
    fontSize: 13, minHeight: 80, textAlignVertical: 'top',
  },
})

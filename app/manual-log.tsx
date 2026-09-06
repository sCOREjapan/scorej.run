// app/manual-log.tsx — 手動練習入力画面
import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  TextInput, KeyboardAvoidingView, Platform, ScrollView, Modal,
} from 'react-native'
import HapticTouch from '../components/HapticTouch'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { Sounds, unlockAudio } from '../lib/sounds'
import type { TrainingSession, AthleticsEvent } from '../types'
import { autoSyncTeam } from '../lib/teamAutoSync'
import { updateSessions } from '../lib/sessionsStore'
import { todayLocalISO } from '../lib/dateLocal'
import { STANDARD_HURDLE_HEIGHTS, isHurdleEvent } from '../lib/hurdleHeights'
import { BRAND } from '../lib/theme'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../context/LanguageContext'
import { getEventLabel } from '../lib/eventLabels'
import { shouldShowInterstitial, showInterstitialAd } from '../lib/admob'

async function backWithPossibleInterstitial(router: { back: () => void }) {
  if (await shouldShowInterstitial()) await showInterstitialAd().catch(() => {})
  router.back()
}

const SESSIONS_KEY      = 'trackmate_sessions'
const CONDITION_MAP_KEY = 'trackmate_condition_map'
const MENU_TEMPLATES_KEY = 'trackmate_menu_templates'

type MenuTemplate = { id: string; name: string; content: string }

// ── 種目定義 ──────────────────────────────────────────────
// label は locales/manualLog.sessionTypes 経由で言語対応
const SESSION_TYPES = [
  { key: 'sprint',   ionicon: 'flash',     color: '#FF6B6B' },
  { key: 'interval', ionicon: 'sync',      color: '#E53935' },
  { key: 'tempo',    ionicon: 'walk',      color: '#FF9500' },
  { key: 'easy',     ionicon: 'leaf',      color: '#4ECDC4' },
  { key: 'long',     ionicon: 'map',       color: '#5AC8FA' },
  { key: 'drill',    ionicon: 'construct', color: '#AF52DE' },
  { key: 'strength', ionicon: 'barbell',   color: '#FF6B35' },
  { key: 'race',     ionicon: 'trophy',    color: '#FFD700' },
  { key: 'rest',     ionicon: 'moon',      color: '#666'    },
] as const

// ── 種目を分類分け（モーダル用） ──────────────────────────
// label は locales/manualLog.eventCategories 経由で言語対応
const EVENT_CATEGORIES: { key: string; events: AthleticsEvent[] }[] = [
  { key: 'sprint',       events: ['100m','200m','300m','400m','300mH'] },
  { key: 'middle',       events: ['800m','1000m','1500m','3000m'] },
  { key: 'long',         events: ['5000m','10000m','half_marathon','marathon','競歩'] },
  { key: 'hurdle',       events: ['100mH','110mH','400mH'] },
  { key: 'steeplechase', events: ['3000mSC'] },
  { key: 'jump',         events: ['走幅跳','三段跳','走高跳','棒高跳'] },
  { key: 'throw',        events: ['砲丸投','やり投','円盤投'] },
  { key: 'combined',     events: ['十種競技','七種競技','八種競技'] },
  { key: 'relay',        events: ['4×100mR','4×400mR'] },
]

// ── 自重トレーニング種目 ──────────────────────────────────
// name は locales/manualLog.bodyweightExercises 経由で言語対応(idで参照)
const BODYWEIGHT_EXERCISES = [
  { id: 'situp',           emoji: '💪' },
  { id: 'pushup',          emoji: '🤸' },
  { id: 'squat',           emoji: '🦵' },
  { id: 'plank',           emoji: '🧘' },
  { id: 'lunge',           emoji: '🏃' },
  { id: 'backExtension',   emoji: '🔥' },
  { id: 'hipLift',         emoji: '🍑' },
  { id: 'crunch',          emoji: '💢' },
  { id: 'burpee',          emoji: '⚡' },
  { id: 'mountainClimber', emoji: '🧗' },
  { id: 'jumpingJack',     emoji: '⭐' },
  { id: 'diagonal',        emoji: '✨' },
  { id: 'kneeToElbow',     emoji: '🔄' },
  { id: 'sidePlank',       emoji: '↔️' },
  { id: 'calfRaise',       emoji: '👟' },
]

type BwSet = { id: string; reps: string; sets: string }

// label は locales/manualLog.fatigueLevels 経由で言語対応(vをキーに)
const FATIGUE = [
  { v: 2,  emoji: '😴' },
  { v: 4,  emoji: '😊' },
  { v: 6,  emoji: '😐' },
  { v: 8,  emoji: '😰' },
  { v: 10, emoji: '🤯' },
]

const MANUAL_LOG_MONTH_NAMES_EN = ['January','February','March','April','May','June','July','August','September','October','November','December']

// ── カレンダーピッカー ────────────────────────────────────
function CalendarPicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { colors } = useTheme()
  const cal = React.useMemo(() => makeCalStyles(colors), [colors])
  const today = new Date()
  const [viewYear,  setViewYear]  = useState(() => parseInt(value.slice(0, 4)))
  const [viewMonth, setViewMonth] = useState(() => parseInt(value.slice(5, 7)) - 1)

  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  // toISOString() はUTC日付のため、深夜はローカル日付とずれる → ローカル日付で生成
  const todayStr = [today.getFullYear(), String(today.getMonth()+1).padStart(2,'0'), String(today.getDate()).padStart(2,'0')].join('-')

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

  const DOW = language === 'en' ? ['Su','Mo','Tu','We','Th','Fr','Sa'] : ['日','月','火','水','木','金','土']
  const monthLabel = language === 'en' ? `${MANUAL_LOG_MONTH_NAMES_EN[viewMonth]} ${viewYear}` : `${viewYear}年 ${viewMonth + 1}月`

  return (
    <View style={cal.wrap}>
      {/* ヘッダー（月移動） */}
      <View style={cal.header}>
        <HapticTouch haptic="tap" onPress={prevMonth} style={cal.arrow} hitSlop={8} accessibilityLabel={t('manualLog.calendar.prevMonth')}>
          <Ionicons name="chevron-back" size={18} color={colors.textSec} />
        </HapticTouch>
        <Text style={cal.monthLabel}>{monthLabel}</Text>
        <HapticTouch haptic="tap" onPress={nextMonth} style={cal.arrow} hitSlop={8} accessibilityLabel={t('manualLog.calendar.nextMonth')}>
          <Ionicons name="chevron-forward" size={18} color={colors.textSec} />
        </HapticTouch>
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

const makeCalStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap:       { borderRadius: 14, overflow: 'hidden', backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
  arrow:      { padding: 6 },
  monthLabel: { color: colors.text, fontSize: 15, fontWeight: '800' },
  dowRow:     { flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 4 },
  dow:        { flex: 1, textAlign: 'center', color: colors.textHint, fontSize: 11, fontWeight: '700' },
  row:        { flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 2 },
  cell:       { flex: 1, height: 36, alignItems: 'center', justifyContent: 'center' },
  dayText:    { color: colors.text, fontSize: 13, fontWeight: '600' },
})

// ── タイム変換: mm:ss:cs → ms ────────────────────────────
function toMs(min: string, sec: string, cs: string) {
  const m = Number(min  || '0')
  const s = Number(sec  || '0')
  const c = Number(cs   || '0')
  return (m * 60 + s) * 1000 + c * 10
}

// ── タイム逆変換: ms → mm/ss/cs（編集時のフォーム復元用） ──
function fromMs(ms: number): { min: string; sec: string; cs: string } {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const c = Math.round((ms % 1000) / 10)
  return {
    min: m ? String(m) : '',
    sec: String(s),
    cs:  String(c).padStart(2, '0'),
  }
}

// ── 本数ごとのタイム: mm + ss.cc(小数秒) → ms / 逆変換 ──
function parseRepTime(min: string, sec: string): number | null {
  if (!min && !sec) return null
  const m = Number(min || '0')
  const s = Number(sec || '0')
  const ms = Math.round((m * 60 + s) * 1000)
  return ms > 0 ? ms : null
}
function msToRepFields(ms: number): { min: string; sec: string } {
  const totalSec = ms / 1000
  const m = Math.floor(totalSec / 60)
  const s = (totalSec % 60).toFixed(2)
  return { min: m > 0 ? String(m) : '', sec: s }
}
function fmtRepTime(ms: number): string {
  const { min, sec } = msToRepFields(ms)
  return min ? `${min}'${sec}"` : `${sec}"`
}

export default function ManualLogScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { id: editId } = useLocalSearchParams<{ id?: string }>()
  const isEdit = !!editId
  const today = todayLocalISO()

  // ── フォーム状態 ──────────────────────────────────────
  const [sessionType, setSessionType] = useState<typeof SESSION_TYPES[number]['key']>('sprint')
  const [selectedEvent, setSelectedEvent] = useState<AthleticsEvent | null>(null)
  const [eventCategoryModal, setEventCategoryModal] = useState<string | null>(null)
  const [hurdleHeight,  setHurdleHeight]  = useState<number | null>(null)
  const [date,          setDate]          = useState(today)
  const [timeMin,       setTimeMin]       = useState('')
  const [timeSec,       setTimeSec]       = useState('')
  const [timeCs,        setTimeCs]        = useState('')
  const [distanceM,     setDistanceM]     = useState('')
  const [repCount,      setRepCount]      = useState(1)
  const [repMins,       setRepMins]       = useState<string[]>([''])
  const [repSecs,       setRepSecs]       = useState<string[]>([''])
  const [fatigue,       setFatigue]       = useState(6)
  const [notes,         setNotes]         = useState('')
  const [condLevel,     setCondLevel]     = useState(6)
  const [saving,        setSaving]        = useState(false)
  const [menuTemplates, setMenuTemplates] = useState<MenuTemplate[]>([])
  const [strengthMode,  setStrengthMode]  = useState<'weight' | 'bodyweight'>('weight')
  const [bwSets,        setBwSets]        = useState<BwSet[]>([])
  const [tplNameModal,  setTplNameModal]  = useState(false)
  const [tplNameInput,  setTplNameInput]  = useState('')

  useEffect(() => {
    AsyncStorage.getItem(MENU_TEMPLATES_KEY).then(r => {
      if (!r) return
      try { setMenuTemplates(JSON.parse(r)) } catch {}
    }).catch(() => {})
  }, [])

  // Alert.prompt は iOS専用API（Web/Androidでは「Alert.prompt is not a function」でクラッシュする）
  // のため、全プラットフォームで動くカスタムモーダルで代替する
  const saveTemplate = useCallback(() => {
    if (!notes.trim()) return
    setTplNameInput('')
    setTplNameModal(true)
  }, [notes])

  const confirmSaveTemplate = useCallback(() => {
    const trimmed = notes.trim()
    const name = tplNameInput.trim()
    if (!trimmed || !name) return
    const tpl: MenuTemplate = { id: `tpl_${Date.now()}`, name, content: trimmed }
    const next = [tpl, ...menuTemplates]
    setMenuTemplates(next)
    AsyncStorage.setItem(MENU_TEMPLATES_KEY, JSON.stringify(next)).catch(() => {})
    Toast.show({ type: 'success', text1: t('manualLog.templateSaved', { name }) })
    setTplNameModal(false)
  }, [notes, tplNameInput, menuTemplates, t])

  const deleteTemplate = useCallback((id: string) => {
    const next = menuTemplates.filter(tpl => tpl.id !== id)
    setMenuTemplates(next)
    AsyncStorage.setItem(MENU_TEMPLATES_KEY, JSON.stringify(next)).catch(() => {})
  }, [menuTemplates])

  useEffect(() => {
    // 編集時は既存記録の体調を優先するため、今日の体調マップは読み込まない
    if (isEdit) return
    AsyncStorage.getItem(CONDITION_MAP_KEY).then(r => {
      if (!r) return
      try {
        const map = JSON.parse(r)
        if (map[today]) setCondLevel(map[today])
      } catch {}
    }).catch(() => {})
  }, [isEdit])

  // ── 編集モード: 既存記録をフォームに復元 ──
  useEffect(() => {
    if (!editId) return
    AsyncStorage.getItem(SESSIONS_KEY).then(raw => {
      if (!raw) return
      try {
        const list: TrainingSession[] = JSON.parse(raw)
        const sess = list.find(x => x.id === editId)
        if (!sess) return
        setSessionType(sess.session_type as typeof SESSION_TYPES[number]['key'])
        setSelectedEvent((sess.event as AthleticsEvent) ?? null)
        setHurdleHeight(sess.hurdle_height_cm ?? null)
        setDate(sess.session_date)
        if (sess.time_ms) {
          const t = fromMs(sess.time_ms)
          setTimeMin(t.min); setTimeSec(t.sec); setTimeCs(t.cs)
        }
        setDistanceM(sess.distance_m != null ? String(sess.distance_m) : '')
        // 本数ごとの内訳は保存していないため、編集時は1本目に代表タイムを復元するのみ（残りは空欄で再入力可）
        const rc = Math.max(1, sess.reps ?? 1)
        setRepCount(rc)
        if (sess.time_ms) {
          const rf = msToRepFields(sess.time_ms)
          setRepMins(Array.from({ length: rc }, (_, i) => i === 0 ? rf.min : ''))
          setRepSecs(Array.from({ length: rc }, (_, i) => i === 0 ? rf.sec : ''))
        } else {
          setRepMins(Array(rc).fill(''))
          setRepSecs(Array(rc).fill(''))
        }
        setFatigue(sess.fatigue_level ?? 6)
        setCondLevel(sess.condition_level ?? 6)
        setNotes(sess.notes ?? '')
      } catch {}
    }).catch(() => {})
  }, [editId])

  const typeInfo = SESSION_TYPES.find(st => st.key === sessionType)!
  const hasTime  = sessionType !== 'rest' && sessionType !== 'strength'
  const hasReps  = ['sprint','interval','drill','strength'].includes(sessionType)
  // 本数分だけタイム入力欄を並べる（スプリント・インターバル・ドリル）。ウェイトは本数=セット数のみでタイム欄は出さない
  const hasRepTimes = hasReps && hasTime
  // 距離は種目を問わず手動で入力できるように（スプリント・試合なども含め全種目で表示、休養のみ除外）
  const hasDist  = sessionType !== 'rest' && sessionType !== 'strength'

  // 本数の＋／−。増やすと配列を伸ばし、減らすと末尾を切り詰める（既存の入力値は保持）
  function changeRepCount(next: number) {
    const clamped = Math.max(1, Math.min(20, next))
    setRepCount(clamped)
    const resize = (arr: string[]) => {
      const a = arr.slice(0, clamped)
      while (a.length < clamped) a.push('')
      return a
    }
    setRepMins(resize)
    setRepSecs(resize)
  }

  async function handleSave(continueLogging = false) {
    unlockAudio(); Sounds.tap()
    setSaving(true)
    try {
      let time_ms: number | undefined
      let repTimesNote = ''
      if (hasRepTimes) {
        const parsedTimes = repMins.map((m, i) => parseRepTime(m, repSecs[i]))
        const valid = parsedTimes.filter((v): v is number => v != null)
        if (valid.length > 0) {
          time_ms = Math.min(...valid)
          if (repCount > 1) {
            const lines = parsedTimes
              .map((ms, i) => ms != null ? t('manualLog.repTimeLine', { n: i + 1, time: fmtRepTime(ms) }) : null)
              .filter((l): l is string => l != null)
            if (lines.length > 0) repTimesNote = `${t('manualLog.repTimesNoteHeader')}\n${lines.join('\n')}`
          }
        }
      } else if (hasTime) {
        time_ms = (timeMin || timeSec || timeCs) ? toMs(timeMin, timeSec, timeCs) : undefined
      }

      // 自重モード／本数ごとのタイムは、notesに構造化テキストとして変換する（既存メモがあれば末尾に追記）
      let finalNotes = notes.trim()
      if (sessionType === 'strength' && strengthMode === 'bodyweight' && bwSets.length > 0) {
        const valid = bwSets.filter(s => s.id && s.reps)
        if (valid.length > 0) {
          const bwText = t('manualLog.bodyweightNoteHeader') + '\n' + valid.map(s =>
            `${t(`manualLog.bodyweightExercises.${s.id}`)}　${s.reps}${t('manualLog.repsUnit')} × ${s.sets || '1'}${t('manualLog.setsUnit')}`
          ).join('\n')
          finalNotes = finalNotes ? `${bwText}\n\n${finalNotes}` : bwText
        }
      }
      if (repTimesNote) {
        finalNotes = finalNotes ? `${repTimesNote}\n\n${finalNotes}` : repTimesNote
      }

      // 練習タイプを切り替えても非表示になったフィールドの入力値が消えずに残るため、
      // 現在のタイプで実際に表示されている項目だけを保存する（隠れたゴーストデータの混入を防ぐ）
      const eventVisible = ['sprint','interval','race','tempo'].includes(sessionType)
      const fields = {
        session_date:    date,
        session_type:    sessionType,
        event:           eventVisible ? (selectedEvent ?? undefined) : undefined,
        hurdle_height_cm: (eventVisible && selectedEvent && isHurdleEvent(selectedEvent)) ? hurdleHeight ?? undefined : undefined,
        time_ms:         hasTime ? time_ms : undefined,
        distance_m:      (hasDist && distanceM) ? Number(distanceM) : undefined,
        reps:            hasReps ? repCount : undefined,
        fatigue_level:   fatigue,
        condition_level: condLevel,
        notes:           finalNotes || undefined,
      }

      if (isEdit && editId) {
        // ── 既存記録を上書き（id・created_at は保持） ──
        const sessions = await updateSessions(current =>
          current.map(sx => (sx.id === editId ? { ...sx, ...fields } : sx))
        )
        autoSyncTeam(sessions, { force: true }).catch(() => {})
        Toast.show({ type: 'success', text1: t('manualLog.toastUpdateSuccess'), visibilityTime: 1500 })
        setTimeout(() => backWithPossibleInterstitial(router), 400)
        return
      }

      const newSession: TrainingSession = {
        id:             `manual-${Date.now()}`,
        user_id:        (await AsyncStorage.getItem('userId').catch(() => null)) ?? 'local',
        created_at:     new Date().toISOString(),
        ...fields,
      }

      const sessions = await updateSessions(current => [newSession, ...current])
      autoSyncTeam(sessions, { force: true }).catch(() => {})

      if (continueLogging) {
        // 同じ日付・練習タイプのまま、種目ごとの入力だけをリセットして
        // 続けて次の種目を記録できるようにする（試合や1回の練習で複数種目を記録したい場合）
        Toast.show({ type: 'success', text1: t('manualLog.toastContinueSuccess'), visibilityTime: 1800 })
        setSelectedEvent(null)
        setHurdleHeight(null)
        setTimeMin(''); setTimeSec(''); setTimeCs('')
        setDistanceM('')
        setRepCount(1); setRepMins(['']); setRepSecs([''])
        setNotes('')
        setBwSets([])
        setSaving(false)
        return
      }

      Toast.show({ type: 'success', text1: t('manualLog.toastSaveSuccess'), visibilityTime: 1500 })

      setTimeout(() => backWithPossibleInterstitial(router), 400)
    } catch {
      Toast.show({ type: 'error', text1: t('manualLog.toastSaveError'), visibilityTime: 2000 })
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
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={10} accessibilityLabel={t('manualLog.back')}>
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[s.headerTitle, { color: colors.text }]}>{isEdit ? t('manualLog.editTitle') : t('manualLog.title')}</Text>
            <TouchableOpacity
              onPress={() => handleSave()}
              disabled={saving}
              style={[s.saveBtn, { backgroundColor: BRAND, opacity: saving ? 0.6 : 1 }]}
            >
              <Text style={s.saveBtnText}>{saving ? t('manualLog.saving') : isEdit ? t('manualLog.update') : t('manualLog.save')}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

            {/* ── 日付選択（カレンダー） ── */}
            <Section title={t('manualLog.sections.date')}>
              <Text style={{ color: colors.textSec, fontSize: 12, marginBottom: 6 }}>
                {t('manualLog.selectedLabel')}<Text style={{ color: colors.text, fontWeight: '700' }}>{date === today ? t('manualLog.selectedToday', { date }) : date}</Text>
              </Text>
              <CalendarPicker value={date} onChange={setDate} />
            </Section>

            {/* ── 練習タイプ ── */}
            <Section title={t('manualLog.sections.sessionType')}>
              <Text style={{ color: colors.textSec, fontSize: 12, marginBottom: 8 }}>
                {t('manualLog.sessionTypeHint')}
              </Text>
              <View style={s.typeGrid}>
                {SESSION_TYPES.map(st => (
                  <TouchableOpacity
                    key={st.key}
                    onPress={() => { setSessionType(st.key); Sounds.tap() }}
                    style={[
                      s.typeBtn,
                      { borderColor: st.color + '44' },
                      sessionType === st.key && { backgroundColor: st.color + '22', borderColor: st.color },
                    ]}
                  >
                    <Ionicons name={st.ionicon as any} size={18} color={sessionType === st.key ? st.color : colors.textSec} />
                    <Text style={[s.typeBtnLabel, { color: sessionType === st.key ? st.color : colors.textSec }]}>
                      {t(`manualLog.sessionTypes.${st.key}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Section>

            {/* ── 種目選択（スプリント・インターバル・試合の時） ── */}
            {['sprint','interval','race','tempo'].includes(sessionType) && (
              <Section title={t('manualLog.sections.event')}>
                {selectedEvent && (
                  <View style={[s.eventSelectedRow]}>
                    <View style={[s.eventChip, { backgroundColor: typeInfo.color + '22', borderColor: typeInfo.color }]}>
                      <Text style={[s.eventChipText, { color: typeInfo.color }]}>{getEventLabel(selectedEvent, language)}</Text>
                    </View>
                    <TouchableOpacity onPress={() => { setSelectedEvent(null); Sounds.tap() }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={t('manualLog.clearEvent')}>
                      <Ionicons name="close-circle" size={18} color={colors.textHint} />
                    </TouchableOpacity>
                  </View>
                )}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {EVENT_CATEGORIES.map(cat => {
                    const active = cat.events.includes(selectedEvent as AthleticsEvent)
                    return (
                      <TouchableOpacity
                        key={cat.key}
                        onPress={() => { setEventCategoryModal(cat.key); Sounds.tap() }}
                        style={[
                          s.eventChip,
                          active && { backgroundColor: typeInfo.color + '22', borderColor: typeInfo.color },
                        ]}
                      >
                        <Text style={[s.eventChipText, { color: active ? typeInfo.color : colors.textSec }]}>
                          {t(`manualLog.eventCategories.${cat.key}`)}
                        </Text>
                        <Ionicons name="chevron-down" size={12} color={active ? typeInfo.color : colors.textHint} style={{ marginLeft: 4 }} />
                      </TouchableOpacity>
                    )
                  })}
                </ScrollView>
              </Section>
            )}

            {/* ── ハードルの高さ ── */}
            {selectedEvent && isHurdleEvent(selectedEvent) && (
              <Section title={t('manualLog.sections.hurdleHeight')}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {STANDARD_HURDLE_HEIGHTS.map(h => {
                    const active = hurdleHeight === h.cm
                    return (
                      <TouchableOpacity
                        key={h.cm}
                        onPress={() => { setHurdleHeight(h.cm); Sounds.tap() }}
                        style={[
                          s.eventChip,
                          active && { backgroundColor: typeInfo.color + '22', borderColor: typeInfo.color },
                        ]}
                      >
                        <Text style={[s.eventChipText, { color: active ? typeInfo.color : colors.textSec }]}>
                          {h.label}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </Section>
            )}

            {/* ── 種目カテゴリーモーダル ── */}
            <Modal visible={!!eventCategoryModal} transparent animationType="fade" onRequestClose={() => setEventCategoryModal(null)}>
              <TouchableOpacity style={s.eventModalBackdrop} activeOpacity={1} onPress={() => setEventCategoryModal(null)}>
                <TouchableOpacity activeOpacity={1} style={[s.eventModalSheet, { backgroundColor: colors.surface }]}>
                  <Text style={[s.eventModalTitle, { color: colors.text }]}>{eventCategoryModal ? t(`manualLog.eventCategories.${eventCategoryModal}`) : ''}</Text>
                  <View style={s.eventModalGrid}>
                    {(EVENT_CATEGORIES.find(c => c.key === eventCategoryModal)?.events ?? []).map(ev => (
                      <TouchableOpacity
                        key={ev}
                        onPress={() => { setSelectedEvent(ev); setEventCategoryModal(null); Sounds.tap() }}
                        style={[
                          s.eventModalChip,
                          selectedEvent === ev && { backgroundColor: typeInfo.color + '22', borderColor: typeInfo.color },
                        ]}
                      >
                        <Text style={[s.eventChipText, { color: selectedEvent === ev ? typeInfo.color : colors.textSec }]}>
                          {getEventLabel(ev, language)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity style={s.eventModalClose} onPress={() => setEventCategoryModal(null)}>
                    <Text style={{ color: colors.textSec, fontSize: 14, fontWeight: '700' }}>{t('manualLog.close')}</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              </TouchableOpacity>
            </Modal>

            {/* ── タイム入力（本数を持たない種目のみ。本数がある種目は下の「本数」セクションにまとめる） ── */}
            {!hasReps && hasTime && (
              <Section title={t('manualLog.sections.time')}>
                <View style={s.timeRow}>
                  <TimeField value={timeMin} onChange={setTimeMin} placeholder="0" label={t('manualLog.timeFields.min')} colors={colors} />
                  <Text style={[s.timeSep, { color: colors.textHint }]}>:</Text>
                  <TimeField value={timeSec} onChange={setTimeSec} placeholder="00" label={t('manualLog.timeFields.sec')} colors={colors} />
                  <Text style={[s.timeSep, { color: colors.textHint }]}>.</Text>
                  <TimeField value={timeCs}  onChange={setTimeCs}  placeholder="00" label={t('manualLog.timeFields.cs')} colors={colors} />
                </View>
              </Section>
            )}

            {/* ── ウェイト: 器具 / 自重 切り替え ── */}
            {sessionType === 'strength' && (
              <Section title={t('manualLog.sections.trainingType')}>
                <View style={s.modeToggleRow}>
                  {(['weight', 'bodyweight'] as const).map(m => (
                    <TouchableOpacity
                      key={m}
                      onPress={() => { setStrengthMode(m); Sounds.tap() }}
                      style={[s.modeToggleBtn, strengthMode === m && { backgroundColor: '#FF6B35', borderColor: '#FF6B35' }]}
                    >
                      <Text style={{ fontSize: 16 }}>{m === 'weight' ? '🏋️' : '🤸'}</Text>
                      <Text style={[s.modeToggleBtnText, { color: strengthMode === m ? '#fff' : colors.textSec }]}>
                        {t(`manualLog.strengthMode.${m}`)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Section>
            )}

            {/* ── 自重トレーニングビルダー ── */}
            {sessionType === 'strength' && strengthMode === 'bodyweight' && (
              <Section title={t('manualLog.sections.bodyweight')}>
                {/* 種目選択チップ */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 8 }}>
                  {BODYWEIGHT_EXERCISES.map(ex => {
                    const already = bwSets.some(s => s.id === ex.id)
                    const exLabel = t(`manualLog.bodyweightExercises.${ex.id}`)
                    return (
                      <TouchableOpacity
                        key={ex.id}
                        onPress={() => {
                          Sounds.tap()
                          if (already) {
                            setBwSets(prev => prev.filter(s => s.id !== ex.id))
                          } else {
                            setBwSets(prev => [...prev, { id: ex.id, reps: '', sets: '3' }])
                          }
                        }}
                        style={[
                          s.bwChip,
                          already && { backgroundColor: '#FF6B3522', borderColor: '#FF6B35' },
                        ]}
                      >
                        <Text style={{ fontSize: 14 }}>{ex.emoji}</Text>
                        <Text style={[s.bwChipText, { color: already ? '#FF6B35' : colors.textSec }]}>{exLabel}</Text>
                        {already && <Ionicons name="checkmark-circle" size={14} color="#FF6B35" />}
                      </TouchableOpacity>
                    )
                  })}
                </ScrollView>

                {/* 選択済み種目のセット・回数入力 */}
                {bwSets.length > 0 && (
                  <View style={{ gap: 8, marginTop: 4 }}>
                    {bwSets.map((bw, idx) => {
                      const bwLabel = t(`manualLog.bodyweightExercises.${bw.id}`)
                      return (
                      <View key={bw.id} style={[s.bwSetRow, { backgroundColor: colors.surface2 }]}>
                        <Text style={[s.bwSetName, { color: colors.text }]}>{bwLabel}</Text>
                        <View style={s.bwInputGroup}>
                          <TextInput
                            value={bw.reps}
                            onChangeText={v => setBwSets(prev => prev.map((x, i) => i === idx ? { ...x, reps: v.replace(/[^0-9]/g, '') } : x))}
                            placeholder={t('manualLog.repsUnit')}
                            placeholderTextColor={colors.textHint}
                            keyboardType="numeric"
                            style={[s.bwNumInput, { backgroundColor: colors.surface, color: colors.text }]}
                            textAlign="center"
                          />
                          <Text style={[s.bwUnit, { color: colors.textSec }]}>{t('manualLog.repsUnit')}</Text>
                          <Text style={[s.bwSep, { color: colors.textHint }]}>×</Text>
                          <TextInput
                            value={bw.sets}
                            onChangeText={v => setBwSets(prev => prev.map((x, i) => i === idx ? { ...x, sets: v.replace(/[^0-9]/g, '') } : x))}
                            placeholder="3"
                            placeholderTextColor={colors.textHint}
                            keyboardType="numeric"
                            style={[s.bwNumInput, { backgroundColor: colors.surface, color: colors.text }]}
                            textAlign="center"
                          />
                          <Text style={[s.bwUnit, { color: colors.textSec }]}>{t('manualLog.setsUnit')}</Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => { setBwSets(prev => prev.filter((_, i) => i !== idx)); Sounds.tap() }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityLabel={t('manualLog.deleteExercise', { name: bwLabel })}
                        >
                          <Ionicons name="close-circle" size={20} color={colors.textHint} />
                        </TouchableOpacity>
                      </View>
                      )
                    })}
                  </View>
                )}
              </Section>
            )}

            {/* ── 本数（＋で増やすとその本数分だけタイム欄が並ぶ／ウェイト以外 or 器具ウェイト） ── */}
            {hasReps && !(sessionType === 'strength' && strengthMode === 'bodyweight') && (
              <Section title={hasRepTimes ? t('manualLog.sections.repsAndTime') : t('manualLog.sections.reps')}>
                <View style={s.stepperRow}>
                  <HapticTouch
                    haptic="tap"
                    onPress={() => changeRepCount(repCount - 1)}
                    disabled={repCount <= 1}
                    style={[s.stepperBtn, { backgroundColor: colors.surface2, opacity: repCount <= 1 ? 0.4 : 1 }]}
                    hitSlop={4}
                    accessibilityLabel={t('manualLog.decreaseReps')}
                  >
                    <Ionicons name="remove" size={18} color={colors.text} />
                  </HapticTouch>
                  <Text style={[s.stepperCount, { color: colors.text }]}>{repCount}</Text>
                  <Text style={[s.unitLabel, { color: colors.textSec }]}>{t('manualLog.repUnit')}</Text>
                  <HapticTouch
                    haptic="tap"
                    onPress={() => changeRepCount(repCount + 1)}
                    style={[s.stepperBtn, { backgroundColor: BRAND + '18' }]}
                    hitSlop={4}
                    accessibilityLabel={t('manualLog.increaseReps')}
                  >
                    <Ionicons name="add" size={18} color={BRAND} />
                  </HapticTouch>
                </View>

                {hasRepTimes && (
                  <View style={{ gap: 8, marginTop: 12 }}>
                    {Array.from({ length: repCount }, (_, i) => (
                      <View key={i} style={s.repRow}>
                        {repCount > 1 && (
                          <Text style={[s.repRowLabel, { color: colors.textSec }]}>{t('manualLog.repN', { n: i + 1 })}</Text>
                        )}
                        <View style={s.repTimeGroup}>
                          <TextInput
                            value={repMins[i] ?? ''}
                            onChangeText={v => setRepMins(prev => prev.map((val, idx) => idx === i ? v.replace(/[^0-9]/g, '') : val))}
                            placeholder="0" placeholderTextColor={colors.textHint}
                            keyboardType="number-pad" maxLength={2} textAlign="center"
                            style={[s.repTimeInput, { width: 44, backgroundColor: colors.surface2, color: colors.text }]}
                          />
                          <Text style={[s.repTimeSep, { color: colors.textSec }]}>{t('manualLog.repTimeMin')}</Text>
                          <TextInput
                            value={repSecs[i] ?? ''}
                            onChangeText={v => setRepSecs(prev => prev.map((val, idx) => idx === i ? v.replace(/[^0-9.]/g, '') : val))}
                            placeholder="12.34" placeholderTextColor={colors.textHint}
                            keyboardType="decimal-pad" maxLength={5} textAlign="center"
                            style={[s.repTimeInput, { flex: 1, backgroundColor: colors.surface2, color: colors.text }]}
                          />
                          <Text style={[s.repTimeSep, { color: colors.textSec }]}>{t('manualLog.repTimeSec')}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </Section>
            )}

            {/* ── 距離 ── */}
            {hasDist && (
              <Section title={t('manualLog.sections.distance')}>
                <View style={s.inlineRow}>
                  <TextInput
                    value={distanceM}
                    onChangeText={v => setDistanceM(v.replace(/[^0-9]/g, ''))}
                    placeholder={t('manualLog.distancePlaceholder')}
                    placeholderTextColor={colors.textHint}
                    keyboardType="numeric"
                    style={[s.shortInput, { backgroundColor: colors.surface2, color: colors.text }]}
                  />
                  <Text style={[s.unitLabel, { color: colors.textSec }]}>m</Text>
                </View>
              </Section>
            )}

            {/* ── 疲労度 ── */}
            <Section title={t('manualLog.sections.fatigue')}>
              <View style={s.fatigueRow}>
                {FATIGUE.map(f => (
                  <TouchableOpacity
                    key={f.v}
                    onPress={() => { setFatigue(f.v); Sounds.tap() }}
                    style={[s.fatigueBtn, fatigue === f.v && { backgroundColor: BRAND + '22', borderColor: BRAND }]}
                  >
                    <Text style={{ fontSize: 22 }}>{f.emoji}</Text>
                    <Text style={[s.fatigueBtnLabel, { color: fatigue === f.v ? BRAND : colors.textHint }]}>{t(`manualLog.fatigueLevels.${f.v}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Section>

            {/* ── 練習メニュー ── */}
            <Section title={t('manualLog.sections.menu')}>
              {menuTemplates.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginBottom: 8 }}
                  contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}
                >
                  {menuTemplates.map(tpl => (
                    <TouchableOpacity
                      key={tpl.id}
                      style={[s.tplChip, { backgroundColor: colors.surface2, borderColor: colors.border }]}
                      onPress={() => setNotes(tpl.content)}
                      onLongPress={() => Alert.alert(t('manualLog.deleteTemplateTitle'), t('manualLog.deleteTemplateBody', { name: tpl.name }), [
                        { text: t('manualLog.cancel'), style: 'cancel' },
                        { text: t('manualLog.delete'), style: 'destructive', onPress: () => deleteTemplate(tpl.id) },
                      ])}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.tplChipText, { color: colors.text }]} numberOfLines={1}>{tpl.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder={t('manualLog.notesPlaceholder')}
                placeholderTextColor={colors.textHint}
                multiline
                numberOfLines={4}
                autoCorrect={false}
                spellCheck={false}
                style={[s.notesInput, { backgroundColor: colors.surface2, color: colors.text }]}
              />
              {notes.trim().length > 0 && (
                <TouchableOpacity style={s.saveTplBtn} onPress={saveTemplate} activeOpacity={0.8}>
                  <Ionicons name="bookmark-outline" size={14} color={BRAND} />
                  <Text style={s.saveTplBtnText}>{t('manualLog.saveAsTemplate')}</Text>
                </TouchableOpacity>
              )}
            </Section>

            {/* 同じ日に別の種目も記録したい場合（例: 100m と 200m を同じ練習で） */}
            {!isEdit && (
              <TouchableOpacity
                onPress={() => handleSave(true)}
                disabled={saving}
                style={[s.continueBtn, { borderColor: BRAND, opacity: saving ? 0.5 : 1 }]}
                activeOpacity={0.8}
              >
                <Ionicons name="add-circle-outline" size={16} color={BRAND} />
                <Text style={[s.continueBtnText, { color: BRAND }]}>{t('manualLog.continueLogging')}</Text>
              </TouchableOpacity>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* ── テンプレート名入力モーダル（Alert.promptの代替・全プラットフォーム対応） ── */}
      <Modal visible={tplNameModal} transparent animationType="fade" onRequestClose={() => setTplNameModal(false)}>
        <TouchableOpacity style={s.eventModalBackdrop} activeOpacity={1} onPress={() => setTplNameModal(false)}>
          <TouchableOpacity activeOpacity={1} style={[s.tplModalSheet, { backgroundColor: colors.surface }]}>
            <Text style={[s.eventModalTitle, { color: colors.text }]}>{t('manualLog.templateModal.title')}</Text>
            <Text style={{ color: colors.textSec, fontSize: 13 }}>{t('manualLog.templateModal.hint')}</Text>
            <TextInput
              value={tplNameInput}
              onChangeText={setTplNameInput}
              placeholder={t('manualLog.templateModal.placeholder')}
              placeholderTextColor={colors.textHint}
              autoFocus
              style={[s.tplModalInput, { backgroundColor: colors.surface2, color: colors.text }]}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <TouchableOpacity style={[s.tplModalBtn, { backgroundColor: colors.surface2 }]} onPress={() => setTplNameModal(false)}>
                <Text style={{ color: colors.textSec, fontSize: 14, fontWeight: '700' }}>{t('manualLog.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.tplModalBtn, { backgroundColor: BRAND, opacity: tplNameInput.trim() ? 1 : 0.5 }]}
                onPress={confirmSaveTemplate}
                disabled={!tplNameInput.trim()}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{t('manualLog.save')}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  )
}

// ── サブコンポーネント ─────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme()
  return (
    <View style={s.sectionShadow}>
      <View style={[s.section, { backgroundColor: colors.surface }]}>
        <Text style={[s.sectionTitle, { color: colors.textSec }]}>{title}</Text>
        {children}
      </View>
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
        onChangeText={v => onChange(v.replace(/[^0-9]/g, ''))}
        placeholder={placeholder}
        placeholderTextColor={colors.textHint}
        keyboardType="numeric"
        maxLength={3}
        style={[s.timeInput, { backgroundColor: colors.surface2, color: colors.text }]}
        textAlign="center"
      />
      <Text style={[s.timeLabel, { color: colors.textSec }]}>{label}</Text>
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
  saveBtn:      { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 50 },
  saveBtnText:  { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },

  content:  { padding: 16, paddingTop: 12, gap: 14 },
  sectionShadow: {
    borderRadius: 18,
    shadowColor: '#0d1f16',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  section:  { gap: 12, borderRadius: 18, padding: 16, overflow: 'hidden' },
  sectionTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },

  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeBtn: {
    flexBasis: '31%', flexGrow: 1,
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 10, paddingVertical: 11,
    borderRadius: 14, borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  typeBtnLabel: { fontSize: 12.5, fontWeight: '700' },

  dateChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'transparent',
  },
  dateChipText: { fontSize: 12, fontWeight: '700' },

  eventChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)',
  },
  eventChipText: { fontSize: 12, fontWeight: '700' },
  eventSelectedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },

  eventModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  eventModalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32, gap: 14 },
  eventModalTitle: { fontSize: 16, fontWeight: '800' },
  eventModalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  eventModalChip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)',
  },
  eventModalClose: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 20 },

  tplModalSheet: { borderRadius: 20, padding: 20, gap: 12, marginHorizontal: 24, alignSelf: 'center', width: '100%', maxWidth: 340 },
  tplModalInput: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  tplModalBtn:   { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12 },

  timeRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  timeSep:      { fontSize: 24, fontWeight: '800', marginBottom: 10 },
  timeFieldWrap:{ alignItems: 'center', gap: 5 },
  timeInput: {
    width: 64, height: 58, borderRadius: 16,
    fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'],
  },
  timeLabel: { fontSize: 10.5, fontWeight: '700' },

  inlineRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shortInput: {
    width: 100, height: 48, borderRadius: 14,
    fontSize: 18, fontWeight: '700', paddingHorizontal: 12, fontVariant: ['tabular-nums'],
  },
  unitLabel:  { fontSize: 14, fontWeight: '700' },

  stepperRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperBtn:   { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepperCount: { fontSize: 22, fontWeight: '900', minWidth: 30, textAlign: 'center', fontVariant: ['tabular-nums'] },

  repRow:       { flexDirection: 'row', alignItems: 'center', gap: 10 },
  repRowLabel:  { fontSize: 12, fontWeight: '700', width: 46 },
  repTimeGroup: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  repTimeInput: {
    height: 42, borderRadius: 12,
    fontSize: 15, fontWeight: '700', paddingHorizontal: 10, fontVariant: ['tabular-nums'],
  },
  repTimeSep:   { fontSize: 12, fontWeight: '600' },

  fatigueRow: { flexDirection: 'row', gap: 6 },
  fatigueBtn: {
    flex: 1, alignItems: 'center', gap: 4,
    paddingVertical: 12, borderRadius: 14,
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.1)',
  },
  fatigueBtnLabel: { fontSize: 10, fontWeight: '700', textAlign: 'center' },

  notesInput: {
    borderRadius: 14, padding: 12,
    fontSize: 13, minHeight: 80, textAlignVertical: 'top',
  },
  tplChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1,
    maxWidth: 160,
  },
  tplChipText: { fontSize: 13 },
  saveTplBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 8, alignSelf: 'flex-start',
    paddingVertical: 4, paddingHorizontal: 2,
  },
  saveTplBtnText: { fontSize: 12, color: BRAND },
  continueBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 20, borderWidth: 1.5, borderRadius: 50, paddingVertical: 13,
  },
  continueBtnText: { fontSize: 14, fontWeight: '700' },

  // 自重トレーニング
  modeToggleRow:    { flexDirection: 'row', gap: 10 },
  modeToggleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.1)',
  },
  modeToggleBtnText: { fontSize: 14, fontWeight: '700' },
  bwChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.1)',
  },
  bwChipText: { fontSize: 12, fontWeight: '700' },
  bwSetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
  },
  bwSetName:    { fontSize: 13, fontWeight: '700', flex: 1 },
  bwInputGroup: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bwNumInput: {
    width: 52, height: 38, borderRadius: 8,
    fontSize: 15, fontWeight: '700',
  },
  bwUnit: { fontSize: 12, fontWeight: '600' },
  bwSep:  { fontSize: 14, fontWeight: '700', marginHorizontal: 2 },
})

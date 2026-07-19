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
import { useTheme } from '../context/ThemeContext'
import { Sounds, unlockAudio } from '../lib/sounds'
import type { TrainingSession, AthleticsEvent } from '../types'
import { autoSyncTeam } from '../lib/teamAutoSync'
import { getTier } from '../lib/adGate'
import { shouldShowInterstitial, showInterstitialAd } from '../lib/admob'
import { todayLocalISO } from '../lib/dateLocal'
import { STANDARD_HURDLE_HEIGHTS, isHurdleEvent } from '../lib/hurdleHeights'

const SESSIONS_KEY      = 'trackmate_sessions'
const CONDITION_MAP_KEY = 'trackmate_condition_map'
const MENU_TEMPLATES_KEY = 'trackmate_menu_templates'
const BRAND             = '#E53935'

type MenuTemplate = { id: string; name: string; content: string }

// ── 種目定義 ──────────────────────────────────────────────
const SESSION_TYPES = [
  { key: 'sprint',   label: 'スプリント',  ionicon: 'flash',     color: '#FF6B6B' },
  { key: 'interval', label: 'インターバル', ionicon: 'sync',      color: '#E53935' },
  { key: 'tempo',    label: 'テンポ走',    ionicon: 'walk',      color: '#FF9500' },
  { key: 'easy',     label: 'ジョグ',      ionicon: 'leaf',      color: '#4ECDC4' },
  { key: 'long',     label: 'ロング走',    ionicon: 'map',       color: '#5AC8FA' },
  { key: 'drill',    label: 'ドリル',      ionicon: 'construct', color: '#AF52DE' },
  { key: 'strength', label: 'ウェイト',    ionicon: 'barbell',   color: '#FF6B35' },
  { key: 'race',     label: '試合',        ionicon: 'trophy',    color: '#FFD700' },
  { key: 'rest',     label: '休養',        ionicon: 'moon',      color: '#666'    },
] as const

// ── 種目を分類分け（モーダル用） ──────────────────────────
const EVENT_CATEGORIES: { label: string; events: AthleticsEvent[] }[] = [
  { label: 'スプリント', events: ['100m','200m','300m','400m','300mH'] },
  { label: '中距離',    events: ['800m','1500m','3000m'] },
  { label: '長距離',    events: ['5000m','10000m','half_marathon','marathon','競歩'] },
  { label: 'ハードル',  events: ['100mH','110mH','400mH'] },
  { label: '障害',      events: ['3000mSC'] },
  { label: '跳躍',      events: ['走幅跳','三段跳','走高跳','棒高跳'] },
  { label: '投擲',      events: ['砲丸投','やり投','円盤投'] },
  { label: '混成',      events: ['十種競技','七種競技','八種競技'] },
  { label: 'リレー',    events: ['4×100mR','4×400mR'] },
]
function eventLabel(ev: AthleticsEvent): string {
  if (ev === 'half_marathon') return 'ハーフ'
  if (ev === 'marathon') return 'マラソン'
  return ev
}

// ── 自重トレーニング種目 ──────────────────────────────────
const BODYWEIGHT_EXERCISES = [
  { name: '腹筋',               emoji: '💪' },
  { name: '腕立て伏せ',         emoji: '🤸' },
  { name: 'スクワット',         emoji: '🦵' },
  { name: 'プランク',           emoji: '🧘' },
  { name: 'ランジ',             emoji: '🏃' },
  { name: '背筋',               emoji: '🔥' },
  { name: 'ヒップリフト',       emoji: '🍑' },
  { name: 'クランチ',           emoji: '💢' },
  { name: 'バーピー',           emoji: '⚡' },
  { name: 'マウンテンクライマー', emoji: '🧗' },
  { name: 'ジャンピングジャック', emoji: '⭐' },
  { name: 'ダイアゴナル',       emoji: '✨' },
  { name: 'ニートゥーエルボー', emoji: '🔄' },
  { name: 'サイドプランク',     emoji: '↔️' },
  { name: 'カーフレイズ',       emoji: '👟' },
]

type BwSet = { name: string; reps: string; sets: string }

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

  const DOW = ['日','月','火','水','木','金','土']

  return (
    <View style={cal.wrap}>
      {/* ヘッダー（月移動） */}
      <View style={cal.header}>
        <HapticTouch haptic="tap" onPress={prevMonth} style={cal.arrow}>
          <Ionicons name="chevron-back" size={18} color="#6b7280" />
        </HapticTouch>
        <Text style={cal.monthLabel}>{viewYear}年 {viewMonth + 1}月</Text>
        <HapticTouch haptic="tap" onPress={nextMonth} style={cal.arrow}>
          <Ionicons name="chevron-forward" size={18} color="#6b7280" />
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

const cal = StyleSheet.create({
  wrap:       { borderRadius: 14, overflow: 'hidden', backgroundColor: '#f8f8fa', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
  arrow:      { padding: 6 },
  monthLabel: { color: '#111827', fontSize: 15, fontWeight: '800' },
  dowRow:     { flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 4 },
  dow:        { flex: 1, textAlign: 'center', color: '#9ca3af', fontSize: 11, fontWeight: '700' },
  row:        { flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 2 },
  cell:       { flex: 1, height: 36, alignItems: 'center', justifyContent: 'center' },
  dayText:    { color: '#111827', fontSize: 13, fontWeight: '600' },
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

export default function ManualLogScreen() {
  const router = useRouter()
  const { colors } = useTheme()
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
  const [repsStr,       setRepsStr]       = useState('')
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
    const t: MenuTemplate = { id: `tpl_${Date.now()}`, name, content: trimmed }
    const next = [t, ...menuTemplates]
    setMenuTemplates(next)
    AsyncStorage.setItem(MENU_TEMPLATES_KEY, JSON.stringify(next)).catch(() => {})
    Toast.show({ type: 'success', text1: `「${name}」を保存しました` })
    setTplNameModal(false)
  }, [notes, tplNameInput, menuTemplates])

  const deleteTemplate = useCallback((id: string) => {
    const next = menuTemplates.filter(t => t.id !== id)
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
        setRepsStr(sess.reps != null ? String(sess.reps) : '')
        setFatigue(sess.fatigue_level ?? 6)
        setCondLevel(sess.condition_level ?? 6)
        setNotes(sess.notes ?? '')
      } catch {}
    }).catch(() => {})
  }, [editId])

  const typeInfo = SESSION_TYPES.find(t => t.key === sessionType)!
  const hasTime  = sessionType !== 'rest' && sessionType !== 'strength'
  const hasReps  = ['sprint','interval','drill','strength'].includes(sessionType)
  // 距離は種目を問わず手動で入力できるように（スプリント・試合なども含め全種目で表示、休養のみ除外）
  const hasDist  = sessionType !== 'rest' && sessionType !== 'strength'

  async function handleSave() {
    unlockAudio(); Sounds.tap()
    setSaving(true)
    try {
      const time_ms = (timeMin || timeSec || timeCs)
        ? toMs(timeMin, timeSec, timeCs)
        : undefined

      // 自重モードのときは種目リストをnotesに変換（既存メモがあれば末尾に追記）
      let finalNotes = notes.trim()
      if (sessionType === 'strength' && strengthMode === 'bodyweight' && bwSets.length > 0) {
        const valid = bwSets.filter(s => s.name && s.reps)
        if (valid.length > 0) {
          const bwText = '【自重トレーニング】\n' + valid.map(s =>
            `${s.name}　${s.reps}回 × ${s.sets || '1'}セット`
          ).join('\n')
          finalNotes = finalNotes ? `${bwText}\n\n${finalNotes}` : bwText
        }
      }

      const raw = await AsyncStorage.getItem(SESSIONS_KEY)
      let sessions: TrainingSession[] = []
      try { if (raw) sessions = JSON.parse(raw) } catch {}  // データ破損でも保存を継続

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
        reps:            (hasReps && repsStr)   ? Number(repsStr)   : undefined,
        fatigue_level:   fatigue,
        condition_level: condLevel,
        notes:           finalNotes || undefined,
      }

      if (isEdit && editId) {
        // ── 既存記録を上書き（id・created_at は保持） ──
        sessions = sessions.map(sx => (sx.id === editId ? { ...sx, ...fields } : sx))
        await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
        autoSyncTeam(sessions, { force: true }).catch(() => {})
        Toast.show({ type: 'success', text1: '練習を更新しました ✓', visibilityTime: 1500 })
        setTimeout(() => router.back(), 400)
        return
      }

      const newSession: TrainingSession = {
        id:             `manual-${Date.now()}`,
        user_id:        (await AsyncStorage.getItem('userId').catch(() => null)) ?? 'local',
        created_at:     new Date().toISOString(),
        ...fields,
      }

      sessions.unshift(newSession)
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
      autoSyncTeam(sessions, { force: true }).catch(() => {})
      Toast.show({ type: 'success', text1: '練習を記録しました ✓', visibilityTime: 1500 })

      // フリープランのみ：2回に1回インタースティシャル広告を表示（新規記録時のみ）
      const tier = await getTier()
      if (tier === 'free') {
        const showAd = await shouldShowInterstitial()
        if (showAd) await showInterstitialAd()
      }

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
            <Text style={[s.headerTitle, { color: colors.text }]}>{isEdit ? '記録を編集' : '手動入力'}</Text>
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={[s.saveBtn, { backgroundColor: '#1c1c1e', opacity: saving ? 0.6 : 1 }]}
            >
              <Text style={s.saveBtnText}>{saving ? '保存中...' : isEdit ? '更新' : '保存'}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

            {/* ── 日付選択（カレンダー） ── */}
            <Section title="日付">
              <Text style={{ color: '#6b7280', fontSize: 12, marginBottom: 6 }}>
                選択中: <Text style={{ color: '#111827', fontWeight: '700' }}>{date === today ? `今日 (${date})` : date}</Text>
              </Text>
              <CalendarPicker value={date} onChange={setDate} />
            </Section>

            {/* ── 練習タイプ ── */}
            <Section title="練習タイプ">
              <Text style={{ color: colors.textSec, fontSize: 12, marginBottom: 8 }}>
                「ポイント練習」は、インターバル・テンポ走・スプリントなど質を重視する練習のことです。内容に近いものを選んでください。
              </Text>
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
                    <Ionicons name={t.ionicon as any} size={18} color={sessionType === t.key ? t.color : colors.textSec} />
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
                {selectedEvent && (
                  <View style={[s.eventSelectedRow]}>
                    <View style={[s.eventChip, { backgroundColor: typeInfo.color + '22', borderColor: typeInfo.color }]}>
                      <Text style={[s.eventChipText, { color: typeInfo.color }]}>{eventLabel(selectedEvent)}</Text>
                    </View>
                    <TouchableOpacity onPress={() => { setSelectedEvent(null); Sounds.tap() }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={18} color={colors.textHint} />
                    </TouchableOpacity>
                  </View>
                )}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {EVENT_CATEGORIES.map(cat => {
                    const active = cat.events.includes(selectedEvent as AthleticsEvent)
                    return (
                      <TouchableOpacity
                        key={cat.label}
                        onPress={() => { setEventCategoryModal(cat.label); Sounds.tap() }}
                        style={[
                          s.eventChip,
                          active && { backgroundColor: typeInfo.color + '22', borderColor: typeInfo.color },
                        ]}
                      >
                        <Text style={[s.eventChipText, { color: active ? typeInfo.color : colors.textSec }]}>
                          {cat.label}
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
              <Section title="ハードルの高さ">
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
                  <Text style={[s.eventModalTitle, { color: colors.text }]}>{eventCategoryModal}</Text>
                  <View style={s.eventModalGrid}>
                    {(EVENT_CATEGORIES.find(c => c.label === eventCategoryModal)?.events ?? []).map(ev => (
                      <TouchableOpacity
                        key={ev}
                        onPress={() => { setSelectedEvent(ev); setEventCategoryModal(null); Sounds.tap() }}
                        style={[
                          s.eventModalChip,
                          selectedEvent === ev && { backgroundColor: typeInfo.color + '22', borderColor: typeInfo.color },
                        ]}
                      >
                        <Text style={[s.eventChipText, { color: selectedEvent === ev ? typeInfo.color : colors.textSec }]}>
                          {eventLabel(ev)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity style={s.eventModalClose} onPress={() => setEventCategoryModal(null)}>
                    <Text style={{ color: colors.textSec, fontSize: 14, fontWeight: '700' }}>閉じる</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              </TouchableOpacity>
            </Modal>

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

            {/* ── ウェイト: 器具 / 自重 切り替え ── */}
            {sessionType === 'strength' && (
              <Section title="トレーニング種別">
                <View style={s.modeToggleRow}>
                  {(['weight', 'bodyweight'] as const).map(m => (
                    <TouchableOpacity
                      key={m}
                      onPress={() => { setStrengthMode(m); Sounds.tap() }}
                      style={[s.modeToggleBtn, strengthMode === m && { backgroundColor: '#FF6B35', borderColor: '#FF6B35' }]}
                    >
                      <Text style={{ fontSize: 16 }}>{m === 'weight' ? '🏋️' : '🤸'}</Text>
                      <Text style={[s.modeToggleBtnText, { color: strengthMode === m ? '#fff' : colors.textSec }]}>
                        {m === 'weight' ? '器具ウェイト' : '自重'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Section>
            )}

            {/* ── 自重トレーニングビルダー ── */}
            {sessionType === 'strength' && strengthMode === 'bodyweight' && (
              <Section title="種目・回数">
                {/* 種目選択チップ */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 8 }}>
                  {BODYWEIGHT_EXERCISES.map(ex => {
                    const already = bwSets.some(s => s.name === ex.name)
                    return (
                      <TouchableOpacity
                        key={ex.name}
                        onPress={() => {
                          Sounds.tap()
                          if (already) {
                            setBwSets(prev => prev.filter(s => s.name !== ex.name))
                          } else {
                            setBwSets(prev => [...prev, { name: ex.name, reps: '', sets: '3' }])
                          }
                        }}
                        style={[
                          s.bwChip,
                          already && { backgroundColor: '#FF6B3522', borderColor: '#FF6B35' },
                        ]}
                      >
                        <Text style={{ fontSize: 14 }}>{ex.emoji}</Text>
                        <Text style={[s.bwChipText, { color: already ? '#FF6B35' : colors.textSec }]}>{ex.name}</Text>
                        {already && <Ionicons name="checkmark-circle" size={14} color="#FF6B35" />}
                      </TouchableOpacity>
                    )
                  })}
                </ScrollView>

                {/* 選択済み種目のセット・回数入力 */}
                {bwSets.length > 0 && (
                  <View style={{ gap: 8, marginTop: 4 }}>
                    {bwSets.map((bw, idx) => (
                      <View key={bw.name} style={[s.bwSetRow, { backgroundColor: colors.surface2 }]}>
                        <Text style={[s.bwSetName, { color: colors.text }]}>{bw.name}</Text>
                        <View style={s.bwInputGroup}>
                          <TextInput
                            value={bw.reps}
                            onChangeText={v => setBwSets(prev => prev.map((x, i) => i === idx ? { ...x, reps: v.replace(/[^0-9]/g, '') } : x))}
                            placeholder="回数"
                            placeholderTextColor={colors.textHint}
                            keyboardType="numeric"
                            style={[s.bwNumInput, { backgroundColor: colors.surface, color: colors.text }]}
                            textAlign="center"
                          />
                          <Text style={[s.bwUnit, { color: colors.textSec }]}>回</Text>
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
                          <Text style={[s.bwUnit, { color: colors.textSec }]}>セット</Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => { setBwSets(prev => prev.filter((_, i) => i !== idx)); Sounds.tap() }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="close-circle" size={20} color={colors.textHint} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </Section>
            )}

            {/* ── 本数 / セット（ウェイト以外 or 器具ウェイト） ── */}
            {hasReps && !(sessionType === 'strength' && strengthMode === 'bodyweight') && (
              <Section title="本数">
                <View style={s.inlineRow}>
                  <TextInput
                    value={repsStr}
                    onChangeText={v => setRepsStr(v.replace(/[^0-9]/g, ''))}
                    placeholder="例: 6"
                    placeholderTextColor={colors.textHint}
                    keyboardType="numeric"
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
                    onChangeText={v => setDistanceM(v.replace(/[^0-9]/g, ''))}
                    placeholder="例: 5000"
                    placeholderTextColor={colors.textHint}
                    keyboardType="numeric"
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

            {/* ── 練習メニュー ── */}
            <Section title="練習メニュー・メモ（任意）">
              {menuTemplates.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginBottom: 8 }}
                  contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}
                >
                  {menuTemplates.map(t => (
                    <TouchableOpacity
                      key={t.id}
                      style={[s.tplChip, { backgroundColor: colors.surface2, borderColor: colors.border }]}
                      onPress={() => setNotes(t.content)}
                      onLongPress={() => Alert.alert('削除', `「${t.name}」を削除しますか？`, [
                        { text: 'キャンセル', style: 'cancel' },
                        { text: '削除', style: 'destructive', onPress: () => deleteTemplate(t.id) },
                      ])}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.tplChipText, { color: colors.text }]} numberOfLines={1}>{t.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="アップ→ドリル→メイン練習→ダウン..."
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
                  <Text style={s.saveTplBtnText}>テンプレートとして保存</Text>
                </TouchableOpacity>
              )}
            </Section>

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* ── テンプレート名入力モーダル（Alert.promptの代替・全プラットフォーム対応） ── */}
      <Modal visible={tplNameModal} transparent animationType="fade" onRequestClose={() => setTplNameModal(false)}>
        <TouchableOpacity style={s.eventModalBackdrop} activeOpacity={1} onPress={() => setTplNameModal(false)}>
          <TouchableOpacity activeOpacity={1} style={[s.tplModalSheet, { backgroundColor: colors.surface }]}>
            <Text style={[s.eventModalTitle, { color: colors.text }]}>テンプレートとして保存</Text>
            <Text style={{ color: colors.textSec, fontSize: 13 }}>テンプレート名を入力してください</Text>
            <TextInput
              value={tplNameInput}
              onChangeText={setTplNameInput}
              placeholder="例: インターバル定番メニュー"
              placeholderTextColor={colors.textHint}
              autoFocus
              style={[s.tplModalInput, { backgroundColor: colors.surface2, color: colors.text }]}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <TouchableOpacity style={[s.tplModalBtn, { backgroundColor: colors.surface2 }]} onPress={() => setTplNameModal(false)}>
                <Text style={{ color: colors.textSec, fontSize: 14, fontWeight: '700' }}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.tplModalBtn, { backgroundColor: BRAND, opacity: tplNameInput.trim() ? 1 : 0.5 }]}
                onPress={confirmSaveTemplate}
                disabled={!tplNameInput.trim()}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>保存</Text>
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
        onChangeText={v => onChange(v.replace(/[^0-9]/g, ''))}
        placeholder={placeholder}
        placeholderTextColor={colors.textHint}
        keyboardType="numeric"
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
  saveBtn:      { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 50 },
  saveBtnText:  { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },

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

  timeRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  timeSep:      { fontSize: 22, fontWeight: '800', marginBottom: 8 },
  timeFieldWrap:{ alignItems: 'center', gap: 4 },
  timeInput: {
    width: 56, height: 52, borderRadius: 14,
    fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'],
  },
  timeLabel: { fontSize: 10, fontWeight: '600' },

  inlineRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shortInput: {
    width: 100, height: 46, borderRadius: 14,
    fontSize: 18, fontWeight: '700', paddingHorizontal: 12, fontVariant: ['tabular-nums'],
  },
  unitLabel:  { fontSize: 14, fontWeight: '700' },

  fatigueRow: { flexDirection: 'row', gap: 6 },
  fatigueBtn: {
    flex: 1, alignItems: 'center', gap: 4,
    paddingVertical: 10, borderRadius: 12,
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.1)',
  },
  fatigueBtnLabel: { fontSize: 9, fontWeight: '700', textAlign: 'center' },

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

// app/practice-input.tsx — 自由入力（メニューライブラリ選択 + フリーテキスト）
import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { useTheme } from '../context/ThemeContext'
import { BRAND, TEXT } from '../lib/theme'
import { Sounds, unlockAudio } from '../lib/sounds'
import HapticTouch from '../components/HapticTouch'
import { successNotify } from '../lib/haptics'
import { autoSyncTeam } from '../lib/teamAutoSync'
import { trackSessionRecord } from '../lib/analytics'
import { parseDistanceAndReps } from '../lib/parseWorkoutDistance'
import PracticeShareCard, { PracticeShareData } from '../components/PracticeShareCard'
import type { LibraryFolder } from './workout-menu'

const SESSIONS_KEY = 'trackmate_sessions'
const TASKS_KEY    = 'trackmate_tasks'
const LIBRARY_KEY  = 'trackmate_exercise_library'

function CalendarPicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const today = new Date()
  const [viewYear,  setViewYear]  = useState(() => parseInt(value.slice(0, 4)))
  const [viewMonth, setViewMonth] = useState(() => parseInt(value.slice(5, 7)) - 1)

  const firstDay    = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const todayStr    = [today.getFullYear(), String(today.getMonth()+1).padStart(2,'0'), String(today.getDate()).padStart(2,'0')].join('-')

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
  while (cells.length % 7 !== 0) cells.push(null)

  const DOW = ['日','月','火','水','木','金','土']

  return (
    <View style={cal.wrap}>
      <View style={cal.header}>
        <HapticTouch haptic="tap" onPress={prevMonth} style={cal.arrow}>
          <Ionicons name="chevron-back" size={18} color="#6b7280" />
        </HapticTouch>
        <Text style={cal.monthLabel}>{viewYear}年 {viewMonth + 1}月</Text>
        <HapticTouch haptic="tap" onPress={nextMonth} style={cal.arrow}>
          <Ionicons name="chevron-forward" size={18} color="#6b7280" />
        </HapticTouch>
      </View>
      <View style={cal.dowRow}>
        {DOW.map((d, i) => (
          <Text key={d} style={[cal.dow, i === 0 && { color: '#FF6B6B' }, i === 6 && { color: '#5AC8FA' }]}>{d}</Text>
        ))}
      </View>
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

function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dateOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return localDateStr(d)
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  return `${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`
}

function fallbackParse(text: string, today: string): Record<string, any> {
  const t = text
  let session_type = 'easy'
  if (/インターバル|interval|本.*レスト|レスト.*本/i.test(t)) session_type = 'interval'
  else if (/テンポ|ペース走|ビルドアップ/i.test(t)) session_type = 'tempo'
  else if (/スプリント|全力|100m.*走|ダッシュ|坂道|流し|タイムトライアル|\bTT\b/i.test(t)) session_type = 'sprint'
  else if (/ロング|長距離|LSD/i.test(t)) session_type = 'long'
  else if (/ドリル|ハードル|ABCドリル/i.test(t)) session_type = 'drill'
  else if (/ウェイト|筋トレ|ジム|スクワット|デッド/i.test(t)) session_type = 'strength'
  else if (/試合|大会|記録会|レース/i.test(t)) session_type = 'race'
  else if (/休養|オフ|休み|レスト|\brest\b/i.test(t)) session_type = 'rest'
  // 「ポイント練習」単体では種類が特定できないため、上記のどれにも一致しなかった場合のみ
  // インターバル系（質の高い練習の代表）として扱う。他のキーワードが既にあれば、そちらを優先する。
  else if (/ポイント練習|ポイント練/i.test(t)) session_type = 'interval'

  const eventMatch = t.match(/\b(100m|200m|400m|800m|1500m|3000m|5000m|10000m|110mH|100mH|400mH|3000mSC)\b/i)
  const event = eventMatch ? eventMatch[1] : null

  let time_ms: number | null = null
  const timeMatch = t.match(/(\d{1,2}):(\d{2})[.:](\d{1,2})|(\d{1,2})'(\d{2})[.:]?(\d{0,2})|(\d{2,3})[."秒](\d{0,2})/)
  if (timeMatch) {
    if (timeMatch[1]) time_ms = (parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]) + parseInt(timeMatch[3] || '0') / 100) * 1000
    else if (timeMatch[4]) time_ms = (parseInt(timeMatch[4]) * 60 + parseInt(timeMatch[5]) + parseInt(timeMatch[6] || '0') / 100) * 1000
    else if (timeMatch[7]) time_ms = (parseInt(timeMatch[7]) + parseInt(timeMatch[8] || '0') / 100) * 1000
    time_ms = time_ms ? Math.round(time_ms) : null
  }

  const { distance_m, reps } = parseDistanceAndReps(t)

  const fatMatch = t.match(/疲労\s*[：:=]?\s*(\d+)|疲[れ労]\s*(\d+)/)
  const fatigue_level = fatMatch ? parseInt(fatMatch[1] ?? fatMatch[2]) : 5

  const condMatch = t.match(/体調\s*[：:=]?\s*(\d+)/)
  const condition_level = condMatch ? parseInt(condMatch[1]) : 6

  return { session_date: today, session_type, event, time_ms, distance_m, reps, fatigue_level, condition_level }
}

function sessionTypeLabel(t: string): string {
  const m: Record<string, string> = {
    interval: 'インターバル', tempo: 'テンポ走', sprint: 'スプリント',
    long: 'ロング走', drill: 'ドリル', strength: '筋トレ',
    race: 'レース', rest: '休養', easy: 'ジョグ',
  }
  return m[t] || t
}

function formatTimeMs(ms: number): string {
  const totalSec = ms / 1000
  if (totalSec >= 60) {
    const min = Math.floor(totalSec / 60)
    const sec = (totalSec % 60).toFixed(2).padStart(5, '0')
    return `${min}'${sec}"`
  }
  return `${totalSec.toFixed(2)}"`
}

async function saveTasks(newTexts: string[]) {
  if (newTexts.length === 0) return
  try {
    const raw = await AsyncStorage.getItem(TASKS_KEY)
    const existing = raw ? JSON.parse(raw) : []
    const newTasks = newTexts.map(text => ({
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text, completed: false, created_at: new Date().toISOString(),
    }))
    await AsyncStorage.setItem(TASKS_KEY, JSON.stringify([...newTasks, ...existing].slice(0, 20)))
  } catch { /* ignore */ }
}

export default function PracticeInputScreen() {
  const router = useRouter()
  const { colors } = useTheme()

  const [freeText, setFreeText]           = useState('')
  const [selectedDate, setSelectedDate]   = useState(dateOffset(0))
  const [folders, setFolders]             = useState<LibraryFolder[]>([])
  const [openFolderId, setOpenFolderId]   = useState<string | null>(null)
  const [pickedItems, setPickedItems]     = useState<{ folderId: string; folderName: string; folderColor: string; text: string }[]>([])
  const [saving, setSaving]               = useState(false)
  const [showShare, setShowShare]         = useState(false)
  const [shareData, setShareData]         = useState<PracticeShareData | null>(null)

  useEffect(() => {
    AsyncStorage.getItem(LIBRARY_KEY).then(r => {
      if (!r) return
      try { setFolders(JSON.parse(r)) } catch {}
    }).catch(() => {})
  }, [])

  function toggleItem(folder: LibraryFolder, item: string) {
    setPickedItems(prev => {
      const exists = prev.some(p => p.folderId === folder.id && p.text === item)
      if (exists) return prev.filter(p => !(p.folderId === folder.id && p.text === item))
      return [...prev, { folderId: folder.id, folderName: folder.name, folderColor: folder.color, text: item }]
    })
  }

  function applyPicked() {
    if (pickedItems.length === 0) return
    const lines = pickedItems.map(p => p.text).join('\n')
    setFreeText(prev => prev.trim() ? prev.trim() + '\n' + lines : lines)
    setPickedItems([])
    setOpenFolderId(null)
  }

  const handleSave = useCallback(async () => {
    if (!freeText.trim() || saving) return
    unlockAudio()
    setSaving(true)
    const today = localDateStr(new Date())
    const parsed = fallbackParse(freeText, selectedDate)
    const toNum = (v: any) => (v !== null && v !== undefined && v !== 'null' && !isNaN(Number(v)) && Number(v) > 0) ? Number(v) : undefined
    try {
      const existing = await AsyncStorage.getItem(SESSIONS_KEY)
      let sessions: any[] = []
      try { if (existing) sessions = JSON.parse(existing) } catch {}
      sessions.unshift({
        id:              `ql_${Date.now()}`,
        user_id:         (await AsyncStorage.getItem('userId').catch(() => null)) ?? 'local',
        created_at:      new Date().toISOString(),
        session_date:    parsed.session_date    || today,
        session_type:    parsed.session_type    || 'easy',
        event:           parsed.event && parsed.event !== 'null' ? String(parsed.event) : undefined,
        time_ms:         toNum(parsed.time_ms),
        distance_m:      toNum(parsed.distance_m),
        reps:            toNum(parsed.reps),
        fatigue_level:   toNum(parsed.fatigue_level) ?? 5,
        condition_level: toNum(parsed.condition_level) ?? 7,
        notes:           freeText,
      })
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
      autoSyncTeam(sessions, { force: true }).catch(() => {})
      trackSessionRecord(parsed.session_type || 'easy')

      const taskTexts: string[] = []
      if (parsed.fatigue_level >= 8) taskTexts.push('今夜は7時間以上の睡眠を確保しよう')
      else if (parsed.fatigue_level >= 6) taskTexts.push('練習後のストレッチを10分しっかり行おう')
      if (parsed.session_type === 'interval' || parsed.session_type === 'sprint')
        taskTexts.push('次の練習は軽いジョグか休養にしよう（インターバル翌日）')
      await saveTasks(taskTexts.slice(0, 3))

      Sounds.save()
      successNotify()
      Toast.show({ type: 'success', text1: '練習を記録しました ✓', visibilityTime: 1800 })

      const d = new Date()
      const weekdays = ['日', '月', '火', '水', '木', '金', '土']
      const drills: string[] = []
      const drillRegex = /([A-Za-zぁ-んァ-ン一-龥]+ドリル|Aスキップ|Bスキップ|バウンディング|ハイニー|もも上げ|ランジ|サーキット)/g
      let mr: RegExpExecArray | null
      while ((mr = drillRegex.exec(freeText)) !== null) drills.push(mr[1])
      setShareData({
        date:      `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${weekdays[d.getDay()]}）`,
        title:     sessionTypeLabel(parsed.session_type || 'easy'),
        menu:      freeText.trim(), drills,
        distance:  parsed.distance_m ? parsed.distance_m / 1000 : undefined,
        sets:      parsed.reps       ? Number(parsed.reps)       : undefined,
        time:      parsed.time_ms    ? formatTimeMs(Number(parsed.time_ms)) : undefined,
        fatigue:   parsed.fatigue_level   ? Number(parsed.fatigue_level)   : undefined,
        condition: parsed.condition_level ? Number(parsed.condition_level) : undefined,
      })
      setFreeText('')
      setShowShare(true)
    } catch {
      Toast.show({ type: 'error', text1: '保存に失敗しました', text2: 'もう一度試してください' })
    } finally {
      setSaving(false)
    }
  }, [freeText, selectedDate, saving])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* ── ヘッダー ── */}
          <View style={[s.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[s.title, { color: colors.text }]}>自由入力</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={s.content}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── 日付セレクター ── */}
            <Text style={[s.sectionLabel, { color: colors.textHint, marginBottom: 8 }]}>日付を選ぶ</Text>
            <View style={{ marginBottom: 20 }}>
              <CalendarPicker value={selectedDate} onChange={setSelectedDate} />
            </View>

            {/* ── メニューライブラリ（フォルダ選択） ── */}
            {folders.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <Text style={[s.sectionLabel, { color: colors.textHint }]}>メニューから選ぶ</Text>

                {/* フォルダチップ横スクロール */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingHorizontal: 2, marginBottom: 10 }}
                >
                  {folders.map(f => {
                    const isOpen = openFolderId === f.id
                    return (
                      <TouchableOpacity
                        key={f.id}
                        style={[s.folderChip, {
                          backgroundColor: isOpen ? f.color : colors.surface2,
                          borderColor: isOpen ? f.color : colors.border,
                        }]}
                        onPress={() => setOpenFolderId(prev => prev === f.id ? null : f.id)}
                        activeOpacity={0.8}
                      >
                        <Text style={{ fontSize: 14 }}>{f.icon}</Text>
                        <Text style={[s.folderChipText, { color: isOpen ? '#fff' : colors.text }]}>{f.name}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </ScrollView>

                {/* 開いているフォルダの種目一覧 */}
                {openFolderId && (() => {
                  const folder = folders.find(f => f.id === openFolderId)
                  if (!folder) return null
                  return (
                    <View style={[s.itemsBox, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                      <Text style={[s.itemsBoxTitle, { color: folder.color }]}>
                        {folder.icon} {folder.name}
                      </Text>
                      <View style={s.itemsGrid}>
                        {folder.items.map((item, idx) => {
                          const picked = pickedItems.some(p => p.folderId === folder.id && p.text === item)
                          return (
                            <TouchableOpacity
                              key={idx}
                              style={[s.itemChip, {
                                backgroundColor: picked ? folder.color : colors.bg,
                                borderColor: picked ? folder.color : colors.border,
                              }]}
                              onPress={() => toggleItem(folder, item)}
                              activeOpacity={0.75}
                            >
                              {picked && <Ionicons name="checkmark" size={12} color="#fff" />}
                              <Text style={[s.itemChipText, { color: picked ? '#fff' : colors.text }]}>{item}</Text>
                            </TouchableOpacity>
                          )
                        })}
                      </View>
                    </View>
                  )
                })()}

                {/* ピック済みバー */}
                {pickedItems.length > 0 && (
                  <View style={[s.pickedBar, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                    <Text style={[s.pickedBarText, { color: colors.text }]} numberOfLines={1}>
                      {pickedItems.map(p => p.text).join('、')}
                    </Text>
                    <TouchableOpacity
                      style={[s.applyBtn, { backgroundColor: BRAND }]}
                      onPress={applyPicked}
                      activeOpacity={0.85}
                    >
                      <Text style={s.applyBtnText}>入力欄に追加</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* ── テキスト入力 ── */}
            <Text style={[s.sectionLabel, { color: colors.textHint }]}>内容を入力・編集</Text>
            <TextInput
              style={[s.input, { backgroundColor: colors.surface2, color: colors.text, borderColor: colors.border }]}
              value={freeText}
              onChangeText={setFreeText}
              multiline
              autoCorrect={false}
              spellCheck={false}
              placeholder={'例:\n400m × 5本 レスト3分 68秒\n疲労7 脚が重かった\n\n「ジョグ10km」だけでもOK'}
              placeholderTextColor={colors.textHint}
              textAlignVertical="top"
            />
            <Text style={[s.hint, { color: colors.textHint }]}>
              💡 疲労度・タイムを含めると自動で記録に反映されます{'\n'}
              💡 ポイント練習は「400m×5本」「テンポ走5km」「坂道ダッシュ」のように、本数・距離・種類を書くと自動で分類されます
            </Text>

            {/* ── 保存ボタン ── */}
            <TouchableOpacity
              style={[s.saveBtn, (!freeText.trim() || saving) && { opacity: 0.4 }]}
              activeOpacity={0.85}
              onPress={handleSave}
              disabled={!freeText.trim() || saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={s.saveBtnText}>記録する</Text>
                </>
              )}
            </TouchableOpacity>

            {folders.length === 0 && (
              <TouchableOpacity
                style={s.emptyLibraryHint}
                onPress={() => router.push('/workout-menu' as any)}
                activeOpacity={0.7}
              >
                <Ionicons name="folder-outline" size={14} color={colors.textHint} />
                <Text style={[s.emptyLibraryText, { color: colors.textHint }]}>
                  メニューライブラリに種目を登録すると、ここから選べます
                </Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textHint} />
              </TouchableOpacity>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {showShare && shareData && (
        <PracticeShareCard
          data={shareData}
          visible={showShare}
          onClose={() => { setShowShare(false); router.back() }}
        />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  backBtn:       { padding: 4 },
  title:         { fontSize: 17, fontWeight: '800' },
  content:       { padding: 20, gap: 0 },
  sectionLabel:  { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8 },
  folderChip:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 21, borderWidth: 1.5 },
  folderChipText:{ fontSize: 13, fontWeight: '700' },
  itemsBox:      { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  itemsBoxTitle: { fontSize: 13, fontWeight: '800', marginBottom: 10 },
  itemsGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  itemChip:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  itemChipText:  { fontSize: 13 },
  pickedBar:     { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1, padding: 10, marginBottom: 4 },
  pickedBarText: { flex: 1, fontSize: 13 },
  applyBtn:      { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  applyBtnText:  { color: '#fff', fontSize: 13, fontWeight: '700' },
  input:         { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, lineHeight: 24, borderWidth: 1, height: 160, marginBottom: 10 },
  hint:          { fontSize: 12, lineHeight: 18, marginBottom: 20 },
  saveBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 21, paddingVertical: 16, marginBottom: 16 },
  saveBtnText:   { color: '#fff', fontSize: 16, fontWeight: '700' },
  emptyLibraryHint: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', paddingVertical: 12 },
  emptyLibraryText: { fontSize: 12, flex: 1, textAlign: 'center' },
})

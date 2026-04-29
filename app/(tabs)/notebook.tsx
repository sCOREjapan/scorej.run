// app/(tabs)/notebook.tsx — 陸上ノート（テーマ対応版）
import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Modal, FlatList, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { useTheme } from '../../context/ThemeContext'
import { Sounds, unlockAudio } from '../../lib/sounds'
import { useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import TrainingChart from '../../components/TrainingChart'
import type { TrainingSession, ChartDataPoint } from '../../types'

const SESSIONS_KEY    = 'trackmate_sessions'
const TASKS_KEY       = 'trackmate_tasks'

// ── 正規表現フォールバックパーサー ───────────────────────────────
function fallbackParse(text: string, today: string): Record<string, any> {
  const t = text
  let session_type = 'easy'
  if (/インターバル|interval|本.*レスト|レスト.*本/i.test(t)) session_type = 'interval'
  else if (/テンポ|ペース走/i.test(t)) session_type = 'tempo'
  else if (/スプリント|全力|ダッシュ/i.test(t)) session_type = 'sprint'
  else if (/ロング|長距離|LSD/i.test(t)) session_type = 'long'
  else if (/ドリル|ABCドリル/i.test(t)) session_type = 'drill'
  else if (/ウェイト|筋トレ|ジム|スクワット/i.test(t)) session_type = 'strength'
  else if (/試合|大会|記録会|レース/i.test(t)) session_type = 'race'
  else if (/休養|オフ|休み/i.test(t)) session_type = 'rest'

  const eventMatch = t.match(/\b(100m|200m|400m|800m|1500m|3000m|5000m|10000m|110mH|100mH|400mH|3000mSC)\b/i)
  const event = eventMatch ? eventMatch[1] : null

  let time_ms: number | null = null
  const timeMatch = t.match(/(\d{1,2}):(\d{2})[.:](\d{1,2})|(\d{1,2})'(\d{2})[.:]?(\d{0,2})|(\d{2,3})[."秒](\d{0,2})/)
  if (timeMatch) {
    if (timeMatch[1]) time_ms = Math.round((parseInt(timeMatch[1])*60 + parseInt(timeMatch[2]) + parseInt(timeMatch[3]||'0')/100)*1000)
    else if (timeMatch[4]) time_ms = Math.round((parseInt(timeMatch[4])*60 + parseInt(timeMatch[5]) + parseInt(timeMatch[6]||'0')/100)*1000)
    else if (timeMatch[7]) time_ms = Math.round((parseInt(timeMatch[7]) + parseInt(timeMatch[8]||'0')/100)*1000)
  }

  let distance_m: number | null = null
  const kmMatch = t.match(/(\d+(?:\.\d+)?)\s*km/i)
  const mMatch  = t.match(/(\d+)\s*m(?!H|SC)\b/)
  if (kmMatch) distance_m = Math.round(parseFloat(kmMatch[1]) * 1000)
  else if (mMatch && parseInt(mMatch[1]) > 50) distance_m = parseInt(mMatch[1])

  const repsMatch = t.match(/(\d+)\s*(本|×)/)
  const reps = repsMatch ? parseInt(repsMatch[1]) : null

  const fatMatch = t.match(/疲労\s*[：:=]?\s*(\d+)|疲[れ労]\s*(\d+)/)
  const fatigue_level = fatMatch ? parseInt(fatMatch[1] ?? fatMatch[2]) : 5

  const condMatch = t.match(/体調\s*[：:=]?\s*(\d+)/)
  const condition_level = condMatch ? parseInt(condMatch[1]) : 6

  return { session_date: today, session_type, event, time_ms, distance_m, reps, fatigue_level, condition_level }
}
const CONDITION_MAP_KEY = 'trackmate_condition_map'
const BRAND           = '#166534'
const MOCK_USER_ID    = 'mock-user-1'

async function saveImprovementTasks(sessionType: string, fatigue: number, notes: string) {
  const texts: string[] = []
  if (fatigue >= 8) texts.push('今夜は7時間以上の睡眠を確保しよう')
  if (fatigue >= 6) texts.push('練習後のストレッチを10分しっかり行おう')
  if (sessionType === 'interval' || sessionType === 'sprint')
    texts.push('次の練習は軽いジョグか休養にしよう（インターバル翌日）')
  if (sessionType === 'long') texts.push('長距離後は糖質+たんぱく質の補給を忘れずに')
  if (sessionType === 'race') texts.push('レース後は2〜3日間は強度を落として調整しよう')
  if (notes.includes('痛') || notes.includes('違和感'))
    texts.push('痛みや違和感が続く場合は早めに医師に相談しよう')

  if (texts.length === 0) return
  try {
    const raw = await AsyncStorage.getItem(TASKS_KEY)
    const existing = raw ? JSON.parse(raw) : []
    const newTasks = texts.slice(0, 3).map(text => ({
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text, completed: false, created_at: new Date().toISOString(),
    }))
    await AsyncStorage.setItem(TASKS_KEY, JSON.stringify([...newTasks, ...existing].slice(0, 20)))
  } catch { /* ignore */ }
}

const TYPE_INFO: Record<string, { label: string; color: string }> = {
  interval: { label: 'インターバル', color: '#f97316' },
  tempo:    { label: 'テンポ走',     color: '#FF9500' },
  easy:     { label: 'ジョグ',       color: '#34C759' },
  long:     { label: 'ロング走',     color: '#5AC8FA' },
  sprint:   { label: 'スプリント',   color: '#FF3B30' },
  drill:    { label: 'ドリル',       color: '#AF52DE' },
  strength: { label: 'ウェイト',     color: '#FF6B35' },
  race:     { label: '試合',         color: '#FFD700' },
  rest:     { label: '休養',         color: '#5a5a8a' },
}

function fmtTime(ms: number) {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(2)}"`
  return `${Math.floor(s / 60)}'${(s % 60).toFixed(2).padStart(5, '0')}"`
}
function fmtDist(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`
}

const CONDITION_EMOJIS: Record<number,string> = { 2:'😫', 4:'😕', 6:'😐', 8:'😊', 10:'💪' }
function conditionEmoji(v: number) {
  const closest = [2,4,6,8,10].reduce((a,b) => Math.abs(b-v) < Math.abs(a-v) ? b : a)
  return CONDITION_EMOJIS[closest] ?? '😐'
}

function SessionCard({ session, conditionMap }: { session: TrainingSession; conditionMap: Record<string,number> }) {
  const { colors } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const info = TYPE_INFO[session.session_type] ?? { label: session.session_type, color: '#888' }
  const cond = session.condition_level ?? conditionMap[session.session_date]
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={() => setExpanded(e => !e)}
      style={[st.sessionCard, { backgroundColor: colors.surface2, borderColor: colors.border }]}
    >
      <View style={[st.typeBar, { backgroundColor: info.color }]} />
      <View style={st.sessionBody}>
        <View style={st.sessionRow}>
          <Text style={[st.typeLabel, { color: info.color }]}>{info.label}</Text>
          {session.event ? <Text style={[st.eventLabel, { color: colors.textSec }]}>{session.event}</Text> : null}
          <Text style={[st.dateLabel, { color: colors.textHint }]}>{session.session_date}</Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={13}
            color={colors.textHint}
            style={{ marginLeft: 'auto' as any }}
          />
        </View>
        <View style={st.sessionRow}>
          {session.time_ms   ? <Text style={[st.sessionStat, { color: colors.text }]}>{fmtTime(session.time_ms)}</Text>   : null}
          {session.distance_m? <Text style={[st.sessionStat, { color: colors.text }]}>{fmtDist(session.distance_m)}</Text> : null}
          {session.reps      ? <Text style={[st.sessionStat, { color: colors.text }]}>{session.reps}本</Text>              : null}
          <View style={[st.fatiguePill, { backgroundColor: colors.inputBg }]}>
            <Text style={[st.fatigueNum, { color: colors.textHint }]}>疲労 {session.fatigue_level}/10</Text>
          </View>
          {cond != null && (
            <View style={[st.fatiguePill, { backgroundColor: colors.inputBg }]}>
              <Text style={[st.fatigueNum, { color: colors.textHint }]}>{conditionEmoji(cond)} 体調{cond}/10</Text>
            </View>
          )}
        </View>
        {session.notes ? (
          <Text style={[st.notesText, { color: colors.textHint }]} numberOfLines={expanded ? undefined : 2}>
            {session.notes}
          </Text>
        ) : null}
        {expanded && (
          <View style={[st.expandedDetail, { borderTopColor: colors.border }]}>
            {session.time_ms    ? <Text style={[st.detailRow, { color: colors.textSec }]}>⏱ タイム: {fmtTime(session.time_ms)}</Text>    : null}
            {session.distance_m ? <Text style={[st.detailRow, { color: colors.textSec }]}>📏 距離: {fmtDist(session.distance_m)}</Text>   : null}
            {session.reps       ? <Text style={[st.detailRow, { color: colors.textSec }]}>🔁 本数: {session.reps}本</Text>                : null}
            {session.event      ? <Text style={[st.detailRow, { color: colors.textSec }]}>🏟️ 種目: {session.event}</Text>                : null}
            <Text style={[st.detailRow, { color: colors.textSec }]}>💪 疲労度: {session.fatigue_level}/10</Text>
            {cond != null ? <Text style={[st.detailRow, { color: colors.textSec }]}>{conditionEmoji(cond)} 体調: {cond}/10</Text> : null}
            <Text style={[st.detailRow, { color: colors.textHint, fontSize: 10 }]}>記録: {session.created_at?.slice(0,16).replace('T',' ') ?? ''}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  )
}

export default function NotebookScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const [sessions, setSessions]       = useState<TrainingSession[]>([])
  const [conditionMap, setConditionMap] = useState<Record<string,number>>({})
  const [loading, setLoading]         = useState(true)
  const [modal, setModal]             = useState(false)
  const [freeText, setFreeText]       = useState('')
  const [parsing, setParsing]         = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rawSessions, rawCond] = await AsyncStorage.multiGet([SESSIONS_KEY, CONDITION_MAP_KEY])
      if (rawSessions[1]) setSessions(JSON.parse(rawSessions[1]))
      if (rawCond[1])     setConditionMap(JSON.parse(rawCond[1]))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // 他画面から戻ってきた時にもリロード（manual-log等から保存後）
  useFocusEffect(useCallback(() => { load() }, [load]))

  const weekAgo   = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const monthAgo  = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const thisWeek  = sessions.filter(s => s.session_date >= weekAgo)
  const thisMonth = sessions.filter(s => s.session_date >= monthAgo)
  const avgFatigue = thisWeek.length > 0
    ? (thisWeek.reduce((a, s) => a + (s.fatigue_level ?? 5), 0) / thisWeek.length).toFixed(1)
    : '—'
  const totalKm = thisMonth.reduce((a, s) => a + (s.distance_m ?? 0), 0) / 1000

  const chartData: ChartDataPoint[] = sessions
    .filter(s => s.time_ms).slice(0, 7).reverse()
    .map(s => ({ date: s.session_date, value: s.time_ms! / 1000 }))

  async function handleSave() {
    if (!freeText.trim()) return
    setParsing(true)

    const today = new Date().toISOString().slice(0, 10)

    // ── Step 1: まず正規表現でフォールバック解析 ──────────
    let parsed: Record<string, any> = fallbackParse(freeText, today)

    // ── Step 2: AIでより正確に解析（成功すればフォールバックを上書き） ─
    try {
      const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY
      if (apiKey) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 500,
            messages: [{ role: 'user', content: `陸上競技の練習記録テキストを正確にJSONに変換してください。今日の日付は${today}です。\n\n入力テキスト:\n"${freeText}"\n\nルール:\n- session_type: interval(本数+レスト), tempo(ペース走), easy(ジョグ/LSD), long(長距離), sprint(全力短距離), drill(ドリル), strength(ウェイト/筋トレ), race(試合/大会), rest(休養)\n- time_ms: タイムをミリ秒整数に変換。「46秒80」→46800, 「1:28.50」→88500。なければnull\n- distance_m: 距離をメートル整数に変換。「10km」→10000。なければnull\n- reps: 本数の整数。なければnull\n- fatigue_level: 疲労度1〜10の整数（明記なければ雰囲気から推定）\n- condition_level: 体調1〜10の整数（明記なければ6）\n- event: 100m/200m/400m/800m/1500m/3000m/5000m/10000m/110mH/100mH/400mH/3000mSC/競歩/走幅跳/三段跳/走高跳/棒高跳/砲丸投/やり投/円盤投/ハンマー投 のいずれか、なければnull\n\nJSONのみ返答:\n{"session_date":"${today}","session_type":"...","event":"...orNull","time_ms":数値orNull,"distance_m":数値orNull,"reps":数値orNull,"fatigue_level":整数,"condition_level":整数}` }],
          }),
        })
        if (res.ok) {
          const data = await res.json()
          const rawText = data.content?.[0]?.text ?? ''
          const jsonMatch = rawText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const aiParsed = JSON.parse(jsonMatch[0])
            parsed = { ...parsed, ...aiParsed }
          }
        }
      }
    } catch {
      // AI解析失敗 → fallbackParse の結果をそのまま使う
    }

    // ── Step 3: 必ず保存 ──────────────────────────────────
    const toNum = (v: any) => (v !== null && v !== undefined && v !== 'null' && !isNaN(Number(v)) && Number(v) > 0) ? Number(v) : undefined
    try {
      const newSession: TrainingSession = {
        id: `local-${Date.now()}`, user_id: MOCK_USER_ID, created_at: new Date().toISOString(),
        session_date:    parsed.session_date    || today,
        session_type:    parsed.session_type    || 'easy',
        event:           parsed.event && parsed.event !== 'null' && parsed.event !== null ? String(parsed.event) as any : undefined,
        time_ms:         toNum(parsed.time_ms),
        distance_m:      toNum(parsed.distance_m),
        reps:            toNum(parsed.reps),
        fatigue_level:   toNum(parsed.fatigue_level) ?? 5,
        condition_level: toNum(parsed.condition_level) ?? conditionMap[today] ?? 6,
        notes: freeText,
      }
      // ストレージへの書き込みを確実に完了させてから状態更新
      // （他タブのuseFocusEffectが先に走るレースコンディションを防ぐ）
      const rawExisting = await AsyncStorage.getItem(SESSIONS_KEY)
      const existing: TrainingSession[] = rawExisting ? JSON.parse(rawExisting) : []
      const next = [newSession, ...existing]
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(next))
      setSessions(next)
      // 改善タスク生成
      saveImprovementTasks(newSession.session_type, newSession.fatigue_level ?? 5, freeText)
      Sounds.save()
      setFreeText(''); setModal(false)
      Toast.show({ type: 'success', text1: '練習を記録しました ✓', visibilityTime: 1500 })
    } catch {
      Toast.show({ type: 'error', text1: '保存に失敗しました' })
    } finally { setParsing(false) }
  }

  const iconColor = colors.text

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }}>

        {/* ── ヘッダー ── */}
        <View style={[st.header, { borderBottomColor: colors.border }]}>
          <Text style={[st.headerTitle, { color: colors.text }]}>陸上ノート</Text>
          <View style={st.headerActions}>
            <TouchableOpacity style={[st.iconBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]} onPress={() => router.push('/gps-run')} activeOpacity={0.8}>
              <Ionicons name="navigate-outline" size={18} color={iconColor} />
            </TouchableOpacity>
            <TouchableOpacity style={[st.iconBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]} onPress={() => router.push('/calendar')} activeOpacity={0.8}>
              <Ionicons name="calendar-outline" size={18} color={iconColor} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>

          {/* ── 統計バー ── */}
          <View style={[st.statsRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {[
              { num: String(sessions.length), label: '総記録' },
              { num: String(thisWeek.length), label: '今週' },
              { num: totalKm > 0 ? `${totalKm.toFixed(0)}km` : '—', label: '今月距離' },
              { num: String(avgFatigue), label: '今週疲労' },
            ].map((item, i) => (
              <View key={i} style={[st.statBox, i > 0 && { borderLeftWidth: 1, borderLeftColor: colors.border }]}>
                <Text style={[st.statNum, { color: colors.text }]}>{item.num}</Text>
                <Text style={[st.statLabel, { color: colors.textHint }]}>{item.label}</Text>
              </View>
            ))}
          </View>

          {/* ── 記録ボタン ── */}
          <TouchableOpacity style={st.recordBtn} onPress={() => { unlockAudio(); Sounds.whoosh(); setModal(true) }} activeOpacity={0.85}>
            <Ionicons name="add-circle" size={20} color="#fff" />
            <Text style={st.recordBtnText}>今日の練習を記録する</Text>
          </TouchableOpacity>

          {/* ── チャート ── */}
          {!loading && chartData.length > 0 && (
            <View style={[st.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TrainingChart data={chartData} title="タイム推移（秒）" color={BRAND} unit="秒" isLoading={false} />
            </View>
          )}

          {/* ── 練習記録 ── */}
          <View style={[st.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={st.sectionHeader}>
              <Text style={[st.sectionTitle, { color: colors.text }]}>練習記録</Text>
              <Text style={[st.sectionCount, { color: colors.textHint }]}>{sessions.length}件</Text>
            </View>
            {loading ? (
              <View style={{ gap: 10 }}>
                {[1,2,3].map(i => <View key={i} style={{ height: 64, backgroundColor: colors.surface2, borderRadius: 10 }} />)}
              </View>
            ) : sessions.length === 0 ? (
              <View style={st.empty}>
                <Ionicons name="book-outline" size={40} color={colors.textHint} />
                <Text style={[st.emptyText,    { color: colors.textHint }]}>まだ記録がありません</Text>
                <Text style={[st.emptySubText, { color: colors.textHint }]}>上のボタンから今日の練習を記録しよう</Text>
              </View>
            ) : (
              <FlatList
                data={sessions}
                keyExtractor={item => item.id}
                renderItem={({ item }) => <SessionCard session={item} conditionMap={conditionMap} />}
                scrollEnabled={false}
                ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              />
            )}
          </View>
        </ScrollView>

        {/* ── 入力モーダル ── */}
        <Modal visible={modal} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={st.modalContent}>
                <View style={st.modalHeader}>
                  <TouchableOpacity onPress={() => { setModal(false); setFreeText('') }}>
                    <Text style={{ color: colors.textSec, fontSize: 16 }}>キャンセル</Text>
                  </TouchableOpacity>
                  <Text style={[st.modalTitle, { color: colors.text }]}>練習を記録</Text>
                  <View style={{ width: 60 }} />
                </View>
                <Text style={{ color: colors.textHint, fontSize: 13, marginBottom: 14, lineHeight: 18 }}>
                  自由に書いてください — AIが自動で整理します
                </Text>
                <TextInput
                  style={[st.textInput, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.border }]}
                  value={freeText}
                  onChangeText={setFreeText}
                  multiline autoFocus
                  placeholder={'例:\n400m × 5本 レスト3分 68秒\n疲労7 脚が重かった\n\n「ジョグ10km」だけでもOK'}
                  placeholderTextColor={colors.textHint}
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={[st.saveBtn, (!freeText.trim() || parsing) && { opacity: 0.4 }]}
                  onPress={handleSave} disabled={!freeText.trim() || parsing} activeOpacity={0.8}
                >
                  {parsing
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Ionicons name="sparkles" size={18} color="#fff" /><Text style={st.saveBtnText}>AIで記録する</Text></>
                  }
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </Modal>

      </SafeAreaView>
    </View>
  )
}

const st = StyleSheet.create({
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle:   { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconBtn:       { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  scroll:        { padding: 16, gap: 14, paddingBottom: 48 },
  statsRow:      { flexDirection: 'row', borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  statBox:       { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 3 },
  statNum:       { fontSize: 18, fontWeight: '800' },
  statLabel:     { fontSize: 10, fontWeight: '600' },
  recordBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 14, paddingVertical: 16 },
  recordBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  card:          { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle:  { fontSize: 15, fontWeight: '800' },
  sectionCount:  { fontSize: 13 },
  sessionCard:   { flexDirection: 'row', borderRadius: 12, overflow: 'hidden', borderWidth: 1 },
  typeBar:       { width: 4 },
  sessionBody:   { flex: 1, padding: 12, gap: 5 },
  sessionRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  typeLabel:     { fontSize: 12, fontWeight: '800' },
  eventLabel:    { fontSize: 12 },
  dateLabel:     { fontSize: 11, marginLeft: 'auto' as any },
  sessionStat:   { fontSize: 14, fontWeight: '700' },
  fatiguePill:   { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  fatigueNum:    { fontSize: 11 },
  notesText:     { fontSize: 12, lineHeight: 16 },
  expandedDetail:{ marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 3 },
  detailRow:     { fontSize: 12, lineHeight: 18 },
  empty:         { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyText:     { fontSize: 15 },
  emptySubText:  { fontSize: 12, textAlign: 'center' },
  modalContent:  { flex: 1, padding: 20 },
  modalHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle:    { fontSize: 17, fontWeight: '800' },
  textInput:     { flex: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, lineHeight: 26, borderWidth: 1, marginBottom: 16 },
  saveBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 14, paddingVertical: 16 },
  saveBtnText:   { color: '#fff', fontSize: 16, fontWeight: '700' },
})

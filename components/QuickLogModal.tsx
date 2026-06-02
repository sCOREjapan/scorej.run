// components/QuickLogModal.tsx — AI自由入力版
import React, { useState, useRef } from 'react'
import {
  Modal, View, Text, TouchableOpacity, TextInput,
  StyleSheet, Animated, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native'
import HapticTouch from '../components/HapticTouch'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Ionicons } from '@expo/vector-icons'
import { BRAND, TEXT } from '../lib/theme'
import { Sounds, unlockAudio } from '../lib/sounds'
import Toast from 'react-native-toast-message'
import { autoSyncTeam } from '../lib/teamAutoSync'
import { trackSessionRecord } from '../lib/analytics'
import { successNotify } from '../lib/haptics'
import PracticeShareCard, { PracticeShareData } from './PracticeShareCard'

const SESSIONS_KEY = 'trackmate_sessions'
const TASKS_KEY    = 'trackmate_tasks'

// ── 日付ヘルパー ─────────────────────────────────────────────────
/** ローカル日付を YYYY-MM-DD 文字列に変換（toISOStringはUTCになるのでNG） */
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

/** テキストから日付を抽出（昨日/一昨日/MM月DD日/MM/DD） */
function parseDateFromText(text: string): string | null {
  if (/一昨日|おととい/.test(text)) return dateOffset(2)
  if (/昨日/.test(text))           return dateOffset(1)
  const mmdd = text.match(/(\d{1,2})月(\d{1,2})日/)
  if (mmdd) {
    const now = new Date()
    const d = new Date(now.getFullYear(), parseInt(mmdd[1]) - 1, parseInt(mmdd[2]))
    if (d <= now) return localDateStr(d)
  }
  const slash = text.match(/(\d{1,2})\/(\d{1,2})/)
  if (slash) {
    const now = new Date()
    const d = new Date(now.getFullYear(), parseInt(slash[1]) - 1, parseInt(slash[2]))
    if (d <= now) return localDateStr(d)
  }
  return null
}

/** YYYY-MM-DD → 表示文字列 */
function formatDateLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  return `${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`
}

// ── 正規表現フォールバックパーサー ───────────────────────────────
function fallbackParse(text: string, today: string): Record<string, any> {
  const t = text

  // 種目判定
  let session_type = 'easy'
  if (/インターバル|interval|本.*レスト|レスト.*本/i.test(t)) session_type = 'interval'
  else if (/テンポ|ペース走/i.test(t)) session_type = 'tempo'
  else if (/スプリント|全力|100m.*走|ダッシュ/i.test(t)) session_type = 'sprint'
  else if (/ロング|長距離|LSD/i.test(t)) session_type = 'long'
  else if (/ドリル|ハードル|ABCドリル/i.test(t)) session_type = 'drill'
  else if (/ウェイト|筋トレ|ジム|スクワット|デッド/i.test(t)) session_type = 'strength'
  else if (/試合|大会|記録会|レース/i.test(t)) session_type = 'race'
  else if (/休養|オフ|休み/i.test(t)) session_type = 'rest'
  else if (/ジョグ|jog|easy/i.test(t)) session_type = 'easy'

  // 種目（event）
  const eventMatch = t.match(/\b(100m|200m|400m|800m|1500m|3000m|5000m|10000m|110mH|100mH|400mH|3000mSC)\b/i)
  const event = eventMatch ? eventMatch[1] : null

  // タイム (mm:ss.xx / ss.xx / ss"xx)
  let time_ms: number | null = null
  const timeMatch = t.match(/(\d{1,2}):(\d{2})[.:](\d{1,2})|(\d{1,2})'(\d{2})[.:]?(\d{0,2})|(\d{2,3})[."秒](\d{0,2})/)
  if (timeMatch) {
    if (timeMatch[1]) {
      time_ms = (parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]) + parseInt(timeMatch[3] || '0') / 100) * 1000
    } else if (timeMatch[4]) {
      time_ms = (parseInt(timeMatch[4]) * 60 + parseInt(timeMatch[5]) + parseInt(timeMatch[6] || '0') / 100) * 1000
    } else if (timeMatch[7]) {
      time_ms = (parseInt(timeMatch[7]) + parseInt(timeMatch[8] || '0') / 100) * 1000
    }
    time_ms = time_ms ? Math.round(time_ms) : null
  }

  // 距離
  let distance_m: number | null = null
  const kmMatch  = t.match(/(\d+(?:\.\d+)?)\s*km/i)
  const mMatch   = t.match(/(\d+)\s*m(?!H|SC)\b/)
  if (kmMatch) distance_m = Math.round(parseFloat(kmMatch[1]) * 1000)
  else if (mMatch && parseInt(mMatch[1]) > 50) distance_m = parseInt(mMatch[1])

  // 本数
  const repsMatch = t.match(/(\d+)\s*(本|set|本セット|×)/)
  const reps = repsMatch ? parseInt(repsMatch[1]) : null

  // 疲労度
  const fatMatch = t.match(/疲労\s*[：:=]?\s*(\d+)|疲[れ労]\s*(\d+)/)
  const fatigue_level = fatMatch ? parseInt(fatMatch[1] ?? fatMatch[2]) : 5

  // 体調
  const condMatch = t.match(/体調\s*[：:=]?\s*(\d+)/)
  const condition_level = condMatch ? parseInt(condMatch[1]) : 6

  return { session_date: today, session_type, event, time_ms, distance_m, reps, fatigue_level, condition_level }
}

/** セッション内容に基づいてルールベースの改善タスクを生成 */
function generateTasks(sessionType: string, fatigueLevel: number, notes: string): string[] {
  const tasks: string[] = []

  // 疲労が高い → 回復系タスク
  if (fatigueLevel >= 8) {
    tasks.push('今夜は7時間以上の睡眠を確保しよう')
    tasks.push('アイスバスまたは軽いストレッチで回復を促そう')
  } else if (fatigueLevel >= 6) {
    tasks.push('練習後のストレッチを10分しっかり行おう')
  }

  // 種目別タスク
  if (sessionType === 'interval' || sessionType === 'sprint') {
    tasks.push('次の練習は軽いジョグか休養にしよう（インターバル翌日）')
  } else if (sessionType === 'long') {
    tasks.push('長距離後は糖質+たんぱく質の補給を忘れずに')
  } else if (sessionType === 'race') {
    tasks.push('レース後は2〜3日間は強度を落として調整しよう')
  } else if (sessionType === 'strength') {
    tasks.push('筋トレ後は48時間の筋肉回復時間を確保しよう')
  }

  // ノートに特定キーワードがあれば
  if (notes.includes('痛') || notes.includes('違和感')) {
    tasks.push('痛みや違和感が続く場合は早めに医師に相談しよう')
  }

  return tasks.slice(0, 3)
}

async function saveTasks(newTexts: string[]) {
  if (newTexts.length === 0) return
  try {
    const raw = await AsyncStorage.getItem(TASKS_KEY)
    const existing = raw ? JSON.parse(raw) : []
    const newTasks = newTexts.map(text => ({
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text,
      completed: false,
      created_at: new Date().toISOString(),
    }))
    const merged = [...newTasks, ...existing].slice(0, 20)  // 最大20件
    await AsyncStorage.setItem(TASKS_KEY, JSON.stringify(merged))
  } catch { /* ignore */ }
}

interface Props {
  visible: boolean
  onClose: () => void
  onSaved?: () => void
}

// セッションタイプを日本語に変換
function sessionTypeLabel(t: string): string {
  const m: Record<string, string> = {
    interval: 'インターバル', tempo: 'テンポ走', sprint: 'スプリント',
    long: 'ロング走', drill: 'ドリル', strength: '筋トレ',
    race: 'レース', rest: '休養', easy: 'ジョグ',
  }
  return m[t] || t
}

// ms → 表示タイム
function formatTimeMs(ms: number): string {
  const totalSec = ms / 1000
  if (totalSec >= 60) {
    const min = Math.floor(totalSec / 60)
    const sec = (totalSec % 60).toFixed(2).padStart(5, '0')
    return `${min}'${sec}"`
  }
  return `${totalSec.toFixed(2)}"`
}

export default function QuickLogModal({ visible, onClose, onSaved }: Props) {
  const [freeText, setFreeText]         = useState('')
  const [parsing, setParsing]           = useState(false)
  const [showShare, setShowShare]       = useState(false)
  const [shareData, setShareData]       = useState<PracticeShareData | null>(null)
  const [selectedDate, setSelectedDate] = useState(dateOffset(0))

  const slideAnim = useRef(new Animated.Value(300)).current

  React.useEffect(() => {
    if (visible) {
      setSelectedDate(dateOffset(0))  // モーダルを開くたびに「今日」にリセット
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: Platform.OS !== 'web' }).start()
    } else {
      slideAnim.setValue(300)
    }
  }, [visible])

  function handleClose() {
    setFreeText('')
    setShowShare(false)  // ゾンビModal防止
    onClose()
  }

  async function handleSave() {
    if (!freeText.trim()) return
    unlockAudio()
    setParsing(true)

    const today = localDateStr(new Date())  // UTC ではなくローカル日付を使用

    // テキスト内の日付を優先、なければボタンで選択した日付
    const textDate = parseDateFromText(freeText)
    const sessionDate = textDate || selectedDate

    // 正規表現でテキストを解析（AI不使用・即時保存）
    const parsed: Record<string, any> = fallbackParse(freeText, sessionDate)

    // ── 保存 ──────────────────────────────────
    const toNum = (v: any) => (v !== null && v !== undefined && v !== 'null' && !isNaN(Number(v)) && Number(v) > 0) ? Number(v) : undefined
    try {
      const existing = await AsyncStorage.getItem(SESSIONS_KEY)
      let sessions: any[] = []
      try { if (existing) sessions = JSON.parse(existing) } catch {}  // データ破損でも新規保存を継続

      sessions.unshift({
        id:              `ql_${Date.now()}`,
        user_id:         (await AsyncStorage.getItem('userId').catch(() => null)) ?? 'local',
        session_date:    parsed.session_date    || today,
        session_type:    parsed.session_type    || 'easy',
        event:           parsed.event && parsed.event !== 'null' && parsed.event !== null ? String(parsed.event) : undefined,
        time_ms:         toNum(parsed.time_ms),
        distance_m:      toNum(parsed.distance_m),
        reps:            toNum(parsed.reps),
        fatigue_level:   toNum(parsed.fatigue_level) ?? 5,
        condition_level: toNum(parsed.condition_level) ?? 7,
        notes:           freeText,
        created_at:      new Date().toISOString(),
      })

      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
      autoSyncTeam(sessions, { force: true }).catch(() => {})
      trackSessionRecord(parsed.session_type || 'easy')

      // 改善タスクを自動生成してホーム画面に表示
      const taskTexts = generateTasks(
        parsed.session_type || 'easy',
        parsed.fatigue_level || 5,
        freeText,
      )
      await saveTasks(taskTexts)

      Sounds.save()
      successNotify()
      Toast.show({ type: 'success', text1: '練習を記録しました ✓', visibilityTime: 1800 })

      // シェアカード用データを組み立て
      const d = new Date()
      const weekdays = ['日', '月', '火', '水', '木', '金', '土']
      const dateLabel = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${weekdays[d.getDay()]}）`
      const drills: string[] = []
      const drillRegex = /([A-Za-zぁ-んァ-ン一-龥]+ドリル|Aスキップ|Bスキップ|バウンディング|ハイニー|もも上げ|ランジ|サーキット)/g
      let m: RegExpExecArray | null
      while ((m = drillRegex.exec(freeText)) !== null) drills.push(m[1])

      setShareData({
        date:      dateLabel,
        title:     sessionTypeLabel(parsed.session_type || 'easy'),
        menu:      freeText.trim(),
        drills,
        distance:  parsed.distance_m ? parsed.distance_m / 1000 : undefined,
        sets:      parsed.reps       ? Number(parsed.reps)       : undefined,
        time:      parsed.time_ms    ? formatTimeMs(Number(parsed.time_ms)) : undefined,
        fatigue:   parsed.fatigue_level   ? Number(parsed.fatigue_level)   : undefined,
        condition: parsed.condition_level ? Number(parsed.condition_level) : undefined,
      })
      setShowShare(true)
      setFreeText('')
      onSaved?.()
    } catch {
      Toast.show({ type: 'error', text1: '保存に失敗しました', text2: 'もう一度試してください' })
    } finally {
      setParsing(false)
    }
  }

  return (
    <Modal visible={visible || showShare} transparent={!showShare} animationType={showShare ? 'slide' : 'none'} onRequestClose={() => { if (showShare) { setShowShare(false); onClose() } else { handleClose() } }}>
      <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={handleClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={st.kvWrapper}
        pointerEvents="box-none"
      >
        <Animated.View style={[st.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={st.handle} />
          <View style={st.header}>
            <Text style={st.title}>✏️ 自由入力で記録</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={TEXT.secondary} />
            </TouchableOpacity>
          </View>

          {/* 日付セレクター */}
          <View style={st.dateRow}>
            {([0, 1, 2] as const).map(offset => {
              const d = dateOffset(offset)
              const labels = ['今日', '昨日', '一昨日']
              const active = selectedDate === d
              return (
                <TouchableOpacity
                  key={offset}
                  style={[st.dateBtn, active && st.dateBtnActive]}
                  onPress={() => setSelectedDate(d)}
                  activeOpacity={0.75}
                >
                  <Text style={[st.dateBtnTxt, active && st.dateBtnTxtActive]}>
                    {labels[offset]}
                  </Text>
                  {active && (
                    <Text style={st.dateBtnSub}>{formatDateLabel(d)}</Text>
                  )}
                </TouchableOpacity>
              )
            })}
          </View>

          <Text style={st.hint}>
            自由に入力 — 「昨日」「5月10日」と書いても反映されます
          </Text>

          <TextInput
            style={st.input}
            value={freeText}
            onChangeText={setFreeText}
            multiline
            autoFocus
            placeholder={'例:\n400m × 5本 レスト3分 68秒\n疲労7 脚が重かった\n\n「ジョグ10km」だけでもOK'}
            placeholderTextColor={TEXT.hint}
            textAlignVertical="top"
          />

          <HapticTouch
            haptic="save"
            style={[st.saveBtn, (!freeText.trim() || parsing) && { opacity: 0.4 }]}
            activeOpacity={0.85}
            onPress={handleSave}
            disabled={!freeText.trim() || parsing}
          >
            {parsing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="sparkles" size={18} color="#fff" />
                <Text style={st.saveBtnText}>AIで記録する</Text>
              </>
            )}
          </HapticTouch>
        </Animated.View>
      </KeyboardAvoidingView>

      {/* シェアカード（同じModal内で表示） */}
      {showShare && shareData && (
        <PracticeShareCard
          data={shareData}
          visible={showShare}
          onClose={() => { setShowShare(false); onClose() }}
        />
      )}
    </Modal>
  )
}

const st = StyleSheet.create({
  overlay:    { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  kvWrapper:  { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 16, paddingBottom: 40,
    borderTopWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08, shadowRadius: 16, elevation: 8,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.15)',
    alignSelf: 'center', marginTop: 10, marginBottom: 6,
  },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  title:      { color: TEXT.primary, fontSize: 17, fontWeight: '800' },
  hint:       { color: TEXT.hint, fontSize: 13, marginBottom: 12, lineHeight: 18 },
  input: {
    backgroundColor: '#f8f8fa',
    borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    color: TEXT.primary, fontSize: 15, lineHeight: 24,
    borderWidth: 1, borderColor: 'rgba(59,130,246,0.25)',
    height: 160,
    marginBottom: 16,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: BRAND, borderRadius: 14, paddingVertical: 16,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // 日付セレクター
  dateRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  dateBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, paddingVertical: 8,
    backgroundColor: '#f0f2f5',
    borderWidth: 1.5, borderColor: 'transparent',
  },
  dateBtnActive: {
    backgroundColor: '#e8f5e9',
    borderColor: BRAND,
  },
  dateBtnTxt: { fontSize: 13, fontWeight: '700', color: '#6b7280' },
  dateBtnTxtActive: { color: BRAND },
  dateBtnSub: { fontSize: 10, color: BRAND, marginTop: 2, fontWeight: '600' },
})

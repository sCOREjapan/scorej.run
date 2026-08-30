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
import { updateSessions } from '../lib/sessionsStore'
import { addTasks } from '../lib/tasksStore'
import { trackSessionRecord } from '../lib/analytics'
import { successNotify } from '../lib/haptics'
import { parseDistanceAndReps } from '../lib/parseWorkoutDistance'
import PracticeShareCard, { PracticeShareData } from './PracticeShareCard'
import type { TrainingSession } from '../types'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../context/LanguageContext'
import { getSessionTypeLabel } from '../lib/sessionTypeLabels'

const SESSIONS_KEY = 'trackmate_sessions'

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

/** YYYY-MM-DD → 表示文字列 */
function formatDateLabel(iso: string, lang: 'ja' | 'en' = 'ja'): string {
  const d = new Date(iso + 'T12:00:00')
  if (lang === 'en') return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', weekday: 'short' })
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  return `${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`
}

// ── 正規表現フォールバックパーサー ───────────────────────────────
function fallbackParse(text: string, today: string): Record<string, any> {
  const t = text

  // 種目判定（practice-input.tsx の fallbackParse と同じ判定基準に統一 — 別々に実装すると
  // 同じ文章でも入力画面によって分類結果が食い違うバグの原因になるため）
  let session_type = 'easy'
  if (/インターバル|interval|本.*レスト|レスト.*本/i.test(t)) session_type = 'interval'
  else if (/テンポ|ペース走|ビルドアップ|tempo|pace run|build.?up/i.test(t)) session_type = 'tempo'
  else if (/スプリント|全力|100m.*走|ダッシュ|坂道|流し|タイムトライアル|\bTT\b|sprint|hill/i.test(t)) session_type = 'sprint'
  else if (/ロング|長距離|LSD|long run|long jog/i.test(t)) session_type = 'long'
  else if (/ドリル|ハードル|ABCドリル|drill|hurdle/i.test(t)) session_type = 'drill'
  else if (/ウェイト|筋トレ|ジム|スクワット|デッド|weight|gym|squat|strength/i.test(t)) session_type = 'strength'
  else if (/試合|大会|記録会|レース|race|competition|meet/i.test(t)) session_type = 'race'
  else if (/休養|オフ|休み|レスト|\brest\b|day off/i.test(t)) session_type = 'rest'
  else if (/ジョグ|jog|easy/i.test(t)) session_type = 'easy'
  // 「ポイント練習」単体では種類が特定できないため、上記のどれにも一致しなかった場合のみ
  // インターバル系（質の高い練習の代表）として扱う。他のキーワードが既にあれば、そちらを優先する。
  else if (/ポイント練習|ポイント練/i.test(t)) session_type = 'interval'

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

  // 距離・本数（「300×6」等の掛け算表記は合計距離として計算される）
  const { distance_m, reps } = parseDistanceAndReps(t)

  // 疲労度
  const fatMatch = t.match(/疲労\s*[：:=]?\s*(\d+)|疲[れ労]\s*(\d+)|fatigue\s*[：:=]?\s*(\d+)/i)
  const fatigue_level = fatMatch ? parseInt(fatMatch[1] ?? fatMatch[2] ?? fatMatch[3]) : 5

  // 体調
  const condMatch = t.match(/体調\s*[：:=]?\s*(\d+)|condition\s*[：:=]?\s*(\d+)/i)
  const condition_level = condMatch ? parseInt(condMatch[1] ?? condMatch[2]) : 6

  return { session_date: today, session_type, event, time_ms, distance_m, reps, fatigue_level, condition_level }
}

/** セッション内容に基づいてルールベースの改善タスクを生成 */
function generateTasks(sessionType: string, fatigueLevel: number, notes: string, t: (key: string) => string): string[] {
  const tasks: string[] = []

  // 疲労が高い → 回復系タスク
  if (fatigueLevel >= 8) {
    tasks.push(t('quickLogModal.tasks.sleep'))
    tasks.push(t('quickLogModal.tasks.iceBath'))
  } else if (fatigueLevel >= 6) {
    tasks.push(t('quickLogModal.tasks.stretch'))
  }

  // 種目別タスク
  if (sessionType === 'interval' || sessionType === 'sprint') {
    tasks.push(t('quickLogModal.tasks.restDay'))
  } else if (sessionType === 'long') {
    tasks.push(t('quickLogModal.tasks.longRunFuel'))
  } else if (sessionType === 'race') {
    tasks.push(t('quickLogModal.tasks.raceRecovery'))
  } else if (sessionType === 'strength') {
    tasks.push(t('quickLogModal.tasks.strengthRecovery'))
  }

  // ノートに特定キーワードがあれば
  if (notes.includes('痛') || notes.includes('違和感') || /\bpain\b|\bsore(ness)?\b|\bhurt(s|ing)?\b/i.test(notes)) {
    tasks.push(t('quickLogModal.tasks.painCheck'))
  }

  return tasks.slice(0, 3)
}

async function saveTasks(newTexts: string[]) {
  if (newTexts.length === 0) return
  try {
    await addTasks(newTexts)
  } catch { /* ignore */ }
}

interface Props {
  visible: boolean
  onClose: () => void
  onSaved?: () => void
  /** 指定すると編集モード（既存の自由入力レコードを上書き） */
  editSession?: TrainingSession | null
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

export default function QuickLogModal({ visible, onClose, onSaved, editSession }: Props) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const isEdit = !!editSession
  const [freeText, setFreeText]         = useState('')
  const [parsing, setParsing]           = useState(false)
  const [showShare, setShowShare]       = useState(false)
  const [shareData, setShareData]       = useState<PracticeShareData | null>(null)
  const [selectedDate, setSelectedDate] = useState(dateOffset(0))

  const slideAnim = useRef(new Animated.Value(300)).current

  React.useEffect(() => {
    if (visible) {
      // 編集時は元レコードの内容・日付を復元、新規時は「今日」にリセット
      if (editSession) {
        setFreeText(editSession.notes ?? '')
        setSelectedDate(editSession.session_date)
      } else {
        setSelectedDate(dateOffset(0))
      }
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: Platform.OS !== 'web' }).start()
    } else {
      slideAnim.setValue(300)
    }
  }, [visible, editSession])

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

    // 日付は上のボタン（今日/昨日/一昨日）で選択したものを使用
    const sessionDate = selectedDate

    // 正規表現でテキストを解析（AI不使用・即時保存）
    const parsed: Record<string, any> = fallbackParse(freeText, sessionDate)

    // ── 保存 ──────────────────────────────────
    const toNum = (v: any) => (v !== null && v !== undefined && v !== 'null' && !isNaN(Number(v)) && Number(v) > 0) ? Number(v) : undefined
    try {
      const parsedFields = {
        session_date:    parsed.session_date    || today,
        session_type:    parsed.session_type    || 'easy',
        event:           parsed.event && parsed.event !== 'null' && parsed.event !== null ? String(parsed.event) : undefined,
        time_ms:         toNum(parsed.time_ms),
        distance_m:      toNum(parsed.distance_m),
        reps:            toNum(parsed.reps),
        fatigue_level:   toNum(parsed.fatigue_level) ?? 5,
        condition_level: toNum(parsed.condition_level) ?? 7,
        notes:           freeText,
      }

      if (editSession) {
        // ── 既存の自由入力レコードを上書き（id・created_at は保持） ──
        const sessions = await updateSessions(current =>
          current.map(sx => (sx.id === editSession.id ? { ...sx, ...parsedFields } as TrainingSession : sx))
        )
        autoSyncTeam(sessions, { force: true }).catch(() => {})
        Sounds.save()
        successNotify()
        Toast.show({ type: 'success', text1: t('quickLogModal.toastUpdateSuccess'), visibilityTime: 1500 })
        setFreeText('')
        onSaved?.()
        onClose()
        return
      }

      const newSession = {
        id:              `ql_${Date.now()}`,
        user_id:         (await AsyncStorage.getItem('userId').catch(() => null)) ?? 'local',
        created_at:      new Date().toISOString(),
        ...parsedFields,
      }
      const sessions = await updateSessions(current => [newSession as any, ...current])
      autoSyncTeam(sessions, { force: true }).catch(() => {})
      trackSessionRecord(parsed.session_type || 'easy')

      // 改善タスクを自動生成してホーム画面に表示
      const taskTexts = generateTasks(
        parsed.session_type || 'easy',
        parsed.fatigue_level || 5,
        freeText,
        t,
      )
      await saveTasks(taskTexts)

      Sounds.save()
      successNotify()
      Toast.show({ type: 'success', text1: t('quickLogModal.toastSaveSuccess'), visibilityTime: 1800 })

      // シェアカード用データを組み立て
      const d = new Date()
      const weekdays = ['日', '月', '火', '水', '木', '金', '土']
      const dateLabel = language === 'en'
        ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' })
        : `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${weekdays[d.getDay()]}）`
      const drills: string[] = []
      const drillRegex = /([A-Za-zぁ-んァ-ン一-龥]+ドリル|Aスキップ|Bスキップ|バウンディング|ハイニー|もも上げ|ランジ|サーキット)/g
      let m: RegExpExecArray | null
      while ((m = drillRegex.exec(freeText)) !== null) drills.push(m[1])

      setShareData({
        date:      dateLabel,
        title:     getSessionTypeLabel(parsed.session_type || 'easy', language),
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
      Toast.show({ type: 'error', text1: t('quickLogModal.toastSaveErrorTitle'), text2: t('quickLogModal.toastSaveErrorBody') })
    } finally {
      setParsing(false)
    }
  }

  return (
    <Modal visible={visible || showShare} transparent={!showShare} animationType={showShare ? 'slide' : 'none'} onRequestClose={() => { if (showShare) { setShowShare(false); onClose() } else { handleClose() } }}>
      {/* 背景タップで閉じるのは「まだ何も入力していない」時だけに限定する。
          入力済みの状態で誤タップして全文を無確認で失うバグ報告があったため
          （Androidはキーボードで入力欄が隠れやすく誤タップしやすい → 下のKeyboardAvoidingView修正も参照） */}
      <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={() => { if (!freeText.trim()) handleClose() }} />
      <KeyboardAvoidingView
        // Android: undefined(何もしない)だと<Modal transparent>特有の制約でキーボードが
        // 入力欄にそのまま覆いかぶさり、「打ち込めてるか見えない」バグになっていた。
        // 'height'にするとキーボード表示分だけシートの高さを縮めて押し上げてくれる
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={st.kvWrapper}
        pointerEvents="box-none"
      >
        <Animated.View style={[st.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={st.handle} />
          <View style={st.header}>
            <Text style={st.title}>{isEdit ? t('quickLogModal.titleEdit') : t('quickLogModal.titleNew')}</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('quickLogModal.close')} accessibilityRole="button">
              <Ionicons name="close" size={22} color={TEXT.secondary} />
            </TouchableOpacity>
          </View>

          {/* 日付セレクター */}
          {/* 編集中のレコードが3日以上前の場合、クイックボタン(今日/昨日/一昨日)はどれも
              ハイライトされない。選択中の日付が見えないまま誤ってボタンを押すと元の記録日を
              上書きしてしまうため、その場合は実際の選択日をボタン上部に明示する */}
          {isEdit && !([0, 1, 2] as const).some(o => dateOffset(o) === selectedDate) && (
            <View style={st.editDateNotice}>
              <Ionicons name="calendar-outline" size={13} color={TEXT.secondary} />
              <Text style={st.editDateNoticeTxt}>{t('quickLogModal.editDateNotice', { date: selectedDate })}</Text>
            </View>
          )}
          <View style={st.dateRow}>
            {([0, 1, 2] as const).map(offset => {
              const d = dateOffset(offset)
              const labelKeys = ['quickLogModal.dateToday', 'quickLogModal.dateYesterday', 'quickLogModal.dateTwoDaysAgo']
              const active = selectedDate === d
              return (
                <TouchableOpacity
                  key={offset}
                  style={[st.dateBtn, active && st.dateBtnActive]}
                  onPress={() => setSelectedDate(d)}
                  activeOpacity={0.75}
                >
                  <Text style={[st.dateBtnTxt, active && st.dateBtnTxtActive]}>
                    {t(labelKeys[offset])}
                  </Text>
                  {active && (
                    <Text style={st.dateBtnSub}>{formatDateLabel(d, language)}</Text>
                  )}
                </TouchableOpacity>
              )
            })}
          </View>

          <Text style={st.hint}>
            {t('quickLogModal.hint')}
          </Text>

          <TextInput
            style={st.input}
            value={freeText}
            onChangeText={setFreeText}
            multiline
            autoFocus
            autoCorrect={false}
            spellCheck={false}
            placeholder={t('quickLogModal.placeholder')}
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
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                <Text style={st.saveBtnText}>{isEdit ? t('quickLogModal.update') : t('quickLogModal.save')}</Text>
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
  editDateNotice: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  editDateNoticeTxt: { color: TEXT.secondary, fontSize: 12 },
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

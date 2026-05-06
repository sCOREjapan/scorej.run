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

const SESSIONS_KEY = 'trackmate_sessions'
const TASKS_KEY    = 'trackmate_tasks'

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

export default function QuickLogModal({ visible, onClose, onSaved }: Props) {
  const [freeText, setFreeText] = useState('')
  const [parsing, setParsing]   = useState(false)

  const slideAnim = useRef(new Animated.Value(300)).current

  React.useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }).start()
    } else {
      slideAnim.setValue(300)
    }
  }, [visible])

  function handleClose() {
    setFreeText('')
    onClose()
  }

  async function handleSave() {
    if (!freeText.trim()) return
    unlockAudio()
    setParsing(true)

    const today = new Date().toISOString().slice(0, 10)

    // ── Step 1: まず正規表現でフォールバック解析（必ず結果あり） ─
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
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            messages: [{
              role: 'user',
              content: `陸上競技の練習記録テキストを正確にJSONに変換してください。今日の日付は${today}です。

入力テキスト:
"${freeText}"

ルール:
- session_type: interval(本数+レスト), tempo(ペース走), easy(ジョグ/LSD), long(30分以上の長距離), sprint(全力短距離), drill(ドリル), strength(ウェイト/筋トレ), race(試合/大会), rest(休養)
- time_ms: タイムをミリ秒の整数に変換。「46秒80」→46800, 「1:28.50」→88500, 「11"25」→11250。タイムの記載がなければnull
- distance_m: 距離をメートルの整数に変換。「10km」→10000, 「400m」→400。記載がなければnull
- reps: 本数（「5本」「×5」→5）。記載がなければnull
- fatigue_level: 疲労度1〜10。「疲労7」→7。明記なければ雰囲気から推定（きつそうなら7〜8, 普通なら5〜6）
- condition_level: 体調1〜10。明記なければ6
- event: 記録した種目（100m, 200m, 400m, 800m, 1500m, 3000m, 5000m, 10000m, 110mH, 100mH, 400mH, 3000mSC のいずれか、なければnull）

必ずJSONのみを返してください（説明・前後の文章は不要）:
{"session_date":"${today}","session_type":"...","event":"...orNull","time_ms":数値orNull,"distance_m":数値orNull,"reps":数値orNull,"fatigue_level":1〜10の整数,"condition_level":1〜10の整数}`,
            }],
          }),
        })
        if (res.ok) {
          const data = await res.json()
          const rawText = data.content?.[0]?.text ?? ''
          // JSONブロックを抽出（余計なテキストが前後についても対応）
          const jsonMatch = rawText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const aiParsed = JSON.parse(jsonMatch[0])
            // AI結果で上書き（nullでないフィールドのみ）
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
      const existing = await AsyncStorage.getItem(SESSIONS_KEY)
      const sessions = existing ? JSON.parse(existing) : []

      sessions.unshift({
        id:              `ql_${Date.now()}`,
        user_id:         'mock-user-1',
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
      autoSyncTeam(sessions).catch(() => {})

      // 改善タスクを自動生成してホーム画面に表示
      const taskTexts = generateTasks(
        parsed.session_type || 'easy',
        parsed.fatigue_level || 5,
        freeText,
      )
      await saveTasks(taskTexts)

      Sounds.save()
      Toast.show({ type: 'success', text1: '練習を記録しました ✓', visibilityTime: 1800 })
      setFreeText('')
      onSaved?.()
      onClose()
    } catch {
      Toast.show({ type: 'error', text1: '保存に失敗しました', text2: 'もう一度試してください' })
    } finally {
      setParsing(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={handleClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={st.kvWrapper}
        pointerEvents="box-none"
      >
        <Animated.View style={[st.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={st.handle} />
          <View style={st.header}>
            <Text style={st.title}>今日の練習を記録</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={TEXT.secondary} />
            </TouchableOpacity>
          </View>

          <Text style={st.hint}>
            自由に入力してください — AIが自動で整理します
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
})

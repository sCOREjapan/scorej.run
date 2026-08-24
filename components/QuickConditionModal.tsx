// components/QuickConditionModal.tsx — 今日の状態を30秒で記録
import React, { useState, useRef, useCallback } from 'react'
import {
  Modal, View, Text, TouchableOpacity, TextInput,
  StyleSheet, Animated, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import { Ionicons } from '@expo/vector-icons'
import { BRAND, TEXT } from '../lib/theme'
import { Sounds, unlockAudio } from '../lib/sounds'
import { successNotify } from '../lib/haptics'
import Toast from 'react-native-toast-message'
import HapticTouch from './HapticTouch'
import { parseDistanceAndReps } from '../lib/parseWorkoutDistance'
import { updateSessions } from '../lib/sessionsStore'
import { getConditionMap, updateConditionMap } from '../lib/conditionStore'
import { getSleepRecords, updateSleepRecords } from '../lib/sleepStore'
import { updateWeights } from '../lib/weightStore'

const SESSIONS_KEY      = 'trackmate_sessions'
const DRAFT_KEY         = 'trackmate_quick_condition_draft'

type Draft = {
  targetDate: string
  fatigue: number
  sleepH: number
  condition: number
  menuText: string
  weightStr: string
  showOpt: boolean
}

function localDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

const FATIGUE_OPTIONS = [
  { emoji: '😊', label: '元気', value: 2 },
  { emoji: '😐', label: '普通', value: 4 },
  { emoji: '😓', label: 'やや', value: 6 },
  { emoji: '😫', label: '重い', value: 8 },
  { emoji: '🥵', label: '限界', value: 10 },
]

const CONDITION_OPTIONS = [
  { emoji: '🤕', label: '悪い',     value: 2 },
  { emoji: '😔', label: 'イマイチ', value: 4 },
  { emoji: '😊', label: 'まあまあ', value: 6 },
  { emoji: '💪', label: '好調',     value: 8 },
  { emoji: '🔥', label: '最高',     value: 10 },
]

interface Props {
  visible: boolean
  onClose: () => void
  onSaved?: () => void
  /** 記録対象の日付（YYYY-MM-DD）。省略時は今日 */
  date?: string
}

export default function QuickConditionModal({ visible, onClose, onSaved, date }: Props) {
  const targetDate = date ?? localDateStr()
  const isToday = targetDate === localDateStr()
  const [fatigue,   setFatigue]   = useState(4)
  const [sleepH,    setSleepH]    = useState(7.0)
  const [condition, setCondition] = useState(6)
  const [showOpt,   setShowOpt]   = useState(false)
  const [menuText,  setMenuText]  = useState('')
  const [weightKg,  setWeightKg]  = useState<number | null>(null)
  const [weightStr, setWeightStr] = useState('')
  const [saving,    setSaving]    = useState(false)

  const slideAnim = useRef(new Animated.Value(400)).current

  // 起動直後の復元処理中は下書きの自動保存を止める（デフォルト値で上書きしてしまうのを防ぐ）
  const restoringRef = useRef(false)

  React.useEffect(() => {
    if (visible) {
      restoringRef.current = true
      // 対象日の保存済みデータがあれば復元する（無ければ既定値に戻す）
      setCondition(6)
      setSleepH(7.0)
      setFatigue(4)
      ;(async () => {
        try {
          // 体調
          const condMap = await getConditionMap().catch(() => ({} as Record<string, number>))
          if (condMap[targetDate] != null) setCondition(condMap[targetDate])
          // 睡眠
          const sleepRecords = await getSleepRecords().catch(() => [])
          const daySleep = sleepRecords.find(r => r.sleep_date === targetDate)
          if (daySleep?.duration_min != null) setSleepH(Math.round((daySleep.duration_min / 60) * 2) / 2)
          // 疲労度（セッションから取得）
          const sessRaw = await AsyncStorage.getItem(SESSIONS_KEY).catch(() => null)
          if (sessRaw) {
            const sessions: any[] = JSON.parse(sessRaw)
            const daySess = sessions.find((s: any) => s.session_date === targetDate && s.fatigue_level != null)
            if (daySess) setFatigue(daySess.fatigue_level)
          }
          // 下書き（保存せずに閉じた前回の入力）があれば、保存済みデータより優先して復元する
          const draftRaw = await AsyncStorage.getItem(DRAFT_KEY).catch(() => null)
          if (draftRaw) {
            const draft: Draft = JSON.parse(draftRaw)
            if (draft.targetDate === targetDate) {
              setFatigue(draft.fatigue)
              setSleepH(draft.sleepH)
              setCondition(draft.condition)
              setMenuText(draft.menuText)
              setWeightStr(draft.weightStr)
              setShowOpt(draft.showOpt)
            }
          }
        } finally {
          restoringRef.current = false
        }
      })()
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: Platform.OS !== 'web' }).start()
    } else {
      slideAnim.setValue(400)
      setShowOpt(false)
      setMenuText('')
      setWeightStr('')
      setWeightKg(null)
    }
  }, [visible, targetDate])

  // ── 下書き自動保存 ──────────────────────────────────────────
  // 保存せずにアプリを閉じても、次に開いたときに入力内容を復元できるようにする。
  React.useEffect(() => {
    if (!visible || restoringRef.current) return
    const t = setTimeout(() => {
      const draft: Draft = { targetDate, fatigue, sleepH, condition, menuText, weightStr, showOpt }
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => {})
    }, 400)
    return () => clearTimeout(t)
  }, [visible, targetDate, fatigue, sleepH, condition, menuText, weightStr, showOpt])

  function adjustSleep(delta: number) {
    setSleepH(h => Math.min(12, Math.max(2, Math.round((h + delta) * 2) / 2)))
  }

  const handleSave = useCallback(async () => {
    if (saving) return
    unlockAudio()
    setSaving(true)
    try {
      // ── 体調を保存 ──
      await updateConditionMap(current => ({ ...current, [targetDate]: condition }))

      // ── 睡眠を保存 ──
      // 睡眠タブの詳細記録（就寝/起床時刻・メモ）が既にある場合、ここでの上書きで
      // 消してしまわないよう、対象日の既存レコードを引き継いだ上で
      // duration_min/quality_score だけを更新する
      const userId = (await AsyncStorage.getItem('userId').catch(() => null)) ?? 'local'
      await updateSleepRecords(current => {
        const existing = current.find(r => r.sleep_date === targetDate)
        const rest = current.filter(r => r.sleep_date !== targetDate)
        return [{
          ...existing,
          id:            existing?.id ?? Crypto.randomUUID(),
          user_id:       userId,
          sleep_date:    targetDate,
          duration_min:  Math.round(sleepH * 60),
          quality_score: Math.round(condition / 2),
          created_at:    existing?.created_at ?? new Date().toISOString(),
        }, ...rest].slice(0, 365)
      })

      // ── 練習メモ（任意）を保存 ──
      // 「ジョグ8km」のようなテキストから距離・本数を抽出し、累計距離に反映されるようにする
      if (menuText.trim()) {
        const { distance_m, reps } = parseDistanceAndReps(menuText.trim())
        const newSession = {
          id:              `qc_${Date.now()}`,
          user_id:         (await AsyncStorage.getItem('userId').catch(() => null)) ?? 'local',
          created_at:      new Date().toISOString(),
          session_date:    targetDate,
          session_type:    'easy',
          fatigue_level:   fatigue,
          condition_level: condition,
          notes:           menuText.trim(),
          distance_m:      distance_m ?? undefined,
          reps:            reps ?? undefined,
        }
        await updateSessions(current => [newSession as any, ...current])
      }

      // ── 体重（任意）を保存 ──
      const parsedWeight = parseFloat(weightStr.replace(',', '.'))
      if (!isNaN(parsedWeight) && parsedWeight > 0) {
        await updateWeights(current => {
          const rest = current.filter(w => w.date !== targetDate)
          return [{ id: `wt_${Date.now()}`, date: targetDate, weight_kg: parsedWeight }, ...rest].slice(0, 365)
        })
      }

      // 保存が完了したら下書きは不要になるため削除
      await AsyncStorage.removeItem(DRAFT_KEY).catch(() => {})

      Sounds.save()
      successNotify()
      Toast.show({
        type: 'success',
        text1: isToday ? '今日の状態を記録しました ✓' : `${targetDate.slice(5).replace('-', '/')}の状態を記録しました ✓`,
        visibilityTime: 1800,
      })
      onSaved?.()
      onClose()
    } catch {
      Toast.show({ type: 'error', text1: '保存に失敗しました', text2: 'もう一度試してください' })
    } finally {
      setSaving(false)
    }
  }, [saving, fatigue, sleepH, condition, menuText, weightStr, targetDate, isToday])

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={st.kvWrapper}
        pointerEvents="box-none"
      >
        <Animated.View style={[st.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={st.handle} />
          <View style={st.header}>
            <Text style={st.title}>{isToday ? '今日の状態を記録' : `${targetDate.slice(5).replace('-', '/')}の状態を記録`}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="閉じる" accessibilityRole="button">
              <Ionicons name="close" size={22} color={TEXT.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* ── 疲労度 ── */}
            <Text style={st.sectionLabel}>疲労度</Text>
            <View style={st.emojiRow}>
              {FATIGUE_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[st.emojiBtn, fatigue === opt.value && st.emojiBtnActive]}
                  onPress={() => { Sounds.tap(); setFatigue(opt.value) }}
                  activeOpacity={0.75}
                >
                  <Text style={st.emojiIcon}>{opt.emoji}</Text>
                  <Text style={[st.emojiLabel, fatigue === opt.value && { color: BRAND }]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── 睡眠時間 ── */}
            <Text style={st.sectionLabel}>睡眠時間（ざっくり）</Text>
            <View style={st.sleepRow}>
              <TouchableOpacity style={st.sleepAdj} onPress={() => adjustSleep(-0.5)} activeOpacity={0.7}>
                <Ionicons name="remove" size={20} color={TEXT.primary} />
              </TouchableOpacity>
              <View style={st.sleepDisplay}>
                <Text style={st.sleepVal}>{sleepH.toFixed(1)}</Text>
                <Text style={st.sleepUnit}>時間</Text>
              </View>
              <TouchableOpacity style={st.sleepAdj} onPress={() => adjustSleep(0.5)} activeOpacity={0.7}>
                <Ionicons name="add" size={20} color={TEXT.primary} />
              </TouchableOpacity>
            </View>
            <Text style={st.sleepHint}>就寝・起床時刻やメモまで記録したい時は「睡眠」タブから。ここでの記録はそちらを上書きしません</Text>

            {/* ── 体調 ── */}
            <Text style={st.sectionLabel}>体調</Text>
            <View style={st.emojiRow}>
              {CONDITION_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[st.emojiBtn, condition === opt.value && st.emojiBtnActive]}
                  onPress={() => { Sounds.tap(); setCondition(opt.value) }}
                  activeOpacity={0.75}
                >
                  <Text style={st.emojiIcon}>{opt.emoji}</Text>
                  <Text style={[st.emojiLabel, condition === opt.value && { color: BRAND }]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── 任意セクション ── */}
            <TouchableOpacity
              style={st.optToggle}
              onPress={() => setShowOpt(v => !v)}
              activeOpacity={0.7}
            >
              <Ionicons name={showOpt ? 'chevron-up' : 'add-circle-outline'} size={16} color={BRAND} />
              <Text style={st.optToggleText}>{showOpt ? '追加項目を閉じる' : '練習・体重も記録する（任意）'}</Text>
            </TouchableOpacity>

            {showOpt && (
              <View style={st.optBody}>
                <Text style={st.sectionLabel}>練習メニュー</Text>
                <TextInput
                  value={menuText}
                  onChangeText={setMenuText}
                  placeholder="例: ジョグ8km、インターバル400m×5本..."
                  placeholderTextColor={TEXT.hint}
                  multiline
                  style={st.menuInput}
                  textAlignVertical="top"
                />

                <Text style={[st.sectionLabel, { marginTop: 12 }]}>体重 (kg)</Text>
                <TextInput
                  value={weightStr}
                  onChangeText={setWeightStr}
                  placeholder="例: 62.5"
                  placeholderTextColor={TEXT.hint}
                  keyboardType="decimal-pad"
                  style={st.weightInput}
                />
              </View>
            )}

            {/* ── 保存ボタン ── */}
            <HapticTouch
              haptic="save"
              style={[st.saveBtn, saving && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={st.saveBtnText}>記録する</Text>
            </HapticTouch>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const st = StyleSheet.create({
  overlay:      { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  kvWrapper:    { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 6,
    maxHeight: '90%',
  },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.15)', alignSelf: 'center', marginBottom: 10 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, marginBottom: 4 },
  title:        { color: TEXT.primary, fontSize: 17, fontWeight: '800' },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: TEXT.secondary, letterSpacing: 0.5, marginBottom: 10, marginTop: 4 },

  emojiRow:     { flexDirection: 'row', gap: 8, marginBottom: 18 },
  emojiBtn:     { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.08)', backgroundColor: '#f8f8fa' },
  emojiBtnActive: { borderColor: BRAND, backgroundColor: 'rgba(76,175,80,0.08)' },
  emojiIcon:    { fontSize: 22 },
  emojiLabel:   { fontSize: 9, marginTop: 3, color: TEXT.secondary, fontWeight: '600' },

  sleepRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 20 },
  sleepAdj:     { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f0f2f5', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  sleepDisplay: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  sleepVal:     { fontSize: 36, fontWeight: '900', color: TEXT.primary, lineHeight: 42 },
  sleepUnit:    { fontSize: 14, color: TEXT.secondary, fontWeight: '600' },
  sleepHint:    { fontSize: 11, color: TEXT.hint, textAlign: 'center', marginTop: -12, marginBottom: 18 },

  optToggle:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, marginBottom: 4 },
  optToggleText:{ fontSize: 13, color: BRAND, fontWeight: '700' },
  optBody:      { marginBottom: 12 },
  menuInput:    { backgroundColor: '#f8f8fa', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: TEXT.primary, borderWidth: 1, borderColor: 'rgba(59,130,246,0.2)', height: 90, marginBottom: 4 },
  weightInput:  { backgroundColor: '#f8f8fa', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: TEXT.primary, borderWidth: 1, borderColor: 'rgba(59,130,246,0.2)' },

  saveBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 14, paddingVertical: 16, marginTop: 16 },
  saveBtnText:  { color: '#fff', fontSize: 16, fontWeight: '700' },
})

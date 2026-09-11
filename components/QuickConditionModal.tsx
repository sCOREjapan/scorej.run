// components/QuickConditionModal.tsx — 今日の状態を30秒で記録
import React, { useState, useRef, useCallback, useMemo } from 'react'
import {
  Modal, View, Text, TouchableOpacity, TextInput,
  StyleSheet, Animated, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import { Ionicons } from '@expo/vector-icons'
import { BRAND } from '../lib/theme'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { Sounds, unlockAudio } from '../lib/sounds'
import { successNotify } from '../lib/haptics'
import Toast from 'react-native-toast-message'
import HapticTouch from './HapticTouch'
import { parseDistanceAndReps } from '../lib/parseWorkoutDistance'
import { updateSessions } from '../lib/sessionsStore'
import { getConditionMap, updateConditionMap } from '../lib/conditionStore'
import { getSleepRecords, updateSleepRecords } from '../lib/sleepStore'
import { updateWeights } from '../lib/weightStore'
import { useTranslation } from 'react-i18next'
import { decideDailyAction, type DailyDecision, type PainSeverity, type PlannedIntensity } from '../lib/dailyDecision'
import { trackEvent } from '../lib/analytics'

const SESSIONS_KEY      = 'trackmate_sessions'
const DRAFT_KEY         = 'trackmate_quick_condition_draft'

type Draft = {
  targetDate: string
  fatigue: number
  sleepH: number
  condition: number
  pain: PainSeverity
  plannedIntensity: PlannedIntensity
  menuText: string
  weightStr: string
  showOpt: boolean
}

// 2026-09-09: 設計書§3-2「60秒状態チェック」。既存のQuickConditionModalは
// 疲労度・睡眠・体調は既に集めていたが、痛み・今日の練習予定強度が無く、
// 「今日の一手」を返す判定もしていなかった。新規に別画面を作ると入力導線が
// 分散するため、この既存モーダルに2項目を足し、保存後にlib/dailyDecision.tsの
// 判定結果を表示する形にする。
const PAIN_OPTIONS: { key: PainSeverity; emoji: string }[] = [
  { key: 'none', emoji: '🙆' },
  { key: 'mild', emoji: '😐' },
  { key: 'strong', emoji: '🤕' },
]
const INTENSITY_OPTIONS: { key: PlannedIntensity; emoji: string }[] = [
  { key: 'rest', emoji: '🛌' },
  { key: 'light', emoji: '🚶' },
  { key: 'normal', emoji: '🏃' },
  { key: 'high', emoji: '⚡' },
]
const DECISION_COLOR: Record<DailyDecision['level'], string> = {
  ready: '#34C759', caution: '#FF9500', recover: '#FF3B30',
}

function localDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// label は locales/quickConditionModal 経由で言語対応
const FATIGUE_OPTIONS = [
  { emoji: '😊', key: 'energetic', value: 2 },
  { emoji: '😐', key: 'normal', value: 4 },
  { emoji: '😓', key: 'somewhat', value: 6 },
  { emoji: '😫', key: 'heavy', value: 8 },
  { emoji: '🥵', key: 'limit', value: 10 },
]

const CONDITION_OPTIONS = [
  { emoji: '🤕', key: 'bad', value: 2 },
  { emoji: '😔', key: 'soso', value: 4 },
  { emoji: '😊', key: 'okay', value: 6 },
  { emoji: '💪', key: 'good', value: 8 },
  { emoji: '🔥', key: 'great', value: 10 },
]

interface Props {
  visible: boolean
  onClose: () => void
  onSaved?: () => void
  /** 記録対象の日付（YYYY-MM-DD）。省略時は今日 */
  date?: string
}

export default function QuickConditionModal({ visible, onClose, onSaved, date }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const st = useMemo(() => makeSt(colors), [colors])
  const targetDate = date ?? localDateStr()
  const isToday = targetDate === localDateStr()
  const [fatigue,   setFatigue]   = useState(4)
  const [sleepH,    setSleepH]    = useState(7.0)
  const [condition, setCondition] = useState(6)
  const [pain,      setPain]      = useState<PainSeverity>('none')
  const [plannedIntensity, setPlannedIntensity] = useState<PlannedIntensity>('normal')
  const [showOpt,   setShowOpt]   = useState(false)
  const [menuText,  setMenuText]  = useState('')
  const [weightKg,  setWeightKg]  = useState<number | null>(null)
  const [weightStr, setWeightStr] = useState('')
  const [saving,    setSaving]    = useState(false)
  const [decision,  setDecision]  = useState<DailyDecision | null>(null)

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
      setPain('none')
      setPlannedIntensity('normal')
      setDecision(null)
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
              if (draft.pain) setPain(draft.pain)
              if (draft.plannedIntensity) setPlannedIntensity(draft.plannedIntensity)
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
    const timer = setTimeout(() => {
      const draft: Draft = { targetDate, fatigue, sleepH, condition, pain, plannedIntensity, menuText, weightStr, showOpt }
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => {})
    }, 400)
    return () => clearTimeout(timer)
  }, [visible, targetDate, fatigue, sleepH, condition, pain, plannedIntensity, menuText, weightStr, showOpt])

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
      // 消してしまわないよう、対象日の既存レコードを引き継ぐ。
      // 2026-09-12バグ修正: 以前はduration_min/quality_scoreを無条件にこのクイック
      // 入力側の値(sleepH・condition/2)で上書きしていたため、睡眠タブで「7」と手動
      // 入力したスコアが、後で日次のクイック記録を使っただけで「3」等の無関係な値
      // (体調condition÷2という別指標)に化けてしまうバグがあった（ユーザー報告：
      // 「睡眠記録でつけられる1~10のスコアが次の日には変わってしまっています」）。
      // sleep_startの有無で「睡眠タブで作られた詳細記録か」を判定し、詳細記録が
      // 既にある場合はduration_min/quality_scoreともにそちらの値を優先して残す。
      const userId = (await AsyncStorage.getItem('userId').catch(() => null)) ?? 'local'
      await updateSleepRecords(current => {
        const existing = current.find(r => r.sleep_date === targetDate)
        const rest = current.filter(r => r.sleep_date !== targetDate)
        const hasDetailedRecord = !!existing?.sleep_start
        return [{
          ...existing,
          id:            existing?.id ?? Crypto.randomUUID(),
          user_id:       userId,
          sleep_date:    targetDate,
          duration_min:  hasDetailedRecord ? existing!.duration_min : Math.round(sleepH * 60),
          quality_score: hasDetailedRecord ? existing!.quality_score : Math.round(condition / 2),
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
        text1: isToday ? t('quickConditionModal.toastSaveSuccessToday') : t('quickConditionModal.toastSaveSuccessDate', { date: targetDate.slice(5).replace('-', '/') }),
        visibilityTime: 1800,
      })
      onSaved?.()
      trackEvent('daily_checkin_completed', {
        feature: 'daily_checkin',
        metadata: { pain, planned_intensity: plannedIntensity, is_today: isToday },
      })
      // 2026-09-09: 保存して即座に閉じるのではなく、ルールベースの「今日の一手」を
      // その場で見せる（設計書§3-2）。今日の記録の時だけ表示する（過去日の修正時は不要）。
      if (isToday) {
        const result = decideDailyAction({ sleepHours: sleepH, fatigue, condition, pain, plannedIntensity })
        setDecision(result)
        trackEvent('daily_decision_viewed', { feature: 'daily_checkin', metadata: { level: result.level } })
      } else {
        onClose()
      }
    } catch {
      Toast.show({ type: 'error', text1: t('quickConditionModal.toastSaveErrorTitle'), text2: t('quickConditionModal.toastSaveErrorBody') })
    } finally {
      setSaving(false)
    }
  }, [saving, fatigue, sleepH, condition, pain, plannedIntensity, menuText, weightStr, targetDate, isToday, t])

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
            <Text style={st.title}>{isToday ? t('quickConditionModal.titleToday') : t('quickConditionModal.titleDate', { date: targetDate.slice(5).replace('-', '/') })}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('quickConditionModal.close')} accessibilityRole="button">
              <Ionicons name="close" size={22} color={colors.textSec} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {decision ? (
              <View style={{ paddingTop: 4, paddingBottom: 8 }}>
                <View style={[st.decisionBadge, { backgroundColor: DECISION_COLOR[decision.level] + '18' }]}>
                  <View style={[st.decisionDot, { backgroundColor: DECISION_COLOR[decision.level] }]} />
                  <Text style={[st.decisionBadgeText, { color: DECISION_COLOR[decision.level] }]}>
                    {t(`quickConditionModal.decisionLevel.${decision.level}`)}
                  </Text>
                </View>
                <Text style={st.decisionHeadline}>{decision.headline}</Text>
                <Text style={st.decisionAction}>{decision.recommendedAction}</Text>
                {decision.reasons.length > 0 && (
                  <View style={st.decisionReasons}>
                    {decision.reasons.map((r, i) => (
                      <Text key={i} style={st.decisionReasonText}>・{r}</Text>
                    ))}
                  </View>
                )}
                <HapticTouch haptic="save" style={st.saveBtn} onPress={onClose} activeOpacity={0.85}>
                  <Text style={st.saveBtnText}>{t('quickConditionModal.decisionClose')}</Text>
                </HapticTouch>
              </View>
            ) : (
            <>
            {/* ── 疲労度 ── */}
            <Text style={st.sectionLabel}>{t('quickConditionModal.fatigueLabel')}</Text>
            <View style={st.emojiRow}>
              {FATIGUE_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[st.emojiBtn, fatigue === opt.value && st.emojiBtnActive]}
                  onPress={() => { Sounds.tap(); setFatigue(opt.value) }}
                  activeOpacity={0.75}
                >
                  <Text style={st.emojiIcon}>{opt.emoji}</Text>
                  <Text style={[st.emojiLabel, fatigue === opt.value && { color: BRAND }]}>{t(`quickConditionModal.fatigueOptions.${opt.key}`)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── 睡眠時間 ── */}
            <Text style={st.sectionLabel}>{t('quickConditionModal.sleepLabel')}</Text>
            <View style={st.sleepRow}>
              <TouchableOpacity style={st.sleepAdj} onPress={() => adjustSleep(-0.5)} activeOpacity={0.7}>
                <Ionicons name="remove" size={20} color={colors.text} />
              </TouchableOpacity>
              <View style={st.sleepDisplay}>
                <Text style={st.sleepVal}>{sleepH.toFixed(1)}</Text>
                <Text style={st.sleepUnit}>{t('quickConditionModal.sleepUnit')}</Text>
              </View>
              <TouchableOpacity style={st.sleepAdj} onPress={() => adjustSleep(0.5)} activeOpacity={0.7}>
                <Ionicons name="add" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>
            <Text style={st.sleepHint}>{t('quickConditionModal.sleepHint')}</Text>

            {/* ── 体調 ── */}
            <Text style={st.sectionLabel}>{t('quickConditionModal.conditionLabel')}</Text>
            <View style={st.emojiRow}>
              {CONDITION_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[st.emojiBtn, condition === opt.value && st.emojiBtnActive]}
                  onPress={() => { Sounds.tap(); setCondition(opt.value) }}
                  activeOpacity={0.75}
                >
                  <Text style={st.emojiIcon}>{opt.emoji}</Text>
                  <Text style={[st.emojiLabel, condition === opt.value && { color: BRAND }]}>{t(`quickConditionModal.conditionOptions.${opt.key}`)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── 痛み・違和感 ── */}
            <Text style={st.sectionLabel}>{t('quickConditionModal.painLabel')}</Text>
            <View style={st.emojiRow}>
              {PAIN_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.key}
                  style={[st.emojiBtn, pain === opt.key && st.emojiBtnActive]}
                  onPress={() => { Sounds.tap(); setPain(opt.key) }}
                  activeOpacity={0.75}
                >
                  <Text style={st.emojiIcon}>{opt.emoji}</Text>
                  <Text style={[st.emojiLabel, pain === opt.key && { color: BRAND }]}>{t(`quickConditionModal.painOptions.${opt.key}`)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── 今日の練習予定強度 ── */}
            <Text style={st.sectionLabel}>{t('quickConditionModal.intensityLabel')}</Text>
            <View style={st.emojiRow}>
              {INTENSITY_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.key}
                  style={[st.emojiBtn, plannedIntensity === opt.key && st.emojiBtnActive]}
                  onPress={() => { Sounds.tap(); setPlannedIntensity(opt.key) }}
                  activeOpacity={0.75}
                >
                  <Text style={st.emojiIcon}>{opt.emoji}</Text>
                  <Text style={[st.emojiLabel, plannedIntensity === opt.key && { color: BRAND }]}>{t(`quickConditionModal.intensityOptions.${opt.key}`)}</Text>
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
              <Text style={st.optToggleText}>{showOpt ? t('quickConditionModal.optToggleClose') : t('quickConditionModal.optToggleOpen')}</Text>
            </TouchableOpacity>

            {showOpt && (
              <View style={st.optBody}>
                <Text style={st.sectionLabel}>{t('quickConditionModal.menuLabel')}</Text>
                <TextInput
                  value={menuText}
                  onChangeText={setMenuText}
                  placeholder={t('quickConditionModal.menuPlaceholder')}
                  placeholderTextColor={colors.textHint}
                  multiline
                  style={st.menuInput}
                  textAlignVertical="top"
                />

                <Text style={[st.sectionLabel, { marginTop: 12 }]}>{t('quickConditionModal.weightLabel')}</Text>
                <TextInput
                  value={weightStr}
                  onChangeText={setWeightStr}
                  placeholder={t('quickConditionModal.weightPlaceholder')}
                  placeholderTextColor={colors.textHint}
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
              <Text style={st.saveBtnText}>{t('quickConditionModal.save')}</Text>
            </HapticTouch>
            </>
            )}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const makeSt = (colors: ThemeColors) => StyleSheet.create({
  overlay:      { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  kvWrapper:    { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 6,
    maxHeight: '90%',
  },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 10 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, marginBottom: 4 },
  title:        { color: colors.text, fontSize: 17, fontWeight: '800' },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.textSec, letterSpacing: 0.5, marginBottom: 10, marginTop: 4 },

  emojiRow:     { flexDirection: 'row', gap: 8, marginBottom: 18 },
  emojiBtn:     { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface2 },
  emojiBtnActive: { borderColor: BRAND, backgroundColor: 'rgba(76,175,80,0.08)' },
  emojiIcon:    { fontSize: 22 },
  emojiLabel:   { fontSize: 9, marginTop: 3, color: colors.textSec, fontWeight: '600' },

  sleepRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 20 },
  sleepAdj:     { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  sleepDisplay: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  sleepVal:     { fontSize: 36, fontWeight: '900', color: colors.text, lineHeight: 42 },
  sleepUnit:    { fontSize: 14, color: colors.textSec, fontWeight: '600' },
  sleepHint:    { fontSize: 11, color: colors.textHint, textAlign: 'center', marginTop: -12, marginBottom: 18 },

  optToggle:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, marginBottom: 4 },
  optToggleText:{ fontSize: 13, color: BRAND, fontWeight: '700' },
  optBody:      { marginBottom: 12 },
  menuInput:    { backgroundColor: colors.surface2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: 'rgba(59,130,246,0.2)', height: 90, marginBottom: 4 },
  weightInput:  { backgroundColor: colors.surface2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.text, borderWidth: 1, borderColor: 'rgba(59,130,246,0.2)' },

  saveBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 14, paddingVertical: 16, marginTop: 16 },
  saveBtnText:  { color: '#fff', fontSize: 16, fontWeight: '700' },

  // ── 今日の一手（判定結果） ──
  decisionBadge:     { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, borderRadius: 50, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 14 },
  decisionDot:       { width: 7, height: 7, borderRadius: 3.5 },
  decisionBadgeText: { fontSize: 12, fontWeight: '800' },
  decisionHeadline:  { fontSize: 20, fontWeight: '900', color: colors.text, marginBottom: 10, lineHeight: 27 },
  decisionAction:    { fontSize: 14, color: colors.textSec, lineHeight: 22, marginBottom: 14 },
  decisionReasons:   { backgroundColor: colors.surface2, borderRadius: 12, padding: 12, marginBottom: 4 },
  decisionReasonText:{ fontSize: 12, color: colors.textSec, lineHeight: 19 },
})

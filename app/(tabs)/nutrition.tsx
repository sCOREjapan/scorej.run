import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Animated, Image, Platform, TextInput, Modal, Pressable,
} from 'react-native'
import { checkAdGate, recordUsage } from '../../lib/adGate'
import { TICKET_COST } from '../../lib/ticketWallet'
import AdGateModal from '../../components/AdGateModal'
import TicketGateModal from '../../components/TicketGateModal'
import NutritionShareCard, { type NutritionShareData } from '../../components/NutritionShareCard'
import { useAuth } from '../../context/AuthContext'
import { useRouter, useFocusEffect } from 'expo-router'
import { trackFeatureUse } from '../../lib/analytics'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { Ionicons } from '@expo/vector-icons'
import Toast from 'react-native-toast-message'
import * as FileSystem from 'expo-file-system/legacy'
import * as ImageManipulator from 'expo-image-manipulator'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import DateSelector from '../../components/DateSelector'
import { analyzeMeal } from '../../lib/claude'
import AIFeedbackCard from '../../components/AIFeedbackCard'
import GlassCard from '../../components/GlassCard'
import PressableScale from '../../components/PressableScale'
import { BRAND, NEON } from '../../lib/theme'
import { useTheme, type ThemeColors } from '../../context/ThemeContext'
import { Sounds, unlockAudio } from '../../lib/sounds'
import HapticTouch from '../../components/HapticTouch'
import AnimatedSection from '../../components/AnimatedSection'
import type { MealType, MealRecord, MealAnalysisResult, UserProfile } from '../../types'
import { todayLocalISO, localDateStr } from '../../lib/dateLocal'
import { getWeights, type WeightRecord } from '../../lib/weightStore'
import { createStorageQueue } from '../../lib/storageQueue'
import { BlurView } from 'expo-blur'
import { usePurchase } from '../../context/PurchaseContext'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../../context/LanguageContext'

const STORAGE_KEY = 'trackmate_meals'
const NUTRITION_STATS_VIEW_KEY = 'trackmate_nutrition_stats_views'
const NUTRITION_STATS_FREE_VIEWS = 2
// 保存/区分変更/削除が history state を基点に独立して書き込むため、
// 同時に操作すると lost update が起きる可能性があり直列化する
const mealsStore = createStorageQueue<MealRecord[]>(STORAGE_KEY, [])
const PROFILE_KEY = 'trackmate_my_profile'

// label は locales/nutrition.mealTypes / .timings 経由で言語対応
const MEAL_TYPES: { value: MealType; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'breakfast', icon: 'partly-sunny-outline' },
  { value: 'lunch',     icon: 'sunny-outline' },
  { value: 'dinner',    icon: 'moon-outline' },
  { value: 'snack',     icon: 'nutrition-outline' },
  { value: 'supplement',icon: 'medical-outline' },
]
const TIMINGS: { value: 'pre' | 'post' | 'none' }[] = [
  { value: 'none' },
  { value: 'pre' },
  { value: 'post' },
]

// ─── Skeleton ──────────────────────────────────────────────────────────
function SkeletonRect({ height = 16, width = '100%' as string | number }) {
  const { colors } = useTheme()
  const opacity = useRef(new Animated.Value(0.3)).current
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
    ]))
    a.start(); return () => a.stop()
  }, [opacity])
  return <Animated.View style={{ height, width: width as any, borderRadius: 8, backgroundColor: colors.surface2, opacity }} />
}

// ─── 栄養素サマリー ─────────────────────────────────────────────────────
function MacroRow({ calories, protein, carb, fat }: { calories: number; protein: number; carb: number; fat: number }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={styles.macroRow}>
      <View style={styles.macroMain}>
        <Text style={styles.macroKcal}>{Math.round(calories)}</Text>
        <Text style={styles.macroKcalLabel}>kcal</Text>
      </View>
      {[
        { label: t('nutrition.macroRow.protein'), value: protein, color: BRAND },
        { label: t('nutrition.macroRow.carb'),    value: carb,    color: '#5AC8FA' },
        { label: t('nutrition.macroRow.fat'),     value: fat,     color: '#FF9500' },
      ].map(m => (
        <View key={m.label} style={styles.macroItem}>
          <Text style={[styles.macroValue, { color: m.color }]}>{Math.round(m.value)}g</Text>
          <Text style={styles.macroLabel}>{m.label}</Text>
        </View>
      ))}
    </View>
  )
}

// ─── 栄養プランの目安（体重ベース・3要素の充足度を一目で） ─────────────────────
function NutritionPlanCard({ stats, onGoLogWeight }: {
  stats: {
    latestWeight: WeightRecord | null
    planTargets: { protein: number; carb: number; fat: number } | null
    planFulfillment: { protein: number; carb: number; fat: number } | null
  }
  onGoLogWeight: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const planStyles = useMemo(() => makePlanStyles(colors), [colors])
  if (!stats.latestWeight || !stats.planTargets) {
    return (
      <View style={planStyles.card}>
        <View style={planStyles.headRow}>
          <Ionicons name="pie-chart-outline" size={15} color={colors.text} />
          <Text style={styles.cardTitle}>{t('nutrition.planCard.title')}</Text>
        </View>
        <Text style={planStyles.emptyText}>{t('nutrition.planCard.emptyText')}</Text>
        <TouchableOpacity style={planStyles.emptyBtn} onPress={onGoLogWeight} activeOpacity={0.8}>
          <Text style={planStyles.emptyBtnText}>{t('nutrition.planCard.emptyBtn')}</Text>
          <Ionicons name="chevron-forward" size={14} color={BRAND} />
        </TouchableOpacity>
      </View>
    )
  }

  const { latestWeight, planTargets, planFulfillment } = stats
  const MACROS: { key: 'protein' | 'carb' | 'fat'; label: string }[] = [
    { key: 'protein', label: t('nutrition.planCard.macros.protein') },
    { key: 'carb',    label: t('nutrition.planCard.macros.carb') },
    { key: 'fat',     label: t('nutrition.planCard.macros.fat') },
  ]
  const worst = planFulfillment
    ? MACROS.map(m => ({ ...m, pct: planFulfillment[m.key] })).sort((a, b) => a.pct - b.pct)[0]
    : null

  return (
    <View style={planStyles.card}>
      <View style={planStyles.headRow}>
        <Ionicons name="pie-chart-outline" size={15} color={colors.text} />
        <Text style={styles.cardTitle}>{t('nutrition.planCard.title')}</Text>
      </View>
      <Text style={planStyles.sub}>
        {t('nutrition.planCard.sub', { weight: Math.round(latestWeight.weight_kg * 10) / 10, date: latestWeight.date })}
      </Text>

      <View style={planStyles.macroGrid}>
        {MACROS.map(m => {
          const pct = planFulfillment ? planFulfillment[m.key] : 0
          const barColor = pct >= 85 ? BRAND : '#FF9500'
          return (
            <View key={m.key} style={planStyles.macroCol}>
              <Text style={planStyles.macroName}>{m.label}</Text>
              <View style={planStyles.barTrack}>
                <View style={[planStyles.barFill, { width: `${Math.min(Math.max(pct, 0), 100)}%`, backgroundColor: planFulfillment ? barColor : colors.border }]} />
              </View>
              <View style={planStyles.macroNums}>
                <Text style={planStyles.macroNow}>{planFulfillment ? Math.round(planTargets[m.key] * pct / 100) : '–'}g</Text>
                <Text style={planStyles.macroTarget}>/{Math.round(planTargets[m.key])}g</Text>
              </View>
            </View>
          )
        })}
      </View>

      {planFulfillment ? (
        worst && worst.pct < 85 ? (
          <Text style={planStyles.insight}>
            {t('nutrition.planCard.insightWorst', { label: worst.label, pct: worst.pct })}
          </Text>
        ) : (
          <Text style={planStyles.insight}>{t('nutrition.planCard.insightGood')}</Text>
        )
      ) : (
        <Text style={planStyles.insight}>{t('nutrition.planCard.insightNoData')}</Text>
      )}
    </View>
  )
}

const makePlanStyles = (colors: ThemeColors) => StyleSheet.create({
  card:       { backgroundColor: colors.card, borderRadius: 21, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2 },
  headRow:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sub:        { color: colors.textSec, fontSize: 12, lineHeight: 17, marginTop: -4 },
  macroGrid:  { flexDirection: 'row', gap: 12, marginTop: 4 },
  macroCol:   { flex: 1, gap: 6 },
  macroName:  { color: colors.textSec, fontSize: 11, fontWeight: '600' },
  barTrack:   { height: 7, borderRadius: 4, backgroundColor: colors.surface2, overflow: 'hidden' },
  barFill:    { height: '100%', borderRadius: 4 },
  macroNums:  { flexDirection: 'row', alignItems: 'baseline', gap: 1 },
  macroNow:   { color: colors.text, fontSize: 12.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
  macroTarget:{ color: colors.textHint, fontSize: 10.5, fontVariant: ['tabular-nums'] },
  insight:    { color: colors.textSec, fontSize: 12, lineHeight: 18, marginTop: 4, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  emptyText:  { color: colors.textSec, fontSize: 12.5, lineHeight: 18 },
  emptyBtn:   { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 2 },
  emptyBtnText:{ color: BRAND, fontSize: 13, fontWeight: '700' },
})

// ─── 統計セクション（直近7日間） ────────────────────────────────────────
const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土']
const WEEKDAY_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function NutritionStatsSection({ stats }: {
  stats: {
    dayTotals: { date: string; calories: number; logged: boolean }[]
    avgCalories: number
    avgProtein: number
    macroPct: { protein: number; carb: number; fat: number } | null
    streak: number
    timingRate: number | null
    proteinPerKg: number | null
    hasData: boolean
  }
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const statsStyles = useMemo(() => makeStatsStyles(colors), [colors])
  const WEEKDAY = language === 'en' ? WEEKDAY_EN : WEEKDAY_JA
  if (!stats.hasData) {
    return (
      <View style={styles.empty}>
        <Ionicons name="stats-chart-outline" size={32} color={colors.textHint} />
        <Text style={styles.emptyText}>{t('nutrition.statsEmpty')}</Text>
      </View>
    )
  }

  const maxCal = Math.max(...stats.dayTotals.map(d => d.calories), 1)

  return (
    <View style={{ gap: 18 }}>
      {/* 継続日数バッジ */}
      {stats.streak > 1 && (
        <View style={statsStyles.streakBadge}>
          <Ionicons name="flame-outline" size={14} color="#c2650a" />
          <Text style={statsStyles.streakText}>{t('nutrition.streakContinuing', { n: stats.streak })}</Text>
        </View>
      )}

      {/* 7日間カロリー推移 */}
      <View>
        <View style={statsStyles.rowBetween}>
          <Text style={statsStyles.label}>{t('nutrition.avgCaloriesPerDay')}</Text>
          <Text style={statsStyles.labelValue}>{t('nutrition.avgLabel', { n: Math.round(stats.avgCalories) })}</Text>
        </View>
        <View style={statsStyles.barChartRow}>
          {stats.dayTotals.map(d => {
            const dow = WEEKDAY[new Date(d.date + 'T00:00:00').getDay()]
            const h = d.logged ? Math.max((d.calories / maxCal) * 72, 4) : 0
            return (
              <View key={d.date} style={statsStyles.barCol}>
                <View style={statsStyles.barTrack}>
                  <View style={[statsStyles.bar, { height: h, backgroundColor: d.logged ? BRAND : 'transparent' }]} />
                </View>
                <Text style={statsStyles.barLabel}>{dow}</Text>
              </View>
            )
          })}
        </View>
      </View>

      {/* PFCバランス */}
      {stats.macroPct && (
        <View>
          <Text style={statsStyles.label}>{t('nutrition.pfcBalance')}</Text>
          <View style={statsStyles.pfcBar}>
            <View style={{ flex: stats.macroPct.protein || 0.001, backgroundColor: BRAND }} />
            <View style={{ flex: stats.macroPct.carb    || 0.001, backgroundColor: '#5AC8FA' }} />
            <View style={{ flex: stats.macroPct.fat     || 0.001, backgroundColor: '#FF9500' }} />
          </View>
          <View style={statsStyles.pfcLegendRow}>
            <Text style={[statsStyles.pfcLegend, { color: BRAND }]}>{t('nutrition.planCard.macros.protein')} {stats.macroPct.protein}%</Text>
            <Text style={[statsStyles.pfcLegend, { color: '#3b9dc9' }]}>{t('nutrition.planCard.macros.carb')} {stats.macroPct.carb}%</Text>
            <Text style={[statsStyles.pfcLegend, { color: '#FF9500' }]}>{t('nutrition.planCard.macros.fat')} {stats.macroPct.fat}%</Text>
          </View>
        </View>
      )}

      {/* たんぱく質・タイミング */}
      <View style={statsStyles.metricRow}>
        <View style={statsStyles.metricBox}>
          <Text style={statsStyles.metricValue}>{Math.round(stats.avgProtein)}g</Text>
          <Text style={statsStyles.metricLabel}>{t('nutrition.avgProteinPerDay')}</Text>
          {stats.proteinPerKg != null && (
            <Text style={[
              statsStyles.metricSub,
              { color: stats.proteinPerKg >= 1.6 ? BRAND : '#FF9500' },
            ]}>
              {t('nutrition.proteinPerKg', { n: stats.proteinPerKg.toFixed(1) })}
            </Text>
          )}
        </View>
        {stats.timingRate != null && (
          <View style={statsStyles.metricBox}>
            <Text style={statsStyles.metricValue}>{stats.timingRate}%</Text>
            <Text style={statsStyles.metricLabel}>{t('nutrition.timingRate')}</Text>
          </View>
        )}
      </View>
    </View>
  )
}

const makeStatsStyles = (colors: ThemeColors) => StyleSheet.create({
  rowBetween:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  label:       { color: colors.textSec, fontSize: 12, fontWeight: '700' },
  labelValue:  { color: colors.text, fontSize: 12, fontWeight: '700' },
  streakBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(255,149,0,0.1)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  streakText:  { color: '#c2650a', fontSize: 12, fontWeight: '800' },
  barChartRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 96 },
  barCol:      { alignItems: 'center', gap: 6, flex: 1 },
  barTrack:    { height: 72, width: 18, justifyContent: 'flex-end', backgroundColor: colors.surface2, borderRadius: 6, overflow: 'hidden' },
  bar:         { width: '100%', borderRadius: 6 },
  barLabel:    { color: colors.textHint, fontSize: 10, fontWeight: '600' },
  pfcBar:      { flexDirection: 'row', height: 10, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.surface2 },
  pfcLegendRow:{ flexDirection: 'row', gap: 14, marginTop: 8 },
  pfcLegend:   { fontSize: 11, fontWeight: '700' },
  metricRow:   { flexDirection: 'row', gap: 10 },
  metricBox:   { flex: 1, backgroundColor: colors.surface2, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 2 },
  metricValue: { color: colors.text, fontSize: 18, fontWeight: '900' },
  metricLabel: { color: colors.textSec, fontSize: 11, marginTop: 2 },
  metricSub:   { fontSize: 10, fontWeight: '700', marginTop: 4 },
})

// ─── 食事履歴カード ─────────────────────────────────────────────────────
function MealHistoryCard({ meal, showDate, onPress }: { meal: MealRecord; showDate?: boolean; onPress?: () => void }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const type = MEAL_TYPES.find(mt => mt.value === meal.meal_type)
  const typeLabel = type ? t(`nutrition.mealTypes.${type.value}`) : meal.meal_type
  return (
    <TouchableOpacity style={styles.historyCard} onPress={onPress} activeOpacity={0.7} disabled={!onPress}>
      <View style={styles.historyCardHeader}>
        <Ionicons name={type?.icon ?? 'restaurant-outline'} size={16} color={colors.textSec} />
        <Text style={styles.historyType}>{typeLabel}</Text>
        {showDate && <Text style={styles.historyDate}>{meal.meal_date}</Text>}
        <View style={styles.kcalBadge}>
          <Text style={styles.kcalBadgeText}>{Math.round(meal.total_calories)} kcal</Text>
        </View>
        {onPress && <Ionicons name="pencil-outline" size={13} color={colors.textHint} style={{ marginLeft: 6 }} />}
      </View>
      {meal.foods.slice(0, 3).map((f, i) => (
        <Text key={i} style={styles.historyFood}>
          · {f.name}{'  '}
          <Text style={styles.historyFoodMacro}>({Math.round(f.calories)}kcal / P:{Math.round(f.protein)}g)</Text>
        </Text>
      ))}
      {meal.foods.length > 3 && <Text style={styles.historyMore}>{t('nutrition.moreItems', { n: meal.foods.length - 3 })}</Text>}
    </TouchableOpacity>
  )
}

// ─── 食事編集モーダル（区分の変更・削除） ─────────────────────────────────
function MealEditModal({ meal, onClose, onChangeMealType, onDelete }: {
  meal: MealRecord | null
  onClose: () => void
  onChangeMealType: (id: string, type: MealType) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  if (!meal) return null
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.editModalBackdrop} onPress={onClose}>
        <Pressable style={styles.editModalSheet} onPress={() => {}}>
          <Text style={styles.editModalTitle}>{t('nutrition.editModal.title')}</Text>
          <Text style={styles.editModalLabel}>{t('nutrition.editModal.category')}</Text>
          <View style={styles.editModalChipRow}>
            {MEAL_TYPES.map(mt => (
              <HapticTouch
                key={mt.value}
                haptic="toggleOn"
                style={[styles.chip, meal.meal_type === mt.value && styles.chipActive]}
                onPress={() => { onChangeMealType(meal.id, mt.value); onClose() }}
              >
                <Ionicons name={mt.icon} size={15} color={meal.meal_type === mt.value ? '#fff' : colors.textSec} />
                <Text style={[styles.chipText, meal.meal_type === mt.value && styles.chipTextActive]}>{t(`nutrition.mealTypes.${mt.value}`)}</Text>
              </HapticTouch>
            ))}
          </View>
          <TouchableOpacity
            style={styles.editModalDeleteBtn}
            onPress={() => { onDelete(meal.id); onClose() }}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={15} color="#FF3B30" />
            <Text style={styles.editModalDeleteText}>{t('nutrition.editModal.delete')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.editModalCloseBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.editModalCloseText}>{t('nutrition.editModal.close')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

// ─── メイン ────────────────────────────────────────────────────────────
export default function NutritionScreen() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [mealType, setMealType] = useState<MealType>('lunch')
  const [timing, setTiming] = useState<'pre' | 'post' | 'none'>('none')
  const [imageUri, setImageUri] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [inputMode, setInputMode] = useState<'photo' | 'manual'>('photo')
  const [manualName,    setManualName]    = useState('')
  const [manualCalories, setManualCalories] = useState('')
  const [manualProtein, setManualProtein] = useState('')
  const [manualCarb,    setManualCarb]    = useState('')
  const [manualFat,     setManualFat]     = useState('')
  const [manualSaving,  setManualSaving]  = useState(false)
  const [editingMeal, setEditingMeal] = useState<MealRecord | null>(null)
  const [adGateVisible,     setAdGateVisible]     = useState(false)
  const [adGateRemaining,   setAdGateRemaining]   = useState(0)
  const [adGateHardLimited, setAdGateHardLimited] = useState(false)
  const [adGateLimitType,   setAdGateLimitType]   = useState<'none'|'daily'|'monthly'|'total'|'window'>('none')
  const [ticketGateVisible, setTicketGateVisible] = useState(false)
  const [ticketGateCost,    setTicketGateCost]    = useState(0)
  const [ticketGateBalance, setTicketGateBalance] = useState(0)
  const [upsellVisible,     setUpsellVisible]     = useState(false)
  const [result, setResult] = useState<MealAnalysisResult | null>(null)
  const [shareData, setShareData] = useState<NutritionShareData | null>(null)
  const [history, setHistory] = useState<MealRecord[]>([])
  const [weights, setWeights] = useState<WeightRecord[]>([])
  const [statsViewCount, setStatsViewCount] = useState(0)
  const [recordDate, setRecordDate] = useState(todayLocalISO())
  const today = todayLocalISO()
  const { user, isGuest } = useAuth()
  const { isNoad } = usePurchase()
  const [eventCategory, setEventCategory] = useState<'sprint' | 'middle' | 'long'>('sprint')
  const router = useRouter()
  // AdGate async チェック中の二重タップ防止
  const analyzeCallRef = React.useRef(false)
  // セッション内キャッシュ（同じ画像+種別の再分析コストをゼロに）
  const mealCacheRef = React.useRef<Map<string, MealAnalysisResult>>(new Map())

  // ローカルストレージから履歴を読み込む + 残り回数取得
  useEffect(() => {
    // ユーザープロフィールからevent_categoryを読み込む
    AsyncStorage.getItem(PROFILE_KEY).then(raw => {
      if (raw) {
        try {
          const p = JSON.parse(raw)
          if (p?.event_category === 'middle' || p?.event_category === 'long') setEventCategory(p.event_category)
        } catch {}
      }
    }).catch(() => {})
    // 統計セクションの閲覧回数（無料枠を超えたらプロプラン限定表示にする）
    AsyncStorage.getItem(NUTRITION_STATS_VIEW_KEY).then(raw => {
      const count = (parseInt(raw ?? '0', 10) || 0) + 1
      setStatsViewCount(count)
      AsyncStorage.setItem(NUTRITION_STATS_VIEW_KEY, String(count)).catch(() => {})
    }).catch(() => {})
  }, [])

  // 食事履歴・体重は他画面（ホームのクイック記録など）で更新されることがあるため、
  // マウント時だけでなくタブに戻るたびに再読み込みする（stateがstaleなままになるのを防ぐ）
  useFocusEffect(useCallback(() => {
    mealsStore.get().then(setHistory).catch(() => {})
    getWeights().then(setWeights).catch(() => {})
  }, []))

  // ── 統計（直近7日間） ──────────────────────────────────────────
  const nutritionStats = useMemo(() => {
    const days: string[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      days.push(localDateStr(d))
    }
    const dayTotals = days.map(date => {
      const dayMeals = history.filter(m => m.meal_date === date)
      return {
        date,
        calories: dayMeals.reduce((s, m) => s + m.total_calories, 0),
        logged: dayMeals.length > 0,
      }
    })
    const loggedDays = dayTotals.filter(d => d.logged)
    const weekMeals = history.filter(m => days.includes(m.meal_date))
    const weekTotals = weekMeals.reduce(
      (acc, m) => ({
        calories: acc.calories + m.total_calories,
        protein: acc.protein + m.total_protein,
        carb: acc.carb + m.total_carb,
        fat: acc.fat + m.total_fat,
      }),
      { calories: 0, protein: 0, carb: 0, fat: 0 }
    )
    const avgCalories = loggedDays.length > 0 ? weekTotals.calories / loggedDays.length : 0
    const avgProtein  = loggedDays.length > 0 ? weekTotals.protein  / loggedDays.length : 0
    const avgCarb     = loggedDays.length > 0 ? weekTotals.carb     / loggedDays.length : 0
    const avgFat      = loggedDays.length > 0 ? weekTotals.fat      / loggedDays.length : 0

    // PFCバランス（カロリー換算比率。P/C=4kcal/g, F=9kcal/g）
    const pKcal = weekTotals.protein * 4
    const cKcal = weekTotals.carb * 4
    const fKcal = weekTotals.fat * 9
    const macroKcalTotal = pKcal + cKcal + fKcal
    const macroPct = macroKcalTotal > 0 ? {
      protein: Math.round(pKcal / macroKcalTotal * 100),
      carb:    Math.round(cKcal / macroKcalTotal * 100),
      fat:     Math.round(fKcal / macroKcalTotal * 100),
    } : null

    // 記録継続日数（今日から遡って記録が途切れるまで）
    let streak = 0
    for (let i = 0; i < 90; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      if (history.some(m => m.meal_date === localDateStr(d))) streak++
      else break
    }

    // 練習前後の栄養タイミング遵守率（練習前/後どちらかを記録した割合）
    const timingRate = weekMeals.length > 0
      ? Math.round(weekMeals.filter(m => m.training_timing === 'pre' || m.training_timing === 'post').length / weekMeals.length * 100)
      : null

    // 体重あたりたんぱく質（直近の体重記録があれば計算）
    const latestWeight = weights.length > 0 ? [...weights].sort((a, b) => b.date.localeCompare(a.date))[0] : null
    const proteinPerKg = latestWeight && avgProtein > 0 ? avgProtein / latestWeight.weight_kg : null

    // 栄養プランの目安（体重ベース。断定的な処方ではなく一般的な目安として提示）
    const planTargets = latestWeight ? {
      protein: latestWeight.weight_kg * 1.8,
      carb:    latestWeight.weight_kg * 6,
      fat:     latestWeight.weight_kg * 1.0,
    } : null
    const planFulfillment = planTargets && loggedDays.length > 0 ? {
      protein: Math.round(avgProtein / planTargets.protein * 100),
      carb:    Math.round(avgCarb    / planTargets.carb    * 100),
      fat:     Math.round(avgFat     / planTargets.fat     * 100),
    } : null

    return {
      dayTotals, avgCalories, avgProtein, macroPct, streak, timingRate, proteinPerKg,
      latestWeight, planTargets, planFulfillment,
      hasData: weekMeals.length > 0,
    }
  }, [history, weights])

  const todayTotals = history.filter(m => m.meal_date === today).reduce(
    (acc, m) => ({ calories: acc.calories + m.total_calories, protein: acc.protein + m.total_protein, carb: acc.carb + m.total_carb, fat: acc.fat + m.total_fat }),
    { calories: 0, protein: 0, carb: 0, fat: 0 }
  )

  const pickImage = useCallback(async (source: 'camera' | 'library') => {
    try {
      let res: ImagePicker.ImagePickerResult
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync()
        if (status !== 'granted') { Toast.show({ type: 'error', text1: t('nutrition.permission.camera') }); return }
        res = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 })
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
        if (status !== 'granted') { Toast.show({ type: 'error', text1: t('nutrition.permission.library') }); return }
        res = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, quality: 0.8, mediaTypes: 'images' })
      }
      if (!res.canceled && res.assets[0]) { setImageUri(res.assets[0].uri); setResult(null) }
    } catch { Toast.show({ type: 'error', text1: t('nutrition.permission.imageError') }) }
  }, [t])

  // リサイズ（最大640px）＋ base64 変換（Web / ネイティブ両対応）
  // 食事分析は動画分析ほどの精細さを必要としないため、AIコスト削減のため控えめなサイズに設定。
  // 2026-09-01: 800pxでも品目・分量の判別には十分すぎるサイズだったため640pxにさらに縮小
  // （動画分析側のトークン最適化に合わせた見直し。画質面で問題が出れば戻すこと）
  const imageUriToBase64 = useCallback(async (uri: string): Promise<string> => {
    if (Platform.OS === 'web') {
      // Web: Canvas でリサイズしてから base64 取得
      return new Promise((resolve, reject) => {
        const img = new (globalThis as any).Image() as HTMLImageElement
        img.onload = () => {
          const MAX = 640
          let w = img.naturalWidth || img.width
          let h = img.naturalHeight || img.height
          if (w > MAX || h > MAX) {
            if (w >= h) { h = Math.round(h * MAX / w); w = MAX }
            else        { w = Math.round(w * MAX / h); h = MAX }
          }
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) { reject(new Error('Canvas unavailable')); return }
          ctx.drawImage(img, 0, 0, w, h)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.6)
          resolve(dataUrl.split(',')[1])
        }
        img.onerror = reject
        img.src = uri
      })
    } else {
      // Native: expo-image-manipulator でリサイズしてから base64 取得
      const resized = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 640 } }],
        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG }
      )
      return FileSystem.readAsStringAsync(resized.uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
    }
  }, [])

  // skipGate=true は広告視聴経路（既にAdGateModal側で対価を払っている）専用。
  // 通常のAI分析成功時のみチケットを消費する（保存操作とは切り離し、AIコストが実際に
  // 発生した時点で確実に課金する。保存後の副作用[Sounds.save等]が失敗しても既に
  // 課金は完了しているため「保存に成功したのにチケットが消費されない」不具合を防げる）。
  const handleAnalyzeCore = useCallback(async (skipGate = false): Promise<boolean> => {
    if (!imageUri) return false
    let usesTicketThisRun = false
    if (!skipGate) {
      const gate = await checkAdGate('meal')
      if (!gate.allowed) {
        if (gate.needsTicket) { setTicketGateCost(gate.ticketCost); setTicketGateBalance(gate.ticketBalance); setTicketGateVisible(true) }
        else { setAdGateRemaining(gate.remaining); setAdGateHardLimited(gate.hardLimited); setAdGateLimitType(gate.limitType); setAdGateVisible(true) }
        return false
      }
      usesTicketThisRun = gate.needsTicket
    }
    // セッション内キャッシュチェック（同じ画像+種別なら API コールしない・新規課金もしない）
    const cacheKey = `${imageUri}__${mealType}__${timing}`
    const cached = mealCacheRef.current.get(cacheKey)
    if (cached) { setResult(cached); return true }
    setAnalyzing(true)
    try {
      const base64 = await imageUriToBase64(imageUri)
      // 実際のユーザープロフィールを使用（最低限の情報だけ渡す）
      const profile: UserProfile = {
        id: user?.id ?? 'local',
        name: '',
        primary_event: '100m',
        secondary_events: [],
        event_category: eventCategory as import('../../types').EventCategory,
        created_at: new Date().toISOString(),
      }
      const res = await analyzeMeal(base64, profile, mealType, timing, language)
      if (!res || !Array.isArray(res.foods)) throw new Error('応答形式が不正です')
      mealCacheRef.current.set(cacheKey, res)
      setResult(res)
      // 分析に成功した場合のみ利用回数・チケットを消費する（失敗時に課金しないため）
      if (!skipGate) {
        await recordUsage('meal')
        if (usesTicketThisRun) Toast.show({ type: 'info', text1: t('nutrition.ticketUsed', { n: TICKET_COST.meal }), visibilityTime: 1800 })
      }
      return true
    } catch (e) {
      Toast.show({ type: 'error', text1: t('nutrition.analyzeError'), text2: e instanceof Error ? e.message : '' })
      return false
    } finally { setAnalyzing(false) }
  }, [imageUri, mealType, timing, user, eventCategory, language, t])

  const handleAnalyze = useCallback(async () => {
    if (analyzeCallRef.current) return  // 二重タップ防止
    if (!imageUri) return
    // ゲストはログイン必須
    if (isGuest) { setAdGateRemaining(0); setAdGateHardLimited(false); setAdGateVisible(true); return }
    analyzeCallRef.current = true
    try {
      trackFeatureUse('meal')
      await handleAnalyzeCore()
    } finally {
      analyzeCallRef.current = false
    }
  }, [imageUri, handleAnalyzeCore, isGuest])

  const handleSave = useCallback(async () => {
    if (!result) return
    // チケットは分析成功時点で既に消費済み（handleAnalyzeCore）。保存はローカルへの記録のみ。
    setSaving(true)
    try {
      const newRecord: MealRecord = {
        id: Crypto.randomUUID(),
        user_id: user?.id ?? 'local',
        meal_date: recordDate,
        meal_type: mealType,
        foods: result.foods,
        total_calories: result.total_calories,
        total_protein: result.total_protein,
        total_carb: result.total_carb,
        total_fat: result.total_fat,
        training_timing: timing,
        advice: result.advice,
        created_at: new Date().toISOString(),
      }
      const updated = await mealsStore.update(current => [newRecord, ...current])
      setHistory(updated)
      setResult(null)
      setImageUri(null)
      Sounds.save()
      Toast.show({ type: 'success', text1: t('nutrition.saveSuccess') })
    } catch (e) {
      Toast.show({ type: 'error', text1: t('nutrition.saveError'), text2: e instanceof Error ? e.message : '' })
    } finally {
      setSaving(false)
    }
  }, [result, mealType, timing, today, recordDate, user, t])

  // 記録済みの食事の区分（朝食/昼食/夕食など）を変更する
  const handleChangeMealType = useCallback(async (id: string, newType: MealType) => {
    const updated = await mealsStore.update(current => current.map(m => (m.id === id ? { ...m, meal_type: newType } : m)))
    setHistory(updated)
    Toast.show({ type: 'success', text1: t('nutrition.mealTypeChanged'), visibilityTime: 1200 })
  }, [t])

  // 記録済みの食事を削除する
  const handleDeleteMeal = useCallback(async (id: string) => {
    const updated = await mealsStore.update(current => current.filter(m => m.id !== id))
    setHistory(updated)
    Toast.show({ type: 'success', text1: t('nutrition.deleted'), visibilityTime: 1200 })
  }, [t])

  // ── 手動入力の保存（写真・AI分析を使わず直接記録） ──────────────
  const handleManualSave = useCallback(async () => {
    if (!manualName.trim()) { Toast.show({ type: 'error', text1: t('nutrition.manual.nameRequired') }); return }
    const calories = parseFloat(manualCalories) || 0
    if (calories <= 0) { Toast.show({ type: 'error', text1: t('nutrition.manual.caloriesRequired') }); return }
    // ゲストはログイン必須
    if (isGuest) { setAdGateRemaining(0); setAdGateHardLimited(false); setAdGateVisible(true); return }
    // 手動入力はAIを使わないためチケット不要（無料）
    setManualSaving(true)
    try {
      const protein = parseFloat(manualProtein) || 0
      const carb    = parseFloat(manualCarb)    || 0
      const fat     = parseFloat(manualFat)     || 0
      const newRecord: MealRecord = {
        id: Crypto.randomUUID(),
        user_id: user?.id ?? 'local',
        meal_date: recordDate,
        meal_type: mealType,
        foods: [{ name: manualName.trim(), calories, protein, carb, fat, confidence: 1 }],
        total_calories: calories,
        total_protein: protein,
        total_carb: carb,
        total_fat: fat,
        training_timing: timing,
        created_at: new Date().toISOString(),
      }
      const updated = await mealsStore.update(current => [newRecord, ...current])
      setHistory(updated)
      setManualName(''); setManualCalories(''); setManualProtein(''); setManualCarb(''); setManualFat('')
      Sounds.save()
      Toast.show({ type: 'success', text1: t('nutrition.saveSuccess') })
    } catch (e) {
      Toast.show({ type: 'error', text1: t('nutrition.saveError'), text2: e instanceof Error ? e.message : '' })
    } finally {
      setManualSaving(false)
    }
  }, [manualName, manualCalories, manualProtein, manualCarb, manualFat, mealType, timing, recordDate, user, t])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        <View style={styles.header}>
          <Text style={styles.title}>{t('nutrition.title')}</Text>
          <Text style={styles.date}>{today}</Text>
        </View>

        {/* 栄養プランの目安（体重ベース） */}
        <AnimatedSection delay={0} type="scale">
          <NutritionPlanCard stats={nutritionStats} onGoLogWeight={() => router.push('/(tabs)/records')} />
        </AnimatedSection>

        {/* 今日の合計 */}
        <AnimatedSection delay={20} type="scale">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('nutrition.todayTotal')}</Text>
          <MacroRow {...todayTotals} />
        </View>
        </AnimatedSection>

        {/* AI食事コーチ 導線 */}
        <AnimatedSection delay={40} type="fade-up">
        <TouchableOpacity
          style={styles.coachEntryBtn}
          onPress={() => router.push('/meal-coach')}
          activeOpacity={0.85}
        >
          <View style={styles.coachEntryIcon}>
            <Ionicons name="restaurant-outline" size={20} color={BRAND} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.coachEntryTitle}>{t('nutrition.coach.title')}</Text>
              <View style={styles.coachEntryBadge}><Text style={styles.coachEntryBadgeText}>PRO</Text></View>
            </View>
            <Text style={styles.coachEntrySub}>{t('nutrition.coach.sub')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textHint} />
        </TouchableOpacity>
        </AnimatedSection>

        {/* 食事タイプ・タイミング */}
        <AnimatedSection delay={80} type="fade-up">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('nutrition.mealTypeCard')}</Text>
          <DateSelector date={recordDate} onChange={d => { setRecordDate(d); setResult(null); setImageUri(null) }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {MEAL_TYPES.map(mt => (
              <HapticTouch key={mt.value} haptic="toggleOn" style={[styles.chip, mealType === mt.value && styles.chipActive]} onPress={() => setMealType(mt.value)} activeOpacity={0.7}>
                <Ionicons name={mt.icon} size={18} color={mealType === mt.value ? '#fff' : colors.textSec} />
                <Text style={[styles.chipText, mealType === mt.value && styles.chipTextActive]}>{t(`nutrition.mealTypes.${mt.value}`)}</Text>
              </HapticTouch>
            ))}
          </ScrollView>
          <View style={styles.timingRow}>
            {TIMINGS.map(tm => (
              <HapticTouch key={tm.value} haptic="toggleOn" style={[styles.timingBtn, timing === tm.value && styles.timingBtnActive]} onPress={() => setTiming(tm.value)} activeOpacity={0.7}>
                <Text style={[styles.timingText, timing === tm.value && styles.timingTextActive]}>{t(`nutrition.timings.${tm.value}`)}</Text>
              </HapticTouch>
            ))}
          </View>
        </View>
        </AnimatedSection>

        {/* 写真選択・分析 / 手動入力 */}
        <AnimatedSection delay={160} type="fade-up">
        <View style={styles.card}>
          <View style={styles.modeTabRow}>
            <HapticTouch haptic="toggleOn" style={[styles.modeTab, inputMode === 'photo' && styles.modeTabActive]} onPress={() => setInputMode('photo')} activeOpacity={0.7}>
              <Ionicons name="camera-outline" size={16} color={inputMode === 'photo' ? '#fff' : colors.textSec} />
              <Text style={[styles.modeTabText, inputMode === 'photo' && styles.modeTabTextActive]}>{t('nutrition.inputMode.photo')}</Text>
            </HapticTouch>
            <HapticTouch haptic="toggleOn" style={[styles.modeTab, inputMode === 'manual' && styles.modeTabActive]} onPress={() => setInputMode('manual')} activeOpacity={0.7}>
              <Ionicons name="create-outline" size={16} color={inputMode === 'manual' ? '#fff' : colors.textSec} />
              <Text style={[styles.modeTabText, inputMode === 'manual' && styles.modeTabTextActive]}>{t('nutrition.inputMode.manual')}</Text>
            </HapticTouch>
          </View>

          {inputMode === 'photo' ? (
            <>
              {imageUri ? (
                <View style={styles.imageBox}>
                  <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
                  <TouchableOpacity
                    style={styles.imageClose}
                    onPress={() => setImageUri(null)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={t('nutrition.removeImage')}
                  >
                    <Ionicons name="close-circle" size={30} color="rgba(255,255,255,0.9)" />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.pickRow}>
                  <HapticTouch haptic="tap" style={styles.pickBtn} onPress={() => pickImage('camera')} activeOpacity={0.8}>
                    <Ionicons name="camera" size={22} color="#fff" />
                    <Text style={styles.pickBtnText}>{t('nutrition.photoBtn')}</Text>
                  </HapticTouch>
                  <HapticTouch haptic="tap" style={[styles.pickBtn, styles.pickBtnSub]} onPress={() => pickImage('library')} activeOpacity={0.8}>
                    <Ionicons name="images" size={22} color={colors.text} />
                    <Text style={[styles.pickBtnText, {color: colors.text}]}>{t('nutrition.libraryBtn')}</Text>
                  </HapticTouch>
                </View>
              )}
              {imageUri && !result && (
                <>
                  <View style={styles.ticketCostBadge}>
                    <Text style={styles.ticketCostBadgeText}>{t('nutrition.ticketCost', { n: TICKET_COST.meal })}</Text>
                  </View>
                  <HapticTouch haptic="whoosh" style={[styles.analyzeBtn, analyzing && { opacity: 0.6 }]} onPress={handleAnalyze} disabled={analyzing} activeOpacity={0.85}>
                    <Ionicons name="sparkles" size={20} color="#fff" />
                    <Text style={styles.analyzeBtnText}>{analyzing ? t('nutrition.analyze.analyzing') : t('nutrition.analyze.button')}</Text>
                  </HapticTouch>
                </>
              )}
            </>
          ) : (
            <View style={{ gap: 10 }}>
              <TextInput
                style={styles.manualInput}
                placeholder={t('nutrition.manual.namePlaceholder')}
                placeholderTextColor={colors.textHint}
                value={manualName}
                onChangeText={setManualName}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[styles.manualInput, { flex: 1 }]}
                  placeholder={t('nutrition.manual.caloriesPlaceholder')}
                  placeholderTextColor={colors.textHint}
                  keyboardType="numeric"
                  value={manualCalories}
                  onChangeText={setManualCalories}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[styles.manualInput, { flex: 1 }]}
                  placeholder={t('nutrition.manual.proteinPlaceholder')}
                  placeholderTextColor={colors.textHint}
                  keyboardType="numeric"
                  value={manualProtein}
                  onChangeText={setManualProtein}
                />
                <TextInput
                  style={[styles.manualInput, { flex: 1 }]}
                  placeholder={t('nutrition.manual.carbPlaceholder')}
                  placeholderTextColor={colors.textHint}
                  keyboardType="numeric"
                  value={manualCarb}
                  onChangeText={setManualCarb}
                />
                <TextInput
                  style={[styles.manualInput, { flex: 1 }]}
                  placeholder={t('nutrition.manual.fatPlaceholder')}
                  placeholderTextColor={colors.textHint}
                  keyboardType="numeric"
                  value={manualFat}
                  onChangeText={setManualFat}
                />
              </View>
              <HapticTouch haptic="save" style={[styles.saveBtn, manualSaving && { opacity: 0.5 }]} onPress={handleManualSave} disabled={manualSaving} activeOpacity={0.85}>
                <Ionicons name="save" size={18} color="#fff" />
                <Text style={styles.saveBtnText}>{manualSaving ? t('nutrition.saving') : t('nutrition.save')}</Text>
              </HapticTouch>
            </View>
          )}
        </View>
        </AnimatedSection>

        {/* スケルトン */}
        {analyzing && (
          <View style={[styles.card, { gap: 10 }]}>
            <SkeletonRect height={18} width="50%" />
            <SkeletonRect height={60} />
            <SkeletonRect height={14} />
            <SkeletonRect height={14} width="80%" />
          </View>
        )}

        {/* 分析結果 */}
        {result && (
          <AnimatedSection delay={0} type="scale">
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.cardTitle}>{t('nutrition.analysisResult')}</Text>
              <TouchableOpacity
                onPress={() => {
                  const dt = new Date(recordDate + 'T00:00:00')
                  const dateLabel = language === 'en'
                    ? dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' })
                    : (() => { const weekdays = ['日', '月', '火', '水', '木', '金', '土']; return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日（${weekdays[dt.getDay()]}）` })()
                  setShareData({
                    date: dateLabel,
                    mealType: t(`nutrition.mealTypes.${mealType}`),
                    totalCalories: result.total_calories,
                    protein: result.total_protein,
                    carb: result.total_carb,
                    fat: result.total_fat,
                    foods: result.foods.map(f => f.name),
                    advice: result.advice,
                  })
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="share-outline" size={20} color={BRAND} />
              </TouchableOpacity>
            </View>
            {result.foods.map((f, i) => (
              <View key={i} style={styles.foodRow}>
                <Text style={styles.foodName}>{f.name}</Text>
                <View style={styles.foodMacros}>
                  <Text style={[styles.foodMacro, { color: BRAND }]}>{Math.round(f.calories)}kcal</Text>
                  <Text style={styles.foodMacro}>P:{Math.round(f.protein)}g</Text>
                  <Text style={styles.foodMacro}>C:{Math.round(f.carb)}g</Text>
                  <Text style={styles.foodMacro}>F:{Math.round(f.fat)}g</Text>
                </View>
              </View>
            ))}
            <View style={styles.divider} />
            <MacroRow calories={result.total_calories} protein={result.total_protein} carb={result.total_carb} fat={result.total_fat} />
            <AIFeedbackCard feedback={result.advice} title={t('nutrition.nutritionAdvice')} />
            {result.hydration_reminder && (
              <View style={[styles.hydration, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                <Ionicons name="water-outline" size={14} color={NEON.cyan} />
                <Text style={styles.hydrationText}>{result.hydration_reminder}</Text>
              </View>
            )}
            <HapticTouch haptic="save" style={[styles.saveBtn, saving && { opacity: 0.5 }]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
              <Ionicons name="save" size={18} color="#fff" />
              <Text style={styles.saveBtnText}>{saving ? t('nutrition.saving') : t('nutrition.save')}</Text>
            </HapticTouch>
            <TouchableOpacity onPress={() => { setResult(null); setImageUri(null) }} style={{ alignSelf: 'center', padding: 8 }}>
              <Text style={{ color: colors.textSec, fontSize: 13 }}>{t('nutrition.clear')}</Text>
            </TouchableOpacity>
          </View>
          </AnimatedSection>
        )}

        {/* 選択日の記録一覧 */}
        <AnimatedSection delay={240} type="fade-up">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('nutrition.mealRecords', { label: recordDate === today ? t('nutrition.recordsFor.today') : recordDate })}</Text>
          {history.filter(m => m.meal_date === recordDate).length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="restaurant-outline" size={32} color={colors.textHint} />
              <Text style={styles.emptyText}>{t('nutrition.noRecords')}</Text>
            </View>
          ) : (
            history.filter(m => m.meal_date === recordDate).map(m => <MealHistoryCard key={m.id} meal={m} onPress={() => setEditingMeal(m)} />)
          )}
        </View>
        </AnimatedSection>

        {/* 統計（直近7日間） */}
        <AnimatedSection delay={260} type="fade-up">
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="stats-chart-outline" size={15} color={colors.text} />
            <Text style={styles.cardTitle}>{t('nutrition.weeklyStats')}</Text>
          </View>
          {!isNoad && statsViewCount > NUTRITION_STATS_FREE_VIEWS ? (
            <View style={{ minHeight: 240, borderRadius: 14, overflow: 'hidden' }}>
              <View pointerEvents="none">
                <NutritionStatsSection stats={nutritionStats} />
              </View>
              <BlurView intensity={32} tint="light" style={StyleSheet.absoluteFill} />
              <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 20 }]}>
                <Ionicons name="lock-closed" size={24} color={colors.textSec} />
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 8, textAlign: 'center' }}>
                  {t('nutrition.proPlanOnly')}
                </Text>
                <Text style={{ color: colors.textSec, fontSize: 12, marginTop: 4, textAlign: 'center' }}>
                  {t('nutrition.proPlanHint', { n: NUTRITION_STATS_FREE_VIEWS })}
                </Text>
                <TouchableOpacity
                  onPress={() => router.push('/paywall')}
                  style={{ marginTop: 12, backgroundColor: BRAND, borderRadius: 50, paddingHorizontal: 20, paddingVertical: 10 }}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>{t('nutrition.seeProPlan')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <NutritionStatsSection stats={nutritionStats} />
          )}
        </View>
        </AnimatedSection>

        {/* 過去の記録一覧（全日付） */}
        {history.length > 0 && (
          <AnimatedSection delay={280} type="fade-up">
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('nutrition.allRecords')}</Text>
            {[...history]
              .sort((a, b) => (a.meal_date === b.meal_date
                ? b.created_at.localeCompare(a.created_at)
                : b.meal_date.localeCompare(a.meal_date)))
              .slice(0, 30)
              .map(m => <MealHistoryCard key={m.id} meal={m} showDate onPress={() => setEditingMeal(m)} />)}
          </View>
          </AnimatedSection>
        )}
      </ScrollView>
    </SafeAreaView>

    {/* ── 食事編集モーダル（区分変更・削除） ── */}
    <MealEditModal
      meal={editingMeal}
      onClose={() => setEditingMeal(null)}
      onChangeMealType={handleChangeMealType}
      onDelete={handleDeleteMeal}
    />

    {/* ── 広告ゲートモーダル ── */}
    <AdGateModal
      visible={adGateVisible}
      feature="meal"
      remaining={adGateRemaining}
      hardLimited={adGateHardLimited}
      limitType={adGateLimitType}
      isGuest={isGuest}
      onClose={() => setAdGateVisible(false)}
      onAdWatched={async () => {
        setAdGateVisible(false)
        trackFeatureUse('meal')
        // 広告視聴分は対価を払い済みのため、ゲートチェック・チケット消費をスキップする
        const ok = await handleAnalyzeCore(true)
        // 広告視聴後の分析が完了したら、広告なしプランへのアップセルを提示
        if (ok) setUpsellVisible(true)
      }}
      onUpgrade={() => { setAdGateVisible(false); router.push('/paywall') }}
    />

    <TicketGateModal
      visible={ticketGateVisible}
      feature="meal"
      ticketCost={ticketGateCost}
      ticketBalance={ticketGateBalance}
      onClose={() => setTicketGateVisible(false)}
    />

    <Modal visible={!!shareData} transparent animationType="fade" onRequestClose={() => setShareData(null)}>
      {shareData ? (
        <NutritionShareCard data={shareData} onClose={() => setShareData(null)} />
      ) : null}
    </Modal>

    {/* ── 分析結果後アップセルシート（広告視聴で分析した直後に表示） ── */}
    <Modal visible={upsellVisible} transparent animationType="slide" onRequestClose={() => setUpsellVisible(false)}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={() => setUpsellVisible(false)}>
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          <Pressable onPress={() => {}}>
            <View style={{ backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 16 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 4 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="star" size={24} color="#16a34a" />
                <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>{t('nutrition.upsell.title')}</Text>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 20 }}>
                {t('nutrition.upsell.body')}
              </Text>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 14, gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{t('nutrition.upsell.freePlan')}</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{t('nutrition.upsell.freePlanNote')}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ backgroundColor: '#166534', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{t('nutrition.upsell.noAdPlan')}</Text>
                    </View>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{t('nutrition.upsell.noAdPrice')}</Text>
                  </View>
                  <Text style={{ color: '#4ade80', fontSize: 12, fontWeight: '700' }}>{t('nutrition.upsell.noAdNote')}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={{ backgroundColor: '#166534', borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}
                onPress={() => { setUpsellVisible(false); router.push('/paywall?plan=noad' as any) }}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{t('nutrition.upsell.cta')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 4 }} onPress={() => setUpsellVisible(false)} activeOpacity={0.7}>
                <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>{t('nutrition.upsell.notNow')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
    </View>
  )
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  date: { color: colors.textSec, fontSize: 13 },
  card: { backgroundColor: colors.card, borderRadius: 21, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  coachEntryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(22,101,52,0.06)', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(22,101,52,0.25)',
    padding: 16,
  },
  coachEntryIcon: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(22,101,52,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  coachEntryTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  coachEntryBadge: { backgroundColor: BRAND, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  coachEntryBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  coachEntrySub: { color: colors.textSec, fontSize: 12, marginTop: 2 },
  macroRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  macroMain: { alignItems: 'center' },
  macroKcal: { color: BRAND, fontSize: 34, fontWeight: '800', lineHeight: 38, fontVariant: ['tabular-nums'] },
  macroKcalLabel: { color: colors.textSec, fontSize: 12 },
  macroItem: { flex: 1, alignItems: 'center', gap: 2 },
  macroValue: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  macroLabel: { color: colors.textSec, fontSize: 11 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.surface2, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.border, gap: 4, minWidth: 60 },
  chipActive: { backgroundColor: BRAND, borderColor: BRAND },
  chipIcon: { fontSize: 18 },
  chipText: { color: colors.textSec, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },
  editModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  editModalSheet: {
    backgroundColor: colors.card, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 20, paddingBottom: 36, gap: 14,
  },
  editModalTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  editModalLabel: { fontSize: 12, fontWeight: '700', color: colors.textSec },
  editModalChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  editModalDeleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: 14, marginTop: 4,
    backgroundColor: 'rgba(255,59,48,0.08)', borderWidth: 1, borderColor: 'rgba(255,59,48,0.25)',
  },
  editModalDeleteText: { color: '#FF3B30', fontSize: 14, fontWeight: '700' },
  editModalCloseBtn: { alignItems: 'center', paddingVertical: 10 },
  editModalCloseText: { color: colors.textSec, fontSize: 13, fontWeight: '600' },
  timingRow: { flexDirection: 'row', gap: 8 },
  timingBtn: { flex: 1, paddingVertical: 8, backgroundColor: colors.surface2, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  timingBtnActive: { backgroundColor: `${BRAND}10`, borderColor: BRAND },
  timingText: { color: colors.textSec, fontSize: 13, fontWeight: '600' },
  timingTextActive: { color: BRAND },
  imageBox: { height: 200, borderRadius: 14, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  imageClose: { position: 'absolute', top: 8, right: 8 },
  pickRow: { flexDirection: 'row', gap: 10 },
  pickBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 21, paddingVertical: 16 },
  pickBtnSub: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, color: colors.text },
  pickBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  analyzeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 21, paddingVertical: 16 },
  analyzeBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  foodRow: { gap: 4, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  foodName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  foodMacros: { flexDirection: 'row', gap: 8 },
  foodMacro: { color: colors.textSec, fontSize: 12 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  hydration: { backgroundColor: 'rgba(6,182,212,0.08)', borderRadius: 14, padding: 10, borderWidth: 1, borderColor: 'rgba(6,182,212,0.25)' },
  hydrationText: { color: NEON.cyan, fontSize: 13 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 21, paddingVertical: 16 },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  ticketCostBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, marginBottom: 8, backgroundColor: 'rgba(22,101,52,0.10)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(22,101,52,0.3)' },
  ticketCostBadgeText: { fontSize: 11, fontWeight: '700', color: BRAND },
  historyCard: { backgroundColor: colors.surface2, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 5 },
  historyCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  historyIcon: { fontSize: 16 },
  historyType: { color: colors.text, fontSize: 14, fontWeight: '700', flex: 1 },
  historyDate: { color: colors.textHint, fontSize: 11, fontWeight: '600' },
  kcalBadge: { backgroundColor: `${BRAND}22`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  kcalBadgeText: { color: BRAND, fontSize: 12, fontWeight: '600' },
  historyFood: { color: colors.textSec, fontSize: 13 },
  historyFoodMacro: { color: colors.textSec, fontSize: 12 },
  historyMore: { color: colors.textHint, fontSize: 12 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  emptyText: { color: colors.textSec, fontSize: 14 },
  modeTabRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  modeTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, backgroundColor: colors.surface2, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  modeTabActive: { backgroundColor: BRAND, borderColor: BRAND },
  modeTabText: { color: colors.textSec, fontSize: 13, fontWeight: '700' },
  modeTabTextActive: { color: '#FFFFFF' },
  manualInput: { backgroundColor: colors.surface2, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: colors.text },
})

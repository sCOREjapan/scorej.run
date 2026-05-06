import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Animated, Image, Platform,
} from 'react-native'
import { checkAdGate, recordUsage, grantRewardUse } from '../../lib/adGate'
import AdGateModal from '../../components/AdGateModal'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { Ionicons } from '@expo/vector-icons'
import Toast from 'react-native-toast-message'
import * as FileSystem from 'expo-file-system/legacy'
import * as ImageManipulator from 'expo-image-manipulator'
import AsyncStorage from '@react-native-async-storage/async-storage'
import DateSelector from '../../components/DateSelector'
import { analyzeMeal } from '../../lib/claude'
import AIFeedbackCard from '../../components/AIFeedbackCard'
import GlassCard from '../../components/GlassCard'
import PressableScale from '../../components/PressableScale'
import { BRAND, NEON, TEXT, GLASS } from '../../lib/theme'
import { Sounds, unlockAudio } from '../../lib/sounds'
import AnimatedSection from '../../components/AnimatedSection'
import type { MealType, MealRecord, MealAnalysisResult, UserProfile } from '../../types'

const STORAGE_KEY = 'trackmate_meals'

const MOCK_USER: UserProfile = {
  id: 'mock-user-1', name: '田中 太郎', primary_event: '400m',
  secondary_events: ['200m'], event_category: 'sprint',
  personal_best_ms: 47800, target_time_ms: 47000,
  age: 20, experience_years: 5, created_at: new Date().toISOString(),
}

const MEAL_TYPES: { value: MealType; label: string; icon: string }[] = [
  { value: 'breakfast', label: '朝食',  icon: '🌅' },
  { value: 'lunch',     label: '昼食',  icon: '☀️' },
  { value: 'dinner',    label: '夕食',  icon: '🌙' },
  { value: 'snack',     label: '間食',  icon: '🍎' },
  { value: 'supplement',label: 'サプリ',icon: '💊' },
]
const TIMINGS: { value: 'pre' | 'post' | 'none'; label: string }[] = [
  { value: 'none', label: 'なし' },
  { value: 'pre',  label: '練習前' },
  { value: 'post', label: '練習後' },
]

// ─── Skeleton ──────────────────────────────────────────────────────────
function SkeletonRect({ height = 16, width = '100%' as string | number }) {
  const opacity = useRef(new Animated.Value(0.3)).current
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
    ]))
    a.start(); return () => a.stop()
  }, [opacity])
  return <Animated.View style={{ height, width: width as number, borderRadius: 8, backgroundColor: '#e8eaed', opacity }} />
}

// ─── 栄養素サマリー ─────────────────────────────────────────────────────
function MacroRow({ calories, protein, carb, fat }: { calories: number; protein: number; carb: number; fat: number }) {
  return (
    <View style={styles.macroRow}>
      <View style={styles.macroMain}>
        <Text style={styles.macroKcal}>{Math.round(calories)}</Text>
        <Text style={styles.macroKcalLabel}>kcal</Text>
      </View>
      {[
        { label: 'P', value: protein, color: BRAND },
        { label: 'C', value: carb,    color: '#5AC8FA' },
        { label: 'F', value: fat,     color: '#FF9500' },
      ].map(m => (
        <View key={m.label} style={styles.macroItem}>
          <Text style={[styles.macroValue, { color: m.color }]}>{Math.round(m.value)}g</Text>
          <Text style={styles.macroLabel}>{m.label}</Text>
        </View>
      ))}
    </View>
  )
}

// ─── 食事履歴カード ─────────────────────────────────────────────────────
function MealHistoryCard({ meal }: { meal: MealRecord }) {
  const type = MEAL_TYPES.find(t => t.value === meal.meal_type)
  return (
    <View style={styles.historyCard}>
      <View style={styles.historyCardHeader}>
        <Text style={styles.historyIcon}>{type?.icon ?? '🍽️'}</Text>
        <Text style={styles.historyType}>{type?.label ?? meal.meal_type}</Text>
        <View style={styles.kcalBadge}>
          <Text style={styles.kcalBadgeText}>{Math.round(meal.total_calories)} kcal</Text>
        </View>
      </View>
      {meal.foods.slice(0, 3).map((f, i) => (
        <Text key={i} style={styles.historyFood}>
          · {f.name}{'  '}
          <Text style={styles.historyFoodMacro}>({Math.round(f.calories)}kcal / P:{Math.round(f.protein)}g)</Text>
        </Text>
      ))}
      {meal.foods.length > 3 && <Text style={styles.historyMore}>+{meal.foods.length - 3}品</Text>}
    </View>
  )
}

// ─── メイン ────────────────────────────────────────────────────────────
export default function NutritionScreen() {
  const [mealType, setMealType] = useState<MealType>('lunch')
  const [timing, setTiming] = useState<'pre' | 'post' | 'none'>('none')
  const [imageUri, setImageUri] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [adGateVisible,     setAdGateVisible]     = useState(false)
  const [adGateHardLimited, setAdGateHardLimited] = useState(false)
  const [result, setResult] = useState<MealAnalysisResult | null>(null)
  const [history, setHistory] = useState<MealRecord[]>([])
  const [recordDate, setRecordDate] = useState(new Date().toISOString().slice(0, 10))
  const today = new Date().toISOString().slice(0, 10)

  // ローカルストレージから履歴を読み込む
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        try { setHistory(JSON.parse(raw)) } catch { /* ignore */ }
      }
    })
  }, [])

  const todayTotals = history.filter(m => m.meal_date === today).reduce(
    (acc, m) => ({ calories: acc.calories + m.total_calories, protein: acc.protein + m.total_protein, carb: acc.carb + m.total_carb, fat: acc.fat + m.total_fat }),
    { calories: 0, protein: 0, carb: 0, fat: 0 }
  )

  const pickImage = useCallback(async (source: 'camera' | 'library') => {
    try {
      let res: ImagePicker.ImagePickerResult
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync()
        if (status !== 'granted') { Toast.show({ type: 'error', text1: 'カメラの許可が必要です' }); return }
        res = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 })
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
        if (status !== 'granted') { Toast.show({ type: 'error', text1: 'ライブラリの許可が必要です' }); return }
        res = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, quality: 0.8, mediaTypes: 'images' })
      }
      if (!res.canceled && res.assets[0]) { setImageUri(res.assets[0].uri); setResult(null) }
    } catch { Toast.show({ type: 'error', text1: '画像の取得に失敗しました' }) }
  }, [])

  // リサイズ（最大1024px）＋ base64 変換（Web / ネイティブ両対応）
  const imageUriToBase64 = useCallback(async (uri: string): Promise<string> => {
    if (Platform.OS === 'web') {
      // Web: Canvas でリサイズしてから base64 取得
      return new Promise((resolve, reject) => {
        const img = new (globalThis as any).Image() as HTMLImageElement
        img.onload = () => {
          const MAX = 1024
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
          const dataUrl = canvas.toDataURL('image/jpeg', 0.75)
          resolve(dataUrl.split(',')[1])
        }
        img.onerror = reject
        img.src = uri
      })
    } else {
      // Native: expo-image-manipulator でリサイズしてから base64 取得
      const resized = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
      )
      return FileSystem.readAsStringAsync(resized.uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
    }
  }, [])

  const handleAnalyzeCore = useCallback(async () => {
    if (!imageUri) return
    setAnalyzing(true)
    try {
      const base64 = await imageUriToBase64(imageUri)
      const res = await analyzeMeal(base64, MOCK_USER, mealType, timing)
      if (!res || !Array.isArray(res.foods)) throw new Error('応答形式が不正です')
      setResult(res)
    } catch (e) {
      Toast.show({ type: 'error', text1: 'AI分析に失敗しました', text2: e instanceof Error ? e.message : '' })
    } finally { setAnalyzing(false) }
  }, [imageUri, mealType, timing])

  const handleAnalyze = useCallback(async () => {
    if (!imageUri) return
    const gate = await checkAdGate('meal')
    if (gate.hardLimited || gate.needsAd) {
      setAdGateHardLimited(gate.hardLimited)
      setAdGateVisible(true)
      return
    }
    await recordUsage('meal')
    await handleAnalyzeCore()
  }, [imageUri, handleAnalyzeCore])

  const handleSave = useCallback(async () => {
    if (!result) return
    setSaving(true)
    try {
      const newRecord: MealRecord = {
        id: `local_${Date.now()}`,
        user_id: MOCK_USER.id,
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
      const updated = [newRecord, ...history]
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      setHistory(updated)
      setResult(null)
      setImageUri(null)
      Sounds.save()
      Toast.show({ type: 'success', text1: '✅ 食事を保存しました' })
    } catch (e) {
      Toast.show({ type: 'error', text1: '保存に失敗しました', text2: e instanceof Error ? e.message : '' })
    } finally {
      setSaving(false)
    }
  }, [result, mealType, timing, today, history])

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        <View style={styles.header}>
          <Text style={styles.title}>食事管理</Text>
          <Text style={styles.date}>{today}</Text>
        </View>

        {/* 今日の合計 */}
        <AnimatedSection delay={0} type="scale">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>今日の合計</Text>
          <MacroRow {...todayTotals} />
        </View>
        </AnimatedSection>

        {/* 食事タイプ・タイミング */}
        <AnimatedSection delay={80} type="fade-up">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>食事タイプ</Text>
          <DateSelector date={recordDate} onChange={d => { setRecordDate(d); setResult(null); setImageUri(null) }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {MEAL_TYPES.map(t => (
              <TouchableOpacity key={t.value} style={[styles.chip, mealType === t.value && styles.chipActive]} onPress={() => setMealType(t.value)} activeOpacity={0.7}>
                <Text style={styles.chipIcon}>{t.icon}</Text>
                <Text style={[styles.chipText, mealType === t.value && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.timingRow}>
            {TIMINGS.map(t => (
              <TouchableOpacity key={t.value} style={[styles.timingBtn, timing === t.value && styles.timingBtnActive]} onPress={() => setTiming(t.value)} activeOpacity={0.7}>
                <Text style={[styles.timingText, timing === t.value && styles.timingTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        </AnimatedSection>

        {/* 写真選択・分析 */}
        <AnimatedSection delay={160} type="fade-up">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>食事写真</Text>
          {imageUri ? (
            <View style={styles.imageBox}>
              <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
              <TouchableOpacity style={styles.imageClose} onPress={() => setImageUri(null)}>
                <Ionicons name="close-circle" size={30} color="rgba(255,255,255,0.9)" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.pickRow}>
              <TouchableOpacity style={styles.pickBtn} onPress={() => pickImage('camera')} activeOpacity={0.8}>
                <Ionicons name="camera" size={22} color="#fff" />
                <Text style={styles.pickBtnText}>撮影する</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.pickBtn, styles.pickBtnSub]} onPress={() => pickImage('library')} activeOpacity={0.8}>
                <Ionicons name="images" size={22} color="#374151" />
                <Text style={[styles.pickBtnText, {color:'#374151'}]}>ライブラリ</Text>
              </TouchableOpacity>
            </View>
          )}
          {imageUri && !result && (
            <TouchableOpacity style={[styles.analyzeBtn, analyzing && { opacity: 0.6 }]} onPress={handleAnalyze} disabled={analyzing} activeOpacity={0.85}>
              <Ionicons name="sparkles" size={20} color="#fff" />
              <Text style={styles.analyzeBtnText}>{analyzing ? '分析中...' : '分析する'}</Text>
            </TouchableOpacity>
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
            <Text style={styles.cardTitle}>分析結果</Text>
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
            <AIFeedbackCard feedback={result.advice} title="栄養アドバイス" />
            {result.hydration_reminder && (
              <View style={styles.hydration}>
                <Text style={styles.hydrationText}>💧 {result.hydration_reminder}</Text>
              </View>
            )}
            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.5 }]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
              <Ionicons name="save" size={18} color="#fff" />
              <Text style={styles.saveBtnText}>{saving ? '保存中...' : '保存する'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setResult(null); setImageUri(null) }} style={{ alignSelf: 'center', padding: 8 }}>
              <Text style={{ color: TEXT.secondary, fontSize: 13 }}>クリア</Text>
            </TouchableOpacity>
          </View>
          </AnimatedSection>
        )}

        {/* 選択日の記録一覧 */}
        <AnimatedSection delay={240} type="fade-up">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{recordDate === today ? '今日' : recordDate}の食事記録</Text>
          {history.filter(m => m.meal_date === recordDate).length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="restaurant-outline" size={32} color={TEXT.hint} />
              <Text style={styles.emptyText}>まだ記録がありません</Text>
            </View>
          ) : (
            history.filter(m => m.meal_date === recordDate).map(m => <MealHistoryCard key={m.id} meal={m} />)
          )}
        </View>
        </AnimatedSection>
      </ScrollView>
    </SafeAreaView>

    {/* ── 広告ゲートモーダル ── */}
    <AdGateModal
      visible={adGateVisible}
      feature="meal"
      hardLimited={adGateHardLimited}
      onClose={() => setAdGateVisible(false)}
      onAdWatched={async () => {
        setAdGateVisible(false)
        await grantRewardUse('meal')
        await recordUsage('meal')
        await handleAnalyzeCore()
      }}
      onUpgrade={() => {
        setAdGateVisible(false)
        // TODO: プレミアム画面へのナビゲーションを追加
      }}
    />
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { color: TEXT.primary, fontSize: 24, fontWeight: '700' },
  date: { color: TEXT.secondary, fontSize: 13 },
  card: { backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  cardTitle: { color: TEXT.primary, fontSize: 15, fontWeight: '700' },
  macroRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  macroMain: { alignItems: 'center' },
  macroKcal: { color: BRAND, fontSize: 34, fontWeight: '800', lineHeight: 38 },
  macroKcalLabel: { color: TEXT.secondary, fontSize: 12 },
  macroItem: { flex: 1, alignItems: 'center', gap: 2 },
  macroValue: { fontSize: 18, fontWeight: '700' },
  macroLabel: { color: TEXT.secondary, fontSize: 11 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#f0f2f5', borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', gap: 4, minWidth: 60 },
  chipActive: { backgroundColor: BRAND, borderColor: BRAND },
  chipIcon: { fontSize: 18 },
  chipText: { color: TEXT.secondary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },
  timingRow: { flexDirection: 'row', gap: 8 },
  timingBtn: { flex: 1, paddingVertical: 8, backgroundColor: '#f0f2f5', borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  timingBtnActive: { backgroundColor: `${BRAND}10`, borderColor: BRAND },
  timingText: { color: TEXT.secondary, fontSize: 13, fontWeight: '600' },
  timingTextActive: { color: BRAND },
  imageBox: { height: 200, borderRadius: 10, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  imageClose: { position: 'absolute', top: 8, right: 8 },
  pickRow: { flexDirection: 'row', gap: 10 },
  pickBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 12, paddingVertical: 16 },
  pickBtnSub: { backgroundColor: '#f0f2f5', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', color: '#374151' },
  pickBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  analyzeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 12, paddingVertical: 16 },
  analyzeBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  foodRow: { gap: 4, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.07)' },
  foodName: { color: TEXT.primary, fontSize: 14, fontWeight: '600' },
  foodMacros: { flexDirection: 'row', gap: 8 },
  foodMacro: { color: TEXT.secondary, fontSize: 12 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(0,0,0,0.07)' },
  hydration: { backgroundColor: 'rgba(6,182,212,0.08)', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: 'rgba(6,182,212,0.25)' },
  hydrationText: { color: NEON.cyan, fontSize: 13 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 12, paddingVertical: 16 },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  historyCard: { backgroundColor: '#f8f8fa', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', padding: 12, gap: 5 },
  historyCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  historyIcon: { fontSize: 16 },
  historyType: { color: TEXT.primary, fontSize: 14, fontWeight: '700', flex: 1 },
  kcalBadge: { backgroundColor: `${BRAND}22`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  kcalBadgeText: { color: BRAND, fontSize: 12, fontWeight: '600' },
  historyFood: { color: TEXT.secondary, fontSize: 13 },
  historyFoodMacro: { color: TEXT.hint, fontSize: 12 },
  historyMore: { color: TEXT.hint, fontSize: 12 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  emptyText: { color: TEXT.secondary, fontSize: 14 },
})

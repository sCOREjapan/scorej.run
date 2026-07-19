import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Animated, Image, Platform, TextInput, Modal, Pressable,
} from 'react-native'
import { checkAdGate, recordUsage } from '../../lib/adGate'
import { showInterstitialAd } from '../../lib/admob'
import AdGateModal from '../../components/AdGateModal'
import BannerAdView from '../../components/BannerAdView'
import { useAuth } from '../../context/AuthContext'
import { useRouter } from 'expo-router'
import { trackFeatureUse } from '../../lib/analytics'
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
import HapticTouch from '../../components/HapticTouch'
import AnimatedSection from '../../components/AnimatedSection'
import type { MealType, MealRecord, MealAnalysisResult, UserProfile } from '../../types'
import { todayLocalISO } from '../../lib/dateLocal'

const STORAGE_KEY = 'trackmate_meals'
const PROFILE_KEY = 'trackmate_my_profile'

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
  return <Animated.View style={{ height, width: width as any, borderRadius: 8, backgroundColor: '#e8eaed', opacity }} />
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
function MealHistoryCard({ meal, showDate }: { meal: MealRecord; showDate?: boolean }) {
  const type = MEAL_TYPES.find(t => t.value === meal.meal_type)
  return (
    <View style={styles.historyCard}>
      <View style={styles.historyCardHeader}>
        <Text style={styles.historyIcon}>{type?.icon ?? '🍽️'}</Text>
        <Text style={styles.historyType}>{type?.label ?? meal.meal_type}</Text>
        {showDate && <Text style={styles.historyDate}>{meal.meal_date}</Text>}
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
  const [inputMode, setInputMode] = useState<'photo' | 'manual'>('photo')
  const [manualName,    setManualName]    = useState('')
  const [manualCalories, setManualCalories] = useState('')
  const [manualProtein, setManualProtein] = useState('')
  const [manualCarb,    setManualCarb]    = useState('')
  const [manualFat,     setManualFat]     = useState('')
  const [manualSaving,  setManualSaving]  = useState(false)
  const [adGateVisible,     setAdGateVisible]     = useState(false)
  const [adGateRemaining,   setAdGateRemaining]   = useState(0)
  const [adGateHardLimited, setAdGateHardLimited] = useState(false)
  const [adGateLimitType,   setAdGateLimitType]   = useState<'none'|'daily'|'monthly'|'total'|'window'>('none')
  const [remaining,         setRemaining]         = useState<number | null>(null)
  const [upsellVisible,     setUpsellVisible]     = useState(false)
  const [result, setResult] = useState<MealAnalysisResult | null>(null)
  const [history, setHistory] = useState<MealRecord[]>([])
  const [recordDate, setRecordDate] = useState(todayLocalISO())
  const today = todayLocalISO()
  const { user, isGuest } = useAuth()
  const [eventCategory, setEventCategory] = useState<'sprint' | 'middle' | 'long'>('sprint')
  const router = useRouter()
  // AdGate async チェック中の二重タップ防止
  const analyzeCallRef = React.useRef(false)
  // セッション内キャッシュ（同じ画像+種別の再分析コストをゼロに）
  const mealCacheRef = React.useRef<Map<string, MealAnalysisResult>>(new Map())

  // ローカルストレージから履歴を読み込む + 残り回数取得
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        try { setHistory(JSON.parse(raw)) } catch { /* ignore */ }
      }
    }).catch(() => {})
    // ユーザープロフィールからevent_categoryを読み込む
    AsyncStorage.getItem(PROFILE_KEY).then(raw => {
      if (raw) {
        try {
          const p = JSON.parse(raw)
          if (p?.event_category === 'middle' || p?.event_category === 'long') setEventCategory(p.event_category)
        } catch {}
      }
    }).catch(() => {})
    checkAdGate('meal').then(g => {
      if (g.remaining < 999) setRemaining(g.remaining)
    }).catch(() => {})
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

  // リサイズ（最大800px）＋ base64 変換（Web / ネイティブ両対応）
  // 食事分析は動画分析ほどの精細さを必要としないため、AIコスト削減のため控えめなサイズに設定
  const imageUriToBase64 = useCallback(async (uri: string): Promise<string> => {
    if (Platform.OS === 'web') {
      // Web: Canvas でリサイズしてから base64 取得
      return new Promise((resolve, reject) => {
        const img = new (globalThis as any).Image() as HTMLImageElement
        img.onload = () => {
          const MAX = 800
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
        [{ resize: { width: 800 } }],
        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG }
      )
      return FileSystem.readAsStringAsync(resized.uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
    }
  }, [])

  const handleAnalyzeCore = useCallback(async (): Promise<boolean> => {
    if (!imageUri) return false
    // セッション内キャッシュチェック（同じ画像+種別なら API コールしない）
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
      const res = await analyzeMeal(base64, profile, mealType, timing)
      if (!res || !Array.isArray(res.foods)) throw new Error('応答形式が不正です')
      mealCacheRef.current.set(cacheKey, res)
      setResult(res)
      showInterstitialAd().catch(() => {})
      return true
    } catch (e) {
      Toast.show({ type: 'error', text1: 'AI分析に失敗しました', text2: e instanceof Error ? e.message : '' })
      return false
    } finally { setAnalyzing(false) }
  }, [imageUri, mealType, timing, user, eventCategory])

  const handleAnalyze = useCallback(async () => {
    if (analyzeCallRef.current) return  // 二重タップ防止
    if (!imageUri) return
    // ゲストはログイン必須
    if (isGuest) { setAdGateRemaining(0); setAdGateHardLimited(false); setAdGateVisible(true); return }
    analyzeCallRef.current = true
    try {
      const gate = await checkAdGate('meal')
      if (!gate.allowed) {
        setAdGateRemaining(gate.remaining); setAdGateHardLimited(gate.hardLimited); setAdGateLimitType(gate.limitType); setAdGateVisible(true); return
      }
      await recordUsage('meal')
      trackFeatureUse('meal')
      checkAdGate('meal').then(g => { if (g.remaining < 999) setRemaining(g.remaining) }).catch(() => {})
      await handleAnalyzeCore()
    } finally {
      analyzeCallRef.current = false
    }
  }, [imageUri, handleAnalyzeCore, isGuest])

  const handleSave = useCallback(async () => {
    if (!result) return
    setSaving(true)
    try {
      const newRecord: MealRecord = {
        id: `local_${Date.now()}`,
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
  }, [result, mealType, timing, today, history, recordDate, user])

  // ── 手動入力の保存（写真・AI分析を使わず直接記録） ──────────────
  const handleManualSave = useCallback(async () => {
    if (!manualName.trim()) { Toast.show({ type: 'error', text1: '食べたものを入力してください' }); return }
    const calories = parseFloat(manualCalories) || 0
    if (calories <= 0) { Toast.show({ type: 'error', text1: 'カロリーを入力してください' }); return }
    setManualSaving(true)
    try {
      const protein = parseFloat(manualProtein) || 0
      const carb    = parseFloat(manualCarb)    || 0
      const fat     = parseFloat(manualFat)     || 0
      const newRecord: MealRecord = {
        id: `local_${Date.now()}`,
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
      const updated = [newRecord, ...history]
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      setHistory(updated)
      setManualName(''); setManualCalories(''); setManualProtein(''); setManualCarb(''); setManualFat('')
      Sounds.save()
      Toast.show({ type: 'success', text1: '✅ 食事を保存しました' })
    } catch (e) {
      Toast.show({ type: 'error', text1: '保存に失敗しました', text2: e instanceof Error ? e.message : '' })
    } finally {
      setManualSaving(false)
    }
  }, [manualName, manualCalories, manualProtein, manualCarb, manualFat, mealType, timing, history, recordDate, user])

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
              <HapticTouch key={t.value} haptic="toggleOn" style={[styles.chip, mealType === t.value && styles.chipActive]} onPress={() => setMealType(t.value)} activeOpacity={0.7}>
                <Text style={styles.chipIcon}>{t.icon}</Text>
                <Text style={[styles.chipText, mealType === t.value && styles.chipTextActive]}>{t.label}</Text>
              </HapticTouch>
            ))}
          </ScrollView>
          <View style={styles.timingRow}>
            {TIMINGS.map(t => (
              <HapticTouch key={t.value} haptic="toggleOn" style={[styles.timingBtn, timing === t.value && styles.timingBtnActive]} onPress={() => setTiming(t.value)} activeOpacity={0.7}>
                <Text style={[styles.timingText, timing === t.value && styles.timingTextActive]}>{t.label}</Text>
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
              <Ionicons name="camera-outline" size={16} color={inputMode === 'photo' ? '#fff' : TEXT.secondary} />
              <Text style={[styles.modeTabText, inputMode === 'photo' && styles.modeTabTextActive]}>写真で記録</Text>
            </HapticTouch>
            <HapticTouch haptic="toggleOn" style={[styles.modeTab, inputMode === 'manual' && styles.modeTabActive]} onPress={() => setInputMode('manual')} activeOpacity={0.7}>
              <Ionicons name="create-outline" size={16} color={inputMode === 'manual' ? '#fff' : TEXT.secondary} />
              <Text style={[styles.modeTabText, inputMode === 'manual' && styles.modeTabTextActive]}>手動で入力</Text>
            </HapticTouch>
          </View>

          {inputMode === 'photo' ? (
            <>
              {imageUri ? (
                <View style={styles.imageBox}>
                  <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
                  <TouchableOpacity style={styles.imageClose} onPress={() => setImageUri(null)}>
                    <Ionicons name="close-circle" size={30} color="rgba(255,255,255,0.9)" />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.pickRow}>
                  <HapticTouch haptic="tap" style={styles.pickBtn} onPress={() => pickImage('camera')} activeOpacity={0.8}>
                    <Ionicons name="camera" size={22} color="#fff" />
                    <Text style={styles.pickBtnText}>撮影する</Text>
                  </HapticTouch>
                  <HapticTouch haptic="tap" style={[styles.pickBtn, styles.pickBtnSub]} onPress={() => pickImage('library')} activeOpacity={0.8}>
                    <Ionicons name="images" size={22} color="#374151" />
                    <Text style={[styles.pickBtnText, {color:'#374151'}]}>ライブラリ</Text>
                  </HapticTouch>
                </View>
              )}
              {imageUri && !result && (
                <>
                  {remaining !== null && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8,
                      backgroundColor: remaining <= 1 ? 'rgba(239,68,68,0.10)' : 'rgba(22,101,52,0.10)',
                      borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start',
                      borderWidth: 1, borderColor: remaining <= 1 ? 'rgba(239,68,68,0.3)' : 'rgba(22,101,52,0.3)',
                    }}>
                      <Ionicons name={remaining <= 1 ? 'warning-outline' : 'flash-outline'} size={11}
                        color={remaining <= 1 ? '#ef4444' : BRAND}/>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: remaining <= 1 ? '#ef4444' : BRAND }}>
                        {remaining === 0 ? '無料枠を使い切りました' : `残り${remaining}回（無料枠）`}
                      </Text>
                    </View>
                  )}
                  <HapticTouch haptic="whoosh" style={[styles.analyzeBtn, analyzing && { opacity: 0.6 }]} onPress={handleAnalyze} disabled={analyzing} activeOpacity={0.85}>
                    <Ionicons name="sparkles" size={20} color="#fff" />
                    <Text style={styles.analyzeBtnText}>{analyzing ? '分析中...' : '分析する'}</Text>
                  </HapticTouch>
                </>
              )}
            </>
          ) : (
            <View style={{ gap: 10 }}>
              <TextInput
                style={styles.manualInput}
                placeholder="食べたもの（例：鶏胸肉のサラダ）"
                placeholderTextColor={TEXT.hint}
                value={manualName}
                onChangeText={setManualName}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[styles.manualInput, { flex: 1 }]}
                  placeholder="カロリー(kcal)"
                  placeholderTextColor={TEXT.hint}
                  keyboardType="numeric"
                  value={manualCalories}
                  onChangeText={setManualCalories}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[styles.manualInput, { flex: 1 }]}
                  placeholder="P(g)"
                  placeholderTextColor={TEXT.hint}
                  keyboardType="numeric"
                  value={manualProtein}
                  onChangeText={setManualProtein}
                />
                <TextInput
                  style={[styles.manualInput, { flex: 1 }]}
                  placeholder="C(g)"
                  placeholderTextColor={TEXT.hint}
                  keyboardType="numeric"
                  value={manualCarb}
                  onChangeText={setManualCarb}
                />
                <TextInput
                  style={[styles.manualInput, { flex: 1 }]}
                  placeholder="F(g)"
                  placeholderTextColor={TEXT.hint}
                  keyboardType="numeric"
                  value={manualFat}
                  onChangeText={setManualFat}
                />
              </View>
              <HapticTouch haptic="save" style={[styles.saveBtn, manualSaving && { opacity: 0.5 }]} onPress={handleManualSave} disabled={manualSaving} activeOpacity={0.85}>
                <Ionicons name="save" size={18} color="#fff" />
                <Text style={styles.saveBtnText}>{manualSaving ? '保存中...' : '保存する'}</Text>
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
            <HapticTouch haptic="save" style={[styles.saveBtn, saving && { opacity: 0.5 }]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
              <Ionicons name="save" size={18} color="#fff" />
              <Text style={styles.saveBtnText}>{saving ? '保存中...' : '保存する'}</Text>
            </HapticTouch>
            <TouchableOpacity onPress={() => { setResult(null); setImageUri(null) }} style={{ alignSelf: 'center', padding: 8 }}>
              <Text style={{ color: TEXT.secondary, fontSize: 13 }}>クリア</Text>
            </TouchableOpacity>
          </View>
          </AnimatedSection>
        )}

        {/* バナー広告 */}
        <View style={{ marginVertical: 6 }}>
          <BannerAdView />
        </View>

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

        {/* 過去の記録一覧（全日付） */}
        {history.length > 0 && (
          <AnimatedSection delay={280} type="fade-up">
          <View style={styles.card}>
            <Text style={styles.cardTitle}>過去の記録一覧</Text>
            {[...history]
              .sort((a, b) => (a.meal_date === b.meal_date
                ? b.created_at.localeCompare(a.created_at)
                : b.meal_date.localeCompare(a.meal_date)))
              .slice(0, 30)
              .map(m => <MealHistoryCard key={m.id} meal={m} showDate />)}
          </View>
          </AnimatedSection>
        )}
      </ScrollView>
    </SafeAreaView>

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
        await recordUsage('meal')
        trackFeatureUse('meal')
        checkAdGate('meal').then(g2 => { if (g2.remaining < 999) setRemaining(g2.remaining) }).catch(() => {})
        const ok = await handleAnalyzeCore()
        // 広告視聴後の分析が完了したら、広告なしプランへのアップセルを提示
        if (ok) setUpsellVisible(true)
      }}
      onUpgrade={() => { setAdGateVisible(false); router.push('/paywall') }}
    />

    {/* ── 分析結果後アップセルシート（広告視聴で分析した直後に表示） ── */}
    <Modal visible={upsellVisible} transparent animationType="slide" onRequestClose={() => setUpsellVisible(false)}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={() => setUpsellVisible(false)}>
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          <Pressable onPress={() => {}}>
            <View style={{ backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 16 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 4 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="star" size={24} color="#16a34a" />
                <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>広告なしプランにしませんか？</Text>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 20 }}>
                無料枠を使い切ると広告視聴が必要になります。{'\n'}
                広告なしプランなら、食事分析もフォーム分析も広告なしで使い放題です。
              </Text>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 14, gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>FREE（今のプラン）</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>無料枠超過後は広告視聴</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ backgroundColor: '#166534', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>広告なし</Text>
                    </View>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>¥980/月</Text>
                  </View>
                  <Text style={{ color: '#4ade80', fontSize: 12, fontWeight: '700' }}>広告一切なし</Text>
                </View>
              </View>
              <TouchableOpacity
                style={{ backgroundColor: '#166534', borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}
                onPress={() => { setUpsellVisible(false); router.push('/paywall?plan=noad' as any) }}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>広告なしプランを見る ¥980/月〜</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 4 }} onPress={() => setUpsellVisible(false)} activeOpacity={0.7}>
                <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>今はしない</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
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
  card: { backgroundColor: '#ffffff', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2 },
  cardTitle: { color: TEXT.primary, fontSize: 15, fontWeight: '700' },
  macroRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  macroMain: { alignItems: 'center' },
  macroKcal: { color: BRAND, fontSize: 34, fontWeight: '800', lineHeight: 38, fontVariant: ['tabular-nums'] },
  macroKcalLabel: { color: TEXT.secondary, fontSize: 12 },
  macroItem: { flex: 1, alignItems: 'center', gap: 2 },
  macroValue: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  macroLabel: { color: TEXT.secondary, fontSize: 11 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#f0f2f5', borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', gap: 4, minWidth: 60 },
  chipActive: { backgroundColor: BRAND, borderColor: BRAND },
  chipIcon: { fontSize: 18 },
  chipText: { color: TEXT.secondary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },
  timingRow: { flexDirection: 'row', gap: 8 },
  timingBtn: { flex: 1, paddingVertical: 8, backgroundColor: '#f0f2f5', borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  timingBtnActive: { backgroundColor: `${BRAND}10`, borderColor: BRAND },
  timingText: { color: TEXT.secondary, fontSize: 13, fontWeight: '600' },
  timingTextActive: { color: BRAND },
  imageBox: { height: 200, borderRadius: 14, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  imageClose: { position: 'absolute', top: 8, right: 8 },
  pickRow: { flexDirection: 'row', gap: 10 },
  pickBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 21, paddingVertical: 16 },
  pickBtnSub: { backgroundColor: '#f0f2f5', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', color: '#374151' },
  pickBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  analyzeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 21, paddingVertical: 16 },
  analyzeBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  foodRow: { gap: 4, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.07)' },
  foodName: { color: TEXT.primary, fontSize: 14, fontWeight: '600' },
  foodMacros: { flexDirection: 'row', gap: 8 },
  foodMacro: { color: TEXT.secondary, fontSize: 12 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(0,0,0,0.07)' },
  hydration: { backgroundColor: 'rgba(6,182,212,0.08)', borderRadius: 14, padding: 10, borderWidth: 1, borderColor: 'rgba(6,182,212,0.25)' },
  hydrationText: { color: NEON.cyan, fontSize: 13 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 21, paddingVertical: 16 },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  historyCard: { backgroundColor: '#f8f8fa', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', padding: 12, gap: 5 },
  historyCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  historyIcon: { fontSize: 16 },
  historyType: { color: TEXT.primary, fontSize: 14, fontWeight: '700', flex: 1 },
  historyDate: { color: TEXT.hint, fontSize: 11, fontWeight: '600' },
  kcalBadge: { backgroundColor: `${BRAND}22`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  kcalBadgeText: { color: BRAND, fontSize: 12, fontWeight: '600' },
  historyFood: { color: TEXT.secondary, fontSize: 13 },
  historyFoodMacro: { color: TEXT.hint, fontSize: 12 },
  historyMore: { color: TEXT.hint, fontSize: 12 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  emptyText: { color: TEXT.secondary, fontSize: 14 },
  modeTabRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  modeTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, backgroundColor: '#f0f2f5', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  modeTabActive: { backgroundColor: BRAND, borderColor: BRAND },
  modeTabText: { color: TEXT.secondary, fontSize: 13, fontWeight: '700' },
  modeTabTextActive: { color: '#FFFFFF' },
  manualInput: { backgroundColor: '#f8f8fa', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: TEXT.primary },
})

// app/onboarding.tsx — 初回登録後のプロフィール設定

import React, { useRef, useState, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, TextInput, ScrollView, Platform,
  KeyboardAvoidingView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'

import { useAuth } from '../context/AuthContext'
import { BRAND, TEXT } from '../lib/theme'
import { Sounds, unlockAudio } from '../lib/sounds'
import type { AthleticsEvent, EventCategory } from '../types'

const SURFACE  = '#ffffff'
const SURFACE2 = '#f0f2f5'
const TOTAL_STEPS = 5

// ── 種目データ ─────────────────────────────────────────────
const CATEGORIES = [
  { key: 'sprint', label: '短距離', icon: '⚡️', sub: '100m〜400mH' },
  { key: 'middle', label: '中距離', icon: '🔥', sub: '800m〜3000mSC' },
  { key: 'long',   label: '長距離', icon: '🌟', sub: '5000m〜マラソン' },
  { key: 'field',  label: 'フィールド', icon: '🏅', sub: '跳躍・投擲' },
] as const

const EVENTS_BY_CATEGORY: Record<string, { label: string; key: AthleticsEvent }[]> = {
  sprint: [
    { key: '100m',  label: '100m' },
    { key: '200m',  label: '200m' },
    { key: '400m',  label: '400m' },
    { key: '110mH', label: '110mH（男子）' },
    { key: '100mH', label: '100mH（女子）' },
    { key: '400mH', label: '400mH' },
  ],
  middle: [
    { key: '800m',    label: '800m' },
    { key: '1500m',   label: '1500m' },
    { key: '3000m',   label: '3000m' },
    { key: '3000mSC', label: '3000mSC' },
  ],
  long: [
    { key: '5000m',         label: '5000m' },
    { key: '10000m',        label: '10000m' },
    { key: 'half_marathon', label: 'ハーフマラソン' },
    { key: 'marathon',      label: 'マラソン' },
    { key: '競歩',          label: '競歩' },
  ],
  field: [
    { key: '走幅跳',    label: '走幅跳' },
    { key: '三段跳',    label: '三段跳' },
    { key: '走高跳',    label: '走高跳' },
    { key: '棒高跳',    label: '棒高跳' },
    { key: '砲丸投',    label: '砲丸投' },
    { key: 'やり投',    label: 'やり投' },
    { key: '円盤投',    label: '円盤投' },
    { key: 'ハンマー投', label: 'ハンマー投' },
  ],
}

const EXPERIENCE_OPTIONS = [
  { key: 0,  label: '始めたばかり', sub: '1年未満' },
  { key: 2,  label: '中級者',       sub: '2〜4年' },
  { key: 5,  label: '経験者',       sub: '5〜9年' },
  { key: 10, label: 'ベテラン',     sub: '10年以上' },
]

// ── プログレスバー ─────────────────────────────────────────
function StepBar({ step }: { step: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 24, paddingTop: 12 }}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1, height: 3, borderRadius: 2,
            backgroundColor: i < step ? BRAND : 'rgba(0,0,0,0.12)',
          }}
        />
      ))}
    </View>
  )
}

// ── 選択チップ ─────────────────────────────────────────────
function Chip({
  label, sub, selected, onPress, icon,
}: {
  label: string; sub?: string; selected: boolean; onPress: () => void; icon?: string
}) {
  const scale = useRef(new Animated.Value(1)).current

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.spring(scale,  { toValue: 1,    tension: 300, friction: 10, useNativeDriver: true }),
    ]).start()
    onPress()
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        style={[styles.chip, selected && styles.chipSelected]}
        onPress={handlePress}
        activeOpacity={1}
      >
        {icon && <Text style={{ fontSize: 22 }}>{icon}</Text>}
        <View style={{ flex: 1 }}>
          <Text style={[styles.chipLabel, selected && { color: '#fff' }]}>{label}</Text>
          {sub ? <Text style={styles.chipSub}>{sub}</Text> : null}
        </View>
        {selected
          ? <Ionicons name="checkmark-circle" size={22} color={BRAND} />
          : <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.2)' }} />
        }
      </TouchableOpacity>
    </Animated.View>
  )
}

// ── メイン ─────────────────────────────────────────────────
export default function OnboardingScreen() {
  const router  = useRouter()
  const { user, setOnboarded } = useAuth()

  const [step,       setStep]       = useState(1)
  const [name,       setName]       = useState('')
  const [category,   setCategory]   = useState<string>('')
  const [event,      setEvent]      = useState<AthleticsEvent | ''>('')
  const [experience, setExperience] = useState<number>(-1)
  const [age,        setAge]        = useState('')
  const [pb,         setPb]         = useState('')

  // フェードアニメーション（シンプルで確実）
  const fadeAnim = useRef(new Animated.Value(1)).current
  const isAnimating = useRef(false)

  const transition = useCallback((action: () => void) => {
    if (isAnimating.current) return
    isAnimating.current = true

    // フェードアウト → step変更 → フェードイン
    Animated.timing(fadeAnim, {
      toValue: 0, duration: 120, useNativeDriver: true,
    }).start(() => {
      action()
      Animated.timing(fadeAnim, {
        toValue: 1, duration: 180, useNativeDriver: true,
      }).start(() => {
        isAnimating.current = false
      })
    })
  }, [fadeAnim])

  const goNext = useCallback((nextStep: number) => {
    unlockAudio(); Sounds.pop()
    transition(() => setStep(nextStep))
  }, [transition])

  const goBack = useCallback(() => {
    if (step <= 1) return
    Sounds.tap()
    transition(() => setStep(s => s - 1))
  }, [step, transition])

  const handleCategorySelect = useCallback((key: string) => {
    Sounds.tap()
    if (key !== category) {
      setCategory(key)
      setEvent('')  // カテゴリ変更時に種目リセット
    }
  }, [category])

  const handleFinish = useCallback(async (skipNav = false, goPaywall = false) => {
    unlockAudio(); Sounds.save()

    const profile = {
      id: user?.id ?? 'guest',
      name: name.trim() || (user?.email?.split('@')[0] ?? 'アスリート'),
      primary_event: event || '100m',
      event_category: (category || 'sprint') as EventCategory,
      secondary_events: [],
      age: age ? Number(age) : undefined,
      experience_years: experience >= 0 ? experience : undefined,
      personal_best_ms: pb.trim() ? (parsePbToMs(pb.trim()) ?? undefined) : undefined,
      target_time_ms: undefined as number | undefined,
      created_at: new Date().toISOString(),
    }

    await AsyncStorage.setItem('trackmate_my_profile', JSON.stringify(profile)).catch(() => {})

    if (goPaywall) {
      // ペイウォールへ先にナビゲートしてから setOnboarded を呼ぶ
      // → AuthGate が /(tabs) に上書きする前に segments が変わるのでレース条件を回避
      router.replace('/paywall')
      await setOnboarded()
    } else {
      await setOnboarded()
      Toast.show({
        type: 'success',
        text1: `ようこそ、${profile.name}さん！`,
        text2: '一緒に記録を伸ばしていこう 🏃',
      })
      if (!skipNav) router.replace('/(tabs)')
    }
  }, [name, event, category, experience, age, pb, user, setOnboarded, router])

  const canNextStep1 = name.trim().length >= 1
  const canNextStep2 = category !== ''
  const canNextStep3 = event !== ''

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
      {/* ヘッダー */}
      <SafeAreaView>
        <StepBar step={step} />
        <View style={styles.header}>
          {step > 1 ? (
            <TouchableOpacity onPress={goBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-back" size={22} color={TEXT.secondary} />
            </TouchableOpacity>
          ) : <View style={{ width: 40 }} />}
          <Text style={styles.stepLabel}>STEP {step} / {TOTAL_STEPS}</Text>
          <TouchableOpacity
            onPress={() => { Sounds.tap(); transition(() => setStep(s => Math.min(s + 1, TOTAL_STEPS))) }}
            style={styles.skipBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.skipText}>{step < TOTAL_STEPS ? 'スキップ' : ''}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* アニメーション対象はここだけ */}
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── STEP 1: 名前 ── */}
            {step === 1 && (
              <View style={{ gap: 24 }}>
                <View style={styles.titleArea}>
                  <Text style={styles.emoji}>👋</Text>
                  <Text style={styles.title}>はじめに{'\n'}教えてください</Text>
                  <Text style={styles.sub}>あなたの名前またはニックネームを入力してください</Text>
                </View>
                <View style={styles.inputWrap}>
                  <Ionicons name="person-outline" size={18} color={TEXT.hint} />
                  <TextInput
                    style={styles.input}
                    placeholder="例：田中 太郎 / Taro"
                    placeholderTextColor={TEXT.hint}
                    value={name}
                    onChangeText={setName}
                    maxLength={20}
                    returnKeyType="done"
                    onSubmitEditing={() => canNextStep1 && goNext(2)}
                    autoFocus
                  />
                </View>
                <Text style={styles.inputHint}>後から設定で変更できます</Text>
              </View>
            )}

            {/* ── STEP 2: カテゴリ ── */}
            {step === 2 && (
              <View style={{ gap: 20 }}>
                <View style={styles.titleArea}>
                  <Text style={styles.emoji}>🏃</Text>
                  <Text style={styles.title}>競技カテゴリを{'\n'}選んでください</Text>
                  <Text style={styles.sub}>メインで取り組んでいる種目のカテゴリ</Text>
                </View>
                <View style={{ gap: 10 }}>
                  {CATEGORIES.map(c => (
                    <Chip
                      key={c.key}
                      icon={c.icon}
                      label={c.label}
                      sub={c.sub}
                      selected={category === c.key}
                      onPress={() => handleCategorySelect(c.key)}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* ── STEP 3: 種目 ── */}
            {step === 3 && (
              <View style={{ gap: 20 }}>
                <View style={styles.titleArea}>
                  <Text style={styles.emoji}>🎯</Text>
                  <Text style={styles.title}>メイン種目を{'\n'}選んでください</Text>
                  <Text style={styles.sub}>複数ある場合は最も力を入れている種目を選んで</Text>
                </View>
                <View style={{ gap: 8 }}>
                  {(EVENTS_BY_CATEGORY[category] ?? EVENTS_BY_CATEGORY.sprint).map(e => (
                    <Chip
                      key={e.key}
                      label={e.label}
                      selected={event === e.key}
                      onPress={() => { setEvent(e.key); Sounds.tap() }}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* ── STEP 4: 経験・PB ── */}
            {step === 4 && (
              <View style={{ gap: 24 }}>
                <View style={styles.titleArea}>
                  <Text style={styles.emoji}>📊</Text>
                  <Text style={styles.title}>競技歴と記録{'\n'}（任意）</Text>
                  <Text style={styles.sub}>入力するとAIのアドバイスが精度アップします</Text>
                </View>


                {/* 競技歴 */}
                <View style={{ gap: 10 }}>
                  <Text style={styles.sectionLabel}>競技歴</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {EXPERIENCE_OPTIONS.map(opt => (
                      <TouchableOpacity
                        key={opt.key}
                        style={[styles.expBtn, experience === opt.key && styles.expBtnActive]}
                        onPress={() => { setExperience(opt.key); Sounds.tap() }}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.expLabel, experience === opt.key && { color: '#fff' }]}>{opt.label}</Text>
                        <Text style={[styles.expSub, experience === opt.key && { color: 'rgba(255,255,255,0.65)' }]}>{opt.sub}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* 年齢 */}
                <View style={{ gap: 8 }}>
                  <Text style={styles.sectionLabel}>年齢</Text>
                  <View style={styles.inputWrap}>
                    <Ionicons name="calendar-outline" size={18} color={TEXT.hint} />
                    <TextInput
                      style={styles.input}
                      placeholder="例：20"
                      placeholderTextColor={TEXT.hint}
                      value={age}
                      onChangeText={v => setAge(v.replace(/\D/g, ''))}
                      keyboardType="number-pad"
                      maxLength={3}
                    />
                    <Text style={{ color: TEXT.hint, fontSize: 14 }}>歳</Text>
                  </View>
                </View>

                {/* 自己ベスト */}
                <View style={{ gap: 8 }}>
                  <Text style={styles.sectionLabel}>自己ベスト（{event || '選択種目'}）</Text>
                  <View style={styles.inputWrap}>
                    <Ionicons name="trophy-outline" size={18} color={TEXT.hint} />
                    <TextInput
                      style={styles.input}
                      placeholder={
                        category === 'field' ? '例：7.32（m）' :
                        (event?.startsWith('5') || event?.startsWith('10') || event?.includes('marathon'))
                          ? '例：13:45.00 / 1:23:45'
                          : event?.startsWith('8') || event === '1500m' || event === '3000m' || event === '3000mSC'
                          ? '例：1:47.32 / 3:35.00'
                          : '例：10.85 / 47.32'
                      }
                      placeholderTextColor={TEXT.hint}
                      value={pb}
                      onChangeText={setPb}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <Text style={styles.inputHint}>
                    {category === 'field' ? 'メートル単位で入力（例: 7.32）' : '秒またはm:ss形式（例: 10.85 / 1:47.32）'}
                  </Text>
                </View>
              </View>
            )}
            {step === 5 && (
              <View style={{ gap: 14 }}>
                <View style={styles.titleArea}>
                  <Text style={styles.emoji}>🚀</Text>
                  <Text style={styles.title}>プランを選んで{'\n'}始めよう</Text>
                  <Text style={styles.sub}>いつでも変更・解約できます</Text>
                </View>

                {/* ── PRO おすすめ（最上段・一番目立つ） ── */}
                <TouchableOpacity
                  onPress={() => handleFinish(false, true)}
                  activeOpacity={0.88}
                  style={{
                    backgroundColor: '#fff',
                    borderRadius: 20,
                    borderWidth: 2,
                    borderColor: BRAND,
                    padding: 20,
                    shadowColor: BRAND,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.18,
                    shadowRadius: 16,
                    elevation: 6,
                  }}
                >
                  {/* ヘッダー行 */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ backgroundColor: BRAND, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 5 }}>
                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 0.5 }}>✦ PRO</Text>
                      </View>
                      <View style={{ backgroundColor: '#fef9c3', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text style={{ color: '#ca8a04', fontSize: 10, fontWeight: '800' }}>⭐ おすすめ</Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontSize: 26, fontWeight: '900', color: BRAND, letterSpacing: -0.5 }}>¥480</Text>
                      <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: -2 }}>/月</Text>
                    </View>
                  </View>
                  {/* 機能リスト */}
                  <View style={{ gap: 7 }}>
                    {[
                      { icon: 'ban-outline', text: '広告・バナー 完全非表示' },
                      { icon: 'sparkles-outline', text: 'AI練習分析・動画分析 月30回' },
                      { icon: 'document-text-outline', text: 'CSVエクスポート・全機能解放' },
                    ].map(f => (
                      <View key={f.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                        <Ionicons name={f.icon as any} size={15} color={BRAND} />
                        <Text style={{ color: '#374151', fontSize: 13, fontWeight: '600' }}>{f.text}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={{ backgroundColor: BRAND, borderRadius: 12, paddingVertical: 12, marginTop: 16, alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>PROプランで始める →</Text>
                  </View>
                </TouchableOpacity>

                {/* ── ELITE ── */}
                <TouchableOpacity
                  onPress={() => handleFinish(false, true)}
                  activeOpacity={0.88}
                  style={{
                    backgroundColor: '#fff',
                    borderRadius: 20,
                    borderWidth: 1.5,
                    borderColor: '#d97706',
                    padding: 20,
                    shadowColor: '#d97706',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.1,
                    shadowRadius: 8,
                    elevation: 3,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <View style={{ backgroundColor: '#fef3c7', borderRadius: 8, paddingHorizontal: 11, paddingVertical: 5 }}>
                      <Text style={{ color: '#d97706', fontSize: 14, fontWeight: '900', letterSpacing: 0.5 }}>👑 ELITE</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontSize: 26, fontWeight: '900', color: '#d97706', letterSpacing: -0.5 }}>¥980</Text>
                      <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: -2 }}>/月</Text>
                    </View>
                  </View>
                  <View style={{ gap: 7 }}>
                    {[
                      { icon: 'infinite-outline', text: 'AI全機能 完全無制限 ∞' },
                      { icon: 'ban-outline', text: '広告・バナー 完全非表示' },
                      { icon: 'videocam-outline', text: '動画フォーム分析 無制限' },
                    ].map(f => (
                      <View key={f.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                        <Ionicons name={f.icon as any} size={15} color="#d97706" />
                        <Text style={{ color: '#374151', fontSize: 13, fontWeight: '600' }}>{f.text}</Text>
                      </View>
                    ))}
                  </View>
                </TouchableOpacity>

                {/* ── FREE（テキストリンク風・目立たせない） ── */}
                <TouchableOpacity
                  onPress={() => handleFinish()}
                  activeOpacity={0.7}
                  style={{
                    backgroundColor: '#f9fafb',
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                    paddingVertical: 14,
                    paddingHorizontal: 20,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ backgroundColor: '#f3f4f6', borderRadius: 7, paddingHorizontal: 9, paddingVertical: 4 }}>
                      <Text style={{ color: '#6b7280', fontSize: 12, fontWeight: '800' }}>FREE</Text>
                    </View>
                    <Text style={{ color: '#6b7280', fontSize: 13 }}>まず無料で始める</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: '#9ca3af' }}>¥0</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>

      {/* ボトムボタン */}
      <SafeAreaView edges={['bottom']}>
        <View style={styles.bottomBar}>
          {step < TOTAL_STEPS ? (
            <TouchableOpacity
              style={[
                styles.nextBtn,
                ((step === 1 && !canNextStep1) || (step === 2 && !canNextStep2) || (step === 3 && !canNextStep3))
                  ? { opacity: 0.4 } : {},
              ]}
              onPress={() => {
                if (step === 1 && !canNextStep1) return
                if (step === 2 && !canNextStep2) return
                if (step === 3 && !canNextStep3) return
                goNext(step + 1)
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.nextBtnText}>次へ</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </TouchableOpacity>
          ) : (
            // Step 5: プラン選択 — カード内にFREEボタンを含めているのでフッターは非表示
            <View style={{ paddingVertical: 8 }} />
          )}
        </View>
      </SafeAreaView>
    </View>
  )
}

// ── PBをミリ秒に変換 ─────────────────────────────────────
function parsePbToMs(input: string): number | null {
  const mMatch = input.match(/^(\d+):(\d+(?:\.\d+)?)$/)
  if (mMatch) {
    return Math.round((parseInt(mMatch[1], 10) * 60 + parseFloat(mMatch[2])) * 1000)
  }
  const sMatch = input.match(/^\d+(?:\.\d+)?$/)
  if (sMatch) {
    return Math.round(parseFloat(input) * 1000)
  }
  return null
}

// ── スタイル ───────────────────────────────────────────────
const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backBtn:   { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { color: TEXT.hint, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  skipBtn:   { width: 60, alignItems: 'flex-end', paddingVertical: 4 },
  skipText:  { color: TEXT.hint, fontSize: 13, fontWeight: '600' },

  content:    { padding: 24, paddingBottom: 20 },
  titleArea:  { gap: 10, marginBottom: 4 },
  emoji:      { fontSize: 42 },
  title:      { color: '#111827', fontSize: 28, fontWeight: '900', letterSpacing: -0.8, lineHeight: 36 },
  sub:        { color: TEXT.secondary, fontSize: 14, lineHeight: 20 },
  sectionLabel: { color: TEXT.hint, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },

  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: SURFACE, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
  },
  chipSelected: {
    backgroundColor: 'rgba(229,62,62,0.1)',
    borderColor: BRAND,
  },
  chipLabel: { color: '#111827', fontSize: 15, fontWeight: '700' },
  chipSub:   { color: TEXT.hint, fontSize: 12, marginTop: 2 },

  expBtn: {
    flex: 1, minWidth: '45%', alignItems: 'center',
    backgroundColor: SURFACE, borderRadius: 12,
    padding: 14, borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)', gap: 3,
  },
  expBtnActive:  { backgroundColor: 'rgba(229,62,62,0.12)', borderColor: BRAND },
  expLabel:      { color: '#111827', fontSize: 14, fontWeight: '700' },
  expSub:        { color: TEXT.hint, fontSize: 11 },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: SURFACE2, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)',
  },
  input:     { flex: 1, color: '#111827', fontSize: 16, outlineStyle: 'none' as any },
  inputHint: { color: TEXT.hint, fontSize: 11, paddingLeft: 4 },

  bottomBar: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 8 },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#1c1c1e', borderRadius: 50, paddingVertical: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 5,
  },
  nextBtnText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },

  planCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 16,
    padding: 18, borderWidth: 2, borderColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  planCardPro: {
    borderColor: BRAND,
    backgroundColor: 'rgba(229,62,62,0.04)',
  },
  planLabel: { color: '#111827', fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },
  planPrice: { color: '#111827', fontSize: 18, fontWeight: '900' },
  planDesc:  { color: '#6b7280', fontSize: 12, lineHeight: 17, marginTop: 2 },
})

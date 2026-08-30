// components/TutorialSlides.tsx — スライド形式チュートリアル

import React, { useRef, useState } from 'react'
import {
  Animated, Dimensions, Modal, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTutorial } from '../lib/tutorialContext'
import { useTranslation } from 'react-i18next'

const BRAND = '#16a34a'

interface Slide {
  emoji: string
  key: string
  color: string
  /** タップで指定タブへ移動するボタンを表示する */
  navigateTo?: string
}

// title/description/navigateLabel は locales/tutorialSlides.slides 経由で言語対応
const SLIDES: Slide[] = [
  { emoji: '🏃', key: 's1', color: BRAND },
  { emoji: '📝', key: 's2', color: '#3b82f6' },
  { emoji: '⚠️', key: 's3', color: '#ef4444' },
  { emoji: '🧘', key: 's4', color: '#8b5cf6' },
  { emoji: '🎫', key: 's5', color: '#f59e0b' },
  { emoji: '🏁', key: 's6', color: '#f59e0b', navigateTo: '/(tabs)/competition' },
  { emoji: '📋', key: 's7', color: '#06b6d4' },
  { emoji: '📸', key: 's8', color: '#ec4899', navigateTo: '/(tabs)/records' },
  { emoji: '🎉', key: 's9', color: BRAND },
]

export default function TutorialSlides() {
  const { t } = useTranslation()
  const { active, skipTutorial } = useTutorial()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [step, setStep] = useState(0)
  const fadeAnim = useRef(new Animated.Value(1)).current

  // active が false になったらリセット
  const prevActive = useRef(active)
  if (!active && prevActive.current) {
    prevActive.current = false
    // 次回起動時のためステップをリセット
    setTimeout(() => setStep(0), 300)
  }
  if (active && !prevActive.current) {
    prevActive.current = true
  }

  if (!active) return null

  const slide = SLIDES[step]
  const isLast = step === SLIDES.length - 1

  function animate(cb: () => void) {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
    ]).start(() => {
      cb()
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start()
    })
  }

  function goNext() {
    if (isLast) { skipTutorial(); return }
    animate(() => setStep(s => s + 1))
  }

  function goPrev() {
    if (step === 0) return
    animate(() => setStep(s => s - 1))
  }

  // 画面の縦サイズからカードの中心位置を計算（常に画面中央に固定）
  const { height: SH } = Dimensions.get('window')
  // カード高さは約340px 程度。上から(SH/2 - 170) の位置に配置
  const cardTop = Math.max(insets.top + 20, SH / 2 - 170)

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      {/* 背景 */}
      <View style={StyleSheet.absoluteFill}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
      </View>

      {/* カード（画面中央に絶対配置） */}
      <Animated.View
        style={[
          s.card,
          {
            position: 'absolute',
            top: cardTop,
            left: 24,
            right: 24,
            opacity: fadeAnim,
            transform: [{ scale: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
          },
        ]}
      >
        {/* 絵文字 */}
        <View style={[s.emojiCircle, { backgroundColor: slide.color + '18' }]}>
          <Text style={s.emojiText}>{slide.emoji}</Text>
        </View>

        {/* タイトル・説明 */}
        <Text style={s.title}>{t(`tutorialSlides.slides.${slide.key}.title`)}</Text>
        <Text style={s.desc}>{t(`tutorialSlides.slides.${slide.key}.description`)}</Text>

        {/* タブ遷移ボタン */}
        {slide.navigateTo && (
          <TouchableOpacity
            onPress={() => router.push(slide.navigateTo as any)}
            style={[s.navBtn, { borderColor: slide.color }]}
            activeOpacity={0.75}
          >
            <Text style={[s.navBtnText, { color: slide.color }]}>{t(`tutorialSlides.slides.${slide.key}.navigateLabel`)}</Text>
          </TouchableOpacity>
        )}

        {/* ドット */}
        <View style={s.dotsRow}>
          {SLIDES.map((_, i) => (
            <TouchableOpacity key={i} onPress={() => animate(() => setStep(i))} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
              <View
                style={[
                  s.dot,
                  { backgroundColor: i === step ? slide.color : 'rgba(0,0,0,0.15)' },
                  i === step && { width: 18 },
                ]}
              />
            </TouchableOpacity>
          ))}
        </View>

        {/* ボタン行 */}
        <View style={s.btnRow}>
          <TouchableOpacity onPress={skipTutorial} style={s.skipBtn} activeOpacity={0.7}>
            <Text style={s.skipTxt}>{t('tutorialSlides.skip')}</Text>
          </TouchableOpacity>

          {step > 0 && (
            <TouchableOpacity onPress={goPrev} style={s.prevBtn} activeOpacity={0.75}>
              <Ionicons name="chevron-back" size={18} color="#888" />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={goNext}
            style={[s.nextBtn, { backgroundColor: slide.color }]}
            activeOpacity={0.85}
          >
            <Text style={s.nextTxt}>{isLast ? t('tutorialSlides.start') : t('tutorialSlides.next')}</Text>
            {!isLast && <Ionicons name="chevron-forward" size={16} color="#fff" />}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  )
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 28,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 16,
  },
  emojiCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  emojiText:  { fontSize: 46 },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: '#111',
    textAlign: 'center',
    marginBottom: 8,
  },
  desc: {
    fontSize: 14,
    color: '#555',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 14,
  },
  navBtn: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  navBtnText: { fontSize: 13, fontWeight: '700' },
  dotsRow: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: 18,
    alignItems: 'center',
  },
  dot: {
    height: 6,
    width: 6,
    borderRadius: 3,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  skipBtn: { paddingVertical: 10, paddingHorizontal: 12 },
  skipTxt:  { fontSize: 13, color: '#bbb' },
  prevBtn: {
    width: 40, height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 13,
    borderRadius: 24,
  },
  nextTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
})

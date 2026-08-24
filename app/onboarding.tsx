// app/onboarding.tsx — 統合オンボーディング
// 画面フロー: イントロカルーセル(価値提案・旧auth.tsxのSlide1-5を移設) →
//            クエスト(name/category/event/experience、ソフトグリーン演出) →
//            プラン生成演出 → リビール → handleFinish()（/auth または /(tabs)、後続は不変）
// /auth はログインボタン(旧Slide6)のみの単一画面に簡略化（ログイン部分そのものは一切変更していない）

import React, { useRef, useState, useCallback, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, TextInput, ScrollView, Platform,
  KeyboardAvoidingView, Dimensions, PanResponder, Easing,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { getEventLabel } from '../lib/eventLabels'
import { getPrefectureLabel, getRegionLabel } from '../lib/prefectureLabels'
import { grantStarterTicketsIfNeeded } from '../lib/ticketWallet'
import { BRAND, TEXT } from '../lib/theme'
import { useTutorial } from '../lib/tutorialContext'
import { Sounds, unlockAudio } from '../lib/sounds'
import type { AthleticsEvent, EventCategory } from '../types'

const QUIZ_STEPS = 4
const { width: SW } = Dimensions.get('window')
const RED     = BRAND   // アプリ全体のグリーンに統一（旧: 赤 #E53E3E）
const BLUE    = '#5AC8FA'
const GREEN   = '#34C759'
const I_AMBER = '#FF9500'

// ── クエスト用ソフトグリーン配色 ────────────────────────────
const G1     = '#22c55e'
const G2     = BRAND   // #166534
const TINT   = '#f0fdf4'
const SBORDER= '#d7ecdf'
const GRAD   = [G1, G2] as const

// ════════════════════════════════════════════════════════════════
// イントロカルーセル（旧 app/auth.tsx Slide1〜5 を移設。内容は不変）
// ════════════════════════════════════════════════════════════════

function useFadeUp(isActive: boolean, delay = 0) {
  const opacity = useRef(new Animated.Value(0)).current
  const ty      = useRef(new Animated.Value(30)).current
  React.useEffect(() => {
    if (isActive) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 560, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.spring(ty,      { toValue: 0, delay, tension: 60, friction: 10, useNativeDriver: true }),
      ]).start()
    } else {
      opacity.setValue(0); ty.setValue(30)
    }
  }, [isActive])
  return { opacity, transform: [{ translateY: ty }] } as any
}

function useFadeX(isActive: boolean, fromX: number, delay = 0) {
  const opacity = useRef(new Animated.Value(0)).current
  const tx      = useRef(new Animated.Value(fromX)).current
  React.useEffect(() => {
    if (isActive) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 560, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.spring(tx,      { toValue: 0, delay, tension: 60, friction: 10, useNativeDriver: true }),
      ]).start()
    } else {
      opacity.setValue(0); tx.setValue(fromX)
    }
  }, [isActive])
  return { opacity, transform: [{ translateX: tx }] } as any
}

function useScaleFade(isActive: boolean, delay = 0) {
  const opacity = useRef(new Animated.Value(0)).current
  const scale   = useRef(new Animated.Value(0.85)).current
  React.useEffect(() => {
    if (isActive) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 500, delay, useNativeDriver: true }),
        Animated.spring(scale,   { toValue: 1, delay, tension: 70, friction: 9, useNativeDriver: true }),
      ]).start()
    } else {
      opacity.setValue(0); scale.setValue(0.85)
    }
  }, [isActive])
  return { opacity, transform: [{ scale }] } as any
}

function useStagger(isActive: boolean, count: number, baseDelay = 0, step = 80) {
  const anims = useRef(Array.from({ length: count }, () => ({
    opacity: new Animated.Value(0),
    ty:      new Animated.Value(22),
  }))).current
  React.useEffect(() => {
    if (isActive) {
      Animated.parallel(anims.map((a, i) =>
        Animated.parallel([
          Animated.timing(a.opacity, { toValue: 1, duration: 480, delay: baseDelay + i * step, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.spring(a.ty,      { toValue: 0, delay: baseDelay + i * step, tension: 65, friction: 10, useNativeDriver: true }),
        ])
      )).start()
    } else {
      anims.forEach(a => { a.opacity.setValue(0); a.ty.setValue(22) })
    }
  }, [isActive])
  return anims.map(a => ({ opacity: a.opacity, transform: [{ translateY: a.ty }] }) as any)
}

function useArrowBounce() {
  const tx = useRef(new Animated.Value(0)).current
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(tx, { toValue: 8, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(tx, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]))
    loop.start(); return () => loop.stop()
  }, [])
  return tx
}

const CHECKLIST_IDS = ['a', 'b', 'c', 'd', 'e', 'f']

type SlideProps = { isActive: boolean }

function IntroSlide1({ isActive }: SlideProps) {
  const { t } = useTranslation()
  const arrowTx  = useArrowBounce()
  const logo     = useScaleFade(isActive, 0)
  const title    = useFadeUp(isActive, 160)
  const sub      = useFadeUp(isActive, 280)
  const badges   = useStagger(isActive, 3, 380, 110)
  const hint     = useFadeUp(isActive, 680)

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={sl.scrollContent} showsVerticalScrollIndicator={false} scrollEnabled={false}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {[...Array(5)].map((_, i) => (
          <View key={i} style={[sl.gridLine, { left: `${(i + 1) * (100 / 6)}%` as any }]} />
        ))}
      </View>
      <View style={sl.heroContent}>
        <Animated.View style={[sl.logoRow, logo]}>
          <View style={sl.logoMark}><Text style={sl.logoS}>S</Text></View>
          <View>
            <Text style={sl.logoName}>sCORE</Text>
            <Text style={sl.logoTagline}>{t('onboarding.intro.slide1.tagline')}</Text>
          </View>
        </Animated.View>
        <Animated.Text style={[sl.heroTitle, title]}>{t('onboarding.intro.slide1.heroTitle')}</Animated.Text>
        <Animated.Text style={[sl.heroSub, sub]}>{t('onboarding.intro.slide1.heroSub')}</Animated.Text>
        <View style={sl.scoreRow}>
          {([
            { label: t('onboarding.intro.slide1.sleepScore'), val: '87', color: BLUE,    icon: '😴' },
            { label: t('onboarding.intro.slide1.fatigue'),    val: '42', color: I_AMBER, icon: '⚡' },
            { label: t('onboarding.intro.slide1.condition'),  val: '91', color: GREEN,   icon: '💪' },
          ]).map((item, i) => (
            <Animated.View key={item.label} style={[sl.scoreBadge, { borderColor: item.color + '40' }, badges[i]]}>
              <Text style={{ fontSize: 18 }}>{item.icon}</Text>
              <Text style={[sl.scoreVal, { color: item.color }]}>{item.val}</Text>
              <Text style={sl.scoreLabel}>{item.label}</Text>
            </Animated.View>
          ))}
        </View>
        <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }, hint]}>
          <Text style={sl.hintText}>{t('onboarding.intro.slide1.nextPage')}</Text>
          <Animated.View style={{ transform: [{ translateX: arrowTx }] }}>
            <Ionicons name="arrow-forward" size={14} color="#9ca3af" />
          </Animated.View>
        </Animated.View>
      </View>
    </ScrollView>
  )
}

function IntroSlide2({ isActive }: SlideProps) {
  const { t } = useTranslation()
  const featureText = t('onboarding.intro.slide2.features', { returnObjects: true }) as { title: string; desc: string }[]
  const features = [
    { icon: '📊', color: RED,     ...featureText[0] },
    { icon: '🤖', color: BLUE,    ...featureText[1] },
    { icon: '⚡', color: I_AMBER, ...featureText[2] },
    { icon: '🎯', color: GREEN,   ...featureText[3] },
  ]
  const header = useFadeUp(isActive, 0)
  const cards  = useStagger(isActive, 4, 180, 100)

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={sl.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={sl.slideInner}>
        <Animated.View style={header}>
          <Text style={sl.tag}>{t('onboarding.intro.slide2.tag')}</Text>
          <Text style={sl.sectionTitle}>{t('onboarding.intro.slide2.title')}</Text>
          <Text style={sl.sectionSub}>{t('onboarding.intro.slide2.subtitle')}</Text>
        </Animated.View>
        <View style={{ gap: 12, marginTop: 24 }}>
          {features.map((f, i) => (
            <Animated.View key={f.title} style={[ft.card, cards[i]]}>
              <View style={[ft.iconWrap, { backgroundColor: f.color + '16' }]}><Text style={{ fontSize: 24 }}>{f.icon}</Text></View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[ft.title, { color: f.color }]}>{f.title}</Text>
                <Text style={ft.desc}>{f.desc}</Text>
              </View>
            </Animated.View>
          ))}
        </View>
      </View>
    </ScrollView>
  )
}

function IntroSlide3({ isActive }: SlideProps) {
  const { t } = useTranslation()
  const checklistText = t('onboarding.intro.slide3.checklist', { returnObjects: true }) as string[]
  const CHECKLIST = CHECKLIST_IDS.map((id, i) => ({ id, text: checklistText[i] }))
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setChecked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const header = useFadeUp(isActive, 0)
  const items  = useStagger(isActive, CHECKLIST.length, 160, 65)

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={sl.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={sl.slideInner}>
        <Animated.View style={header}>
          <Text style={sl.tag}>{t('onboarding.intro.slide3.tag')}</Text>
          <Text style={sl.sectionTitle}>{t('onboarding.intro.slide3.title')}</Text>
          <Text style={sl.sectionSub}>{t('onboarding.intro.slide3.subtitle')}</Text>
        </Animated.View>
        <View style={{ gap: 10, marginTop: 22 }}>
          {CHECKLIST.map((item, i) => {
            const on = checked.has(item.id)
            return (
              <Animated.View key={item.id} style={items[i]}>
                <TouchableOpacity style={[ck.row, on && ck.rowActive]} onPress={() => toggle(item.id)} activeOpacity={0.75}>
                  <View style={[ck.box, on && ck.boxActive]}>{on && <Ionicons name="checkmark" size={12} color="#fff" />}</View>
                  <Text style={[ck.text, on && { color: '#111827' }]}>{item.text}</Text>
                  {on && <Ionicons name="checkmark-circle" size={16} color={RED} />}
                </TouchableOpacity>
              </Animated.View>
            )
          })}
        </View>
        {checked.size > 0 && (
          <View style={ck.resultCard}>
            <Text style={ck.resultNum}>{checked.size}</Text>
            <View style={{ flex: 1 }}>
              <Text style={ck.resultTitle}>{t('onboarding.intro.slide3.resultSuffix')}</Text>
              <Text style={ck.resultSub}>{t('onboarding.intro.slide3.resultSub')}</Text>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  )
}

function IntroSlide4({ isActive }: SlideProps) {
  const { t: tr } = useTranslation()
  const before = tr('onboarding.intro.slide4.before', { returnObjects: true }) as string[]
  const after  = tr('onboarding.intro.slide4.after', { returnObjects: true }) as string[]
  const header  = useFadeUp(isActive, 0)
  const leftCol = useFadeX(isActive, -50, 220)
  const rightCol= useFadeX(isActive,  50, 360)

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={sl.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={sl.slideInner}>
        <Animated.View style={header}>
          <Text style={sl.tag}>{tr('onboarding.intro.slide4.tag')}</Text>
          <Text style={sl.sectionTitle}>{tr('onboarding.intro.slide4.title')}</Text>
          <Text style={[sl.sectionSub, { marginBottom: 24 }]}>{tr('onboarding.intro.slide4.subtitle')}</Text>
        </Animated.View>
        <View style={cp.wrap}>
          <Animated.View style={[cp.col, leftCol]}>
            <View style={cp.head}><Ionicons name="close-circle" size={14} color="#555" /><Text style={cp.headLabel}>{tr('onboarding.intro.slide4.beforeLabel')}</Text></View>
            {before.map((t, i) => (
              <View key={i} style={[cp.row, i > 0 && cp.rowBorder]}><Text style={cp.iconBad}>✗</Text><Text style={cp.textOld}>{t}</Text></View>
            ))}
          </Animated.View>
          <Animated.View style={[cp.col, cp.colGood, rightCol]}>
            <View style={[cp.head, cp.headGood]}><Ionicons name="checkmark-circle" size={14} color={RED} /><Text style={[cp.headLabel, { color: RED }]}>{tr('onboarding.intro.slide4.afterLabel')}</Text></View>
            {after.map((t, i) => (
              <View key={i} style={[cp.row, i > 0 && cp.rowBorder]}><Text style={cp.iconGood}>✓</Text><Text style={cp.textNew}>{t}</Text></View>
            ))}
          </Animated.View>
        </View>
      </View>
    </ScrollView>
  )
}

function IntroSlide5({ isActive }: SlideProps) {
  const { t } = useTranslation()
  const header = useFadeUp(isActive, 0)
  const card   = useScaleFade(isActive, 240)

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={sl.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={sl.slideInner}>
        <Animated.View style={header}>
          <Text style={sl.tag}>{t('onboarding.intro.slide5.tag')}</Text>
          <Text style={sl.sectionTitle}>{t('onboarding.intro.slide5.title')}</Text>
        </Animated.View>
        <Animated.View style={[dv.card, card]}>
          <View style={dv.accent} />
          <View style={{ flex: 1, gap: 0 }}>
            <Text style={dv.openQuote}>"</Text>
            <Text style={dv.msg}>{t('onboarding.intro.slide5.message')}</Text>
            <View style={dv.sigRow}><View style={dv.sigLine} /><Text style={dv.sig}>{t('onboarding.intro.slide5.signature')}</Text></View>
          </View>
        </Animated.View>
      </View>
    </ScrollView>
  )
}

const INTRO_SLIDES: Array<(p: SlideProps) => React.ReactElement> = [IntroSlide1, IntroSlide2, IntroSlide3, IntroSlide4, IntroSlide5]
const INTRO_TOTAL = INTRO_SLIDES.length

function IntroCarousel({ onFinish }: { onFinish: () => void }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(0)
  const pageRef    = useRef(0)
  const goToRef    = useRef<(n: number) => void>(() => {})
  const translateX = useRef(new Animated.Value(0)).current

  const goTo = useCallback((idx: number) => {
    const target = Math.max(0, Math.min(INTRO_TOTAL - 1, idx))
    Animated.spring(translateX, { toValue: -target * SW, tension: 80, friction: 16, useNativeDriver: true }).start()
    pageRef.current = target
    setPage(target)
  }, [])
  useEffect(() => { goToRef.current = goTo }, [goTo])

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy }) => Math.abs(dx) > Math.abs(dy) + 5 && Math.abs(dx) > 10,
      onMoveShouldSetPanResponderCapture: (_, { dx, dy }) => Math.abs(dx) > Math.abs(dy) + 5 && Math.abs(dx) > 10,
      onPanResponderRelease: (_, { dx }) => {
        if (dx < -50 && pageRef.current < INTRO_TOTAL - 1) goToRef.current(pageRef.current + 1)
        else if (dx > 50 && pageRef.current > 0) goToRef.current(pageRef.current - 1)
      },
    })
  ).current

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
      <View style={{ flex: 1, overflow: 'hidden' }} {...panResponder.panHandlers}>
        <Animated.View style={{ flexDirection: 'row', width: SW * INTRO_TOTAL, flex: 1, transform: [{ translateX }] }}>
          {INTRO_SLIDES.map((SlideComp, i) => (
            <View key={i} style={{ width: SW, flex: 1 }}><SlideComp isActive={page === i} /></View>
          ))}
        </Animated.View>
      </View>
      <View style={nav.bar}>
        <View style={nav.dotsRow}>
          {INTRO_SLIDES.map((_, i) => (
            <TouchableOpacity key={i} onPress={() => goTo(i)} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
              <Animated.View style={[nav.dot, i === page && nav.dotActive]} />
            </TouchableOpacity>
          ))}
        </View>
        <View style={nav.btnRow}>
          {page > 0 ? (
            <TouchableOpacity style={nav.backBtn} onPress={() => goTo(page - 1)} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={16} color="rgba(0,0,0,0.4)" />
              <Text style={nav.backText}>{t('onboarding.intro.back')}</Text>
            </TouchableOpacity>
          ) : <View style={{ flex: 1 }} />}
          <TouchableOpacity
            onPress={() => { Sounds.tap(); if (page < INTRO_TOTAL - 1) goTo(page + 1); else onFinish() }}
            activeOpacity={0.85}
          >
            <View style={[nav.nextBtn, { backgroundColor: G2 }]}>
              <Text style={nav.nextText}>{page === INTRO_TOTAL - 1 ? t('onboarding.intro.startQuest') : t('onboarding.intro.next')}</Text>
              <Ionicons name={page === INTRO_TOTAL - 1 ? 'sparkles' : 'chevron-forward'} size={16} color="#fff" />
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

// ════════════════════════════════════════════════════════════════
// クエスト（プロフィール入力・ソフトグリーン演出）
// ════════════════════════════════════════════════════════════════

function buildCategories(t: (key: string) => string) {
  return [
    { key: 'sprint', label: t('onboarding.categories.sprint.label'), icon: 'flash-outline' as const, sub: t('onboarding.categories.sprint.sub') },
    { key: 'middle', label: t('onboarding.categories.middle.label'), icon: 'flame-outline' as const, sub: t('onboarding.categories.middle.sub') },
    { key: 'long',   label: t('onboarding.categories.long.label'),   icon: 'ellipse-outline' as const, sub: t('onboarding.categories.long.sub') },
    { key: 'field',  label: t('onboarding.categories.field.label'),  icon: 'medal-outline' as const, sub: t('onboarding.categories.field.sub') },
  ]
}

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

// フィールド種目は内部値(データ)が日本語のため、表示だけ getEventLabel() で言語に応じたラベルに変換する。
// 距離種目(100m等)は言語非依存なのでそのまま。

function buildExperienceOptions(t: (key: string) => string) {
  return [
    { key: 0,  label: t('onboarding.experience.beginner.label'),     sub: t('onboarding.experience.beginner.sub') },
    { key: 2,  label: t('onboarding.experience.intermediate.label'), sub: t('onboarding.experience.intermediate.sub') },
    { key: 5,  label: t('onboarding.experience.experienced.label'),  sub: t('onboarding.experience.experienced.sub') },
    { key: 10, label: t('onboarding.experience.veteran.label'),      sub: t('onboarding.experience.veteran.sub') },
  ]
}

const PREFS_BY_REGION: { region: string; prefs: string[] }[] = [
  { region: '北海道', prefs: ['北海道'] },
  { region: '東北', prefs: ['青森', '岩手', '宮城', '秋田', '山形', '福島'] },
  { region: '関東', prefs: ['茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川'] },
  { region: '中部', prefs: ['新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知'] },
  { region: '近畿', prefs: ['三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山'] },
  { region: '中国', prefs: ['鳥取', '島根', '岡山', '広島', '山口'] },
  { region: '四国', prefs: ['徳島', '香川', '愛媛', '高知'] },
  { region: '九州・沖縄', prefs: ['福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'] },
]

function buildStepHeadline(t: (key: string) => string): Record<number, string> {
  return {
    1: t('onboarding.step.headline1'), 2: t('onboarding.step.headline2'),
    3: t('onboarding.step.headline3'), 4: t('onboarding.step.headline4'),
  }
}
function buildStepSub(t: (key: string) => string): Record<number, string> {
  return {
    1: t('onboarding.step.sub1'), 2: t('onboarding.step.sub2'),
    3: t('onboarding.step.sub3'), 4: t('onboarding.step.sub4'),
  }
}
const STEP_ICON: Record<number, keyof typeof Ionicons.glyphMap> = {
  1: 'person-outline', 2: 'grid-outline', 3: 'flag-outline', 4: 'stats-chart-outline',
}

function ProgressHeader({ step, onBack, onSkip, showBack }: { step: number; onBack: () => void; onSkip: () => void; showBack: boolean }) {
  const { t } = useTranslation()
  return (
    <View style={styles.progressHeader}>
      {showBack ? (
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={20} color={TEXT.hint} />
        </TouchableOpacity>
      ) : <View style={{ width: 28 }} />}
      <View style={styles.progressTrack}>
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: `${(step / QUIZ_STEPS) * 100}%` }]} />
      </View>
      <TouchableOpacity onPress={onSkip} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.skipText}>{step < QUIZ_STEPS ? t('onboarding.skip') : ' '}</Text>
      </TouchableOpacity>
    </View>
  )
}

function IconBlob({ icon, pulse }: { icon: keyof typeof Ionicons.glyphMap; pulse?: Animated.Value }) {
  return (
    <View style={styles.blobWrap}>
      <Animated.View style={pulse ? { transform: [{ scale: pulse }] } : undefined}>
        <LinearGradient colors={GRAD} start={{ x: 0.3, y: 0.2 }} end={{ x: 1, y: 1 }} style={styles.blob}>
          <Ionicons name={icon} size={32} color="#fff" />
        </LinearGradient>
      </Animated.View>
      <View style={styles.dotsBadge}><Text style={styles.dotsBadgeText}>•••</Text></View>
    </View>
  )
}

function GradientButton({ onPress, disabled, label, icon }: { onPress: () => void; disabled?: boolean; label: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.85} style={disabled ? { opacity: 0.4 } : undefined}>
      <View style={[styles.gradientBtn, { backgroundColor: G2 }]}>
        <Text style={styles.gradientBtnText}>{label}</Text>
        <Ionicons name={icon} size={17} color="#fff" />
      </View>
    </TouchableOpacity>
  )
}

function CategoryCard({ label, icon, selected, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; selected: boolean; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current
  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.spring(scale,  { toValue: 1,    tension: 300, friction: 10, useNativeDriver: true }),
    ]).start()
    onPress()
  }
  return (
    <Animated.View style={{ transform: [{ scale }], width: '48%' }}>
      <TouchableOpacity style={[styles.card, selected && styles.cardSelected]} onPress={handlePress} activeOpacity={1}>
        <View style={[styles.cardAvatar, selected && styles.cardAvatarSelected]}>
          <Ionicons name={icon} size={24} color={selected ? G2 : TEXT.hint} />
        </View>
        <Text style={[styles.cardLabel, selected && { color: G2 }]}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  )
}

function Chip({
  label, sub, selected, onPress,
}: {
  label: string; sub?: string; selected: boolean; onPress: () => void
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
      <TouchableOpacity style={[styles.chip, selected && styles.chipSelected]} onPress={handlePress} activeOpacity={1}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.chipLabel, selected && { color: G2 }]}>{label}</Text>
          {sub ? <Text style={styles.chipSub}>{sub}</Text> : null}
        </View>
        {selected
          ? <View style={styles.checkBadge}><Ionicons name="checkmark" size={13} color="#fff" /></View>
          : <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: SBORDER }} />
        }
      </TouchableOpacity>
    </Animated.View>
  )
}

// ════════════════════════════════════════════════════════════════
// メイン
// ════════════════════════════════════════════════════════════════

export default function OnboardingScreen() {
  const router  = useRouter()
  const { t } = useTranslation()
  const { startTutorial } = useTutorial()
  const { user, isGuest, setOnboarded } = useAuth()
  const { language } = useLanguage()

  const CATEGORIES = buildCategories(t)
  const EXPERIENCE_OPTIONS = buildExperienceOptions(t)
  const STEP_HEADLINE = buildStepHeadline(t)
  const STEP_SUB = buildStepSub(t)
  const PROCESSING_ITEMS = t('onboarding.processing.items', { returnObjects: true }) as string[]

  const [phase, setPhase] = useState<'intro' | 'quiz' | 'processing' | 'reveal'>('intro')
  const [step,       setStep]       = useState(1)   // クエスト内: 1-4
  const [name,       setName]       = useState('')
  const [category,   setCategory]   = useState<string>('sprint')
  const [event,      setEvent]      = useState<AthleticsEvent | ''>('100m')
  const [experience, setExperience] = useState<number>(2)
  const [age,        setAge]        = useState('')
  const [pb,         setPb]         = useState('')
  const [prefecture, setPrefecture] = useState('')
  const [processingIdx, setProcessingIdx] = useState(0)

  const fadeAnim   = useRef(new Animated.Value(1)).current
  const pulse      = useRef(new Animated.Value(1)).current
  const revealPop  = useRef(new Animated.Value(0)).current
  const isAnimating = useRef(false)

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])

  const transition = useCallback((action: () => void) => {
    if (isAnimating.current) return
    isAnimating.current = true
    Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      action()
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start(() => {
        isAnimating.current = false
      })
    })
  }, [fadeAnim])

  const goNext = useCallback((nextStep: number) => {
    unlockAudio(); Sounds.pop()
    transition(() => setStep(nextStep))
  }, [transition])

  const goBack = useCallback(() => {
    if (step <= 1) { unlockAudio(); Sounds.tap(); setPhase('intro'); return }
    Sounds.tap()
    transition(() => setStep(s => s - 1))
  }, [step, transition])

  const handleCategorySelect = useCallback((key: string) => {
    Sounds.tap()
    if (key !== category) { setCategory(key); setEvent('') }
  }, [category])

  // ── プラン生成演出（自動進行） ─────────────────────────────
  useEffect(() => {
    if (phase !== 'processing') return
    setProcessingIdx(0)
    const timers: ReturnType<typeof setTimeout>[] = []
    PROCESSING_ITEMS.forEach((_, i) => {
      timers.push(setTimeout(() => setProcessingIdx(i + 1), 550 + i * 650))
    })
    timers.push(setTimeout(() => {
      Sounds.save()
      revealPop.setValue(0)
      setPhase('reveal')
    }, 550 + PROCESSING_ITEMS.length * 650 + 350))
    return () => timers.forEach(clearTimeout)
  }, [phase])

  useEffect(() => {
    if (phase !== 'reveal') return
    Animated.spring(revealPop, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }).start()
  }, [phase])

  const handleFinish = useCallback(async () => {
    unlockAudio(); Sounds.save()

    const profile = {
      id: user?.id ?? 'guest',
      name: name.trim() || (user?.email?.split('@')[0] ?? t('onboarding.defaultAthleteName')),
      primary_event: event || '100m',
      event_category: (category || 'sprint') as EventCategory,
      secondary_events: [],
      age: age ? Number(age) : undefined,
      experience_years: experience >= 0 ? experience : undefined,
      personal_best_ms: pb.trim() ? (parsePbToMs(pb.trim()) ?? undefined) : undefined,
      target_time_ms: undefined as number | undefined,
      prefecture: prefecture || undefined,
      created_at: new Date().toISOString(),
    }

    await AsyncStorage.setItem('trackmate_my_profile', JSON.stringify(profile)).catch(() => {})

    if (user?.id) {
      try {
        const { supabase: sb } = await import('../lib/supabase')
        await sb.from('profiles').upsert({
          user_id: user.id,
          name: profile.name,
          primary_event: profile.primary_event,
          event_category: profile.event_category,
          age: profile.age ?? null,
          experience_years: profile.experience_years ?? null,
          prefecture: prefecture || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }).then(() => {})
      } catch { /* 同期失敗はサイレント */ }
    }

    const authed = !!user?.id || isGuest
    await setOnboarded()
    await grantStarterTicketsIfNeeded()
    if (!authed) {
      router.replace('/auth')
    } else {
      router.replace('/(tabs)')
      setTimeout(() => startTutorial(), 800)
    }
  }, [name, event, category, experience, age, pb, prefecture, user, isGuest, setOnboarded, router, startTutorial])

  const canNextStep1 = name.trim().length >= 1
  const canNextStep2 = category !== ''
  const canNextStep3 = event !== ''
  const expLabel = EXPERIENCE_OPTIONS.find(o => o.key === experience)?.label ?? EXPERIENCE_OPTIONS[1].label

  // ── イントロカルーセル ────────────────────────────────────
  if (phase === 'intro') {
    return <IntroCarousel onFinish={() => { unlockAudio(); Sounds.pop(); setPhase('quiz') }} />
  }

  // ── プラン生成演出 ────────────────────────────────────────
  if (phase === 'processing') {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <SafeAreaView style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ maxWidth: 600, alignSelf: 'center', width: '100%', paddingHorizontal: 32 }}>
            <IconBlob icon="sync-outline" pulse={pulse} />
            <Text style={styles.processingTitle}>{t('onboarding.processing.title')}</Text>
            <View style={{ marginTop: 24, gap: 12 }}>
              {PROCESSING_ITEMS.map((item, i) => (
                <View key={item} style={styles.processRow}>
                  {i < processingIdx
                    ? <View style={styles.processDone}><Ionicons name="checkmark" size={13} color="#fff" /></View>
                    : <View style={styles.processPending} />
                  }
                  <Text style={[styles.processText, i < processingIdx && { color: TEXT.primary, fontWeight: '700' }]}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        </SafeAreaView>
      </View>
    )
  }

  // ── リビール ──────────────────────────────────────────────
  if (phase === 'reveal') {
    const displayName = name.trim() || t('onboarding.reveal.defaultName')
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ flex: 1, maxWidth: 600, alignSelf: 'center', width: '100%', paddingHorizontal: 24 }}>
            <Animated.View
              style={{
                flex: 1, justifyContent: 'center', alignItems: 'center',
                opacity: revealPop,
                transform: [{ scale: revealPop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
              }}
            >
              <LinearGradient colors={GRAD} start={{ x: 0.2, y: 0 }} end={{ x: 1, y: 1 }} style={styles.revealIcon}>
                <Ionicons name="checkmark" size={36} color="#fff" />
              </LinearGradient>
              <View style={styles.doneBadge}><Text style={styles.doneBadgeText}>{t('onboarding.reveal.badge')}</Text></View>
              <Text style={styles.revealTitle}>{t('onboarding.reveal.title', { name: displayName })}</Text>
              <View style={styles.statCard}>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>{t('onboarding.reveal.event')}</Text>
                  <Text style={styles.statValue}>{getEventLabel(event, language)}</Text>
                </View>
                <View style={styles.statRow}><Text style={styles.statLabel}>{t('onboarding.reveal.level')}</Text><Text style={styles.statValue}>{expLabel}</Text></View>
                <View style={styles.statRow}><Text style={styles.statLabel}>{t('onboarding.reveal.nextGoal')}</Text><Text style={styles.statValue}>{t('onboarding.reveal.nextGoalValue')}</Text></View>
              </View>
            </Animated.View>
            <SafeAreaView edges={['bottom']}>
              <GradientButton label={t('onboarding.reveal.startButton')} icon="arrow-forward" onPress={() => handleFinish()} />
            </SafeAreaView>
          </View>
        </SafeAreaView>
      </View>
    )
  }

  // ── クエスト（プロフィール入力） ───────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ flex: 1, maxWidth: 600, alignSelf: 'center', width: '100%' }}>
        <SafeAreaView>
          <ProgressHeader
            step={step}
            showBack
            onBack={goBack}
            onSkip={() => { Sounds.tap(); transition(() => setStep(s => Math.min(s + 1, QUIZ_STEPS))) }}
          />
        </SafeAreaView>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <IconBlob icon={STEP_ICON[step]} />
              <Text style={styles.headline}>{STEP_HEADLINE[step]}</Text>
              <Text style={styles.subline}>{STEP_SUB[step]}</Text>

              {step === 1 && (
                <View style={{ gap: 20, marginTop: 22 }}>
                  <View style={styles.inputWrap}>
                    <Ionicons name="person-outline" size={18} color={TEXT.hint} />
                    <TextInput
                      style={styles.input}
                      placeholder={t('onboarding.namePlaceholder')}
                      placeholderTextColor={TEXT.hint}
                      value={name}
                      onChangeText={setName}
                      maxLength={20}
                      returnKeyType="done"
                      onSubmitEditing={() => canNextStep1 && goNext(2)}
                      autoFocus
                    />
                  </View>
                </View>
              )}

              {step === 2 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
                  {CATEGORIES.map(c => (
                    <CategoryCard key={c.key} icon={c.icon} label={c.label} selected={category === c.key} onPress={() => handleCategorySelect(c.key)} />
                  ))}
                </View>
              )}

              {step === 3 && (
                <View style={{ gap: 8, marginTop: 22 }}>
                  {(EVENTS_BY_CATEGORY[category] ?? EVENTS_BY_CATEGORY.sprint).map(e => (
                    <Chip key={e.key} label={getEventLabel(e.key, language)} selected={event === e.key} onPress={() => { setEvent(e.key); Sounds.tap() }} />
                  ))}
                </View>
              )}

              {step === 4 && (
                <View style={{ gap: 22, marginTop: 22 }}>
                  <View style={{ gap: 10 }}>
                    <Text style={styles.sectionLabel}>{t('onboarding.fields.experienceLabel')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {EXPERIENCE_OPTIONS.map(opt => (
                        <TouchableOpacity
                          key={opt.key}
                          style={[styles.expBtn, experience === opt.key && styles.expBtnActive]}
                          onPress={() => { setExperience(opt.key); Sounds.tap() }}
                          activeOpacity={0.75}
                        >
                          <Text style={[styles.expLabel, experience === opt.key && { color: G2 }]}>{opt.label}</Text>
                          <Text style={[styles.expSub, experience === opt.key && { color: G2 }]}>{opt.sub}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View style={{ gap: 8 }}>
                    <Text style={styles.sectionLabel}>{t('onboarding.fields.ageLabel')}</Text>
                    <View style={styles.inputWrap}>
                      <Ionicons name="calendar-outline" size={18} color={TEXT.hint} />
                      <TextInput
                        style={styles.input}
                        placeholder={t('onboarding.fields.agePlaceholder')}
                        placeholderTextColor={TEXT.hint}
                        value={age}
                        onChangeText={v => setAge(v.replace(/\D/g, ''))}
                        keyboardType="number-pad"
                        maxLength={3}
                      />
                      <Text style={{ color: TEXT.hint, fontSize: 14 }}>{t('onboarding.fields.ageUnit')}</Text>
                    </View>
                  </View>

                  <View style={{ gap: 8 }}>
                    <Text style={styles.sectionLabel}>{t('onboarding.fields.regionLabel')}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                      <View style={{ flexDirection: 'row', flexWrap: 'nowrap', gap: 0, paddingHorizontal: 4 }}>
                        {PREFS_BY_REGION.map(({ region, prefs }) => (
                          <View key={region} style={{ marginRight: 14 }}>
                            <Text style={{ fontSize: 10, color: TEXT.hint, fontWeight: '700', marginBottom: 4 }}>{getRegionLabel(region, language)}</Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, maxWidth: prefs.length <= 2 ? 90 : 200 }}>
                              {prefs.map(p => (
                                <TouchableOpacity
                                  key={p}
                                  onPress={() => { setPrefecture(prefecture === p ? '' : p); Sounds.tap() }}
                                  style={{
                                    paddingHorizontal: 10, paddingVertical: 5,
                                    borderRadius: 8, borderWidth: 1.5,
                                    borderColor: prefecture === p ? G1 : SBORDER,
                                    backgroundColor: prefecture === p ? TINT : '#fff',
                                  }}
                                >
                                  <Text style={{ fontSize: 12, fontWeight: '600', color: prefecture === p ? G2 : TEXT.secondary }}>{getPrefectureLabel(p, language)}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                    <Text style={styles.inputHint}>{t('onboarding.fields.regionHint')}</Text>
                  </View>

                  <View style={{ gap: 8 }}>
                    <Text style={styles.sectionLabel}>{t('onboarding.fields.pbLabel', { event: event ? getEventLabel(event, language) : t('onboarding.fields.pbLabelDefault') })}</Text>
                    <View style={styles.inputWrap}>
                      <Ionicons name="trophy-outline" size={18} color={TEXT.hint} />
                      <TextInput
                        style={styles.input}
                        placeholder={
                          category === 'field' ? t('onboarding.fields.pbPlaceholderField') :
                          (event?.startsWith('5') || event?.startsWith('10') || event?.includes('marathon'))
                            ? t('onboarding.fields.pbPlaceholderLong')
                            : event?.startsWith('8') || event === '1500m' || event === '3000m' || event === '3000mSC'
                            ? t('onboarding.fields.pbPlaceholderMiddle')
                            : t('onboarding.fields.pbPlaceholderShort')
                        }
                        placeholderTextColor={TEXT.hint}
                        value={pb}
                        onChangeText={setPb}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <Text style={styles.inputHint}>
                      {category === 'field' ? t('onboarding.fields.pbHintField') : t('onboarding.fields.pbHintTrack')}
                    </Text>
                  </View>
                </View>
              )}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>

        <SafeAreaView edges={['bottom']}>
          <View style={styles.bottomBar}>
            <GradientButton
              label={step === QUIZ_STEPS ? t('onboarding.quiz.createPlan') : t('onboarding.quiz.next')}
              icon={step === QUIZ_STEPS ? 'sparkles' : 'arrow-forward'}
              disabled={(step === 1 && !canNextStep1) || (step === 2 && !canNextStep2) || (step === 3 && !canNextStep3)}
              onPress={() => {
                if (step === 1 && !canNextStep1) return
                if (step === 2 && !canNextStep2) return
                if (step === 3 && !canNextStep3) return
                if (step === QUIZ_STEPS) { unlockAudio(); Sounds.pop(); setPhase('processing'); return }
                goNext(step + 1)
              }}
            />
          </View>
        </SafeAreaView>
      </View>
    </View>
  )
}

// ── PBをミリ秒に変換 ─────────────────────────────────────
function parsePbToMs(input: string): number | null {
  const mMatch = input.match(/^(\d+):(\d+(?:\.\d+)?)$/)
  if (mMatch) return Math.round((parseInt(mMatch[1], 10) * 60 + parseFloat(mMatch[2])) * 1000)
  const sMatch = input.match(/^\d+(?:\.\d+)?$/)
  if (sMatch) return Math.round(parseFloat(input) * 1000)
  return null
}

// ════════════════════════════════════════════════════════════════
// スタイル
// ════════════════════════════════════════════════════════════════

// ── イントロカルーセル用（旧auth.tsxより移設） ──────────────
const sl = StyleSheet.create({
  scrollContent: { flexGrow: 1, minHeight: '100%' as any },
  heroContent:   { flex: 1, padding: 28, paddingTop: 80, paddingBottom: 16, justifyContent: 'flex-end' },
  slideInner:    { padding: 26, paddingTop: 64, paddingBottom: 48 },
  gridLine:   { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(0,0,0,0.03)' },
  logoRow:    { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 36 },
  logoMark:   { width: 56, height: 56, borderRadius: 16, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  logoS:      { color: '#fff', fontSize: 30, fontWeight: '900' },
  logoName:   { color: '#111827', fontSize: 26, fontWeight: '900', letterSpacing: -1 },
  logoTagline:{ color: '#888', fontSize: 10, fontWeight: '600', letterSpacing: 1.5 },
  heroTitle:  { color: '#111827', fontSize: 38, fontWeight: '900', letterSpacing: -1.5, lineHeight: 48, marginBottom: 18 },
  heroSub:    { color: '#6b7280', fontSize: 14, lineHeight: 23, marginBottom: 36 },
  scoreRow:   { flexDirection: 'row', gap: 10, marginBottom: 20 },
  scoreBadge: { flex: 1, backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', padding: 14, alignItems: 'center', gap: 4 },
  scoreVal:   { fontSize: 24, fontWeight: '900' },
  scoreLabel: { color: '#888', fontSize: 9, fontWeight: '700', textAlign: 'center', letterSpacing: 0.3 },
  hintText:   { color: '#9ca3af', fontSize: 12 },
  tag:         { color: '#9ca3af', fontSize: 10, fontWeight: '800', letterSpacing: 2.5, marginBottom: 10 },
  sectionTitle:{ color: '#111827', fontSize: 27, fontWeight: '900', letterSpacing: -0.8, marginBottom: 10 },
  sectionSub:  { color: '#6b7280', fontSize: 14, lineHeight: 22 },
})
const ft = StyleSheet.create({
  card:    { flexDirection: 'row', alignItems: 'flex-start', gap: 14, backgroundColor: '#ffffff', borderRadius: 20, padding: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  iconWrap:{ width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title:   { fontSize: 13, fontWeight: '800', marginBottom: 5 },
  desc:    { color: '#6b7280', fontSize: 12, lineHeight: 18 },
})
const ck = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#ffffff', borderRadius: 18, borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)', padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  rowActive: { borderColor: RED + '50', backgroundColor: 'rgba(22,101,52,0.06)' },
  box:       { width: 22, height: 22, borderRadius: 8, borderWidth: 1.5, borderColor: '#ccc', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  boxActive: { backgroundColor: RED, borderColor: RED },
  text:      { flex: 1, color: '#6b7280', fontSize: 14, lineHeight: 20 },
  resultCard:{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18, backgroundColor: 'rgba(22,101,52,0.08)', borderRadius: 20, borderWidth: 1, borderColor: RED + '40', padding: 18 },
  resultNum: { fontSize: 48, fontWeight: '900', color: RED, lineHeight: 52 },
  resultTitle:{ color: '#111827', fontSize: 16, fontWeight: '800', marginBottom: 4 },
  resultSub:  { color: '#6b7280', fontSize: 12, lineHeight: 18 },
})
const cp = StyleSheet.create({
  wrap:     { flexDirection: 'row', gap: 10 },
  col:      { flex: 1, backgroundColor: '#ffffff', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  colGood:  { borderColor: RED + '40', backgroundColor: 'rgba(22,101,52,0.04)' },
  head:     { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12, backgroundColor: '#f0f2f5', justifyContent: 'center' },
  headGood: { backgroundColor: 'rgba(22,101,52,0.1)' },
  headLabel:{ color: '#6b7280', fontSize: 12, fontWeight: '800' },
  row:      { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10 },
  rowBorder:{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(0,0,0,0.06)' },
  iconBad:  { color: '#bbb', fontSize: 12, marginTop: 1 },
  iconGood: { color: GREEN, fontSize: 12, marginTop: 1 },
  textOld:  { flex: 1, color: '#9ca3af', fontSize: 11, lineHeight: 17 },
  textNew:  { flex: 1, color: '#111827', fontSize: 11, lineHeight: 17 },
})
const dv = StyleSheet.create({
  card:     { flexDirection: 'row', gap: 16, backgroundColor: '#ffffff', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', padding: 22, marginTop: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 2 },
  accent:   { width: 3, borderRadius: 2, backgroundColor: RED, flexShrink: 0 },
  openQuote:{ color: RED, fontSize: 52, fontWeight: '900', lineHeight: 44, marginBottom: 8 },
  msg:      { color: '#6b7280', fontSize: 14, lineHeight: 26 },
  sigRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
  sigLine:  { flex: 1, height: 1, backgroundColor: 'rgba(0,0,0,0.1)' },
  sig:      { color: '#9ca3af', fontSize: 12, fontStyle: 'italic' },
})
const nav = StyleSheet.create({
  bar:      { paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 36 : 22, paddingTop: 14,
    backgroundColor: 'rgba(246,246,248,0.97)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(0,0,0,0.08)' },
  dotsRow:  { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 14 },
  dot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: '#d1d5db' },
  dotActive:{ backgroundColor: RED, width: 22 },
  btnRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  backText: { color: 'rgba(0,0,0,0.4)', fontSize: 13, fontWeight: '600' },
  nextBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 50, paddingVertical: 14, paddingHorizontal: 24 },
  nextText: { color: '#fff', fontWeight: '900', fontSize: 14 },
})

// ── クエスト用（ソフトグリーン） ─────────────────────────────
const styles = StyleSheet.create({
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 4 },
  backBtn:   { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { flex: 1, height: 5, backgroundColor: '#eceae4', borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 3 },
  skipText:  { color: TEXT.hint, fontSize: 12, fontWeight: '700' },

  blobWrap: { alignItems: 'center', marginTop: 22, position: 'relative' },
  blob:     { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  dotsBadge: {
    position: 'absolute', top: -2, left: '58%', backgroundColor: '#fff', borderWidth: 1.5, borderColor: SBORDER,
    borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  dotsBadgeText: { fontSize: 10, fontWeight: '900', color: G2 },

  headline: { fontSize: 21, fontWeight: '900', color: TEXT.primary, textAlign: 'center', marginTop: 18, lineHeight: 29, letterSpacing: -0.3 },
  subline:  { fontSize: 12.5, color: TEXT.secondary, textAlign: 'center', marginTop: 8, lineHeight: 18, paddingHorizontal: 6 },
  sectionLabel: { color: TEXT.hint, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },

  content:    { padding: 24, paddingTop: 8, paddingBottom: 40, flexGrow: 1 },

  card: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: SBORDER, borderRadius: 18, paddingVertical: 16, paddingHorizontal: 10, alignItems: 'center' },
  cardSelected: { backgroundColor: TINT, borderColor: G1, borderWidth: 2 },
  cardAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  cardAvatarSelected: { backgroundColor: '#dcfce7' },
  cardLabel: { fontSize: 12.5, fontWeight: '800', color: TEXT.primary },

  chip: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 15, borderWidth: 1.5, borderColor: SBORDER },
  chipSelected: { backgroundColor: TINT, borderColor: G1 },
  chipLabel: { color: TEXT.primary, fontSize: 15, fontWeight: '700' },
  chipSub:   { color: TEXT.hint, fontSize: 12, marginTop: 2 },
  checkBadge: { width: 20, height: 20, borderRadius: 10, backgroundColor: G1, alignItems: 'center', justifyContent: 'center' },

  expBtn: { flex: 1, minWidth: '45%', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: SBORDER, gap: 3 },
  expBtnActive:  { backgroundColor: TINT, borderColor: G1 },
  expLabel:      { color: TEXT.primary, fontSize: 14, fontWeight: '700' },
  expSub:        { color: TEXT.hint, fontSize: 11 },

  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fafaf8', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 15, borderWidth: 1.5, borderColor: SBORDER },
  input:     { flex: 1, color: TEXT.primary, fontSize: 16, outlineStyle: 'none' as any },
  inputHint: { color: TEXT.hint, fontSize: 11, paddingLeft: 4 },

  bottomBar: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 8 },
  gradientBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 50, paddingVertical: 17,
    shadowColor: G2, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 16, elevation: 6 },
  gradientBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },

  revealIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  doneBadge: { marginTop: 14, backgroundColor: TINT, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  doneBadgeText: { color: G2, fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  revealTitle: { fontSize: 22, fontWeight: '900', color: TEXT.primary, textAlign: 'center', marginTop: 14, lineHeight: 30 },

  statCard: { marginTop: 20, width: '100%', backgroundColor: '#fafaf8', borderWidth: 1.5, borderColor: SBORDER, borderRadius: 16, padding: 16 },
  statRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  statLabel: { fontSize: 12.5, fontWeight: '700', color: TEXT.primary },
  statValue: { fontSize: 12.5, fontWeight: '900', color: G2 },

  processingTitle: { fontSize: 19, fontWeight: '900', color: TEXT.primary, textAlign: 'center', marginTop: 16 },
  processRow:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  processDone:    { width: 22, height: 22, borderRadius: 11, backgroundColor: G1, alignItems: 'center', justifyContent: 'center' },
  processPending: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: SBORDER },
  processText:    { fontSize: 13.5, color: TEXT.secondary },
})

// app/guide.tsx — sCORE 完全使い方ガイド（ブログ記事スタイル・ライト＆クリーン）
import React, { useState, useRef, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Platform, Animated, Dimensions, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'

const { width: W } = Dimensions.get('window')
const isWeb = Platform.OS === 'web'
const MAX_W = 720

// ── カラー ──────────────────────────────────────────────────────────
const WHITE  = '#ffffff'
const OFF    = '#f9fafb'
const OFF2   = '#f3f4f6'
const BLACK  = '#0f172a'
const GRAY   = '#64748b'
const LGRAY  = '#e2e8f0'
const GREEN  = '#16a34a'
const GREEN_L = '#dcfce7'
const DARK   = '#1a1a2e'

// ── 中央揃えヘルパー ─────────────────────────────────────────────────
const center = isWeb ? { alignSelf: 'center' as const, width: '100%' as any, maxWidth: MAX_W } : {}

// ── フェードイン Hook ────────────────────────────────────────────────
function useFadeUp(delay = 0) {
  const opacity    = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(16)).current
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity,    { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]).start()
    }, delay)
    return () => clearTimeout(t)
  }, [])
  return { opacity, transform: [{ translateY }] }
}

// ── 機能データ ───────────────────────────────────────────────────────
// title/what/tipは言語依存のためlocales('guide.features')に移し、ここではicon/color/bgのみ保持
const FEATURES = [
  { icon: 'fitness-outline' as const,              color: GREEN,     bg: GREEN_L   },
  { icon: 'warning-outline' as const,               color: '#ef4444', bg: '#fef2f2' },
  { icon: 'people-outline' as const,                color: '#3b82f6', bg: '#eff6ff' },
  { icon: 'chatbubble-ellipses-outline' as const,   color: '#a855f7', bg: '#faf5ff' },
  { icon: 'share-social-outline' as const,          color: '#f59e0b', bg: '#fffbeb' },
  { icon: 'trophy-outline' as const,                color: '#06b6d4', bg: '#ecfeff' },
]

// ── 料金プラン（実際に販売中の2プランのみ。app/paywall.tsx の PLANS と一致させること） ──────
// name/period/features/badgeは言語依存のためlocales('guide.plans')に移し、ここではprice/color/bgのみ保持
const PLAN_STYLES = [
  { price: '¥0',     color: GRAY,     bg: OFF2   },
  { price: '¥480',   color: GREEN,    bg: GREEN_L },
  { price: '¥1,980', color: '#3b82f6', bg: '#eff6ff' },
]

// ── FAQアイテム ───────────────────────────────────────────────────────
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  const anim = useRef(new Animated.Value(0)).current

  function toggle() {
    setOpen(prev => {
      Animated.timing(anim, { toValue: prev ? 0 : 1, duration: 200, useNativeDriver: false }).start()
      return !prev
    })
  }

  const maxHeight = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 200] })

  return (
    <View style={faq.item}>
      <TouchableOpacity onPress={toggle} activeOpacity={0.75} style={faq.row}>
        <Text style={faq.q}>{q}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={GRAY} />
      </TouchableOpacity>
      <Animated.View style={{ maxHeight, overflow: 'hidden' }}>
        <Text style={faq.a}>{a}</Text>
      </Animated.View>
    </View>
  )
}

// ── メインコンポーネント ──────────────────────────────────────────────
export default function GuidePage() {
  const router = useRouter()
  const { t } = useTranslation()
  const featureContent = t('guide.features', { returnObjects: true }) as { title: string; what: string; tip: string }[]
  const personas        = t('guide.personas', { returnObjects: true }) as { label: string; desc: string }[]
  const planContent     = t('guide.plans', { returnObjects: true }) as { name: string; period: string; features: string[]; badge?: string }[]
  const faqs             = t('guide.faqs', { returnObjects: true }) as { q: string; a: string }[]
  const started           = t('guide.started', { returnObjects: true }) as { title: string; steps: string[] }[]
  const summaryItems      = t('guide.summaryItems', { returnObjects: true }) as string[]
  const targets            = t('guide.targets', { returnObjects: true }) as { icon: string; label: string }[]
  const STARTED_ICONS: Array<'person-outline' | 'people-outline' | 'trophy-outline'> = ['person-outline', 'people-outline', 'trophy-outline']
  const STARTED_COLORS = [GREEN, '#3b82f6', '#a855f7']

  const handleDownload = (store: 'apple' | 'google') => {
    if (store === 'apple') {
      Linking.openURL('https://apps.apple.com/jp/app/score/id6766394981')
    } else {
      Linking.openURL('https://play.google.com/store/apps/details?id=com.scorejapan.score')
    }
  }

  const handleTrial = () => {
    if (isWeb) Linking.openURL('https://scorej-run.vercel.app/auth')
    else router.push('/auth')
  }

  const heroAnim = useFadeUp(100)

  return (
    <View style={g.root}>
      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>

        {/* ── ナビ ──────────────────────────────────────────────── */}
        <View style={g.nav}>
          <TouchableOpacity onPress={() => isWeb ? Linking.openURL('https://scorej-run.vercel.app/coach-landing') : router.push('/coach-landing')} activeOpacity={0.8}>
            <Text style={g.navLogo}>sCORE</Text>
          </TouchableOpacity>
          <View style={g.navLinks}>
            <TouchableOpacity onPress={() => isWeb ? Linking.openURL('https://scorej-run.vercel.app/coach-landing') : router.push('/coach-landing')} activeOpacity={0.7}>
              <Text style={g.navLink}>{t('guide.navFeatures')}</Text>
            </TouchableOpacity>
            <Text style={[g.navLink, { color: GREEN, fontWeight: '700' }]}>{t('guide.navGuideCurrent')}</Text>
            <TouchableOpacity onPress={() => isWeb ? Linking.openURL('https://scorej-run.vercel.app/coach-landing') : router.push('/coach-landing')} activeOpacity={0.7}>
              <Text style={g.navLink}>{t('guide.navPricing')}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={g.navBtn} onPress={handleTrial} activeOpacity={0.85}>
            <Text style={g.navBtnTxt}>{t('guide.navTrial')}</Text>
          </TouchableOpacity>
        </View>

        {/* ── 記事ヘッダー ──────────────────────────────────────── */}
        <View style={g.articleHeader}>
          <Animated.View style={[heroAnim, center]}>
            <View style={g.tagRow}>
              <View style={g.tag}><Text style={g.tagTxt}>{t('guide.tagGuide')}</Text></View>
              <View style={g.tag}><Text style={g.tagTxt}>{t('guide.tagTrack')}</Text></View>
              <View style={[g.tag, { backgroundColor: '#fffbeb' }]}><Text style={[g.tagTxt, { color: '#92400e' }]}>{t('guide.tagReadTime')}</Text></View>
            </View>
            <Text style={g.articleTitle}>
              {t('guide.articleTitle')}
            </Text>
            <Text style={g.articleMeta}>{t('guide.articleMeta')}</Text>
          </Animated.View>
        </View>

        {/* ── 3分でわかる結論 ─────────────────────────────────── */}
        <View style={g.section}>
          <View style={[g.inner, center]}>
            <View style={g.summaryBox}>
              <Text style={g.summaryTitle}>{t('guide.summaryTitle')}</Text>
              {summaryItems.map((txt, i) => (
                <View key={i} style={g.summaryRow}>
                  <View style={g.summaryNum}><Text style={g.summaryNumTxt}>{String(i + 1).padStart(2, '0')}</Text></View>
                  <Text style={g.summaryTxt}>{txt}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── sCORE とは ────────────────────────────────────────── */}
        <View style={[g.section, { backgroundColor: OFF }]}>
          <View style={[g.inner, center]}>
            <Text style={g.sectionLabel}>ABOUT</Text>
            <Text style={g.sectionTitle}>{t('guide.aboutTitle')}</Text>
            <Text style={g.body}>
              {t('guide.aboutBody1')}
            </Text>
            <Text style={[g.body, { marginTop: 12 }]}>
              {t('guide.aboutBody2')}
            </Text>

            <View style={g.targetGrid}>
              {targets.map(tg => (
                <View key={tg.label} style={g.targetChip}>
                  <Text style={{ fontSize: 20 }}>{tg.icon}</Text>
                  <Text style={g.targetChipTxt}>{tg.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── 機能ガイド ────────────────────────────────────────── */}
        <View style={g.section}>
          <View style={[g.inner, center]}>
            <Text style={g.sectionLabel}>FEATURES</Text>
            <Text style={g.sectionTitle}>{t('guide.featuresSectionTitle')}</Text>
            <Text style={g.sectionSub}>{t('guide.featuresSectionSub')}</Text>

            {FEATURES.map((feat, i) => (
              <View key={i} style={g.featCard}>
                <View style={g.featCardHeader}>
                  <View style={[g.featIcon, { backgroundColor: feat.bg }]}>
                    <Ionicons name={feat.icon} size={24} color={feat.color} />
                  </View>
                  <Text style={[g.featCardTitle, { color: feat.color }]}>{featureContent[i].title}</Text>
                </View>
                <View style={g.featCardBody}>
                  <View style={g.featBlock}>
                    <Text style={g.featBlockLabel}>{t('guide.featWhatLabel')}</Text>
                    <Text style={g.featBlockTxt}>{featureContent[i].what}</Text>
                  </View>
                  <View style={[g.featBlock, { backgroundColor: feat.bg, borderRadius: 10, padding: 12 }]}>
                    <Text style={[g.featBlockLabel, { color: feat.color }]}>{t('guide.featTipLabel')}</Text>
                    <Text style={[g.featBlockTxt, { color: BLACK }]}>{featureContent[i].tip}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ── こんな人にオススメ ─────────────────────────────────── */}
        <View style={[g.section, { backgroundColor: OFF }]}>
          <View style={[g.inner, center]}>
            <Text style={g.sectionLabel}>FOR WHO</Text>
            <Text style={g.sectionTitle}>{t('guide.personasSectionTitle')}</Text>

            <View style={g.personaGrid}>
              {personas.map((p, i) => (
                <View key={i} style={g.personaCard}>
                  <Text style={{ fontSize: 32, marginBottom: 8 }}>{['🏃','📋','💼','🎓'][i]}</Text>
                  <Text style={g.personaLabel}>{p.label}</Text>
                  <Text style={g.personaDesc}>{p.desc}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── 料金プラン ────────────────────────────────────────── */}
        <View style={g.section}>
          <View style={[g.inner, center]}>
            <Text style={g.sectionLabel}>PRICING</Text>
            <Text style={g.sectionTitle}>{t('guide.pricingSectionTitle')}</Text>
            <Text style={g.sectionSub}>{t('guide.pricingSectionSub')}</Text>

            <View style={g.planGrid}>
              {PLAN_STYLES.map((style, i) => {
                const plan = planContent[i]
                return (
                <View key={i} style={[g.planCard, { borderColor: style.color }]}>
                  {plan.badge && (
                    <View style={[g.planBadge, { backgroundColor: style.color }]}>
                      <Text style={g.planBadgeTxt}>{plan.badge}</Text>
                    </View>
                  )}
                  <Text style={[g.planName, { color: style.color }]}>{plan.name}</Text>
                  <View style={g.planPriceRow}>
                    <Text style={[g.planPrice, { color: style.color }]}>{style.price}</Text>
                    {plan.period ? <Text style={g.planPeriod}>{plan.period}</Text> : null}
                  </View>
                  <View style={g.planFeatures}>
                    {plan.features.map((f, j) => (
                      <View key={j} style={g.planFeatureRow}>
                        <Ionicons name="checkmark-circle" size={14} color={style.color} />
                        <Text style={g.planFeatureTxt}>{f}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                )
              })}
            </View>

            <Text style={g.planNote}>{t('guide.planNote')}</Text>
          </View>
        </View>

        {/* ── FAQ ───────────────────────────────────────────────── */}
        <View style={[g.section, { backgroundColor: OFF }]}>
          <View style={[g.inner, center]}>
            <Text style={g.sectionLabel}>FAQ</Text>
            <Text style={g.sectionTitle}>{t('guide.faqSectionTitle')}</Text>

            {faqs.map((item, i) => (
              <FaqItem key={i} q={item.q} a={item.a} />
            ))}
          </View>
        </View>

        {/* ── 目的別スタート方法 ─────────────────────────────────── */}
        <View style={g.section}>
          <View style={[g.inner, center]}>
            <Text style={g.sectionLabel}>GET STARTED</Text>
            <Text style={g.sectionTitle}>{t('guide.startedSectionTitle')}</Text>

            {started.map((item, i) => (
              <View key={i} style={g.startCard}>
                <View style={g.startCardHeader}>
                  <View style={[g.startIcon, { backgroundColor: STARTED_COLORS[i] + '18' }]}>
                    <Ionicons name={STARTED_ICONS[i]} size={20} color={STARTED_COLORS[i]} />
                  </View>
                  <Text style={g.startCardTitle}>{item.title}</Text>
                </View>
                {item.steps.map((step, j) => (
                  <View key={j} style={g.startStep}>
                    <View style={[g.startStepNum, { backgroundColor: STARTED_COLORS[i] }]}>
                      <Text style={g.startStepNumTxt}>{j + 1}</Text>
                    </View>
                    <Text style={g.startStepTxt}>{step}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </View>

        {/* ── CTA ───────────────────────────────────────────────── */}
        <View style={g.ctaSection}>
          <View style={[g.inner, center, { alignItems: 'center' }]}>
            <Text style={g.ctaTitle}>{t('guide.ctaTitle')}</Text>
            <Text style={g.ctaSub}>{t('guide.ctaSub')}</Text>

            <View style={g.ctaBtns}>
              <TouchableOpacity style={g.ctaBtn} onPress={() => handleDownload('apple')} activeOpacity={0.85}>
                <Ionicons name="logo-apple" size={20} color={WHITE} />
                <View>
                  <Text style={g.ctaBtnSub}>{t('guide.ctaAppStoreSub')}</Text>
                  <Text style={g.ctaBtnMain}>{t('guide.ctaDownload')}</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={[g.ctaBtn, { backgroundColor: '#16a34a' }]} onPress={() => handleDownload('google')} activeOpacity={0.85}>
                <Ionicons name="logo-google-playstore" size={20} color={WHITE} />
                <View>
                  <Text style={g.ctaBtnSub}>{t('guide.ctaGooglePlaySub')}</Text>
                  <Text style={g.ctaBtnMain}>{t('guide.ctaDownload')}</Text>
                </View>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={handleTrial} activeOpacity={0.8} style={{ marginTop: 12 }}>
              <Text style={g.ctaWebLink}>{t('guide.ctaWebLink')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── フッター ──────────────────────────────────────────── */}
        <View style={g.footer}>
          <View style={[center, { alignItems: 'center', gap: 16 }]}>
            <Text style={g.footerLogo}>sCORE</Text>
            <View style={g.footerLinks}>
              {[
                { label: t('guide.footerTerms'), url: 'https://scorej-run.vercel.app/terms' },
                { label: t('guide.footerPrivacy'), url: 'https://scorej-run.vercel.app/privacy' },
                { label: t('guide.footerCoach'), url: 'https://scorej-run.vercel.app/coach-landing' },
                { label: t('guide.footerContact'), url: 'mailto:amuletbaby.shop@gmail.com' },
              ].map(link => (
                <TouchableOpacity key={link.label} onPress={() => Linking.openURL(link.url)} activeOpacity={0.7}>
                  <Text style={g.footerLink}>{link.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={g.footerCopy}>© 2026 sCORE Japan. All rights reserved.</Text>
          </View>
        </View>

      </ScrollView>
    </View>
  )
}

// ── FAQ スタイル ─────────────────────────────────────────────────────
const faq = StyleSheet.create({
  item: {
    borderBottomWidth: 1, borderBottomColor: LGRAY,
    paddingVertical: 16,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  q: {
    flex: 1, fontSize: 15, fontWeight: '700', color: BLACK, lineHeight: 22,
  },
  a: {
    fontSize: 14, color: GRAY, lineHeight: 22, paddingTop: 10,
  },
})

// ── メインスタイル ───────────────────────────────────────────────────
const g = StyleSheet.create({
  root: { flex: 1, backgroundColor: WHITE },

  // ナビ
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: LGRAY,
    backgroundColor: WHITE, ...center,
  },
  navLogo: { color: BLACK, fontSize: 20, fontWeight: '900', letterSpacing: 0.5 },
  navLinks: { flexDirection: 'row', alignItems: 'center', gap: 20, flex: 1, justifyContent: 'center' },
  navLink:  { color: GRAY, fontSize: 14, fontWeight: '600' },
  navBtn:   { backgroundColor: GREEN, borderRadius: 50, paddingHorizontal: 16, paddingVertical: 8 },
  navBtnTxt:{ color: WHITE, fontWeight: '800', fontSize: 13 },

  // 記事ヘッダー
  articleHeader: {
    backgroundColor: OFF, paddingHorizontal: 24, paddingTop: 52, paddingBottom: 48,
  },
  tagRow: { flexDirection: 'row', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  tag: { backgroundColor: GREEN_L, borderRadius: 50, paddingHorizontal: 12, paddingVertical: 4 },
  tagTxt: { color: '#166534', fontSize: 12, fontWeight: '700' },
  articleTitle: {
    fontSize: isWeb ? 32 : 26, fontWeight: '900', color: BLACK, lineHeight: isWeb ? 44 : 36,
    marginBottom: 16, letterSpacing: -0.5,
  },
  articleMeta: { fontSize: 12, color: GRAY },

  // セクション共通
  section: { paddingVertical: 64, paddingHorizontal: 24 },
  inner:   { width: '100%' },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: GREEN, letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' as const },
  sectionTitle: { fontSize: isWeb ? 28 : 22, fontWeight: '900', color: BLACK, marginBottom: 12 },
  sectionSub:   { fontSize: 14, color: GRAY, lineHeight: 22, marginBottom: 32 },
  body: { fontSize: 15, color: GRAY, lineHeight: 26 },

  // 3分でわかる結論
  summaryBox: {
    backgroundColor: OFF, borderRadius: 20, padding: 24,
    borderWidth: 1, borderColor: LGRAY,
  },
  summaryTitle: { fontSize: 16, fontWeight: '800', color: BLACK, marginBottom: 20 },
  summaryRow: { flexDirection: 'row', gap: 14, marginBottom: 16, alignItems: 'flex-start' },
  summaryNum: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: GREEN,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
  },
  summaryNumTxt: { color: WHITE, fontSize: 11, fontWeight: '900' },
  summaryTxt: { flex: 1, fontSize: 14, color: BLACK, lineHeight: 22 },

  // ターゲット
  targetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 28 },
  targetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: WHITE, borderRadius: 50, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: LGRAY,
  },
  targetChipTxt: { fontSize: 13, fontWeight: '700', color: BLACK },

  // 機能カード
  featCard: {
    backgroundColor: WHITE, borderRadius: 20, borderWidth: 1, borderColor: LGRAY,
    marginBottom: 24, overflow: 'hidden',
  },
  featCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 20, borderBottomWidth: 1, borderBottomColor: LGRAY,
  },
  featIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  featCardTitle: { fontSize: 16, fontWeight: '800', flex: 1 },
  featCardBody: { padding: 20, gap: 12 },
  featBlock: { gap: 6 },
  featBlockLabel: { fontSize: 11, fontWeight: '800', color: GRAY, textTransform: 'uppercase' as const, letterSpacing: 1 },
  featBlockTxt: { fontSize: 14, color: GRAY, lineHeight: 22 },

  // ペルソナ
  personaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  personaCard: {
    flex: 1, minWidth: isWeb ? 280 : '45%' as any,
    backgroundColor: WHITE, borderRadius: 20, padding: 20,
    borderWidth: 1, borderColor: LGRAY,
  },
  personaLabel: { fontSize: 15, fontWeight: '800', color: BLACK, marginBottom: 8 },
  personaDesc:  { fontSize: 13, color: GRAY, lineHeight: 20 },

  // 料金プラン
  planGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 8 },
  planCard: {
    flex: 1, minWidth: isWeb ? 140 : '45%' as any,
    backgroundColor: WHITE, borderRadius: 20, padding: 20,
    borderWidth: 2, position: 'relative' as const,
  },
  planBadge: {
    position: 'absolute', top: -10, right: 16,
    borderRadius: 50, paddingHorizontal: 10, paddingVertical: 4,
  },
  planBadgeTxt: { color: WHITE, fontSize: 11, fontWeight: '800' },
  planName: { fontSize: 18, fontWeight: '900', marginBottom: 8 },
  planPriceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, marginBottom: 16 },
  planPrice: { fontSize: 28, fontWeight: '900' },
  planPeriod: { fontSize: 13, color: GRAY, marginBottom: 4 },
  planFeatures: { gap: 8 },
  planFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  planFeatureTxt: { fontSize: 12, color: BLACK, flex: 1 },
  planNote: { fontSize: 12, color: GRAY, marginTop: 20, textAlign: 'center' as const },

  // スタートガイド
  startCard: {
    backgroundColor: WHITE, borderRadius: 20, borderWidth: 1, borderColor: LGRAY,
    padding: 24, marginBottom: 20,
  },
  startCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  startIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  startCardTitle: { fontSize: 16, fontWeight: '800', color: BLACK, flex: 1 },
  startStep: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  startStepNum: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  startStepNumTxt: { color: WHITE, fontSize: 12, fontWeight: '900' },
  startStepTxt: { flex: 1, fontSize: 14, color: BLACK, lineHeight: 20 },

  // CTA
  ctaSection: { backgroundColor: DARK, paddingVertical: 72, paddingHorizontal: 24 },
  ctaTitle: { fontSize: isWeb ? 32 : 24, fontWeight: '900', color: WHITE, textAlign: 'center' as const, marginBottom: 12 },
  ctaSub:   { fontSize: 14, color: 'rgba(255,255,255,0.65)', textAlign: 'center' as const, marginBottom: 32 },
  ctaBtns: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', justifyContent: 'center' },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1c1c1e', borderRadius: 16, paddingHorizontal: 20, paddingVertical: 14,
    minWidth: 180,
  },
  ctaBtnSub:  { color: 'rgba(255,255,255,0.65)', fontSize: 11 },
  ctaBtnMain: { color: WHITE, fontSize: 15, fontWeight: '800' },
  ctaWebLink: { color: GREEN_L, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' as const },

  // フッター
  footer: {
    backgroundColor: '#0f172a', paddingVertical: 40, paddingHorizontal: 24,
  },
  footerLogo: { color: WHITE, fontSize: 22, fontWeight: '900', letterSpacing: 0.5 },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'center' },
  footerLink: { color: 'rgba(255,255,255,0.55)', fontSize: 13 },
  footerCopy: { color: 'rgba(255,255,255,0.3)', fontSize: 11 },
})

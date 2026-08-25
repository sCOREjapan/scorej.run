// app/paywall.tsx — sCORE プラン選択・購入画面
// App Store Review ガイドライン対応:
//  - 全機能は無料で利用可能（チケット制、初回10枚付与）
//  - 広告なしプラン: 広告を非表示にするだけ
//  - チケット月額プラン: 広告なし＋毎月チケット100枚
//  - コーチプラン: チケット月額プランの内容＋チーム管理・コーチ向け機能
//  - 復元ボタン必須（3.1.1）
//  - 価格・更新周期・キャンセル方法を明記（3.1.2）

import React, { useState, useEffect, useRef, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform, Animated, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { usePurchase } from '../context/PurchaseContext'
import { PRODUCT_IDS, TICKET_MONTHLY_GRANT } from '../lib/purchaseService'
import { trackPaywallView } from '../lib/analytics'
import Toast from 'react-native-toast-message'

const BRAND  = '#16a34a'
const TIX    = '#f59e0b'
const GOLD   = '#d97706'
const BG     = '#f6f6f8'
const CARD   = '#ffffff'
const BORDER = 'rgba(0,0,0,0.08)'
const TEXT_PRIMARY = '#111827'
const TEXT_SECONDARY = '#6b7280'
const TEXT_HINT = '#9ca3af'

type PlanId = 'noad' | 'ticket_monthly' | 'coach'
type Period = 'monthly' | 'yearly'

// ── プラン定義 ─────────────────────────────────────────────────────
type PlanConfig = {
  id: PlanId; color: string; icon: string; label: string; tagline: string
  monthly: { productId: string; price: string; period: string }
  yearly?: { productId: string; price: string; period: string; note: string }
  features: string[]
  recommended?: boolean
}

// t() は言語切り替えで再評価される必要があるため、モジュール定数ではなく
// コンポーネント内で毎回組み立てる（配列自体は軽量なのでメモ化不要）。
function buildPlans(t: (key: string, opts?: any) => string): PlanConfig[] {
  const perMonth = t('paywall.perMonth')
  const perMonthEquiv = t('paywall.perMonthEquiv')
  return [
    {
      id: 'noad', color: BRAND, icon: '🚫',
      label: t('paywall.plans.noad.label'), tagline: t('paywall.plans.noad.tagline'),
      monthly: { productId: PRODUCT_IDS.noad_monthly, price: '¥480',  period: perMonth },
      yearly:  { productId: PRODUCT_IDS.noad_yearly,  price: '¥400',  period: perMonthEquiv, note: t('paywall.plans.noad.yearlyNote') },
      features: [
        t('paywall.plans.noad.feature1'),
        t('paywall.plans.noad.feature2'),
      ],
    },
    {
      id: 'ticket_monthly', color: TIX, icon: '🎫',
      label: t('paywall.plans.ticket_monthly.label'), tagline: t('paywall.plans.ticket_monthly.tagline'),
      monthly: { productId: PRODUCT_IDS.ticket_monthly, price: '¥980', period: perMonth },
      features: [
        t('paywall.plans.ticket_monthly.feature1'),
        t('paywall.plans.ticket_monthly.feature2', { count: TICKET_MONTHLY_GRANT }),
        t('paywall.plans.ticket_monthly.feature3'),
      ],
      recommended: true,
    },
    {
      id: 'coach', color: GOLD, icon: '🏆',
      label: t('paywall.plans.coach.label'), tagline: t('paywall.plans.coach.tagline'),
      monthly: { productId: PRODUCT_IDS.coach_monthly, price: '¥1,980', period: perMonth },
      yearly:  { productId: PRODUCT_IDS.coach_yearly,  price: '¥1,650', period: perMonthEquiv, note: t('paywall.plans.coach.yearlyNote') },
      features: [
        t('paywall.plans.coach.feature1'),
        t('paywall.plans.coach.feature2'),
        t('paywall.plans.coach.feature3'),
        t('paywall.plans.coach.feature4'),
      ],
    },
  ]
}

// StoreKit/Play Console の Introductory Offer（price=0）から無料体験の日数を読み取る。
// 「◯日間無料」を文言としてハードコードすると、ストア側の実際の設定とズレて事実と異なる
// 表示になる危険があるため（noadプランの説明矛盾と同じ種類の事故）、必ず実際の商品情報から動的に出す。
// トライアルが設定されていない商品では null（=表示しない）。
function trialDaysFromPackage(pkg: any): number | null {
  const intro = pkg?.product?.introPrice
  if (!intro || intro.price !== 0) return null
  const n = intro.periodNumberOfUnits ?? 1
  switch (intro.periodUnit) {
    case 'DAY':   return n
    case 'WEEK':  return n * 7
    case 'MONTH': return n * 30
    case 'YEAR':  return n * 365
    default:      return null
  }
}

function CheckRow({ color, text }: { color: string; text: string }) {
  return (
    <View style={st.checkRow}>
      <Ionicons name="checkmark-circle" size={16} color={color} />
      <Text style={st.checkText}>{text}</Text>
    </View>
  )
}

export default function PaywallScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { plan: planParam } = useLocalSearchParams<{ plan?: string }>()
  const { tier, hasTicketMonthly, packages, packagesDiagnostic, packagesReady, purchase, restore, refreshStatus } = usePurchase()

  const PLANS = buildPlans(t)
  const initialPlan: PlanId = (planParam === 'coach' || planParam === 'ticket_monthly') ? planParam : 'noad'
  const [selected,   setSelected]   = useState<PlanId>(initialPlan)
  const [periods,    setPeriods]    = useState<Record<PlanId, Period>>({ noad: 'monthly', ticket_monthly: 'monthly', coach: 'monthly' })
  const [purchasing, setPurchasing] = useState(false)
  const [restoring,  setRestoring]  = useState(false)
  const fadeAnim = useRef(new Animated.Value(0)).current
  // setPurchasingは再レンダー待ちで反映が非同期なため、連打防止には同期的なrefロックが必要
  const purchaseLockRef = useRef(false)

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start()
    refreshStatus().catch(() => {})
    trackPaywallView(`paywall_screen:${initialPlan}`)
  }, [])

  // 購入済みならホームへ（コーチ/広告なしのいずれか、またはチケット月額プランが有効なら）
  useEffect(() => {
    if (tier !== 'free' || hasTicketMonthly) {
      Toast.show({ type: 'success', text1: t('paywall.planActive') })
      router.back()
    }
  }, [tier, hasTicketMonthly])

  const selectedPlan = PLANS.find(p => p.id === selected)!
  const selectedPeriod = selectedPlan.yearly ? periods[selected] : 'monthly'
  const selectedTerms = selectedPeriod === 'yearly' && selectedPlan.yearly ? selectedPlan.yearly : selectedPlan.monthly

  // packages から今選択中のプロダクトに対応するパッケージを探す
  const targetPkg = packages.find(
    (pkg: any) => pkg.product?.identifier === selectedTerms.productId
  )

  const trialDaysFor = (productId: string): number | null => {
    const pkg = packages.find((p: any) => p.product?.identifier === productId)
    return pkg ? trialDaysFromPackage(pkg) : null
  }
  const selectedTrialDays = trialDaysFor(selectedTerms.productId)

  const handlePurchase = useCallback(async () => {
    if (purchaseLockRef.current) return
    if (!targetPkg) {
      Toast.show({
        type: 'error',
        text1: t('paywall.loadFailedTitle'),
        text2: packagesDiagnostic ?? t('paywall.loadFailedRetry'),
        visibilityTime: 6000,
      })
      return
    }
    purchaseLockRef.current = true
    setPurchasing(true)
    try {
      await purchase(targetPkg)
    } finally {
      setPurchasing(false)
      purchaseLockRef.current = false
    }
  }, [targetPkg, purchase, packagesDiagnostic])

  const handleRestore = useCallback(async () => {
    setRestoring(true)
    try { await restore() } finally { setRestoring(false) }
  }, [restore])

  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      {/* ── ヘッダー ── */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityLabel="閉じる" accessibilityRole="button">
          <Ionicons name="close" size={24} color={TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>{t('paywall.headerTitle')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <Animated.ScrollView style={{ flex: 1, opacity: fadeAnim }} contentContainerStyle={st.scroll}>

        {/* ── リード文 ── */}
        <Text style={st.lead}><Text style={{ color: BRAND, fontWeight: '900' }}>{t('paywall.leadHighlight')}</Text>{t('paywall.leadRest')}</Text>
        <Text style={st.subLead}>{t('paywall.subLead')}</Text>

        {/* ── プランカード ── */}
        {PLANS.map(plan => {
          const isSelected = selected === plan.id
          const period = plan.yearly ? periods[plan.id] : 'monthly'
          const terms = period === 'yearly' && plan.yearly ? plan.yearly : plan.monthly
          const trialDays = trialDaysFor(terms.productId)
          return (
            <TouchableOpacity
              key={plan.id}
              onPress={() => setSelected(plan.id)}
              activeOpacity={0.8}
              style={[
                st.planCard,
                plan.recommended && { marginTop: 14 },
                isSelected && { borderColor: plan.color, borderWidth: 2 },
              ]}
            >
              {plan.recommended && (
                <View style={[st.recBadge, { backgroundColor: plan.color }]}>
                  <Text style={st.recBadgeTxt}>{t('paywall.recommended')}</Text>
                </View>
              )}

              {/* 選択ラジオ */}
              <View style={st.planTop}>
                <View style={[st.radio, isSelected && { borderColor: plan.color }]}>
                  {isSelected && <View style={[st.radioDot, { backgroundColor: plan.color }]} />}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 18 }}>{plan.icon}</Text>
                    <Text style={[st.planLabel, isSelected && { color: plan.color }]}>{plan.label}</Text>
                  </View>
                  <Text style={st.planTagline}>{plan.tagline}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {trialDays ? (
                    <View style={[st.trialBadge, { backgroundColor: plan.color }]}>
                      <Text style={st.trialBadgeTxt}>{t('paywall.trialBadge', { days: trialDays })}</Text>
                    </View>
                  ) : null}
                  <Text style={[st.planPrice, { color: plan.color }]}>{terms.price}</Text>
                  <Text style={st.planPeriod}>{terms.period}</Text>
                  {period === 'yearly' && plan.yearly && <Text style={st.planNote}>{plan.yearly.note}</Text>}
                </View>
              </View>

              {/* 月額/年額トグル（年額オプションがあるプランのみ） */}
              {plan.yearly && (
                <View style={st.seg}>
                  <TouchableOpacity
                    onPress={() => setPeriods(p => ({ ...p, [plan.id]: 'monthly' }))}
                    style={[st.segBtn, period === 'monthly' && { backgroundColor: plan.color }]}
                  >
                    <Text style={[st.segBtnTxt, period === 'monthly' && st.segBtnTxtActive]}>{t('paywall.monthly')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setPeriods(p => ({ ...p, [plan.id]: 'yearly' }))}
                    style={[st.segBtn, period === 'yearly' && { backgroundColor: plan.color }]}
                  >
                    <Text style={[st.segBtnTxt, period === 'yearly' && st.segBtnTxtActive]}>{t('paywall.yearlyDiscount')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* 機能リスト */}
              <View style={st.featList}>
                {plan.features.map(f => <CheckRow key={f} color={plan.color} text={f} />)}
              </View>
            </TouchableOpacity>
          )
        })}

        {/* ── 購入ボタン ── */}
        <TouchableOpacity
          onPress={handlePurchase}
          disabled={purchasing || !packagesReady}
          activeOpacity={0.85}
          style={[st.purchaseBtn, { backgroundColor: selectedPlan.color }, (purchasing || !packagesReady) && { opacity: 0.55 }]}
        >
          {purchasing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={st.purchaseBtnText}>
              {selectedTrialDays
                ? t('paywall.startTrial', { days: selectedTrialDays })
                : t('paywall.startPlan', { label: selectedPlan.label, price: selectedTerms.price, period: selectedTerms.period })}
            </Text>
          )}
        </TouchableOpacity>
        {selectedTrialDays ? (
          <Text style={st.trialSubtext}>
            {t('paywall.trialSubtext', { price: selectedTerms.price, period: selectedTerms.period })}
          </Text>
        ) : null}

        {/* ── 法的必須テキスト（Apple審査要件 3.1.2） ── */}
        <View style={st.legalBox}>
          <Text style={st.legalText}>
            {selectedTrialDays ? `• ${t('paywall.legal.trialLine', { days: selectedTrialDays })}\n` : ''}
            • {t('paywall.legal.autoRenew')}{'\n'}
            • {t('paywall.legal.cancelNotice')}{'\n'}
            • {t('paywall.legal.howToCancel')}{'\n'}
            • {t('paywall.legal.refundPolicy')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 10 }}>
            <TouchableOpacity onPress={() => Linking.openURL('https://scorej-run.vercel.app/privacy')}>
              <Text style={st.legalLink}>{t('paywall.privacyPolicy')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Linking.openURL('https://scorej-run.vercel.app/terms')}>
              <Text style={st.legalLink}>{t('paywall.terms')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 復元ボタン（Apple審査で必須） ── */}
        <TouchableOpacity onPress={handleRestore} disabled={restoring} style={st.restoreBtn}>
          {restoring
            ? <ActivityIndicator color={TEXT_SECONDARY} size="small" />
            : <Text style={st.restoreText}>{t('paywall.restoreButton')}</Text>
          }
        </TouchableOpacity>

        {/* ── DEV専用スキップ（本番ビルドには含まれない） ── */}
        {__DEV__ && (
          <TouchableOpacity
            style={{ marginTop: 12, alignSelf: 'center', padding: 10 }}
            onPress={async () => {
              if (selected === 'ticket_monthly') {
                await AsyncStorage.setItem('trackmate_subscription', JSON.stringify({
                  isPremium: true, plan: 'free', expiresAt: '2099-12-31T00:00:00.000Z',
                  hasTicketMonthly: true, ticketMonthlyExpiresAt: '2099-12-31T00:00:00.000Z',
                }))
              } else {
                await AsyncStorage.setItem('trackmate_subscription', JSON.stringify({
                  isPremium: true, plan: selected, expiresAt: '2099-12-31T00:00:00.000Z',
                }))
              }
              Toast.show({ type: 'success', text1: `[DEV] ${selected} を擬似有効化しました` })
              router.back()
            }}
          >
            <Text style={{ color: TIX, fontSize: 12, fontWeight: '700' }}>
              [DEV] 購入をスキップ（開発用）
            </Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 32 }} />
      </Animated.ScrollView>
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: BG },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  closeBtn:        { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:     { fontSize: 17, fontWeight: '700', color: TEXT_PRIMARY },
  scroll:          { paddingHorizontal: 16, paddingTop: 8 },
  lead:            { fontSize: 26, fontWeight: '900', color: TEXT_PRIMARY, textAlign: 'center', lineHeight: 36, marginBottom: 8 },
  subLead:         { fontSize: 14, color: TEXT_SECONDARY, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  planCard:        { backgroundColor: CARD, borderRadius: 21, padding: 18, marginBottom: 14, borderWidth: 1.5, borderColor: BORDER, position: 'relative' },
  recBadge:        { position: 'absolute', top: -11, left: 18, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  recBadgeTxt:     { fontSize: 11, fontWeight: '800', color: '#fff' },
  planTop:         { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  radio:           { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#d1d5db', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  radioDot:        { width: 10, height: 10, borderRadius: 5 },
  planLabel:       { fontSize: 17, fontWeight: '800', color: TEXT_PRIMARY },
  planTagline:     { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },
  planPrice:       { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  planPeriod:      { fontSize: 11, color: TEXT_HINT, marginTop: 1 },
  planNote:        { fontSize: 10, color: '#16a34a', marginTop: 2, fontWeight: '700' },
  trialBadge:      { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 3 },
  trialBadgeTxt:   { fontSize: 10.5, fontWeight: '800', color: '#fff' },
  seg:             { flexDirection: 'row', backgroundColor: '#f0f2f5', borderRadius: 12, padding: 3, gap: 3, marginBottom: 14 },
  segBtn:          { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9 },
  segBtnTxt:       { fontSize: 12, fontWeight: '700', color: TEXT_SECONDARY },
  segBtnTxtActive: { color: '#fff' },
  featList:        { gap: 8, paddingLeft: 4 },
  checkRow:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkText:       { fontSize: 13, color: TEXT_SECONDARY, flex: 1 },
  purchaseBtn:     { borderRadius: 21, paddingVertical: 16, alignItems: 'center', marginTop: 8, marginBottom: 4 },
  purchaseBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  trialSubtext:    { fontSize: 11, color: TEXT_HINT, textAlign: 'center', marginTop: -2, marginBottom: 4 },
  legalBox:        { backgroundColor: '#eef0f3', borderRadius: 14, padding: 14, marginTop: 16 },
  legalText:       { fontSize: 11, color: TEXT_SECONDARY, lineHeight: 18 },
  legalLink:       { fontSize: 11, color: TEXT_SECONDARY, textDecorationLine: 'underline' },
  restoreBtn:      { alignItems: 'center', paddingVertical: 14, minHeight: 44, justifyContent: 'center' },
  restoreText:     { fontSize: 14, color: TEXT_SECONDARY },
})

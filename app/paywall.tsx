// app/paywall.tsx — sCORE プラン選択・購入画面（ダークデザイン）

import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform, Animated,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { usePurchase } from '../context/PurchaseContext'
import { trackPaywallView, trackUpgrade } from '../lib/analytics'
import Toast from 'react-native-toast-message'

const BRAND = '#16a34a'   // green-600
const BG    = '#1a1a2e'   // dark navy

// ── プラン定義 ──────────────────────────────────────────────────────
const PLANS = [
  {
    id:             'pro',
    label:          'PRO',
    color:          BRAND,
    tagline:        '本格的に強くなりたい選手へ',
    titleText:      'sCORE PRO で\n練習を武器にする',
    monthlyPrice:   '¥480',
    annualPrice:    '¥4,800',
    annualMonthly:  '¥400',
    productMonthly: 'score_pro_monthly',
    productAnnual:  'score_pro_annual',
  },
  {
    id:             'elite',
    label:          'ELITE',
    color:          '#d97706',
    tagline:        '本気で結果を出したい選手へ',
    titleText:      'sCORE ELITE で\n記録を限界突破する',
    monthlyPrice:   '¥980',
    annualPrice:    '¥8,820',
    annualMonthly:  '¥735',
    productMonthly: 'score_elite_monthly',
    productAnnual:  'score_elite_annual',
  },
]

type PeriodType = 'monthly' | 'annual'

function FeatRow({ color, text, bold }: { color: string; text: string; bold?: boolean }) {
  return (
    <View style={st.featRow}>
      <Ionicons name="checkmark-circle" size={16} color={color} />
      <Text style={[st.featRowText, bold && { fontWeight: '800', color: '#fff' }]}>{text}</Text>
    </View>
  )
}

export default function PaywallScreen() {
  const router = useRouter()
  const { tier: currentTier, packages, purchase, restore, loading } = usePurchase()

  const [selectedPlan, setSelectedPlan] = useState<'pro' | 'elite'>('pro')
  const [period,       setPeriod]       = useState<PeriodType>('annual')
  const [purchasing,   setPurchasing]   = useState(false)
  const [restoring,    setRestoring]    = useState(false)

  const fadeAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    trackPaywallView('paywall_screen')
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start()
  }, [])

  // プラン切替時のフェード
  const handleSelectPlan = (id: 'pro' | 'elite') => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0.6, duration: 100, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1,   duration: 200, useNativeDriver: true }),
    ]).start()
    setSelectedPlan(id)
  }

  // ── 購入処理 ─────────────────────────────────────────────────────
  const handlePurchase = async () => {
    const plan = PLANS.find(p => p.id === selectedPlan)
    if (!plan) return  // planが見つからない場合は何もしない（クラッシュ防止）
    const prodId = period === 'annual' ? plan.productAnnual : plan.productMonthly

    const pkg = packages.find(p =>
      p.product?.productIdentifier === prodId ||
      (period === 'annual'  && (p.packageType === 'ANNUAL'  || p.product?.productIdentifier?.includes('annual'))) ||
      (period === 'monthly' && (p.packageType === 'MONTHLY' || p.product?.productIdentifier?.includes('monthly')))
    )
    const target = pkg ?? (packages.length > 0 ? packages[0] : null)
    if (!target) {
      Toast.show({
        type: 'error',
        text1: '購入プランを読み込み中',
        text2: '少し待ってから再試行してください',
        visibilityTime: 3000,
      })
      return
    }

    setPurchasing(true)
    try {
      const ok = await purchase(target)
      if (ok) trackUpgrade(`${selectedPlan}_${period}`)
    } finally { setPurchasing(false) }
  }

  const handleRestore = async () => {
    setRestoring(true)
    try { await restore() }
    finally { setRestoring(false) }
  }

  // ── Web 案内 ─────────────────────────────────────────────────────
  if (Platform.OS === 'web') {
    return (
      <View style={st.webWrap}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
          <Text style={{ fontSize: 40, marginBottom: 16 }}>📱</Text>
          <Text style={st.webTitle}>iOSアプリで購入できます</Text>
          <Text style={st.webSub}>
            sCORE PRO / ELITEは{'\n'}
            App Storeの「sCORE」アプリからご購入ください。
          </Text>
          <TouchableOpacity style={[st.ctaBtn, { marginTop: 32 }]} onPress={() => router.back()}>
            <Text style={st.ctaBtnText}>閉じる</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    )
  }

  const plan = PLANS.find(p => p.id === selectedPlan)!
  const dispPrice  = period === 'annual' ? plan.annualPrice   : plan.monthlyPrice
  const perMonth   = period === 'annual' ? plan.annualMonthly : plan.monthlyPrice
  const periodText = period === 'annual' ? '年' : '月'

  return (
    <View style={st.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        {/* ── 閉じるボタン ── */}
        <TouchableOpacity
          style={st.closeCircle}
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={st.scroll}
        >
          <Animated.View style={{ opacity: fadeAnim }}>

            {/* ── ヒーロータイトル ── */}
            <View style={st.heroSection}>
              <Text style={st.heroTitle}>{plan.titleText}</Text>
              <Text style={st.heroSub}>
                まずは無料で試せます。いつでも解約可能。
              </Text>
              {currentTier !== 'free' && (
                <View style={st.currentPlanBadge}>
                  <Text style={st.currentPlanText}>
                    現在 {currentTier === 'coach' ? 'コーチ' : currentTier === 'elite' ? 'ELITE' : 'PRO'} をご利用中
                  </Text>
                </View>
              )}
            </View>

            {/* ── プラン切替タブ ── */}
            <View style={st.planTabs}>
              {PLANS.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={[st.planTab, selectedPlan === p.id && { backgroundColor: p.color }]}
                  onPress={() => handleSelectPlan(p.id as 'pro' | 'elite')}
                  activeOpacity={0.8}
                >
                  <Text style={[st.planTabText, selectedPlan === p.id && { color: '#fff' }]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── 期間切替 ── */}
            <View style={st.periodRow}>
              <TouchableOpacity
                style={[st.periodChip, period === 'annual' && { backgroundColor: plan.color }]}
                onPress={() => setPeriod('annual')}
                activeOpacity={0.8}
              >
                <Text style={[st.periodChipText, period === 'annual' && { color: '#fff' }]}>年払い</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.periodChip, period === 'monthly' && { backgroundColor: plan.color }]}
                onPress={() => setPeriod('monthly')}
                activeOpacity={0.8}
              >
                <Text style={[st.periodChipText, period === 'monthly' && { color: '#fff' }]}>月払い</Text>
              </TouchableOpacity>
            </View>

            {/* ── プランカード ── */}
            <View style={[st.planCard, { borderColor: plan.color }]}>
              {period === 'annual' && (
                <View style={[st.saveBadge, { backgroundColor: plan.color }]}>
                  <Text style={st.saveBadgeText}>2ヶ月分お得</Text>
                </View>
              )}
              <View style={st.planCardInner}>
                <View>
                  <Text style={[st.planCardLabel, { color: plan.color }]}>
                    {period === 'annual' ? '年額プラン' : '月額プラン'}
                  </Text>
                  <Text style={st.planCardSub}>{perMonth}/月</Text>
                </View>
                <Text style={[st.planCardPrice, { color: plan.color }]}>
                  {dispPrice}
                  <Text style={st.planCardUnit}>/{periodText}</Text>
                </Text>
              </View>
            </View>

            {/* ── 含まれる機能 ── */}
            <View style={st.featSection}>
              <Text style={[st.featSectionTitle, { color: plan.color }]}>
                {selectedPlan === 'pro' ? 'PRO' : 'ELITE'} に含まれる機能
              </Text>

              {selectedPlan === 'pro' ? (
                <>
                  <FeatRow color={plan.color} text="バナー・全広告 完全非表示 🚫" bold />
                  <FeatRow color={plan.color} text="AI練習分析コーチ 月30回" />
                  <FeatRow color={plan.color} text="動画フォーム分析 月30回" />
                  <FeatRow color={plan.color} text="AI食事・栄養分析 月30回" />
                  <FeatRow color={plan.color} text="AIリカバリー相談 月30回" />
                  <FeatRow color={plan.color} text="CSVエクスポート 月1回" />
                </>
              ) : (
                <>
                  <FeatRow color={plan.color} text="バナー・全広告 完全非表示 🚫" bold />
                  <FeatRow color={plan.color} text="PROの全機能" />
                  <FeatRow color={plan.color} text="AI機能すべて 完全無制限" bold />
                  <FeatRow color={plan.color} text="CSVエクスポート 無制限" />
                </>
              )}

              <View style={st.featDivider} />
              <Text style={st.featFreeNote}>
                FREE でも: 練習ログ無制限 / タイム記録全期間 / 怪我リスク診断{'\n'}※ FREE は広告あり / AI機能は1日1〜3回制限あり
              </Text>
            </View>

            {/* ── 注意書き ── */}
            <Text style={st.legalText}>
              購入はApple IDに紐付けられます。期間終了24時間前までに解約しない限り自動更新されます。
              購入の管理は「設定」→「サブスクリプション」から行えます。
            </Text>

            <View style={{ height: 160 }} />
          </Animated.View>
        </ScrollView>

        {/* ── 固定フッター ── */}
        <View style={st.footer}>
          {loading ? (
            <View style={[st.ctaBtn, { justifyContent: 'center' }]}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : (
            <TouchableOpacity
              style={st.ctaBtn}
              onPress={handlePurchase}
              disabled={purchasing}
              activeOpacity={0.9}
            >
              {purchasing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={st.ctaBtnText}>
                  プランを選ぶ
                </Text>
              )}
            </TouchableOpacity>
          )}

          {/* いつでも解約可能 */}
          <View style={st.cancelRow}>
            <Ionicons name="shield-checkmark-outline" size={14} color="rgba(255,255,255,0.4)" />
            <Text style={st.cancelText}>いつでも解約可能</Text>
          </View>

          {/* サブリンク */}
          <View style={st.subLinks}>
            <TouchableOpacity onPress={handleRestore} disabled={restoring}>
              {restoring
                ? <ActivityIndicator color="rgba(255,255,255,0.4)" size="small" />
                : <Text style={st.subLinkText}>購入を復元する</Text>
              }
            </TouchableOpacity>
          </View>
        </View>

      </SafeAreaView>
    </View>
  )
}

// ── スタイル ──────────────────────────────────────────────────────
const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  currentPlanBadge: {
    marginTop: 12, alignSelf: 'center',
    backgroundColor: 'rgba(22,101,52,0.25)',
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.5)',
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6,
  },
  currentPlanText: { color: '#4ade80', fontSize: 12, fontWeight: '800' },

  closeCircle: {
    position:  'absolute', top: 14, right: 20, zIndex: 10,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },

  scroll: { paddingTop: 64 },

  // ── ヒーロー
  heroSection: { paddingHorizontal: 28, paddingTop: 16, paddingBottom: 24 },
  heroTitle: {
    fontSize: 32, fontWeight: '900', color: '#ffffff',
    letterSpacing: -0.8, lineHeight: 40, marginBottom: 12,
  },
  heroSub: { fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 20 },

  // ── プランタブ
  planTabs: {
    flexDirection: 'row', marginHorizontal: 28, marginBottom: 28,
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 4, gap: 4,
  },
  planTab: {
    flex: 1, paddingVertical: 9, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  planTabText: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },

  // ── 期間切替
  periodRow: {
    flexDirection: 'row', marginHorizontal: 28, marginBottom: 12, gap: 8,
  },
  periodChip: {
    paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  periodChipText: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },

  // ── プランカード
  planCard: {
    marginHorizontal: 28, marginBottom: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 2, borderRadius: 18,
    overflow: 'visible',
  },
  saveBadge: {
    position: 'absolute', top: -14, alignSelf: 'center',
    paddingHorizontal: 16, paddingVertical: 5,
    borderRadius: 20, zIndex: 1,
  },
  saveBadgeText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  planCardInner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 22, marginTop: 6,
  },
  planCardLabel: { fontSize: 16, fontWeight: '800', marginBottom: 2 },
  planCardSub:   { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  planCardPrice: { fontSize: 30, fontWeight: '900', letterSpacing: -1 },
  planCardUnit:  { fontSize: 15, fontWeight: '600', letterSpacing: 0 },

  // ── 注意書き
  legalText: {
    marginHorizontal: 28, fontSize: 11, color: 'rgba(255,255,255,0.3)', lineHeight: 17, textAlign: 'center',
  },

  // ── フッター
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 24, paddingBottom: 36, paddingTop: 12,
    backgroundColor: BG,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)',
  },

  // ── CTAボタン
  ctaBtn: {
    backgroundColor: '#166534', borderRadius: 50,
    paddingVertical: 18, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
    marginBottom: 12,
  },
  ctaBtnText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },

  // いつでも解約
  cancelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, marginBottom: 12,
  },
  cancelText: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },

  // サブリンク
  subLinks: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  subLinkText: { fontSize: 12, color: 'rgba(255,255,255,0.4)' },
  subLinkDot:  { color: 'rgba(255,255,255,0.2)', fontSize: 12 },
  couponLink:  { flexDirection: 'row', alignItems: 'center', gap: 4 },

  // 機能リスト
  featSection: {
    marginHorizontal: 28, marginBottom: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1.5, borderRadius: 18, borderColor: 'rgba(255,255,255,0.08)',
    padding: 20,
  },
  featSectionTitle: { fontSize: 13, fontWeight: '800', marginBottom: 14, letterSpacing: 0.3 },
  featRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  featRowText: { fontSize: 13, color: 'rgba(255,255,255,0.8)', flex: 1 },
  featDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 12 },
  featFreeNote: { fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 17 },

  // Web
  webWrap:  { flex: 1, backgroundColor: BG },
  webTitle: { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 12 },
  webSub:   { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 24, marginBottom: 32 },
})

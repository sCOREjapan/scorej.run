// app/paywall.tsx — sCORE プラン選択・購入画面

import React, { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform, Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { usePurchase } from '../context/PurchaseContext'

const { width } = Dimensions.get('window')
const BRAND = '#166534'

// ── プラン定義 ──────────────────────────────────────────────────────
const PLANS = [
  {
    id:       'free',
    label:    'FREE',
    color:    '#6b7280',
    tagline:  '今すぐ無料で始める',
    features: [
      '手動練習ログ（月10件）',
      'タイム記録（月5回）',
      'カレンダー表示',
      'ウォームアップ・ストレッチ',
      '記録一覧（直近30日）',
      'レベル・XP表示',
      '食事記録（テキストのみ）',
      '怪我リスクAI診断（1日1回）',
      'AIリカバリー相談（無制限）',
    ],
  },
  {
    id:       'pro',
    label:    'PRO',
    color:    BRAND,
    tagline:  '本格的に強くなりたい選手へ',
    monthlyPrice: '¥780',
    annualPrice:  '¥6,800',
    annualMonthly: '¥567',
    productMonthly: 'score_pro_monthly',
    productAnnual:  'score_pro_annual',
    features: [
      '手動練習ログ 無制限',
      'タイム記録 無制限・全期間表示',
      'AI練習分析・怪我リスク診断 無制限',
      'AI食事・栄養分析 無制限',
      '動画フォーム分析（月5回）',
      'AIリカバリー相談 無制限',
      'CSVエクスポート',
      'シェアカード生成',
      '全国ランキング参加',
      'GPSランニング記録',
    ],
  },
  {
    id:       'elite',
    label:    'ELITE',
    color:    '#f59e0b',
    tagline:  '競技で勝ちにいく選手・コーチへ',
    monthlyPrice: '¥1,480',
    annualPrice:  '¥12,800',
    annualMonthly: '¥1,067',
    productMonthly: 'score_elite_monthly',
    productAnnual:  'score_elite_annual',
    features: [
      'PROの全機能',
      '動画フォーム分析 無制限',
      'AIコーチチャット（練習フィードバック）',
      'チーム機能（部員10名まで管理）',
      'コーチビュー（選手管理ダッシュボード）',
      '優先サポート',
    ],
  },
]

type PeriodType = 'monthly' | 'annual'

export default function PaywallScreen() {
  const router = useRouter()
  const { tier: currentTier, packages, purchase, restore, loading } = usePurchase()

  const [selectedPlan,   setSelectedPlan]   = useState<'pro' | 'elite'>('pro')
  const [period,         setPeriod]         = useState<PeriodType>('annual')
  const [purchasing,     setPurchasing]     = useState(false)
  const [restoring,      setRestoring]      = useState(false)

  // ── 購入処理 ──────────────────────────────────────────────────
  const handlePurchase = async () => {
    const plan   = PLANS.find(p => p.id === selectedPlan)
    const prodId = period === 'annual' ? plan?.productAnnual : plan?.productMonthly

    // RevenueCat パッケージから該当を検索
    const pkg = packages.find(p =>
      p.product?.productIdentifier === prodId ||
      (period === 'annual'  && (p.packageType === 'ANNUAL'  || p.product?.productIdentifier?.includes('annual')))  ||
      (period === 'monthly' && (p.packageType === 'MONTHLY' || p.product?.productIdentifier?.includes('monthly')))
    )

    if (!pkg && packages.length > 0) {
      // フォールバック: 最初のパッケージ
    }

    const target = pkg ?? (packages.length > 0 ? packages[0] : null)
    if (!target) return

    setPurchasing(true)
    try { await purchase(target) }
    finally { setPurchasing(false) }
  }

  const handleRestore = async () => {
    setRestoring(true)
    try { await restore() }
    finally { setRestoring(false) }
  }

  // ── Web では案内表示 ──────────────────────────────────────────
  if (Platform.OS === 'web') {
    return (
      <View style={st.webWrap}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
          <Text style={{ fontSize: 40, marginBottom: 16 }}>📱</Text>
          <Text style={st.webTitle}>iOSアプリで購入できます</Text>
          <Text style={st.webSub}>
            sCORE PRO / ELITEは{'\n'}
            App Storeの「sCORE」アプリからご購入ください。{'\n\n'}
            (近日公開予定)
          </Text>
          <TouchableOpacity style={st.closeBtn} onPress={() => router.back()}>
            <Text style={st.closeBtnText}>閉じる</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    )
  }

  // ── 選択中プランの価格 ────────────────────────────────────────
  const plan       = PLANS.find(p => p.id === selectedPlan)!
  const dispPrice  = period === 'annual' ? plan.annualPrice  : plan.monthlyPrice
  const perMonth   = period === 'annual' ? plan.annualMonthly : plan.monthlyPrice

  return (
    <View style={st.container}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* ヘッダー */}
        <View style={st.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={st.headerTitle}>プランを選ぶ</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={st.scroll}>

          {/* ── ロゴ ── */}
          <View style={st.hero}>
            <View style={st.logoMark}><Text style={st.logoLetter}>S</Text></View>
            <Text style={st.heroTitle}>sCORE</Text>
            <Text style={st.heroSub}>陸上競技のパートナー</Text>
          </View>

          {/* ── 支払い期間切替 ── */}
          <View style={st.periodWrap}>
            <View style={st.periodToggle}>
              <TouchableOpacity
                style={[st.periodBtn, period === 'monthly' && st.periodBtnActive]}
                onPress={() => setPeriod('monthly')}
              >
                <Text style={[st.periodBtnText, period === 'monthly' && st.periodBtnTextActive]}>月払い</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.periodBtn, period === 'annual' && st.periodBtnActive]}
                onPress={() => setPeriod('annual')}
              >
                <Text style={[st.periodBtnText, period === 'annual' && st.periodBtnTextActive]}>年払い</Text>
                <View style={st.savePill}><Text style={st.savePillText}>お得</Text></View>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── プランカード ── */}
          <View style={st.planWrap}>
            {PLANS.map(p => {
              if (p.id === 'free') return null  // FREE は比較表のみ
              const isSelected = selectedPlan === p.id
              const isCurrent  = currentTier === p.id
              const price = period === 'annual' ? p.annualPrice : p.monthlyPrice
              const sub   = period === 'annual' ? `月あたり ${p.annualMonthly}` : null

              return (
                <TouchableOpacity
                  key={p.id}
                  style={[st.planCard, isSelected && { borderColor: p.color, backgroundColor: `${p.color}18` }]}
                  onPress={() => setSelectedPlan(p.id as 'pro' | 'elite')}
                  activeOpacity={0.85}
                >
                  {isCurrent && (
                    <View style={[st.currentBadge, { backgroundColor: p.color }]}>
                      <Text style={st.currentBadgeText}>現在のプラン</Text>
                    </View>
                  )}
                  {p.id === 'elite' && !isCurrent && (
                    <View style={[st.currentBadge, { backgroundColor: '#f59e0b' }]}>
                      <Text style={st.currentBadgeText}>👑 最上位</Text>
                    </View>
                  )}

                  <View style={st.planCardInner}>
                    {/* ラジオ + ラベル */}
                    <View style={st.planCardLeft}>
                      <View style={[st.radio, isSelected && { borderColor: p.color }]}>
                        {isSelected && <View style={[st.radioDot, { backgroundColor: p.color }]} />}
                      </View>
                      <View>
                        <Text style={[st.planLabel, { color: p.color }]}>{p.label}</Text>
                        <Text style={st.planTagline}>{p.tagline}</Text>
                      </View>
                    </View>

                    {/* 価格 */}
                    <View style={st.planCardRight}>
                      <Text style={[st.planPrice, isSelected && { color: '#fff' }]}>{price}</Text>
                      <Text style={st.planPeriodText}>{period === 'annual' ? '/ 年' : '/ 月'}</Text>
                      {sub && <Text style={[st.planSubPrice, { color: p.color }]}>{sub}</Text>}
                    </View>
                  </View>

                  {/* 機能リスト */}
                  <View style={st.featList}>
                    {p.features.map((f, i) => (
                      <View key={i} style={st.featRow}>
                        <Ionicons name="checkmark-circle" size={15} color={p.color} />
                        <Text style={st.featText}>{f}</Text>
                      </View>
                    ))}
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* ── FREE プラン内容 ── */}
          <View style={st.section}>
            <Text style={st.sectionLabel}>FREE（無料）でできること</Text>
            <View style={st.freeBox}>
              {PLANS[0].features.map((f, i) => (
                <View key={i} style={st.freeRow}>
                  <Ionicons name="checkmark" size={14} color="#4ade80" />
                  <Text style={st.freeText}>{f}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── 注意書き ── */}
          <View style={st.noteWrap}>
            <Text style={st.noteText}>
              • 購入はApple IDに紐付けられます{'\n'}
              • 期間終了24時間前までに解約しない限り自動更新されます{'\n'}
              • 購入の管理はiPhone「設定」→「サブスクリプション」から行えます{'\n'}
              • 年払いは一括で請求されます
            </Text>
          </View>

          <View style={{ height: 140 }} />
        </ScrollView>

        {/* ── 購入ボタン（固定フッター） ── */}
        <View style={st.footer}>
          {loading ? (
            <View style={[st.purchaseBtn, { justifyContent: 'center' }]}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : (
            <TouchableOpacity
              style={[st.purchaseBtn, { backgroundColor: plan.color }]}
              onPress={handlePurchase}
              disabled={purchasing}
              activeOpacity={0.85}
            >
              {purchasing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={st.purchaseBtnText}>
                  {`${plan.label} ${period === 'annual' ? '年払い' : '月払い'} ${dispPrice} で始める`}
                </Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity style={st.restoreBtn} onPress={handleRestore} disabled={restoring}>
            {restoring
              ? <ActivityIndicator color="#6b7280" size="small" />
              : <Text style={st.restoreText}>以前の購入を復元する</Text>
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  )
}

// ── スタイル ──────────────────────────────────────────────────────
const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  scroll: { paddingBottom: 20 },

  hero: { alignItems: 'center', paddingVertical: 24 },
  logoMark: {
    width: 56, height: 56, borderRadius: 16, backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
    shadowColor: BRAND, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 20,
  },
  logoLetter: { color: '#fff', fontSize: 30, fontWeight: '900' },
  heroTitle: { fontSize: 24, fontWeight: '900', color: '#fff', letterSpacing: -1 },
  heroSub:   { fontSize: 13, color: '#9ca3af', marginTop: 4 },

  periodWrap:   { paddingHorizontal: 20, marginBottom: 16 },
  periodToggle: {
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12, padding: 3,
  },
  periodBtn: {
    flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 10,
    flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  periodBtnActive:    { backgroundColor: 'rgba(255,255,255,0.12)' },
  periodBtnText:      { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  periodBtnTextActive: { color: '#fff' },
  savePill: {
    backgroundColor: BRAND, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  savePillText: { fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },

  planWrap: { paddingHorizontal: 16, gap: 12, marginBottom: 24 },
  planCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 18, padding: 16,
    position: 'relative', overflow: 'hidden',
  },
  currentBadge: {
    position: 'absolute', top: 10, right: 10,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  currentBadgeText: { fontSize: 10, color: '#fff', fontWeight: '800' },
  planCardInner: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  planCardLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1 },
  radio: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center', marginTop: 2, flexShrink: 0,
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  planLabel:   { fontSize: 17, fontWeight: '900', letterSpacing: -0.5 },
  planTagline: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  planCardRight: { alignItems: 'flex-end' },
  planPrice:     { fontSize: 20, fontWeight: '900', color: '#d1d5db', letterSpacing: -0.5 },
  planPeriodText: { fontSize: 11, color: '#6b7280', marginTop: 1 },
  planSubPrice: { fontSize: 11, fontWeight: '700', marginTop: 3 },

  featList: { gap: 8 },
  featRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featText: { fontSize: 12, color: '#d1d5db', flex: 1 },

  section: { paddingHorizontal: 16, marginBottom: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#4ade80', letterSpacing: 1.5, marginBottom: 10, textTransform: 'uppercase' },
  freeBox: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 14, gap: 10 },
  freeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  freeText: { fontSize: 13, color: '#9ca3af' },

  noteWrap: { marginHorizontal: 16, padding: 14, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10 },
  noteText: { fontSize: 11, color: '#6b7280', lineHeight: 18 },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingBottom: 32, paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.95)',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
    gap: 10,
  },
  purchaseBtn: {
    paddingVertical: 17, borderRadius: 16, alignItems: 'center',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 14,
  },
  purchaseBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  restoreBtn: { alignItems: 'center', paddingVertical: 8 },
  restoreText: { color: '#6b7280', fontSize: 13 },

  webWrap:     { flex: 1, backgroundColor: '#000' },
  webTitle:    { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 12 },
  webSub:      { fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  closeBtn:    { backgroundColor: BRAND, paddingHorizontal: 36, paddingVertical: 14, borderRadius: 12 },
  closeBtnText:{ color: '#fff', fontWeight: '700', fontSize: 15 },
})

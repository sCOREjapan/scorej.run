// app/paywall.tsx — sCORE プラン選択・購入画面
// App Store Review ガイドライン対応:
//  - 全機能は無料で利用可能（広告あり）
//  - 広告なしプラン: 広告を非表示にするだけ
//  - コーチプラン: チーム管理・コーチ向け機能
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
import { usePurchase } from '../context/PurchaseContext'
import Toast from 'react-native-toast-message'

const BRAND  = '#16a34a'
const GOLD   = '#d97706'
const BG     = '#0a0a0a'
const CARD   = '#1a1a1a'
const BORDER = '#2a2a2a'

// ── プラン定義 ─────────────────────────────────────────────────────
const PLANS = [
  {
    id:          'noad'   as const,
    productId:   'score_noad_monthly_v2',
    label:       '広告なしプラン',
    price:       '¥980',
    period:      '/ 月',
    color:       BRAND,
    icon:        '🚫',
    tagline:     '広告を無くす',
    features: [
      '限定シェアカードデザインが使える',
      '全ての機能がそのまま使える',
      'バナー広告・動画広告が完全に消える',
      '広告の読み込み待ちがなくなる',
      'アプリ起動時の広告もなし',
    ],
  },
  {
    id:          'coach'  as const,
    productId:   'score_coach_monthly_v2',
    label:       'コーチプラン',
    price:       '¥1,980',
    period:      '/ 月',
    color:       GOLD,
    icon:        '🏆',
    tagline:     'チームを管理するコーチ・顧問の方へ',
    features: [
      '広告なしプランの全機能',
      'チームメンバー全員のコンディション一覧',
      'チーム全体のコンディション・リスク傾向ダッシュボード',
      'コーチノート・チーム内共有機能',
      'AIによる練習メニュー提案（チーム向け）',
    ],
  },
] as const

type PlanId = typeof PLANS[number]['id']

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
  const { plan: planParam } = useLocalSearchParams<{ plan?: string }>()
  const { tier, packages, packagesDiagnostic, packagesReady, purchase, restore, refreshStatus } = usePurchase()

  const [selected,   setSelected]   = useState<PlanId>(planParam === 'coach' ? 'coach' : 'noad')
  const [purchasing, setPurchasing] = useState(false)
  const [restoring,  setRestoring]  = useState(false)
  const fadeAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start()
    refreshStatus().catch(() => {})
  }, [])

  // 購入済みならホームへ
  useEffect(() => {
    if (tier !== 'free') {
      Toast.show({ type: 'success', text1: 'プランが有効です ✅' })
      router.back()
    }
  }, [tier])

  const selectedPlan = PLANS.find(p => p.id === selected)!

  // packages から今選択中のプロダクトに対応するパッケージを探す
  const targetPkg = packages.find(
    (pkg: any) => pkg.product?.identifier === selectedPlan.productId
  )

  const handlePurchase = useCallback(async () => {
    if (!targetPkg) {
      Toast.show({
        type: 'error',
        text1: '商品の読み込みに失敗しました',
        text2: packagesDiagnostic ?? 'しばらく待ってから再試行してください',
        visibilityTime: 6000,
      })
      return
    }
    setPurchasing(true)
    try {
      await purchase(targetPkg)
    } finally {
      setPurchasing(false)
    }
  }, [targetPkg, purchase])

  const handleRestore = useCallback(async () => {
    setRestoring(true)
    try { await restore() } finally { setRestoring(false) }
  }, [restore])

  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      {/* ── ヘッダー ── */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={st.headerTitle}>プランを選択</Text>
        <View style={{ width: 40 }} />
      </View>

      <Animated.ScrollView style={{ flex: 1, opacity: fadeAnim }} contentContainerStyle={st.scroll}>

        {/* ── リード文 ── */}
        <Text style={st.lead}>sCORE の全機能は{'\n'}<Text style={{ color: BRAND, fontWeight: '900' }}>無料</Text>でお使いいただけます。</Text>
        <Text style={st.subLead}>プランに加入すると広告が消えたり{'\n'}チーム管理機能が使えるようになります。</Text>

        {/* ── プランカード ── */}
        {PLANS.map(plan => {
          const isSelected = selected === plan.id
          return (
            <TouchableOpacity
              key={plan.id}
              onPress={() => setSelected(plan.id)}
              activeOpacity={0.8}
              style={[
                st.planCard,
                isSelected && { borderColor: plan.color, borderWidth: 2 },
              ]}
            >
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
                  <Text style={[st.planPrice, { color: plan.color }]}>{plan.price}</Text>
                  <Text style={st.planPeriod}>{plan.period}</Text>
                </View>
              </View>

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
              {`${selectedPlan.label} を始める  ${selectedPlan.price}${selectedPlan.period}`}
            </Text>
          )}
        </TouchableOpacity>

        {/* ── 法的必須テキスト（Apple審査要件 3.1.2） ── */}
        <View style={st.legalBox}>
          <Text style={st.legalText}>
            • サブスクリプションは月ごとに自動更新されます。{'\n'}
            • 更新の24時間前までにキャンセルしない限り、同額で自動更新されます。{'\n'}
            • キャンセルは「設定」→「Apple ID」→「サブスクリプション」から行えます。{'\n'}
            • 購入後のキャンセルによる返金は Apple のポリシーに準じます。
          </Text>
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 10 }}>
            <TouchableOpacity onPress={() => Linking.openURL('https://scorej-run.vercel.app/privacy')}>
              <Text style={st.legalLink}>プライバシーポリシー</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Linking.openURL('https://scorej-run.vercel.app/terms')}>
              <Text style={st.legalLink}>利用規約</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 復元ボタン（Apple審査で必須） ── */}
        <TouchableOpacity onPress={handleRestore} disabled={restoring} style={st.restoreBtn}>
          {restoring
            ? <ActivityIndicator color="#666" size="small" />
            : <Text style={st.restoreText}>購入を復元する</Text>
          }
        </TouchableOpacity>

        {/* ── DEV専用スキップ（本番ビルドには含まれない） ── */}
        {__DEV__ && (
          <TouchableOpacity
            style={{ marginTop: 12, alignSelf: 'center', padding: 10 }}
            onPress={async () => {
              const plan = selected === 'coach' ? 'coach' : 'noad'
              await AsyncStorage.setItem('trackmate_subscription', JSON.stringify({
                isPremium: true, plan, expiresAt: '2099-12-31T00:00:00.000Z',
              }))
              Toast.show({ type: 'success', text1: `[DEV] ${plan} を擬似有効化しました` })
              router.back()
            }}
          >
            <Text style={{ color: '#f59e0b', fontSize: 12, fontWeight: '700' }}>
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
  headerTitle:     { fontSize: 17, fontWeight: '700', color: '#fff' },
  scroll:          { paddingHorizontal: 16, paddingTop: 8 },
  lead:            { fontSize: 26, fontWeight: '900', color: '#fff', textAlign: 'center', lineHeight: 36, marginBottom: 8 },
  subLead:         { fontSize: 14, color: '#999', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  planCard:        { backgroundColor: CARD, borderRadius: 21, padding: 18, marginBottom: 14, borderWidth: 1.5, borderColor: BORDER },
  planTop:         { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  radio:           { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#555', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  radioDot:        { width: 10, height: 10, borderRadius: 5 },
  planLabel:       { fontSize: 17, fontWeight: '800', color: '#fff' },
  planTagline:     { fontSize: 12, color: '#888', marginTop: 2 },
  planPrice:       { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  planPeriod:      { fontSize: 11, color: '#888', marginTop: 1 },
  featList:        { gap: 8, paddingLeft: 4 },
  checkRow:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkText:       { fontSize: 13, color: '#ccc', flex: 1 },
  purchaseBtn:     { borderRadius: 21, paddingVertical: 16, alignItems: 'center', marginTop: 8, marginBottom: 4 },
  purchaseBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  legalBox:        { backgroundColor: '#111', borderRadius: 14, padding: 14, marginTop: 16 },
  legalText:       { fontSize: 11, color: '#666', lineHeight: 18 },
  legalLink:       { fontSize: 11, color: '#888', textDecorationLine: 'underline' },
  restoreBtn:      { alignItems: 'center', paddingVertical: 14 },
  restoreText:     { fontSize: 14, color: '#666' },
})

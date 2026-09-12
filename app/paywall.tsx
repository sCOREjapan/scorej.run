// app/paywall.tsx — sCORE プラン選択・購入画面
// App Store Review ガイドライン対応:
//  - 全機能は無料で利用可能（チケット制。初回付与は2026-09-11に廃止し、
//    3日間ミッションのDay1報酬(5枚)に置き換え済み。lib/missionStore.ts参照）
//  - 広告なしプラン: 広告を非表示にするだけ
//  - チケット月額プラン: 広告なし＋毎月チケット100枚
//  - コーチプラン: チケット月額プランの内容＋チーム管理・コーチ向け機能
//  - 復元ボタン必須（3.1.1）
//  - 価格・更新周期・キャンセル方法を明記（3.1.2）

import React, { useState, useEffect, useRef, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform, Animated, Linking, Alert, Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { usePurchase } from '../context/PurchaseContext'
import { PRODUCT_IDS, TICKET_MONTHLY_GRANT } from '../lib/purchaseService'
import { trackPaywallView, trackTrialStarted, trackEvent } from '../lib/analytics'
import { getMissionState } from '../lib/missionStore'
import { fetchMembers } from '../lib/supabaseTeam'
import Toast from 'react-native-toast-message'
import DarkScreenBg, { DARK_ACCENT } from '../components/DarkGradientBg'

// 2026-09-07: オンボーディング刷新のダークグリーン系デザインシステムに合わせて全面刷新。
// BRANDはonboarding.tsxの基調色(#166534)に統一（旧#16a34aはこのファイル内でのみ使う
// 微妙に違う緑で、画面をまたぐと色が揃わなかったため）。
const BRAND  = '#166534'
const TIX    = '#f59e0b'
const GOLD   = '#d97706'
const BORDER = 'rgba(0,0,0,0.08)'
const CARD   = '#ffffff'
const TICKET_ICON = require('../assets/icons/ticket.png')
// 2026-09-11: 「チケット月額プランの横は、プレミアム(金×ホロ箔)チケットの方にしてほしい」との指示
const PREMIUM_TICKET_ICON = require('../assets/icons/ticket_premium.png')
const TEXT_PRIMARY = '#111827'
const TEXT_SECONDARY = '#6b7280'
const TEXT_HINT = '#9ca3af'
// ダーク背景(緑グラデーション)に直接乗る文字色。白カードの中の文字は上のTEXT_*のまま。
const DTXT       = '#ffffff'
const DTXT_SUB   = 'rgba(255,255,255,0.72)'
const DTXT_HINT  = 'rgba(255,255,255,0.55)'

type PlanId = 'ticket_monthly' | 'coach'
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
  // 2026-09-07: ¥480広告なしプラン単体は新規販売を終了（チケット月額プランに一本化）。
  // 既存加入者はlib/adGate.tsのisLegacyUnlimitedNoad()でグランドファザリングされ続けるため、
  // PRODUCT_IDS.noad_monthly/noad_yearlyやPlanTierの'noad'自体は削除していない。
  return [
    {
      // iconは'🎫'のまま持たせておき(型を崩さないため)、描画側でticket_monthlyだけ
      // 実チケット画像に差し替える(2026-09-11: 他画面と絵柄を統一するため)
      id: 'ticket_monthly', color: BRAND, icon: '🎫',
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

// 月額（または年額の月換算）price文字列（例:"¥980"）から1日あたりの目安額を出す。
// 「月額980円」より「1日あたり33円」の方が心理的な負担感が小さく見えるアンカリング表示。
// ¥表記以外(将来の多通貨対応)や数値が取れない場合はnullを返して非表示にする。
function dailyPriceLabel(t: (key: string, opts?: any) => string, priceStr: string): string | null {
  const n = Number(priceStr.replace(/[^\d]/g, ''))
  if (!n) return null
  const daily = Math.max(1, Math.round(n / 30))
  return t('paywall.perDayApprox', { price: `¥${daily.toLocaleString()}` })
}

// 2026-09-11: 3日間ミッション達成直後の「?sale=1」導線用。StoreKit/Play Consoleの
// 導入価格(Introductory Offer、価格>0のもの)が実際に設定されていれば、その価格を
// そのまま表示する。設定されていない場合はnullを返し、呼び出し側は通常価格のまま
// 表示する（「980→480」と謳っておいて実際は980円のまま課金される、という事故を防ぐ。
// 本当にその価格で購入できることは、この画面のコードではなくApp Store Connect /
// RevenueCat側の商品設定が保証する）。
function paidIntroPriceString(pkg: any): string | null {
  const intro = pkg?.product?.introPrice
  if (!intro || typeof intro.price !== 'number' || intro.price <= 0) return null
  return intro.priceString ?? null
}

// 2026-09-11: 「16人の壁」対策。コーチプランをチーム人数に応じた3段階制にした
// （〜15人¥1,980／〜30人¥2,980／無制限¥4,980。同じサブスクライブグループ内の
// 別商品として作成——導入価格ではなく普通の価格設定。lib/purchaseService.ts参照）。
// 商品がまだストア側で未作成/未承認の間は、purchase()側がpackagesに見つからず
// 従来通りエラー表示になるだけで、¥1,980の基本コーチプラン自体には影響しない。
function coachTierForMemberCount(count: number): { productId: string; price: string } {
  if (count > 30) return { productId: PRODUCT_IDS.coach_monthly_unlimited, price: '¥4,980' }
  if (count > 15) return { productId: PRODUCT_IDS.coach_monthly_30, price: '¥2,980' }
  return { productId: PRODUCT_IDS.coach_monthly, price: '¥1,980' }
}

// 24時間セールの残り時間を HH:MM:SS 表記にする
function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const sec = totalSec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function CheckRow({ color, text, dark }: { color: string; text: string; dark?: boolean }) {
  return (
    <View style={st.checkRow}>
      <Ionicons name="checkmark-circle" size={16} color={color} />
      <Text style={[st.checkText, dark ? { color: DTXT_SUB } : null]}>{text}</Text>
    </View>
  )
}

export default function PaywallScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { plan: planParam, sale: saleParam } = useLocalSearchParams<{ plan?: string; sale?: string }>()
  const { tier, hasTicketMonthly, packages, packagesDiagnostic, packagesReady, purchase, restore, refreshStatus } = usePurchase()

  // 2026-09-11: 元々は3日間ミッション達成直後の「?plan=ticket_monthly&sale=1」導線
  // だったが、専用のapp/mission-offer.tsxに差し替えたため、この画面には現在どこからも
  // ?sale=1では遷移してこない（components/MissionModal.tsx参照）。呼び出し側が無くなった
  // だけで壊れてはいないため、他からの直リンクに備えて分岐自体はそのまま残してある。
  const isSaleMode = saleParam === '1'
  const [saleExpiresAt, setSaleExpiresAt] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState(Date.now())
  useEffect(() => {
    if (!isSaleMode) return
    getMissionState().then(s => setSaleExpiresAt(s.saleExpiresAt ?? null)).catch(() => {})
  }, [isSaleMode])
  useEffect(() => {
    if (!isSaleMode || !saleExpiresAt) return
    const timer = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isSaleMode, saleExpiresAt])
  const saleRemainingMs = saleExpiresAt ? new Date(saleExpiresAt).getTime() - nowTick : 0
  const saleActive = isSaleMode && saleExpiresAt != null && saleRemainingMs > 0

  // 2026-09-11: コーチプランの3段階制のため、自分のチームの現在の登録人数を読む。
  // コーチとして未セットアップ（trackmate_team_setupが無い）場合は従来通り
  // 基本の¥1,980のまま（coachTierForMemberCountのデフォルト分岐）。
  const [teamMemberCount, setTeamMemberCount] = useState<number | null>(null)
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('trackmate_team_setup')
        if (!raw) return
        const setup = JSON.parse(raw)
        if (!setup?.code) return
        const members = await fetchMembers(setup.code)
        setTeamMemberCount(members.length)
      } catch {}
    })()
  }, [])

  const PLANS = buildPlans(t)
  if (teamMemberCount != null) {
    const coachPlan = PLANS.find(p => p.id === 'coach')
    if (coachPlan) {
      const tier = coachTierForMemberCount(teamMemberCount)
      coachPlan.monthly = { ...coachPlan.monthly, productId: tier.productId, price: tier.price }
      // 2026-09-12バグ修正: 「年額は安くなってる表記なのに、実際に課金しようとすると
      // 19800円だった」という報告への対応。coachPlan.yearly(¥1,650/月換算=¥19,800/年)は
      // 〜15人ティアの価格のまま固定のPRODUCT_IDS.coach_yearly 1本しか無く、
      // 〜30人/無制限ティアの年額商品がまだ存在しない。そのため上のmonthlyだけを
      // ティアに応じて差し替えても、年額を選ぶと常にこの安い〜15人ティアの価格・商品で
      // 課金されてしまっていた(表示と実際の請求額のズレどころか、大きいチームほど
      // 本来より安く課金されてしまう実害あり)。〜15人ティア以外では年額の選択肢
      // 自体を一旦非表示にする(該当ティアの年額商品を作成するまでの暫定対応)。
      if (tier.productId !== PRODUCT_IDS.coach_monthly) {
        delete coachPlan.yearly
      }
    }
  }
  // 2026-09-07: サブスク推奨画面をリニューアル。チケットプランを一律で推奨する
  // 比較デザイン(Free/チケットの2択のみ・コーチはテキストリンクのみ)を追加したが、
  // 2026-09-08: コーチプランと980円プランを両方きちんと選べる既存の3プラン一覧UI
  // （下のuseComparisonDesign=falseの分岐）だけを残すことになったため、
  // 比較デザイン分岐は使わない（コードは残すが常にfalse固定）。
  const initialPlan: PlanId = planParam === 'coach' ? 'coach' : 'ticket_monthly'
  const useComparisonDesign = false
  const [selected,   setSelected]   = useState<PlanId>(initialPlan)
  const [periods,    setPeriods]    = useState<Record<PlanId, Period>>({ ticket_monthly: 'monthly', coach: 'monthly' })
  const [purchasing, setPurchasing] = useState(false)
  const [restoring,  setRestoring]  = useState(false)
  const fadeAnim = useRef(new Animated.Value(0)).current
  // 購入ボタンの「少し光らせる」呼吸するグロー（0↔1を往復するだけの単純なopacityアニメ）
  const ctaGlow = useRef(new Animated.Value(0)).current
  // setPurchasingは再レンダー待ちで反映が非同期なため、連打防止には同期的なrefロックが必要
  const purchaseLockRef = useRef(false)

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start()
    refreshStatus().catch(() => {})
    trackPaywallView(`paywall_screen:${initialPlan}`)
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(ctaGlow, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(ctaGlow, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ])
    )
    glowLoop.start()
    return () => glowLoop.stop()
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
      // Toastは幅が狭く長い診断文字列が途中で切れて読めないため、
      // 原因調査中はAlertで全文表示する（ボタンで消すまで残るのでスクショも撮りやすい）。
      if (packagesDiagnostic) {
        Alert.alert(t('paywall.loadFailedTitle'), packagesDiagnostic)
      } else {
        Toast.show({
          type: 'error',
          text1: t('paywall.loadFailedTitle'),
          text2: t('paywall.loadFailedRetry'),
          visibilityTime: 6000,
        })
      }
      return
    }
    purchaseLockRef.current = true
    setPurchasing(true)
    try {
      const ok = await purchase(targetPkg)
      if (ok && selectedTrialDays) trackTrialStarted(selected)
    } finally {
      setPurchasing(false)
      purchaseLockRef.current = false
    }
  }, [targetPkg, purchase, packagesDiagnostic, selectedTrialDays, selected])

  const handleRestore = useCallback(async () => {
    setRestoring(true)
    try { await restore() } finally { setRestoring(false) }
  }, [restore])

  // ── 購入ボタン以下（法的必須テキスト・復元・DEV用）は新旧デザイン共通 ──
  const renderPurchaseFooter = () => (
    <>
      <View style={st.purchaseBtnWrap}>
        {/* 「少し光らせる」— ボタンの外周にごく淡く呼吸するグローを1枚敷くだけ。
            iOS/Android/webのどこでもぼかしCSSに頼らず同じ見た目になるよう、
            半透明の同色背景レイヤーのopacityをアニメーションさせる方式にしている */}
        <Animated.View
          pointerEvents="none"
          style={[
            st.purchaseBtnGlow,
            {
              opacity: ctaGlow.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.4] }),
              transform: [{ scale: ctaGlow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }],
            },
          ]}
        />
        <TouchableOpacity
          onPress={handlePurchase}
          disabled={purchasing || !packagesReady}
          activeOpacity={0.85}
          style={[st.purchaseBtn, (purchasing || !packagesReady) && { opacity: 0.55 }]}
        >
          {purchasing ? (
            <ActivityIndicator color={selectedPlan.color} />
          ) : (
            <Text style={[st.purchaseBtnText, { color: selectedPlan.color }]}>
              {selectedTrialDays
                ? t('paywall.startTrial', { days: selectedTrialDays })
                : t('paywall.startPlan', { label: selectedPlan.label, price: selectedTerms.price, period: selectedTerms.period })}
            </Text>
          )}
        </TouchableOpacity>
      </View>
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
          ? <ActivityIndicator color={DTXT_SUB} size="small" />
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
    </>
  )

  return (
    <DarkScreenBg>
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      {/* ── ヘッダー ── */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityLabel="閉じる" accessibilityRole="button">
          <Ionicons name="close" size={24} color={DTXT} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>{t('paywall.headerTitle')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {useComparisonDesign ? (
        <Animated.ScrollView style={{ flex: 1, opacity: fadeAnim }} contentContainerStyle={st.scrollCompare}>
          {/* ── ヒーロー（ダーク背景に直接乗せる。他のオンボーディング画面と同じeyebrow+見出しの並び） ── */}
          <View style={st.heroWrap}>
            {selectedTrialDays ? (
              <View style={st.heroOffer}>
                <Text style={st.heroOfferTxt}>{t('paywall.trialBadge', { days: selectedTrialDays })}</Text>
              </View>
            ) : null}
            <Text style={st.heroTitle}>{t('paywall.compare.heroTitle')}</Text>
            <Text style={st.heroSub}>{t('paywall.compare.heroSubtitle', { count: TICKET_MONTHLY_GRANT })}</Text>
          </View>

          {/* ── Free vs チケット 比較表（白カードのまま＝可読性優先。選択カードが白のオンボーディングと同じ言語） ── */}
          <View style={st.cmpWrap}>
            <View style={st.cmpColsRow}>
              <View style={{ flex: 1 }} />
              <Text style={st.cmpColH}>{t('paywall.compare.freeCol')}</Text>
              <Text style={[st.cmpColH, st.cmpColHActive]}>{t('paywall.compare.ticketCol')}</Text>
            </View>
            <View style={st.cmpRow}>
              <Text style={st.cmpFeat}>{t('paywall.compare.rowAdsHidden')}</Text>
              <Text style={[st.cmpMark, st.cmpMarkNo]}>✕</Text>
              <Text style={[st.cmpMark, st.cmpMarkYes]}>✓</Text>
            </View>
            <View style={st.cmpRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.cmpFeat}>{t('paywall.compare.rowMonthlyTickets')}</Text>
                <Text style={st.cmpFeatSub}>{t('paywall.compare.rowMonthlyTicketsSub', { count: TICKET_MONTHLY_GRANT })}</Text>
              </View>
              <Text style={[st.cmpMark, st.cmpMarkNo]}>✕</Text>
              <Text style={[st.cmpMark, st.cmpMarkYes]}>✓</Text>
            </View>
            <View style={st.cmpRow}>
              <Text style={st.cmpFeat}>{t('paywall.compare.rowAiFeatures')}</Text>
              <Text style={[st.cmpMark, st.cmpMarkYes]}>✓</Text>
              <Text style={[st.cmpMark, st.cmpMarkYes]}>✓</Text>
            </View>
            <View style={[st.cmpRow, { paddingBottom: 0 }]}>
              <Text style={st.cmpFeat}>{t('paywall.compare.rowExtraTickets')}</Text>
              <Text style={[st.cmpMark, st.cmpMarkYes]}>✓</Text>
              <Text style={[st.cmpMark, st.cmpMarkYes]}>✓</Text>
            </View>
          </View>

          {/* ── 価格カード（白カードに統一） ── */}
          <View style={st.priceCard}>
            <View>
              <Text style={st.priceCardLabel}>{selectedPlan.label}</Text>
              <Text style={st.priceCardSub}>{t('paywall.compare.priceCardSub', { price: selectedTerms.price })}</Text>
              {(() => {
                const daily = dailyPriceLabel(t, selectedTerms.price)
                return daily ? <Text style={st.priceCardDaily}>{daily}</Text> : null
              })()}
            </View>
            <View style={st.priceCardBadge}>
              <Text style={st.priceCardBadgeTxt}>{t('paywall.recommended')}</Text>
            </View>
          </View>

          <View style={{ marginTop: 14 }}>
            {renderPurchaseFooter()}
          </View>

          <TouchableOpacity onPress={() => router.back()} style={st.skipBtn} activeOpacity={0.7}>
            <Text style={st.skipTxt}>{t('paywall.compare.skipContinue')}</Text>
          </TouchableOpacity>

          {/* 2026-09-07: 比較デザインはFree/チケットの2択のみでコーチプランへの導線が
              無かったため、見つけやすいように控えめなテキストリンクを追加 */}
          <TouchableOpacity onPress={() => router.push('/paywall?plan=coach')} style={st.coachLinkBtn} activeOpacity={0.7}>
            <Text style={st.coachLinkTxt}>{t('paywall.compare.coachLink')}</Text>
          </TouchableOpacity>

          <View style={{ height: 32 }} />
        </Animated.ScrollView>
      ) : (
      <Animated.ScrollView style={{ flex: 1, opacity: fadeAnim }} contentContainerStyle={st.scroll}>

        {/* ── リード文（ダーク背景に直接乗せる） ── */}
        <Text style={st.lead}><Text style={{ color: DARK_ACCENT, fontWeight: '900' }}>{t('paywall.leadHighlight')}</Text>{t('paywall.leadRest')}</Text>
        <Text style={st.subLead}>{t('paywall.subLead')}</Text>

        {/* ── 3日間ミッション達成直後の24時間セールバナー ── */}
        {saleActive && (
          <View style={st.saleBanner}>
            <Ionicons name="time" size={16} color="#fff" />
            <Text style={st.saleBannerText}>{t('paywall.sale.banner')}</Text>
            <Text style={st.saleBannerCountdown}>{formatCountdown(saleRemainingMs)}</Text>
          </View>
        )}

        {/* ── プランカード（未選択=半透明白／選択=白。オンボーディングのDarkChoiceCardと同じ言語） ── */}
        {PLANS.map(plan => {
          const isSelected = selected === plan.id
          const period = plan.yearly ? periods[plan.id] : 'monthly'
          const terms = period === 'yearly' && plan.yearly ? plan.yearly : plan.monthly
          const trialDays = trialDaysFor(terms.productId)
          // セール対象はチケット月額プランのみ。App Store Connect/RevenueCat側で
          // 導入価格(価格>0のIntroductory Offer)が実際に設定されている時だけ、
          // 割引後の価格をそのまま表示する（設定が無ければ通常価格のまま＝誇大表示を避ける）
          const salePkg = plan.id === 'ticket_monthly'
            ? packages.find((p: any) => p.product?.identifier === terms.productId)
            : null
          const saleIntroPrice = saleActive && salePkg ? paidIntroPriceString(salePkg) : null
          return (
            <TouchableOpacity
              key={plan.id}
              onPress={() => setSelected(plan.id)}
              activeOpacity={0.8}
              style={[
                st.planCard,
                plan.recommended && { marginTop: 14 },
                isSelected && [st.planCardSelected, { borderColor: plan.color }],
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
                    {plan.id === 'ticket_monthly'
                      ? <Image source={PREMIUM_TICKET_ICON} style={{ width: 20, height: 20 }} resizeMode="contain" />
                      : <Text style={{ fontSize: 18 }}>{plan.icon}</Text>}
                    <Text style={[st.planLabel, isSelected ? { color: plan.color } : { color: DTXT }]}>{plan.label}</Text>
                  </View>
                  <Text style={[st.planTagline, !isSelected && { color: DTXT_SUB }]}>{plan.tagline}</Text>
                  {plan.id === 'coach' && teamMemberCount != null && (
                    <Text style={[st.planTagline, { fontSize: 11, opacity: 0.8 }]}>
                      {t('paywall.coachTeamSizeNote', { count: teamMemberCount })}
                    </Text>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {trialDays ? (
                    <View style={[st.trialBadge, { backgroundColor: plan.color }]}>
                      <Text style={st.trialBadgeTxt}>{t('paywall.trialBadge', { days: trialDays })}</Text>
                    </View>
                  ) : null}
                  {saleIntroPrice ? (
                    <>
                      <Text style={[st.planPriceStrike, !isSelected && { color: DTXT_HINT }]}>{terms.price}</Text>
                      <Text style={[st.planPrice, { color: isSelected ? plan.color : DTXT }]}>{saleIntroPrice}</Text>
                    </>
                  ) : (
                    <Text style={[st.planPrice, { color: isSelected ? plan.color : DTXT }]}>{terms.price}</Text>
                  )}
                  <Text style={[st.planPeriod, !isSelected && { color: DTXT_HINT }]}>{terms.period}</Text>
                  {period === 'yearly' && plan.yearly && <Text style={st.planNote}>{plan.yearly.note}</Text>}
                  {(() => {
                    const daily = dailyPriceLabel(t, saleIntroPrice ?? terms.price)
                    return daily ? <Text style={[st.planDaily, !isSelected && { color: DTXT_SUB }]}>{daily}</Text> : null
                  })()}
                </View>
              </View>

              {/* 2026-09-11: 「16人の壁」対策の3段階制。裏で価格が動的に切り替わるだけだと
                  コーチから見て「なぜこの値段なのか」が分からず不安になるため、料金カード
                  自体に3段階を明示し、現在の登録人数がどこに当たるかを見せる。 */}
              {plan.id === 'coach' && (() => {
                const currentPrice = teamMemberCount != null ? coachTierForMemberCount(teamMemberCount).price : null
                const tiers = [
                  { label: t('paywall.coachTier.upTo15'), price: '¥1,980' },
                  { label: t('paywall.coachTier.upTo30'), price: '¥2,980' },
                  { label: t('paywall.coachTier.unlimited'), price: '¥4,980' },
                ]
                return (
                  <View style={st.tierTable}>
                    <Text style={[st.tierTableTitle, !isSelected && { color: DTXT_SUB }]}>{t('paywall.coachTierTableTitle')}</Text>
                    {tiers.map(tier => {
                      const isCurrent = currentPrice === tier.price
                      return (
                        <View
                          key={tier.label}
                          style={[
                            st.tierRow,
                            { backgroundColor: isSelected ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.06)' },
                            isCurrent && { backgroundColor: plan.color + '22', borderColor: plan.color, borderWidth: 1 },
                          ]}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            {isCurrent && <Ionicons name="checkmark-circle" size={13} color={plan.color} />}
                            <Text style={[st.tierLabel, !isSelected && { color: DTXT_SUB }, isCurrent && { color: isSelected ? plan.color : DTXT, fontWeight: '800' }]}>{tier.label}</Text>
                          </View>
                          <Text style={[st.tierPrice, !isSelected && { color: DTXT_SUB }, isCurrent && { color: isSelected ? plan.color : DTXT, fontWeight: '800' }]}>{tier.price}</Text>
                        </View>
                      )
                    })}
                  </View>
                )
              })()}

              {/* 月額/年額トグル（年額オプションがあるプランのみ） */}
              {plan.yearly && (
                <View style={[st.seg, !isSelected && st.segDark]}>
                  <TouchableOpacity
                    onPress={() => setPeriods(p => ({ ...p, [plan.id]: 'monthly' }))}
                    style={[st.segBtn, period === 'monthly' && { backgroundColor: plan.color }]}
                  >
                    <Text style={[st.segBtnTxt, !isSelected && { color: DTXT_SUB }, period === 'monthly' && st.segBtnTxtActive]}>{t('paywall.monthly')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setPeriods(p => ({ ...p, [plan.id]: 'yearly' }))}
                    style={[st.segBtn, period === 'yearly' && { backgroundColor: plan.color }]}
                  >
                    <Text style={[st.segBtnTxt, !isSelected && { color: DTXT_SUB }, period === 'yearly' && st.segBtnTxtActive]}>{t('paywall.yearlyDiscount')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* 機能リスト */}
              <View style={st.featList}>
                {plan.features.map(f => <CheckRow key={f} color={isSelected ? plan.color : DARK_ACCENT} text={f} dark={!isSelected} />)}
              </View>
            </TouchableOpacity>
          )
        })}

        {renderPurchaseFooter()}

        {/* 2026-09-11: セール導線では「離脱=悪」ではなく、断る選択肢を明示して
            不安なく閉じられるようにする（見た目の緊急性はカウントダウンで十分に
            出しているため、無料継続の導線を隠す必要はない） */}
        {saleActive && (
          <TouchableOpacity onPress={() => router.back()} style={st.saleSkipBtn} activeOpacity={0.7}>
            <Text style={st.saleSkipText}>{t('paywall.sale.continueFree')}</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 32 }} />
      </Animated.ScrollView>
      )}
    </SafeAreaView>
    </DarkScreenBg>
  )
}

const st = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: 'transparent' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  closeBtn:        { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:     { fontSize: 17, fontWeight: '700', color: DTXT },
  scroll:          { paddingHorizontal: 16, paddingTop: 8 },
  lead:            { fontSize: 26, fontWeight: '900', color: DTXT, textAlign: 'center', lineHeight: 36, marginBottom: 8 },
  subLead:         { fontSize: 14, color: DTXT_SUB, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  // 未選択=半透明白カード／選択=白カード（onboarding.tsxのDarkChoiceCardと同じ言語）
  planCard:        { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 21, padding: 18, marginBottom: 14, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)', position: 'relative' },
  planCardSelected:{ backgroundColor: CARD, borderWidth: 2 },
  recBadge:        { position: 'absolute', top: -11, left: 18, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  recBadgeTxt:     { fontSize: 11, fontWeight: '800', color: '#fff' },
  planTop:         { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  radio:           { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  radioDot:        { width: 10, height: 10, borderRadius: 5 },
  planLabel:       { fontSize: 17, fontWeight: '800', color: TEXT_PRIMARY },
  planTagline:     { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },
  planPrice:       { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  planPriceStrike: { fontSize: 13, fontWeight: '700', textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] },
  planPeriod:      { fontSize: 11, color: TEXT_HINT, marginTop: 1 },
  planNote:        { fontSize: 10, color: DARK_ACCENT, marginTop: 2, fontWeight: '700' },
  planDaily:       { fontSize: 10, color: TEXT_HINT, marginTop: 2 },
  trialBadge:      { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 3 },
  trialBadgeTxt:   { fontSize: 10.5, fontWeight: '800', color: '#fff' },
  tierTable:       { marginTop: 12, marginBottom: 4, gap: 6 },
  tierTableTitle:  { fontSize: 11, fontWeight: '700', color: TEXT_HINT, marginBottom: 2 },
  tierRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10 },
  tierLabel:       { fontSize: 12.5, color: TEXT_SECONDARY },
  tierPrice:       { fontSize: 13, color: TEXT_SECONDARY, fontVariant: ['tabular-nums'] },
  seg:             { flexDirection: 'row', backgroundColor: '#f0f2f5', borderRadius: 12, padding: 3, gap: 3, marginBottom: 14 },
  segDark:         { backgroundColor: 'rgba(255,255,255,0.14)' },
  segBtn:          { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9 },
  segBtnTxt:       { fontSize: 12, fontWeight: '700', color: TEXT_SECONDARY },
  segBtnTxtActive: { color: '#fff' },
  featList:        { gap: 8, paddingLeft: 4 },
  checkRow:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkText:       { fontSize: 13, color: TEXT_SECONDARY, flex: 1 },
  // 購入CTAは白いカプセル＋プラン色文字（オンボーディングのDarkCTAButtonと統一）
  purchaseBtnWrap: { marginTop: 8, marginBottom: 4 },
  purchaseBtn:     { borderRadius: 21, paddingVertical: 16, alignItems: 'center', backgroundColor: '#fff' },
  purchaseBtnText: { fontSize: 16, fontWeight: '800' },
  // ボタンよりひと回り大きい半透明レイヤー。ぼかしCSSを使わず「淡い光の輪」に見せる
  purchaseBtnGlow: {
    position: 'absolute', top: -6, left: -6, right: -6, bottom: -6,
    borderRadius: 27, backgroundColor: DARK_ACCENT,
  },
  trialSubtext:    { fontSize: 11, color: DTXT_HINT, textAlign: 'center', marginTop: -2, marginBottom: 4 },
  legalBox:        { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: 14, marginTop: 16 },
  legalText:       { fontSize: 11, color: DTXT_SUB, lineHeight: 18 },
  legalLink:       { fontSize: 11, color: DTXT_SUB, textDecorationLine: 'underline' },
  restoreBtn:      { alignItems: 'center', paddingVertical: 14, minHeight: 44, justifyContent: 'center' },
  restoreText:     { fontSize: 14, color: DTXT_SUB },
  saleBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch',
    backgroundColor: 'rgba(217,119,6,0.9)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14,
    marginBottom: 14,
  },
  saleBannerText:      { flex: 1, color: '#fff', fontSize: 12.5, fontWeight: '800' },
  saleBannerCountdown: { color: '#fff', fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  saleSkipBtn:  { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  saleSkipText: { fontSize: 13, color: DTXT_SUB, textDecorationLine: 'underline' },

  // ── 比較デザイン（2026-09-07リニューアル：Free vs チケットプラン／ダークグリーン刷新） ──
  scrollCompare:   { paddingBottom: 8 },
  heroWrap:        { paddingHorizontal: 28, paddingTop: 8, paddingBottom: 22, alignItems: 'center' },
  heroOffer:       { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 10 },
  heroOfferTxt:    { fontSize: 11, fontWeight: '800', color: DARK_ACCENT },
  heroTitle:       { fontSize: 24, fontWeight: '900', color: DTXT, textAlign: 'center', lineHeight: 30, marginBottom: 8, letterSpacing: -0.3 },
  heroSub:         { fontSize: 12.5, color: DTXT_SUB, textAlign: 'center', lineHeight: 19 },
  cmpWrap:         { marginHorizontal: 16, backgroundColor: CARD, borderRadius: 20, padding: 18, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 2 },
  cmpColsRow:      { flexDirection: 'row', alignItems: 'center', paddingBottom: 10, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: '#eee' },
  cmpColH:         { width: 60, textAlign: 'center', fontSize: 12, fontWeight: '800', color: TEXT_SECONDARY },
  cmpColHActive:   { color: '#fff', backgroundColor: BRAND, borderRadius: 10, paddingVertical: 4, overflow: 'hidden' },
  cmpRow:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  cmpFeat:         { flex: 1, fontSize: 12.5, fontWeight: '700', color: TEXT_PRIMARY, paddingRight: 6 },
  cmpFeatSub:      { fontSize: 10, fontWeight: '500', color: TEXT_HINT, marginTop: 1 },
  cmpMark:         { width: 60, textAlign: 'center', fontSize: 16 },
  cmpMarkYes:      { color: BRAND, fontWeight: '800' },
  cmpMarkNo:       { color: '#d1d5db' },
  priceCard:       { marginHorizontal: 16, marginTop: 14, borderRadius: 18, padding: 16, backgroundColor: CARD, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  priceCardLabel:  { fontSize: 14, fontWeight: '800', color: BRAND },
  priceCardSub:    { fontSize: 10.5, color: TEXT_SECONDARY, marginTop: 2 },
  priceCardDaily:  { fontSize: 10.5, color: BRAND, marginTop: 2, fontWeight: '700' },
  priceCardBadge:  { backgroundColor: BRAND, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  priceCardBadgeTxt:{ color: '#fff', fontSize: 10, fontWeight: '800' },
  skipBtn:         { alignItems: 'center', paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  skipTxt:         { fontSize: 13, color: DTXT_HINT, fontWeight: '600' },
  coachLinkBtn:    { alignItems: 'center', paddingVertical: 6, minHeight: 32, justifyContent: 'center' },
  coachLinkTxt:    { fontSize: 12, color: DTXT_HINT, fontWeight: '600', textDecorationLine: 'underline' },
})

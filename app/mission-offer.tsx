// app/mission-offer.tsx — 3日間ミッション達成直後の24時間限定オファー画面
//
// 2026-09-11: 「オファー画面を全面的に作り直したい」との指示で新規作成。
// 従来はapp/paywall.tsxに「?sale=1」パラメータを足して、通常の3プラン比較画面に
// セールバナーを載せるだけだったが、ミッション達成という特別な瞬間にふさわしい
// 専用のフルスクリーン演出にする（背景画像＋マスコット＋価格訴求の1枚構成）。
// components/MissionModal.tsxのhandleContinueToSaleから遷移してくる。
//
// 価格の仕組み（2026-09-11 変更）:
// 当初はApp Storeの「導入価格(Introductory Offer)」で¥980→¥680を表現しようとしたが、
// 導入価格は必ず一定期間後に元の価格へ自動で戻る仕組みのため、「24時間以内に登録すれば
// 以後ずっと¥680」という要望には合わなかった。そこで¥680専用の別商品
// (PRODUCT_IDS.ticket_monthly_sale = score_ticket_monthly_sale_v1)を、¥980の商品と
// 同じサブスクライブグループ内に新規作成する方式に変更した。同じグループでは1契約者に
// つきどちらか1つしか加入できないため、セール中にこちらを選べばプラン変更しない限り
// ずっとこの価格のまま——という挙動が自然に実現できる。RevenueCat側では両商品を
// 同じticket_monthly Entitlementに紐付け済みなので、hasTicketMonthly等の判定ロジックは
// 商品が変わっても共通のまま動く。
// 表示専用のSALE_PRICE_FALLBACKは、まだストア側の¥680商品が(審査待ち等で)配信されて
// いない間の一時的な予告表示。実際の請求はOSのネイティブ購入確認画面が必ず本当の価格を
// 提示するため、黙って多く請求される事故にはならない。
import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  Animated, Easing, Image, ImageBackground, Alert, Linking,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Toast from 'react-native-toast-message'
import { usePurchase } from '../context/PurchaseContext'
import { PRODUCT_IDS, TICKET_MONTHLY_GRANT } from '../lib/purchaseService'
import { trackPaywallView, trackTrialStarted } from '../lib/analytics'
import { getMissionState } from '../lib/missionStore'

const BRAND = '#166534'
const GOLD  = '#f59e0b'
const GOLD2 = '#fbbf24'
const TICKET_ICON    = require('../assets/icons/ticket.png')
const MASCOT_OFFER   = require('../assets/illustrations/mascot/mascot_ticket_celebrate.png')
// 2026-09-11: 背景はいったんグラデーションのプレースホルダー画像(lib/../assets/illustrations/
// mission_offer_bg.png)を仮置きしてある。ユーザーが生成した本番画像を同じファイル名で
// 上書きするだけで、コード変更なしにそのまま反映される。
const OFFER_BG = require('../assets/illustrations/mission_offer_bg.png')
// 表示専用の予告価格。実際の課金額はストア側の¥680商品設定に従う（上のコメント参照）
const SALE_PRICE_FALLBACK = '¥680'

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const sec = totalSec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// "¥980" のような文字列から数値だけ取り出す（app/paywall.tsxのdailyPriceLabelと同じ抽出）
function priceToNumber(priceStr: string): number | null {
  const n = Number(priceStr.replace(/[^\d]/g, ''))
  return n || null
}

export default function MissionOfferScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { packages, packagesDiagnostic, packagesReady, purchase, restore, hasTicketMonthly } = usePurchase()

  const [saleExpiresAt, setSaleExpiresAt] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState(Date.now())
  const [purchasing, setPurchasing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const purchaseLockRef = useRef(false)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const ctaGlow  = useRef(new Animated.Value(0)).current

  useEffect(() => {
    getMissionState().then(s => setSaleExpiresAt(s.saleExpiresAt ?? null)).catch(() => {})
    trackPaywallView('mission_offer_screen')
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(ctaGlow, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(ctaGlow, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ])
    )
    glowLoop.start()
    return () => glowLoop.stop()
  }, [])

  useEffect(() => {
    if (!saleExpiresAt) return
    const timer = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [saleExpiresAt])

  // 加入済みなら見せる意味が無いのでホームへ戻す。
  // 2026-09-12バグ修正: paywall.tsxの条件(tier !== 'free' || hasTicketMonthly)を
  // そのまま持ってきていたが、paywallはticket_monthly/コーチ両方を売る画面なので
  // tier!=='free'（コーチ加入済みも含む）で正しい。この画面はticket_monthlyの
  // セール専用のため、無関係なコーチプランが(過去のSandboxテスト等で)有効なだけで
  // 「購入を復元する」を押すとコーチプランが有効になったかのように画面が反応し、
  // ホームへ戻ってしまう実害があった。この画面ではhasTicketMonthlyだけを見る。
  useEffect(() => {
    if (hasTicketMonthly) {
      Toast.show({ type: 'success', text1: t('paywall.planActive') })
      router.back()
    }
  }, [hasTicketMonthly])

  const saleRemainingMs = saleExpiresAt ? new Date(saleExpiresAt).getTime() - nowTick : 0
  const saleActive = saleExpiresAt != null && saleRemainingMs > 0

  // 2026-09-11:「980を取り消し線、680で、24時間以内に登録で680円」との指示に対応。
  // ¥680は導入価格(Introductory Offer)ではなく、¥980の商品と同じサブスクライブグループ
  // 内に新規作成した別商品(PRODUCT_IDS.ticket_monthly_sale)なので、セール中は
  // 通常商品ではなくこちらのpackageを見つけて購入対象にする。まだストア審査待ち等で
  // この商品がpackagesに出てこない間は、表示だけSALE_PRICE_FALLBACKで予告しつつ、
  // 実際の購入は通常商品(regularPkg)にフォールバックする（実際に請求される額は
  // OSのネイティブ購入確認画面が必ず本当の価格を提示するため、表示額と食い違っても
  // 「黙って多く請求される」事故にはならない）。
  const regularPkg = packages.find((p: any) => p.product?.identifier === PRODUCT_IDS.ticket_monthly)
  const salePkg = packages.find((p: any) => p.product?.identifier === PRODUCT_IDS.ticket_monthly_sale)
  const regularPrice = regularPkg?.product?.priceString ?? '¥980'
  const showingDiscount = saleActive
  const displayPrice = saleActive ? (salePkg?.product?.priceString ?? SALE_PRICE_FALLBACK) : regularPrice
  const purchaseTargetPkg = saleActive && salePkg ? salePkg : regularPkg
  const discountPct = (() => {
    if (!showingDiscount) return null
    const a = priceToNumber(regularPrice)
    const b = priceToNumber(displayPrice)
    if (!a || !b || b >= a) return null
    return Math.round((1 - b / a) * 100)
  })()

  const handlePurchase = useCallback(async () => {
    if (purchaseLockRef.current) return
    if (!purchaseTargetPkg) {
      if (packagesDiagnostic) {
        Alert.alert(t('paywall.loadFailedTitle'), packagesDiagnostic)
      } else {
        Toast.show({ type: 'error', text1: t('paywall.loadFailedTitle'), text2: t('paywall.loadFailedRetry'), visibilityTime: 6000 })
      }
      return
    }
    purchaseLockRef.current = true
    setPurchasing(true)
    try {
      // 2026-09-11バグ修正: ここでrouter.back()を呼ぶと、購入成功でtier/hasTicketMonthlyが
      // 更新された時に発火する下のuseEffect（同じくrouter.back()を呼ぶ）と合わせて
      // 2回popしてしまい、意図した1画面戻る以上に戻ってしまう不具合があった
      // （app/paywall.tsxの同等処理と見比べて発覚。あちらはuseEffect側のみに任せている）。
      // ナビゲーションはuseEffect側だけに一本化する。
      const ok = await purchase(purchaseTargetPkg)
      if (ok) trackTrialStarted('ticket_monthly')
    } finally {
      setPurchasing(false)
      purchaseLockRef.current = false
    }
  }, [purchaseTargetPkg, purchase, packagesDiagnostic, t])

  // App Store審査要件(3.1.1): 購入復元ボタンは全ての課金導線に必須
  const handleRestore = useCallback(async () => {
    setRestoring(true)
    try { await restore() } finally { setRestoring(false) }
  }, [restore])

  return (
    // 2026-09-12: 「これもミッション画面と同じようにカードタイプにして」との指示で、
    // 全画面の背景画像テイクオーバーから、components/MissionModal.tsxのA案(中央フロート
    // カード)と同じ構図(暗幕の背景+四辺マージン+四隅丸角+影)に変更。
    <View style={s.overlay}>
      <Animated.View style={[s.cardShadow, { opacity: fadeAnim }]}>
        <ImageBackground source={OFFER_BG} style={s.card} imageStyle={{ borderRadius: 28 }} resizeMode="cover">
          {/* 背景画像の上にごく薄い黒を1枚敷き、どんな画像が来ても文字の可読性を担保する */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <LinearGradient colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0.1)', 'rgba(0,0,0,0.55)']} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />
          </View>

          <TouchableOpacity onPress={() => router.back()} style={s.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityLabel={t('tickets.closeLabel')}>
            <Ionicons name="close" size={20} color="#fff" />
          </TouchableOpacity>

          <Animated.ScrollView style={{ flex: 1 }} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={s.body}>
              {saleActive && (
                <View style={s.countdownPill}>
                  <Ionicons name="time" size={14} color="#fff" />
                  <Text style={s.countdownText}>{t('missionOffer.countdownLabel')} {formatCountdown(saleRemainingMs)}</Text>
                </View>
              )}

              <Text style={s.eyebrow}>{t('missionOffer.eyebrow')}</Text>
              <Image source={MASCOT_OFFER} style={s.mascot} resizeMode="contain" />
              <Text style={s.title}>{t('missionOffer.title')}</Text>

              {showingDiscount && (
                <Text style={s.urgencyLine}>{t('missionOffer.urgencyLine')}</Text>
              )}
              <View style={s.priceRow}>
                {showingDiscount && (
                  <Text style={s.priceStrike}>{regularPrice}</Text>
                )}
                <Text style={s.priceMain}>{displayPrice}</Text>
                <Text style={s.pricePeriod}>{t('paywall.perMonth')}</Text>
              </View>
              {showingDiscount && discountPct != null && (
                <View style={s.discountBadge}>
                  <Text style={s.discountBadgeText}>{t('missionOffer.discountBadge', { pct: discountPct })}</Text>
                </View>
              )}

              <View style={s.featureCard}>
                <FeatureRow text={t('paywall.plans.ticket_monthly.feature1')} />
                <FeatureRow text={t('paywall.plans.ticket_monthly.feature2', { count: TICKET_MONTHLY_GRANT })} />
                <FeatureRow text={t('paywall.plans.ticket_monthly.feature3')} />
              </View>
            </View>

            <View style={s.footer}>
              <View style={s.purchaseBtnWrap}>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    s.purchaseBtnGlow,
                    {
                      opacity: ctaGlow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.5] }),
                      transform: [{ scale: ctaGlow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }],
                    },
                  ]}
                />
                <TouchableOpacity onPress={handlePurchase} disabled={purchasing || !packagesReady} activeOpacity={0.88} style={[s.purchaseBtn, (purchasing || !packagesReady) && { opacity: 0.6 }]}>
                  <LinearGradient colors={[GOLD2, GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.purchaseBtnInner}>
                    {purchasing
                      ? <ActivityIndicator color="#fff" />
                      : <>
                          <Image source={TICKET_ICON} style={{ width: 20, height: 20 }} resizeMode="contain" />
                          <Text style={s.purchaseBtnText}>{t('missionOffer.ctaButton')}</Text>
                        </>}
                  </LinearGradient>
                </TouchableOpacity>
              </View>

              <TouchableOpacity onPress={() => router.back()} style={s.skipBtn} activeOpacity={0.7}>
                <Text style={s.skipText}>{t('missionOffer.skipButton')}</Text>
              </TouchableOpacity>

              {/* App Store審査要件(3.1.1/3.1.2): 復元ボタン・価格/更新周期/解約方法の明記は
                  背景画像付きの派手な画面でも省略できない。app/paywall.tsxと同じ文言を、
                  この画面のトーンに合わせて控えめな小さい白文字で置いている。 */}
              <TouchableOpacity onPress={handleRestore} disabled={restoring} style={s.restoreBtn}>
                {restoring
                  ? <ActivityIndicator color="rgba(255,255,255,0.75)" size="small" />
                  : <Text style={s.restoreText}>{t('paywall.restoreButton')}</Text>}
              </TouchableOpacity>
              <Text style={s.legalText}>
                {t('paywall.legal.autoRenew')} {t('paywall.legal.cancelNotice')} {t('paywall.legal.howToCancel')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 6 }}>
                <TouchableOpacity onPress={() => Linking.openURL('https://scorej-run.vercel.app/privacy')}>
                  <Text style={s.legalLink}>{t('paywall.privacyPolicy')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => Linking.openURL('https://scorej-run.vercel.app/terms')}>
                  <Text style={s.legalLink}>{t('paywall.terms')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.ScrollView>
        </ImageBackground>
      </Animated.View>
    </View>
  )
}

function FeatureRow({ text }: { text: string }) {
  return (
    <View style={s.featureRow}>
      <Ionicons name="checkmark-circle" size={16} color={BRAND} />
      <Text style={s.featureText}>{text}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  // components/MissionModal.tsxのoverlay/sheetShadow/sheetと同じ構図
  // (中央フロートカード)。paddingHorizontal:20で左右の余白、maxHeightで上下の
  // 余白を作る。shadowとoverflow:'hidden'は同居できないため影担当(cardShadow)と
  // クリップ担当(card)を分けている。
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 20 },
  cardShadow: {
    borderRadius: 28, maxHeight: '84%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.4, shadowRadius: 30, elevation: 20,
  },
  card: { borderRadius: 28, overflow: 'hidden', flexShrink: 1 },
  closeBtn: {
    position: 'absolute', top: 12, right: 12, zIndex: 10,
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
  body: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 44 },
  countdownPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
    marginBottom: 18,
  },
  countdownText: { color: '#fff', fontSize: 12.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
  eyebrow: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700', letterSpacing: 0.5, marginBottom: 6 },
  mascot: { width: 128, height: 128, marginBottom: 4 },
  title: {
    color: '#fff', fontSize: 23, fontWeight: '900', textAlign: 'center', lineHeight: 30,
    marginBottom: 18, textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  urgencyLine: { color: GOLD2, fontSize: 13.5, fontWeight: '800', marginBottom: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  priceStrike: { color: 'rgba(255,255,255,0.6)', fontSize: 17, fontWeight: '700', textDecorationLine: 'line-through', marginBottom: 6 },
  priceMain: { color: '#fff', fontSize: 40, fontWeight: '900' },
  pricePeriod: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '700', marginBottom: 6 },
  discountBadge: { backgroundColor: GOLD, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginTop: 8 },
  discountBadgeText: { color: '#241300', fontSize: 12.5, fontWeight: '900' },
  featureCard: {
    marginTop: 22, width: '100%', backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 18, padding: 16, gap: 11,
  },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { flex: 1, color: '#1f2937', fontSize: 13.5, fontWeight: '700' },
  footer: { paddingHorizontal: 24, paddingBottom: 8, paddingTop: 24 },
  purchaseBtnWrap: { position: 'relative' },
  purchaseBtnGlow: {
    position: 'absolute', top: -6, left: -6, right: -6, bottom: -6,
    borderRadius: 30, backgroundColor: GOLD,
  },
  purchaseBtn: { borderRadius: 26, overflow: 'hidden' },
  purchaseBtnInner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 17,
  },
  purchaseBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  skipBtn: { alignItems: 'center', paddingVertical: 14 },
  skipText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, textDecorationLine: 'underline' },
  restoreBtn: { alignItems: 'center', paddingVertical: 4, marginBottom: 8 },
  restoreText: { color: 'rgba(255,255,255,0.75)', fontSize: 12.5, fontWeight: '700' },
  legalText: { color: 'rgba(255,255,255,0.55)', fontSize: 10, lineHeight: 15, textAlign: 'center' },
  legalLink: { color: 'rgba(255,255,255,0.7)', fontSize: 11, textDecorationLine: 'underline' },
})

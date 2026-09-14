// app/team-plan.tsx — チーム/コーチプランの案内・外部決済ページ(Web専用)
//
// 2026-09-14: 「コーチ/チームプランだけApp内課金から外部決済(Stripe)に切り替える」方針で新規作成。
// 2026-09-14 追記: 競合サイト(bukatsu.jp=クラブマネージャー、climbfactory.com/atleta=Atleta)の
// UI/構成を徹底調査した上で、/ui-ux-pro-max の設計システム提案(B2B教育/スポーツ向けは
// 「Trust & Authority」パターン=紺+ゴールドが定石、フォントはBarlow Condensed/Barlowが
// 陸上・アスリート系ブランドの定番との結果)を踏まえて全面拡張。
// 単一ページ内をスクロールで移動する構成(bukatsu.jp自身がこの形式)。ナビの「タブ」は
// 別ページ遷移ではなく、同一ページ内のアンカースクロールとして実装している。
//
// 会社概要のセクションはapp/privacy.tsx・app/terms.tsxに既にある実際の運営者情報
// (個人事業主・屋号trackmate)をそのまま使用し、架空の法人情報は作らない。
import React, { useEffect, useRef, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, ActivityIndicator, Linking, Image, ImageBackground, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'

// 2026-09-14: 「AIっぽすぎる（写真が無い）」との指摘を受けて、GPT画像生成の実写風カットを
// 4枚追加(プロンプトはこのセッションでユーザーに提示済み)。documentary/candid調で
// bukatsu.jp同様「本物の部活写真」に見えることを狙った素材。
const HERO_IMG    = require('../assets/illustrations/team-plan/hero_sprinter.png')
const COACH_IMG   = require('../assets/illustrations/team-plan/coach_data.png')
const ATHLETE_IMG = require('../assets/illustrations/team-plan/athlete_filming.png')
const HUDDLE_IMG  = require('../assets/illustrations/team-plan/team_huddle.png')

// ── デザイントークン ──────────────────────────────────────
// /ui-ux-pro-max --design-system の提案(Trust & Authorityパターン: 紺+ゴールド)を採用。
// sCORE本体のブランドグリーン(BRAND)はロゴ/AI関連の差し色として残し、マーケティングサイト
// としての「信頼できるB2B」の土台色は紺にする(bukatsu.jpの紺+オレンジとも整合)。
const NAVY    = '#16324a'
const NAVY2   = '#0e2233'
const GOLD    = '#a16207'
const GOLD2   = '#d97706'
const BRAND   = '#166534' // sCORE本体のブランドグリーン(差し色用)
const INK     = '#0f172a'
const MUTED   = '#64748b'
const PAPER   = '#f8fafc'
const BORDER  = '#e2e8f0'
const CARD    = '#ffffff'

const OPERATOR = '個人事業主（屋号：trackmate）'
const CONTACT  = 'team.deepwork2026@gmail.com'

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')

// Web版のみ: Barlow Condensed/Barlow(アスリート・陸上系ブランドの定番書体)を読み込む。
// ネイティブアプリはこのページ自体を開かない(Linking.openURLで外部ブラウザに委ねる)ため
// Platform.OS==='web'限定で問題ない。読み込みに失敗してもシステムフォントにフォールバックする。
function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const id = 'score-team-plan-fonts'
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600;700&display=swap'
    document.head.appendChild(link)
  }, [])
}

const FONT_DISPLAY = Platform.select({ web: '"Barlow Condensed", -apple-system, sans-serif', default: undefined })
const FONT_BODY    = Platform.select({ web: '"Barlow", -apple-system, sans-serif', default: undefined })

type TierKey = 'coach_monthly' | 'coach_monthly_30' | 'coach_monthly_unlimited'

const PLANS: { key: TierKey; name: string; range: string; price: number; badge?: string; features: string[] }[] = [
  { key: 'coach_monthly', name: 'スタンダード', range: '〜15人', price: 1980,
    features: ['AIフォーム分析（月次）', '怪我リスクスコア', 'チーム記録の一元管理', 'メールサポート'] },
  { key: 'coach_monthly_30', name: 'アドバンス', range: '〜30人', price: 2980, badge: '人気',
    features: ['スタンダードの全機能', '選手ごとの怪我リスク推移グラフ', '練習メニューAI提案', '優先サポート'] },
  { key: 'coach_monthly_unlimited', name: 'プレミアム', range: '無制限', price: 4980,
    features: ['アドバンスの全機能', '人数無制限', 'チーム全体のリスク傾向レポート', '導入サポート面談'] },
]

const PROOF_STATS = [
  { n: 'AI', label: 'フォーム分析\n＋怪我リスク予測' },
  { n: '¥0', label: 'App Store手数料\n分の上乗せなし' },
  { n: '年1回', label: '請求書・銀行振込\nお支払いOK' },
]

const FEATURES = [
  { icon: 'body-outline',            title: 'AIフォーム分析', text: '練習動画をAIが解析し、フォームの改善点を数値とコメントで可視化します。' },
  { icon: 'shield-checkmark-outline', title: '怪我リスクスコア', text: '日々の練習負荷・コンディションから、選手ごとの怪我リスクを毎日スコア化します。' },
  { icon: 'people-outline',          title: 'チーム記録の一元管理', text: '選手全員の記録・大会結果・コンディションをコーチ1人で見渡せます。' },
  { icon: 'trending-up-outline',     title: '練習メニューAI提案', text: '選手のリスク傾向に応じて、練習強度の調整案をAIが提案します。' },
  { icon: 'document-text-outline',   title: '公費・請求書払いに対応', text: '学校の年度予算に合わせた年払い。銀行振込・請求書でのお支払いにも対応します。' },
  { icon: 'chatbubbles-outline',     title: 'AIスコッピーに質問', text: '選手が陸上競技の一般知識をいつでもAIマスコットに質問できます。' },
]

const FAQS = [
  { q: 'お支払い方法について教えてください。', a: 'クレジットカード決済に対応しています。銀行振込・請求書でのお支払いをご希望の場合はお問い合わせください。学校の年度予算（4月〜3月）に合わせた年払いが基本です。' },
  { q: 'プラン変更・解約はいつでもできますか？', a: '年払いのため、契約期間中の返金は原則対応しておりませんが、次年度の更新有無はいつでもご選択いただけます。人数超過時はプラン変更のご相談も可能です。' },
  { q: '陸上競技以外の部活動でも使えますか？', a: '現在は陸上競技に特化して機能を設計しています。他競技への対応は今後の検討課題としています。' },
  { q: '運営会社について教えてください。', a: `${OPERATOR}が運営しています。お問い合わせは${CONTACT}までお願いします。` },
]

function useCheckout() {
  const [loadingTier, setLoadingTier] = useState<TierKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const startCheckout = async (tier: TierKey) => {
    setError(null)
    setLoadingTier(tier)
    try {
      const res = await fetch(`${API_BASE}/api/create-team-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      })
      const json = await res.json()
      if (!res.ok || !json?.url) throw new Error(json?.error ?? '決済ページの作成に失敗しました')
      if (Platform.OS === 'web') window.location.href = json.url
    } catch (e: any) {
      setError(e?.message ?? '決済ページの作成に失敗しました')
    } finally {
      setLoadingTier(null)
    }
  }
  return { startCheckout, loadingTier, error }
}

type SectionKey = 'hero' | 'features' | 'pricing' | 'company' | 'faq' | 'contact'
const NAV_ITEMS: { key: SectionKey; label: string }[] = [
  { key: 'hero', label: 'ホーム' },
  { key: 'features', label: '機能' },
  { key: 'pricing', label: '料金' },
  { key: 'company', label: '会社概要' },
  { key: 'contact', label: 'お問い合わせ' },
]

// 2026-09-14バグ修正:「PCに対応できていない」との指摘。原因は本文カラムを常に
// maxWidth:720固定にしていたため、デスクトップの広い画面では中央に細い列が浮いて
// 左右が真っ白になる、いかにも「スマホ版をそのまま広げただけ」の見た目になっていた。
// useWindowDimensionsで画面幅を見て、デスクトップ相当(860px〜)ではカラム幅・
// 機能グリッドの列数を広げる。ナビバー自体は背景を画面幅いっぱいにしつつ、
// 中身の行だけ本文と同じ最大幅に揃えることでヘッダーだけ浮くのも防ぐ。
const DESKTOP_BREAKPOINT = 860
const MOBILE_MAX_WIDTH = 720
const DESKTOP_MAX_WIDTH = 1040

export default function TeamPlanScreen() {
  useWebFonts()
  const { startCheckout, loadingTier, error } = useCheckout()
  const scrollRef = useRef<ScrollView>(null)
  const offsets = useRef<Partial<Record<SectionKey, number>>>({})
  const { width } = useWindowDimensions()
  const isWide = width >= DESKTOP_BREAKPOINT
  const contentMaxWidth = isWide ? DESKTOP_MAX_WIDTH : MOBILE_MAX_WIDTH

  const registerOffset = (key: SectionKey) => (e: any) => {
    offsets.current[key] = e.nativeEvent.layout.y
  }
  const scrollTo = (key: SectionKey) => {
    const y = offsets.current[key] ?? 0
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 64), animated: true })
  }

  return (
    <View style={{ flex: 1, backgroundColor: PAPER }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        {/* ── 上部固定ナビ（bukatsu.jp同様、ページ内アンカーとして機能） ── */}
        <View style={s.navBar}>
          <View style={[s.navInner, { maxWidth: contentMaxWidth }]}>
            <View style={s.navBrand}>
              <View style={s.navLogoDot} />
              <Text style={s.navBrandText}>sCORE <Text style={{ color: GOLD }}>Team</Text></Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
              {NAV_ITEMS.map(item => (
                <TouchableOpacity key={item.key} style={s.navLink} onPress={() => scrollTo(item.key)}>
                  <Text style={s.navLinkText}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>

        <ScrollView ref={scrollRef} contentContainerStyle={[s.scroll, { maxWidth: contentMaxWidth }]} showsVerticalScrollIndicator={false}>

          {/* ── ヒーロー（実写背景 + 紺グラデーションで可読性確保。mission-offer.tsxと同じ手法） ── */}
          <View onLayout={registerOffset('hero')}>
            <ImageBackground source={HERO_IMG} style={s.hero} imageStyle={s.heroImg} resizeMode="cover">
              <LinearGradient
                colors={['rgba(14,34,51,0.55)', 'rgba(14,34,51,0.82)', NAVY2]}
                locations={[0, 0.55, 1]}
                style={StyleSheet.absoluteFill}
              />
              <View style={{ position: 'relative' }}>
                <Text style={s.heroEyebrow}>陸上競技チーム向け AIコーチングツール</Text>
                <Text style={s.heroTitle}>AIで怪我を防ぎ、{'\n'}チームの記録を伸ばす。</Text>
                <Text style={s.heroSub}>sCOREのチームプランは、連絡・出欠管理だけの部活アプリとは違い、{'\n'}AIフォーム分析と怪我リスク予測にフォーカスしています。</Text>
                <TouchableOpacity style={s.heroCta} onPress={() => scrollTo('pricing')} activeOpacity={0.9}>
                  <Text style={s.heroCtaText}>料金プランを見る</Text>
                  <Ionicons name="arrow-down" size={16} color={NAVY} />
                </TouchableOpacity>
              </View>
            </ImageBackground>
          </View>

          {/* ── 証明バー ── */}
          <View style={s.proofRow}>
            {PROOF_STATS.map((p, i) => (
              <View key={i} style={s.proofCard}>
                <Text style={s.proofN}>{p.n}</Text>
                <Text style={s.proofLabel}>{p.label}</Text>
              </View>
            ))}
          </View>

          {/* ── 差別化ポイント ── */}
          <View style={s.section}>
            <Text style={s.sectionEyebrow}>WHY sCORE</Text>
            <Text style={s.sectionTitle}>ただの部活連絡アプリでは、ありません</Text>
            <Text style={s.sectionSub}>汎用の出欠・連絡管理ツールや、総合コンディション管理ツールとは違い、sCOREは陸上競技のAI分析と怪我予防に特化しています。</Text>
            <View style={s.photoCard}>
              <Image source={COACH_IMG} style={s.photoCardImg} resizeMode="cover" />
              <View style={s.photoCardCaption}>
                <Text style={s.photoCardCaptionText}>練習を見ながら、その場でリスクを確認できる</Text>
              </View>
            </View>
          </View>

          {/* ── 機能（アンカー: features） ── */}
          <View onLayout={registerOffset('features')} style={s.section}>
            <Text style={s.sectionEyebrow}>FEATURES</Text>
            <Text style={s.sectionTitle}>機能</Text>
            <View style={s.photoCard}>
              <Image source={ATHLETE_IMG} style={s.photoCardImg} resizeMode="cover" />
              <View style={s.photoCardCaption}>
                <Text style={s.photoCardCaptionText}>スマホ1台で、フォームをその場で撮影・分析</Text>
              </View>
            </View>
            <View style={s.featureGrid}>
              {FEATURES.map((f, i) => (
                <View key={i} style={[s.featureCard, { width: isWide ? '31%' : '47%' }]}>
                  <View style={s.featureIconWrap}>
                    <Ionicons name={f.icon as any} size={22} color={NAVY} />
                  </View>
                  <Text style={s.featureTitle}>{f.title}</Text>
                  <Text style={s.featureText}>{f.text}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── 料金（アンカー: pricing） ── */}
          <View onLayout={registerOffset('pricing')} style={[s.section, { backgroundColor: '#fff', paddingTop: 40, paddingBottom: 40, marginHorizontal: -24, paddingHorizontal: 24 }]}>
            <Text style={s.sectionEyebrow}>PRICING</Text>
            <Text style={s.sectionTitle}>チームプラン（年払い・税込）</Text>
            <Text style={s.sectionSub}>学校の年度予算に合わせた12ヶ月一括払い。お支払い後、アプリ内で使う引き換えコードを発行します。</Text>

            {PLANS.map(plan => (
              <View key={plan.key} style={[s.planCard, plan.badge && s.planCardHighlight]}>
                {plan.badge && (
                  <View style={s.planBadge}><Text style={s.planBadgeText}>{plan.badge}</Text></View>
                )}
                <View style={s.planHeader}>
                  <View>
                    <Text style={s.planName}>{plan.name}</Text>
                    <Text style={s.planRange}>{plan.range}のチーム</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.planPrice}>¥{plan.price.toLocaleString()}<Text style={s.planPricePeriod}>/月</Text></Text>
                    <Text style={s.planYearly}>年払い ¥{(plan.price * 12).toLocaleString()}</Text>
                  </View>
                </View>
                <View style={s.planFeatureList}>
                  {plan.features.map((f, i) => (
                    <View key={i} style={s.planFeatureRow}>
                      <Ionicons name="checkmark-circle" size={15} color={BRAND} />
                      <Text style={s.planFeatureText}>{f}</Text>
                    </View>
                  ))}
                </View>
                <TouchableOpacity
                  style={[s.planBtn, loadingTier === plan.key && { opacity: 0.6 }]}
                  onPress={() => startCheckout(plan.key)}
                  disabled={loadingTier !== null}
                  activeOpacity={0.85}
                >
                  {loadingTier === plan.key
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={s.planBtnText}>このプランで申し込む</Text>}
                </TouchableOpacity>
              </View>
            ))}
            {error && <Text style={s.errorText}>{error}</Text>}
          </View>

          {/* ── 会社概要（アンカー: company） ── */}
          <View onLayout={registerOffset('company')} style={s.section}>
            <Text style={s.sectionEyebrow}>COMPANY</Text>
            <Text style={s.sectionTitle}>会社概要</Text>
            <View style={s.companyCard}>
              {[
                ['運営者', OPERATOR],
                ['サービス名', 'sCORE（スコア）'],
                ['お問い合わせ', CONTACT],
                ['対応競技', '陸上競技'],
              ].map(([k, v], i) => (
                <View key={i} style={[s.companyRow, i > 0 && { borderTopWidth: 1, borderTopColor: BORDER }]}>
                  <Text style={s.companyKey}>{k}</Text>
                  <Text style={s.companyVal}>{v}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── FAQ ── */}
          <View onLayout={registerOffset('faq')} style={s.section}>
            <Text style={s.sectionEyebrow}>FAQ</Text>
            <Text style={s.sectionTitle}>よくあるご質問</Text>
            {FAQS.map((f, i) => (
              <View key={i} style={s.faqCard}>
                <View style={s.faqQRow}>
                  <Text style={s.faqQMark}>Q</Text>
                  <Text style={s.faqQ}>{f.q}</Text>
                </View>
                <View style={s.faqARow}>
                  <Text style={s.faqAMark}>A</Text>
                  <Text style={s.faqA}>{f.a}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* ── 最終CTA / お問い合わせ（アンカー: contact） ── */}
          <View onLayout={registerOffset('contact')}>
            <ImageBackground source={HUDDLE_IMG} style={s.ctaSection} imageStyle={s.ctaSectionImg} resizeMode="cover">
              <LinearGradient colors={['rgba(22,50,74,0.72)', 'rgba(14,34,51,0.9)']} style={StyleSheet.absoluteFill} />
              <View style={{ position: 'relative', alignItems: 'center' }}>
                <Text style={s.ctaTitle}>まずはチームプランをご検討ください</Text>
                <Text style={s.ctaSub}>ご不明点は下記メールアドレスまでお気軽にお問い合わせください。</Text>
                <TouchableOpacity style={s.ctaEmailBtn} onPress={() => Linking.openURL(`mailto:${CONTACT}`)} activeOpacity={0.85}>
                  <Ionicons name="mail-outline" size={18} color="#fff" />
                  <Text style={s.ctaEmailText}>{CONTACT}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.ctaSecondaryBtn} onPress={() => scrollTo('pricing')} activeOpacity={0.85}>
                  <Text style={s.ctaSecondaryText}>料金プランに戻る</Text>
                </TouchableOpacity>
              </View>
            </ImageBackground>
          </View>

          <View style={s.footer}>
            <Text style={s.footerText}>お支払い後、次の画面に表示される引き換えコードをアプリ内の「チームプラン」画面からご入力ください。</Text>
            <Text style={[s.footerText, { marginTop: 8, color: '#94a3b8' }]}>© {OPERATOR} — sCORE</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

const s = StyleSheet.create({
  scroll: { flexGrow: 1, width: '100%', alignSelf: 'center' },

  // navBarは画面幅いっぱいの帯(左右の余白まで背景色が届く)。中身(navInner)だけを
  // 本文と同じmaxWidthに揃えて中央寄せすることで、ヘッダーだけ本文と幅がズレて
  // 浮いて見えるのを防ぐ。
  navBar: {
    alignItems: 'center', paddingHorizontal: 20, backgroundColor: 'rgba(248,250,252,0.92)',
    borderBottomWidth: 1, borderBottomColor: BORDER,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)' } as any : {}),
  },
  navInner: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 12, width: '100%', alignSelf: 'center' },
  navBrand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  navLogoDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: BRAND },
  navBrandText: { fontFamily: FONT_DISPLAY, color: NAVY, fontSize: 19, fontWeight: '800', letterSpacing: 0.3 },
  navLink: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  navLinkText: { fontFamily: FONT_BODY, color: MUTED, fontSize: 13, fontWeight: '600' },

  hero: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 44, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' },
  heroImg: { borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  heroEyebrow: { fontFamily: FONT_BODY, color: GOLD2, fontSize: 12.5, fontWeight: '800', letterSpacing: 1.4, marginBottom: 12, textTransform: 'uppercase' },
  heroTitle: { fontFamily: FONT_DISPLAY, color: '#fff', fontSize: 34, fontWeight: '800', lineHeight: 42, letterSpacing: 0.2 },
  heroSub: { fontFamily: FONT_BODY, color: 'rgba(255,255,255,0.78)', fontSize: 14.5, lineHeight: 23, marginTop: 16 },
  heroCta: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 13, marginTop: 24 },
  heroCtaText: { fontFamily: FONT_BODY, color: NAVY, fontSize: 14.5, fontWeight: '800' },

  proofRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: -22 },
  proofCard: { flex: 1, backgroundColor: '#fff', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 8, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3 },
  proofN: { fontFamily: FONT_DISPLAY, color: NAVY, fontSize: 22, fontWeight: '800' },
  proofLabel: { fontFamily: FONT_BODY, color: MUTED, fontSize: 10.5, textAlign: 'center', marginTop: 4, lineHeight: 14 },

  section: { paddingHorizontal: 24, marginTop: 48 },
  sectionEyebrow: { fontFamily: FONT_BODY, color: GOLD, fontSize: 11.5, fontWeight: '800', letterSpacing: 1.6, textAlign: 'center', marginBottom: 6, textTransform: 'uppercase' },
  sectionTitle: { fontFamily: FONT_DISPLAY, color: INK, fontSize: 24, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  sectionSub: { fontFamily: FONT_BODY, color: MUTED, fontSize: 13.5, textAlign: 'center', marginBottom: 24, lineHeight: 20, maxWidth: 480, alignSelf: 'center' },

  featureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  featureCard: { width: '47%', minWidth: 150, backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER },
  featureIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: NAVY + '14', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  featureTitle: { fontFamily: FONT_BODY, color: INK, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  featureText: { fontFamily: FONT_BODY, color: MUTED, fontSize: 12, lineHeight: 18 },

  planCard: { backgroundColor: PAPER, borderRadius: 20, padding: 20, marginBottom: 14, borderWidth: 1, borderColor: BORDER },
  planCardHighlight: { borderColor: GOLD, borderWidth: 1.5, backgroundColor: '#fffbeb' },
  planBadge: { position: 'absolute', top: -10, right: 16, backgroundColor: GOLD2, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  planBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  planName: { fontFamily: FONT_DISPLAY, color: INK, fontSize: 17, fontWeight: '800' },
  planRange: { fontFamily: FONT_BODY, color: MUTED, fontSize: 12, marginTop: 2 },
  planPrice: { fontFamily: FONT_DISPLAY, color: NAVY, fontSize: 24, fontWeight: '800' },
  planPricePeriod: { fontFamily: FONT_BODY, color: MUTED, fontSize: 12, fontWeight: '600' },
  planYearly: { fontFamily: FONT_BODY, color: MUTED, fontSize: 11, marginTop: 2 },
  planFeatureList: { marginTop: 16, gap: 8 },
  planFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planFeatureText: { fontFamily: FONT_BODY, color: '#334155', fontSize: 12.5 },
  planBtn: { marginTop: 16, backgroundColor: GOLD2, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  planBtnText: { fontFamily: FONT_BODY, color: '#fff', fontSize: 14.5, fontWeight: '800' },
  errorText: { color: '#dc2626', fontSize: 12.5, textAlign: 'center', marginTop: 8 },

  companyCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  companyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, gap: 12 },
  companyKey: { fontFamily: FONT_BODY, color: MUTED, fontSize: 12.5, fontWeight: '700', width: 100 },
  companyVal: { fontFamily: FONT_BODY, color: INK, fontSize: 13, flex: 1, textAlign: 'right' },

  faqCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 10 },
  faqQRow: { flexDirection: 'row', gap: 10 },
  faqQMark: { fontFamily: FONT_DISPLAY, color: NAVY, fontSize: 15, fontWeight: '800' },
  faqQ: { fontFamily: FONT_BODY, color: INK, fontSize: 13.5, fontWeight: '700', flex: 1, lineHeight: 20 },
  faqARow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  faqAMark: { fontFamily: FONT_DISPLAY, color: GOLD, fontSize: 15, fontWeight: '800' },
  faqA: { fontFamily: FONT_BODY, color: MUTED, fontSize: 12.5, flex: 1, lineHeight: 19 },

  ctaSection: { marginTop: 56, marginHorizontal: 24, backgroundColor: NAVY, borderRadius: 24, padding: 28, alignItems: 'center', overflow: 'hidden' },
  ctaSectionImg: { borderRadius: 24 },

  // 2026-09-14バグ修正:「写真が画面をはみ出すほど縦長になる」不具合の原因。
  // React Native WebのImageはrequire()したローカル画像の場合、styleのaspectRatioより
  // アセット自身の実ピクセル高さ(例: 1086px)を優先してしまい、widthだけ100%%に
  // 縮んでも高さは実寸のまま(=著しく縦長)になっていた。aspectRatioは「中身を持たない
  // 単なるView」であるphotoCard側に付け、Image自体はwidth/height:100%で親を
  // 埋めるだけにすることで回避する(ImageBackgroundを使うヒーロー/CTAセクションは
  // 元々この問題が起きない作りなので影響なし)。
  photoCard: { marginTop: 20, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000', aspectRatio: 16 / 10, position: 'relative' },
  photoCardImg: { width: '100%', height: '100%' },
  photoCardCaption: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: 'rgba(14,34,51,0.55)' },
  photoCardCaptionText: { fontFamily: FONT_BODY, color: '#fff', fontSize: 12.5, fontWeight: '700' },
  ctaTitle: { fontFamily: FONT_DISPLAY, color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  ctaSub: { fontFamily: FONT_BODY, color: 'rgba(255,255,255,0.7)', fontSize: 12.5, textAlign: 'center', marginTop: 8, marginBottom: 20, lineHeight: 19 },
  ctaEmailBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: GOLD2, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 13 },
  ctaEmailText: { fontFamily: FONT_BODY, color: '#fff', fontSize: 13.5, fontWeight: '800' },
  ctaSecondaryBtn: { marginTop: 12, paddingVertical: 8 },
  ctaSecondaryText: { fontFamily: FONT_BODY, color: 'rgba(255,255,255,0.6)', fontSize: 12, textDecorationLine: 'underline' },

  footer: { paddingHorizontal: 24, marginTop: 28, marginBottom: 40 },
  footerText: { fontFamily: FONT_BODY, color: '#8a9184', fontSize: 11.5, lineHeight: 17, textAlign: 'center' },
})

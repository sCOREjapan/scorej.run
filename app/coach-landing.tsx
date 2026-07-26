// app/coach-landing.tsx — コーチ向け営業ランディングページ（白基調・アニメーション付き）
import React, { useEffect, useRef } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Platform, Animated, Dimensions, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'

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
const GREEN_M = '#86efac'
const RED_L  = '#fef2f2'
const YEL_L  = '#fefce8'

// ── フェードイン Hook ────────────────────────────────────────────────
function useFadeUp(delay = 0) {
  const opacity   = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(24)).current
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity,    { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]).start()
    }, delay)
    return () => clearTimeout(t)
  }, [])
  return { opacity, transform: [{ translateY }] }
}

// ── FadeCard コンポーネント ──────────────────────────────────────────
function FadeCard({ delay, children, style }: { delay: number; children: React.ReactNode; style?: any }) {
  const anim = useFadeUp(delay)
  return <Animated.View style={[anim, style]}>{children}</Animated.View>
}

// ── コーチの悩み ─────────────────────────────────────────────────────
const PAIN_POINTS = [
  { emoji: '😰', color: RED_L,  title: '全員の体調を把握できない',  body: '20人以上の選手の状態を口頭と紙で管理。誰が疲弊しているか気づかないまま練習させている。' },
  { emoji: '🤕', color: YEL_L,  title: '怪我が起きてから気づく',   body: '「あの日は無理させすぎた」と後悔しても遅い。怪我の早期発見の仕組みがなかった。' },
  { emoji: '😓', color: OFF2,   title: '専門知識がなくて不安',     body: '陸上未経験で顧問になってしまった。適切な指導ができているか、毎日不安な状態が続く。' },
  { emoji: '📋', color: OFF2,   title: '管理業務に時間を取られる', body: '体調チェック・記録集計・保護者報告…本来の「選手と向き合う時間」が削られていく。' },
]

// ── 機能 ─────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: 'pulse-outline' as const,         color: '#ef4444', bg: '#fef2f2', title: '全選手の体調を1分で確認',    body: 'ダッシュボードで部員全員の疲労・リスクをひと目で把握。毎朝1分チェックするだけ。' },
  { icon: 'warning-outline' as const,       color: '#f59e0b', bg: '#fffbeb', title: '怪我リスクをAIが自動算出',   body: '睡眠・疲労・天気を複合分析。「今日無理させてはいけない選手」が色で一目瞭然。' },
  { icon: 'bar-chart-outline' as const,     color: GREEN,     bg: GREEN_L,   title: '練習記録が自動集計される',  body: '選手がアプリに入力するだけで、コーチ側のダッシュボードにリアルタイムで反映。' },
  { icon: 'notifications-outline' as const, color: '#3b82f6', bg: '#eff6ff', title: '欠席・報告がアプリ完結',    body: '選手が体調不良や欠席を即報告。LINE/メール不要でコーチに自動通知が届く。' },
  { icon: 'trophy-outline' as const,        color: '#a855f7', bg: '#faf5ff', title: '選手が自発的に記録する',     body: 'PBカードのSNSシェアで承認欲求を満たす設計。コーチが強制しなくても続けてくれる。' },
  { icon: 'calendar-outline' as const,      color: '#06b6d4', bg: '#ecfeff', title: 'チーム予定を一元管理',       body: '練習・試合・休養日をアプリで共有。変更があればすぐ全員に通知が届く。' },
]

// ── 選手のメリット ────────────────────────────────────────────────────
const PLAYER_BENEFITS = [
  '📈 自己ベストの更新をリアルタイム管理',
  '💪 疲労と回復のサイクルが可視化',
  '🌙 睡眠・栄養管理でコンディション最適化',
  '🏆 PBカードをSNSシェアしてモチベUP',
  '🤖 AIが今日の練習強度を自動アドバイス',
  '👥 チームメイトの記録でお互い刺激し合える',
]

export default function CoachLandingPage() {
  const router = useRouter()

  const handleTrial = () => {
    if (isWeb) Linking.openURL('https://scorej-run.vercel.app/auth')
    else router.push('/auth')
  }

  return (
    <View style={s.root}>
      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>

        {/* ── ナビ ──────────────────────────────────────────────── */}
        <View style={s.nav}>
          <Text style={s.navLogo}>sCORE</Text>
          <View style={s.navLinks}>
            <TouchableOpacity onPress={() => {}} activeOpacity={0.7}>
              <Text style={s.navLink}>機能</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => isWeb ? Linking.openURL('https://scorej-run.vercel.app/guide') : router.push('/guide')} activeOpacity={0.7}>
              <Text style={s.navLink}>使い方</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {}} activeOpacity={0.7}>
              <Text style={s.navLink}>料金</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={s.navBtn} onPress={handleTrial} activeOpacity={0.85}>
            <Text style={s.navBtnTxt}>無料で試す</Text>
          </TouchableOpacity>
        </View>

        {/* ── ヒーロー ──────────────────────────────────────────── */}
        <View style={s.hero}>
          <FadeCard delay={100}>
            <View style={s.heroBadge}>
              <View style={s.heroBadgeDot} />
              <Text style={s.heroBadgeTxt}>陸上部顧問・コーチ向け</Text>
            </View>
          </FadeCard>

          <FadeCard delay={200}>
            <Text style={s.heroTitle}>
              選手の怪我を防ぐ。{'\n'}
              チームを、強くする。
            </Text>
          </FadeCard>

          <FadeCard delay={320}>
            <Text style={s.heroSub}>
              体調管理・怪我リスク・練習記録をすべて自動化。{'\n'}
              コーチの負担を減らしながら、選手の成長を最大化するアプリ。
            </Text>
          </FadeCard>

          <FadeCard delay={440}>
            <TouchableOpacity style={s.heroBtn} onPress={handleTrial} activeOpacity={0.85}>
              <Text style={s.heroBtnTxt}>まず無料で試してみる</Text>
              <Ionicons name="arrow-forward" size={18} color={WHITE} />
            </TouchableOpacity>
            <Text style={s.heroNote}>クレジットカード不要・いつでもキャンセル可</Text>
          </FadeCard>

          {/* ── ダッシュボードプレビュー ── */}
          <FadeCard delay={560} style={s.dashWrap}>
            <View style={s.dash}>
              <View style={s.dashTitleRow}>
                <Text style={s.dashTitle}>コーチダッシュボード</Text>
                <View style={s.allOkBadge}>
                  <Text style={s.allOkTxt}>● 本日の確認完了</Text>
                </View>
              </View>
              {[
                { name: '田中 翔',  pos: '100m',  risk: 12, fat: 3,  status: '良好',  col: GREEN },
                { name: '鈴木 陽菜', pos: '200m', risk: 74, fat: 8,  status: '要注意', col: '#ef4444' },
                { name: '山田 蒼',  pos: '走高跳', risk: 41, fat: 5, status: '注意',  col: '#f59e0b' },
                { name: '佐藤 凛',  pos: '800m',  risk: 8,  fat: 2,  status: '良好',  col: GREEN },
              ].map((p, i) => (
                <View key={i} style={s.dashRow}>
                  <View style={[s.dashAvatar, { backgroundColor: p.col + '22' }]}>
                    <Text style={[s.dashInitial, { color: p.col }]}>{p.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.dashName}>{p.name}</Text>
                    <Text style={s.dashPos}>{p.pos}</Text>
                  </View>
                  <View>
                    <View style={[s.dashBadge, { backgroundColor: p.col + '18' }]}>
                      <Text style={[s.dashBadgeTxt, { color: p.col }]}>{p.status}</Text>
                    </View>
                    <Text style={s.dashRisk}>リスク {p.risk}%</Text>
                  </View>
                </View>
              ))}
            </View>
          </FadeCard>
        </View>

        {/* ── コーチの悩み ────────────────────────────────────── */}
        <View style={[s.section, { backgroundColor: OFF }]}>
          <FadeCard delay={100}>
            <Text style={s.tag}>コーチの現実</Text>
            <Text style={s.sectionTitle}>こんな悩み、抱えていませんか？</Text>
          </FadeCard>
          <View style={s.painGrid}>
            {PAIN_POINTS.map((p, i) => (
              <FadeCard key={i} delay={150 + i * 80} style={[s.painCard, { backgroundColor: p.color }]}>
                <Text style={s.painEmoji}>{p.emoji}</Text>
                <Text style={s.painTitle}>{p.title}</Text>
                <Text style={s.painBody}>{p.body}</Text>
              </FadeCard>
            ))}
          </View>
          <FadeCard delay={550} style={s.arrowWrap}>
            <View style={s.arrowLine} />
            <View style={s.arrowCircle}>
              <Ionicons name="arrow-down" size={20} color={GREEN} />
            </View>
            <Text style={s.arrowTxt}>sCORE が全部解決します</Text>
          </FadeCard>
        </View>

        {/* ── 機能 ─────────────────────────────────────────────── */}
        <View style={s.section}>
          <FadeCard delay={100}>
            <Text style={s.tag}>主な機能</Text>
            <Text style={s.sectionTitle}>コーチの仕事を、{'\n'}アプリが自動でやる。</Text>
          </FadeCard>
          <View style={s.featureGrid}>
            {FEATURES.map((f, i) => (
              <FadeCard key={i} delay={150 + i * 70} style={s.featureCard}>
                <View style={[s.featureIconWrap, { backgroundColor: f.bg }]}>
                  <Ionicons name={f.icon} size={22} color={f.color} />
                </View>
                <Text style={s.featureTitle}>{f.title}</Text>
                <Text style={s.featureBody}>{f.body}</Text>
              </FadeCard>
            ))}
          </View>
        </View>

        {/* ── 数字 ─────────────────────────────────────────────── */}
        <View style={s.statsRow}>
          {[
            { n: '1分',   l: '毎日の管理時間' },
            { n: '20名+', l: '管理できる選手数' },
            { n: '7日',   l: '無料トライアル' },
            { n: '¥0〜',  l: '始められる金額' },
          ].map((st, i) => (
            <FadeCard key={i} delay={100 + i * 80} style={s.statCard}>
              <Text style={s.statNum}>{st.n}</Text>
              <Text style={s.statLabel}>{st.l}</Text>
            </FadeCard>
          ))}
        </View>

        {/* ── 選手のメリット ───────────────────────────────────── */}
        <View style={[s.section, { backgroundColor: OFF }]}>
          <FadeCard delay={100}>
            <Text style={s.tag}>選手側のメリット</Text>
            <Text style={s.sectionTitle}>選手が自分から{'\n'}使いたくなるアプリ。</Text>
            <Text style={s.sectionBody}>
              sCORE は選手にとっても魅力的。自己ベスト管理やSNSシェアで「続けたくなる」設計。コーチが強制しなくても選手が自発的に記録します。
            </Text>
          </FadeCard>
          <View style={s.benefitGrid}>
            {PLAYER_BENEFITS.map((b, i) => (
              <FadeCard key={i} delay={150 + i * 60} style={s.benefitCard}>
                <Text style={s.benefitTxt}>{b}</Text>
              </FadeCard>
            ))}
          </View>
        </View>

        {/* ── 3ステップ ────────────────────────────────────────── */}
        <View style={s.section}>
          <FadeCard delay={100}>
            <Text style={s.tag}>導入の流れ</Text>
            <Text style={s.sectionTitle}>今日から使える。{'\n'}3ステップで完了。</Text>
          </FadeCard>
          {[
            { n: '01', t: 'コーチがアカウント作成',    b: 'メールアドレスだけ。5分以内に完了します。' },
            { n: '02', t: 'チームコードを選手に共有',  b: '4桁のコードを伝えるだけ。QRコードでも共有できます。' },
            { n: '03', t: 'あとはアプリが自動管理',    b: '選手が記録するたびにダッシュボードに自動反映されます。' },
          ].map((st, i) => (
            <FadeCard key={i} delay={150 + i * 100} style={s.stepRow}>
              <View style={s.stepCircle}>
                <Text style={s.stepN}>{st.n}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.stepTitle}>{st.t}</Text>
                <Text style={s.stepBody}>{st.b}</Text>
              </View>
            </FadeCard>
          ))}
        </View>

        {/* ── 料金 ─────────────────────────────────────────────── */}
        <View style={[s.section, { backgroundColor: OFF }]}>
          <FadeCard delay={100}>
            <Text style={s.tag}>料金プラン</Text>
            <Text style={s.sectionTitle}>まずは無料で始める。</Text>
          </FadeCard>
          <View style={s.planRow}>
            {/* フリー */}
            <FadeCard delay={200} style={s.planCard}>
              <Text style={s.planName}>個人プラン</Text>
              <Text style={s.planPrice}>¥0</Text>
              <Text style={s.planPer}>ずっと無料</Text>
              {['練習記録・コンディション管理', '自己ベスト管理', 'シェアカード生成', 'AIコーチアドバイス'].map((f, i) => (
                <View key={i} style={s.planFeat}>
                  <Ionicons name="checkmark-circle" size={15} color={GREEN} />
                  <Text style={s.planFeatTxt}>{f}</Text>
                </View>
              ))}
            </FadeCard>
            {/* チーム */}
            <FadeCard delay={300} style={[s.planCard, s.planFeatured]}>
              <View style={s.planBadge}><Text style={s.planBadgeTxt}>チームにおすすめ</Text></View>
              <Text style={[s.planName, { color: WHITE }]}>チームプラン</Text>
              <Text style={[s.planPrice, { color: WHITE }]}>¥1,980</Text>
              <Text style={[s.planPer, { color: 'rgba(255,255,255,0.6)' }]}>/ 月（20名まで）</Text>
              {['コーチダッシュボード', '全選手コンディション一覧', '怪我リスクスコア自動算出', 'チーム予定管理', '練習記録の自動集計', 'リアルタイム通知'].map((f, i) => (
                <View key={i} style={s.planFeat}>
                  <Ionicons name="checkmark-circle" size={15} color={GREEN_M} />
                  <Text style={[s.planFeatTxt, { color: 'rgba(255,255,255,0.85)' }]}>{f}</Text>
                </View>
              ))}
              <TouchableOpacity style={s.planBtn} onPress={handleTrial} activeOpacity={0.85}>
                <Text style={s.planBtnTxt}>無料で試す</Text>
              </TouchableOpacity>
            </FadeCard>
          </View>
        </View>

        {/* ── 最終CTA ───────────────────────────────────────────── */}
        <View style={s.cta}>
          <FadeCard delay={100}>
            <Text style={s.ctaTitle}>
              選手の怪我は、{'\n'}防げる時代になった。
            </Text>
            <Text style={s.ctaBody}>
              sCORE は日本の陸上競技者のために作られた本気のアプリです。{'\n'}まず無料で試してください。いつでも解約できます。
            </Text>
            <TouchableOpacity style={s.ctaBtn} onPress={handleTrial} activeOpacity={0.85}>
              <Text style={s.ctaBtnTxt}>無料でチームを作成する</Text>
              <Ionicons name="arrow-forward" size={18} color={WHITE} />
            </TouchableOpacity>
            <Text style={s.ctaNote}>無料プランあり・クレジットカード不要・いつでもキャンセル</Text>
          </FadeCard>
        </View>

        {/* ── フッター ─────────────────────────────────────────── */}
        <View style={s.footer}>
          <Text style={s.footerLogo}>sCORE</Text>
          <Text style={s.footerCopy}>© 2026 sCORE Japan. All rights reserved.</Text>
          {/* サポート・お問い合わせ */}
          <View style={{ marginVertical: 8, alignItems: 'center', gap: 4 }}>
            <Text style={[s.footerCopy, { fontWeight: '600' }]}>サポート・お問い合わせ</Text>
            <TouchableOpacity onPress={() => Linking.openURL('mailto:team.deepwork2026@gmail.com')}>
              <Text style={[s.footerLink, { color: GREEN, textDecorationLine: 'underline' }]}>
                team.deepwork2026@gmail.com
              </Text>
            </TouchableOpacity>
            <Text style={s.footerCopy}>お問い合わせはメールにてご連絡ください。</Text>
            <Text style={s.footerCopy}>通常1〜3営業日以内にご返信いたします。</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <TouchableOpacity onPress={() => router.push('/privacy' as any)}>
              <Text style={s.footerLink}>プライバシーポリシー</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/terms' as any)}>
              <Text style={s.footerLink}>利用規約</Text>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>
    </View>
  )
}

const center: any = isWeb ? { maxWidth: MAX_W, alignSelf: 'center', width: '100%' } : {}

const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: WHITE },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: LGRAY,
    backgroundColor: WHITE, ...center,
  },
  navLogo:   { color: BLACK, fontSize: 20, fontWeight: '900', letterSpacing: 0.5 },
  navLinks:  { flexDirection: 'row', alignItems: 'center', gap: 20, flex: 1, justifyContent: 'center' },
  navLink:   { color: GRAY, fontSize: 14, fontWeight: '600' },
  navBtn:    { backgroundColor: GREEN, borderRadius: 50, paddingHorizontal: 18, paddingVertical: 9 },
  navBtnTxt: { color: WHITE, fontWeight: '800', fontSize: 13 },

  // Hero
  hero: { paddingHorizontal: 24, paddingTop: 52, paddingBottom: 48, backgroundColor: WHITE, ...center },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: GREEN_L, borderRadius: 50, paddingHorizontal: 14, paddingVertical: 7,
    alignSelf: 'flex-start', marginBottom: 24,
  },
  heroBadgeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN },
  heroBadgeTxt: { color: GREEN, fontWeight: '800', fontSize: 12 },
  heroTitle: { color: BLACK, fontSize: isWeb ? 44 : 30, fontWeight: '900', lineHeight: isWeb ? 56 : 40, marginBottom: 20 },
  heroSub:   { color: GRAY,  fontSize: 16, lineHeight: 28, marginBottom: 36 },
  heroBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: GREEN, borderRadius: 50,
    paddingHorizontal: 28, paddingVertical: 16, alignSelf: 'flex-start', marginBottom: 12,
    shadowColor: GREEN, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 8,
  },
  heroBtnTxt: { color: WHITE, fontWeight: '900', fontSize: 16 },
  heroNote:   { color: GRAY, fontSize: 12, marginBottom: 44 },

  // Dashboard preview
  dashWrap: { width: '100%' as any },
  dash: {
    backgroundColor: WHITE, borderRadius: 20, padding: 16,
    borderWidth: 1, borderColor: LGRAY,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 24, elevation: 8,
  },
  dashTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  dashTitle:    { color: BLACK, fontWeight: '800', fontSize: 14 },
  allOkBadge:   { backgroundColor: GREEN_L, borderRadius: 50, paddingHorizontal: 10, paddingVertical: 4 },
  allOkTxt:     { color: GREEN, fontSize: 11, fontWeight: '700' },
  dashRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: LGRAY,
  },
  dashAvatar:  { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dashInitial: { fontWeight: '800', fontSize: 15 },
  dashName:    { color: BLACK, fontWeight: '700', fontSize: 13 },
  dashPos:     { color: GRAY, fontSize: 11 },
  dashBadge:   { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-end' },
  dashBadgeTxt:{ fontWeight: '700', fontSize: 11 },
  dashRisk:    { color: GRAY, fontSize: 10, textAlign: 'right' },

  // Section共通
  section: { paddingHorizontal: 24, paddingVertical: 60, backgroundColor: WHITE },
  tag:         { color: GREEN, fontWeight: '800', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 },
  sectionTitle:{ color: BLACK, fontSize: isWeb ? 36 : 26, fontWeight: '900', lineHeight: isWeb ? 48 : 36, marginBottom: 16 },
  sectionBody: { color: GRAY, fontSize: 15, lineHeight: 26, marginBottom: 32 },

  // Pain
  painGrid: { gap: 14, marginTop: 32 },
  painCard: { borderRadius: 16, padding: 20, borderWidth: 1, borderColor: LGRAY },
  painEmoji: { fontSize: 30, marginBottom: 10 },
  painTitle: { color: BLACK, fontWeight: '800', fontSize: 15, marginBottom: 6 },
  painBody:  { color: GRAY, fontSize: 13, lineHeight: 22 },
  arrowWrap:  { alignItems: 'center', marginTop: 40, gap: 8 },
  arrowLine:  { width: 1, height: 32, backgroundColor: LGRAY },
  arrowCircle:{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: GREEN, alignItems: 'center', justifyContent: 'center', backgroundColor: GREEN_L },
  arrowTxt:   { color: GREEN, fontWeight: '800', fontSize: 14 },

  // Features
  featureGrid: {
    gap: 14, marginTop: 32,
    ...(isWeb ? { flexDirection: 'row' as const, flexWrap: 'wrap' as const } : {}),
  },
  featureCard: {
    backgroundColor: WHITE, borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: LGRAY,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    ...(isWeb ? { width: '31%' as any } : {}),
  },
  featureIconWrap: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  featureTitle:    { color: BLACK, fontWeight: '800', fontSize: 14, marginBottom: 6 },
  featureBody:     { color: GRAY, fontSize: 13, lineHeight: 21 },

  // Stats
  statsRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    backgroundColor: BLACK, paddingVertical: 32, paddingHorizontal: 8,
  },
  statCard:  { width: '50%', alignItems: 'center', paddingVertical: 20 },
  statNum:   { color: WHITE, fontSize: 34, fontWeight: '900', marginBottom: 4 },
  statLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', textAlign: 'center' },

  // Benefits
  benefitGrid: { gap: 10, marginTop: 24 },
  benefitCard: {
    backgroundColor: WHITE, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: LGRAY,
  },
  benefitTxt: { color: BLACK, fontSize: 14, fontWeight: '600' },

  // Steps
  stepRow: { flexDirection: 'row', gap: 16, marginTop: 24, alignItems: 'flex-start' },
  stepCircle: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: GREEN_L, borderWidth: 1.5, borderColor: GREEN,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stepN:     { color: GREEN, fontWeight: '900', fontSize: 13 },
  stepTitle: { color: BLACK, fontWeight: '800', fontSize: 15, marginBottom: 4 },
  stepBody:  { color: GRAY, fontSize: 13, lineHeight: 21 },

  // Plans
  planRow: { gap: 16, marginTop: 32, ...(isWeb ? { flexDirection: 'row' as const } : {}) },
  planCard: {
    borderRadius: 20, padding: 24, borderWidth: 1, borderColor: LGRAY,
    backgroundColor: WHITE, gap: 4, ...(isWeb ? { flex: 1 } : {}),
  },
  planFeatured: { backgroundColor: BLACK, borderColor: BLACK },
  planBadge: {
    backgroundColor: GREEN, borderRadius: 50, paddingHorizontal: 12, paddingVertical: 4,
    alignSelf: 'flex-start', marginBottom: 8,
  },
  planBadgeTxt: { color: WHITE, fontWeight: '800', fontSize: 11 },
  planName:  { color: GRAY, fontWeight: '700', fontSize: 13 },
  planPrice: { color: BLACK, fontWeight: '900', fontSize: 36, marginVertical: 2 },
  planPer:   { color: GRAY, fontSize: 12, marginBottom: 14 },
  planFeat:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  planFeatTxt: { color: GRAY, fontSize: 13 },
  planBtn: {
    backgroundColor: GREEN, borderRadius: 50, paddingVertical: 14,
    alignItems: 'center', marginTop: 20,
  },
  planBtnTxt: { color: WHITE, fontWeight: '900', fontSize: 15 },

  // CTA
  cta: {
    paddingHorizontal: 24, paddingVertical: 80,
    backgroundColor: GREEN_L, alignItems: 'center',
    borderTopWidth: 1, borderTopColor: GREEN_M,
  },
  ctaTitle: { color: BLACK, fontSize: isWeb ? 40 : 28, fontWeight: '900', lineHeight: isWeb ? 52 : 38, textAlign: 'center', marginBottom: 16 },
  ctaBody:  { color: GRAY, fontSize: 15, lineHeight: 26, textAlign: 'center', marginBottom: 40, maxWidth: 480 },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: GREEN, borderRadius: 50, paddingHorizontal: 32, paddingVertical: 18, marginBottom: 14,
    shadowColor: GREEN, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 10,
  },
  ctaBtnTxt: { color: WHITE, fontWeight: '900', fontSize: 16 },
  ctaNote:   { color: GRAY, fontSize: 12 },

  // Footer
  footer: {
    paddingHorizontal: 24, paddingVertical: 32, alignItems: 'center', gap: 8,
    borderTopWidth: 1, borderTopColor: LGRAY, backgroundColor: WHITE,
  },
  footerLogo: { color: BLACK, fontWeight: '900', fontSize: 18, letterSpacing: 0.5 },
  footerCopy: { color: GRAY, fontSize: 11 },
  footerLink: { color: GRAY, fontSize: 11 },
})

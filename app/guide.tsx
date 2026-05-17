// app/guide.tsx — sCORE 完全使い方ガイド（ブログ記事スタイル・ライト＆クリーン）
import React, { useState, useRef, useEffect } from 'react'
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
const FEATURES = [
  {
    icon: 'fitness-outline' as const,
    color: GREEN,
    bg: GREEN_L,
    title: '練習記録・コンディション管理',
    what: '距離・本数・タイム・疲労度・天気・気分をワンタップで記録。毎日の練習を積み上げてグラフ化。',
    tip: '毎日アプリを開いてコンディションを入力するだけでOK。蓄積されたデータがコーチへの自動レポートになります。',
  },
  {
    icon: 'warning-outline' as const,
    color: '#ef4444',
    bg: '#fef2f2',
    title: '怪我リスクスコア（AI自動算出）',
    what: '睡眠時間・疲労蓄積・天気・気温・練習負荷を複合分析し、今日の怪我リスクを0〜100でスコア化。',
    tip: 'スコアが70以上の日は無理をしない。自分の体の声をデータで「見える化」できます。',
  },
  {
    icon: 'people-outline' as const,
    color: '#3b82f6',
    bg: '#eff6ff',
    title: 'チーム機能（コーチ向け）',
    what: 'コーチが専用コードを発行 → 選手が参加。全選手のコンディションをダッシュボードで一括管理。',
    tip: '顧問・コーチ不在の練習中でも、選手の状態をリモートで確認。欠席・体調不良の報告もアプリ完結。',
  },
  {
    icon: 'chatbubble-ellipses-outline' as const,
    color: '#a855f7',
    bg: '#faf5ff',
    title: 'AIコーチアドバイス',
    what: '今日のコンディション・練習履歴・怪我リスクを踏まえて、AIが今日やるべき練習・回復のアドバイスを生成。',
    tip: '「なんとなく疲れてる」を言語化してくれる相棒。毎朝チェックすれば過トレーニングを防げます。',
  },
  {
    icon: 'share-social-outline' as const,
    color: '#f59e0b',
    bg: '#fffbeb',
    title: 'シェアカード（SNS投稿）',
    what: '自己ベスト更新・連続記録・週間ロードをおしゃれなカードに自動生成。Instagramに1タップでシェア。',
    tip: '仲間に見せて刺激し合うことが継続のコツ。sCORE Monthly Challengeに参加すれば公式からも注目されます。',
  },
  {
    icon: 'trophy-outline' as const,
    color: '#06b6d4',
    bg: '#ecfeff',
    title: '大会記録・自己ベスト管理',
    what: '100m・200m・走高跳など種目別の大会記録を蓄積。PB更新時は特別なエフェクトとバッジが表示。',
    tip: '入力するだけで自動的に自己ベストが更新される。大会シーズン前に過去記録を振り返るのに最適。',
  },
]

// ── ペルソナ ─────────────────────────────────────────────────────────
const PERSONAS = [
  { emoji: '🏃', label: '高校生スプリンター', desc: '練習記録・怪我リスク・自己ベスト管理で成長を可視化したい' },
  { emoji: '📋', label: '陸上部顧問・コーチ', desc: '20人以上の選手の体調を毎日1分で把握し、怪我を未然に防ぎたい' },
  { emoji: '💼', label: '社会人ランナー', desc: 'データに基づいたトレーニングとSNSシェアでモチベーションを維持したい' },
  { emoji: '🎓', label: '大学陸上部員', desc: 'チーム全体のコンディション管理と大会記録の一元管理をしたい' },
]

// ── 料金プラン ───────────────────────────────────────────────────────
const PLANS = [
  {
    name: 'FREE',
    price: '¥0',
    period: '',
    color: GRAY,
    bg: OFF2,
    features: ['練習記録（月10回）', 'コンディション管理', '自己ベスト管理', '怪我リスクスコア（基本）'],
  },
  {
    name: 'PRO',
    price: '¥480',
    period: '/月',
    color: GREEN,
    bg: GREEN_L,
    features: ['練習記録（無制限）', 'AIコーチアドバイス', 'シェアカード生成', 'データグラフ・分析'],
    badge: '人気',
  },
  {
    name: 'ELITE',
    price: '¥980',
    period: '/月',
    color: '#a855f7',
    bg: '#faf5ff',
    features: ['PRO全機能', '動画フォーム分析（月2回）', 'メニュー自動作成（AI）', '優先サポート'],
  },
  {
    name: 'COACH',
    price: '¥2,980',
    period: '/月',
    color: '#3b82f6',
    bg: '#eff6ff',
    features: ['チーム機能（選手数無制限）', 'コーチダッシュボード', '選手一括コンディション確認', 'チームイベント管理'],
  },
]

// ── FAQ ──────────────────────────────────────────────────────────────
const FAQS = [
  { q: 'sCORE は無料で使えますか？', a: 'はい。FREE プランは完全無料で、基本的な練習記録・コンディション管理・自己ベスト管理が利用できます。有料プランへの強制移行はありません。' },
  { q: 'どんなスポーツに対応していますか？', a: '陸上競技に特化したアプリです。100m・200m・400m・800m・1500m・5000m・10000m・走幅跳・走高跳・三段跳・棒高跳・砲丸投・円盤投・やり投など主要種目に対応しています。' },
  { q: 'チーム機能はどうやって始めますか？', a: 'COACHプランに加入後、コーチダッシュボードからチームを作成し、招待コードを選手に共有するだけです。選手はそのコードを使って無料でチームに参加できます。' },
  { q: '怪我リスクスコアはどう計算されますか？', a: '直近7日間の練習負荷・疲労度・睡眠時間・気温・湿度・天気などを独自アルゴリズムで複合分析します。スコアが高いほどリスクが高く、休養や軽めの練習が推奨されます。' },
  { q: 'AIコーチアドバイスの精度はどのくらいですか？', a: 'Anthropic の Claude（最新モデル）を使用しています。あなたの過去データを踏まえて個別化されたアドバイスを生成するため、汎用的なフィットネスアプリより的確なアドバイスが期待できます。' },
  { q: '解約はいつでもできますか？', a: 'はい。App Store / Google Play のサブスクリプション管理画面からいつでも解約できます。解約後も期間終了まで有料機能を利用できます。' },
  { q: 'データはどこに保存されますか？', a: '練習記録・コンディションデータはすべてクラウド（Supabase）に安全に保存されます。機種変更後もログインすれば全データを引き継げます。' },
  { q: 'チームに参加するのに費用はかかりますか？', a: 'チームへの参加（選手として）は無料です。コーチ側がCOACHプランを契約することで、選手は費用なしでチーム機能を利用できます。' },
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

  const handleDownload = (store: 'apple' | 'google') => {
    if (store === 'apple') {
      Linking.openURL('https://apps.apple.com/jp/app/score/id6738321803')
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
              <Text style={g.navLink}>機能</Text>
            </TouchableOpacity>
            <Text style={[g.navLink, { color: GREEN, fontWeight: '700' }]}>使い方</Text>
            <TouchableOpacity onPress={() => isWeb ? Linking.openURL('https://scorej-run.vercel.app/coach-landing') : router.push('/coach-landing')} activeOpacity={0.7}>
              <Text style={g.navLink}>料金</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={g.navBtn} onPress={handleTrial} activeOpacity={0.85}>
            <Text style={g.navBtnTxt}>無料で試す</Text>
          </TouchableOpacity>
        </View>

        {/* ── 記事ヘッダー ──────────────────────────────────────── */}
        <View style={g.articleHeader}>
          <Animated.View style={[heroAnim, center]}>
            <View style={g.tagRow}>
              <View style={g.tag}><Text style={g.tagTxt}>使い方ガイド</Text></View>
              <View style={g.tag}><Text style={g.tagTxt}>陸上競技</Text></View>
              <View style={[g.tag, { backgroundColor: '#fffbeb' }]}><Text style={[g.tagTxt, { color: '#92400e' }]}>読了 約10分</Text></View>
            </View>
            <Text style={g.articleTitle}>
              sCORE の使い方完全ガイド{'\n'}
              — 練習記録から怪我予防まで
            </Text>
            <Text style={g.articleMeta}>2026年4月更新　sCORE Japan 編集部</Text>
          </Animated.View>
        </View>

        {/* ── 3分でわかる結論 ─────────────────────────────────── */}
        <View style={g.section}>
          <View style={[g.inner, center]}>
            <View style={g.summaryBox}>
              <Text style={g.summaryTitle}>📌 3分でわかる sCORE の特徴</Text>
              {[
                { n: '01', txt: '練習記録・コンディション管理・怪我リスクを1つのアプリで完結。毎日1分の入力だけで、自分の体を「数値で見える化」できる。' },
                { n: '02', txt: 'AIが今日の体状況に合わせたアドバイスを生成。専門コーチがいなくても、科学的に正しいトレーニング管理が実現。' },
                { n: '03', txt: 'コーチ・顧問向けのチーム機能で、全選手の状態を毎朝1分で把握。紙・LINEの管理から卒業できる。' },
              ].map(item => (
                <View key={item.n} style={g.summaryRow}>
                  <View style={g.summaryNum}><Text style={g.summaryNumTxt}>{item.n}</Text></View>
                  <Text style={g.summaryTxt}>{item.txt}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── sCORE とは ────────────────────────────────────────── */}
        <View style={[g.section, { backgroundColor: OFF }]}>
          <View style={[g.inner, center]}>
            <Text style={g.sectionLabel}>ABOUT</Text>
            <Text style={g.sectionTitle}>sCORE とは何か</Text>
            <Text style={g.body}>
              sCORE（スコア）は、陸上競技者のための練習記録・コンディション管理・怪我予防アプリです。2024年にローンチし、中学生から社会人アスリートまで幅広いユーザーに使用されています。
            </Text>
            <Text style={[g.body, { marginTop: 12 }]}>
              「毎日の練習を記録したい」「怪我を減らしたい」「コーチとして選手を管理したい」——そんな悩みをひとつのアプリで解決します。
            </Text>

            <View style={g.targetGrid}>
              {[
                { icon: '🏃', label: '中学・高校生' },
                { icon: '🎓', label: '大学陸上部' },
                { icon: '💼', label: '社会人ランナー' },
                { icon: '📋', label: '顧問・コーチ' },
              ].map(t => (
                <View key={t.label} style={g.targetChip}>
                  <Text style={{ fontSize: 20 }}>{t.icon}</Text>
                  <Text style={g.targetChipTxt}>{t.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── 機能ガイド ────────────────────────────────────────── */}
        <View style={g.section}>
          <View style={[g.inner, center]}>
            <Text style={g.sectionLabel}>FEATURES</Text>
            <Text style={g.sectionTitle}>機能ガイド</Text>
            <Text style={g.sectionSub}>6つの主要機能の詳細な使い方を紹介します</Text>

            {FEATURES.map((feat, i) => (
              <View key={i} style={g.featCard}>
                <View style={g.featCardHeader}>
                  <View style={[g.featIcon, { backgroundColor: feat.bg }]}>
                    <Ionicons name={feat.icon} size={24} color={feat.color} />
                  </View>
                  <Text style={[g.featCardTitle, { color: feat.color }]}>{feat.title}</Text>
                </View>
                <View style={g.featCardBody}>
                  <View style={g.featBlock}>
                    <Text style={g.featBlockLabel}>できること</Text>
                    <Text style={g.featBlockTxt}>{feat.what}</Text>
                  </View>
                  <View style={[g.featBlock, { backgroundColor: feat.bg, borderRadius: 10, padding: 12 }]}>
                    <Text style={[g.featBlockLabel, { color: feat.color }]}>💡 活用ポイント</Text>
                    <Text style={[g.featBlockTxt, { color: BLACK }]}>{feat.tip}</Text>
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
            <Text style={g.sectionTitle}>こんな人にオススメ</Text>

            <View style={g.personaGrid}>
              {PERSONAS.map((p, i) => (
                <View key={i} style={g.personaCard}>
                  <Text style={{ fontSize: 32, marginBottom: 8 }}>{p.emoji}</Text>
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
            <Text style={g.sectionTitle}>料金プラン</Text>
            <Text style={g.sectionSub}>まずは無料で始められます。いつでもアップグレード・解約可能。</Text>

            <View style={g.planGrid}>
              {PLANS.map((plan, i) => (
                <View key={i} style={[g.planCard, { borderColor: plan.color }]}>
                  {plan.badge && (
                    <View style={[g.planBadge, { backgroundColor: plan.color }]}>
                      <Text style={g.planBadgeTxt}>{plan.badge}</Text>
                    </View>
                  )}
                  <Text style={[g.planName, { color: plan.color }]}>{plan.name}</Text>
                  <View style={g.planPriceRow}>
                    <Text style={[g.planPrice, { color: plan.color }]}>{plan.price}</Text>
                    {plan.period ? <Text style={g.planPeriod}>{plan.period}</Text> : null}
                  </View>
                  <View style={g.planFeatures}>
                    {plan.features.map((f, j) => (
                      <View key={j} style={g.planFeatureRow}>
                        <Ionicons name="checkmark-circle" size={14} color={plan.color} />
                        <Text style={g.planFeatureTxt}>{f}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>

            <Text style={g.planNote}>※ 年払いにすると約20%お得。学生割引（要学生証）もご利用いただけます。</Text>
          </View>
        </View>

        {/* ── FAQ ───────────────────────────────────────────────── */}
        <View style={[g.section, { backgroundColor: OFF }]}>
          <View style={[g.inner, center]}>
            <Text style={g.sectionLabel}>FAQ</Text>
            <Text style={g.sectionTitle}>よくある質問</Text>

            {FAQS.map((item, i) => (
              <FaqItem key={i} q={item.q} a={item.a} />
            ))}
          </View>
        </View>

        {/* ── 目的別スタート方法 ─────────────────────────────────── */}
        <View style={g.section}>
          <View style={[g.inner, center]}>
            <Text style={g.sectionLabel}>GET STARTED</Text>
            <Text style={g.sectionTitle}>目的別スタート方法</Text>

            {[
              {
                icon: 'person-outline' as const,
                color: GREEN,
                title: '個人選手として始める',
                steps: ['App Store または Google Play でインストール', 'アカウント作成（メール or Google）', 'プロフィール・種目を設定', '今日のコンディションを入力してスタート'],
              },
              {
                icon: 'people-outline' as const,
                color: '#3b82f6',
                title: 'チーム・部活で始める',
                steps: ['コーチ側が COACH プランに加入', 'チームを作成 → 招待コードを発行', '選手に招待コードを共有（LINE等でOK）', '選手は無料で参加・記録開始'],
              },
              {
                icon: 'trophy-outline' as const,
                color: '#a855f7',
                title: '大会シーズンに向けて使う',
                steps: ['大会記録タブに過去の自己ベストを登録', '練習負荷と怪我リスクを毎日チェック', 'ピーキング期は AIコーチアドバイスを参考に', '大会後は自己ベスト更新カードをシェア'],
              },
            ].map((item, i) => (
              <View key={i} style={g.startCard}>
                <View style={g.startCardHeader}>
                  <View style={[g.startIcon, { backgroundColor: item.color + '18' }]}>
                    <Ionicons name={item.icon} size={20} color={item.color} />
                  </View>
                  <Text style={g.startCardTitle}>{item.title}</Text>
                </View>
                {item.steps.map((step, j) => (
                  <View key={j} style={g.startStep}>
                    <View style={[g.startStepNum, { backgroundColor: item.color }]}>
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
            <Text style={g.ctaTitle}>今すぐ sCORE を始めよう</Text>
            <Text style={g.ctaSub}>無料プランで今すぐスタート。クレジットカード不要。</Text>

            <View style={g.ctaBtns}>
              <TouchableOpacity style={g.ctaBtn} onPress={() => handleDownload('apple')} activeOpacity={0.85}>
                <Ionicons name="logo-apple" size={20} color={WHITE} />
                <View>
                  <Text style={g.ctaBtnSub}>App Store で</Text>
                  <Text style={g.ctaBtnMain}>ダウンロード</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={[g.ctaBtn, { backgroundColor: '#16a34a' }]} onPress={() => handleDownload('google')} activeOpacity={0.85}>
                <Ionicons name="logo-google-playstore" size={20} color={WHITE} />
                <View>
                  <Text style={g.ctaBtnSub}>Google Play で</Text>
                  <Text style={g.ctaBtnMain}>ダウンロード</Text>
                </View>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={handleTrial} activeOpacity={0.8} style={{ marginTop: 12 }}>
              <Text style={g.ctaWebLink}>ブラウザ版で試す →</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── フッター ──────────────────────────────────────────── */}
        <View style={g.footer}>
          <View style={[center, { alignItems: 'center', gap: 16 }]}>
            <Text style={g.footerLogo}>sCORE</Text>
            <View style={g.footerLinks}>
              {[
                { label: '利用規約', url: 'https://scorej-run.vercel.app/terms' },
                { label: 'プライバシーポリシー', url: 'https://scorej-run.vercel.app/privacy' },
                { label: 'コーチ向け', url: 'https://scorej-run.vercel.app/coach-landing' },
                { label: 'お問い合わせ', url: 'mailto:amuletbaby.shop@gmail.com' },
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

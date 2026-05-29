// app/terms.tsx — 利用規約（白基調・Web スタイル）
import React from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

const LAST_UPDATED = '2026年5月29日'
const APP_NAME     = 'sCORE'
const OPERATOR     = 'sCORE Japan'
const CONTACT      = 'amuletbaby.shop@gmail.com'

const isWeb = Platform.OS === 'web'
const MAX_W = 720

// ── 共通コンポーネント ──────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <Text style={s.body}>{children}</Text>
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.liRow}>
      <Text style={s.bullet}>・</Text>
      <Text style={[s.body, { flex: 1 }]}>{children}</Text>
    </View>
  )
}

// ── メイン画面 ─────────────────────────────────────────────────────────

export default function TermsScreen() {
  const router = useRouter()

  return (
    <View style={s.root}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* ヘッダー */}
        <View style={s.header}>
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={s.headerLogo}>{APP_NAME}</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.content}>
            {/* タイトル */}
            <Text style={s.pageTitle}>利用規約</Text>
            <Text style={s.lastUpdated}>最終更新日：{LAST_UPDATED}</Text>

            <P>
              本利用規約（以下「本規約」）は、{OPERATOR}（以下「当社」）が提供するスマートフォンアプリ・ウェブアプリ「{APP_NAME}」（以下「本サービス」）の利用条件を定めるものです。本サービスをご利用いただく前に、本規約をよくお読みください。本サービスを利用した場合、本規約に同意したものとみなします。
            </P>

            {/* 1. サービス概要 */}
            <Section title="1. サービス概要">
              <P>
                {APP_NAME} は、陸上競技選手向けのパフォーマンス管理アプリです。練習記録・コンディション管理・怪我リスク診断・AI アドバイス・チーム管理機能などを提供します。iOS アプリおよびウェブ版（PWA）として利用できます。
              </P>
            </Section>

            {/* 2. 利用条件 */}
            <Section title="2. 利用条件">
              <P>本サービスを利用するには、以下の条件を満たす必要があります。</P>
              <Li>13 歳以上であること（13 歳未満の方は保護者の同意が必要）</Li>
              <Li>アカウント登録時に正確な情報を提供すること</Li>
              <Li>本規約およびプライバシーポリシーに同意すること</Li>
              <Li>1 人につき 1 アカウントのみ作成すること</Li>
            </Section>

            {/* 3. 禁止事項 */}
            <Section title="3. 禁止事項">
              <P>ユーザーは以下の行為を行ってはなりません。</P>
              <Li>法令または本規約に違反する行為</Li>
              <Li>本サービスのソフトウェアを逆コンパイル・リバースエンジニアリングする行為</Li>
              <Li>他のユーザーへの嫌がらせ・誹謗中傷・迷惑行為</Li>
              <Li>虚偽の情報を登録・送信する行為</Li>
              <Li>不正な手段で有料機能を無償利用する行為</Li>
              <Li>本サービスへの不正アクセス・過大な負荷をかける行為</Li>
              <Li>当社または第三者の知的財産権を侵害する行為</Li>
              <Li>反社会的勢力への利益供与その他の反社会的行為</Li>
              <Li>その他、当社が不適切と判断する行為</Li>
            </Section>

            {/* 4. サブスクリプション */}
            <Section title="4. サブスクリプション">
              <P>本サービスは以下の有料プランを提供しています。</P>
              <Li>PRO プラン：月額 ¥480 / 年額 ¥4,800（広告非表示・AI 機能拡張）</Li>
              <Li>ELITE プラン：月額 ¥980 / 年額 ¥8,820（AI 機能完全無制限・優先サポート）</Li>
              <Li>COACH プラン：月額 ¥2,980 / 年額 ¥29,800（チーム管理機能）</Li>
              <P>
                有料プランは Apple App Store のサブスクリプションとして提供され、更新日の 24 時間前までに解約しない限り自動更新されます。解約は App Store の「設定」→「サブスクリプション」から行ってください。解約後も当該課金期間の終了まで有料機能をご利用いただけます。既にお支払いいただいた料金の返金はアプリストアの返金ポリシーに準じます。
              </P>
            </Section>

            {/* 5. 免責事項 */}
            <Section title="5. 免責事項">
              <P>
                本サービスが提供する怪我リスクスコア・AI アドバイス・栄養分析等はすべて参考情報であり、医療診断・医療行為に代わるものではありません。身体の痛みや不調がある場合は、医師・理学療法士等の専門家にご相談ください。
              </P>
              <P>
                当社は、以下について責任を負いません。
              </P>
              <Li>本サービスの情報を参考にしたことによる身体的・精神的・財産的損害</Li>
              <Li>外部サービス（Supabase・Anthropic・RevenueCat・OneSignal 等）の障害によるデータ消失・機能停止</Li>
              <Li>端末の故障・紛失等によるローカルデータの消失</Li>
              <Li>AI が生成するコンテンツの正確性・完全性</Li>
            </Section>

            {/* 6. 知的財産 */}
            <Section title="6. 知的財産">
              <P>
                本サービスのソフトウェア・デザイン・ロゴ・アルゴリズムその他一切のコンテンツに関する知的財産権は、当社または当社にライセンスを付与した権利者に帰属します。ユーザーは、個人的・非商業的目的に限り本サービスを利用できます。当社の事前の書面による許可なく、本サービスのコンテンツを複製・改変・再配布することを禁じます。
              </P>
            </Section>

            {/* 7. 準拠法 */}
            <Section title="7. 準拠法">
              <P>
                本規約は日本法に準拠して解釈されます。本規約に関する紛争については、東京地方裁判所を第一審の専属的合意管轄裁判所とします。
              </P>
            </Section>

            {/* 8. お問い合わせ */}
            <Section title="8. お問い合わせ">
              <P>本規約に関するご質問・アカウント削除申請は、以下の連絡先までお送りください。</P>
              <View style={s.contactBox}>
                <Text style={s.contactItem}>運営者：{OPERATOR}</Text>
                <Text style={s.contactItem}>メール：{CONTACT}</Text>
              </View>
            </Section>

            {/* フッター */}
            <View style={s.footerLine} />
            <Text style={s.footerText}>
              最終更新日：{LAST_UPDATED}{'\n'}
              © 2026 {OPERATOR}. All rights reserved.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    ...(isWeb ? { maxWidth: MAX_W, alignSelf: 'center' as const, width: '100%' as any } : {}),
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLogo: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: 0.5,
  },
  scroll: {
    paddingBottom: 60,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
    gap: 0,
    ...(isWeb ? { maxWidth: MAX_W, alignSelf: 'center' as const, width: '100%' as any } : {}),
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
  },
  lastUpdated: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 24,
  },
  section: {
    marginTop: 28,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 24,
  },
  liRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
  },
  bullet: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 24,
  },
  contactBox: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  contactItem: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 22,
  },
  footerLine: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginTop: 32,
    marginBottom: 24,
  },
  footerText: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 20,
  },
})

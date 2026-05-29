// app/privacy.tsx — プライバシーポリシー（白基調・Web スタイル）
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
const APP_URL      = 'https://scorej-run.vercel.app'

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

function PartnerRow({ name, purpose, link }: { name: string; purpose: string; link: string }) {
  return (
    <View style={s.partnerRow}>
      <Text style={s.partnerName}>{name}</Text>
      <Text style={s.partnerPurpose}>{purpose}</Text>
      <Text style={s.partnerLink}>{link}</Text>
    </View>
  )
}

// ── メイン画面 ─────────────────────────────────────────────────────────

export default function PrivacyScreen() {
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
            <Text style={s.pageTitle}>プライバシーポリシー</Text>
            <Text style={s.lastUpdated}>最終更新日：{LAST_UPDATED}</Text>

            {/* はじめに */}
            <Section title="1. はじめに">
              <P>
                {OPERATOR}（以下「当社」）は、陸上競技パフォーマンス管理アプリ「{APP_NAME}」（
                {APP_URL}）を運営しています。本プライバシーポリシーは、当社がユーザーの個人情報をどのように収集・利用・管理するかについて定めるものです。
              </P>
              <P>
                本サービスをご利用いただく前に、本ポリシーをよくお読みください。本サービスを利用した場合、本ポリシーの内容に同意したものとみなします。
              </P>
            </Section>

            {/* 収集する情報 */}
            <Section title="2. 収集する情報">
              <P>当社は、以下の情報を収集します。</P>
              <Li>練習記録・コンディション・睡眠データ（ユーザーが入力した情報）</Li>
              <Li>メールアドレス・Google アカウント情報（アカウント登録時）</Li>
              <Li>デバイス情報・広告ID（広告配信・統計分析目的）</Li>
              <Li>サブスクリプション購入情報（プラン種別・有効期限等）</Li>
            </Section>

            {/* 利用目的 */}
            <Section title="3. 情報の利用目的">
              <P>収集した情報は、以下の目的で利用します。</P>
              <Li>サービスの提供・改善および新機能の開発</Li>
              <Li>AI 分析機能の提供（練習データに基づく診断・アドバイス）</Li>
              <Li>広告の配信（Google AdMob による広告表示）</Li>
              <Li>プッシュ通知の配信（練習リマインダー・怪我リスク警告等）</Li>
              <Li>サブスクリプション管理および購入の検証</Li>
              <Li>ユーザーサポートへの対応</Li>
            </Section>

            {/* 第三者への提供 */}
            <Section title="4. 第三者への提供">
              <P>
                当社は、以下のサービスプロバイダーにデータを提供します。各社のプライバシーポリシーも合わせてご確認ください。
              </P>
              <View style={s.partnerTable}>
                <PartnerRow
                  name="Supabase, Inc."
                  purpose="ユーザー認証・データ保存"
                  link="supabase.com/privacy"
                />
                <PartnerRow
                  name="Google（AdMob）"
                  purpose="広告配信・広告ID の利用"
                  link="policies.google.com/privacy"
                />
                <PartnerRow
                  name="RevenueCat, Inc."
                  purpose="サブスクリプション管理・課金検証"
                  link="revenuecat.com/privacy"
                />
                <PartnerRow
                  name="OneSignal, Inc."
                  purpose="プッシュ通知の配信"
                  link="onesignal.com/privacy"
                />
                <PartnerRow
                  name="Anthropic PBC"
                  purpose="AI 分析機能（Claude API）"
                  link="anthropic.com/privacy"
                />
              </View>
              <P>
                上記以外に、法令に基づく場合を除き、ユーザーの同意なく第三者に個人情報を提供することはありません。
              </P>
            </Section>

            {/* データの保管・削除 */}
            <Section title="5. データの保管・削除">
              <P>
                収集したデータは、Supabase（米国）のサーバーに保管されます。アカウントを削除した場合、クラウドに保存されたすべてのデータは原則 14 日以内に削除されます。
              </P>
              <P>
                データの削除をご希望の場合は、アプリの「設定」→「アカウントを削除」から手続きを行うか、下記お問い合わせ先にご連絡ください。
              </P>
            </Section>

            {/* お子様のプライバシー */}
            <Section title="6. お子様のプライバシー">
              <P>
                本サービスは 13 歳以上を対象としています。13 歳未満の方が本サービスを利用する場合は、保護者の同意が必要です。当社が 13 歳未満のお子様の個人情報を収集していることが判明した場合、速やかに当該情報を削除します。
              </P>
            </Section>

            {/* お問い合わせ */}
            <Section title="7. お問い合わせ">
              <P>個人情報の取り扱いに関するご質問・ご要望は、以下の連絡先までお送りください。</P>
              <View style={s.contactBox}>
                <Text style={s.contactItem}>運営者：{OPERATOR}</Text>
                <Text style={s.contactItem}>メール：{CONTACT}</Text>
              </View>
            </Section>

            {/* 改定 */}
            <Section title="8. 改定">
              <P>
                本ポリシーは、法令の改正やサービスの変更に伴い、随時改定されることがあります。重要な変更を行う場合は、アプリ内のお知らせ機能を通じてユーザーに通知します。
              </P>
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
    marginBottom: 32,
  },
  section: {
    marginBottom: 32,
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
  partnerTable: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 4,
    marginBottom: 4,
  },
  partnerRow: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    gap: 2,
  },
  partnerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  partnerPurpose: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 20,
  },
  partnerLink: {
    fontSize: 12,
    color: '#6b7280',
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
    marginVertical: 24,
  },
  footerText: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 20,
  },
})

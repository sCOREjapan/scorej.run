// app/receipt.tsx — ご利用証明書（学校の部費精算等を想定）
//
// 2026-09-11: 「学校の顧問の先生が部費として経費精算するには領収書が要るのでは」
// との指摘で追加。ただしこのアプリの売上はApple/Google経由のアプリ内課金であり、
// 法律上の「代金を受け取った売主」はApple/Googleであってtrackmate（個人事業主）
// ではないため、正式な「領収書」をtrackmate名義で発行するのは正確性に欠ける。
// そのため名称は「ご利用証明書」とし、画面下部にその旨と、正式な購入証明としては
// App Store/Google Playからの購入完了メールを参照すべき旨を明記している。
// PDF生成等はせず、スクリーンショットして提出する運用を想定したシンプルな画面。
import React, { useState, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../context/LanguageContext'
import { usePurchase } from '../context/PurchaseContext'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { fetchMembers } from '../lib/supabaseTeam'

const BRAND    = '#166534'
const APP_NAME = 'sCORE'
const OPERATOR = '個人事業主（屋号：trackmate）'
const CONTACT  = 'team.deepwork2026@gmail.com'

// app/paywall.tsxのcoachTierForMemberCountと同じ3段階（2026-09-11時点の料金）。
// 表示専用の複製なので、料金体系を変える時はpaywall.tsx側と合わせて更新すること。
function coachTierPrice(count: number | null): string {
  if (count == null) return '¥1,980'
  if (count > 30) return '¥4,980'
  if (count > 15) return '¥2,980'
  return '¥1,980'
}

export default function ReceiptScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { tier, hasTicketMonthly } = usePurchase()
  const [recipient, setRecipient] = useState('')
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

  const planLabel = tier === 'coach'
    ? t('receipt.planLabel.coach')
    : hasTicketMonthly
    ? t('receipt.planLabel.ticketMonthly')
    : tier === 'noad'
    ? t('receipt.planLabel.noad')
    : t('receipt.planLabel.free')

  const price = tier === 'coach' ? coachTierPrice(teamMemberCount)
    : hasTicketMonthly ? '¥980〜'  // 期間限定オファー等で¥680の場合もあるため幅を持たせる
    : tier === 'noad' ? '¥480'
    : '¥0'

  const issueDate = new Date().toLocaleDateString(language === 'ja' ? 'ja-JP' : 'en-US')

  return (
    <View style={{ flex: 1, backgroundColor: '#f4f4f5' }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={22} color="#111827" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{t('receipt.headerTitle')}</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {/* ── 宛名入力（スクリーンショット対象の証明書カードの外に置く操作用UI） ── */}
          <Text style={s.inputLabel}>{t('receipt.recipientLabel')}</Text>
          <TextInput
            value={recipient}
            onChangeText={setRecipient}
            placeholder={t('receipt.recipientPlaceholder')}
            placeholderTextColor="#9ca3af"
            style={s.input}
          />
          <Text style={s.inputHint}>{t('receipt.screenshotHint')}</Text>

          {/* ── ここから証明書本体（スクリーンショット対象） ── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>{t('receipt.certTitle')}</Text>
            <Text style={s.issueDate}>{t('receipt.issueDate', { date: issueDate })}</Text>

            <View style={s.recipientRow}>
              <Text style={s.recipientText}>
                {recipient.trim() ? recipient.trim() : t('receipt.recipientFallback')}
              </Text>
              <Text style={s.recipientSuffix}>{t('receipt.recipientSuffix')}</Text>
            </View>

            <View style={s.divider} />

            <View style={s.row}>
              <Text style={s.rowLabel}>{t('receipt.rowService')}</Text>
              <Text style={s.rowValue}>{APP_NAME}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>{t('receipt.rowPlan')}</Text>
              <Text style={s.rowValue}>{planLabel}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>{t('receipt.rowAmount')}</Text>
              <Text style={[s.rowValue, { fontWeight: '900', fontSize: 17 }]}>{price}{t('receipt.perMonth')}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>{t('receipt.rowMemo')}</Text>
              <Text style={s.rowValue}>{t('receipt.memoValue')}</Text>
            </View>

            <View style={s.divider} />

            <Text style={s.issuerLabel}>{t('receipt.issuerLabel')}</Text>
            <Text style={s.issuerText}>{OPERATOR}</Text>
            <Text style={s.issuerText}>{CONTACT}</Text>
          </View>
          {/* ── 証明書本体ここまで ── */}

          <View style={s.noteBox}>
            <Ionicons name="information-circle-outline" size={16} color="#6b7280" />
            <Text style={s.noteText}>{t('receipt.disclaimer')}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  scroll: { padding: 20, paddingBottom: 48 },
  inputLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 6 },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827',
  },
  inputHint: { fontSize: 11.5, color: '#9ca3af', marginTop: 6, marginBottom: 18, lineHeight: 17 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 22,
    borderWidth: 1, borderColor: '#e5e7eb',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
  },
  cardTitle: { fontSize: 19, fontWeight: '900', color: '#111827', textAlign: 'center' },
  issueDate: { fontSize: 12, color: '#6b7280', textAlign: 'center', marginTop: 4, marginBottom: 18 },
  recipientRow: { flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1.5, borderBottomColor: '#111827', paddingBottom: 6, marginBottom: 18 },
  recipientText: { fontSize: 18, fontWeight: '700', color: '#111827' },
  recipientSuffix: { fontSize: 13, color: '#374151', marginLeft: 6, marginBottom: 1 },
  divider: { height: 1, backgroundColor: '#e5e7eb', marginVertical: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  rowLabel: { fontSize: 12.5, color: '#6b7280' },
  rowValue: { fontSize: 14, color: '#111827', fontWeight: '700' },
  issuerLabel: { fontSize: 11, color: '#9ca3af', marginBottom: 4 },
  issuerText: { fontSize: 12.5, color: '#374151', lineHeight: 19 },
  noteBox: { flexDirection: 'row', gap: 8, backgroundColor: '#f3f4f6', borderRadius: 12, padding: 14, marginTop: 20 },
  noteText: { flex: 1, fontSize: 11.5, color: '#6b7280', lineHeight: 17 },
})

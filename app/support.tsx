// app/support.tsx — サポートページ
import React from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'

const isWeb = Platform.OS === 'web'

export default function SupportScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const faq = t('support.faq', { returnObjects: true }) as { q: string; a: string }[]

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.scroll}>

        {/* ヘッダー */}
        <View style={s.header}>
          <TouchableOpacity
            onPress={() => isWeb ? Linking.openURL('https://scorej-run.vercel.app/coach-landing') : router.back()}
            style={s.back}
            hitSlop={8}
            accessibilityLabel={t('support.backLabel')}
          >
            <Ionicons name="chevron-back" size={22} color="#166534" />
          </TouchableOpacity>
          <Text style={s.logo}>sCORE</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={s.body}>
          <Text style={s.title}>{t('support.title')}</Text>
          <Text style={s.subtitle}>{t('support.subtitle')}</Text>

          {/* お問い合わせ方法 */}
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Ionicons name="mail-outline" size={24} color="#166534" />
              <Text style={s.cardTitle}>{t('support.emailCardTitle')}</Text>
            </View>
            <Text style={s.cardBody}>
              {t('support.emailCardBody')}
            </Text>
            <TouchableOpacity
              style={s.emailBtn}
              onPress={() => Linking.openURL('mailto:team.deepwork2026@gmail.com?subject=sCORE%20サポートについて')}
            >
              <Ionicons name="mail" size={18} color="#fff" />
              <Text style={s.emailBtnText}>team.deepwork2026@gmail.com</Text>
            </TouchableOpacity>
          </View>

          {/* よくある質問 */}
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Ionicons name="help-circle-outline" size={24} color="#166534" />
              <Text style={s.cardTitle}>{t('support.faqTitle')}</Text>
            </View>

            {faq.map((item, i) => (
              <View key={i} style={s.faq}>
                <Text style={s.faqQ}>Q. {item.q}</Text>
                <Text style={s.faqA}>A. {item.a}</Text>
              </View>
            ))}
          </View>

          {/* アプリ情報 */}
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Ionicons name="information-circle-outline" size={24} color="#166534" />
              <Text style={s.cardTitle}>{t('support.appInfoTitle')}</Text>
            </View>
            <Text style={s.infoRow}>{t('support.developerRow')}</Text>
            <Text style={s.infoRow}>{t('support.contactRow')}</Text>
            <Text style={s.infoRow}>{t('support.bundleIdRow')}</Text>
            <View style={s.links}>
              <TouchableOpacity onPress={() => isWeb ? Linking.openURL('https://scorej-run.vercel.app/privacy') : router.push('/privacy' as any)}>
                <Text style={s.link}>{t('support.privacyLink')}</Text>
              </TouchableOpacity>
              <Text style={s.linkSep}>｜</Text>
              <TouchableOpacity onPress={() => isWeb ? Linking.openURL('https://scorej-run.vercel.app/terms') : router.push('/terms' as any)}>
                <Text style={s.link}>{t('support.termsLink')}</Text>
              </TouchableOpacity>
            </View>
          </View>

        </View>

        <Text style={s.copy}>© 2026 sCORE Japan. All rights reserved.</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#f9fafb' },
  scroll:      { paddingBottom: 60 },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  back:        { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  logo:        { fontSize: 18, fontWeight: '900', color: '#166534', letterSpacing: 1 },
  body:        { padding: 20, gap: 16, maxWidth: 720, alignSelf: 'center', width: '100%' },
  title:       { fontSize: 28, fontWeight: '800', color: '#111827', marginTop: 8 },
  subtitle:    { fontSize: 14, color: '#6b7280', marginBottom: 8 },
  card:        { backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  cardHeader:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle:   { fontSize: 17, fontWeight: '700', color: '#111827' },
  cardBody:    { fontSize: 14, color: '#6b7280', lineHeight: 22 },
  emailBtn:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#166534', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, alignSelf: 'flex-start' },
  emailBtnText:{ color: '#fff', fontSize: 14, fontWeight: '700' },
  faq:         { borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 12, gap: 4 },
  faqQ:        { fontSize: 14, fontWeight: '600', color: '#111827' },
  faqA:        { fontSize: 14, color: '#6b7280', lineHeight: 20 },
  infoRow:     { fontSize: 13, color: '#6b7280' },
  links:       { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  link:        { fontSize: 13, color: '#166534', textDecorationLine: 'underline' },
  linkSep:     { fontSize: 13, color: '#9ca3af' },
  copy:        { textAlign: 'center', fontSize: 11, color: '#9ca3af', padding: 20 },
})

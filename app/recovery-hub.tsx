// app/recovery-hub.tsx — リカバリー系ハブ画面（FABの「リカバリー」項目の遷移先）
//
// 2026-09-13: タブバー中央のラジアルFABの中身を見直した際、「AIリカバリー相談」
// (/recovery=怪我の無料AI相談)がホーム画面のどこにも他の入口が無い孤立機能だと判明。
// 一方でスコッピーとの会話機能(/scoppy-chat)も露出が弱かったため、この2つを
// 1つのハブ画面にまとめてワンタップでどちらかへ行けるようにした。
// FAB側の変更はapp/(tabs)/_layout.tsx参照。
import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme, type ThemeColors } from '../context/ThemeContext'

const BRAND = '#166534'

export default function RecoveryHubScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const s = makeStyles(colors)

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('recoveryHub.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={s.body}>
        <TouchableOpacity style={s.card} onPress={() => router.push('/recovery' as any)} activeOpacity={0.85}>
          <View style={s.iconWrap}>
            <Ionicons name="medkit-outline" size={28} color={BRAND} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{t('recoveryHub.aiRecovery')}</Text>
            <Text style={s.cardSub}>{t('recoveryHub.aiRecoverySub')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textHint} />
        </TouchableOpacity>

        <TouchableOpacity style={s.card} onPress={() => router.push('/scoppy-chat' as any)} activeOpacity={0.85}>
          <View style={s.iconWrap}>
            <Ionicons name="chatbubble-ellipses-outline" size={28} color={BRAND} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{t('recoveryHub.scoppyChat')}</Text>
            <Text style={s.cardSub}>{t('recoveryHub.scoppyChatSub')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textHint} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  body: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surface, borderRadius: 18, padding: 18,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  iconWrap: {
    width: 52, height: 52, borderRadius: 16, backgroundColor: BRAND + '14',
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 15.5, fontWeight: '800', color: colors.text, marginBottom: 3 },
  cardSub: { fontSize: 12.5, color: colors.textSec, lineHeight: 17 },
})

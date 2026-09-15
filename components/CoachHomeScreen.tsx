// components/CoachHomeScreen.tsx — コーチ専用ホーム画面
//
// 2026-09-14: 「コーチ選択した人は完全にコーチ専用のUIに変更、怪我リスクとかいらない」
// という指示で新設。app/(tabs)/index.tsx のDashboardScreenは選手向け機能
// （怪我リスクスコア・ストレッチ・体調ログ等）が中心のため、isCoachMode===trueの
// ユーザーには代わりにこの軽量な画面を出す（app/(tabs)/index.tsx側で分岐）。
// チームの詳細管理（メンバー・メニュー配信・連絡）は既存のapp/(tabs)/team.tsxの
// CoachDashboardに委譲し、ここはそこへの入口+よく使う機能へのショートカットに絞る。
import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { BRAND } from '../lib/theme'
import Logo from './Logo'
import PressableScale from './PressableScale'

const SETUP_KEY = 'trackmate_team_setup'

interface TeamSetup { teamName: string; coachName: string; code: string; createdAt: string }

export default function CoachHomeScreen() {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()
  const s = makeStyles(colors)
  const [setup, setSetup] = useState<TeamSetup | null>(null)

  const load = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(SETUP_KEY)
      setSetup(raw ? JSON.parse(raw) : null)
    } catch {
      setSetup(null)
    }
  }, [])

  useEffect(() => { load() }, [load])
  // チーム作成直後にteam.tsxから戻ってきた時も最新化されるよう、フォーカス時にも再読込
  useFocusEffect(useCallback(() => { load() }, [load]))

  const quickActions = [
    { key: 'team',     icon: 'people-outline' as const,     label: t('home.coach.actionTeam'),     sub: t('home.coach.actionTeamSub'),     onPress: () => router.push('/(tabs)/team' as any) },
    { key: 'timer',    icon: 'stopwatch-outline' as const,  label: t('home.coach.actionTimer'),    sub: t('home.coach.actionTimerSub'),    onPress: () => router.push('/timer-hub' as any) },
    { key: 'recovery', icon: 'medkit-outline' as const,     label: t('home.coach.actionRecovery'), sub: t('home.coach.actionRecoverySub'), onPress: () => router.push('/recovery-hub' as any) },
    { key: 'settings', icon: 'settings-outline' as const,   label: t('home.coach.actionSettings'), sub: t('home.coach.actionSettingsSub'), onPress: () => router.push('/settings' as any) },
  ]

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          <View style={s.header}>
            <Logo size={30} />
            <TouchableOpacity onPress={() => router.push('/settings' as any)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="settings-outline" size={22} color={colors.textSec} />
            </TouchableOpacity>
          </View>

          <View style={s.badge}>
            <Ionicons name="shield-checkmark" size={13} color={BRAND} />
            <Text style={s.badgeText}>COACH</Text>
          </View>
          <Text style={s.greeting}>
            {setup?.coachName
              ? t('home.coach.greeting', { name: setup.coachName })
              : t('home.coach.greetingFallback')}
          </Text>
          <Text style={s.subline}>{t('home.coach.subline')}</Text>

          {setup ? (
            <PressableScale onPress={() => router.push('/(tabs)/team' as any)} style={s.teamCard}>
              <View style={s.teamCardRow}>
                <View style={s.teamIconWrap}>
                  <Ionicons name="people" size={24} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.teamCardLabel}>{t('home.coach.teamCardLabel')}</Text>
                  <Text style={s.teamName} numberOfLines={1}>{setup.teamName}</Text>
                  <Text style={s.teamCode}>{t('home.coach.teamCodeLabel')}: {setup.code}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.85)" />
              </View>
            </PressableScale>
          ) : (
            <PressableScale onPress={() => router.push('/(tabs)/team' as any)} style={s.noTeamCard}>
              {/* PressableScaleはstyleを外側Pressableに適用し、子は内側Animated.View
                  (flexDirection未指定=column)に入るため、rowレイアウトは内側Viewで明示する
                  （components/PressableScale.tsx参照・過去に繰り返し踏んだバグ） */}
              <View style={s.noTeamCardRow}>
                <Ionicons name="people-outline" size={28} color={BRAND} />
                <View style={{ flex: 1 }}>
                  <Text style={s.noTeamTitle}>{t('home.coach.noTeamTitle')}</Text>
                  <Text style={s.noTeamSub}>{t('home.coach.noTeamSub')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textHint} />
              </View>
            </PressableScale>
          )}

          <Text style={s.sectionTitle}>{t('home.coach.quickActionsTitle')}</Text>
          <View style={s.actionsGrid}>
            {quickActions.map(a => (
              <PressableScale key={a.key} onPress={a.onPress} style={s.actionCard}>
                <View style={s.actionIconWrap}>
                  <Ionicons name={a.icon} size={22} color={BRAND} />
                </View>
                <Text style={s.actionLabel}>{a.label}</Text>
                <Text style={s.actionSub} numberOfLines={2}>{a.sub}</Text>
              </PressableScale>
            ))}
          </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: BRAND + '14', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 10,
  },
  badgeText: { fontSize: 11, fontWeight: '800', color: BRAND, letterSpacing: 0.5 },
  greeting: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 4 },
  subline: { fontSize: 13.5, color: colors.textSec, marginBottom: 20 },
  teamCard: {
    borderRadius: 18, padding: 18, backgroundColor: BRAND, marginBottom: 24,
    shadowColor: BRAND, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 14, elevation: 4,
  },
  teamCardRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  teamIconWrap: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  teamCardLabel: { fontSize: 11.5, color: 'rgba(255,255,255,0.75)', fontWeight: '700', marginBottom: 2 },
  teamName: { fontSize: 17, fontWeight: '800', color: '#fff', marginBottom: 3 },
  teamCode: { fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
  noTeamCard: {
    backgroundColor: colors.surface, borderRadius: 18, padding: 18, marginBottom: 24,
    borderWidth: 1, borderColor: colors.border,
  },
  noTeamCardRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  noTeamTitle: { fontSize: 14.5, fontWeight: '800', color: colors.text, marginBottom: 2 },
  noTeamSub: { fontSize: 12.5, color: colors.textSec },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textSec, marginBottom: 10, letterSpacing: 0.3 },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  actionCard: {
    width: '47%', backgroundColor: colors.surface, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  actionIconWrap: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: BRAND + '14',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  actionLabel: { fontSize: 13.5, fontWeight: '800', color: colors.text, marginBottom: 3 },
  actionSub: { fontSize: 11, color: colors.textSec, lineHeight: 15 },
})

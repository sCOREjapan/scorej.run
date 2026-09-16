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
import { useLanguage } from '../context/LanguageContext'
import { BRAND } from '../lib/theme'
import { getTeamRosterSummary, type TeamRosterSummary } from '../lib/teamRoster'
import { fetchRecentPbUpdates, type TeamPbEventRow } from '../lib/supabaseTeam'
import { getEventLabel } from '../lib/eventLabels'
import Logo from './Logo'
import PressableScale from './PressableScale'

const SETUP_KEY = 'trackmate_team_setup'
const RISK_RED    = '#E53935'
const PAIN_ORANGE = '#FF9500'
const NEUTRAL_BLUE = '#6366f1'

interface TeamSetup { teamName: string; coachName: string; code: string; createdAt: string }

export default function CoachHomeScreen() {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const { language } = useLanguage()
  const router = useRouter()
  const s = makeStyles(colors)
  const [setup, setSetup] = useState<TeamSetup | null>(null)
  // 2026-09-16(P1/P3): 「今日のチーム状況」サマリーと自己ベスト更新フィード。
  // undefined=未読込、null=データなし(取得失敗含む)、と区別してローディング中の
  // チラつきを防ぐ
  const [summary,    setSummary]    = useState<TeamRosterSummary | undefined>(undefined)
  const [pbUpdates,  setPbUpdates]  = useState<TeamPbEventRow[]>([])
  const [showNotLogged, setShowNotLogged] = useState(false)

  const load = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(SETUP_KEY)
      const parsed: TeamSetup | null = raw ? JSON.parse(raw) : null
      setSetup(parsed)
      if (parsed?.code) {
        const [sum, pbs] = await Promise.all([
          getTeamRosterSummary(parsed.code),
          fetchRecentPbUpdates(parsed.code, 3),
        ])
        setSummary(sum)
        setPbUpdates(pbs)
      } else {
        setSummary(undefined)
        setPbUpdates([])
      }
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

          {/* ── 今日のチーム状況(P1) ──────────────────────────────
              team.tsxのCoachDashboardが既に計算している怪我リスク・未確認の痛みを、
              ホーム画面からも一目で見えるようにする。競合(TrainHeroic等)の
              「チームダッシュボード」に相当するが、sCOREは生データではなく
              件数だけを見せて詳細はタップ先(チームタブ)に委ねる設計にし、
              「監視されている感」を出さないようにしている。 */}
          {setup && summary && summary.totalMembers > 0 && (
            <View style={s.statusCard}>
              <Text style={s.statusCardTitle}>{t('home.coach.statusTitle')}</Text>
              {summary.highRiskCount === 0 && summary.unackedPainCount === 0 && summary.notLoggedCount === 0 ? (
                <View style={s.allClearRow}>
                  <Ionicons name="checkmark-circle" size={18} color={BRAND} />
                  <Text style={s.allClearText}>{t('home.coach.allClear')}</Text>
                </View>
              ) : (
                <View style={s.statusChips}>
                  <PressableScale
                    onPress={() => router.push({ pathname: '/(tabs)/team', params: { filter: 'danger' } } as any)}
                    style={summary.highRiskCount === 0 ? [s.statusChip, s.statusChipMuted] : s.statusChip}
                    disabled={summary.highRiskCount === 0}
                  >
                    <View style={s.statusChipRow}>
                      <Text style={[s.statusChipNum, { color: summary.highRiskCount > 0 ? RISK_RED : colors.textHint }]}>{summary.highRiskCount}</Text>
                      <Text style={s.statusChipLabel}>{t('home.coach.statusHighRisk')}</Text>
                    </View>
                  </PressableScale>
                  <PressableScale
                    onPress={() => router.push({ pathname: '/(tabs)/team', params: { filter: 'pain' } } as any)}
                    style={summary.unackedPainCount === 0 ? [s.statusChip, s.statusChipMuted] : s.statusChip}
                    disabled={summary.unackedPainCount === 0}
                  >
                    <View style={s.statusChipRow}>
                      <Text style={[s.statusChipNum, { color: summary.unackedPainCount > 0 ? PAIN_ORANGE : colors.textHint }]}>{summary.unackedPainCount}</Text>
                      <Text style={s.statusChipLabel}>{t('home.coach.statusPain')}</Text>
                    </View>
                  </PressableScale>
                  <PressableScale
                    onPress={() => setShowNotLogged(v => !v)}
                    style={summary.notLoggedCount === 0 ? [s.statusChip, s.statusChipMuted] : s.statusChip}
                    disabled={summary.notLoggedCount === 0}
                  >
                    <View style={s.statusChipRow}>
                      <Text style={[s.statusChipNum, { color: summary.notLoggedCount > 0 ? NEUTRAL_BLUE : colors.textHint }]}>{summary.notLoggedCount}</Text>
                      <Text style={s.statusChipLabel}>{t('home.coach.statusNotLogged')}</Text>
                    </View>
                  </PressableScale>
                </View>
              )}
              {showNotLogged && summary.notLoggedNames.length > 0 && (
                <View style={s.notLoggedBox}>
                  <Text style={s.notLoggedText}>{summary.notLoggedNames.join('、')}</Text>
                </View>
              )}
            </View>
          )}

          {/* ── 自己ベスト更新フィード(P3) ─────────────────────── */}
          {setup && pbUpdates.length > 0 && (
            <View style={s.pbCard}>
              <View style={s.pbCardHeader}>
                <Ionicons name="trophy" size={16} color="#FF9500" />
                <Text style={s.pbCardTitle}>{t('home.coach.pbFeedTitle')}</Text>
              </View>
              {pbUpdates.map(ev => (
                <View key={ev.id} style={s.pbRow}>
                  <Text style={s.pbRowText}>
                    {t('home.coach.pbFeedLine', {
                      name: ev.player_name,
                      event: getEventLabel(ev.event, language) || ev.event,
                    })}
                  </Text>
                  <View style={s.pbRowTimes}>
                    {!!ev.old_pb && <Text style={s.pbOld}>{ev.old_pb}</Text>}
                    {!!ev.old_pb && <Ionicons name="arrow-forward" size={11} color={colors.textHint} />}
                    <Text style={s.pbNew}>{ev.new_pb}</Text>
                  </View>
                </View>
              ))}
            </View>
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
  statusCard: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  statusCardTitle: { fontSize: 12.5, fontWeight: '800', color: colors.textSec, marginBottom: 12 },
  allClearRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  allClearText: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  statusChips: { flexDirection: 'row', gap: 8 },
  statusChip: {
    flex: 1, backgroundColor: colors.surface2, borderRadius: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  statusChipMuted: { opacity: 0.5 },
  statusChipRow: { alignItems: 'center', gap: 3 },
  statusChipNum: { fontSize: 20, fontWeight: '900' },
  statusChipLabel: { fontSize: 10.5, color: colors.textSec, fontWeight: '700', textAlign: 'center' },
  notLoggedBox: {
    marginTop: 10, backgroundColor: NEUTRAL_BLUE + '0f', borderRadius: 10,
    borderWidth: 1, borderColor: NEUTRAL_BLUE + '30', padding: 10,
  },
  notLoggedText: { fontSize: 12, color: colors.textSec, lineHeight: 18 },
  pbCard: {
    backgroundColor: 'rgba(255,149,0,0.06)', borderRadius: 16, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: 'rgba(255,149,0,0.22)', gap: 10,
  },
  pbCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pbCardTitle: { fontSize: 12.5, fontWeight: '800', color: '#B45309' },
  pbRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pbRowText: { flex: 1, fontSize: 12.5, color: colors.text, fontWeight: '600' },
  pbRowTimes: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pbOld: { fontSize: 11.5, color: colors.textHint, textDecorationLine: 'line-through' },
  pbNew: { fontSize: 13, color: '#FF9500', fontWeight: '900' },
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

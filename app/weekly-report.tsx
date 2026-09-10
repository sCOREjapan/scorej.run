// app/weekly-report.tsx — Day7 週次レポート
// sCORE_課金タイミング設計_Day0-7.md のDay7に対応。直近7日間の記録をテンプレート集計だけで
// 表示する（AIは使わない）。FREEユーザーには最下部にチケット月額プランを案内するが、
// 「無料で続ける」を必ず同じ強さで併記する（押し売りにしない）。
import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { usePurchase } from '../context/PurchaseContext'
import { computeWeeklyTrend, markWeeklyReportShown, buildWeeklyInsightKey, type WeeklyTrend } from '../lib/weeklyReport'
import { trackWeeklyReportViewed, trackPaywallView } from '../lib/analytics'
import { BRAND, ALERT } from '../lib/theme'
import type { TrainingSession, SleepRecord } from '../types'

// app/growth-report.tsx と同じキー・同じ「ローカルAsyncStorageを正とする」読み込み方式
// （Supabase同期済みの useTrainingSessions ではなく、オフライン/ゲストでも動く方を採用）
const SESSIONS_KEY = 'trackmate_sessions'
const SLEEP_KEY = 'trackmate_sleep'
const CONDITION_MAP_KEY = 'trackmate_condition_map'

export default function WeeklyReportScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const s = useMemo(() => makeS(colors), [colors])
  const { tier } = usePurchase()
  const [trend, setTrend] = useState<WeeklyTrend | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const [sRaw, slRaw, cRaw] = await AsyncStorage.multiGet([SESSIONS_KEY, SLEEP_KEY, CONDITION_MAP_KEY])
          .then(pairs => pairs.map(([, v]) => v))
        const sessions: TrainingSession[] = sRaw ? JSON.parse(sRaw) : []
        const sleepRecords: SleepRecord[] = slRaw ? JSON.parse(slRaw) : []
        const conditionMap: Record<string, number> = cRaw ? JSON.parse(cRaw) : {}
        setTrend(computeWeeklyTrend(sessions, sleepRecords, conditionMap))
      } catch {
        setTrend(computeWeeklyTrend([], [], {}))
      }
    })()
  }, [])

  useEffect(() => {
    trackWeeklyReportViewed()
    markWeeklyReportShown()
  }, [])

  const isFree = tier === 'free'
  useEffect(() => {
    if (trend && isFree) trackPaywallView('weekly_report')
  }, [!!trend, isFree])

  if (!trend) {
    return (
      <SafeAreaView style={[s.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: colors.textHint }}>{t('weeklyReport.loading')}</Text>
      </SafeAreaView>
    )
  }

  const insightKey = buildWeeklyInsightKey(trend)
  const delta = trend.riskEnd - trend.riskStart
  const deltaColor = delta > 0 ? ALERT : delta < 0 ? BRAND : colors.textHint

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('weeklyReport.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={s.cardLabel}>{t('weeklyReport.riskTrendLabel')}</Text>
          <View style={s.trendRow}>
            <View style={{ alignItems: 'center' }}>
              <Text style={s.trendNum}>{trend.riskStart}</Text>
              <Text style={s.trendSub}>{t('weeklyReport.sevenDaysAgo')}</Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color={colors.textHint} />
            <View style={{ alignItems: 'center' }}>
              <Text style={s.trendNum}>{trend.riskEnd}</Text>
              <Text style={s.trendSub}>{t('weeklyReport.today')}</Text>
            </View>
            <View style={[s.deltaBadge, { backgroundColor: deltaColor + '18', borderColor: deltaColor + '40' }]}>
              <Text style={[s.deltaText, { color: deltaColor }]}>{delta > 0 ? '+' : ''}{delta}</Text>
            </View>
          </View>
        </View>

        <View style={s.statsRow}>
          <View style={[s.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={s.statNum}>{trend.avgCondition !== null ? trend.avgCondition.toFixed(1) : '—'}</Text>
            <Text style={s.statLabel}>{t('weeklyReport.avgCondition')}</Text>
          </View>
          <View style={[s.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={s.statNum}>{trend.avgSleepHours !== null ? `${trend.avgSleepHours.toFixed(1)}h` : '—'}</Text>
            <Text style={s.statLabel}>{t('weeklyReport.avgSleep')}</Text>
          </View>
          <View style={[s.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={s.statNum}>{trend.sessionCount}</Text>
            <Text style={s.statLabel}>{t('weeklyReport.sessionCount')}</Text>
          </View>
        </View>

        <View style={s.adviceCard}>
          <Text style={s.adviceEyebrow}>{t('weeklyReport.insightEyebrow')}</Text>
          <Text style={s.adviceBody}>{t(insightKey)}</Text>
        </View>

        {isFree && (
          <View style={[s.offerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={s.offerTitle}>{t('weeklyReport.offerTitle')}</Text>
            <Text style={s.offerSub}>{t('weeklyReport.offerSub')}</Text>
            <TouchableOpacity style={s.offerBtn} onPress={() => router.push('/paywall?plan=ticket_monthly')} activeOpacity={0.85}>
              <Text style={s.offerBtnTxt}>{t('weeklyReport.offerCta')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.continueFreeBtn} onPress={() => router.back()}>
              <Text style={s.continueFreeTxt}>{t('weeklyReport.continueFree')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const makeS = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text },

  card: { borderRadius: 20, borderWidth: 1, padding: 18 },
  cardLabel: { fontSize: 12, fontWeight: '700', color: colors.textHint, marginBottom: 10 },
  trendRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  trendNum: { fontSize: 32, fontWeight: '900', color: colors.text, fontVariant: ['tabular-nums'] },
  trendSub: { fontSize: 10.5, color: colors.textHint, marginTop: 2 },
  deltaBadge: { marginLeft: 'auto', borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  deltaText: { fontSize: 15, fontWeight: '800' },

  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, borderRadius: 16, borderWidth: 1, padding: 14, alignItems: 'center', gap: 4 },
  statNum: { fontSize: 20, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 10.5, color: colors.textHint, textAlign: 'center' },

  adviceCard: { backgroundColor: '#14532d', borderRadius: 20, padding: 18 },
  adviceEyebrow: { fontSize: 10.5, fontWeight: '800', color: '#86efac', letterSpacing: 1, marginBottom: 6 },
  adviceBody: { fontSize: 14.5, fontWeight: '700', color: '#fff', lineHeight: 22 },

  offerCard: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 10, alignItems: 'center' },
  offerTitle: { fontSize: 15, fontWeight: '800', color: colors.text, textAlign: 'center' },
  offerSub: { fontSize: 12.5, color: colors.textSec, textAlign: 'center', lineHeight: 18 },
  offerBtn: { backgroundColor: BRAND, borderRadius: 16, paddingVertical: 15, width: '100%', alignItems: 'center', marginTop: 4 },
  offerBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  continueFreeBtn: { paddingVertical: 8 },
  continueFreeTxt: { fontSize: 13, fontWeight: '700', color: colors.textSec, textDecorationLine: 'underline' },
})

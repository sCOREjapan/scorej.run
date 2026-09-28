// components/RacePlanDetail.tsx — 提出済み「レース行動予定」を1枚のデータとして表示する共通ビュー
// app/race-plan.tsx（選手本人の履歴閲覧）と app/(tabs)/team.tsx の MemberDetailSheet
// （コーチ側の閲覧）の両方から使う。

import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { BRAND } from '../lib/theme'
import type { ThemeColors } from '../context/ThemeContext'
import type { TeamRacePlanRow, RacePlanBlock } from '../lib/supabaseTeam'

export function RacePlanBlockRow({ block, colors }: { block: RacePlanBlock; colors: ThemeColors }) {
  return (
    <View style={[styles.blockCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.timeBadge}><Text style={styles.timeBadgeText}>{block.time}</Text></View>
      <Text style={[styles.blockContent, { color: colors.text }]}>{block.content}</Text>
    </View>
  )
}

export function RacePlanDetailContent({ plan, colors }: { plan: TeamRacePlanRow; colors: ThemeColors }) {
  const { t } = useTranslation()
  return (
    <View>
      <Text style={{ color: colors.textHint, fontSize: 12, marginBottom: 20 }}>{plan.race_date}</Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('racePlan.timelineSectionTitle')}</Text>
      <View style={{ gap: 10, marginBottom: 24 }}>
        {plan.blocks.map((b, i) => <RacePlanBlockRow key={i} block={b} colors={colors} />)}
      </View>

      {(!!plan.target_time || !!plan.splits) && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('racePlan.targetSectionTitle')}</Text>
          <View style={{ marginBottom: 24, gap: 4 }}>
            {!!plan.target_time && <Text style={{ color: colors.text, fontSize: 14 }}>{plan.target_time}</Text>}
            {!!plan.splits && <Text style={{ color: colors.textSec, fontSize: 13 }}>{plan.splits}</Text>}
          </View>
        </>
      )}

      {!!plan.goal && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('racePlan.goalSectionTitle')}</Text>
          <Text style={{ color: colors.text, fontSize: 14, lineHeight: 22, marginBottom: 8 }}>{plan.goal}</Text>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 14, fontWeight: '800', marginBottom: 10 },
  blockCard:    { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  timeBadge:    { backgroundColor: BRAND, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  timeBadgeText:{ color: '#fff', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  blockContent: { flex: 1, fontSize: 14, lineHeight: 20 },
})

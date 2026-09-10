// components/FirstRunChecklist.tsx
// 2026-09-07: オンボーディング再設計の一部。到達後800msで自動的に全画面を再説明する
// 旧チュートリアル(useTutorial().startTutorial())を廃止し、代わりにホーム画面に常駐する
// 項目チェックリストを表示する（ヒントは自動で押し付けず、本人が触るタイミングに任せる）。
// 全項目完了、または本人が閉じたら二度と出さない（skipTutorial()と同じ完了フラグを共有）。
//
// 2026-09-07 追記: Codex実装指示により3項目を刷新。
//   1. 今日の状態を確認した … 新オンボーディングStep3で必ず回答済みのため、常にdone扱い
//      （home画面独自の「今日の調子」1〜10スライダー(trackmate_condition_map)とは別概念のため、
//        そちらの記録有無では判定しない＝二重管理を避ける）
//   2. 次の練習を記録する   … 練習記録(training_sessions)が1件以上あるか(hasLoggedPractice)
//   3. 目標または大会を設定する … 目標(trackmate_goals)または大会(trackmate_competitions)が
//      1件以上あるか(hasSetGoalOrCompetition)
//
// 2026-09-09 追記: 4項目目「ストレッチをしてスコアを下げる」を追加。
//   4. ストレッチをしてスコアを下げる … ストレッチを一度でも完了したか(hasStretched)。
//      lib/stretchResultStore.ts の hasEverStretched()（日次リセットされない永続フラグ）で判定。
import React, { useEffect, useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { isTutorialDone, useTutorial } from '../lib/tutorialContext'
import { BRAND } from '../lib/theme'
import { trackOnboardingStep } from '../lib/analytics'

interface Props {
  hasLoggedPractice: boolean
  hasSetGoalOrCompetition: boolean
  hasStretched: boolean
  onNavigatePractice: () => void
  onNavigateGoal: () => void
  onNavigateStretch: () => void
}

export default function FirstRunChecklist({
  hasLoggedPractice, hasSetGoalOrCompetition, hasStretched,
  onNavigatePractice, onNavigateGoal, onNavigateStretch,
}: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const s = useMemo(() => makeS(colors), [colors])
  const { skipTutorial, startTutorial } = useTutorial()

  const [shouldShow, setShouldShow] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const done = await isTutorialDone()
      if (cancelled) return
      setShouldShow(!done)
    })()
    return () => { cancelled = true }
  }, [])

  const items = [
    // 新オンボーディングを通った時点で必ず完了しているため常時done。タップ不要。
    { key: 'condition', label: t('firstRunChecklist.itemCondition'), done: true,                     onPress: () => {} },
    { key: 'practice',  label: t('firstRunChecklist.itemPractice'),  done: hasLoggedPractice,         onPress: onNavigatePractice },
    { key: 'goal',      label: t('firstRunChecklist.itemGoal'),      done: hasSetGoalOrCompetition,   onPress: onNavigateGoal },
    { key: 'stretch',   label: t('firstRunChecklist.itemStretch'),   done: hasStretched,              onPress: onNavigateStretch },
  ]
  const doneCount = items.filter(i => i.done).length

  useEffect(() => {
    // 3つとも完了したら、旧チュートリアルの完了フラグも一緒に立てて二度と出さない
    if (shouldShow && doneCount === items.length) {
      trackOnboardingStep('checklist_completed')
      const timer = setTimeout(() => { skipTutorial(); setShouldShow(false) }, 900)
      return () => clearTimeout(timer)
    }
  }, [doneCount, shouldShow])

  if (!shouldShow) return null

  return (
    <View style={[s.card, { backgroundColor: 'rgba(34,197,94,0.07)', borderColor: 'rgba(34,197,94,0.28)' }]}>
      <View style={s.headerRow}>
        <Text style={[s.title, { color: colors.text }]}>{t('firstRunChecklist.title', { done: doneCount, total: items.length })}</Text>
        <TouchableOpacity onPress={() => { skipTutorial(); setShouldShow(false) }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={16} color={colors.textHint} />
        </TouchableOpacity>
      </View>

      {items.map(item => (
        <TouchableOpacity key={item.key} style={s.row} onPress={item.onPress} activeOpacity={0.7} disabled={item.done}>
          <View style={[s.box, { borderColor: item.done ? BRAND : colors.border }, item.done && { backgroundColor: BRAND }]}>
            {item.done && <Ionicons name="checkmark" size={12} color="#fff" />}
          </View>
          <Text style={[s.rowText, { color: colors.text }, item.done && { color: colors.textHint, textDecorationLine: 'line-through' }]}>
            {item.label}
          </Text>
          {!item.done && <Ionicons name="chevron-forward" size={15} color={colors.textHint} />}
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={s.tourLink} onPress={startTutorial}>
        <Text style={[s.tourLinkText, { color: colors.textHint }]}>{t('firstRunChecklist.guidedTourLink')}</Text>
      </TouchableOpacity>
    </View>
  )
}

const makeS = (colors: ThemeColors) => StyleSheet.create({
  card: {
    borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.06, shadowRadius: 14, elevation: 3,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 14, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.6, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, fontSize: 13, fontWeight: '600' },
  tourLink: { marginTop: 4, alignSelf: 'center', paddingVertical: 6 },
  tourLinkText: { fontSize: 11.5, fontWeight: '600', textDecorationLine: 'underline' },
})

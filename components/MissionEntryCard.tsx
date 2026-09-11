// components/MissionEntryCard.tsx — ホーム画面常駐の3日間ミッション入口カード
// 2026-09-11: components/FirstRunChecklist.tsx を置き換える。タスク自体はここには置かず、
// タップでMissionModal（components/MissionModal.tsx）を開いて詳細を見せる導線だけを持つ。
import React, { useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { BRAND } from '../lib/theme'
import { ensureMissionStarted, getMissionDayProgress, currentMissionDay, getMissionState } from '../lib/missionStore'

export default function MissionEntryCard({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const s = makeS(colors)
  const [visible,   setVisible]   = useState(false)
  const [day,       setDay]       = useState(1)
  const [doneCount, setDoneCount] = useState(0)
  const [total,     setTotal]     = useState(0)

  const load = useCallback(async () => {
    // finished(結果カード〜セールまで見終えた)ならもう出さない
    const already = await getMissionState()
    if (already.finished) { setVisible(false); return }
    const state = await ensureMissionStarted()
    const activeDay = currentMissionDay(state.startDate)
    const progress = await getMissionDayProgress(activeDay, state.startDate, state)
    setDay(activeDay)
    setDoneCount(progress.tasks.filter(x => x.done).length)
    setTotal(progress.tasks.length)
    setVisible(true)
  }, [])

  // 他画面でタスクを完了して戻ってきた時に進捗を更新するため、フォーカスの都度読み直す
  useFocusEffect(useCallback(() => { load() }, [load]))

  if (!visible) return null

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      <View style={s.iconWrap}>
        <Ionicons name="flag" size={20} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.title, { color: colors.text }]}>{t('mission.entry.title', { day })}</Text>
        <Text style={[s.sub, { color: colors.textSec }]}>{t('mission.entry.sub', { done: doneCount, total })}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textHint} />
    </TouchableOpacity>
  )
}

const makeS = (colors: ThemeColors) => StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(22,101,52,0.24)',
    backgroundColor: 'rgba(22,101,52,0.07)', padding: 14, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.06, shadowRadius: 14, elevation: 3,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: 14, backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 14, fontWeight: '800' },
  sub:   { fontSize: 12, fontWeight: '600', marginTop: 2 },
})

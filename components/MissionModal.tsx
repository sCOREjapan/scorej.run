// components/MissionModal.tsx — 3日間アクティベーションミッション（ホーム画面のバッジから開く）
//
// 2026-09-11: components/FirstRunChecklist.tsx（常駐チェックリスト）を置き換える。
// Day1〜Day3のタスクを1日ずつ提示し、日をまたぐたびに再訪する理由を作る。
// Modalの開閉はuseOverlayDismiss経由（本セッションで直したCoachPlanBanner等と
// 同じ理由＝<Modal visible>を親の条件アンマウントで閉じると画面がタップ無反応に
// なるフリーズがあるため、フェードし切ってから実際に閉じる）。
import React, { useEffect, useState, useCallback } from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { useOverlayDismiss } from '../lib/useOverlayDismiss'
import { trackEvent } from '../lib/analytics'
import {
  ensureMissionStarted, getMissionDayProgress, currentMissionDay, claimDayReward,
  finishMission, startSaleWindowIfNeeded, getMissionAchievements,
  type MissionState, type MissionDayProgress, type MissionDay, type MissionTaskStatus,
} from '../lib/missionStore'

const BRAND = '#166534'

interface Props {
  visible: boolean
  onClose: () => void
  onNavigateCondition: () => void
  onNavigateStretch: () => void
}

type Phase = 'loading' | 'tasks' | 'summary'

const TASK_ICON: Record<MissionTaskStatus['key'], keyof typeof Ionicons.glyphMap> = {
  practice: 'barbell-outline',
  condition: 'pulse-outline',
  video: 'videocam-outline',
  competition: 'flag-outline',
  meal: 'restaurant-outline',
  stretch: 'body-outline',
}

export default function MissionModal({ visible, onClose, onNavigateCondition, onNavigateStretch }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const s = makeStyles(colors)
  const { modalProps, close } = useOverlayDismiss(onClose)

  const [phase,        setPhase]        = useState<Phase>('loading')
  const [mission,      setMission]      = useState<MissionState | null>(null)
  const [day,          setDay]          = useState<MissionDay>(1)
  const [progress,     setProgress]     = useState<MissionDayProgress | null>(null)
  const [claiming,     setClaiming]     = useState(false)
  const [achievements, setAchievements] = useState<MissionTaskStatus['key'][]>([])

  const load = useCallback(async () => {
    const state = await ensureMissionStarted()
    const activeDay = currentMissionDay(state.startDate)
    const prog = await getMissionDayProgress(activeDay, state.startDate, state)
    setMission(state)
    setDay(activeDay)
    setProgress(prog)
    setPhase('tasks')
  }, [])

  useEffect(() => {
    if (!visible) return
    setPhase('loading')
    load()
  }, [visible, load])

  const handleClaim = async () => {
    if (!mission || !progress || claiming) return
    setClaiming(true)
    try {
      const { granted, tickets } = await claimDayReward(day as 1 | 2, mission.startDate)
      trackEvent('mission_day_claimed', { feature: 'mission', metadata: { day, granted, tickets } })
      // 再読み込みして受け取り済み状態を反映
      await load()
    } finally {
      setClaiming(false)
    }
  }

  const handleShowSummary = async () => {
    if (!mission) return
    const achieved = await getMissionAchievements(mission.startDate, mission)
    setAchievements(achieved)
    trackEvent('mission_summary_viewed', { feature: 'mission', metadata: { achieved } })
    setPhase('summary')
  }

  const handleContinueToSale = () => {
    close(async () => {
      await startSaleWindowIfNeeded()
      await finishMission()
      trackEvent('mission_sale_shown', { feature: 'mission' })
      router.push('/paywall?plan=ticket_monthly&sale=1' as any)
    })
  }

  const navigateTo = (path: string) => {
    close(() => router.push(path as any))
  }

  const taskLabel = (key: MissionTaskStatus['key']) => t(`mission.task.${key}`)

  const handleTaskPress = (key: MissionTaskStatus['key']) => {
    switch (key) {
      case 'practice':    navigateTo('/manual-log'); break
      case 'condition':   close(onNavigateCondition); break
      case 'video':       navigateTo('/video-analysis'); break
      case 'competition': navigateTo('/(tabs)/competition'); break
      case 'meal':        navigateTo('/(tabs)/nutrition'); break
      case 'stretch':     close(onNavigateStretch); break
    }
  }

  return (
    <Modal transparent animationType="fade" {...modalProps}>
      <View style={s.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => close()} />
        <View style={s.sheet}>
          <View style={s.headerRow}>
            <View style={s.dayBadge}>
              <Text style={s.dayBadgeText}>{t('mission.dayBadge', { day })}</Text>
            </View>
            <TouchableOpacity onPress={() => close()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={colors.textHint} />
            </TouchableOpacity>
          </View>

          {phase === 'loading' && (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ActivityIndicator color={BRAND} />
            </View>
          )}

          {phase === 'tasks' && progress && (
            <>
              <Text style={s.title}>{t(`mission.day${day}.title`)}</Text>
              <Text style={s.sub}>{t(`mission.day${day}.sub`)}</Text>

              {/* 進捗バー */}
              <View style={s.progressTrack}>
                <View style={[s.progressFill, { width: `${(progress.tasks.filter(x => x.done).length / progress.tasks.length) * 100}%` }]} />
              </View>

              <View style={{ marginTop: 16, gap: 10 }}>
                {progress.tasks.map(task => (
                  <TouchableOpacity
                    key={task.key}
                    style={[s.taskRow, task.done && s.taskRowDone]}
                    onPress={() => !task.done && handleTaskPress(task.key)}
                    activeOpacity={task.done ? 1 : 0.7}
                    disabled={task.done}
                  >
                    <View style={[s.taskIconWrap, task.done && { backgroundColor: BRAND }]}>
                      <Ionicons name={task.done ? 'checkmark' : TASK_ICON[task.key]} size={16} color={task.done ? '#fff' : BRAND} />
                    </View>
                    <Text style={[s.taskLabel, { color: colors.text }, task.done && { color: colors.textHint, textDecorationLine: 'line-through' }]}>
                      {taskLabel(task.key)}
                    </Text>
                    {!task.done && <Ionicons name="chevron-forward" size={16} color={colors.textHint} />}
                  </TouchableOpacity>
                ))}
              </View>

              {/* Day1/Day2: 全タスク完了→チケット受け取り */}
              {day !== 3 && progress.allDone && !progress.rewardClaimed && (
                <TouchableOpacity style={s.claimBtn} onPress={handleClaim} disabled={claiming} activeOpacity={0.85}>
                  {claiming
                    ? <ActivityIndicator color="#fff" />
                    : <>
                        <Ionicons name="gift" size={18} color="#fff" />
                        <Text style={s.claimBtnText}>{t('mission.claimButton', { n: progress.rewardTickets })}</Text>
                      </>}
                </TouchableOpacity>
              )}
              {day !== 3 && progress.allDone && progress.rewardClaimed && (
                <View style={s.doneBanner}>
                  <Ionicons name="checkmark-circle" size={16} color={BRAND} />
                  <Text style={s.doneBannerText}>{t('mission.waitForNextDay')}</Text>
                </View>
              )}

              {/* Day3: 全タスク完了→結果を見る */}
              {day === 3 && progress.allDone && (
                <TouchableOpacity style={s.claimBtn} onPress={handleShowSummary} activeOpacity={0.85}>
                  <Ionicons name="sparkles" size={18} color="#fff" />
                  <Text style={s.claimBtnText}>{t('mission.viewSummaryButton')}</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {phase === 'summary' && mission && (
            <MissionSummary
              colors={colors} t={t}
              achievements={achievements}
              onContinue={handleContinueToSale}
            />
          )}
        </View>
      </View>
    </Modal>
  )
}

function MissionSummary({ colors, t, achievements, onContinue }: {
  colors: ThemeColors
  t: (key: string, opts?: any) => string
  achievements: MissionTaskStatus['key'][]
  onContinue: () => void
}) {
  const s = makeStyles(colors)
  return (
    <View style={{ alignItems: 'center', paddingTop: 8 }}>
      <View style={s.summaryIconWrap}>
        <Ionicons name="trophy" size={36} color="#f59e0b" />
      </View>
      <Text style={s.title}>{t('mission.summary.title')}</Text>
      <Text style={[s.sub, { textAlign: 'center' }]}>{t('mission.summary.body')}</Text>

      {achievements.length > 0 && (
        <View style={s.summaryCard}>
          {/* 実際にDay1〜3で達成したタスクだけを表示する（未達成の項目は出さない） */}
          {achievements.map(k => (
            <View key={k} style={s.summaryRow}>
              <Ionicons name="checkmark-circle" size={16} color={BRAND} />
              <Text style={[s.summaryRowText, { color: colors.text }]}>{t(`mission.summary.item.${k}`)}</Text>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity style={s.claimBtn} onPress={onContinue} activeOpacity={0.85}>
        <Ionicons name="arrow-forward-circle" size={18} color="#fff" />
        <Text style={s.claimBtnText}>{t('mission.continueButton')}</Text>
      </TouchableOpacity>
    </View>
  )
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 22, paddingBottom: 36,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  dayBadge: { backgroundColor: BRAND + '18', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  dayBadgeText: { color: BRAND, fontWeight: '800', fontSize: 12 },
  title: { fontSize: 19, fontWeight: '900', color: colors.text, marginTop: 6 },
  sub: { fontSize: 13, color: colors.textSec, marginTop: 4, lineHeight: 19 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surface2, marginTop: 14, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: BRAND },
  taskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12,
    borderRadius: 14, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
  },
  taskRowDone: { opacity: 0.6 },
  taskIconWrap: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: BRAND + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  taskLabel: { flex: 1, fontSize: 14, fontWeight: '700' },
  claimBtn: {
    marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: BRAND, paddingVertical: 15, borderRadius: 28,
  },
  claimBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  doneBanner: {
    marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: BRAND + '12', paddingVertical: 12, borderRadius: 16,
  },
  doneBannerText: { color: BRAND, fontSize: 13, fontWeight: '700' },
  summaryIconWrap: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#fef3c7',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  summaryCard: {
    width: '100%', backgroundColor: colors.surface2, borderRadius: 16, padding: 14, marginTop: 16, gap: 10,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryRowText: { fontSize: 13, fontWeight: '600' },
})

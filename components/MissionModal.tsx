// components/MissionModal.tsx — 3日間アクティベーションミッション（ホーム画面のバッジから開く）
//
// 2026-09-11: components/FirstRunChecklist.tsx（常駐チェックリスト）を置き換える。
// Day1〜Day3のタスクを1日ずつ提示し、日をまたぐたびに再訪する理由を作る。
// ビジュアルはui-previews/2026-09-11-mission-system-3案.html のA案（ポケポケ直系）を
// 採用: グラデーションヘッダー＋白カード＋ゴールドの受け取り演出（バースト光線＋紙吹雪）。
//
// Modalの開閉は usePropOverlayDismiss 経由。
// 2026-09-11: 最初 useOverlayDismiss を使っていたが、あちらは「条件付きマウントで開き、
// 閉じる=アンマウント」なバナー(CoachPlanBanner等)用で内部visibleがtrue始まりのため、
// このモーダルのように親のvisible propで開閉しながら常時マウントされ続けるパターンに使うと
// ホーム画面を開いた瞬間からモーダルが「開きっぱなし・読み込み中のまま」になり、何度
// タップしても反応しない不具合になっていた。常時マウント型は必ずusePropOverlayDismissを使う。
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Animated, Easing } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { useLanguage } from '../context/LanguageContext'
import { usePropOverlayDismiss } from '../lib/useOverlayDismiss'
import { trackEvent } from '../lib/analytics'
import { getMissionSummaryInsight, type MissionSummaryInsight } from '../lib/claude'
import {
  ensureMissionStarted, getMissionDayProgress, currentMissionDay, claimDayReward,
  finishMission, startSaleWindowIfNeeded, getMissionAchievements, getMissionStats,
  type MissionState, type MissionDayProgress, type MissionDay, type MissionTaskStatus, type MissionStats,
} from '../lib/missionStore'

const BRAND = '#166534'
const G1    = '#22c55e'
const GOLD  = '#f59e0b'
const GOLD2 = '#fbbf24'
const TICKET_ICON = require('../assets/icons/ticket.png')
const MASCOT_CELEBRATE = require('../assets/illustrations/mascot/mascot_ticket_celebrate.png')

interface Props {
  visible: boolean
  onClose: () => void
  onNavigateCondition: () => void
  onNavigateStretch: () => void
  // 開発用: 実際の経過日数を無視してDay1/2/3を強制的に表示する（__DEV__ボタンから使用）
  forceDay?: MissionDay | null
}

type Phase = 'loading' | 'tasks' | 'summary'

const TASK_ICON: Record<MissionTaskStatus['key'], keyof typeof Ionicons.glyphMap> = {
  practice: 'barbell-outline',
  condition: 'happy-outline',
  video: 'videocam-outline',
  competition: 'flag-outline',
  meal: 'restaurant-outline',
  stretch: 'body-outline',
}
// A案: タスク種別ごとに色を変える（ui-previews参照。単色だと単調になるため）
const TASK_CHIP_COLOR: Record<MissionTaskStatus['key'], string> = {
  practice: '#3b82f6', condition: '#ec4899', video: '#8b5cf6',
  competition: GOLD, meal: '#f97316', stretch: '#06b6d4',
}

export default function MissionModal({ visible, onClose, onNavigateCondition, onNavigateStretch, forceDay = null }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const s = makeStyles(colors)
  const { modalProps, close } = usePropOverlayDismiss(visible, onClose)

  const [phase,        setPhase]        = useState<Phase>('loading')
  const [mission,      setMission]      = useState<MissionState | null>(null)
  const [day,          setDay]          = useState<MissionDay>(1)
  const [progress,     setProgress]     = useState<MissionDayProgress | null>(null)
  const [claiming,     setClaiming]     = useState(false)
  const [achievements, setAchievements] = useState<MissionTaskStatus['key'][]>([])
  const [rewardTickets, setRewardTickets] = useState(0)
  const [showRewardPopup, setShowRewardPopup] = useState(false)
  const [allDays, setAllDays] = useState<MissionDayProgress[] | null>(null)

  const load = useCallback(async () => {
    const state = await ensureMissionStarted()
    const activeDay = forceDay ?? currentMissionDay(state.startDate)
    const [prog, d1, d2, d3] = await Promise.all([
      getMissionDayProgress(activeDay, state.startDate, state),
      getMissionDayProgress(1, state.startDate, state),
      getMissionDayProgress(2, state.startDate, state),
      getMissionDayProgress(3, state.startDate, state),
    ])
    setMission(state)
    setDay(activeDay)
    setProgress(prog)
    setAllDays([d1, d2, d3])
    setPhase('tasks')
  }, [forceDay])

  useEffect(() => {
    if (!visible) return
    setPhase('loading')
    setShowRewardPopup(false)
    load()
  }, [visible, load])

  const handleClaim = async () => {
    if (!mission || !progress || claiming) return
    setClaiming(true)
    try {
      const { granted, tickets } = await claimDayReward(day as 1 | 2, mission.startDate)
      trackEvent('mission_day_claimed', { feature: 'mission', metadata: { day, granted, tickets } })
      setRewardTickets(tickets)
      setShowRewardPopup(true)
      // 再読み込みして受け取り済み状態を反映（演出の裏側で先に済ませておく）
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

          {phase === 'loading' && (
            <View style={{ paddingVertical: 60, alignItems: 'center' }}>
              <ActivityIndicator color={BRAND} />
            </View>
          )}

          {phase === 'tasks' && progress && (
            <>
              <LinearGradient
                colors={[BRAND, G1, '#86efac']}
                start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1.2 }}
                style={s.header}
              >
                <View style={s.headerTopRow}>
                  <View style={s.dayPill}><Text style={s.dayPillText}>{t('mission.dayBadge', { day })}</Text></View>
                  <TouchableOpacity onPress={() => close()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="close" size={22} color="rgba(255,255,255,0.9)" />
                  </TouchableOpacity>
                </View>
                <Text style={s.title}>{t(`mission.day${day}.title`)}</Text>
                <Text style={s.sub}>{t(`mission.day${day}.sub`)}</Text>
                {mission && allDays && <MissionJourneyBar allDays={allDays} mission={mission} />}
              </LinearGradient>

              <View style={s.body}>
                <View style={{ gap: 10 }}>
                  {progress.tasks.map(task => (
                    <TouchableOpacity
                      key={task.key}
                      style={[s.taskRow, task.done && s.taskRowDone]}
                      onPress={() => !task.done && handleTaskPress(task.key)}
                      activeOpacity={task.done ? 1 : 0.7}
                      disabled={task.done}
                    >
                      <View style={[s.taskIconWrap, { backgroundColor: task.done ? BRAND : TASK_CHIP_COLOR[task.key] + '20' }]}>
                        <Ionicons name={task.done ? 'checkmark' : TASK_ICON[task.key]} size={17} color={task.done ? '#fff' : TASK_CHIP_COLOR[task.key]} />
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
                  <TouchableOpacity onPress={handleClaim} disabled={claiming} activeOpacity={0.85} style={{ marginTop: 18 }}>
                    <LinearGradient colors={[GOLD2, GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.claimBtn}>
                      {claiming
                        ? <ActivityIndicator color="#fff" />
                        : <>
                            <Image source={TICKET_ICON} style={s.claimBtnIcon} resizeMode="contain" />
                            <Text style={s.claimBtnText}>{t('mission.claimButton', { n: progress.rewardTickets })}</Text>
                          </>}
                    </LinearGradient>
                  </TouchableOpacity>
                )}
                {day !== 3 && progress.allDone && progress.rewardClaimed && (
                  <View style={s.doneBanner}>
                    <Ionicons name="checkmark-circle" size={16} color={BRAND} />
                    <Text style={s.doneBannerText}>{t('mission.waitForNextDay')}</Text>
                  </View>
                )}
                {day !== 3 && !progress.allDone && (
                  <Text style={s.hintText}>{t('mission.rewardHint', { n: progress.rewardTickets })}</Text>
                )}

                {/* Day3: 全タスク完了→結果を見る */}
                {day === 3 && progress.allDone && (
                  <TouchableOpacity onPress={handleShowSummary} activeOpacity={0.85} style={{ marginTop: 18 }}>
                    <LinearGradient colors={[GOLD2, GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.claimBtn}>
                      <Ionicons name="sparkles" size={18} color="#fff" />
                      <Text style={s.claimBtnText}>{t('mission.viewSummaryButton')}</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}

          {phase === 'summary' && mission && (
            <MissionSummary
              colors={colors} t={t}
              startDate={mission.startDate}
              achievements={achievements}
              onContinue={handleContinueToSale}
            />
          )}
        </View>
      </View>

      {/* ── 受け取り演出（ゴールドのバースト光線＋紙吹雪＋コインポップ） ── */}
      {showRewardPopup && (
        <RewardPopup
          tickets={rewardTickets}
          day={day}
          t={t}
          onClose={() => setShowRewardPopup(false)}
        />
      )}
    </Modal>
  )
}

// ── 受け取り演出モーダル（A案: コアくんの掲げ演出＋バースト光線＋紙吹雪） ──
// 2026-09-11: 汎用素材(ゴールドリボン+チケットアイコンのみ)だと「AIっぽい」テンプレ感が
// 強いという指摘を受け、生成済みのマスコット(コアくん)がチケットを掲げるイラストを
// メインビジュアルにして、白カードはその下で結果を添えるだけの構成に変更した。
function RewardPopup({ tickets, day, t, onClose }: {
  tickets: number
  day: MissionDay
  t: (key: string, opts?: any) => string
  onClose: () => void
}) {
  const heroScale = useRef(new Animated.Value(0.6)).current
  const heroOpacity = useRef(new Animated.Value(0)).current
  const cardOpacity = useRef(new Animated.Value(0)).current
  const cardTranslate = useRef(new Animated.Value(16)).current
  const burstProgress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.parallel([
      Animated.spring(heroScale, { toValue: 1, friction: 6, tension: 140, useNativeDriver: true }),
      Animated.timing(heroOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(burstProgress, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(200),
        Animated.parallel([
          Animated.timing(cardOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
          Animated.timing(cardTranslate, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
      ]),
    ]).start()
  }, [])

  return (
    <View style={StyleSheet.absoluteFill}>
      <TouchableOpacity style={[StyleSheet.absoluteFill, rs.backdrop]} activeOpacity={1} onPress={onClose} />
      <View style={rs.center} pointerEvents="box-none">
        <ConfettiBurst progress={burstProgress} />
        <Animated.View style={{ transform: [{ scale: heroScale }], opacity: heroOpacity }}>
          <Image source={MASCOT_CELEBRATE} style={rs.heroImage} resizeMode="contain" />
        </Animated.View>
        <Animated.View style={[rs.card, { opacity: cardOpacity, transform: [{ translateY: cardTranslate }] }]}>
          <View style={rs.amountRow}>
            <Image source={TICKET_ICON} style={rs.amountIcon} resizeMode="contain" />
            <Text style={rs.amount}>{t('mission.reward.amount', { n: tickets })}</Text>
          </View>
          <Text style={rs.caption}>{t('mission.reward.caption', { day })}</Text>
          <TouchableOpacity onPress={onClose} activeOpacity={0.85} style={{ width: '100%' }}>
            <LinearGradient colors={[GOLD2, GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={rs.okBtn}>
              <Text style={rs.okBtnText}>OK</Text>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  )
}

// ── 紙吹雪（単一のAnimated.Valueで全パーティクルを駆動。useNativeDriverで軽量に） ──
const CONFETTI_COLORS = [GOLD, G1, BRAND, GOLD2, '#ffffff']
function ConfettiBurst({ progress }: { progress: Animated.Value }) {
  const particles = useRef(
    Array.from({ length: 20 }, () => {
      const angle = Math.random() * Math.PI * 2
      const dist = 70 + Math.random() * 100
      return {
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist - 30,
        rotate: Math.round(Math.random() * 360),
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      }
    })
  ).current

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((p, i) => {
        const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] })
        const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.dy] })
        const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] })
        const opacity = progress.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 1, 0] })
        return (
          <Animated.View
            key={i}
            style={[
              cs.dot,
              {
                backgroundColor: p.color,
                opacity,
                transform: [{ translateX }, { translateY }, { scale }, { rotate: `${p.rotate}deg` }],
              },
            ]}
          />
        )
      })}
    </View>
  )
}
const cs = StyleSheet.create({
  dot: { position: 'absolute', top: '50%', left: '50%', width: 8, height: 8, marginTop: -4, marginLeft: -4, borderRadius: 2 },
})

// ── 3日間ぶんの旅程バー（ポケポケのデイリーミッション画面参照）──
// 2026-09-11: 「今日のタスク」だけの進捗バーだと3日間ミッション全体の見通しが
// 立たないという指摘で、Day1〜3の全タスク数(4+3+2=9)に対する通算進捗に変更。
// 各Dayの区切り位置にマイル ストーン(Day1/2はチケット、Day3はプレゼント)を置き、
// そのDayの報酬を受け取り済み(Day3は全タスク完了)になったら円を白く塗りつぶす。
function MissionJourneyBar({ allDays, mission }: { allDays: MissionDayProgress[]; mission: MissionState }) {
  const counts = allDays.map(d => d.tasks.length)
  const totalTasks = counts.reduce((a, b) => a + b, 0)
  const doneTasks = allDays.reduce((sum, d) => sum + d.tasks.filter(x => x.done).length, 0)
  const fillPct = totalTasks > 0 ? Math.min(100, (doneTasks / totalTasks) * 100) : 0

  let cumulative = 0
  const markers = counts.map((c, i) => {
    cumulative += c
    return { day: (i + 1) as MissionDay, pct: totalTasks > 0 ? (cumulative / totalTasks) * 100 : 0 }
  })
  const achieved = (d: MissionDay) =>
    d === 1 ? mission.claimedDay1 : d === 2 ? mission.claimedDay2 : allDays[2]?.allDone ?? false

  return (
    <View style={jb.wrap}>
      <View style={jb.track}>
        <View style={[jb.fill, { width: `${fillPct}%` }]} />
      </View>
      {markers.map(m => {
        const done = achieved(m.day)
        return (
          <View key={m.day} style={[jb.markerWrap, { left: `${m.pct}%` }]}>
            <View style={[jb.markerCircle, done && jb.markerCircleDone]}>
              {m.day === 3
                ? <Ionicons name="gift" size={12} color={done ? BRAND : '#fff'} />
                : <Image source={TICKET_ICON} style={{ width: 13, height: 13 }} resizeMode="contain" />}
            </View>
          </View>
        )
      })}
    </View>
  )
}
const jb = StyleSheet.create({
  wrap: { marginTop: 18, height: 26, justifyContent: 'center' },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: '#fff' },
  markerWrap: { position: 'absolute', top: 0, marginLeft: -13, width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  markerCircle: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center',
  },
  markerCircleDone: { backgroundColor: GOLD2, borderColor: '#fff' },
})

// 2026-09-11: 「実際に3日間記録したデータから統計を出して、AIに分析させてほしい」との
// 指示で、静的な「やったことチェックリスト」だけだった結果画面に、実データの集計
// (getMissionStats・確定的な数字)とAIの一言コメント(getMissionSummaryInsight)を追加した。
// AI呼び出しが失敗しても(クレジット切れ・タイムアウト等)続けるボタンは止めず、
// 数字とチェックリストだけで結果画面として成立するようにフォールバックする。
function MissionSummary({ colors, t, startDate, achievements, onContinue }: {
  colors: ThemeColors
  t: (key: string, opts?: any) => string
  startDate: string
  achievements: MissionTaskStatus['key'][]
  onContinue: () => void
}) {
  const s = makeStyles(colors)
  const { language } = useLanguage()
  const [stats, setStats] = useState<MissionStats | null>(null)
  const [insight, setInsight] = useState<MissionSummaryInsight | null>(null)
  const [insightLoading, setInsightLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const st = await getMissionStats(startDate).catch(() => null)
      if (cancelled) return
      setStats(st)
      if (!st) { setInsightLoading(false); return }
      try {
        const result = await getMissionSummaryInsight(st, language)
        if (!cancelled) setInsight(result)
      } catch {
        // AI分析が失敗しても数字とチェックリストだけで結果画面として成立させる
      } finally {
        if (!cancelled) setInsightLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [startDate, language])

  const conditionDiff = stats && stats.conditionFirst != null && stats.conditionLast != null
    ? stats.conditionLast - stats.conditionFirst : null

  return (
    <>
      <LinearGradient colors={[BRAND, G1, '#86efac']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1.2 }} style={[s.header, { alignItems: 'center', paddingBottom: 24 }]}>
        <Text style={{ fontSize: 44 }}>🏆</Text>
      </LinearGradient>
      <View style={s.body}>
        <View style={{ alignItems: 'center', marginTop: -36 }}>
          <View style={s.summaryIconRing}>
            <Text style={{ fontSize: 30 }}>🎉</Text>
          </View>
          <Text style={[s.title, { color: colors.text, textAlign: 'center', marginTop: 14 }]}>{t('mission.summary.title')}</Text>
          <Text style={[s.sub, { color: colors.textSec, textAlign: 'center' }]}>{t('mission.summary.body')}</Text>

          {/* AIコメント（読み込み中はスピナー、失敗時は静かに非表示） */}
          {insightLoading ? (
            <View style={s.insightCard}>
              <ActivityIndicator color={BRAND} size="small" />
            </View>
          ) : insight ? (
            <View style={s.insightCard}>
              <View style={s.insightBadge}>
                <Ionicons name="sparkles" size={12} color="#fff" />
                <Text style={s.insightBadgeText}>{t('mission.summary.aiBadge')}</Text>
              </View>
              <Text style={s.insightHeadline}>{insight.headline}</Text>
              <Text style={s.insightComment}>{insight.comment}</Text>
            </View>
          ) : null}

          {/* 実データの統計（確定的にここで計算した数字。AIには解釈しかさせない） */}
          {stats && (
            <View style={s.statsRow}>
              <View style={s.statCard}>
                <Text style={s.statValue}>{stats.totalSessions}</Text>
                <Text style={s.statLabel}>{t('mission.summary.stat.sessions')}</Text>
              </View>
              <View style={s.statCard}>
                <Text style={s.statValue}>
                  {conditionDiff != null ? (conditionDiff >= 0 ? `+${conditionDiff}` : `${conditionDiff}`) : '—'}
                </Text>
                <Text style={s.statLabel}>{t('mission.summary.stat.condition')}</Text>
              </View>
              {stats.videoScore != null ? (
                <View style={s.statCard}>
                  <Text style={s.statValue}>{stats.videoScore}</Text>
                  <Text style={s.statLabel}>{t('mission.summary.stat.videoScore')}</Text>
                </View>
              ) : (
                <View style={s.statCard}>
                  <Text style={s.statValue}>{stats.riskReduction != null ? `-${stats.riskReduction}%` : '—'}</Text>
                  <Text style={s.statLabel}>{t('mission.summary.stat.riskReduction')}</Text>
                </View>
              )}
            </View>
          )}

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

          <TouchableOpacity onPress={onContinue} activeOpacity={0.85} style={{ width: '100%', marginTop: 18 }}>
            <LinearGradient colors={[GOLD2, GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.claimBtn}>
              <Ionicons name="arrow-forward-circle" size={18} color="#fff" />
              <Text style={s.claimBtnText}>{t('mission.continueButton')}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </>
  )
}

const rs = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  heroImage: { width: 220, height: 220, marginBottom: -18, zIndex: 2 },
  card: {
    width: '100%', maxWidth: 320, backgroundColor: '#fffdf7', borderRadius: 28,
    paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24, alignItems: 'center', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.3, shadowRadius: 40, elevation: 20,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  amountIcon: { width: 26, height: 26 },
  amount: { fontSize: 21, fontWeight: '900', color: '#111827' },
  caption: { fontSize: 12.5, color: '#6b7280', marginTop: 4, marginBottom: 18 },
  okBtn: { paddingVertical: 15, borderRadius: 26, alignItems: 'center' },
  okBtnText: { color: '#fff', fontSize: 15, fontWeight: '900' },
})

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    overflow: 'hidden', maxHeight: '86%',
  },
  header: { paddingTop: 18, paddingHorizontal: 22, paddingBottom: 22 },
  headerTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayPill: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  dayPillText: { color: BRAND, fontWeight: '900', fontSize: 13 },
  title: { fontSize: 21, fontWeight: '900', color: '#fff', marginTop: 12 },
  sub: { fontSize: 12.5, color: 'rgba(255,255,255,0.88)', marginTop: 4, lineHeight: 18 },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.35)', marginTop: 16, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: '#fff' },
  body: { padding: 22 },
  taskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13,
    borderRadius: 16, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
  },
  taskRowDone: { opacity: 0.55 },
  taskIconWrap: {
    width: 34, height: 34, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  taskLabel: { flex: 1, fontSize: 14, fontWeight: '700' },
  claimBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, borderRadius: 28,
    shadowColor: GOLD, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 8,
  },
  claimBtnIcon: { width: 20, height: 20 },
  claimBtnText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  doneBanner: {
    marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: BRAND + '12', paddingVertical: 12, borderRadius: 16,
  },
  doneBannerText: { color: BRAND, fontSize: 13, fontWeight: '700' },
  hintText: { marginTop: 16, textAlign: 'center', fontSize: 11.5, color: colors.textHint },
  summaryIconRing: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surface, borderWidth: 4, borderColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 6,
  },
  summaryCard: {
    width: '100%', backgroundColor: colors.surface2, borderRadius: 16, padding: 16, marginTop: 18, gap: 11,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryRowText: { fontSize: 13, fontWeight: '600' },
  insightCard: {
    width: '100%', backgroundColor: BRAND + '0d', borderRadius: 16, borderWidth: 1, borderColor: BRAND + '22',
    padding: 14, marginTop: 18, alignItems: 'center',
  },
  insightBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BRAND, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 8,
  },
  insightBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  insightHeadline: { fontSize: 14, fontWeight: '800', color: colors.text, alignSelf: 'flex-start' },
  insightComment: { fontSize: 12.5, color: colors.textSec, lineHeight: 19, marginTop: 6, alignSelf: 'flex-start' },
  statsRow: { flexDirection: 'row', width: '100%', gap: 10, marginTop: 14 },
  statCard: {
    flex: 1, backgroundColor: colors.surface2, borderRadius: 14, paddingVertical: 12, alignItems: 'center',
  },
  statValue: { fontSize: 19, fontWeight: '900', color: BRAND },
  statLabel: { fontSize: 10.5, color: colors.textHint, fontWeight: '600', marginTop: 2, textAlign: 'center' },
})

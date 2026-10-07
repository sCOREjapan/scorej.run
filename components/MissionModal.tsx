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
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Animated, Easing, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { useLanguage } from '../context/LanguageContext'
import { usePropOverlayDismiss } from '../lib/useOverlayDismiss'
import { trackEvent } from '../lib/analytics'
import { getMissionSummaryInsight, type MissionSummaryInsight } from '../lib/claude'
import TypewriterText from './TypewriterText'
import { hasAiConsent } from '../lib/aiConsent'
import {
  ensureMissionStarted, getMissionDayProgress, currentMissionDay, claimDayReward,
  finishMission, startSaleWindowIfNeeded, getMissionStats,
  type MissionState, type MissionDayProgress, type MissionDay, type MissionTaskStatus, type MissionStats,
} from '../lib/missionStore'

const BRAND = '#166534'
const G1    = '#22c55e'
const GOLD  = '#f59e0b'
const GOLD2 = '#fbbf24'
const TICKET_ICON = require('../assets/icons/ticket.png')
const MASCOT_CELEBRATE = require('../assets/illustrations/mascot/mascot_ticket_celebrate.png')
const MASCOT_READY = require('../assets/illustrations/mascot/mascot_onboarding_ready.png')

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
  const [rewardTickets, setRewardTickets] = useState(0)
  const [showRewardPopup, setShowRewardPopup] = useState(false)
  const [allDays, setAllDays] = useState<MissionDayProgress[] | null>(null)
  // 2026-09-13: tasks→summary切り替え時の透け防止用の白幕(下のhandleShowSummary/
  // return部のコメント参照)。
  const transitionCover = useRef(new Animated.Value(0)).current

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
      // 2026-09-13バグ修正: 「チケット受け取りボタンが何回でも押せる」との報告。
      // claimDayReward自体はサーバー側(ticket_wallet_grant_once)で二重付与防止済みだが、
      // ここでgrantedの結果を見ずに毎回setShowRewardPopup(true)していたため、既に受け取り
      // 済み(granted=false)でも毎回「チケット獲得」演出が出て、実際は貰えていないのに
      // 何度でも貰えているように見えていた。granted=falseの時は演出を出さずload()だけ行う
      // (load()がprogress.rewardClaimed=trueを反映してボタン自体も消えるはずだが、
      // 万一のズレに備えて演出表示側もgrantedで確実にガードする)。
      if (granted) {
        setRewardTickets(tickets)
        setShowRewardPopup(true)
      }
      // 再読み込みして受け取り済み状態を反映（演出の裏側で先に済ませておく）
      await load()
    } finally {
      setClaiming(false)
    }
  }

  const handleShowSummary = () => {
    trackEvent('mission_summary_viewed', { feature: 'mission' })
    // 2026-09-13再修正: 前回(5807eec)の対策(MissionReveal側のmountFade)は逆効果だった。
    // MissionRevealのルート自体をopacity 0から開始させたため、フェードインの最初の数フレーム
    // は「白背景ごと透明」になり、transparentなModalの向こう側(ホーム画面)が一瞬透けて
    // 見えるという、元の「急に切り替わる」より悪い見え方になっていた(ユーザー報告で発覚)。
    // 正しい直し方: tasks→summaryはこの<Modal>が同じインスタンスのまま中身だけ差し替わる
    // ため、切り替わる瞬間を常駐の白幕(transitionCover)で先に覆ってから中身を切り替える。
    // 白幕は常にModal内の最前面にいる(下のreturn参照)ので、透ける余地がない。
    Animated.timing(transitionCover, {
      toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start(() => {
      setPhase('summary')
      transitionCover.setValue(0) // 新画面も自前の白幕(whiteFade)で覆われた状態なので瞬時に戻して良い
    })
  }

  const handleContinueToSale = () => {
    close(async () => {
      await startSaleWindowIfNeeded()
      await finishMission()
      trackEvent('mission_sale_shown', { feature: 'mission' })
      // 2026-09-11: 「オファー画面を作り直したい」との指示で、汎用paywallに?sale=1を
      // 足すだけの旧導線から、ミッション達成専用のapp/mission-offer.tsxに差し替えた
      router.push('/mission-offer' as any)
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

  // 2026-09-11: 「全面的に変更してほしい」との指示で、結果画面はボトムシート内ではなく
  // 白フェードで画面全体を覆う独立のフルスクリーン演出(MissionReveal)にした。
  // 2026-09-13: 以前はこのsummaryフェーズだけ別の<Modal>で早期returnしていたが、
  // どのフェーズでも<Modal>自体は同じインスタンスのまま(visibleがtrueの間ずっとマウント
  // されている)なので、別々に書いても得はなく、むしろ下のtransitionCover(常駐の白幕)を
  // 「Modal内の最前面に必ずいる」ようにするために1つの<Modal>にまとめた。
  return (
    <Modal transparent animationType="fade" {...modalProps}>
      {phase === 'summary' && mission ? (
        <MissionReveal
          startDate={mission.startDate}
          onContinue={handleContinueToSale}
        />
      ) : (
      <View style={s.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => close()} />
        <View style={s.sheetShadow}>
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

              {/* 2026-09-11: 固定maxHeight('86%')のsheetに対してbodyがただのViewだと、
                  タスク数が多い日(Day1は4件)や大きい文字サイズ設定の端末（特にAndroidは
                  システムフォントサイズ変更を使うユーザーが多い）でコンテンツが
                  overflow:'hidden'に切られ、下側のタスク行がタップできなくなる恐れが
                  あったためScrollViewに変更。 */}
              <ScrollView style={s.bodyScroll} contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
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

                {/* Day1/Day2: 報酬対象タスク完了→チケット受け取り
                    2026-09-11: 動画分析(Day1)・食事分析(Day2)はチケットが無いとできないのに、
                    報酬(チケット)自体がそのタスク込みの全タスク完了が条件、という鶏卵状態だった
                    のを修正。rewardEligibleは練習・体調の2つだけで満たされる（lib/missionStore.ts
                    参照）ので、そこで先にチケットを受け取ってからチケット消費タスクに進める。 */}
                {day !== 3 && progress.rewardEligible && !progress.rewardClaimed && (
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
                {/* 受け取り済みだが、まだ残タスクがある（Day1の動画分析・大会登録やDay2の
                    食事分析が未了）場合は「次の日を待とう」ではなく「残りにも挑戦しよう」を出す */}
                {day !== 3 && progress.rewardClaimed && progress.allDone && (
                  <View style={s.doneBanner}>
                    <Ionicons name="checkmark-circle" size={16} color={BRAND} />
                    <Text style={s.doneBannerText}>{t('mission.waitForNextDay')}</Text>
                  </View>
                )}
                {day !== 3 && progress.rewardClaimed && !progress.allDone && (
                  <View style={s.doneBanner}>
                    <Ionicons name="checkmark-circle" size={16} color={BRAND} />
                    <Text style={s.doneBannerText}>{t('mission.bonusTasksHint')}</Text>
                  </View>
                )}
                {day !== 3 && !progress.rewardEligible && (
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
              </ScrollView>
            </>
          )}

        </View>
        </View>
      </View>
      )}

      {/* ── 受け取り演出（ゴールドのバースト光線＋紙吹雪＋コインポップ） ── */}
      {showRewardPopup && (
        <RewardPopup
          tickets={rewardTickets}
          day={day}
          t={t}
          onClose={() => setShowRewardPopup(false)}
        />
      )}

      {/* 2026-09-13: tasks→summary切り替え時の透け防止用の白幕。常にModal内の最前面(最後の
          子要素)に置くことで、handleShowSummaryがこれを不透明にしてから中身を差し替えても
          必ずその上に乗り、向こう側が透けることはない。ふだんはopacity 0で操作を邪魔しない
          よう pointerEvents="none"。 */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: transitionCover }]} />
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
  const achieved = (d: MissionDay) =>
    d === 1 ? mission.claimedDay1 : d === 2 ? mission.claimedDay2 : allDays[2]?.allDone ?? false

  // 2026-09-11: 「間隔を均等にする」「達成した分だけ線に色がつくように」との指示で、
  // タスク数の重みづけ(4:3:2)をやめてDay1/2/3を等間隔(33/66/100%)に配置し直した。
  // 塗り分けは区間ごと(=そのDayを達成したら区間が満タンになる)で、達成前の日は
  // 「今日のタスクのうち何個終えたか」の分だけ区間内で滑らかに伸びる
  // （進行中でも見た目に動きがあるようにしつつ、達成の瞬間に区間が確定する）。
  const SEGMENT = 100 / 3
  const dayDoneFrac = (i: number) => {
    const d = allDays[i]
    if (!d || d.tasks.length === 0) return 0
    return d.tasks.filter(x => x.done).length / d.tasks.length
  }
  const fillPct = ([1, 2, 3] as MissionDay[]).reduce((sum, day, i) => {
    return sum + SEGMENT * (achieved(day) ? 1 : dayDoneFrac(i))
  }, 0)

  return (
    <View style={jb.wrap}>
      <View style={jb.track}>
        <View style={[jb.fill, { width: `${Math.min(100, fillPct)}%` }]} />
      </View>
      {([1, 2, 3] as MissionDay[]).map((day, i) => {
        const done = achieved(day)
        const pct = SEGMENT * (i + 1)
        return (
          <View key={day} style={[jb.markerWrap, { left: `${pct}%` }]}>
            <View style={[jb.markerCircle, done && jb.markerCircleDone]}>
              {day === 3
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
// ── Day3結果の演出画面（フルスクリーン。ui-previews系のmitame運用は経ていないが、
//    ユーザーの言語化「白フェードアウト→イン、キャラ+タイピングで文章、その後
//    オファーボタン」をそのまま実装） ──
// 2026-09-11: 「全面的に変更してほしい」との指示で、ボトムシート内の統計カード+
// チェックリストという構成をやめ、画面全体を使った1枚の演出に作り直した。
// 「白へのフェードアウト」はモーダル切り替えの瞬間に既に白一色(whiteFade=1)で
// 覆っているため改めてフェードさせる必要がなく、データが揃ってから白を
// フェードアウトさせて中身を見せる（＝実質的に指示の「フェードアウト→イン」を
// 1本のアニメーションで実現している）。
function MissionReveal({ startDate, onContinue }: {
  startDate: string
  onContinue: () => void
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [stats, setStats] = useState<MissionStats | null>(null)
  const [insight, setInsight] = useState<MissionSummaryInsight | null>(null)
  const [ready, setReady] = useState(false)
  const [showCta, setShowCta] = useState(false)
  const whiteFade = useRef(new Animated.Value(1)).current
  const ctaFade = useRef(new Animated.Value(0)).current
  // 2026-09-12に「切り替えが急すぎる」対策としてここにmountFade(このルート自体を
  // opacity 0から280msでフェードイン)を追加したが、2026-09-13に撤回した。ルート自体を
  // 透明から始めると、フェードインの最初の数フレームは背景色ごと透明になり、transparentな
  // <Modal>の向こう側(ホーム画面)が一瞬透けて見える方が目立ってしまっていた。
  // 正しい対策は呼び出し側(MissionModal本体)のtransitionCoverで先に覆ってから
  // このコンポーネントに切り替えること。ここはルートを常に不透明のままにし、
  // 下のwhiteFade(データ取得完了まで白一色で覆う)だけで十分。

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const st = await getMissionStats(startDate).catch(() => null)
      let ins: MissionSummaryInsight | null = null
      // 同意前(AI機能をまだ使っていない)の人には、勝手にAIへデータを送らず用意済みの文言を出す(lib/aiConsent.ts)
      if (st && await hasAiConsent()) {
        // 2026-10-07: AIの応答を無制限に待っていたため、混雑時は白一色の画面のまま最大50秒以上
        // 次へ進めなかった。6秒待っても返らなければ、用意済みのフォールバック文言で先へ進む。
        try {
          ins = await Promise.race([
            getMissionSummaryInsight(st, language),
            new Promise<null>(resolve => setTimeout(() => resolve(null), 6000)),
          ])
        } catch { /* フォールバック文言を使う */ }
      }
      if (cancelled) return
      setStats(st)
      setInsight(ins)
      setReady(true)
      Animated.timing(whiteFade, {
        toValue: 0, duration: 550, delay: 150, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start()
    })()
    return () => { cancelled = true }
  }, [startDate, language])

  // AIが失敗しても画面が空にならないよう、フォールバックの文章を用意しておく
  const message = insight?.comment || t('mission.summary.fallbackMessage')

  useEffect(() => {
    if (!ready) return
    const typingMs = 300 + Array.from(message).length * 28
    const timer = setTimeout(() => {
      setShowCta(true)
      Animated.timing(ctaFade, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    }, typingMs)
    return () => clearTimeout(timer)
  }, [ready, message])

  const conditionDiff = stats && stats.conditionFirst != null && stats.conditionLast != null
    ? stats.conditionLast - stats.conditionFirst : null

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={rv.wrap}>
          <Image source={MASCOT_READY} style={rv.mascot} resizeMode="contain" />
          <Text style={rv.title}>{t('mission.summary.title')}</Text>

          {ready && (
            <TypewriterText text={message} speed={26} delay={100} style={rv.message} />
          )}

          {/* 2026-09-11: 「数字だけ表示されても何もわからない、総合データ的な見え方が
              ほしい」との指摘で、3つの孤立した数字カードをやめ、1枚の「レポートカード」に
              まとめた。各行も裸の数値ではなく「練習ログを2回記録できました」のような
              一文にし、数値部分だけ太字色付けで強調する（文脈がある状態で数字が目に入る）。 */}
          {showCta && stats && (
            <Animated.View style={[rv.reportCard, { opacity: ctaFade }]}>
              <View style={rv.reportHeader}>
                <Ionicons name="ribbon" size={14} color={GOLD} />
                <Text style={rv.reportHeaderText}>{t('mission.summary.reportTitle')}</Text>
              </View>
              <StatLine
                icon="barbell-outline"
                color={BRAND}
                template={t('mission.summary.stat.sessionsLine')}
                value={`${stats.totalSessions}`}
              />
              <StatLine
                icon="heart-outline"
                color={conditionDiff != null && conditionDiff < 0 ? '#f59e0b' : '#22c55e'}
                template={
                  conditionDiff == null ? t('mission.summary.stat.conditionNoneLine')
                  : conditionDiff > 0 ? t('mission.summary.stat.conditionUpLine')
                  : conditionDiff < 0 ? t('mission.summary.stat.conditionDownLine')
                  : t('mission.summary.stat.conditionFlatLine')
                }
                value={conditionDiff != null ? `${conditionDiff > 0 ? '+' : ''}${conditionDiff}` : ''}
              />
              {stats.videoScore != null ? (
                <StatLine
                  icon="videocam-outline"
                  color="#4A9FFF"
                  template={t('mission.summary.stat.videoScoreLine')}
                  value={`${stats.videoScore}`}
                />
              ) : (
                <StatLine
                  icon="shield-checkmark-outline"
                  color={BRAND}
                  template={stats.riskReduction != null ? t('mission.summary.stat.riskReductionLine') : t('mission.summary.stat.riskReductionNoneLine')}
                  value={stats.riskReduction != null ? `${stats.riskReduction}` : ''}
                />
              )}
            </Animated.View>
          )}
        </View>

        {showCta && (
          <Animated.View style={[rv.ctaWrap, { opacity: ctaFade }]}>
            <TouchableOpacity onPress={onContinue} activeOpacity={0.85}>
              <LinearGradient colors={[GOLD2, GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={rv.ctaBtn}>
                <Ionicons name="gift" size={18} color="#fff" />
                <Text style={rv.ctaBtnText}>{t('mission.summary.viewOfferButton')}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        )}
      </SafeAreaView>

      {/* データ取得中は白一色で覆っておき、揃ったらフェードアウトして見せる */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: whiteFade }]} />
    </View>
  )
}
// 数字を「裸の値」ではなく1文の中の強調語として見せるための行コンポーネント。
// template内の "{v}" を境に前後を分割し、value部分だけ太字・色付けで挟む。
// value===''(条件が取れなかった等)のときは自然にvalue部分だけ省く。
function StatLine({ icon, color, template, value }: {
  icon: keyof typeof Ionicons.glyphMap
  color: string
  template: string
  value: string
}) {
  const [before, after] = template.split('{v}')
  return (
    <View style={rv.reportRow}>
      <View style={[rv.reportIconChip, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={15} color={color} />
      </View>
      <Text style={rv.reportRowText}>
        {before}
        {value ? <Text style={[rv.reportRowValue, { color }]}>{value}</Text> : null}
        {after}
      </Text>
    </View>
  )
}

const rv = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  mascot: { width: 132, height: 132, marginBottom: 14 },
  title: { fontSize: 20, fontWeight: '900', color: BRAND, textAlign: 'center', marginBottom: 16 },
  message: { fontSize: 15.5, lineHeight: 25, color: '#374151', textAlign: 'center' },
  reportCard: { marginTop: 26, width: '100%', backgroundColor: '#f6f6f8', borderRadius: 18, padding: 16, gap: 12 },
  reportHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  reportHeaderText: { fontSize: 11.5, fontWeight: '800', color: '#9ca3af', letterSpacing: 0.3 },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reportIconChip: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  reportRowText: { flex: 1, fontSize: 13.5, lineHeight: 19, color: '#374151', fontWeight: '600' },
  reportRowValue: { fontWeight: '900', fontSize: 14.5 },
  ctaWrap: { paddingHorizontal: 24, paddingBottom: 16 },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, borderRadius: 28,
    shadowColor: GOLD, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 8,
  },
  ctaBtnText: { color: '#fff', fontSize: 15, fontWeight: '900' },
})

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
  // 2026-09-11: 「ポケポケみたいな、画面より一回り小さいカードタイプにして」との指示で、
  // 画面下端に張り付く全幅ボトムシート(角丸は上だけ・影なし)から、四辺に余白のある
  // 中央フロートカード(角丸は四隅・影つき)に変更(ui-previews/2026-09-11-mission-modal-
  // カード型.html のA案)。overlayをjustifyContent:'center'にし、paddingHorizontalで
  // 左右の余白を作る。上下の余白はsheetShadowのmaxHeight('78%')が残りを空ける。
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 20 },
  // shadowとoverflow:'hidden'は同じViewに同居できない(iOSでshadowごと角丸に
  // クリップされてしまう)ため、影担当の外側Viewと、クリップ担当の内側Viewを分けている。
  sheetShadow: {
    borderRadius: 28, maxHeight: '78%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.35, shadowRadius: 30, elevation: 20,
  },
  sheet: {
    backgroundColor: colors.surface, borderRadius: 28,
    overflow: 'hidden', flexShrink: 1,
  },
  // 2026-09-11: 最初flex:1にしていたが、sheetがmaxHeightのみ(明示的heightなし)で
  // 中身に応じて自動サイズされるコンテナのため、flex:1(flex-basis:0%)だと「伸びる先の
  // 余白」が定まらずbodyScrollの高さが潰れ、タスク一覧が丸ごと表示されない実機バグに
  // なった。flexShrink:1（flex-basis:autoのまま）にすると、中身が短い時はそのままの
  // 高さで表示され、maxHeightを超える時だけ収縮してスクロール可能になる。
  bodyScroll: { flexShrink: 1 },
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
})

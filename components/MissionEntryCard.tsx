// components/MissionEntryCard.tsx — ホーム画面右下に常駐する3日間ミッションの丸バッジ
// 2026-09-11: components/FirstRunChecklist.tsx を置き換える。タスク自体はここには置かず、
// タップでMissionModal（components/MissionModal.tsx）を開いて詳細を見せる導線だけを持つ。
// 2026-09-11追記: 当初はスクロール内の横長カードだったが、「ポケポケみたいに右下に丸で」
// という指示でフローティングの丸バッジに変更。ホーム画面のSafeAreaView内・ScrollViewの
// 外側（きょうだい要素）に置くことで、スクロールしても常に同じ位置に浮いたままになる。
// 2026-09-11追記2: 「オンボーディングの水滴が落ちた時みたいに強調し続けて」との指示で、
// app/onboarding.tsx の RiskMeterCTA と同じ波紋(RippleRing)を移植。今日のタスクが
// 残っている間だけ波紋を出し、全部終わったらグレーにして波紋も止める
// （「やることがある」を視覚的に伝える演出なので、やることが無い時に出し続けると逆に嘘になる）。
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { BRAND } from '../lib/theme'
import { ensureMissionStarted, getMissionDayProgress, currentMissionDay, getMissionState } from '../lib/missionStore'

const G1 = '#22c55e'
const GRAY_1 = '#9ca3af'
const GRAY_2 = '#6b7280'
const GOLD  = '#f59e0b'
const GOLD2 = '#fbbf24'
const RING_SIZE = 80
const CIRCLE_SIZE = 60

// 2026-09-11: 「ポケポケのUIを参考に、ホーム画面をより良くできる箇所があれば」との指示で追加。
// ポケポケのショップ/パックアイコンにある「光がバッジの上を定期的に滑る」ツヤ演出を移植。
// レイアウト・配置は一切変えず、既存の丸バッジの上に重ねるだけの装飾アニメーションなので、
// mitameの3案プレビューは通さず直接実装した（動きの解釈が割れる余地がない単純な光沢表現のため）。
// やることが残っている間だけ動かす（波紋と同じ理由＝「まだ何かある」を伝える演出なので、
// 空の時に動かし続けると逆に紛らわしい）。
function ShineSweep({ active, size }: { active: boolean; size: number }) {
  const x = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!active) { x.stopAnimation(); x.setValue(0); return }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(2200),
        Animated.timing(x, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [active])
  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-size * 0.9, size * 0.9] })
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', top: -size * 0.3, bottom: -size * 0.3, width: size * 0.4,
      transform: [{ translateX }, { rotate: '25deg' }],
    }}>
      <LinearGradient
        colors={['transparent', 'rgba(255,255,255,0.65)', 'transparent']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  )
}

// app/onboarding.tsx の RiskMeterCTA と同一実装（波紋が3本、600msずつずれて広がり続ける）
function RippleRing({ active, delay, size, color }: { active: boolean; delay: number; size: number; color: string }) {
  const t = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!active) { t.stopAnimation(); t.setValue(0); return }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(t, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [active])
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] })
  const opacity = t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.45, 0] })
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', width: size, height: size, borderRadius: size / 2,
      borderWidth: 1.5, borderColor: color, opacity, transform: [{ scale }],
    }} />
  )
}

export default function MissionEntryCard({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const s = makeS(colors)
  const [visible,   setVisible]   = useState(false)
  const [day,       setDay]       = useState(1)
  const [doneCount, setDoneCount] = useState(0)
  const [total,     setTotal]     = useState(0)
  // 2026-09-12: 「ミッション自体は消えても、24時間セールだけは消えないように」との
  // 指示で追加。finished後もsaleExpiresAtが有効な間はバッジを残し、タップ先を
  // ミッションモーダルではなく/mission-offerへ直接切り替える(セール中は見せる
  // タスクが無いため)。saleExpiresAtはAsyncStorage(missionStore.ts)に保存済みの
  // 実タイムスタンプなので、アプリを閉じて再度開いても消えない。
  const [saleMode,  setSaleMode]  = useState(false)

  const load = useCallback(async () => {
    // finished(結果カード〜セールまで見終えた)場合、24時間セール期限がまだ
    // 残っていればセール専用バッジとして出し続け、切れていたら完全に消す
    const already = await getMissionState()
    if (already.finished) {
      const stillOnSale = !!already.saleExpiresAt && new Date(already.saleExpiresAt).getTime() > Date.now()
      setSaleMode(stillOnSale)
      setVisible(stillOnSale)
      return
    }
    setSaleMode(false)
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
  const remaining = total - doneCount
  const hasRemaining = saleMode ? true : remaining > 0

  return (
    <TouchableOpacity
      style={s.wrap}
      onPress={saleMode ? () => router.push('/mission-offer' as any) : onPress}
      activeOpacity={0.85}
      accessibilityLabel={saleMode ? t('mission.entry.saleTitle') : t('mission.entry.title', { day })}
    >
      <RippleRing active={hasRemaining} delay={0}    size={RING_SIZE} color={saleMode ? GOLD : BRAND} />
      <RippleRing active={hasRemaining} delay={600}  size={RING_SIZE} color={saleMode ? GOLD : BRAND} />
      <RippleRing active={hasRemaining} delay={1200} size={RING_SIZE} color={saleMode ? GOLD : BRAND} />
      <View>
        <View style={s.circleShadow}>
          <LinearGradient
            colors={saleMode ? [GOLD2, GOLD] : hasRemaining ? [G1, BRAND] : [GRAY_1, GRAY_2]}
            start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
            style={s.circle}
          >
            <Ionicons name={saleMode ? 'pricetag' : 'flag'} size={24} color="#fff" />
            <Text style={s.dayText}>{saleMode ? t('mission.entry.saleBadge') : t('mission.dayBadge', { day })}</Text>
            <ShineSweep active={hasRemaining} size={CIRCLE_SIZE} />
          </LinearGradient>
        </View>
        {!saleMode && hasRemaining && (
          <View style={s.badgeDot}><Text style={s.badgeDotText}>{remaining}</Text></View>
        )}
      </View>
    </TouchableOpacity>
  )
}

const makeS = (colors: ThemeColors) => StyleSheet.create({
  wrap: {
    position: 'absolute', right: 8, bottom: 12, zIndex: 30,
    width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center',
  },
  // 影(shadow/elevation)とツヤ演出のクリップ(overflow:hidden)は同じViewに同居できない
  // (Androidのelevationがoverflow:hiddenと衝突して欠ける)ため、影は外側、クリップは
  // 内側のグラデーション本体側に分けている。
  circleShadow: {
    width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: CIRCLE_SIZE / 2,
    shadowColor: BRAND, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 10,
  },
  circle: {
    width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: CIRCLE_SIZE / 2,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    borderWidth: 3, borderColor: colors.bg,
  },
  dayText: { color: '#fff', fontSize: 8.5, fontWeight: '900', marginTop: 1, letterSpacing: 0.3 },
  badgeDot: {
    position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: '#ef4444', borderWidth: 2, borderColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeDotText: { color: '#fff', fontSize: 10.5, fontWeight: '900' },
})

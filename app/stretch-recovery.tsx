// app/stretch-recovery.tsx — ストレッチリカバリー機能
// フロー: 部位選択 → ストレッチ実施 → 完了

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Animated, Easing,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Svg, { Circle } from 'react-native-svg'
import * as Haptics from 'expo-haptics'

const STRETCH_RESULT_KEY   = 'trackmate_stretch_result'
const MAX_DAILY_REDUCTION  = 20

// ── 部位データ ───────────────────────────────────────────────
const BODY_PARTS = [
  {
    id:            'shoulder_neck',
    name:          '肩・首',
    icon:          '🙆',
    muscle:        '僧帽筋・胸鎖乳突筋',
    desc:          '首をゆっくり左右に傾け、反対の手で軽く押さえる。肩の力を抜いて10秒キープ。',
    illustration:  '🧘',
  },
  {
    id:            'lower_back',
    name:          '腰・背中',
    icon:          '🔙',
    muscle:        '脊柱起立筋・腰方形筋',
    desc:          '仰向けに寝て両膝を曲げ、左右にゆっくり倒す。腰の緊張をほぐす。',
    illustration:  '🛌',
  },
  {
    id:            'hip',
    name:          '股関節',
    icon:          '🔄',
    muscle:        '鼠蹊部・腸腰筋',
    desc:          '片膝を前に出し、もう片方の膝を床につける。骨盤を前に押し出してキープ。',
    illustration:  '🧎',
  },
  {
    id:            'hamstring',
    name:          'ハムストリング',
    icon:          '🦵',
    muscle:        '太もも裏',
    desc:          '床に座り片足を伸ばして前屈。膝を曲げずに太もも裏を伸ばす。左右交互に。',
    illustration:  '🤸',
  },
  {
    id:            'calf_achilles',
    name:          'ふくらはぎ',
    icon:          '👟',
    muscle:        '腓腹筋・アキレス腱',
    desc:          '壁に手をつき片足を後ろに引いてかかとを床につける。ふくらはぎを伸ばす。',
    illustration:  '🏃',
  },
  {
    id:            'ankle',
    name:          '足首',
    icon:          '🦶',
    muscle:        '前脛骨筋・足底筋膜',
    desc:          '足首をゆっくり大きく回す。内回し・外回しを各方向10回ずつ。',
    illustration:  '🦵',
  },
] as const

type PartId = typeof BODY_PARTS[number]['id']

// ── ロジック ─────────────────────────────────────────────────
function getRecommendedParts(riskScore: number): PartId[] {
  if (riskScore >= 70) return ['hamstring', 'hip', 'calf_achilles', 'lower_back']
  if (riskScore >= 40) return ['hamstring', 'hip']
  return []
}

function calcRecoveryReduction(totalSeconds: number, skippedCount: number): number {
  let base = 3
  if      (totalSeconds >= 300) base = 15
  else if (totalSeconds >= 180) base = 12
  else if (totalSeconds >= 120) base = 9
  else if (totalSeconds >= 60)  base = 6
  return Math.max(base - skippedCount, 1)
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}分${s}秒` : `${s}秒`
}

async function saveResult(reduction: number, lastReduction: number) {
  const today = new Date().toISOString().slice(0, 10)
  try {
    const existing = await AsyncStorage.getItem(STRETCH_RESULT_KEY)
    let total = reduction
    if (existing) {
      const parsed = JSON.parse(existing)
      if (parsed.date === today) {
        total = Math.min(MAX_DAILY_REDUCTION, parsed.reduction + reduction)
      }
    }
    await AsyncStorage.setItem(STRETCH_RESULT_KEY, JSON.stringify({
      date: today,
      reduction: total,
      showBanner: true,
      lastReduction,
    }))
  } catch {}
}

// ── ビープ音（Web Audio API） ─────────────────────────────────
function playBeep(freq: number = 880, duration: number = 0.12) {
  if (typeof window === 'undefined') return
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx  = new AudioCtx()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = freq
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.4, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration)
    setTimeout(() => ctx.close(), (duration + 0.1) * 1000)
  } catch {}
}

// ── 円形タイマー ──────────────────────────────────────────────
function CircularTimer({ progress, seconds, color }: {
  progress: number
  seconds: number
  color:    string
}) {
  const r             = 68
  const circumference = 2 * Math.PI * r
  const dashOffset    = circumference * (1 - progress)

  return (
    <View style={{ width: 160, height: 160, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={160} height={160} viewBox="0 0 160 160" style={{ position: 'absolute' }}>
        <Circle cx={80} cy={80} r={r} fill="none" stroke="#e5e7eb" strokeWidth={8} />
        <Circle
          cx={80} cy={80} r={r}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          rotation={-90}
          origin="80, 80"
        />
      </Svg>
      <Text style={{ color: '#111827', fontSize: 56, fontWeight: '900', lineHeight: 60 }}>
        {seconds.toString().padStart(2, '0')}
      </Text>
    </View>
  )
}

// ── イラストアニメーション ────────────────────────────────────
function PartIllustration({ illustration, isActive }: { illustration: string; isActive: boolean }) {
  const scale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (!isActive) { scale.setValue(1); return }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(scale, { toValue: 1.2, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0.9, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [isActive])

  return (
    <Animated.View style={[il.wrap, { transform: [{ scale }] }]}>
      <Text style={{ fontSize: 72 }}>{illustration}</Text>
    </Animated.View>
  )
}
const il = StyleSheet.create({
  wrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
})

// ══════════════════════════════════════════════════════════════
// 画面1: 部位選択
// ══════════════════════════════════════════════════════════════
function PartSelectScreen({
  riskScore,
  selected,
  recommended,
  onToggle,
  onStart,
}: {
  riskScore:   number
  selected:    Set<PartId>
  recommended: PartId[]
  onToggle:    (id: PartId) => void
  onStart:     () => void
}) {
  return (
    <ScrollView contentContainerStyle={ps.content} showsVerticalScrollIndicator={false}>
      <Text style={ps.title}>どこをストレッチしますか？</Text>
      <Text style={ps.sub}>気になる部位を複数選んでください</Text>

      <View style={ps.grid}>
        {BODY_PARTS.map(part => {
          const isSelected  = selected.has(part.id)
          const isRecommend = recommended.includes(part.id)
          return (
            <TouchableOpacity
              key={part.id}
              style={[ps.card, isSelected && ps.cardSelected]}
              onPress={() => onToggle(part.id)}
              activeOpacity={0.75}
            >
              {isRecommend && (
                <View style={ps.badge}>
                  <Text style={ps.badgeText}>推奨</Text>
                </View>
              )}
              <Text style={{ fontSize: 36, marginBottom: 6 }}>{part.icon}</Text>
              <Text style={[ps.partName, isSelected && { color: '#C8102E' }]}>{part.name}</Text>
              <Text style={[ps.partMuscle, isSelected && { color: 'rgba(200,16,46,0.6)' }]}>{part.muscle}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <TouchableOpacity
        style={[ps.startBtn, selected.size === 0 && { opacity: 0.35 }]}
        onPress={onStart}
        disabled={selected.size === 0}
        activeOpacity={0.85}
      >
        <Text style={ps.startBtnText}>ストレッチを開始する（{selected.size}部位）</Text>
        <Ionicons name="arrow-forward" size={18} color="#fff" />
      </TouchableOpacity>
    </ScrollView>
  )
}

const ps = StyleSheet.create({
  content:       { padding: 20, paddingBottom: 40 },
  title:         { color: '#111827', fontSize: 22, fontWeight: '900', marginBottom: 6 },
  sub:           { color: '#6b7280', fontSize: 13, marginBottom: 22 },
  grid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  card:          {
    width: '47%', backgroundColor: '#ffffff',
    borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.08)',
    padding: 16, alignItems: 'center', gap: 4, position: 'relative',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  cardSelected: {
    borderColor: '#C8102E',
    backgroundColor: 'rgba(229,57,53,0.05)',
  },
  badge:         {
    position: 'absolute', top: 8, right: 8,
    backgroundColor: '#f59e0b', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  badgeText:     { color: '#fff', fontSize: 9, fontWeight: '900' },
  partName:      { color: '#111827', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  partMuscle:    { color: '#9ca3af', fontSize: 10, textAlign: 'center' },
  startBtn:      {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#1c1c1e', borderRadius: 50, paddingVertical: 17,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 5,
  },
  startBtnText:  { color: '#fff', fontSize: 15, fontWeight: '900', letterSpacing: -0.3 },
})

// ══════════════════════════════════════════════════════════════
// 画面2: ストレッチ実施
// ══════════════════════════════════════════════════════════════
function StretchScreen({
  parts,
  secondsPerStretch,
  onComplete,
  onSkip,
  onBack,
  onChangeSeconds,
}: {
  parts:            typeof BODY_PARTS[number][]
  secondsPerStretch: number
  onComplete:       (totalSec: number, skipped: number) => void
  onSkip:           (partId: PartId) => void
  onBack:           () => void
  onChangeSeconds:  (s: number) => void
}) {
  const [currentIndex, setCurrentIndex]   = useState(0)
  const [secondsLeft,  setSecondsLeft]    = useState(secondsPerStretch)
  const [isPaused,     setIsPaused]       = useState(false)
  const [isStarted,    setIsStarted]      = useState(false)
  const [skipped,      setSkipped]        = useState<Set<PartId>>(new Set())
  const [totalSpent,   setTotalSpent]     = useState(0)
  const [showTimePicker, setShowTimePicker] = useState(false)

  const part    = parts[currentIndex]
  const isLast  = currentIndex === parts.length - 1

  // タイマーリセット（部位が変わったとき）
  useEffect(() => {
    setSecondsLeft(secondsPerStretch)
    setIsStarted(false)  // 次の部位はスタート待ち
  }, [currentIndex, secondsPerStretch])

  // カウントダウン
  useEffect(() => {
    if (!isStarted || isPaused) return
    if (secondsLeft <= 0) {
      // タイマー自然終了 → 全時間経過
      playBeep(1046, 0.15)
      setTimeout(() => playBeep(1318, 0.2), 180)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
      setTimeout(() => advanceNext(false, secondsPerStretch), 600)
      return
    }
    // 残り5秒カウントダウン音
    if (secondsLeft <= 5) {
      playBeep(secondsLeft === 1 ? 1046 : 660, 0.1)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    }
    const timer = setInterval(() => {
      setSecondsLeft(s => s - 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [secondsLeft, isPaused, isStarted])

  // wasSkipped: スキップの場合 / earlyDone: 早期完了（実際の経過秒を渡す）
  function advanceNext(wasSkipped: boolean, overrideElapsed?: number) {
    const elapsed = wasSkipped ? 0 : (overrideElapsed ?? (secondsPerStretch - secondsLeft))
    if (!wasSkipped) {
      setTotalSpent(t => t + elapsed)
    } else {
      setSkipped(prev => new Set([...prev, part.id]))
      onSkip(part.id)
    }
    if (isLast) {
      const total = wasSkipped ? totalSpent : totalSpent + elapsed
      const skippedCount = wasSkipped ? skipped.size + 1 : skipped.size
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      onComplete(total, skippedCount)
    } else {
      setCurrentIndex(i => i + 1)
    }
  }

  function handleBack() {
    if (currentIndex > 0) {
      setCurrentIndex(i => i - 1)
    } else {
      onBack()
    }
  }

  const progress     = 1 - secondsLeft / secondsPerStretch
  const timerColor   =
    secondsLeft > 20 ? '#C8102E' :
    secondsLeft > 10 ? '#F5A623' : '#34C759'

  const TIME_OPTIONS = [15, 30, 45, 60]

  return (
    <View style={{ flex: 1 }}>
      {/* 進捗 */}
      <View style={ss.progressRow}>
        <Text style={ss.progressText}>{currentIndex + 1}/{parts.length} 部位</Text>
        {/* 秒数変更バッジ */}
        <TouchableOpacity
          style={ss.timeBadge}
          onPress={() => setShowTimePicker(v => !v)}
          activeOpacity={0.7}
        >
          <Text style={ss.timeBadgeText}>⏱ {secondsPerStretch}秒</Text>
        </TouchableOpacity>
      </View>

      {/* 秒数選択シート */}
      {showTimePicker && (
        <View style={ss.timePicker}>
          {TIME_OPTIONS.map(t => (
            <TouchableOpacity
              key={t}
              style={[ss.timeOpt, t === secondsPerStretch && ss.timeOptActive]}
              onPress={() => { onChangeSeconds(t); setShowTimePicker(false) }}
              activeOpacity={0.7}
            >
              <Text style={[ss.timeOptText, t === secondsPerStretch && { color: '#C8102E' }]}>{t}秒</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ScrollView contentContainerStyle={ss.content} showsVerticalScrollIndicator={false}>
        {/* イラスト */}
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <PartIllustration illustration={part.illustration} isActive={!isPaused} />
        </View>

        {/* 部位名・説明 */}
        <Text style={ss.partName}>{part.icon} {part.name}</Text>
        <Text style={ss.muscle}>{part.muscle}</Text>
        <Text style={ss.desc}>{part.desc}</Text>

        {/* 円形タイマー */}
        <View style={{ alignItems: 'center', marginVertical: 24 }}>
          <CircularTimer
            progress={progress}
            seconds={secondsLeft}
            color={timerColor}
          />
        </View>

        {/* 操作ボタン */}
        {!isStarted ? (
          // ── スタート前 ──
          <View style={ss.btnRow}>
            <TouchableOpacity style={ss.subBtn} onPress={handleBack} activeOpacity={0.7}>
              <Ionicons name="arrow-back" size={18} color="#9ca3af" />
              <Text style={ss.subBtnText}>戻る</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[ss.mainBtn, { backgroundColor: '#C8102E' }]}
              onPress={() => setIsStarted(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="play" size={18} color="#fff" />
              <Text style={ss.mainBtnText}>スタート</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ss.subBtn} onPress={() => advanceNext(true)} activeOpacity={0.7}>
              <Text style={ss.subBtnText}>スキップ</Text>
              <Ionicons name="arrow-forward" size={18} color="#9ca3af" />
            </TouchableOpacity>
          </View>
        ) : (
          // ── 実施中 ──
          <>
            {/* メインボタン行: 一時停止 | 完了 */}
            <View style={ss.btnRow}>
              <TouchableOpacity style={ss.subBtn} onPress={handleBack} activeOpacity={0.7}>
                <Ionicons name="arrow-back" size={18} color="#9ca3af" />
                <Text style={ss.subBtnText}>戻る</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[ss.mainBtn, isPaused ? { backgroundColor: '#34C759' } : { backgroundColor: '#555' }]}
                onPress={() => setIsPaused(v => !v)}
                activeOpacity={0.85}
              >
                <Ionicons name={isPaused ? 'play' : 'pause'} size={16} color="#fff" />
                <Text style={ss.mainBtnText}>{isPaused ? '再開' : '一時停止'}</Text>
              </TouchableOpacity>
              {/* 早期完了ボタン（実際の経過秒を記録） */}
              <TouchableOpacity
                style={[ss.mainBtn, { backgroundColor: '#C8102E' }]}
                onPress={() => advanceNext(false)}
                activeOpacity={0.85}
              >
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={ss.mainBtnText}>完了</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[ss.subBtn, { alignSelf: 'flex-end', marginTop: 6, paddingHorizontal: 16 }]}
              onPress={() => advanceNext(true)}
              activeOpacity={0.7}
            >
              <Text style={ss.subBtnText}>スキップ</Text>
              <Ionicons name="arrow-forward" size={16} color="#9ca3af" />
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  )
}

const ss = StyleSheet.create({
  progressRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12,
  },
  progressText:  { color: '#6b7280', fontSize: 13, fontWeight: '700' },
  timeBadge:     {
    backgroundColor: '#f0f2f5', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
    paddingHorizontal: 10, paddingVertical: 4,
  },
  timeBadgeText: { color: '#6b7280', fontSize: 12, fontWeight: '700' },
  timePicker:    {
    flexDirection: 'row', justifyContent: 'center', gap: 8,
    paddingHorizontal: 20, paddingBottom: 10,
  },
  timeOpt:       {
    flex: 1, backgroundColor: '#ffffff',
    borderRadius: 10, paddingVertical: 10, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  timeOptActive: { backgroundColor: 'rgba(22,101,52,0.08)', borderWidth: 1.5, borderColor: '#166534' },
  timeOptText:   { color: '#6b7280', fontSize: 13, fontWeight: '700' },
  content:       { padding: 20, paddingBottom: 40, alignItems: 'center' },
  partName:      { color: '#111827', fontSize: 22, fontWeight: '900', marginBottom: 4, textAlign: 'center' },
  muscle:        { color: '#6b7280', fontSize: 12, marginBottom: 10, textAlign: 'center' },
  desc:          { color: '#6b7280', fontSize: 13, lineHeight: 20, textAlign: 'center', paddingHorizontal: 10 },
  btnRow:        {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    width: '100%', marginTop: 8,
  },
  mainBtn:       {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: '#f0f2f5', borderRadius: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
  },
  mainBtnText:   { color: '#111827', fontSize: 14, fontWeight: '800' },
  subBtn:        {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, borderWidth: 1, borderColor: 'rgba(0,0,0,0.10)',
    borderRadius: 14, paddingVertical: 14,
    backgroundColor: '#ffffff',
  },
  subBtnText:    { color: '#9ca3af', fontSize: 12, fontWeight: '700' },
})

// ══════════════════════════════════════════════════════════════
// 画面3: 完了
// ══════════════════════════════════════════════════════════════
function CompleteScreen({
  riskBefore,
  reduction,
  completedParts,
  totalSeconds,
  onHome,
}: {
  riskBefore:     number
  reduction:      number
  completedParts: number
  totalSeconds:   number
  onHome:         () => void
}) {
  const riskAfter = Math.max(0, riskBefore - reduction)

  const scale = useRef(new Animated.Value(0.7)).current
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start()
  }, [])

  return (
    <ScrollView contentContainerStyle={cs.content} showsVerticalScrollIndicator={false}>
      <Animated.View style={[cs.card, { transform: [{ scale }], opacity }]}>
        <Text style={{ fontSize: 56, marginBottom: 8 }}>🎉</Text>
        <Text style={cs.title}>ストレッチ完了！</Text>

        <View style={cs.statsRow}>
          <View style={cs.stat}>
            <Text style={cs.statNum}>{completedParts}</Text>
            <Text style={cs.statLabel}>部位</Text>
          </View>
          <View style={cs.divider} />
          <View style={cs.stat}>
            <Text style={cs.statNum}>{fmtTime(totalSeconds)}</Text>
            <Text style={cs.statLabel}>合計時間</Text>
          </View>
        </View>

        <Text style={cs.riskLabel}>怪我リスクスコア</Text>
        <View style={cs.riskRow}>
          <Text style={cs.riskBefore}>{riskBefore}</Text>
          <Ionicons name="arrow-forward" size={20} color="#888" style={{ marginHorizontal: 8 }} />
          <Text style={cs.riskAfter}>{riskAfter}</Text>
        </View>
        <Text style={cs.riskDelta}>(-{reduction}ポイント)</Text>
      </Animated.View>

      <TouchableOpacity style={cs.homeBtn} onPress={onHome} activeOpacity={0.85}>
        <Ionicons name="home" size={18} color="#fff" />
        <Text style={cs.homeBtnText}>ホームに戻る</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const cs = StyleSheet.create({
  content:    { padding: 24, paddingBottom: 60, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  card:       {
    width: '100%', backgroundColor: '#ffffff',
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
    padding: 28, alignItems: 'center', marginBottom: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
  },
  title:      { color: '#111827', fontSize: 22, fontWeight: '900', marginBottom: 20 },
  statsRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 24, gap: 20 },
  stat:       { alignItems: 'center', gap: 4 },
  statNum:    { color: '#111827', fontSize: 24, fontWeight: '900' },
  statLabel:  { color: '#9ca3af', fontSize: 11 },
  divider:    { width: 1, height: 36, backgroundColor: 'rgba(0,0,0,0.08)' },
  riskLabel:  { color: '#9ca3af', fontSize: 11, fontWeight: '700', marginBottom: 8, letterSpacing: 1 },
  riskRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  riskBefore: { color: '#ef4444', fontSize: 36, fontWeight: '900' },
  riskAfter:  { color: '#22c55e', fontSize: 36, fontWeight: '900' },
  riskDelta:  { color: '#22c55e', fontSize: 14, fontWeight: '700' },
  homeBtn:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#1c1c1e', borderRadius: 50,
    paddingVertical: 17, width: '100%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 5,
  },
  homeBtnText:{ color: '#fff', fontSize: 15, fontWeight: '900', letterSpacing: -0.3 },
})

// ══════════════════════════════════════════════════════════════
// メインスクリーン
// ══════════════════════════════════════════════════════════════
type Phase = 'select' | 'stretch' | 'complete'

export default function StretchRecoveryScreen() {
  const router = useRouter()
  const { riskScore: riskScoreStr } = useLocalSearchParams<{ riskScore: string }>()
  const riskScore = parseInt(riskScoreStr ?? '50', 10)

  const recommended = getRecommendedParts(riskScore)
  const [selected, setSelected] = useState<Set<PartId>>(new Set(recommended))
  const [phase, setPhase]       = useState<Phase>('select')
  const [secondsPerStretch, setSecondsPerStretch] = useState(30)
  const [skippedParts, setSkippedParts] = useState<PartId[]>([])
  const [result, setResult] = useState<{ totalSec: number; reduction: number } | null>(null)

  const selectedParts = BODY_PARTS.filter(p => selected.has(p.id))

  function togglePart(id: PartId) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleStart() {
    setSkippedParts([])
    setResult(null)
    setPhase('stretch')
  }

  function handleStretchComplete(totalSec: number, skippedCount: number) {
    const reduction = calcRecoveryReduction(totalSec, skippedCount)
    const completed = selectedParts.length - skippedCount
    setResult({ totalSec, reduction })
    saveResult(reduction, reduction)
    setPhase('complete')
  }

  function handleHome() {
    router.replace('/(tabs)')
  }

  const titleMap: Record<Phase, string> = {
    select:   'ストレッチを始めよう',
    stretch:  '',
    complete: '',
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* ヘッダー */}
        <View style={ms.header}>
          <TouchableOpacity
            onPress={() => phase === 'select' ? router.back() : setPhase('select')}
            style={ms.backBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={22} color="#6b7280" />
          </TouchableOpacity>
          <Text style={ms.headerTitle}>{titleMap[phase] || ''}</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* コンテンツ */}
        {phase === 'select' && (
          <PartSelectScreen
            riskScore={riskScore}
            selected={selected}
            recommended={recommended}
            onToggle={togglePart}
            onStart={handleStart}
          />
        )}

        {phase === 'stretch' && (
          <StretchScreen
            parts={selectedParts}
            secondsPerStretch={secondsPerStretch}
            onComplete={(total, skipped) => handleStretchComplete(total, skipped)}
            onSkip={(id) => setSkippedParts(prev => [...prev, id])}
            onBack={() => setPhase('select')}
            onChangeSeconds={setSecondsPerStretch}
          />
        )}

        {phase === 'complete' && result && (
          <CompleteScreen
            riskBefore={riskScore}
            reduction={result.reduction}
            completedParts={selectedParts.length - skippedParts.length}
            totalSeconds={result.totalSec}
            onHome={handleHome}
          />
        )}
      </SafeAreaView>
    </View>
  )
}

const ms = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
    backgroundColor: '#ffffff',
  },
  backBtn:     { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#111827', fontSize: 16, fontWeight: '800' },
})

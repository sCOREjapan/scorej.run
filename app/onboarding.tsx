// app/onboarding.tsx — 統合オンボーディング
// 2026-09-07 再設計(1) 13画面→7画面。
// 2026-09-07 再設計(2) Codex実装指示によるダークグリーン・グラデーションの
//   「1問ずつ・即体感」デザインへの全面刷新（配色/カード選択パターン/進捗バー/
//   下部固定CTAのみ他アプリを参考にし、配色やフォーム自体は模倣していない）。
// 2026-09-07 再設計(3) 旧5枚スライドの導入カルーセル(IntroCarousel/phase==='intro')は
//   一度メインフローから撤去したが、丸い怪我リスクメーター＋長押しCTA
//   （RiskMeterCTA。0→65まで弧が伸びて数字がカウントアップ→「クエストを始める」に
//   クロスフェード→長押しで画面全体に緑が広がり次画面へ）へ全面刷新したことを受けて
//   再度エントリーポイントに戻した（初期phaseは'intro'）。
//
// 画面フロー: 導入(怪我リスクメーター・長押しでスタート) → 目的選択 →
//   メイン種目選択[ジャンル+種目統合] → 今日の状態チェック[練習/疲労/睡眠+任意で痛み] →
//   準備中演出(honest) → 初回チェック結果(数値スコア+定性見出し・課金訴求は最下部1行のみ) →
//   handleFinish()（/auth または /(tabs)、後続は不変）。
//   旧・任意の目標設定画面(phase==='goals'、名前/年齢/PB/経験年数)は必須フローから外し、
//   到達経路を持たない状態で温存（該当項目はSettings画面から引き続き設定可能）。
// /auth 側は「このプランを保存しますか」という保存価値フレーミングに変更済み（app/auth.tsx）。
// 「チームを管理したい」を選んだ場合は種目選択・状態チェックをスキップし、
// handleFinish()内で/team-invite（既存のチーム作成・招待コード発行画面）へ直接遷移する。

import React, { useRef, useState, useCallback, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  Animated, TextInput, ScrollView, Platform,
  KeyboardAvoidingView, Dimensions, PanResponder, Easing,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Circle } from 'react-native-svg'
import CountUpText from '../components/CountUpText'
import TypewriterText from '../components/TypewriterText'
import DarkScreenBg from '../components/DarkGradientBg'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { getEventLabel } from '../lib/eventLabels'
import { getPrefectureLabel, getRegionLabel } from '../lib/prefectureLabels'
import { BRAND, TEXT } from '../lib/theme'
import { Sounds, unlockAudio } from '../lib/sounds'
import { lightTap, mediumTap } from '../lib/haptics'
import { trackOnboardingStep } from '../lib/analytics'
import {
  computeOnboardingReadiness, READINESS_BAND_COLOR,
  type YesterdayPractice, type FatigueLevel, type SleepBand, type OnboardingReadinessResult, type ReadinessBand,
} from '../lib/onboardingReadiness'
import type { AthleticsEvent, EventCategory } from '../types'

const QUIZ_STEPS = 3   // 1:目的選択 2:種目選択(統合) 3:今日の状態チェック
const { width: SW, height: SH } = Dimensions.get('window')
const RED     = BRAND   // アプリ全体のグリーンに統一（旧: 赤 #E53E3E）
const BLUE    = '#5AC8FA'
const GREEN   = '#34C759'
const I_AMBER = '#FF9500'

// ── クエスト用ソフトグリーン配色 ────────────────────────────
const G1     = '#22c55e'
const G2     = BRAND   // #166534
const TINT   = '#f0fdf4'
const SBORDER= '#d7ecdf'
const GRAD   = [G1, G2] as const

// ════════════════════════════════════════════════════════════════
// イントロカルーセル（旧 app/auth.tsx Slide1〜5 を移設。内容は不変）
// ════════════════════════════════════════════════════════════════

function useFadeUp(isActive: boolean, delay = 0) {
  const opacity = useRef(new Animated.Value(0)).current
  const ty      = useRef(new Animated.Value(30)).current
  React.useEffect(() => {
    if (isActive) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 560, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.spring(ty,      { toValue: 0, delay, tension: 60, friction: 10, useNativeDriver: true }),
      ]).start()
    } else {
      opacity.setValue(0); ty.setValue(30)
    }
  }, [isActive])
  return { opacity, transform: [{ translateY: ty }] } as any
}

function useScaleFade(isActive: boolean, delay = 0) {
  const opacity = useRef(new Animated.Value(0)).current
  const scale   = useRef(new Animated.Value(0.85)).current
  React.useEffect(() => {
    if (isActive) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 500, delay, useNativeDriver: true }),
        Animated.spring(scale,   { toValue: 1, delay, tension: 70, friction: 9, useNativeDriver: true }),
      ]).start()
    } else {
      opacity.setValue(0); scale.setValue(0.85)
    }
  }, [isActive])
  return { opacity, transform: [{ scale }] } as any
}

function useStagger(isActive: boolean, count: number, baseDelay = 0, step = 80) {
  const anims = useRef(Array.from({ length: count }, () => ({
    opacity: new Animated.Value(0),
    ty:      new Animated.Value(22),
  }))).current
  React.useEffect(() => {
    if (isActive) {
      Animated.parallel(anims.map((a, i) =>
        Animated.parallel([
          Animated.timing(a.opacity, { toValue: 1, duration: 480, delay: baseDelay + i * step, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.spring(a.ty,      { toValue: 0, delay: baseDelay + i * step, tension: 65, friction: 10, useNativeDriver: true }),
        ])
      )).start()
    } else {
      anims.forEach(a => { a.opacity.setValue(0); a.ty.setValue(22) })
    }
  }, [isActive])
  return anims.map(a => ({ opacity: a.opacity, transform: [{ translateY: a.ty }] }) as any)
}

function useArrowBounce() {
  const tx = useRef(new Animated.Value(0)).current
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(tx, { toValue: 8, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(tx, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]))
    loop.start(); return () => loop.stop()
  }, [])
  return tx
}

type SlideProps = { isActive: boolean; onFinish: () => void }

// 2026-09-07: 「三つの四角」を撤去し、丸い怪我リスク風メーター1つに統合（ユーザー要望）。
// ①isActiveになったら0→valueまで弧が伸び、数字もカウントアップ。溜まっている間は
//   lightTapを一定間隔で刻み、完了時にmediumTapで締める（実機の「ジジジ…ッ」という
//   溜まり感を狙う。Web/開発機はlib/haptics.tsがPlatform.OS==='web'を検知して自動的に
//   無音・無振動になるので分岐を気にせず呼べる）。
// ②弧が溜まりきったら中央の数値表示を「クエストを始める」ボタンにクロスフェード。
// ③ボタンは長押し専用（誤タップ防止の「握り込む」コミット操作）。押し続けている間、
//   緑の円がボタン位置から画面全体へ広がり、Sounds.tap()を刻みながら画面が小刻みに
//   揺れ、広がりきった瞬間にSounds.pb()が鳴って次画面(目的選択)へ遷移する。
//   （2026-09-08: 当初は陸上の号砲=playStarterGunCue()だったが、アプリ起動直後に
//   いきなり銃声が鳴るのは唐突すぎるとの指摘で、通常の達成音に変更した）
//   途中で指を離すと縮んでキャンセルされる。
const METER_SIZE = 220
const HOLD_MS = 750
const HOLD_TICK_MS = 90

// 水面の波紋のように中心から広がって消えるリング。3本を600msずつずらしてループさせ、
// 「常に出続けている」ように見せる（ボタンが押せる状態になっている間だけ表示）。
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

function RiskMeterCTA({ isActive, value, ctaLabel, riskLabel, onFinish, hold, onHoldStart, onHoldEnd }: {
  isActive: boolean; value: number; ctaLabel: string; riskLabel: string; onFinish: () => void
  hold: Animated.Value; onHoldStart: () => void; onHoldEnd: () => void
}) {
  const fill     = useRef(new Animated.Value(0)).current
  const revealed = useRef(new Animated.Value(0)).current   // 0=数値表示 / 1=ボタン表示（クロスフェード）
  const [buttonReady, setButtonReady] = useState(false)
  const firedRef = useRef(false)
  const holdTickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const band: ReadinessBand =
    value <= 24 ? 'low' : value <= 49 ? 'caution' : value <= 74 ? 'warning' : 'high'
  const color = READINESS_BAND_COLOR[band]

  // 「65」までしっかり見える速さにするため意図的にゆっくり(1.8秒)伸ばす
  const FILL_DURATION = 1800
  const TICK_MS = 90

  useEffect(() => {
    if (!isActive) return
    const tickTimer = setInterval(() => { lightTap() }, TICK_MS)
    let holdBeforeReveal: ReturnType<typeof setTimeout> | null = null
    Animated.timing(fill, { toValue: 1, duration: FILL_DURATION, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(() => {
      clearInterval(tickTimer)
      mediumTap()
      // 「何のメーターか」が伝わるよう、数字+「怪我リスク」表示を1秒静止させてから
      // ボタンへクロスフェードする（即切り替わると読む間もなく変わってしまうため）
      holdBeforeReveal = setTimeout(() => {
        setButtonReady(true)
        Animated.timing(revealed, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
      }, 1000)
    })
    return () => { clearInterval(tickTimer); if (holdBeforeReveal) clearTimeout(holdBeforeReveal) }
  }, [isActive])

  const stopHoldTicks = () => {
    if (holdTickRef.current) { clearInterval(holdTickRef.current); holdTickRef.current = null }
  }

  const handlePressIn = () => {
    if (firedRef.current || !buttonReady) return
    onHoldStart()
    Sounds.tap()
    holdTickRef.current = setInterval(() => { Sounds.tap() }, HOLD_TICK_MS)
    Animated.timing(hold, { toValue: 1, duration: HOLD_MS, easing: Easing.linear, useNativeDriver: true }).start(({ finished }) => {
      stopHoldTicks()
      if (finished && !firedRef.current) {
        firedRef.current = true
        onHoldEnd()
        Sounds.pb()   // 2026-09-08: 号砲音は初回起動でいきなり鳴ると唐突という指摘で変更
        onFinish()
      }
    })
  }
  const handlePressOut = () => {
    if (firedRef.current) return
    stopHoldTicks()
    onHoldEnd()
    Animated.timing(hold, { toValue: 0, duration: 180, useNativeDriver: true }).start()
  }

  useEffect(() => () => stopHoldTicks(), [])

  const strokeWidth = 12
  const r = (METER_SIZE - strokeWidth) / 2
  const circumference = 2 * Math.PI * r
  const dashOffset = fill.interpolate({ inputRange: [0, 1], outputRange: [circumference, circumference * (1 - value / 100)] })
  const coverSize = Math.max(SW, SH) * 2.6

  return (
    <View style={{ width: METER_SIZE, height: METER_SIZE, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={METER_SIZE} height={METER_SIZE} style={{ position: 'absolute' }}>
        <Circle cx={METER_SIZE / 2} cy={METER_SIZE / 2} r={r} stroke="rgba(0,0,0,0.08)" strokeWidth={strokeWidth} fill="none" />
        <AnimatedCircle
          cx={METER_SIZE / 2} cy={METER_SIZE / 2} r={r}
          stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round"
          strokeDasharray={`${circumference}, ${circumference}`}
          strokeDashoffset={dashOffset}
          rotation="-90" origin={`${METER_SIZE / 2}, ${METER_SIZE / 2}`}
        />
      </Svg>

      {/* 水面の波紋エフェクト（ボタンが押せる状態の間、中心から広がり続ける） */}
      <RippleRing active={buttonReady} delay={0}    size={150} color={color} />
      <RippleRing active={buttonReady} delay={600}  size={150} color={color} />
      <RippleRing active={buttonReady} delay={1200} size={150} color={color} />

      {/* 数値表示（弧が溜まる間だけ表示、完了後はフェードアウト） */}
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', alignItems: 'center', opacity: revealed.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}
      >
        <CountUpText value={value} duration={FILL_DURATION} triggerKey={isActive} style={StyleSheet.flatten([sl.meterNum, { color }])} />
        <Text style={sl.meterNumLabel}>{riskLabel}</Text>
      </Animated.View>

      {/* 長押しCTA（弧が溜まりきったらフェードイン。押している間だけ有効） */}
      <Animated.View style={{ position: 'absolute', opacity: revealed }} pointerEvents={buttonReady ? 'auto' : 'none'}>
        <TouchableOpacity activeOpacity={1} onPressIn={handlePressIn} onPressOut={handlePressOut} style={sl.meterCtaHit}>
          <Ionicons name="sparkles" size={18} color={G2} />
          <Text style={sl.meterCtaText}>{ctaLabel}</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* 長押しで画面全体へ広がる緑のカバー（离すと縮んでキャンセル） */}
      <Animated.View
        pointerEvents="none"
        style={[sl.holdCover, {
          width: coverSize, height: coverSize, borderRadius: coverSize / 2,
          top: METER_SIZE / 2 - coverSize / 2, left: METER_SIZE / 2 - coverSize / 2,
          transform: [{ scale: hold }],
        }]}
      />
    </View>
  )
}

// 2026-09-07: 「他のオンボーディング画面みたいにデザイン変更して欲しい」という要望を受け、
// ダークグリーン・グラデーション系のデザインシステム（app/onboarding.tsxの目的選択画面等と同じ）
// に合わせて再配色。グリッド線などライト背景前提の装飾は撤去し、ロゴマークは白地に
// 緑文字へ反転（背景と同化しないように）。スコアバッジは可読性優先で白カードのまま維持。
// app/_layout.tsxが言語選択/利用規約同意モーダルをこの画面の上に重ねて表示している間も
// /onboardingルート自体はマウントされたまま（見えないだけ）のため、isActiveだけを見て
// 演出を開始すると「規約を読んでいる間にメーターが進み終わっている」事故が起きる
// （2026-09-07に実際に報告された不具合）。_layout.tsx自体は触らず、そこが書き込む
// 既存の同意済みフラグ(score_terms_accepted_v1)をこちらから読むだけに留める。
const CONSENT_ACCEPTED_KEY = 'score_terms_accepted_v1'

// マスコットキャラ（オンボーディング用2カット・背景透過PNG）
// ready: 「クエストを始める」CTA脇に置く、やる気に満ちたポーズ
// thinking: 準備中（processing）演出で、データを分析しているようなポーズ
const MASCOT_ONBOARDING_READY    = require('../assets/illustrations/mascot/mascot_onboarding_ready.png')
const MASCOT_ONBOARDING_THINKING = require('../assets/illustrations/mascot/mascot_onboarding_thinking.png')

function IntroSlide1({ isActive, onFinish }: SlideProps) {
  const { t } = useTranslation()
  const { hasSelectedLanguage } = useLanguage()
  const [consentDone, setConsentDone] = useState(false)
  const consentDoneRef = useRef(false)
  useEffect(() => {
    let alive = true
    const check = () => {
      if (consentDoneRef.current) return
      AsyncStorage.getItem(CONSENT_ACCEPTED_KEY).then(v => {
        if (!alive || !v || consentDoneRef.current) return
        consentDoneRef.current = true
        setConsentDone(true)
      }).catch(() => {})
    }
    check()
    // 同意モーダルは_layout.tsx側の状態なので変化を購読できない。消えたのを取りこぼさない
    // よう、同意済みになるまで短い間隔でポーリングする（同意後は自動的に止まる）。
    const interval = setInterval(check, 350)
    return () => { alive = false; clearInterval(interval) }
  }, [])
  // 言語選択・利用規約モーダルがこの画面の上に出ている間は、演出が見えないまま
  // 進んでしまわないよう開始条件に含める
  const revealReady = isActive && hasSelectedLanguage && consentDone

  const logo     = useScaleFade(revealReady, 0)
  const title    = useFadeUp(revealReady, 160)
  const meterPop = useScaleFade(revealReady, 420)
  // メーターの弧が溜まりきってボタンが現れる頃合い(FILL_DURATION=1100ms)に合わせて表示
  // タイムライン: 弧が伸びる(FILL_DURATION=1800ms) → 数字を1秒静止 → ボタンへクロスフェード(700ms)
  const holdHint = useFadeUp(revealReady, 2800)

  // 長押し中の「画面が少し揺れる」演出。hold(0〜1、長押しの進捗)が進むほど
  // 振幅が大きくなる小刻みな左右ウォブル(wobble、-1〜1を往復するループ)を
  // Animated.multiplyで掛け合わせる（どちらもtransformのみ＝useNativeDriver:trueで完結）。
  const hold   = useRef(new Animated.Value(0)).current
  const wobble = useRef(new Animated.Value(0)).current
  const wobbleLoopRef = useRef<Animated.CompositeAnimation | null>(null)
  const SHAKE_MAX_PX = 5

  // 2026-09-09: 「キャラクターを少しだけ上下に動かしてふわふわしてる感じに」の指示で追加。
  // 吹き出し脇のマスコットが常時ゆっくり上下に浮遊するループ（振れ幅6px・往復1400ms・
  // ease-in-outでフワッと感を出す）。revealReady後（言語選択/規約同意モーダルが消えてから）に開始。
  const mascotFloat = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!revealReady) return
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(mascotFloat, { toValue: -6, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(mascotFloat, { toValue: 0,  duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [revealReady])

  const startShake = useCallback(() => {
    wobble.setValue(0)
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(wobble, { toValue: 1, duration: 55, useNativeDriver: true }),
      Animated.timing(wobble, { toValue: -1, duration: 55, useNativeDriver: true }),
    ]))
    wobbleLoopRef.current = loop
    loop.start()
  }, [])
  const stopShake = useCallback(() => {
    wobbleLoopRef.current?.stop()
    wobbleLoopRef.current = null
    Animated.timing(wobble, { toValue: 0, duration: 100, useNativeDriver: true }).start()
  }, [])
  useEffect(() => () => { wobbleLoopRef.current?.stop() }, [])

  const shakeX = Animated.multiply(wobble, Animated.multiply(hold, SHAKE_MAX_PX))

  return (
    <Animated.View style={{ flex: 1, transform: [{ translateX: shakeX }] }}>
      {/* 2026-09-07: メーターを大きくした結果、小さい端末では長押しボタンが画面外に
          はみ出て押せなくなる不具合を確認したため、縦スクロールを許可して必ず
          辿り着けるようにする（横スワイプは親のPanResponderがdx優勢時のみ奪うため両立する） */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={sl.scrollContent} showsVerticalScrollIndicator={false} scrollEnabled={true}>
        <View style={sl.heroContent}>
          <Animated.View style={[sl.logoRow, logo]}>
            <View style={sl.logoMark}><Text style={sl.logoS}>S</Text></View>
            <View>
              <Text style={sl.logoName}>sCORE</Text>
              <Text style={sl.logoTagline}>{t('onboarding.intro.slide1.tagline')}</Text>
            </View>
          </Animated.View>
          {/* 2026-09-09: マスコットが吹き出しで喋っている風のレイアウト（mitame案A採用）。
              第1弾は緑タブの半透明ボックス＋三角尻尾だったが「ぷっくりしてる感じ」
              「AIっぽすぎる」というフィードバックを受けて、白ベース＋影で立体的にし、
              尻尾も三角ではなく大小2つの丸（漫画の思考吹き出し風）に変更（mitame再プレビュー
              A案採用）。文字も1文字ずつ表示するタイピング演出(TypewriterText)に変更した。 */}
          <Animated.View style={[sl.heroSpeechRow, title]}>
            <Animated.Image
              source={MASCOT_ONBOARDING_READY}
              style={[sl.heroMascot, { transform: [{ translateY: mascotFloat }] }]}
              resizeMode="contain"
            />
            <View style={sl.heroBubbleWrap}>
              <View style={sl.heroBubble}>
                <TypewriterText text={t('onboarding.intro.slide1.heroTitle')} style={sl.heroBubbleTitle} delay={150} triggerKey={revealReady} />
                <TypewriterText text={t('onboarding.intro.slide1.heroSub')} style={sl.heroBubbleSub} delay={900} triggerKey={revealReady} />
              </View>
              <View style={sl.heroDotBig} />
              <View style={sl.heroDotSmall} />
            </View>
          </Animated.View>

          <Animated.View style={[{ alignItems: 'center', marginTop: 24 }, meterPop]}>
            <RiskMeterCTA
              isActive={revealReady}
              value={65}
              ctaLabel={t('onboarding.intro.startQuest')}
              riskLabel={t('onboarding.intro.slide1.riskLabel')}
              onFinish={onFinish}
              hold={hold}
              onHoldStart={startShake}
              onHoldEnd={stopShake}
            />
            <Animated.Text style={[sl.holdHintText, holdHint]}>{t('onboarding.intro.slide1.holdHint')}</Animated.Text>
          </Animated.View>
        </View>
      </ScrollView>
    </Animated.View>
  )
}

// 2026-09-07: 旧Slide2〜5（機能紹介／あるあるチェック／Before-After／開発者メッセージ）は
// オンボーディング短縮のため削除した。行き先はそれぞれ: 機能紹介→ホーム内の初回導線、
// あるあるチェック→次の「目的選択」画面に統合、Before/After→App Store/LP用の販促素材、
// 開発者メッセージ→設定「sCOREについて」/Webサイトへ移設予定（コード未着手）。
const INTRO_SLIDES: Array<(p: SlideProps) => React.ReactElement> = [IntroSlide1]
const INTRO_TOTAL = INTRO_SLIDES.length

function IntroCarousel({ onFinish }: { onFinish: () => void }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(0)
  const pageRef    = useRef(0)
  const goToRef    = useRef<(n: number) => void>(() => {})
  const translateX = useRef(new Animated.Value(0)).current

  const goTo = useCallback((idx: number) => {
    const target = Math.max(0, Math.min(INTRO_TOTAL - 1, idx))
    Animated.spring(translateX, { toValue: -target * SW, tension: 80, friction: 16, useNativeDriver: true }).start()
    pageRef.current = target
    setPage(target)
  }, [])
  useEffect(() => { goToRef.current = goTo }, [goTo])

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy }) => Math.abs(dx) > Math.abs(dy) + 5 && Math.abs(dx) > 10,
      onMoveShouldSetPanResponderCapture: (_, { dx, dy }) => Math.abs(dx) > Math.abs(dy) + 5 && Math.abs(dx) > 10,
      onPanResponderRelease: (_, { dx }) => {
        if (dx < -50 && pageRef.current < INTRO_TOTAL - 1) goToRef.current(pageRef.current + 1)
        else if (dx > 50 && pageRef.current > 0) goToRef.current(pageRef.current - 1)
      },
    })
  ).current

  // 2026-09-07: CTA(「クエストを始める」の長押し)がメーター内に組み込まれたため、
  // 下部ナビバー（戻る/ドット/次へボタン）は撤去。スライドが複数に戻る将来のために
  // goTo/panResponder自体は残すが、現状は1枚のみなのでスワイプは実質使われない。
  // 2026-09-07追記: 「最初の画面だけ白背景ベース」の指示により、この画面だけ
  // DarkScreenBg(ダークグリーン)ではなく白背景に変更（他のオンボーディング画面は不変）。
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <SafeAreaView style={{ flex: 1, overflow: 'hidden' }} edges={['top', 'bottom']} {...panResponder.panHandlers}>
        <Animated.View style={{ flexDirection: 'row', width: SW * INTRO_TOTAL, flex: 1, transform: [{ translateX }] }}>
          {INTRO_SLIDES.map((SlideComp, i) => (
            <View key={i} style={{ width: SW, flex: 1 }}><SlideComp isActive={page === i} onFinish={onFinish} /></View>
          ))}
        </Animated.View>
      </SafeAreaView>
    </View>
  )
}

// ════════════════════════════════════════════════════════════════
// クエスト（プロフィール入力・ソフトグリーン演出）
// ════════════════════════════════════════════════════════════════

function buildCategories(t: (key: string) => string) {
  return [
    { key: 'sprint', label: t('onboarding.categories.sprint.label'), icon: 'flash-outline' as const, sub: t('onboarding.categories.sprint.sub') },
    { key: 'middle', label: t('onboarding.categories.middle.label'), icon: 'flame-outline' as const, sub: t('onboarding.categories.middle.sub') },
    { key: 'long',   label: t('onboarding.categories.long.label'),   icon: 'ellipse-outline' as const, sub: t('onboarding.categories.long.sub') },
    { key: 'field',  label: t('onboarding.categories.field.label'),  icon: 'medal-outline' as const, sub: t('onboarding.categories.field.sub') },
  ]
}

const EVENTS_BY_CATEGORY: Record<string, { label: string; key: AthleticsEvent }[]> = {
  sprint: [
    { key: '100m',  label: '100m' },
    { key: '200m',  label: '200m' },
    { key: '400m',  label: '400m' },
    { key: '110mH', label: '110mH（男子）' },
    { key: '100mH', label: '100mH（女子）' },
    { key: '400mH', label: '400mH' },
  ],
  middle: [
    { key: '800m',    label: '800m' },
    { key: '1500m',   label: '1500m' },
    { key: '3000m',   label: '3000m' },
    { key: '3000mSC', label: '3000mSC' },
  ],
  long: [
    { key: '5000m',         label: '5000m' },
    { key: '10000m',        label: '10000m' },
    { key: 'half_marathon', label: 'ハーフマラソン' },
    { key: 'marathon',      label: 'マラソン' },
    { key: '競歩',          label: '競歩' },
  ],
  field: [
    { key: '走幅跳',    label: '走幅跳' },
    { key: '三段跳',    label: '三段跳' },
    { key: '走高跳',    label: '走高跳' },
    { key: '棒高跳',    label: '棒高跳' },
    { key: '砲丸投',    label: '砲丸投' },
    { key: 'やり投',    label: 'やり投' },
    { key: '円盤投',    label: '円盤投' },
    { key: 'ハンマー投', label: 'ハンマー投' },
  ],
}

// フィールド種目は内部値(データ)が日本語のため、表示だけ getEventLabel() で言語に応じたラベルに変換する。
// 距離種目(100m等)は言語非依存なのでそのまま。

function buildGoalOptions(t: (key: string) => string) {
  return [
    { key: 'pb',           label: t('onboarding.goals.pb.label'),          sub: t('onboarding.goals.pb.sub'),          icon: 'trophy-outline' as const },
    { key: 'injury_free',  label: t('onboarding.goals.injuryFree.label'),  sub: t('onboarding.goals.injuryFree.sub'),  icon: 'shield-checkmark-outline' as const },
    { key: 'competition',  label: t('onboarding.goals.competition.label'), sub: t('onboarding.goals.competition.sub'), icon: 'flag-outline' as const },
    { key: 'team',         label: t('onboarding.goals.team.label'),        sub: t('onboarding.goals.team.sub'),        icon: 'people-outline' as const },
  ]
}

const PRACTICE_OPTIONS: { key: YesterdayPractice; labelKey: string }[] = [
  { key: 'rest',   labelKey: 'onboarding.condition.practice.rest' },
  { key: 'light',  labelKey: 'onboarding.condition.practice.light' },
  { key: 'normal', labelKey: 'onboarding.condition.practice.normal' },
  { key: 'hard',   labelKey: 'onboarding.condition.practice.hard' },
]
const FATIGUE_OPTIONS: { key: FatigueLevel; labelKey: string }[] = [
  { key: 'veryLight', labelKey: 'onboarding.condition.fatigue.veryLight' },
  { key: 'light',     labelKey: 'onboarding.condition.fatigue.light' },
  { key: 'normal',    labelKey: 'onboarding.condition.fatigue.normal' },
  { key: 'heavy',     labelKey: 'onboarding.condition.fatigue.heavy' },
  { key: 'veryHeavy', labelKey: 'onboarding.condition.fatigue.veryHeavy' },
]
const SLEEP_OPTIONS: { key: SleepBand; labelKey: string }[] = [
  { key: 'under4', labelKey: 'onboarding.condition.sleep.under4' },
  { key: 'h5to6',  labelKey: 'onboarding.condition.sleep.h5to6' },
  { key: 'h7to8',  labelKey: 'onboarding.condition.sleep.h7to8' },
  { key: 'over9',  labelKey: 'onboarding.condition.sleep.over9' },
]

function buildExperienceOptions(t: (key: string) => string) {
  return [
    { key: 0,  label: t('onboarding.experience.beginner.label'),     sub: t('onboarding.experience.beginner.sub') },
    { key: 2,  label: t('onboarding.experience.intermediate.label'), sub: t('onboarding.experience.intermediate.sub') },
    { key: 5,  label: t('onboarding.experience.experienced.label'),  sub: t('onboarding.experience.experienced.sub') },
    { key: 10, label: t('onboarding.experience.veteran.label'),      sub: t('onboarding.experience.veteran.sub') },
  ]
}

const PREFS_BY_REGION: { region: string; prefs: string[] }[] = [
  { region: '北海道', prefs: ['北海道'] },
  { region: '東北', prefs: ['青森', '岩手', '宮城', '秋田', '山形', '福島'] },
  { region: '関東', prefs: ['茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川'] },
  { region: '中部', prefs: ['新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知'] },
  { region: '近畿', prefs: ['三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山'] },
  { region: '中国', prefs: ['鳥取', '島根', '岡山', '広島', '山口'] },
  { region: '四国', prefs: ['徳島', '香川', '愛媛', '高知'] },
  { region: '九州・沖縄', prefs: ['福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'] },
]

function buildStepHeadline(t: (key: string) => string): Record<number, string> {
  return {
    1: t('onboarding.step.headline1'), 2: t('onboarding.step.headline2'), 3: t('onboarding.step.headline3'),
  }
}
function buildStepSub(t: (key: string) => string): Record<number, string> {
  return {
    1: t('onboarding.step.sub1'), 2: t('onboarding.step.sub2'), 3: t('onboarding.step.sub3'),
  }
}
const STEP_ICON: Record<number, keyof typeof Ionicons.glyphMap> = {
  1: 'flag-outline', 2: 'grid-outline', 3: 'battery-half-outline',
}

function ProgressHeader({ step, onBack, onSkip, showBack }: { step: number; onBack: () => void; onSkip: () => void; showBack: boolean }) {
  const { t } = useTranslation()
  return (
    <View style={styles.progressHeader}>
      {showBack ? (
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={20} color={TEXT.hint} />
        </TouchableOpacity>
      ) : <View style={{ width: 28 }} />}
      <View style={styles.progressTrack}>
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: `${(step / QUIZ_STEPS) * 100}%` }]} />
      </View>
      <TouchableOpacity onPress={onSkip} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.skipText}>{step < QUIZ_STEPS ? t('onboarding.skip') : ' '}</Text>
      </TouchableOpacity>
    </View>
  )
}

// 2026-09-07: グラデーションのブロブ＋浮き出しの「•••」バッジが「ダサい」というフィードバックを受け、
// フラットな色ベタ塗りの角丸アイコンコンテナに変更（NoadUpsellModal等、他画面のアイコン表現と統一）。
function IconBlob({ icon }: { icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.blobWrap}>
      <View style={styles.blob}>
        <Ionicons name={icon} size={26} color={G2} />
      </View>
    </View>
  )
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

// 2026-09-07: 準備中画面を「本格的」に作り直すためのリングコンポーネント。
// ホーム画面の怪我リスクリング（app/(tabs)/index.tsx）と同じreact-native-svg手法で、
// 実際の進捗(0〜1)に連動して弧が伸びる。中心のアイコンは常時ゆっくり回転させ、
// 「本当に何かを計算している」感を静止画のパルスより強く出す。
function ProcessingRing({ progress, rotateDeg, size = 104 }: {
  progress: Animated.Value
  rotateDeg: Animated.AnimatedInterpolation<string | number>
  size?: number
}) {
  const strokeWidth = 7
  const r = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * r
  const dashOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] })
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(22,101,52,0.12)" strokeWidth={strokeWidth} fill="none" />
        <AnimatedCircle
          cx={size / 2} cy={size / 2} r={r}
          stroke={G2} strokeWidth={strokeWidth} fill="none" strokeLinecap="round"
          strokeDasharray={`${circumference}, ${circumference}`}
          strokeDashoffset={dashOffset}
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Animated.View style={{ transform: [{ rotate: rotateDeg }] }}>
        <Ionicons name="sync-outline" size={30} color={G2} />
      </Animated.View>
    </View>
  )
}

// 準備中チェックリストの「進行中」ドット。完了前の項目にだけ呼吸するような拍動を付ける。
function ActiveDot() {
  const scale = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(scale, { toValue: 1.35, duration: 480, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1,    duration: 480, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [])
  return <Animated.View style={[styles.processActive, { transform: [{ scale }] }]} />
}

function GradientButton({ onPress, disabled, label, icon }: { onPress: () => void; disabled?: boolean; label: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.85} style={disabled ? { opacity: 0.4 } : undefined}>
      <View style={[styles.gradientBtn, { backgroundColor: G2 }]}>
        <Text style={styles.gradientBtnText}>{label}</Text>
        <Ionicons name={icon} size={17} color="#fff" />
      </View>
    </TouchableOpacity>
  )
}

function CategoryCard({ label, icon, selected, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; selected: boolean; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current
  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.spring(scale,  { toValue: 1,    tension: 300, friction: 10, useNativeDriver: true }),
    ]).start()
    onPress()
  }
  return (
    <Animated.View style={{ transform: [{ scale }], width: '48%' }}>
      <TouchableOpacity style={[styles.card, selected && styles.cardSelected]} onPress={handlePress} activeOpacity={1}>
        <View style={[styles.cardAvatar, selected && styles.cardAvatarSelected]}>
          <Ionicons name={icon} size={24} color={selected ? G2 : TEXT.hint} />
        </View>
        <Text style={[styles.cardLabel, selected && { color: G2 }]}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  )
}

function Chip({
  label, sub, selected, onPress,
}: {
  label: string; sub?: string; selected: boolean; onPress: () => void
}) {
  const scale = useRef(new Animated.Value(1)).current
  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.spring(scale,  { toValue: 1,    tension: 300, friction: 10, useNativeDriver: true }),
    ]).start()
    onPress()
  }
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity style={[styles.chip, selected && styles.chipSelected]} onPress={handlePress} activeOpacity={1}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.chipLabel, selected && { color: G2 }]}>{label}</Text>
          {sub ? <Text style={styles.chipSub}>{sub}</Text> : null}
        </View>
        {selected
          ? <View style={styles.checkBadge}><Ionicons name="checkmark" size={13} color="#fff" /></View>
          : <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: SBORDER }} />
        }
      </TouchableOpacity>
    </Animated.View>
  )
}

// ════════════════════════════════════════════════════════════════
// ダーク緑クエスト画面用（2026-09-07 Codex案スタイル・目的/種目/状態チェック/結果で使用）
// ════════════════════════════════════════════════════════════════

function DarkProgressHeader({ step, onBack, showBack }: { step: number; onBack: () => void; showBack: boolean }) {
  return (
    <View style={ds.progressHeader}>
      {showBack ? (
        <TouchableOpacity onPress={onBack} style={ds.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
      ) : <View style={{ width: 36 }} />}
      <View style={ds.progressTrack}>
        <Animated.View style={[ds.progressFill, { width: `${(step / QUIZ_STEPS) * 100}%` }]} />
      </View>
      <View style={{ width: 36 }} />
    </View>
  )
}

// 目的選択・チーム選択カード（白背景=選択済み／半透明白=未選択）
function DarkChoiceCard({ icon, title, sub, selected, onPress, tag }: {
  icon: keyof typeof Ionicons.glyphMap; title: string; sub?: string; selected: boolean; onPress: () => void; tag?: string
}) {
  const scale = useRef(new Animated.Value(1)).current
  const handlePress = () => {
    Animated.timing(scale, { toValue: 1.02, duration: 180, useNativeDriver: true }).start(() => {
      Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }).start()
    })
    onPress()
  }
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        style={[ds.choiceCard, selected && ds.choiceCardSelected]}
        onPress={handlePress}
        activeOpacity={1}
      >
        <View style={[ds.choiceIconWrap, selected && ds.choiceIconWrapSelected]}>
          <Ionicons name={icon} size={20} color={selected ? '#166534' : '#fff'} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[ds.choiceTitle, selected && ds.choiceTitleSelected]}>{title}</Text>
            {tag ? (
              <View style={[ds.choiceTag, selected && ds.choiceTagSelected]}>
                <Text style={[ds.choiceTagText, selected && ds.choiceTagTextSelected]}>{tag}</Text>
              </View>
            ) : null}
          </View>
          {sub ? <Text style={[ds.choiceSub, selected && ds.choiceSubSelected]}>{sub}</Text> : null}
        </View>
        {selected && <Ionicons name="checkmark-circle" size={20} color="#166534" />}
      </TouchableOpacity>
    </Animated.View>
  )
}

// 種目ジャンル・状態チェックのピル（横並び・タップのみ）
function DarkPill({ label, selected, onPress, widthPct }: { label: string; selected: boolean; onPress: () => void; widthPct?: string }) {
  const scale = useRef(new Animated.Value(1)).current
  const handlePress = () => {
    Animated.timing(scale, { toValue: 1.02, duration: 180, useNativeDriver: true }).start(() => {
      Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }).start()
    })
    onPress()
  }
  return (
    <Animated.View style={[{ transform: [{ scale }] }, widthPct ? { width: widthPct as any } : undefined]}>
      <TouchableOpacity style={[ds.pill, selected && ds.pillSelected]} onPress={handlePress} activeOpacity={1}>
        <Text style={[ds.pillText, selected && ds.pillTextSelected]} numberOfLines={1}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  )
}

// 下部固定・白カプセルCTA
function DarkCTAButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const scale = useRef(new Animated.Value(1)).current
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={1}
      onPressIn={() => Animated.timing(scale, { toValue: 0.98, duration: 120, useNativeDriver: true }).start()}
      onPressOut={() => Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }).start()}
    >
      <Animated.View style={[ds.ctaBtn, disabled && ds.ctaBtnDisabled, { transform: [{ scale }] }]}>
        <Text style={[ds.ctaText, disabled && ds.ctaTextDisabled]}>{label}</Text>
      </Animated.View>
    </TouchableOpacity>
  )
}

// ════════════════════════════════════════════════════════════════
// メイン
// ════════════════════════════════════════════════════════════════

export default function OnboardingScreen() {
  const router  = useRouter()
  const { t } = useTranslation()
  const { user, isGuest, setOnboarded } = useAuth()
  const { language } = useLanguage()

  const CATEGORIES = buildCategories(t)
  const GOAL_OPTIONS = buildGoalOptions(t)
  const EXPERIENCE_OPTIONS = buildExperienceOptions(t)
  const STEP_HEADLINE = buildStepHeadline(t)
  const STEP_SUB = buildStepSub(t)
  const PROCESSING_ITEMS = t('onboarding.processing.items', { returnObjects: true }) as string[]

  // 2026-09-07: Codex実装指示で一度はメインフローから撤去したIntroCarouselだが、
  // 丸い怪我リスクメーター+長押しCTAへ全面刷新したことでユーザーが「これも最初の画面に
  // 戻したい」と判断したため、再度エントリーポイントに戻す。
  const [phase, setPhase] = useState<'intro' | 'quiz' | 'processing' | 'reveal' | 'goals'>('intro')
  const [step,       setStep]       = useState(1)   // クエスト内: 1(目的)-2(種目)-3(状態チェック)
  const [goal,       setGoal]       = useState<'' | 'pb' | 'injury_free' | 'competition' | 'team'>('')
  const [name,       setName]       = useState('')
  const [category,   setCategory]   = useState<string>('sprint')
  const [event,      setEvent]      = useState<AthleticsEvent | ''>('100m')
  const [practice,   setPractice]   = useState<YesterdayPractice | ''>('')
  const [fatigue,    setFatigue]    = useState<FatigueLevel | ''>('')
  const [sleepBand,  setSleepBand]  = useState<SleepBand | ''>('')
  const [hasPain,    setHasPain]    = useState(false)
  const [readiness,  setReadiness]  = useState<OnboardingReadinessResult | null>(null)
  const [experience, setExperience] = useState<number>(2)
  const [age,        setAge]        = useState('')
  const [pb,         setPb]         = useState('')
  const [prefecture, setPrefecture] = useState('')
  const [processingIdx, setProcessingIdx] = useState(0)

  const fadeAnim   = useRef(new Animated.Value(1)).current
  const revealPop  = useRef(new Animated.Value(0)).current
  const readinessFill = useRef(new Animated.Value(0)).current
  const adviceFade = useFadeUp(phase === 'reveal', 650)
  const isAnimating = useRef(false)

  // ── 準備中画面（processing）の演出用 ─────────────────────────
  const processingProgress = useRef(new Animated.Value(0)).current
  const ringRotate = useRef(new Animated.Value(0)).current
  const rowAnims = useRef(
    Array.from({ length: PROCESSING_ITEMS.length }, () => new Animated.Value(0))
  ).current
  const ringRotateDeg = ringRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })

  useEffect(() => {
    if (phase !== 'processing') return
    ringRotate.setValue(0)
    const loop = Animated.loop(
      Animated.timing(ringRotate, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true })
    )
    loop.start()
    return () => loop.stop()
  }, [phase])

  // 2026-09-09: 「キャラの動き」フィードバックで追加。intro画面のマスコット浮遊ループ
  // (mascotFloat)と同じ振れ幅・タイミングをこちらにも流用している。
  const processingMascotFloat = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (phase !== 'processing') return
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(processingMascotFloat, { toValue: -6, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(processingMascotFloat, { toValue: 0,  duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [phase])

  const transition = useCallback((action: () => void) => {
    if (isAnimating.current) return
    isAnimating.current = true
    Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      action()
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start(() => {
        isAnimating.current = false
      })
    })
  }, [fadeAnim])

  const goNext = useCallback((nextStep: number) => {
    unlockAudio(); Sounds.pop()
    transition(() => setStep(nextStep))
  }, [transition])

  const goBack = useCallback(() => {
    if (step <= 1) { unlockAudio(); Sounds.tap(); setPhase('intro'); return }
    Sounds.tap()
    transition(() => setStep(s => s - 1))
  }, [step, transition])

  const handleCategorySelect = useCallback((key: string) => {
    Sounds.tap()
    if (key !== category) { setCategory(key); setEvent('') }
  }, [category])

  // ── 準備中演出（自動進行） ─────────────────────────────────
  useEffect(() => {
    if (phase !== 'processing') return
    setProcessingIdx(0)
    processingProgress.setValue(0)
    rowAnims.forEach(a => a.setValue(0))
    const timers: ReturnType<typeof setTimeout>[] = []
    PROCESSING_ITEMS.forEach((_, i) => {
      timers.push(setTimeout(() => {
        setProcessingIdx(i + 1)
        Sounds.tap()
        Animated.timing(processingProgress, {
          toValue: (i + 1) / PROCESSING_ITEMS.length, duration: 420,
          easing: Easing.out(Easing.cubic), useNativeDriver: false,
        }).start()
        Animated.spring(rowAnims[i], { toValue: 1, tension: 300, friction: 12, useNativeDriver: true }).start()
      }, 550 + i * 650))
    })
    timers.push(setTimeout(() => {
      Sounds.save()
      revealPop.setValue(0)
      setPhase('reveal')
    }, 550 + PROCESSING_ITEMS.length * 650 + 350))
    return () => timers.forEach(clearTimeout)
  }, [phase])

  useEffect(() => {
    if (phase !== 'reveal') return
    trackOnboardingStep('readiness_viewed', goal === 'team' ? { team: true } : { score: readiness?.score, band: readiness?.band })
    Animated.spring(revealPop, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }).start()
    readinessFill.setValue(0)
    Animated.timing(readinessFill, {
      toValue: 1, duration: 900, delay: 250,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start()
  }, [phase])

  const handleFinish = useCallback(async () => {
    unlockAudio(); Sounds.save()

    const profile = {
      id: user?.id ?? 'guest',
      name: name.trim() || (user?.email?.split('@')[0] ?? t('onboarding.defaultAthleteName')),
      primary_event: event || '100m',
      event_category: (category || 'sprint') as EventCategory,
      secondary_events: [],
      age: age ? Number(age) : undefined,
      experience_years: experience >= 0 ? experience : undefined,
      personal_best_ms: pb.trim() ? (parsePbToMs(pb.trim()) ?? undefined) : undefined,
      target_time_ms: undefined as number | undefined,
      prefecture: prefecture || undefined,
      created_at: new Date().toISOString(),
    }

    await AsyncStorage.setItem('trackmate_my_profile', JSON.stringify(profile)).catch(() => {})

    if (user?.id) {
      try {
        const { supabase: sb } = await import('../lib/supabase')
        await sb.from('profiles').upsert({
          user_id: user.id,
          name: profile.name,
          primary_event: profile.primary_event,
          event_category: profile.event_category,
          age: profile.age ?? null,
          experience_years: profile.experience_years ?? null,
          prefecture: prefecture || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }).then(() => {})
      } catch { /* 同期失敗はサイレント */ }
    }

    const authed = !!user?.id || isGuest
    await setOnboarded()
    // 2026-09-11: オンボーディング完了時の即時5枚付与(grantStarterTicketsIfNeeded)は撤去。
    // 3日間ミッション(lib/missionStore.ts)のDay1報酬(🎫5枚)が実質的に置き換わっており、
    // 両方残すと初日だけ実質10枚(5+5)の二重付与になってしまう。
    // 将来のホーム画面パーソナライズ用に目的を保存（現時点では読み出し側は未実装）
    await AsyncStorage.setItem('trackmate_onboarding_goal', goal || 'pb').catch(() => {})
    if (!authed) {
      router.replace('/auth')
    } else if (goal === 'team') {
      // 2026-09-09訂正: 2026-09-07時点では app/team-invite.tsx を「既存のチーム作成・
      // 招待コード発行画面」として使っていたが、これはSupabaseに一切接続していない
      // ローカルストレージのみのプロトタイプだった（招待コードはAsyncStorageに保存する
      // だけ、参加ボタンも実在確認なしで常に成功トーストを出すだけ）。新規コーチ全員が
      // この偽画面に着地していたため、本物のSupabase連携チーム作成・ダッシュボード機能
      // (RoleSelectionScreen→CoachSetupScreen、createTeam()でSupabaseに実登録)を持つ
      // app/(tabs)/team.tsx へ着地先を修正した。
      // 2026-09-14: 「コーチ選択画面から新オンボーディング(コードお持ちの方/まだの方)を挟む」
      // 指示で変更。以前はteam.tsxへ直接着地させていたが、コーチプランは外部決済+コード
      // 引き換え方式に変わったため、まずapp/coach-onboarding.tsxのゲートを通す
      // (既にisCoachなら同画面が自動でteam.tsxへスキップする)。
      router.replace('/coach-onboarding' as any)
    } else {
      // 2026-09-07: 到達後に全画面を自動的に再説明する旧チュートリアルの自動起動はここでも廃止。
      // ホーム画面には常駐の<FirstRunChecklist/>が表示される（app/(tabs)/index.tsx）。
      trackOnboardingStep('home_reached')
      router.replace('/(tabs)')
    }
  }, [name, event, category, experience, age, pb, prefecture, goal, user, isGuest, setOnboarded, router])

  const canNextStep1 = goal !== ''
  const canNextStep2 = event !== ''
  const canNextStep3 = practice !== '' && fatigue !== '' && sleepBand !== ''

  // ── イントロカルーセル ────────────────────────────────────
  if (phase === 'intro') {
    return <IntroCarousel onFinish={() => { unlockAudio(); Sounds.pop(); setPhase('quiz') }} />
  }

  // ── 準備中演出 ────────────────────────────────────────────
  if (phase === 'processing') {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <SafeAreaView style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ maxWidth: 600, alignSelf: 'center', width: '100%', paddingHorizontal: 32, alignItems: 'center' }}>
            {/* 2026-09-09: 「キャラの動き／サイズ・位置／チェックリストのデザイン」フィードバックで更新。
                キャラを拡大しintro同様に浮遊させつつ、リングと重ならないようmarginBottomで間隔を確保。
                チェックリストはmitameプレビューのB案（項目ごとに白いピル型カード）を採用。 */}
            <Animated.Image
              source={MASCOT_ONBOARDING_THINKING}
              style={[styles.processingMascot, { transform: [{ translateY: processingMascotFloat }] }]}
              resizeMode="contain"
            />
            <ProcessingRing progress={processingProgress} rotateDeg={ringRotateDeg} />
            <Text style={[styles.processingTitle, { marginTop: 20 }]}>{t('onboarding.processing.title')}</Text>
            <Text style={styles.processingStepCount}>{processingIdx} / {PROCESSING_ITEMS.length}</Text>
            <View style={{ marginTop: 26, width: '100%' }}>
              {PROCESSING_ITEMS.map((item, i) => {
                const isDone = i < processingIdx
                const isActive = i === processingIdx
                return (
                  <View key={item} style={styles.processRow}>
                    {isDone ? (
                      <Animated.View style={[styles.processDone, { transform: [{ scale: rowAnims[i] }] }]}>
                        <Ionicons name="checkmark" size={13} color="#fff" />
                      </Animated.View>
                    ) : isActive ? (
                      <ActiveDot />
                    ) : (
                      <View style={styles.processPending} />
                    )}
                    <Text style={[
                      styles.processText,
                      isDone && { color: TEXT.primary, fontWeight: '700' },
                      isActive && { color: G2, fontWeight: '700' },
                    ]}>
                      {item}
                    </Text>
                  </View>
                )
              })}
            </View>
          </View>
        </SafeAreaView>
      </View>
    )
  }

  // ── リビール ──────────────────────────────────────────────
  // 2026-09-07: 「プラン完成」ではなく正直に「初回チェック」と表現する。
  // 課金訴求はGradientButtonの下の1行(day7Line)のみ。Proボタンはここには置かない。
  if (phase === 'reveal') {
    if (goal === 'team') {
      return (
        <DarkScreenBg>
          <View style={{ flex: 1, maxWidth: 600, alignSelf: 'center', width: '100%' }}>
            <SafeAreaView edges={['top']}>
              <DarkProgressHeader step={QUIZ_STEPS} showBack={false} onBack={() => {}} />
            </SafeAreaView>
            <Animated.View
              style={{
                flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24,
                opacity: revealPop,
                transform: [{ scale: revealPop.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
              }}
            >
              <View style={[ds.choiceIconWrap, { width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)', marginBottom: 18 }]}>
                <Ionicons name="people" size={30} color="#fff" />
              </View>
              <View style={ds.readinessBadge}><Text style={ds.readinessBadgeText}>{t('onboarding.reveal.teamBadge')}</Text></View>
              <TypewriterText text={t('onboarding.reveal.teamTitle')} style={StyleSheet.flatten([ds.headline, { marginTop: 14 }])} triggerKey={phase} />
              <Text style={[ds.sub, { marginTop: 8 }]}>{t('onboarding.reveal.teamSub')}</Text>
            </Animated.View>
            <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: 24, paddingTop: 10 }}>
              {/* 2026-09-07: 'goals'画面は自己ベスト・競技歴など選手向けの項目しかなく
                  コーチには意味が無いため、チーム目的の場合はスキップして直接完了させる */}
              <DarkCTAButton label={t('onboarding.reveal.teamStartButton')} onPress={() => handleFinish()} />
            </SafeAreaView>
          </View>
        </DarkScreenBg>
      )
    }

    const score = readiness?.score ?? 0
    const band = readiness?.band ?? 'low'
    const hasPainReveal = readiness?.adviceKey === 'onboarding.condition.advice.pain'
    // 2026-09-07: 'low'帯の既定色(#166534)はダーク背景と同化するため、リビール画面表示専用に
    // ロー帯だけグロー色(#A7EE9C)へ差し替える。他画面(ホーム等)で使うREADINESS_BAND_COLOR自体は変更しない。
    const displayColor = band === 'low' ? '#A7EE9C' : READINESS_BAND_COLOR[band]
    const headlineKey = hasPainReveal ? 'pain' : band
    return (
      <DarkScreenBg>
        <View style={{ flex: 1, maxWidth: 600, alignSelf: 'center', width: '100%' }}>
          <SafeAreaView edges={['top']}>
            <DarkProgressHeader step={QUIZ_STEPS} showBack={false} onBack={() => {}} />
          </SafeAreaView>
          <Animated.View
            style={{
              flex: 1, justifyContent: 'center', paddingHorizontal: 24,
              opacity: revealPop,
              transform: [{ scale: revealPop.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
            }}
          >
            <Text style={ds.eyebrow}>{t('onboarding.reveal.eyebrow')}</Text>
            <TypewriterText text={t('onboarding.reveal.title')} style={StyleSheet.flatten([ds.headline, { marginTop: 6, marginBottom: 18 }])} triggerKey={phase} />

            <View style={ds.readinessRow}>
              <CountUpText value={score} duration={900} delay={250} triggerKey={phase} style={ds.readinessNum} />
              <Text style={ds.readinessMax}>/100</Text>
              <Animated.View style={[
                ds.readinessBadge,
                { backgroundColor: displayColor + '2E', borderColor: displayColor + '55' },
                adviceFade,
              ]}>
                <Text style={[ds.readinessBadgeText, { color: displayColor }]}>{t(`onboarding.condition.bandLabel.${band}`)}</Text>
              </Animated.View>
            </View>
            <View style={ds.scaleBarTrack}>
              <Animated.View style={[ds.scaleFill, {
                backgroundColor: displayColor,
                width: readinessFill.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${Math.min(100, Math.max(0, score))}%`] }),
              }]} />
            </View>
            <Text style={ds.honestCaption}>{t('onboarding.reveal.honestCaption')}</Text>

            <Animated.View style={[ds.adviceCard, adviceFade]}>
              <Text style={ds.adviceEyebrow}>{t(`onboarding.condition.headline.${headlineKey}`)}</Text>
              <TypewriterText text={readiness ? t(readiness.adviceKey) : ''} style={ds.adviceBody} delay={650} triggerKey={phase} />
            </Animated.View>
          </Animated.View>
          <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: 24, paddingTop: 10 }}>
            <DarkCTAButton label={t('onboarding.reveal.startButton')} onPress={() => handleFinish()} />
            <Text style={ds.day7Line}>{t('onboarding.reveal.day7Line')}</Text>
          </SafeAreaView>
        </View>
      </DarkScreenBg>
    )
  }

  // ── 目標設定（任意・スキップ可） ───────────────────────────
  // 旧クエストStep4（経験年数/年齢/地域/自己ベスト）+ 名前をここに移設。
  // 必須のオンボーディングからは完全に外れ、あとから設定でも変更できる。
  // 2026-09-07: Codex実装指示の必須4ステップ(目的→種目→状態チェック→結果)には
  // この画面を含めない方針のため、setPhase('goals')の呼び出し箇所は現在存在せず、
  // このphaseは到達不能（コードは削除せず温存。名前/年齢/自己ベスト/経験年数は
  // 現状すでにapp/settings.tsxから同等に設定可能なため、実質的な機能欠落はない）。
  if (phase === 'goals') {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={{ flex: 1, maxWidth: 600, alignSelf: 'center', width: '100%' }}>
          <SafeAreaView>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 18 }}>
              <TouchableOpacity onPress={() => { trackOnboardingStep('goal_saved', { skipped: true }); handleFinish() }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.skipText}>{t('onboarding.goalsScreen.later')}</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <IconBlob icon="person-outline" />
              <TypewriterText text={t('onboarding.goalsScreen.headline')} style={styles.headline} triggerKey={phase} />
              <Text style={styles.subline}>{t('onboarding.goalsScreen.sub')}</Text>

              <View style={{ gap: 22, marginTop: 22 }}>
                <View style={{ gap: 8 }}>
                  <Text style={styles.sectionLabel}>{t('onboarding.fields.nameLabel')}</Text>
                  <View style={styles.inputWrap}>
                    <Ionicons name="person-outline" size={18} color={TEXT.hint} />
                    <TextInput
                      style={styles.input}
                      placeholder={t('onboarding.namePlaceholder')}
                      placeholderTextColor={TEXT.hint}
                      value={name}
                      onChangeText={setName}
                      maxLength={20}
                    />
                  </View>
                </View>

                {goal !== 'team' && (
                  <View style={{ gap: 8 }}>
                    <Text style={styles.sectionLabel}>{t('onboarding.fields.pbLabel', { event: event ? getEventLabel(event, language) : t('onboarding.fields.pbLabelDefault') })}</Text>
                    <View style={styles.inputWrap}>
                      <Ionicons name="trophy-outline" size={18} color={TEXT.hint} />
                      <TextInput
                        style={styles.input}
                        placeholder={
                          category === 'field' ? t('onboarding.fields.pbPlaceholderField') :
                          (event?.startsWith('5') || event?.startsWith('10') || event?.includes('marathon'))
                            ? t('onboarding.fields.pbPlaceholderLong')
                            : event?.startsWith('8') || event === '1500m' || event === '3000m' || event === '3000mSC'
                            ? t('onboarding.fields.pbPlaceholderMiddle')
                            : t('onboarding.fields.pbPlaceholderShort')
                        }
                        placeholderTextColor={TEXT.hint}
                        value={pb}
                        onChangeText={setPb}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <Text style={styles.inputHint}>
                      {category === 'field' ? t('onboarding.fields.pbHintField') : t('onboarding.fields.pbHintTrack')}
                    </Text>
                  </View>
                )}

                <View style={{ gap: 10 }}>
                  <Text style={styles.sectionLabel}>{t('onboarding.fields.experienceLabel')}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {EXPERIENCE_OPTIONS.map(opt => (
                      <TouchableOpacity
                        key={opt.key}
                        style={[styles.expBtn, experience === opt.key && styles.expBtnActive]}
                        onPress={() => { setExperience(opt.key); Sounds.tap() }}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.expLabel, experience === opt.key && { color: G2 }]}>{opt.label}</Text>
                        <Text style={[styles.expSub, experience === opt.key && { color: G2 }]}>{opt.sub}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={{ gap: 8 }}>
                  <Text style={styles.sectionLabel}>{t('onboarding.fields.ageLabel')}</Text>
                  <View style={styles.inputWrap}>
                    <Ionicons name="calendar-outline" size={18} color={TEXT.hint} />
                    <TextInput
                      style={styles.input}
                      placeholder={t('onboarding.fields.agePlaceholder')}
                      placeholderTextColor={TEXT.hint}
                      value={age}
                      onChangeText={v => setAge(v.replace(/\D/g, ''))}
                      keyboardType="number-pad"
                      maxLength={3}
                    />
                    <Text style={{ color: TEXT.hint, fontSize: 14 }}>{t('onboarding.fields.ageUnit')}</Text>
                  </View>
                </View>

                <View style={{ gap: 8 }}>
                  <Text style={styles.sectionLabel}>{t('onboarding.fields.regionLabel')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'nowrap', gap: 0, paddingHorizontal: 4 }}>
                      {PREFS_BY_REGION.map(({ region, prefs }) => (
                        <View key={region} style={{ marginRight: 14 }}>
                          <Text style={{ fontSize: 10, color: TEXT.hint, fontWeight: '700', marginBottom: 4 }}>{getRegionLabel(region, language)}</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, maxWidth: prefs.length <= 2 ? 90 : 200 }}>
                            {prefs.map(p => (
                              <TouchableOpacity
                                key={p}
                                onPress={() => { setPrefecture(prefecture === p ? '' : p); Sounds.tap() }}
                                style={{
                                  paddingHorizontal: 10, paddingVertical: 5,
                                  borderRadius: 8, borderWidth: 1.5,
                                  borderColor: prefecture === p ? G1 : SBORDER,
                                  backgroundColor: prefecture === p ? TINT : '#fff',
                                }}
                              >
                                <Text style={{ fontSize: 12, fontWeight: '600', color: prefecture === p ? G2 : TEXT.secondary }}>{getPrefectureLabel(p, language)}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                  <Text style={styles.inputHint}>{t('onboarding.fields.regionHint')}</Text>
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>

          <SafeAreaView edges={['bottom']}>
            <View style={styles.bottomBar}>
              <GradientButton label={t('onboarding.goalsScreen.saveButton')} icon="checkmark" onPress={() => { trackOnboardingStep('goal_saved', { skipped: false, hasPb: !!pb.trim() }); handleFinish() }} />
            </View>
          </SafeAreaView>
        </View>
      </View>
    )
  }

  // ── クエスト（目的・種目・状態チェック／ダーク緑デザイン） ──────
  return (
    <DarkScreenBg>
      <View style={{ flex: 1, maxWidth: 600, alignSelf: 'center', width: '100%' }}>
        <SafeAreaView edges={['top']}>
          <DarkProgressHeader step={step} showBack onBack={goBack} />
        </SafeAreaView>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
            <ScrollView contentContainerStyle={ds2.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={ds.eyebrow}>{`STEP ${step} OF ${QUIZ_STEPS + 1}`}</Text>
              <TypewriterText text={STEP_HEADLINE[step]} style={ds.headline} triggerKey={step} />
              <Text style={ds.sub}>{STEP_SUB[step]}</Text>

              {step === 1 && (
                <View style={{ gap: 10, marginTop: 24 }}>
                  {GOAL_OPTIONS.map(g => (
                    <DarkChoiceCard
                      key={g.key} icon={g.icon} title={g.label} sub={g.sub}
                      tag={g.key === 'team' ? t('onboarding.goals.team.tag') : undefined}
                      selected={goal === g.key} onPress={() => { setGoal(g.key as any); Sounds.tap() }}
                    />
                  ))}
                </View>
              )}

              {step === 2 && (
                <View style={{ marginTop: 24, gap: 22 }}>
                  <View style={{ gap: 10 }}>
                    <Text style={ds2.sectionLabel}>{t('onboarding.fields.genreLabel')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {CATEGORIES.map(c => (
                        <DarkPill key={c.key} label={c.label} selected={category === c.key} onPress={() => handleCategorySelect(c.key)} widthPct="48%" />
                      ))}
                    </View>
                  </View>
                  <View style={{ gap: 8 }}>
                    <Text style={ds2.sectionLabel}>{t('onboarding.fields.eventLabel')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {(EVENTS_BY_CATEGORY[category] ?? EVENTS_BY_CATEGORY.sprint).map(e => (
                        <DarkPill key={e.key} label={getEventLabel(e.key, language)} selected={event === e.key} onPress={() => { setEvent(e.key); Sounds.tap() }} />
                      ))}
                    </View>
                  </View>
                </View>
              )}

              {step === 3 && (
                <View style={{ marginTop: 24, gap: 20 }}>
                  <View style={{ gap: 8 }}>
                    <Text style={ds2.sectionLabel}>{t('onboarding.condition.practiceLabel')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {PRACTICE_OPTIONS.map(o => (
                        <DarkPill key={o.key} label={t(o.labelKey)} selected={practice === o.key} onPress={() => { setPractice(o.key); Sounds.tap() }} widthPct="48%" />
                      ))}
                    </View>
                  </View>

                  <View style={{ gap: 8 }}>
                    <Text style={ds2.sectionLabel}>{t('onboarding.condition.fatigueLabel')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {FATIGUE_OPTIONS.map(o => (
                        <DarkPill key={o.key} label={t(o.labelKey)} selected={fatigue === o.key} onPress={() => { setFatigue(o.key); Sounds.tap() }} widthPct="31%" />
                      ))}
                    </View>
                  </View>

                  <View style={{ gap: 8 }}>
                    <Text style={ds2.sectionLabel}>{t('onboarding.condition.sleepLabel')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {SLEEP_OPTIONS.map(o => (
                        <DarkPill key={o.key} label={t(o.labelKey)} selected={sleepBand === o.key} onPress={() => { setSleepBand(o.key); Sounds.tap() }} widthPct="48%" />
                      ))}
                    </View>
                  </View>

                  <View style={{ gap: 8 }}>
                    <Text style={ds2.sectionLabel}>{t('onboarding.condition.painLabel')}</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity style={[ds.ynBtn, !hasPain && ds.ynBtnSelected]} onPress={() => { setHasPain(false); Sounds.tap() }} activeOpacity={1}>
                        <Text style={[ds.ynBtnText, !hasPain && ds.ynBtnTextSelected]}>{t('onboarding.condition.painNo')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[ds.ynBtn, hasPain && ds.ynBtnWarnSelected]} onPress={() => { setHasPain(true); Sounds.tap() }} activeOpacity={1}>
                        <Text style={[ds.ynBtnText, hasPain && ds.ynBtnTextWarn]}>{t('onboarding.condition.painYes')}</Text>
                      </TouchableOpacity>
                    </View>
                    {hasPain && (
                      <View style={ds.medWarn}>
                        <Text style={ds.medWarnText}>{t('onboarding.condition.medDisclaimer')}</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>

        <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: 24, paddingTop: 10 }}>
          <DarkCTAButton
            label={step === QUIZ_STEPS ? t('onboarding.quiz.createPlan') : t('onboarding.quiz.next')}
            disabled={(step === 1 && !canNextStep1) || (step === 2 && !canNextStep2) || (step === 3 && !canNextStep3)}
            onPress={() => {
              if (step === 1) {
                if (!canNextStep1) return
                trackOnboardingStep('goal_selected', { goal })
                // 「チームを管理したい」は種目選択・状態チェックをスキップして直接演出へ
                if (goal === 'team') { unlockAudio(); Sounds.pop(); setPhase('processing'); return }
                goNext(2); return
              }
              if (step === 2) {
                if (!canNextStep2) return
                trackOnboardingStep('event_selected', { category, event })
                trackOnboardingStep('baseline_started')
                goNext(3); return
              }
              if (step === 3) {
                if (!canNextStep3) return
                trackOnboardingStep('baseline_completed', { practice, fatigue, sleep: sleepBand, hasPain })
                setReadiness(computeOnboardingReadiness({
                  practice: practice as YesterdayPractice, fatigue: fatigue as FatigueLevel, sleep: sleepBand as SleepBand, hasPain,
                }))
                unlockAudio(); Sounds.pop(); setPhase('processing')
              }
            }}
          />
        </SafeAreaView>
      </View>
    </DarkScreenBg>
  )
}

// ── PBをミリ秒に変換 ─────────────────────────────────────
function parsePbToMs(input: string): number | null {
  const mMatch = input.match(/^(\d+):(\d+(?:\.\d+)?)$/)
  if (mMatch) return Math.round((parseInt(mMatch[1], 10) * 60 + parseFloat(mMatch[2])) * 1000)
  const sMatch = input.match(/^\d+(?:\.\d+)?$/)
  if (sMatch) return Math.round(parseFloat(input) * 1000)
  return null
}

// ════════════════════════════════════════════════════════════════
// スタイル
// ════════════════════════════════════════════════════════════════

// ── イントロカルーセル用（旧auth.tsxより移設） ──────────────
const sl = StyleSheet.create({
  scrollContent: { flexGrow: 1, minHeight: '100%' as any },
  // メーターが画面のだいたい中央に来るよう、コンテンツ全体を縦中央寄せに変更(旧:flex-end)
  heroContent:   { flex: 1, padding: 28, paddingTop: 80, paddingBottom: 16, justifyContent: 'center' },
  slideInner:    { padding: 26, paddingTop: 64, paddingBottom: 48 },
  gridLine:   { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(0,0,0,0.03)' },
  logoRow:    { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 36 },
  // 2026-09-07: 「最初の画面だけ白背景ベース」の指示により、この1画面(IntroSlide1)だけ
  // ライトテーマに戻した。他のオンボーディング画面(目的選択等)はダークグリーンのまま。
  // ロゴマークは元の緑地に白文字（白背景と同化しないよう）。
  logoMark:   { width: 56, height: 56, borderRadius: 16, backgroundColor: G2, alignItems: 'center', justifyContent: 'center' },
  logoS:      { color: '#fff', fontSize: 30, fontWeight: '900' },
  logoName:   { color: TEXT.primary, fontSize: 26, fontWeight: '900', letterSpacing: -1 },
  logoTagline:{ color: TEXT.hint, fontSize: 10, fontWeight: '600', letterSpacing: 1.5 },
  // 2026-09-09: マスコットが喋っている風の吹き出しレイアウト（mitame案A→再プレビューでA案「ぷっくり」に更新）。
  // 「AIっぽすぎる」「文字がガタガタ」というフィードバックを受け、緑タブの半透明box＋三角尻尾
  // をやめ、白ベース＋影で立体的な「ぷっくり」吹き出しに変更。尻尾も三角でなく大小2つの丸
  // （漫画の思考吹き出し風）にした。
  heroSpeechRow:    { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 28 },
  heroMascot:       { width: 92, height: 154, marginRight: 6 },
  heroBubbleWrap:   { flex: 1, position: 'relative', marginTop: 6 },
  heroBubble:       {
    backgroundColor: '#ffffff', borderRadius: 26, paddingHorizontal: 18, paddingVertical: 16,
    shadowColor: G2, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.14, shadowRadius: 18,
    elevation: 6,
  },
  heroBubbleTitle:  { color: TEXT.primary, fontSize: 19, fontWeight: '900', letterSpacing: -0.3, lineHeight: 25, marginBottom: 6 },
  heroBubbleSub:    { color: TEXT.secondary, fontSize: 12.5, lineHeight: 19 },
  // ぷっくり吹き出しの尻尾（三角ではなく大小2つの丸。キャラが左にいるので左向きに配置）
  heroDotBig:       {
    position: 'absolute', left: -20, top: 40, width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#ffffff',
    shadowColor: G2, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 3,
  },
  heroDotSmall:     {
    position: 'absolute', left: -30, top: 56, width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#ffffff',
    shadowColor: G2, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 5, elevation: 2,
  },
  scoreRow:   { flexDirection: 'row', gap: 10, marginBottom: 20 },
  scoreBadge: { flex: 1, backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', padding: 14, alignItems: 'center', gap: 4 },
  scoreVal:   { fontSize: 24, fontWeight: '900' },
  scoreLabel: { color: '#888', fontSize: 9, fontWeight: '700', textAlign: 'center', letterSpacing: 0.3 },
  hintText:   { color: TEXT.hint, fontSize: 12 },
  // ── 丸い怪我リスクメーター＋長押しCTA（2026-09-07・白背景版） ──
  meterNum:      { fontFamily: 'Barlow Condensed', fontSize: 44, fontWeight: '800' },
  meterNumLabel: { color: TEXT.hint, fontSize: 11, fontWeight: '700', marginTop: 2, letterSpacing: 0.5 },
  meterCtaHit:   { width: METER_SIZE - 40, height: METER_SIZE - 40, borderRadius: (METER_SIZE - 40) / 2, alignItems: 'center', justifyContent: 'center', gap: 4 },
  meterCtaText:  { color: G2, fontSize: 12.5, fontWeight: '800', textAlign: 'center', maxWidth: 110 },
  // 長押しで広がるカバーは次画面(ダークグリーン)への橋渡しなので緑のまま
  holdCover:     { position: 'absolute', backgroundColor: G2 },
  holdHintText:  { color: TEXT.hint, fontSize: 11.5, marginTop: 14, textAlign: 'center' },
  tag:         { color: '#9ca3af', fontSize: 10, fontWeight: '800', letterSpacing: 2.5, marginBottom: 10 },
  sectionTitle:{ color: '#111827', fontSize: 27, fontWeight: '900', letterSpacing: -0.8, marginBottom: 10 },
  sectionSub:  { color: '#6b7280', fontSize: 14, lineHeight: 22 },
})
const nav = StyleSheet.create({
  bar:      { paddingHorizontal: 24, paddingBottom: 14, paddingTop: 14, backgroundColor: 'transparent' },
  dotsRow:  { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 14 },
  dot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive:{ backgroundColor: '#fff', width: 22 },
  btnRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  backText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600' },
  nextBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 50, paddingVertical: 14, paddingHorizontal: 24, backgroundColor: '#fff' },
  nextText: { color: G2, fontWeight: '900', fontSize: 14 },
})

// ── クエスト用（ソフトグリーン） ─────────────────────────────
const styles = StyleSheet.create({
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 4 },
  backBtn:   { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { flex: 1, height: 5, backgroundColor: '#eceae4', borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 3 },
  skipText:  { color: TEXT.hint, fontSize: 12, fontWeight: '700' },

  blobWrap: { alignItems: 'center', marginTop: 22 },
  blob:     { width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(22,101,52,0.10)', alignItems: 'center', justifyContent: 'center' },

  headline: { fontSize: 21, fontWeight: '900', color: TEXT.primary, textAlign: 'center', marginTop: 18, lineHeight: 29, letterSpacing: -0.3 },
  subline:  { fontSize: 12.5, color: TEXT.secondary, textAlign: 'center', marginTop: 8, lineHeight: 18, paddingHorizontal: 6 },
  sectionLabel: { color: TEXT.hint, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },

  content:    { padding: 24, paddingTop: 8, paddingBottom: 40, flexGrow: 1 },

  card: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: SBORDER, borderRadius: 18, paddingVertical: 16, paddingHorizontal: 10, alignItems: 'center' },
  cardSelected: { backgroundColor: TINT, borderColor: G1, borderWidth: 2 },
  cardAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  cardAvatarSelected: { backgroundColor: '#dcfce7' },
  cardLabel: { fontSize: 12.5, fontWeight: '800', color: TEXT.primary },

  chip: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 15, borderWidth: 1.5, borderColor: SBORDER },
  chipSelected: { backgroundColor: TINT, borderColor: G1 },
  chipLabel: { color: TEXT.primary, fontSize: 15, fontWeight: '700' },
  chipSub:   { color: TEXT.hint, fontSize: 12, marginTop: 2 },
  checkBadge: { width: 20, height: 20, borderRadius: 10, backgroundColor: G1, alignItems: 'center', justifyContent: 'center' },

  expBtn: { flex: 1, minWidth: '45%', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: SBORDER, gap: 3 },
  expBtnActive:  { backgroundColor: TINT, borderColor: G1 },
  expLabel:      { color: TEXT.primary, fontSize: 14, fontWeight: '700' },
  expSub:        { color: TEXT.hint, fontSize: 11 },

  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fafaf8', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 15, borderWidth: 1.5, borderColor: SBORDER },
  input:     { flex: 1, color: TEXT.primary, fontSize: 16, outlineStyle: 'none' as any },
  inputHint: { color: TEXT.hint, fontSize: 11, paddingLeft: 4 },

  bottomBar: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 8 },
  gradientBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 50, paddingVertical: 17,
    shadowColor: G2, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 16, elevation: 6 },
  gradientBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },

  revealIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  doneBadge: { marginTop: 14, backgroundColor: TINT, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  doneBadgeText: { color: G2, fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  revealTitle: { fontSize: 22, fontWeight: '900', color: TEXT.primary, textAlign: 'center', marginTop: 14, lineHeight: 30 },

  // ── リビール（初回チェック・2026-09-07新設） ────────────────
  readinessEyebrow: { fontSize: 12, fontWeight: '800', color: TEXT.hint, letterSpacing: 1.2, textAlign: 'center', marginBottom: 10 },
  readinessRow:     { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6, marginBottom: 14 },
  readinessNum:     { fontSize: 52, fontWeight: '900', color: TEXT.primary, letterSpacing: -1.5 },
  readinessMax:     { fontSize: 15, fontWeight: '700', color: TEXT.hint, marginRight: 8 },
  readinessBadge:   { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  readinessBadgeText: { fontSize: 12, fontWeight: '800' },
  scaleBarTrack:    { height: 8, borderRadius: 4, backgroundColor: '#f0f0f0', overflow: 'hidden' },
  scaleFill:        { height: '100%', borderRadius: 4 },
  honestCaption:    { fontSize: 11.5, color: TEXT.hint, textAlign: 'center', lineHeight: 18, marginTop: 10, marginBottom: 22 },
  adviceCard:       { backgroundColor: '#14532d', borderRadius: 20, padding: 18 },
  adviceEyebrow:    { fontSize: 10.5, fontWeight: '800', color: '#86efac', letterSpacing: 1, marginBottom: 6 },
  adviceBody:       { fontSize: 14.5, fontWeight: '700', color: '#fff', lineHeight: 22 },
  day7Line:         { textAlign: 'center', fontSize: 11, color: TEXT.hint, marginTop: 12, lineHeight: 17, paddingHorizontal: 12 },

  // 2026-09-09: 「キャラのサイズ・位置」フィードバックで拡大（64×110→108×186）。
  // リングと重ならないよう、以前のmarginBottom:2ではなく明示的な間隔(18)を確保している。
  processingMascot: { width: 108, height: 186, marginBottom: 18 },
  processingTitle: { fontSize: 19, fontWeight: '900', color: TEXT.primary, textAlign: 'center' },
  processingStepCount: { fontSize: 12, fontWeight: '700', color: TEXT.hint, marginTop: 4, fontVariant: ['tabular-nums'] },
  // 2026-09-09: 「チェックリストのデザイン」フィードバックで、mitameプレビューB案
  // （項目ごとに白いピル型カード＋影）を採用。
  processRow:     {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#ffffff', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12,
    marginBottom: 10,
    shadowColor: G2, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.10, shadowRadius: 12,
    elevation: 3,
  },
  processDone:    { width: 22, height: 22, borderRadius: 11, backgroundColor: G1, alignItems: 'center', justifyContent: 'center' },
  processActive:  { width: 22, height: 22, borderRadius: 11, backgroundColor: G1, opacity: 0.4 },
  processPending: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: SBORDER },
  processText:    { fontSize: 13.5, color: TEXT.secondary },
})

// ── 今日の状態チェック（画面C・2026-09-07新設） ───────────────
const cs = StyleSheet.create({
  fatigueCard: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: 14,
    backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderColor: SBORDER,
  },
  fatigueCardSelected: { backgroundColor: G2, borderColor: G2 },
  fatigueLabel: { fontSize: 11.5, fontWeight: '700', color: TEXT.secondary },
  painBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 13,
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: SBORDER,
  },
  painBtnSelected: { backgroundColor: TINT, borderColor: G1 },
  painBtnSelectedWarn: { backgroundColor: '#fef2f2', borderColor: '#fca5a5' },
  painBtnText: { fontSize: 14, fontWeight: '700', color: TEXT.secondary },
  medWarn: {
    marginTop: 10, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a',
    borderRadius: 12, padding: 12,
  },
  medWarnText: { fontSize: 11.5, color: '#92400e', lineHeight: 18 },
})

// ── ダーク緑クエスト画面（目的/種目/状態チェック/結果）用スタイル ──
const ds = StyleSheet.create({
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 12 },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center',
  },
  progressTrack: { flex: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },

  eyebrow: { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.6)', letterSpacing: 1.5, textAlign: 'center' },
  headline: {
    fontFamily: 'Barlow Condensed', fontSize: 26, fontWeight: '800', color: '#fff',
    textAlign: 'center', lineHeight: 32, marginTop: 6,
  },
  sub: { fontSize: 13, color: 'rgba(255,255,255,0.72)', textAlign: 'center', lineHeight: 19, marginTop: 8, paddingHorizontal: 8 },

  choiceCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
  choiceCardSelected: { backgroundColor: '#fff', borderColor: '#fff' },
  choiceIconWrap: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  choiceIconWrapSelected: { backgroundColor: 'rgba(22,101,52,0.12)' },
  choiceTitle: { fontSize: 14.5, fontWeight: '800', color: '#fff' },
  choiceTitleSelected: { color: '#166534' },
  choiceSub: { fontSize: 11.5, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  choiceSubSelected: { color: 'rgba(22,101,52,0.65)' },
  choiceTag: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  choiceTagSelected: { backgroundColor: 'rgba(22,101,52,0.12)' },
  choiceTagText: { fontSize: 9.5, fontWeight: '800', color: '#fff' },
  choiceTagTextSelected: { color: '#166534' },

  pill: {
    paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
  pillSelected: { backgroundColor: '#fff', borderColor: '#fff' },
  pillText: { fontSize: 12.5, fontWeight: '700', color: '#fff' },
  pillTextSelected: { color: '#166534' },

  ctaBtn: {
    height: 54, borderRadius: 27, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 6, paddingHorizontal: 20,
  },
  ctaBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.25)' },
  ctaText: { fontSize: 15.5, fontWeight: '800', color: '#166534' },
  ctaTextDisabled: { color: 'rgba(255,255,255,0.6)' },

  ynBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
  ynBtnSelected: { backgroundColor: '#fff', borderColor: '#fff' },
  ynBtnWarnSelected: { backgroundColor: '#fecaca', borderColor: '#fecaca' },
  ynBtnText: { fontSize: 13.5, fontWeight: '700', color: '#fff' },
  ynBtnTextSelected: { color: '#166534' },
  ynBtnTextWarn: { color: '#991b1b' },
  medWarn: { marginTop: 10, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 12, padding: 12 },
  medWarnText: { fontSize: 11, color: '#fff', lineHeight: 17 },

  adviceCard: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 20, padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  adviceEyebrow: { fontSize: 10.5, fontWeight: '800', color: '#A7EE9C', letterSpacing: 1, marginBottom: 6 },
  adviceBody: { fontSize: 14.5, fontWeight: '700', color: '#fff', lineHeight: 22 },

  readinessRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6, marginBottom: 14 },
  readinessNum: { fontFamily: 'Barlow Condensed', fontSize: 56, fontWeight: '800', color: '#fff' },
  readinessMax: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
  readinessBadge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.2)' },
  readinessBadgeText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  scaleBarTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  scaleFill: { height: '100%', borderRadius: 4, backgroundColor: '#A7EE9C' },
  honestCaption: { fontSize: 11.5, color: 'rgba(255,255,255,0.65)', textAlign: 'center', lineHeight: 18, marginTop: 10, marginBottom: 22 },
  day7Line: { textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 14, lineHeight: 17, paddingHorizontal: 12 },
})
const ds2 = StyleSheet.create({
  content: { padding: 24, paddingTop: 12, paddingBottom: 40, flexGrow: 1 },
  sectionLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
})

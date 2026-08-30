// components/SplashAnimation.tsx — 起動時スプラッシュアニメーション

import React, { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View, Dimensions, Platform } from 'react-native'
import { Sounds } from '../lib/sounds'
import { useTranslation } from 'react-i18next'

const { width } = Dimensions.get('window')

interface Props {
  onFinish: () => void
}

export default function SplashAnimation({ onFinish }: Props) {
  const { t } = useTranslation()
  // ── アニメーション値 ──────────────────────────────
  const bgOpacity   = useRef(new Animated.Value(1)).current
  const logoScale   = useRef(new Animated.Value(0.6)).current
  const logoOpacity = useRef(new Animated.Value(0)).current
  const lineWidth   = useRef(new Animated.Value(0)).current
  const textY       = useRef(new Animated.Value(18)).current
  const textOpacity = useRef(new Animated.Value(0)).current
  const tagY        = useRef(new Animated.Value(10)).current
  const tagOpacity  = useRef(new Animated.Value(0)).current
  const dotScale1   = useRef(new Animated.Value(0)).current
  const dotScale2   = useRef(new Animated.Value(0)).current
  const dotScale3   = useRef(new Animated.Value(0)).current

  useEffect(() => {
    // ロゴ出現と同時にズーン効果音
    if (Platform.OS === 'web') {
      setTimeout(() => Sounds.splashBoom(), 80)
    }

    // 安全策: Web(React Native Web)ではuseNativeDriverを含むAnimated.sequenceの
    // 完了コールバックが発火しないことがあり、その場合アプリ本体が永久にスプラッシュの
    // 裏に隠れたままになる。一定時間で強制的に onFinish を呼ぶフォールバックを設ける。
    let finished = false
    const finish = () => { if (!finished) { finished = true; onFinish() } }
    const safety = Platform.OS === 'web' ? setTimeout(finish, 2500) : null

    Animated.sequence([
      // 1. ロゴマーク出現（スプリング）
      Animated.parallel([
        Animated.spring(logoScale, {
          toValue: 1, tension: 140, friction: 9, useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1, duration: 300, useNativeDriver: true,
        }),
      ]),

      // 2. 下線がスーッと伸びる
      Animated.timing(lineWidth, {
        toValue: 1, duration: 400,
        easing: Easing.out(Easing.cubic), useNativeDriver: false,
      }),

      // 3. "TrackMate" テキスト + タグライン 同時フェードイン
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 1, duration: 350, useNativeDriver: true,
        }),
        Animated.timing(textY, {
          toValue: 0, duration: 350,
          easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
        Animated.timing(tagOpacity, {
          toValue: 1, duration: 350, delay: 100, useNativeDriver: true,
        }),
        Animated.timing(tagY, {
          toValue: 0, duration: 350, delay: 100,
          easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
      ]),

      // 4. ドット3つが順番にポップ
      Animated.stagger(120, [
        Animated.spring(dotScale1, { toValue: 1, tension: 200, friction: 7, useNativeDriver: true }),
        Animated.spring(dotScale2, { toValue: 1, tension: 200, friction: 7, useNativeDriver: true }),
        Animated.spring(dotScale3, { toValue: 1, tension: 200, friction: 7, useNativeDriver: true }),
      ]),

      // 5. 少し待つ
      Animated.delay(500),

      // 6. 全体フェードアウト
      Animated.timing(bgOpacity, {
        toValue: 0, duration: 380,
        easing: Easing.in(Easing.cubic), useNativeDriver: true,
      }),
    ]).start(() => {
      if (safety) clearTimeout(safety)
      finish()
    })

    return () => { if (safety) clearTimeout(safety) }
  }, [])

  const dotDots = [dotScale1, dotScale2, dotScale3]

  return (
    <Animated.View style={[styles.container, { opacity: bgOpacity }]} pointerEvents="none">

      {/* グリッドライン（背景装飾） */}
      <View style={styles.gridWrap} pointerEvents="none">
        {[...Array(6)].map((_, i) => (
          <View key={i} style={[styles.gridLine, { left: `${(i + 1) * (100 / 7)}%` as any }]} />
        ))}
      </View>

      {/* 中央コンテンツ */}
      <View style={styles.center}>

        {/* ロゴマーク（S） */}
        <Animated.View style={[styles.logoMark, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
          <Text style={styles.logoLetter}>S</Text>
        </Animated.View>

        {/* sCORE テキスト */}
        <Animated.Text style={[styles.brand, { opacity: textOpacity, transform: [{ translateY: textY }] }]}>
          sCORE
        </Animated.Text>

        {/* アンダーライン */}
        <Animated.View style={[styles.line, {
          width: lineWidth.interpolate({ inputRange: [0, 1], outputRange: [0, 160] }),
        }]} />

        {/* タグライン */}
        <Animated.Text style={[styles.tag, { opacity: tagOpacity, transform: [{ translateY: tagY }] }]}>
          {t('splashAnimation.tagline')}
        </Animated.Text>

        {/* ドットインジケーター */}
        <View style={styles.dots}>
          {dotDots.map((s, i) => (
            <Animated.View key={i} style={[styles.dot, { transform: [{ scale: s }] }]} />
          ))}
        </View>
      </View>

      {/* 右下バージョン */}
      <Animated.Text style={[styles.version, { opacity: tagOpacity }]}>v1.0</Animated.Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  gridWrap: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  gridLine: {
    position: 'absolute',
    top: 0, bottom: 0, width: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  center: {
    alignItems: 'center',
    gap: 0,
  },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#166534',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
  },
  logoLetter: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1,
  },
  brand: {
    color: '#FFFFFF',
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: -2,
    marginBottom: 10,
  },
  line: {
    height: 2,
    backgroundColor: '#166534',
    borderRadius: 1,
    marginBottom: 14,
  },
  tag: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 2,
    marginBottom: 40,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#166534',
  },
  version: {
    position: 'absolute',
    bottom: 40,
    right: 24,
    color: 'rgba(255,255,255,0.2)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
  },
})

// components/DarkGradientBg.tsx
// 2026-09-07: オンボーディング刷新(app/onboarding.tsx)で作ったダークグリーン系
// 背景(グラデーション＋常時漂う光球)を共有コンポーネント化。
// 他画面(paywall等)でも同じ配色・同じ動きを使い回し、実装がずれないようにする。
import React, { useEffect, useRef } from 'react'
import { Animated, Easing } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'

export const DARK_GRAD = ['#166534', '#0E4E2C'] as const
export const DARK_GLOW = 'rgba(167,238,156,0.16)'
// リビール画面などで数値/バッジの色として使う明るいアクセント（緑背景に同化しない）
export const DARK_ACCENT = '#A7EE9C'

// 常時ゆっくり上下に漂う光の球（装飾のみ・情報や操作は妨げない）
export function GlowOrb({ size, style, duration = 5000, distance = 14 }: { size: number; style: any; duration?: number; distance?: number }) {
  const ty = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(ty, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(ty, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [])
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: DARK_GLOW },
        style,
        { transform: [{ translateY: ty.interpolate({ inputRange: [0, 1], outputRange: [0, -distance] }) }] },
      ]}
    />
  )
}

// 背景グラデーション＋光球。ダーク画面共通のラッパー。
export default function DarkGradientBg({ children }: { children: React.ReactNode }) {
  return (
    <LinearGradient colors={DARK_GRAD} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={{ flex: 1 }}>
      <GlowOrb size={220} style={{ top: -60, right: -60 }} duration={5200} distance={16} />
      <GlowOrb size={160} style={{ bottom: 40, left: -50 }} duration={6400} distance={12} />
      {children}
    </LinearGradient>
  )
}

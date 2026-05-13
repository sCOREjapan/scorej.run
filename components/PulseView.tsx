// components/PulseView.tsx — 脈打つ光るエフェクト（連続記録・怪我ゼロ節目）
import React, { useEffect, useRef } from 'react'
import { Animated, View, ViewStyle, StyleProp } from 'react-native'

interface PulseViewProps {
  active?: boolean          // パルス発動
  color?: string            // 光の色
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  pulseCount?: number       // 何回パルスするか（0 = 無限）
}

export default function PulseView({
  active = true,
  color = '#FF6B35',
  children,
  style,
  pulseCount = 0,
}: PulseViewProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current
  const glowAnim  = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!active) {
      pulseAnim.setValue(1)
      glowAnim.setValue(0)
      return
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1.04,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: false,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 600,
            useNativeDriver: false,
          }),
        ]),
      ]),
      { iterations: pulseCount || -1 }
    )
    pulse.start()
    return () => pulse.stop()
  }, [active, color])

  const shadowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.1, 0.5],
  })
  const shadowRadius = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [4, 18],
  })

  return (
    <Animated.View
      style={[
        style,
        {
          transform: [{ scale: pulseAnim }],
          shadowColor: color,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity,
          shadowRadius,
          elevation: 6,
        },
      ]}
    >
      {children}
    </Animated.View>
  )
}

// components/SaveCheckmark.tsx — 保存完了チェックマークアニメ
import React, { useEffect, useRef } from 'react'
import { Animated, View, StyleSheet } from 'react-native'

interface SaveCheckmarkProps {
  visible: boolean
  color?: string
  size?: number
}

export default function SaveCheckmark({ visible, color = '#00C896', size = 64 }: SaveCheckmarkProps) {
  const scale = useRef(new Animated.Value(0)).current
  const opacity = useRef(new Animated.Value(0)).current
  const checkOpacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      // 円がポンっと出る
      Animated.sequence([
        Animated.parallel([
          Animated.spring(scale, {
            toValue: 1,
            useNativeDriver: true,
            speed: 20,
            bounciness: 14,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
        ]),
        // チェックマークがフェードイン
        Animated.timing(checkOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        // 少し待ってフェードアウト
        Animated.delay(700),
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1.2,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
      ]).start(() => {
        scale.setValue(0)
        opacity.setValue(0)
        checkOpacity.setValue(0)
      })
    }
  }, [visible])

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          alignItems: 'center',
          justifyContent: 'center',
          opacity,
        },
      ]}
    >
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale }],
          shadowColor: color,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.4,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        <Animated.Text
          style={{
            fontSize: size * 0.5,
            opacity: checkOpacity,
          }}
        >
          ✓
        </Animated.Text>
      </Animated.View>
    </Animated.View>
  )
}

// components/PressableScale.tsx — バウンスアニメーション + ハプティクス + サウンド付きボタン

import React, { useRef } from 'react'
import { Animated, Pressable, ViewStyle, Platform, Insets, AccessibilityRole } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Sounds, unlockAudio } from '../lib/sounds'

interface Props {
  onPress?: () => void
  children: React.ReactNode
  style?: ViewStyle | ViewStyle[]
  haptic?: 'light' | 'medium' | 'heavy' | 'selection' | 'none'
  scaleAmount?: number
  sound?: keyof typeof Sounds | 'none'
  disabled?: boolean
  hitSlop?: Insets | number
  accessibilityLabel?: string
  accessibilityRole?: AccessibilityRole
}

export default function PressableScale({
  onPress,
  children,
  style,
  haptic = 'light',
  scaleAmount = 0.96,
  sound = 'tap',
  disabled,
  hitSlop,
  accessibilityLabel,
  accessibilityRole,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current

  const handlePressIn = () => {
    // AudioContext を unlock（初回タップで解除）
    unlockAudio()

    Animated.spring(scale, {
      toValue: scaleAmount,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start()
  }

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 10,
    }).start()
  }

  const handlePress = () => {
    // ハプティクス（ネイティブのみ）
    if (Platform.OS !== 'web' && haptic !== 'none') {
      if (haptic === 'selection') {
        Haptics.selectionAsync()
      } else {
        Haptics.impactAsync(
          haptic === 'heavy'
            ? Haptics.ImpactFeedbackStyle.Heavy
            : haptic === 'medium'
            ? Haptics.ImpactFeedbackStyle.Medium
            : Haptics.ImpactFeedbackStyle.Light,
        )
      }
    }

    // サウンド（Web）
    if (sound !== 'none' && Platform.OS === 'web') {
      Sounds[sound]?.()
    }

    onPress?.()
  }

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={style}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
    >
      <Animated.View style={{ flex: 1, transform: [{ scale }] }}>
        {children}
      </Animated.View>
    </Pressable>
  )
}

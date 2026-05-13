// components/AnimatedPressable.tsx — バネアニメ + ハプティクス付きボタン
import React, { useRef } from 'react'
import { Animated, TouchableWithoutFeedback, ViewStyle, StyleProp } from 'react-native'
import { lightTap, mediumTap } from '../lib/haptics'

interface AnimatedPressableProps {
  onPress?: () => void
  onLongPress?: () => void
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  haptic?: 'light' | 'medium' | 'none'
  scaleDown?: number   // デフォルト 0.94
  disabled?: boolean
  activeOpacity?: number
}

export default function AnimatedPressable({
  onPress,
  onLongPress,
  children,
  style,
  haptic = 'light',
  scaleDown = 0.94,
  disabled = false,
  activeOpacity = 1,
}: AnimatedPressableProps) {
  const scale = useRef(new Animated.Value(1)).current
  const opacity = useRef(new Animated.Value(1)).current

  const pressIn = () => {
    Animated.spring(scale, {
      toValue: scaleDown,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start()
    Animated.timing(opacity, {
      toValue: activeOpacity,
      duration: 60,
      useNativeDriver: true,
    }).start()
  }

  const pressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 40,
      bounciness: 8,
    }).start()
    Animated.timing(opacity, {
      toValue: 1,
      duration: 100,
      useNativeDriver: true,
    }).start()
  }

  const handlePress = () => {
    if (disabled) return
    if (haptic === 'light') lightTap()
    else if (haptic === 'medium') mediumTap()
    onPress?.()
  }

  return (
    <TouchableWithoutFeedback
      onPressIn={pressIn}
      onPressOut={pressOut}
      onPress={handlePress}
      onLongPress={onLongPress}
      disabled={disabled}
    >
      <Animated.View style={[style, { transform: [{ scale }], opacity }]}>
        {children}
      </Animated.View>
    </TouchableWithoutFeedback>
  )
}

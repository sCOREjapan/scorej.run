// components/StretchHoldButton.tsx — 長押しストレッチ開始ボタン

import React, { useRef } from 'react'
import { View, Text, StyleSheet, Animated, Easing, Pressable } from 'react-native'
import * as Haptics from 'expo-haptics'
import { useTranslation } from 'react-i18next'

const HOLD_DURATION = 1500

interface Props {
  riskScore: number
  onComplete: () => void
}

export default function StretchHoldButton({ riskScore, onComplete }: Props) {
  const { t } = useTranslation()
  const progress  = useRef(new Animated.Value(0)).current
  const blink     = useRef(new Animated.Value(1)).current
  const isHolding = useRef(false)

  const color = riskScore >= 70 ? '#C8102E' : '#F5A623'

  React.useEffect(() => {
    if (riskScore < 70) return
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(blink, { toValue: 0.65, duration: 750, useNativeDriver: true }),
      Animated.timing(blink, { toValue: 1.0,  duration: 750, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [riskScore])

  const handlePressIn = () => {
    isHolding.current = true
    Animated.timing(progress, {
      toValue: 1,
      duration: HOLD_DURATION,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && isHolding.current) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})
        onComplete()
      }
    })
  }

  const handlePressOut = () => {
    isHolding.current = false
    progress.stopAnimation()
    Animated.timing(progress, {
      toValue: 0,
      duration: 300,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start()
  }

  const barWidth = progress.interpolate({
    inputRange:  [0, 1],
    outputRange: ['0%', '100%'],
  })

  return (
    <Animated.View style={{ opacity: riskScore >= 70 ? blink : 1 }}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        <View style={[s.btn, { borderColor: color + '55' }]}>
          <Animated.View style={[s.bar, { width: barWidth, backgroundColor: color + 'BB' }]} />
          <View style={s.content}>
            <Text style={[s.label, { color }]}>
              {riskScore >= 70 ? t('stretchHoldButton.urgent') : t('stretchHoldButton.normal')}
            </Text>
            <Text style={{ color, fontSize: 14, fontWeight: '700' }}>→</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  )
}

const s = StyleSheet.create({
  btn: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: 6,
  },
  bar: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  label: {
    fontSize: 13,
    fontWeight: '800',
  },
})

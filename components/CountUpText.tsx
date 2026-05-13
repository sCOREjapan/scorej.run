// components/CountUpText.tsx — 数字がカウントアップするアニメーション
import React, { useEffect, useRef, useState } from 'react'
import { Animated, Text, TextStyle } from 'react-native'

interface CountUpTextProps {
  value: number
  duration?: number       // ms（デフォルト 800）
  delay?: number          // ms（デフォルト 0）
  suffix?: string         // 例: "日" "km" "回"
  prefix?: string         // 例: "¥"
  decimals?: number       // 小数点桁数
  style?: TextStyle
  triggerKey?: any        // この値が変わるとアニメ再実行
}

export default function CountUpText({
  value,
  duration = 800,
  delay = 0,
  suffix = '',
  prefix = '',
  decimals = 0,
  style,
  triggerKey,
}: CountUpTextProps) {
  const animValue = useRef(new Animated.Value(0)).current
  const [displayValue, setDisplayValue] = useState(0)

  useEffect(() => {
    animValue.setValue(0)
    const listener = animValue.addListener(({ value: v }) => {
      setDisplayValue(v)
    })

    const anim = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(animValue, {
        toValue: value,
        duration,
        useNativeDriver: false, // 数値追跡にnativeDriverは使えない
      }),
    ])
    anim.start()

    return () => {
      animValue.removeListener(listener)
      anim.stop()
    }
  }, [value, triggerKey])

  const formatted = decimals > 0
    ? displayValue.toFixed(decimals)
    : Math.round(displayValue).toString()

  return (
    <Text style={style}>
      {prefix}{formatted}{suffix}
    </Text>
  )
}

// components/SimpleSlider.tsx — 依存追加なしの軽量スライダー（PanResponderで実装）
import React, { useRef, useState } from 'react'
import { View, StyleSheet, PanResponder } from 'react-native'

type Props = {
  value: number
  min: number
  max: number
  step?: number
  color?: string
  trackColor?: string
  onChange: (v: number) => void
  onSlidingComplete?: (v: number) => void
}

export default function SimpleSlider({
  value, min, max, step = 0.1, color = '#16a34a', trackColor = 'rgba(0,0,0,0.08)',
  onChange, onSlidingComplete,
}: Props) {
  const [trackWidth, setTrackWidth] = useState(0)
  const trackWidthRef = useRef(0)
  const valueRef = useRef(value)
  valueRef.current = value

  function clampToStep(v: number): number {
    const stepped = Math.round((v - min) / step) * step + min
    return Math.min(max, Math.max(min, Number(stepped.toFixed(4))))
  }

  function xToValue(x: number): number {
    const w = trackWidthRef.current
    if (w <= 0) return valueRef.current
    const pct = Math.min(1, Math.max(0, x / w))
    return clampToStep(min + pct * (max - min))
  }

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => onChange(xToValue(e.nativeEvent.locationX)),
      onPanResponderMove: (e) => onChange(xToValue(e.nativeEvent.locationX)),
      onPanResponderRelease: (e) => {
        const v = xToValue(e.nativeEvent.locationX)
        onChange(v)
        onSlidingComplete?.(v)
      },
    })
  ).current

  const pct = trackWidth > 0 ? (value - min) / (max - min) : 0

  return (
    <View
      style={sl.wrap}
      onLayout={(e) => { trackWidthRef.current = e.nativeEvent.layout.width; setTrackWidth(e.nativeEvent.layout.width) }}
      {...responder.panHandlers}
      hitSlop={{ top: 14, bottom: 14, left: 4, right: 4 }}
    >
      <View style={[sl.track, { backgroundColor: trackColor }]} />
      <View style={[sl.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      <View style={[sl.thumb, { left: `${pct * 100}%`, borderColor: color }]} />
    </View>
  )
}

const sl = StyleSheet.create({
  wrap:  { height: 28, justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2 },
  fill:  { position: 'absolute', left: 0, height: 4, borderRadius: 2 },
  thumb: {
    position: 'absolute', width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#fff', borderWidth: 3, marginLeft: -11,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 3,
  },
})

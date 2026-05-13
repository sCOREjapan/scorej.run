// components/ConfettiEffect.tsx — 紙吹雪エフェクト（外部依存なし）
import React, { useEffect, useRef } from 'react'
import { View, Animated, Dimensions, StyleSheet } from 'react-native'

const { width: W, height: H } = Dimensions.get('window')

const COLORS = ['#FF6B35', '#FFD700', '#00C896', '#4ECDC4', '#FF6B6B', '#A8E6CF', '#FFB347', '#87CEEB']
const PARTICLE_COUNT = 60

interface Particle {
  x: Animated.Value
  y: Animated.Value
  rotate: Animated.Value
  opacity: Animated.Value
  scale: Animated.Value
  color: string
  size: number
  isSquare: boolean
}

function createParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    const startX = Math.random() * W
    return {
      x: new Animated.Value(startX),
      y: new Animated.Value(-20),
      rotate: new Animated.Value(0),
      opacity: new Animated.Value(1),
      scale: new Animated.Value(Math.random() * 0.6 + 0.4),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: Math.random() * 8 + 5,
      isSquare: Math.random() > 0.5,
    }
  })
}

interface ConfettiEffectProps {
  visible: boolean
  onDone?: () => void
}

export default function ConfettiEffect({ visible, onDone }: ConfettiEffectProps) {
  const particles = useRef<Particle[]>(createParticles()).current
  const animsRef = useRef<Animated.CompositeAnimation[]>([])

  useEffect(() => {
    if (!visible) return

    // 前回のアニメーションをリセット
    particles.forEach(p => {
      p.x.setValue(Math.random() * W)
      p.y.setValue(-20)
      p.rotate.setValue(0)
      p.opacity.setValue(1)
      p.scale.setValue(Math.random() * 0.6 + 0.4)
    })

    animsRef.current = particles.map((p, i) => {
      const delay = i * 20
      const duration = Math.random() * 1200 + 1800
      const endX = (Math.random() - 0.5) * 300 + parseFloat(JSON.stringify(p.x))

      return Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(p.y, {
            toValue: H + 50,
            duration,
            useNativeDriver: true,
          }),
          Animated.timing(p.x, {
            toValue: endX,
            duration,
            useNativeDriver: true,
          }),
          Animated.timing(p.rotate, {
            toValue: (Math.random() - 0.5) * 10,
            duration,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.delay(duration * 0.7),
            Animated.timing(p.opacity, {
              toValue: 0,
              duration: duration * 0.3,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ])
    })

    Animated.parallel(animsRef.current).start(() => {
      onDone?.()
    })

    return () => {
      animsRef.current.forEach(a => a.stop())
    }
  }, [visible])

  if (!visible) return null

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {particles.map((p, i) => {
        const rotate = p.rotate.interpolate({
          inputRange: [-10, 10],
          outputRange: ['-720deg', '720deg'],
        })
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              width: p.size,
              height: p.isSquare ? p.size : p.size * 0.5,
              backgroundColor: p.color,
              borderRadius: p.isSquare ? 2 : p.size,
              transform: [
                { translateX: p.x },
                { translateY: p.y },
                { rotate },
                { scale: p.scale },
              ],
              opacity: p.opacity,
            }}
          />
        )
      })}
    </View>
  )
}

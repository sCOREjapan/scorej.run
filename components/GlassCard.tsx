// components/GlassCard.tsx — W3 浮き上がりカード
import React from 'react'
import { Platform, StyleSheet, View, ViewStyle } from 'react-native'
import { useTheme } from '../context/ThemeContext'

interface Props {
  children: React.ReactNode
  style?: ViewStyle
  padding?: number
  glowColor?: string
}

export default function GlassCard({ children, style, padding = 16, glowColor }: Props) {
  const { colors } = useTheme()
  return (
    <View style={styles.shadowWrap}>
      <View style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}>
        {glowColor && <View style={[styles.accentLine, { backgroundColor: glowColor }]} />}
        <View style={[styles.content, { padding }]}>
          {children}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // overflow:hidden なカード本体とは別レイヤーにして影がクリップされないようにする
  shadowWrap: {
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 20,
    elevation: 6,
  },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
  },
  accentLine: { height: 3, position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
  content:    { gap: 12, zIndex: 2 },
})

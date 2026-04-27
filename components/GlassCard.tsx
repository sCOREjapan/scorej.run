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
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    // iOS / Web shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    // Android
    elevation: 3,
  },
  accentLine: { height: 3, position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
  content:    { gap: 12, zIndex: 2 },
})

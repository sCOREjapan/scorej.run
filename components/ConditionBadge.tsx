import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'

interface Props {
  condition: number
  size?: 'sm' | 'md' | 'lg'
}

interface BadgeConfig {
  emoji: string
  labelKey: string
  color: string
  bg: string
}

function getBadgeConfig(condition: number): BadgeConfig {
  if (condition <= 3) {
    return { emoji: '💀', labelKey: 'exhausted', color: '#FF3B30', bg: 'rgba(255,59,48,0.15)' }
  }
  if (condition <= 5) {
    return { emoji: '⚠️', labelKey: 'caution', color: '#FF9500', bg: 'rgba(255,149,0,0.15)' }
  }
  if (condition === 6) {
    return { emoji: '😐', labelKey: 'normal', color: '#FFCC00', bg: 'rgba(255,204,0,0.15)' }
  }
  if (condition <= 8) {
    return { emoji: '😊', labelKey: 'good', color: '#34C759', bg: 'rgba(52,199,89,0.15)' }
  }
  return { emoji: '🔥', labelKey: 'great', color: '#30D158', bg: 'rgba(48,209,88,0.15)' }
}

const PADDING: Record<'sm' | 'md' | 'lg', { paddingHorizontal: number; paddingVertical: number }> = {
  sm: { paddingHorizontal: 8, paddingVertical: 3 },
  md: { paddingHorizontal: 12, paddingVertical: 5 },
  lg: { paddingHorizontal: 16, paddingVertical: 8 },
}

const TEXT_SIZE: Record<'sm' | 'md' | 'lg', number> = { sm: 11, md: 13, lg: 16 }
const EMOJI_SIZE: Record<'sm' | 'md' | 'lg', number> = { sm: 12, md: 14, lg: 18 }

const ConditionBadge: React.FC<Props> = ({ condition, size = 'md' }) => {
  const { t } = useTranslation()
  const config = getBadgeConfig(condition)

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: config.bg,
          borderColor: config.color,
          ...PADDING[size],
        },
      ]}
    >
      <Text style={{ fontSize: EMOJI_SIZE[size], marginRight: 4 }}>{config.emoji}</Text>
      <Text style={[styles.label, { color: config.color, fontSize: TEXT_SIZE[size] }]}>
        {t(`conditionBadge.${config.labelKey}`)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  label: {
    fontWeight: '600',
  },
})

export default ConditionBadge

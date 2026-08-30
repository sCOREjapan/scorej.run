import React, { useEffect, useRef } from 'react'
import { View, Text, Animated, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'

interface Props {
  feedback: string
  isLoading?: boolean
  title?: string
}

const SkeletonLine: React.FC<{ width: string | number }> = ({ width }) => {
  const opacity = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    )
    pulse.start()
    return () => pulse.stop()
  }, [opacity])

  return (
    <Animated.View
      style={[
        styles.skeletonLine,
        { width: width as any, opacity },
      ]}
    />
  )
}

const AIFeedbackCard: React.FC<Props> = ({
  feedback,
  isLoading = false,
  title,
}) => {
  const { t } = useTranslation()
  const resolvedTitle = title ?? t('aiFeedbackCard.defaultTitle')
  return (
    <View style={styles.card}>
      {/* Orange left border accent */}
      <View style={styles.leftBorder} />

      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.icon}>🤖</Text>
          <Text style={styles.title}>{resolvedTitle}</Text>
        </View>

        {/* Body */}
        {isLoading ? (
          <View style={styles.skeletonContainer}>
            <SkeletonLine width="100%" />
            <SkeletonLine width="88%" />
            <SkeletonLine width="72%" />
          </View>
        ) : (
          <Text style={styles.feedback}>{feedback}</Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(74,159,255,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(74,159,255,0.2)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  leftBorder: {
    width: 3,
    backgroundColor: '#4A9FFF',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  icon: {
    fontSize: 20,
    marginRight: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  feedback: {
    color: '#8899CC',
    fontSize: 14,
    lineHeight: 22,
  },
  skeletonContainer: {
    gap: 10,
  },
  skeletonLine: {
    height: 14,
    backgroundColor: 'rgba(74,159,255,0.15)',
    borderRadius: 7,
  },
})

export default AIFeedbackCard

// components/PaywallSheet.tsx — ソフトペイウォール（強制ブロックなし）
import React, { useEffect, useRef } from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Dimensions,
  Pressable,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'

const { height: SCREEN_H } = Dimensions.get('window')

interface PaywallSheetProps {
  visible: boolean
  remaining: number          // 0 = 使い切り, 1 = 残り1回警告
  featureName?: string       // 例: "AI診断"
  onClose: () => void
  onUpgrade: () => void
  onWatchAd?: () => void     // 広告視聴で1回追加
}

export default function PaywallSheet({
  visible,
  remaining,
  featureName = 'この機能',
  onClose,
  onUpgrade,
  onWatchAd,
}: PaywallSheetProps) {
  const slideY = useRef(new Animated.Value(300)).current
  const bgOpacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideY, {
          toValue: 0,
          damping: 22,
          stiffness: 260,
          useNativeDriver: true,
        }),
        Animated.timing(bgOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start()
    } else {
      Animated.parallel([
        Animated.timing(slideY, {
          toValue: 300,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(bgOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start()
    }
  }, [visible])

  const isWarning = remaining === 1
  const accentColor = isWarning ? '#FF9500' : '#EF4444'
  const icon = isWarning ? 'warning-outline' : 'lock-closed-outline'

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View style={[styles.backdropFill, { opacity: bgOpacity }]} />
      </Pressable>

      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideY }] }]}>
        {/* Handle bar */}
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.iconRow}>
          <View style={[styles.iconCircle, { backgroundColor: accentColor + '18' }]}>
            <Ionicons name={icon} size={28} color={accentColor} />
          </View>
        </View>

        {/* Message */}
        {isWarning ? (
          <>
            <Text style={styles.title}>残り<Text style={[styles.countText, { color: accentColor }]}>1回</Text>です</Text>
            <Text style={styles.subtitle}>
              {featureName}の無料枠が残り1回になりました。{'\n'}
              アップグレードで無制限に使えます。
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>無料枠を使い切りました</Text>
            <Text style={styles.subtitle}>
              {featureName}の今月の無料回数が終了しました。{'\n'}
              続けるにはアップグレードか広告視聴をどうぞ。
            </Text>
          </>
        )}

        {/* Upgrade button */}
        <TouchableOpacity style={styles.upgradeBtn} onPress={onUpgrade} activeOpacity={0.85}>
          <Ionicons name="star" size={16} color="#fff" style={{ marginRight: 6 }} />
          <Text style={styles.upgradeBtnText}>プレミアムにアップグレード</Text>
        </TouchableOpacity>

        {/* Watch ad button */}
        {onWatchAd && !isWarning && (
          <TouchableOpacity style={styles.adBtn} onPress={onWatchAd} activeOpacity={0.8}>
            <Ionicons name="play-circle-outline" size={16} color="#FF6B35" style={{ marginRight: 6 }} />
            <Text style={styles.adBtnText}>広告を見て1回追加</Text>
          </TouchableOpacity>
        )}

        {/* Dismiss — soft, not blocking */}
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.6}>
          <Text style={styles.closeBtnText}>
            {isWarning ? 'このまま続ける' : 'あとで考える'}
          </Text>
        </TouchableOpacity>

        <View style={styles.bottomSafe} />
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  backdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 20,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E0E0',
    alignSelf: 'center',
    marginBottom: 20,
  },
  iconRow: {
    alignItems: 'center',
    marginBottom: 16,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
    marginBottom: 10,
  },
  countText: {
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
  },
  upgradeBtn: {
    backgroundColor: '#FF6B35',
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    shadowColor: '#FF6B35',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  upgradeBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  adBtn: {
    borderWidth: 1.5,
    borderColor: '#FF6B35',
    borderRadius: 14,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  adBtnText: {
    color: '#FF6B35',
    fontSize: 15,
    fontWeight: '600',
  },
  closeBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 14,
    color: '#999',
    fontWeight: '500',
  },
  bottomSafe: {
    height: 12,
  },
})

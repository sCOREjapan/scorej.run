// components/CoachPlanBanner.tsx — アプデ後に一度だけ表示するコーチプラン値下げ告知
import React from 'react'
import { Modal, View, Text, TouchableOpacity, ImageBackground, StyleSheet, SafeAreaView } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'

export default function CoachPlanBanner({ onDismiss }: { onDismiss: () => void }) {
  const router = useRouter()
  const { t } = useTranslation()

  const handleView = () => {
    onDismiss()
    router.push('/paywall?plan=coach')
  }

  return (
    <Modal visible transparent animationType="fade">
      <ImageBackground
        source={require('../assets/banners/coach-plan-banner.png')}
        style={styles.bg}
        resizeMode="cover"
      >
        <SafeAreaView style={styles.safe}>
          {/* 閉じるボタン */}
          <TouchableOpacity
            onPress={onDismiss}
            style={styles.closeBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.75}
          >
            <Ionicons name="close" size={22} color="#166534" />
          </TouchableOpacity>

          {/* 見出し */}
          <View style={styles.headline}>
            <View style={styles.headlinePill}>
              <Text style={styles.priceTag}>{t('coachPlanBanner.priceTag')}</Text>
              <Text style={styles.headlineText}>{t('coachPlanBanner.headline')}</Text>
            </View>
          </View>

          {/* 下部CTA */}
          <View style={styles.footer}>
            <View style={styles.descPill}>
              <Text style={styles.desc}>
                {t('coachPlanBanner.desc')}
              </Text>
            </View>
            <TouchableOpacity style={styles.viewBtn} onPress={handleView} activeOpacity={0.85}>
              <Ionicons name="trophy" size={18} color="#fff" />
              <Text style={styles.viewBtnText}>{t('coachPlanBanner.cta')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onDismiss} activeOpacity={0.7}>
              <Text style={styles.laterText}>{t('coachPlanBanner.later')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </ImageBackground>
    </Modal>
  )
}

const styles = StyleSheet.create({
  bg: { flex: 1, width: '100%', height: '100%' },
  safe: { flex: 1, justifyContent: 'space-between' },
  closeBtn: {
    alignSelf: 'flex-end',
    marginRight: 16,
    marginTop: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    paddingTop: 8,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  headlinePill: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  priceTag: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
    backgroundColor: '#166534',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 8,
    overflow: 'hidden',
  },
  headlineText: {
    fontSize: 21,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    lineHeight: 28,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 28,
    alignItems: 'center',
  },
  descPill: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  desc: {
    fontSize: 13,
    lineHeight: 20,
    color: '#374151',
    textAlign: 'center',
  },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#166534',
    paddingVertical: 15,
    paddingHorizontal: 24,
    borderRadius: 28,
    width: '100%',
    shadowColor: '#166534',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  viewBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  laterText: {
    marginTop: 14,
    fontSize: 13,
    color: '#6b7280',
  },
})

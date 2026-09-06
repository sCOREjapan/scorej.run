// components/NoadUpsellModal.tsx
// 広告なしプランの案内モーダル（週1回程度）
// 表示条件: FREEプラン かつ 前回表示から7日以上経過（未表示なら即表示）
// noad / coach プランに加入済みの場合は呼び出し側でそもそも表示しない

import React, { useRef, useEffect, useMemo } from 'react'
import {
  Modal, View, Text, TouchableOpacity,
  Animated, StyleSheet,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Ionicons } from '@expo/vector-icons'
import { todayLocalISO } from '../lib/dateLocal'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { useTranslation } from 'react-i18next'

const LAST_SHOWN_KEY = 'score_noad_upsell_last_shown'
const INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

// ── 表示すべきか判定（呼び出し側で tier === 'free' を確認してから呼ぶ） ──
export async function shouldShowNoadUpsell(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SHOWN_KEY)
    if (!raw) return true
    const last = new Date(raw + 'T00:00:00').getTime()
    return Date.now() - last >= INTERVAL_MS
  } catch {
    return false
  }
}

export async function markNoadUpsellShown(): Promise<void> {
  await AsyncStorage.setItem(LAST_SHOWN_KEY, todayLocalISO()).catch(() => {})
}

interface Props {
  visible: boolean
  onClose: () => void
  onUpgrade: () => void
}

export default function NoadUpsellModal({ visible, onClose, onUpgrade }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const s = useMemo(() => makeS(colors), [colors])
  const slideY    = useRef(new Animated.Value(500)).current
  const bgOpacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideY,    { toValue: 0, useNativeDriver: true, tension: 60, friction: 11 }),
        Animated.timing(bgOpacity, { toValue: 1, useNativeDriver: true, duration: 250 }),
      ]).start()
    } else {
      slideY.setValue(500)
      bgOpacity.setValue(0)
    }
  }, [visible])

  function dismiss(cb?: () => void) {
    Animated.parallel([
      Animated.timing(slideY,    { toValue: 500, useNativeDriver: true, duration: 220 }),
      Animated.timing(bgOpacity, { toValue: 0,   useNativeDriver: true, duration: 220 }),
    ]).start(() => {
      markNoadUpsellShown()
      onClose()
      cb?.()
    })
  }

  if (!visible) return null

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={() => dismiss()}>
      <Animated.View style={[s.overlay, { opacity: bgOpacity }]}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => dismiss()} />
      </Animated.View>

      <Animated.View style={[s.sheet, { transform: [{ translateY: slideY }] }]}>
        <View style={s.handle} />

        <View style={s.headerRow}>
          <View style={s.iconWrap}>
            <Ionicons name="shield-checkmark" size={26} color="#166534" />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.title}>{t('noadUpsellModal.title')}</Text>
            <Text style={s.sub}>{t('noadUpsellModal.sub')}</Text>
          </View>
        </View>

        <View style={s.benefits}>
          {(t('noadUpsellModal.benefits', { returnObjects: true }) as string[]).map(benefit => (
            <View key={benefit} style={s.benefitRow}>
              <Ionicons name="checkmark-circle" size={16} color="#166534" />
              <Text style={s.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={s.primaryBtn} onPress={() => dismiss(onUpgrade)} activeOpacity={0.85}>
          <Text style={s.primaryBtnTxt}>{t('noadUpsellModal.cta')}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => dismiss()} style={s.subBtn}>
          <Text style={s.subBtnTxt}>{t('noadUpsellModal.notNow')}</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  )
}

const makeS = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
    gap: 16,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center', marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  iconWrap: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: 'rgba(22,101,52,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: {
    color: colors.text, fontSize: 16, fontWeight: '800',
  },
  sub: {
    color: colors.textSec, fontSize: 13,
  },
  benefits: {
    gap: 8,
  },
  benefitRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  benefitText: {
    color: colors.text, fontSize: 13, fontWeight: '600',
  },
  primaryBtn: {
    backgroundColor: '#166534',
    borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnTxt: {
    color: '#fff', fontSize: 16, fontWeight: '800',
  },
  subBtn: {
    alignItems: 'center', paddingVertical: 12, minHeight: 44, justifyContent: 'center',
  },
  subBtnTxt: {
    color: colors.textSec, fontSize: 14,
  },
})

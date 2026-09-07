// components/NoadUpsellModal.tsx
// チケットプランの案内モーダル（1日1回程度）
// 2026-09-07: paywall画面が「チケットプラン推奨」の比較デザインに刷新されたのに合わせ、
// このモーダルの文言・導線も¥480広告なしプラン推奨からチケットプラン推奨に統一。
// 表示頻度も週1回→1日1回に変更（呼び出し側のトリガーは index.tsx の起動時タイマーに加え、
// 広告視聴でチケットを獲得した直後にも呼ぶ想定）。
// 表示条件: FREEプラン かつ 前回表示から1日以上経過（未表示なら即表示）
// ticket_monthly / coach プランに加入済みの場合は呼び出し側でそもそも表示しない
//
// 2026-09-07 追記（marketing-council / Sutherland案）:
// 「広告を見てチケットを稼いだ直後」に売り込み文言を出すのは、対価を払った直後に
// また対価を求める格好になり心理的に逆効果になりうる、という指摘を受け、
// context='post_ad_watch' のときだけ「お疲れさまでした」から始まる感謝フレーミングに
// 差し替える（表示頻度・導線はdaily/post_ad_watchで変えない。文言だけの実験）。

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
import { TICKET_MONTHLY_GRANT } from '../lib/purchaseService'
import { trackPaywallView, trackPaywallDismiss } from '../lib/analytics'

const LAST_SHOWN_KEY = 'score_noad_upsell_last_shown'
const INTERVAL_MS = 1 * 24 * 60 * 60 * 1000

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
  /** 表示トリガー（計測タグ＋文言の出し分けに使う）。省略時は'daily'扱い */
  context?: 'daily' | 'post_ad_watch'
}

export default function NoadUpsellModal({ visible, onClose, onUpgrade, context = 'daily' }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const s = useMemo(() => makeS(colors), [colors])
  const slideY    = useRef(new Animated.Value(500)).current
  const bgOpacity = useRef(new Animated.Value(0)).current
  const source = `noad_upsell:${context}`

  useEffect(() => {
    if (visible) {
      trackPaywallView(source)
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
    // アップグレード導線に進む場合はdismiss扱いにしない（離脱ではないため）
    if (!cb) trackPaywallDismiss(source)
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
            <Text style={{ fontSize: 26 }}>🎫</Text>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.title}>
              {context === 'post_ad_watch' ? t('noadUpsellModal.postAdTitle') : t('noadUpsellModal.title')}
            </Text>
            <Text style={s.sub}>
              {context === 'post_ad_watch'
                ? t('noadUpsellModal.postAdSub', { n: TICKET_MONTHLY_GRANT })
                : t('noadUpsellModal.sub', { n: TICKET_MONTHLY_GRANT })}
            </Text>
          </View>
        </View>

        <View style={s.benefits}>
          {(t('noadUpsellModal.benefits', { returnObjects: true, n: TICKET_MONTHLY_GRANT }) as string[]).map(benefit => (
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

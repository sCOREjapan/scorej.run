// components/ReviewWall.tsx
// アプリレビュー依頼モーダル（底部シート・ダークUI）
// 表示条件: アプリを5回以上起動 かつ 永久非表示にしていない
//           「あとで」の場合は30日後に再表示

import React, { useEffect, useRef, useState } from 'react'
import {
  Modal, View, Text, TouchableOpacity,
  Animated, Linking, Platform, StyleSheet,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Ionicons } from '@expo/vector-icons'
import * as StoreReview from 'expo-store-review'
import { todayLocalISO } from '../lib/dateLocal'
import { useTranslation } from 'react-i18next'

// ── ストア URL ────────────────────────────────────────────────
// itms-apps:// + ?action=write-review → App Storeのレビュー入力画面に直接飛ぶ（iOS専用）
// ネイティブの評価ポップアップ(requestReview)が使えない環境向けのフォールバックとしてのみ使用する
const APP_STORE_REVIEW_URL  = 'itms-apps://apps.apple.com/app/id6766394981?action=write-review'
const APP_STORE_WEB_URL     = 'https://apps.apple.com/jp/app/score/id6766394981?action=write-review'
const PLAY_STORE_URL        = 'https://play.google.com/store/apps/details?id=com.scorejapan.score&reviewId=0'

// 低評価(1〜3星)の受け皿。公開のApp Store/Playレビューには送らず、こちらへ誘導する
function feedbackEmailUrl(t: (key: string) => string): string {
  return 'mailto:team.deepwork2026@gmail.com?subject=' + encodeURIComponent(t('reviewWall.feedbackEmailSubject')) +
    '&body=' + encodeURIComponent(t('reviewWall.feedbackEmailBody'))
}

// ── AsyncStorage キー ─────────────────────────────────────────
export const REVIEW_OPEN_COUNT_KEY = 'score_review_open_count'
export const REVIEW_WALL_STATE_KEY = 'score_review_wall_v1'

export type ReviewWallState = {
  neverShow:  boolean   // 「表示しない」を選択した
  lastShown:  string    // YYYY-MM-DD（「あとで」を選択した日）
  reviewed:   boolean   // 「レビューを書く」を押した
}

// ── 表示すべきか判定 ──────────────────────────────────────────
export async function shouldShowReviewWall(): Promise<boolean> {
  try {
    // 起動回数カウントアップ
    const countRaw = await AsyncStorage.getItem(REVIEW_OPEN_COUNT_KEY)
    const count = parseInt(countRaw ?? '0', 10) + 1
    await AsyncStorage.setItem(REVIEW_OPEN_COUNT_KEY, String(count))

    // 5回未満はスキップ
    if (count < 5) return false

    const raw = await AsyncStorage.getItem(REVIEW_WALL_STATE_KEY)
    if (!raw) return true  // 初めて閾値に達した

    const state: ReviewWallState = JSON.parse(raw)
    if (state.neverShow || state.reviewed) return false

    // 「あとで」→ 30日後まで非表示
    if (state.lastShown) {
      const last = new Date(state.lastShown).getTime()
      const diff = Date.now() - last
      if (diff < 30 * 24 * 60 * 60 * 1000) return false
    }

    return true
  } catch {
    return false
  }
}

// ── コンポーネント ────────────────────────────────────────────
interface Props {
  visible:     boolean
  onClose:     () => void
}

export default function ReviewWall({ visible, onClose }: Props) {
  const { t } = useTranslation()
  const slideY    = useRef(new Animated.Value(500)).current
  const bgOpacity = useRef(new Animated.Value(0)).current
  const [starPressed, setStarPressed] = useState(0)

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideY,    { toValue: 0,   useNativeDriver: true, tension: 60, friction: 11 }),
        Animated.timing(bgOpacity, { toValue: 1,   useNativeDriver: true, duration: 250 }),
      ]).start()
      setStarPressed(0)
    } else {
      slideY.setValue(500)
      bgOpacity.setValue(0)
    }
  }, [visible])

  function dismiss(type: 'later' | 'never' | 'reviewed') {
    Animated.parallel([
      Animated.timing(slideY,    { toValue: 500, useNativeDriver: true, duration: 220 }),
      Animated.timing(bgOpacity, { toValue: 0,   useNativeDriver: true, duration: 220 }),
    ]).start(() => {
      const today = todayLocalISO()
      const state: ReviewWallState = {
        neverShow:  type === 'never',
        lastShown:  today,
        reviewed:   type === 'reviewed',
      }
      AsyncStorage.setItem(REVIEW_WALL_STATE_KEY, JSON.stringify(state)).catch(() => {})
      onClose()
    })
  }

  // 4〜5星 → Apple/Googleのネイティブレビューポップアップ（Appストアの実評価に直結する公式UI）を呼ぶ。
  // 端末側の制限（年数回まで等）で表示されないこともあるため、その場合のみストアページへのリンクにフォールバックする。
  async function submitPositiveReview() {
    try {
      const available = await StoreReview.isAvailableAsync()
      if (available) {
        await StoreReview.requestReview()
      } else if (Platform.OS === 'android') {
        await Linking.openURL(PLAY_STORE_URL)
      } else if (Platform.OS === 'ios') {
        const canOpen = await Linking.canOpenURL(APP_STORE_REVIEW_URL)
        await Linking.openURL(canOpen ? APP_STORE_REVIEW_URL : APP_STORE_WEB_URL)
      } else {
        await Linking.openURL(APP_STORE_WEB_URL)
      }
    } catch {}
    dismiss('reviewed')
  }

  // 1〜3星 → 公開ストアレビューには送らず、内々のフィードバック窓口へ誘導する
  async function sendFeedback() {
    try {
      await Linking.openURL(feedbackEmailUrl(t))
    } catch {}
    dismiss('reviewed')
  }

  function handlePrimaryPress() {
    if (starPressed >= 4) submitPositiveReview()
    else if (starPressed >= 1) sendFeedback()
  }

  if (!visible) return null

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={() => dismiss('later')}>
      {/* 背景オーバーレイ */}
      <Animated.View style={[s.overlay, { opacity: bgOpacity }]}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => dismiss('later')} />
      </Animated.View>

      {/* ボトムシート */}
      <Animated.View style={[s.sheet, { transform: [{ translateY: slideY }] }]}>
        {/* ハンドル */}
        <View style={s.handle} />

        {/* ヘッダー */}
        <View style={s.headerRow}>
          <View style={s.appIconWrap}>
            <Text style={{ fontSize: 28 }}>🏃</Text>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.title}>{t('reviewWall.title')}</Text>
            <Text style={s.sub}>{t('reviewWall.sub')}</Text>
          </View>
        </View>

        {/* 星 */}
        <View style={s.stars}>
          {[1, 2, 3, 4, 5].map(n => (
            <TouchableOpacity
              key={n}
              onPress={() => setStarPressed(n)}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              accessibilityLabel={t('reviewWall.starAccessibility', { n })}
              accessibilityRole="button"
            >
              <Ionicons
                name={n <= starPressed ? 'star' : 'star-outline'}
                size={38}
                color={n <= starPressed ? '#FBBF24' : 'rgba(255,255,255,0.3)'}
              />
            </TouchableOpacity>
          ))}
        </View>
        {starPressed > 0 && (
          <Text style={s.starLabel}>
            {starPressed === 5 ? t('reviewWall.starLabel.star5') :
             starPressed >= 4 ? t('reviewWall.starLabel.star4') :
             starPressed >= 3 ? t('reviewWall.starLabel.star3') :
             t('reviewWall.starLabel.starLow')}
          </Text>
        )}

        {/* CTAボタン */}
        <TouchableOpacity
          style={[s.primaryBtn, starPressed === 0 && s.primaryBtnDisabled]}
          onPress={handlePrimaryPress}
          activeOpacity={0.85}
          disabled={starPressed === 0}
        >
          <Ionicons name={starPressed >= 4 ? 'star' : 'mail'} size={18} color="#fff" />
          <Text style={s.primaryBtnTxt}>
            {starPressed === 0
              ? t('reviewWall.ctaChooseStars')
              : starPressed >= 4
                ? (Platform.OS === 'android' ? t('reviewWall.ctaWriteReviewAndroid') : t('reviewWall.ctaWriteReviewIOS'))
                : t('reviewWall.ctaSendFeedback')}
          </Text>
        </TouchableOpacity>

        {/* サブアクション */}
        <View style={s.subRow}>
          <TouchableOpacity onPress={() => dismiss('later')} style={s.subBtn}>
            <Text style={s.subBtnTxt}>{t('reviewWall.later')}</Text>
          </TouchableOpacity>
          <View style={s.subDivider} />
          <TouchableOpacity onPress={() => dismiss('never')} style={s.subBtn}>
            <Text style={[s.subBtnTxt, { color: 'rgba(255,255,255,0.25)' }]}>{t('reviewWall.never')}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
    gap: 16,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center', marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  appIconWrap: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  title: {
    color: '#fff', fontSize: 16, fontWeight: '800', lineHeight: 22,
  },
  sub: {
    color: 'rgba(255,255,255,0.55)', fontSize: 13,
  },
  stars: {
    flexDirection: 'row', justifyContent: 'center', gap: 8,
    paddingVertical: 4,
  },
  starLabel: {
    color: '#FBBF24', fontSize: 13, textAlign: 'center',
    fontWeight: '600', marginTop: -8,
  },
  primaryBtn: {
    backgroundColor: '#166534',
    borderRadius: 16, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8,
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryBtnTxt: {
    color: '#fff', fontSize: 16, fontWeight: '800',
  },
  subRow: {
    flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', gap: 0, marginTop: -4,
  },
  subBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12, minHeight: 44, justifyContent: 'center',
  },
  subBtnTxt: {
    color: 'rgba(255,255,255,0.65)', fontSize: 14,
  },
  subDivider: {
    width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.15)',
  },
})

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

// ── ストア URL ────────────────────────────────────────────────
// itms-apps:// + ?action=write-review → App Storeのレビュー入力画面に直接飛ぶ（iOS専用）
const APP_STORE_REVIEW_URL  = 'itms-apps://itunes.apple.com/app/id6738321803?action=write-review'
const APP_STORE_WEB_URL     = 'https://apps.apple.com/jp/app/score/id6738321803?action=write-review'
const PLAY_STORE_URL        = 'https://play.google.com/store/apps/details?id=com.scorejapan.score&reviewId=0'

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
      const today = new Date().toISOString().slice(0, 10)
      const state: ReviewWallState = {
        neverShow:  type === 'never',
        lastShown:  today,
        reviewed:   type === 'reviewed',
      }
      AsyncStorage.setItem(REVIEW_WALL_STATE_KEY, JSON.stringify(state)).catch(() => {})
      onClose()
    })
  }

  async function openStore() {
    setStarPressed(5)
    try {
      if (Platform.OS === 'android') {
        // Android → Play Storeのレビューページ
        await Linking.openURL(PLAY_STORE_URL)
      } else if (Platform.OS === 'ios') {
        // iOS → itms-apps:// でApp Storeのレビュー入力欄に直接飛ぶ
        const canOpen = await Linking.canOpenURL(APP_STORE_REVIEW_URL)
        await Linking.openURL(canOpen ? APP_STORE_REVIEW_URL : APP_STORE_WEB_URL)
      } else {
        // Web → App Storeページ（webではレビュー直接入力は不可）
        await Linking.openURL(APP_STORE_WEB_URL)
      }
    } catch {}
    dismiss('reviewed')
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
            <Text style={s.title}>sCORE を使ってみていかがですか？</Text>
            <Text style={s.sub}>レビューがアプリの成長を支えます🙏</Text>
          </View>
        </View>

        {/* 星 */}
        <View style={s.stars}>
          {[1, 2, 3, 4, 5].map(n => (
            <TouchableOpacity key={n} onPress={() => setStarPressed(n)} activeOpacity={0.7}>
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
            {starPressed === 5 ? '最高です！ありがとうございます 🎉' :
             starPressed >= 4 ? '嬉しいです！ぜひ教えてください' :
             starPressed >= 3 ? 'ご意見をお聞かせください' :
             'ご不満な点をぜひ教えてください'}
          </Text>
        )}

        {/* CTAボタン */}
        <TouchableOpacity style={s.primaryBtn} onPress={openStore} activeOpacity={0.85}>
          <Ionicons name="star" size={18} color="#fff" />
          <Text style={s.primaryBtnTxt}>
            {Platform.OS === 'android' ? 'Google Play でレビューを書く' : 'App Store でレビューを書く'}
          </Text>
        </TouchableOpacity>

        {/* サブアクション */}
        <View style={s.subRow}>
          <TouchableOpacity onPress={() => dismiss('later')} style={s.subBtn}>
            <Text style={s.subBtnTxt}>あとで</Text>
          </TouchableOpacity>
          <View style={s.subDivider} />
          <TouchableOpacity onPress={() => dismiss('never')} style={s.subBtn}>
            <Text style={[s.subBtnTxt, { color: 'rgba(255,255,255,0.25)' }]}>表示しない</Text>
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
  primaryBtnTxt: {
    color: '#fff', fontSize: 16, fontWeight: '800',
  },
  subRow: {
    flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', gap: 0, marginTop: -4,
  },
  subBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 8,
  },
  subBtnTxt: {
    color: 'rgba(255,255,255,0.4)', fontSize: 14,
  },
  subDivider: {
    width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.15)',
  },
})

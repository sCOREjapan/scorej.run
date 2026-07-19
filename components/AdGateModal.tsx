// components/AdGateModal.tsx — 広告リワードモーダル（v1.0 IAP無効化・広告中心モデル）
// 表示パターン:
//   isGuest                     → ログイン促進
//   それ以外（needsAd=true）     → 広告を視聴して機能を1回解放
import React, { useEffect, useState } from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import type { Feature } from '../lib/adGate'
import { watchAdsForReward } from '../lib/rewardedAd'
import { trackPaywallView } from '../lib/analytics'

const BRAND      = '#166534'
const ADS_NEEDED = 2   // 2本の広告視聴でAI機能1回解放

// ── 機能名マップ ──────────────────────────────────────────────
const FEATURE_LABELS: Record<Feature, string> = {
  ai_analysis: 'AI練習分析コーチ',
  video:       '動画フォーム分析',
  meal:        'AI食事分析',
  csv:         'CSVエクスポート',
  recovery:    'AIリカバリー相談',
  workout:     'AI練習メニュー生成',
}

interface Props {
  visible:      boolean
  feature:      Feature
  remaining?:   number   // 残り無料回数
  hardLimited?: boolean
  limitType?:   'none' | 'daily' | 'monthly' | 'total' | 'window'
  isGuest?:     boolean
  onClose:      () => void
  onAdWatched:  () => void  // 広告視聴完了 → 親が処理を実行
  onUpgrade?:   () => void  // 互換用（v1.0では未使用）
}

export default function AdGateModal({
  visible, feature, isGuest = false, hardLimited = false, limitType = 'daily', onClose, onAdWatched,
}: Props) {
  const router = useRouter()
  const featureName = FEATURE_LABELS[feature] ?? '機能'

  // 広告視聴中の状態
  const [watching, setWatching]     = useState(false)
  const [adProgress, setAdProgress] = useState(0)   // 0〜ADS_NEEDED

  // モーダルが閉じたらリセット
  useEffect(() => {
    if (!visible) { setWatching(false); setAdProgress(0) }
  }, [visible])

  // 表示トラッキング
  useEffect(() => {
    if (visible && !isGuest) trackPaywallView(feature)
  }, [visible, feature, isGuest])

  // ── 広告を視聴 → 機能1回解放 ─────────────────────────
  const handleWatchAds = async () => {
    setWatching(true)
    setAdProgress(0)
    const success = await watchAdsForReward(ADS_NEEDED, (watched) => {
      setAdProgress(watched)
    })
    setWatching(false)
    if (success) {
      onAdWatched()   // 親に通知 → 処理実行
    } else {
      Alert.alert(
        '広告を最後まで見てください',
        '最後まで視聴すると1回無料で使用できます。',
        [{ text: 'OK' }]
      )
      setAdProgress(0)
    }
  }

  // ── ゲスト：ログイン促進 ───────────────────────────────────
  if (isGuest) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={st.overlay}>
          <View style={st.card}>
            <View style={st.handle} />
            <View style={[st.iconWrap, { backgroundColor: 'rgba(37,99,235,0.2)' }]}>
              <Ionicons name="person-circle-outline" size={36} color="#60a5fa" />
            </View>
            <Text style={st.title}>ログインが必要です</Text>
            <Text style={st.sub}>{featureName}はアカウントが必要な機能です。{'\n'}無料で登録できます。</Text>
            <TouchableOpacity
              style={[st.primaryBtn, { backgroundColor: '#2563EB' }]}
              onPress={() => { onClose(); router.replace('/auth') }}
              activeOpacity={0.85}
            >
              <Ionicons name="log-in-outline" size={18} color="#fff" />
              <Text style={st.primaryBtnTxt}>ログイン / 新規登録（無料）</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={st.cancelTxt}>キャンセル</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    )
  }

  // ── 本日の絶対上限に達した場合：広告視聴では解除できない ──────
  if (hardLimited) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={st.overlay}>
          <View style={st.card}>
            <View style={st.handle} />
            <View style={[st.iconWrap, { backgroundColor: 'rgba(245,158,11,0.2)' }]}>
              <Ionicons name="time-outline" size={36} color="#f59e0b" />
            </View>
            <Text style={st.title}>{limitType === 'monthly' ? '今月のご利用上限に達しました' : '本日のご利用上限に達しました'}</Text>
            <Text style={st.sub}>
              {limitType === 'monthly'
                ? `${featureName}は来月また使えるようになります。`
                : `${featureName}は明日また使えるようになります。`}
            </Text>
            <TouchableOpacity style={[st.primaryBtn, { backgroundColor: '#374151' }]} onPress={onClose} activeOpacity={0.85}>
              <Text style={st.primaryBtnTxt}>閉じる</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    )
  }

  // ── 広告視聴中UI ─────────────────────────────────────────
  if (watching) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => {}}>
        <View style={st.overlay}>
          <View style={st.card}>
            <View style={st.handle} />
            <View style={[st.iconWrap, { backgroundColor: 'rgba(22,101,52,0.3)' }]}>
              <Ionicons name="play-circle" size={36} color="#4ade80" />
            </View>
            <Text style={st.title}>広告を視聴中...</Text>
            <Text style={st.sub}>最後まで見ると{featureName}が1回使えます{'\n'}（{adProgress} / {ADS_NEEDED} 本）</Text>
            <ActivityIndicator size="large" color={BRAND} style={{ marginTop: 8 }} />
          </View>
        </View>
      </Modal>
    )
  }

  // ── 広告を見て1回使う ─────────────────────────────────────
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.overlay}>
        <View style={st.card}>
          <View style={st.handle} />
          <View style={[st.iconWrap, { backgroundColor: 'rgba(37,99,235,0.2)' }]}>
            <Ionicons name="play-circle-outline" size={36} color="#60a5fa" />
          </View>

          <Text style={st.title}>広告を見て使う 🎬</Text>
          <Text style={st.sub}>{featureName}は広告{ADS_NEEDED}本の視聴で無料で使えます。</Text>

          {/* 広告視聴ボタン */}
          <TouchableOpacity
            style={[st.primaryBtn, { backgroundColor: '#1d4ed8' }]}
            onPress={handleWatchAds}
            activeOpacity={0.85}
          >
            <Ionicons name="play-circle-outline" size={18} color="#fff" />
            <Text style={st.primaryBtnTxt}>広告 {ADS_NEEDED} 本を見て使う（無料）</Text>
          </TouchableOpacity>

          <TouchableOpacity style={st.cancelBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={st.cancelTxt}>今はしない</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  overlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  card:          {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 36,
    alignItems: 'center', gap: 12,
  },
  handle:        { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 4 },
  iconWrap:      { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title:         { fontSize: 18, fontWeight: '800', color: '#fff', textAlign: 'center' },
  sub:           { fontSize: 13, color: 'rgba(255,255,255,0.65)', textAlign: 'center', lineHeight: 20 },
  primaryBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 14, width: '100%' },
  primaryBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },
  cancelBtn:     { paddingVertical: 8 },
  cancelTxt:     { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
})

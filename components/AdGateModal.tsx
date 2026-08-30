// components/AdGateModal.tsx — 広告リワードモーダル（v1.0 IAP無効化・広告中心モデル）
// 表示パターン:
//   isGuest                     → ログイン促進
//   それ以外（needsAd=true）     → 広告を視聴して機能を1回解放
import React, { useEffect, useState } from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ImageBackground } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import type { Feature } from '../lib/adGate'
import { watchAdsForReward } from '../lib/rewardedAd'
import { trackPaywallView } from '../lib/analytics'
import { useTranslation } from 'react-i18next'

const MEAL_PAYWALL_BG = require('../assets/banners/meal-paywall-bg.png')

const BRAND      = '#166534'
const ADS_NEEDED = 2   // 2本の広告視聴でAI機能1回解放

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
  const { t } = useTranslation()
  const featureName = t(`adGateModal.features.${feature}`, { defaultValue: t('adGateModal.features.default') })

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
        t('adGateModal.adAlert.title'),
        t('adGateModal.adAlert.body'),
        [{ text: t('adGateModal.adAlert.ok') }]
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
            <Text style={st.title}>{t('adGateModal.guest.title')}</Text>
            <Text style={st.sub}>{t('adGateModal.guest.sub', { feature: featureName })}</Text>
            <TouchableOpacity
              style={[st.primaryBtn, { backgroundColor: '#2563EB' }]}
              onPress={() => { onClose(); router.replace('/auth') }}
              activeOpacity={0.85}
            >
              <Ionicons name="log-in-outline" size={18} color="#fff" />
              <Text style={st.primaryBtnTxt}>{t('adGateModal.guest.cta')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={st.cancelTxt}>{t('adGateModal.guest.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    )
  }

  // ── 累計上限に達した場合：広告では解除できず、有料プランのみ ──────
  // （日次/月次の絶対上限とは異なり、リセットされないためアップグレード導線を出す）
  if (hardLimited && limitType === 'total') {
    const bg = feature === 'meal' ? MEAL_PAYWALL_BG : undefined
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={st.overlay}>
          <View style={[st.card, { overflow: 'hidden' }]}>
            {bg && (
              <ImageBackground source={bg} style={StyleSheet.absoluteFill} resizeMode="cover" />
            )}
            <View style={st.handle} />
            <View style={[st.iconWrap, { backgroundColor: 'rgba(22,101,52,0.15)' }]}>
              <Ionicons name="star" size={32} color={BRAND} />
            </View>
            <Text style={st.title}>{t('adGateModal.totalLimit.title')}</Text>
            <Text style={st.sub}>{t('adGateModal.totalLimit.sub', { feature: featureName })}</Text>
            <TouchableOpacity
              style={[st.primaryBtn, { backgroundColor: BRAND }]}
              onPress={() => { onClose(); router.push('/paywall') }}
              activeOpacity={0.85}
            >
              <Ionicons name="star" size={18} color="#fff" />
              <Text style={st.primaryBtnTxt}>{t('adGateModal.totalLimit.cta')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={st.cancelTxt}>{t('adGateModal.totalLimit.notNow')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    )
  }

  // ── 本日/今月の絶対上限に達した場合：リセットされるまで待つ（広告視聴でも解除不可） ──
  if (hardLimited) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={st.overlay}>
          <View style={st.card}>
            <View style={st.handle} />
            <View style={[st.iconWrap, { backgroundColor: 'rgba(245,158,11,0.2)' }]}>
              <Ionicons name="time-outline" size={36} color="#f59e0b" />
            </View>
            <Text style={st.title}>{limitType === 'monthly' ? t('adGateModal.hardLimit.titleMonthly') : t('adGateModal.hardLimit.titleDaily')}</Text>
            <Text style={st.sub}>
              {limitType === 'monthly'
                ? t('adGateModal.hardLimit.subMonthly', { feature: featureName })
                : t('adGateModal.hardLimit.subDaily', { feature: featureName })}
            </Text>
            <TouchableOpacity style={[st.primaryBtn, { backgroundColor: '#374151' }]} onPress={onClose} activeOpacity={0.85}>
              <Text style={st.primaryBtnTxt}>{t('adGateModal.hardLimit.close')}</Text>
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
            <Text style={st.title}>{t('adGateModal.watching.title')}</Text>
            <Text style={st.sub}>{t('adGateModal.watching.sub', { feature: featureName, watched: adProgress, needed: ADS_NEEDED })}</Text>
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

          <Text style={st.title}>{t('adGateModal.main.title')}</Text>
          <Text style={st.sub}>{t('adGateModal.main.sub', { feature: featureName, needed: ADS_NEEDED })}</Text>

          {/* 広告視聴ボタン */}
          <TouchableOpacity
            style={[st.primaryBtn, { backgroundColor: '#1d4ed8' }]}
            onPress={handleWatchAds}
            activeOpacity={0.85}
          >
            <Ionicons name="play-circle-outline" size={18} color="#fff" />
            <Text style={st.primaryBtnTxt}>{t('adGateModal.main.cta', { needed: ADS_NEEDED })}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={st.cancelBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={st.cancelTxt}>{t('adGateModal.main.notNow')}</Text>
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

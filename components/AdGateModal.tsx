// components/AdGateModal.tsx — アップグレード促進 & 広告リワードモーダル（ダークデザイン）
// 表示パターン:
//   needsAd=true, !hardLimited  → 広告1本でAI機能解放（フリープラン）
//   hardLimited, limitType=daily → 今日は使用済み（明日また可能）
//   hardLimited, limitType=monthly → 今月のPRO上限
//   isGuest                     → ログイン促進
import React, { useEffect, useState } from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import type { Feature } from '../lib/adGate'
import { watchAdsForReward } from '../lib/rewardedAd'
import { trackPaywallView } from '../lib/analytics'

const BRAND       = '#166534'
const PRO_COLOR   = '#166534'
const ELITE_COLOR = '#B45309'
const ADS_NEEDED  = 1   // 1本の広告視聴でAI機能1回解放

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
  limitType?:   'none' | 'daily' | 'monthly' | 'total'   // ← 制限種別（メッセージ分岐用）
  isGuest?:     boolean
  onClose:      () => void
  onAdWatched:  () => void  // 「今回は使う」ボタン
  onUpgrade:    () => void
}

export default function AdGateModal({
  visible, feature, remaining = 0, hardLimited = false,
  limitType = 'none', isGuest = false, onClose, onAdWatched, onUpgrade,
}: Props) {
  const router = useRouter()
  const featureName = FEATURE_LABELS[feature] ?? '機能'

  // 広告視聴中の状態
  const [watching, setWatching]   = useState(false)
  const [adProgress, setAdProgress] = useState(0)   // 0〜ADS_NEEDED

  // モーダルが閉じたらリセット
  useEffect(() => {
    if (!visible) { setWatching(false); setAdProgress(0) }
  }, [visible])

  // ペイウォール表示トラッキング
  useEffect(() => {
    if (visible && remaining === 0 && !isGuest) {
      trackPaywallView(feature)
    }
  }, [visible, feature, remaining, isGuest])

  // ── 広告1本視聴 → AI機能1回解放 ─────────────────────────
  const handleWatchAds = async () => {
    setWatching(true)
    setAdProgress(0)
    const success = await watchAdsForReward(ADS_NEEDED, (watched) => {
      setAdProgress(watched)
    })
    setWatching(false)
    if (success) {
      onAdWatched()   // 親に通知 → 解析実行
    } else {
      Alert.alert(
        '広告を最後まで見てください',
        '最後まで視聴すると1回無料で使用できます。',
        [{ text: 'OK' }]
      )
      setAdProgress(0)
    }
  }

  // ─────────────────────────────────────────────────────────
  // ゲスト：ログイン促進
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

  // ─────────────────────────────────────────────────────────
  // 残り1回：警告
  if (remaining === 1) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={st.overlay}>
          <View style={st.card}>
            <View style={st.handle} />
            <View style={[st.iconWrap, { backgroundColor: 'rgba(217,119,6,0.2)' }]}>
              <Ionicons name="warning-outline" size={32} color="#fbbf24" />
            </View>
            <Text style={st.title}>残り1回です ⚠️</Text>
            <Text style={st.sub}>
              {featureName}の無料枠が残り1回になりました。{'\n'}今のうちにアップグレードしませんか？
            </Text>
            <TouchableOpacity style={[st.primaryBtn, { backgroundColor: '#059669' }]} onPress={onAdWatched} activeOpacity={0.85}>
              <Ionicons name="play-circle-outline" size={18} color="#fff" />
              <Text style={st.primaryBtnTxt}>今回は使う（残り1回）</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.upgradeRow} onPress={onUpgrade} activeOpacity={0.8}>
              <View style={[st.planBadge, { backgroundColor: PRO_COLOR }]}><Text style={st.planBadgeTxt}>PRO</Text></View>
              <Text style={st.upgradeTxt}>PROプラン ¥480/月で使い放題に</Text>
              <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.4)" />
            </TouchableOpacity>
            <TouchableOpacity style={st.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={st.cancelTxt}>今はしない</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    )
  }

  // ─────────────────────────────────────────────────────────
  // 今日 / 今月 / 無料枠 を使い切った
  if (hardLimited) {
    const isMonthly = limitType === 'monthly'
    const isTotal   = limitType === 'total'
    const limitTitle = isMonthly ? '今月は使い切りました'
                     : isTotal   ? '無料枠を使い切りました'
                     :             '今日は使い切りました'
    const limitSub   = isMonthly
      ? `${featureName}の今月の上限に達しました。\nELITEプランなら完全無制限です。`
      : isTotal
      ? `${featureName}の無料回数を使い切りました。\nアップグレードで続けて使えます。`
      : `${featureName}は毎日1回、広告を見て無料で使えます。\n明日また使えます。`
    const proLabel   = isMonthly ? 'ELITEプラン ¥980/月で完全無制限に'
                                 : 'PROプラン ¥480/月で月30回使い放題'
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={st.overlay}>
          <View style={st.card}>
            <View style={st.handle} />
            <View style={[st.iconWrap, { backgroundColor: 'rgba(220,38,38,0.2)' }]}>
              <Ionicons name="lock-closed" size={32} color="#f87171" />
            </View>
            <Text style={st.title}>{limitTitle}</Text>
            <Text style={st.sub}>{limitSub}</Text>
            <TouchableOpacity style={[st.primaryBtn, { backgroundColor: isMonthly ? ELITE_COLOR : PRO_COLOR }]} onPress={onUpgrade} activeOpacity={0.85}>
              <Ionicons name="star-outline" size={18} color="#fff" />
              <Text style={st.primaryBtnTxt}>{proLabel}</Text>
            </TouchableOpacity>
            {!isMonthly && (
              <TouchableOpacity style={st.eliteRow} onPress={onUpgrade} activeOpacity={0.8}>
                <View style={[st.planBadge, { backgroundColor: ELITE_COLOR }]}><Text style={st.planBadgeTxt}>ELITE</Text></View>
                <Text style={st.upgradeTxt}>完全無制限は ELITEプラン ¥980/月</Text>
                <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.4)" />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={st.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={st.cancelTxt}>今はしない</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    )
  }

  // ─────────────────────────────────────────────────────────
  // 広告1本で今日1回使える
  const proFeatureDetail =
    feature === 'video'       ? 'AI動画分析 月30回（ELITEで無制限）' :
    feature === 'meal'        ? 'AI食事分析 月30回（ELITEで無制限）' :
    feature === 'ai_analysis' ? 'AI練習分析 月30回（ELITEで無制限）' :
    feature === 'csv'         ? 'CSVエクスポート 月1回（ELITEで無制限）' : 'AI機能 月30回'

  // 広告視聴中UI
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
            <Text style={st.sub}>最後まで見るとAIが1回使えます</Text>
            <ActivityIndicator size="large" color={BRAND} style={{ marginTop: 8 }} />
          </View>
        </View>
      </Modal>
    )
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.overlay}>
        <View style={st.card}>
          <View style={st.handle} />
          <View style={[st.iconWrap, { backgroundColor: 'rgba(37,99,235,0.2)' }]}>
            <Ionicons name="play-circle-outline" size={36} color="#60a5fa" />
          </View>

          <Text style={st.title}>広告を見てAIを使う 🎬</Text>
          <Text style={st.sub}>{featureName}は毎日1回、広告1本で無料で使えます。</Text>

          {/* 広告1本で解除ボタン */}
          <TouchableOpacity
            style={[st.primaryBtn, { backgroundColor: '#1d4ed8' }]}
            onPress={handleWatchAds}
            activeOpacity={0.85}
          >
            <Ionicons name="play-circle-outline" size={18} color="#fff" />
            <Text style={st.primaryBtnTxt}>広告 1 本を見てAIを使う（無料）</Text>
          </TouchableOpacity>

          {/* PRO ボタン */}
          <TouchableOpacity style={[st.primaryBtn, { backgroundColor: PRO_COLOR }]} onPress={onUpgrade} activeOpacity={0.85}>
            <Ionicons name="star-outline" size={18} color="#fff" />
            <Text style={st.primaryBtnTxt}>PROプランへアップグレード ¥480/月</Text>
          </TouchableOpacity>

          {/* PRO 特典 */}
          <View style={st.benefitBox}>
            <Text style={st.benefitTxt}>✓ {proFeatureDetail}</Text>
            <Text style={st.benefitTxt}>✓ 広告なしで快適に使える</Text>
            <Text style={st.benefitTxt}>✓ バナー広告も非表示</Text>
          </View>

          {/* ELITE */}
          <TouchableOpacity style={st.eliteRow} onPress={onUpgrade} activeOpacity={0.8}>
            <View style={[st.planBadge, { backgroundColor: ELITE_COLOR }]}><Text style={st.planBadgeTxt}>ELITE</Text></View>
            <Text style={st.upgradeTxt}>完全無制限は ELITEプラン ¥980/月</Text>
            <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.4)" />
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
  upgradeRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 12, width: '100%' },
  eliteRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: 10, width: '100%' },
  planBadge:     { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  planBadgeTxt:  { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  upgradeTxt:    { flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
  benefitBox:    { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, padding: 12, width: '100%', gap: 4 },
  benefitTxt:    { fontSize: 12, color: 'rgba(255,255,255,0.75)', lineHeight: 18 },
  cancelBtn:     { paddingVertical: 8 },
  cancelTxt:     { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
})

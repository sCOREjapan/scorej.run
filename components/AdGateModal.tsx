// components/AdGateModal.tsx — アップグレード促進 & 広告リワードモーダル
// 表示パターン:
//   remaining=1             → 残り1回警告（softWarn）
//   remaining=0, rewardUses=0, !hardLimited → 無料枠ゼロ + 広告3本で解除 + PRO誘導
//   remaining=0, hardLimited → PRO日次/月次上限（広告解除なし）
//   isGuest                 → ログイン促進
import React, { useEffect, useState } from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import type { Feature } from '../lib/adGate'
import { grantRewardUse } from '../lib/adGate'
import { watchAdsForReward } from '../lib/rewardedAd'
import { trackPaywallView } from '../lib/analytics'

const BRAND       = '#166534'
const PRO_COLOR   = '#166534'
const ELITE_COLOR = '#B45309'
const ADS_NEEDED  = 3   // 解除に必要な広告本数

// ── 機能名マップ ──────────────────────────────────────────────
const FEATURE_LABELS: Record<Feature, string> = {
  ai_analysis: 'AI練習分析コーチ',
  video:       '動画フォーム分析',
  meal:        'AI食事分析',
  csv:         'CSVエクスポート',
  recovery:    'AIリカバリー相談',
}

interface Props {
  visible:      boolean
  feature:      Feature
  remaining?:   number   // 残り無料回数
  rewardUses?:  number   // 広告で獲得済みの残りリワード回数
  hardLimited?: boolean
  isGuest?:     boolean
  onClose:      () => void
  onAdWatched:  () => void  // 「今回は使う」「リワード使用」ボタン
  onUpgrade:    () => void
}

export default function AdGateModal({
  visible, feature, remaining = 0, rewardUses = 0, hardLimited = false,
  isGuest = false, onClose, onAdWatched, onUpgrade,
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
    if (visible && remaining === 0 && rewardUses === 0 && !isGuest) {
      trackPaywallView(feature)
    }
  }, [visible, feature, remaining, rewardUses, isGuest])

  // ── 広告3本視聴 → リワード付与 ───────────────────────────
  const handleWatchAds = async () => {
    setWatching(true)
    setAdProgress(0)
    const success = await watchAdsForReward(ADS_NEEDED, (watched) => {
      setAdProgress(watched)
    })
    setWatching(false)
    if (success) {
      await grantRewardUse(feature)
      onAdWatched()   // 親に通知 → 解析実行
    } else {
      Alert.alert(
        '広告を最後まで見てください',
        `${ADS_NEEDED}本すべて視聴すると1回使用できます。`,
        [{ text: 'OK' }]
      )
      setAdProgress(0)
    }
  }

  // ─────────────────────────────────────────────────────────
  // ゲスト：ログイン促進
  if (isGuest) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={st.overlay}>
          <View style={st.card}>
            <View style={[st.iconWrap, { backgroundColor: '#EFF6FF' }]}>
              <Ionicons name="person-circle-outline" size={36} color="#2563EB" />
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
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={st.overlay}>
          <View style={st.card}>
            <View style={[st.iconWrap, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="warning-outline" size={32} color="#D97706" />
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
              <Ionicons name="chevron-forward" size={14} color="#9ca3af" />
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
  // PRO日次/月次上限：広告解除なし
  if (hardLimited) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={st.overlay}>
          <View style={st.card}>
            <View style={[st.iconWrap, { backgroundColor: '#FEE2E2' }]}>
              <Ionicons name="lock-closed" size={32} color="#DC2626" />
            </View>
            <Text style={st.title}>本日の上限です</Text>
            <Text style={st.sub}>本日の利用上限に達しました。{'\n'}明日またお使いいただけます。</Text>
            <TouchableOpacity style={[st.primaryBtn, { backgroundColor: ELITE_COLOR }]} onPress={onUpgrade} activeOpacity={0.85}>
              <Ionicons name="star-outline" size={18} color="#fff" />
              <Text style={st.primaryBtnTxt}>ELITEプランで無制限に ¥1,480/月</Text>
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
  // 無料枠ゼロ：広告3本で解除 or PRO課金
  const proFeatureDetail =
    feature === 'video'       ? '動画分析 1日1回（ELITEで無制限）' :
    feature === 'meal'        ? '食事分析 1日3回（ELITEで無制限）' :
    feature === 'ai_analysis' ? 'AI分析コーチ 無制限' :
    feature === 'csv'         ? 'CSVエクスポート 月1回（ELITEで無制限）' : 'AI機能 使い放題'

  // 広告視聴中UI
  if (watching) {
    return (
      <Modal visible={visible} transparent animationType="fade">
        <View style={st.overlay}>
          <View style={st.card}>
            <View style={[st.iconWrap, { backgroundColor: '#F0FDF4' }]}>
              <Ionicons name="play-circle" size={36} color={BRAND} />
            </View>
            <Text style={st.title}>広告を視聴中...</Text>
            <Text style={st.sub}>{adProgress} / {ADS_NEEDED} 本完了{'\n'}最後まで見てください</Text>

            {/* 進捗ドット */}
            <View style={st.dotsRow}>
              {Array.from({ length: ADS_NEEDED }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    st.dot,
                    i < adProgress ? st.dotDone : i === adProgress ? st.dotActive : st.dotPending
                  ]}
                />
              ))}
            </View>

            <ActivityIndicator size="large" color={BRAND} style={{ marginTop: 8 }} />
          </View>
        </View>
      </Modal>
    )
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.overlay}>
        <View style={st.card}>
          <View style={[st.iconWrap, { backgroundColor: '#FEE2E2' }]}>
            <Ionicons name="lock-closed" size={32} color="#DC2626" />
          </View>

          <Text style={st.title}>無料枠を使い切りました</Text>
          <Text style={st.sub}>{featureName}の無料2回を使い切りました。{'\n'}広告視聴またはPROプランで続けて使えます。</Text>

          {/* 広告3本で解除ボタン */}
          <TouchableOpacity
            style={[st.primaryBtn, { backgroundColor: '#1d4ed8' }]}
            onPress={handleWatchAds}
            activeOpacity={0.85}
          >
            <Ionicons name="play-circle-outline" size={18} color="#fff" />
            <Text style={st.primaryBtnTxt}>動画広告 {ADS_NEEDED} 本を見て1回使う（無料）</Text>
          </TouchableOpacity>

          {/* 進捗ドット（まだ視聴前でも表示） */}
          <View style={st.dotsRow}>
            {Array.from({ length: ADS_NEEDED }).map((_, i) => (
              <View key={i} style={[st.dot, i < adProgress ? st.dotDone : st.dotPending]} />
            ))}
          </View>
          <Text style={{ fontSize: 10, color: '#9ca3af', marginTop: -4 }}>
            広告 {ADS_NEEDED} 本 = 1回分
          </Text>

          {/* PRO ボタン */}
          <TouchableOpacity style={[st.primaryBtn, { backgroundColor: PRO_COLOR }]} onPress={onUpgrade} activeOpacity={0.85}>
            <Ionicons name="star-outline" size={18} color="#fff" />
            <Text style={st.primaryBtnTxt}>PROプランへアップグレード ¥480/月</Text>
          </TouchableOpacity>

          {/* PRO 特典 */}
          <View style={st.benefitBox}>
            <Text style={st.benefitTxt}>✓ {proFeatureDetail}</Text>
            <Text style={st.benefitTxt}>✓ 広告なしで使い放題</Text>
            <Text style={st.benefitTxt}>✓ 全期間の記録履歴</Text>
          </View>

          {/* ELITE */}
          <TouchableOpacity style={st.eliteRow} onPress={onUpgrade} activeOpacity={0.8}>
            <View style={[st.planBadge, { backgroundColor: ELITE_COLOR }]}><Text style={st.planBadgeTxt}>ELITE</Text></View>
            <Text style={st.upgradeTxt}>完全無制限は ELITEプラン ¥1,480/月</Text>
            <Ionicons name="chevron-forward" size={14} color="#9ca3af" />
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
  overlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card:          { backgroundColor: '#fff', borderRadius: 24, padding: 24, width: '100%', maxWidth: 360, alignItems: 'center', gap: 12 },
  iconWrap:      { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title:         { fontSize: 18, fontWeight: '800', color: '#111827', textAlign: 'center' },
  sub:           { fontSize: 13, color: '#6b7280', textAlign: 'center', lineHeight: 20 },
  primaryBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 14, width: '100%' },
  primaryBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },
  upgradeRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f9fafb', borderRadius: 12, padding: 12, width: '100%' },
  eliteRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFBEB', borderRadius: 10, padding: 10, width: '100%' },
  planBadge:     { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  planBadgeTxt:  { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  upgradeTxt:    { flex: 1, fontSize: 12, color: '#374151', fontWeight: '600' },
  benefitBox:    { backgroundColor: '#F0FDF4', borderRadius: 12, padding: 12, width: '100%', gap: 4 },
  benefitTxt:    { fontSize: 12, color: '#166534', lineHeight: 18 },
  cancelBtn:     { paddingVertical: 8 },
  cancelTxt:     { fontSize: 13, color: '#9ca3af' },
  dotsRow:       { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  dot:           { width: 12, height: 12, borderRadius: 6 },
  dotPending:    { backgroundColor: '#e5e7eb' },
  dotActive:     { backgroundColor: '#93c5fd' },
  dotDone:       { backgroundColor: '#16a34a' },
})

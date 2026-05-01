// AdGateModal.tsx — 利用上限モーダル（リワード広告連携）
import React, { useState } from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { BRAND, TEXT } from '../lib/theme'
import { showRewardedAd } from '../lib/admob'
import { grantRewardUse } from '../lib/adGate'
import type { Feature } from '../lib/adGate'

interface Props {
  visible: boolean
  feature: Feature
  hardLimited?: boolean
  onClose: () => void
  onAdWatched: () => void   // 広告視聴 or 付与成功後に呼ばれる
  onUpgrade: () => void
}

const FEATURE_LABEL: Record<Feature, string> = {
  video:    '動画フォーム分析',
  meal:     'AI食事分析',
  recovery: 'AIリカバリー相談',
}

export default function AdGateModal({
  visible, feature, hardLimited = false,
  onClose, onAdWatched, onUpgrade,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const handleWatchAd = async () => {
    setError('')
    setLoading(true)
    try {
      const earned = await showRewardedAd()
      if (earned) {
        await grantRewardUse(feature)
        onAdWatched()
      } else {
        setError('広告の読み込みに失敗しました。もう一度お試しください。')
      }
    } catch (e) {
      setError('エラーが発生しました。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.overlay}>
        <View style={st.modal}>
          {/* ヘッダー */}
          <View style={st.header}>
            <Ionicons name="lock-closed" size={18} color={BRAND} />
            <Text style={{ color: BRAND, fontSize: 12, fontWeight: '700', flex: 1 }}>無料プラン</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={20} color={TEXT.secondary} />
            </TouchableOpacity>
          </View>

          {/* タイトル */}
          <Text style={st.title}>
            {hardLimited ? '本日の利用上限に達しました' : '無料利用回数を使い切りました'}
          </Text>
          <Text style={st.sub}>
            {hardLimited
              ? '明日またご利用いただけます\nプレミアムプランで無制限に利用できます'
              : `${FEATURE_LABEL[feature]}は\n広告を視聴すると続けて使えます`}
          </Text>

          {/* 広告視聴ボタン（上限未達のときのみ） */}
          {!hardLimited && (
            <TouchableOpacity
              style={[st.watchAdBtn, loading && { opacity: 0.6 }]}
              onPress={handleWatchAd}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Ionicons name="play-circle" size={20} color="#fff" />
                    <Text style={st.watchAdText}>広告を見て続ける（無料）</Text>
                  </>
              }
            </TouchableOpacity>
          )}

          {/* エラー表示 */}
          {!!error && (
            <Text style={st.errorText}>{error}</Text>
          )}

          {/* アップグレードリンク */}
          <TouchableOpacity style={st.upgradeBtn} onPress={onUpgrade} activeOpacity={0.8}>
            <Ionicons name="star" size={14} color="#FFD700" />
            <Text style={st.upgradeTxt}>広告なし・無制限 → プレミアムへ</Text>
            <Ionicons name="chevron-forward" size={14} color={TEXT.hint} />
          </TouchableOpacity>

          {/* 無料残り枠の説明 */}
          {!hardLimited && (
            <Text style={st.hint}>
              ※ 広告視聴で1回分追加されます
            </Text>
          )}
        </View>
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal:       { backgroundColor: '#111', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 20, width: '100%', maxWidth: 360, alignItems: 'center', gap: 12 },
  header:      { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' },
  title:       { color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  sub:         { color: TEXT.secondary, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  watchAdBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FF9500', borderRadius: 14, paddingVertical: 14, width: '100%' },
  watchAdText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  errorText:   { color: '#FF3B30', fontSize: 12, textAlign: 'center' },
  upgradeBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  upgradeTxt:  { color: TEXT.secondary, fontSize: 13, fontWeight: '600', flex: 1 },
  hint:        { color: TEXT.hint, fontSize: 11, textAlign: 'center' },
})

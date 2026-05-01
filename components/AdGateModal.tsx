// AdGateModal.tsx — 広告モーダル（外部広告スクリプト無効化済み）
import React from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { BRAND, TEXT, SURFACE2 } from '../lib/theme'
import type { Feature } from '../lib/adGate'

interface Props {
  visible: boolean
  feature: Feature
  adCount?: number
  hardLimited?: boolean
  onClose: () => void
  onAdWatched: () => void
  onUpgrade: () => void
}

export default function AdGateModal({ visible, feature, hardLimited = false, onClose, onAdWatched, onUpgrade }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.overlay}>
        <View style={st.modal}>
          <View style={st.header}>
            <Ionicons name="lock-closed" size={18} color={BRAND} />
            <Text style={{ color: BRAND, fontSize: 12, fontWeight: '700', flex: 1 }}>無料プラン</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={20} color={TEXT.secondary} />
            </TouchableOpacity>
          </View>

          <Text style={st.title}>
            {hardLimited ? '本日の利用上限に達しました' : '利用上限に達しました'}
          </Text>
          <Text style={st.sub}>
            {hardLimited
              ? '明日またご利用いただけます'
              : 'プレミアムプランで無制限に利用できます'}
          </Text>

          {!hardLimited && (
            <TouchableOpacity style={st.continueBtn} onPress={onAdWatched} activeOpacity={0.85}>
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>続ける</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={st.upgradeBtn} onPress={onUpgrade} activeOpacity={0.8}>
            <Ionicons name="star" size={14} color="#FFD700" />
            <Text style={{ color: TEXT.secondary, fontSize: 13, fontWeight: '600' }}>プレミアムへアップグレード ¥980/月</Text>
            <Ionicons name="chevron-forward" size={14} color={TEXT.hint} />
          </TouchableOpacity>
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
  sub:         { color: TEXT.secondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  continueBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#34C759', borderRadius: 14, paddingVertical: 14, width: '100%' },
  upgradeBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
})

// components/TicketGateModal.tsx — チケット残高不足モーダル
// checkAdGate() が needsTicket=true かつ allowed=false（残高不足）のときに表示。
// 「広告を見てチケット+1」をその場で完結できる導線にし（earnTicketFromAd、1日上限あり）、
// 購入 / 月額プランへの導線もあわせて提示する。
import React, { useEffect, useRef, useState } from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import type { Feature } from '../lib/adGate'
import { earnTicketFromAd, getAdTicketRemainingToday, getTicketBalance } from '../lib/ticketWallet'
import { watchAdsForReward } from '../lib/rewardedAd'
import { trackPaywallView } from '../lib/analytics'
import Toast from 'react-native-toast-message'

const TIX  = '#f59e0b'
const PREM = '#7c3aed'

const FEATURE_LABELS: Partial<Record<Feature, string>> = {
  video:            '動画フォーム分析',
  workout:          'AI練習メニュー生成',
  meal:             'AI食事分析',
  ai_analysis:      'AI練習分析コーチ',
  recovery:         'AIリカバリー相談',
  meal_coach:       'AI食事コーチ',
  daily_insight:    '今日のAIアドバイス',
  notebook_ai:      '練習ノートAI解析',
  competition_plan: '大会プラン生成',
  injury_recovery:  '復帰プラン生成',
}

interface Props {
  visible:       boolean
  feature:       Feature
  ticketCost:    number
  ticketBalance: number
  onClose:       () => void
}

export default function TicketGateModal({ visible, feature, ticketCost, ticketBalance, onClose }: Props) {
  const router = useRouter()
  const featureName = FEATURE_LABELS[feature] ?? '機能'

  // 広告視聴で増えた分をその場で反映するため、残高・不足枚数はローカルstateで持つ
  const [balance, setBalance] = useState(ticketBalance)
  const [watchingAd, setWatchingAd] = useState(false)
  const [adTicketsLeft, setAdTicketsLeft] = useState(0)
  const adLockRef = useRef(false)
  const shortage = Math.max(0, ticketCost - balance)

  useEffect(() => {
    if (!visible) return
    setBalance(ticketBalance)
    getAdTicketRemainingToday().then(setAdTicketsLeft).catch(() => {})
  }, [visible, ticketBalance])

  // 表示イベントの計測は「開いた瞬間」だけに絞る（残高更新のたびに二重計測しない）
  useEffect(() => {
    if (visible) trackPaywallView(`ticket_gate_modal:${feature}`)
  }, [visible])

  const handleWatchAd = async () => {
    if (adLockRef.current || adTicketsLeft <= 0) return
    adLockRef.current = true
    setWatchingAd(true)
    try {
      const ok = await watchAdsForReward(1)
      if (!ok) return
      const r = await earnTicketFromAd()
      if (r.granted) {
        setBalance(await getTicketBalance())
        setAdTicketsLeft(await getAdTicketRemainingToday())
        Toast.show({ type: 'success', text1: '🎫 チケット1枚を獲得しました！' })
      }
    } finally {
      setWatchingAd(false)
      adLockRef.current = false
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.overlay}>
        <View style={st.card}>
          <View style={st.handle} />
          <View style={[st.iconWrap, { backgroundColor: 'rgba(245,158,11,0.18)' }]}>
            <Text style={{ fontSize: 30 }}>🎫</Text>
          </View>
          <Text style={st.title}>チケットが足りません</Text>
          <Text style={st.sub}>
            {featureName}には{ticketCost}枚必要です（現在{balance}枚・あと{shortage}枚）
          </Text>

          <TouchableOpacity
            style={[st.primaryBtn, { backgroundColor: '#22c55e' }, (watchingAd || adTicketsLeft <= 0) && { opacity: 0.5 }]}
            onPress={handleWatchAd}
            activeOpacity={0.85}
            disabled={watchingAd || adTicketsLeft <= 0}
          >
            {watchingAd ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="play-circle" size={18} color="#fff" />
            )}
            <Text style={[st.primaryBtnTxt, { color: '#fff' }]}>
              {watchingAd ? '広告を読み込み中...'
                : adTicketsLeft > 0 ? `広告を見てチケット+1（本日あと${adTicketsLeft}回）`
                : '本日の獲得上限に達しました'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[st.secondaryBtn, { borderColor: TIX }]}
            onPress={() => { onClose(); router.push('/tickets') }}
            activeOpacity={0.85}
          >
            <Text style={{ fontSize: 16 }}>🎫</Text>
            <Text style={[st.secondaryBtnTxt, { color: TIX }]}>チケットを購入する</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[st.secondaryBtn, { borderColor: PREM }]}
            onPress={() => { onClose(); router.push('/paywall?plan=ticket_monthly') }}
            activeOpacity={0.85}
          >
            <Ionicons name="refresh" size={16} color={PREM} />
            <Text style={[st.secondaryBtnTxt, { color: PREM }]}>チケット月額プランで毎月100枚</Text>
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
  overlay:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  card:           {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 36,
    alignItems: 'center', gap: 12,
  },
  handle:         { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 4 },
  iconWrap:       { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title:          { fontSize: 18, fontWeight: '800', color: '#fff', textAlign: 'center' },
  sub:            { fontSize: 13, color: 'rgba(255,255,255,0.65)', textAlign: 'center', lineHeight: 20 },
  primaryBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 14, width: '100%' },
  primaryBtnTxt:  { fontSize: 14, fontWeight: '800' },
  secondaryBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 12, width: '100%', borderWidth: 1.5 },
  secondaryBtnTxt:{ fontSize: 13, fontWeight: '700' },
  cancelBtn:      { paddingVertical: 8 },
  cancelTxt:      { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
})

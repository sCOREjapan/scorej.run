// components/TicketGateModal.tsx — チケット残高不足モーダル
// checkAdGate() が needsTicket=true かつ allowed=false（残高不足）のときに表示。
// 2026-09-03: 下からのボトムシート(小さい・背景が透けて見える)から、画面全体を覆う
// フルスクリーンモーダルに変更(mitameでA/B/C案をプレビューし、Aで確定)。
// あわせて、月額プラン(¥980〜)への導線を最上段の主CTAにし、広告視聴・単発購入は
// その下のサブ導線に格下げ（APIコストが広告収益を上回っていたための収益改善施策）。
import React, { useEffect, useRef, useState } from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import type { Feature } from '../lib/adGate'
import { earnTicketFromAd, getAdTicketRemainingToday, getTicketBalance } from '../lib/ticketWallet'
import { watchAdsForReward } from '../lib/rewardedAd'
import { trackPaywallView } from '../lib/analytics'
import Toast from 'react-native-toast-message'
import { useTranslation } from 'react-i18next'

const BRAND = '#166534'
const TIX   = '#f59e0b'
const TEXT_1 = '#111827'
const TEXT_2 = '#6b7280'
const TEXT_HINT = '#9ca3af'
const BG    = '#f6f6f8'
const BORDER = 'rgba(0,0,0,0.08)'

interface Props {
  visible:       boolean
  feature:       Feature
  ticketCost:    number
  ticketBalance: number
  onClose:       () => void
}

export default function TicketGateModal({ visible, feature, ticketCost, ticketBalance, onClose }: Props) {
  const router = useRouter()
  const { t } = useTranslation()
  const featureName = t(`adGateModal.features.${feature}`, { defaultValue: t('adGateModal.features.default') })

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
        Toast.show({ type: 'success', text1: t('ticketGateModal.ticketEarned') })
      }
    } finally {
      setWatchingAd(false)
      adLockRef.current = false
    }
  }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
        <TouchableOpacity style={st.closeBtn} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={22} color={TEXT_HINT} />
        </TouchableOpacity>

        <View style={st.body}>
          <View style={st.iconWrap}>
            <Text style={{ fontSize: 34 }}>🎫</Text>
          </View>
          <Text style={st.title}>{t('ticketGateModal.title')}</Text>
          <Text style={st.sub}>
            {t('ticketGateModal.sub', { feature: featureName, cost: ticketCost, balance, shortage })}
          </Text>

          <View style={st.btns}>
            {/* 主CTA：月額プラン（¥980〜・毎月チケット100枚）。広告/単発購入より上に配置 */}
            <TouchableOpacity
              style={st.primaryBtn}
              onPress={() => { onClose(); router.push('/paywall?plan=ticket_monthly') }}
              activeOpacity={0.85}
            >
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={st.primaryBtnTxt}>{t('ticketGateModal.monthlyPlan')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[st.secondaryBtn, (watchingAd || adTicketsLeft <= 0) && { opacity: 0.5 }]}
              onPress={handleWatchAd}
              activeOpacity={0.85}
              disabled={watchingAd || adTicketsLeft <= 0}
            >
              {watchingAd ? (
                <ActivityIndicator size="small" color={TEXT_1} />
              ) : (
                <Ionicons name="play-circle-outline" size={17} color={TEXT_1} />
              )}
              <Text style={st.secondaryBtnTxt}>
                {watchingAd ? t('ticketGateModal.watchAdLoading')
                  : adTicketsLeft > 0 ? t('ticketGateModal.watchAdCta', { n: adTicketsLeft })
                  : t('ticketGateModal.watchAdCapReached')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={st.secondaryBtn}
              onPress={() => { onClose(); router.push('/tickets') }}
              activeOpacity={0.85}
            >
              <Text style={{ fontSize: 15 }}>🎫</Text>
              <Text style={st.secondaryBtnTxt}>{t('ticketGateModal.buyTickets')}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={st.cancelBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={st.cancelTxt}>{t('ticketGateModal.notNow')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const st = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: BG },
  closeBtn:       { alignSelf: 'flex-end', padding: 16 },
  body:           { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingBottom: 24 },
  iconWrap:       {
    width: 76, height: 76, borderRadius: 22,
    backgroundColor: 'rgba(245,158,11,0.14)',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 12, marginBottom: 18,
  },
  title:          { fontSize: 19, fontWeight: '800', color: TEXT_1, textAlign: 'center', marginBottom: 8 },
  sub:            { fontSize: 13, color: TEXT_2, textAlign: 'center', lineHeight: 20, paddingHorizontal: 8 },
  btns:           { width: '100%', gap: 11, marginTop: 'auto', marginBottom: 10 },
  primaryBtn:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: BRAND, borderRadius: 14, paddingVertical: 15, width: '100%',
  },
  primaryBtnTxt:  { fontSize: 14, fontWeight: '800', color: '#fff' },
  secondaryBtn:   {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 14, paddingVertical: 13, width: '100%',
    borderWidth: 1.3, borderColor: BORDER,
  },
  secondaryBtnTxt:{ fontSize: 13, fontWeight: '700', color: TEXT_1 },
  cancelBtn:      { paddingVertical: 8 },
  cancelTxt:      { fontSize: 12.5, color: TEXT_HINT },
})

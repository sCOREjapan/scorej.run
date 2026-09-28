// components/TicketGateModal.tsx — チケット残高不足モーダル
// checkAdGate() が needsTicket=true かつ allowed=false（残高不足）のときに表示。
// 2026-09-03: 下からのボトムシート(小さい・背景が透けて見える)から、画面全体を覆う
// フルスクリーンモーダルに変更(mitameでA/B/C案をプレビューし、Aで確定)。
// あわせて、月額プラン(¥980〜)への導線を最上段の主CTAにし、広告視聴・単発購入は
// その下のサブ導線に格下げ（APIコストが広告収益を上回っていたための収益改善施策）。
// 2026-09-26:「デザインがダサい」との指摘で刷新。汎用のドル札アイコン→Scoppyマスコット
// (チケットを掲げて喜ぶポーズ)に差し替え、単調な白背景→ブランドカラーの淡いグラデーション、
// ボタンにHapticTouchのタップ演出を追加。ボタンの構成・優先順位（月額プラン主導線という
// 収益改善施策）とロジックは一切変更していない。
import React, { useEffect, useRef, useState } from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import type { Feature } from '../lib/adGate'
import { earnTicketFromAd, getAdTicketRemainingToday, getTicketBalance } from '../lib/ticketWallet'
import { watchAdsForReward } from '../lib/rewardedAd'
import { trackPaywallView, trackPaywallDismiss } from '../lib/analytics'
import HapticTouch from './HapticTouch'
import Toast from 'react-native-toast-message'
import { useTranslation } from 'react-i18next'

const BRAND = '#166534'
const TIX   = '#f59e0b'
const MASCOT = require('../assets/illustrations/mascot/mascot_ticket_celebrate.png')
const TICKET_ICON = require('../assets/icons/ticket.png')
const TEXT_1 = '#111827'
const TEXT_2 = '#6b7280'
const TEXT_HINT = '#9ca3af'
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

  // 離脱（購入導線に進まず閉じた）だけを計測する。watchAd/buyTickets/月額プランへの
  // 遷移はonCloseを呼ぶが「離脱」ではないため、そちらではtrackPaywallDismissを呼ばない
  const handleDismiss = () => {
    trackPaywallDismiss(`ticket_gate_modal:${feature}`)
    onClose()
  }

  const handleWatchAd = async () => {
    if (adLockRef.current) return
    adLockRef.current = true
    try {
      // 2026-09-17実機バグ報告「広告を1回も見ていないのに上限扱いになる」に対応。
      // adTicketsLeftはuseState(0)の初期値のまま、モーダルが開いた直後に素早く
      // タップされるとuseEffectの非同期読み込みが間に合わず0(=上限)と誤判定して
      // いた（何も起きず押しても反応しないように見えるバグの原因）。タップ時点で
      // AsyncStorageから最新値を取り直してから判定する。
      const fresh = await getAdTicketRemainingToday()
      setAdTicketsLeft(fresh)
      if (fresh <= 0) return
      setWatchingAd(true)
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
    <Modal visible={visible} animationType="fade" onRequestClose={handleDismiss}>
      <LinearGradient colors={['#eafaf0', '#fbfdfc', '#ffffff']} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
        <TouchableOpacity style={st.closeBtn} onPress={handleDismiss} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={22} color={TEXT_HINT} />
        </TouchableOpacity>

        <View style={st.body}>
          <View style={st.mascotWrap}>
            <View style={st.mascotGlow} />
            <Image source={MASCOT} style={st.mascotImg} resizeMode="contain" />
          </View>

          <Text style={st.title}>{t('ticketGateModal.title')}</Text>
          <Text style={st.sub}>
            {t('ticketGateModal.sub', { feature: featureName, cost: ticketCost, balance, shortage })}
          </Text>

          <View style={st.statRow}>
            <View style={st.statChip}>
              <Image source={TICKET_ICON} style={{ width: 14, height: 14 }} resizeMode="contain" />
              <Text style={st.statChipLabel}>{t('ticketGateModal.statBalance')}</Text>
              <Text style={st.statChipValue}>{balance}</Text>
            </View>
            <Ionicons name="arrow-forward" size={14} color={TEXT_HINT} />
            <View style={[st.statChip, st.statChipNeed]}>
              <Text style={[st.statChipLabel, { color: TIX }]}>{t('ticketGateModal.statNeeded')}</Text>
              <Text style={[st.statChipValue, { color: TIX }]}>{ticketCost}</Text>
            </View>
          </View>

          <View style={st.btns}>
            {/* 主CTA：月額プラン（¥980〜・毎月チケット100枚）。広告/単発購入より上に配置 */}
            <HapticTouch
              haptic="whoosh"
              style={st.primaryBtn}
              onPress={() => { onClose(); router.push('/paywall?plan=ticket_monthly') }}
              activeOpacity={0.88}
            >
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={st.primaryBtnTxt}>{t('ticketGateModal.monthlyPlan')}</Text>
            </HapticTouch>

            <HapticTouch
              haptic="tap"
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
            </HapticTouch>

            <HapticTouch
              haptic="tap"
              style={st.secondaryBtn}
              onPress={() => { onClose(); router.push('/tickets') }}
              activeOpacity={0.85}
            >
              <Image source={TICKET_ICON} style={{ width: 17, height: 17 }} resizeMode="contain" />
              <Text style={st.secondaryBtnTxt}>{t('ticketGateModal.buyTickets')}</Text>
            </HapticTouch>
          </View>

          <TouchableOpacity style={st.cancelBtn} onPress={handleDismiss} activeOpacity={0.7}>
            <Text style={st.cancelTxt}>{t('ticketGateModal.notNow')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const st = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: 'transparent' },
  closeBtn:       { alignSelf: 'flex-end', padding: 16 },
  body:           { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingBottom: 24 },
  mascotWrap:     {
    width: 148, height: 148,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 4, marginBottom: 14,
  },
  mascotGlow:     {
    position: 'absolute', width: 148, height: 148, borderRadius: 74,
    backgroundColor: 'rgba(22,101,52,0.10)',
  },
  mascotImg:      { width: 128, height: 128 },
  title:          { fontSize: 21, fontWeight: '800', color: TEXT_1, textAlign: 'center', marginBottom: 8, letterSpacing: 0.2 },
  sub:            { fontSize: 13, color: TEXT_2, textAlign: 'center', lineHeight: 20, paddingHorizontal: 8 },
  statRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  statChip:       {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  statChipNeed:   { borderColor: 'rgba(245,158,11,0.35)', backgroundColor: 'rgba(245,158,11,0.06)' },
  statChipLabel:  { fontSize: 11, fontWeight: '700', color: TEXT_2 },
  statChipValue:  { fontSize: 14, fontWeight: '900', color: BRAND },
  btns:           { width: '100%', gap: 11, marginTop: 'auto', marginBottom: 10 },
  primaryBtn:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: BRAND, borderRadius: 14, paddingVertical: 15, width: '100%',
    shadowColor: BRAND, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 14, elevation: 4,
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

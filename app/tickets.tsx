// app/tickets.tsx — チケット購入画面（消耗型IAP）
// 動画分析(3枚)/AIメニュー作成(2枚)/AI食事分析(1枚)等のAI機能すべてが消費する共通チケットを購入する。
import React, { useState, useEffect, useCallback, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { usePurchase } from '../context/PurchaseContext'
import { PRODUCT_IDS, purchaseConsumable, TICKET_MONTHLY_GRANT } from '../lib/purchaseService'
import { getWalletSnapshot, grantTickets, earnTicketFromAd, getAdTicketRemainingToday } from '../lib/ticketWallet'
import { watchAdsForReward } from '../lib/rewardedAd'
import Toast from 'react-native-toast-message'

const TIX    = '#f59e0b'
const BRAND  = '#16a34a'
const BG     = '#f6f6f8'
const CARD   = '#ffffff'
const BORDER = 'rgba(0,0,0,0.08)'
const TEXT_PRIMARY   = '#111827'
const TEXT_SECONDARY = '#6b7280'
const TEXT_HINT      = '#9ca3af'

const PACKS = [
  { id: 'light' as const, productId: PRODUCT_IDS.tickets_light, count: 15, price: '¥370', per: '¥24.7 / 枚', popular: false },
  { id: 'value' as const, productId: PRODUCT_IDS.tickets_value, count: 50, price: '¥730', per: '¥14.6 / 枚（約41%お得）', popular: true },
]

export default function TicketsScreen() {
  const router = useRouter()
  const { packages, packagesReady, packagesDiagnostic, hasTicketMonthly } = usePurchase()

  const [tickets, setTickets]   = useState(0)
  const [selected, setSelected] = useState<'light' | 'value'>('value')
  const [purchasing, setPurchasing] = useState(false)
  const [watchingAd, setWatchingAd] = useState(false)
  const [adTicketsLeft, setAdTicketsLeft] = useState(0)
  // setPurchasing/setWatchingAdはReactの再レンダー待ちで反映が非同期なため、
  // 連打（disabledが効く前の2連タップ）を防ぐには同期的なrefロックが必要
  const purchaseLockRef = useRef(false)
  const adLockRef = useRef(false)

  const refresh = useCallback(async () => {
    const w = await getWalletSnapshot()
    setTickets(w.tickets)
    setAdTicketsLeft(await getAdTicketRemainingToday())
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const selectedPack = PACKS.find(p => p.id === selected)!
  const targetPkg = packages.find((pkg: any) => pkg.product?.identifier === selectedPack.productId)

  const handlePurchase = useCallback(async () => {
    if (purchaseLockRef.current) return
    if (!targetPkg) {
      Toast.show({
        type: 'error',
        text1: '商品の読み込みに失敗しました',
        text2: packagesDiagnostic ?? 'しばらく待ってから再試行してください',
        visibilityTime: 6000,
      })
      return
    }
    purchaseLockRef.current = true
    setPurchasing(true)
    try {
      const granted = await purchaseConsumable(targetPkg)
      if (granted) {
        await grantTickets(granted)
        await refresh()
        Toast.show({ type: 'success', text1: `🎫 チケット${granted}枚を追加しました` })
      }
    } catch (e: any) {
      Toast.show({ type: 'error', text1: '購入エラー', text2: e?.message ?? '購入に失敗しました' })
    } finally {
      setPurchasing(false)
      purchaseLockRef.current = false
    }
  }, [targetPkg, packagesDiagnostic, refresh])

  const handleWatchAd = useCallback(async () => {
    if (adLockRef.current) return
    if (adTicketsLeft <= 0) {
      Toast.show({ type: 'info', text1: '本日の獲得上限に達しました', text2: '明日また視聴できます' })
      return
    }
    adLockRef.current = true
    setWatchingAd(true)
    try {
      const ok = await watchAdsForReward(1)
      if (!ok) return
      const r = await earnTicketFromAd()
      await refresh()
      if (r.granted) {
        Toast.show({ type: 'success', text1: '🎫 チケット1枚を獲得しました！' })
      }
    } finally {
      setWatchingAd(false)
      adLockRef.current = false
    }
  }, [adTicketsLeft, refresh])

  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityLabel="閉じる" accessibilityRole="button">
          <Ionicons name="close" size={24} color={TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>チケットを購入</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={st.scroll}>
        <View style={st.balanceCard}>
          <Text style={st.balanceLabel}>現在の残高</Text>
          <Text style={st.balanceNum}>🎫 {tickets}<Text style={st.balanceUnit}>枚</Text></Text>
        </View>

        {PACKS.map(pack => {
          const isSelected = selected === pack.id
          return (
            <TouchableOpacity
              key={pack.id}
              onPress={() => setSelected(pack.id)}
              activeOpacity={0.8}
              style={[st.packCard, isSelected && { borderColor: TIX, borderWidth: 1.7 }, pack.popular && { marginTop: 14 }]}
            >
              {pack.popular && (
                <View style={st.popBadge}><Text style={st.popBadgeTxt}>人気</Text></View>
              )}
              <Text style={{ fontSize: 26, width: 44, textAlign: 'center' }}>{pack.popular ? '🎟️' : '🎫'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={st.packCount}>{pack.id === 'light' ? 'ライト' : 'お得'} {pack.count}枚</Text>
                <Text style={st.packPer}>{pack.per}</Text>
              </View>
              <Text style={st.packPrice}>{pack.price}</Text>
            </TouchableOpacity>
          )
        })}

        <View style={st.legend}>
          <Text style={st.legendTitle}>チケットの使い道</Text>
          <Text style={st.legendBody}>動画分析3枚／AIメニュー作成2枚／AI食事分析1枚 など、AI機能はすべて共通のチケットを消費します</Text>
        </View>

        <TouchableOpacity
          onPress={handlePurchase}
          disabled={purchasing || !packagesReady}
          activeOpacity={0.85}
          style={[st.purchaseBtn, (purchasing || !packagesReady) && { opacity: 0.55 }]}
        >
          {purchasing ? <ActivityIndicator color="#241300" /> : (
            <Text style={st.purchaseBtnTxt}>{selectedPack.id === 'light' ? 'ライト' : 'お得'} {selectedPack.count}枚 を購入 {selectedPack.price}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleWatchAd}
          disabled={watchingAd}
          activeOpacity={0.85}
          style={[st.adBtn, watchingAd && { opacity: 0.55 }]}
        >
          {watchingAd ? <ActivityIndicator color={TIX} size="small" /> : (
            <>
              <Ionicons name="play-circle-outline" size={16} color={TIX} />
              <Text style={st.adBtnTxt}>広告を見てチケット1枚を獲得（本日あと{adTicketsLeft}回）</Text>
            </>
          )}
        </TouchableOpacity>

        {!hasTicketMonthly && (
          <TouchableOpacity
            style={st.monthlyCard}
            onPress={() => router.push('/paywall?plan=ticket_monthly')}
            activeOpacity={0.85}
          >
            <View style={st.monthlyIconWrap}>
              <Ionicons name="refresh-circle" size={26} color={TIX} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.monthlyTitle}>よく使うなら チケット月額プラン</Text>
              <Text style={st.monthlySub}>毎月{TICKET_MONTHLY_GRANT}枚自動付与＋広告なし ¥980/月</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={TEXT_HINT} />
          </TouchableOpacity>
        )}

        {__DEV__ && (
          <TouchableOpacity
            style={{ marginTop: 4, alignSelf: 'center', padding: 10 }}
            onPress={async () => { await grantTickets(50); await refresh(); Toast.show({ type: 'success', text1: '[DEV] チケット50枚を付与しました' }) }}
          >
            <Text style={{ color: TIX, fontSize: 12, fontWeight: '700' }}>[DEV] チケット50枚を付与（開発用）</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: BG },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  closeBtn:      { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:   { fontSize: 17, fontWeight: '700', color: TEXT_PRIMARY },
  scroll:        { paddingHorizontal: 16, paddingTop: 8 },
  balanceCard:   { backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER, borderRadius: 21, padding: 22, alignItems: 'center', marginBottom: 16 },
  balanceLabel:  { fontSize: 12, color: TEXT_SECONDARY, marginBottom: 6 },
  balanceNum:    { fontSize: 34, fontWeight: '900', color: TIX },
  balanceUnit:   { fontSize: 16, color: TEXT_HINT, fontWeight: '700', marginLeft: 4 },
  packCard:      { backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER, borderRadius: 21, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, position: 'relative' },
  popBadge:      { position: 'absolute', top: -10, left: 16, backgroundColor: TIX, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  popBadgeTxt:   { fontSize: 10, fontWeight: '800', color: '#241300' },
  packCount:     { fontSize: 16, fontWeight: '800', color: TEXT_PRIMARY },
  packPer:       { fontSize: 11, color: TEXT_SECONDARY, marginTop: 2 },
  packPrice:     { fontSize: 19, fontWeight: '900', color: TIX },
  legend:        { backgroundColor: '#eef0f3', borderRadius: 14, padding: 14, marginTop: 18, marginBottom: 10 },
  legendTitle:   { fontSize: 12, fontWeight: '800', color: TEXT_PRIMARY, marginBottom: 4 },
  legendBody:    { fontSize: 11.5, color: TEXT_SECONDARY, lineHeight: 18 },
  purchaseBtn:   { backgroundColor: TIX, borderRadius: 21, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  purchaseBtnTxt:{ fontSize: 16, fontWeight: '800', color: '#241300' },
  adBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: TIX, borderRadius: 21, paddingVertical: 14, marginTop: 10 },
  adBtnTxt:      { fontSize: 13, fontWeight: '700', color: TIX },
  monthlyCard:   { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER, borderRadius: 18, padding: 14, marginTop: 18 },
  monthlyIconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(245,158,11,0.12)', alignItems: 'center', justifyContent: 'center' },
  monthlyTitle:  { fontSize: 14, fontWeight: '800', color: TEXT_PRIMARY },
  monthlySub:    { fontSize: 11.5, color: TEXT_SECONDARY, marginTop: 2 },
})

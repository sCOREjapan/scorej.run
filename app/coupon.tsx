// app/coupon.tsx — マーケティングクーポン入力画面
// SNS動画コメント欄でのクーポン配布キャンペーン専用
// ・SCR-XXXXX 形式の3日間全機能トライアルコードを入力
// ・2026年6月1日以降は一斉に無効化

import React, { useState, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  Animated, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { BRAND } from '../lib/theme'
import { usePurchase, isTrialCampaignActive } from '../context/PurchaseContext'

export default function CouponScreen() {
  const { applyCoupon } = usePurchase()

  const [code,    setCode]    = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState<'ok' | 'already_used' | 'campaign_expired' | 'invalid' | null>(null)

  const shakeAnim = useRef(new Animated.Value(0)).current
  const successAnim = useRef(new Animated.Value(0)).current

  function shake() {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10,  duration: 60,  useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60,  useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6,   duration: 50,  useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6,  duration: 50,  useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,   duration: 40,  useNativeDriver: true }),
    ]).start()
  }

  function celebrateSuccess() {
    Animated.spring(successAnim, {
      toValue: 1, useNativeDriver: true,
      tension: 80, friction: 6,
    }).start()
  }

  async function handleApply() {
    const cleaned = code.trim().toUpperCase()
    if (!cleaned) return
    setLoading(true)
    try {
      const res = await applyCoupon(cleaned)
      setResult(res)
      if (res === 'ok') {
        celebrateSuccess()
        // 3秒後にホームへ戻る
        setTimeout(() => router.replace('/(tabs)'), 3000)
      } else {
        shake()
      }
    } finally {
      setLoading(false)
    }
  }

  // ──────────────────────────────────────
  // 成功画面
  // ──────────────────────────────────────
  if (result === 'ok') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.successWrap}>
          <Animated.View style={[styles.successCircle, {
            transform: [{ scale: successAnim }],
            opacity:   successAnim,
          }]}>
            <Text style={{ fontSize: 56 }}>🎉</Text>
          </Animated.View>
          <Text style={styles.successTitle}>クーポン適用完了！</Text>
          <Text style={styles.successSub}>3日間、全機能が使い放題になりました</Text>
          <View style={styles.trialBadge}>
            <Ionicons name="time-outline" size={14} color={BRAND} />
            <Text style={[styles.trialBadgeText, { color: BRAND }]}>72時間 ELITE 体験</Text>
          </View>
          <Text style={styles.successNote}>
            キャンペーンへの参加ありがとうございます！{'\n'}
            引き続き使い続けたい場合はホーム画面から{'\n'}
            プレミアムプランをお選びください。
          </Text>
          <TouchableOpacity style={styles.homeBtn} onPress={() => router.replace('/(tabs)')}>
            <Text style={styles.homeBtnText}>ホームへ →</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ──────────────────────────────────────
  // 入力画面
  // ──────────────────────────────────────
  const campaignActive = isTrialCampaignActive()

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* ヘッダー */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>クーポンコード</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.body}>
          {/* キャンペーン期限バナー */}
          {campaignActive ? (
            <View style={styles.campaignBanner}>
              <Ionicons name="gift-outline" size={16} color="#166534" />
              <Text style={styles.campaignText}>
                キャンペーン中 — 2026年5月末まで有効
              </Text>
            </View>
          ) : (
            <View style={[styles.campaignBanner, { backgroundColor: '#fef2f2', borderColor: '#fca5a5' }]}>
              <Ionicons name="close-circle-outline" size={16} color="#dc2626" />
              <Text style={[styles.campaignText, { color: '#dc2626' }]}>
                キャンペーン期間は終了しました
              </Text>
            </View>
          )}

          {/* 説明 */}
          <Text style={styles.desc}>
            SNS動画のコメント欄で配布したクーポンコードを入力すると、
            <Text style={{ fontWeight: '800', color: BRAND }}>3日間</Text>
            すべての機能が無料で使えます。
          </Text>

          {/* コード入力 */}
          <Animated.View style={{ transform: [{ translateX: shakeAnim }] }}>
            <TextInput
              style={[
                styles.input,
                result === 'invalid'         && styles.inputError,
                result === 'already_used'    && styles.inputError,
                result === 'campaign_expired'&& styles.inputError,
              ]}
              value={code}
              onChangeText={v => { setCode(v.toUpperCase()); setResult(null) }}
              placeholder="SCR-XXXXX"
              placeholderTextColor="#9ca3af"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={9}
              editable={campaignActive && !loading}
              returnKeyType="done"
              onSubmitEditing={handleApply}
            />
          </Animated.View>

          {/* エラーメッセージ */}
          {result === 'invalid' && (
            <Text style={styles.errorText}>
              ⚠️ コードが正しくありません。もう一度確認してください。
            </Text>
          )}
          {result === 'already_used' && (
            <Text style={styles.errorText}>
              ⚠️ このデバイスではすでにトライアルを使用済みです。
            </Text>
          )}
          {result === 'campaign_expired' && (
            <Text style={styles.errorText}>
              ⚠️ このクーポンはキャンペーン期間が終了しています。
            </Text>
          )}

          {/* 適用ボタン */}
          <TouchableOpacity
            style={[styles.applyBtn, (!campaignActive || !code.trim()) && { opacity: 0.5 }]}
            onPress={handleApply}
            activeOpacity={0.85}
            disabled={!campaignActive || !code.trim() || loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="ticket-outline" size={18} color="#fff" />
                <Text style={styles.applyBtnText}>クーポンを適用する</Text>
              </>
            )}
          </TouchableOpacity>

          {/* 注意書き */}
          <Text style={styles.note}>
            ・コードは1デバイスにつき1回のみ使用可能{'\n'}
            ・3日間の体験後は自動的に無料プランに戻ります{'\n'}
            ・コードは2026年6月1日をもって一斉に無効化されます
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#f6f6f8' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  backBtn:     { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },

  body: { flex: 1, padding: 24, gap: 16 },

  campaignBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  campaignText: { fontSize: 13, fontWeight: '600', color: '#166534', flex: 1 },

  desc: { fontSize: 14, color: '#6b7280', lineHeight: 21 },

  input: {
    backgroundColor: '#fff',
    borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.12)',
    paddingHorizontal: 20, paddingVertical: 16,
    fontSize: 22, fontWeight: '800', letterSpacing: 3,
    color: '#111827', textAlign: 'center',
  },
  inputError: { borderColor: '#ef4444', backgroundColor: '#fef2f2' },
  errorText:  { fontSize: 13, color: '#ef4444', textAlign: 'center' },

  applyBtn: {
    backgroundColor: '#1c1c1e', borderRadius: 50,
    paddingVertical: 17, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 5,
  },
  applyBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },

  note: { fontSize: 12, color: '#9ca3af', lineHeight: 20, textAlign: 'center' },

  // 成功画面
  successWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16,
  },
  successCircle: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: '#f0fdf4', borderWidth: 2, borderColor: '#bbf7d0',
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  successTitle: { fontSize: 24, fontWeight: '900', color: '#111827' },
  successSub:   { fontSize: 15, color: '#6b7280', textAlign: 'center' },
  trialBadge:   {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#f0fdf4', borderRadius: 20, borderWidth: 1, borderColor: '#bbf7d0',
    paddingHorizontal: 14, paddingVertical: 6,
  },
  trialBadgeText: { fontSize: 13, fontWeight: '700' },
  successNote: { fontSize: 13, color: '#9ca3af', textAlign: 'center', lineHeight: 21 },
  homeBtn: {
    backgroundColor: '#1c1c1e', borderRadius: 50,
    paddingVertical: 15, paddingHorizontal: 40, marginTop: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 5,
  },
  homeBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
})

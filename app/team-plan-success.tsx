// app/team-plan-success.tsx — Stripe決済完了後、引き換えコードを表示する(Web専用)
// api/create-team-checkout.ts の success_url からリダイレクトされてくる。
import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

const BRAND = '#166534'
const PAPER = '#f6f8f6'

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')

const TIER_LABEL: Record<string, string> = {
  coach_monthly: 'スタンダード（〜15人）',
  coach_monthly_30: 'アドバンス（〜30人）',
  coach_monthly_unlimited: 'プレミアム（無制限）',
}

export default function TeamPlanSuccessScreen() {
  const params = useLocalSearchParams<{ session_id?: string }>()
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [code, setCode] = useState('')
  const [tier, setTier] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const sessionId = params.session_id
    if (!sessionId) { setState('error'); setErrorMsg('決済情報が見つかりませんでした'); return }
    fetch(`${API_BASE}/api/team-checkout-verify?session_id=${encodeURIComponent(sessionId)}`)
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error ?? 'コードの発行に失敗しました')
        setCode(json.code); setTier(json.tier); setState('ok')
      })
      .catch(e => { setErrorMsg(e?.message ?? 'コードの発行に失敗しました'); setState('error') })
  }, [params.session_id])

  const handleCopy = async () => {
    if (Platform.OS === 'web' && navigator?.clipboard) {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: PAPER }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        {state === 'loading' && (
          <>
            <ActivityIndicator size="large" color={BRAND} />
            <Text style={s.loadingText}>お支払いを確認しています…</Text>
          </>
        )}

        {state === 'error' && (
          <View style={s.card}>
            <Ionicons name="alert-circle" size={40} color="#dc2626" />
            <Text style={s.errorTitle}>エラーが発生しました</Text>
            <Text style={s.errorText}>{errorMsg}</Text>
          </View>
        )}

        {state === 'ok' && (
          <View style={s.card}>
            <View style={s.checkWrap}><Ionicons name="checkmark" size={32} color="#fff" /></View>
            <Text style={s.title}>お支払いありがとうございます</Text>
            <Text style={s.tierLabel}>{TIER_LABEL[tier] ?? tier}</Text>

            <Text style={s.codeLabel}>アプリ内で入力する引き換えコード</Text>
            <TouchableOpacity style={s.codeBox} onPress={handleCopy} activeOpacity={0.8}>
              <Text style={s.codeText}>{code}</Text>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={BRAND} />
            </TouchableOpacity>
            {copied && <Text style={s.copiedText}>コピーしました</Text>}

            <View style={s.stepsBox}>
              <Text style={s.stepsTitle}>次の手順</Text>
              <Text style={s.stepText}>1. sCOREアプリでログイン（未登録の場合は先に会員登録）</Text>
              <Text style={s.stepText}>2. 「チーム」タブ →「コーチとして始める」を選択</Text>
              <Text style={s.stepText}>3. 「コードをお持ちの方はこちら」に上記コードを入力</Text>
            </View>
            <Text style={s.note}>コードとメールアドレスは念のため控えておいてください。</Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  )
}

const s = StyleSheet.create({
  loadingText: { color: '#6b7280', fontSize: 13, marginTop: 12 },
  card: { backgroundColor: '#fff', borderRadius: 24, padding: 28, alignItems: 'center', maxWidth: 420, width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 20 },
  checkWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '900', color: '#0f1f16' },
  tierLabel: { fontSize: 13, color: BRAND, fontWeight: '700', marginTop: 4, marginBottom: 20 },
  codeLabel: { fontSize: 11.5, color: '#8a9184', fontWeight: '700' },
  codeBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f0f2f0', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, marginTop: 8, borderWidth: 1.5, borderColor: BRAND + '30', borderStyle: 'dashed' },
  codeText: { fontSize: 20, fontWeight: '900', color: '#0f1f16', letterSpacing: 1, fontVariant: ['tabular-nums'] },
  copiedText: { fontSize: 11, color: BRAND, marginTop: 6, fontWeight: '700' },
  stepsBox: { width: '100%', backgroundColor: '#f6f8f6', borderRadius: 14, padding: 16, marginTop: 24 },
  stepsTitle: { fontSize: 12.5, fontWeight: '800', color: '#0f1f16', marginBottom: 8 },
  stepText: { fontSize: 12, color: '#4b5f43', lineHeight: 20 },
  note: { fontSize: 11, color: '#9aa39a', marginTop: 16, textAlign: 'center' },
  errorTitle: { fontSize: 16, fontWeight: '800', color: '#0f1f16', marginTop: 10 },
  errorText: { fontSize: 12.5, color: '#6b7280', marginTop: 6, textAlign: 'center' },
})

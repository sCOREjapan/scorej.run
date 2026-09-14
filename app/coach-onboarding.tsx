// app/coach-onboarding.tsx — コーチ向けの入り口画面（コード引き換え or 購入導線）
//
// 2026-09-14: 「オンボーディングのコーチ選択→そのままチーム作成画面に行けてしまう」
// 「アプリ内に価格表示があるのはもう古い(外部決済に切り替えたため)」との指示で新規作成。
// 従来はapp/(tabs)/team.tsxのCoachSetupScreen内に「価格表示+コード入力欄」を直接
// 埋め込んでいたが、それを削除しこの独立画面に一本化した。
//
// 到達経路は2つ:
//   ① app/onboarding.tsx でgoal==='team'を選んだ人（新規ユーザー）
//   ② app/(tabs)/team.tsx のCoachSetupScreenで!isCoachだった人（既存ユーザーが後から
//      コーチ機能に触れようとした場合）
// どちらも、まだコーチプランの権限(isCoach)を持っていなければこの画面に来る。
import React, { useEffect, useState } from 'react'
import { View, Text, Image, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Toast from 'react-native-toast-message'
import { useTheme } from '../context/ThemeContext'
import { usePurchase } from '../context/PurchaseContext'
import { getAiAuthHeader } from '../lib/supabase'
import { BRAND } from '../lib/theme'

const MASCOT = require('../assets/illustrations/mascot/mascot_onboarding_ready.png')

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
// 2026-09-14: 「BASEショップで作る」方針。実際のBASEショップURLが発行され次第、
// ここを差し替えるだけでよい(コード発行・引き換え側のロジックには一切影響しない。
// api/admin-generate-team-code.tsx参照)。それまではStripe決済ページ(自作)を暫定で使う。
const TEAM_PLAN_EXTERNAL_URL = `${API_BASE_URL}/team-plan` // ← BASEショップ開設後にURLを差し替える

export default function CoachOnboardingScreen() {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()
  const { isCoach, refreshStatus } = usePurchase()
  const [mode, setMode] = useState<'choose' | 'redeem'>('choose')
  const [code, setCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)

  // 既にコーチプランが有効な場合(以前コードを引き換え済み等)はゲート不要なので素通りさせる
  useEffect(() => {
    if (isCoach) router.replace('/(tabs)/team' as any)
  }, [isCoach])

  const handleRedeem = async () => {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return
    setRedeeming(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/redeem-team-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAiAuthHeader()) },
        body: JSON.stringify({ code: trimmed }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'コードの引き換えに失敗しました')
      await refreshStatus()
      Toast.show({ type: 'success', text1: t('coachOnboarding.redeemSuccess') })
      router.replace('/(tabs)/team' as any)
    } catch (e: any) {
      Toast.show({ type: 'error', text1: t('coachOnboarding.redeemFailed'), text2: e?.message })
    } finally {
      setRedeeming(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>

        <View style={s.body}>
          <Image source={MASCOT} style={s.mascot} resizeMode="contain" />
          <Text style={[s.title, { color: colors.text }]}>{t('coachOnboarding.title')}</Text>
          <Text style={[s.subtitle, { color: colors.textSec }]}>{t('coachOnboarding.subtitle')}</Text>

          {mode === 'choose' ? (
            <View style={{ width: '100%', gap: 12, marginTop: 32 }}>
              <TouchableOpacity style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => setMode('redeem')} activeOpacity={0.85}>
                <View style={[s.cardIcon, { backgroundColor: BRAND + '18' }]}>
                  <Ionicons name="key-outline" size={24} color={BRAND} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.cardTitle, { color: colors.text }]}>{t('coachOnboarding.hasCodeTitle')}</Text>
                  <Text style={[s.cardDesc, { color: colors.textSec }]}>{t('coachOnboarding.hasCodeDesc')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textHint} />
              </TouchableOpacity>

              <TouchableOpacity style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => Linking.openURL(TEAM_PLAN_EXTERNAL_URL)} activeOpacity={0.85}>
                <View style={[s.cardIcon, { backgroundColor: '#f59e0b18' }]}>
                  <Ionicons name="storefront-outline" size={24} color="#d97706" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.cardTitle, { color: colors.text }]}>{t('coachOnboarding.noCodeTitle')}</Text>
                  <Text style={[s.cardDesc, { color: colors.textSec }]}>{t('coachOnboarding.noCodeDesc')}</Text>
                </View>
                <Ionicons name="open-outline" size={18} color={colors.textHint} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ width: '100%', marginTop: 32, gap: 12 }}>
              <Text style={[s.label, { color: colors.textHint }]}>{t('coachOnboarding.codeLabel')}</Text>
              <TextInput
                style={[s.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.text }]}
                value={code}
                onChangeText={setCode}
                placeholder="XXXX-XXXX-XXXX"
                placeholderTextColor={colors.textHint}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[s.primaryBtn, (redeeming || !code.trim()) && { opacity: 0.5 }]}
                onPress={handleRedeem}
                disabled={redeeming || !code.trim()}
                activeOpacity={0.85}
              >
                {redeeming ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>{t('coachOnboarding.redeemButton')}</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 8 }} onPress={() => setMode('choose')}>
                <Text style={{ color: colors.textSec, fontSize: 13 }}>{t('coachOnboarding.back')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  )
}

const s = StyleSheet.create({
  backBtn: { paddingHorizontal: 16, paddingTop: 8 },
  body: { flex: 1, alignItems: 'center', paddingHorizontal: 28, paddingTop: 20 },
  mascot: { width: 96, height: 96, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: 13.5, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 20, borderWidth: 1, padding: 18 },
  cardIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '800', marginBottom: 3 },
  cardDesc: { fontSize: 12, lineHeight: 17 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  input: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, textTransform: 'uppercase', letterSpacing: 1 },
  primaryBtn: { backgroundColor: BRAND, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
})

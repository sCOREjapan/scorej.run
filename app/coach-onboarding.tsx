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
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Toast from 'react-native-toast-message'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../context/ThemeContext'
import { usePurchase } from '../context/PurchaseContext'
import { useAuth } from '../context/AuthContext'
import { getAiAuthHeader } from '../lib/supabase'
import { BRAND } from '../lib/theme'
import { SETUP_KEY, ROLE_KEY } from '../lib/teamKeys'
import { startCoachTrial, CoachTrialAlreadyUsedError } from '../lib/coachTrial'

const MASCOT = require('../assets/illustrations/mascot/mascot_onboarding_ready.png')

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
// 2026-09-14: 「BASEショップで作る」方針。実際のBASEショップURLが発行され次第、
// ここを差し替えるだけでよい(コード発行・引き換え側のロジックには一切影響しない。
// api/admin-generate-team-code.tsx参照)。それまではStripe決済ページ(自作)を暫定で使う。
// 2026-09-21: BASEショップ開設に伴いここを実URLに差し替え。
const TEAM_PLAN_EXTERNAL_URL = 'https://scorejapan.official.ec'

export default function CoachOnboardingScreen() {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()
  const rawParams = useLocalSearchParams<{ trialExpired?: string }>()
  // 2026-09-25バグ巡り指摘: expo-routerはクエリパラメータをstring[]で返すことがあるため、
  // 単純な===比較だと配列の場合に常にfalseになりうる。念のため先頭要素に正規化しておく。
  const trialExpiredParam = Array.isArray(rawParams.trialExpired) ? rawParams.trialExpired[0] : rawParams.trialExpired
  const params = { trialExpired: trialExpiredParam }
  const { isCoach, refreshStatus } = usePurchase()
  const { isGuest, setCoachMode } = useAuth()
  const [mode, setMode] = useState<'choose' | 'redeem' | 'trial'>('choose')
  const [code, setCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  // 2026-09-25:「15日間無料体験」機能で追加。lib/coachTrial.ts参照。
  const [trialTeamName, setTrialTeamName] = useState('')
  const [trialCoachName, setTrialCoachName] = useState('')
  const [startingTrial, setStartingTrial] = useState(false)

  // 既にコーチプランが有効な場合(以前コードを引き換え済み等)はゲート不要なので素通りさせる
  useEffect(() => {
    if (isCoach) router.replace('/(tabs)/team' as any)
  }, [isCoach])

  // 2026-10-06 致命バグ修正: 選手として使っていた人がここへ誘導された時に、選手へ戻る手段が
  // 無かった(戻る矢印でチームタブへ戻ると、コーチ権限が無いため再びここへ飛ばされる無限ループ)。
  // 役割を'player'にしてホームのコーチ専用UIも解除し、ホームへ確実に逃がす。チームのデータ
  // (SETUP_KEY等)は消さないので、あとでコーチプランに加入すれば同じチームを使い続けられる。
  const handleUseAsAthlete = async () => {
    await AsyncStorage.setItem(ROLE_KEY, 'player').catch(() => {})
    await setCoachMode(false)
    router.replace('/(tabs)' as any)
  }

  const handleStartTrial = async () => {
    if (isGuest) { router.push('/auth' as any); return }
    if (!trialTeamName.trim() || !trialCoachName.trim()) return
    setStartingTrial(true)
    try {
      const result = await startCoachTrial(trialTeamName.trim(), trialCoachName.trim())
      const setup = {
        teamName: result.teamName, coachName: result.coachName, code: result.code,
        createdAt: new Date().toISOString(), trialExpiresAt: result.trialExpiresAt,
      }
      await AsyncStorage.setItem(SETUP_KEY, JSON.stringify(setup))
      await AsyncStorage.setItem(ROLE_KEY, 'coach')
      Toast.show({ type: 'success', text1: t('coachOnboarding.trialStarted') })
      router.replace('/(tabs)/team' as any)
    } catch (e: any) {
      if (e instanceof CoachTrialAlreadyUsedError) {
        Toast.show({ type: 'info', text1: t('coachOnboarding.trialAlreadyUsed') })
        setMode('choose')
      } else {
        Toast.show({ type: 'error', text1: t('coachOnboarding.trialFailed'), text2: e?.message })
      }
    } finally {
      setStartingTrial(false)
    }
  }

  const handleRedeem = async () => {
    // 2026-09-17実機バグ報告「コードを入力しても見つからない」に対応。
    // 発行コードは"XXXX-XXXX-XXXX"形式だが、ユーザーがダッシュを省略して
    // 入力しても通るよう、英数字以外を除去してから送信する
    // (api/redeem-team-code.ts側でダッシュを再構成してDBと照合する)。
    const trimmed = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
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

      // 2026-09-26実機バグ報告「コーチプランが有効になるだけで、チームは作成されず
      // また、コーチとして始める画面が出てきた」に対応。
      // 原因: 無料体験からのコード引き換え直後、refreshStatus()を呼んでもRevenueCat側の
      // isCoach反映に若干のタイムラグがあり、その間にteam.tsxが読むタイミングだと
      // isCoachがまだfalseのまま。team.tsx側の体験期限切れ判定(trialExpired && !isCoach)は
      // ローカルのSETUP_KEY.trialExpiresAtだけを見て即座に評価されるため、isCoachの反映が
      // 間に合わずレースコンディションでcoach-onboardingへ引き戻されてしまっていた。
      // 引き換え成功が確定したこの時点でtrialExpiresAtをローカルから確実に消しておけば、
      // isCoachの反映タイミングに関係なくtrialExpired判定は恒久的にfalseになる。
      try {
        const setupRaw = await AsyncStorage.getItem(SETUP_KEY)
        if (setupRaw) {
          const setup = JSON.parse(setupRaw)
          if (setup?.trialExpiresAt) {
            delete setup.trialExpiresAt
            await AsyncStorage.setItem(SETUP_KEY, JSON.stringify(setup))
          }
        }
      } catch {}

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
        <TouchableOpacity
          onPress={() => {
            // 2026-09-16実機バグ報告「戻るボタンが反応しない」に対応。
            // この画面への到達経路は両方ともrouter.replace()（app/onboarding.tsxの
            // handleFinish、app/(tabs)/team.tsxのCoachSetupScreen）で、履歴に戻り先が
            // 積まれていないため、router.back()は常に何もせず「反応しない」ように
            // 見えていた。canGoBack()がfalseの時はホームタブへ明示的に逃がす
            // （team.tsxへ戻すと!isCoachで即このgateへ戻される無限ループになるため避ける）。
            if (router.canGoBack()) router.back()
            else router.replace('/(tabs)' as any)
          }}
          style={s.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>

        <View style={s.body}>
          <Image source={MASCOT} style={s.mascot} resizeMode="contain" />
          <Text style={[s.title, { color: colors.text }]}>{t('coachOnboarding.title')}</Text>
          <Text style={[s.subtitle, { color: colors.textSec }]}>
            {params.trialExpired === '1' ? t('coachOnboarding.trialExpiredSubtitle') : t('coachOnboarding.subtitle')}
          </Text>

          {mode === 'choose' ? (
            <View style={{ width: '100%', gap: 12, marginTop: 32 }}>
              {/* 2026-09-25:「15日間無料体験」追加。体験終了後にこの画面へ戻ってきた場合
                  (params.trialExpired==='1')は既に使い切っているため表示しない。 */}
              {params.trialExpired !== '1' && (
                <TouchableOpacity style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => setMode('trial')} activeOpacity={0.85}>
                  <View style={[s.cardIcon, { backgroundColor: '#16653418' }]}>
                    <Ionicons name="gift-outline" size={24} color={BRAND} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.cardTitle, { color: colors.text }]}>{t('coachOnboarding.trialTitle')}</Text>
                    <Text style={[s.cardDesc, { color: colors.textSec }]}>{t('coachOnboarding.trialDesc')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textHint} />
                </TouchableOpacity>
              )}

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

              <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 14 }} onPress={handleUseAsAthlete} activeOpacity={0.7} accessibilityRole="button">
                <Text style={{ color: BRAND, fontSize: 14, fontWeight: '700' }}>{t('coachOnboarding.useAsAthlete')}</Text>
                <Text style={{ color: colors.textSec, fontSize: 11, marginTop: 2 }}>{t('coachOnboarding.useAsAthleteSub')}</Text>
              </TouchableOpacity>
            </View>
          ) : mode === 'redeem' ? (
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
          ) : (
            <View style={{ width: '100%', marginTop: 32, gap: 12 }}>
              <Text style={[s.label, { color: colors.textHint }]}>{t('coachOnboarding.trialTeamNameLabel')}</Text>
              <TextInput
                style={[s.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.text, textTransform: 'none' }]}
                value={trialTeamName}
                onChangeText={setTrialTeamName}
                placeholder={t('coachOnboarding.trialTeamNamePlaceholder')}
                placeholderTextColor={colors.textHint}
              />
              <Text style={[s.label, { color: colors.textHint }]}>{t('coachOnboarding.trialCoachNameLabel')}</Text>
              <TextInput
                style={[s.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.text, textTransform: 'none' }]}
                value={trialCoachName}
                onChangeText={setTrialCoachName}
                placeholder={t('coachOnboarding.trialCoachNamePlaceholder')}
                placeholderTextColor={colors.textHint}
              />
              <TouchableOpacity
                style={[s.primaryBtn, (startingTrial || !trialTeamName.trim() || !trialCoachName.trim()) && { opacity: 0.5 }]}
                onPress={handleStartTrial}
                disabled={startingTrial || !trialTeamName.trim() || !trialCoachName.trim()}
                activeOpacity={0.85}
              >
                {startingTrial ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>{t('coachOnboarding.trialStartButton')}</Text>}
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

import React, { useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Ionicons } from '@expo/vector-icons'
import Toast from 'react-native-toast-message'
import { useRouter } from 'expo-router'
import { BRAND, TEXT, SURFACE2, DIVIDER, BG_GRADIENT } from '../lib/theme'
import { Sounds } from '../lib/sounds'
import AnimatedSection from '../components/AnimatedSection'
import { useAuth } from '../context/AuthContext'
import {
  getMyReferralCode,
  redeemReferralCode,
  claimReferralRewards,
  REFERRAL_BONUS_TICKETS,
} from '../lib/referral'
import { useTranslation } from 'react-i18next'

const APP_STORE_URL = 'https://apps.apple.com/jp/app/score/id6766394981'

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const Clipboard = require('@react-native-clipboard/clipboard').default
    Clipboard.setString(text)
    return true
  } catch {
    return false
  }
}

export default function ReferralChallengeScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { user, isGuest } = useAuth()
  const loggedIn = !!user && !isGuest
  const [myCode, setMyCode] = useState<string | null>(null)
  const [loadingCode, setLoadingCode] = useState(true)
  const [joinCode, setJoinCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)

  useEffect(() => {
    if (!loggedIn) { setLoadingCode(false); return }
    claimReferralRewards().then(n => {
      if (n > 0) {
        Toast.show({ type: 'success', text1: t('referral.referralSuccessToast', { n: REFERRAL_BONUS_TICKETS * n }), visibilityTime: 3000 })
      }
    }).catch(() => {})
    getMyReferralCode().then(code => {
      setMyCode(code)
      setLoadingCode(false)
    }).catch(() => setLoadingCode(false))
  }, [loggedIn, t])

  const handleShare = useCallback(async () => {
    if (!myCode) return
    Sounds.tap()
    const message = t('referral.shareMessage', { code: myCode, n: REFERRAL_BONUS_TICKETS, url: APP_STORE_URL })
    try {
      if (Platform.OS === 'web') {
        const ok = await copyToClipboard(message)
        Toast.show({ type: ok ? 'success' : 'error', text1: ok ? t('referral.copiedToast') : t('referral.copyFailedToast') })
        return
      }
      await Share.share({ message })
    } catch {
      const ok = await copyToClipboard(message)
      if (ok) Toast.show({ type: 'success', text1: t('referral.copiedToast') })
    }
  }, [myCode, t])

  const handleRedeem = useCallback(async () => {
    if (joinCode.trim().length !== 6 || redeeming) return
    Sounds.save()
    setRedeeming(true)
    try {
      const result = await redeemReferralCode(joinCode)
      switch (result) {
        case 'granted':
          Toast.show({ type: 'success', text1: t('referral.redeemGranted', { n: REFERRAL_BONUS_TICKETS }), visibilityTime: 2500 })
          setJoinCode('')
          break
        case 'self_code':
          Toast.show({ type: 'error', text1: t('referral.redeemSelfCode') })
          break
        case 'already_used':
          Toast.show({ type: 'error', text1: t('referral.redeemAlreadyUsed') })
          break
        case 'invalid_code':
          Toast.show({ type: 'error', text1: t('referral.redeemInvalidCode') })
          break
        case 'not_logged_in':
          Toast.show({ type: 'error', text1: t('referral.redeemNotLoggedIn') })
          break
        default:
          Toast.show({ type: 'error', text1: t('referral.redeemDefaultError') })
      }
    } catch {
      Toast.show({ type: 'error', text1: t('referral.redeemNetworkError') })
    } finally {
      setRedeeming(false)
    }
  }, [joinCode, redeeming, t])

  return (
    <View style={{ flex: 1, backgroundColor: BG_GRADIENT[0] }}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => { Sounds.tap(); router.back() }} style={styles.backBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} accessibilityLabel={t('referral.backLabel')}>
              <Ionicons name="chevron-back" size={22} color={TEXT.primary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{t('referral.headerTitle')}</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

            {!loggedIn ? (
              <AnimatedSection delay={0} type="fade-up">
                <View style={styles.card}>
                  <Text style={{ fontSize: 28, marginBottom: 10 }}>🔒</Text>
                  <Text style={styles.leadText}>{t('referral.loginRequired')}</Text>
                  <Text style={[styles.leadText, { marginTop: 4, marginBottom: 18 }]}>
                    {t('referral.loginRequiredSub')}
                  </Text>
                  <TouchableOpacity
                    style={styles.shareBtn}
                    onPress={() => { Sounds.tap(); router.push('/auth') }}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.shareBtnText}>{t('referral.loginBtn')}</Text>
                  </TouchableOpacity>
                </View>
              </AnimatedSection>
            ) : (
            <AnimatedSection delay={0} type="fade-up">
              <View style={styles.card}>
                <Text style={styles.leadText}>{t('referral.inviteLead')}</Text>
                <Text style={styles.leadBonus}>{t('referral.inviteBonus', { n: REFERRAL_BONUS_TICKETS })}</Text>

                <Text style={styles.label}>{t('referral.yourCode')}</Text>
                <Text style={styles.codeText} selectable>
                  {loadingCode ? '------' : (myCode ?? t('referral.codeLoadFailed'))}
                </Text>

                <TouchableOpacity
                  style={[styles.shareBtn, !myCode && { opacity: 0.5 }]}
                  onPress={handleShare}
                  activeOpacity={0.85}
                  disabled={!myCode}
                >
                  <Ionicons name="share-social-outline" size={18} color="#fff" />
                  <Text style={styles.shareBtnText}>{t('referral.shareBtn')}</Text>
                </TouchableOpacity>
              </View>
            </AnimatedSection>
            )}

            {loggedIn && (
            <AnimatedSection delay={100} type="fade-up">
              <View style={styles.card2}>
                <Text style={styles.sectionTitle}>{t('referral.redeemSectionTitle')}</Text>
                <View style={styles.redeemRow}>
                  <TextInput
                    style={styles.codeInput}
                    value={joinCode}
                    onChangeText={t => setJoinCode(t.toUpperCase().slice(0, 6))}
                    placeholder="------"
                    placeholderTextColor={TEXT.hint}
                    autoCapitalize="characters"
                    maxLength={6}
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={[styles.redeemBtn, (joinCode.length !== 6 || redeeming) && { opacity: 0.5 }]}
                    onPress={handleRedeem}
                    activeOpacity={0.85}
                    disabled={joinCode.length !== 6 || redeeming}
                  >
                    <Text style={styles.redeemBtnText}>{redeeming ? t('referral.redeemBtnLoading') : t('referral.redeemBtn')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </AnimatedSection>
            )}

            {loggedIn && (
            <AnimatedSection delay={180} type="fade">
              <Text style={styles.infoText}>
                {t('referral.infoText')}
              </Text>
            </AnimatedSection>
            )}

          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DIVIDER,
  },
  backBtn: { width: 40, height: 40, borderRadius: 18, backgroundColor: SURFACE2, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: TEXT.primary, fontSize: 19, fontWeight: '800' },
  content: { padding: 18, gap: 14, paddingBottom: 48 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: DIVIDER,
    padding: 22,
    alignItems: 'center',
  },
  leadText: { fontSize: 13, color: TEXT.secondary, textAlign: 'center' },
  leadBonus: { fontSize: 26, fontWeight: '900', color: BRAND, marginTop: 2, marginBottom: 18 },
  label: { fontSize: 10.5, fontWeight: '700', color: TEXT.hint, letterSpacing: 0.5, marginBottom: 8 },
  codeText: { fontSize: 32, fontWeight: '900', letterSpacing: 6, color: TEXT.primary, marginBottom: 16 },
  shareBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: BRAND,
    borderRadius: 50,
    paddingVertical: 14,
  },
  shareBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },

  card2: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: DIVIDER,
    padding: 18,
  },
  sectionTitle: { fontSize: 12.5, fontWeight: '800', color: TEXT.primary, marginBottom: 10 },
  redeemRow: { flexDirection: 'row', gap: 8 },
  codeInput: {
    flex: 1,
    backgroundColor: SURFACE2,
    borderRadius: 12,
    paddingVertical: 13,
    color: TEXT.primary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 3,
    textAlign: 'center',
  },
  redeemBtn: {
    backgroundColor: SURFACE2,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  redeemBtnText: { color: TEXT.secondary, fontSize: 12.5, fontWeight: '700' },

  infoText: { fontSize: 10.5, color: TEXT.hint, textAlign: 'center', lineHeight: 16, paddingHorizontal: 6 },
})

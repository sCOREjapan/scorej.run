import React, { Component, useEffect, useRef, useState } from 'react'
import {
  Platform, View, ActivityIndicator, TouchableOpacity,
  Text, Modal, ScrollView, Linking, StyleSheet,
} from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import Toast from 'react-native-toast-message'
import * as Font from 'expo-font'
import * as SplashScreen from 'expo-splash-screen'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { Ionicons } from '@expo/vector-icons'
import { AuthProvider, useAuth } from '../context/AuthContext'
import { claimReferralRewards, REFERRAL_BONUS_TICKETS } from '../lib/referral'
import { ThemeProvider } from '../context/ThemeContext'
import { PurchaseProvider } from '../context/PurchaseContext'
import { LanguageProvider, useLanguage } from '../context/LanguageContext'
import LanguagePickerModal from '../components/LanguagePickerModal'
import SplashAnimation from '../components/SplashAnimation'
import { TutorialProvider, isTutorialDone } from '../lib/tutorialContext'
import TutorialSlides from '../components/TutorialSlides'
import LineCommunityBanner from '../components/LineCommunityBanner'
import CoachPlanBanner from '../components/CoachPlanBanner'
import { initOneSignal, requestPushPermission } from '../lib/notify'
import { initAdmob, showAppOpenAd } from '../lib/admob'
import { isAnyAdShowing, setAnyAdShowing } from '../lib/adLock'
// expo-tracking-transparency: 動的インポートでバージョン非互換クラッシュを防ぐ

// ── iOS 26 beta Hermes 0.81.5 クラッシュ回避 ───────────────────────
// Hermes の String.fromCodePoint ネイティブ実装にスタックバッファオーバー
// フローのバグがある。アプリ起動時に純粋 JS 実装で上書きする。
// (metro.config.js の getPolyfills でも同一ポリフィルを先行注入済み)
;(function _patchFromCodePoint() {
  if (typeof String.fromCodePoint !== 'function') return
  const _orig = String.fromCodePoint
  ;(String as any).fromCodePoint = function safeFromCodePoint() {
    var result = ''
    for (var i = 0; i < arguments.length; i++) {
      var cp: number = Number(arguments[i])
      if (isNaN(cp) || cp < 0 || cp > 0x10FFFF || Math.floor(cp) !== cp) {
        result += '?'; continue
      }
      if (cp <= 0xFFFF) {
        result += String.fromCharCode(cp)
      } else {
        var adj = cp - 0x10000
        result += String.fromCharCode(0xD800 + (adj >> 10), 0xDC00 + (adj & 0x3FF))
      }
    }
    return result
  }
})()

// ── グローバル React エラーバウンダリ ─────────────────────────────
// JS 例外がコンポーネントツリーで未捕捉になっても黒画面/クラッシュに
// ならないように、全体を囲むエラーバウンダリで安全に捕捉する。
interface EBState { hasError: boolean; errorMsg: string }
class AppErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, errorMsg: '' }
  }
  static getDerivedStateFromError(error: any): EBState {
    const msg = String(error?.message ?? error)
    const stack = String(error?.stack ?? '').slice(0, 300)
    return { hasError: true, errorMsg: msg + '\n\n' + stack }
  }
  componentDidCatch(error: any, info: any) {
    console.error('[AppErrorBoundary] Uncaught error:', error, info?.componentStack ?? '')
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ color: '#e5e7eb', fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 12 }}>
            申し訳ありません
          </Text>
          <Text style={{ color: '#6b7280', fontSize: 14, textAlign: 'center', lineHeight: 22 }}>
            エラーが発生しました。アプリを再起動してください。
          </Text>
          <Text style={{ color: '#ef4444', fontSize: 12, textAlign: 'center', marginTop: 16, paddingHorizontal: 16 }}>
            {this.state.errorMsg}
          </Text>
        </View>
      )
    }
    return this.props.children
  }
}

const CONSENT_KEY = 'score_terms_accepted_v1'
// LINEコミュニティ告知バナー：このバージョンで表示済みかどうかを記録するキー
const LINE_BANNER_SEEN_KEY = 'line_banner_seen_version'
// コーチプラン値下げ告知バナー：このバージョンで表示済みかどうかを記録するキー
const COACH_BANNER_SEEN_KEY = 'coach_banner_seen_version'

// ─────────────────────────────────────────────────────────
// ConsentModal — 初回起動時に利用規約・プライバシーポリシーへの同意を求める
// ─────────────────────────────────────────────────────────
function ConsentModal({ onAccept }: { onAccept: () => void }) {
  const { t } = useTranslation()
  const [termsChecked,   setTermsChecked]   = useState(false)
  const [privacyChecked, setPrivacyChecked] = useState(false)
  // null=同意画面, 'terms'=利用規約全文, 'privacy'=プライバシーポリシー全文
  const [innerDoc, setInnerDoc] = useState<null | 'terms' | 'privacy'>(null)
  const allChecked = termsChecked && privacyChecked

  const handleAccept = async () => {
    await AsyncStorage.setItem(CONSENT_KEY, new Date().toISOString()).catch(() => {})
    onAccept()
  }

  // ── 全文表示ビュー（アプリ内ドキュメントビューア）──────
  if (innerDoc !== null) {
    const DocScreen = innerDoc === 'terms'
      ? require('./terms').default
      : require('./privacy').default

    return (
      <Modal visible transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: '#fff' }}>
          {/* ヘッダー */}
          <SafeAreaView edges={['top']} style={{ backgroundColor: '#166534' }}>
            <View style={cs.docHeader}>
              <TouchableOpacity
                onPress={() => setInnerDoc(null)}
                style={cs.docBackBtn}
                activeOpacity={0.75}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="chevron-back" size={22} color="#fff" />
                <Text style={cs.docBackText}>{t('consent.backToConsent')}</Text>
              </TouchableOpacity>
              <Text style={cs.docHeaderTitle}>
                {innerDoc === 'terms' ? t('consent.terms') : t('consent.privacy')}
              </Text>
              <View style={{ width: 80 }} />
            </View>
          </SafeAreaView>
          {/* 本文（既存スクリーンをそのまま描画） */}
          <DocScreen />
          {/* 下部に「同意して戻る」ボタン */}
          <SafeAreaView edges={['bottom']} style={cs.docFooterWrap}>
            <TouchableOpacity
              style={cs.docAgreeBtn}
              onPress={() => {
                if (innerDoc === 'terms')   setTermsChecked(true)
                if (innerDoc === 'privacy') setPrivacyChecked(true)
                setInnerDoc(null)
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={cs.docAgreeBtnText}>
                {t('consent.agreeAndReturn', { doc: innerDoc === 'terms' ? t('consent.terms') : t('consent.privacy') })}
              </Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </Modal>
    )
  }

  // ── メイン同意画面 ──────────────────────────────────────
  return (
    <Modal visible transparent animationType="fade">
      <View style={cs.overlay}>
        <SafeAreaView style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={cs.sheet}>

            {/* ── アイコン + タイトル ── */}
            <View style={cs.iconWrap}>
              <Text style={{ fontSize: 32 }}>⚡️</Text>
            </View>
            <Text style={cs.title}>{t('consent.welcomeTitle')}</Text>
            <Text style={cs.subtitle}>{t('consent.subtitle')}</Text>

            {/* ── 規約リンク（タップで全文を表示） ── */}
            <View style={cs.linksBox}>
              <TouchableOpacity
                style={cs.linkRow}
                onPress={() => setInnerDoc('terms')}
                activeOpacity={0.7}
              >
                <Ionicons name="document-text-outline" size={18} color="#166534" />
                <Text style={cs.linkText}>{t('consent.terms')}</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </TouchableOpacity>
              <View style={cs.divider} />
              <TouchableOpacity
                style={cs.linkRow}
                onPress={() => setInnerDoc('privacy')}
                activeOpacity={0.7}
              >
                <Ionicons name="shield-checkmark-outline" size={18} color="#166534" />
                <Text style={cs.linkText}>{t('consent.privacy')}</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            {/* ── 同意チェックボックス ── */}
            <View style={cs.checksWrap}>
              <TouchableOpacity
                style={cs.checkRow}
                onPress={() => setTermsChecked(v => !v)}
                activeOpacity={0.75}
              >
                <View style={[cs.checkbox, termsChecked && cs.checkboxActive]}>
                  {termsChecked && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
                <Text style={cs.checkLabel}>{t('consent.agreeToTerms')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={cs.checkRow}
                onPress={() => setPrivacyChecked(v => !v)}
                activeOpacity={0.75}
              >
                <View style={[cs.checkbox, privacyChecked && cs.checkboxActive]}>
                  {privacyChecked && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
                <Text style={cs.checkLabel}>{t('consent.agreeToPrivacy')}</Text>
              </TouchableOpacity>
            </View>

            {/* ── 同意ボタン ── */}
            <TouchableOpacity
              style={[cs.acceptBtn, !allChecked && cs.acceptBtnDisabled]}
              onPress={handleAccept}
              disabled={!allChecked}
              activeOpacity={0.85}
            >
              <Text style={[cs.acceptBtnText, !allChecked && { color: '#9ca3af' }]}>
                {t('consent.startApp')}
              </Text>
            </TouchableOpacity>

            <Text style={cs.footer}>{t('consent.footer')}</Text>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  )
}

const cs = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: 36,
    gap: 16,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 22,
  },
  linksBox: {
    backgroundColor: '#f9fafb',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    overflow: 'hidden',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  linkText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  divider: { height: 1, backgroundColor: 'rgba(0,0,0,0.07)', marginHorizontal: 16 },
  checksWrap: { gap: 12 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  checkLabel: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  checkLinkText: {
    color: '#166534',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  acceptBtn: {
    backgroundColor: '#166534',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  acceptBtnDisabled: {
    backgroundColor: '#f3f4f6',
  },
  acceptBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  footer: {
    color: '#9ca3af',
    fontSize: 11,
    textAlign: 'center',
  },
  // ── ドキュメントビューア ──
  docHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  docBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    width: 80,
  },
  docBackText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  docHeaderTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    flex: 1,
  },
  docFooterWrap: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.08)',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  docAgreeBtn: {
    backgroundColor: '#166534',
    borderRadius: 16,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  docAgreeBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
})

if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync().catch(() => {})
}

// Service Worker 登録（PWAキャッシュ自動更新）
if (Platform.OS === 'web' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing
      newWorker?.addEventListener('statechange', () => {
        if (newWorker.state === 'activated') {
          // OAuth コールバック中（?code= / #access_token=）はリロードしない
          // Google OAuth はクロスオリジンリダイレクトで sessionStorage がクリアされるため
          // リロードすると PKCE コード交換が中断される
          const isOAuth = typeof window !== 'undefined' &&
            window.location != null &&
            (window.location.search?.includes('code=') ||
             window.location.hash?.includes('access_token='))
          if (isOAuth) return
          // 新バージョン検知 → セッション内で1回だけリロード（連続デプロイによる無限ループ防止）
          if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem('_sw_reloaded')) {
            sessionStorage.setItem('_sw_reloaded', '1')
            window.location.reload()
          }
        }
      })
    })
  }).catch(() => {})
}

const MIN_SPLASH_MS = 800

// 認証ガード — 未ログイン・未ゲスト選択時は auth 画面へ
function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, isGuest, isOnboarded } = useAuth()
  const { languageLoaded, hasSelectedLanguage } = useLanguage()
  const router   = useRouter()
  const segments = useSegments()

  // 同意状態: null=ロード中, false=未同意, true=同意済み
  const [consentAccepted, setConsentAccepted] = useState<boolean | null>(null)

  // 初回マウント時に同意フラグを確認
  useEffect(() => {
    AsyncStorage.getItem(CONSENT_KEY)
      .then(v => setConsentAccepted(!!v))
      .catch(() => setConsentAccepted(false))
  }, [])

  // ── アプデ後告知バナー（LINEコミュニティ・コーチプラン値下げ） ──────────
  // 「アプデ後に一度だけ・新規ユーザーのオンボーディングとは絶対に被らない」ため、
  // コールドスタート時点で isOnboarded が true だったユーザー（＝既存ユーザー）
  // だけを対象にする。オンボーディング完了直後は wasOnboardedAtColdStart=false のまま
  // なので、初回ユーザーには絶対に表示されない。
  // 複数バナーが同時に「未読」でも重ならないよう、キューにして1つずつ順番に見せる。
  const wasOnboardedAtColdStart = useRef<boolean | null>(null)
  const [bannerQueue, setBannerQueue] = useState<Array<'line' | 'coach'>>([])

  useEffect(() => {
    if (loading) return
    if (wasOnboardedAtColdStart.current === null) {
      wasOnboardedAtColdStart.current = isOnboarded
    }
    if (!wasOnboardedAtColdStart.current) return
    if (consentAccepted !== true) return // 規約同意が先

    const currentVersion = Constants.expoConfig?.version ?? ''
    ;(async () => {
      const queue: Array<'line' | 'coach'> = []
      try {
        const lineSeen = await AsyncStorage.getItem(LINE_BANNER_SEEN_KEY)
        if (lineSeen !== currentVersion) queue.push('line')
        const coachSeen = await AsyncStorage.getItem(COACH_BANNER_SEEN_KEY)
        if (coachSeen !== currentVersion) queue.push('coach')
      } catch {}
      if (queue.length) setBannerQueue(queue)
    })()
  }, [loading, isOnboarded, consentAccepted])

  // ── 友達招待の成立チェック（次回ログイン時に自動で反映） ──────────────
  // 招待した側は、招待した相手がコードを使った時点では自分の端末を見ていないため、
  // それまでは報酬が未反映のまま。次にアプリを開いた（ログイン状態が確定した）
  // タイミングで claimReferralRewards() を呼び、未受け取り分があればまとめて付与し通知する。
  // ゲストは紹介機能の対象外（アカウントに紐付くため）。
  const referralCheckedRef = useRef(false)
  useEffect(() => {
    if (loading || isGuest || !user) return
    if (referralCheckedRef.current) return
    referralCheckedRef.current = true
    claimReferralRewards().then(n => {
      if (n > 0) {
        Toast.show({
          type: 'success',
          text1: `🎫 チケット${REFERRAL_BONUS_TICKETS * n}枚が付与されました！`,
          text2: '友達紹介が成立しました',
          visibilityTime: 3500,
        })
      }
    }).catch(() => {})
  }, [loading, isGuest, user])

  // 告知バナーは全て<Modal>でネイティブpresentationを伴うため、表示中はApp Open広告と
  // 衝突しないよう共有ロックに反映する（lib/adLock.ts参照）。
  // ロックは参照カウント式なので、実際に表示⇄非表示が切り替わった時だけ呼ぶ
  // （毎レンダーで同じ値を渡すと二重にカウントされてロックが外れなくなる）
  const bannerLockActiveRef = useRef(false)
  useEffect(() => {
    const anyBannerVisible = bannerQueue.length > 0
    if (anyBannerVisible === bannerLockActiveRef.current) return
    bannerLockActiveRef.current = anyBannerVisible
    setAnyAdShowing(anyBannerVisible)
  }, [bannerQueue])

  const dismissBanner = (key: 'line' | 'coach') => {
    const storageKey = key === 'line' ? LINE_BANNER_SEEN_KEY : COACH_BANNER_SEEN_KEY
    const currentVersion = Constants.expoConfig?.version ?? ''
    AsyncStorage.setItem(storageKey, currentVersion).catch(() => {})
    // LineCommunityBanner/CoachPlanBannerは常にvisible=trueの<Modal>で、キューを
    // 即座に進めると前のModalの閉じるアニメーションが終わる前に次のModalが
    // presentされ、iOS側でネイティブpresentationが競合して画面が反応しなくなる
    // (フリーズする)不具合があった。fadeアニメーション(既定300ms)が完了するまで
    // 次のバナーの表示を遅らせることで回避する。
    setTimeout(() => setBannerQueue(q => q.slice(1)), 400)
  }

  useEffect(() => {
    if (loading) return
    // 同意チェックが終わるまでナビゲーションは行わない
    if (consentAccepted === null) return

    const inAuth        = segments[0] === 'auth'
    const inOnboarding  = segments[0] === 'onboarding'
    const inPublic      = segments[0] === 'coach-landing' || segments[0] === 'guide' || segments[0] === 'support' || segments[0] === 'privacy' || segments[0] === 'terms' || segments[0] === 'admin'
    const inPaywall     = segments[0] === 'paywall'   // オンボーディング→ペイウォール遷移中も許可
    const authed        = !!user || isGuest

    // OAuth リダイレクト後はルート URL '/' に着地する（app/index.tsx が存在しないため空白画面）
    // → 認証済みなら適切な画面へ送る
    if (authed && (segments as string[]).length === 0) {
      router.replace(!isOnboarded ? '/onboarding' : '/(tabs)')
      return
    }

    // Web OAuth コールバック中（?code= / #access_token=）は Supabase がコード交換を完了するまで待つ
    // loading=false になった後でも交換が進行中の場合があるため、/auth へのリダイレクトをブロック
    const hasOAuthParams = typeof window !== 'undefined' &&
      window.location != null &&
      (window.location.search?.includes('code=') || window.location.hash?.includes('access_token='))
    if (!authed && hasOAuthParams) return

    // 未認証 かつ オンボーディング未完了 → まず /onboarding へ
    // （サインアップの壁を見せる前に、種目選択などで価値を体験してもらう）
    if (!authed && !isOnboarded && !inOnboarding && !inPublic) {
      router.replace('/onboarding')
      return
    }

    // 未認証（オンボーディング済みだが未認証） → /auth へ（公開ページ・オンボーディング中は除く）
    // ※ inOnboarding を除外しないと、上の「未認証→/onboarding」チェックと互いを
    //   無限に呼び合うリダイレクトループになり、新規ユーザーがアプリを開けなくなる。
    //   /onboarding からの明示的な /auth 遷移は onboarding.tsx の handleFinish が行う。
    if (!authed && !inAuth && !inPublic && !inOnboarding) {
      router.replace('/auth')
      return
    }

    // 認証済みで auth ページにいる → onboarding or tabs
    if (authed && inAuth) {
      if (!isOnboarded) {
        router.replace('/onboarding')
      } else {
        router.replace('/(tabs)')
      }
      return
    }

    // 認証済みでオンボーディング未完了 → /onboarding
    // ペイウォールはオンボーディングStep5からの遷移中なので除外
    if (authed && !isOnboarded && !inOnboarding && !inPublic && !inPaywall) {
      router.replace('/onboarding')
      return
    }

    // オンボーディング済みでオンボーディングにいる → tabs
    // ペイウォールに遷移中の場合は上書きしない
    if (authed && isOnboarded && inOnboarding && !inPaywall) {
      router.replace('/(tabs)')
    }
  }, [user, loading, isGuest, isOnboarded, segments, consentAccepted, router])

  if (loading || !languageLoaded || consentAccepted === null) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#E53E3E" size="large" />
      </View>
    )
  }

  return (
    <>
      {children}
      {/* 言語選択モーダル — 同意モーダルより先に、初回のみ表示（admin は除く） */}
      {!hasSelectedLanguage && segments[0] !== 'admin' && (
        <LanguagePickerModal />
      )}
      {/* 同意モーダル — 言語選択済み・未同意の場合すべての画面の上に表示（admin は除く） */}
      {hasSelectedLanguage && !consentAccepted && segments[0] !== 'admin' && (
        <ConsentModal onAccept={() => setConsentAccepted(true)} />
      )}
      {/* アプデ後告知バナー — 既存ユーザー・同意済みの場合のみ、キューの先頭を1つずつ表示 */}
      {segments[0] !== 'admin' && bannerQueue[0] === 'line' && (
        <LineCommunityBanner onDismiss={() => dismissBanner('line')} />
      )}
      {segments[0] !== 'admin' && bannerQueue[0] === 'coach' && (
        <CoachPlanBanner onDismiss={() => dismissBanner('coach')} />
      )}
    </>
  )
}

function RootLayoutNav() {
  const router = useRouter()
  const segments = useSegments()

  // アプリ起動時に OneSignal を初期化（許可ダイアログは初回のみ）
  useEffect(() => {
    if (Platform.OS === 'web') {
      initOneSignal().then(() => {
        if (typeof localStorage !== 'undefined' && !localStorage.getItem('score_push_asked')) {
          localStorage.setItem('score_push_asked', '1')
          requestPushPermission()
        }
      }).catch(() => {})
    }
  }, [])

  // 3秒後のタイマー発火時点で最新のsegmentsを参照するためのref（[]依存だと古い値のまま固定されてしまう）
  const segmentsRef = useRef(segments)
  segmentsRef.current = segments

  // ATT (App Tracking Transparency) 許可 → AdMob SDK 初期化
  // 動的インポートでバージョン非互換によるクラッシュを防ぐ
  useEffect(() => {
    const t = setTimeout(async () => {
      if (Platform.OS === 'ios') {
        try {
          // 動的インポート: モジュールが存在しない/非互換でもクラッシュしない
          const att = await import('expo-tracking-transparency').catch(() => null)
          if (att) {
            const { status } = await att.getTrackingPermissionsAsync().catch(() => ({ status: 'unavailable' }))
            if (status === 'undetermined') {
              await att.requestTrackingPermissionsAsync().catch(() => {})
            }
          }
        } catch {}
      }
      await initAdmob().catch(() => {})
      // 初期化完了後にApp Open広告（1日1回）。オンボーディング/ログイン中は離脱率が上がるため表示しない。
      // ホーム画面のチュートリアル演出や告知バナー（<Modal>）の最中も、ネイティブ広告の
      // presentationと重なって画面が反応しなくなる不具合があったため、
      // どちらも出ていない間だけ見送る（見送っても次回起動時に再チャレンジされるだけで実害はない）
      const seg = segmentsRef.current[0]
      if (seg !== 'onboarding' && seg !== 'auth') {
        const tutorialDone = await isTutorialDone().catch(() => true)
        if (tutorialDone && !isAnyAdShowing()) showAppOpenAd().catch(() => {})
      }
    }, 3000)
    return () => clearTimeout(t)
  }, [])


  // @expo/vector-icons はビルド時に自動バンドルされるためここでのロードは不要
  // ただし旧来との互換性のため残す（エラーを抑制）
  let _ioniconsFontSrc: Font.FontSource
  try { _ioniconsFontSrc = require('../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf') } catch { _ioniconsFontSrc = '' }
  const [fontsLoaded] = Font.useFonts({ 'Ionicons': _ioniconsFontSrc })
  const [splashDone,  setSplashDone]  = useState(false)
  const [minTimeDone, setMinTimeDone] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMinTimeDone(true), MIN_SPLASH_MS)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (Platform.OS !== 'web' && fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {})
    }
  }, [fontsLoaded])

  if (Platform.OS !== 'web' && !fontsLoaded) return null

  const showSplash = Platform.OS === 'web' && (!splashDone || !minTimeDone)

  return (
    <SafeAreaProvider>
      <TutorialProvider>
      <TutorialSlides />
      <AuthGate>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#000000' },
            headerTintColor: '#FFFFFF',
            headerTitleStyle: { color: '#FFFFFF', fontWeight: '800' },
            contentStyle: { backgroundColor: '#000000' },
            headerBackTitle: '',
            headerLeft: ({ canGoBack }) =>
              canGoBack ? (
                <TouchableOpacity
                  onPress={() => router.back()}
                  style={{ paddingHorizontal: 8, paddingVertical: 6, marginLeft: -4 }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="chevron-back" size={28} color="#fff" />
                </TouchableOpacity>
              ) : undefined,
          }}
        >
          <Stack.Screen name="auth"        options={{ headerShown: false }} />
          <Stack.Screen name="onboarding"  options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="(tabs)"      options={{ headerShown: false }} />
          <Stack.Screen
            name="video-analysis"
            options={{
              title: 'フォーム分析',
              headerStyle: { backgroundColor: '#000' },
              headerTintColor: '#fff',
              headerTitleStyle: { color: '#fff', fontWeight: '800' },
              presentation: 'card',
            }}
          />
          <Stack.Screen name="warmup" options={{ title: 'ウォームアップ', headerShown: true }} />
          <Stack.Screen
            name="session-detail"
            options={{ title: '練習詳細', headerStyle: { backgroundColor: '#000000' }, headerTintColor: '#FFFFFF', presentation: 'card' }}
          />
          <Stack.Screen
            name="gps-run"
            options={{ title: 'GPS練習記録', headerShown: false, presentation: 'fullScreenModal' }}
          />
          <Stack.Screen
            name="timer"
            options={{ title: 'タイマー', headerShown: false, presentation: 'fullScreenModal' }}
          />
          <Stack.Screen
            name="share-card"
            options={{ title: '記録シェア', headerShown: false, presentation: 'card' }}
          />
          <Stack.Screen
            name="ranking"
            options={{ title: '全国ランキング', headerStyle: { backgroundColor: '#000000' }, headerTintColor: '#FFFFFF' }}
          />
          <Stack.Screen
            name="settings"
            options={{
              title: '設定',
              headerStyle: { backgroundColor: '#000' },
              headerTintColor: '#fff',
              headerTitleStyle: { color: '#fff', fontWeight: '800' },
              presentation: 'card',
            }}
          />
          <Stack.Screen name="workout-menu" options={{ title: '練習メニュー', headerStyle: { backgroundColor: '#000' }, headerTintColor: '#fff', headerTitleStyle: { color: '#fff', fontWeight: '800' } }} />
          {/* 2026-09-03: app/(tabs)/calendar.tsx(予定を立てる用・タブ登録)と
              同じルート名"calendar"で衝突していたため、こちら(練習強度の可視化)は
              training-calendarに改名。notebook.tsxの遷移先も合わせて変更済み */}
          <Stack.Screen name="training-calendar" options={{ title: 'カレンダー', headerStyle: { backgroundColor: '#000' }, headerTintColor: '#fff', headerTitleStyle: { color: '#fff', fontWeight: '800' } }} />
          <Stack.Screen
            name="ai-diagnosis"
            options={{
              title: 'AI診断',
              headerStyle: { backgroundColor: '#000' },
              headerTintColor: '#fff',
              headerTitleStyle: { color: '#fff', fontWeight: '800' },
            }}
          />
          <Stack.Screen
            name="recovery"
            options={{
              title: 'AIリカバリー相談',
              headerStyle: { backgroundColor: '#000' },
              headerTintColor: '#fff',
              headerTitleStyle: { color: '#fff', fontWeight: '800' },
            }}
          />
          <Stack.Screen name="privacy" options={{ headerShown: false }} />
          <Stack.Screen name="terms"   options={{ headerShown: false }} />
          <Stack.Screen
            name="paywall"
            options={{ headerShown: false, presentation: 'modal' }}
          />
          <Stack.Screen
            name="tickets"
            options={{ headerShown: false, presentation: 'modal' }}
          />
          {/* 未登録スクリーン — 独自ヘッダーを持つため headerShown: false */}
          <Stack.Screen name="coupon"           options={{ headerShown: false }} />
          <Stack.Screen name="coach-landing"    options={{ headerShown: false }} />
          <Stack.Screen name="guide"            options={{ headerShown: false }} />
          <Stack.Screen name="support"          options={{ headerShown: false }} />
          <Stack.Screen name="manual-log"       options={{ headerShown: false }} />
          <Stack.Screen name="notifications"    options={{ headerShown: false }} />
          <Stack.Screen name="practice-input"   options={{ headerShown: false }} />
          <Stack.Screen name="stretch-recovery" options={{ headerShown: false }} />
          <Stack.Screen name="team-invite"      options={{ headerShown: false }} />
          <Stack.Screen name="referral-challenge" options={{ headerShown: false }} />
          <Stack.Screen name="coach-view"       options={{ headerShown: false }} />
          <Stack.Screen name="level-roadmap"    options={{ headerShown: false }} />
        </Stack>
      </AuthGate>
      <Toast />
      {showSplash && <SplashAnimation onFinish={() => setSplashDone(true)} />}
      </TutorialProvider>
    </SafeAreaProvider>
  )
}

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <LanguageProvider>
          <AuthProvider>
            <PurchaseProvider>
              <RootLayoutNav />
            </PurchaseProvider>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  )
}

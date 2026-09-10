# sCORE — アプリインストールからホーム画面到達までの全コード

生成日: 2026-09-07。以下の順番でユーザーが通る画面のコードを掲載（言語選択→規約同意→オンボーディング→ログイン→ホーム到達）。


---

## `app/_layout.tsx`

```tsx
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
import { trackOnboardingStep } from '../lib/analytics'
import { ThemeProvider, useTheme } from '../context/ThemeContext'
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
    trackOnboardingStep('consent_completed')
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

  // ── ホーム画面ウィジェットからのディープリンク ─────────────────────
  // Widget.swift の widgetURL は score://risk / score://dashboard / score://streak /
  // score://competition / score://recovery だが、これらは実ファイルルートと一致しない
  // ため expo-router の自動解決だけでは開けない（未マッチルート画面になる）。
  // ここで明示的に実ルートへマッピングして router.replace() する。
  useEffect(() => {
    if (loading || consentAccepted !== true) return
    const authed = !!user || isGuest
    if (!authed || !isOnboarded) return

    const routeForWidgetUrl = (url: string | null): string | null => {
      if (!url) return null
      const m = /^score:\/\/([a-z]+)/i.exec(url)
      const key = m?.[1]?.toLowerCase()
      switch (key) {
        case 'risk':
        case 'dashboard':
        case 'streak':
          return '/(tabs)'
        case 'competition':
          return '/(tabs)/competition'
        case 'recovery':
          return '/(tabs)/competition?tab=injury'
        default:
          return null
      }
    }

    const handleWidgetUrl = (url: string | null) => {
      const target = routeForWidgetUrl(url)
      if (target) router.replace(target as any)
    }

    Linking.getInitialURL().then(handleWidgetUrl).catch(() => {})
    const sub = Linking.addEventListener('url', ({ url }) => handleWidgetUrl(url))
    return () => sub.remove()
  }, [loading, consentAccepted, user, isGuest, isOnboarded, router])

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
  const { colors } = useTheme()

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
            // 画面遷移アニメーション中、次の画面が実際に描画されるまでの一瞬デフォルト
            // (白)の背景が見えてしまう(特にダークモード時に白フラッシュとして目立つ)ため
            // 明示的にテーマ背景色を指定する
            contentStyle: { backgroundColor: colors.bg },
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
          {/* 2026-09-03: これらの画面は独自のヘッダーUIを内部で描画しているため、
              未登録のままだとExpo Routerがファイル名から自動生成したタイトル
              （例: "multi-event-score"）がネイティブヘッダーとして別途表示されてしまっていた。
              明示的にheaderShown:falseを指定してこれを防ぐ */}
          <Stack.Screen name="multi-event-score"       options={{ headerShown: false }} />
          <Stack.Screen name="reaction-start"          options={{ headerShown: false }} />
          <Stack.Screen name="reaction-start-settings" options={{ headerShown: false }} />
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
```

---

## `components/LanguagePickerModal.tsx`

```tsx
// components/LanguagePickerModal.tsx — 初回起動時に表示する言語選択画面
// 同意モーダル(app/_layout.tsx の ConsentModal)より先に表示される。
// 両方の言語を選ぶ前の画面なので、あえて i18n の t() は使わず日英併記の固定文言にする。
import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Modal } from 'react-native'
import { useLanguage } from '../context/LanguageContext'
import { trackOnboardingStep } from '../lib/analytics'

const BRAND = '#166534'

export default function LanguagePickerModal() {
  const { setLanguage } = useLanguage()

  return (
    <Modal visible transparent animationType="fade">
      <View style={s.overlay}>
        <SafeAreaView style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={s.sheet}>
            <View style={s.iconWrap}>
              <Text style={{ fontSize: 32 }}>🌐</Text>
            </View>
            <Text style={s.title}>言語を選択{'\n'}Select your language</Text>

            <TouchableOpacity style={s.btn} onPress={() => { trackOnboardingStep('language_selected', { lang: 'ja', auto: false }); setLanguage('ja') }} activeOpacity={0.85}>
              <Text style={s.btnText}>日本語</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, { marginTop: 12 }]} onPress={() => { trackOnboardingStep('language_selected', { lang: 'en', auto: false }); setLanguage('en') }} activeOpacity={0.85}>
              <Text style={s.btnText}>English</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 32,
    alignItems: 'center',
  },
  iconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(22,101,52,0.1)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18, fontWeight: '800', color: '#111827',
    textAlign: 'center', lineHeight: 26, marginBottom: 24,
  },
  btn: {
    width: '100%',
    backgroundColor: BRAND,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
})
```

---

## `context/LanguageContext.tsx`

```tsx
// context/LanguageContext.tsx — アプリ表示言語（日本語/英語）のグローバル管理
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import i18n from '../lib/i18n'
import { getDeviceLocale } from '../lib/deviceLocale'
import { trackOnboardingStep } from '../lib/analytics'

export type Language = 'ja' | 'en'

const LANGUAGE_KEY = 'score_language_v1'

interface LanguageContextType {
  language: Language
  languageLoaded: boolean       // AsyncStorage読み込みが完了したか
  hasSelectedLanguage: boolean  // 初回言語選択画面を通過済みか
  setLanguage: (lang: Language) => Promise<void>
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'ja',
  languageLoaded: false,
  hasSelectedLanguage: false,
  setLanguage: async () => {},
})

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('ja')
  const [languageLoaded, setLanguageLoaded] = useState(false)
  const [hasSelectedLanguage, setHasSelectedLanguage] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_KEY).then(saved => {
      if (saved === 'ja' || saved === 'en') {
        setLanguageState(saved)
        i18n.changeLanguage(saved)
        setHasSelectedLanguage(true)
        setLanguageLoaded(true)
        return
      }
      // 2026-09-07: 端末言語が日本語なら選択画面を出さず自動でjaにする。
      // 2026-09-07 追記: 当初は端末が英語ならenも自動選択していたが、
      // 「起動したら英語になっていた」という報告を受けて撤回した。
      // このアプリの既定言語は常に日本語であるべきで、英語への自動切り替えは
      // 危険（端末のロケール判定を誤ると、日本語ユーザーが英語で使うことになる）。
      // 日本語以外の端末は、これまで通り選択画面で本人に選んでもらう。
      const deviceLocale = getDeviceLocale().toLowerCase()
      const detected: Language | null = deviceLocale.startsWith('ja') ? 'ja' : null
      if (detected) {
        setLanguageState(detected)
        i18n.changeLanguage(detected)
        setHasSelectedLanguage(true)
        AsyncStorage.setItem(LANGUAGE_KEY, detected).catch(() => {})
        trackOnboardingStep('language_selected', { lang: detected, auto: true })
      }
      setLanguageLoaded(true)
    }).catch(() => setLanguageLoaded(true))
  }, [])

  const setLanguage = useCallback(async (lang: Language) => {
    setLanguageState(lang)
    setHasSelectedLanguage(true)
    await i18n.changeLanguage(lang)
    await AsyncStorage.setItem(LANGUAGE_KEY, lang).catch(() => {})
  }, [])

  return (
    <LanguageContext.Provider value={{ language, languageLoaded, hasSelectedLanguage, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = () => useContext(LanguageContext)
```

---

## `lib/deviceLocale.ts`

```ts
// lib/deviceLocale.ts — 端末の言語設定を取得する（追加ネイティブ依存なし）
// expo-localizationを新規導入するとネイティブ再ビルドが必要になるため、
// React Native標準のNativeModulesから直接読む昔ながらの手法を使う。
import { NativeModules, Platform } from 'react-native'

export function getDeviceLocale(): string {
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings
      return settings?.AppleLocale || settings?.AppleLanguages?.[0] || 'en'
    }
    if (Platform.OS === 'android') {
      return NativeModules.I18nManager?.localeIdentifier || 'en'
    }
  } catch { /* noop */ }
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language
  return 'en'
}
```

---

## `app/onboarding.tsx`

```tsx
// app/onboarding.tsx — 統合オンボーディング（2026-09-07 再設計・13画面→7画面）
// 画面フロー: イントロ(単一ヒーロー画面) →
//            クエスト3問(目的選択 → 種目選択[統合] → 今日の状態チェック[新規・実データ]) →
//            準備中演出(honest) → リビール(初回チェック・課金訴求は最下部1行のみ) →
//            任意の目標設定(旧クエストStep4の項目をここに移設・スキップ可) →
//            handleFinish()（/auth または /(tabs)、後続は不変）
// /auth 側は「このプランを保存しますか」という保存価値フレーミングに変更済み（app/auth.tsx）。
// 「チームを管理したい」を選んだ場合は種目選択・状態チェックをスキップする
// （本格的な別チーム作成フローは未着手・follow-up予定）。

import React, { useRef, useState, useCallback, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, TextInput, ScrollView, Platform,
  KeyboardAvoidingView, Dimensions, PanResponder, Easing,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Circle } from 'react-native-svg'
import CountUpText from '../components/CountUpText'
import TypewriterText from '../components/TypewriterText'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { getEventLabel } from '../lib/eventLabels'
import { getPrefectureLabel, getRegionLabel } from '../lib/prefectureLabels'
import { grantStarterTicketsIfNeeded } from '../lib/ticketWallet'
import { BRAND, TEXT } from '../lib/theme'
import { Sounds, unlockAudio } from '../lib/sounds'
import { trackOnboardingStep } from '../lib/analytics'
import {
  computeOnboardingReadiness, READINESS_BAND_COLOR,
  type YesterdayPractice, type FatigueLevel, type SleepBand, type OnboardingReadinessResult,
} from '../lib/onboardingReadiness'
import type { AthleticsEvent, EventCategory } from '../types'

const QUIZ_STEPS = 3   // 1:目的選択 2:種目選択(統合) 3:今日の状態チェック
const { width: SW } = Dimensions.get('window')
const RED     = BRAND   // アプリ全体のグリーンに統一（旧: 赤 #E53E3E）
const BLUE    = '#5AC8FA'
const GREEN   = '#34C759'
const I_AMBER = '#FF9500'

// ── クエスト用ソフトグリーン配色 ────────────────────────────
const G1     = '#22c55e'
const G2     = BRAND   // #166534
const TINT   = '#f0fdf4'
const SBORDER= '#d7ecdf'
const GRAD   = [G1, G2] as const

// ════════════════════════════════════════════════════════════════
// イントロカルーセル（旧 app/auth.tsx Slide1〜5 を移設。内容は不変）
// ════════════════════════════════════════════════════════════════

function useFadeUp(isActive: boolean, delay = 0) {
  const opacity = useRef(new Animated.Value(0)).current
  const ty      = useRef(new Animated.Value(30)).current
  React.useEffect(() => {
    if (isActive) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 560, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.spring(ty,      { toValue: 0, delay, tension: 60, friction: 10, useNativeDriver: true }),
      ]).start()
    } else {
      opacity.setValue(0); ty.setValue(30)
    }
  }, [isActive])
  return { opacity, transform: [{ translateY: ty }] } as any
}

function useScaleFade(isActive: boolean, delay = 0) {
  const opacity = useRef(new Animated.Value(0)).current
  const scale   = useRef(new Animated.Value(0.85)).current
  React.useEffect(() => {
    if (isActive) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 500, delay, useNativeDriver: true }),
        Animated.spring(scale,   { toValue: 1, delay, tension: 70, friction: 9, useNativeDriver: true }),
      ]).start()
    } else {
      opacity.setValue(0); scale.setValue(0.85)
    }
  }, [isActive])
  return { opacity, transform: [{ scale }] } as any
}

function useStagger(isActive: boolean, count: number, baseDelay = 0, step = 80) {
  const anims = useRef(Array.from({ length: count }, () => ({
    opacity: new Animated.Value(0),
    ty:      new Animated.Value(22),
  }))).current
  React.useEffect(() => {
    if (isActive) {
      Animated.parallel(anims.map((a, i) =>
        Animated.parallel([
          Animated.timing(a.opacity, { toValue: 1, duration: 480, delay: baseDelay + i * step, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.spring(a.ty,      { toValue: 0, delay: baseDelay + i * step, tension: 65, friction: 10, useNativeDriver: true }),
        ])
      )).start()
    } else {
      anims.forEach(a => { a.opacity.setValue(0); a.ty.setValue(22) })
    }
  }, [isActive])
  return anims.map(a => ({ opacity: a.opacity, transform: [{ translateY: a.ty }] }) as any)
}

function useArrowBounce() {
  const tx = useRef(new Animated.Value(0)).current
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(tx, { toValue: 8, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(tx, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]))
    loop.start(); return () => loop.stop()
  }, [])
  return tx
}

type SlideProps = { isActive: boolean }

function IntroSlide1({ isActive }: SlideProps) {
  const { t } = useTranslation()
  const arrowTx  = useArrowBounce()
  const logo     = useScaleFade(isActive, 0)
  const title    = useFadeUp(isActive, 160)
  const sub      = useFadeUp(isActive, 280)
  const badges   = useStagger(isActive, 3, 380, 110)
  const hint     = useFadeUp(isActive, 680)

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={sl.scrollContent} showsVerticalScrollIndicator={false} scrollEnabled={false}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {[...Array(5)].map((_, i) => (
          <View key={i} style={[sl.gridLine, { left: `${(i + 1) * (100 / 6)}%` as any }]} />
        ))}
      </View>
      <View style={sl.heroContent}>
        <Animated.View style={[sl.logoRow, logo]}>
          <View style={sl.logoMark}><Text style={sl.logoS}>S</Text></View>
          <View>
            <Text style={sl.logoName}>sCORE</Text>
            <Text style={sl.logoTagline}>{t('onboarding.intro.slide1.tagline')}</Text>
          </View>
        </Animated.View>
        <Animated.Text style={[sl.heroTitle, title]}>{t('onboarding.intro.slide1.heroTitle')}</Animated.Text>
        <Animated.Text style={[sl.heroSub, sub]}>{t('onboarding.intro.slide1.heroSub')}</Animated.Text>
        <View style={sl.scoreRow}>
          {([
            { label: t('onboarding.intro.slide1.sleepScore'), val: '87', color: BLUE,    icon: '😴' },
            { label: t('onboarding.intro.slide1.fatigue'),    val: '42', color: I_AMBER, icon: '⚡' },
            { label: t('onboarding.intro.slide1.condition'),  val: '91', color: GREEN,   icon: '💪' },
          ]).map((item, i) => (
            <Animated.View key={item.label} style={[sl.scoreBadge, { borderColor: item.color + '40' }, badges[i]]}>
              <Text style={{ fontSize: 18 }}>{item.icon}</Text>
              <Text style={[sl.scoreVal, { color: item.color }]}>{item.val}</Text>
              <Text style={sl.scoreLabel}>{item.label}</Text>
            </Animated.View>
          ))}
        </View>
        <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }, hint]}>
          <Text style={sl.hintText}>{t('onboarding.intro.slide1.nextPage')}</Text>
          <Animated.View style={{ transform: [{ translateX: arrowTx }] }}>
            <Ionicons name="arrow-forward" size={14} color="#9ca3af" />
          </Animated.View>
        </Animated.View>
      </View>
    </ScrollView>
  )
}

// 2026-09-07: 旧Slide2〜5（機能紹介／あるあるチェック／Before-After／開発者メッセージ）は
// オンボーディング短縮のため削除した。行き先はそれぞれ: 機能紹介→ホーム内の初回導線、
// あるあるチェック→次の「目的選択」画面に統合、Before/After→App Store/LP用の販促素材、
// 開発者メッセージ→設定「sCOREについて」/Webサイトへ移設予定（コード未着手）。
const INTRO_SLIDES: Array<(p: SlideProps) => React.ReactElement> = [IntroSlide1]
const INTRO_TOTAL = INTRO_SLIDES.length

function IntroCarousel({ onFinish }: { onFinish: () => void }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(0)
  const pageRef    = useRef(0)
  const goToRef    = useRef<(n: number) => void>(() => {})
  const translateX = useRef(new Animated.Value(0)).current

  const goTo = useCallback((idx: number) => {
    const target = Math.max(0, Math.min(INTRO_TOTAL - 1, idx))
    Animated.spring(translateX, { toValue: -target * SW, tension: 80, friction: 16, useNativeDriver: true }).start()
    pageRef.current = target
    setPage(target)
  }, [])
  useEffect(() => { goToRef.current = goTo }, [goTo])

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy }) => Math.abs(dx) > Math.abs(dy) + 5 && Math.abs(dx) > 10,
      onMoveShouldSetPanResponderCapture: (_, { dx, dy }) => Math.abs(dx) > Math.abs(dy) + 5 && Math.abs(dx) > 10,
      onPanResponderRelease: (_, { dx }) => {
        if (dx < -50 && pageRef.current < INTRO_TOTAL - 1) goToRef.current(pageRef.current + 1)
        else if (dx > 50 && pageRef.current > 0) goToRef.current(pageRef.current - 1)
      },
    })
  ).current

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
      <View style={{ flex: 1, overflow: 'hidden' }} {...panResponder.panHandlers}>
        <Animated.View style={{ flexDirection: 'row', width: SW * INTRO_TOTAL, flex: 1, transform: [{ translateX }] }}>
          {INTRO_SLIDES.map((SlideComp, i) => (
            <View key={i} style={{ width: SW, flex: 1 }}><SlideComp isActive={page === i} /></View>
          ))}
        </Animated.View>
      </View>
      <View style={nav.bar}>
        {INTRO_TOTAL > 1 && (
          <View style={nav.dotsRow}>
            {INTRO_SLIDES.map((_, i) => (
              <TouchableOpacity key={i} onPress={() => goTo(i)} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
                <Animated.View style={[nav.dot, i === page && nav.dotActive]} />
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={nav.btnRow}>
          {page > 0 ? (
            <TouchableOpacity style={nav.backBtn} onPress={() => goTo(page - 1)} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={16} color="rgba(0,0,0,0.4)" />
              <Text style={nav.backText}>{t('onboarding.intro.back')}</Text>
            </TouchableOpacity>
          ) : <View style={{ flex: 1 }} />}
          <TouchableOpacity
            onPress={() => { Sounds.tap(); if (page < INTRO_TOTAL - 1) goTo(page + 1); else onFinish() }}
            activeOpacity={0.85}
          >
            <View style={[nav.nextBtn, { backgroundColor: G2 }]}>
              <Text style={nav.nextText}>{page === INTRO_TOTAL - 1 ? t('onboarding.intro.startQuest') : t('onboarding.intro.next')}</Text>
              <Ionicons name={page === INTRO_TOTAL - 1 ? 'sparkles' : 'chevron-forward'} size={16} color="#fff" />
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

// ════════════════════════════════════════════════════════════════
// クエスト（プロフィール入力・ソフトグリーン演出）
// ════════════════════════════════════════════════════════════════

function buildCategories(t: (key: string) => string) {
  return [
    { key: 'sprint', label: t('onboarding.categories.sprint.label'), icon: 'flash-outline' as const, sub: t('onboarding.categories.sprint.sub') },
    { key: 'middle', label: t('onboarding.categories.middle.label'), icon: 'flame-outline' as const, sub: t('onboarding.categories.middle.sub') },
    { key: 'long',   label: t('onboarding.categories.long.label'),   icon: 'ellipse-outline' as const, sub: t('onboarding.categories.long.sub') },
    { key: 'field',  label: t('onboarding.categories.field.label'),  icon: 'medal-outline' as const, sub: t('onboarding.categories.field.sub') },
  ]
}

const EVENTS_BY_CATEGORY: Record<string, { label: string; key: AthleticsEvent }[]> = {
  sprint: [
    { key: '100m',  label: '100m' },
    { key: '200m',  label: '200m' },
    { key: '400m',  label: '400m' },
    { key: '110mH', label: '110mH（男子）' },
    { key: '100mH', label: '100mH（女子）' },
    { key: '400mH', label: '400mH' },
  ],
  middle: [
    { key: '800m',    label: '800m' },
    { key: '1500m',   label: '1500m' },
    { key: '3000m',   label: '3000m' },
    { key: '3000mSC', label: '3000mSC' },
  ],
  long: [
    { key: '5000m',         label: '5000m' },
    { key: '10000m',        label: '10000m' },
    { key: 'half_marathon', label: 'ハーフマラソン' },
    { key: 'marathon',      label: 'マラソン' },
    { key: '競歩',          label: '競歩' },
  ],
  field: [
    { key: '走幅跳',    label: '走幅跳' },
    { key: '三段跳',    label: '三段跳' },
    { key: '走高跳',    label: '走高跳' },
    { key: '棒高跳',    label: '棒高跳' },
    { key: '砲丸投',    label: '砲丸投' },
    { key: 'やり投',    label: 'やり投' },
    { key: '円盤投',    label: '円盤投' },
    { key: 'ハンマー投', label: 'ハンマー投' },
  ],
}

// フィールド種目は内部値(データ)が日本語のため、表示だけ getEventLabel() で言語に応じたラベルに変換する。
// 距離種目(100m等)は言語非依存なのでそのまま。

function buildGoalOptions(t: (key: string) => string) {
  return [
    { key: 'pb',           label: t('onboarding.goals.pb.label'),          icon: 'trophy-outline' as const },
    { key: 'injury_free',  label: t('onboarding.goals.injuryFree.label'),  icon: 'shield-checkmark-outline' as const },
    { key: 'competition',  label: t('onboarding.goals.competition.label'), icon: 'flag-outline' as const },
    { key: 'team',         label: t('onboarding.goals.team.label'),        icon: 'people-outline' as const },
  ]
}

const PRACTICE_OPTIONS: { key: YesterdayPractice; labelKey: string }[] = [
  { key: 'rest',  labelKey: 'onboarding.condition.practice.rest' },
  { key: 'light', labelKey: 'onboarding.condition.practice.light' },
  { key: 'solid', labelKey: 'onboarding.condition.practice.solid' },
  { key: 'hard',  labelKey: 'onboarding.condition.practice.hard' },
]
const FATIGUE_OPTIONS: { key: FatigueLevel; labelKey: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'fresh',  labelKey: 'onboarding.condition.fatigue.fresh',  icon: 'battery-full-outline' },
  { key: 'normal', labelKey: 'onboarding.condition.fatigue.normal', icon: 'battery-half-outline' },
  { key: 'tired',  labelKey: 'onboarding.condition.fatigue.tired',  icon: 'battery-dead-outline' },
]
const SLEEP_OPTIONS: { key: SleepBand; labelKey: string }[] = [
  { key: 'short', labelKey: 'onboarding.condition.sleep.short' },
  { key: 'mid',   labelKey: 'onboarding.condition.sleep.mid' },
  { key: 'long',  labelKey: 'onboarding.condition.sleep.long' },
]

function buildExperienceOptions(t: (key: string) => string) {
  return [
    { key: 0,  label: t('onboarding.experience.beginner.label'),     sub: t('onboarding.experience.beginner.sub') },
    { key: 2,  label: t('onboarding.experience.intermediate.label'), sub: t('onboarding.experience.intermediate.sub') },
    { key: 5,  label: t('onboarding.experience.experienced.label'),  sub: t('onboarding.experience.experienced.sub') },
    { key: 10, label: t('onboarding.experience.veteran.label'),      sub: t('onboarding.experience.veteran.sub') },
  ]
}

const PREFS_BY_REGION: { region: string; prefs: string[] }[] = [
  { region: '北海道', prefs: ['北海道'] },
  { region: '東北', prefs: ['青森', '岩手', '宮城', '秋田', '山形', '福島'] },
  { region: '関東', prefs: ['茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川'] },
  { region: '中部', prefs: ['新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知'] },
  { region: '近畿', prefs: ['三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山'] },
  { region: '中国', prefs: ['鳥取', '島根', '岡山', '広島', '山口'] },
  { region: '四国', prefs: ['徳島', '香川', '愛媛', '高知'] },
  { region: '九州・沖縄', prefs: ['福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'] },
]

function buildStepHeadline(t: (key: string) => string): Record<number, string> {
  return {
    1: t('onboarding.step.headline1'), 2: t('onboarding.step.headline2'), 3: t('onboarding.step.headline3'),
  }
}
function buildStepSub(t: (key: string) => string): Record<number, string> {
  return {
    1: t('onboarding.step.sub1'), 2: t('onboarding.step.sub2'), 3: t('onboarding.step.sub3'),
  }
}
const STEP_ICON: Record<number, keyof typeof Ionicons.glyphMap> = {
  1: 'flag-outline', 2: 'grid-outline', 3: 'battery-half-outline',
}

function ProgressHeader({ step, onBack, onSkip, showBack }: { step: number; onBack: () => void; onSkip: () => void; showBack: boolean }) {
  const { t } = useTranslation()
  return (
    <View style={styles.progressHeader}>
      {showBack ? (
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={20} color={TEXT.hint} />
        </TouchableOpacity>
      ) : <View style={{ width: 28 }} />}
      <View style={styles.progressTrack}>
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: `${(step / QUIZ_STEPS) * 100}%` }]} />
      </View>
      <TouchableOpacity onPress={onSkip} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.skipText}>{step < QUIZ_STEPS ? t('onboarding.skip') : ' '}</Text>
      </TouchableOpacity>
    </View>
  )
}

// 2026-09-07: グラデーションのブロブ＋浮き出しの「•••」バッジが「ダサい」というフィードバックを受け、
// フラットな色ベタ塗りの角丸アイコンコンテナに変更（NoadUpsellModal等、他画面のアイコン表現と統一）。
function IconBlob({ icon }: { icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.blobWrap}>
      <View style={styles.blob}>
        <Ionicons name={icon} size={26} color={G2} />
      </View>
    </View>
  )
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

// 2026-09-07: 準備中画面を「本格的」に作り直すためのリングコンポーネント。
// ホーム画面の怪我リスクリング（app/(tabs)/index.tsx）と同じreact-native-svg手法で、
// 実際の進捗(0〜1)に連動して弧が伸びる。中心のアイコンは常時ゆっくり回転させ、
// 「本当に何かを計算している」感を静止画のパルスより強く出す。
function ProcessingRing({ progress, rotateDeg, size = 104 }: {
  progress: Animated.Value
  rotateDeg: Animated.AnimatedInterpolation<string | number>
  size?: number
}) {
  const strokeWidth = 7
  const r = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * r
  const dashOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] })
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(22,101,52,0.12)" strokeWidth={strokeWidth} fill="none" />
        <AnimatedCircle
          cx={size / 2} cy={size / 2} r={r}
          stroke={G2} strokeWidth={strokeWidth} fill="none" strokeLinecap="round"
          strokeDasharray={`${circumference}, ${circumference}`}
          strokeDashoffset={dashOffset}
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Animated.View style={{ transform: [{ rotate: rotateDeg }] }}>
        <Ionicons name="sync-outline" size={30} color={G2} />
      </Animated.View>
    </View>
  )
}

// 準備中チェックリストの「進行中」ドット。完了前の項目にだけ呼吸するような拍動を付ける。
function ActiveDot() {
  const scale = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(scale, { toValue: 1.35, duration: 480, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1,    duration: 480, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [])
  return <Animated.View style={[styles.processActive, { transform: [{ scale }] }]} />
}

function GradientButton({ onPress, disabled, label, icon }: { onPress: () => void; disabled?: boolean; label: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.85} style={disabled ? { opacity: 0.4 } : undefined}>
      <View style={[styles.gradientBtn, { backgroundColor: G2 }]}>
        <Text style={styles.gradientBtnText}>{label}</Text>
        <Ionicons name={icon} size={17} color="#fff" />
      </View>
    </TouchableOpacity>
  )
}

function CategoryCard({ label, icon, selected, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; selected: boolean; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current
  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.spring(scale,  { toValue: 1,    tension: 300, friction: 10, useNativeDriver: true }),
    ]).start()
    onPress()
  }
  return (
    <Animated.View style={{ transform: [{ scale }], width: '48%' }}>
      <TouchableOpacity style={[styles.card, selected && styles.cardSelected]} onPress={handlePress} activeOpacity={1}>
        <View style={[styles.cardAvatar, selected && styles.cardAvatarSelected]}>
          <Ionicons name={icon} size={24} color={selected ? G2 : TEXT.hint} />
        </View>
        <Text style={[styles.cardLabel, selected && { color: G2 }]}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  )
}

function Chip({
  label, sub, selected, onPress,
}: {
  label: string; sub?: string; selected: boolean; onPress: () => void
}) {
  const scale = useRef(new Animated.Value(1)).current
  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.spring(scale,  { toValue: 1,    tension: 300, friction: 10, useNativeDriver: true }),
    ]).start()
    onPress()
  }
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity style={[styles.chip, selected && styles.chipSelected]} onPress={handlePress} activeOpacity={1}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.chipLabel, selected && { color: G2 }]}>{label}</Text>
          {sub ? <Text style={styles.chipSub}>{sub}</Text> : null}
        </View>
        {selected
          ? <View style={styles.checkBadge}><Ionicons name="checkmark" size={13} color="#fff" /></View>
          : <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: SBORDER }} />
        }
      </TouchableOpacity>
    </Animated.View>
  )
}

// ════════════════════════════════════════════════════════════════
// メイン
// ════════════════════════════════════════════════════════════════

export default function OnboardingScreen() {
  const router  = useRouter()
  const { t } = useTranslation()
  const { user, isGuest, setOnboarded } = useAuth()
  const { language } = useLanguage()

  const CATEGORIES = buildCategories(t)
  const GOAL_OPTIONS = buildGoalOptions(t)
  const EXPERIENCE_OPTIONS = buildExperienceOptions(t)
  const STEP_HEADLINE = buildStepHeadline(t)
  const STEP_SUB = buildStepSub(t)
  const PROCESSING_ITEMS = t('onboarding.processing.items', { returnObjects: true }) as string[]

  const [phase, setPhase] = useState<'intro' | 'quiz' | 'processing' | 'reveal' | 'goals'>('intro')
  const [step,       setStep]       = useState(1)   // クエスト内: 1(目的)-2(種目)-3(状態チェック)
  const [goal,       setGoal]       = useState<'' | 'pb' | 'injury_free' | 'competition' | 'team'>('')
  const [name,       setName]       = useState('')
  const [category,   setCategory]   = useState<string>('sprint')
  const [event,      setEvent]      = useState<AthleticsEvent | ''>('100m')
  const [practice,   setPractice]   = useState<YesterdayPractice | ''>('')
  const [fatigue,    setFatigue]    = useState<FatigueLevel | ''>('')
  const [sleepBand,  setSleepBand]  = useState<SleepBand | ''>('')
  const [hasPain,    setHasPain]    = useState(false)
  const [readiness,  setReadiness]  = useState<OnboardingReadinessResult | null>(null)
  const [experience, setExperience] = useState<number>(2)
  const [age,        setAge]        = useState('')
  const [pb,         setPb]         = useState('')
  const [prefecture, setPrefecture] = useState('')
  const [processingIdx, setProcessingIdx] = useState(0)

  const fadeAnim   = useRef(new Animated.Value(1)).current
  const revealPop  = useRef(new Animated.Value(0)).current
  const readinessFill = useRef(new Animated.Value(0)).current
  const adviceFade = useFadeUp(phase === 'reveal', 650)
  const isAnimating = useRef(false)

  // ── 準備中画面（processing）の演出用 ─────────────────────────
  const processingProgress = useRef(new Animated.Value(0)).current
  const ringRotate = useRef(new Animated.Value(0)).current
  const rowAnims = useRef(
    Array.from({ length: PROCESSING_ITEMS.length }, () => new Animated.Value(0))
  ).current
  const ringRotateDeg = ringRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })

  useEffect(() => {
    if (phase !== 'processing') return
    ringRotate.setValue(0)
    const loop = Animated.loop(
      Animated.timing(ringRotate, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true })
    )
    loop.start()
    return () => loop.stop()
  }, [phase])

  const transition = useCallback((action: () => void) => {
    if (isAnimating.current) return
    isAnimating.current = true
    Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      action()
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start(() => {
        isAnimating.current = false
      })
    })
  }, [fadeAnim])

  const goNext = useCallback((nextStep: number) => {
    unlockAudio(); Sounds.pop()
    transition(() => setStep(nextStep))
  }, [transition])

  const goBack = useCallback(() => {
    if (step <= 1) { unlockAudio(); Sounds.tap(); setPhase('intro'); return }
    Sounds.tap()
    transition(() => setStep(s => s - 1))
  }, [step, transition])

  const handleCategorySelect = useCallback((key: string) => {
    Sounds.tap()
    if (key !== category) { setCategory(key); setEvent('') }
  }, [category])

  // ── 準備中演出（自動進行） ─────────────────────────────────
  useEffect(() => {
    if (phase !== 'processing') return
    setProcessingIdx(0)
    processingProgress.setValue(0)
    rowAnims.forEach(a => a.setValue(0))
    const timers: ReturnType<typeof setTimeout>[] = []
    PROCESSING_ITEMS.forEach((_, i) => {
      timers.push(setTimeout(() => {
        setProcessingIdx(i + 1)
        Sounds.tap()
        Animated.timing(processingProgress, {
          toValue: (i + 1) / PROCESSING_ITEMS.length, duration: 420,
          easing: Easing.out(Easing.cubic), useNativeDriver: false,
        }).start()
        Animated.spring(rowAnims[i], { toValue: 1, tension: 300, friction: 12, useNativeDriver: true }).start()
      }, 550 + i * 650))
    })
    timers.push(setTimeout(() => {
      Sounds.save()
      revealPop.setValue(0)
      setPhase('reveal')
    }, 550 + PROCESSING_ITEMS.length * 650 + 350))
    return () => timers.forEach(clearTimeout)
  }, [phase])

  useEffect(() => {
    if (phase !== 'reveal') return
    trackOnboardingStep('readiness_viewed', goal === 'team' ? { team: true } : { score: readiness?.score, band: readiness?.band })
    Animated.spring(revealPop, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }).start()
    readinessFill.setValue(0)
    Animated.timing(readinessFill, {
      toValue: 1, duration: 900, delay: 250,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start()
  }, [phase])

  const handleFinish = useCallback(async () => {
    unlockAudio(); Sounds.save()

    const profile = {
      id: user?.id ?? 'guest',
      name: name.trim() || (user?.email?.split('@')[0] ?? t('onboarding.defaultAthleteName')),
      primary_event: event || '100m',
      event_category: (category || 'sprint') as EventCategory,
      secondary_events: [],
      age: age ? Number(age) : undefined,
      experience_years: experience >= 0 ? experience : undefined,
      personal_best_ms: pb.trim() ? (parsePbToMs(pb.trim()) ?? undefined) : undefined,
      target_time_ms: undefined as number | undefined,
      prefecture: prefecture || undefined,
      created_at: new Date().toISOString(),
    }

    await AsyncStorage.setItem('trackmate_my_profile', JSON.stringify(profile)).catch(() => {})

    if (user?.id) {
      try {
        const { supabase: sb } = await import('../lib/supabase')
        await sb.from('profiles').upsert({
          user_id: user.id,
          name: profile.name,
          primary_event: profile.primary_event,
          event_category: profile.event_category,
          age: profile.age ?? null,
          experience_years: profile.experience_years ?? null,
          prefecture: prefecture || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }).then(() => {})
      } catch { /* 同期失敗はサイレント */ }
    }

    const authed = !!user?.id || isGuest
    await setOnboarded()
    await grantStarterTicketsIfNeeded()
    // 将来のホーム画面パーソナライズ用に目的を保存（現時点では読み出し側は未実装）
    await AsyncStorage.setItem('trackmate_onboarding_goal', goal || 'pb').catch(() => {})
    if (!authed) {
      router.replace('/auth')
    } else if (goal === 'team') {
      // 2026-09-07: 「チームを管理したい」を選んだユーザーは、選手向けホームではなく
      // 既存のチーム作成・招待コード発行画面（app/team-invite.tsx）に直接着地させる。
      // 注意選手一覧などのコーチ用ダッシュボードは既存の app/(tabs)/team.tsx がそのまま使える。
      router.replace('/team-invite' as any)
    } else {
      // 2026-09-07: 到達後に全画面を自動的に再説明する旧チュートリアルの自動起動はここでも廃止。
      // ホーム画面には常駐の<FirstRunChecklist/>が表示される（app/(tabs)/index.tsx）。
      trackOnboardingStep('home_reached')
      router.replace('/(tabs)')
    }
  }, [name, event, category, experience, age, pb, prefecture, goal, user, isGuest, setOnboarded, router])

  const canNextStep1 = goal !== ''
  const canNextStep2 = event !== ''
  const canNextStep3 = practice !== '' && fatigue !== '' && sleepBand !== ''

  // ── イントロカルーセル ────────────────────────────────────
  if (phase === 'intro') {
    return <IntroCarousel onFinish={() => { unlockAudio(); Sounds.pop(); setPhase('quiz') }} />
  }

  // ── 準備中演出 ────────────────────────────────────────────
  if (phase === 'processing') {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <SafeAreaView style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ maxWidth: 600, alignSelf: 'center', width: '100%', paddingHorizontal: 32, alignItems: 'center' }}>
            <ProcessingRing progress={processingProgress} rotateDeg={ringRotateDeg} />
            <Text style={[styles.processingTitle, { marginTop: 20 }]}>{t('onboarding.processing.title')}</Text>
            <Text style={styles.processingStepCount}>{processingIdx} / {PROCESSING_ITEMS.length}</Text>
            <View style={{ marginTop: 26, gap: 14, width: '100%' }}>
              {PROCESSING_ITEMS.map((item, i) => {
                const isDone = i < processingIdx
                const isActive = i === processingIdx
                return (
                  <View key={item} style={styles.processRow}>
                    {isDone ? (
                      <Animated.View style={[styles.processDone, { transform: [{ scale: rowAnims[i] }] }]}>
                        <Ionicons name="checkmark" size={13} color="#fff" />
                      </Animated.View>
                    ) : isActive ? (
                      <ActiveDot />
                    ) : (
                      <View style={styles.processPending} />
                    )}
                    <Text style={[
                      styles.processText,
                      isDone && { color: TEXT.primary, fontWeight: '700' },
                      isActive && { color: G2, fontWeight: '700' },
                    ]}>
                      {item}
                    </Text>
                  </View>
                )
              })}
            </View>
          </View>
        </SafeAreaView>
      </View>
    )
  }

  // ── リビール ──────────────────────────────────────────────
  // 2026-09-07: 「プラン完成」ではなく正直に「初回チェック」と表現する。
  // 課金訴求はGradientButtonの下の1行(day7Line)のみ。Proボタンはここには置かない。
  if (phase === 'reveal') {
    if (goal === 'team') {
      return (
        <View style={{ flex: 1, backgroundColor: '#fff' }}>
          <SafeAreaView style={{ flex: 1 }}>
            <View style={{ flex: 1, maxWidth: 600, alignSelf: 'center', width: '100%', paddingHorizontal: 24 }}>
              <Animated.View
                style={{
                  flex: 1, justifyContent: 'center', alignItems: 'center',
                  opacity: revealPop,
                  transform: [{ scale: revealPop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
                }}
              >
                <LinearGradient colors={GRAD} start={{ x: 0.2, y: 0 }} end={{ x: 1, y: 1 }} style={styles.revealIcon}>
                  <Ionicons name="people" size={32} color="#fff" />
                </LinearGradient>
                <View style={styles.doneBadge}><Text style={styles.doneBadgeText}>{t('onboarding.reveal.teamBadge')}</Text></View>
                <TypewriterText text={t('onboarding.reveal.teamTitle')} style={styles.revealTitle} triggerKey={phase} />
                <Text style={[styles.subline, { marginTop: 10 }]}>{t('onboarding.reveal.teamSub')}</Text>
              </Animated.View>
              <SafeAreaView edges={['bottom']}>
                {/* 2026-09-07: 'goals'画面は自己ベスト・競技歴など選手向けの項目しかなく
                    コーチには意味が無いため、チーム目的の場合はスキップして直接完了させる */}
                <GradientButton label={t('onboarding.reveal.teamStartButton')} icon="arrow-forward" onPress={() => handleFinish()} />
              </SafeAreaView>
            </View>
          </SafeAreaView>
        </View>
      )
    }

    const score = readiness?.score ?? 0
    const band = readiness?.band ?? 'low'
    const bandColor = READINESS_BAND_COLOR[band]
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ flex: 1, maxWidth: 600, alignSelf: 'center', width: '100%', paddingHorizontal: 24 }}>
            <Animated.View
              style={{
                flex: 1, justifyContent: 'center',
                opacity: revealPop,
                transform: [{ scale: revealPop.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
              }}
            >
              <Text style={styles.readinessEyebrow}>{t('onboarding.reveal.eyebrow')}</Text>
              <View style={styles.readinessRow}>
                <CountUpText value={score} duration={900} delay={250} triggerKey={phase} style={styles.readinessNum} />
                <Text style={styles.readinessMax}>/100</Text>
                <Animated.View style={[
                  styles.readinessBadge,
                  { backgroundColor: bandColor + '18', borderColor: bandColor + '40' },
                  adviceFade,
                ]}>
                  <Text style={[styles.readinessBadgeText, { color: bandColor }]}>{t(`onboarding.condition.bandLabel.${band}`)}</Text>
                </Animated.View>
              </View>
              <View style={styles.scaleBarTrack}>
                <Animated.View style={[styles.scaleFill, {
                  backgroundColor: bandColor,
                  width: readinessFill.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${Math.min(100, Math.max(0, score))}%`] }),
                }]} />
              </View>
              <Text style={styles.honestCaption}>{t('onboarding.reveal.honestCaption')}</Text>

              <Animated.View style={[styles.adviceCard, adviceFade]}>
                <Text style={styles.adviceEyebrow}>{t('onboarding.reveal.adviceEyebrow')}</Text>
                <TypewriterText text={readiness ? t(readiness.adviceKey) : ''} style={styles.adviceBody} delay={650} triggerKey={phase} />
              </Animated.View>
            </Animated.View>
            <SafeAreaView edges={['bottom']}>
              <GradientButton label={t('onboarding.reveal.startButton')} icon="arrow-forward" onPress={() => setPhase('goals')} />
              <Text style={styles.day7Line}>{t('onboarding.reveal.day7Line')}</Text>
            </SafeAreaView>
          </View>
        </SafeAreaView>
      </View>
    )
  }

  // ── 目標設定（任意・スキップ可） ───────────────────────────
  // 旧クエストStep4（経験年数/年齢/地域/自己ベスト）+ 名前をここに移設。
  // 必須のオンボーディングからは完全に外れ、あとから設定でも変更できる。
  if (phase === 'goals') {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={{ flex: 1, maxWidth: 600, alignSelf: 'center', width: '100%' }}>
          <SafeAreaView>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 18 }}>
              <TouchableOpacity onPress={() => { trackOnboardingStep('goal_saved', { skipped: true }); handleFinish() }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.skipText}>{t('onboarding.goalsScreen.later')}</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <IconBlob icon="person-outline" />
              <TypewriterText text={t('onboarding.goalsScreen.headline')} style={styles.headline} triggerKey={phase} />
              <Text style={styles.subline}>{t('onboarding.goalsScreen.sub')}</Text>

              <View style={{ gap: 22, marginTop: 22 }}>
                <View style={{ gap: 8 }}>
                  <Text style={styles.sectionLabel}>{t('onboarding.fields.nameLabel')}</Text>
                  <View style={styles.inputWrap}>
                    <Ionicons name="person-outline" size={18} color={TEXT.hint} />
                    <TextInput
                      style={styles.input}
                      placeholder={t('onboarding.namePlaceholder')}
                      placeholderTextColor={TEXT.hint}
                      value={name}
                      onChangeText={setName}
                      maxLength={20}
                    />
                  </View>
                </View>

                {goal !== 'team' && (
                  <View style={{ gap: 8 }}>
                    <Text style={styles.sectionLabel}>{t('onboarding.fields.pbLabel', { event: event ? getEventLabel(event, language) : t('onboarding.fields.pbLabelDefault') })}</Text>
                    <View style={styles.inputWrap}>
                      <Ionicons name="trophy-outline" size={18} color={TEXT.hint} />
                      <TextInput
                        style={styles.input}
                        placeholder={
                          category === 'field' ? t('onboarding.fields.pbPlaceholderField') :
                          (event?.startsWith('5') || event?.startsWith('10') || event?.includes('marathon'))
                            ? t('onboarding.fields.pbPlaceholderLong')
                            : event?.startsWith('8') || event === '1500m' || event === '3000m' || event === '3000mSC'
                            ? t('onboarding.fields.pbPlaceholderMiddle')
                            : t('onboarding.fields.pbPlaceholderShort')
                        }
                        placeholderTextColor={TEXT.hint}
                        value={pb}
                        onChangeText={setPb}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <Text style={styles.inputHint}>
                      {category === 'field' ? t('onboarding.fields.pbHintField') : t('onboarding.fields.pbHintTrack')}
                    </Text>
                  </View>
                )}

                <View style={{ gap: 10 }}>
                  <Text style={styles.sectionLabel}>{t('onboarding.fields.experienceLabel')}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {EXPERIENCE_OPTIONS.map(opt => (
                      <TouchableOpacity
                        key={opt.key}
                        style={[styles.expBtn, experience === opt.key && styles.expBtnActive]}
                        onPress={() => { setExperience(opt.key); Sounds.tap() }}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.expLabel, experience === opt.key && { color: G2 }]}>{opt.label}</Text>
                        <Text style={[styles.expSub, experience === opt.key && { color: G2 }]}>{opt.sub}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={{ gap: 8 }}>
                  <Text style={styles.sectionLabel}>{t('onboarding.fields.ageLabel')}</Text>
                  <View style={styles.inputWrap}>
                    <Ionicons name="calendar-outline" size={18} color={TEXT.hint} />
                    <TextInput
                      style={styles.input}
                      placeholder={t('onboarding.fields.agePlaceholder')}
                      placeholderTextColor={TEXT.hint}
                      value={age}
                      onChangeText={v => setAge(v.replace(/\D/g, ''))}
                      keyboardType="number-pad"
                      maxLength={3}
                    />
                    <Text style={{ color: TEXT.hint, fontSize: 14 }}>{t('onboarding.fields.ageUnit')}</Text>
                  </View>
                </View>

                <View style={{ gap: 8 }}>
                  <Text style={styles.sectionLabel}>{t('onboarding.fields.regionLabel')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'nowrap', gap: 0, paddingHorizontal: 4 }}>
                      {PREFS_BY_REGION.map(({ region, prefs }) => (
                        <View key={region} style={{ marginRight: 14 }}>
                          <Text style={{ fontSize: 10, color: TEXT.hint, fontWeight: '700', marginBottom: 4 }}>{getRegionLabel(region, language)}</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, maxWidth: prefs.length <= 2 ? 90 : 200 }}>
                            {prefs.map(p => (
                              <TouchableOpacity
                                key={p}
                                onPress={() => { setPrefecture(prefecture === p ? '' : p); Sounds.tap() }}
                                style={{
                                  paddingHorizontal: 10, paddingVertical: 5,
                                  borderRadius: 8, borderWidth: 1.5,
                                  borderColor: prefecture === p ? G1 : SBORDER,
                                  backgroundColor: prefecture === p ? TINT : '#fff',
                                }}
                              >
                                <Text style={{ fontSize: 12, fontWeight: '600', color: prefecture === p ? G2 : TEXT.secondary }}>{getPrefectureLabel(p, language)}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                  <Text style={styles.inputHint}>{t('onboarding.fields.regionHint')}</Text>
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>

          <SafeAreaView edges={['bottom']}>
            <View style={styles.bottomBar}>
              <GradientButton label={t('onboarding.goalsScreen.saveButton')} icon="checkmark" onPress={() => { trackOnboardingStep('goal_saved', { skipped: false, hasPb: !!pb.trim() }); handleFinish() }} />
            </View>
          </SafeAreaView>
        </View>
      </View>
    )
  }

  // ── クエスト（プロフィール入力） ───────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ flex: 1, maxWidth: 600, alignSelf: 'center', width: '100%' }}>
        <SafeAreaView>
          <ProgressHeader
            step={step}
            showBack
            onBack={goBack}
            onSkip={() => {
              Sounds.tap()
              // 「次へ」と同様、チーム目的を選んだ状態でスキップされた場合も専用フローへ分岐させる
              // （でないとスキップ経由だけ選手向けの種目選択・状態チェックに入ってしまう）
              if (step === 1 && goal === 'team') { unlockAudio(); setPhase('processing'); return }
              transition(() => setStep(s => Math.min(s + 1, QUIZ_STEPS)))
            }}
          />
        </SafeAreaView>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <IconBlob icon={STEP_ICON[step]} />
              <TypewriterText text={STEP_HEADLINE[step]} style={styles.headline} triggerKey={step} />
              <Text style={styles.subline}>{STEP_SUB[step]}</Text>

              {step === 1 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
                  {GOAL_OPTIONS.map(g => (
                    <CategoryCard key={g.key} icon={g.icon} label={g.label} selected={goal === g.key} onPress={() => { setGoal(g.key as any); Sounds.tap() }} />
                  ))}
                </View>
              )}

              {step === 2 && (
                <View style={{ marginTop: 22, gap: 22 }}>
                  <View style={{ gap: 10 }}>
                    <Text style={styles.sectionLabel}>{t('onboarding.fields.genreLabel')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                      {CATEGORIES.map(c => (
                        <CategoryCard key={c.key} icon={c.icon} label={c.label} selected={category === c.key} onPress={() => handleCategorySelect(c.key)} />
                      ))}
                    </View>
                  </View>
                  <View style={{ gap: 8 }}>
                    <Text style={styles.sectionLabel}>{t('onboarding.fields.eventLabel')}</Text>
                    <View style={{ gap: 8 }}>
                      {(EVENTS_BY_CATEGORY[category] ?? EVENTS_BY_CATEGORY.sprint).map(e => (
                        <Chip key={e.key} label={getEventLabel(e.key, language)} selected={event === e.key} onPress={() => { setEvent(e.key); Sounds.tap() }} />
                      ))}
                    </View>
                  </View>
                </View>
              )}

              {step === 3 && (
                <View style={{ marginTop: 22, gap: 20 }}>
                  <View style={{ gap: 8 }}>
                    <Text style={styles.sectionLabel}>{t('onboarding.condition.practiceLabel')}</Text>
                    <View style={{ gap: 8 }}>
                      {PRACTICE_OPTIONS.map(o => (
                        <Chip key={o.key} label={t(o.labelKey)} selected={practice === o.key} onPress={() => { setPractice(o.key); Sounds.tap() }} />
                      ))}
                    </View>
                  </View>

                  <View style={{ gap: 8 }}>
                    <Text style={styles.sectionLabel}>{t('onboarding.condition.fatigueLabel')}</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {FATIGUE_OPTIONS.map(o => {
                        const selected = fatigue === o.key
                        return (
                          <TouchableOpacity
                            key={o.key}
                            style={[cs.fatigueCard, selected && cs.fatigueCardSelected]}
                            onPress={() => { setFatigue(o.key); Sounds.tap() }}
                            activeOpacity={0.8}
                          >
                            <Ionicons name={o.icon} size={22} color={selected ? '#fff' : TEXT.hint} />
                            <Text style={[cs.fatigueLabel, selected && { color: '#fff' }]}>{t(o.labelKey)}</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  </View>

                  <View style={{ gap: 8 }}>
                    <Text style={styles.sectionLabel}>{t('onboarding.condition.sleepLabel')}</Text>
                    <View style={{ gap: 8 }}>
                      {SLEEP_OPTIONS.map(o => (
                        <Chip key={o.key} label={t(o.labelKey)} selected={sleepBand === o.key} onPress={() => { setSleepBand(o.key); Sounds.tap() }} />
                      ))}
                    </View>
                  </View>

                  <View style={{ gap: 8 }}>
                    <Text style={styles.sectionLabel}>{t('onboarding.condition.painLabel')}</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity style={[cs.painBtn, !hasPain && cs.painBtnSelected]} onPress={() => { setHasPain(false); Sounds.tap() }} activeOpacity={0.8}>
                        <Text style={[cs.painBtnText, !hasPain && { color: G2 }]}>{t('onboarding.condition.painNo')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[cs.painBtn, hasPain && cs.painBtnSelectedWarn]} onPress={() => { setHasPain(true); Sounds.tap() }} activeOpacity={0.8}>
                        <Text style={[cs.painBtnText, hasPain && { color: '#b91c1c' }]}>{t('onboarding.condition.painYes')}</Text>
                      </TouchableOpacity>
                    </View>
                    {hasPain && (
                      <View style={cs.medWarn}>
                        <Text style={cs.medWarnText}>{t('onboarding.condition.medDisclaimer')}</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>

        <SafeAreaView edges={['bottom']}>
          <View style={styles.bottomBar}>
            <GradientButton
              label={step === QUIZ_STEPS ? t('onboarding.quiz.createPlan') : t('onboarding.quiz.next')}
              icon={step === QUIZ_STEPS ? 'sparkles' : 'arrow-forward'}
              disabled={(step === 1 && !canNextStep1) || (step === 2 && !canNextStep2) || (step === 3 && !canNextStep3)}
              onPress={() => {
                if (step === 1) {
                  if (!canNextStep1) return
                  trackOnboardingStep('goal_selected', { goal })
                  // 「チームを管理したい」は種目選択・状態チェックをスキップして直接演出へ
                  if (goal === 'team') { unlockAudio(); Sounds.pop(); setPhase('processing'); return }
                  goNext(2); return
                }
                if (step === 2) {
                  if (!canNextStep2) return
                  trackOnboardingStep('event_selected', { category, event })
                  trackOnboardingStep('baseline_started')
                  goNext(3); return
                }
                if (step === 3) {
                  if (!canNextStep3) return
                  trackOnboardingStep('baseline_completed', { practice, fatigue, sleep: sleepBand, hasPain })
                  setReadiness(computeOnboardingReadiness({
                    practice: practice as YesterdayPractice, fatigue: fatigue as FatigueLevel, sleep: sleepBand as SleepBand, hasPain,
                  }))
                  unlockAudio(); Sounds.pop(); setPhase('processing')
                }
              }}
            />
          </View>
        </SafeAreaView>
      </View>
    </View>
  )
}

// ── PBをミリ秒に変換 ─────────────────────────────────────
function parsePbToMs(input: string): number | null {
  const mMatch = input.match(/^(\d+):(\d+(?:\.\d+)?)$/)
  if (mMatch) return Math.round((parseInt(mMatch[1], 10) * 60 + parseFloat(mMatch[2])) * 1000)
  const sMatch = input.match(/^\d+(?:\.\d+)?$/)
  if (sMatch) return Math.round(parseFloat(input) * 1000)
  return null
}

// ════════════════════════════════════════════════════════════════
// スタイル
// ════════════════════════════════════════════════════════════════

// ── イントロカルーセル用（旧auth.tsxより移設） ──────────────
const sl = StyleSheet.create({
  scrollContent: { flexGrow: 1, minHeight: '100%' as any },
  heroContent:   { flex: 1, padding: 28, paddingTop: 80, paddingBottom: 16, justifyContent: 'flex-end' },
  slideInner:    { padding: 26, paddingTop: 64, paddingBottom: 48 },
  gridLine:   { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(0,0,0,0.03)' },
  logoRow:    { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 36 },
  logoMark:   { width: 56, height: 56, borderRadius: 16, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  logoS:      { color: '#fff', fontSize: 30, fontWeight: '900' },
  logoName:   { color: '#111827', fontSize: 26, fontWeight: '900', letterSpacing: -1 },
  logoTagline:{ color: '#888', fontSize: 10, fontWeight: '600', letterSpacing: 1.5 },
  heroTitle:  { color: '#111827', fontSize: 38, fontWeight: '900', letterSpacing: -1.5, lineHeight: 48, marginBottom: 18 },
  heroSub:    { color: '#6b7280', fontSize: 14, lineHeight: 23, marginBottom: 36 },
  scoreRow:   { flexDirection: 'row', gap: 10, marginBottom: 20 },
  scoreBadge: { flex: 1, backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', padding: 14, alignItems: 'center', gap: 4 },
  scoreVal:   { fontSize: 24, fontWeight: '900' },
  scoreLabel: { color: '#888', fontSize: 9, fontWeight: '700', textAlign: 'center', letterSpacing: 0.3 },
  hintText:   { color: '#9ca3af', fontSize: 12 },
  tag:         { color: '#9ca3af', fontSize: 10, fontWeight: '800', letterSpacing: 2.5, marginBottom: 10 },
  sectionTitle:{ color: '#111827', fontSize: 27, fontWeight: '900', letterSpacing: -0.8, marginBottom: 10 },
  sectionSub:  { color: '#6b7280', fontSize: 14, lineHeight: 22 },
})
const nav = StyleSheet.create({
  bar:      { paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 36 : 22, paddingTop: 14,
    backgroundColor: 'rgba(246,246,248,0.97)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(0,0,0,0.08)' },
  dotsRow:  { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 14 },
  dot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: '#d1d5db' },
  dotActive:{ backgroundColor: RED, width: 22 },
  btnRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  backText: { color: 'rgba(0,0,0,0.4)', fontSize: 13, fontWeight: '600' },
  nextBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 50, paddingVertical: 14, paddingHorizontal: 24 },
  nextText: { color: '#fff', fontWeight: '900', fontSize: 14 },
})

// ── クエスト用（ソフトグリーン） ─────────────────────────────
const styles = StyleSheet.create({
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 4 },
  backBtn:   { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { flex: 1, height: 5, backgroundColor: '#eceae4', borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 3 },
  skipText:  { color: TEXT.hint, fontSize: 12, fontWeight: '700' },

  blobWrap: { alignItems: 'center', marginTop: 22 },
  blob:     { width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(22,101,52,0.10)', alignItems: 'center', justifyContent: 'center' },

  headline: { fontSize: 21, fontWeight: '900', color: TEXT.primary, textAlign: 'center', marginTop: 18, lineHeight: 29, letterSpacing: -0.3 },
  subline:  { fontSize: 12.5, color: TEXT.secondary, textAlign: 'center', marginTop: 8, lineHeight: 18, paddingHorizontal: 6 },
  sectionLabel: { color: TEXT.hint, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },

  content:    { padding: 24, paddingTop: 8, paddingBottom: 40, flexGrow: 1 },

  card: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: SBORDER, borderRadius: 18, paddingVertical: 16, paddingHorizontal: 10, alignItems: 'center' },
  cardSelected: { backgroundColor: TINT, borderColor: G1, borderWidth: 2 },
  cardAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  cardAvatarSelected: { backgroundColor: '#dcfce7' },
  cardLabel: { fontSize: 12.5, fontWeight: '800', color: TEXT.primary },

  chip: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 15, borderWidth: 1.5, borderColor: SBORDER },
  chipSelected: { backgroundColor: TINT, borderColor: G1 },
  chipLabel: { color: TEXT.primary, fontSize: 15, fontWeight: '700' },
  chipSub:   { color: TEXT.hint, fontSize: 12, marginTop: 2 },
  checkBadge: { width: 20, height: 20, borderRadius: 10, backgroundColor: G1, alignItems: 'center', justifyContent: 'center' },

  expBtn: { flex: 1, minWidth: '45%', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: SBORDER, gap: 3 },
  expBtnActive:  { backgroundColor: TINT, borderColor: G1 },
  expLabel:      { color: TEXT.primary, fontSize: 14, fontWeight: '700' },
  expSub:        { color: TEXT.hint, fontSize: 11 },

  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fafaf8', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 15, borderWidth: 1.5, borderColor: SBORDER },
  input:     { flex: 1, color: TEXT.primary, fontSize: 16, outlineStyle: 'none' as any },
  inputHint: { color: TEXT.hint, fontSize: 11, paddingLeft: 4 },

  bottomBar: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 8 },
  gradientBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 50, paddingVertical: 17,
    shadowColor: G2, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 16, elevation: 6 },
  gradientBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },

  revealIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  doneBadge: { marginTop: 14, backgroundColor: TINT, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  doneBadgeText: { color: G2, fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  revealTitle: { fontSize: 22, fontWeight: '900', color: TEXT.primary, textAlign: 'center', marginTop: 14, lineHeight: 30 },

  // ── リビール（初回チェック・2026-09-07新設） ────────────────
  readinessEyebrow: { fontSize: 12, fontWeight: '800', color: TEXT.hint, letterSpacing: 1.2, textAlign: 'center', marginBottom: 10 },
  readinessRow:     { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6, marginBottom: 14 },
  readinessNum:     { fontSize: 52, fontWeight: '900', color: TEXT.primary, letterSpacing: -1.5 },
  readinessMax:     { fontSize: 15, fontWeight: '700', color: TEXT.hint, marginRight: 8 },
  readinessBadge:   { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  readinessBadgeText: { fontSize: 12, fontWeight: '800' },
  scaleBarTrack:    { height: 8, borderRadius: 4, backgroundColor: '#f0f0f0', overflow: 'hidden' },
  scaleFill:        { height: '100%', borderRadius: 4 },
  honestCaption:    { fontSize: 11.5, color: TEXT.hint, textAlign: 'center', lineHeight: 18, marginTop: 10, marginBottom: 22 },
  adviceCard:       { backgroundColor: '#14532d', borderRadius: 20, padding: 18 },
  adviceEyebrow:    { fontSize: 10.5, fontWeight: '800', color: '#86efac', letterSpacing: 1, marginBottom: 6 },
  adviceBody:       { fontSize: 14.5, fontWeight: '700', color: '#fff', lineHeight: 22 },
  day7Line:         { textAlign: 'center', fontSize: 11, color: TEXT.hint, marginTop: 12, lineHeight: 17, paddingHorizontal: 12 },

  processingTitle: { fontSize: 19, fontWeight: '900', color: TEXT.primary, textAlign: 'center' },
  processingStepCount: { fontSize: 12, fontWeight: '700', color: TEXT.hint, marginTop: 4, fontVariant: ['tabular-nums'] },
  processRow:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  processDone:    { width: 22, height: 22, borderRadius: 11, backgroundColor: G1, alignItems: 'center', justifyContent: 'center' },
  processActive:  { width: 22, height: 22, borderRadius: 11, backgroundColor: G1, opacity: 0.4 },
  processPending: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: SBORDER },
  processText:    { fontSize: 13.5, color: TEXT.secondary },
})

// ── 今日の状態チェック（画面C・2026-09-07新設） ───────────────
const cs = StyleSheet.create({
  fatigueCard: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: 14,
    backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderColor: SBORDER,
  },
  fatigueCardSelected: { backgroundColor: G2, borderColor: G2 },
  fatigueLabel: { fontSize: 11.5, fontWeight: '700', color: TEXT.secondary },
  painBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 13,
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: SBORDER,
  },
  painBtnSelected: { backgroundColor: TINT, borderColor: G1 },
  painBtnSelectedWarn: { backgroundColor: '#fef2f2', borderColor: '#fca5a5' },
  painBtnText: { fontSize: 14, fontWeight: '700', color: TEXT.secondary },
  medWarn: {
    marginTop: 10, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a',
    borderRadius: 12, padding: 12,
  },
  medWarnText: { fontSize: 11.5, color: '#92400e', lineHeight: 18 },
})
```

---

## `lib/onboardingReadiness.ts`

```ts
// lib/onboardingReadiness.ts — オンボーディング「初回チェック」用の簡易スコア（AIを使わない）
//
// 本番の怪我リスク計算(lib/injuryRisk.ts の calcInjuryRisk)は直近1〜6週間の練習・睡眠履歴を
// 必要とするため、登録直後で記録が0件のユーザーには使えない。
// ここではオンボーディングの状態チェック画面で聞く4問（昨日の練習・疲労感・睡眠時間・痛みの
// 有無）だけから、あらかじめ決めたテンプレート（ルールベースの点数表）で「初回チェック」の
// 目安スコアを出す。AI（LLM）は一切呼ばない。
//
// スケールと意味は calcInjuryRisk と統一している（0=リスク低・良好 〜 100=リスク高）。
// 記録を重ねるほど、この簡易スコアから本番の calcInjuryRisk に置き換わっていく想定。

export type YesterdayPractice = 'rest' | 'light' | 'solid' | 'hard'
export type FatigueLevel = 'fresh' | 'normal' | 'tired'
export type SleepBand = 'short' | 'mid' | 'long'
export type ReadinessBand = 'low' | 'caution' | 'warning' | 'high'

export interface OnboardingConditionInput {
  practice: YesterdayPractice
  fatigue: FatigueLevel
  sleep: SleepBand
  hasPain: boolean
}

export interface OnboardingReadinessResult {
  /** 0-100。calcInjuryRiskと同じ意味（高いほどリスク高・要注意） */
  score: number
  band: ReadinessBand
  /** i18nキー（onboarding.condition.advice.*）。呼び出し側で t() して表示する */
  adviceKey: string
}

// ── 点数表（テンプレート） ──────────────────────────────────
const PRACTICE_PTS: Record<YesterdayPractice, number> = { rest: 0, light: 3, solid: 12, hard: 22 }
const FATIGUE_PTS: Record<FatigueLevel, number> = { fresh: 0, normal: 10, tired: 20 }
const SLEEP_PTS: Record<SleepBand, number> = { long: 0, mid: 8, short: 22 }
const PAIN_PTS = 25

export function computeOnboardingReadiness(input: OnboardingConditionInput): OnboardingReadinessResult {
  let score = PRACTICE_PTS[input.practice] + FATIGUE_PTS[input.fatigue] + SLEEP_PTS[input.sleep]
  if (input.hasPain) score += PAIN_PTS
  score = Math.max(0, Math.min(100, Math.round(score)))

  const band: ReadinessBand =
    score <= 24 ? 'low' : score <= 49 ? 'caution' : score <= 74 ? 'warning' : 'high'

  // 痛み・違和感の申告がある場合は、スコア帯によらず注意喚起のテンプレートを優先する
  // （calcInjuryRiskのsymptomScoreと同じ考え方＝違和感は最優先シグナル）
  const adviceKey = input.hasPain
    ? 'onboarding.condition.advice.pain'
    : `onboarding.condition.advice.${band}`

  return { score, band, adviceKey }
}

// ホーム画面のRISK_CFGと同じ帯色（lib/theme.tsのBRAND/ALERT + 中間2色）
export const READINESS_BAND_COLOR: Record<ReadinessBand, string> = {
  low: '#166534',
  caution: '#f59e0b',
  warning: '#f97316',
  high: '#E53935',
}
```

---

## `components/TypewriterText.tsx`

```tsx
// components/TypewriterText.tsx — 1文字ずつ表示するタイピング風アニメーション
// CountUpText.tsx と同じ思想（軽量・自己完結・triggerKeyで再実行）。
import React, { useEffect, useState } from 'react'
import { Text, TextStyle } from 'react-native'

interface TypewriterTextProps {
  text: string
  speed?: number        // 1文字あたりms（デフォルト26）
  delay?: number        // 開始までの待ちms（デフォルト0）
  style?: TextStyle
  triggerKey?: any       // この値が変わるとアニメ再実行
}

export default function TypewriterText({ text, speed = 26, delay = 0, style, triggerKey }: TypewriterTextProps) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const chars = Array.from(text)
    setCount(0)
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    function step(i: number) {
      if (cancelled) return
      setCount(i)
      if (i < chars.length) timer = setTimeout(() => step(i + 1), speed)
    }

    const startTimer = setTimeout(() => step(1), delay)
    return () => { cancelled = true; clearTimeout(startTimer); clearTimeout(timer) }
  }, [text, triggerKey, speed, delay])

  const visible = Array.from(text).slice(0, count).join('')
  return <Text style={style}>{visible}</Text>
}
```

---

## `components/CountUpText.tsx`

```tsx
// components/CountUpText.tsx — 数字がカウントアップするアニメーション
import React, { useEffect, useRef, useState } from 'react'
import { Animated, Text, TextStyle } from 'react-native'

interface CountUpTextProps {
  value: number
  duration?: number       // ms（デフォルト 800）
  delay?: number          // ms（デフォルト 0）
  suffix?: string         // 例: "日" "km" "回"
  prefix?: string         // 例: "¥"
  decimals?: number       // 小数点桁数
  style?: TextStyle
  triggerKey?: any        // この値が変わるとアニメ再実行
}

export default function CountUpText({
  value,
  duration = 800,
  delay = 0,
  suffix = '',
  prefix = '',
  decimals = 0,
  style,
  triggerKey,
}: CountUpTextProps) {
  const animValue = useRef(new Animated.Value(0)).current
  const [displayValue, setDisplayValue] = useState(0)

  useEffect(() => {
    animValue.setValue(0)
    const listener = animValue.addListener(({ value: v }) => {
      setDisplayValue(v)
    })

    const anim = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(animValue, {
        toValue: value,
        duration,
        useNativeDriver: false, // 数値追跡にnativeDriverは使えない
      }),
    ])
    anim.start()

    return () => {
      animValue.removeListener(listener)
      anim.stop()
    }
  }, [value, triggerKey])

  const formatted = decimals > 0
    ? displayValue.toFixed(decimals)
    : Math.round(displayValue).toString()

  return (
    <Text style={style}>
      {prefix}{formatted}{suffix}
    </Text>
  )
}
```

---

## `app/auth.tsx`

```tsx
// app/auth.tsx — ログイン画面
// 価値提案カルーセル（旧Slide1-5）は app/onboarding.tsx に統合済み。
// ここはログイン手段の選択のみを行う（ロジック・ボタンの挙動は一切変更していない）。

import React, { useRef, useState, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform, ScrollView, Animated, Easing,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useAuth } from '../context/AuthContext'
import { BRAND, TEXT } from '../lib/theme'
import { Sounds, unlockAudio } from '../lib/sounds'
import { useTranslation } from 'react-i18next'
import { trackOnboardingStep } from '../lib/analytics'

const RED = BRAND   // アプリ全体のグリーンに統一（旧: 赤 #E53E3E）

function useFadeUp(delay = 0) {
  const opacity = useRef(new Animated.Value(0)).current
  const ty      = useRef(new Animated.Value(30)).current
  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 560, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(ty,      { toValue: 0, delay, tension: 60, friction: 10, useNativeDriver: true }),
    ]).start()
  }, [])
  return { opacity, transform: [{ translateY: ty }] } as any
}

export default function AuthScreen() {
  const { t } = useTranslation()
  const { signInWithGoogle, signInWithApple, continueAsGuest } = useAuth()
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading,  setAppleLoading]  = useState(false)

  const isInAppBrowser = typeof navigator !== 'undefined' &&
    /Instagram|FBAN|FBAV|Twitter|Line|MicroMessenger|GSA/i.test(navigator.userAgent)

  useEffect(() => { trackOnboardingStep('auth_prompt_viewed') }, [])

  const handleGoogle = () => {
    if (isInAppBrowser) {
      alert(t('auth.inAppBrowserAlert'))
      return
    }
    unlockAudio(); Sounds.pop()
    setGoogleLoading(true)
    signInWithGoogle().catch(() => {}).finally(() => setGoogleLoading(false))
  }
  const handleApple = () => {
    unlockAudio(); Sounds.pop()
    setAppleLoading(true)
    signInWithApple().catch(() => {}).finally(() => setAppleLoading(false))
  }

  const header = useFadeUp(0)
  const google = useFadeUp(180)
  const apple  = useFadeUp(260)
  const guest  = useFadeUp(360)

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={sl.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={[sl.slideInner, { alignItems: 'center' }]}>

          <Animated.View style={[{ width: '100%', alignItems: 'center', marginBottom: 32 }, header]}>
            <View style={lg.logoSmall}><Text style={lg.logoSmallS}>S</Text></View>
            <Text style={sl.tag}>{t('auth.tag')}</Text>
            <Text style={[sl.sectionTitle, { textAlign: 'center', fontSize: 28 }]}>{t('auth.title')}</Text>
            <Text style={[sl.sectionSub, { textAlign: 'center' }]}>{t('auth.subtitle')}</Text>
          </Animated.View>

          <Animated.View style={[{ width: '100%' }, google]}>
            <TouchableOpacity style={lg.googleBtn} onPress={handleGoogle} disabled={googleLoading} activeOpacity={0.85}>
              {googleLoading ? <ActivityIndicator color="#111" size="small" /> : (
                <>
                  <View style={lg.gIconWrap}><Text style={lg.gIconText}>G</Text></View>
                  <Text style={lg.googleText}>{t('auth.googleLogin')}</Text>
                </>
              )}
            </TouchableOpacity>
          </Animated.View>

          {Platform.OS === 'ios' && (
            <Animated.View style={[{ width: '100%', marginTop: 12 }, apple]}>
              <TouchableOpacity style={lg.appleBtn} onPress={handleApple} disabled={appleLoading} activeOpacity={0.85}>
                {appleLoading ? <ActivityIndicator color="#fff" size="small" /> : (
                  <>
                    <Ionicons name="logo-apple" size={20} color="#fff" />
                    <Text style={lg.appleBtnText}>{t('auth.appleLogin')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </Animated.View>
          )}

          <Animated.View style={[{ width: '100%' }, guest]}>
            <TouchableOpacity style={lg.guestBtn} onPress={() => { unlockAudio(); Sounds.tap(); trackOnboardingStep('guest_selected'); continueAsGuest() }} activeOpacity={0.7}>
              <Ionicons name="person-outline" size={16} color={TEXT.hint} />
              <Text style={lg.guestText}>{t('auth.continueAsGuest')}</Text>
            </TouchableOpacity>
            <Text style={lg.footer}>
              {t('auth.footerPrefix')}
              <Text style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/terms' as any)}>{t('auth.footerTerms')}</Text>
              {t('auth.footerAnd')}
              <Text style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/privacy' as any)}>{t('auth.footerPrivacy')}</Text>
              {t('auth.footerSuffix')}
            </Text>
          </Animated.View>

        </View>
      </ScrollView>
    </View>
  )
}

const sl = StyleSheet.create({
  scrollContent: { flexGrow: 1, minHeight: '100%' as any, justifyContent: 'center' },
  slideInner:    { padding: 26, paddingTop: 64, paddingBottom: 48 },
  tag:         { color: '#9ca3af', fontSize: 10, fontWeight: '800', letterSpacing: 2.5, marginBottom: 10 },
  sectionTitle:{ color: '#111827', fontSize: 27, fontWeight: '900', letterSpacing: -0.8, marginBottom: 10 },
  sectionSub:  { color: '#6b7280', fontSize: 14, lineHeight: 22 },
})

const lg = StyleSheet.create({
  logoSmall:   { width: 56, height: 56, borderRadius: 16, backgroundColor: RED, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  logoSmallS:  { color: '#fff', fontSize: 28, fontWeight: '900' },

  googleBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 18, paddingVertical: 18 },
  gIconWrap:   { width: 24, height: 24, borderRadius: 12, backgroundColor: '#4285F4', alignItems: 'center', justifyContent: 'center' },
  gIconText:   { fontSize: 13, fontWeight: '900', color: '#fff' },
  googleText:  { color: '#111', fontSize: 16, fontWeight: '800' },

  appleBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#000', borderRadius: 18, paddingVertical: 18 },
  appleBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  guestBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, marginTop: 8, borderRadius: 14,
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.12)', backgroundColor: 'rgba(0,0,0,0.04)' },
  guestText:   { color: '#374151', fontSize: 15, fontWeight: '700' },
  footer:      { color: '#9ca3af', fontSize: 10, textAlign: 'center', lineHeight: 16, paddingBottom: 8 },
})
```

---

## `context/AuthContext.tsx`

```tsx
// context/AuthContext.tsx — 認証状態グローバル管理

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { syncAll, syncProfileToCloud } from '../lib/cloudSync'
import Toast from 'react-native-toast-message'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import * as AuthSession from 'expo-auth-session'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Crypto from 'expo-crypto'
import { GoogleSignin, statusCodes as GoogleStatusCodes } from '@react-native-google-signin/google-signin'
import { useTranslation } from 'react-i18next'
import { trackOnboardingStep } from '../lib/analytics'

// expo-web-browser の結果を Supabase が処理できるよう登録
// iOS 26 で稀に throw するため try-catch で保護
try { WebBrowser.maybeCompleteAuthSession() } catch {}

const ONBOARDING_KEY = 'tm_onboarded'

// 現在のオリジンを使う（localhost / Vercel / その他デプロイ先すべてに対応）
const SITE_URL = typeof window !== 'undefined' && window.location?.origin
  ? window.location.origin
  : 'https://scorej-run.vercel.app'

// ── PKCE コード交換の重複排除 ────────────────────────────────────
// signInWithGoogle の openAuthSessionAsync 結果と、Linking のディープリンク
// リスナーが同じ code で同時に exchangeCodeForSession を呼ぶと、PKCE の
// code verifier が片方で消費され、もう片方が「no valid flow state found」で
// 失敗する。code 単位で1回だけ交換するようにロックする。
let _exchangePromise: Promise<{ error: any }> | null = null
let _exchangeCode: string | null = null
const _doneCodes = new Set<string>()

async function exchangeCodeOnce(urlOrCode: string): Promise<{ error: any }> {
  const m = urlOrCode.match(/[?&]code=([^&\s]+)/)
  const code = m ? decodeURIComponent(m[1]) : urlOrCode
  // 既に成功済みの code → 成功扱いでスキップ
  if (_doneCodes.has(code)) return { error: null }
  // 同じ code が交換中 → その Promise を待つ（二重呼び出しを1本化）
  if (_exchangeCode === code && _exchangePromise) return _exchangePromise
  _exchangeCode = code
  _exchangePromise = (async () => {
    try {
      // まず URL 形式で試し、ダメなら code だけで再試行
      let { error } = await (supabase.auth as any).exchangeCodeForSession(urlOrCode)
      if (error) {
        const r = await (supabase.auth as any).exchangeCodeForSession(code)
        error = r.error
      }
      if (!error) _doneCodes.add(code)
      return { error }
    } finally {
      _exchangePromise = null
      _exchangeCode = null
    }
  })()
  return _exchangePromise
}

interface AuthContextType {
  user:                    User    | null
  session:                 Session | null
  loading:                 boolean
  isGuest:                 boolean
  isOnboarded:             boolean
  signInWithGoogle:        () => Promise<void>
  signInWithApple:         () => Promise<void>
  signInWithEmail:         (email: string, password: string) => Promise<boolean>
  signUpWithEmail:         (email: string, password: string) => Promise<'signed_in' | 'confirm_email' | false>
  resendConfirmationEmail: (email: string) => Promise<boolean>
  sendOtp:                 (email: string) => Promise<boolean>
  verifyOtp:               (email: string, token: string) => Promise<boolean>
  signOut:                 () => Promise<void>
  continueAsGuest:         () => void
  signOutGuest:            () => void
  setOnboarded:            () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null, session: null, loading: true,
  isGuest: false, isOnboarded: false,
  signInWithGoogle:        async () => {},
  signInWithApple:         async () => {},
  signInWithEmail:         async () => false,
  signUpWithEmail:         async () => false,
  resendConfirmationEmail: async () => false,
  sendOtp:                 async () => false,
  verifyOtp:               async () => false,
  signOut:                 async () => {},
  continueAsGuest:         () => {},
  signOutGuest:            () => {},
  setOnboarded:            async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const [user,        setUser]        = useState<User | null>(null)
  const [session,     setSession]     = useState<Session | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [isGuest,     setIsGuest]     = useState(false)
  const [isOnboarded, setIsOnboarded] = useState(false)

  useEffect(() => {
    let mounted = true

    // ── ディープリンクからコードを交換する（メール確認・OAuth コールバック） ──
    // ネイティブでメール確認リンクや Google OAuth コールバックを受け取ったとき
    // score://auth-callback?code=... を Supabase が自動処理しないため手動で交換する
    const handleDeepLink = async (url: string) => {
      if (!url) return
      try {
        if (url.includes('code=')) {
          await exchangeCodeOnce(url)   // 重複排除付き（二重交換を防ぐ）
        } else if (url.includes('access_token=')) {
          // implicit flow（旧 Supabase）
          const hash = url.split('#')[1] ?? ''
          const params = new URLSearchParams(hash)
          const accessToken = params.get('access_token')
          const refreshToken = params.get('refresh_token')
          if (accessToken && refreshToken) {
            await (supabase.auth as any).setSession({ access_token: accessToken, refresh_token: refreshToken })
          }
        }
      } catch (e) {
        console.warn('[DeepLink] handleDeepLink error:', e)
      }
    }

    const init = async () => {
      try {
        // 1+2+3 を並列実行（直列だと 3 倍かかる）
        const [ob, sessionResult, storedUserId, initialUrl] = await Promise.all([
          AsyncStorage.getItem(ONBOARDING_KEY).catch(() => null),
          (supabase.auth as any).getSession().catch(() => ({ data: null })),
          AsyncStorage.getItem('userId').catch(() => null),
          // 起動時のディープリンク URL を取得（メール確認リンクからの起動に対応）
          Platform.OS !== 'web' ? Linking.getInitialURL().catch(() => null) : Promise.resolve(null),
        ])
        if (!mounted) return

        // アプリがメール確認リンクから起動した場合はコードを交換
        if (initialUrl && (initialUrl.includes('code=') || initialUrl.includes('access_token='))) {
          await handleDeepLink(initialUrl)
        }

        setIsOnboarded(ob === 'true')
        const s = sessionResult?.data?.session ?? null
        setSession(s)
        setUser(s?.user ?? null)
        // 起動時: 既存セッションがあればuserIdをキャッシュ + クラウド同期
        if (s?.user?.id) {
          AsyncStorage.setItem('userId', s.user.id).catch(() => {})
          syncAll(s.user.id).catch(() => {})
          syncProfileToCloud(s.user.id).catch(() => {})
        } else if (storedUserId?.startsWith('guest_') || storedUserId === 'guest') {
          // ゲストとして続けていたユーザーを再認識（アプリ再起動でもゲスト状態を維持）
          setIsGuest(true)
        }
      } catch {
        // 予期せぬエラーでも loading を解除してアプリを続行
      } finally {
        if (mounted) setLoading(false)
      }
    }

    init()

    // 実行中にディープリンクが来た場合（アプリが起動済みの状態でメールリンクをタップ）
    let linkingSub: any
    if (Platform.OS !== 'web') {
      linkingSub = Linking.addEventListener('url', ({ url }) => {
        if (!mounted) return
        if (url && (url.includes('code=') || url.includes('access_token='))) {
          handleDeepLink(url)
        }
      })
    }

    // セッション変更監視（メール確認後の自動ログインもここで拾う）
    let subscription: any
    try {
      const { data } = (supabase.auth as any).onAuthStateChange(
        async (event: string, newSession: any) => {
          if (!mounted) return
          setSession(newSession)
          setUser(newSession?.user ?? null)
          if (newSession) setIsGuest(false)

          if (event === 'SIGNED_IN' || event === 'EMAIL_CONFIRMED') {
            // ログイン直後に isOnboarded を再取得してナビゲーションが正しく動くようにする
            const ob = await AsyncStorage.getItem(ONBOARDING_KEY).catch(() => null)
            if (mounted) setIsOnboarded(ob === 'true')
            // setLoading(false) は init() の finally で確実に呼ばれるため、ここでは不要
            // （早期に呼ぶと init() 完了前に AuthGate が動いて不正リダイレクトが起きる）
            // ログイン直後: クラウドとローカルを双方向マージ同期
            // （ゲストで使ったデータをクラウドへ移行 + 他デバイスのデータを取得）
            if (newSession?.user?.id) {
              // userId をローカルにキャッシュ（各画面の user_id フィールド設定で使用）
              AsyncStorage.setItem('userId', newSession.user.id).catch(() => {})
              syncAll(newSession.user.id).catch(() => {})
              syncProfileToCloud(newSession.user.id).catch(() => {})
            }
          }
          // セッション終了時はキャッシュをクリア
          if (event === 'SIGNED_OUT') {
            AsyncStorage.removeItem('userId').catch(() => {})
          }
        },
      )
      subscription = data?.subscription
    } catch (_) {}

    return () => {
      mounted = false
      try { subscription?.unsubscribe() } catch (_) {}
      try { linkingSub?.remove() } catch (_) {}
    }
  }, [])

  // ── Google Sign In（ネイティブ idToken 方式・Apple と同じパターン） ──
  const signInWithGoogle = useCallback(async () => {
    try {
      if (Platform.OS === 'web') {
        // Web: OAuth リダイレクト方式
        const { data, error } = await (supabase.auth as any).signInWithOAuth({
          provider: 'google',
          options: { redirectTo: SITE_URL, skipBrowserRedirect: true },
        })
        if (error || !data?.url) {
          Toast.show({ type: 'error', text1: t('auth.googleLoginFailed'), text2: error?.message ?? t('auth.urlFetchFailed') })
          return
        }
        if (typeof window !== 'undefined') window.location.href = data.url
        return
      }

      // Native: Google Sign-In SDK → idToken → Supabase（PKCEブラウザフロー不使用）
      GoogleSignin.configure({
        webClientId:  '918711129795-hskjq09k6e8gumt71ptmgkjepskmktf2.apps.googleusercontent.com',
        iosClientId:  '918711129795-5lt5a8v4ud03iu2lg35olfits8rc78dg.apps.googleusercontent.com',
        offlineAccess: false,
      })

      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: false })
      await GoogleSignin.signIn()
      const { idToken } = await GoogleSignin.getTokens()

      if (!idToken) {
        Toast.show({ type: 'error', text1: t('auth.googleLoginFailed'), text2: t('auth.idTokenFailed') })
        return
      }

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      })
      if (error) {
        Toast.show({ type: 'error', text1: t('auth.googleLoginFailed'), text2: error.message, visibilityTime: 5000 })
      } else {
        trackOnboardingStep('auth_completed', { provider: 'google' })
      }
    } catch (e: any) {
      if (e?.code === GoogleStatusCodes.SIGN_IN_CANCELLED) return  // ユーザーキャンセル
      if (e?.code === GoogleStatusCodes.IN_PROGRESS) return        // 既に処理中
      const msg = e?.message ?? t('auth.genericError')
      Toast.show({ type: 'error', text1: t('auth.googleLoginFailed'), text2: msg, visibilityTime: 5000 })
    }
  }, [t])

  // ── Apple Sign In ─────────────────────────────────────────
  const signInWithApple = useCallback(async () => {
    try {
      if (Platform.OS === 'ios') {
        // iOS: ネイティブ機能が利用可能か確認（Expo Go では使えない）
        let nativeAvailable = false
        try { nativeAvailable = await AppleAuthentication.isAvailableAsync() } catch {}

        if (nativeAvailable) {
          // nonce: raw を Supabase に、SHA256(raw) を Apple に渡す（Supabase推奨フロー）
          const rawNonce = Crypto.randomUUID()
          const hashedNonce = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            rawNonce,
          )
          const credential = await AppleAuthentication.signInAsync({
            requestedScopes: [
              AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
              AppleAuthentication.AppleAuthenticationScope.EMAIL,
            ],
            nonce: hashedNonce,
          })
          if (!credential.identityToken) {
            Toast.show({ type: 'error', text1: t('auth.appleLoginFailed'), text2: t('auth.appleTokenFailed') })
            return
          }
          const { error } = await (supabase.auth as any).signInWithIdToken({
            provider: 'apple',
            token:    credential.identityToken,
            nonce:    rawNonce,
          })
          if (error) Toast.show({ type: 'error', text1: t('auth.appleLoginFailed'), text2: error.message })
          else trackOnboardingStep('auth_completed', { provider: 'apple' })
        } else {
          // Expo Go などネイティブ機能なし → ブラウザ経由で Web の auth ページへ
          await WebBrowser.openBrowserAsync(SITE_URL + '?auth=apple')
        }

      } else if (Platform.OS === 'web') {
        // Web: Supabase OAuth リダイレクト
        const { data, error } = await (supabase.auth as any).signInWithOAuth({
          provider: 'apple',
          options:  { redirectTo: SITE_URL, skipBrowserRedirect: false },
        })
        if (error) {
          Toast.show({ type: 'error', text1: t('auth.appleLoginFailed'), text2: error.message })
          return
        }
        if (data?.url && typeof window !== 'undefined') {
          window.location.href = data.url
        }
      } else {
        Toast.show({ type: 'info', text1: t('auth.appleIosOnly') })
      }
    } catch (e: any) {
      if (e?.code !== 'ERR_CANCELED') {
        Toast.show({ type: 'error', text1: t('auth.appleLoginFailed'), text2: e?.message ?? t('auth.genericError') })
      }
    }
  }, [t])

  // ── メール/パスワード ログイン ────────────────────────────
  const signInWithEmail = useCallback(async (email: string, password: string): Promise<boolean> => {
    try {
      const { data, error } = await (supabase.auth as any).signInWithPassword({ email, password })
      if (error) {
        const msg =
          error.message?.includes('Invalid login') || error.message?.includes('invalid_credentials')
            ? t('auth.invalidCredentials')
          : error.message?.includes('Email not confirmed')
            ? t('auth.emailNotConfirmed')
          : error.message ?? t('auth.loginGenericError')
        Toast.show({ type: 'error', text1: t('auth.loginFailed'), text2: msg })
        return false
      }
      if (data?.session) {
        setSession(data.session)
        setUser(data.session.user)
        setIsGuest(false)
      }
      return true
    } catch (e: any) {
      Toast.show({ type: 'error', text1: t('auth.loginFailed'), text2: e?.message ?? t('auth.genericError') })
      return false
    }
  }, [t])

  // ── 新規登録 ──────────────────────────────────────────────
  const signUpWithEmail = useCallback(
    async (email: string, password: string): Promise<'signed_in' | 'confirm_email' | false> => {
      try {
        // ネイティブ: メール確認リンクをタップするとアプリが直接開くようにディープリンクを使用
        // Web: そのままサイトに戻る
        const emailRedirectTo = Platform.OS === 'web'
          ? SITE_URL
          : AuthSession.makeRedirectUri({ scheme: 'score', path: 'auth-callback' })
        const { data, error } = await (supabase.auth as any).signUp({
          email,
          password,
          options: { emailRedirectTo },
        })
        if (error) {
          const msg =
            error.message?.includes('already registered') || error.message?.includes('already exists')
              ? t('auth.emailAlreadyRegistered')
            : error.message?.includes('Password')
              ? t('auth.passwordTooShort')
            : error.message ?? t('auth.signupGenericError')
          Toast.show({ type: 'error', text1: t('auth.signupFailed'), text2: msg })
          return false
        }
        // 確認メール不要（auto confirm ON）の場合は即ログイン
        if (data?.session) {
          setSession(data.session)
          setUser(data.session.user)
          setIsGuest(false)
          Toast.show({ type: 'success', text1: t('auth.signupCompleteTitle'), text2: t('auth.signupCompleteBody') })
          return 'signed_in'
        }
        // 確認メール必要の場合
        Toast.show({
          type: 'success',
          text1: t('auth.confirmEmailSentTitle'),
          text2: t('auth.confirmEmailSentBody'),
          visibilityTime: 5000,
        })
        return 'confirm_email'
      } catch (e: any) {
        Toast.show({ type: 'error', text1: t('auth.signupFailed'), text2: e?.message ?? t('auth.genericError') })
        return false
      }
    },
    [t],
  )

  // ── OTP 送信（メールに6桁コード） ────────────────────────
  const sendOtp = useCallback(async (email: string): Promise<boolean> => {
    try {
      const { error } = await (supabase.auth as any).signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      })
      if (error) {
        const msg = error.message?.includes('rate') || error.message?.includes('limit') || error.message?.includes('too many')
          ? t('auth.otpRateLimited')
          : error.message ?? t('auth.otpSendFailed')
        Toast.show({ type: 'error', text1: t('auth.sendFailed'), text2: msg })
        return false
      }
      Toast.show({ type: 'success', text1: t('auth.otpSentTitle'), text2: t('auth.otpSentBody') })
      return true
    } catch (e: any) {
      Toast.show({ type: 'error', text1: t('auth.sendFailed'), text2: e?.message ?? t('auth.genericError') })
      return false
    }
  }, [t])

  // ── OTP 検証 ─────────────────────────────────────────────
  const verifyOtp = useCallback(async (email: string, token: string): Promise<boolean> => {
    try {
      const { data, error } = await (supabase.auth as any).verifyOtp({
        email,
        token,
        type: 'email',
      })
      if (error) {
        const msg = error.message?.includes('expired')
          ? t('auth.otpExpired')
          : error.message?.includes('invalid') || error.message?.includes('Invalid')
          ? t('auth.otpInvalid')
          : error.message ?? t('auth.authGenericError')
        Toast.show({ type: 'error', text1: t('auth.authFailed'), text2: msg })
        return false
      }
      if (data?.session) {
        setSession(data.session)
        setUser(data.session.user)
        setIsGuest(false)
      }
      return true
    } catch (e: any) {
      Toast.show({ type: 'error', text1: t('auth.authFailed'), text2: e?.message ?? t('auth.genericError') })
      return false
    }
  }, [t])

  // ── 確認メール再送 ────────────────────────────────────────
  const resendConfirmationEmail = useCallback(async (email: string): Promise<boolean> => {
    try {
      const emailRedirectTo = Platform.OS === 'web'
        ? SITE_URL
        : AuthSession.makeRedirectUri({ scheme: 'score', path: 'auth-callback' })
      const { error } = await (supabase.auth as any).resend({
        type: 'signup',
        email,
        options: { emailRedirectTo },
      })
      if (error) {
        Toast.show({ type: 'error', text1: t('auth.resendFailed'), text2: error.message ?? t('auth.resendFailedRetry') })
        return false
      }
      Toast.show({ type: 'success', text1: t('auth.resendSuccessTitle'), text2: t('auth.resendSuccessBody') })
      return true
    } catch (e: any) {
      Toast.show({ type: 'error', text1: t('auth.resendFailed'), text2: e?.message ?? t('auth.genericError') })
      return false
    }
  }, [t])

  // ── ログアウト ────────────────────────────────────────────
  const signOut = useCallback(async () => {
    // Supabaseセッション終了（エラーは無視）
    try { await (supabase.auth as any).signOut() } catch (_) {}
    // ローカル状態をリセット → AuthGate が /auth へリダイレクト
    setUser(null)
    setSession(null)
    setIsGuest(false)
    // オンボーディングフラグはリセットしない（再ログインで再度やらせない）
  }, [])

  // ── ゲスト ────────────────────────────────────────────────
  const continueAsGuest = useCallback(() => {
    setIsGuest(true)
    setLoading(false)
    // ゲストIDを永続化（アプリ再起動後もゲスト状態を維持するため）
    const guestId = `guest_${Date.now()}`
    AsyncStorage.setItem('userId', guestId).catch(() => {})
    // アクセスコード・サブスクキャッシュをクリア（前ユーザーの課金状態を引き継がせない）
    AsyncStorage.multiRemove(['trackmate_subscription']).catch(() => {})
  }, [])

  // ── ゲスト解除（設定画面の「ログイン」ボタン用） ─────────
  const signOutGuest = useCallback(() => {
    setIsGuest(false)
    // ゲストIDをクリア（再ログイン促進）
    AsyncStorage.removeItem('userId').catch(() => {})
    // AuthGate が authed=false を検知して /auth へ自動リダイレクト
  }, [])

  // ── オンボーディング完了 ──────────────────────────────────
  const setOnboarded = useCallback(async () => {
    setIsOnboarded(true)
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true').catch(() => {})
  }, [])

  return (
    <AuthContext.Provider value={{
      user, session, loading,
      isGuest, isOnboarded,
      signInWithGoogle, signInWithApple,
      signInWithEmail, signUpWithEmail, resendConfirmationEmail,
      sendOtp, verifyOtp,
      signOut, continueAsGuest, signOutGuest, setOnboarded,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
```

---

## `components/FirstRunChecklist.tsx`

```tsx
// components/FirstRunChecklist.tsx
// 2026-09-07: オンボーディング再設計の一部。到達後800msで自動的に全画面を再説明する
// 旧チュートリアル(useTutorial().startTutorial())を廃止し、代わりにホーム画面に常駐する
// 3項目チェックリストを表示する（ヒントは自動で押し付けず、本人が触るタイミングに任せる）。
// 3つとも完了、または本人が閉じたら二度と出さない（skipTutorial()と同じ完了フラグを共有）。
import React, { useEffect, useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTranslation } from 'react-i18next'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { isTutorialDone, useTutorial } from '../lib/tutorialContext'
import { BRAND } from '../lib/theme'
import { trackOnboardingStep } from '../lib/analytics'

const MENU_VISITED_KEY = 'trackmate_checklist_menu_visited'
const VIDEO_VISITED_KEY = 'trackmate_checklist_video_visited'

interface Props {
  hasLoggedConditionToday: boolean
  onOpenConditionModal: () => void
  onNavigateMenu: () => void
  onNavigateVideo: () => void
}

export default function FirstRunChecklist({
  hasLoggedConditionToday, onOpenConditionModal, onNavigateMenu, onNavigateVideo,
}: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const s = useMemo(() => makeS(colors), [colors])
  const { skipTutorial, startTutorial } = useTutorial()

  const [shouldShow, setShouldShow] = useState(false)
  const [menuVisited, setMenuVisited] = useState(false)
  const [videoVisited, setVideoVisited] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [done, menuV, videoV] = await Promise.all([
        isTutorialDone(),
        AsyncStorage.getItem(MENU_VISITED_KEY),
        AsyncStorage.getItem(VIDEO_VISITED_KEY),
      ])
      if (cancelled) return
      setMenuVisited(menuV === '1')
      setVideoVisited(videoV === '1')
      setShouldShow(!done)
    })()
    return () => { cancelled = true }
  }, [])

  // 2026-09-07: 「種目のPBを設定する」は設定画面の奥まった場所にあり見つけにくいという
  // フィードバックを受け、より発見しやすく・すぐ試せる「動画分析を使ってみる」に変更。
  const items = [
    { key: 'condition', label: t('firstRunChecklist.itemCondition'), done: hasLoggedConditionToday, onPress: onOpenConditionModal },
    { key: 'menu',      label: t('firstRunChecklist.itemMenu'),      done: menuVisited,             onPress: () => { AsyncStorage.setItem(MENU_VISITED_KEY, '1').catch(() => {}); setMenuVisited(true); onNavigateMenu() } },
    { key: 'video',     label: t('firstRunChecklist.itemVideo'),     done: videoVisited,            onPress: () => { AsyncStorage.setItem(VIDEO_VISITED_KEY, '1').catch(() => {}); setVideoVisited(true); onNavigateVideo() } },
  ]
  const doneCount = items.filter(i => i.done).length

  useEffect(() => {
    // 3つとも完了したら、旧チュートリアルの完了フラグも一緒に立てて二度と出さない
    if (shouldShow && doneCount === items.length) {
      trackOnboardingStep('checklist_completed')
      const timer = setTimeout(() => { skipTutorial(); setShouldShow(false) }, 900)
      return () => clearTimeout(timer)
    }
  }, [doneCount, shouldShow])

  if (!shouldShow) return null

  return (
    <View style={[s.card, { backgroundColor: 'rgba(34,197,94,0.07)', borderColor: 'rgba(34,197,94,0.28)' }]}>
      <View style={s.headerRow}>
        <Text style={[s.title, { color: colors.text }]}>{t('firstRunChecklist.title', { done: doneCount, total: items.length })}</Text>
        <TouchableOpacity onPress={() => { skipTutorial(); setShouldShow(false) }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={16} color={colors.textHint} />
        </TouchableOpacity>
      </View>

      {items.map(item => (
        <TouchableOpacity key={item.key} style={s.row} onPress={item.onPress} activeOpacity={0.7} disabled={item.done}>
          <View style={[s.box, { borderColor: item.done ? BRAND : colors.border }, item.done && { backgroundColor: BRAND }]}>
            {item.done && <Ionicons name="checkmark" size={12} color="#fff" />}
          </View>
          <Text style={[s.rowText, { color: colors.text }, item.done && { color: colors.textHint, textDecorationLine: 'line-through' }]}>
            {item.label}
          </Text>
          {!item.done && <Ionicons name="chevron-forward" size={15} color={colors.textHint} />}
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={s.tourLink} onPress={startTutorial}>
        <Text style={[s.tourLinkText, { color: colors.textHint }]}>{t('firstRunChecklist.guidedTourLink')}</Text>
      </TouchableOpacity>
    </View>
  )
}

const makeS = (colors: ThemeColors) => StyleSheet.create({
  card: {
    borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.06, shadowRadius: 14, elevation: 3,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 14, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.6, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, fontSize: 13, fontWeight: '600' },
  tourLink: { marginTop: 4, alignSelf: 'center', paddingVertical: 6 },
  tourLinkText: { fontSize: 11.5, fontWeight: '600', textDecorationLine: 'underline' },
})
```

---

## `app/(tabs)/index.tsx`

```tsx
// app/(tabs)/index.tsx — シンプルホーム（ゲーミフィケーション + 改善タスク + 総合リスク）
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import {
  ActivityIndicator, Alert, Animated, Easing, KeyboardAvoidingView, Linking, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { useTheme, type ThemeColors } from '../../context/ThemeContext'
import { useLanguage } from '../../context/LanguageContext'
import { narrativeLanguageInstruction } from '../../lib/aiLanguage'
import { useTrainingSessions } from '../../hooks/useTrainingSessions'
import { calcInjuryRisk } from '../../lib/injuryRisk'
import { calcLevelInfo } from '../../lib/gamification'
import { checkInStreak, TICKET_COST, grantFirstGoalBonusIfNeeded } from '../../lib/ticketWallet'
import { getAiAuthHeader } from '../../lib/supabase'
import GlassCard from '../../components/GlassCard'
import PressableScale from '../../components/PressableScale'
import { BRAND, ALERT, NEON } from '../../lib/theme'
import { Sounds, unlockAudio } from '../../lib/sounds'
import HapticTouch from '../../components/HapticTouch'
import Logo from '../../components/Logo'
import PWAInstallPrompt from '../../components/PWAInstallPrompt'
import QuickLogModal from '../../components/QuickLogModal'
import QuickConditionModal from '../../components/QuickConditionModal'
import FirstRunChecklist from '../../components/FirstRunChecklist'
import {
  shouldShowDay3Offer, shouldShowDay5Offer, markDay3OfferShown, markDay5OfferShown,
  markFirstScoreViewed,
} from '../../lib/paywallTiming'
import { computeWeeklyTrend, shouldShowWeeklyReport } from '../../lib/weeklyReport'
import PracticeShareCard, { PracticeShareData } from '../../components/PracticeShareCard'
import StretchHoldButton from '../../components/StretchHoldButton'
import { registerHomeScroll, unregisterHomeScroll } from '../../lib/homeScroll'
import { setQuickLogListener, clearQuickLogListener } from '../../lib/quickLogEvent'
import { getCachedWeather, getWeatherCacheOnly, clearWeatherCache } from '../../lib/weather'
import { calcWeatherRiskBonus, getWeatherRiskText } from '../../lib/weatherRisk'
import { getHydrationEligibility, markHydrationShown, logHydrationPress, getHydrationReductionPts } from '../../lib/hydration'
import Toast from 'react-native-toast-message'
import { autoSyncTeam } from '../../lib/teamAutoSync'
import { trackAppOpen, trackPaywallView } from '../../lib/analytics'
import { usePurchase } from '../../context/PurchaseContext'
import TutorialSpot from '../../components/TutorialSpot'
import Svg, { Circle, Defs, LinearGradient, Stop, Path, Rect } from 'react-native-svg'
import { useTutorial } from '../../lib/tutorialContext'
import { sendRiskAlertIfNeeded, sendStretchReminderIfNeeded, scheduleCompetitionReminder, scheduleStreakReminder } from '../../lib/notifications'
import { fetchTeamEvents, sendCoachNotification, type TeamEventRow } from '../../lib/supabaseTeam'
import type { SleepRecord, AthleticsEvent } from '../../types'
import { getEventLabel } from '../../lib/eventLabels'
import { syncWidgetData } from '../../lib/widgetSync'
import ReviewWall, { shouldShowReviewWall } from '../../components/ReviewWall'
import { hasDailyInsightClaimed, markDailyInsightClaimed } from '../../lib/admob'
import { isAnyAdShowing } from '../../lib/adLock'
import { checkAdGate, recordUsage } from '../../lib/adGate'
import TicketGateModal from '../../components/TicketGateModal'
import { todayLocalISO, localDateStr } from '../../lib/dateLocal'
import { TASKS_KEY, getTasks, updateTasks, type ImprovementTask } from '../../lib/tasksStore'
import { updateConditionMap } from '../../lib/conditionStore'
import { getStretchResult, updateStretchResult } from '../../lib/stretchResultStore'
import { SESSION_TYPE_LABEL, sessionTypeInfo } from '../../lib/sessionTypeLabels'

// Hermesの AbortSignal.timeout 非対応に対応したタイムアウト付きfetch
function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return fetch(url, { ...options, signal: AbortSignal.timeout(ms) })
  }
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id))
}

// ── AsyncStorage keys ───────────────────────────────────
const CONDITION_KEY      = 'trackmate_condition'
const CONDITION_MAP_KEY  = 'trackmate_condition_map'
const SLEEP_KEY          = 'trackmate_sleep'
const RECOVERY_KEY       = 'trackmate_recovery_records'
const GOALS_KEY          = 'trackmate_goals'
const JOINED_KEY          = 'trackmate_team_joined'
const EVENT_CONFIRMED_KEY = 'event_confirmed_ids'
const NOTIF_READ_KEY      = 'notif_read_ids'

// アプリお知らせIDリスト（通知画面と同期）
const APP_NOTICE_IDS = ['v1.0.1-date-fix','v1.0.1-load-fix','v1.0.1-injury-model','welcome-v1']
const APP_NOTICE_DATES: Record<string, string> = {
  'v1.0.1-date-fix': '2026-05-14', 'v1.0.1-load-fix': '2026-05-14',
  'v1.0.1-injury-model': '2026-05-14', 'welcome-v1': '2026-04-01',
}

// ── チーム予定ヘルパー ────────────────────────────────────
const EVENT_CFG_HOME: Record<string, { emoji: string; color: string }> = {
  practice: { emoji: '🏃', color: '#34C759' },
  race:     { emoji: '🏁', color: BRAND     },
  rest:     { emoji: '😴', color: '#5856D6' },
  meeting:  { emoji: '💬', color: '#FF9500' },
  other:    { emoji: '📌', color: '#8E8E93' },
}
function isPastEvent(d: string) {
  const dt = new Date(d + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return dt.getTime() < today.getTime()
}
function isNewTeamEvent(createdAt: string) {
  return Date.now() - new Date(createdAt).getTime() < 3 * 24 * 60 * 60 * 1000
}
function fmtEventDateHome(d: string, t: (key: string) => string, dayNames: string[]) {
  const dt = new Date(d + 'T00:00:00')
  const today = new Date(); today.setHours(0,0,0,0)
  const diff = Math.round((dt.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return t('home.relativeDate.today')
  if (diff === 1) return t('home.relativeDate.tomorrow')
  if (diff === 2) return t('home.relativeDate.dayAfterTomorrow')
  return `${dt.getMonth()+1}/${dt.getDate()}（${dayNames[dt.getDay()]}）`
}

// タイム表示（ミリ秒 → "12.34" / "1'28.50"）。練習一覧・当日記録の両セクションで共通利用
function fmtSessionTime(ms: number) {
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(2)}"`
  return `${Math.floor(sec/60)}'${(sec%60).toFixed(2).padStart(5,'0')}"`
}

export interface GoalTask {
  id: string
  text: string
  done: boolean
}

export interface Goal {
  id: string
  text: string
  deadline?: string   // ISO date "YYYY-MM-DD"
  progress: number    // 0-100
  achieved: boolean
  created_at: string
  tasks?: GoalTask[]  // サブタスク
}

// ── 定数 ────────────────────────────────────────────────
function buildConditionEmojis(t: (key: string) => string) {
  return [
    { emoji: '😫', label: t('home.condition.tough'),  value: 2 },
    { emoji: '😕', label: t('home.condition.hard'),   value: 4 },
    { emoji: '😐', label: t('home.condition.normal'), value: 6 },
    { emoji: '😊', label: t('home.condition.good'),   value: 8 },
    { emoji: '💪', label: t('home.condition.great'),  value: 10 },
  ] as const
}

// ────────────────────────────────────────────────────────
// AnimatedEntry
// ────────────────────────────────────────────────────────
function AnimatedEntry({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const fadeY = useRef(new Animated.Value(0)).current
  useFocusEffect(
    useCallback(() => {
      fadeY.setValue(0)
      const anim = Animated.spring(fadeY, {
        toValue: 1, delay,
        speed: 16, bounciness: 8,
        useNativeDriver: true,
      })
      anim.start()
      return () => anim.stop()
    }, [delay])
  )
  return (
    <Animated.View style={{
      opacity: fadeY,
      transform: [
        { translateY: fadeY.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
        { scale: fadeY.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
      ],
    }}>
      {children}
    </Animated.View>
  )
}

// ────────────────────────────────────────────────────────
// WeekDateBar — 7日間横スクロール日付バー
// ────────────────────────────────────────────────────────
// 今日の日付を毎回生成（モジュール定数にすると日付またぎで古いまま）
// UTC基準の toISOString() だと JST 深夜0〜9時に前日扱いになるため、
// ローカルタイムゾーンで正しく「今日」を返す共通ヘルパーを使う
function getTodayISO() { return todayLocalISO() }

function WeekDateBar({
  selected, onChange, conditionMap = {},
}: {
  selected: string
  onChange: (d: string) => void
  conditionMap?: Record<string, number>
}) {
  const { t } = useTranslation()
  const { colors, scheme } = useTheme()
  const shadowColor = scheme === 'dark' ? 'transparent' : 'rgba(255,255,255,0.9)'
  const todayISO = getTodayISO()  // レンダー時に毎回生成（日付またぎ対応）
  // 過去10日〜未来3日まで表示（左にスクロールすると過去の日付も見える）
  const PAST_DAYS = 10
  const FUTURE_DAYS = 3
  const CELL_W = 56  // paddingHorizontal(10*2) + numCircle(32) + gap(4) の概算
  const days = Array.from({ length: PAST_DAYS + FUTURE_DAYS + 1 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - PAST_DAYS + i)
    return d
  })
  const DAY_NAMES = t('home.dayNames', { returnObjects: true }) as unknown as string[]
  const AMBER = '#F5A623'
  const scrollRef = useRef<ScrollView>(null)

  // 初回表示時は「今日の3日前」が先頭に来る位置までスクロール（従来の見え方を維持）
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: (PAST_DAYS - 3) * CELL_W, animated: false })
  }, [])

  // 体調値に応じた色
  const conditionColor = (v: number) => v >= 8 ? '#34C759' : v >= 6 ? AMBER : '#FF6B6B'

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 8, gap: 4 }}
      style={{ marginBottom: 4 }}
    >
      {days.map(d => {
        const iso     = localDateStr(d)
        const isToday = iso === todayISO
        const isSel   = iso === selected
        const cond    = conditionMap[iso]
        const dayName = DAY_NAMES[d.getDay()]
        const dayNum  = d.getDate()

        return (
          <TouchableOpacity
            key={iso}
            onPress={() => { Sounds.tap(); onChange(iso) }}
            style={wb.cell}
            activeOpacity={0.8}
          >
            <Text style={[wb.dayName, { color: colors.textSec, textShadowColor: shadowColor }, isToday && { color: AMBER }]}>{dayName}</Text>
            <View style={[
              wb.numCircle,
              isSel && { backgroundColor: BRAND },
              isToday && !isSel && { borderWidth: 1.5, borderColor: AMBER },
            ]}>
              <Text style={[wb.numText, { color: colors.text, textShadowColor: shadowColor }, isSel && { color: '#fff', fontWeight: '900' }]}>{dayNum}</Text>
            </View>
            {/* 体調入力済みインジケーター */}
            {cond != null ? (
              <View style={[wb.dot, { backgroundColor: conditionColor(cond) }]} />
            ) : (
              <View style={wb.dotEmpty} />
            )}
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

const wb = StyleSheet.create({
  cell:      { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, gap: 3 },
  // イラスト背景の上でも読めるよう、白のテキストシャドウでコントラストを補強
  dayName:   {
    color: '#4b5563', fontSize: 11, fontWeight: '700',
    textShadowColor: 'rgba(255,255,255,0.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 4,
  },
  numCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  numText:   {
    color: '#111827', fontSize: 14, fontWeight: '800',
    textShadowColor: 'rgba(255,255,255,0.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 4,
  },
  dot:       { width: 5, height: 5, borderRadius: 3 },
  dotEmpty:  { width: 5, height: 5 },
})

// ────────────────────────────────────────────────────────
// LevelBadge — ヘッダー右側のレベル表示
// ────────────────────────────────────────────────────────
function LevelBadge({ sessionCount }: { sessionCount: number }) {
  const { language } = useLanguage()
  const { colors } = useTheme()
  const info = calcLevelInfo(sessionCount, language)
  return (
    <View style={lb.wrap}>
      <Text style={lb.emoji}>{info.emoji}</Text>
      <View>
        <Text style={lb.lv}>Lv.{info.level} <Text style={[lb.title, { color: colors.textSec }]}>{info.title}</Text></Text>
        <View style={[lb.barBg, { backgroundColor: colors.border }]}>
          <View style={[lb.barFill, { width: `${Math.round(info.progress * 100)}%` as any }]} />
        </View>
      </View>
    </View>
  )
}
const lb = StyleSheet.create({
  wrap:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: BRAND + '12', borderRadius: 20, borderWidth: 1, borderColor: BRAND + '30' },
  emoji:  { fontSize: 16 },
  lv:     { color: BRAND, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  title:  { color: '#6b7280', fontWeight: '600' },
  barBg:  { height: 3, width: 60, backgroundColor: 'rgba(0,0,0,0.10)', borderRadius: 2, marginTop: 2 },
  barFill:{ height: 3, backgroundColor: BRAND, borderRadius: 2 },
})

// ────────────────────────────────────────────────────────
// ScoreOverviewCard — W3スタイル INJURY RISK SCORE
// ────────────────────────────────────────────────────────
function buildRiskCfg(t: (key: string) => string) {
  return [
    { max: 24,  color: BRAND,     label: t('home.risk.tiers.low.label'),     phrase: t('home.risk.tiers.low.phrase'),     note: t('home.risk.tiers.low.note') },
    { max: 49,  color: '#f59e0b', label: t('home.risk.tiers.caution.label'), phrase: t('home.risk.tiers.caution.phrase'), note: t('home.risk.tiers.caution.note') },
    { max: 74,  color: '#f97316', label: t('home.risk.tiers.warning.label'), phrase: t('home.risk.tiers.warning.phrase'), note: t('home.risk.tiers.warning.note') },
    { max: 100, color: ALERT,     label: t('home.risk.tiers.high.label'),    phrase: t('home.risk.tiers.high.phrase'),    note: t('home.risk.tiers.high.note') },
  ]
}

// hexカラーを明るく/暗くする（グラデーション用）
function shadeColor(hex: string, percent: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + Math.round(255 * percent)))
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + Math.round(255 * percent)))
  const b = Math.min(255, Math.max(0, (n & 0xff) + Math.round(255 * percent)))
  return `rgb(${r}, ${g}, ${b})`
}

// リング型ゲージ（中央に数値）
function RiskRing({ score, color, trackColor, size = 132 }: { score: number; color: string; trackColor: string; size?: number }) {
  const { colors } = useTheme()
  const so = useMemo(() => makeSoStyles(colors), [colors])
  const strokeWidth = 18
  const gradId = `riskRingGrad-${color.replace('#', '')}`
  const r = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * r
  const pct = Math.min(100, Math.max(0, score)) / 100
  const dashOffset = circumference * (1 - pct)

  // 外周の目盛りドット（12個）
  const tickCount  = 12
  const tickRadius = size / 2 - 2
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const angle = (i / tickCount) * 2 * Math.PI - Math.PI / 2
    return {
      cx: size / 2 + tickRadius * Math.cos(angle),
      cy: size / 2 + tickRadius * Math.sin(angle),
    }
  })

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={shadeColor(color, 0.18)} />
            <Stop offset="100%" stopColor={shadeColor(color, -0.12)} />
          </LinearGradient>
        </Defs>
        {ticks.map((t, i) => (
          <Circle key={i} cx={t.cx} cy={t.cy} r={1.4} fill={trackColor} />
        ))}
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Text style={[so.scoreNum, { fontSize: 44, lineHeight: 48 }]}>{score}</Text>
    </View>
  )
}

function ScoreOverviewCard({
  sessions, sleepRecords, conditionLevel, riskResult,
  effectiveRiskScore, weatherBonus, onStretchStart,
  onRefreshWeather, weatherLoading, onPressBreakdown,
}: {
  sessions: import('../../types').TrainingSession[]
  sleepRecords: import('../../types').SleepRecord[]
  conditionLevel: number
  riskResult: ReturnType<typeof calcInjuryRisk> | null
  effectiveRiskScore?: number
  weatherBonus?: number
  onStretchStart?: () => void
  onRefreshWeather?: () => void
  weatherLoading?: boolean
  onPressBreakdown?: () => void
}) {
  const { colors } = useTheme()
  const so = useMemo(() => makeSoStyles(colors), [colors])
  const { t } = useTranslation()
  const riskScore = effectiveRiskScore ?? (riskResult ? riskResult.riskScore : 0)
  const RISK_CFG = buildRiskCfg(t)
  const cfg = RISK_CFG.find(c => riskScore <= c.max) ?? RISK_CFG[3]

  return (
    <>
      {/* ── INJURY RISK SCORE カード（コンパクト版・タップで内訳） ── */}
      <TutorialSpot spotKey="home_risk_card">
      <PressableScale
        onPress={onPressBreakdown}
        haptic={onPressBreakdown ? 'light' : 'none'}
        scaleAmount={0.97}
        sound="tap"
        style={[so.card, { backgroundColor: colors.surface }]}
      >
        <View style={{ width: '100%' }}>
          {/* ヘッダー行：盾アイコン＋タイトル＋詳細 */}
          <View style={so.riskHeaderRow}>
            <View style={[so.riskIconWrap, { backgroundColor: cfg.color + '14' }]}>
              <Ionicons name="shield-checkmark" size={14} color={cfg.color} />
            </View>
            <Text style={so.heroTitle}>{t('home.risk.cardTitle')}</Text>
            <View style={{ flex: 1 }} />
            {!!onPressBreakdown && (
              <View style={so.detailBtn}>
                <Text style={so.detailBtnText}>{t('home.risk.detail')}</Text>
                <Ionicons name="chevron-forward" size={13} color={colors.textHint} />
              </View>
            )}
          </View>

          {/* 数値＋区切り線＋バッジ/メッセージ */}
          <View style={so.riskMainRow}>
            <View style={so.riskScoreWrap}>
              <View style={[so.riskDot, { backgroundColor: cfg.color }]} />
              <Text style={so.riskScoreNum}>{riskScore}</Text>
              <Text style={so.riskScoreMax}>/100</Text>
            </View>
            <View style={so.riskDivider} />
            <View style={{ flex: 1 }}>
              <View style={[so.riskBadge, { backgroundColor: cfg.color + '18', borderColor: cfg.color + '40' }]}>
                <Text style={[so.riskBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
              </View>
              <Text style={so.riskMessage} numberOfLines={2}>{cfg.note}</Text>
              {!!weatherBonus && (
                <Text style={[so.weatherPt, { marginTop: 2 }]}>{t('home.risk.weather')} {weatherBonus > 0 ? '+' : ''}{weatherBonus}</Text>
              )}
            </View>
          </View>

          {/* フラット塗りつぶしスケールバー（低〜中〜高の目盛り・現在値まで単色塗り） */}
          <View>
            <View style={so.scaleLabelsRow}>
              <Text style={so.scaleLabel}>{t('home.risk.scaleLow')}</Text>
              <Text style={so.scaleLabel}>{t('home.risk.scaleMid')}</Text>
              <Text style={so.scaleLabel}>{t('home.risk.scaleHigh')}</Text>
            </View>
            <View style={so.scaleBarTrack}>
              <View style={[so.scaleFill, { width: `${Math.min(100, Math.max(0, riskScore))}%`, backgroundColor: cfg.color }]} />
              <View style={[so.scaleTick, { left: '25%' }]} />
              <View style={[so.scaleTick, { left: '50%' }]} />
              <View style={[so.scaleTick, { left: '75%' }]} />
            </View>
            <View style={so.scaleLabelsRow}>
              <Text style={so.scaleNumLabel}>0</Text>
              <Text style={so.scaleNumLabel}>50</Text>
              <Text style={so.scaleNumLabel}>100</Text>
            </View>
          </View>
        </View>
      </PressableScale>
      </TutorialSpot>

      {/* ── ストレッチバナー（リスク40以上 or チュートリアル中は常時表示） ── */}
      {(riskScore >= 40 || !!onStretchStart) && onStretchStart && (
        <TutorialSpot spotKey="home_stretch_banner">
        <PressableScale
          onPress={onStretchStart}
          haptic="medium"
          sound="whoosh"
          scaleAmount={0.97}
          style={[so.stretchBanner, { backgroundColor: colors.surface }]}
        >
          <View style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={so.stretchIconWrap}>
              <Ionicons name="body-outline" size={22} color={BRAND} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={so.stretchLabel} numberOfLines={1}>{t('home.stretchBanner.today')}</Text>
              <Text style={[so.stretchText, { color: colors.text }]} numberOfLines={1}>{t('home.stretchBanner.title')}</Text>
              <Text style={[so.stretchGain, { color: BRAND }]} numberOfLines={1}>{t('home.stretchBanner.gain')}</Text>
            </View>
            <View style={so.stretchBtn}>
              <Text style={so.stretchBtnText}>{t('home.stretchBanner.start')}</Text>
              <Ionicons name="chevron-forward" size={14} color="#fff" />
            </View>
          </View>
        </PressableScale>
        </TutorialSpot>
      )}
    </>
  )
}

const makeSoStyles = (colors: ThemeColors) => StyleSheet.create({
  // メインカード — Apple UI Skills準拠（21pxスケール角丸・1pxボーダー・淡い影）
  card: {
    borderRadius: 24, paddingVertical: 18, paddingHorizontal: 16,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.09, shadowRadius: 18, elevation: 5,
  },
  heroTitle:     { fontSize: 15, fontWeight: '700', color: colors.text },
  cardHeader:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  riskLabel:     { fontSize: 22, fontWeight: '700', letterSpacing: 0.2, color: colors.text },
  riskBadge:     { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 21, paddingHorizontal: 12, paddingVertical: 4, alignSelf: 'flex-start' },
  riskDot:       { width: 9, height: 9, borderRadius: 5, marginRight: 6 },
  riskBadgeText: { fontSize: 11, fontWeight: '700' },
  scoreNum:      { fontSize: 72, fontWeight: '700', letterSpacing: -3, color: colors.text, lineHeight: 80, marginVertical: 2, fontVariant: ['tabular-nums'] },
  weatherPt:     { fontSize: 12, color: colors.textSec, fontWeight: '400' },
  barTrack:      { height: 4, borderRadius: 2, overflow: 'hidden' },
  barFill:       { height: 4, borderRadius: 2 },
  // ── 怪我リスクカード（コンパクト版・上下幅を詰めたレイアウト） ──
  riskHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  riskIconWrap:  { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginRight: 7 },
  detailBtn:     { flexDirection: 'row', alignItems: 'center' },
  detailBtnText: { fontSize: 12.5, fontWeight: '600', color: colors.textHint, marginRight: 1 },
  riskMainRow:   { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10 },
  riskScoreWrap: { flexDirection: 'row', alignItems: 'baseline' },
  riskScoreNum:  { fontSize: 38, fontWeight: '800', color: colors.text, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  riskScoreMax:  { fontSize: 14, fontWeight: '600', color: colors.textHint, marginLeft: 1 },
  riskDivider:   { width: 1, height: 32, backgroundColor: colors.border },
  riskMessage:   { fontSize: 12.5, fontWeight: '500', color: colors.textSec, marginTop: 4, lineHeight: 16 },
  scaleLabelsRow:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  scaleLabel:      { fontSize: 10.5, fontWeight: '600', color: colors.textHint },
  scaleNumLabel:   { fontSize: 10, fontWeight: '400', color: colors.textHint },
  scaleBarTrack:   { height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: 'hidden' },
  scaleFill:       { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3 },
  scaleTick:       { position: 'absolute', top: 0, bottom: 0, width: 1.5, marginLeft: -0.75, backgroundColor: colors.border },
  // 4ステータス（カード内埋め込み 2×2）
  statInline:      { width: 64, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center', gap: 4, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  statInlineVal:   { fontSize: 16, fontWeight: '700', letterSpacing: -0.5, color: colors.text, fontVariant: ['tabular-nums'] },
  statInlineLabel: { fontSize: 9, fontWeight: '400', color: colors.textSec },
  // ストレッチバナー（アイコン＋2行テキスト＋ピルCTA）
  stretchBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12, marginTop: 8,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 3,
  },
  stretchIconWrap: { width: 44, height: 44, borderRadius: 14, backgroundColor: BRAND + '14', alignItems: 'center', justifyContent: 'center' },
  stretchLabel:  { fontSize: 11, fontWeight: '600', color: colors.textHint },
  stretchText:   { fontSize: 13, fontWeight: '500' },
  stretchGain:   { fontSize: 14, fontWeight: '800' },
  stretchBtn:    { flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: BRAND },
  stretchBtnText:{ color: '#fff', fontSize: 12.5, fontWeight: '700' },
})


// ────────────────────────────────────────────────────────
// ConditionRow — コンパクトな体調入力
// ────────────────────────────────────────────────────────
function ConditionRow({ value, onChange, dateLabel }: { value: number; onChange: (v: number) => void; dateLabel?: string }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const CONDITION_EMOJIS = buildConditionEmojis(t)
  const selected = CONDITION_EMOJIS.findIndex(e => e.value === value)
  return (
    <View style={cr.row}>
      <Text style={[cr.label, { color: colors.textHint }]}>{dateLabel ?? t('home.conditionCardDefaultLabel')}</Text>
      <View style={cr.emojis}>
        {CONDITION_EMOJIS.map((e, i) => (
          <TouchableOpacity
            key={e.value}
            onPress={() => { unlockAudio(); Sounds.pop(); onChange(e.value) }}
            style={[cr.btn, i === selected && { backgroundColor: colors.surface2, borderColor: colors.border }]}
            activeOpacity={0.7}
          >
            <Text style={[cr.emoji, i !== selected && { opacity: 0.4 }]}>{e.emoji}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}
const cr = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label:     { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  emojis:    { flexDirection: 'row', gap: 4 },
  btn:       { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  emoji:     { fontSize: 22 },
})

// ────────────────────────────────────────────────────────
// TasksCard — 改善タスク（チェックリスト）
// ────────────────────────────────────────────────────────
function TasksCard({
  tasks, onToggle,
}: {
  tasks: ImprovementTask[]
  onToggle: (id: string) => void
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const pending = tasks.filter(t => !t.completed)
  if (pending.length === 0) return null

  return (
    <GlassCard>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Text style={{ fontSize: 14 }}>✅</Text>
        <Text style={[tk.title, { color: colors.text }]}>{t('home.improvementTasksTitle')}</Text>
        <View style={tk.badge}>
          <Text style={tk.badgeText}>{pending.length}</Text>
        </View>
      </View>
      {pending.slice(0, 5).map((task, idx) => (
        <TouchableOpacity
          key={task.id}
          onPress={() => { unlockAudio(); Sounds.pop(); onToggle(task.id) }}
          activeOpacity={0.7}
          style={[tk.row, idx > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
        >
          <View style={[tk.check, { borderColor: colors.border }]}>
            {task.completed && <Ionicons name="checkmark" size={12} color={NEON.green} />}
          </View>
          <Text style={[tk.text, { color: colors.text }]}>{task.text}</Text>
        </TouchableOpacity>
      ))}
    </GlassCard>
  )
}
const tk = StyleSheet.create({
  title:     { fontSize: 13, fontWeight: '800', flex: 1 },
  badge:     { backgroundColor: BRAND, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  row:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  check:     { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  text:      { fontSize: 13, lineHeight: 18, flex: 1 },
})

// ────────────────────────────────────────────────────────
// DeadlinePicker — インラインカレンダー式期日選択
// ────────────────────────────────────────────────────────
function DeadlinePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const { language } = useLanguage()
  const DOW = t('home.dayNames', { returnObjects: true }) as unknown as string[]
  const today = new Date()
  today.setHours(0,0,0,0)

  const initMonth = value ? new Date(value + 'T00:00:00') : new Date()
  const [viewYear,  setViewYear]  = useState(initMonth.getFullYear())
  const [viewMonth, setViewMonth] = useState(initMonth.getMonth())

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  // カレンダーグリッドの日付を生成
  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // 6行に揃える
  while (cells.length % 7 !== 0) cells.push(null)

  function toISO(day: number) {
    const m = String(viewMonth + 1).padStart(2, '0')
    const d = String(day).padStart(2, '0')
    return `${viewYear}-${m}-${d}`
  }

  const selectedISO = value

  return (
    <View style={[dp.wrap, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
      {/* ── 月ナビ ── */}
      <View style={dp.nav}>
        <TouchableOpacity onPress={prevMonth} style={dp.navBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={colors.text} />
        </TouchableOpacity>
        <Text style={[dp.navTitle, { color: colors.text }]}>
          {language === 'ja'
            ? `${viewYear}年 ${viewMonth + 1}月`
            : new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </Text>
        <TouchableOpacity onPress={nextMonth} style={dp.navBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-forward" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* ── 曜日ヘッダー ── */}
      <View style={dp.row}>
        {DOW.map((d, i) => (
          <Text key={d} style={[dp.dowCell, { color: i === 0 ? '#FF6B6B' : i === 6 ? '#5AC8FA' : colors.textHint }]}>{d}</Text>
        ))}
      </View>

      {/* ── 日付グリッド ── */}
      {Array.from({ length: cells.length / 7 }, (_, row) => (
        <View key={row} style={dp.row}>
          {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
            if (!day) return <View key={col} style={dp.cell} />
            const iso = toISO(day)
            const isSelected = iso === selectedISO
            const isPast = new Date(iso + 'T00:00:00') < today
            const isToday = iso === localDateStr(today)
            const isSun = col === 0, isSat = col === 6
            return (
              <TouchableOpacity
                key={col}
                onPress={() => onChange(isSelected ? '' : iso)}
                disabled={isPast}
                style={[dp.cell, isSelected && { backgroundColor: BRAND, borderRadius: 20 }]}
                activeOpacity={0.7}
              >
                <Text style={[
                  dp.dayText,
                  { color: isPast ? colors.textHint : isSun ? '#FF6B6B' : isSat ? '#5AC8FA' : colors.text },
                  isSelected && { color: '#fff', fontWeight: '900' },
                  isToday && !isSelected && { color: BRAND, fontWeight: '800' },
                  isPast && { opacity: 0.3 },
                ]}>{day}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      ))}

      {/* 選択済み表示 + クリアボタン */}
      {value ? (
        <View style={dp.selectedRow}>
          <Text style={{ color: BRAND, fontSize: 12, fontWeight: '700' }}>📅 {value}</Text>
          <TouchableOpacity onPress={() => onChange('')} activeOpacity={0.7}>
            <Text style={{ color: colors.textHint, fontSize: 11 }}>{t('home.datePicker.clear')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={{ color: colors.textHint, fontSize: 11, textAlign: 'center', paddingVertical: 4 }}>{t('home.datePicker.selectHint')}</Text>
      )}
    </View>
  )
}

const dp = StyleSheet.create({
  wrap:        { borderWidth: 1, borderRadius: 14, padding: 10, marginBottom: 14, gap: 4 },
  nav:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 4 },
  navBtn:      { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  navTitle:    { fontSize: 14, fontWeight: '800' },
  row:         { flexDirection: 'row' },
  dowCell:     { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700', paddingVertical: 4 },
  cell:        { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center' },
  dayText:     { fontSize: 13, fontWeight: '600' },
  selectedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, paddingHorizontal: 4 },
})

// ────────────────────────────────────────────────────────
// GoalCard — 目標 + タスク管理
// ────────────────────────────────────────────────────────
function GoalCard({
  goals,
  onUpdate,
}: {
  goals: Goal[]
  onUpdate: (goals: Goal[]) => void
}) {
  const { colors } = useTheme()
  const gc = useMemo(() => makeGcStyles(colors), [colors])
  const { t } = useTranslation()
  const [showModal,     setShowModal]     = useState(false)
  const [editGoal,      setEditGoal]      = useState<Goal | null>(null)
  const [inputText,     setInputText]     = useState('')
  const [inputDeadline, setInputDeadline] = useState('')
  const [editTasks,     setEditTasks]     = useState<GoalTask[]>([])
  const [newTaskText,   setNewTaskText]   = useState('')
  const [showAchieved,  setShowAchieved]  = useState(false)
  const [expandedId,    setExpandedId]    = useState<string | null>(null)
  const [confettiGoalId, setConfettiGoalId] = useState<string | null>(null)
  const [longPressGoalId, setLongPressGoalId] = useState<string | null>(null)
  const longPressProgress = useRef(new Animated.Value(0)).current
  const longPressAnim = useRef<Animated.CompositeAnimation | null>(null)

  // confetti パーティクル
  const PARTICLES = 18
  const particleAnims = useRef(
    Array.from({ length: PARTICLES }, () => ({
      x:  new Animated.Value(0),
      y:  new Animated.Value(0),
      op: new Animated.Value(0),
      rot: new Animated.Value(0),
      scale: new Animated.Value(0),
    }))
  ).current
  const EMOJIS = ['🏆','⭐','✨','🎉','🎊','💫','🌟','🔥']

  function triggerConfetti(goalId: string) {
    setConfettiGoalId(goalId)
    particleAnims.forEach((p, i) => {
      const angle = (i / PARTICLES) * Math.PI * 2
      const dist  = 60 + Math.random() * 80
      p.x.setValue(0); p.y.setValue(0); p.op.setValue(1); p.rot.setValue(0); p.scale.setValue(0)
      Animated.parallel([
        Animated.timing(p.x,     { toValue: Math.cos(angle) * dist,   duration: 900, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
        Animated.timing(p.y,     { toValue: Math.sin(angle) * dist - 40, duration: 900, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
        Animated.timing(p.scale, { toValue: 1,    duration: 200, useNativeDriver: true }),
        Animated.timing(p.rot,   { toValue: 2,    duration: 900, useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(500),
          Animated.timing(p.op, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]),
      ]).start()
    })
    setTimeout(() => setConfettiGoalId(null), 1200)
  }

  function startLongPress(goalId: string) {
    setLongPressGoalId(goalId)
    longPressProgress.setValue(0)
    longPressAnim.current = Animated.timing(longPressProgress, {
      toValue: 1, duration: 700, useNativeDriver: false,
    })
    longPressAnim.current.start(({ finished }) => {
      if (finished) {
        achieveGoal(goalId)
        setLongPressGoalId(null)
        longPressProgress.setValue(0)
      }
    })
  }

  function cancelLongPress() {
    longPressAnim.current?.stop()
    setLongPressGoalId(null)
    longPressProgress.setValue(0)
  }

  function achieveGoal(goalId: string) {
    onUpdate(goals.map(g => g.id === goalId ? { ...g, progress: 100, achieved: true } : g))
    triggerConfetti(goalId)
  }

  const active   = goals.filter(g => !g.achieved)
  const achieved = goals.filter(g => g.achieved)

  // タスク完了数からprogress自動計算
  function calcProgress(tasks: GoalTask[]): number {
    if (tasks.length === 0) return 0
    return Math.round((tasks.filter(t => t.done).length / tasks.length) * 100)
  }

  function openAdd() {
    setEditGoal(null)
    setInputText('')
    setInputDeadline('')
    setEditTasks([])
    setNewTaskText('')
    setShowModal(true)
  }

  function openEdit(g: Goal) {
    setEditGoal(g)
    setInputText(g.text)
    setInputDeadline(g.deadline ?? '')
    setEditTasks(g.tasks ? [...g.tasks] : [])
    setNewTaskText('')
    setShowModal(true)
  }

  function addTask() {
    if (!newTaskText.trim()) return
    setEditTasks(prev => [...prev, { id: `task-${Date.now()}`, text: newTaskText.trim(), done: false }])
    setNewTaskText('')
  }

  function toggleEditTask(id: string) {
    setEditTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t))
  }

  function removeTask(id: string) {
    setEditTasks(prev => prev.filter(t => t.id !== id))
  }

  // カード上でタスクを直接チェック（モーダルを開かず）
  function toggleTaskInline(goalId: string, taskId: string) {
    const next = goals.map(g => {
      if (g.id !== goalId) return g
      const tasks = (g.tasks ?? []).map(t => t.id === taskId ? { ...t, done: !t.done } : t)
      return { ...g, tasks, progress: calcProgress(tasks) }
    })
    onUpdate(next)
  }

  function handleSave() {
    if (!inputText.trim()) return
    const progress = editTasks.length > 0 ? calcProgress(editTasks) : 0
    if (editGoal) {
      onUpdate(goals.map(g => g.id === editGoal.id
        ? { ...g, text: inputText.trim(), deadline: inputDeadline || undefined, tasks: editTasks, progress }
        : g))
    } else {
      const newGoal: Goal = {
        id: `goal-${Date.now()}`,
        text: inputText.trim(),
        deadline: inputDeadline || undefined,
        progress: 0,
        achieved: false,
        created_at: new Date().toISOString(),
        tasks: editTasks,
      }
      onUpdate([newGoal, ...goals])
    }
    setShowModal(false)
  }

  function handleDelete() {
    if (!editGoal) return
    onUpdate(goals.filter(g => g.id !== editGoal.id))
    setShowModal(false)
  }

  function handleAchieve() {
    if (!editGoal) return
    onUpdate(goals.map(g => g.id === editGoal.id
      ? { ...g, progress: 100, achieved: true } : g))
    setShowModal(false)
  }

  function progressColor(p: number) {
    if (p >= 100) return '#34C759'
    if (p >= 60)  return '#5AC8FA'
    if (p >= 30)  return '#FF9500'
    return BRAND
  }

  function daysLeft(deadline?: string) {
    if (!deadline) return null
    const d = new Date(deadline.includes('T') ? deadline : deadline + 'T00:00:00')
    const diff = Math.ceil((d.getTime() - Date.now()) / 86400000)
    if (diff < 0)  return { text: t('home.goals.deadlinePassed'), color: '#FF3B30' }
    if (diff === 0) return { text: t('home.goals.dueToday'), color: '#FF9500' }
    return { text: t('home.goals.daysLeft', { n: diff }), color: diff <= 7 ? '#FF9500' : colors.textSec }
  }

  // 目標を立ててから何日経ったか（努力期間の可視化）
  function daysSinceSet(created_at: string): number {
    const d = new Date(created_at)
    d.setHours(0, 0, 0, 0)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86400000))
  }

  return (
    <>
      <View style={[gc.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* ヘッダー */}
        <View style={gc.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 16 }}>🎯</Text>
            <Text style={[gc.title, { color: colors.text }]}>{t('home.goals.title')}</Text>
            {active.length > 0 && (
              <View style={{ backgroundColor: BRAND + '22', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ color: BRAND, fontSize: 10, fontWeight: '800' }}>{t('home.goals.activeCount', { n: active.length })}</Text>
              </View>
            )}
          </View>
          <HapticTouch haptic="whoosh" onPress={openAdd}
            style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' }}
            activeOpacity={0.8}>
            <Ionicons name="add" size={18} color="#fff" />
          </HapticTouch>
        </View>

        {/* 目標リスト */}
        {active.length === 0 ? (
          <TouchableOpacity onPress={openAdd} activeOpacity={0.7} style={gc.emptyRow}>
            <Text style={{ color: colors.textHint, fontSize: 13 }}>{t('home.goals.tapToAdd')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ gap: 12 }}>
            {active.map((g, idx) => {
              const dl       = daysLeft(g.deadline)
              const tasks    = g.tasks ?? []
              const done     = tasks.filter(t => t.done).length
              const total    = tasks.length
              const progress = total > 0 ? calcProgress(tasks) : g.progress
              const col      = progressColor(progress)
              const expanded = expandedId === g.id

              return (
                <View key={g.id} style={[gc.goalBlock, idx > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                  {/* 目標ヘッダー行 */}
                  <TouchableOpacity
                    onPress={() => setExpandedId(expanded ? null : g.id)}
                    activeOpacity={0.75}
                    style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}
                  >
                    <View style={{ flex: 1, gap: 5 }}>
                      {/* タイトル + 期日 */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={[gc.goalText, { color: colors.text }]} numberOfLines={expanded ? 10 : 2}>{g.text}</Text>
                        {dl && <Text style={{ color: dl.color, fontSize: 10, fontWeight: '700', flexShrink: 0 }}>{dl.text}</Text>}
                      </View>

                      {/* タスクカウンター + プログレスバー */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {total > 0 && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: col + '18', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 }}>
                            <Ionicons name="checkmark-circle" size={11} color={col} />
                            <Text style={{ color: col, fontSize: 11, fontWeight: '800' }}>{t('home.goals.taskCount', { done, total })}</Text>
                          </View>
                        )}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Ionicons name="hourglass-outline" size={11} color={colors.textHint} />
                          <Text style={{ color: colors.textHint, fontSize: 11, fontWeight: '700' }}>{t('home.goals.daysSinceSet', { n: daysSinceSet(g.created_at) })}</Text>
                        </View>
                        <View style={[gc.barBg, { flex: 1, backgroundColor: colors.surface2 }]}>
                          <View style={[gc.barFill, { width: `${progress}%` as any, backgroundColor: col }]} />
                        </View>
                        <Text style={{ color: col, fontSize: 11, fontWeight: '800', width: 32, textAlign: 'right' }}>{progress}%</Text>
                      </View>
                    </View>

                    {/* 右側ボタン群 */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {/* 達成ボタン（長押し or onLongPress で達成） */}
                      <View style={{ position: 'relative', alignItems: 'center' }}>
                        {/* 長押し中の進行バー */}
                        <View style={{ width: 52, height: 44, borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
                          <Animated.View style={{
                            position: 'absolute', top: 0, left: 0, bottom: 0,
                            borderRadius: 10,
                            backgroundColor: '#34C75966',
                            width: longPressGoalId === g.id
                              ? longPressProgress.interpolate({ inputRange: [0,1], outputRange: ['0%','100%'] })
                              : '0%',
                          }} />
                          <TouchableOpacity
                            onPressIn={() => startLongPress(g.id)}
                            onPressOut={cancelLongPress}
                            onLongPress={() => { cancelLongPress(); achieveGoal(g.id) }}
                            delayLongPress={600}
                            activeOpacity={0.75}
                            style={{
                              width: 52, height: 44, borderRadius: 10,
                              backgroundColor: 'transparent',
                              borderWidth: 1.5,
                              borderColor: longPressGoalId === g.id ? '#34C759' : colors.border,
                              alignItems: 'center', justifyContent: 'center',
                              gap: 1,
                            }}
                          >
                            <Text style={{ fontSize: 14 }}>🏆</Text>
                            <Text style={{ fontSize: 9, color: longPressGoalId === g.id ? '#34C759' : colors.textSec, fontWeight: '600' }}>
                              {longPressGoalId === g.id ? t('home.goals.achieved') : t('home.goals.longPress')}
                            </Text>
                          </TouchableOpacity>
                        </View>
                        {/* confetti パーティクル */}
                        {confettiGoalId === g.id && particleAnims.map((p, i) => (
                          <Animated.Text
                            key={i}
                            style={{
                              position: 'absolute', top: 8, left: 8,
                              fontSize: 14, opacity: p.op,
                              transform: [
                                { translateX: p.x },
                                { translateY: p.y },
                                { scale: p.scale },
                                { rotate: p.rot.interpolate({ inputRange: [0,2], outputRange: ['0deg','720deg'] }) },
                              ],
                            }}
                          >
                            {EMOJIS[i % EMOJIS.length]}
                          </Animated.Text>
                        ))}
                      </View>
                      {/* 編集ボタン */}
                      <TouchableOpacity
                        onPress={() => openEdit(g)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{ padding: 4 }}
                      >
                        <Ionicons name="create-outline" size={15} color={colors.textHint} />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>

                  {/* タスクリスト（展開時） */}
                  {expanded && total > 0 && (
                    <View style={{ marginTop: 8, gap: 4, paddingLeft: 4 }}>
                      {tasks.map(t => (
                        <TouchableOpacity
                          key={t.id}
                          onPress={() => toggleTaskInline(g.id, t.id)}
                          activeOpacity={0.7}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5 }}
                        >
                          <View style={[gc.checkbox, t.done && { backgroundColor: '#34C759', borderColor: '#34C759' }]}>
                            {t.done && <Ionicons name="checkmark" size={11} color="#fff" />}
                          </View>
                          <Text style={{ color: t.done ? colors.textHint : colors.text, fontSize: 13, flex: 1, textDecorationLine: t.done ? 'line-through' : 'none' }}>
                            {t.text}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {/* タスクなし＋展開済み → タスク追加を促す */}
                  {expanded && total === 0 && (
                    <TouchableOpacity onPress={() => openEdit(g)} activeOpacity={0.7}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingLeft: 4 }}>
                      <Ionicons name="add-circle-outline" size={14} color={BRAND} />
                      <Text style={{ color: BRAND, fontSize: 12, fontWeight: '700' }}>{t('home.goals.addTask')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )
            })}
          </View>
        )}

        {/* 達成済み表示トグル */}
        {achieved.length > 0 && (
          <TouchableOpacity onPress={() => setShowAchieved(v => !v)} style={gc.achievedToggle} activeOpacity={0.7}>
            <Ionicons name={showAchieved ? 'chevron-up' : 'trophy-outline'} size={12} color="#34C759" />
            <Text style={{ color: '#34C759', fontSize: 11, fontWeight: '700' }}>
              {showAchieved ? t('home.goals.hideAchieved') : t('home.goals.showAchieved', { n: achieved.length })}
            </Text>
          </TouchableOpacity>
        )}
        {showAchieved && achieved.map(g => (
          <TouchableOpacity key={g.id} onPress={() => openEdit(g)} activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={{ fontSize: 14 }}>🏆</Text>
            <Text style={{ color: '#34C759', fontSize: 12, fontWeight: '700', flex: 1 }} numberOfLines={1}>{g.text}</Text>
            {(g.tasks?.length ?? 0) > 0 && (
              <Text style={{ color: colors.textSec, fontSize: 10 }}>{g.tasks!.filter(t=>t.done).length}/{g.tasks!.length}</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* ── 編集モーダル ── */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <View style={gc.overlay}>
          <View style={[gc.sheet, { backgroundColor: colors.surface }]}>
            <View style={gc.sheetHeader}>
              <Text style={[gc.sheetTitle, { color: colors.text }]}>{editGoal ? t('home.goals.editTitle') : t('home.goals.addTitle')}</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={22} color={colors.textSec} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* 目標テキスト */}
              <Text style={[gc.label, { color: colors.textSec }]}>{t('home.goals.label')}</Text>
              <TextInput
                value={inputText}
                onChangeText={setInputText}
                placeholder={t('home.goals.textPlaceholder')}
                placeholderTextColor={colors.textHint}
                style={[gc.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface2 }]}
                multiline
              />

              {/* 期日 */}
              <Text style={[gc.label, { color: colors.textSec }]}>{t('home.goals.deadlineLabel')}</Text>
              <DeadlinePicker value={inputDeadline} onChange={setInputDeadline} />

              {/* ─ タスクセクション ─ */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 8 }}>
                <Text style={[gc.label, { color: colors.textSec, marginBottom: 0 }]}>
                  {t('home.goals.tasksLabel')} {editTasks.length > 0 && (
                    <Text style={{ color: BRAND }}>
                      {t('home.goals.tasksCompleted', { done: editTasks.filter(t => t.done).length, total: editTasks.length })}
                    </Text>
                  )}
                </Text>
              </View>

              {/* タスク入力行 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <TextInput
                  value={newTaskText}
                  onChangeText={setNewTaskText}
                  placeholder={t('home.goals.taskInputPlaceholder')}
                  placeholderTextColor={colors.textHint}
                  style={[gc.input, { flex: 1, marginBottom: 0, minHeight: 40 }, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface2 }]}
                  returnKeyType="done"
                  onSubmitEditing={addTask}
                />
                <TouchableOpacity onPress={addTask} style={[gc.stepBtn, { backgroundColor: BRAND, borderColor: BRAND }]} activeOpacity={0.8}>
                  <Ionicons name="add" size={18} color="#fff" />
                </TouchableOpacity>
              </View>

              {/* タスクリスト */}
              {editTasks.length > 0 && (
                <View style={{ gap: 4, marginBottom: 14, backgroundColor: colors.surface2, borderRadius: 12, padding: 10 }}>
                  {/* 全体進捗バー */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <View style={[gc.barBg, { flex: 1, backgroundColor: colors.border }]}>
                      <View style={[gc.barFill, {
                        width: `${calcProgress(editTasks)}%` as any,
                        backgroundColor: progressColor(calcProgress(editTasks)),
                      }]} />
                    </View>
                    <Text style={{ color: progressColor(calcProgress(editTasks)), fontSize: 12, fontWeight: '800', width: 36, textAlign: 'right' }}>
                      {calcProgress(editTasks)}%
                    </Text>
                  </View>

                  {editTasks.map((t, i) => (
                    <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8,
                      paddingVertical: 6, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.border }}>
                      <TouchableOpacity onPress={() => toggleEditTask(t.id)} style={[gc.checkbox, t.done && { backgroundColor: '#34C759', borderColor: '#34C759' }]}>
                        {t.done && <Ionicons name="checkmark" size={11} color="#fff" />}
                      </TouchableOpacity>
                      <Text style={{ flex: 1, fontSize: 13, color: t.done ? colors.textHint : colors.text, textDecorationLine: t.done ? 'line-through' : 'none' }}>
                        {t.text}
                      </Text>
                      <TouchableOpacity onPress={() => removeTask(t.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close-circle" size={16} color={colors.textHint} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* ボタン群 */}
              <HapticTouch haptic="save" style={[gc.saveBtn, !inputText.trim() && { opacity: 0.4 }]}
                onPress={handleSave} disabled={!inputText.trim()} activeOpacity={0.85}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{editGoal ? t('home.goals.save') : t('home.goals.add')}</Text>
              </HapticTouch>

              {editGoal && !editGoal.achieved && (
                <TouchableOpacity style={gc.achieveBtn} onPress={handleAchieve} activeOpacity={0.85}>
                  <Text style={{ fontSize: 16 }}>🏆</Text>
                  <Text style={{ color: '#34C759', fontWeight: '800', fontSize: 14 }}>{t('home.goals.achieved')}</Text>
                </TouchableOpacity>
              )}

              {editGoal && (
                <TouchableOpacity style={gc.deleteBtn} onPress={handleDelete} activeOpacity={0.85}>
                  <Ionicons name="trash-outline" size={15} color="#FF3B30" />
                  <Text style={{ color: '#FF3B30', fontWeight: '700', fontSize: 13 }}>{t('home.goals.delete')}</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  )
}

const makeGcStyles = (colors: ThemeColors) => StyleSheet.create({
  card:          { borderRadius: 18, borderWidth: 1, padding: 12, gap: 6,
                   shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4 },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:         { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  emptyRow:      { paddingVertical: 14, alignItems: 'center' },
  goalBlock:     { paddingVertical: 6, gap: 0 },
  goalText:      { fontSize: 15, fontWeight: '700', flex: 1, lineHeight: 22 },
  barBg:         { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill:       { height: 6, borderRadius: 3 },
  checkbox:      { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  achievedToggle:{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(52,199,89,0.2)' },

  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet:        { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: '88%' },
  sheetHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  sheetTitle:   { fontSize: 17, fontWeight: '800' },
  label:        { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  input:        { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, marginBottom: 14, minHeight: 44 },
  stepBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  saveBtn:      { backgroundColor: BRAND, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 10 },
  achieveBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: '#34C759', borderRadius: 14, paddingVertical: 13, marginBottom: 10 },
  deleteBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
})

// ────────────────────────────────────────────────────────
// DashboardScreen
// ────────────────────────────────────────────────────────
const APP_OPEN_COUNT_KEY = 'score_app_open_count'

export default function DashboardScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const s = useMemo(() => makeStyles(colors), [colors])
  const { t } = useTranslation()
  const { language } = useLanguage()
  const dayNames = t('home.dayNames', { returnObjects: true }) as unknown as string[]
  const { tier: purchaseTier, isNoad: purchaseIsNoad } = usePurchase()
  const { active: tutorialActive, stepId: tutStepId, nextStep: tutNext, onConditionModalClose } = useTutorial()
  const { sessions, loading, fetchSessions } = useTrainingSessions()
  const [appOpenCount,     setAppOpenCount]     = useState(0)
  const [selectedDate,    setSelectedDate]    = useState(getTodayISO())
  const [showQuickLog,    setShowQuickLog]    = useState(false)
  const [showQuickCondition, setShowQuickCondition] = useState(false)
  const [showRiskBreakdown, setShowRiskBreakdown] = useState(false)
  const [conditionMap,    setConditionMap]    = useState<Record<string,number>>({})
  const conditionLevel = conditionMap[selectedDate] ?? 6
  // 今日以外の日付を見ているか（過去/未来の日付タップ時は表示を絞る）
  const isViewingToday = selectedDate === getTodayISO()
  useEffect(() => { setDoneBannerDismissed(false) }, [selectedDate])
  // 選択中の日付を基準にした、直近7日の平均体調（リスク計算用）
  // 日付バーで別の日をタップすると、その日を基準に7日分を遡って計算し直す
  const avgConditionLevel = useMemo(() => {
    const asOf = new Date(selectedDate + 'T12:00:00')
    const vals = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(asOf); d.setDate(d.getDate() - i)
      return conditionMap[localDateStr(d)]
    }).filter((v): v is number => v !== undefined)
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : conditionLevel
  }, [conditionMap, selectedDate, conditionLevel])
  const [sleepRecords,    setSleepRecords]    = useState<SleepRecord[]>([])
  const [recoveryRecords, setRecoveryRecords] = useState<Array<{ date: string }>>([])
  // 選択中の日付を基準に、直近7日以内の違和感・痛み記録があるかを判定
  const hasSymptom = useMemo(() => {
    const sevenDaysAgo = localDateStr(new Date(new Date(selectedDate + 'T12:00:00').getTime() - 7 * 86400000))
    return recoveryRecords.some(r => r.date >= sevenDaysAgo && r.date <= selectedDate)
  }, [recoveryRecords, selectedDate])
  // 今日まだ入力していない項目（ホーム画面トップのCTA用）
  const todayUnfilled = useMemo(() => {
    const today = getTodayISO()
    const items: { key: string; icon: string; label: string; onPress: () => void }[] = []
    if (conditionMap[today] === undefined) {
      items.push({ key: 'condition', icon: '🙂', label: t('home.ctaItems.condition'), onPress: () => setShowQuickCondition(true) })
    }
    if (!sleepRecords.some(r => r.sleep_date === today)) {
      items.push({ key: 'sleep', icon: '😴', label: t('home.ctaItems.sleep'), onPress: () => setShowQuickCondition(true) })
    }
    if (!sessions.some(sess => sess.session_date === today)) {
      items.push({ key: 'practice', icon: '🏃', label: t('home.ctaItems.practice'), onPress: () => setShowQuickLog(true) })
    }
    return items
  }, [conditionMap, sleepRecords, sessions, t])
  const [tasks,           setTasks]           = useState<ImprovementTask[]>([])
  const [goals,           setGoals]           = useState<Goal[]>([])
  const [showAIAdvice,    setShowAIAdvice]    = useState(false)
  const [aiAdvice,        setAiAdvice]        = useState('')
  const [loadingAI,       setLoadingAI]       = useState(false)
  const [insightClaimed,  setInsightClaimed]  = useState<boolean | null>(null)  // null = チェック中
  const [insightLoading,  setInsightLoading]  = useState(false)
  const [ticketGateVisible, setTicketGateVisible] = useState(false)
  const [ticketGateCost,    setTicketGateCost]    = useState(0)
  const [ticketGateBalance, setTicketGateBalance] = useState(0)
  const [weatherBonus,    setWeatherBonus]    = useState(0)
  const [weatherText,     setWeatherText]     = useState<string | null>(null)
  const [weatherLoading,  setWeatherLoading]  = useState(false)
  const [weatherTemp,     setWeatherTemp]     = useState<number | null>(null)
  const [stretchReduction,setStretchReduction]= useState(0)
  const [recoveryBanner,  setRecoveryBanner]  = useState<{ reduction: number } | null>(null)
  const [hydrationReductionPts, setHydrationReductionPts] = useState(0)
  const [hydrationCard,   setHydrationCard]   = useState<{ message: string; showSaltTip: boolean } | null>(null)
  const [teamNotifs,      setTeamNotifs]      = useState<TeamEventRow[]>([])
  const [reviewWallVisible, setReviewWallVisible] = useState(false)
  const [confirmedIds,    setConfirmedIds]    = useState<Set<string>>(new Set())
  const [notifReadIds,    setNotifReadIds]    = useState<Set<string>>(new Set())
  const [shareSession,    setShareSession]    = useState<PracticeShareData | null>(null)
  const [injuryDaysLeft,     setInjuryDaysLeft]     = useState<number | null>(null)
  const [injuryFreeDays,     setInjuryFreeDays]     = useState<number>(0)
  const [compDaysLeft,       setCompDaysLeft]       = useState<{ name: string; days: number } | null>(null)
  const [showCountdownModal, setShowCountdownModal] = useState(false)
  const [igBannerVisible, setIgBannerVisible] = useState(false)
  const [doneBannerDismissed, setDoneBannerDismissed] = useState(false)

  // AdGate async チェック中の二重タップ防止
  const insightCallRef = useRef(false)
  // 2026-09-07: 到達後600msで全画面を自動的に再説明する旧チュートリアルの自動起動を廃止。
  // 未完了ユーザーには <FirstRunChecklist /> が常駐する3項目チェックリストを表示し、
  // 本人が触るタイミングに委ねる（ガイドツアー自体はチェックリストの下部リンクから起動可能）。

  // Instagramバナー：閉じたことがなければ表示
  useEffect(() => {
    AsyncStorage.getItem('score_ig_banner_dismissed').then(v => {
      if (!v) setIgBannerVisible(true)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const TODAY = todayLocalISO()
    AsyncStorage.getItem('score_last_open_tracked').then(last => {
      if (last !== TODAY) {
        trackAppOpen()
        AsyncStorage.setItem('score_last_open_tracked', TODAY).catch(() => {})
        // アプリ起動回数をインクリメント
        AsyncStorage.getItem(APP_OPEN_COUNT_KEY).then(raw => {
          const newCount = (raw ? parseInt(raw, 10) : 0) + 1
          setAppOpenCount(newCount)
          AsyncStorage.setItem(APP_OPEN_COUNT_KEY, String(newCount)).catch(() => {})
        }).catch(() => {})
        // 連続起動日数チェックイン（3/7/30日でチケットボーナス）
        checkInStreak().then(({ bonus }) => {
          if (!bonus) return
          Toast.show({ type: 'success', text1: t('home.toasts.streakBonus'), text2: t('home.toasts.ticketsEarned', { n: bonus.amount }), visibilityTime: 2500 })
        }).catch(() => {})
      } else {
        AsyncStorage.getItem(APP_OPEN_COUNT_KEY).then(raw => {
          setAppOpenCount(raw ? parseInt(raw, 10) : 0)
        }).catch(() => {})
      }
    }).catch(() => {})
  }, [])

  // カウントダウンデータは reloadAll（useFocusEffect）で取得するため個別useEffectは不要

  useEffect(() => {
    AsyncStorage.multiGet([CONDITION_MAP_KEY, CONDITION_KEY]).then(([[, mapStr], [, oldVal]]) => {
      if (mapStr) {
        try { setConditionMap(JSON.parse(mapStr)) } catch {}
      } else if (oldVal) {
        const migrated = { [getTodayISO()]: Number(oldVal) }
        setConditionMap(migrated)
        AsyncStorage.setItem(CONDITION_MAP_KEY, JSON.stringify(migrated)).catch(() => {})
      }
    }).catch(() => {})
  }, [])

  // ── 天気：キャッシュを即反映するヘルパー ──────────────────────────────────
  const applyWeather = useCallback((w: import('../../lib/weather').WeatherData) => {
    const bonus = calcWeatherRiskBonus(w)
    setWeatherBonus(bonus)
    setWeatherText(getWeatherRiskText(w, bonus))
    setWeatherTemp(w.temp)
  }, [])

  // ── 天気取得（1日1回のみAPI呼び出し、それ以外はキャッシュ）────────────────
  const fetchWeather = useCallback(async (forceRefresh = false) => {
    setWeatherLoading(true)
    try {
      if (forceRefresh) await clearWeatherCache()
      const w = await getCachedWeather()
      if (w) applyWeather(w)
    } catch {}
    finally { setWeatherLoading(false) }
  }, [applyWeather])

  // 起動直後：キャッシュがあれば遅延なしで即表示 → その後バックグラウンドで更新チェック
  useEffect(() => {
    // ① まずキャッシュのみ即読み（画面が開いた瞬間に表示）
    getWeatherCacheOnly().then(w => { if (w) applyWeather(w) }).catch(() => {})
    // ② 600ms後にAPI or キャッシュ有効期限チェック（当日まだ未取得なら取得）
    const t = setTimeout(() => fetchWeather(), 600)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 今日獲得済みの水分補給軽減ptを起動時に読み込む（バナー表示有無に関わらずスコアに反映）
  useEffect(() => {
    getHydrationReductionPts().then(setHydrationReductionPts).catch(() => {})
  }, [])

  // 水分補給リマインダー：気温・今日の練習強度が揃った時点で表示要否を判定
  const todaySessionTypes = useMemo(
    () => sessions.filter(s => s.session_date === getTodayISO()).map(s => s.session_type),
    [sessions],
  )
  useEffect(() => {
    if (loading === 'loading' || loading === 'idle') return
    if (weatherTemp === null) return
    if (hydrationCard) return
    getHydrationEligibility(weatherTemp, todaySessionTypes).then(elig => {
      if (elig.show) {
        setHydrationCard({ message: elig.message, showSaltTip: elig.showSaltTip })
        markHydrationShown().catch(() => {})
      }
    }).catch(() => {})
  }, [loading, weatherTemp, todaySessionTypes, hydrationCard])

  const handleHydrationPress = useCallback(async () => {
    setHydrationCard(null)
    const { pressCount, reductionPts } = await logHydrationPress()
    setHydrationReductionPts(reductionPts)
    Toast.show({ type: 'success', text1: t('home.toasts.hydration'), text2: t('home.toasts.hydrationCount', { n: pressCount }) })
  }, [])

  // レビューウォール：起動5回目以降に表示（4秒後に）
  // チュートリアル中・広告/告知バナー表示中（isAnyAdShowing。LINE/コーチのお知らせバナーも
  // 同じ<Modal>ネイティブpresentationなのでここに含まれる）は表示しない（複数の Modal/native広告が
  // 同時に present されると、片方を閉じてももう片方の presentation が残って
  // 画面全体がタップ無反応になることがあるため、必ず1つずつ表示する）
  useEffect(() => {
    if (tutorialActive) return
    const t = setTimeout(async () => {
      try {
        if (tutorialActive || isAnyAdShowing()) return
        const show = await shouldShowReviewWall()
        if (show) setReviewWallVisible(true)
      } catch {}
    }, 4000)
    return () => clearTimeout(t)
  }, [tutorialActive])

  // 2026-09-07: 起動6秒後の自動チケットプラン案内は廃止。
  // 代わりに「登録からN日後」ではなく利用実績で条件ゲートするDay3/Day5導線に切り替えた
  // （詳細: sCORE_課金タイミング設計_Day0-7.md）。判定条件: コンディション記録3回＋
  // 初回スコア閲覧＋練習or睡眠記録1回以上。起動のたびに軽くチェックするだけなので
  // タイマーは使わず、データ読み込み後に1回だけ判定する。
  // 2026-09-07 追記: 当初は小さいモーダルで一度ワンクッション挟む設計だったが、
  // 「小さいモーダルじゃなくて最初からデカく出していい」というフィードバックを受け、
  // 中間モーダルは廃止し、条件を満たしたら直接 /paywall（チケット月額プラン比較画面）へ遷移する。
  useEffect(() => {
    if (loading || purchaseTier !== 'free' || tutorialActive || reviewWallVisible || isAnyAdShowing()) return
    let cancelled = false
    ;(async () => {
      try {
        const conditionRecordCount = Object.keys(conditionMap).length
        const hasPracticeOrSleepLog = sessions.length > 0 || sleepRecords.length > 0
        const gateInput = { conditionRecordCount, hasPracticeOrSleepLog, isFreeTier: true }

        if (await shouldShowDay3Offer(gateInput)) {
          if (cancelled) return
          await markDay3OfferShown()
          trackPaywallView('day3_offer:day3')
          router.push('/paywall?plan=ticket_monthly')
          return
        }
        if (await shouldShowDay5Offer(true)) {
          if (cancelled) return
          await markDay5OfferShown()
          trackPaywallView('day3_offer:day5')
          router.push('/paywall?plan=ticket_monthly')
          return
        }

        // Day7: 直近7日の記録が半分(4日)以上ある未課金ユーザーに週次レポートを提示
        // （lib/weeklyReport.ts）。noad+ユーザーは既存のapp/growth-report.tsxで
        // いつでもより詳しいレポートを見られるため、この軽量版は無料ユーザー限定。
        const weeklyTrend = computeWeeklyTrend(sessions, sleepRecords, conditionMap)
        if (await shouldShowWeeklyReport(weeklyTrend)) {
          if (cancelled) return
          router.push('/weekly-report' as any)
        }
      } catch { /* 判定失敗時は出さない（サイレント） */ }
    })()
    return () => { cancelled = true }
  }, [loading, purchaseTier, tutorialActive, reviewWallVisible, conditionMap, sessions, sleepRecords])

  function handleGoalsUpdate(next: Goal[]) {
    // 初めて目標を設定したらチケットボーナス（goals は更新前の件数を参照するためクロージャで判定）
    if (goals.length === 0 && next.length > 0) {
      grantFirstGoalBonusIfNeeded().then(({ granted }) => {
        if (granted) Toast.show({ type: 'success', text1: t('home.toasts.firstGoalBonus') })
      }).catch(() => {})
    }
    setGoals(next)
    AsyncStorage.setItem(GOALS_KEY, JSON.stringify(next)).catch(() => {})
  }

  const reloadAll = useCallback(() => {
    // カウントダウンデータ（怪我・試合）
    const todayMs = (() => { const d = new Date(); d.setHours(0,0,0,0); return d })()
    AsyncStorage.getItem('trackmate_injury_records').then(raw => {
      if (!raw) { setInjuryDaysLeft(null); setInjuryFreeDays(0); return }
      try {
        const recs = JSON.parse(raw) as Array<{ status: string; startDate: string; totalDays: number; createdAt?: string }>
        const active = recs.find(r => r.status === 'active')
        if (active) {
          const start = new Date(active.startDate); start.setHours(0,0,0,0)
          const elapsed = Math.floor((todayMs.getTime() - start.getTime()) / 86400000)
          setInjuryDaysLeft(Math.max(0, active.totalDays - elapsed))
          setInjuryFreeDays(0)
        } else {
          setInjuryDaysLeft(null)
          const completed = recs.filter(r => r.status === 'completed')
          if (completed.length > 0) {
            const last = completed.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0]
            const endDate = new Date(last.startDate); endDate.setDate(endDate.getDate() + last.totalDays); endDate.setHours(0,0,0,0)
            setInjuryFreeDays(Math.max(0, Math.floor((todayMs.getTime() - endDate.getTime()) / 86400000)))
          } else { setInjuryFreeDays(0) }
        }
      } catch { setInjuryDaysLeft(null); setInjuryFreeDays(0) }
    }).catch(() => { setInjuryDaysLeft(null); setInjuryFreeDays(0) })
    AsyncStorage.getItem('trackmate_competitions').then(raw => {
      if (!raw) { setCompDaysLeft(null); return }
      try {
        const all = JSON.parse(raw) as Array<{ competition_name: string; competition_date: string }>
        const todayStr = localDateStr(todayMs)
        const upcoming = all.filter(c => c.competition_date >= todayStr).sort((a,b) => a.competition_date.localeCompare(b.competition_date))[0]
        if (!upcoming) { setCompDaysLeft(null); return }
        const compDate = new Date(upcoming.competition_date); compDate.setHours(0,0,0,0)
        setCompDaysLeft({ name: upcoming.competition_name, days: Math.ceil((compDate.getTime() - todayMs.getTime()) / 86400000) })
      } catch { setCompDaysLeft(null) }
    }).catch(() => { setCompDaysLeft(null) })
    fetchSessions('')
    // ストレッチ結果読み込み
    const today = todayLocalISO()
    getStretchResult().then(parsed => {
      if (parsed.date !== today) { setStretchReduction(0); return }
      setStretchReduction(parsed.reduction ?? 0)
      if (parsed.showBanner) {
        setRecoveryBanner({ reduction: parsed.lastReduction ?? parsed.reduction })
        updateStretchResult(cur => ({ ...cur, showBanner: false })).catch(() => {})
      }
    }).catch(() => {})
    AsyncStorage.multiGet([CONDITION_MAP_KEY, SLEEP_KEY, TASKS_KEY, RECOVERY_KEY, GOALS_KEY]).then(
      ([[, mapStr], [, sleepStr], [, tasksStr], [, recovStr], [, goalsStr]]) => {
        if (mapStr)   { try { setConditionMap(JSON.parse(mapStr)) }    catch {} }
        if (sleepStr) { try { setSleepRecords(JSON.parse(sleepStr)) }  catch {} }
        if (tasksStr) { try { setTasks(JSON.parse(tasksStr)) }         catch {} }
        if (goalsStr) { try { setGoals(JSON.parse(goalsStr)) }         catch {} }
        if (recovStr) {
          try {
            const recs = JSON.parse(recovStr) as Array<{ date: string }>
            setRecoveryRecords(recs)
          } catch {}
        }
      }
    ).catch(() => {})
  }, [fetchSessions])
  // App Open Ad — 離脱率が高くなるため無効化

  useFocusEffect(useCallback(() => {
    reloadAll()
    // デイリーインサイト 取得済みかチェック
    hasDailyInsightClaimed().then(claimed => setInsightClaimed(claimed)).catch(() => {})
    // ホーム画面が表示されるたびにチームへセッションを同期
    AsyncStorage.getItem('trackmate_sessions').then(raw => {
      if (raw) { try { autoSyncTeam(JSON.parse(raw)).catch(() => {}) } catch {} }
    }).catch(() => {})
    // チーム予定 + 確認済みIDを取得
    Promise.all([
      AsyncStorage.getItem(JOINED_KEY),
      AsyncStorage.getItem(EVENT_CONFIRMED_KEY),
    ]).then(([joinedRaw, confirmedRaw]) => {
      try { setConfirmedIds(new Set(confirmedRaw ? JSON.parse(confirmedRaw) : [])) } catch {}
      if (!joinedRaw) return
      let joined: any
      try { joined = JSON.parse(joinedRaw) } catch { return }
      if (!joined?.code) return
      if (Date.now() - lastTeamEventsFetch.current >= 5 * 60 * 1000) {
        lastTeamEventsFetch.current = Date.now()
        fetchTeamEvents(joined.code).then(evts => {
          // 未来 or 今日の予定のみ（過去は除外）
          setTeamNotifs(evts.filter(e => !isPastEvent(e.event_date)))
        }).catch(() => {})
      }
    }).catch(() => {})
    // 通知画面から戻ったとき用：既読IDを再ロードしてバッジを消す
    AsyncStorage.getItem(NOTIF_READ_KEY).then(raw => {
      try { setNotifReadIds(new Set(raw ? JSON.parse(raw) : [])) } catch {}
    }).catch(() => {})
  }, [reloadAll]))

  function loadTasks() {
    getTasks().then(setTasks).catch(() => {})
  }

  function toggleTask(id: string) {
    updateTasks(current => current.map(t => t.id === id ? { ...t, completed: !t.completed } : t))
      .then(setTasks)
      .catch(() => {})
  }

  // ── デイリーAIインサイト（チケット制）─────────────────────────
  async function handleDailyInsight() {
    if (insightCallRef.current) return  // 二重タップ防止
    if (insightClaimed === true || insightClaimed === null || insightLoading) return
    insightCallRef.current = true
    try {
      setInsightLoading(true)
      try {
        const gate = await checkAdGate('daily_insight')
        if (!gate.allowed) {
          if (gate.needsTicket) { setTicketGateCost(gate.ticketCost); setTicketGateBalance(gate.ticketBalance); setTicketGateVisible(true) }
          else {
            Alert.alert(t('home.dailyLimitAlert.title'), t('home.dailyLimitAlert.message'), [{ text: t('home.dailyLimitAlert.ok'), style: 'cancel' }])
          }
          return
        }
        handleGetAIAdvice({ needsTicket: gate.needsTicket, ticketCost: gate.ticketCost })
      } finally {
        setInsightLoading(false)
      }
    } finally {
      insightCallRef.current = false
    }
  }

  const AI_ADVICE_CACHE_KEY = 'score_ai_advice_daily_cache'

  // ── AIコーチアドバイス ──────────────────────────────────
  // ticketInfo が渡された場合のみ（＝デイリーインサイトのゲートを通過した場合のみ）、
  // 新規生成に成功した時点でチケット/利用回数を消費する（失敗時に課金しないため）
  async function handleGetAIAdvice(ticketInfo?: { needsTicket: boolean; ticketCost: number }) {
    setLoadingAI(true)
    setShowAIAdvice(true)
    setAiAdvice('')
    try {
      const today  = todayLocalISO()

      // 日次キャッシュチェック（同日は API を呼ばない）
      try {
        const cached = await AsyncStorage.getItem(AI_ADVICE_CACHE_KEY)
        if (cached) {
          const { date, advice } = JSON.parse(cached)
          if (date === today && advice) {
            setAiAdvice(advice)
            setLoadingAI(false)
            return
          }
        }
      } catch {}

      // 直近7日の練習データ
      const sevenDaysAgo = localDateStr(new Date(Date.now() - 7 * 86400000))
      const recentSessions = sessions.filter(s => s.session_date >= sevenDaysAgo).slice(0, 10)

      // 睡眠データ
      const recentSleep = sleepRecords.slice(0, 7)

      // リスクスコア
      const riskLabel = riskResult
        ? `${riskResult.riskScore}/100（${riskResult.label}）`
        : '未計算'

      const conditionLabel = ['きつい','きつめ','しんどい','やや重い','ふつう','まあまあ','いい感じ','好調','絶好調','最高'][conditionLevel - 1] ?? 'ふつう'

      const sessionsText = recentSessions.length > 0
        ? recentSessions.map(s =>
            `${s.session_date}: ${SESSION_TYPE_LABEL[s.session_type] ?? s.session_type}` +
            (s.distance_m ? ` ${(s.distance_m/1000).toFixed(1)}km` : '') +
            (s.fatigue_level ? ` 疲労${s.fatigue_level}` : '') +
            (s.notes ? ` 備考:${s.notes.slice(0, 30)}` : '')
          ).join('\n')
        : '記録なし'

      const sleepText = recentSleep.length > 0
        ? recentSleep.map(r => `${r.sleep_date}: ${r.duration_min ? (r.duration_min/60).toFixed(1) : '?'}h`).join(', ')
        : '記録なし'

      const systemPrompt = `あなたは陸上競技専門のエリートコーチです。オリンピック選手も指導した経験を持ち、スポーツ科学・栄養学・スポーツ心理学の知識を統合した高度なアドバイスができます。

コーチとしてのスタイル：
- 選手のデータを深く読み解き、表面的でない本質的な課題を指摘する
- 具体的な数値・種目名・タイムを出して語る（「もっと走れ」ではなく「火曜の400m×6本はインターバルを90秒に縮めてみよう」）
- 選手の頑張りをちゃんと認め、自信を持たせてから改善点を伝える
- 科学的根拠を簡潔に添える（「睡眠不足は成長ホルモンの分泌を30%下げる」など）
- 語尾は「〜だ」「〜しよう」「〜が大切」など、コーチらしい力強い言葉で締める
- 絶対にテンプレっぽい文章にしない。その選手のデータを見て初めて言える言葉を選ぶ`

      const prompt = `今日は${today}。以下の選手データを見て、このコーチとしての分析・アドバイスをしてください。

━━━ 選手の現在地 ━━━
体調スコア：${conditionLevel}/10（${conditionLabel}）
怪我リスク：${riskLabel}
痛み・違和感：${hasSymptom ? '⚠️ あり（直近7日以内に記録あり）' : 'なし'}

━━━ 直近7日の練習 ━━━
${sessionsText || '記録なし（まだ練習ログがない）'}

━━━ 睡眠 ━━━
${sleepText || 'データなし'}

━━━━━━━━━━━━━━━━━━━━━

以下の構成で、このコーチとしてのリアルな言葉でアドバイスしてください。

🔍 **今週の総評**
（練習量・強度・体調の変化を具体的に読み解く。数字を使う。）

💪 **よくやった点・強み**
（認めるべき努力や成果を正直に伝える。具体的に。）

⚡ **今すぐ変えるべきこと**
（最も重要な改善点1〜2個を、理由と一緒にズバリ言う。）

🗓 **明日〜来週の練習方針**
（今週のデータを踏まえた具体的な練習提案。種目・セット数・強度まで）

🌙 **リカバリー・コンディション**
（睡眠・栄養・疲労管理について、今のデータに基づいた具体策）

最後に、コーチとしての一言メッセージ（1〜2文。熱く、でも的確に）${narrativeLanguageInstruction(language)}`

      {
        const apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
        const endpoint = `${apiBase}/api/analyze`
        const res = await fetchWithTimeout(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(await getAiAuthHeader()) },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1400,
            feature: 'daily_insight',
            system: systemPrompt,
            messages: [{ role: 'user', content: prompt }],
          }),
        }, 35000)
        if (res.ok) {
          const data = await res.json()
          const txt = data.content?.[0]?.text
          if (txt && txt.trim().length > 0) {
            setAiAdvice(txt)
            // 当日分をキャッシュ保存（次回から API 不要）
            AsyncStorage.setItem(AI_ADVICE_CACHE_KEY, JSON.stringify({ date: today, advice: txt })).catch(() => {})
            if (ticketInfo) {
              await recordUsage('daily_insight')
              await markDailyInsightClaimed()
              setInsightClaimed(true)
              if (ticketInfo.needsTicket) Toast.show({ type: 'info', text1: t('home.aiAdvice.ticketUsed', { n: ticketInfo.ticketCost }), visibilityTime: 1800 })
            }
          } else {
            // 空応答は失敗として扱う（キャッシュ保存・チケット消費・当日分クレーム消費のいずれもしない）
            setAiAdvice(t('home.aiAdvice.getFailed'))
          }
        } else {
          const errBody = await res.text().catch(() => '')
          setAiAdvice(`${t('home.aiAdvice.apiError', { status: res.status })}\n${errBody.slice(0,80)}`)
        }
      }
    } catch (err: any) {
      setAiAdvice(t('home.aiAdvice.connectionError', { message: err?.message ?? t('home.aiAdvice.tryAgain') }))
    } finally {
      setLoadingAI(false)
    }
  }

  const handleConditionChange = useCallback((v: number) => {
    updateConditionMap(current => ({ ...current, [selectedDate]: v }))
      .then(setConditionMap)
      .catch(() => {})
  }, [selectedDate])

  // ── 怪我リスク計算（選択中の日付を基準に、それ以降の記録は無視して計算） ──
  // ストレッチ・リカバリーの軽減分は、疲労蓄積(TSB)・直近疲労度のスコアに直接反映する
  const riskResult = useMemo(() => {
    if (loading === 'loading' || loading === 'idle') return null
    const asOfMs = new Date(selectedDate + 'T23:59:59').getTime()
    const filteredSessions = isViewingToday ? sessions : sessions.filter(s => s.session_date.slice(0, 10) <= selectedDate)
    const filteredSleep    = isViewingToday ? sleepRecords : sleepRecords.filter(s => s.sleep_date.slice(0, 10) <= selectedDate)
    const recoveryReductionPts  = isViewingToday ? stretchReduction : 0
    const hydrationReductionArg = isViewingToday ? hydrationReductionPts : 0
    return calcInjuryRisk(filteredSessions, filteredSleep, avgConditionLevel, hasSymptom, { recoveryReductionPts, hydrationReductionPts: hydrationReductionArg }, asOfMs)
  }, [sessions, sleepRecords, avgConditionLevel, hasSymptom, loading, selectedDate, isViewingToday, stretchReduction, hydrationReductionPts])

  // Day3/Day5課金導線の条件の1つ「初回スコア閲覧」。ホームに実スコアが表示された時点で
  // 「見た」とみなす（詳細タップまで要求すると条件が厳しすぎるため）。markFirstScoreViewed自体は
  // 一度立てたら二度と書き込まない（lib/paywallTiming.ts）。
  useEffect(() => {
    if (riskResult) markFirstScoreViewed()
  }, [!!riskResult])

  // 天気ボーナスを反映した有効リスクスコア（ストレッチ軽減はriskResult内で計算済み）
  const effectiveRiskScore = useMemo(() => {
    if (!riskResult) return null
    const bonus = isViewingToday ? weatherBonus : 0
    return Math.min(100, Math.max(0, riskResult.riskScore + bonus))
  }, [riskResult, weatherBonus, isViewingToday])

  // 怪我リスクが高い場合に通知を送る（初回マウント + スコアが閾値を超えた時のみ）
  const prevRiskRef = useRef<number | null>(null)
  useEffect(() => {
    if (effectiveRiskScore == null) return
    const prev = prevRiskRef.current
    prevRiskRef.current = effectiveRiskScore
    // 前回から閾値をまたいで上昇した場合のみ通知（再マウントやリフレッシュでは発火しない）
    const crossedRisk    = prev !== null && prev < 80 && effectiveRiskScore >= 80
    const crossedStretch = prev !== null && prev < 75 && effectiveRiskScore >= 75
    if (crossedRisk) {
      sendRiskAlertIfNeeded(effectiveRiskScore)
      // コーチに怪我リスクを通知
      AsyncStorage.getItem(JOINED_KEY).then(raw => {
        if (!raw) return
        let joined: any
        try { joined = JSON.parse(raw) } catch { return }
        if (joined?.code && joined?.playerName) {
          sendCoachNotification(
            joined.code,
            'risk_alert',
            joined.playerName,
            `${joined.playerName}の怪我リスクが高くなっています（スコア: ${effectiveRiskScore}）`,
          ).catch(() => {})
        }
      }).catch(() => {})
    }
    if (crossedStretch) sendStretchReminderIfNeeded(effectiveRiskScore, stretchReduction > 0)
  }, [effectiveRiskScore, stretchReduction])

  // 連続記録ストリーク通知：今日未記録で連続中なら今夜21:00に予約（記録すれば自動キャンセル）
  useEffect(() => {
    const ds = new Set(sessions.map(s => s.session_date))
    const today = todayLocalISO()
    const recordedToday = ds.has(today)
    let streak = 0
    for (let i = 0; i < 365; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      if (ds.has(localDateStr(d))) streak++
      else if (i > 0) break
    }
    scheduleStreakReminder(streak, recordedToday).catch(() => {})
  }, [sessions])

  // ホーム画面ウィジェット(iOS)への同期：怪我リスク・連続記録・次の大会までの日数
  useEffect(() => {
    if (effectiveRiskScore == null) return
    ;(async () => {
      const ds = new Set(sessions.map(s => s.session_date))
      let streak = 0
      for (let i = 0; i < 365; i++) {
        const d = new Date(); d.setDate(d.getDate() - i)
        if (ds.has(localDateStr(d))) streak++
        else if (i > 0) break
      }

      const riskBands = buildRiskCfg(t)
      const cfg = riskBands.find(c => effectiveRiskScore <= c.max) ?? riskBands[3]

      let daysUntilCompetition: number | undefined
      let competitionName: string | undefined
      try {
        const raw = await AsyncStorage.getItem('trackmate_competitions')
        const list: { competition_name?: string; competition_date?: string; event?: string }[] = raw ? JSON.parse(raw) : []
        const today = todayLocalISO()
        const upcoming = list
          .filter(c => c.competition_date && c.competition_date >= today)
          .sort((a, b) => (a.competition_date! < b.competition_date! ? -1 : 1))[0]
        if (upcoming?.competition_date) {
          daysUntilCompetition = Math.ceil((new Date(upcoming.competition_date + 'T00:00:00').getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          competitionName = upcoming.competition_name || (upcoming.event ? getEventLabel(upcoming.event as AthleticsEvent, language) : undefined)
        }
      } catch {}

      let recoveryPhase: string | undefined
      let recoveryDay: number | undefined
      let recoveryTotalDays: number | undefined
      let recoveryProgressPercent: number | undefined
      try {
        const raw = await AsyncStorage.getItem('trackmate_injury_records')
        const list: { status: string; startDate: string; totalDays: number; plans: { day: number; phase: string }[] }[] = raw ? JSON.parse(raw) : []
        const active = list.find(r => r.status === 'active')
        if (active) {
          const start = new Date(active.startDate + 'T00:00:00')
          const elapsed = Math.max(0, Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24)))
          recoveryDay = elapsed + 1
          recoveryTotalDays = active.totalDays
          recoveryProgressPercent = Math.min(100, Math.round((elapsed / active.totalDays) * 100))
          recoveryPhase = active.plans.find(p => p.day === recoveryDay)?.phase ?? active.plans[active.plans.length - 1]?.phase
        }
      } catch {}

      syncWidgetData({
        riskScore: effectiveRiskScore,
        riskLabel: cfg.label,
        daysUntilCompetition,
        competitionName,
        streak,
        recoveryPhase,
        recoveryDay,
        recoveryTotalDays,
        recoveryProgressPercent,
      })
    })()
  }, [effectiveRiskScore, sessions, t, language])

  const handleStretchStart = useCallback(() => {
    router.push({ pathname: '/stretch-recovery', params: { riskScore: (effectiveRiskScore ?? 50).toString() } } as any)
  }, [effectiveRiskScore])

  // ── スクロールトップ ──
  const scrollRef            = useRef<ScrollView>(null)
  const lastTeamEventsFetch  = useRef<number>(0)
  useEffect(() => {
    registerHomeScroll(() => scrollRef.current?.scrollTo({ y: 0, animated: true }))
    setQuickLogListener(() => setShowQuickLog(true))
    return () => { unregisterHomeScroll(); clearQuickLogListener() }
  }, [])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* ── 週間日付バー ── */}
          <AnimatedEntry delay={30}>
            <WeekDateBar selected={selectedDate} onChange={setSelectedDate} conditionMap={conditionMap} />
          </AnimatedEntry>

          {/* ── ここから：今日を見ている時だけ表示するセクション群 ── */}
          {isViewingToday && (<>
          {/* ── 今日まだ入力していないことCTA（未入力があれば最優先で表示） ── */}
          {todayUnfilled.length > 0 ? (
            <AnimatedEntry delay={35}>
              <View style={{
                borderRadius: 14,
                marginBottom: 10,
                shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
              }}>
                <View style={{
                  backgroundColor: colors.surface,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: BRAND + '55',
                  overflow: 'hidden',
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 }}>
                    <Ionicons name="alert-circle" size={16} color={BRAND} />
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{t('home.todoCta.title')}</Text>
                  </View>
                  {todayUnfilled.map((item, i) => (
                    <TouchableOpacity
                      key={item.key}
                      activeOpacity={0.75}
                      onPress={() => { unlockAudio(); item.onPress() }}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        paddingHorizontal: 14, paddingVertical: 12,
                        borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border,
                      }}
                    >
                      <Text style={{ fontSize: 18 }}>{item.icon}</Text>
                      <Text style={{ flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' }}>{item.label}</Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.textHint} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </AnimatedEntry>
          ) : !doneBannerDismissed && (
            <AnimatedEntry delay={35}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 14, borderWidth: 1, borderColor: BRAND + '40',
                paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
                shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
              }}>
                <Ionicons name="checkmark-circle" size={18} color={BRAND} />
                <Text style={{ flex: 1, color: colors.text, fontSize: 13, fontWeight: '700' }}>{t('home.todoCta.allDone')}</Text>
                <TouchableOpacity onPress={() => setDoneBannerDismissed(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={18} color={colors.textHint} />
                </TouchableOpacity>
              </View>
            </AnimatedEntry>
          )}
          {/* ── 水分補給リマインダー ── */}
          {hydrationCard && (
            <AnimatedEntry delay={38}>
              <View style={{
                borderRadius: 14, marginBottom: 10,
                shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
              }}>
                <View style={{
                  backgroundColor: '#ecfeff', borderRadius: 14,
                  borderWidth: 1.5, borderColor: '#22d3ee55',
                  padding: 14, gap: 10,
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ fontSize: 22 }}>🚰</Text>
                    <Text style={{ flex: 1, color: '#0e7490', fontSize: 14, fontWeight: '800' }}>{hydrationCard.message}</Text>
                    <TouchableOpacity onPress={() => setHydrationCard(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close" size={18} color="#0e7490" />
                    </TouchableOpacity>
                  </View>
                  {hydrationCard.showSaltTip && (
                    <Text style={{ color: '#0e7490', fontSize: 11.5, lineHeight: 16 }}>
                      {t('home.hydrationReminder.text')}
                    </Text>
                  )}
                  <TouchableOpacity
                    onPress={() => { unlockAudio(); handleHydrationPress() }}
                    activeOpacity={0.85}
                    style={{ backgroundColor: '#06b6d4', borderRadius: 21, paddingVertical: 11, alignItems: 'center' }}
                  >
                    <Text style={{ color: '#fff', fontSize: 13.5, fontWeight: '800' }}>{t('home.hydrationReminder.drank')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </AnimatedEntry>
          )}
          {/* ── Instagram フォロー促進バナー ── */}
          {igBannerVisible && (
            <AnimatedEntry delay={40}>
              <View style={{
                marginBottom: 10, borderRadius: 14,
                shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.15, shadowRadius: 16, elevation: 4,
              }}>
              <TouchableOpacity
                activeOpacity={0.88}
                onPress={() => Linking.openURL('https://www.instagram.com/score.japan/')}
                style={{
                  marginHorizontal: 0,
                  borderRadius: 14,
                  overflow: 'hidden',
                  backgroundColor: '#1a1a1a',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.1)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  gap: 12,
                }}
              >
                {/* Instagramグラデーションアイコン */}
                <View style={{
                  width: 40, height: 40, borderRadius: 12,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: '#E1306C22',
                }}>
                  <Text style={{ fontSize: 22 }}>📸</Text>
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800', marginBottom: 2 }}>
                    {t('home.igBanner.question')}
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, lineHeight: 15 }}>
                    {t('home.igBanner.challenge')}
                  </Text>
                </View>

                {/* 閉じるボタン */}
                <TouchableOpacity
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={(e) => {
                    e.stopPropagation()
                    setIgBannerVisible(false)
                    AsyncStorage.setItem('score_ig_banner_dismissed', '1').catch(() => {})
                  }}
                >
                  <Ionicons name="close" size={18} color="rgba(255,255,255,0.35)" />
                </TouchableOpacity>
              </TouchableOpacity>
              </View>
            </AnimatedEntry>
          )}

          {/* ── チーム通知バナー ── */}
          {teamNotifs.length > 0 && (() => {
            const newUnconfirmed = teamNotifs.filter(e => isNewTeamEvent(e.created_at) && !confirmedIds.has(e.id))
            const upcoming = [...teamNotifs].sort((a, b) => a.event_date.localeCompare(b.event_date))
            const featured = newUnconfirmed[0] ?? upcoming[0]
            if (!featured) return null
            const cfg = EVENT_CFG_HOME[featured.event_type] ?? EVENT_CFG_HOME.other
            const isNew = isNewTeamEvent(featured.created_at) && !confirmedIds.has(featured.id)
            const extraCount = teamNotifs.length - 1
            return (
              <AnimatedEntry delay={45}>
                <View style={{
                  borderRadius: 14,
                  shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
                }}>
                <HapticTouch
                  haptic="whoosh"
                  activeOpacity={0.85}
                  onPress={() => router.push('/(tabs)/team')}
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: isNew ? BRAND + '60' : colors.border,
                    overflow: 'hidden',
                  }}
                >
                  {/* NEW帯（新着があるときのみ） */}
                  {isNew && (
                    <View style={{ backgroundColor: BRAND, paddingHorizontal: 14, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>{t('home.teamBanner.newEvent')}</Text>
                      {newUnconfirmed.length > 1 && (
                        <View style={{ marginLeft: 'auto', backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}>
                          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{t('home.teamBanner.moreCount', { n: newUnconfirmed.length - 1 })}</Text>
                        </View>
                      )}
                    </View>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 }}>
                    {/* イベントアイコン */}
                    <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: cfg.color + '18', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 20 }}>{cfg.emoji}</Text>
                    </View>
                    {/* 内容 */}
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{featured.title}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Text style={{ color: cfg.color, fontSize: 12, fontWeight: '700' }}>{fmtEventDateHome(featured.event_date, t, dayNames)}</Text>
                        {!!featured.event_time && <Text style={{ color: colors.textSec, fontSize: 11 }}>{featured.event_time}</Text>}
                        {!!featured.location && <Text style={{ color: colors.textSec, fontSize: 11 }}>📍{featured.location}</Text>}
                      </View>
                      {extraCount > 0 && (
                        <Text style={{ color: colors.textHint, fontSize: 11 }}>{t('home.teamBanner.moreEvents', { n: extraCount })}</Text>
                      )}
                    </View>
                    {/* 矢印 */}
                    <Ionicons name="chevron-forward" size={16} color={colors.textHint} />
                  </View>
                </HapticTouch>
                </View>
              </AnimatedEntry>
            )
          })()}
          </>)}
          {/* ── ここまで：今日限定セクション ── */}

          {/* ── はじめてチェックリスト（旧: 自動チュートリアル） ── */}
          <AnimatedEntry delay={60}>
            <FirstRunChecklist
              hasLoggedConditionToday={getTodayISO() in conditionMap}
              onOpenConditionModal={() => setShowQuickCondition(true)}
              onNavigateMenu={() => router.push('/workout-menu' as any)}
              onNavigateVideo={() => router.push('/video-analysis' as any)}
            />
          </AnimatedEntry>

          {__DEV__ && (
            <TouchableOpacity
              style={{ alignSelf: 'center', paddingVertical: 8, marginBottom: 4 }}
              onPress={() => router.push('/paywall?plan=ticket_monthly')}
            >
              <Text style={{ color: '#166534', fontSize: 12, fontWeight: '700' }}>[DEV] Day3課金案内をプレビュー（→Paywall）</Text>
            </TouchableOpacity>
          )}

          {/* ── INJURY RISK SCORE ── */}
          <AnimatedEntry delay={90}>
            <ScoreOverviewCard
              sessions={sessions}
              sleepRecords={sleepRecords}
              conditionLevel={avgConditionLevel}
              riskResult={riskResult}
              effectiveRiskScore={effectiveRiskScore ?? undefined}
              weatherBonus={weatherBonus}
              onStretchStart={handleStretchStart}
              onRefreshWeather={() => fetchWeather(true)}
              weatherLoading={weatherLoading}
              onPressBreakdown={() => { markFirstScoreViewed(); setShowRiskBreakdown(true) }}
            />
          </AnimatedEntry>

          {/* ── 選択中の日（今日以外）の記録内容 ── */}
          {!isViewingToday && (
            <AnimatedEntry delay={100}>
              <GlassCard>
                <View style={s.sectionRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="calendar-outline" size={14} color={BRAND} />
                    <Text style={[s.sectionLabel, { color: colors.text }]}>
                      {t('home.selectedDateSection.recordsFor', { date: selectedDate.slice(5).replace('-', '/') })}
                    </Text>
                  </View>
                </View>
                {(() => {
                  const daySessions = sessions.filter(sess => sess.session_date === selectedDate)
                  if (daySessions.length === 0) {
                    return (
                      <View style={{ alignItems: 'center', gap: 6, paddingVertical: 20 }}>
                        <Ionicons name="barbell-outline" size={28} color={colors.textHint} />
                        <Text style={{ color: colors.textHint, fontSize: 13 }}>{t('home.selectedDateSection.noRecords')}</Text>
                      </View>
                    )
                  }
                  return daySessions.map((sess, idx) => {
                    const typeInfo = sessionTypeInfo(sess.session_type, language)
                    const fat = sess.fatigue_level ?? 5
                    const fatColor = fat >= 8 ? '#FF6B6B' : fat >= 6 ? '#FF9500' : '#4ECDC4'
                    return (
                      <View key={sess.id} style={[s.sessRow, idx > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                        <View style={[s.typeBar, { backgroundColor: typeInfo.color }]} />
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={[s.sessType, { color: colors.text }]}>{typeInfo.label}</Text>
                            {sess.event ? <Text style={{ color: colors.textHint, fontSize: 11 }}>{sess.event}</Text> : null}
                          </View>
                          {sess.notes ? (
                            <Text style={[s.sessDate, { color: colors.textHint }]} numberOfLines={2}>{sess.notes}</Text>
                          ) : sess.distance_m ? (
                            <Text style={[s.sessDate, { color: colors.textHint }]}>
                              {sess.distance_m >= 1000 ? `${(sess.distance_m/1000).toFixed(1)}km` : `${sess.distance_m}m`}
                            </Text>
                          ) : null}
                        </View>
                        {sess.time_ms ? (
                          <Text style={[s.sessStat, { color: colors.textSec }]}>{fmtSessionTime(sess.time_ms)}</Text>
                        ) : null}
                        <View style={[s.fatiguePill, { backgroundColor: fatColor + '22' }]}>
                          <Text style={{ fontSize: 10, fontWeight: '800', color: fatColor }}>{t('home.selectedDateSection.fatigue', { n: fat })}</Text>
                        </View>
                      </View>
                    )
                  })
                })()}
              </GlassCard>
            </AnimatedEntry>
          )}

          {/* ── ここから：今日を見ている時だけ表示するセクション群 ── */}
          {isViewingToday && (<>
          {/* ── 目標 ── */}
          <AnimatedEntry delay={100}>
            <TutorialSpot spotKey="home_goal_section">
              <GoalCard goals={goals} onUpdate={handleGoalsUpdate} />
            </TutorialSpot>
          </AnimatedEntry>

          {/* ── サクッと入力 ＋ カウントダウン（アイコン＋2行テキストの統一ミニカード） ── */}
          <AnimatedEntry delay={120}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {/* サクッと入力 */}
              <TutorialSpot spotKey="home_quick_input" style={{ flex: 1 }}>
              <TouchableOpacity
                style={[s.miniCard, { backgroundColor: colors.surface, borderColor: BRAND, borderWidth: 1.5 }]}
                onPress={() => { unlockAudio(); setShowQuickCondition(true); if (tutStepId === 'quick_input') tutNext() }}
                activeOpacity={0.78}
              >
                <View style={s.miniCardIconWrap}>
                  <Ionicons name="flash-outline" size={20} color={BRAND} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.miniCardTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{t('home.miniCards.quickLog')}</Text>
                  <Text style={s.miniCardSub} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{t('home.miniCards.quickLogSub')}</Text>
                </View>
              </TouchableOpacity>
              </TutorialSpot>

              {/* カウントダウンカード */}
              <TouchableOpacity
                style={[s.miniCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => setShowCountdownModal(true)}
                activeOpacity={0.78}
              >
                {injuryDaysLeft !== null ? (
                  <>
                    <View style={[s.miniCardIconWrap, { backgroundColor: '#FF6B6B14' }]}>
                      <Ionicons name="medkit-outline" size={20} color="#FF6B6B" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.miniCardTitle} numberOfLines={1}>{t('home.miniCards.injuryReturn')}</Text>
                      <Text style={[s.miniCardSub, { color: '#FF6B6B', fontWeight: '700' }]} numberOfLines={1}>{t('home.miniCards.daysUnit', { n: injuryDaysLeft })}</Text>
                    </View>
                  </>
                ) : compDaysLeft !== null ? (
                  <>
                    <View style={s.miniCardIconWrap}>
                      <Ionicons name="calendar-outline" size={20} color={BRAND} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.miniCardTitle} numberOfLines={1}>{t('home.miniCards.competitionCountdown')}</Text>
                      <Text style={[s.miniCardSub, { color: BRAND, fontWeight: '700' }]} numberOfLines={1}>{t('home.miniCards.daysUnit', { n: compDaysLeft.days })}</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={s.miniCardIconWrap}>
                      <Ionicons name="timer-outline" size={20} color={BRAND} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.miniCardTitle} numberOfLines={1}>{t('home.miniCards.countdown')}</Text>
                      <Text style={s.miniCardSub} numberOfLines={1}>{t('home.miniCards.registerCompetition')}</Text>
                    </View>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </AnimatedEntry>

          {/* ── 今日のAIアドバイス（AIコーチカード） ── */}
          <AnimatedEntry delay={140}>
            <TouchableOpacity
              style={[s.aiCoachCard, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
              onPress={() => { unlockAudio(); if (insightClaimed) { handleGetAIAdvice() } else { handleDailyInsight() } }}
              activeOpacity={0.85}
              disabled={insightLoading}
            >
              <View style={s.aiCoachDarkIcon}>
                {insightLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Ionicons name="sparkles" size={22} color="#fff" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.aiCoachLabel, { color: colors.text }]}>{t('home.aiCoachCard.title')}</Text>
                <Text style={[s.aiCoachSub, { color: colors.textSec }]} numberOfLines={1}>
                  {insightClaimed ? t('home.aiCoachCard.viewAdvice') : t('home.aiCoachCard.analyze')}
                </Text>
              </View>
              {!insightClaimed && (
                <View style={s.ticketBadge}>
                  <Text style={s.ticketBadgeText}>{t('home.aiCoachCard.ticketBadge', { n: TICKET_COST.daily_insight })}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={18} color={colors.textHint} />
            </TouchableOpacity>
          </AnimatedEntry>

          {/* ── クイックアクセス（線画アイコンで統一） ── */}
          <AnimatedEntry delay={160}>
            <View style={{ gap: 8 }}>
              <Text style={[s.sectionLabel, { color: colors.textSec, marginBottom: 0 }]}>{t('home.quickAccess.title')}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.quickLinks}
              >
                {[
                  { icon: 'videocam-outline' as const,   label: t('home.quickAccess.videoAnalysis'),  route: '/video-analysis',     spotKey: undefined },
                  { icon: 'clipboard-outline' as const,  label: t('home.quickAccess.menu'),           route: '/workout-menu',       spotKey: 'notebook_menu_link' as const },
                  { icon: 'calendar-outline' as const,   label: t('home.quickAccess.calendar'),       route: '/(tabs)/calendar',    spotKey: undefined },
                  { icon: 'restaurant-outline' as const, label: t('home.quickAccess.mealAnalysis'),   route: '/(tabs)/nutrition',   spotKey: undefined },
                  { icon: 'flag-outline' as const,       label: t('home.quickAccess.competitionPlan'), route: '/(tabs)/competition', spotKey: 'competition_tab' as const },
                  { icon: 'megaphone-outline' as const,  label: t('home.quickAccess.starter'),        route: '/reaction-start',            spotKey: undefined },
                  { icon: 'calculator-outline' as const, label: t('home.quickAccess.combinedEvents'), route: '/multi-event-score',    spotKey: undefined },
                  { icon: 'stopwatch-outline' as const,  label: t('home.quickAccess.trainingTimer'),  route: '/training-timer', spotKey: undefined },
                ].map(item => {
                  const btn = (
                    <PressableScale
                      key={item.label}
                      haptic="light"
                      scaleAmount={0.94}
                      onPress={() => { unlockAudio(); Sounds.tap(); router.push(item.route as any) }}
                    >
                      <View style={[s.quickLink, { backgroundColor: colors.surface }]}>
                        <View style={s.quickLinkIconWrap}>
                          <Ionicons name={item.icon} size={22} color={BRAND} />
                        </View>
                        <Text style={s.quickLinkLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>{item.label}</Text>
                      </View>
                    </PressableScale>
                  )
                  return item.spotKey
                    ? <TutorialSpot key={item.label} spotKey={item.spotKey}>{btn}</TutorialSpot>
                    : btn
                })}
              </ScrollView>
            </View>
          </AnimatedEntry>

          {/* ── 改善タスク（ある場合のみ表示） ── */}
          <AnimatedEntry delay={180}>
            <TasksCard tasks={tasks} onToggle={toggleTask} />
          </AnimatedEntry>


          {/* ── 練習一覧（全件・スクロール形式） ── */}
          <AnimatedEntry delay={360}>
            <GlassCard>
              <View style={s.sectionRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="list" size={14} color={BRAND} />
                  <Text style={[s.sectionLabel, { color: colors.text }]}>{t('home.practiceList.title')}</Text>
                  {sessions.length > 0 && (
                    <View style={{ backgroundColor: BRAND + '22', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ color: BRAND, fontSize: 10, fontWeight: '800' }}>{t('home.practiceList.count', { n: sessions.length })}</Text>
                    </View>
                  )}
                </View>
                <PressableScale haptic="light" onPress={() => router.push('/(tabs)/records')}>
                  <Text style={{ color: BRAND, fontSize: 12, fontWeight: '700' }}>{t('home.practiceList.progress')}</Text>
                </PressableScale>
              </View>

              {loading === 'loading' || loading === 'idle' ? (
                <View style={{ gap: 10 }}>
                  {[0,1,2].map(i => (
                    <View key={i} style={{ height: 44, backgroundColor: colors.surface2, borderRadius: 8, opacity: 0.8 }} />
                  ))}
                </View>
              ) : sessions.length === 0 ? (
                <View style={{ alignItems: 'center', gap: 6, paddingVertical: 24 }}>
                  <Ionicons name="barbell-outline" size={32} color={colors.textHint} />
                  <Text style={{ color: colors.textHint, fontSize: 14 }}>{t('home.practiceList.noRecords')}</Text>
                  <Text style={{ color: colors.textHint, fontSize: 12 }}>{t('home.practiceList.addHint')}</Text>
                </View>
              ) : (() => {
                const renderRow = (sess: typeof sessions[0], idx: number) => {
                  const typeInfo = sessionTypeInfo(sess.session_type, language)
                  const fat = sess.fatigue_level ?? 5
                  const fatColor = fat >= 8 ? '#FF6B6B' : fat >= 6 ? '#FF9500' : '#4ECDC4'
                  const openShare = () => {
                    const dt = new Date(sess.session_date + 'T00:00:00')
                    setShareSession({
                      date:      language === 'ja'
                        ? `${dt.getFullYear()}年${dt.getMonth()+1}月${dt.getDate()}日（${dayNames[dt.getDay()]}）`
                        : dt.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }),
                      title:     typeInfo.label,
                      menu:      sess.notes ?? undefined,
                      distance:  sess.distance_m ? sess.distance_m / 1000 : undefined,
                      sets:      sess.reps ?? undefined,
                      time:      sess.time_ms ? fmtSessionTime(sess.time_ms) : undefined,
                      fatigue:   sess.fatigue_level,
                      condition: sess.condition_level,
                      weather:   sess.weather ?? undefined,
                      streak:    (() => { let sk=0; const ds=new Set(sessions.map(s=>s.session_date)); for(let i=0;i<365;i++){const d=new Date();d.setDate(d.getDate()-i);if(ds.has(localDateStr(d)))sk++;else if(i>0)break}; return sk })(),
                      rank:      `${calcLevelInfo(sessions.length, language).emoji} ${calcLevelInfo(sessions.length, language).title}`,
                    })
                  }
                  return (
                    <View
                      key={sess.id}
                      style={[s.sessRow, idx > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                    >
                      <View style={[s.typeBar, { backgroundColor: typeInfo.color }]} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[s.sessType, { color: colors.text }]}>{typeInfo.label}</Text>
                          {sess.event ? <Text style={{ color: colors.textHint, fontSize: 11 }}>{sess.event}</Text> : null}
                        </View>
                        <Text style={[s.sessDate, { color: colors.textHint }]}>
                          {sess.session_date}
                          {sess.distance_m ? ` · ${sess.distance_m >= 1000 ? `${(sess.distance_m/1000).toFixed(1)}km` : `${sess.distance_m}m`}` : ''}
                        </Text>
                      </View>
                      {sess.time_ms ? (
                        <Text style={[s.sessStat, { color: colors.textSec }]}>{fmtSessionTime(sess.time_ms)}</Text>
                      ) : null}
                      <View style={[s.fatiguePill, { backgroundColor: fatColor + '22' }]}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: fatColor }}>{t('home.selectedDateSection.fatigue', { n: fat })}</Text>
                      </View>
                      <TouchableOpacity onPress={openShare} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginLeft: 6 }}>
                        <Ionicons name="share-outline" size={16} color={BRAND} />
                      </TouchableOpacity>
                    </View>
                  )
                }
                return (
                  <ScrollView
                    style={{ maxHeight: 275 }}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={sessions.length > 5}
                  >
                    {sessions.map((sess, idx) => renderRow(sess, idx))}
                  </ScrollView>
                )
              })()}
            </GlassCard>
          </AnimatedEntry>

          </>)}
          {/* ── ここまで：今日限定セクション ── */}

        </ScrollView>
      </SafeAreaView>

      {/* ── リカバリー完了バナー ── */}
      {recoveryBanner && (
        <TouchableOpacity
          style={s.recovBanner}
          onPress={() => setRecoveryBanner(null)}
          activeOpacity={0.8}
        >
          <Text style={s.recovBannerText}>
            {t('home.recoveryBanner', { n: recoveryBanner.reduction })}
          </Text>
          <Ionicons name="close" size={14} color="#34C759" />
        </TouchableOpacity>
      )}

      <QuickLogModal
        visible={showQuickLog}
        onClose={() => setShowQuickLog(false)}
        onSaved={() => {
          fetchSessions('')
          loadTasks()
        }}
      />

      <QuickConditionModal
        visible={showQuickCondition}
        date={selectedDate}
        onClose={() => { setShowQuickCondition(false); onConditionModalClose() }}
        onSaved={() => reloadAll()}
      />

      {/* ── 怪我リスク内訳モーダル ── */}
      <Modal visible={showRiskBreakdown} transparent animationType="slide" onRequestClose={() => setShowRiskBreakdown(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { backgroundColor: colors.surface }]}>
            <View style={s.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 20 }}>📊</Text>
                <Text style={[s.modalTitle, { color: colors.text }]}>{t('home.breakdown.title')}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowRiskBreakdown(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={22} color={colors.textSec} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: '80%' }} showsVerticalScrollIndicator={false}>
              {riskResult && (
                <View style={{
                  flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 16,
                  padding: 14, borderRadius: 14, backgroundColor: colors.surface2,
                }}>
                  <Text style={{ fontSize: 13, color: colors.textSec }}>
                    {t('home.breakdown.base', { n: riskResult.riskScore + riskResult.recoveryApplied + riskResult.hydrationApplied })}
                  </Text>
                  {isViewingToday && riskResult.recoveryApplied > 0 && (
                    <Text style={{ fontSize: 13, color: BRAND, fontWeight: '700' }}>
                      {t('home.breakdown.stretch', { n: riskResult.recoveryApplied })}
                    </Text>
                  )}
                  {isViewingToday && riskResult.hydrationApplied > 0 && (
                    <Text style={{ fontSize: 13, color: '#0891b2', fontWeight: '700' }}>
                      {t('home.breakdown.hydration', { n: riskResult.hydrationApplied })}
                    </Text>
                  )}
                  {!!weatherBonus && (
                    <Text style={{ fontSize: 13, color: colors.textSec }}>
                      {t('home.breakdown.weather', { n: `${weatherBonus > 0 ? '+' : ''}${weatherBonus}` })}
                    </Text>
                  )}
                  <Text style={{ fontSize: 13, color: colors.text, fontWeight: '800', marginLeft: 'auto' }}>
                    {t('home.breakdown.current', { n: effectiveRiskScore ?? riskResult.riskScore })}
                  </Text>
                </View>
              )}
              {riskResult?.reasons && riskResult.reasons.length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  {riskResult.reasons.map((r, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
                      <Text style={{ fontSize: 13, color: colors.textSec }}>・</Text>
                      <Text style={{ fontSize: 13, color: colors.textSec, flex: 1, lineHeight: 19 }}>{r}</Text>
                    </View>
                  ))}
                </View>
              )}
              {isViewingToday && riskResult && riskResult.recoveryApplied > 0 && (
                <Text style={{ fontSize: 11, color: colors.textHint, marginBottom: 10, lineHeight: 16 }}>
                  {t('home.breakdown.stretchNote')}
                </Text>
              )}
              {isViewingToday && riskResult && riskResult.hydrationApplied > 0 && (
                <Text style={{ fontSize: 11, color: colors.textHint, marginBottom: 10, lineHeight: 16 }}>
                  {t('home.breakdown.hydrationNote')}
                </Text>
              )}
              {riskResult?.factors.map(f => {
                // 未記録(-1)は棒を出さない。0以上は最低でも視認できる幅を確保する。
                const pct = f.score < 0 ? null : Math.max(3, Math.min(100, f.score))
                const barColor = pct === null ? colors.textHint
                  : f.score >= 60 ? ALERT : f.score >= 30 ? '#f59e0b' : BRAND
                return (
                  <View key={f.key} style={{
                    marginBottom: 10, padding: 12, borderRadius: 14,
                    backgroundColor: colors.surface2,
                  }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{f.emoji} {f.name}</Text>
                      {pct !== null && (
                        <Text style={{ fontSize: 12, fontWeight: '700', color: barColor }}>{f.score}%</Text>
                      )}
                    </View>
                    <Text style={{ fontSize: 12, color: colors.textSec, marginBottom: 8, lineHeight: 17 }}>{f.description}</Text>
                    <View style={{ height: 6, backgroundColor: colors.border ?? 'rgba(128,128,128,0.2)', borderRadius: 3, overflow: 'hidden' }}>
                      {pct !== null && (
                        <View style={{
                          width: `${pct}%` as any, height: '100%', borderRadius: 3,
                          backgroundColor: barColor,
                        }} />
                      )}
                    </View>
                  </View>
                )
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── AIコーチ アドバイスモーダル ── */}
      <Modal visible={showAIAdvice} transparent animationType="slide" onRequestClose={() => setShowAIAdvice(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { backgroundColor: colors.surface }]}>
            {/* ヘッダー */}
            <View style={s.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 22 }}>🤖</Text>
                <Text style={[s.modalTitle, { color: colors.text }]}>{t('home.aiCoachModal.title')}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAIAdvice(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={22} color={colors.textSec} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              {loadingAI ? (
                <View style={{ alignItems: 'center', paddingVertical: 60, gap: 16 }}>
                  <ActivityIndicator size="large" color={BRAND} />
                  <Text style={{ color: colors.textHint, fontSize: 13 }}>{t('home.aiCoachModal.analyzing')}</Text>
                </View>
              ) : (
                <View style={{ paddingBottom: 40 }}>
                  {aiAdvice.split('\n').map((line, i) => {
                    const isBold = line.startsWith('**') || /^[🏃💪📅🍽️⚠️🎯🔥💤]/.test(line)
                    return (
                      <Text
                        key={i}
                        style={[
                          s.adviceText,
                          { color: isBold ? colors.text : colors.textSec },
                          isBold && { fontWeight: '700', fontSize: 14, marginTop: 14 },
                        ]}
                      >
                        {line.replace(/\*\*/g, '')}
                      </Text>
                    )
                  })}
                </View>
              )}
            </ScrollView>

            {!loadingAI && (
              <TouchableOpacity
                style={[s.reloadBtn, { borderColor: 'rgba(59,130,246,0.3)' }]}
                onPress={() => handleGetAIAdvice()}
              >
                <Ionicons name="refresh" size={15} color="#3b82f6" />
                <Text style={{ color: '#3b82f6', fontSize: 13, fontWeight: '700' }}>{t('home.aiCoachModal.refetch')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* ── 練習記録シェアカード ── */}
      <Modal visible={!!shareSession} transparent animationType="fade" onRequestClose={() => setShareSession(null)}>
        {shareSession ? (
          <PracticeShareCard
            data={shareSession}
            visible={true}
            onClose={() => setShareSession(null)}
          />
        ) : <View />}
      </Modal>

      {/* ── カウントダウン選択モーダル ── */}
      <Modal visible={showCountdownModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCountdownModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 }}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: colors.text }}>{t('home.countdownModal.title')}</Text>
            <TouchableOpacity onPress={() => setShowCountdownModal(false)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={18} color={colors.textSec} />
            </TouchableOpacity>
          </View>

          <Text style={{ fontSize: 13, color: colors.textSec, paddingHorizontal: 20, marginBottom: 20 }}>{t('home.countdownModal.subtitle')}</Text>

          <View style={{ paddingHorizontal: 16, gap: 14 }}>
            {/* 試合計画カード */}
            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => { setShowCountdownModal(false); router.push({ pathname: '/(tabs)/competition', params: { tab: 'race' } }) }}
              style={{ backgroundColor: colors.card, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: colors.border, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 3 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: BRAND + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 26 }}>🏁</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>{t('home.countdownModal.competitionPlan')}</Text>
                  {compDaysLeft !== null ? (
                    <>
                      <Text style={{ fontSize: 12, color: colors.textSec, marginTop: 2 }}>{compDaysLeft.name}</Text>
                      <Text style={{ fontSize: 24, fontWeight: '900', color: BRAND, letterSpacing: -1, marginTop: 4 }}>
                        {t('home.countdownModal.daysLeft', { n: compDaysLeft.days })}
                      </Text>
                    </>
                  ) : (
                    <Text style={{ fontSize: 13, color: colors.textHint, marginTop: 4 }}>{t('home.countdownModal.registerHint')}</Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textHint} />
              </View>
              {compDaysLeft === null && (
                <View style={{ marginTop: 14, backgroundColor: BRAND, borderRadius: 12, paddingVertical: 11, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>{t('home.countdownModal.registerButton')}</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* 怪我復帰計画カード */}
            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => { setShowCountdownModal(false); router.push({ pathname: '/(tabs)/competition', params: { tab: 'injury' } }) }}
              style={{ backgroundColor: colors.card, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: colors.border, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 3 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: '#FF6B6B18', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 26 }}>🩹</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>{t('home.countdownModal.injuryPlan')}</Text>
                  {injuryDaysLeft !== null ? (
                    <>
                      <Text style={{ fontSize: 12, color: colors.textSec, marginTop: 2 }}>{t('home.countdownModal.recoveryInProgress')}</Text>
                      <Text style={{ fontSize: 24, fontWeight: '900', color: '#FF6B6B', letterSpacing: -1, marginTop: 4 }}>
                        {t('home.countdownModal.daysLeft', { n: injuryDaysLeft })}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={{ fontSize: 13, color: colors.textHint, marginTop: 2 }}>{t('home.countdownModal.injuryFree')}</Text>
                      <Text style={{ fontSize: 22, fontWeight: '900', color: '#34C759', letterSpacing: -1, marginTop: 2 }}>
                        {t('home.countdownModal.daysUnit', { n: injuryFreeDays })}
                      </Text>
                    </>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textHint} />
              </View>
              {injuryDaysLeft === null && (
                <View style={{ marginTop: 14, backgroundColor: '#FF6B6B', borderRadius: 12, paddingVertical: 11, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>{t('home.countdownModal.recordInjuryButton')}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      <PWAInstallPrompt />

      {/* レビューウォール */}
      <ReviewWall
        visible={reviewWallVisible}
        onClose={() => setReviewWallVisible(false)}
      />

      <TicketGateModal
        visible={ticketGateVisible}
        feature="daily_insight"
        ticketCost={ticketGateCost}
        ticketBalance={ticketGateBalance}
        onClose={() => setTicketGateVisible(false)}
      />
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  content:   { paddingHorizontal: 16, paddingTop: 8, gap: 16, paddingBottom: 110 },

  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  scorePill:    { backgroundColor: '#111827', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8 },
  scorePillText:{ color: '#ffffff', fontSize: 16, fontWeight: '900', letterSpacing: -0.3 },
  iconBtn:      { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  sectionRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  sessRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  typeBar:    { width: 4, height: 36, borderRadius: 2, flexShrink: 0 },
  sessType:   { fontSize: 13, fontWeight: '700' },
  sessDate:   { fontSize: 11, marginTop: 2 },
  sessStat:   { fontSize: 12, fontWeight: '600' },
  fatiguePill:{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },

  quickLinks: { flexDirection: 'row', gap: 8, paddingRight: 16 },
  quickLink:  { width: 74, borderRadius: 16, borderWidth: 0, paddingVertical: 12, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', gap: 6,
               shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  quickLinkIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: BRAND + '14', alignItems: 'center', justifyContent: 'center' },
  quickLinkLabel: { fontSize: 10.5, fontWeight: '700', textAlign: 'center', color: colors.textSec, lineHeight: 13 },

  // PRバッジ
  prBadge: {
    backgroundColor: '#F5A623', borderRadius: 5,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  prText: { color: '#000', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },

  // リカバリーボタン
  recoveryBtn:   { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  recoveryInner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  recoveryIcon:  { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  recoveryTitle: { fontSize: 14, fontWeight: '800' },
  recoverySub:   { fontSize: 11, marginTop: 2 },

  halfCard: {
    flex: 1, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14,
    alignItems: 'center', gap: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.09, shadowRadius: 16, elevation: 5,
  },
  // ミニカード（アイコン＋2行テキスト、サクッと入力／カウントダウン共通）
  miniCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 16, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  miniCardIconWrap: { width: 36, height: 36, borderRadius: 11, backgroundColor: BRAND + '14', alignItems: 'center', justifyContent: 'center' },
  miniCardTitle: { fontSize: 12.5, fontWeight: '700', color: colors.text },
  miniCardSub:   { fontSize: 11.5, fontWeight: '400', color: colors.textHint, marginTop: 1 },
  // AIコーチカード（W3スタイル）— 案A ソフト浮き上がり
  aiCoachCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 16, paddingHorizontal: 16, paddingVertical: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10, shadowRadius: 20, elevation: 6,
  },
  aiCoachDarkIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#111827',
    alignItems: 'center', justifyContent: 'center',
  },
  aiCoachLabel: { fontSize: 13, fontWeight: '900', color: '#111827', letterSpacing: 0.5, marginBottom: 3 },
  aiCoachSub:   { fontSize: 12, lineHeight: 17 },
  ticketBadge:     { backgroundColor: 'rgba(245,158,11,0.14)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, marginRight: 4 },
  ticketBadgeText: { fontSize: 11.5, fontWeight: '800', color: '#b45309' },

  // リカバリーバナー
  recovBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(52,199,89,0.15)', borderTopWidth: 1,
    borderTopColor: 'rgba(52,199,89,0.3)', paddingHorizontal: 16, paddingVertical: 10,
  },
  recovBannerText: { color: '#34C759', fontSize: 12, fontWeight: '700', flex: 1 },

  // AIアドバイスモーダル
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16,
    maxHeight: '85%',
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, marginBottom: 8,
  },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  adviceText: { fontSize: 13, lineHeight: 21 },
  reloadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderWidth: 1, borderRadius: 12, paddingVertical: 12, marginTop: 8,
  },
})
```

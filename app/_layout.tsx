import React, { Component, useEffect, useState } from 'react'
import {
  Platform, View, ActivityIndicator, TouchableOpacity,
  Text, Modal, ScrollView, Linking, StyleSheet,
} from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import Toast from 'react-native-toast-message'
import * as Font from 'expo-font'
import * as SplashScreen from 'expo-splash-screen'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Ionicons } from '@expo/vector-icons'
import { AuthProvider, useAuth } from '../context/AuthContext'
import { ThemeProvider } from '../context/ThemeContext'
import { PurchaseProvider } from '../context/PurchaseContext'
import SplashAnimation from '../components/SplashAnimation'
import { initOneSignal, requestPushPermission } from '../lib/notify'
import { initAdmob } from '../lib/admob'

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
    return { hasError: true, errorMsg: String(error?.message ?? error) }
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
          {__DEV__ && (
            <Text style={{ color: '#ef4444', fontSize: 11, textAlign: 'center', marginTop: 16 }}>
              {this.state.errorMsg}
            </Text>
          )}
        </View>
      )
    }
    return this.props.children
  }
}

const CONSENT_KEY = 'score_terms_accepted_v1'

// ─────────────────────────────────────────────────────────
// ConsentModal — 初回起動時に利用規約・プライバシーポリシーへの同意を求める
// ─────────────────────────────────────────────────────────
function ConsentModal({ onAccept }: { onAccept: () => void }) {
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
                <Text style={cs.docBackText}>同意画面に戻る</Text>
              </TouchableOpacity>
              <Text style={cs.docHeaderTitle}>
                {innerDoc === 'terms' ? '利用規約' : 'プライバシーポリシー'}
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
                {innerDoc === 'terms' ? '利用規約' : 'プライバシーポリシー'}に同意して戻る
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
            <Text style={cs.title}>sCOREへようこそ</Text>
            <Text style={cs.subtitle}>
              ご利用を開始する前に{'\n'}以下の規約をご確認ください
            </Text>

            {/* ── 規約リンク（タップで全文を表示） ── */}
            <View style={cs.linksBox}>
              <TouchableOpacity
                style={cs.linkRow}
                onPress={() => setInnerDoc('terms')}
                activeOpacity={0.7}
              >
                <Ionicons name="document-text-outline" size={18} color="#166534" />
                <Text style={cs.linkText}>利用規約</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </TouchableOpacity>
              <View style={cs.divider} />
              <TouchableOpacity
                style={cs.linkRow}
                onPress={() => setInnerDoc('privacy')}
                activeOpacity={0.7}
              >
                <Ionicons name="shield-checkmark-outline" size={18} color="#166534" />
                <Text style={cs.linkText}>プライバシーポリシー</Text>
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
                <Text style={cs.checkLabel}>
                  <Text style={cs.checkLinkText} onPress={() => setInnerDoc('terms')}>
                    利用規約
                  </Text>
                  に同意します
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={cs.checkRow}
                onPress={() => setPrivacyChecked(v => !v)}
                activeOpacity={0.75}
              >
                <View style={[cs.checkbox, privacyChecked && cs.checkboxActive]}>
                  {privacyChecked && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
                <Text style={cs.checkLabel}>
                  <Text style={cs.checkLinkText} onPress={() => setInnerDoc('privacy')}>
                    プライバシーポリシー
                  </Text>
                  に同意します
                </Text>
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
                同意してアプリを始める
              </Text>
            </TouchableOpacity>

            <Text style={cs.footer}>
              © 2026 trackmate. All rights reserved.
            </Text>
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
            (window.location.search.includes('code=') ||
             window.location.hash.includes('access_token='))
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

  useEffect(() => {
    if (loading) return
    // 同意チェックが終わるまでナビゲーションは行わない
    if (consentAccepted === null) return

    const inAuth        = segments[0] === 'auth'
    const inOnboarding  = segments[0] === 'onboarding'
    const inPublic      = segments[0] === 'coach-landing' || segments[0] === 'guide'
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
      (window.location.search.includes('code=') || window.location.hash.includes('access_token='))
    if (!authed && hasOAuthParams) return

    // 未認証 → /auth へ（公開ページは除く）
    if (!authed && !inAuth && !inPublic) {
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
  }, [user, loading, isGuest, isOnboarded, segments, consentAccepted])

  if (loading || consentAccepted === null) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#E53E3E" size="large" />
      </View>
    )
  }

  return (
    <>
      {children}
      {/* 同意モーダル — 未同意の場合すべての画面の上に表示 */}
      {!consentAccepted && (
        <ConsentModal onAccept={() => setConsentAccepted(true)} />
      )}
    </>
  )
}

function RootLayoutNav() {
  const router = useRouter()

  // アプリ起動時に OneSignal を初期化（許可ダイアログは初回のみ）
  useEffect(() => {
    if (Platform.OS === 'web') {
      initOneSignal().then(() => {
        if (typeof localStorage !== 'undefined' && !localStorage.getItem('score_push_asked')) {
          localStorage.setItem('score_push_asked', '1')
          requestPushPermission()
        }
      })
    }
  }, [])

  // AdMob SDK 初期化
  useEffect(() => {
    initAdmob().catch(() => {})
  }, [])


  const [fontsLoaded] = Font.useFonts({
    'Ionicons': require('../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf'),
  })
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
          <Stack.Screen name="calendar" options={{ title: 'カレンダー', headerStyle: { backgroundColor: '#000' }, headerTintColor: '#fff', headerTitleStyle: { color: '#fff', fontWeight: '800' } }} />
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
          <Stack.Screen
            name="privacy"
            options={{
              title: 'プライバシーポリシー',
              headerStyle: { backgroundColor: '#000' },
              headerTintColor: '#fff',
              headerTitleStyle: { color: '#fff', fontWeight: '800' },
            }}
          />
          <Stack.Screen
            name="terms"
            options={{
              title: '利用規約',
              headerStyle: { backgroundColor: '#000' },
              headerTintColor: '#fff',
              headerTitleStyle: { color: '#fff', fontWeight: '800' },
            }}
          />
          <Stack.Screen
            name="paywall"
            options={{ headerShown: false, presentation: 'modal' }}
          />
        </Stack>
      </AuthGate>
      <Toast />
      {showSplash && <SplashAnimation onFinish={() => setSplashDone(true)} />}
    </SafeAreaProvider>
  )
}

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <PurchaseProvider>
            <RootLayoutNav />
          </PurchaseProvider>
        </AuthProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  )
}

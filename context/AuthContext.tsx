// context/AuthContext.tsx — 認証状態グローバル管理

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { syncAll } from '../lib/cloudSync'
import Toast from 'react-native-toast-message'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import * as AuthSession from 'expo-auth-session'
import * as AppleAuthentication from 'expo-apple-authentication'

// expo-web-browser の結果を Supabase が処理できるよう登録
// iOS 26 で稀に throw するため try-catch で保護
try { WebBrowser.maybeCompleteAuthSession() } catch {}

const ONBOARDING_KEY = 'tm_onboarded'

// 現在のオリジンを使う（localhost / Vercel / その他デプロイ先すべてに対応）
const SITE_URL = typeof window !== 'undefined' && window.location?.origin
  ? window.location.origin
  : 'https://scorej-run.vercel.app'

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
          const { error } = await (supabase.auth as any).exchangeCodeForSession(url)
          if (error) {
            // フォールバック: URL から code だけ抽出して再試行
            const codeMatch = url.match(/[?&]code=([^&\s]+)/)
            const code = codeMatch ? decodeURIComponent(codeMatch[1]) : null
            if (code) {
              await (supabase.auth as any).exchangeCodeForSession(code).catch(() => {})
            }
          }
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

  // ── Google OAuth ──────────────────────────────────────────
  const signInWithGoogle = useCallback(async () => {
    try {
      if (Platform.OS === 'web') {
        // Web: skipBrowserRedirect: true で URL を取得し手動リダイレクト（環境依存を排除）
        const { data, error } = await (supabase.auth as any).signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: SITE_URL,
            skipBrowserRedirect: true,
          },
        })
        if (error || !data?.url) {
          Toast.show({ type: 'error', text1: 'Googleログイン失敗', text2: error?.message ?? 'URL取得失敗' })
          return
        }
        if (typeof window !== 'undefined') {
          window.location.href = data.url
        }
        return
      }

      // Native: PKCE + in-app browser
      // score://auth-callback は Supabase の Redirect URLs に登録が必要
      const redirectTo = 'score://auth-callback'
      console.log('[Google OAuth] redirectTo:', redirectTo)

      // iOS でブラウザセッションを事前ウォームアップ
      try { await WebBrowser.warmUpAsync() } catch {}

      const { data, error } = await (supabase.auth as any).signInWithOAuth({
        provider: 'google',
        options:  { redirectTo, skipBrowserRedirect: true },
      })
      if (error || !data?.url) {
        const msg = error?.message ?? 'OAuth URL取得失敗'
        console.log('[Google OAuth] Step1 error:', msg)
        Toast.show({ type: 'error', text1: 'Googleログイン失敗', text2: msg, visibilityTime: 5000 })
        try { await WebBrowser.coolDownAsync() } catch {}
        return
      }
      console.log('[Google OAuth] URL取得成功, ブラウザを開きます')
      if (__DEV__) console.log('[Google OAuth] OAuth URL取得成功')

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
      if (__DEV__) console.log('[Google OAuth] browser result type:', result.type)
      if (result.type !== 'success' || !result.url) {
        if (result.type === 'cancel' || result.type === 'dismiss') {
          // ユーザーがキャンセルした場合は何もしない
          try { await WebBrowser.coolDownAsync() } catch {}
          return
        }
        Toast.show({ type: 'error', text1: 'Googleログイン失敗 [Step2]', text2: `ブラウザ結果: ${result.type}`, visibilityTime: 5000 })
        try { await WebBrowser.coolDownAsync() } catch {}
        return
      }
      try { await WebBrowser.coolDownAsync() } catch {}

      const { error: exchError } = await (supabase.auth as any).exchangeCodeForSession(result.url)
      if (exchError) {
        if (__DEV__) console.log('[Google OAuth] exchangeCode error:', exchError.message)
        // フォールバック1: URL から code だけ抜き取って再試行（カスタムスキームの URL パース失敗対策）
        try {
          const codeMatch = result.url.match(/[?&]code=([^&\s]+)/)
          const code = codeMatch ? decodeURIComponent(codeMatch[1]) : null
          if (code) {
            const { error: retryError } = await (supabase.auth as any).exchangeCodeForSession(code)
            if (!retryError) {
              if (__DEV__) console.log('[Google OAuth] exchangeCode retry success')
              return   // 成功 → onAuthStateChange が呼ばれるのでここで終了
            }
            if (__DEV__) console.log('[Google OAuth] retry error:', retryError.message)
          }
        } catch (retryEx: any) {
          if (__DEV__) console.log('[Google OAuth] retry exception:', retryEx?.message)
        }
        // フォールバック2: implicit flow のハッシュトークン（旧 Supabase 対応）
        try {
          const hash = result.url.split('#')[1] ?? ''
          const params = new URLSearchParams(hash)
          const accessToken = params.get('access_token')
          const refreshToken = params.get('refresh_token')
          if (accessToken && refreshToken) {
            await (supabase.auth as any).setSession({ access_token: accessToken, refresh_token: refreshToken })
            return
          }
        } catch {}
        Toast.show({ type: 'error', text1: 'Googleログイン失敗 [Step3]', text2: exchError.message, visibilityTime: 5000 })
      }
    } catch (e: any) {
      const msg = e?.message ?? 'エラーが発生しました'
      if (__DEV__) console.log('[Google OAuth] catch error:', msg)
      Toast.show({ type: 'error', text1: 'Googleログイン失敗', text2: msg, visibilityTime: 5000 })
    }
  }, [])

  // ── Apple Sign In ─────────────────────────────────────────
  const signInWithApple = useCallback(async () => {
    try {
      if (Platform.OS === 'ios') {
        // iOS: ネイティブ機能が利用可能か確認（Expo Go では使えない）
        let nativeAvailable = false
        try { nativeAvailable = await AppleAuthentication.isAvailableAsync() } catch {}

        if (nativeAvailable) {
          const credential = await AppleAuthentication.signInAsync({
            requestedScopes: [
              AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
              AppleAuthentication.AppleAuthenticationScope.EMAIL,
            ],
          })
          if (!credential.identityToken) {
            Toast.show({ type: 'error', text1: 'Appleログイン失敗', text2: 'トークンを取得できませんでした' })
            return
          }
          const { error } = await (supabase.auth as any).signInWithIdToken({
            provider: 'apple',
            token:    credential.identityToken,
          })
          if (error) Toast.show({ type: 'error', text1: 'Appleログイン失敗', text2: error.message })
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
          Toast.show({ type: 'error', text1: 'Appleログイン失敗', text2: error.message })
          return
        }
        if (data?.url && typeof window !== 'undefined') {
          window.location.href = data.url
        }
      } else {
        Toast.show({ type: 'info', text1: 'Appleログインは iOS のみ対応しています' })
      }
    } catch (e: any) {
      if (e?.code !== 'ERR_CANCELED') {
        Toast.show({ type: 'error', text1: 'Appleログイン失敗', text2: e?.message ?? 'エラーが発生しました' })
      }
    }
  }, [])

  // ── メール/パスワード ログイン ────────────────────────────
  const signInWithEmail = useCallback(async (email: string, password: string): Promise<boolean> => {
    try {
      const { data, error } = await (supabase.auth as any).signInWithPassword({ email, password })
      if (error) {
        const msg =
          error.message?.includes('Invalid login') || error.message?.includes('invalid_credentials')
            ? 'メールアドレスかパスワードが違います'
          : error.message?.includes('Email not confirmed')
            ? 'メールアドレスの認証が完了していません\n受信箱を確認してください'
          : error.message ?? 'ログインに失敗しました'
        Toast.show({ type: 'error', text1: 'ログイン失敗', text2: msg })
        return false
      }
      if (data?.session) {
        setSession(data.session)
        setUser(data.session.user)
        setIsGuest(false)
      }
      return true
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'ログイン失敗', text2: e?.message ?? 'エラーが発生しました' })
      return false
    }
  }, [])

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
              ? 'このメールアドレスは既に登録されています'
            : error.message?.includes('Password')
              ? 'パスワードは6文字以上にしてください'
            : error.message ?? '登録に失敗しました'
          Toast.show({ type: 'error', text1: '登録失敗', text2: msg })
          return false
        }
        // 確認メール不要（auto confirm ON）の場合は即ログイン
        if (data?.session) {
          setSession(data.session)
          setUser(data.session.user)
          setIsGuest(false)
          Toast.show({ type: 'success', text1: '登録完了！', text2: 'アカウントが作成されました' })
          return 'signed_in'
        }
        // 確認メール必要の場合
        Toast.show({
          type: 'success',
          text1: '確認メールを送信しました ✉️',
          text2: 'メールの認証リンクをクリックするとログインできます',
          visibilityTime: 5000,
        })
        return 'confirm_email'
      } catch (e: any) {
        Toast.show({ type: 'error', text1: '登録失敗', text2: e?.message ?? 'エラーが発生しました' })
        return false
      }
    },
    [],
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
          ? '送信制限中です（1時間に数回まで）\n迷惑メールフォルダも確認してください'
          : error.message ?? 'コードの送信に失敗しました'
        Toast.show({ type: 'error', text1: '送信失敗', text2: msg })
        return false
      }
      Toast.show({ type: 'success', text1: 'コードを送信しました ✉️', text2: 'メールに届いた6桁のコードを入力してください' })
      return true
    } catch (e: any) {
      Toast.show({ type: 'error', text1: '送信失敗', text2: e?.message ?? 'エラーが発生しました' })
      return false
    }
  }, [])

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
          ? 'コードの有効期限が切れています。再送してください'
          : error.message?.includes('invalid') || error.message?.includes('Invalid')
          ? 'コードが間違っています'
          : error.message ?? '認証に失敗しました'
        Toast.show({ type: 'error', text1: '認証失敗', text2: msg })
        return false
      }
      if (data?.session) {
        setSession(data.session)
        setUser(data.session.user)
        setIsGuest(false)
      }
      return true
    } catch (e: any) {
      Toast.show({ type: 'error', text1: '認証失敗', text2: e?.message ?? 'エラーが発生しました' })
      return false
    }
  }, [])

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
        Toast.show({ type: 'error', text1: '再送失敗', text2: error.message ?? 'しばらく待ってから再試行してください' })
        return false
      }
      Toast.show({ type: 'success', text1: '確認メールを再送しました ✉️', text2: '受信箱を確認してください' })
      return true
    } catch (e: any) {
      Toast.show({ type: 'error', text1: '再送失敗', text2: e?.message ?? 'エラーが発生しました' })
      return false
    }
  }, [])

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
    AsyncStorage.multiRemove(['score_access_code', 'trackmate_subscription']).catch(() => {})
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

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

// expo-web-browser の結果を Supabase が処理できるよう登録
WebBrowser.maybeCompleteAuthSession()

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

    const init = async () => {
      // 1) オンボーディング済みフラグ
      const ob = await AsyncStorage.getItem(ONBOARDING_KEY).catch(() => null)
      if (mounted) setIsOnboarded(ob === 'true')

      // 2) 既存セッション確認（URL ハッシュも含む）
      try {
        const { data } = await (supabase.auth as any).getSession()
        const s = data?.session ?? null
        if (mounted) {
          setSession(s)
          setUser(s?.user ?? null)
          // 起動時: 既存セッションがあればクラウド同期
          if (s?.user?.id) {
            syncAll(s.user.id).catch(() => {})
          }
        }
      } catch (_) {}

      if (mounted) setLoading(false)
    }

    init()

    // 3) セッション変更監視（メール確認後の自動ログインもここで拾う）
    let subscription: any
    try {
      const { data } = (supabase.auth as any).onAuthStateChange(
        async (event: string, newSession: any) => {
          if (!mounted) return
          setSession(newSession)
          setUser(newSession?.user ?? null)
          if (newSession) setIsGuest(false)

          if (event === 'SIGNED_IN' || event === 'EMAIL_CONFIRMED') {
            setLoading(false)
            // ログイン直後: クラウドとローカルを双方向マージ同期
            // （ゲストで使ったデータをクラウドへ移行 + 他デバイスのデータを取得）
            if (newSession?.user?.id) {
              syncAll(newSession.user.id).catch(() => {})
            }
          }
        },
      )
      subscription = data?.subscription
    } catch (_) {}

    return () => {
      mounted = false
      try { subscription?.unsubscribe() } catch (_) {}
    }
  }, [])

  // ── Google OAuth ──────────────────────────────────────────
  const signInWithGoogle = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') {
        // アプリのURLスキームへのリダイレクト URL（Supabase に登録が必要）
        const redirectTo = 'score:///auth-callback'
        const { data, error } = await (supabase.auth as any).signInWithOAuth({
          provider: 'google',
          options: { redirectTo, skipBrowserRedirect: true },
        })
        if (error) { Toast.show({ type: 'error', text1: 'Googleログイン失敗', text2: error.message }); return }
        if (data?.url) {
          // openAuthSessionAsync: ブラウザを開き、redirectTo スキームを検知したら自動で閉じる
          const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
          if (result.type === 'success' && result.url) {
            // URLからセッションを取得してログイン完了
            const { error: sessionError } = await (supabase.auth as any).exchangeCodeForSession(result.url)
            if (sessionError) {
              // PKCE失敗時は setSession を試みる（implicit flow フォールバック）
              const urlObj = new URL(result.url)
              const accessToken  = urlObj.searchParams.get('access_token')
                ?? result.url.split('access_token=')[1]?.split('&')[0]
              const refreshToken = urlObj.searchParams.get('refresh_token')
                ?? result.url.split('refresh_token=')[1]?.split('&')[0]
              if (accessToken && refreshToken) {
                await (supabase.auth as any).setSession({ access_token: accessToken, refresh_token: refreshToken })
              } else {
                Toast.show({ type: 'error', text1: 'Googleログイン失敗', text2: sessionError.message })
              }
            }
          } else if (result.type === 'cancel') {
            // ユーザーがキャンセル — 何もしない
          }
        }
      } else {
        // Web: 通常リダイレクト
        const { error } = await (supabase.auth as any).signInWithOAuth({
          provider: 'google',
          options: { redirectTo: SITE_URL },
        })
        if (error) Toast.show({ type: 'error', text1: 'Googleログイン失敗', text2: error.message })
      }
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Googleログイン失敗', text2: e?.message ?? 'エラーが発生しました' })
    }
  }, [])

  // ── Apple OAuth ───────────────────────────────────────────
  const signInWithApple = useCallback(async () => {
    try {
      const { error } = await (supabase.auth as any).signInWithOAuth({
        provider: 'apple',
        options: { redirectTo: SITE_URL },
      })
      if (error) Toast.show({ type: 'error', text1: 'Appleログイン失敗', text2: error.message })
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Appleログイン失敗', text2: e?.message ?? 'エラーが発生しました' })
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
        const { data, error } = await (supabase.auth as any).signUp({
          email,
          password,
          options: {
            emailRedirectTo: SITE_URL,
          },
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
      const { error } = await (supabase.auth as any).resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: SITE_URL },
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
    // ゲストはオンボーディング済みとして扱う（onboarding.tsx で別途処理）
  }, [])

  // ── ゲスト解除（設定画面の「ログイン」ボタン用） ─────────
  const signOutGuest = useCallback(() => {
    setIsGuest(false)
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

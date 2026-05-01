import { useEffect, useState } from 'react'
import { Platform, View, ActivityIndicator, TouchableOpacity } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import Toast from 'react-native-toast-message'
import * as Font from 'expo-font'
import * as SplashScreen from 'expo-splash-screen'
import { Ionicons } from '@expo/vector-icons'
import { AuthProvider, useAuth } from '../context/AuthContext'
import { ThemeProvider } from '../context/ThemeContext'
import { PurchaseProvider } from '../context/PurchaseContext'
import SplashAnimation from '../components/SplashAnimation'
import { initOneSignal, requestPushPermission } from '../lib/notify'

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
          // 新バージョン検知 → 自動リロード
          window.location.reload()
        }
      })
    })
  }).catch(() => {})
}

const MIN_SPLASH_MS = 2200

// 認証ガード — 未ログイン・未ゲスト選択時は auth 画面へ
function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, isGuest, isOnboarded } = useAuth()
  const router   = useRouter()
  const segments = useSegments()

  useEffect(() => {
    if (loading) return

    const inAuth        = segments[0] === 'auth'
    const inOnboarding  = segments[0] === 'onboarding'
    const authed        = !!user || isGuest

    // 未認証 → /auth へ
    if (!authed && !inAuth) {
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
    if (authed && !isOnboarded && !inOnboarding) {
      router.replace('/onboarding')
      return
    }

    // オンボーディング済みでオンボーディングにいる → tabs
    if (authed && isOnboarded && inOnboarding) {
      router.replace('/(tabs)')
    }
  }, [user, loading, isGuest, isOnboarded, segments])

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#E53E3E" size="large" />
      </View>
    )
  }
  return <>{children}</>
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
    <ThemeProvider>
      <AuthProvider>
        <PurchaseProvider>
          <RootLayoutNav />
        </PurchaseProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

// app/auth.tsx — ログイン画面
// 価値提案カルーセル（旧Slide1-5）は app/onboarding.tsx に統合済み。
// ここはログイン手段の選択のみを行う（ロジック・ボタンの挙動は一切変更していない）。

import React, { useRef, useState } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform, ScrollView, Animated, Easing,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useAuth } from '../context/AuthContext'
import { BRAND, TEXT } from '../lib/theme'
import { Sounds, unlockAudio } from '../lib/sounds'

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
  const { signInWithGoogle, signInWithApple, continueAsGuest } = useAuth()
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading,  setAppleLoading]  = useState(false)

  const isInAppBrowser = typeof navigator !== 'undefined' &&
    /Instagram|FBAN|FBAV|Twitter|Line|MicroMessenger|GSA/i.test(navigator.userAgent)

  const handleGoogle = () => {
    if (isInAppBrowser) {
      alert('Googleログインはアプリ内ブラウザでは使用できません。\n\nSafari（または Chrome）でこのページを開いてからログインしてください。\n\n右下の「...」→「Safariで開く」をタップしてください。')
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
            <Text style={sl.tag}>GET STARTED</Text>
            <Text style={[sl.sectionTitle, { textAlign: 'center', fontSize: 28 }]}>無料で始める</Text>
            <Text style={[sl.sectionSub, { textAlign: 'center' }]}>登録無料・クレジットカード不要</Text>
          </Animated.View>

          <Animated.View style={[{ width: '100%' }, google]}>
            <TouchableOpacity style={lg.googleBtn} onPress={handleGoogle} disabled={googleLoading} activeOpacity={0.85}>
              {googleLoading ? <ActivityIndicator color="#111" size="small" /> : (
                <>
                  <View style={lg.gIconWrap}><Text style={lg.gIconText}>G</Text></View>
                  <Text style={lg.googleText}>Google でログイン</Text>
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
                    <Text style={lg.appleBtnText}>Apple でログイン</Text>
                  </>
                )}
              </TouchableOpacity>
            </Animated.View>
          )}

          <Animated.View style={[{ width: '100%' }, guest]}>
            <TouchableOpacity style={lg.guestBtn} onPress={() => { unlockAudio(); Sounds.tap(); continueAsGuest() }} activeOpacity={0.7}>
              <Ionicons name="person-outline" size={16} color={TEXT.hint} />
              <Text style={lg.guestText}>ゲストとして続ける</Text>
            </TouchableOpacity>
            <Text style={lg.footer}>
              {'ログインすることで '}
              <Text style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/terms' as any)}>利用規約</Text>
              {' と '}
              <Text style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/privacy' as any)}>プライバシーポリシー</Text>
              {'に同意したことになります'}
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

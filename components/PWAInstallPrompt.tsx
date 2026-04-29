// components/PWAInstallPrompt.tsx
// Android Chrome / Desktop Chrome の beforeinstallprompt をキャッチして
// ホーム画面追加バナーを表示する（Web 環境のみ動作）

import React, { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

const DISMISSED_KEY = 'pwa_dismissed'

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [visible, setVisible] = useState(false)
  const slideAnim = React.useRef(new Animated.Value(120)).current

  useEffect(() => {
    // Web 以外では何もしない
    if (Platform.OS !== 'web') return
    if (typeof window === 'undefined') return

    // すでに非表示にした場合はスキップ
    try {
      if (localStorage.getItem(DISMISSED_KEY) === '1') return
    } catch { return }

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setVisible(true)
    }

    window.addEventListener('beforeinstallprompt', handler as EventListener)
    return () => window.removeEventListener('beforeinstallprompt', handler as EventListener)
  }, [])

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 80,
        friction: 10,
        useNativeDriver: true,
      }).start()
    } else {
      Animated.timing(slideAnim, {
        toValue: 120,
        duration: 250,
        useNativeDriver: true,
      }).start()
    }
  }, [visible, slideAnim])

  if (!visible || Platform.OS !== 'web') return null

  const handleInstall = async () => {
    if (!deferredPrompt) return
    try {
      await deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setVisible(false)
      }
    } catch { /* ignore */ }
    setDeferredPrompt(null)
  }

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch { /* ignore */ }
    setVisible(false)
  }

  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.iconWrap}>
        <Ionicons name="phone-portrait-outline" size={28} color="#fff" />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>ホーム画面に追加</Text>
        <Text style={styles.subtitle}>オフラインでも使えます</Text>
      </View>
      <TouchableOpacity style={styles.installBtn} onPress={handleInstall} activeOpacity={0.85}>
        <Text style={styles.installBtnText}>追加</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.laterBtn} onPress={handleDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.laterText}>あとで</Text>
      </TouchableOpacity>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#111',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    gap: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(229,57,53,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1, gap: 2 },
  title:    { color: '#fff', fontSize: 14, fontWeight: '700' },
  subtitle: { color: '#888', fontSize: 12 },
  installBtn: {
    backgroundColor: '#166534',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  installBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  laterBtn: { paddingHorizontal: 4 },
  laterText: { color: '#888', fontSize: 13 },
})

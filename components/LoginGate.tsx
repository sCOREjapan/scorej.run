// components/LoginGate.tsx — AI機能のログイン必須ゲート
import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'

interface LoginGateProps {
  children: React.ReactNode
  featureName?: string   // 例: "AI診断"
}

export default function LoginGate({ children, featureName = 'AI機能' }: LoginGateProps) {
  const [status, setStatus] = useState<'loading' | 'guest' | 'user'>('loading')
  const router = useRouter()

  useEffect(() => {
    AsyncStorage.getItem('userId').then(id => {
      const isGuest = !id || id.startsWith('guest_') || id === 'guest'
      setStatus(isGuest ? 'guest' : 'user')
    }).catch(() => setStatus('guest'))
  }, [])

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FF6B35" />
      </View>
    )
  }

  if (status === 'guest') {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Ionicons name="person-circle-outline" size={40} color="#FF6B35" />
          </View>

          <Text style={styles.title}>ログインが必要です</Text>
          <Text style={styles.subtitle}>
            {featureName}はログインユーザー専用の機能です。{'\n'}
            無料アカウントを作成してすべての機能を使いましょう。
          </Text>

          <TouchableOpacity
            style={styles.loginBtn}
            onPress={() => router.push('/login' as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="log-in-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.loginBtnText}>ログイン / 新規登録</Text>
          </TouchableOpacity>

          <Text style={styles.note}>
            登録は無料。メールアドレスだけでOK。
          </Text>
        </View>
      </View>
    )
  }

  return <>{children}</>
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8F8F8',
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8F8F8',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 6,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FFF3EE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
  },
  loginBtn: {
    backgroundColor: '#FF6B35',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginBottom: 14,
    shadowColor: '#FF6B35',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
  loginBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  note: {
    fontSize: 12,
    color: '#AAA',
    textAlign: 'center',
  },
})

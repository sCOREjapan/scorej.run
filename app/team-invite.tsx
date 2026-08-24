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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { useRouter } from 'expo-router'
import { BRAND, NEON, TEXT } from '../lib/theme'
import { Sounds } from '../lib/sounds'
import AnimatedSection from '../components/AnimatedSection'


const TEAM_KEY = 'trackmate_team'

function generateCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
    // React Native / Expo fallback
    const Clipboard = require('@react-native-clipboard/clipboard').default
    Clipboard.setString(text)
    return true
  } catch {
    return false
  }
}

export default function TeamInviteScreen() {
  const router = useRouter()
  const [myCode, setMyCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [copied, setCopied] = useState(false)

  // ── 自分のコードをロード or 生成 ────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(TEAM_KEY).then(raw => {
      if (raw) {
        try {
          const team = JSON.parse(raw)
          if (team.invite_code) {
            setMyCode(team.invite_code)
            return
          }
        } catch {}
      }
      setMyCode(generateCode())
    }).catch(() => {
      setMyCode(generateCode())
    })
  }, [])

  // ── コードを保存 ─────────────────────────────────────────────────
  const saveCode = useCallback(async (code: string) => {
    try {
      const raw = await AsyncStorage.getItem(TEAM_KEY)
      const team = raw ? JSON.parse(raw) : {}
      await AsyncStorage.setItem(TEAM_KEY, JSON.stringify({ ...team, invite_code: code }))
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (myCode) saveCode(myCode)
  }, [myCode, saveCode])

  // ── コピー ───────────────────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    Sounds.tap()
    const ok = await copyToClipboard(myCode)
    if (ok) {
      setCopied(true)
      Toast.show({ type: 'success', text1: 'コードをコピーしました' })
      setTimeout(() => setCopied(false), 2500)
    } else {
      Toast.show({ type: 'error', text1: 'コピーに失敗しました' })
    }
  }, [myCode])

  // ── 再生成 ───────────────────────────────────────────────────────
  const handleRegenerate = useCallback(() => {
    Sounds.whoosh()
    const code = generateCode()
    setMyCode(code)
    setCopied(false)
    Toast.show({ type: 'info', text1: '新しい招待コードを生成しました' })
  }, [])

  // ── 参加 ─────────────────────────────────────────────────────────
  const handleJoin = useCallback(async () => {
    const trimmed = joinCode.trim().toUpperCase()
    if (trimmed.length !== 6) {
      Toast.show({ type: 'error', text1: '6文字のコードを入力してください' })
      return
    }
    Sounds.save()
    try {
      const raw = await AsyncStorage.getItem(TEAM_KEY)
      const team = raw ? JSON.parse(raw) : {}
      await AsyncStorage.setItem(TEAM_KEY, JSON.stringify({ ...team, joined_code: trimmed }))
      Toast.show({ type: 'success', text1: `チーム「${trimmed}」に参加リクエストを送りました` })
      setJoinCode('')
    } catch {
      Toast.show({ type: 'error', text1: '参加処理に失敗しました' })
    }
  }, [joinCode])

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* ヘッダー */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => { Sounds.tap(); router.back() }} style={styles.backBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} accessibilityLabel="戻る">
              <Ionicons name="chevron-back" size={22} color={TEXT.primary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>チーム招待</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

            {/* ── 招待コード表示 ── */}
            <AnimatedSection delay={0} type="fade-up">
              <View style={styles.card}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="link" size={18} color={NEON.blue} />
                  <Text style={styles.sectionTitle}>あなたの招待コード</Text>
                </View>
                <Text style={styles.subText}>
                  このコードをチームメンバーに共有して、一緒に練習記録を管理しましょう
                </Text>

                {/* 大きなコード表示 */}
                <View style={styles.codeBox}>
                  <Text style={styles.codeText} selectable>{myCode}</Text>
                </View>

                {/* ボタン行 */}
                <View style={styles.btnRow}>
                  <TouchableOpacity
                    style={[styles.copyBtn, copied && { backgroundColor: NEON.green }]}
                    onPress={handleCopy}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name={copied ? 'checkmark-circle' : 'copy-outline'}
                      size={18}
                      color="#fff"
                    />
                    <Text style={styles.copyBtnText}>
                      {copied ? 'コピー済み' : 'コピー'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.regenBtn}
                    onPress={handleRegenerate}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="refresh-outline" size={16} color={TEXT.secondary} />
                    <Text style={styles.regenBtnText}>再生成</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </AnimatedSection>

            {/* ── 招待コードで参加 ── */}
            <AnimatedSection delay={120} type="fade-up">
              <View style={styles.card}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="people" size={18} color={NEON.green} />
                  <Text style={styles.sectionTitle}>招待コードで参加</Text>
                </View>
                <Text style={styles.subText}>
                  チームリーダーから共有された6文字のコードを入力してください
                </Text>

                <TextInput
                  style={styles.codeInput}
                  value={joinCode}
                  onChangeText={text => setJoinCode(text.toUpperCase().slice(0, 6))}
                  placeholder="例: AB12CD"
                  placeholderTextColor={TEXT.hint}
                  autoCapitalize="characters"
                  maxLength={6}
                  autoCorrect={false}
                />

                <TouchableOpacity
                  style={[styles.joinBtn, joinCode.length !== 6 && { opacity: 0.5 }]}
                  onPress={handleJoin}
                  activeOpacity={0.85}
                  disabled={joinCode.length !== 6}
                >
                  <Ionicons name="person-add-outline" size={18} color="#fff" />
                  <Text style={styles.joinBtnText}>チームに参加する</Text>
                </TouchableOpacity>
              </View>
            </AnimatedSection>

            {/* 説明 */}
            <AnimatedSection delay={240} type="fade">
              <View style={styles.infoBox}>
                <Ionicons name="information-circle-outline" size={16} color={TEXT.hint} />
                <Text style={styles.infoText}>
                  招待コードはページを開いている間のみ有効です。リアルタイム同期はサーバー連携後に利用可能になります。
                </Text>
              </View>
            </AnimatedSection>

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
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: TEXT.primary, fontSize: 18, fontWeight: '800' },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  card: {
    backgroundColor: '#111111',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 20,
    gap: 14,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  subText: { color: TEXT.secondary, fontSize: 13, lineHeight: 20 },

  // コード表示
  codeBox: {
    backgroundColor: 'rgba(74,159,255,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(74,159,255,0.3)',
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  codeText: {
    color: '#fff',
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: 8,
  },
  btnRow: { flexDirection: 'row', gap: 10 },
  copyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1c1c1e',
    borderRadius: 50,
    paddingVertical: 15,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 5,
  },
  copyBtnText: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
  regenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  regenBtnText: { color: TEXT.secondary, fontSize: 13, fontWeight: '600' },

  // 参加
  codeInput: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(74,159,255,0.3)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center',
  },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: NEON.green,
    borderRadius: 12,
    paddingVertical: 16,
  },
  joinBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // 情報
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 14,
  },
  infoText: { color: TEXT.hint, fontSize: 12, lineHeight: 18, flex: 1 },
})

// app/settings.tsx — 設定画面

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Switch, Alert, TextInput, Platform, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter } from 'expo-router'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'

import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { usePurchase } from '../context/PurchaseContext'
import AnimatedSection from '../components/AnimatedSection'
import { requestPermission, getPermission, startAllSchedulers } from '../lib/notifications'
import { checkAdGate, recordUsage } from '../lib/adGate'
import AdGateModal from '../components/AdGateModal'
import { trackFeatureUse } from '../lib/analytics'

const PROFILE_KEY   = 'trackmate_my_profile'
const NOTIF_KEY     = 'trackmate_notif_settings'
const TEAM_ROLE_KEY = 'trackmate_team_role'
const TEAM_SETUP_KEY   = 'trackmate_team_setup'
const TEAM_JOINED_KEY  = 'trackmate_team_joined'

const EVENTS = [
  '100m', '200m', '400m', '800m', '1500m', '5000m', '10000m',
  'ハーフ', 'マラソン', '走幅跳', '三段跳', '棒高跳', '走高跳',
  '砲丸投', '円盤投', 'やり投', 'ハンマー投', '400mH', '110mH', '100mH', '3000mSC', '競歩',
]

interface Profile {
  name: string
  event: string
  age: string
  club: string
}

interface NotifSettings {
  practiceReminder: boolean
  raceReminder: boolean
}

// CSV エクスポート（Web のみ）
async function exportCSV() {
  try {
    const [sessionsRaw, racesRaw] = await Promise.all([
      AsyncStorage.getItem('trackmate_sessions'),
      AsyncStorage.getItem('trackmate_race_records'),
    ])

    const sessions: any[] = sessionsRaw ? JSON.parse(sessionsRaw) : []
    const races: any[]    = racesRaw    ? JSON.parse(racesRaw)    : []

    let csv = 'type,id,date,event,value,note\n'

    sessions.forEach((s: any) => {
      const row = [
        'session',
        s.id ?? '',
        s.session_date ?? '',
        s.session_type ?? '',
        s.distance_m != null ? `${s.distance_m}m` : s.time_ms != null ? `${s.time_ms}ms` : '',
        (s.notes ?? '').replace(/,/g, '、'),
      ]
      csv += row.join(',') + '\n'
    })

    races.forEach((r: any) => {
      const row = [
        'race',
        r.id ?? '',
        r.race_date ?? '',
        r.event ?? '',
        r.time_ms != null ? `${r.time_ms}ms` : r.result ?? '',
        (r.memo ?? '').replace(/,/g, '、'),
      ]
      csv += row.join(',') + '\n'
    })

    const filename = `score_${new Date().toISOString().slice(0, 10)}.csv`

    if (typeof document !== 'undefined') {
      // Web: ダウンロードリンクを生成
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } else {
      // Native: ファイルに書き込んで共有シートを開く
      const path = (FileSystem.cacheDirectory ?? '') + filename
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'CSVをエクスポート' })
      } else {
        Alert.alert('完了', `${filename} を保存しました`)
      }
    }
  } catch (e) {
    Alert.alert('エラー', 'エクスポートに失敗しました')
  }
}

// ── セクション見出し付きカード ──────────────────────────────
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  )
}

// ── ラベル付き入力フィールド ────────────────────────────────
function LabeledInput({
  label, value, onChangeText, placeholder, keyboardType = 'default',
}: {
  label: string
  value: string
  onChangeText: (v: string) => void
  placeholder?: string
  keyboardType?: 'default' | 'numeric'
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, { outlineStyle: 'none' } as any]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? ''}
        placeholderTextColor="#9ca3af"
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  )
}

// ── メイン設定画面 ─────────────────────────────────────────
export default function SettingsScreen() {
  const { user, signOut, isGuest, signOutGuest } = useAuth()
  const { colors } = useTheme()
  const { tier, isPro, isElite, isCoach, isCoachPro, expiresAt } = usePurchase()
  const router = useRouter()

  // プロフィール
  const [profile, setProfile] = useState<Profile>({ name: '', event: '', age: '', club: '' })

  // CSV AdGate
  const [csvGateVisible,     setCsvGateVisible]     = useState(false)
  const [csvGateRemaining,   setCsvGateRemaining]   = useState(0)
  const [csvGateHardLimited, setCsvGateHardLimited] = useState(false)
  const [csvGateLimitType,   setCsvGateLimitType]   = useState<'none'|'daily'|'monthly'|'total'>('none')

  // チームロール
  const [teamRole, setTeamRole] = useState<string | null>(null)
  useEffect(() => {
    AsyncStorage.getItem(TEAM_ROLE_KEY).then(v => setTeamRole(v)).catch(() => {})
  }, [])

  // 通知
  const [notifSettings, setNotifSettings] = useState<NotifSettings>({
    practiceReminder: false,
    raceReminder: false,
  })

  // 読み込み
  useEffect(() => {
    AsyncStorage.getItem(PROFILE_KEY).then(v => {
      if (v) {
        try {
          const p = JSON.parse(v)
          setProfile({ name: p.name ?? '', event: p.event ?? '', age: p.age != null ? String(p.age) : '', club: p.club ?? '' })
        } catch {}
      }
    }).catch(() => {})

    AsyncStorage.getItem(NOTIF_KEY).then(v => {
      if (v) { try { setNotifSettings(JSON.parse(v)) } catch {} }
    }).catch(() => {})
  }, [])

  // プロフィール保存
  const saveProfile = async () => {
    const toSave = {
      name:  profile.name,
      event: profile.event,
      age:   profile.age ? Number(profile.age) : null,
      club:  profile.club,
    }
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(toSave)).catch(() => {})
    Alert.alert('保存しました')
  }

  // 通知トグル
  const toggleNotif = (key: keyof NotifSettings, value: boolean) => {
    const next = { ...notifSettings, [key]: value }
    setNotifSettings(next)
    AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(next)).catch(() => {})
  }

  // ログアウト
  const handleSignOut = () => {
    const doSignOut = async () => {
      try {
        // signOut() が user=null をセット → AuthGate が /auth へ自動リダイレクト
        await signOut()
      } catch (_) {
        // エラーが起きても強制的にサインアウト状態にする
        try { router.replace('/auth') } catch {}
      }
    }
    if (typeof window !== 'undefined') {
      if (window.confirm('ログアウトしますか？')) {
        doSignOut()
      }
    } else {
      Alert.alert(
        'ログアウト',
        'ログアウトしますか？',
        [
          { text: 'キャンセル', style: 'cancel' },
          { text: 'ログアウト', style: 'destructive', onPress: doSignOut },
        ]
      )
    }
  }

  // ── 通知・位置情報の許可状態 ──────────────────────────────
  const [notifPerm, setNotifPerm] = useState<string>('loading')
  const [locPerm,   setLocPerm]   = useState<string>('loading')

  useEffect(() => {
    // 通知許可状態（SSR安全）
    if (typeof window !== 'undefined') {
      const p = getPermission()
      setNotifPerm(p)
    } else {
      setNotifPerm('unsupported')
    }

    // 位置情報許可状態
    if (Platform.OS !== 'web') {
      // ネイティブ: expo-location で確認
      ;(async () => {
        try {
          const Location = await import('expo-location')
          const { status } = await Location.getForegroundPermissionsAsync()
          setLocPerm(status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'prompt')
        } catch {
          setLocPerm('prompt')
        }
      })()
    } else if (typeof navigator !== 'undefined' && navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' as PermissionName }).then(r => {
        setLocPerm(r.state)                    // 'granted' | 'denied' | 'prompt'
        r.onchange = () => setLocPerm(r.state)
      }).catch(() => setLocPerm('prompt'))     // APIなし → ボタン表示
    } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
      setLocPerm('prompt')                     // geolocationはあるがPermissions APIなし
    } else {
      setLocPerm('unsupported')
    }
  }, [])

  const handleRequestNotifPerm = useCallback(async () => {
    // iOS Safari (非PWA) は Notification API 非対応
    if (typeof window === 'undefined' || !('Notification' in window)) {
      Alert.alert(
        '通知を使うにはホーム画面に追加してください',
        'iPhoneの場合、Safariで「共有ボタン → ホーム画面に追加」をすると通知が利用できます。',
      )
      return
    }
    const result = await requestPermission()
    setNotifPerm(result as string)
    if (result === 'granted') {
      startAllSchedulers()
      Alert.alert('通知をONにしました 🎉', '練習・睡眠リマインダーと怪我リスクアラートをお届けします。')
    } else if (result === 'denied') {
      Alert.alert(
        '通知が拒否されています',
        'ブラウザの設定から通知を許可してください。\niPhone: 設定 → Safari → 詳細 → 通知',
      )
    }
  }, [])

  const handleRequestLocationPerm = useCallback(async () => {
    if (Platform.OS !== 'web') {
      // ネイティブ: expo-location で許可リクエスト
      try {
        const Location = await import('expo-location')
        if (locPerm === 'denied') {
          // 拒否済み → システム設定を開く
          Alert.alert(
            '位置情報が拒否されています',
            'iPhoneの「設定」→「sCORE」→「位置情報」→「このAppの使用中」を選択してください。',
            [
              { text: 'キャンセル', style: 'cancel' },
              { text: '設定を開く', onPress: () => Linking.openSettings() },
            ]
          )
          return
        }
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status === 'granted') {
          setLocPerm('granted')
          Alert.alert('位置情報をONにしました ✅', '天気情報を自動取得してリスクスコアに反映します。')
        } else {
          setLocPerm('denied')
        }
      } catch {
        Alert.alert('エラー', '位置情報の許可に失敗しました。')
      }
      return
    }

    // Web
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      Alert.alert('非対応', 'このブラウザは位置情報に対応していません。')
      return
    }
    navigator.geolocation.getCurrentPosition(
      () => {
        setLocPerm('granted')
        Alert.alert('位置情報をONにしました ✅', '天気情報を自動取得してリスクスコアに反映します。')
      },
      (err) => {
        if (err.code === 1) {
          setLocPerm('denied')
          Alert.alert('位置情報が拒否されています', 'ブラウザの「設定」→「サイトの設定」→「位置情報」から許可してください。')
        } else {
          Alert.alert('位置情報の取得に失敗しました', err.message)
        }
      },
      { enableHighAccuracy: false, timeout: 10000 }
    )
  }, [locPerm])

  // 全データリセット（AsyncStorage + FileSystem + ログアウト）
  const handleClearCache = async () => {
    const doReset = async () => {
      // 1. AsyncStorage を全消去
      await AsyncStorage.clear().catch(() => {})
      // 2. FileSystem キャッシュディレクトリを削除
      if (Platform.OS !== 'web') {
        try {
          const cacheDir = FileSystem.cacheDirectory
          if (cacheDir) {
            const items = await FileSystem.readDirectoryAsync(cacheDir).catch(() => [] as string[])
            await Promise.all(items.map(f => FileSystem.deleteAsync(cacheDir + f, { idempotent: true }).catch(() => {})))
          }
        } catch {}
      }
      // 3. ログアウトしてログイン画面へ
      await signOut().catch(() => {})
    }

    if (Platform.OS === 'web') {
      const ok = window.confirm('全データをリセットしますか？\n練習記録・プロフィール・設定がすべて削除されます。この操作は取り消せません。')
      if (!ok) return
      await doReset()
      if ('caches' in window) {
        const keys = await caches.keys().catch(() => [] as string[])
        await Promise.all(keys.map(k => caches.delete(k))).catch(() => {})
      }
      window.location.reload()
    } else {
      Alert.alert(
        '全データをリセット',
        '練習記録・プロフィール・チーム情報・設定がすべて削除されます。\n\nこの操作は取り消せません。',
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: 'すべて削除', style: 'destructive',
            onPress: async () => {
              await doReset()
            },
          },
        ]
      )
    }
  }

  // CSV エクスポート（AdGate付き）
  const handleExportCSV = async () => {
    if (isGuest) {
      setCsvGateRemaining(0)
      setCsvGateHardLimited(false)
      setCsvGateVisible(true)
      return
    }
    const gate = await checkAdGate('csv')
    if (gate.remaining === 0) {
      setCsvGateRemaining(0)
      setCsvGateHardLimited(gate.hardLimited)
      setCsvGateLimitType(gate.limitType)
      setCsvGateVisible(true)
      return
    }
    if (gate.remaining === 1) {
      setCsvGateRemaining(1)
      setCsvGateVisible(true)
      return
    }
    await recordUsage('csv')
    trackFeatureUse('csv')
    await exportCSV()
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── プラン ────────────────────────────────────────── */}
          <AnimatedSection delay={0}>
            <View style={[styles.card, isPro ? { borderWidth: 1.5, borderColor: '#166534' } : {}]}>
              <Text style={styles.cardTitle}>プラン</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{
                    backgroundColor: isCoachPro ? '#d9770622' : isCoach ? '#16653422' : isElite ? '#f59e0b22' : isPro ? '#16653422' : '#6b728022',
                    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
                  }}>
                    <Text style={{
                      color: isCoachPro ? '#d97706' : isCoach ? '#166534' : isElite ? '#f59e0b' : isPro ? '#166534' : '#6b7280',
                      fontSize: 13, fontWeight: '800',
                    }}>
                      {isCoachPro ? '🏆 チームPro' : isCoach ? '📋 コーチ' : isElite ? '👑 ELITE' : isPro ? '✦ PRO' : 'FREE'}
                    </Text>
                  </View>
                  {expiresAt && (
                    <Text style={{ color: '#9ca3af', fontSize: 11 }}>
                      {new Date(expiresAt).toLocaleDateString('ja-JP')}まで
                    </Text>
                  )}
                </View>
                {!isPro && (
                  <TouchableOpacity
                    style={{ backgroundColor: '#166534', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}
                    onPress={() => router.push('/paywall')}
                    activeOpacity={0.85}
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>アップグレード</Text>
                  </TouchableOpacity>
                )}
              </View>
              {!isPro && (
                <Text style={{ color: '#9ca3af', fontSize: 12, marginTop: 10, lineHeight: 18 }}>
                  PRO（¥480/月）でAI練習分析・動画フォーム分析が月30回{'\n'}
                  ELITE（¥980/月）でAI機能完全無制限{'\n'}
                  コーチ・チーム管理はコーチプラン（¥2,980〜）
                </Text>
              )}
              {/* クーポンコード入力 */}
              {!isPro && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}
                  onPress={() => router.push('/coupon')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="ticket-outline" size={14} color="#9ca3af" />
                  <Text style={{ color: '#9ca3af', fontSize: 12, textDecorationLine: 'underline' }}>
                    クーポンコードをお持ちの方はこちら
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </AnimatedSection>

          {/* ── プロフィール ───────────────────────────────────── */}
          <AnimatedSection delay={40}>
            <SectionCard title="プロフィール">
              <LabeledInput
                label="名前"
                value={profile.name}
                onChangeText={v => setProfile(p => ({ ...p, name: v }))}
                placeholder="田中 太郎"
              />
              <View style={styles.divider} />

              {/* 種目タグ */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>種目</Text>
              </View>
              <View style={styles.tagWrap}>
                {EVENTS.map(ev => {
                  const active = profile.event === ev
                  return (
                    <TouchableOpacity
                      key={ev}
                      style={[styles.tag, active ? styles.tagActive : styles.tagInactive]}
                      onPress={() => setProfile(p => ({ ...p, event: p.event === ev ? '' : ev }))}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.tagText, active && { color: '#fff' }]}>{ev}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>

              <View style={styles.divider} />
              <LabeledInput
                label="年齢"
                value={profile.age}
                onChangeText={v => setProfile(p => ({ ...p, age: v.replace(/[^0-9]/g, '') }))}
                placeholder="20"
                keyboardType="numeric"
              />
              <View style={styles.divider} />
              <LabeledInput
                label="所属"
                value={profile.club}
                onChangeText={v => setProfile(p => ({ ...p, club: v }))}
                placeholder="〇〇陸上クラブ"
              />

              <TouchableOpacity style={styles.saveBtn} onPress={saveProfile} activeOpacity={0.85}>
                <Text style={styles.saveBtnText}>保存する</Text>
              </TouchableOpacity>
            </SectionCard>
          </AnimatedSection>

          {/* ── アカウント ─────────────────────────────────────── */}
          <AnimatedSection delay={80}>
            <SectionCard title="アカウント">
              {isGuest ? (
                /* ゲスト → ログイン誘導 */
                <>
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>ステータス</Text>
                    <View style={{ backgroundColor: '#FF9500' + '22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: '#FF9500', fontSize: 12, fontWeight: '800' }}>ゲスト</Text>
                    </View>
                  </View>
                  <View style={styles.divider} />
                  <TouchableOpacity
                    style={[styles.actionRow, { backgroundColor: '#166534' + '12', borderRadius: 12, marginTop: 4 }]}
                    onPress={() => signOutGuest()}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="log-in-outline" size={18} color="#166534" />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.actionText, { color: '#166534', fontWeight: '800' }]}>アカウントを作成 / ログイン</Text>
                      <Text style={{ color: colors.textHint, fontSize: 11, marginTop: 2 }}>データをクラウドに保存できます</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#166534" />
                  </TouchableOpacity>
                </>
              ) : (
                /* ログイン済み */
                <>
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>メールアドレス</Text>
                    <Text style={styles.fieldValue} numberOfLines={1}>
                      {user?.email ?? '—'}
                    </Text>
                  </View>
                  <View style={styles.divider} />
                  <TouchableOpacity style={styles.dangerRow} onPress={handleSignOut} activeOpacity={0.75}>
                    <Ionicons name="log-out-outline" size={18} color="#E53935" />
                    <Text style={styles.dangerText}>ログアウト</Text>
                  </TouchableOpacity>
                </>
              )}
            </SectionCard>
          </AnimatedSection>

          {/* ── チーム設定 ────────────────────────────────────── */}
          <AnimatedSection delay={120}>
            <SectionCard title="チーム設定">
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>現在のロール</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {teamRole === 'coach' && (
                    <View style={{ backgroundColor: '#166534' + '20', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ color: '#166534', fontSize: 12, fontWeight: '700' }}>コーチ・監督</Text>
                    </View>
                  )}
                  {teamRole === 'player' && (
                    <View style={{ backgroundColor: '#34C759' + '20', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ color: '#34C759', fontSize: 12, fontWeight: '700' }}>選手</Text>
                    </View>
                  )}
                  {!teamRole && <Text style={styles.fieldValue}>未設定</Text>}
                </View>
              </View>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.actionRow}
                activeOpacity={0.75}
                onPress={async () => {
                  const doSwitch = async () => {
                    await AsyncStorage.multiRemove([TEAM_ROLE_KEY, TEAM_SETUP_KEY, TEAM_JOINED_KEY]).catch(() => {})
                    setTeamRole(null)
                    router.push('/(tabs)/team')
                  }
                  if (typeof window !== 'undefined') {
                    if (window.confirm('チームのロール設定をリセットします。チームタブで再設定できます。')) doSwitch()
                  } else {
                    Alert.alert('ロールを切り替え', 'チームのロール設定をリセットします。', [
                      { text: 'キャンセル', style: 'cancel' },
                      { text: 'リセット', style: 'destructive', onPress: doSwitch },
                    ])
                  }
                }}
              >
                <Ionicons name="swap-horizontal-outline" size={18} color="#6b7280" />
                <Text style={styles.actionText}>コーチ ↔ 選手を切り替え</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </TouchableOpacity>
            </SectionCard>
          </AnimatedSection>

          {/* ── アクセス許可 & 通知 ──────────────────────────── */}
          <AnimatedSection delay={160}>
            <SectionCard title="アクセス許可 & 通知">

              {/* ── 位置情報 ── */}
              <View style={styles.permRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <View style={[styles.permIcon, { backgroundColor: 'rgba(90,200,250,0.12)' }]}>
                    <Ionicons name="location-outline" size={20} color="#5AC8FA" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.permTitle}>位置情報</Text>
                    <Text style={styles.permSub}>
                      {locPerm === 'granted'     ? '✅ 許可済み — 天気自動取得ON'
                       : locPerm === 'denied'    ? '🚫 拒否済み — 設定から変更'
                       : locPerm === 'unsupported' ? '非対応ブラウザ'
                       : '未設定 — 天気でリスクを補正'}
                    </Text>
                  </View>
                </View>
                {locPerm !== 'granted' && (
                  <TouchableOpacity
                    style={[styles.permBtn, locPerm === 'denied' && { backgroundColor: '#f0f2f5' }]}
                    onPress={handleRequestLocationPerm}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.permBtnText, locPerm === 'denied' && { color: '#6b7280' }]}>
                      {locPerm === 'denied' ? '設定を開く' : '許可する'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.divider} />

              {/* ── プッシュ通知 ── */}
              <View style={styles.permRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <View style={[styles.permIcon, { backgroundColor: 'rgba(22,101,52,0.12)' }]}>
                    <Ionicons name="notifications-outline" size={20} color="#166534" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.permTitle}>プッシュ通知</Text>
                    <Text style={styles.permSub}>
                      {notifPerm === 'granted'     ? '✅ 許可済み — 通知ON'
                       : notifPerm === 'denied'    ? '🚫 拒否済み — 設定から変更'
                       : notifPerm === 'unsupported' ? '非対応ブラウザ'
                       : '未設定 — リスク・睡眠・練習通知'}
                    </Text>
                  </View>
                </View>
                {notifPerm !== 'granted' && notifPerm !== 'loading' && (
                  <TouchableOpacity
                    style={[styles.permBtn, notifPerm === 'denied' && { backgroundColor: '#f0f2f5' }]}
                    onPress={handleRequestNotifPerm}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.permBtnText, notifPerm === 'denied' && { color: '#6b7280' }]}>
                      {notifPerm === 'denied' ? '設定を開く' : '許可する'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.divider} />

              {/* 通知スケジュール説明 */}
              <View style={{ gap: 6, paddingTop: 4 }}>
                {[
                  { time: '17:00', label: '練習記録リマインダー', icon: '📝' },
                  { time: '20:00', label: '睡眠リマインダー',     icon: '💤' },
                  { time: 'リアルタイム', label: '怪我リスクアラート',  icon: '🔴' },
                  { time: '大会前',    label: '大会リマインダー',   icon: '🏆' },
                ].map(item => (
                  <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 14 }}>{item.icon}</Text>
                    <Text style={{ color: '#6b7280', fontSize: 12, flex: 1 }}>{item.label}</Text>
                    <Text style={{ color: '#9ca3af', fontSize: 11, fontWeight: '600' }}>{item.time}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.divider} />

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>練習リマインダー (17時)</Text>
                <Switch
                  value={notifSettings.practiceReminder}
                  onValueChange={v => toggleNotif('practiceReminder', v)}
                  trackColor={{ false: '#e5e7eb', true: '#166534' }}
                  thumbColor="#fff"
                  ios_backgroundColor="#e5e7eb"
                />
              </View>
              <View style={styles.divider} />
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>大会リマインダー</Text>
                <Switch
                  value={notifSettings.raceReminder}
                  onValueChange={v => toggleNotif('raceReminder', v)}
                  trackColor={{ false: '#e5e7eb', true: '#166534' }}
                  thumbColor="#fff"
                  ios_backgroundColor="#e5e7eb"
                />
              </View>
            </SectionCard>
          </AnimatedSection>

          {/* ── データ ───────────────────────────────────────── */}
          <AnimatedSection delay={240}>
            <SectionCard title="データ">
              <TouchableOpacity
                style={styles.actionRow}
                onPress={handleExportCSV}
                activeOpacity={0.75}
              >
                <Ionicons name="download-outline" size={18} color="#6b7280" />
                <Text style={styles.actionText}>記録をCSVでエクスポート</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </TouchableOpacity>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.actionRow}
                onPress={handleClearCache}
                activeOpacity={0.75}
              >
                <Ionicons name="trash-outline" size={18} color="#E53935" />
                <Text style={[styles.actionText, { color: '#E53935' }]}>全データをリセット</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </TouchableOpacity>
            </SectionCard>
          </AnimatedSection>

          {/* ── アプリ情報 ────────────────────────────────────── */}
          <AnimatedSection delay={320}>
            <SectionCard title="アプリ情報">
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>バージョン</Text>
                <Text style={styles.fieldValue}>1.0.0</Text>
              </View>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => router.push('/privacy')}
                activeOpacity={0.75}
              >
                <Ionicons name="shield-checkmark-outline" size={18} color="#6b7280" />
                <Text style={styles.actionText}>プライバシーポリシー</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </TouchableOpacity>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => router.push('/terms')}
                activeOpacity={0.75}
              >
                <Ionicons name="document-text-outline" size={18} color="#6b7280" />
                <Text style={styles.actionText}>利用規約</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </TouchableOpacity>
              <View style={styles.divider} />
              <View style={[styles.fieldRow, { paddingBottom: 4 }]}>
                <Text style={{ color: '#555', fontSize: 12, textAlign: 'center', flex: 1 }}>
                  Made with ❤️ for athletes
                </Text>
              </View>
            </SectionCard>
          </AnimatedSection>

        </ScrollView>
      </SafeAreaView>

      <AdGateModal
        visible={csvGateVisible}
        feature="csv"
        remaining={csvGateRemaining}
        hardLimited={csvGateHardLimited}
        limitType={csvGateLimitType}
        isGuest={isGuest}
        onClose={() => setCsvGateVisible(false)}
        onAdWatched={async () => {
          setCsvGateVisible(false)
          await recordUsage('csv')
          trackFeatureUse('csv')
          await exportCSV()
        }}
        onUpgrade={() => {
          setCsvGateVisible(false)
          router.push('/paywall')
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingBottom: 48 },

  // カードセクション
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    margin: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 20,
    elevation: 6,
  },
  cardTitle: {
    color: '#166534',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 12,
    textTransform: 'uppercase',
  },

  divider: { height: 1, backgroundColor: 'rgba(0,0,0,0.07)', marginVertical: 10 },

  // アクセス許可行
  permRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 4 },
  permIcon:    { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  permTitle:   { color: '#111827', fontSize: 14, fontWeight: '700' },
  permSub:     { color: '#6b7280', fontSize: 11, marginTop: 2 },
  permBtn:     { backgroundColor: '#166534', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  permBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  // フィールド行
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  fieldLabel: { color: '#9ca3af', fontSize: 12, flex: 0, minWidth: 72 },
  fieldValue: { color: '#111827', fontSize: 16, flex: 1, textAlign: 'right' },
  fieldInput: {
    flex: 1, color: '#111827', fontSize: 16,
    textAlign: 'right' as const,
  },

  // 種目タグ
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 6 },
  tag: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
  },
  tagActive:   { backgroundColor: '#166534', borderColor: '#166534' },
  tagInactive: { backgroundColor: 'transparent', borderColor: 'rgba(22,101,52,0.4)' },
  tagText:     { color: '#166534', fontSize: 12, fontWeight: '700' },

  // 保存ボタン
  saveBtn: {
    marginTop: 14,
    backgroundColor: '#1c1c1e', borderRadius: 50,
    paddingVertical: 13, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 5,
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },

  // ログアウト行
  dangerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10,
  },
  dangerText: { color: '#E53935', fontSize: 15, fontWeight: '700' },

  // Switch 行
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  switchLabel: { color: '#111827', fontSize: 15, fontWeight: '600' },

  // アクション行（データ）
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  actionText: { flex: 1, color: '#111827', fontSize: 15, fontWeight: '600' },
})

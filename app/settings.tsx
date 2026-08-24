// app/settings.tsx — 設定画面

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Switch, Alert, TextInput, Platform, Linking,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter } from 'expo-router'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'

import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { getEventLabel } from '../lib/eventLabels'
import { supabase } from '../lib/supabase'
import { useTheme } from '../context/ThemeContext'
import { usePurchase } from '../context/PurchaseContext'
import { useTutorial } from '../lib/tutorialContext'
import AnimatedSection from '../components/AnimatedSection'
import { requestPermission, getPermission, startAllSchedulers } from '../lib/notifications'
import { checkAdGate, recordUsage } from '../lib/adGate'
import { getTicketBalance, grantProfileCompleteBonusIfNeeded } from '../lib/ticketWallet'
import Toast from 'react-native-toast-message'
import { Sounds, isSoundEnabled, isHapticsEnabled, setSoundEnabled, setHapticsEnabled, loadSoundPrefs } from '../lib/sounds'
import AdGateModal from '../components/AdGateModal'
import { trackFeatureUse } from '../lib/analytics'

const PROFILE_KEY   = 'trackmate_my_profile'
const NOTIF_KEY     = 'trackmate_notif_settings'
const TEAM_ROLE_KEY = 'trackmate_team_role'
const TEAM_SETUP_KEY   = 'trackmate_team_setup'
const TEAM_JOINED_KEY  = 'trackmate_team_joined'

function buildEventCategories(t: (key: string) => string) {
  return [
    { key: 'sprint',       label: t('settings.eventCategories.sprint'),       events: ['100m', '200m', '300m', '400m', '300mH'] },
    { key: 'middle',       label: t('settings.eventCategories.middle'),       events: ['800m', '1000m', '1500m', '3000m'] },
    { key: 'long',         label: t('settings.eventCategories.long'),         events: ['5000m', '10000m', 'ハーフ', 'マラソン', '競歩'] },
    { key: 'hurdle',       label: t('settings.eventCategories.hurdle'),       events: ['100mH', '110mH', '400mH'] },
    { key: 'steeplechase', label: t('settings.eventCategories.steeplechase'), events: ['3000mSC'] },
    { key: 'jump',         label: t('settings.eventCategories.jump'),         events: ['走幅跳', '三段跳', '棒高跳', '走高跳'] },
    { key: 'throw',        label: t('settings.eventCategories.throw'),        events: ['砲丸投', '円盤投', 'やり投', 'ハンマー投'] },
    { key: 'combined',     label: t('settings.eventCategories.combined'),     events: ['十種競技', '七種競技', '八種競技'] },
    { key: 'relay',        label: t('settings.eventCategories.relay'),        events: ['4×100mR', '4×400mR'] },
  ] as const
}

interface Profile {
  name: string
  event: string
  age: string
  club: string
  pb: string           // 自己ベスト（表示用文字列。例: "12:34.56"）
  target: string        // 目標タイム（同上）
  experienceYears: string   // 競技経験年数（年の部分）
  experienceMonths: string  // 競技経験年数（ヶ月の部分。0〜11）
}

// PB/目標タイム入力: "分:秒.秒" または秒のみ → ミリ秒
function parseTimeToMs(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const mMatch = trimmed.match(/^(\d+):(\d+(?:\.\d+)?)$/)
  if (mMatch) return Math.round((parseInt(mMatch[1], 10) * 60 + parseFloat(mMatch[2])) * 1000)
  const sMatch = trimmed.match(/^\d+(?:\.\d+)?$/)
  if (sMatch) return Math.round(parseFloat(trimmed) * 1000)
  return null
}
// ミリ秒 → 表示用文字列（60秒未満は秒のみ、以上は "分:秒"）
function formatMsToTime(ms?: number | null): string {
  if (!ms || ms <= 0) return ''
  const totalSec = ms / 1000
  if (totalSec < 60) return totalSec.toFixed(2)
  const min = Math.floor(totalSec / 60)
  const sec = (totalSec % 60).toFixed(2).padStart(5, '0')
  return `${min}:${sec}`
}

interface NotifSettings {
  practiceReminder: boolean
  raceReminder: boolean
}

// CSV エクスポート（Web のみ）
async function exportCSV(t: (key: string, opts?: any) => string) {
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
        await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: t('settings.data.exportCsvDialogTitle') })
      } else {
        Alert.alert(t('settings.data.exportDoneTitle'), t('settings.data.exportDoneMessage', { filename }))
      }
    }
  } catch (e) {
    Alert.alert(t('settings.data.exportErrorTitle'), t('settings.data.exportErrorMessage'))
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
  const { t } = useTranslation()
  const { language, setLanguage } = useLanguage()
  const EVENT_CATEGORIES = buildEventCategories(t)
  const { tier, isNoad, isCoach, hasTicketMonthly, expiresAt, restore } = usePurchase()
  const { startTutorial } = useTutorial()
  const router = useRouter()

  // プロフィール
  const [profile, setProfile] = useState<Profile>({ name: '', event: '', age: '', club: '', pb: '', target: '', experienceYears: '', experienceMonths: '' })

  // チケット残高
  const [ticketBalance, setTicketBalance] = useState(0)
  useEffect(() => {
    getTicketBalance().then(setTicketBalance).catch(() => {})
  }, [])

  // CSV AdGate
  const [csvGateVisible,     setCsvGateVisible]     = useState(false)
  const [csvGateRemaining,   setCsvGateRemaining]   = useState(0)
  const [csvGateHardLimited, setCsvGateHardLimited] = useState(false)
  const [csvGateLimitType,   setCsvGateLimitType]   = useState<'none'|'daily'|'monthly'|'total'|'window'>('none')

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
          // experience_yearsは小数（例: 3.5 = 3年6ヶ月）で保存されているため、年とヶ月に分解して表示する
          let expYears = '', expMonths = ''
          if (p.experience_years != null) {
            const totalMonths = Math.round(Number(p.experience_years) * 12)
            expYears  = String(Math.floor(totalMonths / 12))
            expMonths = String(totalMonths % 12)
          }
          setProfile({
            name: p.name ?? '', event: p.event ?? '', age: p.age != null ? String(p.age) : '', club: p.club ?? '',
            pb:         formatMsToTime(p.personal_best_ms),
            target:     formatMsToTime(p.target_time_ms),
            experienceYears: expYears,
            experienceMonths: expMonths,
          })
        } catch {}
      }
    }).catch(() => {})

    AsyncStorage.getItem(NOTIF_KEY).then(v => {
      if (v) { try { setNotifSettings(JSON.parse(v)) } catch {} }
    }).catch(() => {})
  }, [])

  // プロフィール保存
  // 既存の保存データ（オンボーディングで入力した自己ベスト・目標タイム等）を
  // 丸ごと上書きしないよう、既存データを読み直してこの画面の項目だけをマージする
  const saveProfile = async () => {
    let existing: Record<string, any> = {}
    try {
      const raw = await AsyncStorage.getItem(PROFILE_KEY)
      if (raw) existing = JSON.parse(raw)
    } catch {}
    const toSave = {
      ...existing,
      name:  profile.name,
      event: profile.event,
      age:   profile.age ? Number(profile.age) : null,
      club:  profile.club,
      personal_best_ms: profile.pb.trim() ? (parseTimeToMs(profile.pb) ?? existing.personal_best_ms) : undefined,
      target_time_ms:   profile.target.trim() ? (parseTimeToMs(profile.target) ?? existing.target_time_ms) : undefined,
      experience_years: (profile.experienceYears.trim() || profile.experienceMonths.trim())
        ? Math.round(((Number(profile.experienceYears) || 0) * 12 + (Number(profile.experienceMonths) || 0))) / 12
        : existing.experience_years,
    }
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(toSave)).catch(() => {})
    Alert.alert(t('settings.profile.savedAlert'))

    // プロフィール（種目・自己ベスト）を初めて完成させたらチケットボーナス
    if (toSave.name?.trim() && toSave.event?.trim() && toSave.personal_best_ms) {
      const { granted } = await grantProfileCompleteBonusIfNeeded()
      if (granted) Toast.show({ type: 'success', text1: t('settings.profile.profileBonus') })
    }
  }

  // 通知トグル
  const toggleNotif = (key: keyof NotifSettings, value: boolean) => {
    const next = { ...notifSettings, [key]: value }
    setNotifSettings(next)
    AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(next)).catch(() => {})
  }

  // 効果音・バイブ トグル
  const [soundOn,  setSoundOn]  = useState(true)
  const [hapticOn, setHapticOn] = useState(true)
  useEffect(() => {
    loadSoundPrefs().then(() => { setSoundOn(isSoundEnabled()); setHapticOn(isHapticsEnabled()) }).catch(() => {})
  }, [])
  const toggleSound = (v: boolean) => {
    setSoundOn(v); setSoundEnabled(v).catch(() => {})
    if (v) Sounds.toggleOn()   // ON にした瞬間だけ確認音
  }
  const toggleHaptic = (v: boolean) => {
    setHapticOn(v); setHapticsEnabled(v).catch(() => {})
    if (v) Sounds.tap()        // ON にした瞬間だけ確認の振動
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
    if (Platform.OS === 'web') {
      if (window.confirm(t('settings.account.signOutMessage'))) {
        doSignOut()
      }
    } else {
      Alert.alert(
        t('settings.account.signOutTitle'),
        t('settings.account.signOutMessage'),
        [
          { text: t('settings.account.cancel'), style: 'cancel' },
          { text: t('settings.account.signOut'), style: 'destructive', onPress: doSignOut },
        ]
      )
    }
  }

  // アカウント削除
  const handleDeleteAccount = () => {
    Alert.alert(
      t('settings.account.deleteTitle'),
      t('settings.account.deleteMessage'),
      [
        { text: t('settings.account.cancel'), style: 'cancel' },
        {
          text: t('settings.account.deleteConfirm'),
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              t('settings.account.deleteFinalTitle'),
              t('settings.account.deleteFinalMessage'),
              [
                { text: t('settings.account.cancel'), style: 'cancel' },
                {
                  text: t('settings.account.deleteFinalConfirm'),
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      // Supabase からユーザーデータを削除
                      const userId = user?.id
                      if (userId) {
                        try { await supabase.from('training_sessions').delete().eq('user_id', userId) } catch {}
                        try { await supabase.from('meal_records').delete().eq('user_id', userId) } catch {}
                        try { await supabase.from('profiles').delete().eq('id', userId) } catch {}
                      }
                      // ローカルデータを全削除
                      await AsyncStorage.clear().catch(() => {})
                      // サインアウト
                      await signOut().catch(() => {})
                    } catch (_) {
                      try { await signOut() } catch {}
                    }
                  },
                },
              ]
            )
          },
        },
      ]
    )
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
        t('settings.permissions.homeScreenTitle'),
        t('settings.permissions.homeScreenMessage'),
      )
      return
    }
    const result = await requestPermission()
    setNotifPerm(result as string)
    if (result === 'granted') {
      startAllSchedulers()
      Alert.alert(t('settings.permissions.notifOnTitle'), t('settings.permissions.notifOnMessage'))
    } else if (result === 'denied') {
      Alert.alert(
        t('settings.permissions.notifDeniedTitle'),
        t('settings.permissions.notifDeniedMessage'),
      )
    }
  }, [t])

  const handleRequestLocationPerm = useCallback(async () => {
    if (Platform.OS !== 'web') {
      // ネイティブ: expo-location で許可リクエスト
      try {
        const Location = await import('expo-location')
        if (locPerm === 'denied') {
          // 拒否済み → システム設定を開く
          Alert.alert(
            t('settings.permissions.locDeniedTitleNative'),
            t('settings.permissions.locDeniedMessageNative'),
            [
              { text: t('settings.account.cancel'), style: 'cancel' },
              { text: t('settings.permissions.openSettings'), onPress: () => Linking.openSettings() },
            ]
          )
          return
        }
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status === 'granted') {
          setLocPerm('granted')
          Alert.alert(t('settings.permissions.locOnTitle'), t('settings.permissions.locOnMessage'))
        } else {
          setLocPerm('denied')
        }
      } catch {
        Alert.alert(t('settings.permissions.locErrorTitle'), t('settings.permissions.locErrorMessage'))
      }
      return
    }

    // Web
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      Alert.alert(t('settings.permissions.locUnsupportedTitle'), t('settings.permissions.locUnsupportedMessage'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      () => {
        setLocPerm('granted')
        Alert.alert(t('settings.permissions.locOnTitle'), t('settings.permissions.locOnMessage'))
      },
      (err) => {
        if (err.code === 1) {
          setLocPerm('denied')
          Alert.alert(t('settings.permissions.locDeniedTitleWeb'), t('settings.permissions.locDeniedMessageWeb'))
        } else {
          Alert.alert(t('settings.permissions.locFailedTitle'), err.message)
        }
      },
      { enableHighAccuracy: false, timeout: 10000 }
    )
  }, [locPerm, t])

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
      const ok = window.confirm(t('settings.data.resetConfirmWeb'))
      if (!ok) return
      await doReset()
      if ('caches' in window) {
        const keys = await caches.keys().catch(() => [] as string[])
        await Promise.all(keys.map(k => caches.delete(k))).catch(() => {})
      }
      window.location.reload()
    } else {
      Alert.alert(
        t('settings.data.resetTitle'),
        t('settings.data.resetMessage'),
        [
          { text: t('settings.account.cancel'), style: 'cancel' },
          {
            text: t('settings.data.resetConfirm'), style: 'destructive',
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
    if (!gate.allowed) {
      setCsvGateRemaining(gate.remaining)
      setCsvGateHardLimited(gate.hardLimited)
      setCsvGateLimitType(gate.limitType)
      setCsvGateVisible(true)
      return
    }
    await recordUsage('csv')
    trackFeatureUse('csv')
    await exportCSV(t)
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── 現在のプラン ──────────────────────────────────── */}
          <AnimatedSection delay={0}>
            <SectionCard title={t('settings.currentPlan.title')}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
                <View>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>
                    {tier === 'coach' ? t('settings.currentPlan.plans.coach') : hasTicketMonthly ? t('settings.currentPlan.plans.ticketMonthly') : tier === 'noad' ? t('settings.currentPlan.plans.noad') : t('settings.currentPlan.plans.free')}
                  </Text>
                  {expiresAt && (
                    <Text style={{ fontSize: 12, color: colors.textSec, marginTop: 2 }}>
                      {t('settings.currentPlan.validUntil', { date: new Date(expiresAt).toLocaleDateString(language === 'ja' ? 'ja-JP' : 'en-US') })}
                    </Text>
                  )}
                  {!isNoad && (
                    <Text style={{ fontSize: 12, color: colors.textSec, marginTop: 2 }}>{t('settings.currentPlan.adsShown')}</Text>
                  )}
                </View>
                {!isNoad ? (
                  <TouchableOpacity
                    onPress={() => router.push('/paywall' as any)}
                    style={{ backgroundColor: '#16a34a', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
                    activeOpacity={0.85}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>{t('settings.currentPlan.viewPlans')}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={() => Linking.openURL('https://apps.apple.com/account/subscriptions')}
                    style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.border, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
                    activeOpacity={0.75}
                  >
                    <Text style={{ fontSize: 12, color: colors.textSec }}>{t('settings.currentPlan.manage')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {!isNoad && (
                <TouchableOpacity
                  onPress={() => restore()}
                  style={{ marginTop: 10, alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 13, color: colors.textSec }}>{t('settings.currentPlan.restorePurchases')}</Text>
                </TouchableOpacity>
              )}
            </SectionCard>
          </AnimatedSection>

          {/* ── チケット ───────────────────────────────────────── */}
          <AnimatedSection delay={20}>
            <SectionCard title={t('settings.tickets.title')}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
                <View>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>
                    {t('settings.tickets.balance', { n: ticketBalance })}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.textSec, marginTop: 2 }}>
                    {t('settings.tickets.usageHint')}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => router.push('/tickets' as any)}
                  style={{ backgroundColor: '#f59e0b', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
                  activeOpacity={0.85}
                >
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#241300' }}>{t('settings.tickets.buy')}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                onPress={() => router.push('/referral-challenge' as any)}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>
                  {t('settings.tickets.referral')}
                </Text>
                <Text style={{ fontSize: 18, color: colors.textSec }}>›</Text>
              </TouchableOpacity>
            </SectionCard>
          </AnimatedSection>

          {/* ── プロフィール ───────────────────────────────────── */}
          <AnimatedSection delay={40}>
            <SectionCard title={t('settings.profile.title')}>
              <LabeledInput
                label={t('settings.profile.name')}
                value={profile.name}
                onChangeText={v => setProfile(p => ({ ...p, name: v }))}
                placeholder={t('settings.profile.namePlaceholder')}
              />
              <View style={styles.divider} />

              {/* 種目タグ（複数選択可・カンマ区切りで保持） */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>{t('settings.profile.eventsLabel')}</Text>
              </View>
              {EVENT_CATEGORIES.map(cat => (
                <View key={cat.key} style={{ marginBottom: 10 }}>
                  <Text style={styles.eventCategoryLabel}>{cat.label}</Text>
                  <View style={styles.tagWrap}>
                    {cat.events.map(ev => {
                      const selected = profile.event ? profile.event.split(',').filter(Boolean) : []
                      const active = selected.includes(ev)
                      return (
                        <TouchableOpacity
                          key={ev}
                          style={[styles.tag, active ? styles.tagActive : styles.tagInactive]}
                          onPress={() => setProfile(p => {
                            const cur = p.event ? p.event.split(',').filter(Boolean) : []
                            const next = cur.includes(ev) ? cur.filter(e => e !== ev) : [...cur, ev]
                            return { ...p, event: next.join(',') }
                          })}
                          activeOpacity={0.75}
                        >
                          <Text style={[styles.tagText, active && { color: '#fff' }]}>{getEventLabel(ev, language)}</Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                </View>
              ))}

              <View style={styles.divider} />
              <LabeledInput
                label={t('settings.profile.age')}
                value={profile.age}
                onChangeText={v => setProfile(p => ({ ...p, age: v.replace(/[^0-9]/g, '') }))}
                placeholder="20"
                keyboardType="numeric"
              />
              <View style={styles.divider} />
              <LabeledInput
                label={t('settings.profile.club')}
                value={profile.club}
                onChangeText={v => setProfile(p => ({ ...p, club: v }))}
                placeholder={t('settings.profile.clubPlaceholder')}
              />
              <View style={styles.divider} />
              <LabeledInput
                label={t('settings.profile.pb')}
                value={profile.pb}
                onChangeText={v => setProfile(p => ({ ...p, pb: v.replace(/[^0-9:.]/g, '') }))}
                placeholder="12:34.56"
              />
              <View style={styles.divider} />
              <LabeledInput
                label={t('settings.profile.target')}
                value={profile.target}
                onChangeText={v => setProfile(p => ({ ...p, target: v.replace(/[^0-9:.]/g, '') }))}
                placeholder="11:50.00"
              />
              <View style={styles.divider} />
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>{t('settings.profile.experience')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'flex-end' }}>
                  <TextInput
                    style={[styles.fieldInput, { flex: 0, width: 36, outlineStyle: 'none' } as any]}
                    value={profile.experienceYears}
                    onChangeText={v => setProfile(p => ({ ...p, experienceYears: v.replace(/[^0-9]/g, '') }))}
                    placeholder="3"
                    placeholderTextColor="#9ca3af"
                    keyboardType="numeric"
                  />
                  <Text style={{ color: '#9ca3af', fontSize: 13 }}>{t('settings.profile.years')}</Text>
                  <TextInput
                    style={[styles.fieldInput, { flex: 0, width: 30, outlineStyle: 'none' } as any]}
                    value={profile.experienceMonths}
                    onChangeText={v => {
                      const n = v.replace(/[^0-9]/g, '')
                      setProfile(p => ({ ...p, experienceMonths: n === '' ? '' : String(Math.min(11, Number(n))) }))
                    }}
                    placeholder="0"
                    placeholderTextColor="#9ca3af"
                    keyboardType="numeric"
                  />
                  <Text style={{ color: '#9ca3af', fontSize: 13 }}>{t('settings.profile.months')}</Text>
                </View>
              </View>

              <TouchableOpacity style={styles.saveBtn} onPress={saveProfile} activeOpacity={0.85}>
                <Text style={styles.saveBtnText}>{t('settings.profile.save')}</Text>
              </TouchableOpacity>
            </SectionCard>
          </AnimatedSection>

          {/* ── アカウント ─────────────────────────────────────── */}
          <AnimatedSection delay={80}>
            <SectionCard title={t('settings.account.title')}>
              {isGuest ? (
                /* ゲスト → ログイン誘導 */
                <>
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>{t('settings.account.status')}</Text>
                    <View style={{ backgroundColor: '#FF9500' + '22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: '#FF9500', fontSize: 12, fontWeight: '800' }}>{t('settings.account.guest')}</Text>
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
                      <Text style={[styles.actionText, { color: '#166534', fontWeight: '800' }]}>{t('settings.account.createAccount')}</Text>
                      <Text style={{ color: colors.textHint, fontSize: 11, marginTop: 2 }}>{t('settings.account.cloudSaveHint')}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#166534" />
                  </TouchableOpacity>
                </>
              ) : (
                /* ログイン済み */
                <>
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>{t('settings.account.email')}</Text>
                    <Text style={styles.fieldValue} numberOfLines={1}>
                      {user?.email ?? '—'}
                    </Text>
                  </View>
                  <View style={styles.divider} />
                  <TouchableOpacity style={styles.dangerRow} onPress={handleSignOut} activeOpacity={0.75}>
                    <Ionicons name="log-out-outline" size={18} color="#E53935" />
                    <Text style={styles.dangerText}>{t('settings.account.signOut')}</Text>
                  </TouchableOpacity>
                  <View style={styles.divider} />
                  <TouchableOpacity style={styles.dangerRow} onPress={handleDeleteAccount} activeOpacity={0.75}>
                    <Ionicons name="trash-outline" size={18} color="#E53935" />
                    <Text style={styles.dangerText}>{t('settings.account.deleteAccount')}</Text>
                  </TouchableOpacity>
                </>
              )}
            </SectionCard>
          </AnimatedSection>

          {/* ── チーム設定 ────────────────────────────────────── */}
          <AnimatedSection delay={120}>
            <SectionCard title={t('settings.team.title')}>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>{t('settings.team.currentRole')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {teamRole === 'coach' && (
                    <View style={{ backgroundColor: '#166534' + '20', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ color: '#166534', fontSize: 12, fontWeight: '700' }}>{t('settings.team.coach')}</Text>
                    </View>
                  )}
                  {teamRole === 'player' && (
                    <View style={{ backgroundColor: '#34C759' + '20', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ color: '#34C759', fontSize: 12, fontWeight: '700' }}>{t('settings.team.player')}</Text>
                    </View>
                  )}
                  {!teamRole && <Text style={styles.fieldValue}>{t('settings.team.notSet')}</Text>}
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
                    if (window.confirm(t('settings.team.switchConfirmWeb'))) doSwitch()
                  } else {
                    Alert.alert(t('settings.team.switchTitle'), t('settings.team.switchMessage'), [
                      { text: t('settings.account.cancel'), style: 'cancel' },
                      { text: t('settings.team.reset'), style: 'destructive', onPress: doSwitch },
                    ])
                  }
                }}
              >
                <Ionicons name="swap-horizontal-outline" size={18} color="#6b7280" />
                <Text style={styles.actionText}>{t('settings.team.switchRole')}</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </TouchableOpacity>
            </SectionCard>
          </AnimatedSection>

          {/* ── アクセス許可 & 通知 ──────────────────────────── */}
          <AnimatedSection delay={160}>
            <SectionCard title={t('settings.permissions.title')}>

              {/* ── 位置情報 ── */}
              <View style={styles.permRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <View style={[styles.permIcon, { backgroundColor: 'rgba(90,200,250,0.12)' }]}>
                    <Ionicons name="location-outline" size={20} color="#5AC8FA" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.permTitle}>{t('settings.permissions.location')}</Text>
                    <Text style={styles.permSub}>
                      {locPerm === 'granted'     ? t('settings.permissions.locationGranted')
                       : locPerm === 'denied'    ? t('settings.permissions.locationDenied')
                       : locPerm === 'unsupported' ? t('settings.permissions.unsupportedBrowser')
                       : t('settings.permissions.locationUnset')}
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
                      {locPerm === 'denied' ? t('settings.permissions.openSettings') : t('settings.permissions.allow')}
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
                    <Text style={styles.permTitle}>{t('settings.permissions.pushNotif')}</Text>
                    <Text style={styles.permSub}>
                      {notifPerm === 'granted'     ? t('settings.permissions.notifGranted')
                       : notifPerm === 'denied'    ? t('settings.permissions.notifDenied')
                       : notifPerm === 'unsupported' ? t('settings.permissions.unsupportedBrowser')
                       : t('settings.permissions.notifUnset')}
                    </Text>
                  </View>
                </View>
                {notifPerm !== 'granted' && notifPerm !== 'loading' && notifPerm !== 'unsupported' && (
                  <TouchableOpacity
                    style={[styles.permBtn, notifPerm === 'denied' && { backgroundColor: '#f0f2f5' }]}
                    onPress={handleRequestNotifPerm}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.permBtnText, notifPerm === 'denied' && { color: '#6b7280' }]}>
                      {notifPerm === 'denied' ? t('settings.permissions.openSettings') : t('settings.permissions.allow')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.divider} />

              {/* 通知スケジュール説明 */}
              <View style={{ gap: 6, paddingTop: 4 }}>
                {[
                  { time: '17:00', label: t('settings.permissions.schedule.practice'), icon: '📝' },
                  { time: '20:00', label: t('settings.permissions.schedule.sleep'),     icon: '💤' },
                  { time: t('settings.permissions.schedule.realtime'), label: t('settings.permissions.schedule.riskAlert'),  icon: '🔴' },
                  { time: t('settings.permissions.schedule.beforeCompetition'),    label: t('settings.permissions.schedule.competition'),   icon: '🏆' },
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
                <Text style={styles.switchLabel}>{t('settings.permissions.practiceReminderSwitch')}</Text>
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
                <Text style={styles.switchLabel}>{t('settings.permissions.competitionReminderSwitch')}</Text>
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

          {/* ── 効果音・バイブレーション ───────────────────────── */}
          <AnimatedSection delay={230}>
            <SectionCard title={t('settings.sound.title')}>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>{t('settings.sound.soundEffect')}</Text>
                <Switch
                  value={soundOn}
                  onValueChange={toggleSound}
                  trackColor={{ false: '#e5e7eb', true: '#166534' }}
                  thumbColor="#fff"
                  ios_backgroundColor="#e5e7eb"
                />
              </View>
              <View style={styles.divider} />
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>{t('settings.sound.vibration')}</Text>
                <Switch
                  value={hapticOn}
                  onValueChange={toggleHaptic}
                  trackColor={{ false: '#e5e7eb', true: '#166534' }}
                  thumbColor="#fff"
                  ios_backgroundColor="#e5e7eb"
                />
              </View>
            </SectionCard>
          </AnimatedSection>

          {/* ── データ ───────────────────────────────────────── */}
          <AnimatedSection delay={240}>
            <SectionCard title={t('settings.data.title')}>
              <TouchableOpacity
                style={styles.actionRow}
                onPress={handleExportCSV}
                activeOpacity={0.75}
              >
                <Ionicons name="download-outline" size={18} color="#6b7280" />
                <Text style={styles.actionText}>{t('settings.data.exportCsv')}</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </TouchableOpacity>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.actionRow}
                onPress={handleClearCache}
                activeOpacity={0.75}
              >
                <Ionicons name="trash-outline" size={18} color="#E53935" />
                <Text style={[styles.actionText, { color: '#E53935' }]}>{t('settings.data.resetAll')}</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </TouchableOpacity>
            </SectionCard>
          </AnimatedSection>

          {/* ── アプリ情報 ────────────────────────────────────── */}
          <AnimatedSection delay={320}>
            <SectionCard title={t('settings.appInfo.title')}>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>{t('settings.appInfo.version')}</Text>
                <Text style={styles.fieldValue}>1.6.1</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>{t('settings.appInfo.language')}</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity
                    onPress={() => setLanguage('ja')}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
                      backgroundColor: language === 'ja' ? '#166534' : '#f0f2f5',
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: language === 'ja' ? '#fff' : '#6b7280' }}>{t('settings.appInfo.japanese')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setLanguage('en')}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
                      backgroundColor: language === 'en' ? '#166534' : '#f0f2f5',
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: language === 'en' ? '#fff' : '#6b7280' }}>{t('settings.appInfo.english')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => router.push('/support')}
                activeOpacity={0.75}
              >
                <Ionicons name="help-circle-outline" size={18} color="#6b7280" />
                <Text style={styles.actionText}>{t('settings.appInfo.support')}</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </TouchableOpacity>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => router.push('/privacy')}
                activeOpacity={0.75}
              >
                <Ionicons name="shield-checkmark-outline" size={18} color="#6b7280" />
                <Text style={styles.actionText}>{t('settings.appInfo.privacyPolicy')}</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </TouchableOpacity>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => router.push('/terms')}
                activeOpacity={0.75}
              >
                <Ionicons name="document-text-outline" size={18} color="#6b7280" />
                <Text style={styles.actionText}>{t('settings.appInfo.terms')}</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </TouchableOpacity>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.actionRow}
                onPress={async () => {
                  await AsyncStorage.removeItem('trackmate_tutorial_done').catch(() => {})
                  startTutorial()
                  router.replace('/(tabs)' as any)
                }}
                activeOpacity={0.75}
              >
                <Ionicons name="play-circle-outline" size={18} color="#6b7280" />
                <Text style={styles.actionText}>{t('settings.appInfo.replayTutorial')}</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </TouchableOpacity>
              <View style={styles.divider} />
              <View style={[styles.fieldRow, { paddingBottom: 4 }]}>
                <Text style={{ color: '#555', fontSize: 12, textAlign: 'center', flex: 1 }}>
                  {t('settings.appInfo.footer')}
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
          await exportCSV(t)
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
    borderRadius: 21,
    margin: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
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
  permIcon:    { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  permTitle:   { color: '#111827', fontSize: 14, fontWeight: '700' },
  permSub:     { color: '#6b7280', fontSize: 11, marginTop: 2 },
  permBtn:     { backgroundColor: '#166534', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
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
  eventCategoryLabel: { fontSize: 11, fontWeight: '700', color: '#9ca3af', marginBottom: 4 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 6 },
  tag: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 21, borderWidth: 1,
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
    paddingVertical: 10, minHeight: 44,
  },
  dangerText: { color: '#E53935', fontSize: 15, fontWeight: '700' },

  // Switch 行
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, minHeight: 44 },
  switchLabel: { color: '#111827', fontSize: 15, fontWeight: '600' },

  // アクション行（データ）
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, minHeight: 44 },
  actionText: { flex: 1, color: '#111827', fontSize: 15, fontWeight: '600' },
})

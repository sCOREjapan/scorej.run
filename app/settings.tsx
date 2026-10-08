// app/settings.tsx — 設定画面

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Switch, Alert, TextInput, Platform, Linking,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter, useNavigation, useFocusEffect } from 'expo-router'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'

import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { getEventLabel } from '../lib/eventLabels'
import { supabase } from '../lib/supabase'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
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
import { todayLocalISO } from '../lib/dateLocal'
import { purgeAiTempFiles } from '../lib/aiLocalData'

// テーマに関わらず固定のブランド/セマンティックカラー
const BRAND   = '#166534'  // アプリのブランドグリーン
const DANGER  = '#E53935'  // 破壊的操作（サインアウト・削除等）

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

    const filename = `score_${todayLocalISO()}.csv`

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
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
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
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, { outlineStyle: 'none' } as any]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? ''}
        placeholderTextColor={colors.textHint}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  )
}

// ── メイン設定画面 ─────────────────────────────────────────
export default function SettingsScreen() {
  const { user, session, signOut, isGuest, signOutGuest, isCoachMode, setCoachMode, resetOnboarding } = useAuth()
  const { scheme, colors, setScheme } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { t } = useTranslation()
  const { language, setLanguage } = useLanguage()
  const EVENT_CATEGORIES = buildEventCategories(t)
  const { tier, isNoad, isCoach, hasTicketMonthly, expiresAt, restore } = usePurchase()
  const { startTutorial } = useTutorial()
  const router = useRouter()
  const navigation = useNavigation()
  useEffect(() => { navigation.setOptions({ title: t('settings.headerTitle') }) }, [navigation, t, language])

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
  // 2026-09-25:「設定画面からもコーチ⇔選手を切り替えられるように」との指示で追加。
  // 既存のコーチ/選手データ(SETUP_KEY/JOINED_KEY)は消さず、ROLE_KEYだけを付け替える
  // 非破壊の切り替え。両方のデータが揃っている場合のみボタンを表示する
  // (片方しか無い場合は下の「役割を切り替える」(データ初期化)で新規に始めるのが筋)。
  //
  // 2026-09-25バグ修正: teamRoleを元々マウント時1回だけのuseEffectで読んでいたが、
  // この画面はスタック(router.push)で常駐するため、チームタブ側でロールを切り替えてから
  // 戻ってきてもteamRoleが古いままになり、switchToOtherRole()が誤った方向(実質no-op)に
  // 計算されるバグがあった。hasCoachSetup/hasPlayerJoinと同じuseFocusEffectに統合し、
  // 画面に戻るたびに再読み込みする。
  const [hasCoachSetup, setHasCoachSetup] = useState(false)
  const [hasPlayerJoin, setHasPlayerJoin] = useState(false)
  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(TEAM_ROLE_KEY).then(v => setTeamRole(v)).catch(() => {})
    AsyncStorage.getItem(TEAM_SETUP_KEY).then(v => setHasCoachSetup(!!v)).catch(() => {})
    AsyncStorage.getItem(TEAM_JOINED_KEY).then(v => setHasPlayerJoin(!!v)).catch(() => {})
  }, []))
  const switchToOtherRole = useCallback(async () => {
    const target = teamRole === 'coach' ? 'player' : 'coach'
    await AsyncStorage.setItem(TEAM_ROLE_KEY, target).catch(() => {})
    await setCoachMode(target === 'coach')
    setTeamRole(target)
    router.push('/(tabs)/team')
  }, [teamRole, setCoachMode, router])

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
                    // 2026-09-07: 以前はここでtraining_sessions/meal_records/profilesを
                    // クライアントの匿名キーから直接deleteしていたが、いずれもキーの列名/
                    // テーブル名を取り違えており実質0件しか消せておらず、かつSupabase Auth
                    // のユーザー本体はクライアントからは削除できない(service_role権限が必要)。
                    // そのため同じGoogle/Appleアカウントで再ログインすると、チケット残高や
                    // 課金状態を含む全データが復元されてしまう不具合があった。
                    // 今はapi/delete-account.ts(service_role権限のサーバー関数)に
                    // access_tokenだけを渡し、本人確認〜全テーブル削除〜Authユーザー本体の
                    // 削除まで全てサーバー側で行う。
                    if (isGuest) {
                      // ゲストはサーバーにアカウントが無いため、ローカルクリアのみ
                      await AsyncStorage.clear().catch(() => {})
                      signOutGuest()
                      return
                    }
                    // 2026-09-13: 「まだアカウント削除できない」との再報告。Vercel側の
                    // ログ(delete-account)を確認したところ、直近ずっとこのエンドポイントへの
                    // アクセスが一件も無かった＝サーバーに届く前(fetchより前)で毎回失敗して
                    // いたことが判明。最有力候補は下のsupabase.auth.getSession()がaccessToken
                    // を返さないケース(トークン期限切れ等)。ここで打ち切っていた旧実装を、
                    // ①まずAuthContextが持つ最新のsessionを使う→②それも無ければ
                    // getSession()→③それも無ければrefreshSession()を1回試す、の3段構えにし、
                    // 失敗理由を必ずreasonに残す。
                    const resolveAccessToken = async (): Promise<{ token: string | null; reason: string }> => {
                      if (session?.access_token) return { token: session.access_token, reason: 'context-session' }
                      const { data: sessionData, error: getErr } = await supabase.auth.getSession()
                      if (sessionData?.session?.access_token) return { token: sessionData.session.access_token, reason: 'getSession' }
                      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession()
                      if (refreshed?.session?.access_token) return { token: refreshed.session.access_token, reason: 'refreshSession' }
                      return { token: null, reason: `no-token(get=${getErr?.message ?? 'null'},refresh=${refreshErr?.message ?? 'null'})` }
                    }
                    try {
                      const { token: accessToken, reason: tokenReason } = await resolveAccessToken()
                      if (!accessToken) {
                        // セッションが取れない＝サーバー側で本人確認できないため、
                        // ここで打ち切ってサインアウトもしない（黙って「削除できたことにする」と
                        // 同じ不具合を繰り返すため）。ユーザーには失敗を明示し再試行を促す。
                        console.error('[delete-account] no access token:', tokenReason)
                        Alert.alert(t('settings.account.deleteFailedTitle'), t('settings.account.deleteFailedMessage'))
                        return
                      }
                      Toast.show({ type: 'info', text1: t('settings.account.deleting') })
                      const apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
                      // 2026-09-30プライバシー対応: team_*テーブルはteam_code+player_name
                      // (自由入力文字列)でしか紐付いておらずauth_idとの関連が無いため、
                      // サーバー側だけでは「このアカウントの」チーム内データ(怪我報告・
                      // 食事記録・練習ノート等)を特定できない。この端末が知っている
                      // 直近の参加チーム情報をここで渡し、api/delete-account.ts側で
                      // 該当分を削除する(過去に参加して既に退出したチームの分までは
                      // 追跡できない既知の制約)。
                      let joinedTeam: { code?: string; playerName?: string } = {}
                      try {
                        const raw = await AsyncStorage.getItem(TEAM_JOINED_KEY)
                        if (raw) joinedTeam = JSON.parse(raw)
                      } catch {}
                      const res = await fetch(`${apiBase}/api/delete-account`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ teamCode: joinedTeam.code, playerName: joinedTeam.playerName }),
                      })
                      if (!res.ok) {
                        // サーバー側の削除が失敗した状態でサインアウトすると、次回同じ
                        // アカウントで再ログインした時にデータが残っているように見え、
                        // 「削除したのに復活した」という同じ不具合になる。そのため失敗時は
                        // サインアウトせず、再試行できる状態のまま残す。
                        // 2026-09-12: 500の実際の原因がこれまで一切見えず(サーバー側にも
                        // console.errorが無かった)デバッグ不能だったため、レスポンス本文を
                        // 開発時にログへ出す(ユーザー向け文言は変えない)。
                        const bodyText = await res.text().catch(() => '')
                        console.error('[delete-account] failed:', res.status, bodyText)
                        Alert.alert(t('settings.account.deleteFailedTitle'), t('settings.account.deleteFailedMessage'))
                        return
                      }
                      // サーバー側の削除に成功した時だけローカルクリア＋サインアウトする
                      await AsyncStorage.clear().catch(() => {})
                      await purgeAiTempFiles().catch(() => {})   // 分析用に端末へコピーした動画・フレームも消す
                      await signOut().catch(() => {})
                    } catch (e: any) {
                      console.error('[delete-account] client exception:', e)
                      Alert.alert(t('settings.account.deleteFailedTitle'), t('settings.account.deleteFailedMessage'))
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
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
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
              {/* 2026-09-11: 「部費で経費精算したい先生向けに領収書的なものが欲しい」との
                  指摘で追加。有料プラン加入者のみに表示する（無料ユーザーには不要なため） */}
              {isNoad && (
                <TouchableOpacity
                  onPress={() => router.push('/receipt' as any)}
                  style={{ marginTop: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                >
                  <Ionicons name="receipt-outline" size={14} color={colors.textSec} />
                  <Text style={{ fontSize: 13, color: colors.textSec }}>{t('settings.currentPlan.issueReceipt')}</Text>
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
                    placeholderTextColor={colors.textHint}
                    keyboardType="numeric"
                  />
                  <Text style={{ color: colors.textHint, fontSize: 13 }}>{t('settings.profile.years')}</Text>
                  <TextInput
                    style={[styles.fieldInput, { flex: 0, width: 30, outlineStyle: 'none' } as any]}
                    value={profile.experienceMonths}
                    onChangeText={v => {
                      const n = v.replace(/[^0-9]/g, '')
                      setProfile(p => ({ ...p, experienceMonths: n === '' ? '' : String(Math.min(11, Number(n))) }))
                    }}
                    placeholder="0"
                    placeholderTextColor={colors.textHint}
                    keyboardType="numeric"
                  />
                  <Text style={{ color: colors.textHint, fontSize: 13 }}>{t('settings.profile.months')}</Text>
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
                    style={[styles.actionRow, { backgroundColor: BRAND + '12', borderRadius: 12, marginTop: 4 }]}
                    onPress={() => signOutGuest()}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="log-in-outline" size={18} color={BRAND} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.actionText, { color: BRAND, fontWeight: '800' }]}>{t('settings.account.createAccount')}</Text>
                      <Text style={{ color: colors.textHint, fontSize: 11, marginTop: 2 }}>{t('settings.account.cloudSaveHint')}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={BRAND} />
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
                    <Ionicons name="log-out-outline" size={18} color={DANGER} />
                    <Text style={styles.dangerText}>{t('settings.account.signOut')}</Text>
                  </TouchableOpacity>
                  <View style={styles.divider} />
                  <TouchableOpacity style={styles.dangerRow} onPress={handleDeleteAccount} activeOpacity={0.75}>
                    <Ionicons name="trash-outline" size={18} color={DANGER} />
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
                    <View style={{ backgroundColor: BRAND + '20', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ color: BRAND, fontSize: 12, fontWeight: '700' }}>{t('settings.team.coach')}</Text>
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

              {/* 2026-09-25: コーチ・選手どちらのデータも既にある場合のみ、データを消さずに
                  表示だけをその場で入れ替える非破壊の切り替えボタンを出す。 */}
              {hasCoachSetup && hasPlayerJoin && (
                <>
                  <View style={styles.divider} />
                  <TouchableOpacity style={styles.actionRow} activeOpacity={0.75} onPress={switchToOtherRole}>
                    <Ionicons name="swap-horizontal-outline" size={18} color={BRAND} />
                    <Text style={[styles.actionText, { color: BRAND }]}>
                      {teamRole === 'coach' ? t('settings.team.switchToPlayer') : t('settings.team.switchToCoach')}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textHint} />
                  </TouchableOpacity>
                </>
              )}

              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.actionRow}
                activeOpacity={0.75}
                onPress={async () => {
                  const doSwitch = async () => {
                    await AsyncStorage.multiRemove([TEAM_ROLE_KEY, TEAM_SETUP_KEY, TEAM_JOINED_KEY]).catch(() => {})
                    setTeamRole(null)
                    // 2026-09-16: isCoachMode(ホーム画面のコーチ専用UI切り替え)を戻し忘れると、
                    // チームタブでは役割選択に戻るのにホームだけコーチUIのままという
                    // 状態がズレる不具合報告があったため、ここでも明示的にfalseへ戻す。
                    await setCoachMode(false)
                    router.push('/(tabs)/team')
                  }
                  // 2026-10-07 致命バグ修正: ここは `typeof window !== 'undefined'` で Web を判定していたが、
                  // React Native(スマホ)でも window は定義されているため、スマホでも Web 側に入り、
                  // 存在しない window.confirm を呼んで例外になり、ボタンを押しても何も起きなかった
                  // (コーチ専用画面から選手に戻れない不具合の本当の原因)。Platform.OS で判定する。
                  if (Platform.OS === 'web') {
                    if (window.confirm(t('settings.team.switchConfirmWeb'))) doSwitch()
                  } else {
                    Alert.alert(t('settings.team.switchTitle'), t('settings.team.switchMessage'), [
                      { text: t('settings.account.cancel'), style: 'cancel' },
                      { text: t('settings.team.reset'), style: 'destructive', onPress: doSwitch },
                    ])
                  }
                }}
              >
                <Ionicons name="swap-horizontal-outline" size={18} color={colors.textSec} />
                <Text style={styles.actionText}>{t('settings.team.switchRole')}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textHint} />
              </TouchableOpacity>

              {/* 2026-09-14: コーチ専用UI(isCoachMode)と選手向けUIを行き来したい場合、
                  上の「役割を切り替える」はteam.tsxローカルの役割だけをリセットするため、
                  オンボーディング全体(目的選択含む)をやり直したい人向けに別ボタンを用意。
                  resetOnboarding()はisOnboarded・isCoachMode両方をクリアする
                  (context/AuthContext.tsx参照)。 */}
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.actionRow}
                activeOpacity={0.75}
                onPress={() => {
                  // 2026-09-16実機バグ報告「これを押すとクラッシュする」に対応。
                  // 原因: resetOnboarding()でisOnboarded=falseにした直後、ここで
                  // router.replace('/onboarding')を呼んでいたが、isOnboarded=falseへの
                  // 変更はapp/_layout.tsxのAuthGateも監視しており(authed && !isOnboarded
                  // && !inOnboarding → /onboardingへ自動遷移)、両者がほぼ同時に
                  // /onboardingへのreplaceを呼い合う競合状態になっていた
                  // (Android実機でクラッシュとして顕在化)。AuthGate側に一本化し、
                  // ここでは明示的な画面遷移を行わない。
                  const doReset = async () => {
                    await resetOnboarding()
                  }
                  if (Platform.OS === 'web') {
                    if (window.confirm(t('settings.team.redoOnboardingConfirm'))) doReset()
                  } else {
                    Alert.alert(t('settings.team.redoOnboardingTitle'), t('settings.team.redoOnboardingMessage'), [
                      { text: t('settings.account.cancel'), style: 'cancel' },
                      { text: t('settings.team.redoOnboardingConfirmBtn'), style: 'destructive', onPress: doReset },
                    ])
                  }
                }}
              >
                <Ionicons name="refresh-outline" size={18} color={colors.textSec} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionText}>{t('settings.team.redoOnboarding')}</Text>
                  {isCoachMode && (
                    <Text style={{ color: colors.textHint, fontSize: 11, marginTop: 2 }}>{t('settings.team.redoOnboardingCoachHint')}</Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textHint} />
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
                    style={[styles.permBtn, locPerm === 'denied' && { backgroundColor: colors.surface2 }]}
                    onPress={handleRequestLocationPerm}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.permBtnText, locPerm === 'denied' && { color: colors.textSec }]}>
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
                    <Ionicons name="notifications-outline" size={20} color={BRAND} />
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
                    style={[styles.permBtn, notifPerm === 'denied' && { backgroundColor: colors.surface2 }]}
                    onPress={handleRequestNotifPerm}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.permBtnText, notifPerm === 'denied' && { color: colors.textSec }]}>
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
                    <Text style={{ color: colors.textSec, fontSize: 12, flex: 1 }}>{item.label}</Text>
                    <Text style={{ color: colors.textHint, fontSize: 11, fontWeight: '600' }}>{item.time}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.divider} />

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>{t('settings.permissions.practiceReminderSwitch')}</Text>
                <Switch
                  value={notifSettings.practiceReminder}
                  onValueChange={v => toggleNotif('practiceReminder', v)}
                  trackColor={{ false: colors.switchTrack, true: BRAND }}
                  thumbColor="#fff"
                  ios_backgroundColor={colors.switchTrack}
                />
              </View>
              <View style={styles.divider} />
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>{t('settings.permissions.competitionReminderSwitch')}</Text>
                <Switch
                  value={notifSettings.raceReminder}
                  onValueChange={v => toggleNotif('raceReminder', v)}
                  trackColor={{ false: colors.switchTrack, true: BRAND }}
                  thumbColor="#fff"
                  ios_backgroundColor={colors.switchTrack}
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
                  trackColor={{ false: colors.switchTrack, true: BRAND }}
                  thumbColor="#fff"
                  ios_backgroundColor={colors.switchTrack}
                />
              </View>
              <View style={styles.divider} />
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>{t('settings.sound.vibration')}</Text>
                <Switch
                  value={hapticOn}
                  onValueChange={toggleHaptic}
                  trackColor={{ false: colors.switchTrack, true: BRAND }}
                  thumbColor="#fff"
                  ios_backgroundColor={colors.switchTrack}
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
                <Ionicons name="download-outline" size={18} color={colors.textSec} />
                <Text style={styles.actionText}>{t('settings.data.exportCsv')}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textHint} />
              </TouchableOpacity>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.actionRow}
                onPress={handleClearCache}
                activeOpacity={0.75}
              >
                <Ionicons name="trash-outline" size={18} color={DANGER} />
                <Text style={[styles.actionText, { color: DANGER }]}>{t('settings.data.resetAll')}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textHint} />
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
                      backgroundColor: language === 'ja' ? BRAND : colors.surface2,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: language === 'ja' ? '#fff' : colors.textSec }}>{t('settings.appInfo.japanese')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setLanguage('en')}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
                      backgroundColor: language === 'en' ? BRAND : colors.surface2,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: language === 'en' ? '#fff' : colors.textSec }}>{t('settings.appInfo.english')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>{t('settings.appInfo.appearance')}</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity
                    onPress={() => setScheme('light')}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
                      backgroundColor: scheme === 'light' ? BRAND : colors.surface2,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: scheme === 'light' ? '#fff' : colors.textSec }}>{t('settings.appInfo.light')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setScheme('dark')}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
                      backgroundColor: scheme === 'dark' ? BRAND : colors.surface2,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: scheme === 'dark' ? '#fff' : colors.textSec }}>{t('settings.appInfo.dark')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => router.push('/support')}
                activeOpacity={0.75}
              >
                <Ionicons name="help-circle-outline" size={18} color={colors.textSec} />
                <Text style={styles.actionText}>{t('settings.appInfo.support')}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textHint} />
              </TouchableOpacity>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => router.push('/privacy')}
                activeOpacity={0.75}
              >
                <Ionicons name="shield-checkmark-outline" size={18} color={colors.textSec} />
                <Text style={styles.actionText}>{t('settings.appInfo.privacyPolicy')}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textHint} />
              </TouchableOpacity>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => router.push('/terms')}
                activeOpacity={0.75}
              >
                <Ionicons name="document-text-outline" size={18} color={colors.textSec} />
                <Text style={styles.actionText}>{t('settings.appInfo.terms')}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textHint} />
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
                <Ionicons name="play-circle-outline" size={18} color={colors.textSec} />
                <Text style={styles.actionText}>{t('settings.appInfo.replayTutorial')}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textHint} />
              </TouchableOpacity>
              <View style={styles.divider} />
              <View style={[styles.fieldRow, { paddingBottom: 4 }]}>
                <Text style={{ color: colors.textHint, fontSize: 12, textAlign: 'center', flex: 1 }}>
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

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  content: { paddingBottom: 48 },

  // カードセクション
  card: {
    backgroundColor: colors.card,
    borderRadius: 21,
    margin: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 6,
  },
  cardTitle: {
    color: BRAND,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 12,
    textTransform: 'uppercase',
  },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: 10 },

  // アクセス許可行
  permRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 4 },
  permIcon:    { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  permTitle:   { color: colors.text, fontSize: 14, fontWeight: '700' },
  permSub:     { color: colors.textSec, fontSize: 11, marginTop: 2 },
  permBtn:     { backgroundColor: BRAND, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  permBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  // フィールド行
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  fieldLabel: { color: colors.textHint, fontSize: 12, flex: 0, minWidth: 72 },
  fieldValue: { color: colors.text, fontSize: 16, flex: 1, textAlign: 'right' },
  fieldInput: {
    flex: 1, color: colors.text, fontSize: 16,
    textAlign: 'right' as const,
  },

  // 種目タグ
  eventCategoryLabel: { fontSize: 11, fontWeight: '700', color: colors.textHint, marginBottom: 4 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 6 },
  tag: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 21, borderWidth: 1,
  },
  tagActive:   { backgroundColor: BRAND, borderColor: BRAND },
  tagInactive: { backgroundColor: 'transparent', borderColor: 'rgba(22,101,52,0.4)' },
  tagText:     { color: BRAND, fontSize: 12, fontWeight: '700' },

  // 保存ボタン
  saveBtn: {
    marginTop: 14,
    backgroundColor: BRAND, borderRadius: 50,
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
  dangerText: { color: DANGER, fontSize: 15, fontWeight: '700' },

  // Switch 行
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, minHeight: 44 },
  switchLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },

  // アクション行（データ）
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, minHeight: 44 },
  actionText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
})

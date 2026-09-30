// lib/notify.ts — チームのプッシュ通知ヘルパー(Expo Push Notifications)
//
// 2026-09-09: 以前はOneSignal Web SDK(window.OneSignal)専用の実装だったため、
// ネイティブ(iOS/Android)にはOneSignalのSDKが入っておらず、コーチ・選手には
// 「送信できている」ように見えて実際には0件配信という不具合があった。
// ios/sCORE/sCORE.entitlementsにaps-environmentが既に設定済み、EAS projectIdも
// 紐付いているため、新しいネイティブ依存を追加せずにExpo自身のPush通知サービスに
// 乗り換える。Web版は通知許可の概念がexpo-notificationsでは扱えないため、
// ネイティブのみ対応(isPushEnabled等はWebでは常にfalseを返す)。
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { registerTeamPushToken } from './supabaseTeam'
import { supabase } from './supabase'

let ExpoNotif: typeof import('expo-notifications') | null = null
async function getExpoNotif() {
  if (Platform.OS === 'web') return null
  if (!ExpoNotif) {
    try { ExpoNotif = await import('expo-notifications') } catch { return null }
  }
  return ExpoNotif
}

// ── 初期化 ──────────────────────────────────────────────────
// Web版はExpo Push非対応のため何もしない(以前のOneSignal Web初期化は撤去)。
export async function initOneSignal(): Promise<void> {
  // no-op: 互換のため関数名は維持。実際の登録はregisterTeamPushで行う。
}

// ── 通知許可リクエスト ────────────────────────────────────
export async function requestPushPermission(): Promise<boolean> {
  const Notif = await getExpoNotif()
  if (!Notif) return false
  try {
    const { status: existing } = await Notif.getPermissionsAsync()
    if (existing === 'granted') return true
    const { status } = await Notif.requestPermissionsAsync()
    return status === 'granted'
  } catch { return false }
}

// ── チームのプッシュ通知に登録(コーチ・選手それぞれの端末で呼ぶ) ──
// team.tsx側は「role確定 + teamCodeが分かった直後」(チーム作成直後・チーム参加直後・
// ダッシュボード表示時)に呼ぶ。許可が下りていなければ静かに何もしない。
export async function registerTeamPush(teamCode: string, role: 'coach' | 'player'): Promise<void> {
  const Notif = await getExpoNotif()
  if (!Notif || !teamCode) return
  try {
    const granted = await requestPushPermission()
    if (!granted) return
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    if (!projectId) return
    const { data: pushToken } = await Notif.getExpoPushTokenAsync({ projectId })
    if (!pushToken) return
    await registerTeamPushToken(teamCode, role, pushToken).catch(() => {})
  } catch { /* 権限拒否・シミュレータ等はサイレントに無視 */ }
}

// 旧APIとの互換のため残す(呼び出し元は今後 registerTeamPush に統一予定)
export async function registerUserTags(role: 'coach' | 'player', teamCode: string): Promise<void> {
  await registerTeamPush(teamCode, role)
}

// ── アプリ全体の通知(朝/練習/就寝のリマインダー等)に登録 ──
// 2026-09-09: api/daily-reminder.tsもOneSignal Web SDK依存で実質ネイティブに未配信
// だったため、user_push_tokensテーブル(supabase/add_user_push_tokens.sql)へ
// Expo Push Tokenを登録する。ログイン確立後（内部users.idが解決できた時点）に
// 呼ぶ想定（context/AuthContext.tsx参照）。
export async function registerAppPush(userId: string): Promise<void> {
  const Notif = await getExpoNotif()
  if (!Notif || !userId) return
  try {
    const granted = await requestPushPermission()
    if (!granted) return
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    if (!projectId) return
    const { data: pushToken } = await Notif.getExpoPushTokenAsync({ projectId })
    if (!pushToken) return
    await supabase.from('user_push_tokens').upsert(
      { user_id: userId, push_token: pushToken, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,push_token' },
    )
  } catch { /* 権限拒否・シミュレータ等はサイレントに無視 */ }
}

// ── 通知を送信(サーバー経由でExpo Push APIを叩く) ─────────
export async function sendPush(
  title: string,
  message: string,
  target: 'players' | 'coaches' | 'all',
  teamCode: string,
  coachSecret?: string,
): Promise<void> {
  try {
    const _apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
    const appSecret = process.env.EXPO_PUBLIC_APP_SECRET ?? ''
    await fetch(`${_apiBase}/api/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(appSecret ? { 'X-App-Secret': appSecret } : {}),
        // target='players'(コーチ→選手全員への一斉配信)のときサーバー側で検証される。
        // target='coaches'(選手が自分のチームに送る日常操作)では不要。
        ...(coachSecret ? { 'X-Coach-Secret': coachSecret } : {}),
      },
      body: JSON.stringify({ title, message, target, teamCode }),
    })
  } catch { /* ignore */ }
}

// ── 通知が許可済みか確認 ──────────────────────────────────
export async function isPushEnabled(): Promise<boolean> {
  const Notif = await getExpoNotif()
  if (!Notif) return false
  try {
    const { status } = await Notif.getPermissionsAsync()
    return status === 'granted'
  } catch { return false }
}

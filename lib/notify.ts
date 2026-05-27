// lib/notify.ts — プッシュ通知ヘルパー（OneSignal Web SDK）

declare global {
  interface Window {
    __ONESIGNAL_APP_ID__?: string
    OneSignal?: any
  }
}

// ── OneSignal 初期化 ──────────────────────────────────────
export async function initOneSignal(): Promise<void> {
  if (typeof window === 'undefined') return
  const appId = window.__ONESIGNAL_APP_ID__
  if (!appId || !window.OneSignal) return
  try {
    await window.OneSignal.init({
      appId,
      serviceWorkerPath: '/OneSignalSDKWorker.js',
      notifyButton: { enable: false },
      allowLocalhostAsSecureOrigin: true,
    })
  } catch { /* ignore */ }
}

// ── 通知許可リクエスト ────────────────────────────────────
export async function requestPushPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.OneSignal) return false
  try {
    return await window.OneSignal.Notifications.requestPermission()
  } catch { return false }
}

// ── ユーザーにロール + チームコードのタグを付ける ─────────
// これで「○○チームのコーチ」「○○チームの選手」と区別できる
export async function registerUserTags(
  role: 'coach' | 'player',
  teamCode: string,
): Promise<void> {
  if (typeof window === 'undefined' || !window.OneSignal) return
  try {
    await window.OneSignal.User.addTags({ role, teamCode })
  } catch { /* ignore */ }
}

// ── 通知を送信（サーバー経由） ────────────────────────────
export async function sendPush(
  title: string,
  message: string,
  target: 'players' | 'coaches' | 'all',
  teamCode: string,
): Promise<void> {
  try {
    const appSecret = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_APP_SECRET) ?? ''
    await fetch('/api/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(appSecret ? { 'X-App-Secret': appSecret } : {}),
      },
      body: JSON.stringify({ title, message, target, teamCode }),
    })
  } catch { /* ignore */ }
}

// ── 通知が許可済みか確認 ──────────────────────────────────
export function isPushEnabled(): boolean {
  if (typeof window === 'undefined' || !window.OneSignal) return false
  try {
    return window.OneSignal.Notifications.permission
  } catch { return false }
}

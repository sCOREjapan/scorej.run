// lib/aiConsent.ts — AI機能の利用前に行う「データ送信への同意」確認
//
// 2026-10-07: AI機能(動画分析・食事分析・AI診断・リカバリー相談・ノート解析・スコッピー等)は、入力内容
// (テキスト・食事写真・動画から切り出した顔が写り得る画像・睡眠/体重などの記録)を、当社のサーバー経由で
// Google LLC(米国)のGemini APIへ送信する。これまで利用開始時の規約同意(年齢確認付き)があるだけで、
// 送信先・送る内容を示した上での同意は取っていなかった(Google Play / App Store の第三者AIへの
// データ共有の同意要件に沿わない恐れがあった)。最初にAI機能を使う時に1回だけ、内容を示して同意を得る。
// 同意の有無は端末ごとに保存する。内容を変えた時は KEY の版(v1→v2)を上げて、再度同意を求める。
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Alert, Platform } from 'react-native'
import { router } from 'expo-router'
import i18n from './i18n'

export const AI_CONSENT_KEY = 'score_ai_consent_v1'

export async function hasAiConsent(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(AI_CONSENT_KEY)) != null } catch { return false }
}

function ask(): Promise<boolean> {
  const t = (k: string) => i18n.t(k) as string
  const title = t('aiConsent.title')
  const body = t('aiConsent.body')
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${body}`))
  }
  return new Promise<boolean>(resolve => {
    Alert.alert(title, body, [
      { text: t('aiConsent.viewPolicy'), onPress: () => { try { router.push('/privacy') } catch {} ; resolve(false) } },
      { text: t('aiConsent.decline'), style: 'cancel', onPress: () => resolve(false) },
      { text: t('aiConsent.agree'), onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) })
  })
}

let pending: Promise<boolean> | null = null

/** 同意済みなら true。未同意なら確認を出し、同意された時だけ保存して true。同時に複数回呼ばれても確認は1回。 */
export function ensureAiConsent(): Promise<boolean> {
  if (pending) return pending
  pending = (async () => {
    if (await hasAiConsent()) return true
    const ok = await ask()
    if (ok) await AsyncStorage.setItem(AI_CONSENT_KEY, new Date().toISOString()).catch(() => {})
    return ok
  })().finally(() => { pending = null })
  return pending
}

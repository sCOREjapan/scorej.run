// lib/attPrompt.ts — iOS の「追跡の許可(ATT)」を、使い始めの邪魔にならないタイミングで、
// 理由を一言添えてから出す。
//
// 2026-10-07: 以前は起動3秒後に、オンボーディング中でも説明なしにOSのダイアログを出していた。
// 初回起動の最初の数秒で出る許可ダイアログは、許可率が低く、離脱の原因にもなる。
// ホーム画面に着いてチュートリアルも終わってから、短い説明(1回だけ)を挟んでOSのダイアログを出す。
// 許可されると広告識別子(IDFA)が使え、広告の単価が上がる。許可しなくても機能の差はない。
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Alert, Platform } from 'react-native'
import i18n from './i18n'

const PREPROMPT_SHOWN_KEY = 'score_att_preprompt_v1'

export type TrackingStatus = 'granted' | 'denied' | 'undetermined' | 'unavailable'

async function loadModule(): Promise<any | null> {
  if (Platform.OS !== 'ios') return null
  try { return await import('expo-tracking-transparency') } catch { return null }
}

/** 現在のATT状態(iOS以外・取得できない時は 'unavailable') */
export async function getTrackingStatus(): Promise<TrackingStatus> {
  const att = await loadModule()
  if (!att) return 'unavailable'
  try {
    const { status } = await att.getTrackingPermissionsAsync()
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined'
  } catch {
    return 'unavailable'
  }
}

function showPrePrompt(): Promise<void> {
  const t = (k: string) => i18n.t(k) as string
  return new Promise<void>(resolve => {
    Alert.alert(
      t('attPrePrompt.title'),
      t('attPrePrompt.body'),
      [{ text: t('attPrePrompt.next'), onPress: () => resolve() }],
      { cancelable: false },
    )
  })
}

/**
 * まだ許可の確認をしていないiOSユーザーにだけ、説明→OSのダイアログの順で確認する。
 * 戻り値は確認後(または確認不要)の状態。確認を出した時は onResolved を呼ぶ(広告の読み込みをやり直すため)。
 */
export async function maybeRequestTracking(onResolved?: (status: TrackingStatus) => void): Promise<TrackingStatus> {
  const att = await loadModule()
  if (!att) return 'unavailable'
  const before = await getTrackingStatus()
  if (before !== 'undetermined') return before

  // 説明は端末で1回だけ。OSのダイアログは、状態が undetermined の間は(アプリを再起動しても)出せる
  let explained = false
  try { explained = (await AsyncStorage.getItem(PREPROMPT_SHOWN_KEY)) != null } catch {}
  if (!explained) {
    try { await AsyncStorage.setItem(PREPROMPT_SHOWN_KEY, new Date().toISOString()) } catch {}
    await showPrePrompt()
  }

  try { await att.requestTrackingPermissionsAsync() } catch {}
  const after = await getTrackingStatus()
  try { onResolved?.(after) } catch {}
  return after
}

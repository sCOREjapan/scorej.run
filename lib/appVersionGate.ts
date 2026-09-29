// lib/appVersionGate.ts
// 起動時に app_config テーブルを見て、現在のバージョンが min_version を下回っていたら
// 強制アップデート画面を出すためのチェック。管理者は Supabase ダッシュボードで
// app_config.min_version_ios / min_version_android を上げるだけで反映できる。
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { supabase } from './supabase'

export interface UpdateGateResult {
  required: boolean
  message: string
}

const DEFAULT_MESSAGE = '新しいバージョンが利用可能です。最新の機能・修正をご利用いただくため、アップデートをお願いします。'

export async function checkForceUpdate(): Promise<UpdateGateResult> {
  // Web版はストアバージョンの概念が無く(リロードで常に最新)、UpdateRequiredModalの
  // ボタンもストアURLしか開けず脱出手段が無いため、対象外にする
  // (2026-09-29コードレビューで、Android基準に巻き込まれて閉じられないモーダルに
  // ロックされるバグが発覚)。
  if (Platform.OS === 'web') return { required: false, message: '' }

  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('min_version_ios, min_version_android, update_message')
      .eq('id', 1)
      .single()

    if (error || !data) return { required: false, message: '' }

    const minVersion = Platform.OS === 'ios' ? data.min_version_ios : data.min_version_android
    if (!minVersion) return { required: false, message: '' }

    const currentVersion = Number(Constants.expoConfig?.version ?? '0')
    if (!currentVersion || currentVersion >= minVersion) return { required: false, message: '' }

    return { required: true, message: data.update_message || DEFAULT_MESSAGE }
  } catch {
    // ネットワークエラー等でチェックできない場合はアプリ利用をブロックしない
    return { required: false, message: '' }
  }
}

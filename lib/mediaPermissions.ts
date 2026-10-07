// lib/mediaPermissions.ts — 写真・動画の権限まわり（Android の Google Play ポリシー対応）
//
// 2026-10-07: Google Play から「写真と動画の権限に関するポリシー」違反の通知。
// Android 13以降(API 33+)で READ_MEDIA_IMAGES / READ_MEDIA_VIDEO を宣言できるのは、システムの
// 写真選択ツールでは機能を提供できない場合に限られる。このアプリの用途は
//   ①写真・動画を「選ぶ」(動画分析・食事記録)  → システムの写真選択ツールで足りる(権限不要)
//   ②シェアカード画像を「保存する」            → 共有シートの「保存」で足りる(権限不要)
// のため、Android ではこれらの権限を宣言も要求もしない(app.config.js の blockedPermissions で
// マニフェストからも除外している)。iOS は従来どおり。
import { Platform } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as MediaLibrary from 'expo-media-library'
import * as Sharing from 'expo-sharing'

/**
 * ライブラリから写真/動画を選ぶ前の権限確認。
 * Android: launchImageLibraryAsync はシステムの写真選択ツールを使い権限が要らないので、要求せず許可扱い。
 * iOS/その他: 従来どおり requestMediaLibraryPermissionsAsync。
 */
export async function requestPickerLibraryPermission(): Promise<{ granted: boolean; status: string }> {
  if (Platform.OS === 'android') return { granted: true, status: 'granted' }
  const r = await ImagePicker.requestMediaLibraryPermissionsAsync()
  return { granted: r.granted, status: r.status }
}

/** カメラロールへ画像を保存する前の権限確認。Android は共有シート経由で保存するため権限不要。 */
export async function ensureGalleryWritePermission(): Promise<boolean> {
  if (Platform.OS === 'android') return true
  const { status } = await MediaLibrary.requestPermissionsAsync()
  return status === 'granted'
}

/**
 * 画像をカメラロールへ保存する。
 * iOS: そのままカメラロールへ保存して 'saved'。
 * Android: 保存用の権限を持たないので、共有シートを開き（「写真に保存」等をユーザーが選ぶ）'shared' を返す。
 *          呼び出し側は 'shared' の時に「保存しました」を表示しないこと（共有シートの結果は分からないため）。
 */
export async function saveImageToGallery(uri: string): Promise<'saved' | 'shared'> {
  if (Platform.OS === 'android') {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png' })
    }
    return 'shared'
  }
  await MediaLibrary.saveToLibraryAsync(uri)
  return 'saved'
}

// lib/storage.ts — Supabase Storage upload helpers + video frame extraction

import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import { supabase } from './supabase'

// ─────────────────────────────────────────
// 内部ユーティリティ
// ─────────────────────────────────────────

/** URI からファイルを読み込み base64 文字列を返す（ネイティブ用） */
async function readFileAsBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  })
}

/** URI から Blob を生成 */
async function uriToBlob(uri: string): Promise<Blob> {
  const response = await fetch(uri)
  return response.blob()
}

/** 一意なファイルパスを生成 */
function buildStoragePath(userId: string, prefix: string, ext: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 8)
  return `${userId}/${prefix}_${timestamp}_${random}.${ext}`
}

// ─────────────────────────────────────────
// 1. 動画アップロード
// ─────────────────────────────────────────
export async function uploadVideo(uri: string, userId: string): Promise<string> {
  const path = buildStoragePath(userId, 'video', 'mp4')
  const blob = await uriToBlob(uri)
  const { error } = await supabase.storage.from('videos').upload(path, blob, {
    contentType: 'video/mp4', upsert: false,
  })
  if (error) throw new Error(`動画アップロード失敗: ${error.message}`)
  return supabase.storage.from('videos').getPublicUrl(path).data.publicUrl
}

// ─────────────────────────────────────────
// 2. 食事写真アップロード
// ─────────────────────────────────────────
export async function uploadMealPhoto(uri: string, userId: string): Promise<string> {
  const path = buildStoragePath(userId, 'meal', 'jpg')
  const blob = await uriToBlob(uri)
  const { error } = await supabase.storage.from('meal-photos').upload(path, blob, {
    contentType: 'image/jpeg', upsert: false,
  })
  if (error) throw new Error(`食事写真アップロード失敗: ${error.message}`)
  return supabase.storage.from('meal-photos').getPublicUrl(path).data.publicUrl
}

// ─────────────────────────────────────────
// 3. 動画フレーム抽出（Web / ネイティブ両対応）
// ─────────────────────────────────────────

/** Web: HTML5 Canvas で動画フレームを base64 に変換（堅牢版） */
async function extractVideoFramesWeb(videoUri: string, count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    // crossOrigin は blob/local URL では設定しない（CORS エラーになる）
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'

    const timeout = setTimeout(() => {
      reject(new Error('動画の読み込みがタイムアウトしました（15秒）'))
    }, 15000)

    video.addEventListener('loadeddata', async () => {
      clearTimeout(timeout)
      // seek が確実に動くよう一瞬再生してからすぐ停止する
      video.play().catch(() => {})
      video.pause()

      const duration = video.duration
      if (!isFinite(duration) || duration <= 0) {
        reject(new Error('動画の長さを取得できませんでした'))
        return
      }

      const canvas = document.createElement('canvas')
      canvas.width  = Math.min(video.videoWidth  || 640, 640)
      canvas.height = Math.min(video.videoHeight || 360, 360)
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas が使えません')); return }

      const frames: string[] = []

      // フレームを1枚ずつシーク→キャプチャ
      const captureAt = (index: number) => {
        if (index >= count) {
          video.src = ''   // メモリ解放
          resolve(frames)
          return
        }
        const time = count === 1
          ? duration * 0.5
          : (index / (count - 1)) * duration

        const seekTimeout = setTimeout(() => {
          // seeked が来なくても現在フレームで続行
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
          frames.push(dataUrl.split(',')[1])
          captureAt(index + 1)
        }, 3000)

        const onSeeked = () => {
          clearTimeout(seekTimeout)
          video.removeEventListener('seeked', onSeeked)
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
          frames.push(dataUrl.split(',')[1])
          captureAt(index + 1)
        }

        video.addEventListener('seeked', onSeeked)
        video.currentTime = time
      }

      captureAt(0)
    })

    video.addEventListener('error', () => {
      clearTimeout(timeout)
      const code = (video.error?.code ?? 0)
      const msgs: Record<number,string> = {
        1: 'ユーザーによって中断されました',
        2: 'ネットワークエラー',
        3: '動画のデコードに失敗しました',
        4: 'この動画形式はブラウザで未対応です。MOVはSafariで、またはMP4形式に変換してお試しください。',
      }
      reject(new Error(msgs[code] ?? '動画の読み込みに失敗しました'))
    })

    video.src = videoUri
    video.load()
  })
}

/** ネイティブ: expo-video-thumbnails でフレーム抽出 */
async function extractVideoFramesNative(videoUri: string, count: number, knownDurationMs?: number): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const VideoThumbnails = require('expo-video-thumbnails')
  const fileInfo = await FileSystem.getInfoAsync(videoUri)
  if (!fileInfo.exists) throw new Error('動画ファイルが見つかりません')

  // FileSystem.getInfoAsync は動画の長さ(duration)を返さない。
  // 呼び出し元が実際の再生時間を渡してこなければ、動画の長さを取得できず
  // フレーム抽出位置が正しく計算できないため、明示的にエラーにする
  // （固定値10秒を仮定すると、10秒より長い/短い動画で誤ったフレームを抽出してしまうため）。
  if (!knownDurationMs || knownDurationMs <= 0) {
    throw new Error('動画の長さを取得できませんでした。動画を選び直してもう一度お試しください。')
  }
  const durationMs = knownDurationMs
  const positions = Array.from({ length: count }, (_, i) =>
    Math.floor((i / Math.max(count - 1, 1)) * durationMs)
  )

  const frames: string[] = []
  for (const timeMs of positions) {
    const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
      time: timeMs,
      quality: 0.7,
    })
    frames.push(await readFileAsBase64(thumbUri))
  }
  return frames
}

/**
 * 動画から代表フレームを base64 JPEG 文字列の配列として返す。
 * Web / ネイティブ両対応。
 */
export async function extractVideoFrames(
  videoUri: string,
  count: number = 4,
  durationMs?: number
): Promise<string[]> {
  if (Platform.OS === 'web') {
    return extractVideoFramesWeb(videoUri, count)
  }
  return extractVideoFramesNative(videoUri, count, durationMs)
}

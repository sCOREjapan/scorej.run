import React, { useRef, useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  StyleSheet, Platform, Alert, ActivityIndicator, Image, Modal, Pressable,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { BRAND, TEXT } from '../lib/theme'
import { checkAdGate, recordUsage, getTier } from '../lib/adGate'
import { showInterstitialAd } from '../lib/admob'
import AdGateModal from '../components/AdGateModal'
import BannerAdView from '../components/BannerAdView'
import { useAuth } from '../context/AuthContext'
import { useRouter } from 'expo-router'
import { trackFeatureUse } from '../lib/analytics'
import * as ImagePicker from 'expo-image-picker'
import * as VideoThumbnails from 'expo-video-thumbnails'
import * as ImageManipulator from 'expo-image-manipulator'
import * as FileSystem from 'expo-file-system/legacy'
import { sendCoachNotification, submitVideo } from '../lib/supabaseTeam'
import { VideoView, useVideoPlayer } from 'expo-video'

const JOINED_KEY_VA = 'trackmate_team_joined'

/* ─── 型定義 ─────────────────────────────────── */
// 改善点の詳細構造（issue=何が問題か / reason=なぜ起きるか / fix=どう直すか）
type ImprovementDetail = {
  issue: string
  reason: string
  fix: string
}

type FrameAdvice = {
  overall: string
  positives: string[]
  improvements: string[]
  improvementDetails?: ImprovementDetail[]
  injuryRisk?: string
}
type Annotation = {
  id: string
  timestamp: number
  thumbUrl: string
  advice: FrameAdvice
}
type ComprehensiveAnalysis = {
  summary: string
  keyFindings: string[]
  injuryWarnings?: string[]
  trainingMenu: { name: string; detail: string }[]
  nextSteps: string[]
}

const STORAGE_KEY      = 'trackmate_video_annotations'
const COACH_REQ_KEY    = 'trackmate_coach_video_requests'
const MAX_FRAMES       = 8
const THUMB_W          = 320

type CoachVideoRequest = {
  id:           string
  videoUri:     string
  thumbnailUri: string
  message:      string
  event:        string
  sentAt:       string
  checked?:     boolean
}

const FOCUS_HINTS = [
  'スタートの姿勢', '腕の振り', 'ストライド', 'コーナリング',
  '着地のタイミング', '上体の傾き', 'ゴール前',
]

/* ─── ネイティブ動画分析（iOS/Android）──────────────── */
type AnalysisPhase = 'idle' | 'extracting' | 'analyzing' | 'result'

type AnalysisResult = {
  score: number
  overall: string
  positives: string[]
  improvements: string[]
  improvementDetails?: ImprovementDetail[]  // 構造化された改善点（issue/reason/fix）
  menu: { name: string; detail: string }[]
  frameNotes?: Array<{ f: number; note: string }>
}

// フレームタイムスタンプ: 動画の実際の長さが取得できない場合のみ使うフォールバック値
// （3〜15秒の動画を想定した固定値。取得できる場合は下の computeFrameTimestamps で
//  動画の長さに応じて均等割りする）
const FRAME_TIMESTAMPS = [400, 1800, 3200, 4800, 6500, 9500]
const FRAME_COUNT = FRAME_TIMESTAMPS.length

// 動画の実際の長さ(ms)から、フレーム抽出タイムスタンプを均等割りで計算する。
// 先頭・末尾の黒コマ/読み込み中フレームを避けるため、両端に少しマージンを取る。
function computeFrameTimestamps(durationMs: number | null): number[] {
  if (!durationMs || durationMs <= 0) return FRAME_TIMESTAMPS
  const marginMs = Math.min(400, durationMs * 0.08)
  const usableMs = Math.max(durationMs - marginMs * 2, 100)
  return Array.from({ length: FRAME_COUNT }, (_, i) =>
    Math.round(marginMs + (i / Math.max(FRAME_COUNT - 1, 1)) * usableMs)
  )
}

// ── 分析結果キャッシュ（同じ動画の再分析コストをゼロに） ────────────
function _simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < Math.min(s.length, 120); i++) { h = Math.imul(31, h) + s.charCodeAt(i) | 0 }
  return Math.abs(h).toString(36)
}
const ANALYSIS_CACHE_PREFIX = 'score_va_cache_v2_'  // v2: 旧壊れキャッシュを無効化
const ANALYSIS_CACHE_TTL    = 86400_000  // 24時間

async function getAnalysisCache(videoUri: string, event: string): Promise<AnalysisResult | null> {
  try {
    const key  = ANALYSIS_CACHE_PREFIX + _simpleHash(videoUri + event)
    const raw  = await AsyncStorage.getItem(key)
    if (!raw) return null
    const { result, ts } = JSON.parse(raw)
    if (Date.now() - ts > ANALYSIS_CACHE_TTL) return null
    return result as AnalysisResult
  } catch { return null }
}
async function setAnalysisCache(videoUri: string, event: string, result: AnalysisResult) {
  try {
    const key = ANALYSIS_CACHE_PREFIX + _simpleHash(videoUri + event)
    await AsyncStorage.setItem(key, JSON.stringify({ result, ts: Date.now() }))
  } catch {}
}

// Hermesの AbortSignal.timeout 非対応に対応したタイムアウト付きfetch
function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return fetch(url, { ...options, signal: AbortSignal.timeout(ms) })
  }
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id))
}

function formatMs(ms: number): string {
  if (!ms || isNaN(ms)) return '0:00'
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function VideoAnnotationPlayer({
  videoUri,
  frames,
  frameNotes,
  frameTimestamps,
}: {
  videoUri: string
  frames: string[]
  frameNotes?: Array<{ f: number; note: string }>
  frameTimestamps?: number[]
}) {
  const timestamps = frameTimestamps && frameTimestamps.length > 0 ? frameTimestamps : FRAME_TIMESTAMPS
  const [speed, setSpeed]           = useState<1 | 0.5 | 0.25>(1)
  const [activeFrame, setActiveFrame] = useState<number>(-1)
  const [isPlaying, setIsPlaying]   = useState(false)
  const [currentMs, setCurrentMs]   = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const player = useVideoPlayer(videoUri, p => {
    p.loop = false
  })

  // speed 変更を player に反映
  useEffect(() => {
    player.playbackRate = speed
  }, [speed, player])

  // 再生位置を200msごとにポーリングして activeFrame を更新
  useEffect(() => {
    tickRef.current = setInterval(() => {
      try {
        const ms = (player.currentTime ?? 0) * 1000
        const dur = (player.duration ?? 0) * 1000
        setCurrentMs(ms)
        if (dur > 0) setDurationMs(dur)
        setIsPlaying(player.playing)

        // 最も近いフレームを探す
        let best = -1
        let bestDist = Infinity
        timestamps.forEach((ts, idx) => {
          const dist = Math.abs(ts - ms)
          if (dist < bestDist) { bestDist = dist; best = idx }
        })
        if (bestDist < 800) setActiveFrame(best)
        else setActiveFrame(-1)
      } catch {}
    }, 200)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [player])

  const togglePlay = () => {
    if (player.playing) player.pause()
    else player.play()
  }

  const cycleSpeed = () => {
    setSpeed(s => s === 1 ? 0.5 : s === 0.5 ? 0.25 : 1)
  }

  const seekToFrame = (idx: number) => {
    // expo-video では currentTime への直接代入は非対応。seekTo() を使用する
    try {
      if (typeof (player as any).seekTo === 'function') {
        (player as any).seekTo(timestamps[idx] / 1000)
      } else {
        (player as any).currentTime = timestamps[idx] / 1000
      }
    } catch {}
  }

  const activeNote = activeFrame >= 0
    ? frameNotes?.find(n => n.f === activeFrame)?.note
    : undefined

  const progress = durationMs > 0 ? Math.min(currentMs / durationMs, 1) : 0

  return (
    <View style={{ backgroundColor: '#0d1117', borderRadius: 20, overflow: 'hidden',
      borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', marginBottom: 4 }}>
      {/* 動画本体 */}
      <VideoView
        player={player}
        style={{ width: '100%', aspectRatio: 16 / 9 }}
        contentFit="contain"
        nativeControls={false}
      />

      {/* フレームアノテーション */}
      {activeNote && (
        <View style={{ position: 'absolute', top: 8, left: 8, right: 8,
          backgroundColor: 'rgba(0,0,0,0.78)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
          borderLeftWidth: 3, borderLeftColor: '#FF9500' }}>
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
            🎯 フレーム{activeFrame + 1} — {activeNote}
          </Text>
        </View>
      )}

      {/* プログレスバー */}
      <View style={{ height: 3, backgroundColor: 'rgba(255,255,255,0.12)', marginHorizontal: 0 }}>
        <View style={{ height: 3, backgroundColor: '#34C759', width: `${progress * 100}%` as any }} />
      </View>

      {/* コントロール */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 }}>
        <TouchableOpacity onPress={togglePlay} activeOpacity={0.8}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#166534',
            alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color="#fff" />
        </TouchableOpacity>

        <Text style={{ color: '#64748b', fontSize: 11, flex: 1 }}>
          {formatMs(currentMs)} / {formatMs(durationMs)}
        </Text>

        <TouchableOpacity onPress={cycleSpeed} activeOpacity={0.8}
          style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8,
            paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}>
          <Text style={{ color: speed < 1 ? '#FF9500' : '#94a3b8', fontSize: 12, fontWeight: '800' }}>
            {speed}x
          </Text>
        </TouchableOpacity>
      </View>

      {/* フレームタイムライン */}
      <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 6 }}>
        <Text style={{ color: '#4b5563', fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 2 }}>
          フレームタイムライン（タップでシーク）
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {timestamps.map((ts, idx) => {
            const hasNote = frameNotes?.some(n => n.f === idx)
            const isActive = activeFrame === idx
            const thumb = frames[idx]
            return (
              <TouchableOpacity key={idx} onPress={() => seekToFrame(idx)} activeOpacity={0.8}>
                <View style={{ alignItems: 'center', gap: 3 }}>
                  <View style={[
                    { width: 64, height: 44, borderRadius: 8, borderWidth: 2, overflow: 'hidden',
                      backgroundColor: '#1e293b' },
                    isActive ? { borderColor: '#34C759' } : hasNote ? { borderColor: '#FF9500' } : { borderColor: 'transparent' },
                  ]}>
                    {thumb ? (
                      <Image source={{ uri: thumb }} style={{ width: '100%', height: '100%' }} />
                    ) : (
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: '#374151', fontSize: 10 }}>{idx + 1}</Text>
                      </View>
                    )}
                    {hasNote && !isActive && (
                      <View style={{ position: 'absolute', top: 2, right: 2, width: 8, height: 8,
                        borderRadius: 4, backgroundColor: '#FF9500' }} />
                    )}
                  </View>
                  <Text style={{ color: isActive ? '#34C759' : '#4b5563', fontSize: 9, fontWeight: '700' }}>
                    {formatMs(ts)}
                  </Text>
                </View>
              </TouchableOpacity>
            )
          })}
        </ScrollView>

        {/* フレームノート一覧 */}
        {frameNotes && frameNotes.length > 0 && (
          <View style={{ marginTop: 6, gap: 4 }}>
            {frameNotes.map((n, i) => (
              <TouchableOpacity key={i} onPress={() => seekToFrame(n.f)} activeOpacity={0.8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8,
                  backgroundColor: 'rgba(255,149,0,0.08)', borderRadius: 8,
                  paddingHorizontal: 10, paddingVertical: 6, borderLeftWidth: 2, borderLeftColor: '#FF9500' }}>
                <Text style={{ color: '#FF9500', fontSize: 10, fontWeight: '800', width: 40 }}>
                  {formatMs(timestamps[n.f] ?? 0)}
                </Text>
                <Text style={{ color: '#e2e8f0', fontSize: 12, flex: 1 }}>{n.note}</Text>
                <Ionicons name="play-circle-outline" size={14} color="#FF9500" />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </View>
  )
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? '#34C759' : score >= 60 ? '#FF9500' : '#FF3B30'
  const label = score >= 80 ? '優秀' : score >= 60 ? '良好' : '要改善'
  return (
    <View style={{ alignItems: 'center', paddingVertical: 24 }}>
      <View style={{ width: 140, height: 140, borderRadius: 70, borderWidth: 8, borderColor: color,
        alignItems: 'center', justifyContent: 'center', backgroundColor: color + '12' }}>
        <Text style={{ color, fontSize: 52, fontWeight: '900', lineHeight: 60 }}>{score}</Text>
        <Text style={{ color, fontSize: 12, fontWeight: '700' }}>/ 100</Text>
      </View>
      <View style={{ marginTop: 12, backgroundColor: color + '20', borderRadius: 20,
        paddingHorizontal: 16, paddingVertical: 5, borderWidth: 1, borderColor: color + '50' }}>
        <Text style={{ color, fontSize: 13, fontWeight: '800' }}>{label}</Text>
      </View>
    </View>
  )
}

function ResultSection({ title, color, icon, items }: {
  title: string; color: string; icon: string; items: string[]
}) {
  const [expanded, setExpanded] = useState(true)
  return (
    <View style={{ backgroundColor: color + '0D', borderRadius: 16, borderWidth: 1, borderColor: color + '30', overflow: 'hidden' }}>
      <TouchableOpacity
        onPress={() => setExpanded(e => !e)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}
        activeOpacity={0.8}
      >
        <Text style={{ fontSize: 18 }}>{icon}</Text>
        <Text style={{ flex: 1, color, fontSize: 14, fontWeight: '800' }}>{title}</Text>
        <Text style={{ fontSize: 16, color }}>{items.length}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={color} />
      </TouchableOpacity>
      {expanded && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
          {items.map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: color + '25',
                alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                <Text style={{ color, fontSize: 10, fontWeight: '900' }}>{i + 1}</Text>
              </View>
              <Text style={{ flex: 1, color: '#374151', fontSize: 13, lineHeight: 20 }}>{item}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

// 改善点詳細カード（issue / reason / fix の3階層で表示）
function ImprovementDetailSection({ items }: { items: ImprovementDetail[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  return (
    <View style={{ backgroundColor: '#fff7ed', borderRadius: 16, borderWidth: 1, borderColor: '#fed7aa', overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: items.length > 0 ? 1 : 0, borderBottomColor: '#fed7aa' }}>
        <Text style={{ fontSize: 18 }}>🔍</Text>
        <Text style={{ flex: 1, color: '#c2410c', fontSize: 14, fontWeight: '800' }}>改善点の詳細分析</Text>
        <Text style={{ fontSize: 16, color: '#c2410c' }}>{items.length}</Text>
      </View>
      <View style={{ padding: 12, gap: 10 }}>
        {items.map((item, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => setOpenIndex(openIndex === i ? null : i)}
            activeOpacity={0.85}
            style={{ backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#f97316' + '40', overflow: 'hidden' }}
          >
            {/* 問題ヘッダー */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: '#fff7ed' }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#ea580c',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>{i + 1}</Text>
              </View>
              <Text style={{ flex: 1, color: '#9a3412', fontSize: 13, fontWeight: '800', lineHeight: 18 }}>{item.issue}</Text>
              <Ionicons name={openIndex === i ? 'chevron-up' : 'chevron-down'} size={14} color="#c2410c" />
            </View>
            {/* 展開: 原因 + 改善方法 */}
            {openIndex === i && (
              <View style={{ padding: 12, gap: 10 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <View style={{ backgroundColor: '#fef3c7', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, flexShrink: 0 }}>
                    <Text style={{ color: '#92400e', fontSize: 10, fontWeight: '800' }}>なぜ</Text>
                  </View>
                  <Text style={{ flex: 1, color: '#374151', fontSize: 13, lineHeight: 20 }}>{item.reason}</Text>
                </View>
                <View style={{ height: 1, backgroundColor: '#f3f4f6' }} />
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <View style={{ backgroundColor: '#dcfce7', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, flexShrink: 0 }}>
                    <Text style={{ color: '#166534', fontSize: 10, fontWeight: '800' }}>改善</Text>
                  </View>
                  <Text style={{ flex: 1, color: '#374151', fontSize: 13, lineHeight: 20 }}>{item.fix}</Text>
                </View>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

// ─── コーチ送信ウィザード ─────────────────────────────────────────
function CoachSendMode() {
  const [step,       setStep]       = useState<1 | 2 | 3>(1)
  const [videoUri,   setVideoUri]   = useState<string | null>(null)
  const [thumbUri,   setThumbUri]   = useState<string | null>(null)
  const [message,    setMessage]    = useState('')
  const [event,      setEvent]      = useState('')
  const [sending,    setSending]    = useState(false)
  const [sent,       setSent]       = useState(false)

  const reset = () => { setSent(false); setStep(1); setVideoUri(null); setThumbUri(null); setMessage(''); setEvent('') }

  const pickFromLibrary = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) { Alert.alert('権限が必要です', '写真ライブラリへのアクセスを許可してください'); return }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'videos' as any, allowsEditing: false, quality: 1 })
      if (!res.canceled && res.assets[0]) {
        const uri = res.assets[0].uri
        setVideoUri(uri)
        try { const { uri: t } = await VideoThumbnails.getThumbnailAsync(uri, { time: 500 }); setThumbUri(t) } catch {}
        setStep(2)
      }
    } catch (e: any) { Alert.alert('エラー', e?.message ?? '動画の選択に失敗しました') }
  }

  const recordNow = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync()
      if (!perm.granted) { Alert.alert('権限が必要です', 'カメラへのアクセスを許可してください'); return }
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: 'videos' as any, allowsEditing: false, quality: 1, videoMaxDuration: 90 })
      if (!res.canceled && res.assets[0]) {
        const uri = res.assets[0].uri
        setVideoUri(uri)
        try { const { uri: t } = await VideoThumbnails.getThumbnailAsync(uri, { time: 100 }); setThumbUri(t) } catch {}
        setStep(2)
      }
    } catch (e: any) { Alert.alert('エラー', e?.message ?? '動画の撮影に失敗しました') }
  }

  const send = async () => {
    if (!videoUri) return
    setSending(true)
    try {
      const raw = await AsyncStorage.getItem(COACH_REQ_KEY)
      let list: CoachVideoRequest[] = []
      try { if (raw) list = JSON.parse(raw) } catch {}
      list.unshift({ id: Date.now().toString(), videoUri, thumbnailUri: thumbUri ?? '', message, event, sentAt: new Date().toISOString() })
      await AsyncStorage.setItem(COACH_REQ_KEY, JSON.stringify(list.slice(0, 30)))
      // コーチに通知 + Supabase team_videos にレコード作成（別デバイスのコーチが動画タブで確認できるように）
      try {
        const joinedRaw = await AsyncStorage.getItem(JOINED_KEY_VA)
        if (joinedRaw) {
          let joined: any
          try { joined = JSON.parse(joinedRaw) } catch {}
          if (joined?.code && joined?.playerName) {
            const desc = [event, message].filter(Boolean).join(' / ') || 'フォーム分析を送りました'
            await Promise.all([
              sendCoachNotification(joined.code, 'video', joined.playerName,
                `${joined.playerName}がフォーム分析を送信しました${event ? `（${event}）` : ''}`),
              // team_videos テーブルに登録 → コーチの「動画」タブに表示される
              submitVideo(joined.code, joined.playerName, '', desc),
            ])
          }
        }
      } catch {}
      setSent(true)
    } catch { Alert.alert('エラー', '送信に失敗しました') }
    finally { setSending(false) }
  }

  // ── 送信完了 ──
  if (sent) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#f6f6f8' }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
          <Ionicons name="checkmark-circle" size={56} color="#16a34a" />
        </View>
        <Text style={{ fontSize: 22, fontWeight: '900', color: '#111827', marginBottom: 10, textAlign: 'center' }}>
          コーチに送りました！
        </Text>
        <Text style={{ fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 22, marginBottom: 32 }}>
          コーチがアプリを開いたときに{'\n'}「コーチビュー」から確認できます。
        </Text>
        <TouchableOpacity style={cst.primaryBtn} onPress={reset}>
          <Text style={cst.primaryBtnText}>もう一本送る</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── ステップインジケーター ──
  const StepDots = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 28 }}>
      {(['動画', 'メモ', '確認'] as const).map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3
        const active  = step === n
        const done    = step > n
        return (
          <React.Fragment key={n}>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <View style={[cst.stepDot, active && cst.stepDotActive, done && cst.stepDotDone]}>
                {done
                  ? <Ionicons name="checkmark" size={12} color="#fff" />
                  : <Text style={[cst.stepDotNum, active && { color: '#fff' }]}>{n}</Text>}
              </View>
              <Text style={[cst.stepLabel, active && { color: '#111827', fontWeight: '700' }]}>{label}</Text>
            </View>
            {i < 2 && <View style={[cst.stepLine, done && { backgroundColor: '#16a34a' }]} />}
          </React.Fragment>
        )
      })}
    </View>
  )

  // ── STEP 1: 動画選択 ──
  if (step === 1) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: '#f6f6f8' }} contentContainerStyle={cst.scroll} keyboardShouldPersistTaps="handled">
        <Text style={cst.title}>動画を選んでください</Text>
        <Text style={cst.subtitle}>コーチに見てほしいシーンを送りましょう</Text>
        <StepDots />

        <TouchableOpacity style={cst.bigCard} onPress={recordNow} activeOpacity={0.85}>
          <View style={[cst.bigCardIcon, { backgroundColor: '#dcfce7' }]}>
            <Ionicons name="videocam" size={40} color="#16a34a" />
          </View>
          <Text style={cst.bigCardTitle}>今すぐ撮影する</Text>
          <Text style={cst.bigCardSub}>カメラを起動して録画（最大90秒）</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[cst.bigCard, { marginTop: 12 }]} onPress={pickFromLibrary} activeOpacity={0.85}>
          <View style={[cst.bigCardIcon, { backgroundColor: '#f0fdf4' }]}>
            <Ionicons name="images" size={40} color="#22c55e" />
          </View>
          <Text style={cst.bigCardTitle}>ライブラリから選ぶ</Text>
          <Text style={cst.bigCardSub}>撮り貯めた動画から選択</Text>
        </TouchableOpacity>

        <View style={cst.tipBox}>
          <Ionicons name="bulb-outline" size={16} color="#ca8a04" />
          <Text style={cst.tipText}>
            横向きで撮ると全身が映りやすいです。{'\n'}
            正面・側面・後方の3方向があるとベストです。
          </Text>
        </View>
      </ScrollView>
    )
  }

  // ── STEP 2: メモ入力 ──
  if (step === 2) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: '#f6f6f8' }} contentContainerStyle={cst.scroll} keyboardShouldPersistTaps="handled">
        <Text style={cst.title}>コーチへのメモ</Text>
        <Text style={cst.subtitle}>どこを見てほしいか教えましょう（任意）</Text>
        <StepDots />

        {/* サムネイル */}
        {thumbUri && (
          <View style={{ alignItems: 'center', marginBottom: 20 }}>
            <Image source={{ uri: thumbUri }} style={{ width: 200, height: 120, borderRadius: 14, backgroundColor: '#e5e7eb' }} />
            <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>選択済み ✓</Text>
          </View>
        )}

        {/* 種目 */}
        <Text style={cst.fieldLabel}>種目</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8 }}>
          {['', '100m','200m','400m','800m','1500m','走幅跳','三段跳','走高跳','棒高跳','110mH','400mH','5000m'].map(ev => (
            <TouchableOpacity
              key={ev || 'none'}
              style={[cst.chip, event === ev && cst.chipActive]}
              onPress={() => setEvent(ev)}
              activeOpacity={0.8}
            >
              <Text style={[cst.chipText, event === ev && { color: '#fff' }]}>{ev || '指定なし'}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* フォーカスヒント */}
        <Text style={cst.fieldLabel}>見てほしいところ（タップで追加）</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {FOCUS_HINTS.map(hint => {
            const selected = message.includes(hint)
            return (
              <TouchableOpacity
                key={hint}
                style={[cst.hintChip, selected && cst.hintChipActive]}
                onPress={() => {
                  setMessage(prev =>
                    selected ? prev.replace(hint, '').replace(/[、,]\s*/g, '、').replace(/^[、,]/, '').replace(/[、,]$/, '').trim()
                             : prev ? `${prev}、${hint}` : hint
                  )
                }}
                activeOpacity={0.8}
              >
                <Text style={[cst.hintChipText, selected && { color: '#16a34a', fontWeight: '800' }]}>{hint}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        {/* テキスト入力 */}
        <TextInput
          style={cst.textarea}
          value={message}
          onChangeText={setMessage}
          placeholder="その他に気になることを自由に書いてください..."
          placeholderTextColor="#9ca3af"
          multiline
          numberOfLines={3}
        />

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <TouchableOpacity style={cst.secondaryBtn} onPress={() => setStep(1)}>
            <Text style={cst.secondaryBtnText}>← 戻る</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[cst.primaryBtn, { flex: 1 }]} onPress={() => setStep(3)}>
            <Text style={cst.primaryBtnText}>確認する →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    )
  }

  // ── STEP 3: 確認して送信 ──
  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f6f6f8' }} contentContainerStyle={cst.scroll}>
      <Text style={cst.title}>確認して送信</Text>
      <Text style={cst.subtitle}>内容を確認したら送ってください</Text>
      <StepDots />

      <View style={cst.confirmCard}>
        {thumbUri && (
          <Image source={{ uri: thumbUri }} style={{ width: '100%', height: 180, borderRadius: 10, backgroundColor: '#e5e7eb', marginBottom: 14 }} />
        )}
        <View style={cst.confirmRow}>
          <Text style={cst.confirmLabel}>種目</Text>
          <Text style={cst.confirmValue}>{event || '指定なし'}</Text>
        </View>
        <View style={cst.divider} />
        <View style={cst.confirmRow}>
          <Text style={cst.confirmLabel}>コーチへのメモ</Text>
          <Text style={[cst.confirmValue, { flex: 1, textAlign: 'right' }]} numberOfLines={3}>
            {message || '（なし）'}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[cst.sendBtn, sending && { opacity: 0.6 }]}
        onPress={send}
        disabled={sending}
        activeOpacity={0.85}
      >
        {sending
          ? <ActivityIndicator color="#fff" />
          : <>
              <Ionicons name="paper-plane" size={20} color="#fff" />
              <Text style={cst.sendBtnText}>コーチに送る</Text>
            </>
        }
      </TouchableOpacity>

      <TouchableOpacity style={cst.secondaryBtn} onPress={() => setStep(2)}>
        <Text style={cst.secondaryBtnText}>← 修正する</Text>
      </TouchableOpacity>

      <Text style={cst.noteText}>
        送信した動画は、コーチがアプリの「コーチビュー」から確認できます。
      </Text>
    </ScrollView>
  )
}

// ─── タブ切替ラッパー ─────────────────────────────────────────────
function NativeVideoAnalysisRoot() {
  const [activeTab, setActiveTab] = useState<'ai' | 'coach'>('ai')
  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
      {/* タブ */}
      <View style={cst.tabBar}>
        <TouchableOpacity
          style={[cst.tab, activeTab === 'ai' && cst.tabActive]}
          onPress={() => setActiveTab('ai')}
          activeOpacity={0.8}
        >
          <Ionicons name="sparkles" size={14} color={activeTab === 'ai' ? '#fff' : '#6b7280'} />
          <Text style={[cst.tabText, activeTab === 'ai' && { color: '#fff' }]}>AIで自分で分析</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[cst.tab, activeTab === 'coach' && { backgroundColor: '#16a34a' }]}
          onPress={() => setActiveTab('coach')}
          activeOpacity={0.8}
        >
          <Ionicons name="paper-plane" size={14} color={activeTab === 'coach' ? '#fff' : '#6b7280'} />
          <Text style={[cst.tabText, activeTab === 'coach' && { color: '#fff' }]}>コーチに送る</Text>
        </TouchableOpacity>
      </View>
      {activeTab === 'ai'
        ? <NativeVideoAnalysis />
        : <CoachSendMode />
      }
    </View>
  )
}

// ─── コーチ送信モード スタイル ────────────────────────────────────
const cst = StyleSheet.create({
  scroll:          { padding: 24, paddingBottom: 48 },
  title:           { fontSize: 22, fontWeight: '900', color: '#111827', marginBottom: 4 },
  subtitle:        { fontSize: 13, color: '#6b7280', marginBottom: 24, lineHeight: 19 },

  // ステップ
  stepDot:         { width: 28, height: 28, borderRadius: 14, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  stepDotActive:   { backgroundColor: '#111827' },
  stepDotDone:     { backgroundColor: '#16a34a' },
  stepDotNum:      { fontSize: 12, fontWeight: '800', color: '#9ca3af' },
  stepLine:        { flex: 1, height: 2, backgroundColor: '#e5e7eb', marginBottom: 18 },
  stepLabel:       { fontSize: 11, color: '#9ca3af' },

  // 大カード（Step 1）
  bigCard:         { backgroundColor: '#fff', borderRadius: 21, padding: 24, alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.08)' },
  bigCardIcon:     { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  bigCardTitle:    { fontSize: 18, fontWeight: '800', color: '#111827' },
  bigCardSub:      { fontSize: 13, color: '#6b7280', textAlign: 'center' },

  // Tip
  tipBox:          { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#fefce8', borderRadius: 12, padding: 14, marginTop: 20, borderWidth: 1, borderColor: '#fde047' },
  tipText:         { fontSize: 12, color: '#713f12', lineHeight: 18, flex: 1 },

  // フィールド
  fieldLabel:      { fontSize: 12, fontWeight: '800', color: '#374151', marginBottom: 8, letterSpacing: 0.3 },
  chip:            { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  chipActive:      { backgroundColor: '#111827', borderColor: '#111827' },
  chipText:        { fontSize: 13, fontWeight: '700', color: '#6b7280' },
  hintChip:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' },
  hintChipActive:  { backgroundColor: '#dcfce7', borderColor: '#16a34a' },
  hintChipText:    { fontSize: 12, fontWeight: '600', color: '#374151' },
  textarea:        { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.10)', padding: 14, fontSize: 14, color: '#111827', minHeight: 80, textAlignVertical: 'top' },

  // 確認カード
  confirmCard:     { backgroundColor: '#fff', borderRadius: 21, padding: 18, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  confirmRow:      { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 8, gap: 12 },
  confirmLabel:    { fontSize: 12, color: '#9ca3af', fontWeight: '600', paddingTop: 2 },
  confirmValue:    { fontSize: 14, color: '#111827', fontWeight: '600' },
  divider:         { height: 1, backgroundColor: 'rgba(0,0,0,0.07)' },

  // ボタン
  primaryBtn:      { backgroundColor: '#111827', borderRadius: 21, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText:  { color: '#fff', fontSize: 16, fontWeight: '800' },
  secondaryBtn:    { backgroundColor: '#f3f4f6', borderRadius: 21, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  secondaryBtnText:{ color: '#374151', fontSize: 15, fontWeight: '700' },
  sendBtn:         { backgroundColor: '#16a34a', borderRadius: 21, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 12, shadowColor: '#16a34a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12 },
  sendBtnText:     { color: '#fff', fontSize: 18, fontWeight: '900' },
  noteText:        { fontSize: 12, color: '#9ca3af', textAlign: 'center', lineHeight: 18, marginTop: 8 },

  // タブバー
  tabBar:          { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.08)', padding: 8, gap: 8 },
  tab:             { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: '#f3f4f6' },
  tabActive:       { backgroundColor: '#111827' },
  tabText:         { fontSize: 13, fontWeight: '700', color: '#6b7280' },
})

/* ─── ネイティブ動画分析（iOS/Android）──────────────── */
function NativeVideoAnalysis() {
  const [phase, setPhase]             = useState<AnalysisPhase>('idle')
  const [videoUri, setVideoUri]       = useState<string | null>(null)
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null)
  const [localVideoUri, setLocalVideoUri] = useState<string | null>(null)
  const [frames, setFrames]           = useState<string[]>([])
  const [frameTimestampsUsed, setFrameTimestampsUsed] = useState<number[]>(FRAME_TIMESTAMPS)
  const [event, setEvent]             = useState('')
  const [clothingColor, setClothingColor] = useState('')
  const [shoeColor,     setShoeColor]     = useState('')
  const [result, setResult]           = useState<AnalysisResult | null>(null)
  const [rawText, setRawText]         = useState('')
  const [error, setError]             = useState('')
  const [stepLabel, setStepLabel]     = useState('')
  const [adGateVisible,     setAdGateVisible]     = useState(false)
  const [adGateRemaining,   setAdGateRemaining]   = useState(0)
  const [adGateHardLimited, setAdGateHardLimited] = useState(false)
  const [adGateLimitType,   setAdGateLimitType]   = useState<'none'|'daily'|'monthly'|'total'|'window'>('none')
  const [remaining,         setRemaining]         = useState<number | null>(null)
  const [upsellVisible,     setUpsellVisible]     = useState(false)
  const { isGuest } = useAuth()
  const router = useRouter()
  // 連続タップによる二重起動防止（AdGate async チェック中もガード）
  const analyzingRef = React.useRef(false)
  // 広告視聴済みクレジット（分析失敗時のリトライも広告なしで通す）
  const adCreditRef = React.useRef(false)

  React.useEffect(() => {
    checkAdGate('video').then(g => {
      if (g.remaining < 999) setRemaining(g.remaining)
    }).catch(() => {})
  }, [])

  // 分析結果表示後にインタースティシャル広告を表示
  React.useEffect(() => {
    if (phase !== 'result') return
    showInterstitialAd().catch(() => {})
  }, [phase])

  async function pickVideo() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) { Alert.alert('権限が必要です', '写真ライブラリへのアクセスを許可してください'); return }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'videos' as any,
        allowsEditing: false, quality: 1,
      })
      if (!res.canceled && res.assets[0]) {
        setVideoUri(res.assets[0].uri)
        // expo-image-picker は動画アセットの再生時間を「ミリ秒」で返す（秒ではない）。
        // これが取れないと、動画の長さに関わらず固定タイムスタンプで
        // フレーム抽出することになり、短い動画では黒コマ、長い動画では
        // 一部区間しか分析されない不具合が起きるため、必ず実測値を使う。
        const durMs = (res.assets[0] as any).duration
        setVideoDurationMs(typeof durMs === 'number' && durMs > 0 ? durMs : null)
        setLocalVideoUri(null)
        setResult(null); setRawText(''); setError(''); setFrames([])
        setPhase('idle')
      }
    } catch (e: any) { Alert.alert('エラー', e?.message ?? '動画の選択に失敗しました') }
  }

  async function analyze(skipGate = false, forceRefresh = false) {
    if (analyzingRef.current) return   // 二重タップ防止
    if (!videoUri) { Alert.alert('動画を選択してください'); return }
    // ゲストはログイン必須
    if (isGuest) { setAdGateRemaining(0); setAdGateHardLimited(false); setAdGateVisible(true); return }
    // 広告視聴済みクレジットがあればゲートをスキップ（分析失敗時のリトライも許可）
    const usedAdCredit = adCreditRef.current
    if (adCreditRef.current) { skipGate = true }
    // AdGateチェック（広告視聴後は skipGate=true でバイパス）
    if (!skipGate) {
      const gate = await checkAdGate('video')
      if (!gate.allowed) { setAdGateRemaining(gate.remaining); setAdGateHardLimited(gate.hardLimited); setAdGateLimitType(gate.limitType); setAdGateVisible(true); return }
      await recordUsage('video')
    }
    analyzingRef.current = true
    trackFeatureUse('video')
    checkAdGate('video').then(g => { if (g.remaining < 999) setRemaining(g.remaining) }).catch(() => {})
    setError(''); setResult(null); setRawText('')

    try {
      // ── キャッシュチェック（forceRefresh=true のときはスキップ） ──
      if (!forceRefresh) {
        const cached = await getAnalysisCache(videoUri, event)
        if (cached) {
          setResult(cached); setPhase('result'); analyzingRef.current = false; return
        }
      }

      // ── Step 1: フレーム抽出 ──
      setPhase('extracting')
      setStepLabel('動画からフレームを抽出中...')

      let localUri = videoUri
      if (videoUri.startsWith('ph://') || !videoUri.startsWith('file://')) {
        const dest = (FileSystem as any).cacheDirectory + `score_video_${Date.now()}.mp4`
        try {
          await FileSystem.copyAsync({ from: videoUri, to: dest })
        } catch {
          // iCloudにのみ保存されている動画は端末への同期が必要（PHPhotosErrorDomain等）
          throw new Error('動画の読み込みに失敗しました。iCloudにのみ保存されている場合は、写真アプリで一度動画を開いて端末にダウンロードしてから再度お試しください。')
        }
        localUri = dest
      }
      setLocalVideoUri(localUri)

      const base64Frames: string[] = []
      const thumbUris: string[] = []

      // 動画の実際の長さに応じてタイムスタンプを均等割り（取得できない場合は固定値にフォールバック）
      const timestampsForThisVideo = computeFrameTimestamps(videoDurationMs)
      setFrameTimestampsUsed(timestampsForThisVideo)

      // 320px / compress 0.45 → 画像トークン数を ~50% 削減
      for (const t of timestampsForThisVideo) {
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(localUri, { time: t, quality: 0.8 })
          const resized = await ImageManipulator.manipulateAsync(
            uri, [{ resize: { width: 440 } }],  // 480→440: フレーム5→6枚化に伴い1枚あたりのトークンを微減して総量を維持
            { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
          )
          const b64 = await FileSystem.readAsStringAsync(resized.uri, { encoding: FileSystem.EncodingType.Base64 })
          base64Frames.push(b64)
          thumbUris.push(resized.uri)
        } catch { /* 動画長より後のタイムスタンプはスキップ */ }
      }

      // フォールバック: 最初の1フレーム
      if (base64Frames.length === 0) {
        const { uri } = await VideoThumbnails.getThumbnailAsync(localUri, { time: 0 })
        const resized = await ImageManipulator.manipulateAsync(
          uri, [{ resize: { width: 480 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
        )
        const b64 = await FileSystem.readAsStringAsync(resized.uri, { encoding: 'base64' as any })
        base64Frames.push(b64); thumbUris.push(resized.uri)
      }

      if (base64Frames.length === 0) throw new Error('フレームの取得に失敗しました')
      setFrames(thumbUris)

      // ── Step 2: AI分析 ──
      setPhase('analyzing')
      setStepLabel(`${base64Frames.length}フレームをAIで分析中...`)

      // 抽出したフレーム(最大FRAME_COUNT枚)を全て使用。
      // 以前は4枚に制限していたが、computeFrameTimestampsが動画終盤まで
      // 均等割りで抽出しているのに末尾のフレームだけ切り捨てられ、
      // 終盤の動きが分析に反映されない不具合があったため撤廃。
      const imageBlocks = base64Frames.slice(0, FRAME_COUNT).map(b64 => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: b64 },
      }))

      // 人物特定情報をプロンプトに組み込む
      const personHint = [
        clothingColor ? `服の色：${clothingColor}` : '',
        shoeColor     ? `靴の色：${shoeColor}` : '',
      ].filter(Boolean).join('、')

      // 採点の基準点を明示し、モデルが無難な中間点に逃げるのを防ぐ
      const nF = imageBlocks.length
      const prompt = `陸上${event ? `(${event})` : ''}フォーム分析。${personHint ? `対象:${personHint}。` : ''}${nF}フレーム(0〜${nF-1})を、実際に写っている姿勢・関節角度・接地位置から具体的に評価せよ。画像から判断できない項目は無理に指摘せず、見えている範囲だけで評価すること。

採点基準（0-100、必ず画像の内容に応じて差をつけること。迷っても中間の点数に逃げない）:
- 90-100: トップ選手レベル。重心の真下での接地、無駄のない腕振り、上下動が少ない
- 70-89: 実業団・大学レベル。フォームの大枠は良いが細部に改善点がある
- 50-69: 一般的な部活生レベル。基本はできているが明確な改善点が複数ある
- 30-49: フォームに大きな崩れがある（過度な後傾、ブレーキ動作、腕の振りすぎ等）
- 0-29: 画像が不鮮明、または陸上競技のフォームと判断できない

コードブロック不使用・生のJSONのみで回答:
{"score":0-100,"overall":"総評50字","positives":["良い点(部位明記)","良い点2","良い点3"],"improvements":["改善要約1","改善要約2","改善要約3"],"improvementDetails":[{"issue":"問題(部位と動作)","reason":"原因","fix":"改善方法"}],"menu":[{"name":"ドリル","detail":"方法・セット数"}],"frameNotes":[{"f":番号,"note":"指摘20字"}]}
improvementDetails:3件、issue/reason/fix必須。menu:2件。frameNotes:最大2件。`

      // Vercel proxy経由でAnthropicを呼び出し（APIキーをクライアントに持たせない）
      const apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
      const endpoint = `${apiBase}/api/analyze`

      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 1500,  // 1100だと項目が多いJSONが途中で切れてパース失敗し常に60点フォールバックになっていたため増量（コスト配慮で2000より抑制）
          messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }],
        }),
      }, 45000)

      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        throw new Error(`APIエラー (${res.status}): ${errBody.slice(0, 120)}`)
      }
      const json = await res.json()
      // Sonnet 5 は thinking ブロックが content[0] に入るため、text ブロックを探して取得する
      const text = json?.content?.find((b: any) => b.type === 'text')?.text ?? ''
      setRawText(text)

      // JSONパース（複数の方法で試みる）
      let parsed: AnalysisResult | null = null
      // 方法1: コードブロック内のJSON（greedyで完全なJSONを取得）
      const codeMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/)
      // 方法2: 生のJSON（コードブロックなし）
      const rawMatch = text.match(/\{[\s\S]*\}/)
      const jsonStr = codeMatch?.[1] ?? rawMatch?.[0] ?? null
      if (jsonStr) {
        try {
          const p = JSON.parse(jsonStr) as any
          parsed = {
            score: typeof p.score === 'number' ? p.score : 60,
            overall: p.overall ?? '分析完了',
            positives: Array.isArray(p.positives) ? p.positives : [],
            improvements: Array.isArray(p.improvements) ? p.improvements : [],
            improvementDetails: Array.isArray(p.improvementDetails)
              ? p.improvementDetails.filter((d: any) => d?.issue && d?.reason && d?.fix)
              : undefined,
            menu: Array.isArray(p.menu) ? p.menu : [],
            frameNotes: Array.isArray(p.frameNotes) ? p.frameNotes : undefined,
          }
        } catch { parsed = null }
      }
      // 方法3: JSONが取れなければテキストから最低限の結果を生成
      // コードブロック行・空行・記号のみの行を除外して有効なテキストを探す
      if (!parsed && text.trim().length > 0) {
        const validLine = text.split('\n').find((l: string) => {
          const t = l.trim()
          return t.length > 5 && !t.startsWith('`') && !t.startsWith('{') && !t.startsWith('[')
        })
        parsed = {
          score: 60,
          overall: validLine?.slice(0, 80) ?? '分析完了',
          positives: [],
          improvements: [],
          menu: [],
        }
      }
      setResult(parsed)
      setPhase('result')
      adCreditRef.current = false  // 分析成功でクレジット消費
      // 広告視聴後の分析が完了したら、広告なしプランへのアップセルを提示
      if (usedAdCredit) setUpsellVisible(true)
      // キャッシュに保存（同じ動画の再分析コストをゼロに）
      if (parsed) setAnalysisCache(videoUri, event, parsed).catch(() => {})
    } catch (e: any) {
      setError(e?.message ?? '分析に失敗しました')
      setPhase('idle')
      // 分析失敗時はクレジットを残す（リトライを広告なしで許可）
    } finally {
      analyzingRef.current = false
    }
  }

  const scoreColor = result
    ? result.score >= 80 ? '#34C759' : result.score >= 60 ? '#FF9500' : '#FF3B30'
    : '#166534'

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f5f7' }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ヘッダー */}
        <View style={{ marginBottom: 20 }}>
          <Text style={{ color: '#111827', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 }}>フォーム分析</Text>
          <Text style={{ color: '#6b7280', fontSize: 13, marginTop: 2 }}>AIが{MAX_FRAMES}フレームを同時解析・最速診断</Text>
        </View>

        {/* 種目入力 */}
        <View style={{ marginBottom: 14 }}>
          <Text style={{ color: '#6b7280', fontSize: 11, fontWeight: '700', marginBottom: 6, letterSpacing: 0.8 }}>種目（任意）</Text>
          <TextInput
            style={{ backgroundColor: '#fff', color: '#111827', borderRadius: 12,
              padding: 14, fontSize: 15, borderWidth: 1, borderColor: '#e5e7eb' }}
            placeholder="例：100m、走り幅跳び"
            placeholderTextColor="#9ca3af"
            value={event}
            onChangeText={setEvent}
          />
        </View>

        {/* 分析対象の人物特定（複数人対応） */}
        <View style={{ marginBottom: 14, backgroundColor: '#fff', borderRadius: 14,
          borderWidth: 1, borderColor: '#e5e7eb', padding: 14 }}>
          <Text style={{ color: '#6b7280', fontSize: 11, fontWeight: '700', marginBottom: 10, letterSpacing: 0.8 }}>
            👤 分析対象の特定（複数人映っている場合）
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#9ca3af', fontSize: 10, fontWeight: '600', marginBottom: 5 }}>服の色</Text>
              <TextInput
                style={{ backgroundColor: '#f9fafb', color: '#111827', borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: '#e5e7eb' }}
                placeholder="例：赤、白など"
                placeholderTextColor="#9ca3af"
                value={clothingColor}
                onChangeText={setClothingColor}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#9ca3af', fontSize: 10, fontWeight: '600', marginBottom: 5 }}>靴の色</Text>
              <TextInput
                style={{ backgroundColor: '#f9fafb', color: '#111827', borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: '#e5e7eb' }}
                placeholder="例：黒、黄など"
                placeholderTextColor="#9ca3af"
                value={shoeColor}
                onChangeText={setShoeColor}
              />
            </View>
          </View>
          {(clothingColor || shoeColor) ? (
            <Text style={{ color: '#16a34a', fontSize: 11, marginTop: 8 }}>
              ✓ {[clothingColor && `服：${clothingColor}`, shoeColor && `靴：${shoeColor}`].filter(Boolean).join('　')}の選手を分析対象にします
            </Text>
          ) : (
            <Text style={{ color: '#9ca3af', fontSize: 11, marginTop: 6 }}>入力すると複数人の動画でも正確に分析できます</Text>
          )}
        </View>

        {/* 動画選択 */}
        <TouchableOpacity
          onPress={pickVideo}
          activeOpacity={0.8}
          style={{
            borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 14,
            backgroundColor: videoUri ? 'rgba(22,163,74,0.06)' : '#fff',
            borderWidth: 2,
            borderColor: videoUri ? '#16a34a' : '#e5e7eb',
            borderStyle: videoUri ? 'solid' : 'dashed' as any,
          }}
        >
          <Ionicons
            name={videoUri ? 'film' : 'cloud-upload-outline'}
            size={40}
            color={videoUri ? '#16a34a' : '#9ca3af'}
          />
          <Text style={{ color: videoUri ? '#16a34a' : '#6b7280', fontSize: 14, marginTop: 10, fontWeight: '700' }}>
            {videoUri ? '動画選択済み ✓  （タップして変更）' : '動画をタップして選択'}
          </Text>
          {!videoUri && (
            <Text style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}>MP4 / MOV 対応</Text>
          )}
        </TouchableOpacity>

        {/* 抽出フレームサムネイル */}
        {frames.length > 0 && (
          <View style={{ marginBottom: 14 }}>
            <Text style={{ color: '#6b7280', fontSize: 11, fontWeight: '700', marginBottom: 8, letterSpacing: 0.8 }}>
              抽出フレーム ({frames.length}枚)
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {frames.map((uri, i) => (
                <View key={i} style={{ position: 'relative' }}>
                  <Image
                    source={{ uri }}
                    style={{ width: 80, height: 56, borderRadius: 10, backgroundColor: '#e5e7eb' }}
                  />
                  <View style={{ position: 'absolute', bottom: 3, right: 3,
                    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>{i + 1}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* エラー */}
        {error ? (
          <View style={{ backgroundColor: '#fef2f2', borderRadius: 12, padding: 12,
            borderWidth: 1, borderColor: '#fca5a5', marginBottom: 14 }}>
            <Text style={{ color: '#dc2626', fontSize: 13 }}>⚠️ {error}</Text>
          </View>
        ) : null}

        {/* 分析ボタン / ローディング */}
        {phase === 'extracting' || phase === 'analyzing' ? (
          <View style={{ alignItems: 'center', paddingVertical: 30, gap: 12 }}>
            <ActivityIndicator color="#16a34a" size="large" />
            <Text style={{ color: '#6b7280', fontSize: 14, fontWeight: '600' }}>{stepLabel}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {['フレーム抽出', 'AI解析', '結果生成'].map((step, i) => {
                const done = (phase === 'extracting' && i === 0) || (phase === 'analyzing' && i <= 1)
                return (
                  <View key={step} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3,
                      backgroundColor: done ? '#16a34a' : '#d1d5db' }} />
                    <Text style={{ color: done ? '#16a34a' : '#9ca3af', fontSize: 11 }}>{step}</Text>
                  </View>
                )
              })}
            </View>
          </View>
        ) : (
          <>
            {/* 残り回数バッジ */}
            {remaining !== null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8,
                backgroundColor: remaining <= 1 ? '#fef2f2' : '#f0fdf4',
                borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start',
                borderWidth: 1, borderColor: remaining <= 1 ? '#fca5a5' : '#bbf7d0',
              }}>
                <Ionicons name={remaining <= 1 ? 'warning-outline' : 'flash-outline'} size={12}
                  color={remaining <= 1 ? '#dc2626' : '#16a34a'}/>
                <Text style={{ fontSize: 11, fontWeight: '700', color: remaining <= 1 ? '#dc2626' : '#16a34a' }}>
                  {remaining === 0 ? '無料枠を使い切りました' : `残り${remaining}回（無料枠）`}
                </Text>
              </View>
            )}
            <TouchableOpacity
              onPress={() => analyze(false, phase === 'result')}
              disabled={!videoUri}
              activeOpacity={0.85}
              style={{
                backgroundColor: videoUri ? '#16a34a' : '#e5e7eb',
                borderRadius: 16, padding: 18, alignItems: 'center',
                marginBottom: 24, flexDirection: 'row', justifyContent: 'center', gap: 8,
                shadowColor: videoUri ? '#16a34a' : 'transparent',
                shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12,
              }}
            >
              <Ionicons name="sparkles" size={18} color={videoUri ? '#fff' : '#9ca3af'} />
              <Text style={{ color: videoUri ? '#fff' : '#9ca3af', fontSize: 16, fontWeight: '800' }}>
                {phase === 'result' ? '再分析する' : 'AIで分析する'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── 結果 ── */}
        {result && phase === 'result' && (
          <View style={{ gap: 14 }}>
            {/* 動画プレイヤー（スロー再生・フレームアノテーション） */}
            {localVideoUri && (
              <VideoAnnotationPlayer
                videoUri={localVideoUri}
                frames={frames}
                frameNotes={result.frameNotes}
                frameTimestamps={frameTimestampsUsed}
              />
            )}

            {/* スコアリング */}
            <View style={{ backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: scoreColor + '40',
              overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 }}>
              <View style={{ height: 3, backgroundColor: scoreColor }} />
              <ScoreRing score={result.score} />
              <View style={{ paddingHorizontal: 20, paddingBottom: 18 }}>
                <Text style={{ color: '#374151', fontSize: 15, lineHeight: 24, textAlign: 'center' }}>
                  {result.overall}
                </Text>
              </View>
            </View>

            {/* 良い点 */}
            {result.positives?.length > 0 && (
              <ResultSection title="良い点" color="#16a34a" icon="✅" items={result.positives} />
            )}

            {/* 改善点（詳細あれば詳細カード、なければ従来表示） */}
            {result.improvementDetails && result.improvementDetails.length > 0 ? (
              <ImprovementDetailSection items={result.improvementDetails} />
            ) : result.improvements?.length > 0 ? (
              <ResultSection title="改善点" color="#d97706" icon="⚠️" items={result.improvements} />
            ) : null}

            {/* 練習メニュー */}
            {result.menu?.length > 0 && (
              <View style={{ backgroundColor: '#eff6ff', borderRadius: 16, borderWidth: 1, borderColor: '#bfdbfe', padding: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Text style={{ fontSize: 18 }}>🏃</Text>
                  <Text style={{ color: '#2563eb', fontSize: 14, fontWeight: '800' }}>おすすめ練習メニュー</Text>
                </View>
                {result.menu.map((m, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 12, marginBottom: 10, alignItems: 'flex-start' }}>
                    <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#dbeafe',
                      alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#2563eb', fontSize: 12, fontWeight: '900' }}>{i + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#111827', fontSize: 14, fontWeight: '700' }}>{m.name}</Text>
                      <Text style={{ color: '#6b7280', fontSize: 12, lineHeight: 18, marginTop: 2 }}>{m.detail}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* 再分析ボタン */}
            <TouchableOpacity
              onPress={() => analyze(false, true)}
              activeOpacity={0.85}
              style={{ borderRadius: 16, padding: 16, alignItems: 'center',
                backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb' }}
            >
              <Text style={{ color: '#6b7280', fontSize: 14, fontWeight: '700' }}>🔄 再分析する</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* JSON未パース時のフォールバック */}
        {rawText && !result && phase === 'result' && (
          <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#e5e7eb' }}>
            <Text style={{ color: '#6b7280', fontSize: 13, lineHeight: 22 }}>{rawText}</Text>
          </View>
        )}
      </ScrollView>

      <BannerAdView />

      <AdGateModal
        visible={adGateVisible}
        feature="video"
        remaining={adGateRemaining}
        hardLimited={adGateHardLimited}
        limitType={adGateLimitType}
        isGuest={isGuest}
        onClose={() => setAdGateVisible(false)}
        onAdWatched={async () => {
          setAdGateVisible(false)
          await recordUsage('video')
          trackFeatureUse('video')
          checkAdGate('video').then(g2 => { if (g2.remaining < 999) setRemaining(g2.remaining) }).catch(() => {})
          adCreditRef.current = true  // 広告視聴済みクレジット付与（失敗時リトライも許可）
          setError(''); setResult(null); setRawText('')
          analyze(true, true)  // forceRefresh=true で必ず新規分析を実行
        }}
        onUpgrade={() => { setAdGateVisible(false); router.push('/paywall') }}
      />

      {/* ── 分析結果後アップセルシート（広告視聴で分析した直後に表示） ── */}
      <Modal visible={upsellVisible} transparent animationType="slide" onRequestClose={() => setUpsellVisible(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={() => setUpsellVisible(false)}>
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
            <Pressable onPress={() => {}}>
              <View style={{ backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 16 }}>
                <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 4 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="star" size={24} color="#16a34a" />
                  <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>広告なしプランにしませんか？</Text>
                </View>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 20 }}>
                  無料枠を使い切ると広告視聴が必要になります。{'\n'}
                  広告なしプランなら、フォーム分析も食事分析も広告なしで使い放題です。
                </Text>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 14, gap: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>FREE（今のプラン）</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>無料枠超過後は広告視聴</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ backgroundColor: '#166534', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>広告なし</Text>
                      </View>
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>¥980/月</Text>
                    </View>
                    <Text style={{ color: '#4ade80', fontSize: 12, fontWeight: '700' }}>広告一切なし</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={{ backgroundColor: '#166534', borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}
                  onPress={() => { setUpsellVisible(false); router.push('/paywall?plan=noad' as any) }}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>広告なしプランを見る ¥980/月〜</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 4 }} onPress={() => setUpsellVisible(false)} activeOpacity={0.7}>
                  <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>今はしない</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

/* ─── メイン ──────────────────────────────────── */
export default function VideoAnalysis() {
  if (Platform.OS !== 'web') {
    return <NativeVideoAnalysisRoot />
  }
  return <WebPlayer isPremiumUser={true} />
}

/* ─── プレミアムゲート ──────────────────────────── */
function PremiumGate() {
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <View style={{ alignItems: 'center', gap: 20, maxWidth: 400 }}>
        <View style={{ width: 80, height: 80, borderRadius: 20, backgroundColor: '#16653422', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#16653444' }}>
          <Ionicons name="videocam" size={36} color="#166534" />
        </View>
        <Text style={{ color: '#111827', fontSize: 22, fontWeight: '900', textAlign: 'center' }}>
          フォーム動画分析
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center', lineHeight: 22 }}>
          AIによる動画フォーム分析は{'\n'}プレミアムプラン限定の機能です
        </Text>

        {/* 機能説明 */}
        {[
          { icon: '🎯', text: 'フレームごとのAIフォーム診断' },
          { icon: '📊', text: '改善点・強化ポイントの詳細分析' },
          { icon: '🏋️', text: 'パーソナル練習メニュー自動生成' },
          { icon: '⚡', text: '高精度モデル（Claude Opus）使用' },
        ].map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', backgroundColor: '#f0f2f5', borderRadius: 12, padding: 14 }}>
            <Text style={{ fontSize: 20 }}>{item.icon}</Text>
            <Text style={{ color: '#111827', fontSize: 14, fontWeight: '600' }}>{item.text}</Text>
          </View>
        ))}

        {/* 料金 */}
        <View style={{ alignSelf: 'stretch', backgroundColor: 'rgba(229,62,62,0.1)', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: 'rgba(229,62,62,0.3)', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>プレミアムプラン</Text>
          <Text style={{ color: '#111827', fontSize: 32, fontWeight: '900' }}>¥980<Text style={{ fontSize: 14, fontWeight: '400' }}>/月</Text></Text>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>いつでもキャンセル可能</Text>
        </View>

        <View style={{ alignSelf: 'stretch', backgroundColor: 'rgba(155,107,255,0.1)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(155,107,255,0.3)', gap: 6 }}>
          <Text style={{ color: '#9B6BFF', fontSize: 13, fontWeight: '800' }}>👥 チーム・学校向けプラン</Text>
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 18 }}>部活・チーム全員で使えるプランは¥3,000/月〜{'\n'}設定画面からお問い合わせください</Text>
        </View>

        <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, textAlign: 'center' }}>
          ※ 現在サブスクリプション決済は準備中です{'\n'}リリース時にご登録のメールにご連絡します
        </Text>
      </View>
    </ScrollView>
  )
}

/* ─── Web専用プレーヤー ──────────────────────────── */
function WebPlayer({ isPremiumUser: isPremiumProp }: { isPremiumUser: boolean }) {
  const router = useRouter()
  const { isGuest: isGuestWeb } = useAuth()

  /* ── refs ── */
  const videoRef         = useRef<HTMLVideoElement | null>(null)
  const canvasRef        = useRef<HTMLCanvasElement | null>(null)
  const fileRef          = useRef<HTMLInputElement | null>(null)
  const playerDivRef     = useRef<HTMLDivElement | null>(null)  // 実際の表示コンテナ
  const startingRef      = useRef(false)  // 二重タップ防止

  /* ── state ── */
  const [phase, setPhase]         = useState<'upload' | 'analyzing' | 'player'>('upload')
  const [videoName, setVideoName] = useState('')
  const [duration, setDuration]   = useState(0)
  const [currentTime, setCurrent] = useState(0)
  const [isPlaying, setPlaying]   = useState(false)
  const [rate, setRate]           = useState(0.5)
  const [progress, setProgress]   = useState({ done: 0, total: 0 })
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [activeAnn, setActiveAnn] = useState<Annotation | null>(null)
  const [comprehensive, setComprehensive] = useState<ComprehensiveAnalysis | null>(null)
  const [loadingComp, setLoadingComp] = useState(false)
  const [adGateVisible,     setAdGateVisible]     = useState(false)
  const [adGateRemainingW,  setAdGateRemainingW]  = useState(0)
  const [adGateHardLimited, setAdGateHardLimited] = useState(false)
  const [adGateLimitTypeW,  setAdGateLimitTypeW]  = useState<'none'|'daily'|'monthly'|'total'|'window'>('none')
  const isPremiumUser = isPremiumProp

  // 種目・選手指定
  const [selectedEvent,   setSelectedEvent]   = useState('')
  const [athleteColor,    setAthleteColor]     = useState('')

  const annotationsRef = useRef<Annotation[]>([])
  useEffect(() => { annotationsRef.current = annotations }, [annotations])

  /* ── video/canvas 初期化（一度だけ） ── */
  useEffect(() => {
    if (Platform.OS !== 'web') return

    /* video */
    const vid = document.createElement('video') as HTMLVideoElement
    vid.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;display:block;'
    vid.playsInline = true
    vid.controls    = false
    vid.addEventListener('loadedmetadata', () => setDuration(vid.duration))
    vid.addEventListener('timeupdate', () => {
      setCurrent(vid.currentTime)
      drawOverlay(vid.currentTime)
    })
    vid.addEventListener('play',  () => setPlaying(true))
    vid.addEventListener('pause', () => setPlaying(false))
    vid.addEventListener('ended', () => setPlaying(false))
    videoRef.current = vid

    /* canvas */
    const cv = document.createElement('canvas') as HTMLCanvasElement
    cv.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;'
    canvasRef.current = cv

    /* file input */
    const inp = document.createElement('input') as HTMLInputElement
    inp.type = 'file'; inp.accept = 'video/*'; inp.style.display = 'none'
    inp.addEventListener('change', () => {
      const f = inp.files?.[0]
      if (!f) return
      setVideoName(f.name)
      vid.src = URL.createObjectURL(f)
      vid.load()
    })
    document.body.appendChild(inp)
    fileRef.current = inp

    return () => {
      document.body.removeChild(inp)
      vid.src = ''
    }
  }, [])

  /* ── phaseがplayerに変わったらvideoをコンテナに移動 ── */
  useEffect(() => {
    if (phase !== 'player') return
    /* 少し待ってからDOMが確定した後に移動 */
    const timer = setTimeout(() => {
      const container = playerDivRef.current
      const vid = videoRef.current
      const cv  = canvasRef.current
      if (!container || !vid) return
      if (vid.parentNode !== container)  container.appendChild(vid)
      if (cv && cv.parentNode !== container) container.appendChild(cv)
      vid.playbackRate = rate
    }, 50)
    return () => clearTimeout(timer)
  }, [phase])

  /* ── overlay描画 ── */
  const drawOverlay = useCallback((t: number) => {
    const cv  = canvasRef.current
    const vid = videoRef.current
    if (!cv || !vid || !vid.offsetWidth) return
    cv.width  = vid.offsetWidth
    cv.height = vid.offsetHeight
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, cv.width, cv.height)
    const near = annotationsRef.current.filter(a => Math.abs(a.timestamp - t) < 0.6)
    if (!near.length) { setActiveAnn(null); return }
    const ann = near[0]
    setActiveAnn(ann)
    /* 下部バー */
    ctx.fillStyle = 'rgba(0,0,0,0.65)'
    ctx.fillRect(0, cv.height - 80, cv.width, 80)
    ctx.fillStyle = '#166534'
    ctx.font = 'bold 13px -apple-system,sans-serif'
    ctx.fillText(`⚡ ${ann.advice.overall}`, 12, cv.height - 52)
    ctx.fillStyle = '#ddd'
    ctx.font = '12px -apple-system,sans-serif'
    if (ann.advice.improvements[0])
      ctx.fillText(`▶ ${ann.advice.improvements[0]}`, 12, cv.height - 28)
    /* 右上バッジ */
    ctx.fillStyle = 'rgba(229,57,53,0.85)'
    const bw = 82, bh = 24, bx = cv.width - bw - 8, by = 8
    ctx.beginPath()
    ;(ctx as any).roundRect?.(bx, by, bw, bh, 6)
    ctx.fill()
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'right'
    ctx.fillText('🤖 分析済み', cv.width - 12, by + 16)
    ctx.textAlign = 'left'
  }, [])

  /* ── フレーム抽出 ── */
  const extractFrame = (vid: HTMLVideoElement, t: number): Promise<string> =>
    new Promise(resolve => {
      vid.currentTime = t
      const onSeeked = () => {
        vid.removeEventListener('seeked', onSeeked)
        const tmp = document.createElement('canvas')
        tmp.width  = THUMB_W
        tmp.height = Math.round(THUMB_W * (vid.videoHeight || 9) / (vid.videoWidth || 16))
        tmp.getContext('2d')!.drawImage(vid, 0, 0, tmp.width, tmp.height)
        resolve(tmp.toDataURL('image/jpeg', 0.42))  // 0.65→0.42: 画像トークン削減
      }
      vid.addEventListener('seeked', onSeeked)
    })

  /* ── Claude Vision: フレーム分析 ── */
  const analyzeFrame = async (dataUrl: string, t: number): Promise<FrameAdvice> => {
    const apiBase2 = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
    const endpoint2 = `${apiBase2}/api/analyze`
    const model = 'claude-haiku-4-5-20251001'
    const res = await fetchWithTimeout(endpoint2, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 320,  // 512→320: フレーム分析出力削減
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: dataUrl.split(',')[1] } },
          { type: 'text', text: `陸上${selectedEvent ? `(${selectedEvent})` : ''}${athleteColor ? ` 対象:${athleteColor}` : ''} ${formatTime(t)}地点。JSON形式のみ:
{"overall":"評価20字","positives":["良い点(部位)","良い点2"],"improvements":["要約1","要約2"],"improvementDetails":[{"issue":"問題(部位)","reason":"原因(根拠)","fix":"改善方法"}],"injuryRisk":"リスク30字(低ければ「リスク低」)"}` }
        ]}]
      }),
    }, 30000)
    const data = await res.json()
    const text  = data.content?.find((b: any) => b.type === 'text')?.text ?? '{}'
    const match = text.match(/\{[\s\S]*\}/)
    try {
      if (match) {
        const p = JSON.parse(match[0])
        return {
          ...p,
          improvementDetails: Array.isArray(p.improvementDetails)
            ? p.improvementDetails.filter((d: any) => d?.issue && d?.reason && d?.fix)
            : undefined,
        }
      }
      return { overall: text.slice(0, 30), positives: [], improvements: [] }
    }
    catch { return { overall: text.slice(0, 30), positives: [], improvements: [] } }
  }

  /* ── Claude: 総合評価 + メニュー作成 ── */
  const generateComprehensive = async (anns: Annotation[]) => {
    if (anns.length === 0) return
    setLoadingComp(true)
    try {
      const summary = anns.map((a, i) =>
        `フレーム${i+1}(${formatTime(a.timestamp)}): ${a.advice.overall} | 改善: ${a.advice.improvements.join(' / ')}`
      ).join('\n')
      const apiBase3 = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
      const endpoint3 = `${apiBase3}/api/analyze`
      const res = await fetchWithTimeout(endpoint3, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 1024,
          messages: [{ role: 'user', content: `陸上競技バイオメカニクスコーチとして、以下のフレーム分析結果を元に総合評価・トレーニングメニュー・怪我リスクの傾向に関する参考アドバイスを作成してください。断定的な予防・治療効果の表現は避け、あくまで参考情報として提示すること。${selectedEvent ? `\n種目: ${selectedEvent}に特化したアドバイスをしてください。` : ''}
アドバイスは読みやすく簡潔に（1項目30字以内）、かつ部位・角度・回数・距離など具体的な数値を含めること。

【フレーム分析結果】
${summary}

以下のJSON形式のみで回答:
{
  "summary": "総合評価（3〜4文。技術面と怪我リスクの両方に触れる）",
  "keyFindings": ["全体を通して見られた技術的特徴1（部位明記）", "特徴2", "特徴3"],
  "injuryWarnings": ["怪我リスクのある部位と原因1（例: 膝の内側への倒れ込みでランナー膝リスク）", "リスク2（なければ空配列[]）"],
  "trainingMenu": [
    {"name": "ドリル名", "detail": "具体的な方法・セット数・距離（例: 20m×5本）"},
    {"name": "ドリル名2", "detail": "内容"},
    {"name": "ドリル名3", "detail": "内容"},
    {"name": "ドリル名4（弱点補強ドリル）", "detail": "弱点部位を補強する種目"}
  ],
  "nextSteps": ["次の練習で意識すること1（具体的な動作・角度・タイミング）", "意識すること2", "意識すること3"]
}` }]
        }),
      }, 45000)
      const data  = await res.json()
      const text  = data.content?.find((b: any) => b.type === 'text')?.text ?? '{}'
      const match = text.match(/\{[\s\S]*\}/)
      if (match) { try { setComprehensive(JSON.parse(match[0])) } catch {} }
    } catch (e) { console.warn('comprehensive fail', e) }
    finally { setLoadingComp(false) }
  }

  /* ── 分析コア（アドゲートチェック後に呼ぶ） ── */
  const startAnalysisCore = async () => {
    const vid = videoRef.current
    if (!vid?.src) { Alert.alert('動画を選択してください'); return }
    if (!vid.duration)
      await new Promise<void>(r => vid.addEventListener('loadedmetadata', () => r(), { once: true }))
    setPhase('analyzing')
    const dur  = vid.duration
    const step = Math.max(dur / MAX_FRAMES, 0.5)
    const times: number[] = []
    for (let t = step / 2; t < dur; t += step) times.push(parseFloat(t.toFixed(2)))
    const capped = times.slice(0, MAX_FRAMES)
    setProgress({ done: 0, total: capped.length })
    const results: Annotation[] = []
    for (let i = 0; i < capped.length; i++) {
      try {
        const thumb  = await extractFrame(vid, capped[i])
        const advice = await analyzeFrame(thumb, capped[i])
        results.push({ id: String(i), timestamp: capped[i], thumbUrl: thumb, advice })
        setProgress({ done: i + 1, total: capped.length })
        setAnnotations([...results])
      } catch { /* skip */ }
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(results)).catch(() => {})
    vid.currentTime = 0
    setPhase('player')
    /* 総合評価を非同期で生成 */
    generateComprehensive(results)
  }

  /* ── 分析スタート（アドゲートチェック付き） ── */
  const startAnalysis = async () => {
    if (startingRef.current) return  // 二重タップ防止
    const vid = videoRef.current
    if (!vid?.src) { Alert.alert('動画を選択してください'); return }
    startingRef.current = true
    try {
      const gate = await checkAdGate('video')
      if (!gate.allowed) {
        setAdGateRemainingW(gate.remaining)
        setAdGateHardLimited(gate.hardLimited)
        setAdGateLimitTypeW(gate.limitType)
        setAdGateVisible(true)
        return
      }
      await recordUsage('video')
      await startAnalysisCore()
    } finally {
      startingRef.current = false
    }
  }

  /* ── コントロール ── */
  const togglePlay = () => {
    const vid = videoRef.current!
    if (!vid) return
    if (vid.paused) { vid.playbackRate = rate; void vid.play() }
    else vid.pause()
  }
  const changeRate = (r: number) => {
    setRate(r)
    if (videoRef.current) videoRef.current.playbackRate = r
  }
  const seek = (t: number) => { if (videoRef.current) videoRef.current.currentTime = t }
  const stepFrame = (dir: 1 | -1) => {
    if (videoRef.current)
      videoRef.current.currentTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + dir / 30))
  }

  /* ═══════════════ RENDER ═══════════════ */

  /* アップロード */
  if (phase === 'upload') {
    return (
      <View style={s.bg}>
        <ScrollView contentContainerStyle={s.uploadCenter}>
          <Ionicons name="film-outline" size={64} color="#166534" />
          <Text style={s.uploadTitle}>練習フォームをAI分析</Text>
          <Text style={s.uploadSub}>アップロード → AI自動分析 → スローで確認</Text>
          <View style={s.stepRow}>
            {[
              ['cloud-upload-outline', '① 動画を選ぶ'],
              ['sparkles-outline',     '② AIが分析'],
              ['eye-outline',          '③ スローで確認'],
            ].map(([icon, label], i) => (
              <View key={i} style={s.stepItem}>
                <View style={s.stepIcon}>
                  <Ionicons name={icon as any} size={22} color="#166534" />
                </View>
                <Text style={s.stepLabel}>{label}</Text>
              </View>
            ))}
          </View>

          {videoName ? (
            <View style={s.fileTag}>
              <Ionicons name="checkmark-circle" size={16} color="#4CAF50" />
              <Text style={s.fileTagText} numberOfLines={1}>{videoName}</Text>
            </View>
          ) : null}

          <TouchableOpacity style={s.uploadBtn} onPress={() => fileRef.current?.click()}>
            <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
            <Text style={s.uploadBtnText}>{videoName ? '動画を変更' : '動画を選ぶ'}</Text>
          </TouchableOpacity>

          {/* ── 種目選択 ── */}
          <View style={s.settingCard}>
            <Text style={s.settingTitle}>🏃 分析する種目（任意）</Text>
            <Text style={s.settingDesc}>選ぶと種目に特化したアドバイスが得られます</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 6, paddingBottom: 2 }}>
              {['', '100m','200m','400m','800m','1500m','110mH','100mH','400mH','走幅跳','三段跳','走高跳','棒高跳','砲丸投','やり投','円盤投'].map(ev => (
                <TouchableOpacity
                  key={ev || '指定なし'}
                  onPress={() => setSelectedEvent(ev)}
                  style={[s.evChip, selectedEvent === ev && s.evChipActive]}
                >
                  <Text style={[s.evChipText, selectedEvent === ev && { color: '#fff' }]}>
                    {ev || '指定なし'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* ── 複数人動画: 選手の服・靴の色 ── */}
          <View style={s.settingCard}>
            <Text style={s.settingTitle}>👤 分析する選手の特徴（複数人動画の場合）</Text>
            <Text style={s.settingDesc}>服の色・靴の色などを入力するとその選手に絞って分析します</Text>
            <TextInput
              value={athleteColor}
              onChangeText={setAthleteColor}
              placeholder="例: 赤いユニフォーム、白いスパイク　/ 一人の場合は空欄でOK"
              placeholderTextColor="#555"
              style={s.colorInput}
              multiline
            />
          </View>

          {videoName ? (
            <TouchableOpacity style={s.analyzeBtn} onPress={startAnalysis}>
              <Ionicons name="sparkles-outline" size={22} color="#fff" />
              <Text style={s.analyzeBtnText}>AIで分析スタート 🚀</Text>
            </TouchableOpacity>
          ) : null}

          {/* ── AIモデル表示 ── */}
          <View style={isPremiumUser ? s.planBannerPro : s.planBannerFree}>
            {isPremiumUser ? (
              <>
                <Text style={s.planBannerIcon}>⚡</Text>
                <View>
                  <Text style={s.planBannerTitle}>高精度モード（Opus）</Text>
                  <Text style={s.planBannerSub}>プレミアムの高精度AIで分析します</Text>
                </View>
              </>
            ) : (
              <>
                <Text style={s.planBannerIcon}>🤖</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.planBannerTitle}>標準モード（Haiku）で分析</Text>
                  <Text style={s.planBannerSub}>
                    <Text style={{ color: '#FFD700', fontWeight: '700' }}>プレミアム ¥490/月</Text>
                    {'  にすると高精度AI（Opus）で\n骨格・重心・角度まで詳細分析'}
                  </Text>
                </View>
              </>
            )}
          </View>

          <Text style={s.privacyNote}>
            🔒 動画はデバイス内のみで処理{'\n'}フレーム画像のみAI分析に使用します
          </Text>
        </ScrollView>

        {/* ── 広告ゲートモーダル ── */}
        <AdGateModal
          visible={adGateVisible}
          feature="video"
          remaining={adGateRemainingW}
          hardLimited={adGateHardLimited}
          limitType={adGateLimitTypeW}
          isGuest={isGuestWeb}
          onClose={() => setAdGateVisible(false)}
          onAdWatched={async () => {
            setAdGateVisible(false)
            await recordUsage('video')
            await startAnalysisCore()
          }}
          onUpgrade={() => {
            setAdGateVisible(false)
            router.push('/paywall')
          }}
        />
      </View>
    )
  }

  /* 分析中 */
  if (phase === 'analyzing') {
    const pct = progress.total > 0 ? (progress.done / progress.total) * 100 : 0
    return (
      <View style={s.center}>
        <View style={s.analyzeCard}>
          <ActivityIndicator size="large" color="#166534" />
          <Text style={s.analyzeTitle}>AIがフォームを分析中</Text>
          <Text style={s.analyzeCount}>{progress.done} / {progress.total}</Text>
          <View style={s.barTrack}>
            <View style={[s.barFill, { width: `${pct}%` as any }]} />
          </View>
          <Text style={s.analyzeSub}>
            {progress.done === 0 ? 'キーフレームを抽出中...' : `フレーム ${progress.done} を分析しました`}
          </Text>
          <Text style={s.analyzeNote}>この画面を閉じないでください</Text>
        </View>
      </View>
    )
  }

  /* プレーヤー */
  return (
    <View style={s.bg}>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>

        {/* ── 動画エリア（videoRef + canvasRef をここに移動） ── */}
        <View
          style={s.videoWrapper}
          ref={(node: any) => {
            if (node && node !== playerDivRef.current) {
              playerDivRef.current = node
              const vid = videoRef.current
              const cv  = canvasRef.current
              if (vid && vid.parentNode !== node) node.appendChild(vid)
              if (cv  && cv.parentNode  !== node) node.appendChild(cv)
            }
          }}
        />

        {/* ── スライダー ── */}
        <View style={s.sliderRow}>
          <Text style={s.timeText}>{formatTime(currentTime)}</Text>
          <input
            type="range" min={0} max={duration || 100} step={0.033}
            value={currentTime}
            onChange={(e: any) => seek(parseFloat(e.target.value))}
            style={{ flex: 1, accentColor: '#166534', cursor: 'pointer', margin: '0 10px' } as any}
          />
          <Text style={s.timeText}>{formatTime(duration)}</Text>
        </View>

        {/* ── コントロール ── */}
        <View style={s.ctrlRow}>
          <TouchableOpacity style={s.iconBtn} onPress={() => stepFrame(-1)}>
            <Ionicons name="play-skip-back" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={s.playBtn} onPress={togglePlay}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={28} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={() => stepFrame(1)}>
            <Ionicons name="play-skip-forward" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* ── 速度 ── */}
        <View style={s.rateRow}>
          {([0.25, 0.5, 1, 2] as number[]).map(r => (
            <TouchableOpacity key={r} style={[s.rateBtn, rate === r && s.rateBtnActive]} onPress={() => changeRate(r)}>
              <Text style={[s.rateTxt, rate === r && s.rateTxtActive]}>{r}x</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── アクティブフレームのアドバイス ── */}
        {activeAnn ? (
          <View style={s.adviceCard}>
            <Text style={s.adviceTime}>🤖 {formatTime(activeAnn.timestamp)} のフレーム分析</Text>
            <Text style={s.adviceOverall}>{activeAnn.advice.overall}</Text>
            {activeAnn.advice.positives.length > 0 && <>
              <Text style={s.sectionLabel}>✅ 良い点</Text>
              {activeAnn.advice.positives.map((p, i) => <Text key={i} style={s.adviceItem}>• {p}</Text>)}
            </>}
            {activeAnn.advice.improvementDetails && activeAnn.advice.improvementDetails.length > 0 ? (
              <>
                <Text style={s.sectionLabel}>🔍 改善点（原因・対策）</Text>
                {activeAnn.advice.improvementDetails.map((d, i) => (
                  <View key={i} style={{ backgroundColor: '#fff7ed', borderRadius: 8, padding: 8, marginBottom: 6, borderLeftWidth: 3, borderLeftColor: '#f97316' }}>
                    <Text style={{ color: '#9a3412', fontSize: 12, fontWeight: '800', marginBottom: 4 }}>⚠️ {d.issue}</Text>
                    <Text style={{ color: '#92400e', fontSize: 11, marginBottom: 3 }}>📍 なぜ: {d.reason}</Text>
                    <Text style={{ color: '#166534', fontSize: 11 }}>✅ 改善: {d.fix}</Text>
                  </View>
                ))}
              </>
            ) : activeAnn.advice.improvements.length > 0 ? (
              <>
                <Text style={s.sectionLabel}>⚠️ 改善点</Text>
                {activeAnn.advice.improvements.map((p, i) => <Text key={i} style={s.adviceItem}>• {p}</Text>)}
              </>
            ) : null}
            {activeAnn.advice.injuryRisk && activeAnn.advice.injuryRisk !== 'リスク低' && (
              <View style={{ marginTop: 8, backgroundColor: '#FFF1F2', borderRadius: 8, padding: 8, borderLeftWidth: 3, borderLeftColor: '#F43F5E' }}>
                <Text style={{ color: '#BE123C', fontSize: 11, fontWeight: '700', marginBottom: 2 }}>🚨 怪我リスク</Text>
                <Text style={{ color: '#9F1239', fontSize: 12 }}>{activeAnn.advice.injuryRisk}</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={s.noAdviceCard}>
            <Text style={s.noAdviceTxt}>再生すると分析済みフレームでアドバイスが表示されます</Text>
          </View>
        )}

        {/* ── サムネイル一覧 ── */}
        <Text style={s.sectionTitle}>分析済みフレーム ({annotations.length}件)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingLeft: 12, marginBottom: 8 }}>
          {annotations.map(ann => (
            <TouchableOpacity
              key={ann.id}
              style={[s.thumbCard, activeAnn?.id === ann.id && s.thumbActive]}
              onPress={() => { seek(ann.timestamp); setActiveAnn(ann) }}
            >
              <img src={ann.thumbUrl}
                style={{ width: 96, height: 54, borderRadius: 6, objectFit: 'cover', display: 'block' } as any}
                alt="" />
              <Text style={s.thumbTime}>{formatTime(ann.timestamp)}</Text>
              <Text style={s.thumbOverall} numberOfLines={2}>{ann.advice.overall}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ════════════════════════════════════════ */}
        {/* ── 総合評価セクション ── */}
        {/* ════════════════════════════════════════ */}
        <View style={s.divider} />
        <Text style={s.bigSectionTitle}>総合評価 & トレーニングメニュー</Text>

        {loadingComp ? (
          <View style={s.compLoading}>
            <ActivityIndicator size="small" color="#166534" />
            <Text style={s.compLoadingTxt}>AIが総合評価を生成中...</Text>
          </View>
        ) : comprehensive ? (
          <>
            {/* 総合サマリー */}
            <View style={s.compCard}>
              <View style={s.compCardHeader}>
                <Ionicons name="analytics-outline" size={18} color="#166534" />
                <Text style={s.compCardTitle}>総合評価</Text>
              </View>
              <Text style={s.compSummary}>{comprehensive.summary}</Text>
              {comprehensive.keyFindings.length > 0 && <>
                <Text style={s.sectionLabel}>📌 全体的な特徴</Text>
                {comprehensive.keyFindings.map((f, i) => (
                  <View key={i} style={s.findingRow}>
                    <View style={s.findingDot} />
                    <Text style={s.findingTxt}>{f}</Text>
                  </View>
                ))}
              </>}
              {comprehensive.injuryWarnings && comprehensive.injuryWarnings.length > 0 && (
                <View style={{ marginTop: 10, backgroundColor: '#FFF1F2', borderRadius: 10, padding: 10, borderLeftWidth: 3, borderLeftColor: '#F43F5E' }}>
                  <Text style={{ color: '#BE123C', fontSize: 12, fontWeight: '800', marginBottom: 6 }}>🚨 フォームからみるリスク傾向</Text>
                  {comprehensive.injuryWarnings.map((w, i) => (
                    <Text key={i} style={{ color: '#9F1239', fontSize: 12, lineHeight: 20 }}>• {w}</Text>
                  ))}
                </View>
              )}
            </View>

            {/* トレーニングメニュー */}
            <View style={s.compCard}>
              <View style={s.compCardHeader}>
                <Ionicons name="barbell-outline" size={18} color="#166534" />
                <Text style={s.compCardTitle}>推奨トレーニングメニュー</Text>
              </View>
              {comprehensive.trainingMenu.map((ex, i) => (
                <View key={i} style={s.menuItem}>
                  <View style={s.menuNum}><Text style={s.menuNumTxt}>{i + 1}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.menuName}>{ex.name}</Text>
                    <Text style={s.menuDetail}>{ex.detail}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* 次の練習で意識すること */}
            <View style={s.compCard}>
              <View style={s.compCardHeader}>
                <Ionicons name="flag-outline" size={18} color="#166534" />
                <Text style={s.compCardTitle}>次の練習で意識すること</Text>
              </View>
              {comprehensive.nextSteps.map((step, i) => (
                <View key={i} style={s.nextStepRow}>
                  <Text style={s.nextStepNum}>{i + 1}</Text>
                  <Text style={s.nextStepTxt}>{step}</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <View style={s.compLoading}>
            <Text style={s.compLoadingTxt}>分析が完了すると総合評価が表示されます</Text>
          </View>
        )}

        <TouchableOpacity
          style={s.reanalyzeBtn}
          onPress={() => {
            setPhase('upload')
            setAnnotations([])
            setActiveAnn(null)
            setComprehensive(null)
          }}
        >
          <Ionicons name="refresh-outline" size={14} color="#555" />
          <Text style={s.reanalyzeTxt}>別の動画で分析する</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  )
}

function formatTime(sec: number) {
  const m  = Math.floor(sec / 60)
  const ss = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 100)
  return `${m}:${String(ss).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
}

/* ─── スタイル ─── */
const s = StyleSheet.create({
  bg:             { flex: 1, backgroundColor: '#f6f6f8' },
  center:         { flex: 1, backgroundColor: '#f6f6f8', alignItems: 'center', justifyContent: 'center' },
  gray16:         { color: '#555', fontSize: 16, marginTop: 12 },

  /* upload */
  uploadCenter:   { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  uploadTitle:    { color: '#111827', fontSize: 24, fontWeight: '800', marginTop: 16 },
  uploadSub:      { color: '#666', fontSize: 13, marginTop: 6, marginBottom: 24 },
  stepRow:        { flexDirection: 'row', gap: 16, marginBottom: 28 },
  stepItem:       { alignItems: 'center', width: 90 },
  stepIcon:       { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(229,57,53,0.12)',
                    alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  stepLabel:      { color: '#6b7280', fontSize: 11, textAlign: 'center' },
  fileTag:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12,
                    backgroundColor: 'rgba(76,175,80,0.1)', paddingHorizontal: 14,
                    paddingVertical: 7, borderRadius: 20 },
  fileTagText:    { color: '#4CAF50', fontSize: 13, maxWidth: 220 },
  uploadBtn:      { flexDirection: 'row', alignItems: 'center', gap: 8,
                    backgroundColor: '#f0f2f5', paddingHorizontal: 28,
                    paddingVertical: 14, borderRadius: 21, marginBottom: 12 },
  uploadBtnText:  { color: '#111827', fontSize: 16, fontWeight: '700' },
  analyzeBtn:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1c1c1e',
                    paddingHorizontal: 36, paddingVertical: 18, borderRadius: 50, marginBottom: 20,
                    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.18, shadowRadius: 12, elevation: 5 },
  analyzeBtnText: { color: '#ffffff', fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  privacyNote:    { color: '#333', fontSize: 11, textAlign: 'center', lineHeight: 18 },

  /* setting cards before analysis */
  settingCard:    { width: '100%', maxWidth: 340, backgroundColor: '#ffffff', borderRadius: 21, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2 },
  settingTitle:   { color: '#111827', fontSize: 13, fontWeight: '800', marginBottom: 2 },
  settingDesc:    { color: '#666', fontSize: 11, lineHeight: 16 },
  evChip:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#f0f2f5', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  evChipActive:   { backgroundColor: BRAND, borderColor: BRAND },
  evChipText:     { color: '#aaa', fontSize: 12, fontWeight: '700' },
  colorInput:     { marginTop: 10, backgroundColor: '#f0f2f5', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, color: '#111827', fontSize: 13, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', minHeight: 50 },
  planBannerFree: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#f0f2f5', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)',
    padding: 12, width: '100%', maxWidth: 340,
  },
  planBannerPro: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,215,0,0.08)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.4)',
    padding: 12, width: '100%', maxWidth: 340,
  },
  planBannerIcon:  { fontSize: 22 },
  planBannerTitle: { color: '#111827', fontSize: 13, fontWeight: '800' },
  planBannerSub:   { color: '#888', fontSize: 11, marginTop: 2, lineHeight: 16 },

  /* analyzing */
  analyzeCard:    { backgroundColor: '#fff', borderRadius: 20, padding: 32,
                    alignItems: 'center', width: 300,
                    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 },
  analyzeTitle:   { color: '#111827', fontSize: 18, fontWeight: '800', marginTop: 16 },
  analyzeCount:   { color: '#166534', fontSize: 28, fontWeight: '800', marginTop: 8, fontVariant: ['tabular-nums'] },
  barTrack:       { width: '100%', height: 6, backgroundColor: 'rgba(0,0,0,0.08)',
                    borderRadius: 3, marginTop: 16, overflow: 'hidden' },
  barFill:        { height: 6, backgroundColor: BRAND, borderRadius: 3 },
  analyzeSub:     { color: '#6b7280', fontSize: 13, marginTop: 12 },
  analyzeNote:    { color: '#9ca3af', fontSize: 11, marginTop: 8 },

  /* player */
  videoWrapper:   { width: '100%', height: 260, backgroundColor: '#000', position: 'relative' } as any,
  sliderRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  timeText:       { color: '#888', fontSize: 11, minWidth: 54 },
  ctrlRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, paddingVertical: 8 },
  iconBtn:        { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f0f2f5',
                    alignItems: 'center', justifyContent: 'center' },
  playBtn:        { width: 58, height: 58, borderRadius: 29, backgroundColor: BRAND,
                    alignItems: 'center', justifyContent: 'center' },
  rateRow:        { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingBottom: 12 },
  rateBtn:        { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20,
                    backgroundColor: '#f0f2f5' },
  rateBtnActive:  { backgroundColor: BRAND },
  rateTxt:        { color: '#888', fontSize: 13, fontWeight: '700' },
  rateTxtActive:  { color: '#fff' },

  /* advice */
  adviceCard:     { margin: 12, padding: 18, backgroundColor: '#fff',
                    borderRadius: 16, borderLeftWidth: 3, borderLeftColor: '#166534',
                    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  adviceTime:     { color: '#166534', fontSize: 12, fontWeight: '700', marginBottom: 6 },
  adviceOverall:  { color: '#111827', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  noAdviceCard:   { margin: 12, padding: 14, backgroundColor: '#f8f8fa',
                    borderRadius: 12, alignItems: 'center' },
  noAdviceTxt:    { color: '#6b7280', fontSize: 12 },
  sectionLabel:   { color: '#6b7280', fontSize: 11, fontWeight: '700', marginTop: 10, marginBottom: 4 },
  adviceItem:     { color: '#374151', fontSize: 13, lineHeight: 20, marginLeft: 4 },
  sectionTitle:   { color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 1.2,
                    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },

  /* thumbnails */
  thumbCard:      { width: 116, marginRight: 8, backgroundColor: '#fff',
                    borderRadius: 10, padding: 6, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.08)' },
  thumbActive:    { borderColor: BRAND },
  thumbTime:      { color: '#166534', fontSize: 10, fontWeight: '700', marginTop: 4 },
  thumbOverall:   { color: '#6b7280', fontSize: 10, lineHeight: 14, marginTop: 2 },

  /* divider & big section */
  divider:        { height: 1, backgroundColor: 'rgba(0,0,0,0.08)', marginHorizontal: 16, marginVertical: 20 },
  bigSectionTitle:{ color: '#111827', fontSize: 17, fontWeight: '800', paddingHorizontal: 16, marginBottom: 12 },

  /* comprehensive */
  compLoading:    { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 20,
                    justifyContent: 'center' },
  compLoadingTxt: { color: '#6b7280', fontSize: 13 },
  compCard:       { marginHorizontal: 12, marginBottom: 12, padding: 16,
                    backgroundColor: '#fff', borderRadius: 16,
                    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  compCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  compCardTitle:  { color: '#111827', fontSize: 15, fontWeight: '800' },
  compSummary:    { color: '#374151', fontSize: 14, lineHeight: 22 },
  findingRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  findingDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: BRAND, marginTop: 6 },
  findingTxt:     { color: '#374151', fontSize: 13, lineHeight: 20, flex: 1 },
  menuItem:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12,
                    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)' },
  menuNum:        { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(22,101,52,0.12)',
                    alignItems: 'center', justifyContent: 'center' },
  menuNumTxt:     { color: '#166534', fontSize: 12, fontWeight: '800' },
  menuName:       { color: '#111827', fontSize: 14, fontWeight: '700', marginBottom: 2 },
  menuDetail:     { color: '#4b5563', fontSize: 12, lineHeight: 18 },
  nextStepRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  nextStepNum:    { color: '#166534', fontSize: 13, fontWeight: '800', minWidth: 16 },
  nextStepTxt:    { color: '#374151', fontSize: 13, lineHeight: 20, flex: 1 },

  reanalyzeBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 6, padding: 20 },
  reanalyzeTxt:   { color: '#6b7280', fontSize: 13 },
})

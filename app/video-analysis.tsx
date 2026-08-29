import React, { useRef, useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  StyleSheet, Platform, Alert, ActivityIndicator, Image, Modal, Pressable,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Svg, { Polygon, Line, Circle } from 'react-native-svg'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { BRAND, TEXT } from '../lib/theme'
import { checkAdGate, recordUsage, getTier } from '../lib/adGate'
import { TICKET_COST, grantTickets } from '../lib/ticketWallet'
import AdGateModal from '../components/AdGateModal'
import TicketGateModal from '../components/TicketGateModal'
import BannerAdView from '../components/BannerAdView'
import { useAuth } from '../context/AuthContext'
import { useRouter } from 'expo-router'
import { trackFeatureUse } from '../lib/analytics'
import Toast from 'react-native-toast-message'
import * as ImagePicker from 'expo-image-picker'
import * as VideoThumbnails from 'expo-video-thumbnails'
import * as ImageManipulator from 'expo-image-manipulator'
import * as FileSystem from 'expo-file-system/legacy'
import { sendCoachNotification, submitVideo } from '../lib/supabaseTeam'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../context/LanguageContext'
import { narrativeLanguageInstruction } from '../lib/aiLanguage'
import { getEventLabel } from '../lib/eventLabels'
import { todayLocalISO } from '../lib/dateLocal'
import DateSelector from '../components/DateSelector'
import { VideoView, useVideoPlayer } from 'expo-video'
import { updateCoachVideoRequests } from '../lib/coachReqStore'
import {
  getVideoAnalysisHistory, addVideoAnalysisHistory, deleteVideoAnalysisHistory,
  type VideoAnalysisHistoryEntry,
} from '../lib/videoAnalysisHistoryStore'

const JOINED_KEY_VA = 'trackmate_team_joined'

/* ─── 型定義 ─────────────────────────────────── */
// 改善点の詳細構造（issue=何が問題か / reason=なぜ起きるか / fix=どう直すか）
// ※ WebPlayer（Web版の簡易分析フロー）が使用。ネイティブ版は新スキーマ（DimensionScore等）を使う
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

type Confidence = 'low' | 'medium' | 'high'

// bbox: 該当フレーム内の観察根拠位置（正規化座標 0〜1）
type FrameRef = { f: number; x: number; y: number; w: number; h: number }

type DimensionScore = {
  id: string
  label: string
  score: number
  confidence: Confidence
  reason: string
  bbox?: FrameRef
}

type FeedbackCard = { title: string; text: string; bbox?: FrameRef }

type EventCategory = 'sprint' | 'middle_long' | 'jump' | 'throw'

// 種目共通5軸（静止画から観察できる「フォームの質」のみ。速度・ピッチ等の
// 直接計測できない数値は含めない）
// ── AIプロンプト構築専用（常に日本語。表示用ラベルは buildCommonDimensions を使う） ──
const COMMON_DIMENSIONS = [
  { id: 'posture',        label: '姿勢' },
  { id: 'ground_contact', label: '接地' },
  { id: 'arm_swing',      label: '腕振り' },
  { id: 'balance',        label: 'バランス' },
  { id: 'force_transfer', label: '力の伝わりやすさ' },
] as const

// 種目カテゴリ別の追加2軸（AIプロンプト構築専用・常に日本語）
const EXTRA_DIMENSIONS: Record<EventCategory, { id: string; label: string }[]> = {
  sprint:      [{ id: 'start_posture', label: 'スタート姿勢' }, { id: 'accel_posture', label: '加速姿勢' }],
  middle_long: [{ id: 'relaxation',    label: '力みの少なさ' }, { id: 'rhythm',        label: 'リズムの安定感' }],
  jump:        [{ id: 'takeoff',       label: '踏切姿勢' },     { id: 'approach',      label: '助走姿勢' }],
  throw:       [{ id: 'axis_stability',label: '軸の安定' },     { id: 'kinetic_chain', label: '力の連動' }],
}

// ── 表示用（チャート・スコアカードのラベル。言語設定に追従） ──
function buildCommonDimensions(t: (key: string) => string) {
  return [
    { id: 'posture',        label: t('videoAnalysis.dimensions.posture') },
    { id: 'ground_contact', label: t('videoAnalysis.dimensions.groundContact') },
    { id: 'arm_swing',      label: t('videoAnalysis.dimensions.armSwing') },
    { id: 'balance',        label: t('videoAnalysis.dimensions.balance') },
    { id: 'force_transfer', label: t('videoAnalysis.dimensions.forceTransfer') },
  ] as const
}
function buildExtraDimensions(t: (key: string) => string): Record<EventCategory, { id: string; label: string }[]> {
  return {
    sprint:      [{ id: 'start_posture', label: t('videoAnalysis.dimensions.startPosture') }, { id: 'accel_posture', label: t('videoAnalysis.dimensions.accelPosture') }],
    middle_long: [{ id: 'relaxation',    label: t('videoAnalysis.dimensions.relaxation') },   { id: 'rhythm',        label: t('videoAnalysis.dimensions.rhythm') }],
    jump:        [{ id: 'takeoff',       label: t('videoAnalysis.dimensions.takeoff') },      { id: 'approach',      label: t('videoAnalysis.dimensions.approach') }],
    throw:       [{ id: 'axis_stability',label: t('videoAnalysis.dimensions.axisStability') },{ id: 'kinetic_chain', label: t('videoAnalysis.dimensions.kineticChain') }],
  }
}

// レーダーチャートの「理想ライン」目安値（軸ごと）
const IDEAL_TARGET: Record<string, number> = {
  posture: 85, ground_contact: 82, arm_swing: 83, balance: 85, force_transfer: 78,
  start_posture: 82, accel_posture: 80,
  relaxation: 83, rhythm: 85,
  takeoff: 80, approach: 82,
  axis_stability: 82, kinetic_chain: 78,
}

function inferEventCategory(event: string): EventCategory {
  const e = event.trim()
  if (/^(100m|200m|400m|110mH|100mH|300mH|400mH)$/.test(e)) return 'sprint'
  if (/^(800m|1500m|3000m|5000m|10000m)$/.test(e)) return 'middle_long'
  if (/(跳)/.test(e)) return 'jump'
  if (/(投)/.test(e)) return 'throw'
  if (/(800|1500|3000|5000|10000|marathon|マラソン|駅伝|長距離|中距離)/.test(e)) return 'middle_long'
  if (/(幅跳|三段跳|高跳|棒高)/.test(e)) return 'jump'
  return 'sprint'
}

function dimensionsForEvent(event: string) {
  const category = inferEventCategory(event)
  return { category, dims: [...COMMON_DIMENSIONS, ...EXTRA_DIMENSIONS[category]] }
}
// 表示用（言語設定に追従したラベルで dims を返す）
function dimensionsForEventDisplay(event: string, t: (key: string) => string) {
  const category = inferEventCategory(event)
  return { category, dims: [...buildCommonDimensions(t), ...buildExtraDimensions(t)[category]] }
}

const STORAGE_KEY      = 'trackmate_video_annotations'
const MAX_FRAMES       = 8
const THUMB_W          = 320

function buildFocusHints(t: (key: string, opts?: any) => string): string[] {
  return t('videoAnalysis.focusHints', { returnObjects: true }) as unknown as string[]
}

/* ─── ネイティブ動画分析（iOS/Android）──────────────── */
type AnalysisPhase = 'idle' | 'extracting' | 'analyzing' | 'result'

type AnalysisResult = {
  score: number
  headline: string                    // 一番伝えたい一言（例:「接地を改善すれば、もっと速くなれます」）
  dimensions: DimensionScore[]
  confidenceOverall: Confidence
  strength: FeedbackCard              // 今日の強み
  focus: FeedbackCard                 // 今日のテーマ（改善点は1つだけに絞る）
  nextStep: FeedbackCard              // 次の一歩
  practice: { theme: string; drill: string; drillDetail: string }
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
const ANALYSIS_CACHE_PREFIX = 'score_va_cache_v3_'  // v3: レーダーチャート方式へスキーマ変更のため旧キャッシュを無効化
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
  const { t } = useTranslation()
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
            {t('videoAnalysis.native.frameAnnotation', { n: activeFrame + 1, note: activeNote })}
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
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityLabel={isPlaying ? t('videoAnalysis.native.pause') : t('videoAnalysis.native.play')}
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
          {t('videoAnalysis.native.frameTimeline')}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
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

// ── 座標計算ヘルパー（レーダーチャート用） ──────────────────────────
function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg - 90) * Math.PI / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}
const toPolygonStr = (pts: { x: number; y: number }[]) => pts.map(p => `${p.x},${p.y}`).join(' ')

// レーダーチャート（軸=観察できるフォーム品質。実測値=実線、理想ラインは点線）
function RadarChart({ dimensions, size = 280 }: { dimensions: DimensionScore[]; size?: number }) {
  const n = dimensions.length
  if (n < 3) return null
  const cx = size / 2, cy = size / 2
  const maxR = size / 2 - 46
  const step = 360 / n

  const points      = dimensions.map((d, i) => polarToXY(cx, cy, (Math.max(0, Math.min(100, d.score)) / 100) * maxR, i * step))
  const idealPoints = dimensions.map((d, i) => polarToXY(cx, cy, ((IDEAL_TARGET[d.id] ?? 82) / 100) * maxR, i * step))

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        {[0.25, 0.5, 0.75, 1].map((ring, ri) => (
          <Polygon key={ri}
            points={toPolygonStr(dimensions.map((_, i) => polarToXY(cx, cy, maxR * ring, i * step)))}
            fill="none" stroke="#e5e7eb" strokeWidth={1} />
        ))}
        {dimensions.map((_, i) => {
          const p = polarToXY(cx, cy, maxR, i * step)
          return <Line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#e5e7eb" strokeWidth={1} />
        })}
        <Polygon points={toPolygonStr(idealPoints)} fill="none" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="4,4" />
        <Polygon points={toPolygonStr(points)} fill="#16a34a22" stroke="#16a34a" strokeWidth={2.5} />
        {points.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={4}
            fill={dimensions[i].confidence === 'low' ? '#fff' : '#16a34a'}
            stroke="#16a34a" strokeWidth={2} />
        ))}
      </Svg>
      <View style={{ position: 'absolute', width: size, height: size }} pointerEvents="none">
        {dimensions.map((d, i) => {
          const p = polarToXY(cx, cy, maxR + 30, i * step)
          return (
            <View key={d.id} style={{ position: 'absolute', left: p.x - 38, top: p.y - 16, width: 76, alignItems: 'center' }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#4b5563', textAlign: 'center' }} numberOfLines={1}>{d.label}</Text>
              <Text style={{ fontSize: 13, fontWeight: '900', color: d.confidence === 'low' ? '#9ca3af' : '#16a34a' }}>{d.score}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

// 分析の確からしさ（全体）を3ドットで表示
function ConfidenceDots({ level }: { level: Confidence }) {
  const { t } = useTranslation()
  const n = level === 'high' ? 3 : level === 'medium' ? 2 : 1
  const label = level === 'high' ? t('videoAnalysis.confidence.high') : level === 'medium' ? t('videoAnalysis.confidence.medium') : t('videoAnalysis.confidence.low')
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {[0, 1, 2].map(i => (
        <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i < n ? '#16a34a' : '#e5e7eb' }} />
      ))}
      <Text style={{ fontSize: 11, fontWeight: '700', color: '#6b7280', marginLeft: 2 }}>{label}</Text>
    </View>
  )
}

// フレーム画像＋根拠位置（bbox）のハイライト表示
function EvidenceThumb({ uri, bbox, w = 78, h = 56, color = BRAND }: {
  uri?: string; bbox?: FrameRef; w?: number; h?: number; color?: string
}) {
  if (!uri) return null
  const ringSize = bbox ? Math.max(18, Math.min(bbox.w * w, bbox.h * h) * 1.6) : 0
  return (
    <View style={{ width: w, height: h, borderRadius: 10, overflow: 'hidden', backgroundColor: '#e5e7eb', flexShrink: 0 }}>
      <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      {bbox && (
        <View style={{
          position: 'absolute',
          left: (bbox.x + bbox.w / 2) * w - ringSize / 2,
          top:  (bbox.y + bbox.h / 2) * h - ringSize / 2,
          width: ringSize, height: ringSize, borderRadius: ringSize / 2,
          borderWidth: 2, borderColor: color,
        }} />
      )}
    </View>
  )
}

// 強み／テーマ／次の一歩カード（アイコン・タイトル・本文＋根拠フレーム）
function FeedbackCardView({ icon, label, color, bg, card, frameUri }: {
  icon: string; label: string; color: string; bg: string; card: FeedbackCard; frameUri?: string
}) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 16, borderWidth: 1, borderColor: color + '30',
      padding: 14, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 14 }}>{icon}</Text>
          <Text style={{ color, fontSize: 11, fontWeight: '800' }}>{label}</Text>
        </View>
        <Text style={{ color: '#111827', fontSize: 14, fontWeight: '800', lineHeight: 20 }}>{card.title}</Text>
        <Text style={{ color: '#4b5563', fontSize: 12, lineHeight: 18 }}>{card.text}</Text>
      </View>
      {frameUri && card.bbox && <EvidenceThumb uri={frameUri} bbox={card.bbox} color={color} />}
    </View>
  )
}

// ─── コーチ送信ウィザード ─────────────────────────────────────────
function CoachSendMode() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const FOCUS_HINTS = buildFocusHints(t)
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
      if (!perm.granted) { Alert.alert(t('videoAnalysis.coachSend.permissionRequired'), t('videoAnalysis.coachSend.photoLibraryPermission')); return }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'videos' as any, allowsEditing: false, quality: 1 })
      if (!res.canceled && res.assets[0]) {
        const uri = res.assets[0].uri
        setVideoUri(uri)
        try { const { uri: thumb } = await VideoThumbnails.getThumbnailAsync(uri, { time: 500 }); setThumbUri(thumb) } catch {}
        setStep(2)
      }
    } catch (e: any) { Alert.alert(t('videoAnalysis.coachSend.errorTitle'), e?.message ?? t('videoAnalysis.coachSend.pickFailed')) }
  }

  const recordNow = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync()
      if (!perm.granted) { Alert.alert(t('videoAnalysis.coachSend.permissionRequired'), t('videoAnalysis.coachSend.cameraPermission')); return }
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: 'videos' as any, allowsEditing: false, quality: 1, videoMaxDuration: 90 })
      if (!res.canceled && res.assets[0]) {
        const uri = res.assets[0].uri
        setVideoUri(uri)
        try { const { uri: thumb } = await VideoThumbnails.getThumbnailAsync(uri, { time: 100 }); setThumbUri(thumb) } catch {}
        setStep(2)
      }
    } catch (e: any) { Alert.alert(t('videoAnalysis.coachSend.errorTitle'), e?.message ?? t('videoAnalysis.coachSend.recordFailed')) }
  }

  const send = async () => {
    if (!videoUri) return
    setSending(true)
    try {
      await updateCoachVideoRequests(current => [
        { id: Date.now().toString(), videoUri, thumbnailUri: thumbUri ?? '', message, event, sentAt: new Date().toISOString() },
        ...current,
      ].slice(0, 30))
      // コーチに通知 + Supabase team_videos にレコード作成（別デバイスのコーチが動画タブで確認できるように）
      try {
        const joinedRaw = await AsyncStorage.getItem(JOINED_KEY_VA)
        if (joinedRaw) {
          let joined: any
          try { joined = JSON.parse(joinedRaw) } catch {}
          if (joined?.code && joined?.playerName) {
            const desc = [event, message].filter(Boolean).join(' / ') || t('videoAnalysis.coachSend.defaultSendDesc')
            await Promise.all([
              sendCoachNotification(joined.code, 'video', joined.playerName,
                t('videoAnalysis.coachSend.coachNotifyBody', { name: joined.playerName }) + (event ? `（${event}）` : '')),
              // team_videos テーブルに登録 → コーチの「動画」タブに表示される
              submitVideo(joined.code, joined.playerName, '', desc),
            ])
          }
        }
      } catch {}
      setSent(true)
    } catch { Alert.alert(t('videoAnalysis.coachSend.errorTitle'), t('videoAnalysis.coachSend.sendFailed')) }
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
          {t('videoAnalysis.coachSend.sentTitle')}
        </Text>
        <Text style={{ fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 22, marginBottom: 32 }}>
          {t('videoAnalysis.coachSend.sentDesc')}
        </Text>
        <TouchableOpacity style={cst.primaryBtn} onPress={reset}>
          <Text style={cst.primaryBtnText}>{t('videoAnalysis.coachSend.sendAnother')}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── ステップインジケーター ──
  const StepDots = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 28 }}>
      {[t('videoAnalysis.coachSend.stepVideo'), t('videoAnalysis.coachSend.stepMemo'), t('videoAnalysis.coachSend.stepConfirm')].map((label, i) => {
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
        <Text style={cst.title}>{t('videoAnalysis.coachSend.step1Title')}</Text>
        <Text style={cst.subtitle}>{t('videoAnalysis.coachSend.step1Subtitle')}</Text>
        <StepDots />

        <TouchableOpacity style={cst.bigCard} onPress={recordNow} activeOpacity={0.85}>
          <View style={[cst.bigCardIcon, { backgroundColor: '#dcfce7' }]}>
            <Ionicons name="videocam" size={40} color="#16a34a" />
          </View>
          <Text style={cst.bigCardTitle}>{t('videoAnalysis.coachSend.recordNowTitle')}</Text>
          <Text style={cst.bigCardSub}>{t('videoAnalysis.coachSend.recordNowSub')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[cst.bigCard, { marginTop: 12 }]} onPress={pickFromLibrary} activeOpacity={0.85}>
          <View style={[cst.bigCardIcon, { backgroundColor: '#f0fdf4' }]}>
            <Ionicons name="images" size={40} color="#22c55e" />
          </View>
          <Text style={cst.bigCardTitle}>{t('videoAnalysis.coachSend.pickLibraryTitle')}</Text>
          <Text style={cst.bigCardSub}>{t('videoAnalysis.coachSend.pickLibrarySub')}</Text>
        </TouchableOpacity>

        <View style={cst.tipBox}>
          <Ionicons name="bulb-outline" size={16} color="#ca8a04" />
          <Text style={cst.tipText}>
            {t('videoAnalysis.coachSend.tip')}
          </Text>
        </View>
      </ScrollView>
    )
  }

  // ── STEP 2: メモ入力 ──
  if (step === 2) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: '#f6f6f8' }} contentContainerStyle={cst.scroll} keyboardShouldPersistTaps="handled">
        <Text style={cst.title}>{t('videoAnalysis.coachSend.step2Title')}</Text>
        <Text style={cst.subtitle}>{t('videoAnalysis.coachSend.step2Subtitle')}</Text>
        <StepDots />

        {/* サムネイル */}
        {thumbUri && (
          <View style={{ alignItems: 'center', marginBottom: 20 }}>
            <Image source={{ uri: thumbUri }} style={{ width: 200, height: 120, borderRadius: 14, backgroundColor: '#e5e7eb' }} />
            <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>{t('videoAnalysis.coachSend.selectedCheck')}</Text>
          </View>
        )}

        {/* 種目 */}
        <Text style={cst.fieldLabel}>{t('videoAnalysis.coachSend.eventLabel')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8 }}>
          {['', '100m','200m','300m','400m','800m','1000m','1500m','3000m','走幅跳','三段跳','走高跳','棒高跳','110mH','400mH','5000m'].map(ev => (
            <TouchableOpacity
              key={ev || 'none'}
              style={[cst.chip, event === ev && cst.chipActive]}
              onPress={() => setEvent(ev)}
              activeOpacity={0.8}
            >
              <Text style={[cst.chipText, event === ev && { color: '#fff' }]}>{ev ? getEventLabel(ev, language) : t('videoAnalysis.eventNone')}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* フォーカスヒント */}
        <Text style={cst.fieldLabel}>{t('videoAnalysis.coachSend.focusHintLabel')}</Text>
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
          placeholder={t('videoAnalysis.coachSend.messagePlaceholder')}
          placeholderTextColor="#9ca3af"
          multiline
          numberOfLines={3}
        />

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <TouchableOpacity style={cst.secondaryBtn} onPress={() => setStep(1)}>
            <Text style={cst.secondaryBtnText}>{t('videoAnalysis.coachSend.back')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[cst.primaryBtn, { flex: 1 }]} onPress={() => setStep(3)}>
            <Text style={cst.primaryBtnText}>{t('videoAnalysis.coachSend.confirmNext')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    )
  }

  // ── STEP 3: 確認して送信 ──
  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f6f6f8' }} contentContainerStyle={cst.scroll}>
      <Text style={cst.title}>{t('videoAnalysis.coachSend.step3Title')}</Text>
      <Text style={cst.subtitle}>{t('videoAnalysis.coachSend.step3Subtitle')}</Text>
      <StepDots />

      <View style={cst.confirmCard}>
        {thumbUri && (
          <Image source={{ uri: thumbUri }} style={{ width: '100%', height: 180, borderRadius: 10, backgroundColor: '#e5e7eb', marginBottom: 14 }} />
        )}
        <View style={cst.confirmRow}>
          <Text style={cst.confirmLabel}>{t('videoAnalysis.coachSend.eventLabel')}</Text>
          <Text style={cst.confirmValue}>{event ? getEventLabel(event, language) : t('videoAnalysis.eventNone')}</Text>
        </View>
        <View style={cst.divider} />
        <View style={cst.confirmRow}>
          <Text style={cst.confirmLabel}>{t('videoAnalysis.coachSend.coachMemoLabel')}</Text>
          <Text style={[cst.confirmValue, { flex: 1, textAlign: 'right' }]} numberOfLines={3}>
            {message || t('videoAnalysis.coachSend.noneValue')}
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
              <Text style={cst.sendBtnText}>{t('videoAnalysis.coachSend.sendToCoach')}</Text>
            </>
        }
      </TouchableOpacity>

      <TouchableOpacity style={cst.secondaryBtn} onPress={() => setStep(2)}>
        <Text style={cst.secondaryBtnText}>{t('videoAnalysis.coachSend.editBack')}</Text>
      </TouchableOpacity>

      <Text style={cst.noteText}>
        {t('videoAnalysis.coachSend.footerNote')}
      </Text>
    </ScrollView>
  )
}

// ─── タブ切替ラッパー ─────────────────────────────────────────────
function NativeVideoAnalysisRoot() {
  const { t } = useTranslation()
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
          <Text style={[cst.tabText, activeTab === 'ai' && { color: '#fff' }]}>{t('videoAnalysis.coachSend.tabAi')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[cst.tab, activeTab === 'coach' && { backgroundColor: '#16a34a' }]}
          onPress={() => setActiveTab('coach')}
          activeOpacity={0.8}
        >
          <Ionicons name="paper-plane" size={14} color={activeTab === 'coach' ? '#fff' : '#6b7280'} />
          <Text style={[cst.tabText, activeTab === 'coach' && { color: '#fff' }]}>{t('videoAnalysis.coachSend.tabCoach')}</Text>
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
  // 動画の撮影日（分析を実行した日と異なる場合があるため、ユーザーが手動で指定できるようにする）
  const [shotDate, setShotDate]       = useState(todayLocalISO())
  const [clothingColor, setClothingColor] = useState('')
  const [shoeColor,     setShoeColor]     = useState('')
  const [laneNumber,    setLaneNumber]    = useState('')
  const [finishPosition,setFinishPosition]= useState('')
  // 複数人動画で別人が分析された場合の自己申告チケット返還（1結果につき1回まで）
  const [reportedWrongPerson, setReportedWrongPerson] = useState(false)
  const [refundingTicket,     setRefundingTicket]     = useState(false)
  const [result, setResult]           = useState<AnalysisResult | null>(null)
  const [prevScore, setPrevScore]     = useState<number | null>(null)
  const [rawText, setRawText]         = useState('')
  const [error, setError]             = useState('')
  const [stepLabel, setStepLabel]     = useState('')
  const [adGateVisible,     setAdGateVisible]     = useState(false)
  const [adGateRemaining,   setAdGateRemaining]   = useState(0)
  const [adGateHardLimited, setAdGateHardLimited] = useState(false)
  const [adGateLimitType,   setAdGateLimitType]   = useState<'none'|'daily'|'monthly'|'total'|'window'>('none')
  const [ticketGateVisible, setTicketGateVisible] = useState(false)
  const [ticketGateCost,    setTicketGateCost]    = useState(0)
  const [ticketGateBalance, setTicketGateBalance] = useState(0)
  const [upsellVisible,     setUpsellVisible]     = useState(false)
  const [historyList,       setHistoryList]       = useState<VideoAnalysisHistoryEntry[]>([])
  const [historyModal,      setHistoryModal]      = useState(false)
  const [historyFilter,     setHistoryFilter]     = useState<string | null>(null)
  const { isGuest } = useAuth()
  const router = useRouter()
  const { t } = useTranslation()
  const { language } = useLanguage()
  // 連続タップによる二重起動防止（AdGate async チェック中もガード）
  const analyzingRef = React.useRef(false)
  // 広告視聴済みクレジット（分析失敗時のリトライも広告なしで通す）
  const adCreditRef = React.useRef(false)

  React.useEffect(() => {
    getVideoAnalysisHistory().then(setHistoryList).catch(() => {})
  }, [])

  // 複数種目を分析しているユーザーが種目ごとの推移を追いやすいよう、種目でグルーピングする。
  // グループの並びは「その種目を最後に分析した日」が新しい順。各グループ内は元のnewest-first順のまま。
  const historyEvents = React.useMemo(
    () => Array.from(new Set(historyList.map(h => h.event))),
    [historyList]
  )
  const groupedHistory = React.useMemo(() => {
    const filtered = historyFilter ? historyList.filter(h => h.event === historyFilter) : historyList
    const order: string[] = []
    const map = new Map<string, VideoAnalysisHistoryEntry[]>()
    for (const h of filtered) {
      if (!map.has(h.event)) { map.set(h.event, []); order.push(h.event) }
      map.get(h.event)!.push(h)
    }
    return order.map(event => ({ event, entries: map.get(event)! }))
  }, [historyList, historyFilter])

  async function pickVideo() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) { Alert.alert(t('videoAnalysis.native.permissionRequired'), t('videoAnalysis.native.photoLibraryPermission')); return }
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
        setResult(null); setRawText(''); setError(''); setFrames([]); setReportedWrongPerson(false)
        setShotDate(todayLocalISO())
        setPhase('idle')
      }
    } catch (e: any) { Alert.alert(t('videoAnalysis.native.pickErrorTitle'), e?.message ?? t('videoAnalysis.native.pickErrorMessage')) }
  }

  // 複数人動画で対象と違う選手が分析されてしまった場合の自己申告チケット返還。
  // 1件の分析結果につき1回のみ（再分析・別動画の選択でリセットされる）。
  function reportWrongPersonAnalyzed() {
    if (reportedWrongPerson || refundingTicket) return
    Alert.alert(
      t('videoAnalysis.native.wrongPersonTitle'),
      t('videoAnalysis.native.wrongPersonMessage', { n: TICKET_COST.video }),
      [
        { text: t('videoAnalysis.native.cancel'), style: 'cancel' },
        {
          text: t('videoAnalysis.native.refundConfirm'),
          onPress: async () => {
            setRefundingTicket(true)
            try {
              await grantTickets(TICKET_COST.video)
              setReportedWrongPerson(true)
              Toast.show({ type: 'success', text1: t('videoAnalysis.native.refundedToast', { n: TICKET_COST.video }), visibilityTime: 2000 })
            } catch {
              Toast.show({ type: 'error', text1: t('videoAnalysis.native.refundFailedToast'), text2: t('videoAnalysis.native.refundFailedHint') })
            } finally {
              setRefundingTicket(false)
            }
          },
        },
      ]
    )
  }

  async function analyze(skipGate = false, forceRefresh = false) {
    if (analyzingRef.current) return   // 二重タップ防止
    if (!videoUri) { Alert.alert(t('videoAnalysis.native.selectVideoAlert')); return }
    // ゲストはログイン必須
    if (isGuest) { setAdGateRemaining(0); setAdGateHardLimited(false); setAdGateVisible(true); return }
    // 広告視聴済みクレジットがあればゲートをスキップ（分析失敗時のリトライも許可）
    const usedAdCredit = adCreditRef.current
    if (adCreditRef.current) { skipGate = true }
    // AdGateチェック（広告視聴後は skipGate=true でバイパス）
    let usesTicketThisRun = false
    if (!skipGate) {
      const gate = await checkAdGate('video')
      if (!gate.allowed) {
        if (gate.needsTicket) { setTicketGateCost(gate.ticketCost); setTicketGateBalance(gate.ticketBalance); setTicketGateVisible(true) }
        else { setAdGateRemaining(gate.remaining); setAdGateHardLimited(gate.hardLimited); setAdGateLimitType(gate.limitType); setAdGateVisible(true) }
        return
      }
      usesTicketThisRun = gate.needsTicket
    }
    analyzingRef.current = true
    trackFeatureUse('video')
    setError(''); setResult(null); setRawText(''); setReportedWrongPerson(false)

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
      setStepLabel(t('videoAnalysis.native.extractingStep'))

      let localUri = videoUri
      if (videoUri.startsWith('ph://') || !videoUri.startsWith('file://')) {
        const dest = (FileSystem as any).cacheDirectory + `score_video_${Date.now()}.mp4`
        try {
          await FileSystem.copyAsync({ from: videoUri, to: dest })
        } catch {
          // iCloudにのみ保存されている動画は端末への同期が必要（PHPhotosErrorDomain等）
          throw new Error(t('videoAnalysis.native.videoLoadFailed'))
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
      for (const ts of timestampsForThisVideo) {
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(localUri, { time: ts, quality: 0.8 })
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

      if (base64Frames.length === 0) throw new Error(t('videoAnalysis.native.frameFetchFailed'))
      setFrames(thumbUris)

      // ── Step 2: AI分析 ──
      setPhase('analyzing')
      setStepLabel(t('videoAnalysis.native.analyzingStep', { n: base64Frames.length }))

      // 抽出したフレーム(最大FRAME_COUNT枚)を全て使用。
      // 以前は4枚に制限していたが、computeFrameTimestampsが動画終盤まで
      // 均等割りで抽出しているのに末尾のフレームだけ切り捨てられ、
      // 終盤の動きが分析に反映されない不具合があったため撤廃。
      const imageBlocks = base64Frames.slice(0, FRAME_COUNT).map(b64 => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: b64 },
      }))

      // 人物特定情報をプロンプトに組み込む（レーン番号・着順は同じユニフォームの
      // チームメイトが並ぶレース動画で服・靴の色より確実な識別情報になるため追加）
      const personHint = [
        laneNumber     ? `レーン番号：${laneNumber}`   : '',
        finishPosition ? `着順：${finishPosition}`     : '',
        clothingColor  ? `服の色：${clothingColor}`     : '',
        shoeColor      ? `靴の色：${shoeColor}`         : '',
      ].filter(Boolean).join('、')

      // 採点の基準点を明示し、モデルが無難な中間点に逃げるのを防ぐ
      const nF = imageBlocks.length
      const { dims } = dimensionsForEvent(event)
      const dimIdList = dims.map(d => d.id).join('、')
      const prompt = `陸上${event ? `(${event})` : ''}フォーム分析。${personHint ? `対象:${personHint}。` : ''}${nF}フレーム(0〜${nF-1})を評価せよ。

重要な原則（必ず守ること）:
- 静止画からは「速度」「ピッチ」「ストライド」など直接計測できない数値は絶対にスコア化しない
- スコア化するのは画像から観察できる「フォームの質」のみ（能力の推測ではない）
- 各項目に必ずconfidence(low/medium/high)を付け、静止画だけでは判断しづらい場合はlowにする
- 誇張せず、実際に写っている姿勢・関節角度・接地位置から見えている範囲だけで評価する
- 各テキスト項目(reason/text/theme/drill/drillDetail等)は指定の文字数を絶対に超過しないこと。
  簡潔さを最優先し、言い回しを工夫して短く収める（文字数超過は出力全体が途中で切れる原因になる）

評価する項目（${dims.length}件、必ず全て採点。0-100で必ず差をつける。中間点への逃げ禁止）:
${dims.map(d => `- ${d.id}(${d.label})`).join('\n')}

採点基準（各項目共通）:
- 90-100: トップ選手レベル
- 70-89: 実業団・大学レベル。大枠は良いが細部に改善点
- 50-69: 一般的な部活生レベル。明確な改善点が複数
- 30-49: フォームに大きな崩れがある
- 0-29: 画像が不鮮明、または判断不能

bbox（根拠位置）は、その所見の根拠となる身体部位のおおよその位置を0〜1の正規化座標
(f=該当フレーム番号、x/y=左上、w/h=幅高さ)で指定。確信が持てなければ省略可。

コードブロック不使用・生のJSONのみで回答:
{"score":総合0-100,"headline":"一番伝えたい一言30字以内(例:接地を改善すれば、もっと速くなれます)","confidenceOverall":"low|medium|high","dimensions":[{"id":"${dims[0]?.id ?? 'posture'}","score":0-100,"confidence":"low|medium|high","reason":"20字以内","bbox":{"f":0,"x":0.3,"y":0.2,"w":0.2,"h":0.3}}],"strength":{"title":"15字以内","text":"40字以内","bbox":{"f":0,"x":0,"y":0,"w":0,"h":0}},"focus":{"title":"15字以内(改善点は最重要な1つのみ)","text":"40字以内","bbox":{"f":0,"x":0,"y":0,"w":0,"h":0}},"nextStep":{"title":"15字以内","text":"40字以内"},"practice":{"theme":"今日の練習テーマ20字以内","drill":"ドリル名","drillDetail":"方法・セット数"},"frameNotes":[{"f":番号,"note":"指摘20字"}]}
dimensions:上記${dims.length}項目(${dimIdList})全て必須。focusは改善点を1つだけに絞ること（複数挙げない）。frameNotes:最大2件。${narrativeLanguageInstruction(language)}`

      // Vercel proxy経由でAnthropicを呼び出し（APIキーをクライアントに持たせない）
      const apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
      const endpoint = `${apiBase}/api/analyze`

      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          // レーダーチャート方式(7項目×score/confidence/reason/bbox + strength/focus/nextStep + practice)で
          // 応答JSONが旧スキーマよりかなり大きくなったため増量。1500のままだと応答が途中で切れて
          // JSONパース失敗→総合スコア60点の汎用フォールバックになる不具合が発生していた。
          // 2026-08-29: 2600でも、実際の走行フォーム画像(情報量が多い)+gemini-3.5-flashの組み合わせで
          // 同じ途中切れが再発したため引き上げ（api/analyze.ts側の上限も4096に合わせて引き上げ済み）。
          max_tokens: 3800,
          messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }],
        }),
      }, 65000)  // サーバー側(api/analyze.ts)のmaxDuration=60秒より長くする。45秒のままだと
                 // Geminiの応答が46〜59秒かかったケースでサーバーは間に合っているのに
                 // クライアントが先にタイムアウトしてエラーになっていた

      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        throw new Error(t('videoAnalysis.native.apiErrorMessage', { status: res.status, body: errBody.slice(0, 120) }))
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
      const emptyCard = (): FeedbackCard => ({ title: '', text: '' })
      const isConfidence = (v: any): v is Confidence => v === 'low' || v === 'medium' || v === 'high'
      const asBbox = (b: any): FrameRef | undefined =>
        (b && typeof b.f === 'number' && typeof b.x === 'number' && typeof b.y === 'number'
          && typeof b.w === 'number' && typeof b.h === 'number' && b.w > 0 && b.h > 0) ? b : undefined
      const asCard = (c: any): FeedbackCard =>
        c && typeof c.title === 'string' ? { title: c.title, text: c.text ?? '', bbox: asBbox(c.bbox) } : emptyCard()
      if (jsonStr) {
        try {
          const p = JSON.parse(jsonStr) as any
          // 総合スコアが数値でない場合は「JSONは解析できたが中身が不完全」なケース。
          // 以前ここを60点にフォールバックしていたため、エラーにもならず偽の60点が
          // 正常な結果として表示され続ける不具合があった（総合パース失敗時のエラー化とは
          // 別経路のため、そちらの修正だけでは直っていなかった）。ここも素直に失敗扱いにする。
          if (typeof p.score !== 'number') throw new Error('score missing')
          const { dims: expectedDims } = dimensionsForEventDisplay(event, t)
          const rawDims: any[] = Array.isArray(p.dimensions) ? p.dimensions : []
          const dimensions: DimensionScore[] = expectedDims.map(d => {
            const found = rawDims.find(r => r?.id === d.id)
            return {
              id: d.id,
              label: d.label,
              score: typeof found?.score === 'number' ? Math.max(0, Math.min(100, found.score)) : 60,
              confidence: isConfidence(found?.confidence) ? found.confidence : 'low',
              reason: typeof found?.reason === 'string' ? found.reason : '',
              bbox: asBbox(found?.bbox),
            }
          })
          parsed = {
            score: p.score,
            headline: p.headline ?? t('videoAnalysis.native.defaultHeadline'),
            dimensions,
            confidenceOverall: isConfidence(p.confidenceOverall) ? p.confidenceOverall : 'low',
            strength: asCard(p.strength),
            focus: asCard(p.focus),
            nextStep: asCard(p.nextStep),
            practice: {
              theme: p.practice?.theme ?? '',
              drill: p.practice?.drill ?? '',
              drillDetail: p.practice?.drillDetail ?? '',
            },
            frameNotes: Array.isArray(p.frameNotes) ? p.frameNotes : undefined,
          }
        } catch { parsed = null }
      }
      // JSONが取得できなかった場合、以前は「スコア60点固定」の中身のない仮結果を
      // 生成してそのまま成功扱いにしていたが、これはAIが混雑等でまともに応答できなかった
      // ときに偽の分析結果をユーザーに提示し、かつチケットも消費してしまう不具合だった。
      // 解析失敗は素直に失敗として扱い、チケットを消費せずリトライを促す。
      if (!parsed) {
        throw new Error(t('videoAnalysis.native.parseFailedError'))
      }

      // 同じ種目の直近分析があればスコア差分表示のために保持
      // ※ event の空文字フォールバック値は履歴のグルーピングキー（内部データ）のため、
      //   表示用の翻訳は行わず常に日本語の固定値を使う（言語切り替えで別グループに
      //   分裂しないように）。表示側は historyEvents 生成時に翻訳する。
      const prevEntry = historyList.find(h => h.event === (event || '種目未指定'))

      // 履歴への永続保存を、画面状態の更新・チケット消費より必ず先に完了させる。
      // 以前は setResult/setPhase('result') → チケット消費 → 履歴保存（fire-and-forget）
      // の順で、履歴保存が非同期のまま画面遷移が先に起きていたため、遷移直後に
      // クラッシュするとチケットだけ消費されて分析結果が履歴に残らない不具合があった。
      // 画像は保存しない（base64サムネイルを含めるとJSONが肥大化し、AsyncStorageの
      // 書き込みが失敗して履歴が実は保存されていない不具合の原因になっていたため）
      try {
        const nextHistory = await addVideoAnalysisHistory({
          event: event || '種目未指定',
          shot_date: shotDate || undefined,
          score: parsed.score,
          headline: parsed.headline,
          dimensions: parsed.dimensions,
          confidenceOverall: parsed.confidenceOverall,
          strength: parsed.strength,
          focus: parsed.focus,
          nextStep: parsed.nextStep,
          practice: parsed.practice,
        })
        setHistoryList(nextHistory)
      } catch {
        // 履歴保存に失敗しても、AIの応答自体は無駄にせずユーザーに提示する
      }

      setResult(parsed)
      setPhase('result')
      setPrevScore(prevEntry?.score ?? null)
      adCreditRef.current = false  // 分析成功でクレジット消費
      // 広告視聴後の分析が完了したら、広告なしプランへのアップセルを提示
      if (usedAdCredit) setUpsellVisible(true)

      // 分析に成功した場合のみ利用回数・チケットを消費する（失敗時に課金しないため）
      if (!skipGate) {
        await recordUsage('video')
        if (usesTicketThisRun) Toast.show({ type: 'info', text1: t('videoAnalysis.native.ticketUsedToast', { n: TICKET_COST.video }), visibilityTime: 1800 })
      }
      // キャッシュに保存（同じ動画の再分析コストをゼロに）
      setAnalysisCache(videoUri, event, parsed).catch(() => {})
    } catch (e: any) {
      setError(e?.message ?? t('videoAnalysis.native.analysisFailedError'))
      setPhase('idle')
      // 分析失敗時はクレジットを残す（リトライを広告なしで許可）
    } finally {
      analyzingRef.current = false
    }
  }

  const scoreColor = result
    ? result.score >= 80 ? '#34C759' : result.score >= 60 ? '#FF9500' : '#FF3B30'
    : '#166534'

  // 分析の根拠ギャラリー用データ（bboxが付いているカード/軸を集約）
  type EvidenceItem = { bbox: FrameRef; caption: string; color: string }
  const evidenceItems: EvidenceItem[] = result ? [
    ...(result.strength.bbox ? [{ bbox: result.strength.bbox, caption: `⭐ ${result.strength.title}`, color: '#16a34a' }] : []),
    ...(result.focus.bbox    ? [{ bbox: result.focus.bbox,    caption: `🔥 ${result.focus.title}`,    color: '#d97706' }] : []),
    ...(result.nextStep.bbox ? [{ bbox: result.nextStep.bbox, caption: `🎯 ${result.nextStep.title}`, color: '#2563eb' }] : []),
    ...result.dimensions.filter(d => d.bbox).map(d => ({ bbox: d.bbox as FrameRef, caption: `${d.label}：${d.reason}`, color: '#6b7280' })),
  ].filter(it => frames[it.bbox.f]) : []

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f5f7' }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ヘッダー */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#111827', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 }}>{t('videoAnalysis.native.title')}</Text>
            <Text style={{ color: '#6b7280', fontSize: 13, marginTop: 2 }}>{t('videoAnalysis.native.subtitle', { n: MAX_FRAMES })}</Text>
          </View>
          <TouchableOpacity
            onPress={() => setHistoryModal(true)}
            activeOpacity={0.8}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#e5e7eb',
              paddingHorizontal: 12, paddingVertical: 8,
            }}
          >
            <Ionicons name="time-outline" size={15} color={BRAND} />
            <Text style={{ color: BRAND, fontSize: 12, fontWeight: '700' }}>{t('videoAnalysis.native.history')}</Text>
          </TouchableOpacity>
        </View>

        {/* 種目選択（自由入力にすると分析履歴のグルーピングキーが汚染される
            ——例えば「レーン番号」欄と混同してここに「奥のレーン」等を入力してしまい、
            種目タブに存在しない値がそのまま表示される不具合があった。Web版と同じ
            固定チップ選択に統一する） */}
        <View style={{ marginBottom: 14 }}>
          <Text style={{ color: '#6b7280', fontSize: 11, fontWeight: '700', marginBottom: 6, letterSpacing: 0.8 }}>{t('videoAnalysis.native.eventLabel')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
            {['', '100m','200m','300m','400m','800m','1000m','1500m','3000m','110mH','100mH','300mH','400mH','走幅跳','三段跳','走高跳','棒高跳','砲丸投','やり投','円盤投'].map(ev => (
              <TouchableOpacity
                key={ev || '指定なし'}
                onPress={() => setEvent(ev)}
                style={{
                  paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
                  backgroundColor: event === ev ? BRAND : '#fff',
                  borderWidth: 1, borderColor: event === ev ? BRAND : '#e5e7eb',
                }}
              >
                <Text style={{ color: event === ev ? '#fff' : '#111827', fontSize: 14, fontWeight: '700' }}>
                  {ev ? getEventLabel(ev, language) : t('videoAnalysis.eventNone')}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* 分析対象の人物特定（複数人対応） */}
        <View style={{ marginBottom: 14, backgroundColor: '#fff', borderRadius: 14,
          borderWidth: 1, borderColor: '#e5e7eb', padding: 14 }}>
          <Text style={{ color: '#6b7280', fontSize: 11, fontWeight: '700', marginBottom: 10, letterSpacing: 0.8 }}>
            {t('videoAnalysis.native.personIdTitle')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#9ca3af', fontSize: 10, fontWeight: '600', marginBottom: 5 }}>{t('videoAnalysis.native.laneNumberLabel')}</Text>
              <TextInput
                style={{ backgroundColor: '#f9fafb', color: '#111827', borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: '#e5e7eb' }}
                placeholder={t('videoAnalysis.native.laneNumberPlaceholder')}
                placeholderTextColor="#9ca3af"
                keyboardType="number-pad"
                value={laneNumber}
                onChangeText={setLaneNumber}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#9ca3af', fontSize: 10, fontWeight: '600', marginBottom: 5 }}>{t('videoAnalysis.native.finishPositionLabel')}</Text>
              <TextInput
                style={{ backgroundColor: '#f9fafb', color: '#111827', borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: '#e5e7eb' }}
                placeholder={t('videoAnalysis.native.finishPositionPlaceholder')}
                placeholderTextColor="#9ca3af"
                value={finishPosition}
                onChangeText={setFinishPosition}
              />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#9ca3af', fontSize: 10, fontWeight: '600', marginBottom: 5 }}>{t('videoAnalysis.native.clothingColorLabel')}</Text>
              <TextInput
                style={{ backgroundColor: '#f9fafb', color: '#111827', borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: '#e5e7eb' }}
                placeholder={t('videoAnalysis.native.clothingColorPlaceholder')}
                placeholderTextColor="#9ca3af"
                value={clothingColor}
                onChangeText={setClothingColor}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#9ca3af', fontSize: 10, fontWeight: '600', marginBottom: 5 }}>{t('videoAnalysis.native.shoeColorLabel')}</Text>
              <TextInput
                style={{ backgroundColor: '#f9fafb', color: '#111827', borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: '#e5e7eb' }}
                placeholder={t('videoAnalysis.native.shoeColorPlaceholder')}
                placeholderTextColor="#9ca3af"
                value={shoeColor}
                onChangeText={setShoeColor}
              />
            </View>
          </View>
          {(laneNumber || finishPosition || clothingColor || shoeColor) ? (
            <Text style={{ color: '#16a34a', fontSize: 11, marginTop: 8 }}>
              ✓ {t('videoAnalysis.native.targetConfirmed', { parts: [laneNumber && t('videoAnalysis.native.laneLabel', { n: laneNumber }), finishPosition && t('videoAnalysis.native.finishLabel', { n: finishPosition }), clothingColor && t('videoAnalysis.native.clothingLabel', { n: clothingColor }), shoeColor && t('videoAnalysis.native.shoeLabel', { n: shoeColor })].filter(Boolean).join('　') })}
            </Text>
          ) : (
            <Text style={{ color: '#9ca3af', fontSize: 11, marginTop: 6 }}>{t('videoAnalysis.native.targetHint')}</Text>
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
            {videoUri ? t('videoAnalysis.native.videoSelected') : t('videoAnalysis.native.videoSelectPrompt')}
          </Text>
          {!videoUri && (
            <Text style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}>{t('videoAnalysis.native.videoFormats')}</Text>
          )}
        </TouchableOpacity>

        {/* 撮影日（分析を実行する日と異なる場合があるため手動指定できるようにする） */}
        {videoUri && (
          <View style={{ marginBottom: 14 }}>
            <Text style={{ color: '#6b7280', fontSize: 11, fontWeight: '700', marginBottom: 8, letterSpacing: 0.8 }}>
              {t('videoAnalysis.native.shotDateLabel')}
            </Text>
            <DateSelector date={shotDate} onChange={setShotDate} />
          </View>
        )}

        {/* 抽出フレームサムネイル */}
        {frames.length > 0 && (
          <View style={{ marginBottom: 14 }}>
            <Text style={{ color: '#6b7280', fontSize: 11, fontWeight: '700', marginBottom: 8, letterSpacing: 0.8 }}>
              {t('videoAnalysis.native.extractedFrames', { n: frames.length })}
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
              {[t('videoAnalysis.native.stepExtract'), t('videoAnalysis.native.stepAnalyze'), t('videoAnalysis.native.stepResult')].map((step, i) => {
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
            {/* チケット消費数バッジ */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8,
              backgroundColor: 'rgba(245,158,11,0.14)',
              borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start',
              borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)',
            }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#f59e0b' }}>
                {t('videoAnalysis.native.ticketBadge', { n: TICKET_COST.video })}
              </Text>
            </View>
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
                {phase === 'result' ? t('videoAnalysis.native.reanalyzeButton') : t('videoAnalysis.native.analyzeButton')}
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

            {/* ヘッドライン＋スコア */}
            <View style={{ backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: scoreColor + '40',
              overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 }}>
              <View style={{ height: 3, backgroundColor: scoreColor }} />
              <View style={{ padding: 20, gap: 6 }}>
                <Text style={{ color: scoreColor, fontSize: 12, fontWeight: '800' }}>
                  {result.score >= 80 ? t('videoAnalysis.native.scoreGood') : result.score >= 60 ? t('videoAnalysis.native.scoreOk') : t('videoAnalysis.native.scoreLow')}
                </Text>
                <Text style={{ color: '#111827', fontSize: 20, fontWeight: '900', lineHeight: 28 }}>
                  {result.headline}
                </Text>
                <Text style={{ color: '#9ca3af', fontSize: 11, marginTop: 4 }}>
                  {new Date().toLocaleString(language === 'ja' ? 'ja-JP' : 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  {event ? t('videoAnalysis.native.eventPrefix', { event }) : ''}
                </Text>

                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 16, marginTop: 14 }}>
                  <View>
                    <Text style={{ color: '#9ca3af', fontSize: 11, fontWeight: '700' }}>{t('videoAnalysis.native.totalScore')}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                      <Text style={{ color: scoreColor, fontSize: 40, fontWeight: '900' }}>{result.score}</Text>
                      <Text style={{ color: '#9ca3af', fontSize: 13, fontWeight: '700' }}>/ 100</Text>
                    </View>
                    {prevScore !== null && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2,
                        backgroundColor: result.score >= prevScore ? '#f0fdf4' : '#fef2f2',
                        alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Ionicons name={result.score >= prevScore ? 'arrow-up' : 'arrow-down'} size={10}
                          color={result.score >= prevScore ? '#16a34a' : '#dc2626'} />
                        <Text style={{ fontSize: 10.5, fontWeight: '800', color: result.score >= prevScore ? '#16a34a' : '#dc2626' }}>
                          {t('videoAnalysis.native.prevDiff', { sign: result.score - prevScore >= 0 ? '+' : '', n: result.score - prevScore })}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ color: '#9ca3af', fontSize: 11, fontWeight: '700' }}>{t('videoAnalysis.native.confidenceLabel')}</Text>
                    <ConfidenceDots level={result.confidenceOverall} />
                    <Text style={{ color: '#9ca3af', fontSize: 10, lineHeight: 14 }}>{t('videoAnalysis.native.confidenceNote')}</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* 複数人動画で違う選手が分析された場合の申告リンク */}
            {laneNumber || finishPosition || clothingColor || shoeColor ? (
              <TouchableOpacity
                onPress={reportWrongPersonAnalyzed}
                disabled={reportedWrongPerson || refundingTicket}
                activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 }}
              >
                {reportedWrongPerson ? (
                  <>
                    <Ionicons name="checkmark-circle" size={14} color="#16a34a" />
                    <Text style={{ color: '#16a34a', fontSize: 12, fontWeight: '700' }}>{t('videoAnalysis.native.reportRefunded')}</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="alert-circle-outline" size={14} color="#9ca3af" />
                    <Text style={{ color: '#9ca3af', fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' }}>
                      {refundingTicket ? t('videoAnalysis.native.reportProcessing') : t('videoAnalysis.native.reportWrongPerson')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}

            {/* レーダーチャート */}
            {result.dimensions.length >= 3 && (
              <View style={{ backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#e5e7eb', padding: 16, alignItems: 'center', gap: 10 }}>
                <RadarChart dimensions={result.dimensions} />
                <View style={{ flexDirection: 'row', gap: 16, marginTop: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 16, height: 2, backgroundColor: '#16a34a' }} />
                    <Text style={{ fontSize: 11, color: '#4b5563', fontWeight: '700' }}>{t('videoAnalysis.native.you')}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 16, height: 0, borderTopWidth: 1.5, borderColor: '#9ca3af', borderStyle: 'dashed' }} />
                    <Text style={{ fontSize: 11, color: '#4b5563', fontWeight: '700' }}>{t('videoAnalysis.native.idealLine')}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#fefce8',
                  borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#fde047', width: '100%' }}>
                  <Ionicons name="bulb-outline" size={14} color="#ca8a04" />
                  <Text style={{ flex: 1, color: '#713f12', fontSize: 11, lineHeight: 16 }}>
                    {t('videoAnalysis.native.radarNote')}
                  </Text>
                </View>
              </View>
            )}

            {/* AIコーチのフィードバック */}
            {(result.strength.title || result.focus.title || result.nextStep.title) && (
              <View style={{ gap: 10 }}>
                <Text style={{ color: '#111827', fontSize: 14, fontWeight: '800' }}>{t('videoAnalysis.native.aiFeedback')}</Text>
                {result.strength.title && (
                  <FeedbackCardView icon="⭐" label={t('videoAnalysis.native.todayStrength')} color="#16a34a" bg="#f0fdf4"
                    card={result.strength} frameUri={result.strength.bbox ? frames[result.strength.bbox.f] : undefined} />
                )}
                {result.focus.title && (
                  <FeedbackCardView icon="🔥" label={t('videoAnalysis.native.todayTheme')} color="#d97706" bg="#fffbeb"
                    card={result.focus} frameUri={result.focus.bbox ? frames[result.focus.bbox.f] : undefined} />
                )}
                {result.nextStep.title && (
                  <FeedbackCardView icon="🎯" label={t('videoAnalysis.native.nextStep')} color="#2563eb" bg="#eff6ff"
                    card={result.nextStep} frameUri={result.nextStep.bbox ? frames[result.nextStep.bbox.f] : undefined} />
                )}
              </View>
            )}

            {/* 今日の練習テーマ＋おすすめドリル */}
            {(result.practice.theme || result.practice.drill) && (
              <View style={{ backgroundColor: '#111827', borderRadius: 16, padding: 16, gap: 10 }}>
                {result.practice.theme && (
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <Ionicons name="flag" size={13} color="#4ade80" />
                      <Text style={{ color: '#4ade80', fontSize: 11, fontWeight: '800' }}>{t('videoAnalysis.native.todayPracticeTheme')}</Text>
                    </View>
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800', lineHeight: 21 }}>{result.practice.theme}</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11.5, marginTop: 2 }}>{t('videoAnalysis.native.practiceThemeNote')}</Text>
                  </View>
                )}
                {result.practice.drill && (
                  <View style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                    <Text style={{ fontSize: 18 }}>👟</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{t('videoAnalysis.native.recommendedDrill', { name: result.practice.drill })}</Text>
                      {result.practice.drillDetail && (
                        <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11.5, marginTop: 2, lineHeight: 16 }}>{result.practice.drillDetail}</Text>
                      )}
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* 分析の根拠（静止画比較） */}
            {evidenceItems.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={{ color: '#111827', fontSize: 14, fontWeight: '800' }}>{t('videoAnalysis.native.evidenceTitle')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                  {evidenceItems.map((it, i) => (
                    <View key={i} style={{ width: 120, gap: 6 }}>
                      <EvidenceThumb uri={frames[it.bbox.f]} bbox={it.bbox} w={120} h={90} color={it.color} />
                      <Text style={{ color: '#4b5563', fontSize: 10.5, lineHeight: 14 }} numberOfLines={3}>{it.caption}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* 再分析ボタン */}
            <TouchableOpacity
              onPress={() => analyze(false, true)}
              activeOpacity={0.85}
              style={{ borderRadius: 16, padding: 16, alignItems: 'center',
                backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb' }}
            >
              <Text style={{ color: '#6b7280', fontSize: 14, fontWeight: '700' }}>🔄 {t('videoAnalysis.native.reanalyzeButton')}</Text>
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
          // チケット消費は analyze() 内部の「分析成功時のみ」ロジックに任せる
          // （ここで先にrecordUsage()すると、分析が失敗してもチケットが戻らない不具合になる）。
          adCreditRef.current = true  // 広告視聴済みクレジット付与（失敗時リトライも許可）
          setError(''); setResult(null); setRawText(''); setReportedWrongPerson(false)
          analyze(false, true)  // forceRefresh=true で必ず新規分析を実行。skipGate=falseでゲート内の成功判定に任せる
        }}
        onUpgrade={() => { setAdGateVisible(false); router.push('/paywall') }}
      />

      <TicketGateModal
        visible={ticketGateVisible}
        feature="video"
        ticketCost={ticketGateCost}
        ticketBalance={ticketGateBalance}
        onClose={() => setTicketGateVisible(false)}
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
                  <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>{t('videoAnalysis.native.upsellTitle')}</Text>
                </View>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 20 }}>
                  {t('videoAnalysis.native.upsellBody')}
                </Text>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 14, gap: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{t('videoAnalysis.native.upsellFreeLabel')}</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{t('videoAnalysis.native.upsellFreeDesc')}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ backgroundColor: '#166534', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{t('videoAnalysis.native.upsellNoAdsBadge')}</Text>
                      </View>
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{t('videoAnalysis.native.upsellPrice')}</Text>
                    </View>
                    <Text style={{ color: '#4ade80', fontSize: 12, fontWeight: '700' }}>{t('videoAnalysis.native.upsellNoAdsFull')}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={{ backgroundColor: '#166534', borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}
                  onPress={() => { setUpsellVisible(false); router.push('/paywall?plan=noad' as any) }}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{t('videoAnalysis.native.upsellCta')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 4 }} onPress={() => setUpsellVisible(false)} activeOpacity={0.7}>
                  <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>{t('videoAnalysis.native.upsellDismiss')}</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* ── 分析履歴一覧モーダル ── */}
      <Modal visible={historyModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setHistoryModal(false)}>
        <View style={{ flex: 1, backgroundColor: '#f5f5f7' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 }}>
            <Text style={{ color: '#111827', fontSize: 18, fontWeight: '900' }}>{t('videoAnalysis.native.historyTitle')}</Text>
            <TouchableOpacity onPress={() => setHistoryModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('videoAnalysis.native.closeLabel')}>
              <Ionicons name="close" size={24} color="#6b7280" />
            </TouchableOpacity>
          </View>
          {historyList.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
              <Text style={{ fontSize: 32, marginBottom: 8 }}>🎥</Text>
              <Text style={{ color: '#6b7280', fontSize: 14, textAlign: 'center' }}>{t('videoAnalysis.native.noHistoryTitle')}</Text>
            </View>
          ) : (
            <>
              {historyEvents.length > 1 && (
                <ScrollView
                  horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, gap: 8 }}
                >
                  {[null, ...historyEvents].map(ev => (
                    <TouchableOpacity
                      key={ev ?? '__all'}
                      onPress={() => setHistoryFilter(ev)}
                      activeOpacity={0.8}
                      style={{
                        paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
                        backgroundColor: historyFilter === ev ? BRAND : '#fff',
                        borderWidth: 1, borderColor: historyFilter === ev ? BRAND : '#e5e7eb',
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '700', color: historyFilter === ev ? '#fff' : '#374151' }}>
                        {ev ? (ev === '種目未指定' ? t('videoAnalysis.native.eventUnspecified') : getEventLabel(ev, language)) : t('videoAnalysis.native.allFilter')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 18 }} showsVerticalScrollIndicator={false}>
                {groupedHistory.map(group => (
                  <View key={group.event} style={{ gap: 10 }}>
                    {historyEvents.length > 1 && (
                      <Text style={{ color: '#9ca3af', fontSize: 12, fontWeight: '800', letterSpacing: 0.3 }}>
                        {group.event === '種目未指定' ? t('videoAnalysis.native.eventUnspecified') : getEventLabel(group.event, language)}{t('videoAnalysis.native.entriesCount', { n: group.entries.length })}
                      </Text>
                    )}
                    {group.entries.map((h, i) => {
                      const hColor = h.score >= 80 ? '#34C759' : h.score >= 60 ? '#FF9500' : '#FF3B30'
                      const prev = group.entries[i + 1]
                      const delta = prev ? h.score - prev.score : null
                      return (
                        <View
                          key={h.id}
                          style={{
                            backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', padding: 16, gap: 12,
                          }}
                        >
                          {/* ── ヘッダー行（サムネイル・種目・日付・スコア・削除） ── */}
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            {h.thumbBase64 ? (
                              <Image source={{ uri: `data:image/jpeg;base64,${h.thumbBase64}` }} style={{ width: 44, height: 44, borderRadius: 10 }} />
                            ) : (
                              <View style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: '#f0f2f5', alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name="videocam-outline" size={18} color="#9ca3af" />
                              </View>
                            )}
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: '#111827', fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{h.event === '種目未指定' ? t('videoAnalysis.native.eventUnspecified') : getEventLabel(h.event, language)}</Text>
                              <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                                {new Date(h.shot_date ? h.shot_date + 'T00:00:00' : h.created_at).toLocaleDateString(language === 'ja' ? 'ja-JP' : 'en-US', { month: 'short', day: 'numeric', weekday: 'short' })}
                              </Text>
                            </View>
                            <View style={{ alignItems: 'center' }}>
                              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hColor + '18', alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ color: hColor, fontSize: 13, fontWeight: '900' }}>{h.score}</Text>
                              </View>
                              {delta !== null && delta !== 0 && (
                                <Text style={{
                                  fontSize: 10, fontWeight: '800', marginTop: 2,
                                  color: delta > 0 ? '#34C759' : '#FF3B30',
                                }}>
                                  {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
                                </Text>
                              )}
                            </View>
                            <TouchableOpacity
                              onPress={() => deleteVideoAnalysisHistory(h.id).then(setHistoryList).catch(() => {})}
                              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                              accessibilityLabel={t('videoAnalysis.native.deleteHistory')}
                            >
                              <Ionicons name="trash-outline" size={16} color="#d1d5db" />
                            </TouchableOpacity>
                          </View>

                          <Text style={{ color: '#374151', fontSize: 13, lineHeight: 19, fontWeight: '700' }}>
                            {h.headline ?? h.overall ?? ''}
                          </Text>

                          {/* ── 分析結果本体（詳細モーダルと同じ内容をそのまま展開表示） ── */}
                          {h.dimensions && h.dimensions.length >= 3 ? (
                            <View style={{ gap: 12 }}>
                              <View style={{ alignItems: 'center' }}>
                                <RadarChart dimensions={h.dimensions} size={200} />
                              </View>
                              {h.strength?.title && (
                                <FeedbackCardView icon="⭐" label={t('videoAnalysis.native.todayStrength')} color="#16a34a" bg="#f0fdf4" card={h.strength} />
                              )}
                              {h.focus?.title && (
                                <FeedbackCardView icon="🔥" label={t('videoAnalysis.native.todayTheme')} color="#d97706" bg="#fffbeb" card={h.focus} />
                              )}
                              {h.nextStep?.title && (
                                <FeedbackCardView icon="🎯" label={t('videoAnalysis.native.nextStep')} color="#2563eb" bg="#eff6ff" card={h.nextStep} />
                              )}
                              {h.practice?.drill && (
                                <View style={{ backgroundColor: '#f0f2f5', borderRadius: 10, padding: 12 }}>
                                  <Text style={{ color: '#111827', fontSize: 13, fontWeight: '700' }}>{t('videoAnalysis.native.recommendedDrill', { name: h.practice.drill })}</Text>
                                  {h.practice.drillDetail && (
                                    <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>{h.practice.drillDetail}</Text>
                                  )}
                                </View>
                              )}
                            </View>
                          ) : (
                            <>
                              {/* 旧スキーマの履歴（互換表示） */}
                              {!!h.positives?.length && (
                                <View style={{ backgroundColor: '#f0fdf415', borderRadius: 16, borderWidth: 1, borderColor: '#16a34a30', padding: 14 }}>
                                  <Text style={{ color: '#16a34a', fontSize: 13, fontWeight: '800', marginBottom: 8 }}>{t('videoAnalysis.native.goodPoints')}</Text>
                                  {h.positives.map((p, pi) => (
                                    <Text key={pi} style={{ color: '#374151', fontSize: 13, lineHeight: 20 }}>・{p}</Text>
                                  ))}
                                </View>
                              )}
                              {!!h.improvements?.length && (
                                <View style={{ backgroundColor: '#fffbeb', borderRadius: 16, borderWidth: 1, borderColor: '#fde68a', padding: 14 }}>
                                  <Text style={{ color: '#d97706', fontSize: 13, fontWeight: '800', marginBottom: 8 }}>{t('videoAnalysis.native.improvements')}</Text>
                                  {h.improvements.map((p, pi) => (
                                    <Text key={pi} style={{ color: '#374151', fontSize: 13, lineHeight: 20 }}>・{p}</Text>
                                  ))}
                                </View>
                              )}
                              {!!h.menu?.length && (
                                <View>
                                  <Text style={{ color: '#6b7280', fontSize: 12, fontWeight: '700', marginBottom: 8 }}>{t('videoAnalysis.native.recommendedDrills')}</Text>
                                  {h.menu.map((mn, mi) => (
                                    <View key={mi} style={{ backgroundColor: '#f0f2f5', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                                      <Text style={{ color: '#111827', fontSize: 13, fontWeight: '700' }}>{mn.name}</Text>
                                      <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>{mn.detail}</Text>
                                    </View>
                                  ))}
                                </View>
                              )}
                            </>
                          )}
                        </View>
                      )
                    })}
                  </View>
                ))}
              </ScrollView>
            </>
          )}
        </View>
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
          <Text style={{ color: '#111827', fontSize: 32, fontWeight: '900' }}>¥480<Text style={{ fontSize: 14, fontWeight: '400' }}>/月</Text></Text>
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
  const { t } = useTranslation()
  const { language } = useLanguage()

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
  const [ticketGateVisible, setTicketGateVisible] = useState(false)
  const [ticketGateCost,    setTicketGateCost]    = useState(0)
  const [ticketGateBalance, setTicketGateBalance] = useState(0)
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
  const drawOverlay = useCallback((time: number) => {
    const cv  = canvasRef.current
    const vid = videoRef.current
    if (!cv || !vid || !vid.offsetWidth) return
    cv.width  = vid.offsetWidth
    cv.height = vid.offsetHeight
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, cv.width, cv.height)
    const near = annotationsRef.current.filter(a => Math.abs(a.timestamp - time) < 0.6)
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
    ctx.fillText(`🤖 ${t('videoAnalysis.web.analyzedBadge')}`, cv.width - 12, by + 16)
    ctx.textAlign = 'left'
  }, [t])

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
{"overall":"評価20字","positives":["良い点(部位)","良い点2"],"improvements":["要約1","要約2"],"improvementDetails":[{"issue":"問題(部位)","reason":"原因(根拠)","fix":"改善方法"}],"injuryRisk":"リスク30字(低ければ「リスク低」)"}${narrativeLanguageInstruction(language)}` }
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
}${narrativeLanguageInstruction(language)}` }]
        }),
      }, 65000)  // api/analyze.tsのmaxDuration=60秒に合わせて、45秒のクライアント側タイムアウトが
                 // サーバーより先に切れないようにする
      const data  = await res.json()
      const text  = data.content?.find((b: any) => b.type === 'text')?.text ?? '{}'
      const match = text.match(/\{[\s\S]*\}/)
      if (match) { try { setComprehensive(JSON.parse(match[0])) } catch {} }
    } catch (e) { console.warn('comprehensive fail', e) }
    finally { setLoadingComp(false) }
  }

  /* ── 分析コア（アドゲートチェック後に呼ぶ） ── */
  /* 戻り値: 1フレーム以上の分析に成功したか（失敗時はチケットを消費させないための判定に使う） */
  const startAnalysisCore = async (): Promise<boolean> => {
    const vid = videoRef.current
    if (!vid?.src) { Alert.alert(t('videoAnalysis.web.selectVideoAlert')); return false }
    if (!vid.duration)
      await new Promise<void>(r => vid.addEventListener('loadedmetadata', () => r(), { once: true }))
    setPhase('analyzing')
    const dur  = vid.duration
    const step = Math.max(dur / MAX_FRAMES, 0.5)
    const times: number[] = []
    for (let ts = step / 2; ts < dur; ts += step) times.push(parseFloat(ts.toFixed(2)))
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
    if (results.length === 0) {
      setPhase('player')
      Alert.alert(t('videoAnalysis.web.analysisFailedTitle'), t('videoAnalysis.web.analysisFailedMessage'))
      return false
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(results)).catch(() => {})
    vid.currentTime = 0
    setPhase('player')
    /* 総合評価を非同期で生成 */
    generateComprehensive(results)
    return true
  }

  /* ── 分析スタート（アドゲートチェック付き） ── */
  const startAnalysis = async () => {
    if (startingRef.current) return  // 二重タップ防止
    const vid = videoRef.current
    if (!vid?.src) { Alert.alert(t('videoAnalysis.web.selectVideoAlert')); return }
    startingRef.current = true
    try {
      const gate = await checkAdGate('video')
      if (!gate.allowed) {
        if (gate.needsTicket) {
          setTicketGateCost(gate.ticketCost); setTicketGateBalance(gate.ticketBalance); setTicketGateVisible(true)
        } else {
          setAdGateRemainingW(gate.remaining)
          setAdGateHardLimited(gate.hardLimited)
          setAdGateLimitTypeW(gate.limitType)
          setAdGateVisible(true)
        }
        return
      }
      const succeeded = await startAnalysisCore()
      if (succeeded) {
        await recordUsage('video')
        if (gate.needsTicket) Toast.show({ type: 'info', text1: t('videoAnalysis.web.ticketUsedToast', { n: gate.ticketCost }), visibilityTime: 1800 })
      }
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
          <Text style={s.uploadTitle}>{t('videoAnalysis.web.uploadTitle')}</Text>
          <Text style={s.uploadSub}>{t('videoAnalysis.web.uploadSub')}</Text>
          <View style={s.stepRow}>
            {[
              ['cloud-upload-outline', t('videoAnalysis.web.step1')],
              ['sparkles-outline',     t('videoAnalysis.web.step2')],
              ['eye-outline',          t('videoAnalysis.web.step3')],
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
            <Text style={s.uploadBtnText}>{videoName ? t('videoAnalysis.web.changeVideo') : t('videoAnalysis.web.chooseVideo')}</Text>
          </TouchableOpacity>

          {/* ── 種目選択 ── */}
          <View style={s.settingCard}>
            <Text style={s.settingTitle}>{t('videoAnalysis.web.eventSectionTitle')}</Text>
            <Text style={s.settingDesc}>{t('videoAnalysis.web.eventSectionDesc')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
              {['', '100m','200m','300m','400m','800m','1000m','1500m','3000m','110mH','100mH','300mH','400mH','走幅跳','三段跳','走高跳','棒高跳','砲丸投','やり投','円盤投'].map(ev => (
                <TouchableOpacity
                  key={ev || '指定なし'}
                  onPress={() => setSelectedEvent(ev)}
                  style={[s.evChip, selectedEvent === ev && s.evChipActive]}
                >
                  <Text style={[s.evChipText, selectedEvent === ev && { color: '#fff' }]}>
                    {ev ? getEventLabel(ev, language) : t('videoAnalysis.eventNone')}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* ── 複数人動画: 選手の服・靴の色 ── */}
          <View style={s.settingCard}>
            <Text style={s.settingTitle}>{t('videoAnalysis.web.athleteSectionTitle')}</Text>
            <Text style={s.settingDesc}>{t('videoAnalysis.web.athleteSectionDesc')}</Text>
            <TextInput
              value={athleteColor}
              onChangeText={setAthleteColor}
              placeholder={t('videoAnalysis.web.athletePlaceholder')}
              placeholderTextColor="#555"
              style={s.colorInput}
              multiline
            />
          </View>

          {videoName ? (
            <>
              <View style={s.ticketBadge}>
                <Text style={s.ticketBadgeText}>{t('videoAnalysis.web.ticketBadge', { n: TICKET_COST.video })}</Text>
              </View>
              <TouchableOpacity style={s.analyzeBtn} onPress={startAnalysis}>
                <Ionicons name="sparkles-outline" size={22} color="#fff" />
                <Text style={s.analyzeBtnText}>{t('videoAnalysis.web.startAnalysis')}</Text>
              </TouchableOpacity>
            </>
          ) : null}

          {/* ── AIモデル表示 ── */}
          <View style={isPremiumUser ? s.planBannerPro : s.planBannerFree}>
            {isPremiumUser ? (
              <>
                <Text style={s.planBannerIcon}>⚡</Text>
                <View>
                  <Text style={s.planBannerTitle}>{t('videoAnalysis.web.proModeTitle')}</Text>
                  <Text style={s.planBannerSub}>{t('videoAnalysis.web.proModeSub')}</Text>
                </View>
              </>
            ) : (
              <>
                <Text style={s.planBannerIcon}>🤖</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.planBannerTitle}>{t('videoAnalysis.web.freeModeTitle')}</Text>
                  <Text style={s.planBannerSub}>
                    <Text style={{ color: '#FFD700', fontWeight: '700' }}>{t('videoAnalysis.web.freeModePremiumLabel')}</Text>
                    {t('videoAnalysis.web.freeModeSub')}
                  </Text>
                </View>
              </>
            )}
          </View>

          <Text style={s.privacyNote}>
            {t('videoAnalysis.web.privacyNote')}
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
            const succeeded = await startAnalysisCore()
            if (succeeded) await recordUsage('video')
          }}
          onUpgrade={() => {
            setAdGateVisible(false)
            router.push('/paywall')
          }}
        />

        <TicketGateModal
          visible={ticketGateVisible}
          feature="video"
          ticketCost={ticketGateCost}
          ticketBalance={ticketGateBalance}
          onClose={() => setTicketGateVisible(false)}
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
          <Text style={s.analyzeTitle}>{t('videoAnalysis.web.analyzingTitle')}</Text>
          <Text style={s.analyzeCount}>{progress.done} / {progress.total}</Text>
          <View style={s.barTrack}>
            <View style={[s.barFill, { width: `${pct}%` as any }]} />
          </View>
          <Text style={s.analyzeSub}>
            {progress.done === 0 ? t('videoAnalysis.web.extractingKeyframes') : t('videoAnalysis.web.analyzedFrame', { n: progress.done })}
          </Text>
          <Text style={s.analyzeNote}>{t('videoAnalysis.web.dontClose')}</Text>
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
          <TouchableOpacity style={s.iconBtn} onPress={() => stepFrame(-1)} accessibilityLabel={t('videoAnalysis.web.prevFrame')}>
            <Ionicons name="play-skip-back" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={s.playBtn} onPress={togglePlay} accessibilityLabel={isPlaying ? t('videoAnalysis.web.pause') : t('videoAnalysis.web.play')}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={28} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={() => stepFrame(1)} accessibilityLabel={t('videoAnalysis.web.nextFrame')}>
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
            <Text style={s.adviceTime}>{t('videoAnalysis.web.frameAnalysisAt', { time: formatTime(activeAnn.timestamp) })}</Text>
            <Text style={s.adviceOverall}>{activeAnn.advice.overall}</Text>
            {activeAnn.advice.positives.length > 0 && <>
              <Text style={s.sectionLabel}>{t('videoAnalysis.web.goodPoints')}</Text>
              {activeAnn.advice.positives.map((p, i) => <Text key={i} style={s.adviceItem}>• {p}</Text>)}
            </>}
            {activeAnn.advice.improvementDetails && activeAnn.advice.improvementDetails.length > 0 ? (
              <>
                <Text style={s.sectionLabel}>{t('videoAnalysis.web.improvementsWithReason')}</Text>
                {activeAnn.advice.improvementDetails.map((d, i) => (
                  <View key={i} style={{ backgroundColor: '#fff7ed', borderRadius: 8, padding: 8, marginBottom: 6, borderLeftWidth: 3, borderLeftColor: '#f97316' }}>
                    <Text style={{ color: '#9a3412', fontSize: 12, fontWeight: '800', marginBottom: 4 }}>⚠️ {d.issue}</Text>
                    <Text style={{ color: '#92400e', fontSize: 11, marginBottom: 3 }}>{t('videoAnalysis.web.why', { reason: d.reason })}</Text>
                    <Text style={{ color: '#166534', fontSize: 11 }}>{t('videoAnalysis.web.fix', { fix: d.fix })}</Text>
                  </View>
                ))}
              </>
            ) : activeAnn.advice.improvements.length > 0 ? (
              <>
                <Text style={s.sectionLabel}>{t('videoAnalysis.web.improvements')}</Text>
                {activeAnn.advice.improvements.map((p, i) => <Text key={i} style={s.adviceItem}>• {p}</Text>)}
              </>
            ) : null}
            {activeAnn.advice.injuryRisk && activeAnn.advice.injuryRisk !== 'リスク低' && (
              <View style={{ marginTop: 8, backgroundColor: '#FFF1F2', borderRadius: 8, padding: 8, borderLeftWidth: 3, borderLeftColor: '#F43F5E' }}>
                <Text style={{ color: '#BE123C', fontSize: 11, fontWeight: '700', marginBottom: 2 }}>{t('videoAnalysis.web.injuryRisk')}</Text>
                <Text style={{ color: '#9F1239', fontSize: 12 }}>{activeAnn.advice.injuryRisk}</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={s.noAdviceCard}>
            <Text style={s.noAdviceTxt}>{t('videoAnalysis.web.noAdviceYet')}</Text>
          </View>
        )}

        {/* ── サムネイル一覧 ── */}
        <Text style={s.sectionTitle}>{t('videoAnalysis.web.analyzedFrames', { n: annotations.length })}</Text>
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
        <Text style={s.bigSectionTitle}>{t('videoAnalysis.web.comprehensiveTitle')}</Text>

        {loadingComp ? (
          <View style={s.compLoading}>
            <ActivityIndicator size="small" color="#166534" />
            <Text style={s.compLoadingTxt}>{t('videoAnalysis.web.generatingComprehensive')}</Text>
          </View>
        ) : comprehensive ? (
          <>
            {/* 総合サマリー */}
            <View style={s.compCard}>
              <View style={s.compCardHeader}>
                <Ionicons name="analytics-outline" size={18} color="#166534" />
                <Text style={s.compCardTitle}>{t('videoAnalysis.web.overallEvaluation')}</Text>
              </View>
              <Text style={s.compSummary}>{comprehensive.summary}</Text>
              {comprehensive.keyFindings.length > 0 && <>
                <Text style={s.sectionLabel}>{t('videoAnalysis.web.keyFindingsLabel')}</Text>
                {comprehensive.keyFindings.map((f, i) => (
                  <View key={i} style={s.findingRow}>
                    <View style={s.findingDot} />
                    <Text style={s.findingTxt}>{f}</Text>
                  </View>
                ))}
              </>}
              {comprehensive.injuryWarnings && comprehensive.injuryWarnings.length > 0 && (
                <View style={{ marginTop: 10, backgroundColor: '#FFF1F2', borderRadius: 10, padding: 10, borderLeftWidth: 3, borderLeftColor: '#F43F5E' }}>
                  <Text style={{ color: '#BE123C', fontSize: 12, fontWeight: '800', marginBottom: 6 }}>{t('videoAnalysis.web.injuryRiskTrend')}</Text>
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
                <Text style={s.compCardTitle}>{t('videoAnalysis.web.recommendedMenu')}</Text>
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
                <Text style={s.compCardTitle}>{t('videoAnalysis.web.nextPracticeFocus')}</Text>
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
            <Text style={s.compLoadingTxt}>{t('videoAnalysis.web.waitingForComplete')}</Text>
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
          <Text style={s.reanalyzeTxt}>{t('videoAnalysis.web.analyzeAnotherVideo')}</Text>
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
  ticketBadge:    { flexDirection: 'row', alignItems: 'center', marginBottom: 10,
                    backgroundColor: 'rgba(245,158,11,0.14)', borderRadius: 8,
                    borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)',
                    paddingHorizontal: 10, paddingVertical: 4 },
  ticketBadgeText:{ fontSize: 11, fontWeight: '700', color: '#f59e0b' },
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

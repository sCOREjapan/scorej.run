import React, { useRef, useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  StyleSheet, Platform, Alert, ActivityIndicator, Image,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { BRAND, TEXT } from '../lib/theme'
import { checkAdGate, recordUsage, grantRewardUse } from '../lib/adGate'
import { isPremium } from '../lib/subscription'
import AdGateModal from '../components/AdGateModal'
import * as ImagePicker from 'expo-image-picker'
import * as VideoThumbnails from 'expo-video-thumbnails'
import * as ImageManipulator from 'expo-image-manipulator'
import * as FileSystem from 'expo-file-system'

/* ─── 型定義 ─────────────────────────────────── */
type FrameAdvice = {
  overall: string
  positives: string[]
  improvements: string[]
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
  trainingMenu: { name: string; detail: string }[]
  nextSteps: string[]
}

const STORAGE_KEY = 'trackmate_video_annotations'
const MAX_FRAMES  = 8
const THUMB_W     = 320

/* ─── ネイティブ動画分析（iOS/Android）──────────────── */
function NativeVideoAnalysis() {
  const [phase, setPhase]         = useState<'select'|'analyzing'|'result'>('select')
  const [videoUri, setVideoUri]   = useState<string | null>(null)
  const [frames, setFrames]       = useState<string[]>([])
  const [event, setEvent]         = useState('')
  const [result, setResult]       = useState<string>('')
  const [error, setError]         = useState<string>('')

  async function pickVideo() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) { Alert.alert('権限が必要です', '写真ライブラリへのアクセスを許可してください'); return }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 1,
      })
      if (!res.canceled && res.assets[0]) {
        setVideoUri(res.assets[0].uri)
        setPhase('select')
        setResult('')
        setError('')
      }
    } catch (e: any) {
      Alert.alert('エラー', e?.message ?? '動画の選択に失敗しました')
    }
  }

  async function analyze() {
    if (!videoUri) { Alert.alert('動画を選択してください'); return }
    setPhase('analyzing')
    setError('')
    try {
      // iOS の ph:// URI はローカルにコピーしてから処理
      let localUri = videoUri
      if (videoUri.startsWith('ph://') || !videoUri.startsWith('file://')) {
        const ext = 'mp4'
        const dest = FileSystem.cacheDirectory + `score_video_${Date.now()}.${ext}`
        await FileSystem.copyAsync({ from: videoUri, to: dest })
        localUri = dest
      }

      // フレームを複数タイミングで取得（100msから開始、0msは失敗しやすい）
      const timestamps = [100, 1000, 2500, 4000, 6000, 8000, 10000, 13000]
      const base64Frames: string[] = []
      const thumbUris: string[] = []

      for (const t of timestamps) {
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(localUri, { time: t, quality: 0.8 })
          const resized = await ImageManipulator.manipulateAsync(
            uri, [{ resize: { width: 480 } }],
            { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
          )
          const b64 = await FileSystem.readAsStringAsync(resized.uri, { encoding: FileSystem.EncodingType.Base64 })
          base64Frames.push(b64)
          thumbUris.push(resized.uri)
        } catch { /* そのタイムスタンプをスキップ */ }
      }

      // 1フレームも取れなかった場合、最初の1フレームだけ確実に取得を試みる
      if (base64Frames.length === 0) {
        const { uri } = await VideoThumbnails.getThumbnailAsync(localUri, { time: 0 })
        const resized = await ImageManipulator.manipulateAsync(
          uri, [{ resize: { width: 480 } }],
          { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
        )
        const b64 = await FileSystem.readAsStringAsync(resized.uri, { encoding: FileSystem.EncodingType.Base64 })
        base64Frames.push(b64)
        thumbUris.push(resized.uri)
      }

      if (base64Frames.length === 0) throw new Error('フレームの取得に失敗しました')
      setFrames(thumbUris)

      // Claude API に送信
      const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('APIキーが未設定です')

      const imageBlocks = base64Frames.slice(0, 5).map(b64 => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: b64 }
      }))

      const prompt = `あなたは陸上競技の専門コーチです。${event ? `種目：${event}` : ''}の選手のフォームを分析してください。

複数のフレーム画像を提供します。以下の観点で詳細に分析し、日本語で回答してください：

1. **全体評価**（100点満点でスコアと総評）
2. **良い点**（3つ以上）
3. **改善点**（3つ以上、具体的に）
4. **練習メニュー提案**（2〜3種目、各30文字以内）

必ずJSON形式で返答してください：
{"score":85,"overall":"総評","positives":["良い点1","良い点2","良い点3"],"improvements":["改善点1","改善点2","改善点3"],"menu":[{"name":"練習名","detail":"詳細"}]}`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-5',
          max_tokens: 1500,
          messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }],
        }),
      })

      if (!res.ok) throw new Error(`API エラー: ${res.status}`)
      const json = await res.json()
      const text = json?.content?.[0]?.text ?? ''
      setResult(text)
      setPhase('result')
    } catch (e: any) {
      setError(e?.message ?? '分析に失敗しました')
      setPhase('select')
    }
  }

  // JSONパース試行
  let parsed: any = null
  try { const m = result.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]) } catch {}

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#0a0a0a' }} contentContainerStyle={{ padding: 20 }}>
      <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 4 }}>フォーム動画分析</Text>
      <Text style={{ color: '#888', fontSize: 13, marginBottom: 24 }}>AIがあなたのフォームを詳細に分析します</Text>

      {/* 種目入力 */}
      <TextInput
        style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: '#fff', borderRadius: 12, padding: 14, marginBottom: 16, fontSize: 15 }}
        placeholder="種目を入力（例：100m、走り幅跳び）"
        placeholderTextColor="#666"
        value={event}
        onChangeText={setEvent}
      />

      {/* 動画選択ボタン */}
      <TouchableOpacity
        onPress={pickVideo}
        style={{ backgroundColor: videoUri ? 'rgba(229,57,53,0.15)' : 'rgba(255,255,255,0.08)', borderRadius: 14, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: videoUri ? '#E53935' : 'rgba(255,255,255,0.1)', marginBottom: 16 }}
      >
        <Ionicons name={videoUri ? 'checkmark-circle' : 'cloud-upload-outline'} size={36} color={videoUri ? '#E53935' : '#888'} />
        <Text style={{ color: videoUri ? '#E53935' : '#888', fontSize: 14, marginTop: 8, fontWeight: '600' }}>
          {videoUri ? '動画選択済み ✓（タップして変更）' : '動画を選択'}
        </Text>
      </TouchableOpacity>

      {/* サムネイル一覧 */}
      {frames.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {frames.map((uri, i) => (
            <Image key={i} source={{ uri }} style={{ width: 70, height: 50, borderRadius: 8, backgroundColor: '#222' }} />
          ))}
        </View>
      )}

      {error ? <Text style={{ color: '#f87171', marginBottom: 12, fontSize: 13 }}>{error}</Text> : null}

      {/* 分析ボタン */}
      {phase === 'analyzing' ? (
        <View style={{ alignItems: 'center', padding: 24 }}>
          <ActivityIndicator color="#E53935" size="large" />
          <Text style={{ color: '#888', marginTop: 12, fontSize: 14 }}>AIがフォームを分析中...</Text>
        </View>
      ) : (
        <TouchableOpacity
          onPress={analyze}
          disabled={!videoUri}
          style={{ backgroundColor: videoUri ? '#E53935' : '#333', borderRadius: 14, padding: 18, alignItems: 'center', marginBottom: 24 }}
        >
          <Text style={{ color: videoUri ? '#fff' : '#666', fontSize: 16, fontWeight: '800' }}>
            {phase === 'result' ? '再分析する' : 'AIで分析する'}
          </Text>
        </TouchableOpacity>
      )}

      {/* 結果表示 */}
      {parsed && (
        <View style={{ gap: 14 }}>
          {/* スコア */}
          <View style={{ backgroundColor: 'rgba(229,57,53,0.12)', borderRadius: 16, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(229,57,53,0.3)' }}>
            <Text style={{ color: '#E53935', fontSize: 48, fontWeight: '900' }}>{parsed.score}</Text>
            <Text style={{ color: '#E53935', fontSize: 13 }}>/ 100点</Text>
            <Text style={{ color: '#ccc', fontSize: 14, marginTop: 8, textAlign: 'center', lineHeight: 22 }}>{parsed.overall}</Text>
          </View>

          {/* 良い点 */}
          <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 16 }}>
            <Text style={{ color: '#4ade80', fontSize: 14, fontWeight: '700', marginBottom: 10 }}>✅ 良い点</Text>
            {(parsed.positives ?? []).map((p: string, i: number) => (
              <Text key={i} style={{ color: '#ccc', fontSize: 13, lineHeight: 22, paddingLeft: 8 }}>・{p}</Text>
            ))}
          </View>

          {/* 改善点 */}
          <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 16 }}>
            <Text style={{ color: '#fbbf24', fontSize: 14, fontWeight: '700', marginBottom: 10 }}>⚠️ 改善点</Text>
            {(parsed.improvements ?? []).map((p: string, i: number) => (
              <Text key={i} style={{ color: '#ccc', fontSize: 13, lineHeight: 22, paddingLeft: 8 }}>・{p}</Text>
            ))}
          </View>

          {/* 練習メニュー */}
          {parsed.menu && parsed.menu.length > 0 && (
            <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 16 }}>
              <Text style={{ color: '#60a5fa', fontSize: 14, fontWeight: '700', marginBottom: 10 }}>🏃 練習メニュー提案</Text>
              {parsed.menu.map((m: any, i: number) => (
                <View key={i} style={{ marginBottom: 8 }}>
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{m.name}</Text>
                  <Text style={{ color: '#999', fontSize: 12, lineHeight: 18 }}>{m.detail}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* JSON未パースの場合はテキスト表示 */}
      {result && !parsed && (
        <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 16 }}>
          <Text style={{ color: '#ccc', fontSize: 13, lineHeight: 22 }}>{result}</Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  )
}

/* ─── メイン ──────────────────────────────────── */
export default function VideoAnalysis() {
  const [premiumChecked, setPremiumChecked] = useState(false)
  const [isPremiumUser, setIsPremiumUser]   = useState(false)

  useEffect(() => {
    isPremium().then(v => { setIsPremiumUser(v); setPremiumChecked(true) }).catch(() => setPremiumChecked(true))
  }, [])

  if (!premiumChecked) return (
    <View style={s.center}><ActivityIndicator color="#166534" /></View>
  )

  if (Platform.OS !== 'web') {
    return <NativeVideoAnalysis />
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
  /* ── refs ── */
  const videoRef      = useRef<HTMLVideoElement | null>(null)
  const canvasRef     = useRef<HTMLCanvasElement | null>(null)
  const fileRef       = useRef<HTMLInputElement | null>(null)
  const playerDivRef  = useRef<HTMLDivElement | null>(null)  // 実際の表示コンテナ

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
  const [adGateHardLimited, setAdGateHardLimited] = useState(false)
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
        resolve(tmp.toDataURL('image/jpeg', 0.65))
      }
      vid.addEventListener('seeked', onSeeked)
    })

  /* ── Claude Vision: フレーム分析 ── */
  const analyzeFrame = async (dataUrl: string, t: number): Promise<FrameAdvice> => {
    const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('APIキー未設定')
    const model = isPremiumUser ? 'claude-opus-4-5' : 'claude-haiku-3-5'
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model, max_tokens: 512,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: dataUrl.split(',')[1] } },
          { type: 'text', text: `陸上競技バイオメカニクスコーチとして${formatTime(t)}地点のフォームを分析。${selectedEvent ? `\n種目: ${selectedEvent}` : ''}${athleteColor ? `\n分析対象選手: ${athleteColor}の服装・シューズの選手に集中して分析してください。` : ''}
JSON形式のみで回答:
{"overall":"評価(20字以内)","positives":["良い点1","良い点2"],"improvements":["改善点1(部位明記)","改善点2"]}` }
        ]}]
      })
    })
    const data = await res.json()
    const text  = data.content?.[0]?.text ?? '{}'
    const match = text.match(/\{[\s\S]*\}/)
    try { return match ? JSON.parse(match[0]) : { overall: text.slice(0, 30), positives: [], improvements: [] } }
    catch { return { overall: text.slice(0, 30), positives: [], improvements: [] } }
  }

  /* ── Claude: 総合評価 + メニュー作成 ── */
  const generateComprehensive = async (anns: Annotation[]) => {
    const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY
    if (!apiKey || anns.length === 0) return
    setLoadingComp(true)
    try {
      const summary = anns.map((a, i) =>
        `フレーム${i+1}(${formatTime(a.timestamp)}): ${a.advice.overall} | 改善: ${a.advice.improvements.join(' / ')}`
      ).join('\n')
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: isPremiumUser ? 'claude-opus-4-5' : 'claude-haiku-3-5', max_tokens: 1024,
          messages: [{ role: 'user', content: `陸上競技コーチとして以下のフレーム分析結果を元に総合評価とトレーニングメニューを作成してください。${selectedEvent ? `\n種目: ${selectedEvent}に特化したアドバイスをしてください。` : ''}

【フレーム分析結果】
${summary}

以下のJSON形式のみで回答:
{
  "summary": "総合評価（3〜4文）",
  "keyFindings": ["全体を通して見られた特徴1", "特徴2", "特徴3"],
  "trainingMenu": [
    {"name": "ドリル名", "detail": "具体的な方法・セット数"},
    {"name": "ドリル名2", "detail": "内容"},
    {"name": "ドリル名3", "detail": "内容"},
    {"name": "ドリル名4", "detail": "内容"}
  ],
  "nextSteps": ["次の練習で意識すること1", "意識すること2", "意識すること3"]
}` }]
        })
      })
      const data  = await res.json()
      const text  = data.content?.[0]?.text ?? '{}'
      const match = text.match(/\{[\s\S]*\}/)
      if (match) setComprehensive(JSON.parse(match[0]))
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
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(results))
    vid.currentTime = 0
    setPhase('player')
    /* 総合評価を非同期で生成 */
    generateComprehensive(results)
  }

  /* ── 分析スタート（アドゲートチェック付き） ── */
  const startAnalysis = async () => {
    const vid = videoRef.current
    if (!vid?.src) { Alert.alert('動画を選択してください'); return }
    const gate = await checkAdGate('video')
    if (gate.hardLimited || gate.needsAd) {
      setAdGateHardLimited(gate.hardLimited)
      setAdGateVisible(true)
      return
    }
    await recordUsage('video')
    await startAnalysisCore()
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
          adCount={2}
          hardLimited={adGateHardLimited}
          onClose={() => setAdGateVisible(false)}
          onAdWatched={async () => {
            setAdGateVisible(false)
            await grantRewardUse('video')
            await recordUsage('video')
            await startAnalysisCore()
          }}
          onUpgrade={() => {
            setAdGateVisible(false)
            // TODO: プレミアム画面へのナビゲーションを追加
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
            {activeAnn.advice.improvements.length > 0 && <>
              <Text style={s.sectionLabel}>⚠️ 改善点</Text>
              {activeAnn.advice.improvements.map((p, i) => <Text key={i} style={s.adviceItem}>• {p}</Text>)}
            </>}
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
                    paddingVertical: 14, borderRadius: 12, marginBottom: 12 },
  uploadBtnText:  { color: '#111827', fontSize: 16, fontWeight: '700' },
  analyzeBtn:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: BRAND,
                    paddingHorizontal: 36, paddingVertical: 18, borderRadius: 16, marginBottom: 20 },
  analyzeBtnText: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  privacyNote:    { color: '#333', fontSize: 11, textAlign: 'center', lineHeight: 18 },

  /* setting cards before analysis */
  settingCard:    { width: '100%', maxWidth: 340, backgroundColor: '#ffffff', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  settingTitle:   { color: '#111827', fontSize: 13, fontWeight: '800', marginBottom: 2 },
  settingDesc:    { color: '#666', fontSize: 11, lineHeight: 16 },
  evChip:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#f0f2f5', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  evChipActive:   { backgroundColor: BRAND, borderColor: BRAND },
  evChipText:     { color: '#aaa', fontSize: 12, fontWeight: '700' },
  colorInput:     { marginTop: 10, backgroundColor: '#f0f2f5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#111827', fontSize: 13, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', minHeight: 50 },
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
  analyzeCount:   { color: '#166534', fontSize: 28, fontWeight: '800', marginTop: 8 },
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

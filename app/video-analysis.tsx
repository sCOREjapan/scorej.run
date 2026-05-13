import React, { useRef, useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  StyleSheet, Platform, Alert, ActivityIndicator, Image,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { BRAND, TEXT } from '../lib/theme'
import { checkAdGate, recordUsage, consumeRewardUse } from '../lib/adGate'
import AdGateModal from '../components/AdGateModal'
import { useAuth } from '../context/AuthContext'
import { useRouter } from 'expo-router'
import { trackFeatureUse } from '../lib/analytics'
import * as ImagePicker from 'expo-image-picker'
import * as VideoThumbnails from 'expo-video-thumbnails'
import * as ImageManipulator from 'expo-image-manipulator'
import * as FileSystem from 'expo-file-system/legacy'

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
type AnalysisPhase = 'idle' | 'extracting' | 'analyzing' | 'result'

type AnalysisResult = {
  score: number
  overall: string
  positives: string[]
  improvements: string[]
  menu: { name: string; detail: string }[]
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
              <Text style={{ flex: 1, color: '#e2e8f0', fontSize: 13, lineHeight: 20 }}>{item}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function NativeVideoAnalysis() {
  const [phase, setPhase]             = useState<AnalysisPhase>('idle')
  const [videoUri, setVideoUri]       = useState<string | null>(null)
  const [frames, setFrames]           = useState<string[]>([])
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
  const [adGateRewardUses,  setAdGateRewardUses]  = useState(0)
  const [remaining,         setRemaining]         = useState<number | null>(null)
  const { isGuest } = useAuth()
  const router = useRouter()

  React.useEffect(() => {
    checkAdGate('video').then(g => {
      if (g.remaining < 999) setRemaining(g.remaining)
    }).catch(() => {})
  }, [])

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
        setResult(null); setRawText(''); setError(''); setFrames([])
        setPhase('idle')
      }
    } catch (e: any) { Alert.alert('エラー', e?.message ?? '動画の選択に失敗しました') }
  }

  async function analyze() {
    if (!videoUri) { Alert.alert('動画を選択してください'); return }
    // ゲストはログイン必須
    if (isGuest) { setAdGateRemaining(0); setAdGateHardLimited(false); setAdGateVisible(true); return }
    // AdGateチェック
    const gate = await checkAdGate('video')
    if (!gate.allowed) { setAdGateRemaining(0); setAdGateRewardUses(gate.rewardUses); setAdGateHardLimited(gate.hardLimited); setAdGateVisible(true); return }
    if (gate.remaining === 0 && gate.rewardUses > 0) {
      await consumeRewardUse('video')
    } else if (gate.remaining === 1) {
      setAdGateRemaining(1); setAdGateVisible(true); return
    } else {
      await recordUsage('video')
    }
    trackFeatureUse('video')
    checkAdGate('video').then(g => { if (g.remaining < 999) setRemaining(g.remaining) }).catch(() => {})
    setError(''); setResult(null); setRawText('')

    try {
      // ── Step 1: フレーム抽出 ──
      setPhase('extracting')
      setStepLabel('動画からフレームを抽出中...')

      let localUri = videoUri
      if (videoUri.startsWith('ph://') || !videoUri.startsWith('file://')) {
        const dest = (FileSystem as any).cacheDirectory + `score_video_${Date.now()}.mp4`
        await FileSystem.copyAsync({ from: videoUri, to: dest })
        localUri = dest
      }

      const timestamps = [100, 1000, 2500, 4000, 6000, 8000, 10000, 13000]
      const base64Frames: string[] = []
      const thumbUris: string[] = []

      for (const t of timestamps) {
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(localUri, { time: t, quality: 0.75 })
          const resized = await ImageManipulator.manipulateAsync(
            uri, [{ resize: { width: 400 } }],
            { compress: 0.70, format: ImageManipulator.SaveFormat.JPEG }
          )
          const b64 = await FileSystem.readAsStringAsync(resized.uri, { encoding: 'base64' as any })
          base64Frames.push(b64)
          thumbUris.push(resized.uri)
        } catch { /* スキップ */ }
      }

      // フォールバック: 最初の1フレーム
      if (base64Frames.length === 0) {
        const { uri } = await VideoThumbnails.getThumbnailAsync(localUri, { time: 0 })
        const resized = await ImageManipulator.manipulateAsync(
          uri, [{ resize: { width: 400 } }],
          { compress: 0.70, format: ImageManipulator.SaveFormat.JPEG }
        )
        const b64 = await FileSystem.readAsStringAsync(resized.uri, { encoding: 'base64' as any })
        base64Frames.push(b64); thumbUris.push(resized.uri)
      }

      if (base64Frames.length === 0) throw new Error('フレームの取得に失敗しました')
      setFrames(thumbUris)

      // ── Step 2: AI分析 ──
      setPhase('analyzing')
      setStepLabel(`${base64Frames.length}フレームをAIで分析中...`)

      // API送信は最大6フレームに制限（コスト削減）
      const imageBlocks = base64Frames.slice(0, 6).map(b64 => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: b64 },
      }))

      // 人物特定情報をプロンプトに組み込む
      const personHint = [
        clothingColor ? `服の色：${clothingColor}` : '',
        shoeColor     ? `靴の色：${shoeColor}` : '',
      ].filter(Boolean).join('、')

      const prompt = `あなたは陸上競技の専門コーチです。${event ? `種目：${event}。` : ''}${personHint ? `分析対象の選手は${personHint}の人物です。複数人映っている場合はその選手に集中して分析してください。` : ''}選手のフォーム動画から抽出した複数フレームを分析してください。

必ずJSON形式のみで返答してください：
{"score":整数,"overall":"50文字以内の総評","positives":["良い点1","良い点2","良い点3"],"improvements":["改善点1","改善点2","改善点3"],"menu":[{"name":"練習名","detail":"詳細30文字以内"}]}`

      // Vercel proxy経由でAnthropicを呼び出し（APIキーをクライアントに持たせない）
      const apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '')
      const endpoint = apiBase ? `${apiBase}/api/analyze` : '/api/analyze'

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }],
        }),
      })

      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        throw new Error(`APIエラー (${res.status}): ${errBody.slice(0, 120)}`)
      }
      const json = await res.json()
      const text = json?.content?.[0]?.text ?? ''
      setRawText(text)

      // JSONパース（複数の方法で試みる）
      let parsed: AnalysisResult | null = null
      // 方法1: コードブロック内のJSON
      const codeMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
      // 方法2: 生のJSON
      const rawMatch = text.match(/\{[\s\S]*\}/)
      const jsonStr = codeMatch?.[1] ?? rawMatch?.[0] ?? null
      if (jsonStr) {
        try {
          const p = JSON.parse(jsonStr) as any
          parsed = {
            score: typeof p.score === 'number' ? p.score : 60,
            overall: p.overall ?? text.slice(0, 50),
            positives: Array.isArray(p.positives) ? p.positives : [],
            improvements: Array.isArray(p.improvements) ? p.improvements : [],
            menu: Array.isArray(p.menu) ? p.menu : [],
          }
        } catch { parsed = null }
      }
      // 方法3: JSONが取れなければテキストから最低限の結果を生成
      if (!parsed && text.trim().length > 0) {
        parsed = {
          score: 60,
          overall: text.split('\n').find((l: string) => l.trim().length > 5)?.slice(0, 80) ?? '分析完了',
          positives: [],
          improvements: [],
          menu: [],
        }
      }
      setResult(parsed)
      setPhase('result')
    } catch (e: any) {
      setError(e?.message ?? '分析に失敗しました')
      setPhase('idle')
    }
  }

  const scoreColor = result
    ? result.score >= 80 ? '#34C759' : result.score >= 60 ? '#FF9500' : '#FF3B30'
    : '#166534'

  return (
    <View style={{ flex: 1, backgroundColor: '#0f0f14' }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ヘッダー */}
        <View style={{ marginBottom: 20 }}>
          <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 }}>フォーム分析</Text>
          <Text style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>AIが{MAX_FRAMES}フレームを同時解析・最速診断</Text>
        </View>

        {/* 種目入力 */}
        <View style={{ marginBottom: 14 }}>
          <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700', marginBottom: 6, letterSpacing: 0.8 }}>種目（任意）</Text>
          <TextInput
            style={{ backgroundColor: 'rgba(255,255,255,0.07)', color: '#fff', borderRadius: 12,
              padding: 14, fontSize: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' }}
            placeholder="例：100m、走り幅跳び"
            placeholderTextColor="#4b5563"
            value={event}
            onChangeText={setEvent}
          />
        </View>

        {/* 分析対象の人物特定（複数人対応） */}
        <View style={{ marginBottom: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14,
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 14 }}>
          <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700', marginBottom: 10, letterSpacing: 0.8 }}>
            👤 分析対象の特定（複数人映っている場合）
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#64748b', fontSize: 10, fontWeight: '600', marginBottom: 5 }}>服の色</Text>
              <TextInput
                style={{ backgroundColor: 'rgba(255,255,255,0.07)', color: '#fff', borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' }}
                placeholder="例：赤、白など"
                placeholderTextColor="#374151"
                value={clothingColor}
                onChangeText={setClothingColor}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#64748b', fontSize: 10, fontWeight: '600', marginBottom: 5 }}>靴の色</Text>
              <TextInput
                style={{ backgroundColor: 'rgba(255,255,255,0.07)', color: '#fff', borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' }}
                placeholder="例：黒、黄など"
                placeholderTextColor="#374151"
                value={shoeColor}
                onChangeText={setShoeColor}
              />
            </View>
          </View>
          {(clothingColor || shoeColor) ? (
            <Text style={{ color: '#4ADE80', fontSize: 11, marginTop: 8 }}>
              ✓ {[clothingColor && `服：${clothingColor}`, shoeColor && `靴：${shoeColor}`].filter(Boolean).join('　')}の選手を分析対象にします
            </Text>
          ) : (
            <Text style={{ color: '#374151', fontSize: 11, marginTop: 6 }}>入力すると複数人の動画でも正確に分析できます</Text>
          )}
        </View>

        {/* 動画選択 */}
        <TouchableOpacity
          onPress={pickVideo}
          activeOpacity={0.8}
          style={{
            borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 14,
            backgroundColor: videoUri ? 'rgba(22,101,52,0.18)' : 'rgba(255,255,255,0.04)',
            borderWidth: 2,
            borderColor: videoUri ? '#166534' : 'rgba(255,255,255,0.10)',
            borderStyle: videoUri ? 'solid' : 'dashed' as any,
          }}
        >
          <Ionicons
            name={videoUri ? 'film' : 'cloud-upload-outline'}
            size={40}
            color={videoUri ? '#34C759' : '#4b5563'}
          />
          <Text style={{ color: videoUri ? '#34C759' : '#6b7280', fontSize: 14, marginTop: 10, fontWeight: '700' }}>
            {videoUri ? '動画選択済み ✓  （タップして変更）' : '動画をタップして選択'}
          </Text>
          {!videoUri && (
            <Text style={{ color: '#374151', fontSize: 12, marginTop: 4 }}>MP4 / MOV 対応</Text>
          )}
        </TouchableOpacity>

        {/* 抽出フレームサムネイル */}
        {frames.length > 0 && (
          <View style={{ marginBottom: 14 }}>
            <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700', marginBottom: 8, letterSpacing: 0.8 }}>
              抽出フレーム ({frames.length}枚)
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {frames.map((uri, i) => (
                <View key={i} style={{ position: 'relative' }}>
                  <Image
                    source={{ uri }}
                    style={{ width: 80, height: 56, borderRadius: 10, backgroundColor: '#1e293b' }}
                  />
                  <View style={{ position: 'absolute', bottom: 3, right: 3,
                    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>{i + 1}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* エラー */}
        {error ? (
          <View style={{ backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 12, padding: 12,
            borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', marginBottom: 14 }}>
            <Text style={{ color: '#f87171', fontSize: 13 }}>⚠️ {error}</Text>
          </View>
        ) : null}

        {/* 分析ボタン / ローディング */}
        {phase === 'extracting' || phase === 'analyzing' ? (
          <View style={{ alignItems: 'center', paddingVertical: 30, gap: 12 }}>
            <ActivityIndicator color="#166534" size="large" />
            <Text style={{ color: '#94a3b8', fontSize: 14, fontWeight: '600' }}>{stepLabel}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {['フレーム抽出', 'AI解析', '結果生成'].map((step, i) => {
                const done = (phase === 'extracting' && i === 0) || (phase === 'analyzing' && i <= 1)
                return (
                  <View key={step} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3,
                      backgroundColor: done ? '#166534' : '#374151' }} />
                    <Text style={{ color: done ? '#34C759' : '#4b5563', fontSize: 11 }}>{step}</Text>
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
                backgroundColor: remaining <= 1 ? 'rgba(239,68,68,0.12)' : 'rgba(22,101,52,0.12)',
                borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start',
                borderWidth: 1, borderColor: remaining <= 1 ? 'rgba(239,68,68,0.3)' : 'rgba(22,101,52,0.3)',
              }}>
                <Ionicons name={remaining <= 1 ? 'warning-outline' : 'flash-outline'} size={12}
                  color={remaining <= 1 ? '#ef4444' : '#34C759'}/>
                <Text style={{ fontSize: 11, fontWeight: '700', color: remaining <= 1 ? '#ef4444' : '#34C759' }}>
                  {remaining === 0 ? '無料枠を使い切りました' : `残り${remaining}回（無料枠）`}
                </Text>
              </View>
            )}
            <TouchableOpacity
              onPress={analyze}
              disabled={!videoUri}
              activeOpacity={0.85}
              style={{
                backgroundColor: videoUri ? '#166534' : '#1e293b',
                borderRadius: 16, padding: 18, alignItems: 'center',
                marginBottom: 24, flexDirection: 'row', justifyContent: 'center', gap: 8,
                shadowColor: videoUri ? '#166534' : 'transparent',
                shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12,
              }}
            >
              <Ionicons name="sparkles" size={18} color={videoUri ? '#fff' : '#374151'} />
              <Text style={{ color: videoUri ? '#fff' : '#374151', fontSize: 16, fontWeight: '800' }}>
                {phase === 'result' ? '再分析する' : 'AIで分析する'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── 結果 ── */}
        {result && phase === 'result' && (
          <View style={{ gap: 14 }}>
            {/* スコアリング */}
            <View style={{ backgroundColor: '#1a1f2e', borderRadius: 20, borderWidth: 1, borderColor: scoreColor + '40', overflow: 'hidden' }}>
              <View style={{ height: 3, backgroundColor: scoreColor }} />
              <ScoreRing score={result.score} />
              <View style={{ paddingHorizontal: 20, paddingBottom: 18 }}>
                <Text style={{ color: '#e2e8f0', fontSize: 15, lineHeight: 24, textAlign: 'center' }}>
                  {result.overall}
                </Text>
              </View>
            </View>

            {/* 良い点 */}
            {result.positives?.length > 0 && (
              <ResultSection title="良い点" color="#34C759" icon="✅" items={result.positives} />
            )}

            {/* 改善点 */}
            {result.improvements?.length > 0 && (
              <ResultSection title="改善点" color="#FF9500" icon="⚠️" items={result.improvements} />
            )}

            {/* 練習メニュー */}
            {result.menu?.length > 0 && (
              <View style={{ backgroundColor: 'rgba(96,165,250,0.08)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(96,165,250,0.25)', padding: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Text style={{ fontSize: 18 }}>🏃</Text>
                  <Text style={{ color: '#60a5fa', fontSize: 14, fontWeight: '800' }}>おすすめ練習メニュー</Text>
                </View>
                {result.menu.map((m, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 12, marginBottom: 10, alignItems: 'flex-start' }}>
                    <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(96,165,250,0.18)',
                      alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#60a5fa', fontSize: 12, fontWeight: '900' }}>{i + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{m.name}</Text>
                      <Text style={{ color: '#94a3b8', fontSize: 12, lineHeight: 18, marginTop: 2 }}>{m.detail}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* 再分析ボタン */}
            <TouchableOpacity
              onPress={analyze}
              activeOpacity={0.85}
              style={{ borderRadius: 16, padding: 16, alignItems: 'center',
                backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}
            >
              <Text style={{ color: '#94a3b8', fontSize: 14, fontWeight: '700' }}>🔄 再分析する</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* JSON未パース時のフォールバック */}
        {rawText && !result && phase === 'result' && (
          <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 16 }}>
            <Text style={{ color: '#94a3b8', fontSize: 13, lineHeight: 22 }}>{rawText}</Text>
          </View>
        )}
      </ScrollView>

      <AdGateModal
        visible={adGateVisible}
        feature="video"
        remaining={adGateRemaining}
        rewardUses={adGateRewardUses}
        hardLimited={adGateHardLimited}
        isGuest={isGuest}
        onClose={() => setAdGateVisible(false)}
        onAdWatched={async () => {
          setAdGateVisible(false)
          const g = await checkAdGate('video')
          if (g.rewardUses > 0) {
            await consumeRewardUse('video')
          } else {
            await recordUsage('video')
          }
          trackFeatureUse('video')
          checkAdGate('video').then(g2 => { if (g2.remaining < 999) setRemaining(g2.remaining) }).catch(() => {})
          setError(''); setResult(null); setRawText('')
        }}
        onUpgrade={() => { setAdGateVisible(false); router.push('/paywall') }}
      />
    </View>
  )
}

/* ─── メイン ──────────────────────────────────── */
export default function VideoAnalysis() {
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
  const [adGateRewardUsesW, setAdGateRewardUsesW] = useState(0)
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
    const apiBase2 = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '')
    const endpoint2 = apiBase2 ? `${apiBase2}/api/analyze` : '/api/analyze'
    const model = isPremiumUser ? 'claude-haiku-4-5-20251001' : 'claude-haiku-4-5-20251001'
    const res = await fetch(endpoint2, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
    if (anns.length === 0) return
    setLoadingComp(true)
    try {
      const summary = anns.map((a, i) =>
        `フレーム${i+1}(${formatTime(a.timestamp)}): ${a.advice.overall} | 改善: ${a.advice.improvements.join(' / ')}`
      ).join('\n')
      const apiBase3 = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '')
      const endpoint3 = apiBase3 ? `${apiBase3}/api/analyze` : '/api/analyze'
      const res = await fetch(endpoint3, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 1024,
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
    if (!gate.allowed) {
      setAdGateRewardUsesW(gate.rewardUses)
      setAdGateHardLimited(gate.hardLimited)
      setAdGateVisible(true)
      return
    }
    if (gate.remaining === 0 && gate.rewardUses > 0) {
      await consumeRewardUse('video')
    } else {
      await recordUsage('video')
    }
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
          remaining={0}
          rewardUses={adGateRewardUsesW}
          hardLimited={adGateHardLimited}
          onClose={() => setAdGateVisible(false)}
          onAdWatched={async () => {
            setAdGateVisible(false)
            const g = await checkAdGate('video')
            if (g.rewardUses > 0) {
              await consumeRewardUse('video')
            } else {
              await recordUsage('video')
            }
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

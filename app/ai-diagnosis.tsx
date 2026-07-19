import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { BG_GRADIENT, BRAND, TEXT, NEON } from '../lib/theme'
import { Sounds } from '../lib/sounds'
import { checkAdGate, recordUsage } from '../lib/adGate'
import AdGateModal from '../components/AdGateModal'
import { useAuth } from '../context/AuthContext'
import { useRouter } from 'expo-router'
import { trackFeatureUse } from '../lib/analytics'
import { localDateStr } from '../lib/dateLocal'

const AI_DIAGNOSES_KEY = 'trackmate_ai_diagnoses'

// Hermesの AbortSignal.timeout 非対応に対応したタイムアウト付きfetch
function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return fetch(url, { ...options, signal: AbortSignal.timeout(ms) })
  }
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id))
}

type FatigueLevel = '低' | '中' | '高' | '注意'

type DiagnosisResult = {
  id: string
  timestamp: string
  fatigueLevel: FatigueLevel
  comment: string
  recommendations: string[]
  nextWeekIntensity: string
}

const FATIGUE_BADGE_COLOR: Record<FatigueLevel, string> = {
  '低': '#34C759',
  '中': '#FF9500',
  '高': '#FF6B35',
  '注意': '#FF3B30',
}

function FatigueBadge({ level }: { level: FatigueLevel }) {
  const color = FATIGUE_BADGE_COLOR[level]
  return (
    <View style={[styles.fatigueBadge, { backgroundColor: color + '22', borderColor: color }]}>
      <Text style={[styles.fatigueBadgeText, { color }]}>{level}</Text>
    </View>
  )
}

function DiagnosisCard({ result }: { result: DiagnosisResult }) {
  return (
    <View style={styles.diagCard}>
      <View style={styles.diagCardHeader}>
        <Text style={styles.diagTimestamp}>
          {new Date(result.timestamp).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </Text>
        <FatigueBadge level={result.fatigueLevel} />
      </View>
      <Text style={styles.diagComment}>{result.comment}</Text>
      {result.recommendations.length > 0 && (
        <View style={styles.recList}>
          {result.recommendations.map((rec, i) => (
            <View key={i} style={styles.recItem}>
              <Text style={styles.recBullet}>•</Text>
              <Text style={styles.recText}>{rec}</Text>
            </View>
          ))}
        </View>
      )}
      {result.nextWeekIntensity ? (
        <View style={styles.nextWeekBox}>
          <Text style={styles.nextWeekLabel}>来週の推奨強度</Text>
          <Text style={styles.nextWeekValue}>{result.nextWeekIntensity}</Text>
        </View>
      ) : null}
    </View>
  )
}

function parseDiagnosisFromText(text: string, timestamp: string): DiagnosisResult {
  // 疲労レベルを抽出
  let fatigueLevel: FatigueLevel = '中'
  if (/疲労.*注意|注意.*疲労|オーバートレーニング|限界に近|休養.*必要/.test(text)) {
    fatigueLevel = '注意'
  } else if (/疲労.*高|高.*疲労|かなり疲れ|相当.*疲労/.test(text)) {
    fatigueLevel = '高'
  } else if (/疲労.*低|低.*疲労|余裕|十分.*回復|良好|絶好調/.test(text)) {
    fatigueLevel = '低'
  }

  // コメントと推奨事項を簡易パース
  const lines = text.split('\n').filter(l => l.trim())
  const recommendations: string[] = []
  let comment = ''
  let nextWeekIntensity = ''
  let inRec = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^[-・•]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      recommendations.push(trimmed.replace(/^[-・•\d\.]\s*/, ''))
      inRec = true
    } else if (/来週|次週/.test(trimmed) && !nextWeekIntensity) {
      nextWeekIntensity = trimmed
    } else if (!inRec && !comment && trimmed.length > 10) {
      comment = trimmed
    }
  }

  if (!comment && lines.length > 0) comment = lines[0]

  return {
    id: `diag_${Date.now()}`,
    timestamp,
    fatigueLevel,
    comment,
    recommendations: recommendations.slice(0, 5),
    nextWeekIntensity,
  }
}

export default function AIDiagnosisScreen() {
  const [loading,          setLoading]          = useState(false)
  const [result,           setResult]           = useState<DiagnosisResult | null>(null)
  const [history,          setHistory]          = useState<DiagnosisResult[]>([])
  const [adGateVisible,    setAdGateVisible]    = useState(false)
  const [adGateRemaining,  setAdGateRemaining]  = useState(0)
  const [adGateHardLimited,setAdGateHardLimited]= useState(false)
  const [adGateLimitType,  setAdGateLimitType]  = useState<'none'|'daily'|'monthly'|'total'|'window'>('none')
  const [remaining,        setRemaining]        = useState<number | null>(null)
  const { isGuest } = useAuth()
  const router = useRouter()
  // AdGate async チェック中の二重タップ防止
  const diagnosingRef = React.useRef(false)

  useEffect(() => {
    AsyncStorage.getItem(AI_DIAGNOSES_KEY).then(raw => {
      if (raw) {
        try { setHistory(JSON.parse(raw)) } catch {}
      }
    }).catch(() => {})
    // 残り回数を取得して表示
    checkAdGate('ai_analysis').then(g => {
      if (g.remaining < 999) setRemaining(g.remaining)
    }).catch(() => {})
  }, [])

  const handleDiagnose = useCallback(async () => {
    if (diagnosingRef.current) return  // 二重タップ防止
    // ゲストはログイン必須
    if (isGuest) {
      setAdGateRemaining(0)
      setAdGateHardLimited(false)
      setAdGateVisible(true)
      return
    }
    diagnosingRef.current = true
    try {
      // AdGateチェック
      const gate = await checkAdGate('ai_analysis')
      if (!gate.allowed) {
        setAdGateRemaining(gate.remaining)
        setAdGateHardLimited(gate.hardLimited)
        setAdGateLimitType(gate.limitType)
        setAdGateVisible(true)
        return
      }
      await runDiagnose()
    } finally {
      diagnosingRef.current = false
    }
  }, [isGuest])

  const runDiagnose = useCallback(async () => {
    setAdGateVisible(false)
    Sounds.whoosh()
    setLoading(true)
    setResult(null)
    await recordUsage('ai_analysis')
    trackFeatureUse('ai_analysis')
    // 残り回数を更新
    checkAdGate('ai_analysis').then(g => {
      if (g.remaining < 999) setRemaining(g.remaining)
    }).catch(() => {})

    try {
      // データ収集
      const [sessionsRaw, recordsRaw, bodyRaw, sleepRaw] = await Promise.all([
        AsyncStorage.getItem('trackmate_sessions'),
        AsyncStorage.getItem('trackmate_race_records'),
        AsyncStorage.getItem('trackmate_body_records'),
        AsyncStorage.getItem('trackmate_sleep'),
      ])

      const now = new Date()
      const weekAgo = localDateStr(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000))

      const sessions = sessionsRaw ? (JSON.parse(sessionsRaw) as any[]).filter(s => s.session_date >= weekAgo) : []
      const records = recordsRaw ? (JSON.parse(recordsRaw) as any[]).slice(0, 5) : []
      const bodyRecords = bodyRaw ? (JSON.parse(bodyRaw) as any[]).filter(b => b.date >= weekAgo) : []
      const sleepRecords = sleepRaw ? (JSON.parse(sleepRaw) as any[]).filter(s => s.date >= weekAgo) : []

      const trainingData = {
        period: `${weekAgo} 〜 ${localDateStr(now)}`,
        sessions: sessions.map(s => ({
          date: s.session_date,
          type: s.session_type,
          event: s.event,
          fatigue: s.fatigue_level,
          condition: s.condition_level,
          distance_m: s.distance_m,
          time_ms: s.time_ms,
        })),
        recentRecords: records.map(r => ({
          date: r.race_date,
          event: r.event,
          result: r.result_display,
          isPB: r.is_pb,
        })),
        bodyRecords: bodyRecords.map(b => ({
          date: b.date,
          weight: b.weight,
          rpe: b.fatigue,
        })),
        sleepRecords: sleepRecords.map(s => ({
          date: s.sleep_date,
          hours: s.duration_min ? Math.round(s.duration_min / 60 * 10) / 10 : undefined,
          quality: s.quality_score,
        })),
      }

      const _apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
      const _endpoint = `${_apiBase}/api/analyze`

      const response = await fetchWithTimeout(_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: `あなたは陸上競技の専門トレーナーです。以下のトレーニングデータを分析して、日本語で詳細なフィードバックをしてください。

## 直近7日間のトレーニングデータ
${JSON.stringify(trainingData, null, 2)}

## 分析してほしいこと
1. 現在の疲労レベル（低/中/高/注意）
2. 今週の練習に対する総合評価コメント（2〜3文）
3. 改善のための具体的な提案（箇条書き3〜5点）
4. 来週の練習強度の推奨（1文）

回答は日本語で、選手が理解しやすい言葉を使ってください。`,
            },
          ],
        }),
      }, 35000)

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`API error ${response.status}: ${errText}`)
      }

      const data = await response.json()
      const text = data.content?.[0]?.text ?? 'データが不足しているため詳細な分析ができませんでした。'
      const timestamp = new Date().toISOString()
      const parsed = parseDiagnosisFromText(text, timestamp)

      setResult(parsed)
      Sounds.ding()

      // 履歴に保存（最新3件）
      setHistory(prev => {
        const next = [parsed, ...prev].slice(0, 3)
        AsyncStorage.setItem(AI_DIAGNOSES_KEY, JSON.stringify(next)).catch(() => {})
        return next
      })
    } catch (err: any) {
      Sounds.error()
      // フォールバック表示
      const fallback: DiagnosisResult = {
        id: `diag_fallback_${Date.now()}`,
        timestamp: new Date().toISOString(),
        fatigueLevel: '中',
        comment: 'AI分析を利用できませんでした。APIキーが設定されているか確認してください。練習データを蓄積することで精度が上がります。',
        recommendations: [
          '毎日の練習記録を欠かさず入力しましょう',
          '疲労度・体重の体調記録も継続してください',
          '睡眠記録も合わせて管理することをお勧めします',
        ],
        nextWeekIntensity: '現在のペースを維持しながら、徐々に強度を上げていきましょう',
      }
      setResult(fallback)
      Toast.show({ type: 'error', text1: 'AI接続エラー', text2: 'フォールバックメッセージを表示しています' })
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient colors={BG_GRADIENT} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safe}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* 説明 */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardIcon}>🤖</Text>
              <Text style={styles.cardTitle}>AIトレーニング診断</Text>
            </View>
            <Text style={styles.cardDesc}>
              直近7日間の練習記録・体調・睡眠データをもとに、AIが疲労状態を分析して改善提案を行います。
            </Text>
            {/* 残り回数バッジ */}
            {remaining !== null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
                backgroundColor: remaining <= 1 ? 'rgba(239,68,68,0.12)' : 'rgba(22,101,52,0.12)',
                borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1,
                borderColor: remaining <= 1 ? 'rgba(239,68,68,0.3)' : 'rgba(22,101,52,0.3)',
              }}>
                <Ionicons name={remaining <= 1 ? 'warning-outline' : 'flash-outline'} size={12}
                  color={remaining <= 1 ? '#ef4444' : BRAND}/>
                <Text style={{ fontSize: 11, fontWeight: '700', color: remaining <= 1 ? '#ef4444' : BRAND }}>
                  {remaining === 0 ? '無料枠を使い切りました' : `残り${remaining}回（無料枠）`}
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={[styles.analyzeBtn, loading && { opacity: 0.6 }]}
              onPress={handleDiagnose}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.analyzeBtnText}>分析中...</Text>
                </>
              ) : (
                <>
                  <Ionicons name="analytics-outline" size={18} color="#fff" />
                  <Text style={styles.analyzeBtnText}>今週の練習を分析する</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* 最新結果 */}
          {result && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="checkmark-circle" size={18} color={NEON.green} />
                <Text style={styles.cardTitle}>分析結果</Text>
                <FatigueBadge level={result.fatigueLevel} />
              </View>

              <Text style={styles.commentText}>{result.comment}</Text>

              {result.recommendations.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>推奨事項</Text>
                  <View style={styles.recList}>
                    {result.recommendations.map((rec, i) => (
                      <View key={i} style={styles.recItem}>
                        <Text style={styles.recBullet}>•</Text>
                        <Text style={styles.recText}>{rec}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {result.nextWeekIntensity ? (
                <View style={styles.nextWeekBox}>
                  <Text style={styles.nextWeekLabel}>来週の練習強度提案</Text>
                  <Text style={styles.nextWeekValue}>{result.nextWeekIntensity}</Text>
                </View>
              ) : null}
            </View>
          )}

          {/* 診断履歴 */}
          {history.length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="time-outline" size={16} color={TEXT.hint} />
                <Text style={styles.cardTitle}>診断履歴</Text>
                <Text style={{ color: TEXT.hint, fontSize: 12 }}>直近{history.length}件</Text>
              </View>
              <View style={{ gap: 10 }}>
                {history.map(h => (
                  <DiagnosisCard key={h.id} result={h} />
                ))}
              </View>
            </View>
          )}

        </ScrollView>
      </SafeAreaView>

      <AdGateModal
        visible={adGateVisible}
        feature="ai_analysis"
        remaining={adGateRemaining}
        hardLimited={adGateHardLimited}
        limitType={adGateLimitType}
        isGuest={isGuest}
        onClose={() => setAdGateVisible(false)}
        onAdWatched={() => runDiagnose()}
        onUpgrade={() => { setAdGateVisible(false); router.push('/paywall') }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: 'transparent' },
  scroll:  { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 48 },

  card: {
    backgroundColor: '#111111',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 16,
    gap: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardIcon:   { fontSize: 22 },
  cardTitle:  { color: TEXT.primary, fontSize: 15, fontWeight: '700', flex: 1 },
  cardDesc:   { color: TEXT.secondary, fontSize: 13, lineHeight: 20 },

  analyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 14,
  },
  analyzeBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  fatigueBadge: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  fatigueBadgeText: { fontSize: 12, fontWeight: '700' },

  commentText: { color: TEXT.primary, fontSize: 14, lineHeight: 22 },

  section:      { gap: 8 },
  sectionTitle: { color: TEXT.secondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },

  recList: { gap: 6 },
  recItem: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  recBullet: { color: NEON.blue, fontSize: 16, lineHeight: 20 },
  recText:   { color: TEXT.secondary, fontSize: 13, lineHeight: 20, flex: 1 },

  nextWeekBox: {
    backgroundColor: 'rgba(74,159,255,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(74,159,255,0.25)',
    padding: 12,
    gap: 4,
  },
  nextWeekLabel: { color: TEXT.hint, fontSize: 11, fontWeight: '600' },
  nextWeekValue: { color: TEXT.primary, fontSize: 13, lineHeight: 20 },

  // 履歴カード
  diagCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(74,159,255,0.1)',
    padding: 12,
    gap: 8,
  },
  diagCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  diagTimestamp:  { color: TEXT.hint, fontSize: 11 },
  diagComment:    { color: TEXT.secondary, fontSize: 13, lineHeight: 18 },
})

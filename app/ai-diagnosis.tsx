import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { BG_GRADIENT, BRAND, TEXT, NEON } from '../lib/theme'
import { Sounds } from '../lib/sounds'
import { checkAdGate, recordUsage } from '../lib/adGate'
import { TICKET_COST } from '../lib/ticketWallet'
import { getAiAuthHeader } from '../lib/supabase'
import AdGateModal from '../components/AdGateModal'
import TicketGateModal from '../components/TicketGateModal'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { narrativeLanguageInstruction } from '../lib/aiLanguage'
import { useRouter, useNavigation } from 'expo-router'
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

// 内部値(日本語)→表示ラベルのキー。lib/eventLabels.ts と同じ考え方で、
// データの実体(FatigueLevel型・保存済み履歴)は日本語のまま保持し、表示だけ翻訳する
const FATIGUE_LABEL_KEY: Record<FatigueLevel, string> = {
  '低': 'aiDiagnosis.fatigueLevels.low',
  '中': 'aiDiagnosis.fatigueLevels.medium',
  '高': 'aiDiagnosis.fatigueLevels.high',
  '注意': 'aiDiagnosis.fatigueLevels.caution',
}

function FatigueBadge({ level }: { level: FatigueLevel }) {
  const { t } = useTranslation()
  const color = FATIGUE_BADGE_COLOR[level]
  return (
    <View style={[styles.fatigueBadge, { backgroundColor: color + '22', borderColor: color }]}>
      <Text style={[styles.fatigueBadgeText, { color }]}>{t(FATIGUE_LABEL_KEY[level])}</Text>
    </View>
  )
}

function DiagnosisCard({ result }: { result: DiagnosisResult }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  return (
    <View style={styles.diagCard}>
      <View style={styles.diagCardHeader}>
        <Text style={styles.diagTimestamp}>
          {new Date(result.timestamp).toLocaleDateString(language === 'en' ? 'en-US' : 'ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
          <Text style={styles.nextWeekLabel}>{t('aiDiagnosis.nextWeekLabelShort')}</Text>
          <Text style={styles.nextWeekValue}>{result.nextWeekIntensity}</Text>
        </View>
      ) : null}
    </View>
  )
}

function parseDiagnosisFromText(text: string, timestamp: string): DiagnosisResult {
  // 疲労レベルを抽出（英語設定では自由記述部分が英語で返るため、
  // 日本語の合図語だけでなく英語の同義表現もあわせて見る。
  // fatigueLevel自体の語彙(低/中/高/注意)はプロンプト側で維持を指示しているので、
  // 素直な日本語一致がまず効くはずだが、AIが従わなかった場合の保険として英語も見る）
  let fatigueLevel: FatigueLevel = '中'
  if (/疲労.*注意|注意.*疲労|オーバートレーニング|限界に近|休養.*必要|overtrain|near.{0,20}limit|need.{0,10}rest|caution|警戒/i.test(text)) {
    fatigueLevel = '注意'
  } else if (/疲労.*高|高.*疲労|かなり疲れ|相当.*疲労|high fatigue|quite tired|significant(ly)? fatigue/i.test(text)) {
    fatigueLevel = '高'
  } else if (/疲労.*低|低.*疲労|余裕|十分.*回復|良好|絶好調|low fatigue|well recovered|great condition|plenty of (energy|margin)/i.test(text)) {
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
    } else if (/来週|次週|next week/i.test(trimmed) && !nextWeekIntensity) {
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
  const [ticketGateVisible, setTicketGateVisible] = useState(false)
  const [ticketGateCost,    setTicketGateCost]    = useState(0)
  const [ticketGateBalance, setTicketGateBalance] = useState(0)
  const { isGuest } = useAuth()
  const { language } = useLanguage()
  const { t } = useTranslation()
  const router = useRouter()
  const navigation = useNavigation()
  useEffect(() => { navigation.setOptions({ title: t('aiDiagnosis.title') }) }, [navigation, t, language])
  // AdGate async チェック中の二重タップ防止
  const diagnosingRef = React.useRef(false)

  useEffect(() => {
    AsyncStorage.getItem(AI_DIAGNOSES_KEY).then(raw => {
      if (raw) {
        try { setHistory(JSON.parse(raw)) } catch {}
      }
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
        if (gate.needsTicket) { setTicketGateCost(gate.ticketCost); setTicketGateBalance(gate.ticketBalance); setTicketGateVisible(true) }
        else {
          setAdGateRemaining(gate.remaining)
          setAdGateHardLimited(gate.hardLimited)
          setAdGateLimitType(gate.limitType)
          setAdGateVisible(true)
        }
        return
      }
      await runDiagnose(gate.needsTicket ? gate.ticketCost : 0)
    } finally {
      diagnosingRef.current = false
    }
  }, [isGuest])

  const runDiagnose = useCallback(async (ticketCostUsed = 0) => {
    setAdGateVisible(false)
    Sounds.whoosh()
    setLoading(true)
    setResult(null)

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

      // プロンプトの土台は日本語で組み立てる（JSONスキーマ的な指示部分・疲労レベルの
      // 固定語彙(低/中/高/注意)はデータの実体として日本語のまま保つ必要があるため）。
      // 自由記述の文体だけ英語にしたい場合は、末尾に矛盾する指示を足すのではなく、
      // 「日本語で」の一文自体を言語に応じて出し分ける（「日本語で」と言い切った直後に
      // 英語で書けと追記すると、モデルへの指示として一貫性がなく守られないことがある）
      const languageLine = language === 'en'
        ? 'Write the free-text comment/recommendations/next-week fields in natural, fluent English. Keep the fatigue level itself as one of 低/中/高/注意 exactly as listed (do not translate it).'
        : '回答は日本語で、選手が理解しやすい言葉を使ってください。'

      const response = await fetchWithTimeout(_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await getAiAuthHeader()) },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          feature: 'ai_analysis',
          messages: [
            {
              role: 'user',
              content: `あなたは陸上競技の専門トレーナーです。以下のトレーニングデータを分析して、詳細なフィードバックをしてください。

## 直近7日間のトレーニングデータ
${JSON.stringify(trainingData, null, 2)}

## 分析してほしいこと
1. 現在の疲労レベル（低/中/高/注意）
2. 今週の練習に対する総合評価コメント（2〜3文）
3. 改善のための具体的な提案（箇条書き3〜5点）
4. 来週の練習強度の推奨（1文）

${languageLine}${narrativeLanguageInstruction(language)}`,
            },
          ],
        }),
      }, 35000)

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`API error ${response.status}: ${errText}`)
      }

      const data = await response.json()
      const text = data.content?.[0]?.text ?? t('aiDiagnosis.noContentFallback')
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

      // 分析に成功した場合のみ利用回数・チケットを消費する（失敗時に課金しないため）
      await recordUsage('ai_analysis')
      trackFeatureUse('ai_analysis')
      if (ticketCostUsed > 0) Toast.show({ type: 'info', text1: t('aiDiagnosis.ticketUsedToast', { n: ticketCostUsed }), visibilityTime: 1800 })
    } catch (err: any) {
      Sounds.error()
      // フォールバック表示
      const fallback: DiagnosisResult = {
        id: `diag_fallback_${Date.now()}`,
        timestamp: new Date().toISOString(),
        fatigueLevel: '中',
        comment: t('aiDiagnosis.fallback.comment'),
        recommendations: [
          t('aiDiagnosis.fallback.rec1'),
          t('aiDiagnosis.fallback.rec2'),
          t('aiDiagnosis.fallback.rec3'),
        ],
        nextWeekIntensity: t('aiDiagnosis.fallback.nextWeek'),
      }
      setResult(fallback)
      Toast.show({ type: 'error', text1: t('aiDiagnosis.errorToastTitle'), text2: t('aiDiagnosis.errorToastBody') })
    } finally {
      setLoading(false)
    }
    // language/t は元は[]依存で固定されており、マウント後の言語切替が
    // プロンプト・フォールバック文言に反映されない不具合があったため追加
  }, [language, t])

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient colors={BG_GRADIENT} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safe}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* 説明 */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardIcon}>🤖</Text>
              <Text style={styles.cardTitle}>{t('aiDiagnosis.title')}</Text>
            </View>
            <Text style={styles.cardDesc}>
              {t('aiDiagnosis.description')}
            </Text>
            {/* チケット消費数バッジ */}
            <View style={styles.ticketCostBadge}>
              <Text style={styles.ticketCostBadgeText}>{t('aiDiagnosis.ticketCost', { n: TICKET_COST.ai_analysis })}</Text>
            </View>
            <TouchableOpacity
              style={[styles.analyzeBtn, loading && { opacity: 0.6 }]}
              onPress={handleDiagnose}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.analyzeBtnText}>{t('aiDiagnosis.analyzing')}</Text>
                </>
              ) : (
                <>
                  <Ionicons name="analytics-outline" size={18} color="#fff" />
                  <Text style={styles.analyzeBtnText}>{t('aiDiagnosis.analyzeBtn')}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* 最新結果 */}
          {result && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="checkmark-circle" size={18} color={NEON.green} />
                <Text style={styles.cardTitle}>{t('aiDiagnosis.resultTitle')}</Text>
                <FatigueBadge level={result.fatigueLevel} />
              </View>

              <Text style={styles.commentText}>{result.comment}</Text>

              {result.recommendations.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>{t('aiDiagnosis.recommendationsTitle')}</Text>
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
                  <Text style={styles.nextWeekLabel}>{t('aiDiagnosis.nextWeekLabelFull')}</Text>
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
                <Text style={styles.cardTitle}>{t('aiDiagnosis.historyTitle')}</Text>
                <Text style={{ color: TEXT.hint, fontSize: 12 }}>{t('aiDiagnosis.historyCount', { count: history.length })}</Text>
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

      <TicketGateModal
        visible={ticketGateVisible}
        feature="ai_analysis"
        ticketCost={ticketGateCost}
        ticketBalance={ticketGateBalance}
        onClose={() => setTicketGateVisible(false)}
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
  // カードは #111111 の暗色背景のため、TEXT.primary(ライト背景用の濃色)ではなく白系を使用
  cardTitle:  { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1 },
  cardDesc:   { color: TEXT.secondary, fontSize: 13, lineHeight: 20 },

  ticketCostBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245,158,11,0.14)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  ticketCostBadgeText: { fontSize: 11, fontWeight: '700', color: '#f59e0b' },

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

  commentText: { color: '#fff', fontSize: 14, lineHeight: 22 },

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
  nextWeekValue: { color: '#fff', fontSize: 13, lineHeight: 20 },

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

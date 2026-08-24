// app/meal-coach.tsx — AI食事コーチ（プロプラン限定）
// Council合意事項:
//   - 大会日を軸に、確立された栄養知見を「目安・提案」として提示する（断定的な処方はしない）
//   - 「食事を主に用意するのは誰か」で出力の宛先を分岐する（本人 / 保護者 / 寮 等）
//   - 日次の具体的な献立処方（本命機能）は管理栄養士監修・フェーズ設計が整うまで保留
import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Share,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BlurView } from 'expo-blur'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { BRAND, TEXT } from '../lib/theme'
import { useRouter } from 'expo-router'
import { usePurchase } from '../context/PurchaseContext'
import { todayLocalISO } from '../lib/dateLocal'
import { trackFeatureUse } from '../lib/analytics'
import { checkAdGate, recordUsage } from '../lib/adGate'
import { TICKET_COST } from '../lib/ticketWallet'
import TicketGateModal from '../components/TicketGateModal'
import { useAuth } from '../context/AuthContext'

const PROFILE_KEY = 'trackmate_my_profile'
const COMP_KEY    = 'trackmate_competitions'

// Hermesの AbortSignal.timeout 非対応に対応したタイムアウト付きfetch
function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return fetch(url, { ...options, signal: AbortSignal.timeout(ms) })
  }
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id))
}

type MealProvider = 'self' | 'family' | 'dorm' | 'convenience'

const PROVIDER_OPTIONS: { value: MealProvider; label: string; sub: string; icon: string }[] = [
  { value: 'self',        label: '自分で用意',         sub: '自炊・一人暮らしなど',   icon: '🧑‍🍳' },
  { value: 'family',      label: '家族・親が用意',      sub: '実家暮らしなど',         icon: '👨‍👩‍👧' },
  { value: 'dorm',        label: '寮・合宿所',          sub: '食事担当者がいる',       icon: '🏠' },
  { value: 'convenience', label: 'コンビニ・外食中心',   sub: '自炊はあまりしない',     icon: '🏪' },
]

const AUDIENCE_LABEL: Record<MealProvider, string> = {
  self: '選手本人', family: '保護者（親）', dorm: '寮・合宿所の食事担当者', convenience: '選手本人（コンビニ・外食中心）',
}

interface CompetitionInfo { name: string; date: string; event: string; daysLeft: number }

export default function MealCoachScreen() {
  const router = useRouter()
  const { isNoad, isCoach } = usePurchase()
  const { isGuest } = useAuth()
  const [loading, setLoading]           = useState(true)
  const [mealProvider, setMealProvider] = useState<MealProvider | null>(null)
  const [eventCategory, setEventCategory] = useState<'sprint' | 'middle' | 'long'>('sprint')
  const [competition, setCompetition]   = useState<CompetitionInfo | null>(null)
  const [ticketGateVisible, setTicketGateVisible] = useState(false)
  const [ticketGateCost,    setTicketGateCost]    = useState(0)
  const [ticketGateBalance, setTicketGateBalance] = useState(0)
  const [generating, setGenerating]     = useState(false)
  const [message, setMessage]           = useState('')

  useEffect(() => {
    (async () => {
      try {
        const [profileRaw, compRaw] = await Promise.all([
          AsyncStorage.getItem(PROFILE_KEY),
          AsyncStorage.getItem(COMP_KEY),
        ])
        if (profileRaw) {
          try {
            const p = JSON.parse(profileRaw)
            if (p?.meal_provider) setMealProvider(p.meal_provider)
            if (p?.event_category === 'middle' || p?.event_category === 'long') setEventCategory(p.event_category)
          } catch {}
        }
        if (compRaw) {
          try {
            const all = JSON.parse(compRaw) as Array<{ competition_name: string; competition_date: string; event: string }>
            const todayStr = todayLocalISO()
            const upcoming = all
              .filter(c => c.competition_date >= todayStr)
              .sort((a, b) => a.competition_date.localeCompare(b.competition_date))[0]
            if (upcoming) {
              const compDate = new Date(upcoming.competition_date); compDate.setHours(0, 0, 0, 0)
              const today = new Date(); today.setHours(0, 0, 0, 0)
              const daysLeft = Math.ceil((compDate.getTime() - today.getTime()) / 86400000)
              setCompetition({ name: upcoming.competition_name, date: upcoming.competition_date, event: upcoming.event, daysLeft })
            }
          } catch {}
        }
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const saveMealProvider = useCallback(async (v: MealProvider) => {
    setMealProvider(v)
    try {
      const raw = await AsyncStorage.getItem(PROFILE_KEY)
      const p = raw ? JSON.parse(raw) : {}
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ ...p, meal_provider: v }))
    } catch {}
  }, [])

  const generateMessage = useCallback(async () => {
    if (!mealProvider) return
    if (isGuest) { router.push('/auth'); return }
    const gate = await checkAdGate('meal_coach')
    if (!gate.allowed) {
      if (gate.needsTicket) { setTicketGateCost(gate.ticketCost); setTicketGateBalance(gate.ticketBalance); setTicketGateVisible(true) }
      else { router.push('/paywall') }
      return
    }
    setGenerating(true); setMessage('')
    try {
      const apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
      const endpoint = `${apiBase}/api/analyze`
      const eventCategoryLabel = eventCategory === 'sprint' ? '短距離' : eventCategory === 'middle' ? '中距離' : '長距離'
      const audienceLabel = AUDIENCE_LABEL[mealProvider]

      const systemPrompt = `あなたは日本トップレベルの陸上競技専門の管理栄養士です。実業団・大学のトップ選手の栄養指導経験があり、種目特性に応じた実践的なアドバイスを得意とします。

重要な制約（必ず守ること）：
- これは個別の医療的・栄養学的処方ではなく、一般的な情報提供です。断定的な「〜を食べてください」「〜は食べてはいけません」という命令調は避け、「〜を意識してみましょう」「〜がおすすめです」という提案・目安のトーンで書いてください。
- 具体的な数値（カロリー・グラム数）を細かく指定するのではなく、範囲や考え方を中心に示してください。
- 対象は成長期の選手である可能性があります。極端な減量・過度な食事制限を示唆する表現は絶対に使わないでください。
- 文末に「体調に不安がある場合や、詳しい相談は医師・管理栄養士にご相談ください」という趣旨の一文を必ず含めてください。`

      const prompt = `【選手情報】
種目：${eventCategoryLabel}
${competition
  ? `大会：${competition.name}（${competition.event}）、大会まで残り${competition.daysLeft}日`
  : '直近の大会予定：なし（普段の食事について、一般的なポイントをまとめてください）'}

【メッセージの宛先】
${audienceLabel}

上記の宛先に向けて、大会に向けた食事で意識してほしいポイントを、提案・目安のトーンでまとめてください。${mealProvider === 'family' || mealProvider === 'dorm' ? 'そのまま相手に見せられるような、丁寧で分かりやすい文面にしてください。' : ''}

以下の形式で出力してください：

🍚 **今、意識したいポイント**
（2〜3個、箇条書き。大会までの残り日数と種目特性を踏まえた内容にする）

💬 **一言**
（3〜4文。温かみのある結び）

※本メッセージは一般的な情報提供です。個別の体調・既往症等については医師・管理栄養士にご相談ください、という一文を必ず最後に含める。`

      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          system: systemPrompt,
          messages: [{ role: 'user', content: prompt }],
        }),
      }, 45000)
      if (!res.ok) throw new Error(`APIエラー (${res.status})`)
      const data = await res.json()
      const text = data.content?.[0]?.text ?? '生成できませんでした'
      setMessage(text)
      trackFeatureUse('meal_coach')

      // 生成に成功した場合のみ利用回数・チケットを消費する（失敗時に課金しないため）
      await recordUsage('meal_coach')
      if (gate.needsTicket) Toast.show({ type: 'info', text1: `🎫 チケットを${gate.ticketCost}枚使用しました`, visibilityTime: 1800 })
    } catch (e) {
      Toast.show({ type: 'error', text1: '生成に失敗しました', text2: e instanceof Error ? e.message : '' })
    } finally {
      setGenerating(false)
    }
  }, [mealProvider, eventCategory, competition, isGuest, router])

  const shareMessage = useCallback(async () => {
    if (!message) return
    try { await Share.share({ message }) } catch {}
  }, [message])

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f5f7' }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="戻る">
            <Ionicons name="chevron-back" size={24} color={TEXT.primary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>AI食事コーチ</Text>
          <View style={{ width: 24 }} />
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={BRAND} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>

            {/* 大会カウントダウン */}
            {competition && !isNoad ? (
              <View style={[s.card, { overflow: 'hidden' }]}>
                <View pointerEvents="none">
                  <Text style={s.cardLabel}>{competition.name}（{competition.event}）</Text>
                  <Text style={s.countdown}>あと {competition.daysLeft} 日</Text>
                </View>
                <BlurView intensity={32} tint="light" style={StyleSheet.absoluteFill} />
                <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 12 }]}>
                  <Ionicons name="lock-closed" size={18} color={TEXT.secondary} />
                  <Text style={{ color: TEXT.primary, fontSize: 12, fontWeight: '800', marginTop: 6, textAlign: 'center' }}>
                    大会までの日数はプロプラン限定です
                  </Text>
                  <TouchableOpacity
                    onPress={() => router.push('/paywall')}
                    style={{ marginTop: 8, backgroundColor: BRAND, borderRadius: 50, paddingHorizontal: 16, paddingVertical: 7 }}
                    activeOpacity={0.85}
                  >
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>プロプランを見る</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={s.card}>
                {competition ? (
                  <>
                    <Text style={s.cardLabel}>{competition.name}（{competition.event}）</Text>
                    <Text style={s.countdown}>あと {competition.daysLeft} 日</Text>
                  </>
                ) : (
                  <>
                    <Text style={s.cardLabel}>直近の大会予定はありません</Text>
                    <TouchableOpacity onPress={() => router.push({ pathname: '/(tabs)/competition', params: { tab: 'race' } })} style={{ marginTop: 8 }}>
                      <Text style={{ color: BRAND, fontSize: 13, fontWeight: '700' }}>試合計画から大会を登録する →</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}

            {/* 食事を主に用意するのは誰か */}
            <Text style={s.sectionTitle}>食事を主に用意するのはどなたですか？</Text>
            <View style={{ gap: 10, marginBottom: 20 }}>
              {PROVIDER_OPTIONS.map(opt => {
                const selected = mealProvider === opt.value
                return (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => saveMealProvider(opt.value)}
                    style={[s.providerRow, selected && s.providerRowActive]}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontSize: 22 }}>{opt.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.providerLabel, selected && { color: BRAND }]}>{opt.label}</Text>
                      <Text style={s.providerSub}>{opt.sub}</Text>
                    </View>
                    {selected && <Ionicons name="checkmark-circle" size={22} color={BRAND} />}
                  </TouchableOpacity>
                )
              })}
            </View>

            {/* 生成ボタン */}
            <TouchableOpacity
              onPress={generateMessage}
              disabled={!mealProvider || generating}
              style={[s.genBtn, (!mealProvider || generating) && { opacity: 0.4 }]}
              activeOpacity={0.85}
            >
              {generating ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ fontSize: 18 }}>🍚</Text>}
              <Text style={s.genBtnText}>
                {generating ? '作成中...' : mealProvider === 'self' ? '食事のポイントを見る' : `${AUDIENCE_LABEL[mealProvider ?? 'self']}向けメッセージを作成`}
              </Text>
              {!isCoach && !generating && (
                <View style={s.genBtnBadge}><Text style={s.genBtnBadgeText}>🎫 {TICKET_COST.meal_coach}枚</Text></View>
              )}
            </TouchableOpacity>

            {/* 結果 */}
            {message !== '' && (
              <View style={s.resultCard}>
                {message.split('\n').map((line, i) => {
                  const isBold = /^[🍚💬※]/.test(line)
                  return (
                    <Text key={i} style={[s.resultText, isBold && { color: TEXT.primary, fontWeight: '700', marginTop: 10 }]}>
                      {line}
                    </Text>
                  )
                })}
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                  <TouchableOpacity style={s.shareBtn} onPress={shareMessage} activeOpacity={0.8}>
                    <Ionicons name="share-outline" size={15} color={BRAND} />
                    <Text style={s.shareBtnText}>共有・コピー</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.shareBtn} onPress={generateMessage} activeOpacity={0.8}>
                    <Ionicons name="refresh" size={15} color={BRAND} />
                    <Text style={s.shareBtnText}>作り直す</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <Text style={s.disclaimer}>
              ※ AI食事コーチは一般的な情報提供です。個別の体調・既往症等については医師・管理栄養士にご相談ください。
            </Text>
          </ScrollView>
        )}
      </SafeAreaView>

      <TicketGateModal
        visible={ticketGateVisible}
        feature="meal_coach"
        ticketCost={ticketGateCost}
        ticketBalance={ticketGateBalance}
        onClose={() => setTicketGateVisible(false)}
      />
    </View>
  )
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: TEXT.primary },
  card: {
    backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)',
    padding: 16, marginBottom: 20,
  },
  cardLabel: { color: TEXT.secondary, fontSize: 12, fontWeight: '700' },
  countdown: { color: BRAND, fontSize: 28, fontWeight: '900', marginTop: 4, letterSpacing: -0.5 },
  sectionTitle: { color: TEXT.primary, fontSize: 14, fontWeight: '800', marginBottom: 10 },
  providerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.07)',
    padding: 14,
  },
  providerRowActive: { borderColor: BRAND, backgroundColor: BRAND + '0D' },
  providerLabel: { color: TEXT.primary, fontSize: 14, fontWeight: '700' },
  providerSub:   { color: TEXT.hint, fontSize: 11, marginTop: 2 },
  genBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: BRAND, borderRadius: 14, paddingVertical: 16, marginBottom: 20,
    shadowColor: BRAND, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 3,
  },
  genBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  genBtnBadge: { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  genBtnBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  resultCard: {
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)',
    padding: 16, marginBottom: 16,
  },
  resultText: { color: TEXT.secondary, fontSize: 13, lineHeight: 22 },
  shareBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: BRAND + '55', backgroundColor: BRAND + '0D',
    borderRadius: 10, paddingVertical: 10,
  },
  shareBtnText: { color: BRAND, fontSize: 13, fontWeight: '700' },
  // 医療・栄養に関する注意書きのため、hint(薄グレー)ではなく secondary で視認性を確保
  disclaimer: { color: TEXT.secondary, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 4 },
})

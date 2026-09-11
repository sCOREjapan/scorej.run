// app/ranking.tsx — 全国ランキング

import React, { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useNavigation } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Ionicons } from '@expo/vector-icons'
import { BRAND, TEXT, SURFACE, SURFACE2, NEON } from '../lib/theme'
import { supabase } from '../lib/supabase'
import type { AthleticsEvent, RaceRecord } from '../types'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../context/LanguageContext'
import { getEventLabel } from '../lib/eventLabels'
import type { Language } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { getMyRankingSettings } from '../lib/rankingOptIn'

// 2026-09-11: 「参加は任意」のバナーを毎回出さないための既読フラグ(端末ローカル)。
// オプトイン状態そのものはSupabase(profiles.ranking_opt_in)が正なので、
// これはあくまで「まだ参加していない人に、次回また出すか」の表示制御用。
const BANNER_DISMISSED_KEY = 'trackmate_ranking_optin_banner_dismissed'

// ─── 定数 ───────────────────────────────────────────────────────────────
const RECORDS_KEY = 'trackmate_race_records'

const TRACK_EVENTS: AthleticsEvent[] = [
  '100m', '200m', '300m', '400m', '800m', '1000m', '1500m', '3000m',
  '5000m', '10000m', '110mH', '100mH', '300mH', '400mH',
  '3000mSC', 'half_marathon', 'marathon', '競歩',
]

const FIELD_EVENTS: AthleticsEvent[] = [
  '走幅跳', '三段跳', '走高跳', '棒高跳',
  '砲丸投', 'やり投', '円盤投', 'ハンマー投',
]

const ALL_RANK_EVENTS: AthleticsEvent[] = [...TRACK_EVENTS, ...FIELD_EVENTS]

// ─── モックデータ ─────────────────────────────────────────────────────
interface RankingEntry {
  rank: number
  userId: string
  displayName: string      // 匿名化済み
  result: string
  resultMs?: number
  resultCm?: number
  raceDate: string
  isMe: boolean
}

function anonymize(name: string, lang: Language, t: (key: string, opts?: any) => string): string {
  if (!name || name.length === 0) return t('ranking.anonFallback')
  const initial = name.charAt(0)
  return t('ranking.anonSuffix', { initial })
}

// モックランキングデータ（Supabase 未接続時）
// 英語設定では日本語の名字がそのままAthlete表示に混ざると不自然なため、A〜Jのアルファベットを使う
const MOCK_NAMES_JA = [
  '山田', '佐藤', '鈴木', '高橋', '田中',
  '渡辺', '伊藤', '中村', '小林', '加藤',
]
const MOCK_NAMES_EN = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']

function generateMockRanking(event: AthleticsEvent, lang: Language, t: (key: string, opts?: any) => string): RankingEntry[] {
  const MOCK_NAMES = lang === 'en' ? MOCK_NAMES_EN : MOCK_NAMES_JA
  const isField = FIELD_EVENTS.includes(event)

  if (event === '100m') {
    const times = ['10.18', '10.23', '10.31', '10.35', '10.42', '10.48', '10.55', '10.61', '10.68', '10.75']
    return times.map((timeStr, i) => ({
      rank: i + 1,
      userId: `mock_${i}`,
      displayName: anonymize(MOCK_NAMES[i] ?? '', lang, t),
      result: timeStr,
      resultMs: Math.round(parseFloat(timeStr) * 1000),
      raceDate: '2025-06-15',
      isMe: i === 4, // 5位が自分
    }))
  }
  if (event === '200m') {
    const times = ['20.41', '20.58', '20.71', '20.84', '20.99', '21.12', '21.25', '21.38', '21.51', '21.65']
    return times.map((timeStr, i) => ({
      rank: i + 1,
      userId: `mock_${i}`,
      displayName: anonymize(MOCK_NAMES[i] ?? '', lang, t),
      result: timeStr,
      resultMs: Math.round(parseFloat(timeStr) * 1000),
      raceDate: '2025-06-15',
      isMe: i === 3,
    }))
  }
  if (event === '400m') {
    const times = ['46.52', '46.88', '47.12', '47.45', '47.78', '48.01', '48.34', '48.67', '49.01', '49.35']
    return times.map((timeStr, i) => ({
      rank: i + 1,
      userId: `mock_${i}`,
      displayName: anonymize(MOCK_NAMES[i] ?? '', lang, t),
      result: timeStr,
      resultMs: Math.round(parseFloat(timeStr) * 1000),
      raceDate: '2025-06-15',
      isMe: i === 2,
    }))
  }
  if (event === '走幅跳') {
    const distances = ['7m85', '7m72', '7m68', '7m54', '7m41', '7m38', '7m22', '7m15', '7m08', '6m98']
    return distances.map((d, i) => ({
      rank: i + 1,
      userId: `mock_${i}`,
      displayName: anonymize(MOCK_NAMES[i] ?? '', lang, t),
      result: d,
      resultCm: parseInt(d.split('m')[0]) * 100 + parseInt(d.split('m')[1]),
      raceDate: '2025-06-15',
      isMe: false,
    }))
  }

  // 汎用モック
  if (isField) {
    return Array.from({ length: 10 }, (_, i) => ({
      rank: i + 1,
      userId: `mock_${i}`,
      displayName: anonymize(MOCK_NAMES[i] ?? '', lang, t),
      result: `${18 - i}m${String(50 - i * 3).padStart(2, '0')}`,
      raceDate: '2025-06-15',
      isMe: false,
    }))
  }

  // トラック汎用
  const baseMs = event === '800m' ? 110000 : event === '1500m' ? 225000 : 300000
  return Array.from({ length: 10 }, (_, i) => {
    const ms = baseMs + i * 2000
    const totalSec = ms / 1000
    const min = Math.floor(totalSec / 60)
    const sec = (totalSec % 60).toFixed(2).padStart(5, '0')
    return {
      rank: i + 1,
      userId: `mock_${i}`,
      displayName: anonymize(MOCK_NAMES[i] ?? '', lang, t),
      result: `${min}:${sec}`,
      resultMs: ms,
      raceDate: '2025-06-15',
      isMe: i === 5,
    }
  })
}

// ─── Supabase からのランキング取得 ────────────────────────────────────
// 2026-09-11: 「参加は任意にして、名前は付けられるように」との指示で、race_records/
// profilesへの直接クロスユーザークエリ(かつては本名の頭文字を無断で表示していた)から、
// get_event_ranking() RPC(SECURITY DEFINER)経由に変更。オプトイン済み・表示名を
// 自分で設定したユーザーだけが対象になる(supabase/ranking_opt_in_migration.sql参照)。
// 並び順もRPC側で確定して返るため、ここでのorder byは不要。
async function fetchRankingFromSupabase(event: AthleticsEvent, lang: Language, t: (key: string, opts?: any) => string): Promise<RankingEntry[] | null> {
  try {
    const { data, error } = await supabase.rpc('get_event_ranking', { p_event: event })
    if (error || !data || (data as unknown[]).length === 0) return null

    const myRaw = await AsyncStorage.getItem(RECORDS_KEY)
    const myRecords: RaceRecord[] = myRaw ? JSON.parse(myRaw) : []
    const myPB = myRecords.find(r => r.event === event && r.is_pb)

    return (data as Array<{
      user_id: string
      display_name: string
      result_display: string
      result_ms?: number
      result_cm?: number
      race_date: string
    }>).map((row, i) => ({
      rank: i + 1,
      userId: row.user_id,
      // 自分で決めた表示名をそのまま出す(本名ベースの頭文字匿名化はもう不要 —
      // 参加する時点でランキング用の名前を自分で選んでいるため)
      displayName: row.display_name,
      result: row.result_display,
      resultMs: row.result_ms,
      resultCm: row.result_cm,
      raceDate: row.race_date,
      isMe: myPB?.result_ms === row.result_ms && myPB?.result_display === row.result_display,
    }))
  } catch {
    return null
  }
}

// ─── ランキング行 ─────────────────────────────────────────────────────
const RankRow: React.FC<{ entry: RankingEntry }> = ({ entry }) => {
  const { t } = useTranslation()
  const isTop3 = entry.rank <= 3
  const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32']
  const rankColor = isTop3 ? medalColors[entry.rank - 1] : TEXT.hint

  return (
    <View style={[styles.rankRow, entry.isMe && styles.rankRowMe]}>
      {/* 順位 */}
      <View style={styles.rankNumContainer}>
        {isTop3 ? (
          <Ionicons name="trophy" size={16} color={rankColor} />
        ) : (
          <Text style={[styles.rankNum, { color: rankColor }]}>{entry.rank}</Text>
        )}
      </View>

      {/* 名前 */}
      <View style={styles.rankNameContainer}>
        <Text style={[styles.rankName, entry.isMe && { color: NEON.green }]} numberOfLines={1}>
          {entry.displayName}
        </Text>
        {entry.isMe && (
          <View style={styles.meBadge}>
            <Text style={styles.meBadgeText}>{t('ranking.me')}</Text>
          </View>
        )}
      </View>

      {/* 記録 */}
      <Text style={[
        styles.rankResult,
        entry.isMe && { color: NEON.green },
        isTop3 && { fontWeight: '800' },
      ]}>
        {entry.result}
      </Text>

      {/* 日付 */}
      <Text style={styles.rankDate}>{entry.raceDate.slice(2)}</Text>
    </View>
  )
}

// ─── メイン ─────────────────────────────────────────────────────────────
export default function RankingScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { user, isGuest } = useAuth()
  const navigation = useNavigation()
  useEffect(() => { navigation.setOptions({ title: t('ranking.headerTitle') }) }, [navigation, t, language])

  const [selectedEvent, setSelectedEvent] = useState<AthleticsEvent>('100m')
  const [rankings, setRankings] = useState<RankingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [usedMock, setUsedMock] = useState(false)
  const [activeTab, setActiveTab] = useState<'track' | 'field'>('track')

  // 2026-09-11: 「参加は任意で」の指示で追加。自分がまだランキング参加を
  // 決めていない場合だけ、参加を促すバナーを出す(既に参加中/明示的に
  // 却下済みなら出さない)。null=まだ読み込み中(判定不能なので何も出さない)。
  const [myOptIn, setMyOptIn] = useState<boolean | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  useEffect(() => {
    if (isGuest || !user?.id) { setMyOptIn(false); return }
    getMyRankingSettings(user.id).then(s => setMyOptIn(s.optIn))
    AsyncStorage.getItem(BANNER_DISMISSED_KEY).then(v => setBannerDismissed(v === '1'))
  }, [user?.id, isGuest])

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true)
    AsyncStorage.setItem(BANNER_DISMISSED_KEY, '1').catch(() => {})
  }, [])

  const loadRanking = useCallback(async (event: AthleticsEvent, isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const supabaseData = await fetchRankingFromSupabase(event, language, t)
      if (supabaseData && supabaseData.length > 0) {
        setRankings(supabaseData)
        setUsedMock(false)
      } else {
        setRankings(generateMockRanking(event, language, t))
        setUsedMock(true)
      }
    } catch {
      setRankings(generateMockRanking(event, language, t))
      setUsedMock(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [language, t])

  useEffect(() => {
    loadRanking(selectedEvent)
  }, [selectedEvent, loadRanking])

  const handleEventChange = useCallback((event: AthleticsEvent) => {
    setSelectedEvent(event)
    setRankings([])
  }, [])

  const currentEvents = activeTab === 'track' ? TRACK_EVENTS : FIELD_EVENTS

  // ─── UI ─────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* 参加オプトインバナー: まだ決めていない(参加中でも明示的却下済みでもない)場合のみ表示 */}
      {!isGuest && myOptIn === false && !bannerDismissed && (
        <View style={styles.optInBanner}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <Ionicons name="shield-checkmark-outline" size={16} color={NEON.green} style={{ marginTop: 1 }} />
            <Text style={styles.optInBannerText}>{t('ranking.optInBanner')}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <TouchableOpacity style={styles.optInJoinBtn} onPress={() => router.push('/settings' as any)}>
              <Text style={styles.optInJoinBtnText}>{t('ranking.optInJoinBtn')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.optInDismissBtn} onPress={dismissBanner}>
              <Text style={styles.optInDismissBtnText}>{t('ranking.optInDismissBtn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* お知らせバナー */}
      <View style={styles.infoBanner}>
        <Ionicons name="information-circle-outline" size={15} color={TEXT.secondary} />
        <Text style={styles.infoBannerText}>
          {isGuest ? t('ranking.infoBannerGuest') : t('ranking.infoBanner')}
        </Text>
      </View>

      {/* トラック / フィールド タブ */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'track' && styles.tabActive]}
          onPress={() => {
            setActiveTab('track')
            handleEventChange('100m')
          }}
        >
          <Text style={[styles.tabText, activeTab === 'track' && styles.tabTextActive]}>
            {t('ranking.tabTrack')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'field' && styles.tabActive]}
          onPress={() => {
            setActiveTab('field')
            handleEventChange('走幅跳')
          }}
        >
          <Text style={[styles.tabText, activeTab === 'field' && styles.tabTextActive]}>
            {t('ranking.tabField')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 種目セレクター（横スクロール） */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.eventSelector}
        style={styles.eventSelectorScroll}
      >
        {currentEvents.map(event => (
          <TouchableOpacity
            key={event}
            style={[styles.eventChip, selectedEvent === event && styles.eventChipActive]}
            onPress={() => handleEventChange(event)}
            activeOpacity={0.8}
          >
            <Text style={[styles.eventChipText, selectedEvent === event && styles.eventChipTextActive]}>
              {getEventLabel(event, language)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ランキングタイトル */}
      <View style={styles.rankTitle}>
        <Text style={styles.rankTitleText}>{t('ranking.rankingTitle', { event: getEventLabel(selectedEvent, language) })}</Text>
        {usedMock && (
          <View style={styles.mockBadge}>
            <Text style={styles.mockBadgeText}>{t('ranking.sampleBadge')}</Text>
          </View>
        )}
      </View>

      {/* リスト */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={NEON.green} size="large" />
          <Text style={styles.loadingText}>{t('ranking.loadingText')}</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadRanking(selectedEvent, true)}
              tintColor={NEON.green}
            />
          }
        >
          {/* ヘッダー行 */}
          <View style={styles.listHeader}>
            <Text style={[styles.listHeaderText, { width: 36 }]}>{t('ranking.headerRank')}</Text>
            <Text style={[styles.listHeaderText, { flex: 1 }]}>{t('ranking.headerAthlete')}</Text>
            <Text style={[styles.listHeaderText, { width: 80, textAlign: 'right' }]}>{t('ranking.headerResult')}</Text>
            <Text style={[styles.listHeaderText, { width: 56, textAlign: 'right' }]}>{t('ranking.headerDate')}</Text>
          </View>

          {rankings.map(entry => (
            <RankRow key={`${entry.userId}_${entry.rank}`} entry={entry} />
          ))}

          {rankings.length === 0 && (
            <View style={styles.centered}>
              <Ionicons name="podium-outline" size={48} color={TEXT.hint} />
              <Text style={styles.emptyText}>{t('ranking.emptyText')}</Text>
            </View>
          )}

          <Text style={styles.footerNote}>
            {t('ranking.footerNote')}
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

// ─── スタイル ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000000',
  },
  optInBanner: {
    backgroundColor: 'rgba(34,197,94,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(34,197,94,0.18)',
  },
  optInBannerText: {
    color: TEXT.secondary,
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
  },
  optInJoinBtn: {
    backgroundColor: NEON.green,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  optInJoinBtnText: { color: '#000', fontSize: 12.5, fontWeight: '800' },
  optInDismissBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  optInDismissBtnText: { color: TEXT.hint, fontSize: 12.5, fontWeight: '700' },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#111111',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  infoBannerText: {
    color: TEXT.secondary,
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
  },

  // タブ
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: BRAND,
  },
  tabText: {
    color: TEXT.secondary,
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // 種目セレクター
  eventSelectorScroll: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  eventSelector: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  eventChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  eventChipActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  eventChipText: {
    color: TEXT.secondary,
    fontSize: 13,
    fontWeight: '600',
  },
  eventChipTextActive: {
    color: '#FFFFFF',
  },

  // ランキングタイトル
  rankTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rankTitleText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  mockBadge: {
    backgroundColor: 'rgba(255,149,0,0.15)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,149,0,0.4)',
  },
  mockBadgeText: {
    color: '#FF9500',
    fontSize: 11,
    fontWeight: '700',
  },

  // リスト
  scroll: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 48,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    gap: 8,
  },
  listHeaderText: {
    color: TEXT.hint,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },

  // ランク行
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    gap: 8,
  },
  rankRowMe: {
    backgroundColor: `${BRAND}11`,
    borderLeftWidth: 3,
    borderLeftColor: BRAND,
  },
  rankNumContainer: {
    width: 28,
    alignItems: 'center',
  },
  rankNum: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  rankNameContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  rankName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  meBadge: {
    backgroundColor: `${BRAND}33`,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: `${BRAND}66`,
  },
  meBadgeText: {
    color: NEON.green,
    fontSize: 10,
    fontWeight: '800',
  },
  rankResult: {
    width: 80,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  rankDate: {
    width: 56,
    color: TEXT.hint,
    fontSize: 11,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },

  // ローディング・空状態
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 14,
  },
  loadingText: {
    color: TEXT.secondary,
    fontSize: 14,
    marginTop: 8,
  },
  emptyText: {
    color: TEXT.hint,
    fontSize: 15,
    textAlign: 'center',
  },

  // フッター
  footerNote: {
    color: TEXT.hint,
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    lineHeight: 18,
  },
})

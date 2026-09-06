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
async function fetchRankingFromSupabase(event: AthleticsEvent, lang: Language, t: (key: string, opts?: any) => string): Promise<RankingEntry[] | null> {
  try {
    const isFieldEvent = FIELD_EVENTS.includes(event)
    const baseQuery = supabase
      .from('race_records')
      .select('id, user_id, result_display, result_ms, result_cm, race_date, profiles(name)')
      .eq('event', event)
      .eq('is_pb', true)
    // フィールド種目はresult_cm降順（距離が大きい方が上位）、トラック種目はresult_ms昇順
    const { data, error } = isFieldEvent
      ? await baseQuery.order('result_cm', { ascending: false })
      : await baseQuery.order('result_ms', { ascending: true })
    if (error || !data || (data as unknown[]).length === 0) return null

    const myRaw = await AsyncStorage.getItem(RECORDS_KEY)
    const myRecords: RaceRecord[] = myRaw ? JSON.parse(myRaw) : []
    const myPB = myRecords.find(r => r.event === event && r.is_pb)

    return (data as Array<{
      id: string
      user_id: string
      result_display: string
      result_ms?: number
      result_cm?: number
      race_date: string
      profiles?: { name?: string } | null
    }>).map((row, i) => {
      const rawName: string = (row.profiles as { name?: string } | null)?.name ?? ''
      return {
        rank: i + 1,
        userId: row.user_id,
        displayName: anonymize(rawName, lang, t),
        result: row.result_display,
        resultMs: row.result_ms,
        resultCm: row.result_cm,
        raceDate: row.race_date,
        isMe: myPB?.result_ms === row.result_ms && myPB?.result_display === row.result_display,
      }
    })
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
  const navigation = useNavigation()
  useEffect(() => { navigation.setOptions({ title: t('ranking.headerTitle') }) }, [navigation, t, language])

  const [selectedEvent, setSelectedEvent] = useState<AthleticsEvent>('100m')
  const [rankings, setRankings] = useState<RankingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [usedMock, setUsedMock] = useState(false)
  const [activeTab, setActiveTab] = useState<'track' | 'field'>('track')

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
      {/* お知らせバナー */}
      <View style={styles.infoBanner}>
        <Ionicons name="information-circle-outline" size={15} color={TEXT.secondary} />
        <Text style={styles.infoBannerText}>
          {t('ranking.infoBanner')}
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

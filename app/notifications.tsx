// app/notifications.tsx — 通知・連絡ボックス
import React, { useEffect, useState, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { useTheme } from '../context/ThemeContext'
import { BRAND } from '../lib/theme'
import { fetchTeamEvents, type TeamEventRow } from '../lib/supabaseTeam'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../context/LanguageContext'

// ─────────────────────────────────────────
// 定数
// ─────────────────────────────────────────
const JOINED_KEY   = 'trackmate_team_joined'
const READ_KEY     = 'notif_read_ids'

// アプリからのお知らせ（固定リスト — バージョンアップ時に追記）
// title/bodyは言語依存のためlocales側に移し、ここではid/date/badge/icon/colorのみ持つ
interface AppNotice {
  id:      string
  date:    string   // YYYY-MM-DD
  badge?:  string   // 'NEW' | 'UPDATE' | 'TIP'
  icon:    string
  color:   string
}
const APP_NOTICES: AppNotice[] = [
  { id: 'v1.1.0-team-pro',     date: '2026-05-23', badge: 'NEW',    icon: 'trophy-outline',  color: '#7c3aed' },
  { id: 'v1.0.1-date-fix',     date: '2026-05-14', badge: 'UPDATE', icon: 'calendar-outline', color: '#3b82f6' },
  { id: 'v1.0.1-load-fix',     date: '2026-05-14', badge: 'UPDATE', icon: 'barbell-outline',  color: BRAND },
  { id: 'v1.0.1-injury-model', date: '2026-05-14', badge: 'UPDATE', icon: 'fitness-outline',  color: '#8b5cf6' },
  { id: 'welcome-v1',          date: '2026-04-01', badge: 'TIP',    icon: 'rocket-outline',   color: '#FF9500' },
]

// チームイベント種別の設定（labelは言語依存のためt('notifications.eventTypes.<key>')で解決）
const EVENT_CFG: Record<string, { emoji: string; color: string }> = {
  practice: { emoji: '🏃', color: '#34C759' },
  race:     { emoji: '🏁', color: BRAND     },
  rest:     { emoji: '😴', color: '#5856D6' },
  meeting:  { emoji: '💬', color: '#FF9500' },
  other:    { emoji: '📌', color: '#8E8E93' },
}

// ─────────────────────────────────────────
// ヘルパー
// ─────────────────────────────────────────
function fmtDate(dateStr: string, t: (key: string, opts?: any) => string, lang: 'ja' | 'en'): string {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date(); today.setHours(0,0,0,0)
  const diff  = Math.round((d.getTime() - today.getTime()) / 86400000)
  const JP    = ['日','月','火','水','木','金','土']
  const mmdd  = lang === 'en'
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : `${d.getMonth()+1}/${d.getDate()}(${JP[d.getDay()]})`
  if (diff === 0)  return t('notifications.dateToday', { mmdd })
  if (diff === 1)  return t('notifications.dateTomorrow', { mmdd })
  if (diff === -1) return t('notifications.dateYesterday', { mmdd })
  if (diff > 0)    return t('notifications.dateDaysAfter', { n: diff, mmdd })
  return t('notifications.dateDaysAgo', { n: Math.abs(diff), mmdd })
}

function isWithin3Days(isoStr: string): boolean {
  return Date.now() - new Date(isoStr).getTime() < 3 * 86400000
}

// ─────────────────────────────────────────
// バッジコンポーネント
// ─────────────────────────────────────────
function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ backgroundColor: color + '20', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color, letterSpacing: 0.5 }}>{label}</Text>
    </View>
  )
}

// ─────────────────────────────────────────
// メイン画面
// ─────────────────────────────────────────
export default function NotificationsScreen() {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const { language } = useLanguage()

  const [teamEvents,   setTeamEvents]   = useState<TeamEventRow[]>([])
  const [teamName,     setTeamName]     = useState<string | null>(null)
  const [readIds,      setReadIds]      = useState<Set<string>>(new Set())
  const [loading,      setLoading]      = useState(true)
  const [refreshing,   setRefreshing]   = useState(false)
  const [tab,          setTab]          = useState<'team' | 'app'>('team')

  // 既読IDをロード
  useEffect(() => {
    AsyncStorage.getItem(READ_KEY).then(raw => {
      if (raw) { try { setReadIds(new Set(JSON.parse(raw))) } catch {} }
    }).catch(() => {})
  }, [])

  // チームイベントをロード
  const load = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(JOINED_KEY)
      if (!raw) { setLoading(false); return }
      const joined = JSON.parse(raw)
      if (!joined?.code) { setLoading(false); return }
      setTeamName(joined.name ?? null)
      const evts = await fetchTeamEvents(joined.code)
      setTeamEvents(evts)
    } catch {
      // silently fail
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 画面を開いた時点で全通知を既読にする
  // loading が false になった後 + teamEvents が揃った後に実行する
  useEffect(() => {
    if (loading) return
    const newIds = new Set([
      ...Array.from(readIds),
      ...teamEvents.map(e => e.id),
      ...APP_NOTICES.map(n => n.id),
    ])
    setReadIds(newIds)
    AsyncStorage.setItem(READ_KEY, JSON.stringify(Array.from(newIds))).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, teamEvents])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    load()
  }, [load])

  // チームタブに未読があるか
  const teamUnread = teamEvents.filter(e => isWithin3Days(e.created_at) && !readIds.has(e.id)).length
  const appUnread  = APP_NOTICES.filter(n => isWithin3Days(n.date + 'T00:00:00') && !readIds.has(n.id)).length

  return (
    <SafeAreaView style={[s.root, { backgroundColor: colors.bg }]} edges={['top']}>

      {/* ヘッダー */}
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.text }]}>{t('notifications.headerTitle')}</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* タブ */}
      <View style={[s.tabBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        {(['team', 'app'] as const).map(tabKey => {
          const label = tabKey === 'team' ? t('notifications.tabTeam') : t('notifications.tabApp')
          const count = tabKey === 'team' ? teamUnread : appUnread
          const active = tab === tabKey
          return (
            <TouchableOpacity
              key={tabKey}
              style={[s.tab, active && { borderBottomColor: BRAND, borderBottomWidth: 2 }]}
              onPress={() => setTab(tabKey)}
              activeOpacity={0.7}
            >
              <Text style={[s.tabText, { color: active ? BRAND : colors.textSec }, active && { fontWeight: '700' }]}>
                {label}
              </Text>
              {count > 0 && (
                <View style={s.tabBadge}>
                  <Text style={s.tabBadgeText}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          )
        })}
      </View>

      {/* コンテンツ */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={BRAND} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND} />}
          showsVerticalScrollIndicator={false}
        >
          {tab === 'team' ? (
            <TeamTab events={teamEvents} teamName={teamName} colors={colors} />
          ) : (
            <AppTab notices={APP_NOTICES} colors={colors} />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

// ─────────────────────────────────────────
// チームタブ
// ─────────────────────────────────────────
function TeamTab({
  events, teamName, colors,
}: {
  events: TeamEventRow[]
  teamName: string | null
  colors: ReturnType<typeof useTheme>['colors']
}) {
  const { t } = useTranslation()
  if (!teamName) {
    return (
      <View style={s.empty}>
        <Ionicons name="people-outline" size={48} color={colors.textHint} />
        <Text style={[s.emptyTitle, { color: colors.text }]}>{t('notifications.noTeamTitle')}</Text>
        <Text style={[s.emptyBody, { color: colors.textSec }]}>
          {t('notifications.noTeamBody')}
        </Text>
      </View>
    )
  }

  // 今日以降の予定 + 過去3日以内
  const upcoming = events.filter(e => {
    const daysAgo = (Date.now() - new Date(e.event_date + 'T00:00:00').getTime()) / 86400000
    return daysAgo <= 1 // 昨日以降（今日・未来）
  }).sort((a, b) => a.event_date.localeCompare(b.event_date))

  const past = events.filter(e => {
    const daysAgo = (Date.now() - new Date(e.event_date + 'T00:00:00').getTime()) / 86400000
    return daysAgo > 1
  }).sort((a, b) => b.event_date.localeCompare(a.event_date))

  if (events.length === 0) {
    return (
      <View style={s.empty}>
        <Ionicons name="mail-open-outline" size={48} color={colors.textHint} />
        <Text style={[s.emptyTitle, { color: colors.text }]}>{t('notifications.noEventsTitle')}</Text>
        <Text style={[s.emptyBody, { color: colors.textSec }]}>
          {t('notifications.noEventsBody')}
        </Text>
      </View>
    )
  }

  return (
    <View>
      {/* チーム名 */}
      <View style={[s.teamHeader, { backgroundColor: BRAND + '12', borderColor: BRAND + '30' }]}>
        <Ionicons name="people" size={14} color={BRAND} />
        <Text style={[s.teamHeaderText, { color: BRAND }]}>{teamName}</Text>
      </View>

      {upcoming.length > 0 && (
        <>
          <Text style={[s.sectionLabel, { color: colors.textSec }]}>{t('notifications.upcomingLabel')}</Text>
          {upcoming.map(e => <EventCard key={e.id} event={e} colors={colors} />)}
        </>
      )}

      {past.length > 0 && (
        <>
          <Text style={[s.sectionLabel, { color: colors.textSec, marginTop: upcoming.length ? 20 : 0 }]}>{t('notifications.pastLabel')}</Text>
          {past.map(e => <EventCard key={e.id} event={e} colors={colors} muted />)}
        </>
      )}
    </View>
  )
}

function EventCard({
  event, colors, muted = false,
}: {
  event: TeamEventRow
  colors: ReturnType<typeof useTheme>['colors']
  muted?: boolean
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const cfg  = EVENT_CFG[event.event_type] ?? EVENT_CFG.other
  const cfgLabel = t(`notifications.eventTypes.${EVENT_CFG[event.event_type] ? event.event_type : 'other'}`)
  const isNew = isWithin3Days(event.created_at)

  return (
    <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: muted ? 0.6 : 1 }]}>
      {/* 左カラーバー */}
      <View style={[s.cardBar, { backgroundColor: cfg.color }]} />

      <View style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 14 }}>
        {/* 上段：種別バッジ + 日付 + NEW */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <View style={[s.eventTypeBadge, { backgroundColor: cfg.color + '20' }]}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: cfg.color }}>{cfg.emoji} {cfgLabel}</Text>
          </View>
          <Text style={[s.eventDate, { color: colors.textSec }]}>{fmtDate(event.event_date, t, language)}</Text>
          {isNew && !muted && <Badge label={t('notifications.newBadge')} color="#FF3B30" />}
        </View>

        {/* タイトル */}
        <Text style={[s.cardTitle, { color: colors.text }]}>{event.title}</Text>

        {/* 場所・時間 */}
        {(event.event_time || event.location) && (
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 5 }}>
            {event.event_time ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Ionicons name="time-outline" size={12} color={colors.textSec} />
                <Text style={[s.cardMeta, { color: colors.textSec }]}>{event.event_time}</Text>
              </View>
            ) : null}
            {event.location ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Ionicons name="location-outline" size={12} color={colors.textSec} />
                <Text style={[s.cardMeta, { color: colors.textSec }]}>{event.location}</Text>
              </View>
            ) : null}
          </View>
        )}

        {/* メモ */}
        {event.description ? (
          <Text style={[s.cardBody, { color: colors.textSec }]} numberOfLines={3}>
            {event.description}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

// ─────────────────────────────────────────
// アプリタブ
// ─────────────────────────────────────────
function AppTab({
  notices, colors,
}: {
  notices: AppNotice[]
  colors: ReturnType<typeof useTheme>['colors']
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const BADGE_COLOR: Record<string, string> = {
    NEW:    '#FF3B30',
    UPDATE: '#3b82f6',
    TIP:    '#FF9500',
  }
  // title/bodyはlocalesの配列側から同じidで引く(id順は両言語で一致させてある)
  const noticeContent = t('notifications.notices', { returnObjects: true }) as { id: string; title: string; body: string }[]
  const contentOf = (id: string) => noticeContent.find(c => c.id === id) ?? { title: id, body: '' }

  return (
    <View>
      {notices.map(n => {
        const content = contentOf(n.id)
        return (
        <View key={n.id} style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {/* 左カラーバー */}
          <View style={[s.cardBar, { backgroundColor: n.color }]} />

          <View style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 14 }}>
            {/* アイコン + バッジ + 日付 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <View style={[s.noticeIconWrap, { backgroundColor: n.color + '18' }]}>
                <Ionicons name={n.icon as any} size={15} color={n.color} />
              </View>
              {n.badge && <Badge label={n.badge} color={BADGE_COLOR[n.badge] ?? n.color} />}
              <Text style={[s.eventDate, { color: colors.textSec }]}>
                {new Date(n.date + 'T00:00:00').toLocaleDateString(language === 'en' ? 'en-US' : 'ja-JP', { month: 'long', day: 'numeric' })}
              </Text>
            </View>

            <Text style={[s.cardTitle, { color: colors.text }]}>{content.title}</Text>
            <Text style={[s.cardBody, { color: colors.textSec }]}>{content.body}</Text>
          </View>
        </View>
        )
      })}
    </View>
  )
}

// ─────────────────────────────────────────
// スタイル
// ─────────────────────────────────────────
const s = StyleSheet.create({
  root:           { flex: 1 },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn:        { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle:    { fontSize: 17, fontWeight: '700' },

  tabBar:         { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab:            { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  tabText:        { fontSize: 13, fontWeight: '600' },
  tabBadge:       { backgroundColor: '#FF3B30', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabBadgeText:   { color: '#fff', fontSize: 10, fontWeight: '700' },

  center:         { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty:          { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32, gap: 12 },
  emptyTitle:     { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyBody:      { fontSize: 13, textAlign: 'center', lineHeight: 19 },

  teamHeader:     { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 16, alignSelf: 'flex-start' },
  teamHeaderText: { fontSize: 12, fontWeight: '700' },

  sectionLabel:   { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 },

  card:           { flexDirection: 'row', borderRadius: 18, borderWidth: 1, marginBottom: 10, overflow: 'hidden' },
  cardBar:        { width: 4 },
  cardTitle:      { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  cardBody:       { fontSize: 13, lineHeight: 19, marginTop: 6 },
  cardMeta:       { fontSize: 12 },

  eventTypeBadge: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  eventDate:      { fontSize: 12 },

  noticeIconWrap: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
})

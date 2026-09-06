import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'

import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter } from 'expo-router'
import { BRAND, NEON, TEXT } from '../lib/theme'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { Sounds } from '../lib/sounds'
import AnimatedSection from '../components/AnimatedSection'
import type { TrainingSession, RaceRecord, SleepRecord, CoachNote } from '../types'
import {
  fetchCoachNotifications,
  type TeamMessageRow,
  type CoachNotifType,
} from '../lib/supabaseTeam'
import { supabase } from '../lib/supabase'
import { localDateStr } from '../lib/dateLocal'
import { getSessionTypeLabel } from '../lib/sessionTypeLabels'
import { getCoachVideoRequests, updateCoachVideoRequests, type CoachVideoRequest } from '../lib/coachReqStore'
import { getEventLabel } from '../lib/eventLabels'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../context/LanguageContext'

const JOINED_KEY_CV = 'trackmate_team_joined'


const SESSIONS_KEY  = 'trackmate_sessions'
const RECORDS_KEY   = 'trackmate_race_records'
const SLEEP_KEY     = 'trackmate_sleep'
const TEAM_KEY      = 'trackmate_team'

// ── スケルトン ────────────────────────────────────────────────────
function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: string | number }) {
  const op = useRef(new Animated.Value(0.3)).current
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(op, { toValue: 0.8, duration: 700, useNativeDriver: true }),
      Animated.timing(op, { toValue: 0.3, duration: 700, useNativeDriver: true }),
    ]))
    a.start()
    return () => a.stop()
  }, [op])
  return (
    <Animated.View style={{ height: h, width: w as number, borderRadius: 8, backgroundColor: '#1e2a3a', opacity: op }} />
  )
}

// ── 睡眠品質棒グラフ ─────────────────────────────────────────────
function SleepBar({ score, date }: { score: number; date: string }) {
  const anim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(anim, {
      toValue: score / 10,
      duration: 600,
      useNativeDriver: false,
    }).start()
  }, [score])

  const color = score >= 7 ? NEON.green : score >= 5 ? NEON.amber : BRAND
  const shortDate = date.slice(5) // MM-DD

  return (
    <View style={fixedStyles.sleepBarWrap}>
      <View style={fixedStyles.sleepBarTrack}>
        <Animated.View
          style={[
            fixedStyles.sleepBarFill,
            {
              height: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              backgroundColor: color,
            },
          ]}
        />
      </View>
      <Text style={fixedStyles.sleepBarScore}>{score}</Text>
      <Text style={fixedStyles.sleepBarDate}>{shortDate}</Text>
    </View>
  )
}

// ── PB グリッドアイテム ──────────────────────────────────────────
function PbItem({ event, display }: { event: string; display: string }) {
  return (
    <View style={fixedStyles.pbItem}>
      <Text style={fixedStyles.pbEvent}>{event}</Text>
      <Text style={fixedStyles.pbValue}>{display}</Text>
    </View>
  )
}

// ══════════════════════════════════════════════════════════════════
// メイン
// ══════════════════════════════════════════════════════════════════
// ── 通知ヘルパー ──────────────────────────────────────────────────
function parseNotifType(content: string): CoachNotifType {
  if (content.startsWith('[ABSENCE]')) return 'absence'
  if (content.startsWith('[VIDEO]')) return 'video'
  if (content.startsWith('[RISK_ALERT]')) return 'risk_alert'
  return 'message'
}

function notifIcon(type: CoachNotifType): string {
  const map: Record<CoachNotifType, string> = {
    absence: '😴', video: '🎥', risk_alert: '🚨', message: '💬',
  }
  return map[type]
}

function notifLabel(type: CoachNotifType, playerName: string, t: (key: string, opts?: any) => string): string {
  return t(`coachView.notifLabels.${type}`, { name: playerName })
}

function timeAgo(iso: string, t: (key: string, opts?: any) => string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diffMs / 60000)
  const hours = Math.floor(diffMs / 3600000)
  const days  = Math.floor(diffMs / 86400000)
  if (mins < 1)  return t('coachView.timeAgo.justNow')
  if (mins < 60) return t('coachView.timeAgo.minutesAgo', { n: mins })
  if (hours < 24) return t('coachView.timeAgo.hoursAgo', { n: hours })
  return t('coachView.timeAgo.daysAgo', { n: days })
}

function extractPlayerName(content: string, t: (key: string) => string): string {
  // "[TYPE] playerName が..." → first word before が
  // (通知本文は他画面で生成される固定の日本語テンプレート文なので、
  //  抽出用の正規表現自体は表示言語に関わらず変更不要)
  const body = content.replace(/^\[[A-Z_]+\]\s*/, '')
  const m = body.match(/^([^\sがを（]+)/)
  return m ? m[1] : t('coachView.defaultPlayerName')
}

// SleepBar/PbItem専用（常に暗色カード配色で固定のため colors 不要）
const fixedStyles = StyleSheet.create({
  pbItem: {
    backgroundColor: 'rgba(255,149,0,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,149,0,0.25)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: '45%',
    flex: 1,
    alignItems: 'center',
  },
  pbEvent: { color: TEXT.secondary, fontSize: 11, fontWeight: '600', marginBottom: 4 },
  pbValue: { color: NEON.amber, fontSize: 18, fontWeight: '800' },
  sleepBarWrap: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    height: 100,
    justifyContent: 'flex-end',
  },
  sleepBarTrack: {
    width: '100%',
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    maxHeight: 72,
  },
  sleepBarFill: {
    width: '100%',
    borderRadius: 4,
  },
  sleepBarScore: { color: TEXT.secondary, fontSize: 10, fontWeight: '700' },
  sleepBarDate: { color: TEXT.hint, fontSize: 9 },
})

export default function CoachViewScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [loading, setLoading] = useState(true)

  // データ
  const [recentSessions, setRecentSessions] = useState<TrainingSession[]>([])
  const [pbList, setPbList] = useState<{ event: string; display: string }[]>([])
  const [sleepData, setSleepData] = useState<{ date: string; score: number }[]>([])
  const [coachNotes, setCoachNotes] = useState<CoachNote[]>([])
  const [videoRequests, setVideoRequests] = useState<CoachVideoRequest[]>([])

  // サマリー
  const [sessionCount, setSessionCount] = useState(0)
  const [avgFatigue, setAvgFatigue] = useState(0)

  // コーチ通知
  const [coachNotifs, setCoachNotifs] = useState<TeamMessageRow[]>([])
  const [teamCodeRef, setTeamCodeRef] = useState<string | null>(null)

  const loadNotifs = useCallback(async (code: string) => {
    try {
      const notifs = await fetchCoachNotifications(code)
      setCoachNotifs(notifs)
    } catch {}
  }, [])

  // フォーカス時に通知を再取得
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(JOINED_KEY_CV).then(raw => {
        if (!raw) return
        try {
          const joined = JSON.parse(raw)
          if (joined?.code) {
            setTeamCodeRef(joined.code)
            loadNotifs(joined.code)
          }
        } catch {}
      }).catch(() => {})
    }, [loadNotifs])
  )

  // Realtime 購読
  useEffect(() => {
    if (!teamCodeRef) return
    const channel = supabase
      .channel(`coach-notifs-${teamCodeRef}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'team_messages',
          filter: `team_code=eq.${teamCodeRef}`,
        },
        (payload) => {
          const row = payload.new as TeamMessageRow
          if (row.author_name === '__system__') {
            setCoachNotifs(prev => [row, ...prev])
          }
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [teamCodeRef])

  const notifUnreadCount = coachNotifs.filter(n => {
    return Date.now() - new Date(n.created_at).getTime() < 24 * 60 * 60 * 1000
  }).length

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rawSessions, rawRecords, rawSleep, rawTeam, videoReqs] = await Promise.all([
        AsyncStorage.getItem(SESSIONS_KEY),
        AsyncStorage.getItem(RECORDS_KEY),
        AsyncStorage.getItem(SLEEP_KEY),
        AsyncStorage.getItem(TEAM_KEY),
        getCoachVideoRequests(),
      ])

      // ── 過去7日のセッション ──────────────────────────────────────
      try {
        if (rawSessions) {
          const all: TrainingSession[] = JSON.parse(rawSessions)
          // UTC混在を避けるため日付文字列同士で比較
          const cutoff = new Date()
          cutoff.setDate(cutoff.getDate() - 7)
          cutoff.setHours(0, 0, 0, 0)
          const cutoffStr = localDateStr(cutoff)
          const week = all.filter(s => s.session_date.slice(0, 10) >= cutoffStr)
          setRecentSessions(week)
          setSessionCount(week.length)
          if (week.length > 0) {
            const avg = week.reduce((sum, s) => sum + s.fatigue_level, 0) / week.length
            setAvgFatigue(Math.round(avg * 10) / 10)
          }
        }
      } catch {}

      // ── PB一覧 ──────────────────────────────────────────────────
      try {
        if (rawRecords) {
          const all: RaceRecord[] = JSON.parse(rawRecords)
          const pbMap: Record<string, string> = {}
          all.filter(r => r.is_pb).forEach(r => {
            pbMap[r.event] = r.result_display
          })
          setPbList(Object.entries(pbMap).map(([event, display]) => ({ event, display })))
        }
      } catch {}

      // ── 過去7日の睡眠 ───────────────────────────────────────────
      try {
        if (rawSleep) {
          const all: SleepRecord[] = JSON.parse(rawSleep)
          // UTC混在を避けるため日付文字列同士で比較（セッションの過去7日フィルタと同様）
          const sleepCutoff = new Date()
          sleepCutoff.setDate(sleepCutoff.getDate() - 7)
          sleepCutoff.setHours(0, 0, 0, 0)
          const sleepCutoffStr = localDateStr(sleepCutoff)
          const week = all
            .filter(s => s.sleep_date.slice(0, 10) >= sleepCutoffStr)
            .sort((a, b) => a.sleep_date.localeCompare(b.sleep_date))
            .slice(-7)
          setSleepData(week.map(s => ({ date: s.sleep_date, score: s.quality_score })))
        }
      } catch {}

      // ── コーチノート ─────────────────────────────────────────────
      try {
        if (rawTeam) {
          const team = JSON.parse(rawTeam)
          if (Array.isArray(team.coach_notes)) {
            const pinned = (team.coach_notes as CoachNote[]).filter(n => n.pinned)
            const others = (team.coach_notes as CoachNote[]).filter(n => !n.pinned)
            setCoachNotes([...pinned, ...others].slice(0, 5))
          }
        }
      } catch {}

      // ── 送られた動画 ─────────────────────────────────────────────
      setVideoRequests(videoReqs)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const fatigueColor = avgFatigue >= 7 ? BRAND : avgFatigue >= 5 ? NEON.amber : NEON.green

  const markVideoChecked = async (id: string) => {
    const updated = await updateCoachVideoRequests(current =>
      current.map(r => r.id === id ? { ...r, checked: true } : r)
    )
    setVideoRequests(updated)
  }

  const deleteVideoRequest = async (id: string) => {
    const updated = await updateCoachVideoRequests(current => current.filter(r => r.id !== id))
    setVideoRequests(updated)
  }

  const uncheckedCount = videoRequests.filter(r => !r.checked).length

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={styles.safe}>

        {/* ヘッダー */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { Sounds.tap(); router.back() }} style={styles.backBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} accessibilityLabel={t('coachView.back')}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('coachView.title')}</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── 通知 ── */}
          <AnimatedSection delay={0} type="fade-up">
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="notifications-outline" size={18} color={BRAND} />
                <Text style={styles.cardTitle}>{t('coachView.notifications.title')}</Text>
                {notifUnreadCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{notifUnreadCount}</Text>
                  </View>
                )}
                <Text style={styles.cardSub}>{t('coachView.notifications.period')}</Text>
              </View>
              {coachNotifs.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="notifications-outline" size={36} color={TEXT.hint} />
                  <Text style={styles.emptyText}>{t('coachView.notifications.empty')}</Text>
                  <Text style={styles.emptyHint}>{t('coachView.notifications.emptyHint')}</Text>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  {coachNotifs.map(n => {
                    const type = parseNotifType(n.content)
                    const playerName = extractPlayerName(n.content, t)
                    const isNew = Date.now() - new Date(n.created_at).getTime() < 24 * 60 * 60 * 1000
                    return (
                      <View key={n.id} style={[styles.notifCard, isNew && styles.notifCardNew]}>
                        <Text style={styles.notifIcon}>{notifIcon(type)}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.notifText}>{notifLabel(type, playerName, t)}</Text>
                          <Text style={styles.notifTime}>{timeAgo(n.created_at, t)}</Text>
                        </View>
                        {isNew && (
                          <View style={styles.newBadge}>
                            <Text style={styles.newBadgeText}>NEW</Text>
                          </View>
                        )}
                      </View>
                    )
                  })}
                </View>
              )}
            </View>
          </AnimatedSection>

          {/* ── 今週の練習サマリー ── */}
          <AnimatedSection delay={0} type="fade-up">
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="barbell-outline" size={18} color={NEON.blue} />
                <Text style={styles.cardTitle}>{t('coachView.weekSummary.title')}</Text>
                <Text style={styles.cardSub}>{t('coachView.weekSummary.period')}</Text>
              </View>
              {loading ? (
                <View style={{ gap: 8 }}>
                  <Skeleton h={48} />
                  <Skeleton h={48} />
                </View>
              ) : (
                <View style={styles.summaryRow}>
                  <View style={styles.summaryItem}>
                    <Text style={[styles.summaryNum, { color: NEON.blue }]}>{sessionCount}</Text>
                    <Text style={styles.summaryLabel}>{t('coachView.weekSummary.sessions')}</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryItem}>
                    <Text style={[styles.summaryNum, { color: fatigueColor }]}>{sessionCount > 0 ? avgFatigue : '—'}</Text>
                    <Text style={styles.summaryLabel}>{t('coachView.weekSummary.avgFatigue')}</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryItem}>
                    <Text style={[styles.summaryNum, { color: NEON.green }]}>
                      {sessionCount === 0 ? '—' : sessionCount >= 5 ? '◎' : sessionCount >= 3 ? '○' : '△'}
                    </Text>
                    <Text style={styles.summaryLabel}>{t('coachView.weekSummary.frequency')}</Text>
                  </View>
                </View>
              )}
              {!loading && recentSessions.length > 0 && (
                <View style={{ gap: 6, marginTop: 4 }}>
                  {recentSessions.slice(0, 3).map(s => (
                    <View key={s.id} style={styles.sessionRow}>
                      <View style={[styles.sessionDot, {
                        backgroundColor: s.fatigue_level >= 7 ? BRAND : s.fatigue_level >= 5 ? NEON.amber : NEON.green,
                      }]} />
                      <Text style={styles.sessionDate}>{s.session_date.slice(5)}</Text>
                      <Text style={styles.sessionType}>{getSessionTypeLabel(s.session_type, language)}</Text>
                      <Text style={styles.sessionFatigue}>{t('coachView.weekSummary.fatigueLabel', { n: s.fatigue_level })}</Text>
                    </View>
                  ))}
                  {recentSessions.length > 3 && (
                    <Text style={styles.moreText}>{t('coachView.weekSummary.moreCount', { n: recentSessions.length - 3 })}</Text>
                  )}
                </View>
              )}
            </View>
          </AnimatedSection>

          {/* ── PB一覧 ── */}
          <AnimatedSection delay={80} type="fade-up">
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="trophy-outline" size={18} color={NEON.amber} />
                <Text style={styles.cardTitle}>{t('coachView.pb.title')}</Text>
              </View>
              {loading ? (
                <View style={{ gap: 8 }}>
                  <Skeleton h={40} />
                  <Skeleton h={40} />
                </View>
              ) : pbList.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="trophy-outline" size={36} color={TEXT.hint} />
                  <Text style={styles.emptyText}>{t('coachView.pb.empty')}</Text>
                </View>
              ) : (
                <View style={styles.pbGrid}>
                  {pbList.map(pb => (
                    <PbItem key={pb.event} event={getEventLabel(pb.event, language)} display={pb.display} />
                  ))}
                </View>
              )}
            </View>
          </AnimatedSection>

          {/* ── 睡眠品質トレンド ── */}
          <AnimatedSection delay={160} type="fade-up">
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="moon-outline" size={18} color={NEON.blue} />
                <Text style={styles.cardTitle}>{t('coachView.sleep.title')}</Text>
                <Text style={styles.cardSub}>{t('coachView.sleep.period')}</Text>
              </View>
              {loading ? (
                <Skeleton h={100} />
              ) : sleepData.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="moon-outline" size={36} color={TEXT.hint} />
                  <Text style={styles.emptyText}>{t('coachView.sleep.empty')}</Text>
                </View>
              ) : (
                <>
                  <View style={styles.sleepChartArea}>
                    {sleepData.map(d => (
                      <SleepBar key={d.date} score={d.score} date={d.date} />
                    ))}
                  </View>
                  {sleepData.length > 0 && (
                    <View style={styles.sleepLegend}>
                      {[
                        { key: 'good', color: NEON.green },
                        { key: 'normal', color: NEON.amber },
                        { key: 'caution', color: BRAND },
                      ].map(l => (
                        <View key={l.key} style={styles.legendItem}>
                          <View style={[styles.legendDot, { backgroundColor: l.color }]} />
                          <Text style={styles.legendText}>{t(`coachView.sleep.legend.${l.key}`)}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </>
              )}
            </View>
          </AnimatedSection>

          {/* ── 送られた動画 ── */}
          <AnimatedSection delay={200} type="fade-up">
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="videocam-outline" size={18} color={NEON.green} />
                <Text style={styles.cardTitle}>{t('coachView.videos.title')}</Text>
                {uncheckedCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{uncheckedCount}</Text>
                  </View>
                )}
              </View>

              {loading ? (
                <View style={{ gap: 8 }}>
                  <Skeleton h={80} />
                  <Skeleton h={80} />
                </View>
              ) : videoRequests.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="videocam-outline" size={36} color={TEXT.hint} />
                  <Text style={styles.emptyText}>{t('coachView.videos.empty')}</Text>
                  <Text style={styles.emptyHint}>{t('coachView.videos.emptyHint')}</Text>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {videoRequests.map(req => (
                    <View
                      key={req.id}
                      style={[styles.videoCard, !req.checked && styles.videoCardNew]}
                    >
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        {/* サムネイル */}
                        <View style={styles.thumbWrap}>
                          {req.thumbnailUri
                            ? <Image source={{ uri: req.thumbnailUri }} style={styles.thumb} />
                            : <View style={[styles.thumb, { backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }]}>
                                <Ionicons name="film-outline" size={24} color={TEXT.hint} />
                              </View>
                          }
                          {!req.checked && <View style={styles.newDot} />}
                        </View>

                        {/* 情報 */}
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            {req.event ? (
                              <View style={styles.eventBadge}>
                                <Text style={styles.eventBadgeText}>{getEventLabel(req.event, language)}</Text>
                              </View>
                            ) : null}
                            {!req.checked && (
                              <View style={styles.newBadge}>
                                <Text style={styles.newBadgeText}>NEW</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.videoMessage} numberOfLines={2}>
                            {req.message || t('coachView.videos.noMessage')}
                          </Text>
                          <Text style={styles.videoDate}>
                            {new Date(req.sentAt).toLocaleDateString(language === 'en' ? 'en-US' : 'ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
                      </View>

                      {/* アクション */}
                      <View style={styles.videoActions}>
                        {!req.checked && (
                          <TouchableOpacity
                            style={styles.checkedBtn}
                            onPress={() => markVideoChecked(req.id)}
                            activeOpacity={0.8}
                          >
                            <Ionicons name="checkmark" size={14} color="#fff" />
                            <Text style={styles.checkedBtnText}>{t('coachView.videos.markChecked')}</Text>
                          </TouchableOpacity>
                        )}
                        {req.checked && (
                          <Text style={styles.checkedLabel}>{t('coachView.videos.checkedLabel')}</Text>
                        )}
                        <TouchableOpacity
                          style={styles.deleteBtn}
                          onPress={() => deleteVideoRequest(req.id)}
                          activeOpacity={0.8}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityLabel={t('coachView.videos.deleteAccessibility')}
                        >
                          <Ionicons name="trash-outline" size={14} color="#ef4444" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </AnimatedSection>

          {/* ── コーチメモ ── */}
          <AnimatedSection delay={240} type="fade-up">
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="chatbox-outline" size={18} color={NEON.amber} />
                <Text style={styles.cardTitle}>{t('coachView.notes.title')}</Text>
                <Text style={styles.cardSub}>{t('coachView.notes.latestCount', { n: coachNotes.length })}</Text>
              </View>
              {loading ? (
                <View style={{ gap: 8 }}>
                  <Skeleton h={50} />
                  <Skeleton h={50} />
                </View>
              ) : coachNotes.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="chatbox-outline" size={36} color={TEXT.hint} />
                  <Text style={styles.emptyText}>{t('coachView.notes.empty')}</Text>
                  <Text style={styles.emptyHint}>{t('coachView.notes.emptyHint')}</Text>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  {coachNotes.map(n => (
                    <View
                      key={n.id}
                      style={[styles.noteCard, n.pinned && styles.noteCardPinned]}
                    >
                      <View style={styles.noteHeader}>
                        <Text style={styles.noteDate}>{n.date}</Text>
                        {n.pinned && (
                          <Ionicons name="pin" size={14} color={NEON.amber} />
                        )}
                      </View>
                      <Text style={styles.noteContent}>{n.content}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </AnimatedSection>

        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  // ↓ ここから下のカード群は常に暗色カード(#111111)デザインで固定（team-invite/ai-diagnosis等と同じ意図的な配色）
  card: {
    backgroundColor: '#111111',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 16,
    gap: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1 },
  cardSub: { color: TEXT.hint, fontSize: 11 },

  // サマリー
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  summaryNum: { fontSize: 32, fontWeight: '900', lineHeight: 36 },
  summaryLabel: { color: TEXT.hint, fontSize: 11, marginTop: 4, textAlign: 'center' },
  summaryDivider: { width: 1, height: 48, backgroundColor: 'rgba(255,255,255,0.08)' },

  // セッション一覧
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sessionDot: { width: 8, height: 8, borderRadius: 4 },
  sessionDate: { color: TEXT.secondary, fontSize: 12, width: 34, fontWeight: '600' },
  sessionType: { color: '#fff', fontSize: 13, flex: 1 },
  sessionFatigue: { color: TEXT.hint, fontSize: 11 },
  moreText: { color: TEXT.hint, fontSize: 12, textAlign: 'center', marginTop: 2 },

  // PB
  pbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  // 睡眠グラフ
  sleepChartArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 100,
    gap: 6,
    paddingTop: 8,
  },
  sleepLegend: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: TEXT.hint, fontSize: 11 },

  // コーチメモ
  noteCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(74,159,255,0.12)',
    padding: 12,
  },
  noteCardPinned: {
    borderColor: 'rgba(255,149,0,0.35)',
    backgroundColor: 'rgba(255,149,0,0.06)',
  },
  noteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  noteDate: { color: TEXT.hint, fontSize: 11 },
  noteContent: { color: TEXT.secondary, fontSize: 14, lineHeight: 20 },

  // 空状態
  empty: { alignItems: 'center', paddingVertical: 20, gap: 8 },
  emptyText: { color: TEXT.secondary, fontSize: 13 },
  emptyHint: { color: TEXT.hint, fontSize: 11, textAlign: 'center', lineHeight: 18 },

  // 通知カード
  notifCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 12,
  },
  notifCardNew: {
    borderColor: 'rgba(255,59,48,0.35)',
    backgroundColor: 'rgba(255,59,48,0.05)',
  },
  notifIcon: { fontSize: 22, width: 28, textAlign: 'center' },
  notifText: { color: TEXT.secondary, fontSize: 13, lineHeight: 18 },
  notifTime: { color: TEXT.hint, fontSize: 11, marginTop: 2 },

  // バッジ（未確認数）
  badge: { backgroundColor: '#ef4444', borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  // 動画カード
  videoCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 12,
    gap: 10,
  },
  videoCardNew: {
    borderColor: 'rgba(74,222,128,0.4)',
    backgroundColor: 'rgba(74,222,128,0.05)',
  },
  thumbWrap: { position: 'relative' },
  thumb: { width: 80, height: 56, borderRadius: 8, backgroundColor: '#1e293b' },
  newDot: { position: 'absolute', top: -4, right: -4, width: 12, height: 12, borderRadius: 6, backgroundColor: '#ef4444', borderWidth: 2, borderColor: '#111111' },
  eventBadge: { backgroundColor: 'rgba(74,222,128,0.15)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  eventBadgeText: { color: NEON.green, fontSize: 11, fontWeight: '700' },
  newBadge: { backgroundColor: '#ef4444', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  newBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  videoMessage: { color: TEXT.secondary, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  videoDate: { color: TEXT.hint, fontSize: 11 },
  videoActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  checkedBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: NEON.green + '22', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: NEON.green + '44' },
  checkedBtnText: { color: NEON.green, fontSize: 12, fontWeight: '700' },
  checkedLabel: { color: TEXT.hint, fontSize: 12 },
  deleteBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(239,68,68,0.1)', alignItems: 'center', justifyContent: 'center' },
})

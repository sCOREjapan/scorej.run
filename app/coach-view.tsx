import React, { useState, useEffect, useRef, useCallback } from 'react'
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
import { Sounds } from '../lib/sounds'
import AnimatedSection from '../components/AnimatedSection'
import type { TrainingSession, RaceRecord, SleepRecord, CoachNote } from '../types'
import {
  fetchCoachNotifications,
  type TeamMessageRow,
  type CoachNotifType,
} from '../lib/supabaseTeam'
import { supabase } from '../lib/supabase'

const JOINED_KEY_CV = 'trackmate_team_joined'


const SESSIONS_KEY  = 'trackmate_sessions'
const RECORDS_KEY   = 'trackmate_race_records'
const SLEEP_KEY     = 'trackmate_sleep'
const TEAM_KEY      = 'trackmate_team'
const COACH_REQ_KEY = 'trackmate_coach_video_requests'

type CoachVideoRequest = {
  id:           string
  videoUri:     string
  thumbnailUri: string
  message:      string
  event:        string
  sentAt:       string
  checked?:     boolean
}

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
    <View style={styles.sleepBarWrap}>
      <View style={styles.sleepBarTrack}>
        <Animated.View
          style={[
            styles.sleepBarFill,
            {
              height: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              backgroundColor: color,
            },
          ]}
        />
      </View>
      <Text style={styles.sleepBarScore}>{score}</Text>
      <Text style={styles.sleepBarDate}>{shortDate}</Text>
    </View>
  )
}

// ── PB グリッドアイテム ──────────────────────────────────────────
function PbItem({ event, display }: { event: string; display: string }) {
  return (
    <View style={styles.pbItem}>
      <Text style={styles.pbEvent}>{event}</Text>
      <Text style={styles.pbValue}>{display}</Text>
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

function notifLabel(type: CoachNotifType, playerName: string): string {
  switch (type) {
    case 'absence':    return `${playerName}が休みを報告しました`
    case 'video':      return `${playerName}がフォーム分析を送信しました`
    case 'risk_alert': return `${playerName}の怪我リスクが高くなっています`
    case 'message':    return `${playerName}がメッセージを送りました`
  }
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diffMs / 60000)
  const hours = Math.floor(diffMs / 3600000)
  const days  = Math.floor(diffMs / 86400000)
  if (mins < 1)  return 'たった今'
  if (mins < 60) return `${mins}分前`
  if (hours < 24) return `${hours}時間前`
  return `${days}日前`
}

function extractPlayerName(content: string): string {
  // "[TYPE] playerName が..." → first word before が
  const body = content.replace(/^\[[A-Z_]+\]\s*/, '')
  const m = body.match(/^([^\sがを（]+)/)
  return m ? m[1] : '選手'
}

export default function CoachViewScreen() {
  const router = useRouter()
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
        const joined = JSON.parse(raw)
        if (joined?.code) {
          setTeamCodeRef(joined.code)
          loadNotifs(joined.code)
        }
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
      const [rawSessions, rawRecords, rawSleep, rawTeam, rawVideoReqs] = await Promise.all([
        AsyncStorage.getItem(SESSIONS_KEY),
        AsyncStorage.getItem(RECORDS_KEY),
        AsyncStorage.getItem(SLEEP_KEY),
        AsyncStorage.getItem(TEAM_KEY),
        AsyncStorage.getItem(COACH_REQ_KEY),
      ])

      // ── 過去7日のセッション ──────────────────────────────────────
      if (rawSessions) {
        const all: TrainingSession[] = JSON.parse(rawSessions)
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 7)
        const week = all.filter(s => new Date(s.session_date) >= cutoff)
        setRecentSessions(week)
        setSessionCount(week.length)
        if (week.length > 0) {
          const avg = week.reduce((sum, s) => sum + s.fatigue_level, 0) / week.length
          setAvgFatigue(Math.round(avg * 10) / 10)
        }
      }

      // ── PB一覧 ──────────────────────────────────────────────────
      if (rawRecords) {
        const all: RaceRecord[] = JSON.parse(rawRecords)
        const pbMap: Record<string, string> = {}
        all.filter(r => r.is_pb).forEach(r => {
          pbMap[r.event] = r.result_display
        })
        setPbList(Object.entries(pbMap).map(([event, display]) => ({ event, display })))
      }

      // ── 過去7日の睡眠 ───────────────────────────────────────────
      if (rawSleep) {
        const all: SleepRecord[] = JSON.parse(rawSleep)
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 7)
        const week = all
          .filter(s => new Date(s.sleep_date) >= cutoff)
          .sort((a, b) => a.sleep_date.localeCompare(b.sleep_date))
          .slice(-7)
        setSleepData(week.map(s => ({ date: s.sleep_date, score: s.quality_score })))
      }

      // ── コーチノート ─────────────────────────────────────────────
      if (rawTeam) {
        const team = JSON.parse(rawTeam)
        if (Array.isArray(team.coach_notes)) {
          const pinned = (team.coach_notes as CoachNote[]).filter(n => n.pinned)
          const others = (team.coach_notes as CoachNote[]).filter(n => !n.pinned)
          setCoachNotes([...pinned, ...others].slice(0, 5))
        }
      }

      // ── 送られた動画 ─────────────────────────────────────────────
      if (rawVideoReqs) {
        setVideoRequests(JSON.parse(rawVideoReqs))
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const fatigueColor = avgFatigue >= 7 ? BRAND : avgFatigue >= 5 ? NEON.amber : NEON.green

  const markVideoChecked = async (id: string) => {
    const updated = videoRequests.map(r => r.id === id ? { ...r, checked: true } : r)
    setVideoRequests(updated)
    await AsyncStorage.setItem(COACH_REQ_KEY, JSON.stringify(updated)).catch(() => {})
  }

  const deleteVideoRequest = async (id: string) => {
    const updated = videoRequests.filter(r => r.id !== id)
    setVideoRequests(updated)
    await AsyncStorage.setItem(COACH_REQ_KEY, JSON.stringify(updated)).catch(() => {})
  }

  const uncheckedCount = videoRequests.filter(r => !r.checked).length

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
      <SafeAreaView style={styles.safe}>

        {/* ヘッダー */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { Sounds.tap(); router.back() }} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={TEXT.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>コーチビュー</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── 通知 ── */}
          <AnimatedSection delay={0} type="fade-up">
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="notifications-outline" size={18} color={BRAND} />
                <Text style={styles.cardTitle}>通知</Text>
                {notifUnreadCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{notifUnreadCount}</Text>
                  </View>
                )}
                <Text style={styles.cardSub}>過去7日間</Text>
              </View>
              {coachNotifs.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="notifications-outline" size={36} color={TEXT.hint} />
                  <Text style={styles.emptyText}>通知はまだありません</Text>
                  <Text style={styles.emptyHint}>選手がアクションを起こすとここに表示されます</Text>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  {coachNotifs.map(n => {
                    const type = parseNotifType(n.content)
                    const playerName = extractPlayerName(n.content)
                    const isNew = Date.now() - new Date(n.created_at).getTime() < 24 * 60 * 60 * 1000
                    return (
                      <View key={n.id} style={[styles.notifCard, isNew && styles.notifCardNew]}>
                        <Text style={styles.notifIcon}>{notifIcon(type)}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.notifText}>{notifLabel(type, playerName)}</Text>
                          <Text style={styles.notifTime}>{timeAgo(n.created_at)}</Text>
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
                <Text style={styles.cardTitle}>今週の練習サマリー</Text>
                <Text style={styles.cardSub}>過去7日間</Text>
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
                    <Text style={styles.summaryLabel}>セッション数</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryItem}>
                    <Text style={[styles.summaryNum, { color: fatigueColor }]}>{sessionCount > 0 ? avgFatigue : '—'}</Text>
                    <Text style={styles.summaryLabel}>疲労度 平均</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryItem}>
                    <Text style={[styles.summaryNum, { color: NEON.green }]}>
                      {sessionCount === 0 ? '—' : sessionCount >= 5 ? '◎' : sessionCount >= 3 ? '○' : '△'}
                    </Text>
                    <Text style={styles.summaryLabel}>頻度評価</Text>
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
                      <Text style={styles.sessionType}>{s.session_type}</Text>
                      <Text style={styles.sessionFatigue}>疲労 {s.fatigue_level}/10</Text>
                    </View>
                  ))}
                  {recentSessions.length > 3 && (
                    <Text style={styles.moreText}>+{recentSessions.length - 3}件</Text>
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
                <Text style={styles.cardTitle}>PB一覧</Text>
              </View>
              {loading ? (
                <View style={{ gap: 8 }}>
                  <Skeleton h={40} />
                  <Skeleton h={40} />
                </View>
              ) : pbList.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="trophy-outline" size={36} color={TEXT.hint} />
                  <Text style={styles.emptyText}>PB記録がまだありません</Text>
                </View>
              ) : (
                <View style={styles.pbGrid}>
                  {pbList.map(pb => (
                    <PbItem key={pb.event} event={pb.event} display={pb.display} />
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
                <Text style={styles.cardTitle}>睡眠品質トレンド</Text>
                <Text style={styles.cardSub}>過去7日間</Text>
              </View>
              {loading ? (
                <Skeleton h={100} />
              ) : sleepData.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="moon-outline" size={36} color={TEXT.hint} />
                  <Text style={styles.emptyText}>睡眠データがまだありません</Text>
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
                        { label: '良好 (7+)', color: NEON.green },
                        { label: '普通 (5-6)', color: NEON.amber },
                        { label: '要注意 (～4)', color: BRAND },
                      ].map(l => (
                        <View key={l.label} style={styles.legendItem}>
                          <View style={[styles.legendDot, { backgroundColor: l.color }]} />
                          <Text style={styles.legendText}>{l.label}</Text>
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
                <Text style={styles.cardTitle}>送られた動画</Text>
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
                  <Text style={styles.emptyText}>まだ動画が届いていません</Text>
                  <Text style={styles.emptyHint}>選手が「コーチに送る」から動画を送ると{'\n'}ここに表示されます</Text>
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
                                <Text style={styles.eventBadgeText}>{req.event}</Text>
                              </View>
                            ) : null}
                            {!req.checked && (
                              <View style={styles.newBadge}>
                                <Text style={styles.newBadgeText}>NEW</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.videoMessage} numberOfLines={2}>
                            {req.message || '（メモなし）'}
                          </Text>
                          <Text style={styles.videoDate}>
                            {new Date(req.sentAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
                            <Text style={styles.checkedBtnText}>確認済み</Text>
                          </TouchableOpacity>
                        )}
                        {req.checked && (
                          <Text style={styles.checkedLabel}>✓ 確認済み</Text>
                        )}
                        <TouchableOpacity
                          style={styles.deleteBtn}
                          onPress={() => deleteVideoRequest(req.id)}
                          activeOpacity={0.8}
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
                <Text style={styles.cardTitle}>コーチメモ</Text>
                <Text style={styles.cardSub}>最新{coachNotes.length}件</Text>
              </View>
              {loading ? (
                <View style={{ gap: 8 }}>
                  <Skeleton h={50} />
                  <Skeleton h={50} />
                </View>
              ) : coachNotes.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="chatbox-outline" size={36} color={TEXT.hint} />
                  <Text style={styles.emptyText}>コーチメモがまだありません</Text>
                  <Text style={styles.emptyHint}>チーム画面から追加できます</Text>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: TEXT.primary, fontSize: 18, fontWeight: '800' },
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
  cardTitle: { color: TEXT.primary, fontSize: 15, fontWeight: '700', flex: 1 },
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
  sessionType: { color: TEXT.primary, fontSize: 13, flex: 1 },
  sessionFatigue: { color: TEXT.hint, fontSize: 11 },
  moreText: { color: TEXT.hint, fontSize: 12, textAlign: 'center', marginTop: 2 },

  // PB
  pbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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

  // 睡眠グラフ
  sleepChartArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 100,
    gap: 6,
    paddingTop: 8,
  },
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

// app/session-detail.tsx — 練習詳細（タブ外）

import React, { useRef, useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTrainingSessions } from '../hooks/useTrainingSessions'
import AIFeedbackCard from '../components/AIFeedbackCard'
import ConditionBadge from '../components/ConditionBadge'
import type { TrainingSession } from '../types'

// ─── Skeleton ─────────────────────────────────────────────────────────
const SkeletonRect: React.FC<{ height?: number; width?: number | string }> = ({
  height = 16,
  width = '100%',
}) => {
  const opacity = useRef(new Animated.Value(0.3)).current
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    )
    pulse.start()
    return () => pulse.stop()
  }, [opacity])
  return <Animated.View style={[styles.skeleton, { height, width: width as any, opacity }]} />
}

// ─── Detail Row ───────────────────────────────────────────────────────
const DetailRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <View style={styles.detailValueWrapper}>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={styles.detailValue}>{value}</Text>
      ) : (
        value
      )}
    </View>
  </View>
)

function formatMs(ms: number): string {
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec.toFixed(2)}秒`
  const min = Math.floor(totalSec / 60)
  const sec = (totalSec % 60).toFixed(2).padStart(5, '0')
  return `${min}:${sec}`
}

const SESSION_TYPE_LABELS: Record<string, string> = {
  interval: 'インターバル走',
  tempo: 'テンポ走',
  easy: 'イージージョグ',
  long: 'ロング走',
  sprint: 'スプリント',
  drill: 'ドリル',
  strength: 'ウェイト・補強',
  race: '試合',
  rest: '休養',
}

// ─── Video Player Placeholder ─────────────────────────────────────────
// Full expo-video integration requires native setup; showing placeholder
const VideoPlayerPlaceholder: React.FC<{ uri: string }> = ({ uri }) => (
  <View style={styles.videoPlaceholder}>
    <Text style={styles.videoPlaceholderIcon}>🎬</Text>
    <Text style={styles.videoPlaceholderText}>
      動画: {uri.split('/').pop()}
    </Text>
    <Text style={styles.videoPlaceholderNote}>
      (動画再生はexpo-videoが必要です)
    </Text>
  </View>
)

export default function SessionDetailScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { sessions, loading, fetchSessions } = useTrainingSessions()
  const [session, setSession] = useState<TrainingSession | undefined>(undefined)

  useEffect(() => {
    AsyncStorage.getItem('userId').then(uid => {
      if (uid) fetchSessions(uid)
    }).catch(() => {})
  }, [fetchSessions])

  useEffect(() => {
    if (sessions.length > 0 && id) {
      const found = sessions.find(s => s.id === id)
      setSession(found)
    }
  }, [sessions, id])

  const isLoading = loading === 'idle' || loading === 'loading'

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            {[0, 1, 2, 3, 4, 5, 6].map(i => (
              <SkeletonRect key={i} height={i === 0 ? 32 : 20} />
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    )
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.notFound}>
          <Text style={styles.notFoundIcon}>🔍</Text>
          <Text style={styles.notFoundText}>練習記録が見つかりませんでした</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>← 戻る</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Session header */}
        <View style={styles.sessionHeader}>
          <View>
            <Text style={styles.sessionDate}>{session.session_date}</Text>
            <Text style={styles.sessionType}>
              {SESSION_TYPE_LABELS[session.session_type] ?? session.session_type}
            </Text>
          </View>
          {session.time_ms && (
            <Text style={styles.sessionTimeHero}>{formatMs(session.time_ms)}</Text>
          )}
        </View>

        {/* Main details */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>練習詳細</Text>

          {session.event && (
            <DetailRow label="種目" value={session.event} />
          )}
          {session.time_ms && (
            <DetailRow label="タイム" value={formatMs(session.time_ms)} />
          )}
          {session.distance_m && (
            <DetailRow label="距離" value={`${session.distance_m} m`} />
          )}
          {session.reps && (
            <DetailRow label="本数" value={`${session.reps}本`} />
          )}
          {session.sets && (
            <DetailRow label="セット数" value={`${session.sets}セット`} />
          )}
          {session.rest_sec && (
            <DetailRow label="レスト" value={`${session.rest_sec}秒`} />
          )}

          <View style={styles.divider} />

          <DetailRow
            label="疲労度"
            value={
              <View style={styles.levelRow}>
                <Text style={styles.detailValue}>{session.fatigue_level}/10</Text>
                <View style={[
                  styles.levelBar,
                  { width: `${session.fatigue_level * 10}%` as `${number}%` },
                  session.fatigue_level >= 8
                    ? { backgroundColor: '#FF3B30' }
                    : session.fatigue_level >= 6
                    ? { backgroundColor: '#FF9500' }
                    : { backgroundColor: '#34C759' },
                ]} />
              </View>
            }
          />
          <DetailRow
            label="体調"
            value={<ConditionBadge condition={session.condition_level} size="sm" />}
          />

          {session.weather && (
            <DetailRow label="天気" value={session.weather} />
          )}
          {session.temperature !== undefined && (
            <DetailRow label="気温" value={`${session.temperature}°C`} />
          )}
        </View>

        {/* Notes */}
        {session.notes && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>メモ</Text>
            <Text style={styles.notesText}>{session.notes}</Text>
          </View>
        )}

        {/* Video */}
        {session.video_url && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>動画</Text>
            <VideoPlayerPlaceholder uri={session.video_url} />
            <TouchableOpacity
              style={styles.videoAnalysisBtn}
              onPress={() => router.push('/video-analysis')}
              activeOpacity={0.8}
            >
              <Text style={styles.videoAnalysisBtnText}>🎬 動画でフォーム分析</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* AI feedback */}
        {session.ai_feedback && (
          <AIFeedbackCard
            feedback={session.ai_feedback}
            title="AIコーチのフィードバック"
          />
        )}

        {/* Meta */}
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>記録日時: {new Date(session.created_at).toLocaleString('ja-JP')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 48,
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingBottom: 8,
  },
  sessionDate: {
    color: '#888888',
    fontSize: 14,
  },
  sessionType: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 4,
  },
  sessionTimeHero: {
    color: '#FF6B00',
    fontSize: 32,
    fontWeight: '800',
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  detailLabel: {
    color: '#888888',
    fontSize: 14,
  },
  detailValueWrapper: {
    flex: 1,
    alignItems: 'flex-end',
  },
  detailValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  levelRow: {
    alignItems: 'flex-end',
    gap: 4,
  },
  levelBar: {
    height: 4,
    borderRadius: 2,
    alignSelf: 'flex-end',
  },
  divider: {
    height: 1,
    backgroundColor: '#2a2a2a',
    marginVertical: 4,
  },
  notesText: {
    color: '#CCCCCC',
    fontSize: 14,
    lineHeight: 22,
  },
  videoPlaceholder: {
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  videoPlaceholderIcon: {
    fontSize: 40,
  },
  videoPlaceholderText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  videoPlaceholderNote: {
    color: '#888888',
    fontSize: 12,
  },
  videoAnalysisBtn: {
    backgroundColor: '#FF6B00',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  videoAnalysisBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  metaRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  metaText: {
    color: '#555555',
    fontSize: 12,
  },
  skeleton: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    width: '100%',
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 32,
  },
  notFoundIcon: {
    fontSize: 48,
  },
  notFoundText: {
    color: '#888888',
    fontSize: 16,
    textAlign: 'center',
  },
  backBtn: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  backBtnText: {
    color: '#FF6B00',
    fontSize: 15,
    fontWeight: '700',
  },
})

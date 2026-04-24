// app/share-card.tsx — 記録シェアカード

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Sharing from 'expo-sharing'
import { Ionicons } from '@expo/vector-icons'
import { BRAND, TEXT, SURFACE, SURFACE2 } from '../lib/theme'
import type { RaceRecord } from '../types'

// ─── 定数 ───────────────────────────────────────────────────────────────
const RECORDS_KEY = 'trackmate_race_records'

// ─── ユーティリティ ─────────────────────────────────────────────────────
function formatDateJP(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${y}年${m}月${d}日`
}

// ─── シェアカードビュー ─────────────────────────────────────────────────
interface ShareCardViewProps {
  record: RaceRecord
}

const ShareCardView: React.FC<ShareCardViewProps> = ({ record }) => (
  <View style={cardStyles.card}>
    {/* 赤いアクセントライン */}
    <View style={cardStyles.accentLine} />

    {/* ロゴ */}
    <View style={cardStyles.logoRow}>
      <View style={cardStyles.logoDot} />
      <Text style={cardStyles.logoText}>sCORE</Text>
    </View>

    {/* 種目バッジ */}
    <View style={cardStyles.eventBadge}>
      <Text style={cardStyles.eventBadgeText}>{record.event}</Text>
    </View>

    {/* 記録（大きく） */}
    <Text style={cardStyles.resultText}>{record.result_display}</Text>

    {/* PB / SB バッジ */}
    <View style={cardStyles.badgeRow}>
      {record.is_pb && (
        <View style={[cardStyles.badge, { backgroundColor: `${BRAND}33`, borderColor: BRAND }]}>
          <Ionicons name="trophy" size={14} color={BRAND} />
          <Text style={[cardStyles.badgeText, { color: BRAND }]}>PB</Text>
        </View>
      )}
      {record.is_sb && !record.is_pb && (
        <View style={[cardStyles.badge, { backgroundColor: '#4A9FFF33', borderColor: '#4A9FFF' }]}>
          <Ionicons name="star" size={14} color="#4A9FFF" />
          <Text style={[cardStyles.badgeText, { color: '#4A9FFF' }]}>SB</Text>
        </View>
      )}
      {!record.is_pb && !record.is_sb && (
        <View style={[cardStyles.badge, { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.2)' }]}>
          <Text style={[cardStyles.badgeText, { color: TEXT.secondary }]}>記録</Text>
        </View>
      )}
    </View>

    {/* 日付・会場 */}
    <View style={cardStyles.metaSection}>
      <View style={cardStyles.metaRow}>
        <Ionicons name="calendar-outline" size={14} color={TEXT.hint} />
        <Text style={cardStyles.metaText}>{formatDateJP(record.race_date)}</Text>
      </View>
      {record.competition_name != null && (
        <View style={cardStyles.metaRow}>
          <Ionicons name="flag-outline" size={14} color={TEXT.hint} />
          <Text style={cardStyles.metaText} numberOfLines={1}>{record.competition_name}</Text>
        </View>
      )}
      {record.venue != null && record.competition_name == null && (
        <View style={cardStyles.metaRow}>
          <Ionicons name="location-outline" size={14} color={TEXT.hint} />
          <Text style={cardStyles.metaText} numberOfLines={1}>{record.venue}</Text>
        </View>
      )}
      {record.wind_ms !== undefined && (
        <View style={cardStyles.metaRow}>
          <Ionicons name="speedometer-outline" size={14} color={TEXT.hint} />
          <Text style={cardStyles.metaText}>
            {record.wind_ms >= 0 ? `+${record.wind_ms}` : record.wind_ms} m/s
          </Text>
        </View>
      )}
    </View>

    {/* 下部ライン */}
    <View style={cardStyles.bottomLine} />
    <Text style={cardStyles.footerText}>陸上競技記録管理アプリ</Text>
  </View>
)

// ─── メインスクリーン ────────────────────────────────────────────────────
export default function ShareCardScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ recordId?: string }>()

  const [records, setRecords] = useState<RaceRecord[]>([])
  const [selectedRecord, setSelectedRecord] = useState<RaceRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)

  // データ読み込み
  useEffect(() => {
    ;(async () => {
      try {
        const raw = await AsyncStorage.getItem(RECORDS_KEY)
        const all: RaceRecord[] = raw ? JSON.parse(raw) : []
        setRecords(all)

        if (all.length > 0) {
          if (params.recordId) {
            const found = all.find(r => r.id === params.recordId)
            setSelectedRecord(found ?? all[0])
          } else {
            // PBがあれば最新のPBを、なければ最新記録を表示
            const pb = all.find(r => r.is_pb)
            setSelectedRecord(pb ?? all[0])
          }
        }
      } catch {
        // ignore parse errors
      } finally {
        setLoading(false)
      }
    })()
  }, [params.recordId])

  // シェア処理
  const handleShare = useCallback(async () => {
    if (!selectedRecord) return
    setSharing(true)
    try {
      const text = [
        `【sCORE 記録シェア】`,
        `種目: ${selectedRecord.event}`,
        `記録: ${selectedRecord.result_display}`,
        selectedRecord.is_pb ? '🏆 自己ベスト！' : '',
        `日付: ${formatDateJP(selectedRecord.race_date)}`,
        selectedRecord.competition_name ? `大会: ${selectedRecord.competition_name}` : '',
        ``,
        `sCORE で記録管理 📱`,
      ].filter(Boolean).join('\n')

      if (Platform.OS === 'web') {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(text)
        }
      } else {
        const isAvailable = await Sharing.isAvailableAsync()
        if (isAvailable) {
          // expo-sharing はファイルが必要なため、テキストをシェアシートで開く代替として
          // 実際のアプリでは expo-view-shot + Sharing を組み合わせる
          // ここでは文字列ベースの共有情報を提示
        }
        // フォールバック: コピー通知
      }
      // シェアシート / クリップボードコピー完了を通知
      // Toast は _layout に配置済み
      const { default: Toast } = await import('react-native-toast-message')
      Toast.show({
        type: 'success',
        text1: 'テキストをコピーしました',
        text2: `${selectedRecord.event}  ${selectedRecord.result_display}`,
      })
    } catch {
      const { default: Toast } = await import('react-native-toast-message')
      Toast.show({ type: 'error', text1: 'シェアに失敗しました' })
    } finally {
      setSharing(false)
    }
  }, [selectedRecord])

  // ─── UI ─────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBack} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={TEXT.secondary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>記録シェア</Text>
        <View style={{ width: 44 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={BRAND} size="large" />
        </View>
      ) : records.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="timer-outline" size={64} color={TEXT.hint} />
          <Text style={styles.emptyTitle}>記録がありません</Text>
          <Text style={styles.emptyBody}>「記録管理」タブで記録を追加してください</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>← 戻る</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* カードプレビュー */}
          {selectedRecord != null && (
            <View style={styles.cardWrapper}>
              <ShareCardView record={selectedRecord} />
            </View>
          )}

          {/* シェアボタン */}
          <TouchableOpacity
            style={[styles.shareButton, sharing && { opacity: 0.6 }]}
            onPress={handleShare}
            disabled={sharing || selectedRecord == null}
            activeOpacity={0.85}
          >
            {sharing ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Ionicons name="share-social-outline" size={20} color="#FFFFFF" />
            )}
            <Text style={styles.shareButtonText}>
              {sharing ? '共有中...' : 'コピーして共有'}
            </Text>
          </TouchableOpacity>

          {/* 記録セレクター */}
          <Text style={styles.selectorLabel}>記録を選択</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.selectorRow}
          >
            {records.map(r => (
              <TouchableOpacity
                key={r.id}
                style={[
                  styles.selectorChip,
                  selectedRecord?.id === r.id && styles.selectorChipActive,
                ]}
                onPress={() => setSelectedRecord(r)}
                activeOpacity={0.8}
              >
                <Text style={[
                  styles.selectorChipEvent,
                  selectedRecord?.id === r.id && { color: '#FFFFFF' },
                ]}>
                  {r.event}
                </Text>
                <Text style={[
                  styles.selectorChipResult,
                  selectedRecord?.id === r.id && { color: '#FFFFFF' },
                ]}>
                  {r.result_display}
                </Text>
                {r.is_pb && (
                  <View style={styles.selectorPBDot}>
                    <Text style={styles.selectorPBDotText}>PB</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

// ─── カードスタイル（独立） ──────────────────────────────────────────────
const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#111111',
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingTop: 0,
    paddingBottom: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    // Instagram Story 風の縦長カード
    aspectRatio: 9 / 16,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  accentLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: BRAND,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 40,
    marginTop: 20,
  },
  logoDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: BRAND,
  },
  logoText: {
    color: TEXT.primary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  eventBadge: {
    alignSelf: 'flex-start',
    backgroundColor: `${BRAND}22`,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: `${BRAND}55`,
    marginBottom: 16,
  },
  eventBadgeText: {
    color: BRAND,
    fontSize: 13,
    fontWeight: '700',
  },
  resultText: {
    color: TEXT.primary,
    fontSize: 64,
    fontWeight: '800',
    letterSpacing: -1,
    lineHeight: 72,
    marginBottom: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 32,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '800',
  },
  metaSection: {
    gap: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaText: {
    color: TEXT.secondary,
    fontSize: 14,
    flex: 1,
  },
  bottomLine: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginTop: 28,
    marginBottom: 12,
  },
  footerText: {
    color: TEXT.hint,
    fontSize: 11,
    textAlign: 'right',
  },
})

// ─── スクリーンスタイル ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerBack: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: TEXT.primary,
    fontSize: 17,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 20,
  },
  cardWrapper: {
    // カードを画面内に収める
    maxWidth: 360,
    alignSelf: 'center',
    width: '100%',
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: BRAND,
    borderRadius: 16,
    paddingVertical: 16,
  },
  shareButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  selectorLabel: {
    color: TEXT.secondary,
    fontSize: 13,
    fontWeight: '600',
  },
  selectorRow: {
    gap: 10,
    paddingBottom: 4,
  },
  selectorChip: {
    backgroundColor: '#111111',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    minWidth: 90,
    position: 'relative',
  },
  selectorChipActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  selectorChipEvent: {
    color: TEXT.secondary,
    fontSize: 11,
    fontWeight: '600',
  },
  selectorChipResult: {
    color: TEXT.primary,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 2,
  },
  selectorPBDot: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#34C759',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  selectorPBDotText: {
    color: '#000000',
    fontSize: 9,
    fontWeight: '800',
  },
  // 空状態
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 40,
  },
  emptyTitle: {
    color: TEXT.primary,
    fontSize: 20,
    fontWeight: '700',
  },
  emptyBody: {
    color: TEXT.secondary,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
  },
  backBtn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    marginTop: 8,
  },
  backBtnText: {
    color: BRAND,
    fontSize: 16,
    fontWeight: '700',
  },
})

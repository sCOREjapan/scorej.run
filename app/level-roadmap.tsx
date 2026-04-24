// app/level-roadmap.tsx — レベルロードマップ画面
import React, { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { calcLevelInfo, RANK_TIERS } from '../lib/gamification'
import { useTheme } from '../context/ThemeContext'

const SESSIONS_KEY = 'trackmate_sessions'

// チームメイトから見る場合は ?name=xxx&sessions=xx で渡す
export default function LevelRoadmapScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ name?: string; sessions?: string }>()
  const { colors } = useTheme()

  const [sessionCount, setSessionCount] = useState(0)
  const [displayName,  setDisplayName]  = useState('')

  useEffect(() => {
    if (params.sessions) {
      // チームメイトのデータを表示
      setSessionCount(Number(params.sessions))
      setDisplayName(params.name ?? '')
    } else {
      // 自分のデータ
      AsyncStorage.getItem(SESSIONS_KEY).then(r => {
        const arr = r ? JSON.parse(r) : []
        setSessionCount(arr.length)
      }).catch(() => {})
      AsyncStorage.getItem('trackmate_my_profile').then(r => {
        if (r) {
          const p = JSON.parse(r)
          setDisplayName(p.name ?? '')
        }
      }).catch(() => {})
    }
  }, [params.sessions, params.name])

  const info        = calcLevelInfo(sessionCount)
  const currentTier = RANK_TIERS.find(t => info.level >= t.min && info.level < t.max) ?? RANK_TIERS[0]
  const nextTier    = RANK_TIERS.find(t => t.min === currentTier.max) ?? null
  const isViewing   = !!params.name

  // 次のランクまでに必要なセッション数
  const sessionsToNextRank = nextTier
    ? Math.max(0, nextTier.sessionsRequired - sessionCount)
    : 0

  return (
    <View style={[st.root, { backgroundColor: colors.bg }]}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* ヘッダー */}
        <View style={st.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[st.headerTitle, { color: colors.text }]}>
            {isViewing ? `${displayName}のロードマップ` : 'レベルロードマップ'}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>

          {/* 現在のレベルカード */}
          <View style={[st.currentCard, { borderColor: currentTier.color + '55', backgroundColor: currentTier.color + '11' }]}>
            <Text style={{ fontSize: 52 }}>{currentTier.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[st.currentRank, { color: currentTier.color }]}>{currentTier.title}</Text>
              <Text style={[st.currentLv, { color: colors.text }]}>Lv.{info.level}</Text>
              {displayName ? (
                <Text style={[st.currentName, { color: colors.textSec }]}>{displayName}</Text>
              ) : null}
              <Text style={[st.currentDesc, { color: colors.textHint }]}>{currentTier.description}</Text>
            </View>
          </View>

          {/* XP プログレスバー */}
          <View style={[st.xpCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={st.xpRow}>
              <Text style={[st.xpLabel, { color: colors.textHint }]}>TOTAL XP</Text>
              <Text style={[st.xpVal, { color: colors.text }]}>{info.xp.toLocaleString()} XP</Text>
            </View>
            <View style={[st.barBg, { backgroundColor: colors.surface2 }]}>
              <View style={[st.barFill, { width: `${Math.round(info.progress * 100)}%` as any, backgroundColor: currentTier.color }]} />
            </View>
            <View style={st.xpRow}>
              <Text style={[st.xpSub, { color: colors.textHint }]}>累計練習 {sessionCount}回</Text>
              {nextTier && (
                <Text style={[st.xpSub, { color: colors.textHint }]}>
                  次のランクまで あと{sessionsToNextRank}回
                </Text>
              )}
            </View>
          </View>

          {/* 現在ランクのマイルストーン */}
          <Text style={[st.sectionTitle, { color: colors.textHint }]}>
            📋 {currentTier.title}のマイルストーン
          </Text>
          <View style={[st.milestoneCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {currentTier.milestones.map((m, i) => {
              // 簡易達成チェック（セッション数ベース）
              const done = i === 0
                ? sessionCount >= 1
                : i === 1
                  ? sessionCount >= 3
                  : false
              return (
                <View key={i} style={[st.milestoneRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                  <View style={[st.milestoneCheck, {
                    backgroundColor: done ? currentTier.color + '22' : 'transparent',
                    borderColor: done ? currentTier.color : colors.border,
                  }]}>
                    {done && <Ionicons name="checkmark" size={13} color={currentTier.color} />}
                  </View>
                  <Text style={[st.milestoneTxt, { color: done ? colors.text : colors.textSec }]}>{m}</Text>
                </View>
              )
            })}
          </View>

          {/* 全ランク一覧 */}
          <Text style={[st.sectionTitle, { color: colors.textHint }]}>🗺️ 全ランク一覧</Text>

          {RANK_TIERS.map((tier, idx) => {
            const isCurrentTier  = info.level >= tier.min && info.level < tier.max
            const isCleared      = info.level >= tier.max
            const isLocked       = sessionCount < tier.sessionsRequired && !isCurrentTier && !isCleared

            return (
              <View
                key={tier.title}
                style={[
                  st.tierRow,
                  { backgroundColor: colors.surface, borderColor: isCurrentTier ? tier.color + '66' : colors.border },
                  isCurrentTier && { borderWidth: 2 },
                ]}
              >
                {/* 左の縦ライン */}
                <View style={[st.tierLine, {
                  backgroundColor: isCleared ? tier.color : isCurrentTier ? tier.color : colors.border,
                }]} />

                {/* アイコン */}
                <View style={[st.tierIconWrap, {
                  backgroundColor: (isCleared || isCurrentTier) ? tier.color + '22' : colors.surface2,
                }]}>
                  <Text style={{ fontSize: 22, opacity: isLocked ? 0.3 : 1 }}>{tier.emoji}</Text>
                  {isCleared && (
                    <View style={[st.clearedBadge, { backgroundColor: tier.color }]}>
                      <Ionicons name="checkmark" size={8} color="#fff" />
                    </View>
                  )}
                </View>

                {/* テキスト */}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[st.tierTitle, {
                      color: isLocked ? colors.textHint : isCurrentTier ? tier.color : colors.text,
                    }]}>{tier.title}</Text>
                    {isCurrentTier && (
                      <View style={[st.nowBadge, { backgroundColor: tier.color }]}>
                        <Text style={st.nowBadgeTxt}>NOW</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[st.tierLvRange, { color: colors.textHint }]}>
                    Lv.{tier.min}〜{tier.max === 9999 ? '' : tier.max - 1}
                    {tier.min > 0 ? `　累計${tier.sessionsRequired}回〜` : '　スタート'}
                  </Text>
                  <Text style={[st.tierDesc, { color: isLocked ? colors.textHint : colors.textSec }]} numberOfLines={2}>
                    {isLocked ? '🔒 まだロック中' : tier.description}
                  </Text>
                </View>

                {/* 達成済みチェック */}
                {isCleared && (
                  <Ionicons name="checkmark-circle" size={22} color={tier.color} />
                )}
              </View>
            )
          })}

          {/* 次のランクへのヒント */}
          {nextTier && (
            <View style={[st.hintCard, { backgroundColor: nextTier.color + '11', borderColor: nextTier.color + '44' }]}>
              <Text style={{ fontSize: 20 }}>{nextTier.emoji}</Text>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[st.hintTitle, { color: nextTier.color }]}>
                  次は「{nextTier.title}」を目指そう
                </Text>
                <Text style={[st.hintSub, { color: colors.textSec }]}>
                  あと{sessionsToNextRank}回練習を記録すれば到達できる
                </Text>
              </View>
            </View>
          )}

          {!nextTier && (
            <View style={[st.hintCard, { backgroundColor: '#FFD70011', borderColor: '#FFD70044' }]}>
              <Text style={{ fontSize: 24 }}>👑</Text>
              <Text style={[st.hintTitle, { color: '#FFD700', flex: 1 }]}>
                最高ランク到達おめでとう！
              </Text>
            </View>
          )}

        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

const st = StyleSheet.create({
  root:        { flex: 1 },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  content:     { padding: 16, gap: 12, paddingBottom: 60 },

  currentCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: 16, borderRadius: 16, borderWidth: 1.5 },
  currentRank: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  currentLv:   { fontSize: 14, fontWeight: '700', marginTop: 2 },
  currentName: { fontSize: 12, marginTop: 1 },
  currentDesc: { fontSize: 12, lineHeight: 18, marginTop: 6 },

  xpCard:  { padding: 14, borderRadius: 14, borderWidth: 1, gap: 8 },
  xpRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  xpLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  xpVal:   { fontSize: 18, fontWeight: '800' },
  xpSub:   { fontSize: 11 },
  barBg:   { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },

  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 4 },

  milestoneCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  milestoneRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  milestoneCheck:{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  milestoneTxt:  { fontSize: 13, flex: 1, lineHeight: 19 },

  tierRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  tierLine:    { width: 3, height: 52, borderRadius: 2, flexShrink: 0 },
  tierIconWrap:{ width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' },
  clearedBadge:{ position: 'absolute', bottom: 0, right: 0, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tierTitle:   { fontSize: 15, fontWeight: '800' },
  tierLvRange: { fontSize: 10, marginTop: 2, fontWeight: '600' },
  tierDesc:    { fontSize: 11, marginTop: 3, lineHeight: 17 },
  nowBadge:    { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  nowBadgeTxt: { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },

  hintCard:  { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1, marginTop: 4 },
  hintTitle: { fontSize: 14, fontWeight: '800' },
  hintSub:   { fontSize: 12 },
})

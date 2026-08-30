// app/(tabs)/mypage.tsx — プロフィール画面
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTrainingSessions } from '../../hooks/useTrainingSessions'
import { calcLevelInfo } from '../../lib/gamification'
import { BRAND, TEXT, SURFACE2 } from '../../lib/theme'
import { useTheme } from '../../context/ThemeContext'
import { Sounds, unlockAudio } from '../../lib/sounds'
import HapticTouch from '../../components/HapticTouch'
import { localDateStr } from '../../lib/dateLocal'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../../context/LanguageContext'
import { getEventLabel } from '../../lib/eventLabels'
import type { RaceRecord } from '../../types'

const PROFILE_KEY = 'trackmate_my_profile'
const RECORDS_KEY = 'trackmate_race_records'

interface MyProfile {
  name: string
  primary_event: string
  grade?: string
}

export default function MyPageScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { sessions, fetchSessions } = useTrainingSessions()
  const [profile, setProfile] = useState<MyProfile>({ name: '', primary_event: '400m' })
  const [records, setRecords] = useState<RaceRecord[]>([])
  const fadeY = useRef(new Animated.Value(0)).current

  useFocusEffect(useCallback(() => {
    fadeY.setValue(0)
    const anim = Animated.timing(fadeY, {
      toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, []))

  // プロフィールは設定画面・オンボーディング等からも書き込まれるため、
  // マウント時だけでなくタブに戻るたびに再読み込みする
  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(PROFILE_KEY).then(v => { if (v) { try { setProfile(JSON.parse(v)) } catch {} } }).catch(() => {})
    AsyncStorage.getItem(RECORDS_KEY).then(v => { if (v) { try { setRecords(JSON.parse(v)) } catch {} } }).catch(() => {})
    fetchSessions('')
  }, [fetchSessions]))

  const displayName = profile.name || t('mypage.defaultName')
  const initials    = displayName.slice(0, 2)
  const levelInfo   = calcLevelInfo(sessions.length)

  // 種目ごとの自己ベスト（記録タブのデータをそのまま使う。ここでは入力欄を増やさない）
  const eventPBs = (() => {
    const map = new Map<string, RaceRecord>()
    records.filter(r => r.is_pb).forEach(r => { if (!map.has(r.event)) map.set(r.event, r) })
    return Array.from(map.values())
  })()

  return (
    <Animated.View style={{ flex: 1, backgroundColor: colors.bg, opacity: fadeY, transform: [{ translateY: fadeY.interpolate({ inputRange: [0,1], outputRange: [14,0] }) }] }}>
      <SafeAreaView style={{ flex: 1 }}>

        {/* ── ヘッダー ── */}
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={t('mypage.backLabel')}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.text }]}>{t('mypage.headerTitle')}</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* ── アバター＋名前 ── */}
          <View style={s.avatarSection}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
            <Text style={[s.name, { color: colors.text }]}>{displayName}</Text>
            {profile.primary_event ? (
              <View style={[s.eventBadge, { backgroundColor: colors.surface }]}>
                <Text style={[s.eventText, { color: colors.textSec }]}>{getEventLabel(profile.primary_event, language)}</Text>
              </View>
            ) : null}
            {profile.grade ? (
              <Text style={[s.grade, { color: colors.textHint }]}>{profile.grade}</Text>
            ) : null}
          </View>

          {/* ── レベル ── */}
          <View style={[s.levelCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={s.levelEmoji}>{levelInfo.emoji}</Text>
            <View style={{ flex: 1, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <Text style={[s.levelNum, { color: colors.text }]}>Lv.{levelInfo.level}</Text>
                <Text style={[s.levelTitle, { color: BRAND }]}>{levelInfo.title}</Text>
              </View>
              <View style={[s.barBg, { backgroundColor: colors.surface2 }]}>
                <View style={[s.barFill, { width: `${Math.round(levelInfo.progress * 100)}%` as any }]} />
              </View>
              <Text style={[s.levelSub, { color: colors.textHint }]}>
                {t('mypage.levelSub', { count: sessions.length, toNext: Math.ceil(levelInfo.xpToNext / 100) })}
              </Text>
            </View>
          </View>

          {/* ── 種目別ベスト ── */}
          <View style={[s.pbCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={s.pbHeader}>
              <Ionicons name="trophy-outline" size={16} color={BRAND} />
              <Text style={[s.pbTitle, { color: colors.text }]}>{t('mypage.pbTitle')}</Text>
            </View>
            {eventPBs.length > 0 ? (
              <View style={s.pbGrid}>
                {eventPBs.map(r => (
                  <View key={r.id} style={[s.pbItem, { backgroundColor: colors.surface2 }]}>
                    <Text style={[s.pbEvent, { color: colors.textSec }]}>{getEventLabel(r.event, language)}</Text>
                    <Text style={[s.pbResult, { color: colors.text }]}>{r.result_display}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[s.pbEmpty, { color: colors.textHint }]}>
                {t('mypage.pbEmpty')}
              </Text>
            )}
          </View>

          {/* ── 統計 ── */}
          <View style={[s.statsRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {[
              { label: t('mypage.statTotal'), value: t('mypage.unitTimes', { count: sessions.length }) },
              { label: t('mypage.statThisWeek'), value: t('mypage.unitTimes', { count: sessions.filter(s => s.session_date >= localDateStr(new Date(Date.now() - 7 * 86400000))).length }) },
              { label: t('mypage.statMonthDistance'), value: (() => { const km = sessions.filter(s => s.session_date >= localDateStr(new Date(Date.now() - 30 * 86400000))).reduce((a, s) => a + (s.distance_m ?? 0), 0) / 1000; return km > 0 ? `${km.toFixed(0)}km` : '—' })() },
            ].map((item, i) => (
              <View key={i} style={[s.statCell, i > 0 && { borderLeftWidth: 1, borderLeftColor: colors.border }]}>
                <Text style={[s.statValue, { color: colors.text }]}>{item.value}</Text>
                <Text style={[s.statLabel, { color: colors.textHint }]}>{item.label}</Text>
              </View>
            ))}
          </View>

          {/* ── お知らせボタン ── */}
          <HapticTouch
            haptic="whoosh"
            style={[s.settingsBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => { unlockAudio(); router.push('/notifications') }}
            activeOpacity={0.8}
          >
            <Ionicons name="notifications-outline" size={20} color={colors.textSec} />
            <Text style={[s.settingsBtnText, { color: colors.text }]}>{t('mypage.notifications')}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textHint} style={{ marginLeft: 'auto' as any }} />
          </HapticTouch>

          {/* ── 設定ボタン ── */}
          <HapticTouch
            haptic="whoosh"
            style={[s.settingsBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => { unlockAudio(); router.push('/settings') }}
            activeOpacity={0.8}
          >
            <Ionicons name="settings-outline" size={20} color={colors.textSec} />
            <Text style={[s.settingsBtnText, { color: colors.text }]}>{t('mypage.settings')}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textHint} style={{ marginLeft: 'auto' as any }} />
          </HapticTouch>

          <Text style={[s.version, { color: colors.textHint }]}>sCORE v1.6.1</Text>
        </ScrollView>
      </SafeAreaView>
    </Animated.View>
  )
}

const s = StyleSheet.create({
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  backBtn:     { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: '800' },

  content:     { padding: 20, gap: 16, paddingBottom: 48 },

  avatarSection: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  avatar:      { width: 72, height: 72, borderRadius: 36, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
  avatarText:  { color: '#fff', fontSize: 26, fontWeight: '900' },
  name:        { fontSize: 22, fontWeight: '900' },
  eventBadge:  { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 },
  eventText:   { fontSize: 13, fontWeight: '700' },
  grade:       { fontSize: 13 },

  levelCard:   { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 21, borderWidth: 1, padding: 16 },
  levelEmoji:  { fontSize: 32 },
  levelNum:    { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  levelTitle:  { fontSize: 14, fontWeight: '700' },
  barBg:       { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill:     { height: 6, backgroundColor: BRAND, borderRadius: 3 },
  levelSub:    { fontSize: 11 },

  pbCard:      { borderRadius: 21, borderWidth: 1, padding: 16, gap: 12 },
  pbHeader:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pbTitle:     { fontSize: 14, fontWeight: '800' },
  pbGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pbItem:      { flexBasis: '31%', flexGrow: 1, borderRadius: 14, paddingVertical: 10, alignItems: 'center', gap: 2 },
  pbEvent:     { fontSize: 11, fontWeight: '700' },
  pbResult:    { fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  pbEmpty:     { fontSize: 12, lineHeight: 18 },

  statsRow:    { flexDirection: 'row', borderRadius: 21, borderWidth: 1, overflow: 'hidden' },
  statCell:    { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 3 },
  statValue:   { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel:   { fontSize: 10, fontWeight: '600' },

  settingsBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 21, borderWidth: 1, padding: 16 },
  settingsBtnText: { fontSize: 15, fontWeight: '700' },

  version:     { textAlign: 'center', fontSize: 12, paddingTop: 4 },
})

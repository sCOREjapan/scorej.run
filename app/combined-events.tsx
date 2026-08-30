// app/combined-events.tsx — 混成競技ツール（男子十種競技／女子七種競技の得点計算・記録・PB管理）
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Crypto from 'expo-crypto'
import Toast from 'react-native-toast-message'
import { unlockAudio, Sounds } from '../lib/sounds'
import { todayLocalISO } from '../lib/dateLocal'
import {
  DECATHLON_MEN, HEPTATHLON_WOMEN, calcEventScore, calcTotalScore, unitLabel, type EventDef,
} from '../lib/decathlonScoring'
import {
  getCompetitions, saveCompetition, deleteCompetition, getPersonalBests, getGoals, setGoal,
  type SavedCompetition, type CombinedCategory,
} from '../lib/combinedEventsStore'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../context/LanguageContext'
import { getEventLabel } from '../lib/eventLabels'

const BRAND = '#16a34a'
const BG = '#f6f6f8'
const CARD = '#ffffff'
const BORDER = 'rgba(0,0,0,0.08)'
const TEXT_PRIMARY = '#111827'
const TEXT_SECONDARY = '#6b7280'
const TEXT_HINT = '#9ca3af'

type SubTab = 'calc' | 'match' | 'pb'

export default function CombinedEventsScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [category, setCategory] = useState<CombinedCategory>('men')
  const [subTab, setSubTab] = useState<SubTab>('calc')
  const [marks, setMarks] = useState<Record<string, string>>({})
  const [competitions, setCompetitions] = useState<SavedCompetition[]>([])
  const [pbMarks, setPbMarks] = useState<Record<string, number>>({})
  const [goals, setGoals] = useState<Record<string, number>>({})

  const events: EventDef[] = category === 'men' ? DECATHLON_MEN : HEPTATHLON_WOMEN

  const refresh = useCallback(async (cat: CombinedCategory) => {
    const [comps, pb, gl] = await Promise.all([
      getCompetitions(cat),
      getPersonalBests(cat, (key) => (cat === 'men' ? DECATHLON_MEN : HEPTATHLON_WOMEN).find(e => e.key === key)?.isTrack ?? false),
      getGoals(cat),
    ])
    setCompetitions(comps)
    setPbMarks(pb)
    setGoals(gl)
  }, [])

  useEffect(() => { refresh(category) }, [category, refresh])

  const numericMarks = useMemo(() => {
    const out: Record<string, number> = {}
    for (const e of events) out[e.key] = parseFloat(marks[e.key] ?? '') || 0
    return out
  }, [marks, events])

  const totalScore = useMemo(() => calcTotalScore(events, numericMarks), [events, numericMarks])
  const filledCount = events.filter(e => numericMarks[e.key] > 0).length

  function switchCategory(cat: CombinedCategory) {
    if (cat === category) return
    unlockAudio(); Sounds.tabSwitch()
    setCategory(cat)
    setMarks({})
  }

  const handleSave = useCallback(async () => {
    if (filledCount === 0) {
      Toast.show({ type: 'info', text1: t('combinedEvents.saveNeedsOneEvent') })
      return
    }
    unlockAudio(); Sounds.save()
    const entry: SavedCompetition = {
      id: Crypto.randomUUID(),
      category,
      date: todayLocalISO(),
      marks: numericMarks,
      totalScore,
    }
    await saveCompetition(entry)
    await refresh(category)
    Toast.show({ type: 'success', text1: t('combinedEvents.saveSuccessToast', { score: totalScore }) })
  }, [category, numericMarks, totalScore, filledCount, refresh, t])

  const handleDeleteCompetition = useCallback((id: string) => {
    Alert.alert(t('combinedEvents.deleteConfirmTitle'), t('combinedEvents.deleteConfirmBody'), [
      { text: t('combinedEvents.deleteCancel'), style: 'cancel' },
      { text: t('combinedEvents.deleteConfirm'), style: 'destructive', onPress: async () => { await deleteCompetition(id); await refresh(category) } },
    ])
  }, [category, refresh, t])

  const loadCompetition = useCallback((comp: SavedCompetition) => {
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(comp.marks)) next[k] = v > 0 ? String(v) : ''
    setMarks(next)
    setSubTab('calc')
  }, [])

  const handleSetGoal = useCallback(async (eventKey: string, text: string) => {
    const v = parseFloat(text) || 0
    setGoals(prev => ({ ...prev, [eventKey]: v }))
    await setGoal(category, eventKey, v)
  }, [category])

  return (
    <SafeAreaView style={ce.safe} edges={['top', 'bottom']}>
      <View style={ce.header}>
        <TouchableOpacity onPress={() => router.back()} style={ce.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityLabel={t('combinedEvents.backLabel')}>
          <Ionicons name="chevron-back" size={26} color={TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={ce.headerTitle}>{t('combinedEvents.headerTitle')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* ── 男女切り替え ── */}
      <View style={ce.segment}>
        {([
          { key: 'men' as const,   label: t('combinedEvents.menCategory') },
          { key: 'women' as const, label: t('combinedEvents.womenCategory') },
        ]).map(o => (
          <TouchableOpacity
            key={o.key}
            style={[ce.segmentBtn, category === o.key && ce.segmentBtnActive]}
            onPress={() => switchCategory(o.key)}
            activeOpacity={0.8}
          >
            <Text style={[ce.segmentText, category === o.key && ce.segmentTextActive]}>{o.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── サブタブ ── */}
      <View style={ce.tabBar}>
        {([
          { key: 'calc' as const,  label: t('combinedEvents.tabCalc') },
          { key: 'match' as const, label: t('combinedEvents.tabMatch') },
          { key: 'pb' as const,    label: t('combinedEvents.tabPb') },
        ]).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[ce.tabItem, subTab === tab.key && ce.tabItemActive]}
            onPress={() => { unlockAudio(); Sounds.tabSwitch(); setSubTab(tab.key) }}
            activeOpacity={0.8}
          >
            <Text style={[ce.tabLabel, subTab === tab.key && ce.tabLabelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={ce.scroll}>
        {subTab === 'calc' && (
          <>
            <View style={ce.totalCard}>
              <Text style={ce.totalLabel}>{t('combinedEvents.totalScore')}</Text>
              <Text style={ce.totalNum}>{totalScore}</Text>
              <Text style={ce.totalSub}>{t('combinedEvents.filledCount', { filled: filledCount, total: events.length })}</Text>
            </View>

            {events.map((e, i) => {
              const mark = numericMarks[e.key]
              const pts = calcEventScore(e, mark)
              return (
                <View key={e.key} style={ce.eventCard}>
                  <View style={ce.eventHeaderRow}>
                    <View style={ce.eventIndex}><Text style={ce.eventIndexText}>{i + 1}</Text></View>
                    <Text style={ce.eventLabel}>{getEventLabel(e.label, language)}</Text>
                    <Text style={[ce.eventPts, mark > 0 && { color: BRAND }]}>{mark > 0 ? `${pts} pt` : t('combinedEvents.ptsUnfilled')}</Text>
                  </View>
                  <View style={ce.eventInputRow}>
                    <TextInput
                      style={ce.eventInput}
                      placeholder={e.unit === 'sec' ? t('combinedEvents.placeholderSec') : e.unit === 'cm' ? t('combinedEvents.placeholderCm') : t('combinedEvents.placeholderM')}
                      placeholderTextColor={TEXT_HINT}
                      keyboardType="decimal-pad"
                      value={marks[e.key] ?? ''}
                      onChangeText={(txt) => setMarks(prev => ({ ...prev, [e.key]: txt }))}
                    />
                    <View style={ce.unitTag}><Text style={ce.unitTagText}>{unitLabel(e.unit, language)}</Text></View>
                  </View>
                </View>
              )
            })}

            <TouchableOpacity style={ce.saveBtn} onPress={handleSave} activeOpacity={0.85}>
              <Ionicons name="save-outline" size={18} color="#fff" />
              <Text style={ce.saveBtnText}>{t('combinedEvents.saveBtn')}</Text>
            </TouchableOpacity>
          </>
        )}

        {subTab === 'match' && (
          competitions.length === 0 ? (
            <View style={ce.emptyWrap}>
              <Ionicons name="trophy-outline" size={36} color={TEXT_HINT} />
              <Text style={ce.emptyText}>{t('combinedEvents.noSavedRecords')}</Text>
            </View>
          ) : (
            competitions.map(comp => (
              <TouchableOpacity key={comp.id} style={ce.matchRow} onPress={() => loadCompetition(comp)} activeOpacity={0.8}>
                <View style={{ flex: 1 }}>
                  <Text style={ce.matchDate}>{comp.date}</Text>
                  <Text style={ce.matchSub}>{t('combinedEvents.eventsFilled', { count: Object.values(comp.marks).filter(v => v > 0).length })}</Text>
                </View>
                <Text style={ce.matchScore}>{t('combinedEvents.pointsSuffix', { score: comp.totalScore })}</Text>
                <TouchableOpacity onPress={() => handleDeleteCompetition(comp.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ marginLeft: 8 }}>
                  <Ionicons name="trash-outline" size={18} color={TEXT_HINT} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          )
        )}

        {subTab === 'pb' && (
          events.map(e => {
            const pb = pbMarks[e.key]
            const goal = goals[e.key]
            return (
              <View key={e.key} style={ce.pbCard}>
                <Text style={ce.eventLabel}>{getEventLabel(e.label, language)}</Text>
                <View style={ce.pbRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={ce.pbCaption}>{t('combinedEvents.personalBest')}</Text>
                    <Text style={ce.pbValue}>{pb !== undefined ? `${pb} ${unitLabel(e.unit, language)}` : t('combinedEvents.notRecorded')}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={ce.pbCaption}>{t('combinedEvents.goal')}</Text>
                    <TextInput
                      style={ce.goalInput}
                      placeholder={t('combinedEvents.goalUnset')}
                      placeholderTextColor={TEXT_HINT}
                      keyboardType="decimal-pad"
                      defaultValue={goal ? String(goal) : ''}
                      onEndEditing={(ev) => handleSetGoal(e.key, ev.nativeEvent.text)}
                    />
                  </View>
                </View>
              </View>
            )
          })
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const ce = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: BG },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT_PRIMARY },

  segment:        { flexDirection: 'row', marginHorizontal: 16, backgroundColor: '#eef0f3', borderRadius: 14, padding: 3, gap: 3 },
  segmentBtn:     { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: CARD, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  segmentText:    { fontSize: 13, fontWeight: '700', color: TEXT_SECONDARY },
  segmentTextActive: { color: TEXT_PRIMARY },

  tabBar:      { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  tabItem:     { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabItemActive: { borderBottomColor: BRAND },
  tabLabel:    { fontSize: 13, fontWeight: '600', color: TEXT_HINT },
  tabLabelActive: { color: BRAND, fontWeight: '800' },

  scroll:      { padding: 16, gap: 12 },

  totalCard:   { backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER, borderRadius: 21, padding: 22, alignItems: 'center', marginBottom: 4 },
  totalLabel:  { fontSize: 12, color: TEXT_SECONDARY, marginBottom: 6 },
  totalNum:    { fontSize: 40, fontWeight: '900', color: BRAND, fontVariant: ['tabular-nums'] },
  totalSub:    { fontSize: 12, color: TEXT_HINT, marginTop: 4 },

  eventCard:   { backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER, borderRadius: 18, padding: 14, gap: 10 },
  eventHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eventIndex:  { width: 22, height: 22, borderRadius: 11, backgroundColor: '#eef0f3', alignItems: 'center', justifyContent: 'center' },
  eventIndexText: { fontSize: 11, fontWeight: '800', color: TEXT_SECONDARY },
  eventLabel:  { fontSize: 15, fontWeight: '800', color: TEXT_PRIMARY, flex: 1 },
  eventPts:    { fontSize: 14, fontWeight: '800', color: TEXT_HINT, fontVariant: ['tabular-nums'] },
  eventInputRow: { flexDirection: 'row', gap: 8 },
  eventInput:  { flex: 1, backgroundColor: '#f6f6f8', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: TEXT_PRIMARY, borderWidth: 1, borderColor: BORDER },
  unitTag:     { paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eef0f3', borderRadius: 12 },
  unitTagText: { fontSize: 13, fontWeight: '700', color: TEXT_SECONDARY },

  saveBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 21, paddingVertical: 16, marginTop: 8 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  emptyWrap:   { alignItems: 'center', gap: 8, paddingVertical: 60 },
  emptyText:   { fontSize: 13, color: TEXT_HINT },

  matchRow:    { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER, borderRadius: 16, padding: 14 },
  matchDate:   { fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY },
  matchSub:    { fontSize: 11.5, color: TEXT_HINT, marginTop: 2 },
  matchScore:  { fontSize: 18, fontWeight: '900', color: BRAND, fontVariant: ['tabular-nums'] },

  pbCard:      { backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER, borderRadius: 16, padding: 14, gap: 10 },
  pbRow:       { flexDirection: 'row', gap: 16 },
  pbCaption:   { fontSize: 11, color: TEXT_HINT, marginBottom: 4 },
  pbValue:     { fontSize: 15, fontWeight: '800', color: TEXT_PRIMARY, fontVariant: ['tabular-nums'] },
  goalInput:   { backgroundColor: '#f6f6f8', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: TEXT_PRIMARY, borderWidth: 1, borderColor: BORDER },
})

// app/multi-event-score.tsx — 混成競技ツール（男子十種競技／女子七種競技の得点計算・記録・PB管理）
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

// 2026-09-03: 配色・レイアウトを全面的に刷新（緑基調→インディゴ基調、カード構成も変更）
const BRAND = '#4338ca'
const BRAND_SOFT = '#eef0ff'
const BG = '#faf9fc'
const CARD = '#ffffff'
const BORDER = 'rgba(67,56,202,0.14)'
const TEXT_PRIMARY = '#1e1b3a'
const TEXT_SECONDARY = '#635f7a'
const TEXT_HINT = '#a29dbd'

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

      {/* ── 種別(男女)ピル切り替え・サブナビゲーションを1つの帯にまとめて表示 ── */}
      <View style={ce.controlRow}>
        <View style={ce.categoryPills}>
          {([
            { key: 'men' as const,   label: t('combinedEvents.menCategory') },
            { key: 'women' as const, label: t('combinedEvents.womenCategory') },
          ]).map(o => (
            <TouchableOpacity
              key={o.key}
              style={[ce.categoryPill, category === o.key && ce.categoryPillActive]}
              onPress={() => switchCategory(o.key)}
              activeOpacity={0.8}
            >
              <Text style={[ce.categoryPillText, category === o.key && ce.categoryPillTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── サブナビゲーション（履歴を先頭に。ピル型・アイコン付き） ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ce.subNavRow}>
        {([
          { key: 'pb' as const,    label: t('combinedEvents.tabPb'),    icon: 'ribbon-outline' as const },
          { key: 'calc' as const,  label: t('combinedEvents.tabCalc'),  icon: 'calculator-outline' as const },
          { key: 'match' as const, label: t('combinedEvents.tabMatch'), icon: 'time-outline' as const },
        ]).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[ce.subNavChip, subTab === tab.key && ce.subNavChipActive]}
            onPress={() => { unlockAudio(); Sounds.tabSwitch(); setSubTab(tab.key) }}
            activeOpacity={0.8}
          >
            <Ionicons name={tab.icon} size={14} color={subTab === tab.key ? '#fff' : TEXT_SECONDARY} />
            <Text style={[ce.subNavChipText, subTab === tab.key && ce.subNavChipTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={ce.scroll}>
        {subTab === 'calc' && (
          <>
            <View style={ce.totalCard}>
              <View style={{ flex: 1 }}>
                <Text style={ce.totalLabel}>{t('combinedEvents.totalScore')}</Text>
                <Text style={ce.totalNum}>{totalScore}</Text>
              </View>
              <View style={ce.totalProgressWrap}>
                <View style={ce.totalProgressRing}>
                  <Text style={ce.totalProgressText}>{filledCount}/{events.length}</Text>
                </View>
                <Text style={ce.totalSub}>{t('combinedEvents.filledCount', { filled: filledCount, total: events.length })}</Text>
              </View>
            </View>

            {events.map((e, i) => {
              const mark = numericMarks[e.key]
              const pts = calcEventScore(e, mark)
              return (
                <View key={e.key} style={ce.eventRow}>
                  <View style={[ce.eventAccent, mark > 0 && { backgroundColor: BRAND }]} />
                  <View style={ce.eventRowBody}>
                    <View style={ce.eventRowTop}>
                      <Text style={ce.eventLabel} numberOfLines={1}>{i + 1}. {getEventLabel(e.label, language)}</Text>
                      <Text style={[ce.eventPts, mark > 0 && { color: BRAND }]}>{mark > 0 ? `${pts}` : '—'}</Text>
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
                      <Text style={ce.unitTagText}>{unitLabel(e.unit, language)}</Text>
                    </View>
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

  controlRow:     { flexDirection: 'row', justifyContent: 'center', marginTop: 4, marginBottom: 14 },
  categoryPills:  { flexDirection: 'row', gap: 8 },
  categoryPill:   { paddingHorizontal: 20, paddingVertical: 9, borderRadius: 20, backgroundColor: BRAND_SOFT, borderWidth: 1.5, borderColor: 'transparent' },
  categoryPillActive: { backgroundColor: BRAND + '18', borderColor: BRAND },
  categoryPillText: { fontSize: 13, fontWeight: '700', color: TEXT_SECONDARY },
  categoryPillTextActive: { color: BRAND },

  subNavRow:   { flexDirection: 'row', paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  subNavChip:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18, backgroundColor: BRAND_SOFT },
  subNavChipActive: { backgroundColor: BRAND },
  subNavChipText: { fontSize: 12.5, fontWeight: '700', color: TEXT_SECONDARY },
  subNavChipTextActive: { color: '#fff' },

  scroll:      { padding: 16, paddingTop: 12, gap: 12 },

  totalCard:   { flexDirection: 'row', backgroundColor: BRAND, borderRadius: 24, padding: 20, alignItems: 'center', marginBottom: 4 },
  totalLabel:  { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginBottom: 4, fontWeight: '700' },
  totalNum:    { fontSize: 38, fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'] },
  totalProgressWrap: { alignItems: 'center', gap: 6 },
  totalProgressRing: { width: 54, height: 54, borderRadius: 27, borderWidth: 3, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  totalProgressText: { fontSize: 13, fontWeight: '800', color: '#fff' },
  totalSub:    { fontSize: 10.5, color: 'rgba(255,255,255,0.75)' },

  eventRow:    { flexDirection: 'row', backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 14, overflow: 'hidden' },
  eventAccent: { width: 4, backgroundColor: '#e4e2f4' },
  eventRowBody:{ flex: 1, padding: 12, gap: 8 },
  eventRowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eventLabel:  { fontSize: 14, fontWeight: '800', color: TEXT_PRIMARY, flex: 1 },
  eventPts:    { fontSize: 14, fontWeight: '800', color: TEXT_HINT, fontVariant: ['tabular-nums'] },
  eventInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eventInput:  { flex: 1, backgroundColor: BRAND_SOFT, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: TEXT_PRIMARY },
  unitTagText: { fontSize: 12.5, fontWeight: '700', color: TEXT_SECONDARY, width: 36 },

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
  goalInput:   { backgroundColor: BRAND_SOFT, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: TEXT_PRIMARY, borderWidth: 1, borderColor: BORDER },
})

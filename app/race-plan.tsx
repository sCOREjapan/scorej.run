// app/race-plan.tsx — レース行動予定（選手が時刻＋内容のブロックを積み上げて作り、
// 完成したら1枚のデータとしてコーチに提出する画面）
//
// 2026-09-20: 実際のコーチ(みずの)からのLINE相談で出た「試合当日の行動予定表を
// 選手に作らせて提出させたい」という要望に基づく新機能。mitameスキルの2回のプレビュー
// (ui-previews/2026-09-18-race-plan-timeline-3案.html)でユーザーが選んだ「B: ライト・
// タイムライン」案を実装。ブロックは都度同期せず、「提出する」を押した瞬間に
// ブロック配列＋目標タイム/ラップ＋意気込みをまとめて1件のデータとしてSupabaseに
// 書き込む（supabase/team_race_plans_migration.sql参照）。

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { useTranslation } from 'react-i18next'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { BRAND } from '../lib/theme'
import { Sounds, unlockAudio } from '../lib/sounds'
import HapticTouch from '../components/HapticTouch'
import ModalSheet from '../components/ModalSheet'
import ConfirmSheet from '../components/ConfirmSheet'
import { RacePlanDetailContent } from '../components/RacePlanDetail'
import { submitRacePlan, fetchRacePlans, type RacePlanBlock, type TeamRacePlanRow } from '../lib/supabaseTeam'
import { sendPush } from '../lib/notify'

const JOINED_KEY = 'trackmate_team_joined'
const DRAFT_KEY  = 'trackmate_race_plan_draft_v1'

interface JoinedTeam { code: string; playerName: string }

interface Draft {
  title:      string
  raceDate:   string
  eventId:    string
  blocks:     RacePlanBlock[]
  targetTime: string
  splits:     string
  goal:       string
}

const EMPTY_DRAFT: Draft = { title: '', raceDate: '', eventId: '', blocks: [], targetTime: '', splits: '', goal: '' }

export default function RacePlanScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ title?: string; date?: string; eventId?: string }>()
  const s = React.useMemo(() => makeStyles(colors), [colors])

  const [joined,        setJoined]        = useState<JoinedTeam | null>(null)
  const [draft,         setDraft]         = useState<Draft>(EMPTY_DRAFT)
  const [showAddModal,  setShowAddModal]  = useState(false)
  const [newTime,       setNewTime]       = useState('')
  const [newContent,    setNewContent]    = useState('')
  const [submitting,    setSubmitting]    = useState(false)
  const [history,       setHistory]       = useState<TeamRacePlanRow[]>([])
  const [viewingPlan,   setViewingPlan]   = useState<TeamRacePlanRow | null>(null)
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState<number | null>(null)
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)

  const draftLoadedRef = useRef(false)

  // 初回ロード: 参加チーム情報 + 保存済みドラフト + 提出履歴
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(JOINED_KEY)
        const j: JoinedTeam | null = raw ? JSON.parse(raw) : null
        setJoined(j)
        const draftRaw = await AsyncStorage.getItem(DRAFT_KEY)
        if (draftRaw) {
          // 2026-09-21実バグ対応: eventId追加前に保存された古いドラフトにはeventId
          // キーが無く、そのままsetDraftすると後続の.trim()呼び出しでundefinedエラーに
          // なっていた（「Cannot read properties of undefined (reading 'trim')」）。
          // EMPTY_DRAFTでデフォルト値を補完してからマージする。
          setDraft({ ...EMPTY_DRAFT, ...JSON.parse(draftRaw) })
        } else if (params.title || params.date || params.eventId) {
          setDraft(d => ({ ...d, title: params.title ?? d.title, raceDate: params.date ?? d.raceDate, eventId: params.eventId ?? d.eventId }))
        }
        draftLoadedRef.current = true
        if (j?.code) {
          const rows = await fetchRacePlans(j.code, j.playerName)
          setHistory(rows)
        }
      } catch {}
    })()
  }, [])

  // ドラフトの自動保存（積み上げていく途中で消えないように）
  useEffect(() => {
    if (!draftLoadedRef.current) return
    AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => {})
  }, [draft])

  const openAddModal = useCallback(() => {
    unlockAudio(); Sounds.tap()
    setNewTime(''); setNewContent('')
    setShowAddModal(true)
  }, [])

  const confirmAddBlock = useCallback(() => {
    if (!newTime.trim() || !newContent.trim()) return
    Sounds.pop()
    setDraft(d => ({ ...d, blocks: [...d.blocks, { time: newTime.trim(), content: newContent.trim() }] }))
    setShowAddModal(false)
  }, [newTime, newContent])

  // 2026-09-21実バグ対応: React Native WebのAlert.alert()は複数ボタン確認ダイアログとして
  // 信頼できず、実機で「削除」「提出する」を押しても何も起きないように見える不具合が
  // あった。ConfirmSheet（自前Modal）に置き換える。
  const removeBlock = useCallback((idx: number) => {
    setPendingDeleteIdx(idx)
  }, [])

  const confirmRemoveBlock = useCallback(() => {
    if (pendingDeleteIdx === null) return
    const idx = pendingDeleteIdx
    setDraft(d => ({ ...d, blocks: d.blocks.filter((_, i) => i !== idx) }))
  }, [pendingDeleteIdx])

  const handleSubmit = useCallback(() => {
    // 2026-09-21実バグ対応: 参加チーム情報が読み込めていない(未参加 or 読み込み中)場合に
    // 何のフィードバックも無く無反応になっていた（「提出するボタンを押しても提出され
    // ない」の実体）。読み込み中に押された場合も含めて必ずエラーを見せる。
    if (!joined?.code) {
      Toast.show({ type: 'error', text1: t('racePlan.notJoinedError') })
      return
    }
    if (draft.blocks.length === 0) {
      Toast.show({ type: 'error', text1: t('racePlan.needAtLeastOneBlock') })
      return
    }
    setShowSubmitConfirm(true)
  }, [joined, draft])

  const doSubmit = useCallback(async () => {
    if (!joined?.code) return
    setSubmitting(true)
    try {
      await submitRacePlan(joined.code, joined.playerName, {
        title: (draft.title || '').trim() || t('racePlan.title'),
        raceDate: (draft.raceDate || '').trim(),
        eventId: (draft.eventId || '').trim(),
        blocks: draft.blocks,
        targetTime: (draft.targetTime || '').trim(),
        splits: (draft.splits || '').trim(),
        goal: (draft.goal || '').trim(),
      })
      sendPush(
        t('racePlan.pushTitle'),
        t('racePlan.pushBody', { name: joined.playerName, title: draft.title.trim() || t('racePlan.title') }),
        'coaches', joined.code,
      ).catch(() => {})
      Toast.show({ type: 'success', text1: t('racePlan.submitSuccess'), visibilityTime: 2000 })
      setDraft(EMPTY_DRAFT)
      await AsyncStorage.removeItem(DRAFT_KEY)
      const rows = await fetchRacePlans(joined.code, joined.playerName)
      setHistory(rows)
    } catch (e: any) {
      Toast.show({ type: 'error', text1: t('racePlan.submitFailed'), text2: e?.message })
    } finally {
      setSubmitting(false)
    }
  }, [joined, draft, t])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

          <View style={[s.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('racePlan.back')}>
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[s.headerTitle, { color: colors.text }]}>{t('racePlan.title')}</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

            {/* 大会名・日付 */}
            <View style={{ gap: 8, marginBottom: 20 }}>
              <TextInput
                style={[s.titleInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                value={draft.title}
                onChangeText={v => setDraft(d => ({ ...d, title: v }))}
                placeholder={t('racePlan.titlePlaceholder')}
                placeholderTextColor={colors.textHint}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="calendar-outline" size={16} color={colors.textHint} />
                <Text style={{ color: colors.textHint, fontSize: 12, fontWeight: '700' }}>{t('racePlan.dateLabel')}</Text>
                <TextInput
                  style={[s.dateInput, { color: colors.text }]}
                  value={draft.raceDate}
                  onChangeText={v => setDraft(d => ({ ...d, raceDate: v }))}
                  placeholder="2026-09-28"
                  placeholderTextColor={colors.textHint}
                />
              </View>
            </View>

            {/* タイムライン */}
            <Text style={[s.sectionTitle, { color: colors.text }]}>{t('racePlan.timelineSectionTitle')}</Text>
            {draft.blocks.length === 0 ? (
              <View style={[s.emptyBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={{ fontSize: 24 }}>🏁</Text>
                <Text style={{ color: colors.textHint, fontSize: 12.5, textAlign: 'center', lineHeight: 18 }}>{t('racePlan.timelineEmpty')}</Text>
              </View>
            ) : (
              <View style={{ gap: 10, marginBottom: 4 }}>
                {draft.blocks.map((b, i) => (
                  <View key={i} style={[s.blockCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={s.timeBadge}><Text style={s.timeBadgeText}>{b.time}</Text></View>
                    <Text style={[s.blockContent, { color: colors.text }]}>{b.content}</Text>
                    <TouchableOpacity onPress={() => removeBlock(i)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('racePlan.deleteBlockConfirmTitle')}>
                      <Ionicons name="close" size={16} color={colors.textHint} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <HapticTouch haptic="tap" style={s.addBlockBtn} onPress={openAddModal}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={s.addBlockBtnText}>{t('racePlan.addBlockBtn')}</Text>
            </HapticTouch>

            {/* 目標タイム・ラップ */}
            <Text style={[s.sectionTitle, { color: colors.text, marginTop: 28 }]}>{t('racePlan.targetSectionTitle')}</Text>
            <View style={{ gap: 8, marginBottom: 20 }}>
              <TextInput
                style={[s.fieldInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                value={draft.targetTime}
                onChangeText={v => setDraft(d => ({ ...d, targetTime: v }))}
                placeholder={t('racePlan.targetTimePlaceholder')}
                placeholderTextColor={colors.textHint}
              />
              <TextInput
                style={[s.fieldInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                value={draft.splits}
                onChangeText={v => setDraft(d => ({ ...d, splits: v }))}
                placeholder={t('racePlan.splitsPlaceholder')}
                placeholderTextColor={colors.textHint}
              />
            </View>

            {/* 目標・意気込み */}
            <Text style={[s.sectionTitle, { color: colors.text }]}>{t('racePlan.goalSectionTitle')}</Text>
            <TextInput
              style={[s.goalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              value={draft.goal}
              onChangeText={v => setDraft(d => ({ ...d, goal: v }))}
              placeholder={t('racePlan.goalPlaceholder')}
              placeholderTextColor={colors.textHint}
              multiline
              textAlignVertical="top"
            />

            {/* 提出履歴 */}
            <Text style={[s.sectionTitle, { color: colors.text, marginTop: 28 }]}>{t('racePlan.historyTitle')}</Text>
            {history.length === 0 ? (
              <Text style={{ color: colors.textHint, fontSize: 12.5 }}>{t('racePlan.historyEmpty')}</Text>
            ) : (
              <View style={{ gap: 8 }}>
                {history.map(h => (
                  <TouchableOpacity key={h.id} style={[s.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => setViewingPlan(h)} activeOpacity={0.7}>
                    <Ionicons name="document-text-outline" size={18} color={BRAND} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 13.5, fontWeight: '700' }}>{h.title || t('racePlan.title')}</Text>
                      <Text style={{ color: colors.textHint, fontSize: 11 }}>{h.race_date || '—'}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textHint} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={{ height: 100 }} />
          </ScrollView>

          {/* 固定: コーチに提出する */}
          <View style={[s.submitBar, { backgroundColor: colors.bg, borderTopColor: colors.border }]}>
            <HapticTouch
              haptic="save"
              style={[s.submitBtn, (submitting || draft.blocks.length === 0) && { opacity: 0.4 }]}
              onPress={handleSubmit}
              disabled={submitting || draft.blocks.length === 0}
            >
              <Ionicons name="paper-plane" size={16} color="#fff" />
              <Text style={s.submitBtnText}>{t('racePlan.submitBtn')}</Text>
            </HapticTouch>
          </View>

        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* 予定を追加モーダル */}
      <Modal visible={showAddModal} transparent animationType="fade" onRequestClose={() => setShowAddModal(false)}>
        <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setShowAddModal(false)}>
          <TouchableOpacity activeOpacity={1} style={[s.addModalSheet, { backgroundColor: colors.surface }]}>
            <Text style={[s.modalTitle, { color: colors.text }]}>{t('racePlan.addBlockModalTitle')}</Text>
            <View style={{ gap: 10 }}>
              <View>
                <Text style={[s.modalLabel, { color: colors.textHint }]}>{t('racePlan.timeInputLabel')}</Text>
                <TextInput
                  style={[s.modalInput, { backgroundColor: colors.surface2, color: colors.text }]}
                  value={newTime}
                  onChangeText={setNewTime}
                  placeholder={t('racePlan.timePlaceholder')}
                  placeholderTextColor={colors.textHint}
                  autoFocus
                />
              </View>
              <View>
                <Text style={[s.modalLabel, { color: colors.textHint }]}>{t('racePlan.contentInputLabel')}</Text>
                <TextInput
                  style={[s.modalInput, { backgroundColor: colors.surface2, color: colors.text }]}
                  value={newContent}
                  onChangeText={setNewContent}
                  placeholder={t('racePlan.contentPlaceholder')}
                  placeholderTextColor={colors.textHint}
                />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <TouchableOpacity style={[s.modalBtn, { backgroundColor: colors.surface2 }]} onPress={() => setShowAddModal(false)}>
                <Text style={{ color: colors.textSec, fontSize: 14, fontWeight: '700' }}>{t('racePlan.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: BRAND, opacity: (newTime.trim() && newContent.trim()) ? 1 : 0.5 }]}
                onPress={confirmAddBlock}
                disabled={!(newTime.trim() && newContent.trim())}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{t('racePlan.addConfirm')}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* 提出済みプランの閲覧（1枚のデータとして表示） */}
      <ModalSheet visible={!!viewingPlan} onClose={() => setViewingPlan(null)} backgroundColor={colors.bg}>
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => setViewingPlan(null)} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.text }]} numberOfLines={1}>{viewingPlan?.title || t('racePlan.title')}</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={s.content}>
          {viewingPlan && (
            <>
              <View style={[s.viewOnlyBadge, { backgroundColor: colors.surface2 }]}>
                <Text style={{ color: colors.textHint, fontSize: 11, fontWeight: '700' }}>{t('racePlan.viewOnly')}</Text>
              </View>
              <RacePlanDetailContent plan={viewingPlan} colors={colors} />
            </>
          )}
        </ScrollView>
      </ModalSheet>

      <ConfirmSheet
        visible={pendingDeleteIdx !== null}
        title={t('racePlan.deleteBlockConfirmTitle')}
        message=""
        confirmLabel={t('racePlan.deleteBlockConfirm')}
        dangerous
        onConfirm={confirmRemoveBlock}
        onCancel={() => setPendingDeleteIdx(null)}
      />
      <ConfirmSheet
        visible={showSubmitConfirm}
        title={t('racePlan.submitConfirmTitle')}
        message={t('racePlan.submitConfirmMessage')}
        confirmLabel={t('racePlan.submitConfirmOk')}
        onConfirm={doSubmit}
        onCancel={() => setShowSubmitConfirm(false)}
      />
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
    backBtn:      { padding: 4 },
    headerTitle:  { fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
    content:      { padding: 20 },
    sectionTitle: { fontSize: 14, fontWeight: '800', marginBottom: 10 },

    titleInput:   { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, fontWeight: '700' },
    dateInput:    { fontSize: 13, fontWeight: '700', flex: 1 },

    emptyBox:     { borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', padding: 22, alignItems: 'center', gap: 8, marginBottom: 14 },

    blockCard:    { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
    timeBadge:    { backgroundColor: BRAND, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
    timeBadgeText:{ color: '#fff', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
    blockContent: { flex: 1, fontSize: 14, lineHeight: 20 },

    addBlockBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 28, paddingVertical: 15, marginTop: 4, shadowColor: BRAND, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
    addBlockBtnText: { color: '#fff', fontSize: 14.5, fontWeight: '800' },

    fieldInput:   { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
    goalInput:    { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, lineHeight: 21, minHeight: 100, marginBottom: 4 },

    historyCard:  { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
    viewOnlyBadge:{ alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },

    submitBar:    { paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 16 : 12, borderTopWidth: 1 },
    submitBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 25, paddingVertical: 15 },
    submitBtnText:{ color: '#fff', fontSize: 15.5, fontWeight: '800' },

    modalBackdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    addModalSheet:  { borderRadius: 20, padding: 20, gap: 14, marginHorizontal: 24, marginBottom: 40, alignSelf: 'center', width: '100%', maxWidth: 340 },
    modalTitle:     { fontSize: 16, fontWeight: '800' },
    modalLabel:     { fontSize: 11, fontWeight: '700', marginBottom: 4 },
    modalInput:     { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
    modalBtn:       { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12 },
  })
}

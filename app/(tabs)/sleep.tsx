import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, TextInput, Animated, Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { NEON, BRAND } from '../../lib/theme'
import { useTheme, type ThemeColors } from '../../context/ThemeContext'
import { Ionicons } from '@expo/vector-icons'
import Toast from 'react-native-toast-message'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import { Sounds } from '../../lib/sounds'
import HapticTouch from '../../components/HapticTouch'
import AnimatedSection from '../../components/AnimatedSection'
import type { SleepRecord } from '../../types'
import { localDateStr, todayLocalISO } from '../../lib/dateLocal'
import { getSleepRecords, updateSleepRecords } from '../../lib/sleepStore'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../../context/LanguageContext'
import type { Language } from '../../context/LanguageContext'
const SCREEN_W = Dimensions.get('window').width

function qualityColor(q: number) {
  if (q >= 8) return '#34C759'
  if (q >= 5) return '#FF9500'
  return '#FF3B30'
}

function fmtDuration(min?: number, lang: Language = 'ja') {
  if (!min) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (lang === 'en') return h > 0 ? `${h}h${m > 0 ? ' ' + m + 'm' : ''}` : `${m}m`
  return h > 0 ? `${h}時間${m > 0 ? m + '分' : ''}` : `${m}分`
}

function SkeletonRect({ height = 16, width = '100%' as number | string }) {
  const { colors } = useTheme()
  const opacity = useRef(new Animated.Value(0.3)).current
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
    ]))
    a.start(); return () => a.stop()
  }, [opacity])
  return <Animated.View style={{ height, width: width as any, borderRadius: 8, backgroundColor: colors.surface2, opacity }} />
}

// ── +/- ボタン式時刻ピッカー ──────────────────────────────────
function TimePicker({ label, hour, minute, onChangeHour, onChangeMinte, color }: {
  label: string
  hour: number
  minute: number
  onChangeHour: (h: number) => void
  onChangeMinte: (m: number) => void
  color: string
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const tp = useMemo(() => makeTpStyles(colors), [colors])
  function incHour()  { onChangeHour((hour + 1) % 24) }
  function decHour()  { onChangeHour((hour + 23) % 24) }
  function incMin()   { onChangeMinte((Math.floor(minute / 5) * 5 + 5) % 60) }
  function decMin()   { onChangeMinte(((Math.ceil(minute / 5) * 5 - 5) + 60) % 60) }

  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <Text style={{ color: colors.textSec, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {/* 時 */}
        <View style={{ alignItems: 'center', gap: 3 }}>
          <TouchableOpacity onPress={incHour} style={tp.btn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={t('sleep.timeIncHour', { label })}>
            <Ionicons name="chevron-up" size={16} color={color} />
          </TouchableOpacity>
          <View style={[tp.box, { borderColor: color + '60' }]}>
            <Text style={[tp.val, { color }]}>{pad(hour)}</Text>
          </View>
          <TouchableOpacity onPress={decHour} style={tp.btn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={t('sleep.timeDecHour', { label })}>
            <Ionicons name="chevron-down" size={16} color={color} />
          </TouchableOpacity>
        </View>
        <Text style={{ color: colors.textHint, fontSize: 22, fontWeight: '300', marginBottom: 4 }}>:</Text>
        {/* 分（5分刻み） */}
        <View style={{ alignItems: 'center', gap: 3 }}>
          <TouchableOpacity onPress={incMin} style={tp.btn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={t('sleep.timeIncMin', { label })}>
            <Ionicons name="chevron-up" size={16} color={color} />
          </TouchableOpacity>
          <View style={[tp.box, { borderColor: color + '60' }]}>
            <Text style={[tp.val, { color }]}>{pad(minute)}</Text>
          </View>
          <TouchableOpacity onPress={decMin} style={tp.btn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={t('sleep.timeDecMin', { label })}>
            <Ionicons name="chevron-down" size={16} color={color} />
          </TouchableOpacity>
        </View>
      </View>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{pad(hour)}:{pad(minute)}</Text>
    </View>
  )
}

const makeTpStyles = (colors: ThemeColors) => StyleSheet.create({
  btn:  { width: 32, height: 26, alignItems: 'center', justifyContent: 'center' },
  box:  { width: 46, height: 44, borderRadius: 14, borderWidth: 1.5, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  val:  { fontSize: 22, fontWeight: '800', letterSpacing: 0.5, fontVariant: ['tabular-nums'] },
})

// ── 睡眠時間の折れ線グラフ ────────────────────────────────────
const Y_AXIS_W = 36
const PLOT_H   = 100
const X_AXIS_H = 16

function SleepLineChart({ records }: { records: SleepRecord[] }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const data = [...records]
    .sort((a, b) => a.sleep_date.localeCompare(b.sleep_date))
    .slice(-20)
    .filter(r => r.duration_min && r.duration_min > 0)
    .map(r => ({ date: r.sleep_date, hours: (r.duration_min ?? 0) / 60 }))

  if (data.length < 2) return null

  const PLOT_W = SCREEN_W - 64 - Y_AXIS_W

  const vals = data.map(d => d.hours)
  const rawMax = Math.max(...vals)
  const rawMin = Math.min(...vals)
  const pad    = (rawMax - rawMin) * 0.2 || 1
  const yMax   = Math.min(12, rawMax + pad)
  const yMin   = Math.max(0, rawMin - pad)
  const yRange = yMax - yMin

  const yTicks = [yMax, (yMax + yMin) / 2, yMin].map(v => Math.round(v * 10) / 10)

  function xFor(i: number) {
    return data.length === 1 ? PLOT_W / 2 : (i / (data.length - 1)) * PLOT_W
  }
  function yFor(h: number) {
    return PLOT_H - ((h - yMin) / yRange) * PLOT_H
  }

  const step = Math.max(1, Math.floor(data.length / 6))

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.textSec, fontSize: 12, fontWeight: '700' }}>{t('sleep.trendChart')}</Text>
      <View style={{ flexDirection: 'row' }}>
        {/* Y軸 */}
        <View style={{ width: Y_AXIS_W, height: PLOT_H, justifyContent: 'space-between', alignItems: 'flex-end', paddingRight: 5 }}>
          {yTicks.map((v, i) => (
            <Text key={i} style={{ color: colors.textHint, fontSize: 9 }}>{v.toFixed(1)}h</Text>
          ))}
        </View>
        {/* プロット */}
        <View style={{ width: PLOT_W, height: PLOT_H + X_AXIS_H }}>
          {/* グリッド */}
          {yTicks.map((_, i) => {
            const y = i === 0 ? 0 : i === 1 ? PLOT_H / 2 : PLOT_H - 1
            return <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: y, height: 1, backgroundColor: colors.border }} />
          })}
          {/* 折れ線 */}
          {data.slice(0, -1).map((d, i) => {
            const x1 = xFor(i),     y1 = yFor(d.hours)
            const x2 = xFor(i + 1), y2 = yFor(data[i + 1].hours)
            const dx = x2 - x1, dy = y2 - y1
            const len   = Math.sqrt(dx * dx + dy * dy)
            const angle = Math.atan2(dy, dx) * 180 / Math.PI
            return (
              <View key={`l${i}`} style={{
                position: 'absolute',
                left: (x1 + x2) / 2 - len / 2, top: (y1 + y2) / 2 - 1,
                width: len, height: 2,
                backgroundColor: NEON.blue,
                borderRadius: 1,
                transform: [{ rotate: `${angle}deg` }],
              }} />
            )
          })}
          {/* ドット */}
          {data.map((d, i) => {
            const x = xFor(i), y = yFor(d.hours)
            const isLatest = i === data.length - 1
            return (
              <View key={`d${i}`} style={{
                position: 'absolute',
                left: x - 4, top: y - 4,
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: isLatest ? BRAND : NEON.blue,
                borderWidth: isLatest ? 2 : 1,
                borderColor: colors.card,
              }} />
            )
          })}
          {/* X軸ラベル */}
          {data.map((d, i) => {
            if (i % step !== 0 && i !== data.length - 1) return null
            const x = xFor(i)
            const dt = new Date(d.date)
            return (
              <Text key={`x${i}`} style={{
                position: 'absolute', left: x - 12, top: PLOT_H + 2,
                width: 24, textAlign: 'center', color: colors.textHint, fontSize: 8,
              }}>{`${dt.getMonth()+1}/${dt.getDate()}`}</Text>
            )
          })}
        </View>
      </View>
    </View>
  )
}

// ── 睡眠履歴カード ─────────────────────────────────────────
function SleepCard({ record, onEdit, onDelete }: {
  record: SleepRecord
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const color = qualityColor(record.quality_score)
  return (
    <TouchableOpacity onPress={onEdit} activeOpacity={0.75} style={styles.sleepCard}>
      <View style={styles.sleepLeft}>
        <Text style={styles.sleepDate}>{record.sleep_date}</Text>
        {record.duration_min ? (
          <Text style={styles.sleepDuration}>{fmtDuration(record.duration_min, language)}</Text>
        ) : null}
        {record.notes ? <Text style={styles.sleepNotes} numberOfLines={1}>{record.notes}</Text> : null}
      </View>
      <View style={[styles.qualityBadge, { borderColor: color }]}>
        <Text style={[styles.qualityValue, { color }]}>{record.quality_score}</Text>
        <Text style={styles.qualityMax}>/10</Text>
      </View>
      <TouchableOpacity onPress={onDelete} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ padding: 4 }} accessibilityLabel={t('sleep.deleteRecord')}>
        <Ionicons name="trash-outline" size={16} color={colors.textSec} />
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

// ── メイン ─────────────────────────────────────────────────
export default function SleepScreen() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const today = todayLocalISO()
  const [records, setRecords] = useState<SleepRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [recordDate, setRecordDate] = useState(today)

  // 時刻（数値で管理）
  const [bedHour,  setBedHour]  = useState(23)
  const [bedMin,   setBedMin]   = useState(30)
  const [wakeHour, setWakeHour] = useState(7)
  const [wakeMin,  setWakeMin]  = useState(0)
  // 就寝〜起床の間に途中で目が覚めていた時間（分）。実質睡眠時間の計算から差し引く
  const [awakeMin, setAwakeMin] = useState(0)
  const [quality,  setQuality]  = useState(7)
  const [notes, setNotes] = useState('')

  // ±7日の日付リスト
  const dateRange = Array.from({ length: 15 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 7 + i)
    return localDateStr(d)
  })

  // 睡眠時間計算
  const bedTotalMin  = bedHour * 60 + bedMin
  let wakeTotalMin   = wakeHour * 60 + wakeMin
  if (wakeTotalMin <= bedTotalMin) wakeTotalMin += 24 * 60
  const durationMin = Math.max(0, wakeTotalMin - bedTotalMin - awakeMin)

  const pad = (n: number) => String(n).padStart(2, '0')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const recs = await getSleepRecords()
      setRecords(recs)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  // 体重・睡眠等はホーム画面のクイック記録(QuickConditionModal)からも書き込まれるため、
  // マウント時だけでなくタブに戻るたびに再読み込みする
  useFocusEffect(useCallback(() => { load() }, [load]))

  async function handleDelete(id: string) {
    const updated = await updateSleepRecords(current => current.filter(r => r.id !== id))
    setRecords(updated)
    Toast.show({ type: 'success', text1: t('sleep.deleted'), visibilityTime: 1200 })
  }

  function handleEditRecord(record: SleepRecord) {
    handleSelectDate(record.sleep_date)
    setFormOpen(true)
    // スクロールしてフォームが見えるように少し後で実行
  }

  // 日付選択時に既存記録があれば時刻を復元
  function handleSelectDate(date: string) {
    setRecordDate(date)
    const existing = records.find(r => r.sleep_date === date)
    if (existing?.sleep_start) {
      const t = new Date(existing.sleep_start)
      setBedHour(t.getHours()); setBedMin(t.getMinutes())
    }
    if (existing?.sleep_end) {
      const t = new Date(existing.sleep_end)
      setWakeHour(t.getHours()); setWakeMin(t.getMinutes())
    }
    if (existing) setQuality(existing.quality_score)
    setAwakeMin(existing?.awake_min ?? 0)
  }

  function formatDateLabel(dateStr: string) {
    const d = new Date(dateStr)
    const diff = Math.round((d.getTime() - new Date(today).getTime()) / 86400000)
    if (diff === 0) return t('sleep.dateToday')
    if (diff === -1) return t('sleep.dateYesterday')
    if (diff === 1) return t('sleep.dateTomorrow')
    if (language === 'en') return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', weekday: 'short' })
    const dow = ['日','月','火','水','木','金','土'][d.getDay()]
    return `${d.getMonth()+1}/${d.getDate()}(${dow})`
  }

  async function handleSave() {
    setSaving(true)
    try {
      // sleep_start/end を ISO 文字列で保存
      const dateBase = new Date(recordDate + 'T00:00:00')
      const sleepStart = new Date(dateBase)
      sleepStart.setHours(bedHour, bedMin, 0, 0)
      // 就寝が深夜の場合、前日扱い
      const sleepEnd = new Date(dateBase)
      sleepEnd.setHours(wakeHour, wakeMin, 0, 0)
      if (sleepEnd <= sleepStart) sleepEnd.setDate(sleepEnd.getDate() + 1)

      const record: SleepRecord = {
        id: Crypto.randomUUID(),
        user_id: (await AsyncStorage.getItem('userId').catch(() => null)) ?? 'local',
        sleep_date: recordDate,
        sleep_start: sleepStart.toISOString(),
        sleep_end:   sleepEnd.toISOString(),
        awake_min: awakeMin || undefined,
        quality_score: quality,
        duration_min: durationMin,
        notes: notes || undefined,
        created_at: new Date().toISOString(),
      }
      const updated = await updateSleepRecords(current =>
        [record, ...current.filter(r => r.sleep_date !== recordDate)]
          .sort((a, b) => b.sleep_date.localeCompare(a.sleep_date))
      )
      setRecords(updated)
      Sounds.save()
      Toast.show({ type: 'success', text1: t('sleep.saveSuccess'), text2: `${pad(bedHour)}:${pad(bedMin)} → ${pad(wakeHour)}:${pad(wakeMin)}  ${fmtDuration(durationMin, language)}` })
      setFormOpen(false)
      setNotes('')
    } catch {
      Toast.show({ type: 'error', text1: t('sleep.saveError') })
    } finally {
      setSaving(false)
    }
  }

  const avgQuality = records.length > 0
    ? (records.slice(0, 7).reduce((s, r) => s + r.quality_score, 0) / Math.min(records.length, 7)).toFixed(1)
    : null
  const avgDuration = records.length > 0
    ? Math.round(records.slice(0, 7).reduce((s, r) => s + (r.duration_min ?? 0), 0) / Math.min(records.length, 7))
    : null

  const existingForDate = records.find(r => r.sleep_date === recordDate)

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('sleep.header')}</Text>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* 睡眠を記録ボタン（大きく横長） */}
          <HapticTouch
            haptic="whoosh"
            style={[styles.recordBtn, formOpen && styles.recordBtnOpen]}
            onPress={() => setFormOpen(v => !v)}
            activeOpacity={0.85}
          >
            <Ionicons name={formOpen ? 'chevron-up' : 'moon'} size={22} color="#fff" />
            <Text style={styles.recordBtnText}>{formOpen ? t('sleep.recordBtnClose') : t('sleep.recordBtnOpen')}</Text>
          </HapticTouch>

          {/* サマリー */}
          {!loading && records.length > 0 && (
            <AnimatedSection delay={0} type="scale">
            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{avgQuality}</Text>
                <Text style={styles.summaryLabel}>{t('sleep.avgQuality')}</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{fmtDuration(avgDuration ?? undefined, language)}</Text>
                <Text style={styles.summaryLabel}>{t('sleep.avgDuration')}</Text>
              </View>
            </View>
            </AnimatedSection>
          )}

          {/* ── 入力フォーム ── */}
          {formOpen && (
            <AnimatedSection delay={0} type="scale">
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>{t('sleep.formTitle')}</Text>

              {/* 日付セレクター */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
                {dateRange.map(d => {
                  const isSelected = d === recordDate
                  const hasRecord  = records.some(r => r.sleep_date === d)
                  const isFuture   = d > today
                  return (
                    <TouchableOpacity
                      key={d}
                      onPress={() => handleSelectDate(d)}
                      disabled={isFuture}
                      style={{
                        paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
                        backgroundColor: isSelected ? NEON.blue : colors.surface2,
                        borderWidth: 1,
                        borderColor: isSelected ? NEON.blue : hasRecord ? 'rgba(59,130,246,0.4)' : 'rgba(0,0,0,0.08)',
                        opacity: isFuture ? 0.3 : 1,
                      }}
                    >
                      <Text style={{ color: isSelected ? '#fff' : hasRecord ? '#3b82f6' : colors.textHint, fontSize: 11, fontWeight: '700' }}>
                        {formatDateLabel(d)}
                      </Text>
                      {hasRecord && (
                        <Text style={{ color: isSelected ? 'rgba(255,255,255,0.8)' : '#3b82f6', fontSize: 9, textAlign: 'center' }}>
                          {fmtDuration(records.find(r => r.sleep_date === d)?.duration_min, language)}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>

              {existingForDate && (
                <Text style={{ color: colors.textSec, fontSize: 11, textAlign: 'center' }}>
                  {t('sleep.existingRecord', { duration: fmtDuration(existingForDate.duration_min, language), score: existingForDate.quality_score })}
                </Text>
              )}

              {/* 時刻ピッカー */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingHorizontal: 4 }}>
                <TimePicker
                  label={t('sleep.bedtime')}
                  hour={bedHour} minute={bedMin}
                  onChangeHour={setBedHour} onChangeMinte={setBedMin}
                  color={NEON.blue}
                />
                <View style={{ alignItems: 'center', gap: 4 }}>
                  <Ionicons name="moon" size={20} color={NEON.purple} />
                  <Text style={{ color: NEON.purple, fontSize: 14, fontWeight: '800' }}>{fmtDuration(durationMin, language)}</Text>
                </View>
                <TimePicker
                  label={t('sleep.wakeTime')}
                  hour={wakeHour} minute={wakeMin}
                  onChangeHour={setWakeHour} onChangeMinte={setWakeMin}
                  color={NEON.cyan}
                />
              </View>

              {/* 途中で目が覚めていた時間（任意） */}
              <View style={{ gap: 8 }}>
                <Text style={{ color: colors.textSec, fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>
                  {t('sleep.awakeTimeLabel')}{awakeMin > 0 ? <Text style={{ color: NEON.amber }}> {t('sleep.awakeTimePlus', { n: awakeMin })}</Text> : null}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {[0, 15, 30, 45, 60, 90].map(n => (
                    <HapticTouch
                      key={n}
                      haptic="toggleOn"
                      onPress={() => setAwakeMin(n)}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14,
                        borderWidth: 1.5, borderColor: awakeMin === n ? NEON.amber : 'rgba(0,0,0,0.1)',
                        backgroundColor: awakeMin === n ? NEON.amber : colors.surface2,
                      }}
                    >
                      <Text style={{ color: awakeMin === n ? '#000' : colors.textSec, fontSize: 12, fontWeight: '700' }}>
                        {n === 0 ? t('sleep.awakeTimeNone') : t('sleep.awakeTimeMin', { n })}
                      </Text>
                    </HapticTouch>
                  ))}
                </View>
              </View>

              {/* 質スコア */}
              <View style={{ gap: 8 }}>
                <Text style={{ color: colors.textSec, fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>
                  {t('sleep.qualityLabel')}<Text style={{ color: qualityColor(quality) }}>{quality}/10</Text>
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
                    const col = qualityColor(n)
                    return (
                      <HapticTouch
                        key={n}
                        haptic="toggleOn"
                        onPress={() => setQuality(n)}
                        style={{
                          width: 34, height: 34, borderRadius: 17,
                          borderWidth: 1.5, borderColor: col,
                          backgroundColor: quality === n ? col : 'transparent',
                          alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Text style={{ color: quality === n ? '#000' : col, fontSize: 13, fontWeight: '700' }}>{n}</Text>
                      </HapticTouch>
                    )
                  })}
                </View>
              </View>

              {/* メモ */}
              <TextInput
                style={styles.noteInput}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={2}
                placeholder={t('sleep.notesPlaceholder')}
                placeholderTextColor={colors.textHint}
              />

              <HapticTouch
                haptic="save"
                style={[styles.saveBtn, saving && { opacity: 0.5 }]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.85}
              >
                <Ionicons name="moon" size={18} color="#fff" />
                <Text style={styles.saveBtnText}>{saving ? t('sleep.saving') : t('sleep.save')}</Text>
              </HapticTouch>
            </View>
            </AnimatedSection>
          )}

          {/* 折れ線グラフ */}
          {!loading && records.length >= 2 && (
            <AnimatedSection delay={80} type="fade-up">
            <View style={styles.card}>
              <SleepLineChart records={records} />
            </View>
            </AnimatedSection>
          )}

          {/* 履歴 */}
          <AnimatedSection delay={160} type="fade-up">
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Ionicons name="moon-outline" size={18} color="#5AC8FA" />
              <Text style={styles.sectionTitle}>{t('sleep.sleepHistory')}</Text>
            </View>
            {loading ? (
              <View style={{ gap: 10 }}>
                {[1, 2, 3].map(i => <SkeletonRect key={i} height={56} />)}
              </View>
            ) : records.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="moon-outline" size={40} color={colors.textHint} />
                <Text style={styles.emptyText}>{t('sleep.emptyText')}</Text>
                <HapticTouch haptic="whoosh" style={styles.emptyBtn} onPress={() => setFormOpen(true)}>
                  <Text style={styles.emptyBtnText}>{t('sleep.emptyBtn')}</Text>
                </HapticTouch>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {records.map(r => (
                  <SleepCard
                    key={r.id}
                    record={r}
                    onEdit={() => handleEditRecord(r)}
                    onDelete={() => handleDelete(r.id)}
                  />
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  headerTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  recordBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: NEON.blue, borderRadius: 16, paddingVertical: 18,
  },
  recordBtnOpen: { backgroundColor: 'rgba(59,130,246,0.10)', borderWidth: 1, borderColor: NEON.blue },
  recordBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 100 },
  card: {
    backgroundColor: colors.card, borderRadius: 21, borderWidth: 1, borderColor: colors.border,
    padding: 16, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2,
  },

  summaryRow: { flexDirection: 'row', gap: 12 },
  summaryCard: {
    flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 21, padding: 16, alignItems: 'center', gap: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2,
  },
  summaryValue: { color: colors.text, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  summaryLabel: { color: colors.textSec, fontSize: 12 },

  formCard: {
    backgroundColor: colors.card, borderRadius: 21, borderWidth: 1, borderColor: colors.border,
    padding: 20, gap: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2,
  },
  formTitle: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },

  noteInput: {
    backgroundColor: colors.surface2,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    color: colors.text, fontSize: 14,
    borderWidth: 1, borderColor: colors.border,
    height: 60, textAlignVertical: 'top',
  },
  saveBtn: {
    backgroundColor: NEON.blue, borderRadius: 50,
    paddingVertical: 17, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 5,
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  sleepCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 16, padding: 12, gap: 10,
  },
  sleepLeft: { flex: 1, gap: 2 },
  sleepDate: { color: colors.text, fontSize: 14, fontWeight: '600' },
  sleepDuration: { color: colors.textSec, fontSize: 12 },
  sleepNotes: { color: colors.textSec, fontSize: 12, flex: 1 },
  qualityBadge: { borderWidth: 2, borderRadius: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  qualityValue: { fontSize: 16, fontWeight: '800', lineHeight: 18 },
  qualityMax: { color: colors.textHint, fontSize: 9 },

  empty: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  emptyText: { color: colors.textSec, fontSize: 14 },
  emptyBtn: { backgroundColor: NEON.blue, borderRadius: 50, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14, letterSpacing: -0.3 },
})

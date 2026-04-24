import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, TextInput, Animated, Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { BG_GRADIENT, NEON, TEXT, BRAND } from '../../lib/theme'
import { Ionicons } from '@expo/vector-icons'
import Toast from 'react-native-toast-message'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Sounds } from '../../lib/sounds'
import AnimatedSection from '../../components/AnimatedSection'
import type { SleepRecord } from '../../types'

const MOCK_USER_ID = 'mock-user-1'
const SLEEP_KEY = 'trackmate_sleep'
const SCREEN_W = Dimensions.get('window').width

function qualityColor(q: number) {
  if (q >= 8) return '#34C759'
  if (q >= 5) return '#FF9500'
  return BRAND
}

function fmtDuration(min?: number) {
  if (!min) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}時間${m > 0 ? m + '分' : ''}` : `${m}分`
}

function SkeletonRect({ height = 16, width = '100%' as number | string }) {
  const opacity = useRef(new Animated.Value(0.3)).current
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
    ]))
    a.start(); return () => a.stop()
  }, [opacity])
  return <Animated.View style={{ height, width: width as number, borderRadius: 8, backgroundColor: '#2a2a2a', opacity }} />
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
  function incHour()  { onChangeHour((hour + 1) % 24) }
  function decHour()  { onChangeHour((hour + 23) % 24) }
  function incMin()   { onChangeMinte((minute + 5) % 60) }
  function decMin()   { onChangeMinte(Math.floor((minute + 5) / 5) % 12 * 5) }

  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <Text style={{ color: TEXT.secondary, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {/* 時 */}
        <View style={{ alignItems: 'center', gap: 4 }}>
          <TouchableOpacity onPress={incHour} style={tp.btn} activeOpacity={0.7}>
            <Ionicons name="chevron-up" size={18} color={color} />
          </TouchableOpacity>
          <View style={[tp.box, { borderColor: color + '60' }]}>
            <Text style={[tp.val, { color }]}>{pad(hour)}</Text>
          </View>
          <TouchableOpacity onPress={decHour} style={tp.btn} activeOpacity={0.7}>
            <Ionicons name="chevron-down" size={18} color={color} />
          </TouchableOpacity>
        </View>
        <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 28, fontWeight: '300' }}>:</Text>
        {/* 分（5分刻み） */}
        <View style={{ alignItems: 'center', gap: 4 }}>
          <TouchableOpacity onPress={incMin} style={tp.btn} activeOpacity={0.7}>
            <Ionicons name="chevron-up" size={18} color={color} />
          </TouchableOpacity>
          <View style={[tp.box, { borderColor: color + '60' }]}>
            <Text style={[tp.val, { color }]}>{pad(minute)}</Text>
          </View>
          <TouchableOpacity onPress={decMin} style={tp.btn} activeOpacity={0.7}>
            <Ionicons name="chevron-down" size={18} color={color} />
          </TouchableOpacity>
        </View>
      </View>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{pad(hour)}:{pad(minute)}</Text>
    </View>
  )
}

const tp = StyleSheet.create({
  btn:  { width: 36, height: 28, alignItems: 'center', justifyContent: 'center' },
  box:  { width: 56, height: 52, borderRadius: 12, borderWidth: 1.5, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  val:  { fontSize: 26, fontWeight: '800', letterSpacing: 1 },
})

// ── 睡眠時間の折れ線グラフ ────────────────────────────────────
const Y_AXIS_W = 36
const PLOT_H   = 100
const X_AXIS_H = 16

function SleepLineChart({ records }: { records: SleepRecord[] }) {
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
      <Text style={{ color: TEXT.secondary, fontSize: 12, fontWeight: '700' }}>睡眠時間の推移</Text>
      <View style={{ flexDirection: 'row' }}>
        {/* Y軸 */}
        <View style={{ width: Y_AXIS_W, height: PLOT_H, justifyContent: 'space-between', alignItems: 'flex-end', paddingRight: 5 }}>
          {yTicks.map((v, i) => (
            <Text key={i} style={{ color: TEXT.hint, fontSize: 9 }}>{v.toFixed(1)}h</Text>
          ))}
        </View>
        {/* プロット */}
        <View style={{ width: PLOT_W, height: PLOT_H + X_AXIS_H }}>
          {/* グリッド */}
          {yTicks.map((_, i) => {
            const y = i === 0 ? 0 : i === 1 ? PLOT_H / 2 : PLOT_H - 1
            return <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: y, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />
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
                borderColor: isLatest ? '#fff' : 'rgba(255,255,255,0.4)',
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
                width: 24, textAlign: 'center', color: TEXT.hint, fontSize: 8,
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
  const color = qualityColor(record.quality_score)
  return (
    <TouchableOpacity onPress={onEdit} activeOpacity={0.75} style={styles.sleepCard}>
      <View style={styles.sleepLeft}>
        <Text style={styles.sleepDate}>{record.sleep_date}</Text>
        {record.duration_min ? (
          <Text style={styles.sleepDuration}>{fmtDuration(record.duration_min)}</Text>
        ) : null}
        {record.notes ? <Text style={styles.sleepNotes} numberOfLines={1}>{record.notes}</Text> : null}
      </View>
      <View style={[styles.qualityBadge, { borderColor: color }]}>
        <Text style={[styles.qualityValue, { color }]}>{record.quality_score}</Text>
        <Text style={styles.qualityMax}>/10</Text>
      </View>
      <TouchableOpacity onPress={onDelete} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ padding: 4 }}>
        <Ionicons name="trash-outline" size={16} color="#555" />
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

// ── メイン ─────────────────────────────────────────────────
export default function SleepScreen() {
  const today = new Date().toISOString().slice(0, 10)
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
  const [quality,  setQuality]  = useState(7)
  const [notes, setNotes] = useState('')

  // ±7日の日付リスト
  const dateRange = Array.from({ length: 15 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 7 + i)
    return d.toISOString().slice(0, 10)
  })

  // 睡眠時間計算
  const bedTotalMin  = bedHour * 60 + bedMin
  let wakeTotalMin   = wakeHour * 60 + wakeMin
  if (wakeTotalMin <= bedTotalMin) wakeTotalMin += 24 * 60
  const durationMin = wakeTotalMin - bedTotalMin

  const pad = (n: number) => String(n).padStart(2, '0')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const raw = await AsyncStorage.getItem(SLEEP_KEY)
      if (raw) setRecords(JSON.parse(raw) as SleepRecord[])
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleDelete(id: string) {
    const updated = records.filter(r => r.id !== id)
    setRecords(updated)
    await AsyncStorage.setItem(SLEEP_KEY, JSON.stringify(updated)).catch(() => {})
    Toast.show({ type: 'success', text1: '削除しました', visibilityTime: 1200 })
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
  }

  function formatDateLabel(dateStr: string) {
    const d = new Date(dateStr)
    const diff = Math.round((d.getTime() - new Date(today).getTime()) / 86400000)
    if (diff === 0) return '今日'
    if (diff === -1) return '昨日'
    if (diff === 1) return '明日'
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
        id: `local-${Date.now()}`,
        user_id: MOCK_USER_ID,
        sleep_date: recordDate,
        sleep_start: sleepStart.toISOString(),
        sleep_end:   sleepEnd.toISOString(),
        quality_score: quality,
        duration_min: durationMin,
        notes: notes || undefined,
        created_at: new Date().toISOString(),
      }
      const updated = [record, ...records.filter(r => r.sleep_date !== recordDate)]
        .sort((a, b) => b.sleep_date.localeCompare(a.sleep_date))
      await AsyncStorage.setItem(SLEEP_KEY, JSON.stringify(updated))
      setRecords(updated)
      Sounds.save()
      Toast.show({ type: 'success', text1: '✅ 睡眠を記録しました', text2: `${pad(bedHour)}:${pad(bedMin)} → ${pad(wakeHour)}:${pad(wakeMin)}  ${fmtDuration(durationMin)}` })
      setFormOpen(false)
      setNotes('')
    } catch {
      Toast.show({ type: 'error', text1: '保存に失敗しました' })
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
    <View style={{ flex: 1 }}>
      <LinearGradient colors={BG_GRADIENT} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>睡眠・回復</Text>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* 睡眠を記録ボタン（大きく横長） */}
          <TouchableOpacity
            style={[styles.recordBtn, formOpen && styles.recordBtnOpen]}
            onPress={() => setFormOpen(v => !v)}
            activeOpacity={0.85}
          >
            <Ionicons name={formOpen ? 'chevron-up' : 'moon'} size={22} color="#fff" />
            <Text style={styles.recordBtnText}>{formOpen ? '閉じる' : '睡眠を記録する'}</Text>
          </TouchableOpacity>

          {/* サマリー */}
          {!loading && records.length > 0 && (
            <AnimatedSection delay={0} type="scale">
            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{avgQuality}</Text>
                <Text style={styles.summaryLabel}>平均質スコア</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{fmtDuration(avgDuration ?? undefined)}</Text>
                <Text style={styles.summaryLabel}>平均睡眠時間</Text>
              </View>
            </View>
            </AnimatedSection>
          )}

          {/* ── 入力フォーム ── */}
          {formOpen && (
            <AnimatedSection delay={0} type="scale">
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>睡眠を記録</Text>

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
                        backgroundColor: isSelected ? NEON.blue : 'rgba(255,255,255,0.06)',
                        borderWidth: 1,
                        borderColor: isSelected ? NEON.blue : hasRecord ? 'rgba(90,200,250,0.4)' : 'rgba(255,255,255,0.1)',
                        opacity: isFuture ? 0.3 : 1,
                      }}
                    >
                      <Text style={{ color: isSelected ? '#fff' : hasRecord ? '#5AC8FA' : TEXT.hint, fontSize: 11, fontWeight: '700' }}>
                        {formatDateLabel(d)}
                      </Text>
                      {hasRecord && (
                        <Text style={{ color: isSelected ? 'rgba(255,255,255,0.8)' : '#5AC8FA', fontSize: 9, textAlign: 'center' }}>
                          {fmtDuration(records.find(r => r.sleep_date === d)?.duration_min)}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>

              {existingForDate && (
                <Text style={{ color: TEXT.hint, fontSize: 11, textAlign: 'center' }}>
                  既存: {fmtDuration(existingForDate.duration_min)} / 質{existingForDate.quality_score} → 上書き保存
                </Text>
              )}

              {/* 時刻ピッカー */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }}>
                <TimePicker
                  label="就寝"
                  hour={bedHour} minute={bedMin}
                  onChangeHour={setBedHour} onChangeMinte={setBedMin}
                  color={NEON.blue}
                />
                <View style={{ alignItems: 'center', gap: 4 }}>
                  <Ionicons name="moon" size={20} color={NEON.purple} />
                  <Text style={{ color: NEON.purple, fontSize: 14, fontWeight: '800' }}>{fmtDuration(durationMin)}</Text>
                </View>
                <TimePicker
                  label="起床"
                  hour={wakeHour} minute={wakeMin}
                  onChangeHour={setWakeHour} onChangeMinte={setWakeMin}
                  color={NEON.cyan}
                />
              </View>

              {/* 質スコア */}
              <View style={{ gap: 8 }}>
                <Text style={{ color: TEXT.secondary, fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>
                  睡眠の質: <Text style={{ color: qualityColor(quality) }}>{quality}/10</Text>
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
                    const col = qualityColor(n)
                    return (
                      <TouchableOpacity
                        key={n}
                        onPress={() => setQuality(n)}
                        style={{
                          width: 34, height: 34, borderRadius: 17,
                          borderWidth: 1.5, borderColor: col,
                          backgroundColor: quality === n ? col : 'transparent',
                          alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Text style={{ color: quality === n ? '#000' : col, fontSize: 13, fontWeight: '700' }}>{n}</Text>
                      </TouchableOpacity>
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
                placeholder="メモ（途中で起きた、夢を見た...）"
                placeholderTextColor="#445577"
              />

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.5 }]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.85}
              >
                <Ionicons name="moon" size={18} color="#fff" />
                <Text style={styles.saveBtnText}>{saving ? '保存中...' : '記録する'}</Text>
              </TouchableOpacity>
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
              <Text style={styles.sectionTitle}>睡眠履歴</Text>
            </View>
            {loading ? (
              <View style={{ gap: 10 }}>
                {[1, 2, 3].map(i => <SkeletonRect key={i} height={56} />)}
              </View>
            ) : records.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="moon-outline" size={40} color={TEXT.hint} />
                <Text style={styles.emptyText}>睡眠を記録しましょう</Text>
                <TouchableOpacity style={styles.emptyBtn} onPress={() => setFormOpen(true)}>
                  <Text style={styles.emptyBtnText}>今夜の睡眠を記録</Text>
                </TouchableOpacity>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: { color: TEXT.primary, fontSize: 20, fontWeight: '800' },
  recordBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: NEON.blue, borderRadius: 16, paddingVertical: 18,
  },
  recordBtnOpen: { backgroundColor: 'rgba(90,200,250,0.2)', borderWidth: 1, borderColor: NEON.blue },
  recordBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 100 },
  card: { backgroundColor: '#111111', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 16, gap: 12 },

  summaryRow: { flexDirection: 'row', gap: 12 },
  summaryCard: { flex: 1, backgroundColor: '#111111', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 20, padding: 16, alignItems: 'center', gap: 4 },
  summaryValue: { color: TEXT.primary, fontSize: 24, fontWeight: '800' },
  summaryLabel: { color: TEXT.secondary, fontSize: 12 },

  formCard: { backgroundColor: 'rgba(12,14,35,0.92)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', padding: 20, gap: 18 },
  formTitle: { color: TEXT.primary, fontSize: 16, fontWeight: '700', textAlign: 'center' },

  noteInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    color: '#FFFFFF', fontSize: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    height: 60, textAlignVertical: 'top',
  },
  saveBtn: {
    backgroundColor: NEON.blue, borderRadius: 14,
    paddingVertical: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { color: TEXT.primary, fontSize: 15, fontWeight: '700', flex: 1 },
  sleepCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(74,159,255,0.12)',
    borderRadius: 10, padding: 12, gap: 10,
  },
  sleepLeft: { flex: 1, gap: 2 },
  sleepDate: { color: TEXT.primary, fontSize: 14, fontWeight: '600' },
  sleepDuration: { color: TEXT.secondary, fontSize: 12 },
  sleepNotes: { color: TEXT.hint, fontSize: 12, flex: 1 },
  qualityBadge: { borderWidth: 2, borderRadius: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  qualityValue: { fontSize: 16, fontWeight: '800', lineHeight: 18 },
  qualityMax: { color: TEXT.hint, fontSize: 9 },

  empty: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  emptyText: { color: TEXT.secondary, fontSize: 14 },
  emptyBtn: { backgroundColor: BRAND, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
})

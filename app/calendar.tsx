import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Animated,
  FlatList,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { BG_GRADIENT, TEXT, SURFACE, DIVIDER, SURFACE2 } from '../lib/theme'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'

// ── ストレージキー ────────────────────────────────────────────────
const SESSIONS_KEY      = 'trackmate_sessions'
const RACE_KEY          = 'trackmate_race_records'
const WORKOUT_KEY       = 'trackmate_workout_menus'
const COMPETITION_KEY   = 'trackmate_competitions'

// ── 型定義 ───────────────────────────────────────────────────────
type DotType = 'race' | 'gps' | 'workout' | 'competition'

type DayData = {
  date: string  // YYYY-MM-DD
  dots: DotType[]
}

type DayRecord = {
  type: DotType
  label: string
  sub?: string
}

// ── カラー定義 ────────────────────────────────────────────────────
const DOT_COLORS: Record<DotType, string> = {
  race:        '#E53935',
  gps:         '#2196F3',
  workout:     '#4CAF50',
  competition: '#FFC107',
}

const DOT_LABELS: Record<DotType, string> = {
  race:        'タイム計測',
  gps:         'GPS練習',
  workout:     '練習メニュー',
  competition: '大会',
}

const DOT_ICONS: Record<DotType, string> = {
  race:        'timer-outline',
  gps:         'navigate-outline',
  workout:     'barbell-outline',
  competition: 'trophy-outline',
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

// ── ユーティリティ ───────────────────────────────────────────────
function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isoToYMD(iso: string): string {
  return iso.slice(0, 10)
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay()
}

// ── メインコンポーネント ──────────────────────────────────────────
export default function CalendarScreen() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string>(toYMD(today))
  const [dayMap, setDayMap] = useState<Record<string, DotType[]>>({})
  const [recordMap, setRecordMap] = useState<Record<string, DayRecord[]>>({})

  const fadeAnim = useRef(new Animated.Value(1)).current

  const load = useCallback(async () => {
    try {
      const [sessionsRaw, raceRaw, workoutRaw, compRaw] = await Promise.all([
        AsyncStorage.getItem(SESSIONS_KEY),
        AsyncStorage.getItem(RACE_KEY),
        AsyncStorage.getItem(WORKOUT_KEY),
        AsyncStorage.getItem(COMPETITION_KEY),
      ])

      const newDayMap: Record<string, DotType[]> = {}
      const newRecordMap: Record<string, DayRecord[]> = {}

      function addDot(date: string, type: DotType, label: string, sub?: string) {
        if (!date) return
        const ymd = date.length > 10 ? isoToYMD(date) : date
        if (!newDayMap[ymd]) newDayMap[ymd] = []
        if (!newDayMap[ymd].includes(type)) newDayMap[ymd].push(type)
        if (!newRecordMap[ymd]) newRecordMap[ymd] = []
        newRecordMap[ymd].push({ type, label, sub })
      }

      // GPS練習セッション
      if (sessionsRaw) {
        try {
          const sessions: any[] = JSON.parse(sessionsRaw)
          sessions.forEach((s: any) => {
            const label = s.session_type ?? 'GPS練習'
            const sub = s.distance_m ? `${(s.distance_m / 1000).toFixed(1)}km` : undefined
            addDot(s.session_date ?? s.created_at, 'gps', label, sub)
          })
        } catch {}
      }

      // タイム計測（レース記録）
      if (raceRaw) {
        try {
          const races: any[] = JSON.parse(raceRaw)
          races.forEach((r: any) => {
            const label = r.event ?? 'タイム計測'
            const sub = r.time ? r.time : undefined
            addDot(r.date ?? r.created_at, 'race', label, sub)
          })
        } catch {}
      }

      // 練習メニュー
      if (workoutRaw) {
        try {
          const workouts: any[] = JSON.parse(workoutRaw)
          workouts.forEach((w: any) => {
            addDot(w.date ?? w.created_at, 'workout', w.title ?? '練習メニュー', undefined)
          })
        } catch {}
      }

      // 大会
      if (compRaw) {
        try {
          const comps: any[] = JSON.parse(compRaw)
          comps.forEach((c: any) => {
            addDot(c.date ?? c.competition_date ?? c.created_at, 'competition', c.name ?? '大会', c.event)
          })
        } catch {}
      }

      setDayMap(newDayMap)
      setRecordMap(newRecordMap)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])

  function changeMonth(delta: number) {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
    }).start(() => {
      setMonth(prev => {
        let nm = prev + delta
        let ny = year
        if (nm < 0)  { nm = 11; ny = year - 1; setYear(ny) }
        if (nm > 11) { nm = 0;  ny = year + 1; setYear(ny) }
        return nm
      })
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start()
    })
  }

  const todayYMD = toYMD(today)
  const daysInMonth = getDaysInMonth(year, month)
  const firstDow = getFirstDayOfWeek(year, month)

  // カレンダーグリッド用配列（空セル含む）
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // 6行になるようにパディング
  while (cells.length % 7 !== 0) cells.push(null)

  // 月間サマリー
  const monthPrefix = `${String(year)}-${String(month + 1).padStart(2, '0')}`
  const monthEntries = Object.entries(dayMap).filter(([d]) => d.startsWith(monthPrefix))
  const monthDays = monthEntries.length
  const monthGPS = monthEntries.filter(([, dots]) => dots.includes('gps')).length

  // 選択日の記録
  const selectedRecords = recordMap[selectedDate] ?? []

  function handleDayPress(day: number) {
    const ymd = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    setSelectedDate(ymd)
  }

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient colors={BG_GRADIENT} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safe}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {/* 月ナビゲーション */}
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.navBtn} activeOpacity={0.7} hitSlop={10} accessibilityLabel="前の月">
              <Ionicons name="chevron-back" size={22} color={TEXT.primary} />
            </TouchableOpacity>
            <Text style={styles.monthTitle}>{year}年{month + 1}月</Text>
            <TouchableOpacity onPress={() => changeMonth(1)} style={styles.navBtn} activeOpacity={0.7} hitSlop={10} accessibilityLabel="次の月">
              <Ionicons name="chevron-forward" size={22} color={TEXT.primary} />
            </TouchableOpacity>
          </View>

          {/* 凡例 */}
          <View style={styles.legendRow}>
            {(Object.entries(DOT_COLORS) as [DotType, string][]).map(([type, color]) => (
              <View key={type} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: color }]} />
                <Text style={styles.legendText}>{DOT_LABELS[type]}</Text>
              </View>
            ))}
          </View>

          {/* カレンダーグリッド */}
          <Animated.View style={[styles.calCard, { opacity: fadeAnim }]}>
            {/* 曜日ヘッダー */}
            <View style={styles.weekRow}>
              {WEEKDAYS.map((w, i) => (
                <Text
                  key={w}
                  style={[
                    styles.weekLabel,
                    i === 0 && { color: '#E53935' },
                    i === 6 && { color: '#2196F3' },
                  ]}
                >
                  {w}
                </Text>
              ))}
            </View>

            {/* 日付グリッド */}
            <View style={styles.grid}>
              {cells.map((day, idx) => {
                if (day === null) {
                  return <View key={`empty-${idx}`} style={styles.dayCell} />
                }
                const ymd = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const isToday = ymd === todayYMD
                const isSelected = ymd === selectedDate
                const dots = dayMap[ymd] ?? []
                const dow = (firstDow + day - 1) % 7

                return (
                  <DayCell
                    key={ymd}
                    day={day}
                    ymd={ymd}
                    isToday={isToday}
                    isSelected={isSelected}
                    dots={dots}
                    dow={dow}
                    onPress={() => handleDayPress(day)}
                  />
                )
              })}
            </View>
          </Animated.View>

          {/* 選択日の詳細 */}
          <View style={styles.detailCard}>
            <View style={styles.detailHeader}>
              <Ionicons name="calendar-outline" size={16} color={TEXT.secondary} />
              <Text style={styles.detailTitle}>
                {selectedDate.replace(/-/g, '/')} の記録
              </Text>
              <Text style={styles.detailCount}>{selectedRecords.length}件</Text>
            </View>
            {selectedRecords.length === 0 ? (
              <Text style={styles.noRecords}>この日の記録はありません</Text>
            ) : (
              <View style={{ gap: 8 }}>
                {selectedRecords.map((rec, idx) => (
                  <View key={idx} style={styles.recordRow}>
                    <View style={[styles.recordIcon, { backgroundColor: DOT_COLORS[rec.type] + '22' }]}>
                      <Ionicons name={DOT_ICONS[rec.type] as any} size={16} color={DOT_COLORS[rec.type]} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.recordLabel}>{rec.label}</Text>
                      {rec.sub ? <Text style={styles.recordSub}>{rec.sub}</Text> : null}
                    </View>
                    <View style={[styles.recordBadge, { backgroundColor: DOT_COLORS[rec.type] + '22', borderColor: DOT_COLORS[rec.type] }]}>
                      <Text style={[styles.recordBadgeText, { color: DOT_COLORS[rec.type] }]}>{DOT_LABELS[rec.type]}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* 月間サマリー */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>{month + 1}月のサマリー</Text>
            <View style={styles.summaryRow}>
              <SummaryItem icon="flame-outline" color="#E53935" value={monthDays} label="練習日数" unit="日" />
              <SummaryItem icon="navigate-outline" color="#2196F3" value={monthGPS} label="GPS練習" unit="回" />
              <SummaryItem icon="barbell-outline" color="#4CAF50" value={monthEntries.filter(([, d]) => d.includes('workout')).length} label="メニュー" unit="件" />
              <SummaryItem icon="trophy-outline" color="#FFC107" value={monthEntries.filter(([, d]) => d.includes('competition')).length} label="大会" unit="回" />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

// ── DayCell コンポーネント ─────────────────────────────────────────
function DayCell({
  day,
  ymd,
  isToday,
  isSelected,
  dots,
  dow,
  onPress,
}: {
  day: number
  ymd: string
  isToday: boolean
  isSelected: boolean
  dots: DotType[]
  dow: number
  onPress: () => void
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current

  function handlePress() {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.85, duration: 80, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1.0, duration: 100, useNativeDriver: true }),
    ]).start()
    onPress()
  }

  const isWeekend = dow === 0 || dow === 6
  const dayColor = isToday ? '#fff' : isWeekend ? (dow === 0 ? '#E53935' : '#2196F3') : TEXT.primary

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={handlePress} style={styles.dayCell}>
      <Animated.View style={{ transform: [{ scale: scaleAnim }], alignItems: 'center' }}>
        <View style={[
          styles.dayNumContainer,
          isToday && styles.todayBg,
          isSelected && !isToday && styles.selectedBg,
        ]}>
          <Text style={[
            styles.dayNum,
            { color: dayColor },
            isToday && { color: '#fff', fontWeight: '800' },
          ]}>
            {day}
          </Text>
        </View>
        {dots.length > 0 && (
          <View style={styles.dotsRow}>
            {dots.slice(0, 3).map(type => (
              <View key={type} style={[styles.dot, { backgroundColor: DOT_COLORS[type] }]} />
            ))}
          </View>
        )}
      </Animated.View>
    </TouchableOpacity>
  )
}

// ── SummaryItem コンポーネント ────────────────────────────────────
function SummaryItem({
  icon,
  color,
  value,
  label,
  unit,
}: {
  icon: string
  color: string
  value: number
  label: string
  unit: string
}) {
  return (
    <View style={sumStyles.item}>
      <View style={[sumStyles.icon, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      <Text style={sumStyles.value}>{value}<Text style={sumStyles.unit}>{unit}</Text></Text>
      <Text style={sumStyles.label}>{label}</Text>
    </View>
  )
}

const sumStyles = StyleSheet.create({
  item: { flex: 1, alignItems: 'center', gap: 4 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  value: { color: TEXT.primary, fontSize: 18, fontWeight: '800' },
  unit: { fontSize: 12, fontWeight: '400', color: TEXT.secondary },
  label: { color: '#666', fontSize: 11 },
})

// ── スタイル ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  scrollContent: { padding: 16, gap: 14, paddingBottom: 48 },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 4,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: SURFACE2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: { color: TEXT.primary, fontSize: 20, fontWeight: '800', minWidth: 140, textAlign: 'center' },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 4,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: '#666', fontSize: 11 },
  calCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: DIVIDER,
    padding: 12,
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    color: '#666',
    fontSize: 12,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 0.85,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 4,
  },
  dayNumContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayBg: { backgroundColor: '#166534' },
  selectedBg: { backgroundColor: 'rgba(22,101,52,0.12)', borderWidth: 1, borderColor: 'rgba(22,101,52,0.4)' },
  dayNum: { fontSize: 13, fontWeight: '500' },
  dotsRow: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 2,
    height: 5,
    alignItems: 'center',
  },
  dot: { width: 4, height: 4, borderRadius: 2 },
  detailCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: DIVIDER,
    padding: 14,
    gap: 10,
  },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailTitle: { color: TEXT.primary, fontSize: 15, fontWeight: '700', flex: 1 },
  detailCount: { color: '#555', fontSize: 13 },
  noRecords: { color: '#444', fontSize: 13, textAlign: 'center', paddingVertical: 12 },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: SURFACE2,
    borderRadius: 8,
    padding: 10,
  },
  recordIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordLabel: { color: TEXT.primary, fontSize: 13, fontWeight: '600' },
  recordSub: { color: '#666', fontSize: 11 },
  recordBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  recordBadgeText: { fontSize: 10, fontWeight: '700' },
  summaryCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: DIVIDER,
    padding: 16,
    gap: 12,
  },
  summaryTitle: { color: TEXT.primary, fontSize: 15, fontWeight: '700' },
  summaryRow: { flexDirection: 'row', gap: 8 },
})

import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { TEXT, BRAND } from '../lib/theme'
import { localDateStr, todayLocalISO } from '../lib/dateLocal'

interface Props {
  date: string          // YYYY-MM-DD
  onChange: (d: string) => void
  maxDate?: string      // デフォルト: 今日
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return localDateStr(d)
}

function formatLabel(dateStr: string): string {
  const today     = todayLocalISO()
  const yesterday = addDays(today, -1)
  if (dateStr === today)     return `今日  (${dateStr})`
  if (dateStr === yesterday) return `昨日  (${dateStr})`
  return dateStr
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay()
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

export default function DateSelector({ date, onChange, maxDate }: Props) {
  const today = todayLocalISO()
  const max   = maxDate ?? today
  const canNext = date < max

  const [calVisible, setCalVisible] = useState(false)

  // カレンダー表示月（選択中の日付の年月で初期化）
  const [calYear,  setCalYear]  = useState(() => parseInt(date.slice(0, 4)))
  const [calMonth, setCalMonth] = useState(() => parseInt(date.slice(5, 7)) - 1)

  function openCalendar() {
    setCalYear(parseInt(date.slice(0, 4)))
    setCalMonth(parseInt(date.slice(5, 7)) - 1)
    setCalVisible(true)
  }

  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11) }
    else setCalMonth(m => m - 1)
  }

  function nextMonth() {
    const maxY = parseInt(max.slice(0, 4))
    const maxM = parseInt(max.slice(5, 7)) - 1
    if (calYear > maxY || (calYear === maxY && calMonth >= maxM)) return
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0) }
    else setCalMonth(m => m + 1)
  }

  function selectDay(day: number) {
    const mm = String(calMonth + 1).padStart(2, '0')
    const dd = String(day).padStart(2, '0')
    const selected = `${calYear}-${mm}-${dd}`
    if (selected > max) return
    onChange(selected)
    setCalVisible(false)
  }

  const daysInMonth  = getDaysInMonth(calYear, calMonth)
  const firstDow     = getFirstDayOfWeek(calYear, calMonth)
  const maxY = parseInt(max.slice(0, 4))
  const maxM = parseInt(max.slice(5, 7)) - 1
  const canNextMonth = calYear < maxY || (calYear === maxY && calMonth < maxM)

  return (
    <>
      <View style={styles.row}>
        {/* 前日 */}
        <TouchableOpacity
          style={styles.arrow}
          onPress={() => onChange(addDays(date, -1))}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={18} color="#6b7280" />
        </TouchableOpacity>

        {/* 中央：タップでカレンダー */}
        <TouchableOpacity style={styles.center} onPress={openCalendar} activeOpacity={0.7}>
          <Text style={styles.label}>{formatLabel(date)}</Text>
          <Text style={styles.calHint}>タップで日付選択</Text>
        </TouchableOpacity>

        {/* 翌日 */}
        <TouchableOpacity
          style={[styles.arrow, !canNext && styles.arrowDisabled]}
          onPress={() => canNext && onChange(addDays(date, 1))}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-forward" size={18} color={canNext ? '#6b7280' : '#d1d5db'} />
        </TouchableOpacity>
      </View>

      {/* カレンダーモーダル */}
      <Modal visible={calVisible} transparent animationType="fade" onRequestClose={() => setCalVisible(false)}>
        <TouchableOpacity style={cal.overlay} activeOpacity={1} onPress={() => setCalVisible(false)}>
          <TouchableOpacity activeOpacity={1} onPress={e => e.stopPropagation()}>
            <View style={cal.sheet}>

              {/* 月ナビ */}
              <View style={cal.monthRow}>
                <TouchableOpacity onPress={prevMonth} style={cal.monthArrow} activeOpacity={0.7}>
                  <Ionicons name="chevron-back" size={20} color="#6b7280" />
                </TouchableOpacity>
                <Text style={cal.monthLabel}>{calYear}年 {calMonth + 1}月</Text>
                <TouchableOpacity
                  onPress={nextMonth}
                  style={[cal.monthArrow, !canNextMonth && { opacity: 0.3 }]}
                  disabled={!canNextMonth}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-forward" size={20} color="#6b7280" />
                </TouchableOpacity>
              </View>

              {/* 曜日ヘッダー */}
              <View style={cal.weekRow}>
                {WEEKDAYS.map((w, i) => (
                  <Text key={w} style={[cal.weekDay, i === 0 && { color: '#FF3B30' }, i === 6 && { color: '#5AC8FA' }]}>{w}</Text>
                ))}
              </View>

              {/* 日付グリッド */}
              <View style={cal.grid}>
                {/* 空白（月初の曜日分） */}
                {Array.from({ length: firstDow }).map((_, i) => (
                  <View key={`e${i}`} style={cal.dayCell} />
                ))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1
                  const mm = String(calMonth + 1).padStart(2, '0')
                  const dd = String(day).padStart(2, '0')
                  const dateStr = `${calYear}-${mm}-${dd}`
                  const isSelected = dateStr === date
                  const isToday = dateStr === today
                  const isFuture = dateStr > max
                  const dow = (firstDow + i) % 7

                  return (
                    <TouchableOpacity
                      key={day}
                      style={[
                        cal.dayCell,
                        isSelected && { backgroundColor: BRAND, borderRadius: 20 },
                        isToday && !isSelected && { borderWidth: 1, borderColor: BRAND, borderRadius: 20 },
                        isFuture && { opacity: 0.2 },
                      ]}
                      onPress={() => !isFuture && selectDay(day)}
                      disabled={isFuture}
                      activeOpacity={0.7}
                    >
                      <Text style={[
                        cal.dayText,
                        isSelected && { color: '#fff', fontWeight: '800' },
                        !isSelected && dow === 0 && { color: '#FF3B30' },
                        !isSelected && dow === 6 && { color: '#5AC8FA' },
                        isFuture && { color: '#d1d5db' },
                      ]}>
                        {day}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>

              {/* 今日ボタン */}
              <TouchableOpacity
                style={cal.todayBtn}
                onPress={() => { onChange(today); setCalVisible(false) }}
                activeOpacity={0.8}
              >
                <Text style={cal.todayText}>今日</Text>
              </TouchableOpacity>

            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f2f5',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
    overflow: 'hidden',
    marginBottom: 14,
  },
  arrow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  arrowDisabled: {
    opacity: 0.3,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    gap: 2,
  },
  label: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  calHint: {
    color: '#9ca3af',
    fontSize: 10,
  },
})

const cal = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    width: 320,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  monthArrow: {
    padding: 8,
  },
  monthLabel: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  weekDay: {
    flex: 1,
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '500',
  },
  todayBtn: {
    backgroundColor: '#f0f2f5',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  todayText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '700',
  },
})

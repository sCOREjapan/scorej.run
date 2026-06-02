import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native'
import type { SleepRecord } from '../types'

interface Props {
  record?: SleepRecord
  onSave: (data: Omit<SleepRecord, 'id' | 'user_id' | 'created_at'>) => void
  isLoading?: boolean
}

/** Parse HH:MM string into total minutes from midnight */
function timeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = parseInt(match[1], 10)
  const mins = parseInt(match[2], 10)
  if (hours > 23 || mins > 59) return null
  return hours * 60 + mins
}

/** Calculate sleep duration in minutes, accounting for overnight sleep */
function calcDuration(start: string, end: string): number | null {
  const startMin = timeToMinutes(start)
  const endMin = timeToMinutes(end)
  if (startMin === null || endMin === null) return null
  let diff = endMin - startMin
  if (diff < 0) diff += 24 * 60 // overnight（diff===0は同時刻=0分睡眠なのでそのまま）
  return diff
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}時間${m > 0 ? `${m}分` : ''}`
}

const QUALITY_LABELS: Record<number, string> = {
  1: '最悪', 2: '悪い', 3: 'やや悪い', 4: '少し悪い', 5: '普通',
  6: 'まずまず', 7: '良い', 8: 'かなり良い', 9: '非常に良い', 10: '最高',
}

const SleepTracker: React.FC<Props> = ({ record, onSave, isLoading = false }) => {
  const today = new Date().toISOString().split('T')[0]

  const [sleepStart, setSleepStart] = useState(
    record?.sleep_start ? record.sleep_start.slice(11, 16) : '23:00'
  )
  const [sleepEnd, setSleepEnd] = useState(
    record?.sleep_end ? record.sleep_end.slice(11, 16) : '07:00'
  )
  const [quality, setQuality] = useState<number>(record?.quality_score ?? 7)
  const [notes, setNotes] = useState(record?.notes ?? '')

  const duration = calcDuration(sleepStart, sleepEnd)

  const handleSave = () => {
    const datePrefix = today + 'T'
    onSave({
      sleep_date: today,
      sleep_start: sleepStart ? `${datePrefix}${sleepStart}:00` : undefined,
      sleep_end: sleepEnd ? `${datePrefix}${sleepEnd}:00` : undefined,
      duration_min: duration ?? undefined,
      quality_score: quality,
      notes: notes.trim() || undefined,
    })
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Duration display */}
      {duration !== null && (
        <View style={styles.durationBadge}>
          <Text style={styles.durationLabel}>睡眠時間</Text>
          <Text style={styles.durationValue}>{formatDuration(duration)}</Text>
        </View>
      )}

      {/* Time inputs */}
      <View style={styles.row}>
        <View style={styles.timeBlock}>
          <Text style={styles.fieldLabel}>就寝時刻</Text>
          <TextInput
            style={styles.timeInput}
            value={sleepStart}
            onChangeText={setSleepStart}
            placeholder="23:00"
            placeholderTextColor="#555"
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />
        </View>
        <View style={styles.timeSeparator}>
          <Text style={styles.separatorText}>→</Text>
        </View>
        <View style={styles.timeBlock}>
          <Text style={styles.fieldLabel}>起床時刻</Text>
          <TextInput
            style={styles.timeInput}
            value={sleepEnd}
            onChangeText={setSleepEnd}
            placeholder="07:00"
            placeholderTextColor="#555"
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />
        </View>
      </View>

      {/* Quality selector */}
      <View style={styles.section}>
        <Text style={styles.fieldLabel}>
          睡眠の質: <Text style={styles.qualityValue}>{QUALITY_LABELS[quality]}</Text>
        </Text>
        <View style={styles.qualityRow}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <TouchableOpacity
              key={n}
              style={[
                styles.qualityBtn,
                quality === n && styles.qualityBtnActive,
                n <= 3 && quality === n && { backgroundColor: '#FF3B30' },
                n >= 4 && n <= 6 && quality === n && { backgroundColor: '#FF9500' },
                n >= 7 && quality === n && { backgroundColor: '#34C759' },
              ]}
              onPress={() => setQuality(n)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.qualityBtnText,
                  quality === n && styles.qualityBtnTextActive,
                ]}
              >
                {n}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Notes */}
      <View style={styles.section}>
        <Text style={styles.fieldLabel}>メモ（任意）</Text>
        <TextInput
          style={styles.notesInput}
          value={notes}
          onChangeText={setNotes}
          placeholder="夢を見た、途中で目が覚めたなど..."
          placeholderTextColor="#555"
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </View>

      {/* Save button */}
      <TouchableOpacity
        style={[styles.saveButton, isLoading && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={isLoading}
        activeOpacity={0.8}
      >
        <Text style={styles.saveButtonText}>
          {isLoading ? '保存中...' : '記録する'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  durationBadge: {
    backgroundColor: 'rgba(255,107,0,0.12)',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,107,0,0.3)',
  },
  durationLabel: {
    color: '#888888',
    fontSize: 12,
    marginBottom: 2,
  },
  durationValue: {
    color: '#FF6B00',
    fontSize: 22,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  timeBlock: {
    flex: 1,
  },
  timeSeparator: {
    paddingBottom: 10,
  },
  separatorText: {
    color: '#888888',
    fontSize: 18,
  },
  fieldLabel: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timeInput: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  section: {
    gap: 6,
  },
  qualityRow: {
    flexDirection: 'row',
    gap: 5,
  },
  qualityBtn: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: '#2a2a2a',
    borderRadius: 6,
    alignItems: 'center',
  },
  qualityBtnActive: {
    backgroundColor: '#FF6B00',
  },
  qualityBtnText: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '600',
  },
  qualityBtnTextActive: {
    color: '#FFFFFF',
  },
  qualityValue: {
    color: '#FF6B00',
    fontWeight: '700',
  },
  notesInput: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    color: '#FFFFFF',
    fontSize: 14,
    minHeight: 80,
  },
  saveButton: {
    backgroundColor: '#FF6B00',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
})

export default SleepTracker

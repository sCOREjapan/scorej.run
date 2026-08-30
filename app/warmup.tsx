import React, { useState, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { BRAND, TEXT, SURFACE, SURFACE2, DIVIDER, NEON } from '../lib/theme'
import { Sounds, unlockAudio } from '../lib/sounds'
import { useTranslation } from 'react-i18next'

type Category = 'jog' | 'mobility' | 'drill' | 'sprint'
type RiskLevel = 'low' | 'moderate' | 'high'

interface WarmupItem {
  id: string
  icon: string
  category: Category
  levels: RiskLevel[]  // which risk levels include this item
}

// name/detailは言語依存のため持たず、id経由でt('warmup.items.<id>.name'等)を引く
const ITEMS: WarmupItem[] = [
  { id: 'jog',        icon: '🏃', category: 'jog',      levels: ['low','moderate','high'] },
  { id: 'calf',       icon: '🦵', category: 'mobility', levels: ['low','moderate','high'] },
  { id: 'hip',        icon: '⭕', category: 'mobility', levels: ['low','moderate','high'] },
  { id: 'leg_swing',  icon: '🔄', category: 'mobility', levels: ['low','moderate','high'] },
  { id: 'dynamic',    icon: '🤸', category: 'mobility', levels: ['low','moderate','high'] },
  { id: 'lunge',      icon: '🚶', category: 'drill',    levels: ['low','moderate'] },
  { id: 'skip',       icon: '⬆️', category: 'drill',    levels: ['low','moderate'] },
  { id: 'carioca',    icon: '🔀', category: 'drill',    levels: ['low','moderate'] },
  { id: 'bounding',   icon: '💨', category: 'drill',    levels: ['low'] },
  { id: 'strides',    icon: '🏁', category: 'sprint',   levels: ['low','moderate'] },
]

const CATEGORY_COLORS: Record<Category, string> = {
  jog: NEON.green, mobility: '#4A9FFF', drill: '#FF9500', sprint: '#FF3B30',
}

export default function WarmupScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const params = useLocalSearchParams<{ risk?: string }>()
  const risk = (params.risk ?? 'low') as RiskLevel

  const items = useMemo(() =>
    ITEMS.filter(it => it.levels.includes(risk)),
    [risk]
  )

  const [checked, setChecked] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    unlockAudio()
    Sounds.pop()
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const progress = items.length > 0 ? checked.size / items.length : 0
  const done = checked.size === items.length

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>

          {/* ── ヘッダー ── */}
          <View style={st.header}>
            <Text style={st.title}>{t('warmup.title')}</Text>
            <View style={[st.riskBadge, { borderColor: risk === 'high' ? '#FF3B30' : risk === 'moderate' ? '#FF9500' : '#34C759' }]}>
              <Text style={{ color: risk === 'high' ? '#FF3B30' : risk === 'moderate' ? '#FF9500' : '#34C759', fontSize: 12, fontWeight: '700' }}>
                {t(`warmup.riskLabel.${risk}`)}
              </Text>
            </View>
          </View>

          {/* ── 今日のアドバイス ── */}
          <View style={st.noteCard}>
            <Text style={st.noteText}>{t(`warmup.riskNote.${risk}`)}</Text>
          </View>

          {/* ── プログレスバー ── */}
          <View style={st.progressWrap}>
            <View style={st.progressBg}>
              <View style={[st.progressFill, {
                width: `${Math.round(progress * 100)}%` as any,
                backgroundColor: done ? NEON.green : BRAND,
              }]} />
            </View>
            <Text style={st.progressLabel}>{checked.size} / {items.length}</Text>
          </View>

          {/* ── チェックリスト ── */}
          <View style={st.list}>
            {items.map((item, i) => {
              const isChecked = checked.has(item.id)
              const catColor = CATEGORY_COLORS[item.category]
              return (
                <TouchableOpacity
                  key={item.id}
                  activeOpacity={0.7}
                  onPress={() => toggle(item.id)}
                  style={[st.item, i < items.length - 1 && { borderBottomWidth: 1, borderBottomColor: DIVIDER }, isChecked && st.itemChecked]}
                >
                  <View style={[st.catDot, { backgroundColor: catColor }]} />
                  <Text style={st.itemIcon}>{item.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[st.itemName, isChecked && { color: TEXT.hint, textDecorationLine: 'line-through' }]}>
                      {t(`warmup.items.${item.id}.name`)}
                    </Text>
                    <Text style={st.itemDetail}>{t(`warmup.items.${item.id}.detail`)}</Text>
                  </View>
                  <View style={[st.checkbox, isChecked && st.checkboxDone]}>
                    {isChecked && <Ionicons name="checkmark" size={16} color="#000" />}
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* ── カテゴリ凡例 ── */}
          <View style={st.legend}>
            {(Object.keys(CATEGORY_COLORS) as Category[]).map(cat => (
              <View key={cat} style={st.legendItem}>
                <View style={[st.legendDot, { backgroundColor: CATEGORY_COLORS[cat] }]} />
                <Text style={st.legendText}>{t(`warmup.categories.${cat}`)}</Text>
              </View>
            ))}
          </View>

          {/* ── 完了ボタン ── */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => { unlockAudio(); Sounds.save(); router.back() }}
            style={[st.doneBtn, done && st.doneBtnActive]}
          >
            <Ionicons name={done ? 'checkmark-circle' : 'play'} size={20} color="#fff" />
            <Text style={st.doneBtnText}>
              {done ? t('warmup.doneBtnActive') : t('warmup.doneBtnIdle')}
            </Text>
          </TouchableOpacity>

        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

const st = StyleSheet.create({
  content:       { padding: 16, gap: 12, paddingBottom: 40 },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  title:         { color: TEXT.primary, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  riskBadge:     { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  noteCard:      { backgroundColor: SURFACE, borderRadius: 12, padding: 14 },
  noteText:      { color: TEXT.secondary, fontSize: 13, lineHeight: 20 },
  progressWrap:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressBg:    { flex: 1, height: 6, backgroundColor: SURFACE2, borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 3 },
  progressLabel: { color: TEXT.hint, fontSize: 12, fontWeight: '700', minWidth: 36, textAlign: 'right' },
  list:          { backgroundColor: SURFACE, borderRadius: 14, overflow: 'hidden' },
  item:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 14, gap: 10 },
  itemChecked:   { opacity: 0.55 },
  catDot:        { width: 4, height: 36, borderRadius: 2 },
  itemIcon:      { fontSize: 22 },
  itemName:      { color: TEXT.primary, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  itemDetail:    { color: TEXT.secondary, fontSize: 12, lineHeight: 17 },
  checkbox:      {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 2, borderColor: DIVIDER,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxDone:  { backgroundColor: NEON.green, borderColor: NEON.green },
  legend:        { flexDirection: 'row', gap: 14, justifyContent: 'center', paddingVertical: 4 },
  legendItem:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:     { width: 8, height: 8, borderRadius: 4 },
  legendText:    { color: TEXT.hint, fontSize: 11 },
  doneBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: SURFACE2, borderRadius: 14,
    paddingVertical: 16, borderWidth: 1, borderColor: DIVIDER,
  },
  doneBtnActive: { backgroundColor: NEON.green, borderColor: NEON.green },
  doneBtnText:   { color: '#fff', fontSize: 16, fontWeight: '800' },
})

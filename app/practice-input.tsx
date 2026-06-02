// app/practice-input.tsx — 練習記録の入力方法選択画面
import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../context/ThemeContext'
import QuickLogModal from '../components/QuickLogModal'
import { Sounds, unlockAudio } from '../lib/sounds'
import { BRAND } from '../lib/theme'



export default function PracticeInputScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const [showAI, setShowAI] = useState(false)

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }}>

        {/* ── ヘッダー ── */}
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[s.title, { color: colors.text }]}>練習記録</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={s.content}>
          <Text style={[s.subtitle, { color: colors.textHint }]}>
            入力方法を選んでください
          </Text>

          {/* 手動入力 */}
          <TouchableOpacity
            style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            activeOpacity={0.85}
            onPress={() => { unlockAudio(); Sounds.tap(); router.push('/manual-log') }}
          >
            <View style={[s.iconWrap, { backgroundColor: 'rgba(90,200,250,0.15)' }]}>
              <Ionicons name="create-outline" size={32} color="#5AC8FA" />
            </View>
            <View style={s.cardBody}>
              <Text style={[s.cardTitle, { color: colors.text }]}>手動入力</Text>
              <Text style={[s.cardDesc, { color: colors.textHint }]}>
                種目・タイム・距離・疲労度を{'\n'}フォームで直接入力する
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textHint} />
          </TouchableOpacity>

          {/* 自由入力 */}
          <TouchableOpacity
            style={[s.card, s.cardAI, { backgroundColor: colors.surface, borderColor: 'rgba(90,200,250,0.4)' }]}
            activeOpacity={0.85}
            onPress={() => { unlockAudio(); Sounds.whoosh(); setShowAI(true) }}
          >
            <View style={[s.iconWrap, { backgroundColor: 'rgba(90,200,250,0.15)' }]}>
              <Text style={{ fontSize: 28 }}>✏️</Text>
            </View>
            <View style={s.cardBody}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[s.cardTitle, { color: colors.text }]}>自由入力</Text>
                <View style={[s.aiBadge, { backgroundColor: '#5AC8FA' }]}>
                  <Text style={s.aiBadgeText}>かんたん</Text>
                </View>
              </View>
              <Text style={[s.cardDesc, { color: colors.textHint }]}>
                練習内容を自由に文章で書くだけ{'\n'}自動で種目・タイムを読み取る
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textHint} />
          </TouchableOpacity>

          <Text style={[s.hint, { color: colors.textHint }]}>
            💡「400m×5本 レスト3分 68秒 疲労7」のように書くだけでOK
          </Text>
        </View>

        {/* AI入力モーダル */}
        <QuickLogModal
          visible={showAI}
          onClose={() => { setShowAI(false); router.back() }}
        />
      </SafeAreaView>
    </View>
  )
}

const s = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  backBtn:   { padding: 4 },
  title:     { fontSize: 17, fontWeight: '800' },
  content:   { flex: 1, padding: 20, gap: 16, justifyContent: 'center' },
  subtitle:  { fontSize: 13, textAlign: 'center', marginBottom: 8 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    borderRadius: 18, borderWidth: 1, padding: 20,
  },
  cardAI: { borderWidth: 1.5 },
  iconWrap:  { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  cardBody:  { flex: 1, gap: 4 },
  cardTitle: { fontSize: 17, fontWeight: '800' },
  cardDesc:  { fontSize: 13, lineHeight: 20 },
  aiBadge:   { backgroundColor: BRAND, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  aiBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  hint:      { fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: 8 },
})

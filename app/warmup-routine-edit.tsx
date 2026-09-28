// app/warmup-routine-edit.tsx — 「マイルーティン」(自由入力のウォームアップ)編集画面
// 2026-09-24: 「ウォームアップを自由に変更・登録できるように」との指示で追加。
// プリセット項目とは別に、ユーザーが種目名・内容を自由入力してルーティンを丸ごと
// 作成・保存できるようにする（lib/warmupRoutine.ts参照）。
import React, { useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Toast from 'react-native-toast-message'
import { BRAND } from '../lib/theme'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { Sounds, unlockAudio } from '../lib/sounds'
import ConfirmSheet from '../components/ConfirmSheet'
import { loadCustomRoutine, saveCustomRoutine, type CustomWarmupItem } from '../lib/warmupRoutine'

function makeId() {
  return `w${Date.now()}${Math.floor(Math.random() * 1000)}`
}

export default function WarmupRoutineEditScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const st = makeSt(colors)
  const [items, setItems] = useState<CustomWarmupItem[]>([])
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadCustomRoutine().then(loaded => setItems(loaded.length > 0 ? loaded : [{ id: makeId(), name: '', detail: '' }]))
  }, [])

  function updateItem(id: string, patch: Partial<CustomWarmupItem>) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it))
  }

  function addItem() {
    unlockAudio(); Sounds.pop()
    setItems(prev => [...prev, { id: makeId(), name: '', detail: '' }])
  }

  function removeItem(id: string) {
    setItems(prev => prev.filter(it => it.id !== id))
    setDeleteTarget(null)
  }

  async function handleSave() {
    const cleaned = items
      .map(it => ({ ...it, name: it.name.trim(), detail: it.detail.trim() }))
      .filter(it => it.name.length > 0)
    if (cleaned.length === 0) {
      Toast.show({ type: 'error', text1: t('warmup.nameRequiredToast') })
      return
    }
    setSaving(true)
    unlockAudio(); Sounds.save()
    await saveCustomRoutine(cleaned)
    setSaving(false)
    Toast.show({ type: 'success', text1: t('warmup.savedToast') })
    router.back()
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={st.header}>
          <TouchableOpacity onPress={() => router.back()} style={st.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={st.headerTitle}>{t('warmup.editRoutineTitle')}</Text>
          <View style={{ width: 32 }} />
        </View>

        <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
          {items.map((item, i) => (
            <View key={item.id} style={st.itemCard}>
              <View style={st.itemCardHeader}>
                <Text style={st.itemIndex}>{i + 1}</Text>
                <TouchableOpacity
                  onPress={() => setDeleteTarget(item.id)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={{ marginLeft: 'auto' as any }}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.textHint} />
                </TouchableOpacity>
              </View>
              <TextInput
                style={[st.input, { color: colors.text, borderColor: colors.border, outlineStyle: 'none' } as any]}
                value={item.name}
                onChangeText={v => updateItem(item.id, { name: v })}
                placeholder={t('warmup.itemNamePlaceholder')}
                placeholderTextColor={colors.textHint}
              />
              <TextInput
                style={[st.input, { color: colors.text, borderColor: colors.border, marginTop: 8, outlineStyle: 'none' } as any]}
                value={item.detail}
                onChangeText={v => updateItem(item.id, { detail: v })}
                placeholder={t('warmup.itemDetailPlaceholder')}
                placeholderTextColor={colors.textHint}
              />
            </View>
          ))}

          <TouchableOpacity style={st.addBtn} onPress={addItem} activeOpacity={0.75}>
            <Text style={st.addBtnText}>{t('warmup.addItemBtn')}</Text>
          </TouchableOpacity>
        </ScrollView>

        <View style={[st.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity style={st.saveBtn} onPress={handleSave} activeOpacity={0.85} disabled={saving}>
            <Text style={st.saveBtnText}>{t('warmup.saveRoutineBtn')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ConfirmSheet
        visible={!!deleteTarget}
        title={t('warmup.deleteItemConfirmTitle')}
        message={t('warmup.deleteItemConfirmBody')}
        confirmLabel={t('warmup.deleteItemConfirmYes')}
        dangerous
        onConfirm={() => deleteTarget && removeItem(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </View>
  )
}

const makeSt = (colors: ThemeColors) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { padding: 4 },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  itemCard: { backgroundColor: colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border },
  itemCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  itemIndex: { color: colors.textHint, fontSize: 12, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  addBtn: { alignItems: 'center', paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  addBtnText: { color: BRAND, fontSize: 14, fontWeight: '700' },
  footer: { padding: 16, borderTopWidth: 1 },
  saveBtn: { backgroundColor: BRAND, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
})

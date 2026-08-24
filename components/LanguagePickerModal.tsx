// components/LanguagePickerModal.tsx — 初回起動時に表示する言語選択画面
// 同意モーダル(app/_layout.tsx の ConsentModal)より先に表示される。
// 両方の言語を選ぶ前の画面なので、あえて i18n の t() は使わず日英併記の固定文言にする。
import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Modal } from 'react-native'
import { useLanguage } from '../context/LanguageContext'

const BRAND = '#166534'

export default function LanguagePickerModal() {
  const { setLanguage } = useLanguage()

  return (
    <Modal visible transparent animationType="fade">
      <View style={s.overlay}>
        <SafeAreaView style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={s.sheet}>
            <View style={s.iconWrap}>
              <Text style={{ fontSize: 32 }}>🌐</Text>
            </View>
            <Text style={s.title}>言語を選択{'\n'}Select your language</Text>

            <TouchableOpacity style={s.btn} onPress={() => setLanguage('ja')} activeOpacity={0.85}>
              <Text style={s.btnText}>日本語</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, { marginTop: 12 }]} onPress={() => setLanguage('en')} activeOpacity={0.85}>
              <Text style={s.btnText}>English</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 32,
    alignItems: 'center',
  },
  iconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(22,101,52,0.1)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18, fontWeight: '800', color: '#111827',
    textAlign: 'center', lineHeight: 26, marginBottom: 24,
  },
  btn: {
    width: '100%',
    backgroundColor: BRAND,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
})

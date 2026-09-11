// components/LanguagePickerModal.tsx — 初回起動時に表示する言語選択画面
// 同意モーダル(app/_layout.tsx の ConsentModal)より先に表示される。
// 両方の言語を選ぶ前の画面なので、あえて i18n の t() は使わず日英併記の固定文言にする。
import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Modal } from 'react-native'
import { useLanguage } from '../context/LanguageContext'
import { trackOnboardingStep } from '../lib/analytics'
import { useOverlayDismiss } from '../lib/useOverlayDismiss'

const BRAND = '#166534'

export default function LanguagePickerModal() {
  const { setLanguage } = useLanguage()
  // 2026-09-11: <Modal visible>固定+親(AuthGate)の条件アンマウントで閉じていたため、
  // 選択直後にiOSのoverFullScreen presentation破棄と次画面(同意モーダル)のpresentが
  // 競合し、タップ無反応になるフリーズがあった。閉じ切ってから言語を確定する
  // （lib/useOverlayDismiss.ts参照）。
  const { modalProps, close } = useOverlayDismiss(() => {})

  const choose = (lang: 'ja' | 'en') => {
    trackOnboardingStep('language_selected', { lang, auto: false })
    close(() => setLanguage(lang))
  }

  // 言語選択は必須ステップでキャンセル導線が無いため、onRequestClose(Android物理戻る)
  // は元々未設定のまま(バイパスさせない)にする。visible/onDismissだけ拝借する。
  return (
    <Modal transparent animationType="fade" visible={modalProps.visible} onDismiss={modalProps.onDismiss}>
      <View style={s.overlay}>
        <SafeAreaView style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={s.sheet}>
            <View style={s.iconWrap}>
              <Text style={{ fontSize: 32 }}>🌐</Text>
            </View>
            <Text style={s.title}>言語を選択{'\n'}Select your language</Text>

            <TouchableOpacity style={s.btn} onPress={() => choose('ja')} activeOpacity={0.85}>
              <Text style={s.btnText}>日本語</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, { marginTop: 12 }]} onPress={() => choose('en')} activeOpacity={0.85}>
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

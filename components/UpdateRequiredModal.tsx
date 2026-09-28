// components/UpdateRequiredModal.tsx
// 強制アップデート画面。閉じるボタンは無く、ストアへ飛ぶボタンのみ
// （Android物理戻るボタンでの回避も onRequestClose を無効化してブロックする）
import React from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet, Linking, Platform } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

const APP_STORE_URL  = 'https://apps.apple.com/jp/app/score/id6766394981'
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.scorejapan.score'

export default function UpdateRequiredModal({ message }: { message: string }) {
  const handleUpdate = () => {
    Linking.openURL(Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL).catch(() => {})
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => {}}>
      <View style={s.overlay}>
        <View style={s.card}>
          <View style={s.iconWrap}>
            <Ionicons name="arrow-up-circle" size={40} color="#166534" />
          </View>
          <Text style={s.title}>アップデートが必要です</Text>
          <Text style={s.message}>{message}</Text>
          <TouchableOpacity style={s.button} onPress={handleUpdate} activeOpacity={0.85}>
            <Text style={s.buttonText}>アップデートする</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 10,
  },
  message: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  button: {
    width: '100%',
    backgroundColor: '#166534',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
})

// components/LineCommunityBanner.tsx — アプデ後に一度だけ表示するLINEコミュニティ告知
import React from 'react'
import { Modal, View, Text, TouchableOpacity, ImageBackground, StyleSheet, Linking, SafeAreaView } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

const LINE_OPENCHAT_URL =
  'https://line.me/ti/g2/jLaBKGHQlJ6xlPaNYBhI_6N0O8OAPvVefJ2Lsw?utm_source=invitation&utm_medium=link_copy&utm_campaign=default'

export default function LineCommunityBanner({ onDismiss }: { onDismiss: () => void }) {
  const handleJoin = () => {
    Linking.openURL(LINE_OPENCHAT_URL).catch(() => {})
    onDismiss()
  }

  return (
    <Modal visible transparent animationType="fade">
      <ImageBackground
        source={require('../assets/banners/line-community-banner.png')}
        style={styles.bg}
        resizeMode="cover"
      >
        <SafeAreaView style={styles.safe}>
          {/* 閉じるボタン */}
          <TouchableOpacity
            onPress={onDismiss}
            style={styles.closeBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.75}
          >
            <Ionicons name="close" size={22} color="#166534" />
          </TouchableOpacity>

          {/* 見出し（イラストと重なっても読めるよう背景ピルを敷く） */}
          <View style={styles.headline}>
            <View style={styles.headlinePill}>
              <Text style={styles.headlineText}>LINEコミュニティ誕生！</Text>
              <Text style={styles.subText}>陸上仲間と繋がろう</Text>
            </View>
          </View>

          {/* 下部CTA */}
          <View style={styles.footer}>
            <View style={styles.descPill}>
              <Text style={styles.desc}>
                マンスリードロップチャレンジやアプデ情報、{'\n'}イベント情報をいち早くお届けします
              </Text>
            </View>
            <TouchableOpacity style={styles.joinBtn} onPress={handleJoin} activeOpacity={0.85}>
              <Ionicons name="chatbubbles" size={18} color="#fff" />
              <Text style={styles.joinBtnText}>オープンチャットに参加する</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onDismiss} activeOpacity={0.7}>
              <Text style={styles.laterText}>あとで</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </ImageBackground>
    </Modal>
  )
}

const styles = StyleSheet.create({
  bg: { flex: 1, width: '100%', height: '100%' },
  safe: { flex: 1, justifyContent: 'space-between' },
  closeBtn: {
    alignSelf: 'flex-end',
    marginRight: 16,
    marginTop: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    paddingTop: 8,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  headlinePill: {
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  headlineText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
  },
  subText: {
    marginTop: 4,
    fontSize: 13,
    color: '#166534',
    fontWeight: '600',
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 28,
    alignItems: 'center',
  },
  descPill: {
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  desc: {
    fontSize: 13,
    lineHeight: 20,
    color: '#374151',
    textAlign: 'center',
  },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#06C755',
    paddingVertical: 15,
    paddingHorizontal: 24,
    borderRadius: 28,
    width: '100%',
    shadowColor: '#06C755',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  joinBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  laterText: {
    marginTop: 14,
    fontSize: 13,
    color: '#6b7280',
  },
})

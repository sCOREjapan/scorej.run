// components/PracticeShareCard.tsx
// 練習記録シェアカード（sCORE — グラスモーフィズム）
import React, { useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  Share, Alert, ScrollView, Dimensions,
} from 'react-native'
import ViewShot, { captureRef } from 'react-native-view-shot'
import * as MediaLibrary from 'expo-media-library'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'

const W = Math.min(Dimensions.get('window').width - 32, 360)

export interface PracticeShareData {
  date: string
  title?: string
  menu?: string
  drills?: string[]
  distance?: number
  sets?: number
  time?: string
  fatigue?: number
  condition?: number
  weather?: string
  note?: string
  streak?: number
  rank?: string
  userName?: string
}

interface Props {
  data: PracticeShareData
  visible?: boolean
  onClose?: () => void
}

function fatigueColor(v: number) {
  if (v <= 3) return '#4ADE80'; if (v <= 6) return '#FBBF24'; return '#F87171'
}
function condColor(v: number) {
  if (v >= 8) return '#4ADE80'; if (v >= 5) return '#FBBF24'; return '#F87171'
}

// 半透明ガラスパネル（形でセクションを分ける）
function Panel({ children, style, accent }: { children: React.ReactNode; style?: any; accent?: string }) {
  return (
    <View style={[{
      backgroundColor: 'rgba(255,255,255,0.13)',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: accent ? `${accent}55` : 'rgba(255,255,255,0.22)',
      padding: 14,
      marginBottom: 10,
      ...(accent ? { borderLeftWidth: 3, borderLeftColor: accent } : {}),
    }, style]}>
      {children}
    </View>
  )
}

function BulletLine({ text }: { text: string }) {
  if (!text.trim()) return null
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 5 }}>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,107,53,0.9)', marginTop: 8, flexShrink: 0 }} />
      <Text style={{ color: 'rgba(255,255,255,0.90)', fontSize: 13, lineHeight: 21, flex: 1 }}>{text.trim()}</Text>
    </View>
  )
}

export default function PracticeShareCard({ data, visible = true, onClose }: Props) {
  const cardRef = useRef<any>(null)

  const handleSave = async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync()
      if (status !== 'granted') { Alert.alert('権限が必要です', 'カメラロールへのアクセスを許可してください'); return }
      const uri = await captureRef(cardRef, { format: 'png', quality: 1.0 })
      await MediaLibrary.saveToLibraryAsync(uri)
      Alert.alert('✅ 保存しました', 'カメラロールに保存されました')
    } catch { Alert.alert('エラー', '保存に失敗しました') }
  }

  const handleShare = async () => {
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1.0 })
      await Share.share({ url: uri, message: `${data.date}の練習 #sCORE #陸上` })
    } catch { Alert.alert('エラー', '共有に失敗しました') }
  }

  if (!visible) return null

  const menuLines = (data.menu ?? '').split('\n').filter(l => l.trim())
  const hasMeta = data.distance != null || data.sets != null || data.time != null

  return (
    <View style={st.overlay}>
      {/* 閉じるボタン */}
      {onClose ? (
        <TouchableOpacity onPress={onClose} style={st.topClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={22} color="rgba(255,255,255,0.85)" />
        </TouchableOpacity>
      ) : null}

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>

        {/* ── キャプチャ対象カード ── */}
        <ViewShot ref={cardRef} options={{ format: 'png', quality: 1.0 }}>
          {/* グラデーション背景 */}
          <LinearGradient
            colors={['#0D1B2A', '#1B263B', '#16213E', '#0F3460']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={st.card}
          >
            {/* 装飾円（形でアクセント） */}
            <View style={st.decoCircle1} />
            <View style={st.decoCircle2} />

            {/* sCORE ロゴ */}
            <View style={st.logoRow}>
              <Text style={st.logoText}>sCORE</Text>
              <View style={st.logoDivider} />
              <Text style={st.logoSub}>TRAINING LOG</Text>
            </View>

            {/* 日付 */}
            <Text style={st.dateText}>{data.date}</Text>

            {/* 種目タイトル */}
            {data.title ? <Text style={st.title}>{data.title}</Text> : null}

            {/* 連続日数 + ランク */}
            {(data.streak != null || data.rank) ? (
              <View style={st.badgeRow}>
                {data.streak != null ? (
                  <Panel style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, marginBottom: 0, borderRadius: 20 }}>
                    <Text style={{ fontSize: 14 }}>🔥</Text>
                    <Text style={{ color: '#FF6B35', fontSize: 12, fontWeight: '800' }}>{data.streak}日連続</Text>
                  </Panel>
                ) : null}
                {data.rank ? (
                  <Panel style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, marginBottom: 0, borderRadius: 20, borderColor: 'rgba(251,191,36,0.35)' }}>
                    <Text style={{ fontSize: 14 }}>⭐</Text>
                    <Text style={{ color: '#FBBF24', fontSize: 12, fontWeight: '800' }}>{data.rank}</Text>
                  </Panel>
                ) : null}
              </View>
            ) : null}

            {/* 練習内容 */}
            {menuLines.length > 0 ? (
              <Panel accent="#FF6B35">
                <Text style={st.panelLabel}>📋 練習内容</Text>
                {menuLines.map((l, i) => <BulletLine key={i} text={l} />)}
              </Panel>
            ) : null}

            {/* ドリル */}
            {data.drills && data.drills.length > 0 ? (
              <Panel accent="#60A5FA">
                <Text style={st.panelLabel}>🏃 ドリル</Text>
                {data.drills.map((d, i) => <BulletLine key={i} text={d} />)}
              </Panel>
            ) : null}

            {/* コンディション・疲労度 */}
            {(data.condition != null || data.fatigue != null) ? (
              <Panel style={{ flexDirection: 'row', gap: 0 }}>
                {data.condition != null ? (
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={st.miniLabel}>コンディション</Text>
                    <Text style={[st.miniValue, { color: condColor(data.condition) }]}>{data.condition}<Text style={{ fontSize: 11 }}>/10</Text></Text>
                  </View>
                ) : null}
                {data.condition != null && data.fatigue != null ? (
                  <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginVertical: 4 }} />
                ) : null}
                {data.fatigue != null ? (
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={st.miniLabel}>疲労度</Text>
                    <Text style={[st.miniValue, { color: fatigueColor(data.fatigue) }]}>{data.fatigue}<Text style={{ fontSize: 11 }}>/10</Text></Text>
                  </View>
                ) : null}
                {data.weather ? (
                  <>
                    <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginVertical: 4 }} />
                    <View style={{ flex: 1, alignItems: 'center' }}>
                      <Text style={st.miniLabel}>天気</Text>
                      <Text style={[st.miniValue, { color: 'rgba(255,255,255,0.75)', fontSize: 13 }]}>{data.weather}</Text>
                    </View>
                  </>
                ) : null}
              </Panel>
            ) : null}

            {/* 今日のコメント */}
            {data.note ? (
              <Panel accent="#A78BFA">
                <Text style={st.panelLabel}>💬 今日のコメント</Text>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 21, fontStyle: 'italic' }}>"{data.note}"</Text>
              </Panel>
            ) : null}

            {/* 距離・タイム・本数（最下部） */}
            {hasMeta ? (
              <Panel style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                {data.distance != null ? (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600' }}>DISTANCE</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 18, fontWeight: '800' }}>{data.distance.toFixed(1)}<Text style={{ fontSize: 10 }}>km</Text></Text>
                  </View>
                ) : null}
                {data.sets != null ? (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600' }}>REPS</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 18, fontWeight: '800' }}>{data.sets}<Text style={{ fontSize: 10 }}>本</Text></Text>
                  </View>
                ) : null}
                {data.time ? (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600' }}>TIME</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 18, fontWeight: '800' }}>{data.time}</Text>
                  </View>
                ) : null}
              </Panel>
            ) : null}

            {/* フッター */}
            <View style={st.footer}>
              <Text style={st.footerLeft}>{data.userName ? `@${data.userName}  ` : ''}#sCORE #陸上</Text>
              <Text style={st.footerRight}>📲 ダウンロードして保存</Text>
            </View>

          </LinearGradient>
        </ViewShot>

        {/* ボタン */}
        <View style={st.btnRow}>
          <TouchableOpacity style={st.saveBtn} onPress={handleSave} activeOpacity={0.85}>
            <Ionicons name="download-outline" size={18} color="#fff" />
            <Text style={st.btnText}>保存</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.shareBtn} onPress={handleShare} activeOpacity={0.85}>
            <Ionicons name="share-social-outline" size={18} color="#fff" />
            <Text style={st.btnText}>シェア</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

const st = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,8,20,0.88)',
    zIndex: 9999,
  },
  topClose: {
    position: 'absolute', top: 56, right: 20, zIndex: 10000,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { alignItems: 'center', paddingTop: 80, paddingBottom: 40, paddingHorizontal: 16 },
  card: { width: W, borderRadius: 24, padding: 22, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.6, shadowRadius: 32, elevation: 20,
  },
  // 装飾円
  decoCircle1: {
    position: 'absolute', width: 180, height: 180, borderRadius: 90,
    backgroundColor: 'rgba(255,107,53,0.12)', top: -60, right: -40,
  },
  decoCircle2: {
    position: 'absolute', width: 120, height: 120, borderRadius: 60,
    backgroundColor: 'rgba(96,165,250,0.10)', bottom: 40, left: -30,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  logoText: { fontSize: 28, fontWeight: '900', color: '#FF6B35', letterSpacing: 2 },
  logoDivider: { width: 1.5, height: 20, backgroundColor: 'rgba(255,255,255,0.2)' },
  logoSub: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.4)', letterSpacing: 1.5 },
  dateText: { fontSize: 13, color: 'rgba(255,255,255,0.50)', fontWeight: '500', marginBottom: 4 },
  title: { fontSize: 22, fontWeight: '900', color: '#fff', marginBottom: 12, letterSpacing: -0.3 },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  panelLabel: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.40)', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 },
  miniLabel: { fontSize: 10, color: 'rgba(255,255,255,0.40)', fontWeight: '600', marginBottom: 4 },
  miniValue: { fontSize: 20, fontWeight: '900' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.12)', paddingTop: 10, marginTop: 4 },
  footerLeft: { fontSize: 10, color: 'rgba(255,255,255,0.30)', fontWeight: '500' },
  footerRight: { fontSize: 10, color: '#FF6B35', fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 20, width: W },
  saveBtn: { flex: 1, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 14, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  shareBtn: { flex: 1, backgroundColor: '#FF6B35', borderRadius: 14, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})

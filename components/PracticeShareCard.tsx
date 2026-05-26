// components/PracticeShareCard.tsx
// 練習記録シェアカード（背景完全透過PNG — ミニマルデザイン）
import React, { useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  Share, Alert, ScrollView, Dimensions,
} from 'react-native'
import ViewShot, { captureRef } from 'react-native-view-shot'
import * as MediaLibrary from 'expo-media-library'
import { Ionicons } from '@expo/vector-icons'

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

const SHADOW: any = {
  textShadowColor: 'rgba(0,0,0,0.9)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 5,
}

export default function PracticeShareCard({ data, visible = true, onClose }: Props) {
  const cardRef = useRef<any>(null)

  const handleSave = async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync()
      if (status !== 'granted') { Alert.alert('権限が必要です', 'カメラロールへのアクセスを許可してください'); return }
      const uri = await captureRef(cardRef, { format: 'png', quality: 1.0, transparent: true } as any)
      await MediaLibrary.saveToLibraryAsync(uri)
      Alert.alert('✅ 保存しました', '背景透過PNGをカメラロールに保存しました')
    } catch { Alert.alert('エラー', '保存に失敗しました') }
  }

  const handleShare = async () => {
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1.0, transparent: true } as any)
      await Share.share({ url: uri, message: `${data.date}の練習 #sCORE #陸上` })
    } catch { Alert.alert('エラー', '共有に失敗しました') }
  }

  if (!visible) return null

  // 練習内容 + ドリルを1つのリストに統合
  const menuLines = (data.menu ?? '').split('\n').filter(l => l.trim())
  const drillLines = data.drills ?? []
  const allLines = [...menuLines, ...drillLines]

  const hasStats = data.condition != null || data.fatigue != null || data.distance != null || data.sets != null || data.time != null

  return (
    <View style={st.overlay}>
      {onClose ? (
        <TouchableOpacity onPress={onClose} style={st.topClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={22} color="rgba(255,255,255,0.85)" />
        </TouchableOpacity>
      ) : null}

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>

        {/* 透過PNG ヒント */}
        <View style={st.transparentHint}>
          <Ionicons name="image-outline" size={13} color="rgba(255,255,255,0.55)" />
          <Text style={st.transparentHintText}>背景透過PNG — 写真の上に貼ってシェアできます</Text>
        </View>

        {/* ── キャプチャ対象カード（背景完全透過） ── */}
        <ViewShot ref={cardRef} options={{ format: 'png', quality: 1.0, transparent: true } as any}
          style={{ backgroundColor: 'transparent' }}>
          <View style={st.card}>

            {/* sCORE ロゴ（大きく） */}
            <Text style={st.logo}>sCORE</Text>

            {/* 日付 + 連続日数 */}
            <View style={st.metaRow}>
              <Text style={st.dateText}>{data.date}</Text>
              {data.streak != null ? (
                <Text style={st.streakText}>🔥 {data.streak}日連続</Text>
              ) : null}
            </View>

            {/* 練習タイトル */}
            {data.title ? <Text style={st.titleText}>{data.title}</Text> : null}

            {/* セパレーター */}
            {allLines.length > 0 ? <View style={st.divider} /> : null}

            {/* 練習内容（menu + drills 統合・枠なし） */}
            {allLines.map((line, i) => (
              <Text key={i} style={st.practiceItem}>・{line.trim()}</Text>
            ))}

            {/* セパレーター */}
            {hasStats ? <View style={st.divider} /> : null}

            {/* コンディション・疲労度・距離 */}
            {hasStats ? (
              <View style={st.statsRow}>
                {data.condition != null ? (
                  <View style={st.statItem}>
                    <Text style={st.statLabel}>コンディション</Text>
                    <Text style={[st.statValue, { color: condColor(data.condition) }]}>
                      {data.condition}<Text style={st.statUnit}>/10</Text>
                    </Text>
                  </View>
                ) : null}
                {data.fatigue != null ? (
                  <View style={st.statItem}>
                    <Text style={st.statLabel}>疲労度</Text>
                    <Text style={[st.statValue, { color: fatigueColor(data.fatigue) }]}>
                      {data.fatigue}<Text style={st.statUnit}>/10</Text>
                    </Text>
                  </View>
                ) : null}
                {data.distance != null ? (
                  <View style={st.statItem}>
                    <Text style={st.statLabel}>DISTANCE</Text>
                    <Text style={[st.statValue, { color: '#fff' }]}>
                      {data.distance.toFixed(1)}<Text style={st.statUnit}>km</Text>
                    </Text>
                  </View>
                ) : null}
                {data.sets != null && data.distance == null ? (
                  <View style={st.statItem}>
                    <Text style={st.statLabel}>REPS</Text>
                    <Text style={[st.statValue, { color: '#fff' }]}>
                      {data.sets}<Text style={st.statUnit}>本</Text>
                    </Text>
                  </View>
                ) : null}
                {data.time ? (
                  <View style={st.statItem}>
                    <Text style={st.statLabel}>TIME</Text>
                    <Text style={[st.statValue, { color: '#fff' }]}>{data.time}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* 下セパレーター */}
            <View style={st.divider} />

            {/* フッター */}
            <Text style={st.downloadText}>sCORE 無料ダウンロード中 📲</Text>

          </View>
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

  // ── 透過カード本体 ─────────────────────────────────────────
  card: {
    width: W,
    paddingHorizontal: 24,
    paddingVertical: 20,
    backgroundColor: 'transparent',
  },

  // ── sCORE ロゴ ──────────────────────────────────────────────
  logo: {
    fontSize: 56,
    fontWeight: '900',
    color: '#FF6B35',
    letterSpacing: -1.5,
    lineHeight: 60,
    ...SHADOW,
  },

  // ── 日付・連続日数 ──────────────────────────────────────────
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
    marginBottom: 4,
  },
  dateText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.80)',
    fontWeight: '600',
    ...SHADOW,
  },
  streakText: {
    fontSize: 13,
    color: '#FF6B35',
    fontWeight: '800',
    ...SHADOW,
  },

  // ── 練習タイトル ────────────────────────────────────────────
  titleText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -0.5,
    marginTop: 4,
    ...SHADOW,
  },

  // ── セパレーター ────────────────────────────────────────────
  divider: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginVertical: 14,
  },

  // ── 練習内容リスト ──────────────────────────────────────────
  practiceItem: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '700',
    lineHeight: 28,
    ...SHADOW,
  },

  // ── ステータス行 ────────────────────────────────────────────
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 28,
    rowGap: 8,
  },
  statItem: {
    alignItems: 'flex-start',
  },
  statLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.50)',
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 1,
    ...SHADOW,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '900',
    color: '#fff',
    ...SHADOW,
  },
  statUnit: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.65)',
  },

  // ── ダウンロード文字 ────────────────────────────────────────
  downloadText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '700',
    letterSpacing: 0.5,
    ...SHADOW,
  },

  // ── 操作ボタン ──────────────────────────────────────────────
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 20, width: W },
  saveBtn: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 14, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  shareBtn: {
    flex: 1, backgroundColor: '#FF6B35', borderRadius: 14, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // 透過ヒントバナー
  transparentHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
    marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  transparentHintText: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '600' },
})

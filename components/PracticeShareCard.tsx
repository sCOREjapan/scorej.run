// components/PracticeShareCard.tsx
// 練習記録シェアカード（背景完全透過PNG — ATHLETE HUD デザイン）
import React, { useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  Share, Alert, ScrollView, Dimensions,
} from 'react-native'
import ViewShot, { captureRef } from 'react-native-view-shot'
import * as MediaLibrary from 'expo-media-library'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'

const W = Math.min(Dimensions.get('window').width - 32, 360)
const ORANGE = '#FF6B35'
const GREEN  = '#166534'

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

// ── HUDフレームの四隅コーナー装飾 ────────────────────────────────
function CornerBrackets({ color = ORANGE, size = 14, thickness = 2 }: { color?: string; size?: number; thickness?: number }) {
  const barH = { width: size, height: thickness, backgroundColor: color }
  const barV = { width: thickness, height: size, backgroundColor: color }
  return (
    <>
      <View style={{ position: 'absolute', top: 0, left: 0 }}>
        <View style={[barH, { position: 'absolute', top: 0, left: 0 }]} />
        <View style={[barV, { position: 'absolute', top: 0, left: 0 }]} />
      </View>
      <View style={{ position: 'absolute', top: 0, right: 0 }}>
        <View style={[barH, { position: 'absolute', top: 0, right: 0 }]} />
        <View style={[barV, { position: 'absolute', top: 0, right: 0 }]} />
      </View>
      <View style={{ position: 'absolute', bottom: 0, left: 0 }}>
        <View style={[barH, { position: 'absolute', bottom: 0, left: 0 }]} />
        <View style={[barV, { position: 'absolute', bottom: 0, left: 0 }]} />
      </View>
      <View style={{ position: 'absolute', bottom: 0, right: 0 }}>
        <View style={[barH, { position: 'absolute', bottom: 0, right: 0 }]} />
        <View style={[barV, { position: 'absolute', bottom: 0, right: 0 }]} />
      </View>
    </>
  )
}

// ── メイン数値見出しの合成（例: "400m×10本" "6'05\"×10本" "12.6km"） ──
// data.distance はセッション「合計」距離(km)。本数で割って1本あたりの距離に戻してから表示する
function buildHeadline(data: PracticeShareData): string | null {
  const repsTxt = data.sets != null ? `${data.sets}本` : null
  if (data.distance != null && data.sets) {
    const totalMeters  = Math.round(data.distance * 1000)
    const perRepMeters = Math.round(totalMeters / data.sets)
    return `${perRepMeters}m×${repsTxt}`
  }
  if (data.time && repsTxt) return `${data.time}×${repsTxt}`
  if (data.distance != null) return `${data.distance.toFixed(1)}km`
  if (repsTxt) return repsTxt
  if (data.time) return data.time
  return null
}

export default function PracticeShareCard({ data, visible = true, onClose }: Props) {
  const { t } = useTranslation()
  const cardRef = useRef<any>(null)

  const handleSave = async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync()
      if (status !== 'granted') { Alert.alert(t('practiceShareCard.permissionTitle'), t('practiceShareCard.permissionBody')); return }
      const uri = await captureRef(cardRef, { format: 'png', quality: 1.0, transparent: true } as any)
      await MediaLibrary.saveToLibraryAsync(uri)
      Alert.alert(t('practiceShareCard.saveSuccessTitle'), t('practiceShareCard.saveSuccessBody'))
    } catch { Alert.alert(t('practiceShareCard.errorTitle'), t('practiceShareCard.saveErrorBody')) }
  }

  const handleShare = async () => {
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1.0, transparent: true } as any)
      await Share.share({ url: uri, message: t('practiceShareCard.shareMessage', { date: data.date }) })
    } catch { Alert.alert(t('practiceShareCard.errorTitle'), t('practiceShareCard.shareErrorBody')) }
  }

  if (!visible) return null

  // 練習内容 + ドリルを1つのリストに統合
  const menuLines = (data.menu ?? '').split('\n').filter(l => l.trim())
  const drillLines = data.drills ?? []
  const allLines = [...menuLines, ...drillLines]

  const hasStats = data.condition != null || data.fatigue != null || data.distance != null || data.sets != null || data.time != null

  const headline = buildHeadline(data)
  // 見出しに使う数値が無ければ、種目名(title)自体を見出しとして大きく見せる
  const mainText = headline ?? data.title ?? t('practiceShareCard.defaultTitle')
  const captionText = headline ? data.title : null

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
          <Text style={st.transparentHintText}>{t('practiceShareCard.transparentHint')}</Text>
        </View>

        {/* ── キャプチャ対象カード（背景完全透過） ── */}
        <ViewShot ref={cardRef} options={{ format: 'png', quality: 1.0, transparent: true } as any}
          style={{ backgroundColor: 'transparent' }}>
          <View style={st.card}>

            {/* sCORE ロゴ + 日付/連続日数 */}
            <Text style={st.logo}>sCORE</Text>

            <View style={st.metaRow}>
              <View style={st.metaPill}>
                <Ionicons name="calendar-outline" size={11} color="rgba(255,255,255,0.75)" />
                <Text style={st.dateText}>{data.date}</Text>
              </View>
              {data.streak != null ? (
                <View style={st.metaPill}>
                  <Ionicons name="flame" size={12} color={ORANGE} />
                  <Text style={st.streakText}>{t('practiceShareCard.streakSuffix', { n: data.streak })}</Text>
                </View>
              ) : null}
            </View>

            {/* ── HUDフレーム（メイン練習内容） ── */}
            <View style={st.hudBox}>
              <CornerBrackets />
              <View style={st.hudInner}>
                {captionText ? <Text style={st.hudCaption}>{captionText.toUpperCase()}</Text> : null}
                <Text style={st.hudMain} numberOfLines={2} adjustsFontSizeToFit>{mainText}</Text>

                {allLines.length > 0 && (
                  <>
                    <View style={st.hudDivider} />
                    {allLines.map((line, i) => (
                      <View key={i} style={st.bulletRow}>
                        <View style={st.bulletDot} />
                        <Text style={st.practiceItem}>{line.trim()}</Text>
                      </View>
                    ))}
                  </>
                )}
              </View>
            </View>

            {/* コンディション・疲労度・距離 */}
            {hasStats ? (
              <View style={st.statsRow}>
                {data.condition != null ? (
                  <View style={st.statItem}>
                    <View style={st.statLabelRow}>
                      <Ionicons name="heart" size={10} color="rgba(255,255,255,0.55)" />
                      <Text style={st.statLabel}>{t('practiceShareCard.stats.condition')}</Text>
                    </View>
                    <Text style={[st.statValue, { color: condColor(data.condition) }]}>
                      {data.condition}<Text style={st.statUnit}>/100</Text>
                    </Text>
                  </View>
                ) : null}
                {data.fatigue != null ? (
                  <View style={st.statItem}>
                    <View style={st.statLabelRow}>
                      <Ionicons name="flash" size={10} color="rgba(255,255,255,0.55)" />
                      <Text style={st.statLabel}>{t('practiceShareCard.stats.fatigue')}</Text>
                    </View>
                    <Text style={[st.statValue, { color: fatigueColor(data.fatigue) }]}>
                      {data.fatigue}<Text style={st.statUnit}>/100</Text>
                    </Text>
                  </View>
                ) : null}
                {data.distance != null ? (
                  <View style={st.statItem}>
                    <View style={st.statLabelRow}>
                      <Ionicons name="location" size={10} color="rgba(255,255,255,0.55)" />
                      <Text style={st.statLabel}>{t('practiceShareCard.stats.distance')}</Text>
                    </View>
                    <Text style={[st.statValue, { color: '#fff' }]}>
                      {data.distance.toFixed(1)}<Text style={st.statUnit}>km</Text>
                    </Text>
                  </View>
                ) : null}
                {data.sets != null && data.distance == null ? (
                  <View style={st.statItem}>
                    <View style={st.statLabelRow}>
                      <Ionicons name="repeat" size={10} color="rgba(255,255,255,0.55)" />
                      <Text style={st.statLabel}>{t('practiceShareCard.stats.reps')}</Text>
                    </View>
                    <Text style={[st.statValue, { color: '#fff' }]}>
                      {data.sets}<Text style={st.statUnit}>{t('practiceShareCard.repsUnit')}</Text>
                    </Text>
                  </View>
                ) : null}
                {data.time ? (
                  <View style={st.statItem}>
                    <View style={st.statLabelRow}>
                      <Ionicons name="stopwatch-outline" size={10} color="rgba(255,255,255,0.55)" />
                      <Text style={st.statLabel}>{t('practiceShareCard.stats.time')}</Text>
                    </View>
                    <Text style={[st.statValue, { color: '#fff' }]}>{data.time}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* フッター */}
            <View style={st.footerRow}>
              <View style={st.footerTick} />
              <Text style={st.downloadText}>{t('practiceShareCard.footer')}</Text>
              <View style={st.footerTick} />
            </View>

          </View>
        </ViewShot>

        {/* ボタン */}
        <View style={st.btnRow}>
          <TouchableOpacity style={st.saveBtn} onPress={handleSave} activeOpacity={0.85}>
            <Ionicons name="download-outline" size={18} color="#fff" />
            <Text style={st.btnText}>{t('practiceShareCard.save')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.shareBtn} onPress={handleShare} activeOpacity={0.85}>
            <Ionicons name="share-social-outline" size={18} color="#fff" />
            <Text style={st.btnText}>{t('practiceShareCard.share')}</Text>
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
    fontSize: 44,
    fontWeight: '900',
    color: ORANGE,
    letterSpacing: -1,
    lineHeight: 48,
    ...SHADOW,
  },

  // ── 日付・連続日数 ──────────────────────────────────────────
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 16,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dateText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.80)',
    fontWeight: '600',
    ...SHADOW,
  },
  streakText: {
    fontSize: 12,
    color: ORANGE,
    fontWeight: '800',
    ...SHADOW,
  },

  // ── HUDフレーム ─────────────────────────────────────────────
  hudBox: {
    position: 'relative',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  hudInner: {
    borderLeftWidth: 2,
    borderLeftColor: ORANGE,
    paddingLeft: 12,
  },
  hudCaption: {
    fontSize: 12,
    fontWeight: '800',
    color: ORANGE,
    letterSpacing: 2,
    marginBottom: 4,
    ...SHADOW,
  },
  hudMain: {
    fontSize: 40,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -1,
    lineHeight: 44,
    ...SHADOW,
  },
  hudDivider: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginVertical: 12,
  },

  // ── 練習内容リスト ──────────────────────────────────────────
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  bulletDot: {
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: ORANGE,
  },
  practiceItem: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
    lineHeight: 20,
    flex: 1,
    ...SHADOW,
  },

  // ── ステータス行 ────────────────────────────────────────────
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 24,
    rowGap: 10,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.22)',
    paddingTop: 14,
    marginBottom: 14,
  },
  statItem: {
    alignItems: 'flex-start',
  },
  statLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.50)',
    fontWeight: '700',
    letterSpacing: 0.6,
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

  // ── フッター ────────────────────────────────────────────────
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  footerTick: {
    width: 16, height: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
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
    flex: 1, backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 14,
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

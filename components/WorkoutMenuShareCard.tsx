// components/WorkoutMenuShareCard.tsx
// 練習メニュー（自分で組み立て／AI生成）のシェアカード（背景完全透過PNG）
// — NutritionShareCard/PracticeShareCardと構造・実装を統一（同じViewShot+captureRefパターン）
import React, { useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  Share, Alert, ScrollView, Dimensions,
} from 'react-native'
import ViewShot, { captureRef } from 'react-native-view-shot'
import * as MediaLibrary from 'expo-media-library'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { ensureGalleryWritePermission, saveImageToGallery } from '../lib/mediaPermissions'

const W = Math.min(Dimensions.get('window').width - 32, 360)
const GREEN = '#166534'   // lib/theme.ts の BRAND と統一

export interface WorkoutMenuShareData {
  date: string
  /** 「スピード移行期。強度高めで」等の一言。無ければ既定見出しを使う */
  intent?: string
  /** 実施順に並んだ種目名リスト */
  items: string[]
  /** 合計時間の目安（分）。任意入力なので無ければ非表示 */
  totalMinutes?: number
  /** 'ai' = チケットを使いAIが組んだ／'manual' = 自分でライブラリから組み立てた */
  source: 'ai' | 'manual'
}

interface Props {
  data: WorkoutMenuShareData
  visible?: boolean
  onClose?: () => void
}

const SHADOW: any = {
  textShadowColor: 'rgba(0,0,0,0.9)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 5,
}

function CornerBrackets({ color = GREEN, size = 14, thickness = 2 }: { color?: string; size?: number; thickness?: number }) {
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

export default function WorkoutMenuShareCard({ data, visible = true, onClose }: Props) {
  const { t } = useTranslation()
  const cardRef = useRef<any>(null)

  const handleSave = async () => {
    try {
      const status = (await ensureGalleryWritePermission()) ? 'granted' : 'denied'
      if (status !== 'granted') { Alert.alert(t('workoutMenuShareCard.permissionTitle'), t('workoutMenuShareCard.permissionBody')); return }
      const uri = await captureRef(cardRef, { format: 'png', quality: 1.0, transparent: true } as any)
      // Android は共有シートで保存するため、保存完了の表示は出さない(lib/mediaPermissions.ts)
      if ((await saveImageToGallery(uri)) === 'shared') return
      Alert.alert(t('workoutMenuShareCard.saveSuccessTitle'), t('workoutMenuShareCard.saveSuccessBody'))
    } catch { Alert.alert(t('workoutMenuShareCard.errorTitle'), t('workoutMenuShareCard.saveErrorBody')) }
  }

  const handleShare = async () => {
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1.0, transparent: true } as any)
      await Share.share({ url: uri, message: t('workoutMenuShareCard.shareMessage', { date: data.date }) })
    } catch { Alert.alert(t('workoutMenuShareCard.errorTitle'), t('workoutMenuShareCard.shareErrorBody')) }
  }

  if (!visible) return null

  const items = data.items ?? []
  const sourceLabel = data.source === 'ai' ? t('workoutMenuShareCard.sourceAi') : t('workoutMenuShareCard.sourceManual')

  return (
    <View style={st.overlay}>
      {onClose ? (
        <TouchableOpacity onPress={onClose} style={st.topClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={22} color="rgba(255,255,255,0.85)" />
        </TouchableOpacity>
      ) : null}

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>

        <View style={st.transparentHint}>
          <Ionicons name="image-outline" size={13} color="rgba(255,255,255,0.55)" />
          <Text style={st.transparentHintText}>{t('workoutMenuShareCard.transparentHint')}</Text>
        </View>

        <ViewShot ref={cardRef} options={{ format: 'png', quality: 1.0, transparent: true } as any}
          style={{ backgroundColor: 'transparent' }}>
          <View style={st.card}>

            <Text style={st.logo}>sCORE</Text>

            <View style={st.metaRow}>
              <View style={st.metaPill}>
                <Ionicons name="calendar-outline" size={11} color="rgba(255,255,255,0.75)" />
                <Text style={st.dateText}>{data.date}</Text>
              </View>
              <View style={st.metaPill}>
                <Ionicons name={data.source === 'ai' ? 'sparkles' : 'construct-outline'} size={11} color={GREEN} />
                <Text style={st.sourceText}>{sourceLabel}</Text>
              </View>
            </View>

            <View style={st.hudBox}>
              <CornerBrackets />
              <View style={st.hudInner}>
                <Text style={st.hudCaption} numberOfLines={1}>{(data.intent ?? t('workoutMenuShareCard.defaultCaption')).toUpperCase()}</Text>
                <Text style={st.hudMain} numberOfLines={1} adjustsFontSizeToFit>
                  {items.length}<Text style={st.hudUnit}> {t('workoutMenuShareCard.itemsUnit')}</Text>
                </Text>

                {items.length > 0 && (
                  <>
                    <View style={st.hudDivider} />
                    {items.slice(0, 10).map((it, i) => (
                      <View key={i} style={st.bulletRow}>
                        <Text style={st.bulletIndex}>{i + 1}.</Text>
                        <Text style={st.foodItem} numberOfLines={1}>{it}</Text>
                      </View>
                    ))}
                    {items.length > 10 && (
                      <Text style={st.moreText}>{t('workoutMenuShareCard.moreItems', { n: items.length - 10 })}</Text>
                    )}
                  </>
                )}
              </View>
            </View>

            <View style={st.statsRow}>
              <View style={st.statItem}>
                <View style={st.statLabelRow}>
                  <Ionicons name="time-outline" size={11} color="rgba(255,255,255,0.65)" />
                  <Text style={st.statLabel}>{t('workoutMenuShareCard.stats.duration')}</Text>
                </View>
                <Text style={[st.statValue, { color: '#fff' }]}>
                  {data.totalMinutes ? <>{data.totalMinutes}<Text style={st.statUnit}> {t('workoutMenuShareCard.minUnit')}</Text></> : '-'}
                </Text>
              </View>
              <View style={st.statItem}>
                <View style={st.statLabelRow}>
                  <Ionicons name="list-outline" size={11} color="rgba(255,255,255,0.65)" />
                  <Text style={st.statLabel}>{t('workoutMenuShareCard.stats.count')}</Text>
                </View>
                <Text style={[st.statValue, { color: '#fff' }]}>{items.length}<Text style={st.statUnit}> {t('workoutMenuShareCard.itemsUnit')}</Text></Text>
              </View>
            </View>

            <View style={st.footerRow}>
              <View style={st.footerTick} />
              <Text style={st.downloadText}>{t('workoutMenuShareCard.footer')}</Text>
              <View style={st.footerTick} />
            </View>

          </View>
        </ViewShot>

        <View style={st.btnRow}>
          <TouchableOpacity style={st.saveBtn} onPress={handleSave} activeOpacity={0.85}>
            <Ionicons name="download-outline" size={18} color="#fff" />
            <Text style={st.btnText}>{t('workoutMenuShareCard.save')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.shareBtn} onPress={handleShare} activeOpacity={0.85}>
            <Ionicons name="share-social-outline" size={18} color="#fff" />
            <Text style={st.btnText}>{t('workoutMenuShareCard.share')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

const st = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.88)', zIndex: 9999 },
  topClose: {
    position: 'absolute', top: 56, right: 20, zIndex: 10000,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { alignItems: 'center', paddingTop: 80, paddingBottom: 40, paddingHorizontal: 16 },

  card: { width: W, paddingHorizontal: 24, paddingVertical: 20, backgroundColor: 'transparent' },

  logo: { fontSize: 44, fontWeight: '900', color: GREEN, letterSpacing: -1, lineHeight: 48, ...SHADOW },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 16 },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dateText: { fontSize: 12, color: 'rgba(255,255,255,0.80)', fontWeight: '600', ...SHADOW },
  sourceText: { fontSize: 12, color: GREEN, fontWeight: '800', ...SHADOW },

  hudBox: { position: 'relative', paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16 },
  hudInner: { borderLeftWidth: 2, borderLeftColor: GREEN, paddingLeft: 12 },
  hudCaption: { fontSize: 12, fontWeight: '800', color: GREEN, letterSpacing: 2, marginBottom: 4, ...SHADOW },
  hudMain: { fontSize: 40, fontWeight: '900', color: '#fff', letterSpacing: -1, lineHeight: 44, ...SHADOW },
  hudUnit: { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },
  hudDivider: { height: 0.5, backgroundColor: 'rgba(255,255,255,0.22)', marginVertical: 12 },

  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  bulletIndex: { fontSize: 13, color: GREEN, fontWeight: '800', width: 18, ...SHADOW },
  foodItem: { fontSize: 14, color: '#fff', fontWeight: '600', lineHeight: 20, flex: 1, ...SHADOW },
  moreText: { fontSize: 12, color: 'rgba(255,255,255,0.55)', fontWeight: '600', marginTop: 2 },

  statsRow: {
    flexDirection: 'row', columnGap: 24, rowGap: 10,
    borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.22)',
    paddingTop: 14, marginBottom: 14,
  },
  statItem: { alignItems: 'flex-start' },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  statLabel: { fontSize: 9, color: 'rgba(255,255,255,0.50)', fontWeight: '700', letterSpacing: 0.6, ...SHADOW },
  statValue: { fontSize: 24, fontWeight: '900', color: '#fff', ...SHADOW },
  statUnit: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.65)' },

  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  footerTick: { width: 16, height: 1, backgroundColor: 'rgba(255,255,255,0.3)' },
  downloadText: { fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: '700', letterSpacing: 0.5, ...SHADOW },

  btnRow: { flexDirection: 'row', gap: 12, marginTop: 20, width: W },
  saveBtn: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 14, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  shareBtn: {
    flex: 1, backgroundColor: GREEN, borderRadius: 14, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  transparentHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
    marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  transparentHintText: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '600' },
})

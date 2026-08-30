// components/NutritionShareCard.tsx
// 栄養分析結果シェアカード（背景完全透過PNG — PracticeShareCardと統一デザイン）
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

export interface NutritionShareData {
  date: string
  mealType?: string
  totalCalories: number
  protein: number
  carb: number
  fat: number
  foods?: string[]
  advice?: string
}

interface Props {
  data: NutritionShareData
  visible?: boolean
  onClose?: () => void
}

const SHADOW: any = {
  textShadowColor: 'rgba(0,0,0,0.9)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 5,
}

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

export default function NutritionShareCard({ data, visible = true, onClose }: Props) {
  const { t } = useTranslation()
  const cardRef = useRef<any>(null)

  const handleSave = async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync()
      if (status !== 'granted') { Alert.alert(t('nutritionShareCard.permissionTitle'), t('nutritionShareCard.permissionBody')); return }
      const uri = await captureRef(cardRef, { format: 'png', quality: 1.0, transparent: true } as any)
      await MediaLibrary.saveToLibraryAsync(uri)
      Alert.alert(t('nutritionShareCard.saveSuccessTitle'), t('nutritionShareCard.saveSuccessBody'))
    } catch { Alert.alert(t('nutritionShareCard.errorTitle'), t('nutritionShareCard.saveErrorBody')) }
  }

  const handleShare = async () => {
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1.0, transparent: true } as any)
      await Share.share({ url: uri, message: t('nutritionShareCard.shareMessage', { date: data.date }) })
    } catch { Alert.alert(t('nutritionShareCard.errorTitle'), t('nutritionShareCard.shareErrorBody')) }
  }

  if (!visible) return null

  const foods = data.foods ?? []

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
          <Text style={st.transparentHintText}>{t('nutritionShareCard.transparentHint')}</Text>
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
              {data.mealType ? (
                <View style={st.metaPill}>
                  <Ionicons name="restaurant" size={11} color={ORANGE} />
                  <Text style={st.mealTypeText}>{data.mealType}</Text>
                </View>
              ) : null}
            </View>

            <View style={st.hudBox}>
              <CornerBrackets />
              <View style={st.hudInner}>
                {data.advice ? <Text style={st.hudCaption} numberOfLines={1}>{data.advice.toUpperCase()}</Text> : null}
                <Text style={st.hudMain} numberOfLines={1} adjustsFontSizeToFit>
                  {Math.round(data.totalCalories)}<Text style={st.hudUnit}> kcal</Text>
                </Text>

                {foods.length > 0 && (
                  <>
                    <View style={st.hudDivider} />
                    {foods.map((f, i) => (
                      <View key={i} style={st.bulletRow}>
                        <View style={st.bulletDot} />
                        <Text style={st.foodItem} numberOfLines={1}>{f}</Text>
                      </View>
                    ))}
                  </>
                )}
              </View>
            </View>

            <View style={st.statsRow}>
              <View style={st.statItem}>
                <View style={st.statLabelRow}>
                  <Ionicons name="ellipse" size={8} color="#60A5FA" />
                  <Text style={st.statLabel}>PROTEIN</Text>
                </View>
                <Text style={[st.statValue, { color: '#fff' }]}>{Math.round(data.protein)}<Text style={st.statUnit}>g</Text></Text>
              </View>
              <View style={st.statItem}>
                <View style={st.statLabelRow}>
                  <Ionicons name="ellipse" size={8} color="#FBBF24" />
                  <Text style={st.statLabel}>CARB</Text>
                </View>
                <Text style={[st.statValue, { color: '#fff' }]}>{Math.round(data.carb)}<Text style={st.statUnit}>g</Text></Text>
              </View>
              <View style={st.statItem}>
                <View style={st.statLabelRow}>
                  <Ionicons name="ellipse" size={8} color="#F87171" />
                  <Text style={st.statLabel}>FAT</Text>
                </View>
                <Text style={[st.statValue, { color: '#fff' }]}>{Math.round(data.fat)}<Text style={st.statUnit}>g</Text></Text>
              </View>
            </View>

            <View style={st.footerRow}>
              <View style={st.footerTick} />
              <Text style={st.downloadText}>{t('nutritionShareCard.footer')}</Text>
              <View style={st.footerTick} />
            </View>

          </View>
        </ViewShot>

        <View style={st.btnRow}>
          <TouchableOpacity style={st.saveBtn} onPress={handleSave} activeOpacity={0.85}>
            <Ionicons name="download-outline" size={18} color="#fff" />
            <Text style={st.btnText}>{t('nutritionShareCard.save')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.shareBtn} onPress={handleShare} activeOpacity={0.85}>
            <Ionicons name="share-social-outline" size={18} color="#fff" />
            <Text style={st.btnText}>{t('nutritionShareCard.share')}</Text>
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

  logo: { fontSize: 44, fontWeight: '900', color: ORANGE, letterSpacing: -1, lineHeight: 48, ...SHADOW },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 16 },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dateText: { fontSize: 12, color: 'rgba(255,255,255,0.80)', fontWeight: '600', ...SHADOW },
  mealTypeText: { fontSize: 12, color: ORANGE, fontWeight: '800', ...SHADOW },

  hudBox: { position: 'relative', paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16 },
  hudInner: { borderLeftWidth: 2, borderLeftColor: ORANGE, paddingLeft: 12 },
  hudCaption: { fontSize: 12, fontWeight: '800', color: ORANGE, letterSpacing: 2, marginBottom: 4, ...SHADOW },
  hudMain: { fontSize: 40, fontWeight: '900', color: '#fff', letterSpacing: -1, lineHeight: 44, ...SHADOW },
  hudUnit: { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },
  hudDivider: { height: 0.5, backgroundColor: 'rgba(255,255,255,0.22)', marginVertical: 12 },

  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  bulletDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: ORANGE },
  foodItem: { fontSize: 14, color: '#fff', fontWeight: '600', lineHeight: 20, flex: 1, ...SHADOW },

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
    flex: 1, backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 14,
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

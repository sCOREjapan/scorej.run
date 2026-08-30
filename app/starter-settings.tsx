// app/starter-settings.tsx — スターターツールのタイミング設定画面
import React, { useEffect, useState, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import SimpleSlider from '../components/SimpleSlider'
import { unlockAudio, Sounds } from '../lib/sounds'
import {
  getStarterSettings, saveStarterSettings, STARTER_DEFAULTS,
  GUN_RANDOM_MIN, GUN_RANDOM_MAX, type StarterSettings,
} from '../lib/starterSettings'
import { useTranslation } from 'react-i18next'

const BRAND = '#16a34a'
const BG = '#f6f6f8'
const CARD = '#ffffff'
const BORDER = 'rgba(0,0,0,0.08)'
const TEXT_PRIMARY = '#111827'
const TEXT_SECONDARY = '#6b7280'
const TEXT_HINT = '#9ca3af'

export default function StarterSettingsScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const [settings, setSettings] = useState<StarterSettings>(STARTER_DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    getStarterSettings().then(s => { setSettings(s); setLoaded(true) })
  }, [])

  const update = useCallback((patch: Partial<StarterSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      saveStarterSettings(next)
      return next
    })
  }, [])

  if (!loaded) return <View style={{ flex: 1, backgroundColor: BG }} />

  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityLabel={t('starterSettings.backLabel')}>
          <Ionicons name="chevron-back" size={26} color={TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>{t('starterSettings.headerTitle')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={st.scroll}>
        <View style={st.card}>
          <View style={st.row}>
            <Text style={st.label}>{t('starterSettings.startToMarks')}</Text>
            <Text style={st.value}>{settings.startToMarksSec.toFixed(1)} s</Text>
          </View>
          <SimpleSlider
            value={settings.startToMarksSec} min={1} max={10} step={0.5} color={BRAND}
            onChange={(v) => update({ startToMarksSec: v })}
          />
          <View style={st.rangeRow}>
            <Text style={st.rangeText}>1 s</Text>
            <Text style={st.rangeText}>10 s</Text>
          </View>

          <View style={st.divider} />

          <View style={st.row}>
            <Text style={st.label}>{t('starterSettings.marksToSet')}</Text>
            <Text style={st.value}>{settings.marksToSetSec.toFixed(1)} s</Text>
          </View>
          <SimpleSlider
            value={settings.marksToSetSec} min={3} max={30} step={1} color={BRAND}
            onChange={(v) => update({ marksToSetSec: v })}
          />
          <View style={st.rangeRow}>
            <Text style={st.rangeText}>3 s</Text>
            <Text style={st.rangeText}>30 s</Text>
          </View>
        </View>

        <View style={st.card}>
          <View style={st.switchRow}>
            <Text style={st.label}>{t('starterSettings.setToGun')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={st.switchLabel}>{t('starterSettings.random')}</Text>
              <Switch
                value={settings.gunRandom}
                onValueChange={(v) => { unlockAudio(); Sounds.toggleOn(); update({ gunRandom: v }) }}
                trackColor={{ false: '#d1d5db', true: BRAND }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {settings.gunRandom ? (
            <Text style={st.hint}>{t('starterSettings.randomHint', { min: GUN_RANDOM_MIN, max: GUN_RANDOM_MAX })}</Text>
          ) : (
            <>
              <View style={st.row}>
                <Text style={st.label}>{t('starterSettings.fixedWait')}</Text>
                <Text style={st.value}>{settings.gunFixedSec.toFixed(1)} s</Text>
              </View>
              <SimpleSlider
                value={settings.gunFixedSec} min={1} max={3} step={0.1} color={BRAND}
                onChange={(v) => update({ gunFixedSec: v })}
              />
              <View style={st.rangeRow}>
                <Text style={st.rangeText}>1 s</Text>
                <Text style={st.rangeText}>3 s</Text>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: BG },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  backBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT_PRIMARY },
  scroll:      { padding: 16, gap: 16 },
  card:        { backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER, borderRadius: 21, padding: 18, gap: 4 },
  row:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  switchRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  label:       { fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY },
  value:       { fontSize: 16, fontWeight: '800', color: BRAND, fontVariant: ['tabular-nums'] },
  switchLabel: { fontSize: 13, fontWeight: '600', color: TEXT_SECONDARY },
  rangeRow:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  rangeText:   { fontSize: 11, color: TEXT_HINT },
  divider:     { height: 1, backgroundColor: BORDER, marginVertical: 18 },
  hint:        { fontSize: 12.5, color: TEXT_SECONDARY, textAlign: 'center', marginTop: 4 },
})

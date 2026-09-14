// app/admin-generate-code.tsx — チームプラン引き換えコードの手動発行画面(Web専用・自分専用)
// 2026-09-14: BASE等、Webhook連携の無い決済手段で注文が入った時に、手動でコードを
// 1件発行するための内輪向けツール。api/admin-generate-team-code.ts参照。
import React, { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

const NAVY = '#16324a'
const GOLD2 = '#d97706'
const BRAND = '#166534'
const PAPER = '#f8fafc'

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')

const TIERS: { key: string; label: string }[] = [
  { key: 'coach_monthly', label: 'スタンダード（〜15人）¥1,980' },
  { key: 'coach_monthly_30', label: 'アドバンス（〜30人）¥2,980' },
  { key: 'coach_monthly_unlimited', label: 'プレミアム（無制限）¥4,980' },
]

export default function AdminGenerateCodeScreen() {
  const [passcode, setPasscode] = useState('')
  const [tier, setTier] = useState(TIERS[0].key)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  const generate = async () => {
    setBusy(true); setError(''); setCode('')
    try {
      const res = await fetch(`${API_BASE}/api/admin-generate-team-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode, tier, note }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? '発行に失敗しました')
      setCode(json.code)
    } catch (e: any) {
      setError(e?.message ?? '発行に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const copy = () => {
    if (Platform.OS === 'web' && navigator?.clipboard) navigator.clipboard.writeText(code)
  }

  return (
    <View style={{ flex: 1, backgroundColor: PAPER }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', paddingTop: 60, paddingHorizontal: 24 }}>
        <View style={s.card}>
          <Text style={s.title}>チームコード発行（内部用）</Text>
          <Text style={s.label}>合言葉</Text>
          <TextInput style={s.input} value={passcode} onChangeText={setPasscode} secureTextEntry placeholder="ADMIN_CODE_SECRET" />

          <Text style={s.label}>プラン</Text>
          {TIERS.map(t => (
            <TouchableOpacity key={t.key} style={[s.tierRow, tier === t.key && s.tierRowActive]} onPress={() => setTier(t.key)}>
              <Ionicons name={tier === t.key ? 'radio-button-on' : 'radio-button-off'} size={18} color={tier === t.key ? NAVY : '#94a3b8'} />
              <Text style={s.tierText}>{t.label}</Text>
            </TouchableOpacity>
          ))}

          <Text style={s.label}>メモ（購入者メール等・任意）</Text>
          <TextInput style={s.input} value={note} onChangeText={setNote} placeholder="example@school.jp" />

          <TouchableOpacity style={[s.btn, busy && { opacity: 0.6 }]} onPress={generate} disabled={busy || !passcode}>
            <Text style={s.btnText}>{busy ? '発行中…' : 'コードを発行'}</Text>
          </TouchableOpacity>

          {!!code && (
            <>
              <TouchableOpacity style={s.codeBox} onPress={copy}>
                <Text style={s.codeText}>{code}</Text>
                <Ionicons name="copy-outline" size={16} color={BRAND} />
              </TouchableOpacity>
              {/* api/admin-generate-team-code.ts / api/team-checkout-verify.ts の
                  CODE_VALIDITY_DAYSと揃える(サーバー側の実値の表示用メモ) */}
              <Text style={s.expiryNote}>発行から90日間有効。購入者への案内にも明記してください。</Text>
            </>
          )}
          {!!error && <Text style={s.error}>{error}</Text>}
        </View>
      </SafeAreaView>
    </View>
  )
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 420, borderWidth: 1, borderColor: '#e2e8f0' },
  title: { fontSize: 17, fontWeight: '800', color: '#0f172a', marginBottom: 18, textAlign: 'center' },
  label: { fontSize: 11.5, fontWeight: '700', color: '#64748b', marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: '#f1f5f9', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  tierRowActive: {},
  tierText: { fontSize: 13, color: '#0f172a' },
  btn: { marginTop: 20, backgroundColor: GOLD2, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 14.5, fontWeight: '800' },
  codeBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, backgroundColor: '#f0fdf4', borderRadius: 10, paddingVertical: 12, borderWidth: 1, borderColor: BRAND + '40' },
  codeText: { fontSize: 17, fontWeight: '800', color: '#0f172a', letterSpacing: 1 },
  expiryNote: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 8 },
  error: { color: '#dc2626', fontSize: 12.5, textAlign: 'center', marginTop: 12 },
})

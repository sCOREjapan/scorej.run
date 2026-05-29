// app/admin.tsx — 管理者専用ダッシュボード
// アクセス: scorej-run.vercel.app/admin
import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, TextInput, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Svg, {
  Circle, Rect, Text as SvgText, G, Line, Path,
} from 'react-native-svg'
import { supabase } from '../lib/supabase'
import { Ionicons } from '@expo/vector-icons'

const ADMIN_PASS = process.env.EXPO_PUBLIC_ADMIN_PASSWORD ?? 'score2026admin'

// ── 都道府県の地理的位置（SVG 260×270内の座標） ──────────────
// lon range 129-146°E, lat range 31-46°N → 260×250px
const PREF_MAP: { name: string; x: number; y: number; region: string }[] = [
  { name: '北海道', x: 189, y: 49,  region: '北海道' },
  { name: '青森',   x: 180, y: 86,  region: '東北' },
  { name: '岩手',   x: 188, y: 104, region: '東北' },
  { name: '秋田',   x: 170, y: 104, region: '東北' },
  { name: '宮城',   x: 182, y: 126, region: '東北' },
  { name: '山形',   x: 169, y: 126, region: '東北' },
  { name: '福島',   x: 173, y: 141, region: '東北' },
  { name: '茨城',   x: 178, y: 159, region: '関東' },
  { name: '栃木',   x: 168, y: 154, region: '関東' },
  { name: '群馬',   x: 153, y: 158, region: '関東' },
  { name: '埼玉',   x: 158, y: 166, region: '関東' },
  { name: '千葉',   x: 177, y: 172, region: '関東' },
  { name: '東京',   x: 167, y: 172, region: '関東' },
  { name: '神奈川', x: 163, y: 181, region: '関東' },
  { name: '山梨',   x: 147, y: 171, region: '中部' },
  { name: '長野',   x: 139, y: 155, region: '中部' },
  { name: '新潟',   x: 153, y: 135, region: '中部' },
  { name: '富山',   x: 126, y: 154, region: '中部' },
  { name: '石川',   x: 116, y: 156, region: '中部' },
  { name: '福井',   x: 110, y: 165, region: '中部' },
  { name: '岐阜',   x: 118, y: 176, region: '中部' },
  { name: '静岡',   x: 145, y: 183, region: '中部' },
  { name: '愛知',   x: 122, y: 180, region: '中部' },
  { name: '三重',   x: 116, y: 190, region: '近畿' },
  { name: '滋賀',   x: 105, y: 181, region: '近畿' },
  { name: '京都',   x: 98,  y: 178, region: '近畿' },
  { name: '大阪',   x: 96,  y: 188, region: '近畿' },
  { name: '兵庫',   x: 87,  y: 184, region: '近畿' },
  { name: '奈良',   x: 105, y: 192, region: '近畿' },
  { name: '和歌山', x: 93,  y: 199, region: '近畿' },
  { name: '鳥取',   x: 79,  y: 174, region: '中国' },
  { name: '島根',   x: 62,  y: 174, region: '中国' },
  { name: '岡山',   x: 75,  y: 188, region: '中国' },
  { name: '広島',   x: 54,  y: 193, region: '中国' },
  { name: '山口',   x: 38,  y: 197, region: '中国' },
  { name: '徳島',   x: 86,  y: 200, region: '四国' },
  { name: '香川',   x: 76,  y: 193, region: '四国' },
  { name: '愛媛',   x: 58,  y: 203, region: '四国' },
  { name: '高知',   x: 70,  y: 210, region: '四国' },
  { name: '福岡',   x: 22,  y: 208, region: '九州' },
  { name: '佐賀',   x: 14,  y: 214, region: '九州' },
  { name: '長崎',   x: 7,   y: 222, region: '九州' },
  { name: '熊本',   x: 28,  y: 221, region: '九州' },
  { name: '大分',   x: 41,  y: 213, region: '九州' },
  { name: '宮崎',   x: 38,  y: 234, region: '九州' },
  { name: '鹿児島', x: 25,  y: 242, region: '九州' },
  { name: '沖縄',   x: 22,  y: 260, region: '沖縄' },
]

const REGION_COLORS: Record<string, string> = {
  '北海道': '#6366f1',
  '東北':   '#22d3ee',
  '関東':   '#f43f5e',
  '中部':   '#f97316',
  '近畿':   '#a855f7',
  '中国':   '#10b981',
  '四国':   '#eab308',
  '九州':   '#ef4444',
  '沖縄':   '#06b6d4',
}

interface AdminStats {
  total_users:       number
  total_sessions:    number
  active_7d:         number
  prefecture_dist:   { prefecture: string; count: number }[]
  event_dist:        { event: string; count: number }[]
  weekly_sessions:   { week: string; count: number }[]
}

// ── カラースケール（0=グレー → 緑系） ────────────────────────
function countToColor(count: number, max: number): string {
  if (count === 0 || max === 0) return '#e5e7eb'
  const ratio = Math.min(count / max, 1)
  if (ratio < 0.2) return '#bbf7d0'
  if (ratio < 0.4) return '#4ade80'
  if (ratio < 0.7) return '#22c55e'
  return '#16a34a'
}

// ── KPIカード ─────────────────────────────────────────────────
function KpiCard({ label, value, icon, color }: {
  label: string; value: string | number; icon: string; color: string
}) {
  return (
    <View style={[kpi.card, { borderColor: color + '30' }]}>
      <View style={[kpi.iconWrap, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon as any} size={20} color={color} />
      </View>
      <Text style={kpi.value}>{value.toLocaleString()}</Text>
      <Text style={kpi.label}>{label}</Text>
    </View>
  )
}
const kpi = StyleSheet.create({
  card:     { flex: 1, backgroundColor: '#1e1e2e', borderRadius: 14, borderWidth: 1, padding: 14, gap: 6, minWidth: 130 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  value:    { color: '#fff', fontSize: 24, fontWeight: '900' },
  label:    { color: '#6b7280', fontSize: 11, fontWeight: '600' },
})

// ── 横棒グラフ行 ──────────────────────────────────────────────
function BarRow({ label, count, max, color }: {
  label: string; count: number; max: number; color?: string
}) {
  const pct = max > 0 ? (count / max) * 100 : 0
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <Text style={{ color: '#9ca3af', fontSize: 12, width: 60, textAlign: 'right' }}>{label}</Text>
      <View style={{ flex: 1, height: 8, backgroundColor: '#2a2a3e', borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color ?? '#16a34a', borderRadius: 4 }} />
      </View>
      <Text style={{ color: '#6b7280', fontSize: 11, width: 28, textAlign: 'right' }}>{count}</Text>
    </View>
  )
}

// ── 折れ線グラフ（SVG） ───────────────────────────────────────
function LineChart({ data }: { data: { week: string; count: number }[] }) {
  if (!data || data.length < 2) return <Text style={{ color: '#6b7280', textAlign: 'center', marginTop: 20 }}>データなし</Text>
  const W = 280, H = 100, PAD = 10
  const maxVal = Math.max(...data.map(d => d.count), 1)
  const stepX = (W - PAD * 2) / (data.length - 1)
  const points = data.map((d, i) => ({
    x: PAD + i * stepX,
    y: PAD + (1 - d.count / maxVal) * (H - PAD * 2),
    label: d.week,
    count: d.count,
  }))
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')

  return (
    <Svg width={W} height={H + 20}>
      {/* グリッド線 */}
      {[0, 0.5, 1].map((v, i) => (
        <Line key={i}
          x1={PAD} y1={PAD + (1 - v) * (H - PAD * 2)}
          x2={W - PAD} y2={PAD + (1 - v) * (H - PAD * 2)}
          stroke="#2a2a3e" strokeWidth={1}
        />
      ))}
      {/* ライン */}
      <Path d={pathD} fill="none" stroke="#16a34a" strokeWidth={2} strokeLinejoin="round" />
      {/* ドット */}
      {points.map((p, i) => (
        <G key={i}>
          <Circle cx={p.x} cy={p.y} r={3} fill="#16a34a" />
        </G>
      ))}
      {/* X軸ラベル（最初・中央・最後） */}
      {[0, Math.floor(points.length / 2), points.length - 1].map(i => (
        <SvgText key={i} x={points[i].x} y={H + 15} fontSize={9} fill="#6b7280" textAnchor="middle">
          {points[i].label}
        </SvgText>
      ))}
    </Svg>
  )
}

// ── 日本地図バブル ────────────────────────────────────────────
function JapanMap({ data }: { data: { prefecture: string; count: number }[] }) {
  const countMap: Record<string, number> = {}
  data.forEach(d => { countMap[d.prefecture] = d.count })
  const maxCount = Math.max(...data.map(d => d.count), 1)
  const [tooltip, setTooltip] = useState<{ name: string; count: number } | null>(null)

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={260} height={275} style={{ backgroundColor: '#111827', borderRadius: 12 }}>
        {/* 背景（海）*/}
        <Rect x={0} y={0} width={260} height={275} fill="#0f172a" rx={12} />

        {/* 沖縄区切り線 */}
        <Line x1={5} y1={253} x2={50} y2={253} stroke="#2a2a3e" strokeWidth={1} strokeDasharray="3,3" />

        {/* 都道府県バブル */}
        {PREF_MAP.map(pref => {
          const cnt = countMap[pref.name] ?? 0
          const color = countToColor(cnt, maxCount)
          const r = cnt > 0 ? Math.max(5, Math.min(12, 5 + Math.sqrt(cnt) * 2)) : 4
          const regionColor = REGION_COLORS[pref.region] ?? '#4b5563'
          return (
            <G key={pref.name}
              onPress={() => setTooltip(tooltip?.name === pref.name ? null : { name: pref.name, count: cnt })}
            >
              <Circle
                cx={pref.x} cy={pref.y} r={r}
                fill={cnt > 0 ? color : '#1e293b'}
                stroke={cnt > 0 ? regionColor : '#374151'}
                strokeWidth={1}
                opacity={cnt > 0 ? 1 : 0.5}
              />
              {cnt > 0 && r >= 8 && (
                <SvgText x={pref.x} y={pref.y + 3} fontSize={7} fill="#fff" textAnchor="middle" fontWeight="700">
                  {cnt}
                </SvgText>
              )}
            </G>
          )
        })}

        {/* 沖縄ラベル */}
        <SvgText x={36} y={264} fontSize={8} fill="#374151">沖縄</SvgText>
      </Svg>

      {/* ツールチップ */}
      {tooltip && (
        <View style={{ marginTop: 8, backgroundColor: '#1e1e2e', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
            {tooltip.name}: {tooltip.count}人
          </Text>
        </View>
      )}

      {/* 凡例 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, justifyContent: 'center' }}>
        {Object.entries(REGION_COLORS).map(([region, color]) => (
          <View key={region} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
            <Text style={{ color: '#6b7280', fontSize: 10 }}>{region}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

// ── パスワード画面 ────────────────────────────────────────────
function PasswordScreen({ pass, setPass, onLogin, error }: {
  pass: string; setPass: (s: string) => void; onLogin: () => void; error: string
}) {
  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a1a', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <View style={{ backgroundColor: '#1e1e2e', borderRadius: 20, padding: 32, width: '100%', maxWidth: 360, gap: 16 }}>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: '#16a34a20', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="lock-closed" size={28} color="#16a34a" />
          </View>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '900' }}>sCORE 管理画面</Text>
          <Text style={{ color: '#6b7280', fontSize: 13 }}>管理者パスワードを入力してください</Text>
        </View>
        <TextInput
          style={{ backgroundColor: '#0a0a1a', color: '#fff', borderRadius: 10, padding: 14, fontSize: 16, borderWidth: 1, borderColor: '#2a2a3e' }}
          placeholder="パスワード"
          placeholderTextColor="#374151"
          value={pass}
          onChangeText={setPass}
          secureTextEntry
          onSubmitEditing={onLogin}
          autoFocus
        />
        {error ? <Text style={{ color: '#ef4444', fontSize: 13, textAlign: 'center' }}>{error}</Text> : null}
        <TouchableOpacity
          style={{ backgroundColor: '#16a34a', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
          onPress={onLogin}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>ログイン</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ── メイン ────────────────────────────────────────────────────
export default function AdminScreen() {
  const [authed,  setAuthed]  = useState(false)
  const [pass,    setPass]    = useState('')
  const [stats,   setStats]   = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [tab,     setTab]     = useState<'map' | 'sport' | 'trend'>('map')

  const loadStats = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_admin_stats')
      if (rpcErr) throw rpcErr
      setStats(data as AdminStats)
    } catch (e: any) {
      setError(e?.message ?? 'データ取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleLogin = () => {
    if (pass === ADMIN_PASS) {
      setAuthed(true)
      loadStats()
    } else {
      setError('パスワードが違います')
    }
  }

  if (!authed) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a1a' }}>
        <PasswordScreen pass={pass} setPass={setPass} onLogin={handleLogin} error={error} />
      </View>
    )
  }

  const prefDist  = stats?.prefecture_dist  ?? []
  const eventDist = stats?.event_dist       ?? []
  const weekly    = stats?.weekly_sessions  ?? []
  const maxPref   = Math.max(...prefDist.map(d => d.count), 1)
  const maxEvent  = Math.max(...eventDist.map(d => d.count), 1)

  // プレミアム率（PRO+ELITE）は profiles 単体では取れないので placeholder
  const premiumPct = stats ? '—' : '—'

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a1a' }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* ヘッダー */}
        <View style={s.header}>
          <View>
            <Text style={s.headerTitle}>📊 sCORE ダッシュボード</Text>
            <Text style={s.headerSub}>管理者専用 · リアルタイム統計</Text>
          </View>
          <TouchableOpacity onPress={loadStats} style={s.refreshBtn}>
            {loading
              ? <ActivityIndicator size="small" color="#16a34a" />
              : <Ionicons name="refresh" size={20} color="#16a34a" />
            }
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {error ? (
            <View style={s.errorBox}>
              <Text style={{ color: '#ef4444' }}>⚠ {error}</Text>
              <Text style={{ color: '#6b7280', fontSize: 11, marginTop: 4 }}>
                Supabase で get_admin_stats() RPC を作成してください
              </Text>
            </View>
          ) : null}

          {/* KPI カード */}
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <KpiCard label="総ユーザー"   value={stats?.total_users    ?? '—'} icon="people"       color="#6366f1" />
            <KpiCard label="7日アクティブ" value={stats?.active_7d     ?? '—'} icon="pulse"        color="#22c55e" />
            <KpiCard label="累計練習記録"  value={stats?.total_sessions ?? '—'} icon="barbell"      color="#f97316" />
            <KpiCard label="有料率"        value={premiumPct}                   icon="diamond"      color="#eab308" />
          </View>

          {/* タブ */}
          <View style={s.tabRow}>
            {[
              { key: 'map',   label: '🗾 地域マップ' },
              { key: 'sport', label: '🏃 種目分布' },
              { key: 'trend', label: '📈 週次推移' },
            ].map(t => (
              <TouchableOpacity
                key={t.key}
                onPress={() => setTab(t.key as any)}
                style={[s.tab, tab === t.key && s.tabActive]}
              >
                <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 地域マップ */}
          {tab === 'map' && (
            <View style={s.card}>
              <Text style={s.cardTitle}>都道府県別ユーザー分布</Text>
              {loading
                ? <ActivityIndicator color="#16a34a" style={{ marginTop: 40, marginBottom: 40 }} />
                : <JapanMap data={prefDist} />
              }
              {prefDist.length > 0 && (
                <View style={{ marginTop: 16 }}>
                  <Text style={[s.cardTitle, { fontSize: 12, marginBottom: 8 }]}>TOP 10 都道府県</Text>
                  {prefDist.slice(0, 10).map(d => (
                    <BarRow
                      key={d.prefecture}
                      label={d.prefecture}
                      count={d.count}
                      max={maxPref}
                      color={REGION_COLORS[PREF_MAP.find(p => p.name === d.prefecture)?.region ?? ''] ?? '#16a34a'}
                    />
                  ))}
                </View>
              )}
            </View>
          )}

          {/* 種目分布 */}
          {tab === 'sport' && (
            <View style={s.card}>
              <Text style={s.cardTitle}>競技種目別ユーザー数</Text>
              {loading
                ? <ActivityIndicator color="#16a34a" style={{ marginTop: 40, marginBottom: 40 }} />
                : eventDist.length === 0
                  ? <Text style={s.empty}>データなし</Text>
                  : eventDist.map(d => (
                    <BarRow key={d.event} label={d.event} count={d.count} max={maxEvent} color="#6366f1" />
                  ))
              }
            </View>
          )}

          {/* 週次推移 */}
          {tab === 'trend' && (
            <View style={s.card}>
              <Text style={s.cardTitle}>週次練習記録数（過去12週）</Text>
              {loading
                ? <ActivityIndicator color="#16a34a" style={{ marginTop: 40, marginBottom: 40 }} />
                : <LineChart data={weekly} />
              }
            </View>
          )}

          {/* 最終更新 */}
          <Text style={{ color: '#374151', fontSize: 11, textAlign: 'center', marginTop: 8 }}>
            最終取得: {new Date().toLocaleString('ja-JP')}
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

const s = StyleSheet.create({
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  headerTitle:  { color: '#fff', fontSize: 18, fontWeight: '900' },
  headerSub:    { color: '#6b7280', fontSize: 11, marginTop: 2 },
  refreshBtn:   { width: 40, height: 40, borderRadius: 12, backgroundColor: '#1e1e2e', alignItems: 'center', justifyContent: 'center' },
  scroll:       { padding: 16, gap: 14, paddingBottom: 40 },
  errorBox:     { backgroundColor: '#1e1e2e', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#ef444430' },
  tabRow:       { flexDirection: 'row', backgroundColor: '#1e1e2e', borderRadius: 12, padding: 4, gap: 4 },
  tab:          { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  tabActive:    { backgroundColor: '#16a34a20' },
  tabText:      { color: '#6b7280', fontSize: 12, fontWeight: '600' },
  tabTextActive:{ color: '#16a34a', fontWeight: '800' },
  card:         { backgroundColor: '#1e1e2e', borderRadius: 16, padding: 18 },
  cardTitle:    { color: '#fff', fontSize: 14, fontWeight: '800', marginBottom: 14 },
  empty:        { color: '#6b7280', textAlign: 'center', paddingVertical: 30 },
})

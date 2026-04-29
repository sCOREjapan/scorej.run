// app/share-card.tsx — シェアカード v2（透過オーバーレイ）
import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Platform, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Path } from 'react-native-svg'
import { BRAND } from '../lib/theme'
import Toast from 'react-native-toast-message'
import type { RaceRecord } from '../types'

const RECORDS_KEY = 'trackmate_race_records'

function formatDateJP(s: string) {
  const [y, m, d] = s.split('-')
  return `${y}年${m}月${d}日`
}

// ── sCORE ロゴ（React Native 用 SVG） ────────────────────────────────────────
// 心拍グラフ→上昇アロー + "sCORE" テキスト
function ScoreIcon({ height = 24 }: { height?: number }) {
  const w = height * 1.55
  return (
    <Svg width={w} height={height} viewBox="0 0 124 80">
      {/* 心拍→上昇カーブ */}
      <Path
        d="M0,52 L28,52 L42,9 L55,72 L65,52 C80,52 83,18 104,10"
        stroke="#ffffff"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* 矢印ヘッド */}
      <Path
        d="M112,4 L97,20 L108,26 Z"
        fill="#ffffff"
      />
    </Svg>
  )
}

// ── sCORE ロゴ（Canvas 書き出し用） ──────────────────────────────────────────
function drawScoreLogo(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  logoH: number,
  withShadow = true,
) {
  const iW = logoH * 1.55   // アイコン幅
  const iH = logoH           // アイコン高さ
  const sw = iH * 0.095      // 線幅

  if (withShadow) { c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 14 }

  // ── アイコン：ECG + 上昇カーブ ──
  c.strokeStyle = '#ffffff'
  c.lineWidth   = sw
  c.lineCap     = 'round'
  c.lineJoin    = 'round'

  const base = y + iH * 0.65   // 基準ライン

  c.beginPath()
  c.moveTo(x, base)
  c.lineTo(x + iW * 0.225, base)                              // 水平
  c.lineTo(x + iW * 0.340, y + iH * 0.11)                    // 上スパイク
  c.lineTo(x + iW * 0.445, y + iH * 0.90)                    // 谷
  c.lineTo(x + iW * 0.525, base)                              // 戻り
  c.bezierCurveTo(
    x + iW * 0.650, base,
    x + iW * 0.670, y + iH * 0.20,
    x + iW * 0.840, y + iH * 0.12,
  )
  c.stroke()

  // ── 矢印ヘッド ──
  c.shadowBlur = 0
  const ax = x + iW * 0.905, ay = y + iH * 0.05
  const ah = sw * 2.1
  c.fillStyle = '#ffffff'
  c.beginPath()
  c.moveTo(ax,          ay)                   // 先端
  c.lineTo(ax - ah * 1.2, ay + ah * 1.3)     // 左根元
  c.lineTo(ax + ah * 0.9, ay + ah * 0.55)    // 右根元
  c.closePath()
  c.fill()

  if (withShadow) { c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 14 }

  // ── テキスト "sCORE" ──
  const gap    = logoH * 0.18
  const txtX   = x + iW + gap
  const txtY   = y + iH * 0.78

  // "s"（白・小）
  const sSize = logoH * 0.56
  c.font      = `600 ${sSize}px system-ui, -apple-system, sans-serif`
  c.fillStyle = '#ffffff'
  c.fillText('s', txtX, txtY)
  const sW = c.measureText('s').width * 0.92

  // "CORE"（白・大）
  const coreSize = logoH * 0.74
  c.font      = `800 ${coreSize}px system-ui, -apple-system, sans-serif`
  c.fillStyle = '#ffffff'
  c.fillText('CORE', txtX + sW, txtY)

  c.shadowBlur = 0
}

// ── Canvas Export — 透過PNG (1080×1920) ────────────────────────────────────
function exportOverlayPNG(record: RaceRecord) {
  if (typeof document === 'undefined') return

  const W = 1080, H = 1920
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const c = cv.getContext('2d')!
  // 背景は塗らない → 完全透明

  function shadow(blur = 20, color = 'rgba(0,0,0,0.92)') {
    c.shadowColor = color; c.shadowBlur = blur
  }
  function noShadow() { c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0 }

  function rr(x: number, y: number, w: number, h: number, r: number) {
    c.beginPath()
    c.moveTo(x + r, y); c.lineTo(x + w - r, y)
    c.quadraticCurveTo(x + w, y, x + w, y + r)
    c.lineTo(x + w, y + h - r)
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    c.lineTo(x + r, y + h)
    c.quadraticCurveTo(x, y + h, x, y + h - r)
    c.lineTo(x, y + r)
    c.quadraticCurveTo(x, y, x + r, y)
    c.closePath()
  }

  // ロゴなし（グラスブロックのみ）

  // ── グラスブロック（中央） ──
  const bx = 68, by = H / 2 - 360, bw = W - 136, bh = 680

  // ブロックの影
  c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 80; c.shadowOffsetY = 24
  c.fillStyle = 'rgba(255,255,255,0.17)'
  rr(bx, by, bw, bh, 44); c.fill()
  noShadow()

  // グラスの枠線
  c.strokeStyle = 'rgba(255,255,255,0.38)'; c.lineWidth = 2.5
  rr(bx, by, bw, bh, 44); c.stroke()

  const tx = bx + 64

  // 種目ラベル
  shadow(16, 'rgba(0,0,0,0.85)')
  c.font = '700 40px system-ui, sans-serif'
  c.fillStyle = '#ffffff'
  c.fillText(record.event, tx, by + 94)

  // 大きいタイム（自動縮小）
  let fs = 200
  c.font = `800 ${fs}px system-ui, sans-serif`
  while (c.measureText(record.result_display).width > bw - 110 && fs > 96) {
    fs -= 6; c.font = `800 ${fs}px system-ui, sans-serif`
  }
  shadow(30, 'rgba(0,0,0,0.95)')
  c.fillStyle = '#ffffff'
  c.fillText(record.result_display, tx, by + 94 + fs + 16)

  // PB / SB バッジ（白）
  const badgeY = by + 94 + fs + 54
  noShadow()
  if (record.is_pb || record.is_sb) {
    const label = record.is_pb ? '自己ベスト！' : 'シーズンベスト！'
    const badgeW = record.is_pb ? 260 : 340
    c.fillStyle = 'rgba(255,255,255,0.12)'; rr(tx, badgeY, badgeW, 60, 14); c.fill()
    c.strokeStyle = 'rgba(255,255,255,0.65)'; c.lineWidth = 2; rr(tx, badgeY, badgeW, 60, 14); c.stroke()
    shadow(10, 'rgba(0,0,0,0.6)')
    c.font = '800 30px system-ui, sans-serif'
    c.fillStyle = '#ffffff'
    c.fillText(label, tx + 20, badgeY + 41)
    noShadow()
  }

  // セパレーター
  const sepY = by + bh - 248
  c.strokeStyle = 'rgba(255,255,255,0.28)'; c.lineWidth = 1
  c.beginPath(); c.moveTo(tx, sepY); c.lineTo(bx + bw - 64, sepY); c.stroke()

  // メタ情報
  shadow(12, 'rgba(0,0,0,0.8)')
  c.font = '400 36px system-ui, sans-serif'
  c.fillStyle = 'rgba(255,255,255,0.88)'
  let my = sepY + 64
  c.fillText(formatDateJP(record.race_date), tx, my)
  if (record.competition_name) { my += 56; c.fillText(record.competition_name, tx, my) }
  if (record.wind_ms !== undefined) {
    my += 56
    c.fillText(`wind  ${record.wind_ms >= 0 ? '+' : ''}${record.wind_ms} m/s`, tx, my)
  }
  noShadow()

  // ウォーターマーク — グラスブロック右下
  const wmX = bx + bw - 44   // ブロック右端から内側
  const wmBotY = by + bh - 30 // ブロック底辺から上30px
  shadow(10, 'rgba(0,0,0,0.55)')
  c.textAlign = 'right'
  c.font = '800 34px system-ui, sans-serif'
  c.fillStyle = 'rgba(255,255,255,0.6)'
  c.fillText('sCORE', wmX, wmBotY - 44)
  c.font = '500 26px system-ui, sans-serif'
  c.fillStyle = 'rgba(255,255,255,0.42)'
  c.fillText('アプリをダウンロード！', wmX, wmBotY)
  noShadow()
  c.textAlign = 'left'

  // ダウンロード
  const a = document.createElement('a')
  a.download = `score-${record.event.replace(/[^a-z0-9]/gi, '')}-overlay.png`
  a.href = cv.toDataURL('image/png')
  a.click()
}

// ── プレビューコンポーネント（アプリ内表示用） ───────────────────────────────
// LinearGradient = サンプル背景（実際のPNGは透過）
function OverlayPreview({ record }: { record: RaceRecord }) {
  return (
    <LinearGradient
      colors={['#0f2027', '#203a43', '#2c5364']}
      style={pv.container}
    >
      {/* グラスブロック */}
      <View style={pv.glass}>
        <Text style={pv.event}>{record.event}</Text>
        <Text style={pv.result} adjustsFontSizeToFit numberOfLines={1}>
          {record.result_display}
        </Text>
        <View style={pv.badgeRow}>
          {record.is_pb && (
            <View style={[pv.badge, { backgroundColor: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.6)' }]}>
              <Ionicons name="trophy" size={12} color="#ffffff" />
              <Text style={[pv.badgeTxt, { color: '#ffffff' }]}>自己ベスト！</Text>
            </View>
          )}
          {record.is_sb && !record.is_pb && (
            <View style={[pv.badge, { backgroundColor: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.6)' }]}>
              <Ionicons name="star" size={12} color="#ffffff" />
              <Text style={[pv.badgeTxt, { color: '#ffffff' }]}>シーズンベスト！</Text>
            </View>
          )}
        </View>
        <View style={pv.divider} />
        <View style={pv.metaList}>
          <View style={pv.metaRow}>
            <Ionicons name="calendar-outline" size={12} color="rgba(255,255,255,0.5)" />
            <Text style={pv.metaTxt}>{formatDateJP(record.race_date)}</Text>
          </View>
          {record.competition_name != null && (
            <View style={pv.metaRow}>
              <Ionicons name="flag-outline" size={12} color="rgba(255,255,255,0.5)" />
              <Text style={pv.metaTxt} numberOfLines={1}>{record.competition_name}</Text>
            </View>
          )}
          {record.wind_ms !== undefined && (
            <View style={pv.metaRow}>
              <Ionicons name="cloud-outline" size={12} color="rgba(255,255,255,0.5)" />
              <Text style={pv.metaTxt}>
                {record.wind_ms >= 0 ? '+' : ''}{record.wind_ms} m/s
              </Text>
            </View>
          )}
        </View>

        {/* ウォーターマーク — グラスブロック右下 */}
        <View style={pv.watermarkRow}>
          <Text style={pv.watermark}>sCORE</Text>
          <Text style={pv.watermarkSub}>アプリをダウンロード！</Text>
        </View>
      </View>
    </LinearGradient>
  )
}

// ── メインスクリーン ──────────────────────────────────────────────────────────
export default function ShareCardScreen() {
  const router = useRouter()
  const { recordId } = useLocalSearchParams<{ recordId?: string }>()

  const [records,   setRecords]   = useState<RaceRecord[]>([])
  const [selected,  setSelected]  = useState<RaceRecord | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const raw = await AsyncStorage.getItem(RECORDS_KEY)
        const all: RaceRecord[] = raw ? JSON.parse(raw) : []
        setRecords(all)
        if (all.length > 0) {
          const found = recordId ? all.find(r => r.id === recordId) : undefined
          setSelected(found ?? all.find(r => r.is_pb) ?? all[0])
        }
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    })()
  }, [recordId])

  const handleDownload = useCallback(async () => {
    if (!selected) return
    setExporting(true)
    try {
      exportOverlayPNG(selected)
      Toast.show({
        type: 'success',
        text1: '透過PNGをダウンロードしました',
        text2: 'インスタのストーリーで動画に重ねて使えます',
        visibilityTime: 2800,
      })
    } catch {
      Toast.show({ type: 'error', text1: 'ダウンロードに失敗しました' })
    } finally {
      setExporting(false)
    }
  }, [selected])

  const handleCopyText = useCallback(async () => {
    if (!selected) return
    const lines = [
      `${selected.event}  ${selected.result_display}`,
      selected.is_pb ? '🏆 自己ベスト更新！' : selected.is_sb ? '⭐ シーズンベスト！' : '',
      formatDateJP(selected.race_date),
      selected.competition_name ?? '',
      '',
      'scorej.run で記録管理',
    ].filter(Boolean).join('\n')

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(lines)
      }
      Toast.show({ type: 'success', text1: 'テキストをコピーしました', visibilityTime: 1800 })
    } catch {
      Toast.show({ type: 'error', text1: 'コピーに失敗しました' })
    }
  }, [selected])

  return (
    <View style={s.screen}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>

        {/* ヘッダー */}
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={26} color="rgba(255,255,255,0.75)" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>シェアカード</Text>
          <View style={{ width: 44 }} />
        </View>

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={BRAND} size="large" />
          </View>
        ) : records.length === 0 ? (
          <View style={s.center}>
            <Ionicons name="timer-outline" size={60} color="rgba(255,255,255,0.18)" />
            <Text style={s.emptyTitle}>記録がありません</Text>
            <Text style={s.emptySub}>「記録管理」タブで記録を追加してください</Text>
            <TouchableOpacity style={s.goBack} onPress={() => router.back()}>
              <Text style={s.goBackTxt}>戻る</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={s.scroll}
            showsVerticalScrollIndicator={false}
          >
            {/* プレビューヒント */}
            <View style={s.hintRow}>
              <Ionicons name="layers-outline" size={14} color={BRAND} />
              <Text style={s.hintTxt}>
                背景透過のPNGを書き出します — インスタのストーリーで動画の上に重ねて投稿できます
              </Text>
            </View>

            {/* カードプレビュー */}
            {selected != null && (
              <View style={s.previewWrap}>
                <OverlayPreview record={selected} />
                {/* サンプル背景の注記 */}
                <View style={s.sampleBadge}>
                  <Text style={s.sampleTxt}>サンプル背景</Text>
                </View>
              </View>
            )}

            {/* アクションボタン */}
            <View style={s.actions}>
              {Platform.OS === 'web' && (
                <TouchableOpacity
                  style={[s.dlBtn, exporting && { opacity: 0.6 }]}
                  onPress={handleDownload}
                  disabled={exporting || !selected}
                  activeOpacity={0.85}
                >
                  {exporting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Ionicons name="download-outline" size={20} color="#fff" />
                  }
                  <Text style={s.dlTxt}>
                    {exporting ? 'ダウンロード中...' : '透過PNGをダウンロード'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={s.copyBtn}
                onPress={handleCopyText}
                disabled={!selected}
                activeOpacity={0.8}
              >
                <Ionicons name="copy-outline" size={18} color="rgba(255,255,255,0.65)" />
                <Text style={s.copyTxt}>テキストをコピー</Text>
              </TouchableOpacity>
            </View>

            {/* 使い方ガイド */}
            <View style={s.guide}>
              {[
                { n: '1', t: 'PNGをダウンロード' },
                { n: '2', t: 'インスタでストーリーを開き、動画を背景に設定' },
                { n: '3', t: 'スタンプ追加 → 「ギャラリー」からPNGを選択' },
                { n: '4', t: '全画面に広げて投稿' },
              ].map(step => (
                <View key={step.n} style={s.guideRow}>
                  <View style={s.guideNum}>
                    <Text style={s.guideNumTxt}>{step.n}</Text>
                  </View>
                  <Text style={s.guideTxt}>{step.t}</Text>
                </View>
              ))}
            </View>

            {/* 記録セレクター */}
            <Text style={s.selectorLabel}>記録を選択</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.chips}
            >
              {records.map(r => (
                <TouchableOpacity
                  key={r.id}
                  style={[s.chip, selected?.id === r.id && s.chipActive]}
                  onPress={() => setSelected(r)}
                  activeOpacity={0.8}
                >
                  {r.is_pb && (
                    <View style={s.pbDot}>
                      <Text style={s.pbDotTxt}>自己ベスト</Text>
                    </View>
                  )}
                  <Text style={[s.chipEvent, selected?.id === r.id && { color: '#fff' }]}>
                    {r.event}
                  </Text>
                  <Text style={[s.chipResult, selected?.id === r.id && { color: '#fff' }]}>
                    {r.result_display}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  )
}

// ── プレビュースタイル ─────────────────────────────────────────────────────
const pv = StyleSheet.create({
  container: {
    aspectRatio: 9 / 16,
    borderRadius: 16,
    overflow: 'hidden',
    padding: 18,
    justifyContent: 'space-between',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  logoTxtS: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  logoTxtCore: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.2,
    textShadowColor: 'rgba(0,0,0,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  glass: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    padding: 20,
    gap: 8,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(20px)' } as any : {}),
  },
  event: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  result: {
    color: '#fff',
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -1,
    minWidth: 10,
    textShadowColor: 'rgba(0,0,0,0.95)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
    borderWidth: 1,
  },
  badgeTxt: {
    fontSize: 12,
    fontWeight: '800',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginVertical: 2,
  },
  metaList: {
    gap: 5,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaTxt: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    flex: 1,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  watermarkRow: {
    alignItems: 'flex-end',
    alignSelf: 'flex-end',
    gap: 1,
    marginTop: 4,
  },
  watermark: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  watermarkSub: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 9,
    textAlign: 'right',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
})

// ── スクリーンスタイル ─────────────────────────────────────────────────────
const s = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: '#080c12' },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  backBtn:     { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 },
  emptyTitle:  { color: '#fff', fontSize: 18, fontWeight: '700' },
  emptySub:    { color: 'rgba(255,255,255,0.45)', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  goBack:      { marginTop: 8, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  goBackTxt:   { color: BRAND, fontSize: 15, fontWeight: '700' },

  scroll:      { padding: 16, paddingBottom: 56, gap: 18 },

  hintRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: BRAND + '15', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: BRAND + '30' },
  hintTxt:     { color: 'rgba(255,255,255,0.65)', fontSize: 12, flex: 1, lineHeight: 18 },

  previewWrap: { maxWidth: 340, alignSelf: 'center', width: '100%', position: 'relative' },
  sampleBadge: { position: 'absolute', bottom: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  sampleTxt:   { color: 'rgba(255,255,255,0.55)', fontSize: 10 },

  actions:     { gap: 10 },
  dlBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: BRAND, borderRadius: 14, paddingVertical: 15 },
  dlTxt:       { color: '#fff', fontSize: 16, fontWeight: '700' },
  copyBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  copyTxt:     { color: 'rgba(255,255,255,0.65)', fontSize: 15, fontWeight: '600' },

  guide:       { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 16, gap: 12 },
  guideRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  guideNum:    { width: 24, height: 24, borderRadius: 12, backgroundColor: BRAND + '33', borderWidth: 1, borderColor: BRAND + '66', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  guideNumTxt: { color: BRAND, fontSize: 12, fontWeight: '800' },
  guideTxt:    { color: 'rgba(255,255,255,0.55)', fontSize: 13, flex: 1, lineHeight: 20 },

  selectorLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  chips:         { gap: 10, paddingBottom: 4 },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    minWidth: 90,
    alignItems: 'center',
    position: 'relative',
  },
  chipActive:  { backgroundColor: BRAND, borderColor: BRAND },
  chipEvent:   { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '600' },
  chipResult:  { color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 2 },
  pbDot:       { position: 'absolute', top: -6, right: -6, backgroundColor: '#34C759', borderRadius: 7, paddingHorizontal: 5, paddingVertical: 2 },
  pbDotTxt:    { color: '#000', fontSize: 8, fontWeight: '800' },
})

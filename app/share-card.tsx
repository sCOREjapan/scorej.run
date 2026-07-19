// app/share-card.tsx — シェアカード v4（DYNAMIC SPEED / 縦向き・横向きの透過PNG）
import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Platform, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { BRAND } from '../lib/theme'

// プレミアム機能(カードデザイン)のロック表示に使用。paywall.tsx のゴールドと統一。
const GOLD = '#d97706'
import Toast from 'react-native-toast-message'
import type { RaceRecord } from '../types'
// ネイティブ用
import { captureRef } from 'react-native-view-shot'
import * as MediaLibrary from 'expo-media-library'
import * as Sharing from 'expo-sharing'
import { grantShareBonus } from '../lib/adGate'
import { usePurchase } from '../context/PurchaseContext'

const RECORDS_KEY = 'trackmate_race_records'

function formatDateJP(s: string) {
  const [y, m, d] = s.split('-')
  return `${y}年${m}月${d}日`
}

/** hex (#rrggbb) → "r,g,b" string for rgba() */
function hexRgb(hex: string): string {
  return `${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)}`
}

/** hex (#rrggbb) + alpha → "rgba(r,g,b,a)" */
function hexA(hex: string, a: number): string {
  return `rgba(${hexRgb(hex)},${a})`
}

// ── カードテーマ定義 ──────────────────────────────────────────────────────────
const CARD_THEMES = [
  { id: 'ocean',    label: 'オーシャン',   colors: ['#0f2027', '#203a43', '#2c5364'] as const, dot: '#5bc8f5' },
  { id: 'fire',     label: 'ファイア',     colors: ['#1a0800', '#5c1a00', '#c0392b'] as const, dot: '#ff6b35' },
  { id: 'forest',   label: 'フォレスト',   colors: ['#001a0a', '#073d1f', '#145a32'] as const, dot: '#2ecc71' },
  { id: 'galaxy',   label: 'ギャラクシー', colors: ['#0d0019', '#1a0033', '#4a0080'] as const, dot: '#c39bd3' },
  { id: 'gold',     label: 'ゴールド',     colors: ['#1a1000', '#3d2800', '#7d5a00'] as const, dot: '#f1c40f' },
  { id: 'midnight', label: 'ミッドナイト', colors: ['#0a0a0a', '#1a1a2e', '#16213e'] as const, dot: '#a0a8c0' },
  { id: 'clear',    label: '透明',         colors: ['#1a1a1a', '#1a1a1a', '#1a1a1a'] as const, dot: '#ffffff' },
] as const
type ThemeId    = typeof CARD_THEMES[number]['id']
type CardVariant = 'card' | 'glass' | 'transparent'

// ── 共通 Canvas ユーティリティ ─────────────────────────────────────────────
function rrPath(
  c: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
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

// ── DYNAMIC SPEED: カード寸法 ───────────────────────────────────────────────
// 縦向き: 縦長感と「中身が詰まって見えること」の両立点。上ブロック(種目・記録・
//         バッジ)は上端から、下ブロック(区切り線・メタ・sCORE)は下端から積むため、
//         大会名や風速が無い記録でも構図が崩れない。
// 横向き: 高さが足りないので縦積みは不可能。左に記録、右にメタの2カラムにする。
export type CardOrientation = 'portrait' | 'landscape'
export const CARD_SIZE: Record<CardOrientation, { w: number; h: number }> = {
  portrait:  { w: 760,  h: 1000 },
  landscape: { w: 1008, h: 680 },
}
const CARD_R = 44

/** スピードライン — DYNAMIC SPEED の主役。斜めに走る速度の軌跡 */
function drawSpeedLines(
  c: CanvasRenderingContext2D,
  bx: number, by: number, bw: number, bh: number, rgb: string,
) {
  c.save()
  c.translate(bx + bw / 2, by + bh / 2)
  c.rotate(-0.38)                       // 約 -22度
  const L = Math.max(bw, bh) * 1.7
  // 細い線ほど濃く鋭く、太い線は薄く帯状に — 速度の軌跡のコントラストを作る
  const LINES = [
    { y: -540, w: 5,  a: 0.60, len: 0.85 },
    { y: -486, w: 2,  a: 0.45, len: 0.50 },
    { y: -330, w: 13, a: 0.20, len: 1.00 },
    { y: -268, w: 3,  a: 0.55, len: 0.38 },
    { y: -140, w: 6,  a: 0.22, len: 0.72 },
    { y:   54, w: 18, a: 0.15, len: 1.00 },
    { y:  128, w: 3,  a: 0.50, len: 0.46 },
    { y:  262, w: 7,  a: 0.28, len: 0.90 },
    { y:  404, w: 2,  a: 0.62, len: 0.34 },
    { y:  474, w: 11, a: 0.16, len: 0.68 },
  ]
  c.lineCap = 'round'
  for (const ln of LINES) {
    const half = (L * ln.len) / 2
    const g = c.createLinearGradient(-half, 0, half, 0)
    g.addColorStop(0,   `rgba(${rgb},0)`)
    g.addColorStop(0.5, `rgba(${rgb},${ln.a})`)
    g.addColorStop(1,   `rgba(${rgb},0)`)
    c.strokeStyle = g
    c.lineWidth = ln.w
    c.beginPath(); c.moveTo(-half, ln.y); c.lineTo(half, ln.y); c.stroke()
  }
  c.restore()
}

/** ドットグラデーション — 右上から減衰 */
function drawDots(
  c: CanvasRenderingContext2D,
  bx: number, by: number, bw: number, _bh: number, rgb: string,
) {
  const STEP = 24, COLS = 13, ROWS = 15
  const ox = bx + bw - 44, oy = by + 44
  for (let i = 0; i < COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      const a = 0.30 - Math.hypot(i, j) * 0.023
      if (a <= 0.006) continue
      c.fillStyle = `rgba(${rgb},${a})`
      c.beginPath(); c.arc(ox - i * STEP, oy + j * STEP, 2.6, 0, Math.PI * 2); c.fill()
    }
  }
}

/* ── メタ情報の簡易アイコン（Canvasにはフォントアイコンが無いためパスで描く） ── */
function icoCal(c: CanvasRenderingContext2D, x: number, y: number, s: number, col: string) {
  c.strokeStyle = col; c.lineWidth = 2.4; c.lineCap = 'round'
  rrPath(c, x, y + 5, s, s - 5, 4); c.stroke()
  c.beginPath(); c.moveTo(x, y + 13); c.lineTo(x + s, y + 13); c.stroke()
  c.beginPath(); c.moveTo(x + 7, y); c.lineTo(x + 7, y + 9); c.stroke()
  c.beginPath(); c.moveTo(x + s - 7, y); c.lineTo(x + s - 7, y + 9); c.stroke()
}
function icoFlag(c: CanvasRenderingContext2D, x: number, y: number, s: number, col: string) {
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2.4; c.lineCap = 'round'
  c.beginPath(); c.moveTo(x + 3, y); c.lineTo(x + 3, y + s); c.stroke()
  c.beginPath(); c.moveTo(x + 4, y + 2); c.lineTo(x + s - 1, y + 8); c.lineTo(x + 4, y + 14)
  c.closePath(); c.fill()
}
function icoWind(c: CanvasRenderingContext2D, x: number, y: number, s: number, col: string) {
  c.strokeStyle = col; c.lineWidth = 2.4; c.lineCap = 'round'
  const rows = [4, 12, 20]
  rows.forEach((dy, i) => {
    c.beginPath(); c.moveTo(x, y + dy); c.lineTo(x + s - (i === 1 ? 0 : 7), y + dy); c.stroke()
  })
}

/** メタ情報の行（日付は常に、大会名・風速は任意） */
function metaRows(record: RaceRecord): Array<{ ico: typeof icoCal; txt: string }> {
  const rows: Array<{ ico: typeof icoCal; txt: string }> = [
    { ico: icoCal, txt: formatDateJP(record.race_date) },
  ]
  if (record.competition_name) rows.push({ ico: icoFlag, txt: record.competition_name })
  if (record.wind_ms !== undefined) {
    rows.push({ ico: icoWind, txt: `wind ${record.wind_ms >= 0 ? '+' : ''}${record.wind_ms} m/s` })
  }
  return rows
}

/**
 * 無料版（完全透明・グラス）用の簡易描画。
 * DYNAMIC SPEED の背景・スピードライン・ドットは一切描かず、テキストのみを描画する。
 * glass=true のときだけ薄いガラス板を敷く。
 */
function drawPlainCard(
  c: CanvasRenderingContext2D,
  record: RaceRecord,
  W: number, H: number,
  orientation: CardOrientation,
  glass: boolean,
) {
  const { w: bw, h: bh } = CARD_SIZE[orientation]
  const bx = (W - bw) / 2
  const by = (H - bh) / 2
  const tx = bx + 64
  const isPB = record.is_pb
  const rows = metaRows(record)
  const sh = (blur: number, col: string, oy = 0) => { c.shadowColor = col; c.shadowBlur = blur; c.shadowOffsetY = oy }
  const ns = () => { c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0 }

  c.textBaseline = 'top'
  c.textAlign = 'left'

  if (glass) {
    c.save()
    c.fillStyle = 'rgba(255,255,255,0.08)'
    rrPath(c, bx, by, bw, bh, CARD_R); c.fill()
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1.5
    rrPath(c, bx, by, bw, bh, CARD_R); c.stroke()
    c.restore()
  }

  let y = by + 80
  sh(12, 'rgba(0,0,0,0.9)', 4)
  c.font = '700 40px system-ui, sans-serif'; c.fillStyle = '#ffffff'
  c.fillText(record.event, tx, y); ns()
  y += 40 + 80

  let fs = 200
  c.font = `800 ${fs}px system-ui, sans-serif`
  const maxTextW = bw - 128
  while (c.measureText(record.result_display).width > maxTextW && fs > 84) {
    fs -= 6; c.font = `800 ${fs}px system-ui, sans-serif`
  }
  sh(30, 'rgba(0,0,0,0.95)', 10); c.fillStyle = '#ffffff'
  c.fillText(record.result_display, tx, y); ns()
  y += fs + 60

  if (isPB || record.is_sb) {
    const label = isPB ? '★ 自己ベスト！' : '★ シーズンベスト！'
    c.font = '700 30px system-ui, sans-serif'
    const badgeW = c.measureText(label).width + 44
    sh(16, 'rgba(0,0,0,0.6)', 4)
    c.fillStyle = 'rgba(255,255,255,0.15)'
    rrPath(c, tx, y, badgeW, 60, 14); c.fill(); ns()
    c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 2
    rrPath(c, tx, y, badgeW, 60, 14); c.stroke()
    c.textBaseline = 'middle'; c.fillStyle = '#ffffff'
    c.fillText(label, tx + 22, y + 31)
    c.textBaseline = 'top'
    y += 60
  }

  const wmBaseline = by + bh - 64
  let my = wmBaseline - 72 - 26 - rows.length * 56
  for (const r of rows) {
    sh(10, 'rgba(0,0,0,0.85)', 3)
    c.save(); r.ico(c, tx, my + 3, 28, 'rgba(255,255,255,0.9)'); c.restore()
    c.font = '600 36px system-ui, sans-serif'
    c.fillStyle = 'rgba(255,255,255,0.88)'
    c.fillText(r.txt, tx + 48, my); ns()
    my += 56
  }

  c.textAlign = 'right'; c.textBaseline = 'alphabetic'
  sh(12, 'rgba(0,0,0,0.7)', 4)
  c.font = '900 72px system-ui, sans-serif'; c.fillStyle = 'rgba(255,255,255,0.70)'
  c.fillText('sCORE', bx + bw - 64, wmBaseline)
  ns(); c.textAlign = 'left'; c.textBaseline = 'top'
}

/**
 * カードをCanvasContextに描画（背景なし = 透過PNG）
 * DYNAMIC SPEED — スピードラインを主役にした縦向き / 横向きカード（広告なしプラン限定）
 * bgAlpha:     カード本体の不透明度（既定 0.80）
 * borderAlpha: 枠線の不透明度（既定 0.85）
 */
function drawCard(
  c: CanvasRenderingContext2D,
  record: RaceRecord,
  theme: typeof CARD_THEMES[number],
  W: number, H: number,
  orientation: CardOrientation = 'portrait',
  bgAlpha = 0.80,
  borderAlpha = 0.85,
) {
  const dotRgb = hexRgb(theme.dot)
  const sh = (blur: number, col: string, oy = 0) => { c.shadowColor = col; c.shadowBlur = blur; c.shadowOffsetY = oy }
  const ns = () => { c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0 }
  // letterSpacing は新しめのブラウザのみ。未対応でも無視されるだけなので安全。
  const ls = (v: string) => { try { (c as any).letterSpacing = v } catch { /* noop */ } }

  const { w: bw, h: bh } = CARD_SIZE[orientation]
  const bx = (W - bw) / 2
  const by = (H - bh) / 2
  const tx = bx + 64
  const isPB = record.is_pb
  const rows = metaRows(record)

  c.textBaseline = 'top'
  c.textAlign = 'left'

  // ── 落ち影 ──
  c.save()
  sh(90, 'rgba(0,0,0,0.55)', 28)
  c.fillStyle = 'rgba(0,0,0,0.92)'
  rrPath(c, bx, by, bw, bh, CARD_R); c.fill()
  c.restore()

  // ── カード内部（クリップして描画） ──
  c.save()
  rrPath(c, bx, by, bw, bh, CARD_R); c.clip()

  const g = c.createLinearGradient(bx, by, bx + bw, by + bh)
  g.addColorStop(0,    hexA(theme.colors[0], bgAlpha))
  g.addColorStop(0.55, hexA(theme.colors[1], bgAlpha))
  g.addColorStop(1,    hexA(theme.colors[2], bgAlpha))
  c.fillStyle = g
  c.fillRect(bx, by, bw, bh)

  drawSpeedLines(c, bx, by, bw, bh, dotRgb)
  drawDots(c, bx, by, bw, bh, dotRgb)
  c.restore()

  // ── 枠線（PBのときは外側グロー） ──
  if (isPB) {
    c.save()
    sh(60, `rgba(${dotRgb},0.95)`)
    c.strokeStyle = `rgba(${dotRgb},${borderAlpha})`
    c.lineWidth = 3
    rrPath(c, bx, by, bw, bh, CARD_R); c.stroke(); c.stroke()
    c.restore()
  }
  c.strokeStyle = `rgba(${dotRgb},${borderAlpha})`
  c.lineWidth = 3
  rrPath(c, bx, by, bw, bh, CARD_R); c.stroke()

  const iconCol = `rgba(${dotRgb},0.95)`

  /** 記録を指定幅に収まるまで縮小して描く。戻り値は実際に使ったフォントサイズ */
  const drawResult = (x: number, y: number, maxW: number, maxFs: number) => {
    ls('-2px')
    let fs = maxFs
    c.font = `800 ${fs}px system-ui, sans-serif`
    while (c.measureText(record.result_display).width > maxW && fs > 84) {
      fs -= 6
      c.font = `800 ${fs}px system-ui, sans-serif`
    }
    if (isPB) {                       // PB: 記録そのものを発光させる
      c.save()
      sh(46, `rgba(${dotRgb},0.9)`)
      c.fillStyle = '#ffffff'
      c.fillText(record.result_display, x, y)
      c.restore()
    }
    sh(30, 'rgba(0,0,0,0.95)', 10)
    c.fillStyle = '#ffffff'
    c.fillText(record.result_display, x, y)
    ns(); ls('0px')
    return fs
  }

  /** PB/SBバッジ。戻り値は描いた高さ（無ければ0） */
  const drawBadge = (x: number, y: number) => {
    if (!isPB && !record.is_sb) return 0
    const label = isPB ? '★ 自己ベスト！' : '★ シーズンベスト！'
    ls('1px')
    c.font = '700 30px system-ui, sans-serif'
    const badgeW = c.measureText(label).width + 44
    sh(16, 'rgba(0,0,0,0.6)', 4)
    c.fillStyle = 'rgba(255,255,255,0.15)'
    rrPath(c, x, y, badgeW, 60, 14); c.fill()
    ns()
    c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 2
    rrPath(c, x, y, badgeW, 60, 14); c.stroke()
    c.textBaseline = 'middle'
    c.fillStyle = '#ffffff'
    c.fillText(label, x + 22, y + 31)
    c.textBaseline = 'top'
    ls('0px')
    return 60
  }

  /** メタ情報を縦に積む */
  const drawMeta = (x: number, y: number, step: number, fontPx: number) => {
    let my = y
    for (const r of rows) {
      sh(10, 'rgba(0,0,0,0.85)', 3)
      c.save(); r.ico(c, x, my + 3, 28, iconCol); c.restore()
      ls('0.5px')
      c.font = `600 ${fontPx}px system-ui, sans-serif`
      c.fillStyle = 'rgba(255,255,255,0.88)'
      c.fillText(r.txt, x + 48, my)
      ns(); ls('0px')
      my += step
    }
  }

  /** sCORE ウォーターマーク（右下） */
  const drawMark = (baselineY: number, fontPx: number) => {
    ls('2px')
    c.textAlign = 'right'
    c.textBaseline = 'alphabetic'
    sh(12, 'rgba(0,0,0,0.7)', 4)
    c.font = `900 ${fontPx}px system-ui, sans-serif`
    c.fillStyle = 'rgba(255,255,255,0.70)'
    c.fillText('sCORE', bx + bw - 64, baselineY)
    ns()
    c.textAlign = 'left'
    c.textBaseline = 'top'
    ls('0px')
  }

  // ══════════════════════════════════════════════════════════════
  // 縦向き: 上ブロック(種目・記録・バッジ)は上端から、
  //         下ブロック(区切り線・メタ・sCORE)は下端から積む
  // ══════════════════════════════════════════════════════════════
  if (orientation === 'portrait') {
    let y = by + 80

    sh(12, 'rgba(0,0,0,0.9)', 4)
    ls('1.5px')
    c.font = '700 40px system-ui, sans-serif'
    c.fillStyle = '#ffffff'
    c.fillText(record.event, tx, y)
    ns(); ls('0px')
    y += 40 + 80

    y += drawResult(tx, y, bw - 128, 200) + 60
    const bh2 = drawBadge(tx, y)
    y += bh2

    const wmBaseline = by + bh - 64
    const metaBottom = wmBaseline - 72 - 26
    let my = metaBottom - rows.length * 56
    const sepY = my - 34
    // 上ブロックと重なる場合のみ、下ブロックを押し下げて衝突を防ぐ
    const shift = Math.max(0, y + 40 - sepY)

    c.strokeStyle = `rgba(${dotRgb},0.45)`; c.lineWidth = 2
    c.beginPath(); c.moveTo(tx, sepY + shift); c.lineTo(bx + bw - 64, sepY + shift); c.stroke()

    drawMeta(tx, my + shift, 56, 36)
    drawMark(wmBaseline + shift, 72)
    return
  }

  // ══════════════════════════════════════════════════════════════
  // 横向き: 高さ680に縦積みは入らないので2カラム。
  //         左＝種目・記録・バッジ / 右＝縦線・メタ・sCORE
  // ══════════════════════════════════════════════════════════════
  const COL_X   = bx + 660          // 左右を分ける縦線
  const RIGHT_X = bx + 700          // 右カラムの内容
  const leftW   = COL_X - 40 - tx   // 左カラムで使える幅

  // 左カラム（種目・記録・バッジを縦に中央寄せ）
  const fsProbe = (() => {
    ls('-2px')
    let fs = 176
    c.font = `800 ${fs}px system-ui, sans-serif`
    while (c.measureText(record.result_display).width > leftW && fs > 84) {
      fs -= 6; c.font = `800 ${fs}px system-ui, sans-serif`
    }
    ls('0px')
    return fs
  })()
  const hasBadge  = isPB || record.is_sb
  const leftH     = 40 + 30 + fsProbe + (hasBadge ? 36 + 60 : 0)
  let ly          = by + (bh - leftH) / 2

  sh(12, 'rgba(0,0,0,0.9)', 4)
  ls('1.5px')
  c.font = '700 40px system-ui, sans-serif'
  c.fillStyle = '#ffffff'
  c.fillText(record.event, tx, ly)
  ns(); ls('0px')
  ly += 40 + 30

  ly += drawResult(tx, ly, leftW, 176)
  if (hasBadge) { ly += 36; drawBadge(tx, ly) }

  // 区切りの縦線
  c.strokeStyle = `rgba(${dotRgb},0.45)`; c.lineWidth = 2
  c.beginPath(); c.moveTo(COL_X, by + 72); c.lineTo(COL_X, by + bh - 72); c.stroke()

  // 右カラム（メタを縦中央、sCOREは右下）
  drawMeta(RIGHT_X, by + (bh - rows.length * 52) / 2 - 30, 52, 32)
  drawMark(by + bh - 56, 60)
}

// ── PNG Export — カードのみ、背景完全透過 ────────────────────────────────────
function exportOverlayPNG(
  record: RaceRecord, themeId: ThemeId, orientation: CardOrientation,
  variant: CardVariant, isNoad: boolean,
) {
  if (typeof document === 'undefined') return
  const W = 1080, H = 1920
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const c = cv.getContext('2d')!
  // 背景は一切塗らない → 完全透過
  // 「カード」(DYNAMIC SPEED)は広告なしプラン限定。未課金なら強制的に完全透明にフォールバックする
  // （UIの選択肢は既に制限しているが、Web書き出しはここでも二重に防御する）
  if (variant === 'card' && isNoad) {
    const theme = CARD_THEMES.find(t => t.id === themeId) ?? CARD_THEMES[0]
    drawCard(c, record, theme, W, H, orientation, 0.80, 0.85)
  } else {
    drawPlainCard(c, record, W, H, orientation, variant === 'glass')
  }
  const a = document.createElement('a')
  a.download = `score-${record.event.replace(/[^a-z0-9]/gi, '')}-${orientation}.png`
  a.href = cv.toDataURL('image/png'); a.click()
}

// ── プレビューコンポーネント（DYNAMIC SPEED） ────────────────────────────────
// ネイティブ(iOS)の書き出しは Canvas ではなく captureRef でこの View を撮影するため、
// Canvas 側の drawCard と同じ見た目になるよう縮尺 0.315 で合わせている。

/** スピードライン — DYNAMIC SPEED の主役 */
function SpeedLines({ color }: { color: string }) {
  const LINES = [
    { top: '4%',  left: '-12%', w: '92%',  h: 1.6, o: 0.60 },
    { top: '9%',  left: '18%',  w: '55%',  h: 1,   o: 0.45 },
    { top: '22%', left: '-22%', w: '120%', h: 4,   o: 0.20 },
    { top: '28%', left: '30%',  w: '40%',  h: 1,   o: 0.55 },
    { top: '40%', left: '-10%', w: '80%',  h: 1.9, o: 0.22 },
    { top: '58%', left: '-25%', w: '125%', h: 5.7, o: 0.15 },
    { top: '64%', left: '25%',  w: '48%',  h: 1,   o: 0.50 },
    { top: '76%', left: '-8%',  w: '95%',  h: 2.2, o: 0.28 },
    { top: '88%', left: '40%',  w: '36%',  h: 1,   o: 0.62 },
    { top: '94%', left: '-14%', w: '72%',  h: 3.5, o: 0.16 },
  ]
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {LINES.map((l, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            top: l.top as any, left: l.left as any,
            width: l.w as any, height: l.h,
            borderRadius: l.h / 2,
            backgroundColor: color,
            opacity: l.o,
            transform: [{ rotate: '-22deg' }],
          }}
        />
      ))}
    </View>
  )
}

/** ドットグラデーション — 右上から減衰 */
function DotGrid({ color }: { color: string }) {
  const COLS = 7, ROWS = 9, STEP = 7
  const dots: React.ReactNode[] = []
  for (let i = 0; i < COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      const a = 0.30 - Math.hypot(i, j) * 0.038
      if (a <= 0.02) continue
      dots.push(
        <View key={`${i}-${j}`} style={{
          position: 'absolute', right: i * STEP, top: j * STEP,
          width: 1.8, height: 1.8, borderRadius: 1,
          backgroundColor: color, opacity: a,
        }} />
      )
    }
  }
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 10, right: 10, width: COLS * STEP, height: ROWS * STEP }}>
      {dots}
    </View>
  )
}

/** 種目・記録・バッジ（両向き共通のヒーロー部分） */
function HeroBlock({ record, accent, land }: { record: RaceRecord; accent: string; land?: boolean }) {
  const isPB = record.is_pb
  return (
    <>
      <Text style={pv.event}>{record.event}</Text>
      <Text
        style={[
          pv.result,
          land && pv.resultLand,
          isPB && { textShadowColor: accent, textShadowRadius: 14 },
        ]}
        adjustsFontSizeToFit
        numberOfLines={1}
      >
        {record.result_display}
      </Text>
      {(isPB || record.is_sb) && (
        <View style={[pv.badgeRow, land && { marginTop: 11 }]}>
          <View style={pv.badge}>
            <Ionicons name={isPB ? 'trophy' : 'star'} size={10} color="#ffffff" />
            <Text style={pv.badgeTxt}>{isPB ? '自己ベスト！' : 'シーズンベスト！'}</Text>
          </View>
        </View>
      )}
    </>
  )
}

/** メタ情報（日付・大会名・風速） */
function MetaList({ record, accent, land }: { record: RaceRecord; accent: string; land?: boolean }) {
  return (
    <View style={pv.metaList}>
      <View style={pv.metaRow}>
        <Ionicons name="calendar-outline" size={11} color={accent} />
        <Text style={[pv.metaTxt, land && pv.metaTxtLand]}>{formatDateJP(record.race_date)}</Text>
      </View>
      {record.competition_name != null && (
        <View style={pv.metaRow}>
          <Ionicons name="flag-outline" size={11} color={accent} />
          <Text style={[pv.metaTxt, land && pv.metaTxtLand]} numberOfLines={1}>{record.competition_name}</Text>
        </View>
      )}
      {record.wind_ms !== undefined && (
        <View style={pv.metaRow}>
          <Ionicons name="cloud-outline" size={11} color={accent} />
          <Text style={[pv.metaTxt, land && pv.metaTxtLand]}>
            wind {record.wind_ms >= 0 ? '+' : ''}{record.wind_ms} m/s
          </Text>
        </View>
      )}
    </View>
  )
}

/** 縦向き: 上にヒーロー、下端に区切り線＋メタ＋sCORE */
function CardContent({ record, accent }: { record: RaceRecord; accent: string }) {
  return (
    <>
      <HeroBlock record={record} accent={accent} />
      {/* 余白は中央に集め、区切り線から下はカード下端に寄せる */}
      <View style={{ flex: 1, minHeight: 12 }} />
      <View style={[pv.divider, { backgroundColor: accent, opacity: 0.45 }]} />
      <MetaList record={record} accent={accent} />
      <Text style={pv.wmScore}>sCORE</Text>
    </>
  )
}

/** 横向き: 高さが足りないので2カラム（左＝記録 / 右＝メタ・sCORE） */
function CardContentLandscape({ record, accent }: { record: RaceRecord; accent: string }) {
  return (
    <View style={pv.landRow}>
      <View style={pv.landLeft}>
        <HeroBlock record={record} accent={accent} land />
      </View>
      <View style={[pv.landDivider, { backgroundColor: accent, opacity: 0.45 }]} />
      <View style={pv.landRight}>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <MetaList record={record} accent={accent} land />
        </View>
        <Text style={[pv.wmScore, pv.wmScoreLand]}>sCORE</Text>
      </View>
    </View>
  )
}

function OverlayPreview({ record, themeId, variant, orientation }: {
  record: RaceRecord; themeId: ThemeId; variant: CardVariant; orientation: CardOrientation
}) {
  const theme = CARD_THEMES.find(t => t.id === themeId) ?? CARD_THEMES[0]
  const isPB  = record.is_pb
  const land  = orientation === 'landscape'

  // カード寸法（Canvas 側 CARD_SIZE と同じ比率・位置）
  const box = land
    ? { width: '93.3%' as const, aspectRatio: CARD_SIZE.landscape.w / CARD_SIZE.landscape.h }
    : { width: '70.4%' as const, aspectRatio: CARD_SIZE.portrait.w  / CARD_SIZE.portrait.h  }

  const Content = land
    ? <CardContentLandscape record={record} accent={variant === 'card' ? theme.dot : '#ffffff'} />
    : <CardContent          record={record} accent={variant === 'card' ? theme.dot : '#ffffff'} />

  // ── バリアント: 完全透明（カード枠なし・テキストのみ）
  if (variant === 'transparent') {
    return (
      <View style={pv.stage}>
        <View style={[pv.plain, box]}>{Content}</View>
      </View>
    )
  }

  // ── バリアント: グラス（白の半透明）
  if (variant === 'glass') {
    return (
      <View style={pv.stage}>
        <View style={[pv.shadowWrap, box]}>
          <View style={[pv.card, land && pv.cardLand, { backgroundColor: 'rgba(255,255,255,0.10)', borderColor: 'rgba(255,255,255,0.55)' }]}>
            <SpeedLines color="#ffffff" />
            {Content}
          </View>
        </View>
      </View>
    )
  }

  // ── バリアント: カード（DYNAMIC SPEED・デフォルト）
  return (
    <View style={pv.stage}>
      <View style={[
        pv.shadowWrap, box,
        isPB && { shadowColor: theme.dot, shadowOpacity: 0.9, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } },
      ]}>
        <View style={[pv.card, land && pv.cardLand, { borderColor: theme.dot }]}>
          <LinearGradient
            colors={theme.colors as unknown as [string, string, ...string[]]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <SpeedLines color={theme.dot} />
          <DotGrid color={theme.dot} />
          {Content}
        </View>
      </View>
    </View>
  )
}

// ── メインスクリーン ──────────────────────────────────────────────────────────
export default function ShareCardScreen() {
  const router = useRouter()
  const { recordId } = useLocalSearchParams<{ recordId?: string }>()
  const { isNoad } = usePurchase()

  const [records,     setRecords]     = useState<RaceRecord[]>([])
  const [selected,    setSelected]    = useState<RaceRecord | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [exporting,   setExporting]   = useState(false)
  const [themeId,     setThemeId]     = useState<ThemeId>('ocean')
  const [orientation, setOrientation] = useState<CardOrientation>('portrait')
  // 「カード」(DYNAMIC SPEEDデザイン)の保存・シェアは広告なしプラン限定だが、
  // プレビューは誰でも見られるようにする（見せずに売ると転換しないため）。
  // そのためデフォルトも一番魅力的な「カード」から見せる。
  const [cardVariant, setCardVariant] = useState<CardVariant>('card')
  const previewRef = useRef<View>(null)

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
    // 「カード」(DYNAMIC SPEED)は広告なしプラン限定。プレビューはさせるが保存はここで止める。
    if (cardVariant === 'card' && !isNoad) {
      router.push('/paywall?plan=noad')
      return
    }
    setExporting(true)
    try {
      exportOverlayPNG(selected, themeId, orientation, cardVariant, isNoad)
      Toast.show({
        type: 'success',
        text1: '透過PNGをダウンロードしました',
        text2: 'インスタのストーリーで動画の上に重ねて使えます',
        visibilityTime: 2800,
      })
    } catch {
      Toast.show({ type: 'error', text1: 'ダウンロードに失敗しました' })
    } finally {
      setExporting(false)
    }
  }, [selected, themeId, orientation, cardVariant, isNoad, router])

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

  // ── ネイティブ: カメラロールに保存 ─────────────────────────────
  const handleNativeSave = useCallback(async () => {
    if (!previewRef.current) return
    if (cardVariant === 'card' && !isNoad) {
      router.push('/paywall?plan=noad')
      return
    }
    setExporting(true)
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync()
      if (status !== 'granted') {
        Toast.show({ type: 'error', text1: '写真ライブラリへのアクセスを許可してください' })
        return
      }
      // グラス・透明バリアントは transparent:true で背景透過PNG を保存
      const isTransparentVariant = cardVariant === 'glass' || cardVariant === 'transparent'
      const uri = await captureRef(previewRef, {
        format: 'png',
        quality: 1,
        ...(isTransparentVariant ? { transparent: true } as any : {}),
      })
      await MediaLibrary.saveToLibraryAsync(uri)
      const msg = isTransparentVariant
        ? '背景透過PNGを保存しました 📸'
        : 'カメラロールに保存しました 📸'
      Toast.show({ type: 'success', text1: msg, visibilityTime: 2000 })
    } catch {
      Toast.show({ type: 'error', text1: '保存に失敗しました' })
    } finally {
      setExporting(false)
    }
  }, [cardVariant, isNoad, router])

  // ── シェアして動画分析1回無料 ─────────────────────────────────
  const handleShare = useCallback(async () => {
    if (!previewRef.current) return
    if (cardVariant === 'card' && !isNoad) {
      router.push('/paywall?plan=noad')
      return
    }
    if (!(await Sharing.isAvailableAsync())) {
      Toast.show({ type: 'error', text1: 'この端末ではシェアできません' })
      return
    }
    setExporting(true)
    try {
      const isTransparentVariant = cardVariant === 'glass' || cardVariant === 'transparent'
      const uri = await captureRef(previewRef, {
        format: 'png',
        quality: 1,
        ...(isTransparentVariant ? { transparent: true } as any : {}),
      })
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'シェアカードを投稿' })
      // シェアシートを開いた段階でボーナス付与（iOSは実投稿を検知できないため）
      const r = await grantShareBonus('video')
      if (r.granted) {
        Toast.show({ type: 'success', text1: '🎁 動画分析1回無料を獲得！', text2: '次の動画分析が広告なしで使えます', visibilityTime: 2600 })
      } else if (r.atCap) {
        Toast.show({ type: 'info', text1: 'シェアありがとう！', text2: '無料獲得は1日1回までです', visibilityTime: 2400 })
      }
    } catch {
      // ユーザーがシェアをキャンセルした場合も含む（エラー表示は出さない）
    } finally {
      setExporting(false)
    }
  }, [cardVariant, isNoad, router])

  return (
    <View style={s.screen}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>

        {/* ヘッダー */}
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}>
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
            <TouchableOpacity style={s.goBack} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}>
              <Text style={s.goBackTxt}>戻る</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

            {/* 縦向き / 横向き 切替 */}
            <View style={s.modeToggle}>
              {([
                { id: 'portrait',  label: '縦向き', icon: 'phone-portrait-outline' },
                { id: 'landscape', label: '横向き', icon: 'phone-landscape-outline' },
              ] as const).map(o => {
                const active = orientation === o.id
                return (
                  <TouchableOpacity
                    key={o.id}
                    style={[s.modeBtn, active && s.modeBtnActive]}
                    onPress={() => setOrientation(o.id)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name={o.icon} size={15} color={active ? '#fff' : 'rgba(255,255,255,0.45)'} />
                    <Text style={[s.modeTxt, active && { color: '#fff' }]}>{o.label}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            {/* ヒント */}
            <View style={s.hintRow}>
              <Ionicons name="layers-outline" size={14} color={BRAND} />
              <Text style={s.hintTxt}>
                背景透過のPNGを書き出します — インスタのストーリーで動画の上に重ねて投稿できます
              </Text>
            </View>

            {/* カードスタイル選択 — 誰でも自由に選んでプレビューできる。
                保存/シェア時にのみ課金チェックする（見せずに売る、を避けるため） */}
            <View style={{ gap: 8 }}>
              <Text style={s.selectorLabel}>カードスタイル</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([
                  { id: 'card',        label: 'カード',   icon: 'color-palette-outline',  desc: 'テーマカラー', premium: true },
                  { id: 'glass',       label: 'グラス',   icon: 'square-outline',          desc: '透明ガラス',   premium: false },
                  { id: 'transparent', label: '完全透明', icon: 'contrast-outline',        desc: 'テキストのみ', premium: false },
                ] as const).map(v => {
                  const active = cardVariant === v.id
                  const showBadge = v.premium && !isNoad
                  return (
                    <TouchableOpacity
                      key={v.id}
                      onPress={() => setCardVariant(v.id)}
                      activeOpacity={0.8}
                      style={{
                        flex: 1, alignItems: 'center', gap: 4,
                        paddingVertical: 10, borderRadius: 12,
                        borderWidth: active ? 1.5 : 1,
                        borderColor: active ? BRAND : (showBadge ? GOLD + '55' : 'rgba(255,255,255,0.1)'),
                        backgroundColor: active ? BRAND + '22' : 'rgba(255,255,255,0.05)',
                      }}
                    >
                      {showBadge && (
                        <View style={{ position: 'absolute', top: 6, right: 6, backgroundColor: GOLD, borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1 }}>
                          <Text style={{ color: '#000', fontSize: 8, fontWeight: '800' }}>PRO</Text>
                        </View>
                      )}
                      <Ionicons name={v.icon} size={18} color={active ? BRAND : showBadge ? GOLD : 'rgba(255,255,255,0.4)'} />
                      <Text style={{ color: active ? BRAND : showBadge ? GOLD : 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: active ? '800' : '500' }}>{v.label}</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9 }}>{v.desc}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>

            {/* カードプレビュー */}
            {selected != null && (
              <View style={s.previewWrap} ref={previewRef} collapsable={false}>
                <OverlayPreview record={selected} themeId={themeId} variant={cardVariant} orientation={orientation} />
              </View>
            )}

            {/* テーマ選択（カードスタイルのみ表示） */}
            {cardVariant === 'card' && (
            <View style={{ gap: 8 }}>
              <Text style={s.selectorLabel}>背景テーマ</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
                {CARD_THEMES.map(t => {
                  const active = t.id === themeId
                  return (
                    <TouchableOpacity
                      key={t.id}
                      onPress={() => setThemeId(t.id)}
                      activeOpacity={0.8}
                      style={{
                        alignItems: 'center', gap: 5,
                        paddingHorizontal: 10, paddingVertical: 7,
                        borderRadius: 12,
                        borderWidth: active ? 1.5 : 1,
                        borderColor: active ? t.dot : 'rgba(255,255,255,0.1)',
                        backgroundColor: active ? t.dot + '22' : 'rgba(255,255,255,0.05)',
                      }}
                    >
                      <LinearGradient
                        colors={t.colors as unknown as [string, string, ...string[]]}
                        style={{ width: 36, height: 36, borderRadius: 10 }}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      />
                      <Text style={{ color: active ? t.dot : 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: active ? '800' : '500' }}>
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>
            </View>
            )}

            {/* アクションボタン */}
            {(() => {
              const isLocked = cardVariant === 'card' && !isNoad
              return (
            <View style={s.actions}>
              {Platform.OS === 'web' ? (
                <TouchableOpacity
                  style={[s.dlBtn, isLocked && { backgroundColor: GOLD }, exporting && { opacity: 0.6 }]}
                  onPress={handleDownload}
                  disabled={exporting || !selected}
                  activeOpacity={0.85}
                >
                  {exporting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Ionicons name={isLocked ? 'lock-open-outline' : 'download-outline'} size={20} color="#fff" />
                  }
                  <Text style={s.dlTxt}>
                    {exporting ? 'ダウンロード中...' : isLocked ? 'アンロックして保存' : '透過PNGをダウンロード'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[s.dlBtn, isLocked && { backgroundColor: GOLD }, exporting && { opacity: 0.6 }]}
                  onPress={handleNativeSave}
                  disabled={exporting || !selected}
                  activeOpacity={0.85}
                >
                  {exporting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Ionicons name={isLocked ? 'lock-open-outline' : 'download-outline'} size={20} color="#fff" />
                  }
                  <Text style={s.dlTxt}>{exporting ? '保存中...' : isLocked ? 'アンロックして保存' : 'カメラロールに保存'}</Text>
                </TouchableOpacity>
              )}
              {Platform.OS !== 'web' && (
                <TouchableOpacity
                  style={[s.shareBtn, isLocked && { backgroundColor: GOLD }, exporting && { opacity: 0.6 }]}
                  onPress={handleShare}
                  disabled={exporting || !selected}
                  activeOpacity={0.85}
                >
                  <Ionicons name={isLocked ? 'lock-open-outline' : 'share-social-outline'} size={19} color={isLocked ? '#fff' : '#063'} />
                  <Text style={[s.shareTxt, isLocked && { color: '#fff' }]}>
                    {isLocked ? 'アンロックしてシェア' : 'シェアして動画分析1回無料 🎁'}
                  </Text>
                </TouchableOpacity>
              )}
              {isLocked && (
                <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, textAlign: 'center', marginTop: -2 }}>
                  このデザインの保存・シェアには広告なしプランが必要です
                </Text>
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
              )
            })()}

            {/* 使い方ガイド */}
            <View style={s.guide}>
              {[
                { n: '1', t: Platform.OS === 'web' ? 'PNGをダウンロード' : 'カメラロールに保存' },
                { n: '2', t: 'インスタでストーリーを開き、動画を背景に設定' },
                { n: '3', t: 'スタンプ追加 → 「ギャラリー」からPNGを選択' },
                { n: '4', t: '好きな位置・大きさに調整して投稿' },
              ].map(step => (
                <View key={step.n} style={s.guideRow}>
                  <View style={s.guideNum}><Text style={s.guideNumTxt}>{step.n}</Text></View>
                  <Text style={s.guideTxt}>{step.t}</Text>
                </View>
              ))}
            </View>

            {/* 記録セレクター */}
            <Text style={s.selectorLabel}>記録を選択</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              {records.map(r => (
                <TouchableOpacity
                  key={r.id}
                  style={[s.chip, selected?.id === r.id && s.chipActive]}
                  onPress={() => setSelected(r)}
                  activeOpacity={0.8}
                >
                  {r.is_pb && (
                    <View style={s.pbDot}><Text style={s.pbDotTxt}>自己ベスト</Text></View>
                  )}
                  <Text style={[s.chipEvent, selected?.id === r.id && { color: '#fff' }]}>{r.event}</Text>
                  <Text style={[s.chipResult, selected?.id === r.id && { color: '#fff' }]}>{r.result_display}</Text>
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
// Canvas(1080×1920 / カード880×1240) を 0.315 倍した縮尺で合わせている
const pv = StyleSheet.create({
  // 9:16 のステージ。カードはこの中央に浮き、上下に背景動画が見える
  stage: {
    aspectRatio: 9 / 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 影・グロー担当（overflow:hidden と同居させると影が消えるため親子で分離）
  // width / aspectRatio は向きに応じて OverlayPreview から渡す
  shadowWrap: {
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  card: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: 'hidden',        // スピードラインを角丸で切り抜く
    paddingHorizontal: 20,     // 64 * 0.315
    paddingTop: 25,            // 80 * 0.315
    paddingBottom: 20,
  },
  // 完全透明バリアント（カード枠なし・テキストのみ）
  plain: {
    paddingHorizontal: 20,
    paddingTop: 25,
    paddingBottom: 20,
  },
  // ── 横向き（2カラム） ──
  cardLand: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 18 },
  landRow:  { flex: 1, flexDirection: 'row' },
  landLeft: { flex: 1, justifyContent: 'center', paddingRight: 12 },
  landDivider: { width: 1, marginVertical: 3 },
  landRight: { width: 97, paddingLeft: 13 },
  event: {
    color: '#ffffff', fontSize: 13, fontWeight: '700', letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  result: {
    color: '#ffffff', fontSize: 63, fontWeight: '800', letterSpacing: -0.6,
    minWidth: 10, marginTop: 25,
    textShadowColor: 'rgba(0,0,0,0.95)',
    textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 10,
  },
  badgeRow: { flexDirection: 'row', marginTop: 19 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 19, paddingHorizontal: 7, borderRadius: 4.5,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderColor: 'rgba(255,255,255,0.6)',
  },
  badgeTxt: { color: '#ffffff', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  divider:  { height: 1, marginTop: 13, marginBottom: 17 },
  metaList: { gap: 6 },
  metaRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaTxt: {
    color: 'rgba(255,255,255,0.88)', fontSize: 11, fontWeight: '600', flex: 1,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  metaTxtLand:  { fontSize: 10 },
  resultLand:   { fontSize: 55, marginTop: 9 },
  wmScoreLand:  { fontSize: 19, marginTop: 0 },
  wmScore: {
    color: 'rgba(255,255,255,0.70)', fontSize: 23, fontWeight: '900',
    letterSpacing: 0.6, textAlign: 'right', marginTop: 8,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
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

  scroll: { padding: 16, paddingBottom: 56, gap: 18 },

  modeToggle:    { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, padding: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  modeBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  modeBtnActive: { backgroundColor: BRAND },
  modeTxt:       { color: 'rgba(255,255,255,0.45)', fontSize: 13, fontWeight: '700' },

  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: BRAND + '15', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: BRAND + '30' },
  hintTxt: { color: 'rgba(255,255,255,0.65)', fontSize: 12, flex: 1, lineHeight: 18 },

  previewWrap: { maxWidth: 340, alignSelf: 'center', width: '100%', backgroundColor: 'transparent' },

  actions:  { gap: 10 },
  dlBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: BRAND, borderRadius: 14, paddingVertical: 15 },
  dlTxt:    { color: '#fff', fontSize: 16, fontWeight: '700' },
  copyBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  copyTxt:  { color: 'rgba(255,255,255,0.65)', fontSize: 15, fontWeight: '600' },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#5DCAA5', borderRadius: 14, paddingVertical: 15, marginTop: 10 },
  shareTxt: { color: '#063', fontSize: 15, fontWeight: '700' },

  guide:       { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 16, gap: 12 },
  guideRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  guideNum:    { width: 24, height: 24, borderRadius: 12, backgroundColor: BRAND + '33', borderWidth: 1, borderColor: BRAND + '66', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  guideNumTxt: { color: BRAND, fontSize: 12, fontWeight: '800' },
  guideTxt:    { color: 'rgba(255,255,255,0.55)', fontSize: 13, flex: 1, lineHeight: 20 },

  selectorLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  chips: { gap: 10, paddingBottom: 4 },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
    minWidth: 90, alignItems: 'center', position: 'relative',
  },
  chipActive:  { backgroundColor: BRAND, borderColor: BRAND },
  chipEvent:   { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '600' },
  chipResult:  { color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 2 },
  pbDot:       { position: 'absolute', top: -6, right: -6, backgroundColor: '#34C759', borderRadius: 7, paddingHorizontal: 5, paddingVertical: 2 },
  pbDotTxt:    { color: '#000', fontSize: 8, fontWeight: '800' },
})

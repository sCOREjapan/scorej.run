// lib/theme.ts — TrackMate デザインシステム（仕様書 v1.0 準拠）
// カラーパレットはメシトラ競合分析に基づくアンバー系に統一

// ── ブランドカラー ────────────────────────────────────────
export const BRAND = '#E53935'   // TrackMate レッド（CTAボタン・強調）

// ── 背景 ─────────────────────────────────────────────────
/** 全画面背景色 */
export const BG_GRADIENT = ['#111111', '#111111', '#111111'] as const

// ── サーフェス ────────────────────────────────────────────
/** カード・モーダル背景 */
export const SURFACE  = '#1a1a1a'
/** アイコン背景・入力欄 */
export const SURFACE2 = '#252525'
/** 区切り線 */
export const DIVIDER  = 'rgba(255,255,255,0.08)'

// ── テキスト ──────────────────────────────────────────────
export const TEXT = {
  primary:   '#FFFFFF',
  secondary: '#888888',
  hint:      '#555555',
} as const

// ── 機能的カラー（最小限） ────────────────────────────────
/** 状態表示にのみ使用 */
export const NEON = {
  blue:    '#4A9FFF',
  purple:  '#9B6BFF',
  cyan:    '#00D4FF',
  pink:    '#FF4FC8',
  green:   '#34C759',
  amber:   '#F5A623',
  success: '#4ECDC4',
  danger:  '#FF6B6B',
} as const

// ── カード ────────────────────────────────────────────────
/** GlassCard 用互換トークン */
export const GLASS = {
  backgroundColor: '#111111',
  borderRadius: 12,
} as const

export const BLUR_INTENSITY = 0

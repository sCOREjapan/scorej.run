// lib/theme.ts — TrackMate デザインシステム（W3 Soft Grey × Red）

// ── ブランドカラー ────────────────────────────────────────
export const BRAND = '#166534'   // TrackMate ディープグリーン（CTAボタン・強調）
export const ALERT = '#E53935'   // アラートレッド（高リスク・危険表示のみ）

// ── 背景 ─────────────────────────────────────────────────
/** 全画面背景色 */
export const BG_GRADIENT = ['#f6f6f8', '#f6f6f8', '#f6f6f8'] as const

// ── サーフェス ────────────────────────────────────────────
/** カード・モーダル背景 */
export const SURFACE  = '#ffffff'
/** アイコン背景・入力欄 */
export const SURFACE2 = '#f0f2f5'
/** 区切り線 */
export const DIVIDER  = 'rgba(0,0,0,0.07)'

// ── テキスト ──────────────────────────────────────────────
export const TEXT = {
  primary:   '#111827',
  secondary: '#6b7280',
  hint:      '#9ca3af',
} as const

// ── 機能的カラー（最小限） ────────────────────────────────
/** 状態表示にのみ使用 */
export const NEON = {
  blue:    '#3b82f6',
  purple:  '#8b5cf6',
  cyan:    '#06b6d4',
  pink:    '#ec4899',
  green:   '#22c55e',
  amber:   '#f59e0b',
  success: '#14b8a6',
  danger:  '#ef4444',
} as const

// ── カード ────────────────────────────────────────────────
/** GlassCard 用互換トークン */
export const GLASS = {
  backgroundColor: '#ffffff',
  borderRadius: 14,
} as const

export const BLUR_INTENSITY = 0

// ── ボタンスタイルプリセット（競合アプリ課金UIに合わせたピル型） ──
export const BTN = {
  /** 主要アクション：ブラックピル */
  primary: {
    backgroundColor: '#1c1c1e',
    borderRadius: 50,
    paddingVertical: 17,
    alignItems:      'center'  as const,
    justifyContent:  'center'  as const,
    flexDirection:   'row'     as const,
    gap:             8,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.18,
    shadowRadius:    12,
    elevation:       5,
  },
  primaryText: {
    color:         '#fff',
    fontSize:      16,
    fontWeight:    '800' as const,
    letterSpacing: -0.3,
  },
  /** セカンダリ：アウトライン */
  secondary: {
    borderWidth:    1.5,
    borderColor:    '#1c1c1e',
    borderRadius:   50,
    paddingVertical:16,
    alignItems:     'center' as const,
    justifyContent: 'center' as const,
    flexDirection:  'row'    as const,
    gap:            8,
    backgroundColor: 'transparent',
  },
  secondaryText: {
    color:      '#1c1c1e',
    fontSize:   15,
    fontWeight: '700' as const,
  },
} as const

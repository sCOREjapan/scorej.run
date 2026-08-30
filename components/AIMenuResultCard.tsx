import React, { useMemo } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { TEXT, BRAND, DIVIDER } from '../lib/theme'
import { useTranslation } from 'react-i18next'

// AIコーチのメニュー生成プロンプト（workout-menu.tsx）が返す固定フォーマット
// （📋 今日のメニュー／🔥 ウォームアップ／⚡ メイン練習／🌊 クールダウン／💬 コーチから）
// を、構造化されたカードUIとしてパースして表示する。フォーマット外の文章（エラー
// メッセージ等）が来た場合はプレーン表示にフォールバックする。
//
// 配色方針：セクションごとに別色を割り当てる「AIっぽい」虹色配色はやめ、
// Apple純正アプリ（設定・Fitness）のグループ化リストに寄せて、アクセントは
// ブランドカラー1色のみ・階層はタイポグラフィと余白で作る。

type MenuLine =
  | { type: 'numbered'; num: number; text: string }
  | { type: 'arrow'; text: string }
  | { type: 'text'; text: string }

type MenuSection = { emoji: string; title: string; lines: MenuLine[] }

// 絵文字はAI生成テキスト側の目印としてパース専用に使い、表示にはIoniconsを使う
// （絵文字アイコンは単色デザインの中で浮くため：本人フィードバック）
const SECTION_LABEL: Record<string, string> = {
  '🔥': 'ウォームアップ',
  '⚡': 'メイン練習',
  '🌊': 'クールダウン',
  '💬': 'コーチから',
}
const SECTION_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  '🔥': 'flame-outline',
  '⚡': 'barbell-outline',
  '🌊': 'water-outline',
  '💬': 'chatbubble-outline',
}

function parseMenuText(raw: string): { title: string; meta: string; sections: MenuSection[] } {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  const sections: MenuSection[] = []
  let title = ''
  let meta = ''
  let current: MenuSection | null = null

  for (const line of lines) {
    const wasBold = /\*\*/.test(line)
    const stripped = line.replace(/\*\*/g, '').trim()

    if (stripped.startsWith('📋')) { title = stripped.replace('📋', '').trim(); continue }
    if (!current && /^（.*分）$/.test(stripped)) { meta = stripped; continue }

    const emoji = Object.keys(SECTION_LABEL).find(e => stripped.startsWith(e))
    if (emoji && wasBold) {
      current = { emoji, title: stripped.replace(emoji, '').trim(), lines: [] }
      sections.push(current)
      continue
    }
    if (!current) continue

    const num = stripped.match(/^(\d+)\.\s*(.+)/)
    if (num) { current.lines.push({ type: 'numbered', num: Number(num[1]), text: num[2] }); continue }
    if (stripped.startsWith('→')) { current.lines.push({ type: 'arrow', text: stripped.replace('→', '').trim() }); continue }
    if (stripped === '---') continue
    current.lines.push({ type: 'text', text: stripped })
  }
  return { title, meta, sections }
}

// "**強調**" を太字スパンに変換する（React NativeのTextはHTML非対応のため手動分割）
function InlineText({ text, style }: { text: string; style?: any }) {
  const parts = text.split('**')
  if (parts.length === 1) return <Text style={style}>{text}</Text>
  return (
    <Text style={style}>
      {parts.map((p, i) => (i % 2 === 1 ? <Text key={i} style={r.bold}>{p}</Text> : p))}
    </Text>
  )
}

export default function AIMenuResultCard({
  text, loading, onRegenerate,
}: { text: string; loading?: boolean; onRegenerate?: () => void }) {
  const parsed = useMemo(() => parseMenuText(text), [text])

  // 想定フォーマット外（APIエラー文言等）はプレーン表示にフォールバック
  if (parsed.sections.length === 0) {
    return (
      <View style={r.card}>
        <Text style={r.fallback}>{text}</Text>
        {onRegenerate && <RegenerateBtn loading={loading} onPress={onRegenerate} />}
      </View>
    )
  }

  return (
    <View style={{ gap: 20 }}>
      {!!parsed.title && (
        <View style={r.headerCard}>
          <Text style={r.headerTitle}>{parsed.title}</Text>
          {!!parsed.meta && (
            <View style={r.metaRow}>
              <Ionicons name="time-outline" size={13} color={TEXT.secondary} />
              <Text style={r.metaText}>{parsed.meta.replace(/[（）]/g, '')}</Text>
            </View>
          )}
        </View>
      )}

      {parsed.sections.map((sec, i) => (
        <View key={i} style={{ gap: 8 }}>
          {/* セクション見出しはカードの外、Appleのグループ化リストと同じ配置 */}
          <View style={r.sectionHead}>
            <Ionicons name={SECTION_ICON[sec.emoji] ?? 'ellipse-outline'} size={14} color={TEXT.secondary} />
            <Text style={r.sectionTitle}>{sec.title}</Text>
          </View>

          <View style={r.card}>
            {sec.lines.map((l, j) => {
              const isLast = j === sec.lines.length - 1
              if (l.type === 'numbered') {
                return (
                  <View key={j} style={[r.numRow, !isLast && r.rowDivider]}>
                    <Text style={r.numText}>{l.num}</Text>
                    <InlineText text={l.text} style={r.bodyText} />
                  </View>
                )
              }
              if (l.type === 'arrow') {
                return <Text key={j} style={[r.arrowText, !isLast && r.rowDivider]}>{l.text}</Text>
              }
              return <InlineText key={j} text={l.text} style={[r.bodyText, !isLast && r.rowDivider, { paddingVertical: 10 }]} />
            })}
          </View>
        </View>
      ))}

      {onRegenerate && <RegenerateBtn loading={loading} onPress={onRegenerate} />}
    </View>
  )
}

function RegenerateBtn({ loading, onPress }: { loading?: boolean; onPress: () => void }) {
  const { t } = useTranslation()
  return (
    <TouchableOpacity style={[r.regenBtn, loading && { opacity: 0.5 }]} onPress={onPress} activeOpacity={0.75} disabled={loading}>
      {loading ? <ActivityIndicator size="small" color={BRAND} /> : <Ionicons name="refresh" size={14} color={BRAND} />}
      <Text style={{ color: BRAND, fontSize: 13, fontWeight: '600' }}>{loading ? t('aiMenuResultCard.regenerating') : t('aiMenuResultCard.regenerate')}</Text>
    </TouchableOpacity>
  )
}

const r = StyleSheet.create({
  card:      { backgroundColor: '#ffffff', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', overflow: 'hidden' },
  fallback:  { color: TEXT.secondary, fontSize: 13, lineHeight: 21, padding: 16 },

  headerCard:  { gap: 4 },
  headerTitle: { color: TEXT.primary, fontSize: 19, fontWeight: '700', lineHeight: 24, letterSpacing: -0.2 },
  metaRow:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText:    { color: TEXT.secondary, fontSize: 13 },

  sectionHead:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: TEXT.secondary, letterSpacing: 0.1 },

  numRow:      { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12, paddingHorizontal: 14 },
  numText:     { width: 18, color: BRAND, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bodyText:    { flex: 1, color: TEXT.primary, fontSize: 15, lineHeight: 21, paddingHorizontal: 14 },

  arrowText:   { color: TEXT.secondary, fontSize: 13, lineHeight: 19, paddingLeft: 44, paddingRight: 14, paddingVertical: 8 },

  rowDivider:  { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: DIVIDER },

  bold:        { color: TEXT.primary, fontWeight: '700' },

  regenBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingVertical: 12 },
})

// components/RankBadge.tsx — ランクティア(RANK_TIERS)を視覚的にリッチに見せる共有バッジ
//
// 2026-09-29:「選手間プロフィール・コーチの選手詳細・マイページ」の3箇所でランク表示が
// それぞれ別々のフラットな見た目だったのを統一。トレーディングカードのような立体感(グラ
// デーション+光沢ハイライト+影)を持たせ、ランクが上がるほど見栄えがする土台にする
// (色自体はlib/gamification.tsのRANK_TIERSを流用するため、アプリ全体の色設計とは変えない)。
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import type { RankTier } from '../lib/gamification'

interface RankBadgeProps {
  tier: RankTier
  level: number
  title: string       // getTierTitle()適用済みの表示名(多言語対応)。size='md'では未使用
  size?: 'lg' | 'md' | 'sm'
}

// 単色のtier.colorから、少し明るい/暗いバリアントを作ってグラデーションの奥行きを出す
function shade(hex: string, percent: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + percent))
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + percent))
  const b = Math.min(255, Math.max(0, (n & 0xff) + percent))
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

export default function RankBadge({ tier, level, title, size = 'lg' }: RankBadgeProps) {
  const isLg = size === 'lg'
  const isMd = size === 'md'
  const dim = isLg ? 84 : isMd ? 52 : 22
  const badgeStyle = isLg ? s.badgeLg : isMd ? s.badgeMd : s.badgeSm
  const sheenStyle = isLg ? s.sheenLg : isMd ? s.sheenMd : s.sheenSm
  const emojiStyle = isLg ? s.emojiLg : isMd ? s.emojiMd : s.emojiSm

  const badge = (
    <LinearGradient
      colors={[shade(tier.color, 35), tier.color, shade(tier.color, -25)]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={[badgeStyle, { width: dim, height: dim, borderRadius: dim / (isSquareish(size) ? 2.6 : 2) }]}
    >
      {/* 左上の光沢ハイライトで「カードっぽい」立体感を出す */}
      <View style={sheenStyle} />
      <Text style={emojiStyle}>{tier.emoji}</Text>
    </LinearGradient>
  )

  if (isMd) return badge

  return (
    <View style={isLg ? s.wrapLg : s.wrapSm}>
      {badge}
      {isLg ? (
        <View style={{ alignItems: 'center', marginTop: 8 }}>
          <Text style={[s.levelLg, { color: tier.color }]}>Lv.{level}</Text>
          <Text style={[s.titleLg, { color: tier.color }]}>{title}</Text>
        </View>
      ) : (
        <Text style={[s.levelSm, { color: tier.color }]}>Lv.{level}</Text>
      )}
    </View>
  )
}

function isSquareish(size: 'lg' | 'md' | 'sm'): boolean {
  return size !== 'sm'
}

const s = StyleSheet.create({
  wrapLg: { alignItems: 'center' },
  wrapSm: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeLg: {
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 8, elevation: 5,
  },
  badgeMd: {
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 5, elevation: 3,
  },
  badgeSm: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  sheenLg: {
    position: 'absolute', top: -20, left: -20, width: 70, height: 70, borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.35)', transform: [{ rotate: '45deg' }],
  },
  sheenMd: {
    position: 'absolute', top: -14, left: -14, width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.35)', transform: [{ rotate: '45deg' }],
  },
  sheenSm: {
    position: 'absolute', top: -8, left: -8, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  emojiLg: { fontSize: 36 },
  emojiMd: { fontSize: 22 },
  emojiSm: { fontSize: 11 },
  levelLg: { fontSize: 20, fontWeight: '900', letterSpacing: 0.3 },
  titleLg: { fontSize: 12, fontWeight: '800', marginTop: 1 },
  levelSm: { fontSize: 11, fontWeight: '800' },
})

// components/RankBadge.tsx — ランクティア(RANK_TIERS)の見た目を3画面で統一する小さいバッジ
//
// 2026-09-29: 最初はグラデーション+光沢+大型サイズの「トレーディングカード」風にしたが、
// 「デカすぎてダサい」との指摘で撤回。他のアクションボタン(team.tsxのreportPain等)と
// 同じ「薄いティント円+その色のアイコン」という、このアプリで既に使われているフラットな
// パターンに揃えるだけにした。絵文字ではなくIoniconsを使う点だけは変えていない。
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { RankTier } from '../lib/gamification'

interface RankBadgeProps {
  tier: RankTier
  level: number
  title?: string      // getTierTitle()適用済みの表示名。渡すとLv.の下(または右)に添える
  size?: 'md' | 'sm'
  iconOnly?: boolean  // trueならアイコン円だけ返す(呼び出し側が既にLv.表記を持っている場合用)
}

const TIER_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  'ビギナー': 'leaf-outline',
  'ランナー': 'flash',
  '中級者':   'flame',
  '上級者':   'barbell-outline',
  'エリート': 'trophy',
  'レジェンド': 'diamond',
}
function iconForTier(tier: RankTier): keyof typeof Ionicons.glyphMap {
  return TIER_ICON[tier.title] ?? 'medal-outline'
}

export default function RankBadge({ tier, level, title, size = 'md', iconOnly = false }: RankBadgeProps) {
  const isMd = size === 'md'
  const dim = isMd ? 34 : 20
  const iconSize = isMd ? 17 : 11

  const circle = (
    <View style={[s.circle, { width: dim, height: dim, borderRadius: dim / 2, backgroundColor: tier.color + '18' }]}>
      <Ionicons name={iconForTier(tier)} size={iconSize} color={tier.color} />
    </View>
  )
  if (iconOnly) return circle

  return (
    <View style={isMd ? s.wrapMd : s.wrapSm}>
      {circle}
      {isMd ? (
        <View>
          <Text style={[s.levelMd, { color: tier.color }]}>Lv.{level}</Text>
          {title ? <Text style={s.titleMd}>{title}</Text> : null}
        </View>
      ) : (
        <Text style={[s.levelSm, { color: tier.color }]}>Lv.{level}</Text>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  wrapMd: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrapSm: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  circle: { alignItems: 'center', justifyContent: 'center' },
  levelMd: { fontSize: 15, fontWeight: '800' },
  titleMd: { fontSize: 11, color: '#8e8e93', marginTop: 1 },
  levelSm: { fontSize: 11, fontWeight: '800' },
})

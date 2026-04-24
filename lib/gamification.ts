// lib/gamification.ts — シンプル育成ゲームシステム

export interface LevelInfo {
  level: number
  title: string
  emoji: string
  xp: number
  xpToNext: number
  progress: number  // 0.0–1.0
}

export interface RankTier {
  min: number
  max: number        // exclusive (次のランクのmin)
  title: string
  emoji: string
  color: string
  description: string
  milestones: string[] // このランクで達成すること
  sessionsRequired: number // このランク到達に必要な累計セッション数
}

interface TitleEntry { min: number; title: string; emoji: string }

export const RANK_TIERS: RankTier[] = [
  {
    min: 1, max: 5,
    title: 'ビギナー', emoji: '🌱', color: '#34C759',
    description: '練習記録をスタートしたばかり。毎日続けることが大切。',
    sessionsRequired: 0,
    milestones: [
      '練習を1回記録する',
      '3日連続で記録する',
      '体調を5日入力する',
      '睡眠を記録してみる',
    ],
  },
  {
    min: 5, max: 10,
    title: 'ランナー', emoji: '⚡', color: '#FF9500',
    description: '記録が習慣になってきた。データが積み上がり分析が始まる。',
    sessionsRequired: 20,
    milestones: [
      '練習を20回記録する（累計）',
      'AIコーチアドバイスを1回もらう',
      'タイム計測を記録する',
      'カレンダーで1週間を振り返る',
    ],
  },
  {
    min: 10, max: 20,
    title: '中級者', emoji: '🔥', color: '#FF6B35',
    description: '本格的にデータが蓄積。怪我リスクスコアが機能し始める。',
    sessionsRequired: 45,
    milestones: [
      '練習を45回記録する（累計）',
      '怪我リスクスコアを毎週確認する',
      'リカバリーAIを使ってみる',
      '試合計画を1つ作成する',
    ],
  },
  {
    min: 20, max: 35,
    title: '上級者', emoji: '💪', color: '#4A9FFF',
    description: '長期間継続中。練習の質と量のバランスが整ってきた。',
    sessionsRequired: 95,
    milestones: [
      '練習を95回記録する（累計）',
      '自己ベストを更新する',
      '動画フォーム分析を受ける',
      'チームで練習記録を共有する',
    ],
  },
  {
    min: 35, max: 50,
    title: 'エリート', emoji: '🏆', color: '#FFD700',
    description: '本格的なアスリートの領域。データ管理が完全に身についている。',
    sessionsRequired: 170,
    milestones: [
      '練習を170回記録する（累計）',
      '3ヶ月連続で記録を続ける',
      '食事・睡眠・練習をすべて記録する',
      '大会で自己ベストを出す',
    ],
  },
  {
    min: 50, max: 9999,
    title: 'レジェンド', emoji: '👑', color: '#E53935',
    description: '伝説の領域。このレベルに達した選手は本物のアスリート。',
    sessionsRequired: 245,
    milestones: [
      '練習を245回記録する（累計）',
      '1年間継続して記録する',
      'チームメンバーのロールモデルになる',
    ],
  },
]

const LEVEL_TITLES: TitleEntry[] = RANK_TIERS.map(r => ({ min: r.min, title: r.title, emoji: r.emoji }))

const XP_PER_SESSION = 100
const XP_PER_LEVEL   = 500

export function calcLevelInfo(totalSessions: number): LevelInfo {
  const xp        = totalSessions * XP_PER_SESSION
  const level     = Math.floor(xp / XP_PER_LEVEL) + 1
  const xpInLevel = xp - (level - 1) * XP_PER_LEVEL
  const progress  = xpInLevel / XP_PER_LEVEL
  const xpToNext  = XP_PER_LEVEL - xpInLevel

  const titleInfo =
    [...LEVEL_TITLES].reverse().find(t => level >= t.min) ?? LEVEL_TITLES[0]

  return {
    level,
    title: titleInfo.title,
    emoji: titleInfo.emoji,
    xp,
    xpToNext,
    progress: Math.min(1, progress),
  }
}

/** セッション保存時に呼ぶ。レベルアップしたらメッセージを返す */
export function checkLevelUp(prevCount: number, newCount: number): string | null {
  const prev = calcLevelInfo(prevCount)
  const next  = calcLevelInfo(newCount)
  if (next.level > prev.level) {
    return `${next.emoji} Lv.${next.level} ${next.title} に昇格！`
  }
  return null
}

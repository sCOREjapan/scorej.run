// lib/gamification.ts — シンプル育成ゲームシステム
import type { Language } from '../context/LanguageContext'

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

// ── 表示テキストの英訳（データの実体である日本語titleをキーに引く） ──────
// RANK_TIERS.title/description/milestonesは各所のcalcLevelInfo呼び出しに
// 直接埋め込まれて表示されており(team.tsx/index.tsx/records.tsx/mypage.tsx/
// level-roadmap.tsx)、英語設定でもここが日本語のまま返ってきていた不具合を
// 2026-08-30に発見・修正。lib/eventLabels.tsと同じ「内部値は日本語のまま・
// 表示だけ関数経由で翻訳する」方式に揃える。
const TIER_TITLE_EN: Record<string, string> = {
  'ビギナー': 'Beginner', 'ランナー': 'Runner', '中級者': 'Intermediate',
  '上級者': 'Advanced', 'エリート': 'Elite', 'レジェンド': 'Legend',
}
const TIER_DESC_EN: Record<string, string> = {
  'ビギナー': 'Just getting started with logging. Keep it up every day.',
  'ランナー': 'Logging is becoming a habit — data is piling up and analysis is starting to kick in.',
  '中級者': 'Data is really accumulating now. The injury risk score is starting to work well.',
  '上級者': 'Training consistently over the long term, with quality and volume in balance.',
  'エリート': "You're in true-athlete territory, with data management fully second nature.",
  'レジェンド': 'Legendary territory — an athlete who reaches this level is the real deal.',
}
const TIER_MILESTONES_EN: Record<string, string[]> = {
  'ビギナー': [
    'Log 1 training session',
    'Log 3 days in a row',
    'Log your condition for 5 days',
    'Try logging your sleep',
  ],
  'ランナー': [
    'Log 20 training sessions (total)',
    'Get 1 piece of AI coach advice',
    'Log a timed result',
    'Review a week on the calendar',
  ],
  '中級者': [
    'Log 45 training sessions (total)',
    'Check your injury risk score weekly',
    'Try the recovery AI',
    'Create 1 competition plan',
  ],
  '上級者': [
    'Log 95 training sessions (total)',
    'Set a new personal best',
    'Get a video form analysis',
    'Share training logs with your team',
  ],
  'エリート': [
    'Log 170 training sessions (total)',
    'Keep logging for 3 months straight',
    'Log meals, sleep, and training — all of them',
    'Set a PB at a competition',
  ],
  'レジェンド': [
    'Log 245 training sessions (total)',
    'Keep logging for a full year',
    'Become a role model for your teammates',
  ],
}

export function getTierTitle(jaTitle: string, lang: Language): string {
  return lang === 'en' ? (TIER_TITLE_EN[jaTitle] ?? jaTitle) : jaTitle
}
export function getTierDescription(jaTitle: string, lang: Language): string {
  return lang === 'en' ? (TIER_DESC_EN[jaTitle] ?? jaTitle) : jaTitle
}
export function getTierMilestones(jaTitle: string, lang: Language): string[] {
  return lang === 'en' ? (TIER_MILESTONES_EN[jaTitle] ?? []) : []
}

export function calcLevelInfo(totalSessions: number, lang: Language = 'ja'): LevelInfo {
  const xp        = totalSessions * XP_PER_SESSION
  const level     = Math.floor(xp / XP_PER_LEVEL) + 1
  const xpInLevel = xp - (level - 1) * XP_PER_LEVEL
  const progress  = xpInLevel / XP_PER_LEVEL
  const xpToNext  = XP_PER_LEVEL - xpInLevel

  const titleInfo =
    [...LEVEL_TITLES].reverse().find(t => level >= t.min) ?? LEVEL_TITLES[0]

  return {
    level,
    title: getTierTitle(titleInfo.title, lang),
    emoji: titleInfo.emoji,
    xp,
    xpToNext,
    progress: Math.min(1, progress),
  }
}

/** セッション保存時に呼ぶ。レベルアップしたらメッセージを返す */
export function checkLevelUp(prevCount: number, newCount: number, lang: Language = 'ja'): string | null {
  const prev = calcLevelInfo(prevCount, lang)
  const next  = calcLevelInfo(newCount, lang)
  if (next.level > prev.level) {
    return lang === 'en'
      ? `${next.emoji} Reached Lv.${next.level} ${next.title}!`
      : `${next.emoji} Lv.${next.level} ${next.title} に昇格！`
  }
  return null
}

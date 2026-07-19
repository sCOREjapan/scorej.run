// lib/tutorial.ts — チュートリアルのステップ定義

export type TutorialSpotKey =
  | 'home_quick_input'
  | 'home_risk_card'
  | 'home_stretch_banner'
  | 'home_goal_section'
  | 'home_countdown_card'
  | 'notebook_menu_link'
  | 'competition_tab'
  | 'records_share_btn'

export type TutorialStepId =
  | 'welcome'
  | 'quick_input'
  | 'condition_modal'
  | 'risk_card'
  | 'stretch_banner'
  | 'goal_section'
  | 'notebook_menu'
  | 'competition_tab'
  | 'share_card'
  | 'complete'

export interface TutorialStep {
  id: TutorialStepId
  title: string
  description: string
  spotKey: TutorialSpotKey | null
  /** tap = ユーザーがハイライト要素をタップして進む / next = 「次へ」ボタンで進む */
  action: 'tap' | 'next'
  nextStep: TutorialStepId | null
  /** タブ遷移が必要なステップ */
  tabIndex?: number
  tooltipPosition?: 'top' | 'bottom'
}

export const TUTORIAL_STEPS: Record<TutorialStepId, TutorialStep> = {
  welcome: {
    id: 'welcome',
    title: 'sCORE へようこそ！🏃',
    description: 'たった1分で基本の使い方を体験しましょう。\n怪我リスクの傾向を確認する流れを一緒に見ていきます。',
    spotKey: null,
    action: 'next',
    nextStep: 'quick_input',
  },
  quick_input: {
    id: 'quick_input',
    title: 'サクッと入力',
    description: 'ここをタップして今日の\n体の状態を入力しよう 👆',
    spotKey: 'home_quick_input',
    action: 'tap',
    nextStep: 'condition_modal',
    tooltipPosition: 'top',
  },
  condition_modal: {
    id: 'condition_modal',
    title: 'コンディションを記録',
    description: '疲労度・コンディションを\nスライダーで入力して保存してね。\n保存したら次に進みます ✅',
    spotKey: null,
    action: 'next',
    nextStep: 'risk_card',
  },
  risk_card: {
    id: 'risk_card',
    title: '怪我リスクをチェック',
    description: 'ここが今日の怪我リスクスコア。\n疲労が高いとリスクも上がるよ ⚠️',
    spotKey: 'home_risk_card',
    action: 'next',
    nextStep: 'stretch_banner',
    tooltipPosition: 'bottom',
  },
  stretch_banner: {
    id: 'stretch_banner',
    title: 'ストレッチでコンディションを整える',
    description: 'このバナーをタップするとストレッチ開始。\n終わるとリスクスコアが変化するよ 💪',
    spotKey: 'home_stretch_banner',
    action: 'next',
    nextStep: 'goal_section',
    tooltipPosition: 'bottom',
  },
  goal_section: {
    id: 'goal_section',
    title: '目標を設定しよう',
    description: 'ホーム上部で目標タイムや\n目標試合を設定できるよ 🎯',
    spotKey: 'home_goal_section',
    action: 'next',
    nextStep: 'notebook_menu',
    tooltipPosition: 'bottom',
  },
  notebook_menu: {
    id: 'notebook_menu',
    title: '練習メニューを見る',
    description: '「メニュー」から今日の練習メニューを\n確認・記録できるよ 📋',
    spotKey: 'notebook_menu_link',
    action: 'next',
    nextStep: 'competition_tab',
    tabIndex: 2,
    tooltipPosition: 'top',
  },
  competition_tab: {
    id: 'competition_tab',
    title: '試合計画・怪我復帰',
    description: 'AIが試合までの練習計画や\n怪我からの回復プランを作ってくれるよ 🏁',
    spotKey: 'competition_tab',
    action: 'next',
    nextStep: 'share_card',
    tabIndex: 3,
    tooltipPosition: 'top',
  },
  share_card: {
    id: 'share_card',
    title: '記録をシェアしよう',
    description: '記録画面からおしゃれなシェアカードを\n作れるよ。SNSに投稿しよう📸',
    spotKey: 'records_share_btn',
    action: 'next',
    nextStep: 'complete',
    tabIndex: 1,
    tooltipPosition: 'top',
  },
  complete: {
    id: 'complete',
    title: 'チュートリアル完了！🎉',
    description: 'お疲れさまでした！\nこれからも毎日記録して\nベスト更新を目指そう💪',
    spotKey: null,
    action: 'next',
    nextStep: null,
  },
}

export const TUTORIAL_ORDER: TutorialStepId[] = [
  'welcome',
  'quick_input',
  'condition_modal',
  'risk_card',
  'stretch_banner',
  'goal_section',
  'notebook_menu',
  'competition_tab',
  'share_card',
  'complete',
]

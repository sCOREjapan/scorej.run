// lib/aiLocalData.ts — AI機能が端末に残すデータの消去
//
// 2026-10-07: AIの履歴・結果キャッシュ・分析用の動画/フレームは、これまでログアウトでも
// アカウント削除でも消えず、同じ端末で別のアカウント(またはゲスト)に切り替えた人に見えたり、
// 前のアカウントの「今日のAIアドバイス」や「リカバリー相談の結果」が課金なしで再利用されていた。
//   ・キャッシュ(再利用して課金を避けるためのもの)   → ログアウト/ゲスト開始のたびに消す
//   ・履歴/チャット/残り回数(その人の内容)           → 別のアカウントに切り替わった時と、アカウント削除時に消す
//   ・端末にコピーした動画ファイル(score_video_*)     → ログアウト時とアカウント削除時に消す
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'

/** 同じ入力なら課金せずに結果を再利用するためのキャッシュ */
const AI_CACHE_KEYS = [
  'score_ai_advice_daily_cache',       // ホームの「今日のAIアドバイス」
  'trackmate_recovery_ai_cache_v1',    // リカバリー相談(入力のメモを含む)
]
const AI_CACHE_PREFIXES = ['score_va_cache_v3_']   // 動画分析の結果キャッシュ

/** その人のAI関連の内容（履歴・会話・残り回数） */
const AI_HISTORY_KEYS = [
  'trackmate_scoppy_chat_history',
  'trackmate_scoppy_chat_credits',
  'trackmate_video_analysis_history',
  'trackmate_video_annotations',
  'trackmate_ai_diagnoses',
  'trackmate_ai_menus',
  'trackmate_recovery_records',
]

/** その人の記録・プロフィールなど（端末内に保存され、ログインすると自動でクラウドへ同期されるもの）。
 *  別のアカウントがログインした時に残っていると、その人のクラウドへ「前の人のデータ」が同期されてしまう。
 *  チームの参加情報や端末の設定は、この端末のものなので含めない。 */
const USER_DATA_KEYS = [
  'trackmate_sessions', 'trackmate_race_records', 'trackmate_sleep', 'trackmate_my_profile',
  'trackmate_competitions', 'trackmate_condition_map', 'trackmate_condition', 'trackmate_workout_menus',
  'trackmate_meals', 'trackmate_injury_records', 'trackmate_body_records', 'trackmate_weight',
  'trackmate_stretch_result', 'trackmate_calendar_events', 'trackmate_timeline', 'trackmate_tasks',
  'trackmate_goals', 'trackmate_menu_templates', 'trackmate_exercise_library', 'trackmate_entry_status',
  'trackmate_race_plan_draft_v1', 'trackmate_quick_condition_draft', 'trackmate_nutrition_stats_views',
  'trackmate_onboarding_goal', 'trackmate_custom_warmup_routine',
]

const LAST_AUTH_USER_KEY = 'score_last_auth_user'

async function removeKeysWithPrefix(prefixes: string[]) {
  try {
    const all = await AsyncStorage.getAllKeys()
    const targets = all.filter(k => prefixes.some(p => k.startsWith(p)))
    if (targets.length) await AsyncStorage.multiRemove(targets)
  } catch {}
}

/** 分析のために端末へコピーした動画・抽出フレームなどの一時ファイルを消す */
export async function purgeAiTempFiles(): Promise<void> {
  if (Platform.OS === 'web') return
  try {
    const dir = FileSystem.cacheDirectory
    if (!dir) return
    const items = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[])
    await Promise.all(
      items
        .filter(f => f.startsWith('score_video_') || f.startsWith('VideoThumbnails') || f.startsWith('ImageManipulator'))
        .map(f => FileSystem.deleteAsync(dir + f, { idempotent: true }).catch(() => {})),
    )
  } catch {}
}

/** キャッシュ類（ログアウト/ゲスト開始のたびに実行） */
export async function purgeAiCaches(): Promise<void> {
  await AsyncStorage.multiRemove(AI_CACHE_KEYS).catch(() => {})
  await removeKeysWithPrefix(AI_CACHE_PREFIXES)
  await purgeAiTempFiles()
}

/** その人の履歴・会話・残り回数（別アカウントへの切り替え時、アカウント削除時） */
export async function purgeAiHistories(): Promise<void> {
  await AsyncStorage.multiRemove(AI_HISTORY_KEYS).catch(() => {})
}

/** すべて（アカウント削除など） */
export async function purgeAiLocalData(): Promise<void> {
  await purgeAiCaches()
  await purgeAiHistories()
}

/** 前の人の記録・プロフィールを端末から消す（別アカウントがログインした時用） */
export async function purgeUserLocalData(): Promise<void> {
  await AsyncStorage.multiRemove(USER_DATA_KEYS).catch(() => {})
}

/**
 * ログイン成功時に呼ぶ。前回ログインしていたアカウントと違えば、前の人のAI履歴と記録を端末から消す。
 * 同じアカウントの再ログインでは消さない。ゲストで使っていたデータ（前回のアカウントが無い端末）は、
 * 従来どおり最初にログインしたアカウントへ引き継ぐ。
 * 2026-10-07: 以前は、ログアウト後に別のアカウントでログインすると、前の人の睡眠・体重・練習記録などが
 * そのまま新しいアカウントのクラウドへ同期され、他人のデータが混ざっていた。
 * ※ 同期(syncAll)より前に完了させるため、呼び出し側は await すること。
 */
export async function onAccountSignedIn(userId: string): Promise<void> {
  try {
    const last = await AsyncStorage.getItem(LAST_AUTH_USER_KEY)
    if (last && last !== userId) {
      await purgeAiHistories()
      await purgeUserLocalData()
    }
    await AsyncStorage.setItem(LAST_AUTH_USER_KEY, userId)
  } catch {}
}

/** ログアウト時に呼ぶ（次にログインする人が別人でも見えないようキャッシュを消す。履歴は次回ログイン時に判定） */
export async function onAccountSignedOut(): Promise<void> {
  await purgeAiCaches()
}

/**
 * ゲストとして使い始める時に呼ぶ。結果のキャッシュだけ消す。
 * （履歴や記録は消さない: 同じ人が「ゲストで続ける → 同じアカウントで再ログイン」しても失わないため。
 *  別のアカウントがログインした時の入れ替えは、onAccountSignedIn が前回のアカウントとの違いで判断する）
 */
export async function onGuestStarted(): Promise<void> {
  await purgeAiCaches()
}

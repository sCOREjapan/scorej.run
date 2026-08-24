// types/index.ts — TrackMate 全型定義

// ─────────────────────────────────────────
// ユーザー
// ─────────────────────────────────────────
export type EventCategory = 'sprint' | 'middle' | 'long'

export type SprintEvent =
  | '100m' | '200m' | '300m' | '400m'
  | '110mH' | '100mH' | '300mH' | '400mH'

export type MiddleLongEvent =
  | '800m' | '1000m' | '1500m' | '3000m'
  | '5000m' | '10000m' | '3000mSC'
  | 'half_marathon' | 'marathon'
  | '競歩'

export type FieldEvent =
  | '走幅跳' | '三段跳' | '走高跳' | '棒高跳'
  | '砲丸投' | 'やり投' | '円盤投' | 'ハンマー投'

// 混成競技（得点制）
export type CombinedEvent =
  | '十種競技' | '七種競技' | '八種競技'

// リレー種目
export type RelayEvent = '4×100mR' | '4×400mR'

export type AthleticsEvent = TrackEvent | FieldEvent | CombinedEvent | RelayEvent
export type TrackEvent = SprintEvent | MiddleLongEvent

// ─────────────────────────────────────────
// 記録管理
// ─────────────────────────────────────────
export interface RaceRecord {
  id: string
  user_id: string
  event: AthleticsEvent
  result_display: string   // 表示用: "10.85" / "47.32" / "7m32"
  result_ms?: number       // トラック種目: ミリ秒
  result_cm?: number       // フィールド種目: センチメートル
  race_date: string        // YYYY-MM-DD
  race_time?: string       // HH:MM（任意）。同日に複数記録がある場合の並び替えに使う
  venue?: string
  competition_name?: string
  wind_ms?: number         // 風速（短距離・跳躍）
  hurdle_height_cm?: number // ハードルの高さ（ハードル種目のみ）
  is_pb: boolean
  is_sb: boolean
  is_official?: boolean    // true=公認記録、false/undefined=手動入力（非公認）
  notes?: string
  created_at: string
}

export interface UserProfile {
  id: string
  name: string
  primary_event: TrackEvent
  secondary_events: TrackEvent[]
  event_category: EventCategory
  personal_best_ms?: number   // ミリ秒
  target_time_ms?: number
  age?: number
  experience_years?: number
  created_at: string
}

// ─────────────────────────────────────────
// トレーニング記録
// ─────────────────────────────────────────
export type SessionType =
  | 'interval'      // インターバル走
  | 'tempo'         // テンポ走
  | 'easy'          // 軽めのジョグ
  | 'long'          // ロング走
  | 'sprint'        // スプリント系
  | 'drill'         // ドリル
  | 'strength'      // ウェイト・補強
  | 'race'          // 試合
  | 'rest'          // 休養

export interface TrainingSession {
  id: string
  user_id: string
  session_date: string         // ISO 8601 date
  session_type: SessionType
  event?: AthleticsEvent
  hurdle_height_cm?: number    // ハードルの高さ（ハードル種目のみ）
  time_ms?: number             // メインタイム（ミリ秒）
  distance_m?: number          // 距離（メートル）
  reps?: number                // 本数
  sets?: number                // セット数
  rest_sec?: number            // レスト（秒）
  fatigue_level: number        // 1-10
  condition_level: number      // 1-10（体調）
  weather?: string
  temperature?: number         // 気温（℃）
  notes?: string
  video_url?: string           // Supabase Storage URL
  ai_feedback?: string
  created_at: string
}

// ─────────────────────────────────────────
// 動画分析
// ─────────────────────────────────────────
export interface VideoDrill {
  name: string
  description: string
  sets: string          // 例: "3×30m"
  focus: string         // 何を改善するか
}

export interface VideoAnalysisResult {
  technique_score: number      // 0-100
  feedback: string             // 総評（2-3文）
  strengths: string[]          // 良い点（最大3つ）
  improvements: string[]       // 改善点（最大3つ）
  drills: VideoDrill[]         // 推奨ドリル（最大4つ）
  next_events: string[]        // 取り組むべき種目
  event_detected?: TrackEvent  // AIが推定した種目
}

// ─────────────────────────────────────────
// 食事管理
// ─────────────────────────────────────────
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'supplement'

export interface FoodItem {
  name: string
  calories: number
  protein: number   // g
  carb: number      // g
  fat: number       // g
  confidence: number // 0-1（AIの推定信頼度）
}

export interface MealRecord {
  id: string
  user_id: string
  meal_date: string
  meal_type: MealType
  photo_url?: string
  foods: FoodItem[]
  total_calories: number
  total_protein: number
  total_carb: number
  total_fat: number
  training_timing?: 'pre' | 'post' | 'none'  // トレーニング前後か
  advice?: string                              // AI短評
  created_at: string
}

export interface MealAnalysisResult {
  foods: FoodItem[]
  total_calories: number
  total_protein: number
  total_carb: number
  total_fat: number
  advice: string
  hydration_reminder?: string
}

// ─────────────────────────────────────────
// 試合計画
// ─────────────────────────────────────────
export interface TrainingSessionPlan {
  day: string         // 例: '月曜'
  type: SessionType
  detail: string      // 例: '400m×5 @ 95%'
  duration_min: number
  intensity: 'easy' | 'moderate' | 'hard' | 'race'
  optional?: boolean
}

export interface WeekPlan {
  week_number: number  // 試合まで何週前か（1=直前週）
  theme: string        // その週のテーマ
  total_volume_km?: number
  sessions: TrainingSessionPlan[]
  key_workout: string  // その週のメインワークアウト
}

export interface CompetitionPlan {
  id: string
  user_id: string
  competition_name: string
  competition_date: string
  event: AthleticsEvent
  target_time_ms: number
  days_until: number
  phases: WeekPlan[]
  peak_week: number    // ピーク週
  taper_start_week: number
  key_advice: string
  created_at: string
}

// ─────────────────────────────────────────
// 睡眠・回復
// ─────────────────────────────────────────
export interface SleepRecord {
  id: string
  user_id: string
  sleep_date: string
  sleep_start?: string       // ISO 8601 datetime
  sleep_end?: string
  awake_min?: number         // 就寝〜起床の間に途中で目が覚めていた時間（分）。duration_minはこれを差し引いた実質睡眠時間
  duration_min?: number      // 計算値（sleep_end - sleep_start - awake_min）
  quality_score: number      // 1-10
  deep_sleep_min?: number    // HealthKit連携時
  rhr?: number               // 安静時心拍数
  hrv?: number               // 心拍変動
  notes?: string
  created_at: string
}

export interface RecoveryStatus {
  overall: number            // 0-100
  sleep_score: number
  fatigue_score: number
  readiness: 'high' | 'moderate' | 'low'
  advice: string
}

// ─────────────────────────────────────────
// チーム・コーチ
// ─────────────────────────────────────────
export type MemberRole = 'athlete' | 'coach' | 'manager'

export interface TeamMember {
  id: string
  name: string
  event: AthleticsEvent
  role: MemberRole
  grade?: string           // 学年: '1年' '2年' etc.
  pb_display?: string      // 自己ベスト表示文字列
  notes?: string
}

export interface CoachNote {
  id: string
  content: string
  date: string             // YYYY-MM-DD
  pinned: boolean
}

export interface TeamProfile {
  team_name: string
  school_or_club?: string
  coach_name?: string
  coach_specialty?: string // 専門: '短距離' '中長距離' etc.
  members: TeamMember[]
  coach_notes: CoachNote[]
}

export interface MyProfile {
  name: string
  primary_event: AthleticsEvent
  secondary_events: AthleticsEvent[]
  grade?: string
  birth_year?: number
  coach_name?: string
}

// ─────────────────────────────────────────
// UI共通
// ─────────────────────────────────────────
export interface ChartDataPoint {
  date: string
  value: number
  label?: string
}

export type LoadingState = 'idle' | 'loading' | 'success' | 'error'

// ─────────────────────────────────────────
// 怪我復帰機能
// ─────────────────────────────────────────
export interface InjuryExercise {
  name: string
  detail: string
}

export interface InjuryDayPlan {
  day: number
  phase: string
  exercises: InjuryExercise[]
  avoid: string[]
  advice: string
}

// 治療（通院・施術等）に行った記録
export interface TreatmentLogEntry {
  date: string     // YYYY-MM-DD
  note?: string     // 任意メモ（例: 「整形外科でリハビリ」）
}

export interface InjuryRecord {
  id: string
  side: string
  parts: string[]
  injuryType: string
  description: string
  painLevel: number
  hasSwelling: boolean
  totalDays: number
  startDate: string
  plans: InjuryDayPlan[]
  coachShare: boolean
  status: 'active' | 'completed'
  createdAt: string
  treatmentLog?: TreatmentLogEntry[]
}

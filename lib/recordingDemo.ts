// lib/recordingDemo.ts — SNS素材録画用のデモモードフラグ（marketing/recording/ 専用）
//
// EXPO_PUBLIC_RECORDING_DEMO=1 の時だけ true。デフォルトはfalseで本番挙動に一切影響しない。
// 有効時は各画面で「実際のAI呼び出し・チケット/広告ゲート・料金/PRO表示」をスキップし、
// 固定のダミーデータを即時に表示するために使う（本番DB・実APIに触れずに録画するため）。
export const RECORDING_DEMO = process.env.EXPO_PUBLIC_RECORDING_DEMO === '1'

// lib/coachReqStore.ts — コーチへの動画送信リクエスト(trackmate_coach_video_requests)を
// 直列化する共有ストア
//
// 背景: COACH_REQ_KEY への read-modify-write が coach-view.tsx (React state を
// 基点に書き込み) と video-analysis.tsx の2ファイルで独立に行われており、
// 選手が動画を送信した直後にコーチ側が別のリクエストを既読/削除すると、
// 送信直後の新規リクエストが古いスナップショットの書き戻しで消える危険があった。
import { createStorageQueue } from './storageQueue'

export type CoachVideoRequest = {
  id:           string
  videoUri:     string
  thumbnailUri: string
  message:      string
  event:        string
  sentAt:       string
  checked?:     boolean
}

export const COACH_REQ_KEY = 'trackmate_coach_video_requests'

const store = createStorageQueue<CoachVideoRequest[]>(COACH_REQ_KEY, [])

export const getCoachVideoRequests = store.get
export const updateCoachVideoRequests = store.update

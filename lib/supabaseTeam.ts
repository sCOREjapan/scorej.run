// lib/supabaseTeam.ts — チームデータ Supabase CRUD
import { supabase } from './supabase'

const isConfigured = !!(
  process.env.EXPO_PUBLIC_SUPABASE_URL &&
  process.env.EXPO_PUBLIC_SUPABASE_URL !== 'placeholder'
)

// ── チーム ────────────────────────────────────────────────
export interface TeamRow {
  code: string
  team_name: string
  coach_name: string
  created_at: string
}

export async function createTeam(code: string, teamName: string, coachName: string): Promise<void> {
  if (!isConfigured) return
  const { error } = await supabase.from('teams').upsert(
    { code, team_name: teamName, coach_name: coachName },
    { onConflict: 'code' },
  )
  if (error) throw new Error(error.message)
}

export async function fetchTeamByCode(code: string): Promise<TeamRow | null> {
  if (!isConfigured) return null
  const { data } = await supabase
    .from('teams').select('*')
    .eq('code', code)
    .single()
  return data as TeamRow | null
}

// ── メンバー ──────────────────────────────────────────────
export interface TeamMemberRow {
  id: string
  team_code: string
  player_name: string
  event: string
  icon?: string
  joined_at: string
}

export async function registerMember(teamCode: string, playerName: string, event = '', icon = ''): Promise<void> {
  if (!isConfigured) return
  const row: Record<string, string> = { id: `${teamCode}_${playerName}`, team_code: teamCode, player_name: playerName, event }
  if (icon) row.icon = icon
  const { error } = await supabase.from('team_members').upsert(row, { onConflict: 'id' })
  if (error) throw new Error(error.message)
}

export async function deleteMember(id: string): Promise<void> {
  if (!isConfigured) return
  const { error } = await supabase.from('team_members').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function fetchMembers(teamCode: string): Promise<TeamMemberRow[]> {
  if (!isConfigured) return []
  const { data } = await supabase
    .from('team_members').select('*')
    .eq('team_code', teamCode)
    .order('joined_at', { ascending: true })
  return (data ?? []) as TeamMemberRow[]
}

// ── メッセージ ────────────────────────────────────────────
export interface TeamMessageRow {
  id: string
  team_code: string
  content: string
  author_name: string
  is_pinned: boolean
  created_at: string
}

export async function fetchMessages(teamCode: string): Promise<TeamMessageRow[]> {
  if (!isConfigured) return []
  const { data } = await supabase
    .from('team_messages').select('*')
    .eq('team_code', teamCode)
    .order('created_at', { ascending: false })
  return (data ?? []) as TeamMessageRow[]
}

export async function postMessage(teamCode: string, content: string, authorName: string): Promise<TeamMessageRow | null> {
  if (!isConfigured) return null  // 未設定時はサイレント（他の関数と統一）
  const { data, error } = await supabase
    .from('team_messages')
    .insert({ team_code: teamCode, content, author_name: authorName, is_pinned: false })
    .select().single()
  if (error) throw new Error(error.message)
  return data as TeamMessageRow | null
}

export async function setPinMessage(id: string, isPinned: boolean): Promise<void> {
  if (!isConfigured) return
  await supabase.from('team_messages').update({ is_pinned: isPinned }).eq('id', id)
}

export async function deleteMessage(id: string): Promise<void> {
  if (!isConfigured) return
  await supabase.from('team_messages').delete().eq('id', id)
}

// ── 動画投稿 ─────────────────────────────────────────────
export interface TeamVideoRow {
  id: string
  team_code: string
  player_name: string
  url: string
  description: string
  watched: boolean
  posted_at: string
}

export async function fetchVideos(teamCode: string): Promise<TeamVideoRow[]> {
  if (!isConfigured) return []
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('team_videos').select('*')
    .eq('team_code', teamCode)
    .gte('posted_at', sevenDaysAgo)
    .order('posted_at', { ascending: false })
  return (data ?? []) as TeamVideoRow[]
}

export async function submitVideo(
  teamCode: string, playerName: string, url: string, description: string,
): Promise<void> {
  if (!isConfigured) return
  await supabase.from('team_videos')
    .insert({ team_code: teamCode, player_name: playerName, url, description })
}

export async function markVideoWatched(id: string): Promise<void> {
  if (!isConfigured) return
  await supabase.from('team_videos').update({ watched: true }).eq('id', id)
}

// ── 痛み報告 ─────────────────────────────────────────────
export interface BodyReportRow {
  team_code:       string
  player_name:     string
  parts:           string[]
  detail:          string
  acked_by_coach:  boolean
  updated_at:      string
}

export async function fetchBodyReports(teamCode: string): Promise<BodyReportRow[]> {
  if (!isConfigured) return []
  const { data } = await supabase
    .from('team_body_reports').select('*')
    .eq('team_code', teamCode)
  return (data ?? []) as BodyReportRow[]
}

export async function upsertBodyReport(
  teamCode: string,
  playerName: string,
  parts: string[],
  detail = '',
): Promise<void> {
  if (!isConfigured) return
  await supabase.from('team_body_reports').upsert(
    { team_code: teamCode, player_name: playerName, parts, detail, acked_by_coach: false, updated_at: new Date().toISOString() },
    { onConflict: 'team_code,player_name' },
  )
}

export async function ackBodyReport(teamCode: string, playerName: string): Promise<void> {
  if (!isConfigured) return
  const { error } = await supabase.from('team_body_reports')
    .update({ acked_by_coach: true })
    .eq('team_code', teamCode)
    .eq('player_name', playerName)
  if (error) throw new Error(error.message)
}

// ── 選手セッション共有（コーチが選手記録を閲覧）────────────
export interface TeamSessionRow {
  id: string
  team_code: string
  player_name: string
  session_date: string
  session_type: string
  fatigue_level: number
  condition_level: number
  distance_m: number | null
  reps: number | null
  sets: number | null
  synced_at: string
}

export async function syncTeamSessions(
  teamCode: string,
  playerName: string,
  sessions: Array<{
    id: string
    session_date: string
    session_type: string
    fatigue_level: number
    condition_level: number
    distance_m?: number
    reps?: number
    sets?: number
  }>,
): Promise<void> {
  if (!isConfigured) return
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const recent = sessions.filter(s => s.session_date >= cutoff)
  if (!recent.length) return
  const rows = recent.map(s => ({
    id: s.id,
    team_code: teamCode,
    player_name: playerName,
    session_date: s.session_date,
    session_type: s.session_type,
    fatigue_level: s.fatigue_level,
    condition_level: s.condition_level,
    distance_m: s.distance_m ?? null,
    reps: s.reps ?? null,
    sets: s.sets ?? null,
  }))
  const { error } = await supabase.from('team_sessions').upsert(rows, { onConflict: 'id' })
  if (error && __DEV__) console.warn('[syncTeamSessions]', error.message)
}

export async function deletePlayerTeamSessions(teamCode: string, playerName: string): Promise<void> {
  if (!isConfigured) return
  const { error } = await supabase.from('team_sessions')
    .delete()
    .eq('team_code', teamCode)
    .eq('player_name', playerName)
  if (error && __DEV__) console.warn('[deletePlayerTeamSessions]', error.message)
}

// 非公開設定時: セッション削除 + player_stats のセッション関連フィールドをリセット
export async function clearPlayerPrivateData(teamCode: string, playerName: string): Promise<void> {
  if (!isConfigured) return
  await supabase.from('team_sessions')
    .delete()
    .eq('team_code', teamCode)
    .eq('player_name', playerName)
  // last_session_date を空にしてコーチ側で「未同期」扱いにする
  await supabase.from('team_player_stats')
    .update({ last_session_date: '', sessions_30d: 0, last_condition: 0, last_fatigue: 0, updated_at: new Date().toISOString() })
    .eq('team_code', teamCode)
    .eq('player_name', playerName)
}

export async function fetchTeamSessions(teamCode: string): Promise<TeamSessionRow[]> {
  if (!isConfigured) return []
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data } = await supabase
    .from('team_sessions').select('*')
    .eq('team_code', teamCode)
    .gte('session_date', cutoff)
    .order('session_date', { ascending: false })
  return (data ?? []) as TeamSessionRow[]
}

// ── 選手プロフィール（自己ベスト・レベル）────────────────
export interface PlayerStatsRow {
  team_code:         string
  player_name:       string
  event:             string
  pb_display:        string
  level:             number
  last_condition:    number
  last_fatigue:      number
  last_session_date: string
  sessions_30d:      number
  goal:              string
  streak:            number   // 連続記録日数（セッション保存時に更新）
  updated_at:        string
}

export async function fetchPlayerStats(teamCode: string): Promise<PlayerStatsRow[]> {
  if (!isConfigured) return []
  const { data } = await supabase
    .from('team_player_stats').select('*')
    .eq('team_code', teamCode)
  return (data ?? []) as PlayerStatsRow[]
}

export async function upsertPlayerStats(
  teamCode: string,
  playerName: string,
  event: string,
  pbDisplay: string,
  level: number,
  lastCondition = 7,
  lastFatigue = 5,
  lastSessionDate = '',
  sessions30d = 0,
  goal = '',
  streak = 0,
): Promise<void> {
  if (!isConfigured) return
  // 段階的フォールバック: streak → goal → base の順で試みる
  const baseRow = {
    team_code: teamCode, player_name: playerName, event, pb_display: pbDisplay, level,
    last_condition: lastCondition, last_fatigue: lastFatigue,
    last_session_date: lastSessionDate, sessions_30d: sessions30d,
    updated_at: new Date().toISOString(),
  }
  const fullRow = { ...baseRow, goal, streak }
  const { error } = await supabase.from('team_player_stats').upsert(
    fullRow, { onConflict: 'team_code,player_name' },
  )
  if (!error) return
  // 失敗時はサイレントに無視（IO節約のためリトライなし）
  if (__DEV__) console.warn('[upsertPlayerStats] upsert failed:', error.message)
}

// ── チーム共有カレンダー ────────────────────────────────────
export type TeamEventType = 'practice' | 'race' | 'rest' | 'meeting' | 'other'

export interface TeamEventRow {
  id:          string
  team_code:   string
  title:       string
  event_date:  string
  event_time:  string
  location:    string
  description: string
  event_type:  TeamEventType
  created_by:  string
  created_at:  string
}

export async function fetchTeamEvents(teamCode: string): Promise<TeamEventRow[]> {
  if (!isConfigured) return []
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('team_events').select('*')
    .eq('team_code', teamCode)
    .gte('event_date', from)
    .order('event_date', { ascending: true })
  if (error) console.warn('[fetchTeamEvents]', error.message)
  return (data ?? []) as TeamEventRow[]
}

export async function addTeamEvent(
  teamCode: string,
  title: string,
  eventDate: string,
  eventTime: string,
  location: string,
  description: string,
  eventType: TeamEventType,
  createdBy: string,
): Promise<TeamEventRow | null> {
  if (!isConfigured) throw new Error('Supabase未設定 — 環境変数を確認してください')
  const { data, error } = await supabase
    .from('team_events')
    .insert({ team_code: teamCode, title, event_date: eventDate, event_time: eventTime, location, description, event_type: eventType, created_by: createdBy })
    .select().single()
  if (error) throw new Error(error.message)
  return data as TeamEventRow | null
}

export async function deleteTeamEvent(id: string): Promise<void> {
  if (!isConfigured) return
  await supabase.from('team_events').delete().eq('id', id)
}

// ── コーチ通知（team_messages テーブルを再利用）────────────────────
export type CoachNotifType = 'absence' | 'video' | 'risk_alert' | 'message'

export async function sendCoachNotification(
  teamCode: string,
  type: CoachNotifType,
  playerName: string,
  content: string,
): Promise<void> {
  if (!isConfigured) return
  await supabase.from('team_messages').insert({
    team_code: teamCode,
    content: `[${type.toUpperCase()}] ${content}`,
    author_name: '__system__',
    is_pinned: false,
  })
}

export async function fetchCoachNotifications(teamCode: string): Promise<TeamMessageRow[]> {
  if (!isConfigured) return []
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('team_messages').select('*')
    .eq('team_code', teamCode)
    .eq('author_name', '__system__')
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false })
  return (data ?? []) as TeamMessageRow[]
}

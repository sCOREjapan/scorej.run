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
  await supabase.from('teams').upsert(
    { code, team_name: teamName, coach_name: coachName },
    { onConflict: 'code' },
  )
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
  joined_at: string
}

export async function registerMember(teamCode: string, playerName: string, event = ''): Promise<void> {
  if (!isConfigured) return
  await supabase.from('team_members').upsert(
    { id: `${teamCode}_${playerName}`, team_code: teamCode, player_name: playerName, event },
    { onConflict: 'id' },
  )
}

export async function deleteMember(id: string): Promise<void> {
  if (!isConfigured) return
  await supabase.from('team_members').delete().eq('id', id)
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
  if (!isConfigured) return null
  const { data } = await supabase
    .from('team_messages')
    .insert({ team_code: teamCode, content, author_name: authorName, is_pinned: false })
    .select().single()
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
  team_code: string
  player_name: string
  parts: string[]
  updated_at: string
}

export async function fetchBodyReports(teamCode: string): Promise<BodyReportRow[]> {
  if (!isConfigured) return []
  const { data } = await supabase
    .from('team_body_reports').select('*')
    .eq('team_code', teamCode)
  return (data ?? []) as BodyReportRow[]
}

export async function upsertBodyReport(teamCode: string, playerName: string, parts: string[]): Promise<void> {
  if (!isConfigured) return
  await supabase.from('team_body_reports').upsert(
    { team_code: teamCode, player_name: playerName, parts, updated_at: new Date().toISOString() },
    { onConflict: 'team_code,player_name' },
  )
}

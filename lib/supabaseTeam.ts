// lib/supabaseTeam.ts — チームデータ Supabase CRUD
//
// 2026-09-02: チームテーブルのRLSが `using(true)` で全公開になっており、team_codeを
// 知らなくても全チームのデータを読み書き削除できる不具合があった(supabase/fix_team_tables_rls.sql
// 参照)。この機能はログイン不要・招待コード方式で、team_membersにアカウント紐付けが無い
// ため「本人確認」ベースのRLSが組めない。代わりに、クライアントが知っているteam_codeを
// `X-Team-Code` ヘッダーで申告し、そのcodeに一致する行にしかRLSが通らないようにした。
// このファイルの全関数は、通常の共有supabaseクライアントではなく、この専用クライアントを
// 経由してteam_*テーブルにアクセスすること。
import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = process.env.EXPO_PUBLIC_SUPABASE_URL     ?? ''
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

const isConfigured = !!(supabaseUrl && supabaseUrl !== 'placeholder')

function teamScopedClient(teamCode: string, coachSecret?: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: {
      'X-Team-Code': teamCode,
      ...(coachSecret ? { 'X-Coach-Secret': coachSecret } : {}),
    } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ── チーム ────────────────────────────────────────────────
export interface TeamRow {
  code: string
  team_name: string
  coach_name: string
  coach_avatar_key?: string
  created_at: string
}

// 2026-09-30: coachSecretを渡すと teams.coach_secret に書き込む。この値が設定されている
// チームは、以後deleteTeam()に同じ秘密を渡さないと削除できなくなる(参加コードだけを
// 知っている選手には削除させないため。supabase/fix_team_delete_requires_coach_secret.sql参照)。
export async function createTeam(code: string, teamName: string, coachName: string, coachSecret?: string): Promise<void> {
  if (!isConfigured) return
  const { error } = await teamScopedClient(code).from('teams').upsert(
    { code, team_name: teamName, coach_name: coachName, ...(coachSecret ? { coach_secret: coachSecret } : {}) },
    { onConflict: 'code' },
  )
  if (error) throw new Error(error.message)
}

// 2026-09-21: コーチのプロフィールアバター登録用（プリセットキャラクターのキー。
// supabase/team_avatars_migration.sql・lib/avatarAssets.ts参照）
export async function setCoachAvatar(teamCode: string, avatarKey: string): Promise<void> {
  if (!isConfigured) return
  const { error } = await teamScopedClient(teamCode).from('teams')
    .update({ coach_avatar_key: avatarKey })
    .eq('code', teamCode)
  if (error) throw new Error(error.message)
}

export async function fetchTeamByCode(code: string): Promise<TeamRow | null> {
  if (!isConfigured) return null
  const { data } = await teamScopedClient(code)
    .from('teams').select('*')
    .eq('code', code)
    .single()
  return data as TeamRow | null
}

// 2026-09-09: コーチ側の「チームを削除」はこれまでAsyncStorageのローカルキー
// (ROLE_KEY/SETUP_KEY)しか消しておらず、Supabase側のteams行が残ったままだった。
// 確認ダイアログには「参加コードが無効になり、全メンバーのデータが失われます」と
// 表示されるが実際には何も削除されておらず、削除後もそのコードで選手が参加でき
// 続ける（=コーチが「消した」と思っているチームにデータが蓄積し続ける）不具合が
// あった。teamsテーブルの行を削除すればon delete cascadeで関連7テーブル
// (team_members/team_messages/team_videos/team_body_reports/team_player_stats/
// team_sessions/team_events)も自動的に連鎖削除される（supabase/schema.sql参照）。
export async function deleteTeam(code: string, coachSecret?: string): Promise<void> {
  if (!isConfigured) return
  const { error } = await teamScopedClient(code, coachSecret).from('teams').delete().eq('code', code)
  if (error) throw new Error(error.message)
}

// ── プッシュ通知トークン(Expo Push) ──────────────────────────
export async function registerTeamPushToken(teamCode: string, role: 'coach' | 'player', pushToken: string): Promise<void> {
  if (!isConfigured) return
  await teamScopedClient(teamCode).from('team_push_tokens').upsert(
    { team_code: teamCode, role, push_token: pushToken, updated_at: new Date().toISOString() },
    { onConflict: 'team_code,push_token' },
  )
}

// ── メンバー ──────────────────────────────────────────────
export interface TeamMemberRow {
  id: string
  team_code: string
  player_name: string
  event: string
  icon?: string
  avatar_key?: string
  joined_at: string
}

export async function registerMember(
  teamCode: string, playerName: string, event = '', icon = '', avatarKey = '',
): Promise<void> {
  if (!isConfigured) return
  const row: Record<string, string> = { id: `${teamCode}_${playerName}`, team_code: teamCode, player_name: playerName, event }
  if (icon) row.icon = icon
  if (avatarKey) row.avatar_key = avatarKey
  const { error } = await teamScopedClient(teamCode).from('team_members').upsert(row, { onConflict: 'id' })
  if (error) throw new Error(error.message)
}

export async function deleteMember(teamCode: string, id: string): Promise<void> {
  if (!isConfigured) return
  const { error } = await teamScopedClient(teamCode).from('team_members').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function fetchMembers(teamCode: string): Promise<TeamMemberRow[]> {
  if (!isConfigured) return []
  const { data } = await teamScopedClient(teamCode)
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
  const { data } = await teamScopedClient(teamCode)
    .from('team_messages').select('*')
    .eq('team_code', teamCode)
    .order('created_at', { ascending: false })
  return (data ?? []) as TeamMessageRow[]
}

export async function postMessage(teamCode: string, content: string, authorName: string): Promise<TeamMessageRow | null> {
  if (!isConfigured) return null  // 未設定時はサイレント（他の関数と統一）
  const { data, error } = await teamScopedClient(teamCode)
    .from('team_messages')
    .insert({ team_code: teamCode, content, author_name: authorName, is_pinned: false })
    .select().single()
  if (error) throw new Error(error.message)
  return data as TeamMessageRow | null
}

export async function setPinMessage(teamCode: string, id: string, isPinned: boolean): Promise<void> {
  if (!isConfigured) return
  await teamScopedClient(teamCode).from('team_messages').update({ is_pinned: isPinned }).eq('id', id)
}

export async function deleteMessage(teamCode: string, id: string): Promise<void> {
  if (!isConfigured) return
  await teamScopedClient(teamCode).from('team_messages').delete().eq('id', id)
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
  const { data } = await teamScopedClient(teamCode)
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
  await teamScopedClient(teamCode).from('team_videos')
    .insert({ team_code: teamCode, player_name: playerName, url, description })
}

export async function markVideoWatched(teamCode: string, id: string): Promise<void> {
  if (!isConfigured) return
  await teamScopedClient(teamCode).from('team_videos').update({ watched: true }).eq('id', id)
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
  const { data } = await teamScopedClient(teamCode)
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
  await teamScopedClient(teamCode).from('team_body_reports').upsert(
    { team_code: teamCode, player_name: playerName, parts, detail, acked_by_coach: false, updated_at: new Date().toISOString() },
    { onConflict: 'team_code,player_name' },
  )
}

// 2026-09-26実機バグ修正: 戻り値で更新件数を分かるようにした。0件はteam.tsx側で
// 「RLSブロック or 該当行なし」として専用のエラーメッセージを出すために使う。
export async function ackBodyReport(teamCode: string, playerName: string): Promise<boolean> {
  if (!isConfigured) return false
  const { data, error } = await teamScopedClient(teamCode).from('team_body_reports')
    .update({ acked_by_coach: true })
    .eq('team_code', teamCode)
    .eq('player_name', playerName)
    .select()
  if (error) throw new Error(error.message)
  return !!data && data.length > 0
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
  notes: string | null
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
    notes?: string
  }>,
): Promise<void> {
  if (!isConfigured) return
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const recent = sessions.filter(s => s.session_date >= cutoff)
  if (!recent.length) return
  // 2026-09-26:「選手からノートを集める機能」対応。以前はnotesを一切含めずupsertしていた
  // ため、共有レベルが「フル共有」(呼び出し元でnotesをstripしない設定)の選手のメモも
  // 実際にはコーチへ届いていなかった。呼び出し元(lib/teamAutoSync.ts等)が既に共有レベルに
  // 応じてnotesをstrip/skipしているため、ここでは受け取った値をそのまま渡すだけでよい。
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
    notes: s.notes ?? null,
  }))
  const { error } = await teamScopedClient(teamCode).from('team_sessions').upsert(rows, { onConflict: 'id' })
  if (error && __DEV__) console.warn('[syncTeamSessions]', error.message)
}

export async function deletePlayerTeamSessions(teamCode: string, playerName: string): Promise<void> {
  if (!isConfigured) return
  const { error } = await teamScopedClient(teamCode).from('team_sessions')
    .delete()
    .eq('team_code', teamCode)
    .eq('player_name', playerName)
  if (error && __DEV__) console.warn('[deletePlayerTeamSessions]', error.message)
}

// 非公開設定時: セッション削除 + player_stats のセッション関連フィールドをリセット
export async function clearPlayerPrivateData(teamCode: string, playerName: string): Promise<void> {
  if (!isConfigured) return
  const client = teamScopedClient(teamCode)
  await client.from('team_sessions')
    .delete()
    .eq('team_code', teamCode)
    .eq('player_name', playerName)
  // 2026-09-26: team_mealsも同じ非公開ルールの対象に追加
  await client.from('team_meals')
    .delete()
    .eq('team_code', teamCode)
    .eq('player_name', playerName)
  // last_session_date を空にしてコーチ側で「未同期」扱いにする
  await client.from('team_player_stats')
    .update({ last_session_date: '', sessions_30d: 0, last_condition: 0, last_fatigue: 0, updated_at: new Date().toISOString() })
    .eq('team_code', teamCode)
    .eq('player_name', playerName)
}

// ── 食事記録の共有（コーチが選手の食事の時間・内容を閲覧） ──────────
// 2026-09-26:「食事の時間と内容がコーチに分かるといい」との指示で追加。
// 呼び出し元(lib/teamAutoSync.ts)がフル共有(shareLv>=2)の選手のみ呼ぶ想定
// (team_sessions.notesと同じ扱い。ここでは共有レベルの判定は行わない)。
export interface TeamMealRow {
  id: string
  team_code: string
  player_name: string
  meal_date: string
  meal_type: string
  foods: { name: string; calories: number; protein: number; carb: number; fat: number }[]
  total_calories: number
  total_protein: number
  total_carb: number
  total_fat: number
  training_timing: string | null
  meal_created_at: string
  synced_at: string
}

export async function syncTeamMeal(
  teamCode: string,
  playerName: string,
  meal: {
    id: string
    meal_date: string
    meal_type: string
    foods: { name: string; calories: number; protein: number; carb: number; fat: number }[]
    total_calories: number
    total_protein: number
    total_carb: number
    total_fat: number
    training_timing?: string
    created_at: string
  },
): Promise<void> {
  if (!isConfigured) return
  const row = {
    id: meal.id,
    team_code: teamCode,
    player_name: playerName,
    meal_date: meal.meal_date,
    meal_type: meal.meal_type,
    foods: meal.foods,
    total_calories: meal.total_calories,
    total_protein: meal.total_protein,
    total_carb: meal.total_carb,
    total_fat: meal.total_fat,
    training_timing: meal.training_timing ?? null,
    meal_created_at: meal.created_at,
  }
  const { error } = await teamScopedClient(teamCode).from('team_meals').upsert(row, { onConflict: 'id' })
  if (error && __DEV__) console.warn('[syncTeamMeal]', error.message)
}

export async function fetchTeamMeals(teamCode: string): Promise<TeamMealRow[]> {
  if (!isConfigured) return []
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data } = await teamScopedClient(teamCode)
    .from('team_meals').select('*')
    .eq('team_code', teamCode)
    .gte('meal_date', cutoff)
    .order('meal_created_at', { ascending: false })
  return (data ?? []) as TeamMealRow[]
}

// ── ウォームアップ完了時刻の共有（内容は記録せず、完了時刻のみ最小実装） ──
// 2026-09-26:「アップの時間がコーチに分かるといい」との指示で追加。
// 1日1件のupsert（team_code, player_name, warmup_dateの複合主キー）。
export interface TeamWarmupRow {
  team_code: string
  player_name: string
  warmup_date: string
  completed_at: string
  synced_at: string
}

export async function syncTeamWarmupCompletion(
  teamCode: string,
  playerName: string,
  warmupDate: string,
  completedAt: string,
): Promise<void> {
  if (!isConfigured) return
  const { error } = await teamScopedClient(teamCode).from('team_warmups').upsert(
    { team_code: teamCode, player_name: playerName, warmup_date: warmupDate, completed_at: completedAt },
    { onConflict: 'team_code,player_name,warmup_date' },
  )
  if (error && __DEV__) console.warn('[syncTeamWarmupCompletion]', error.message)
}

export async function fetchTeamWarmups(teamCode: string): Promise<TeamWarmupRow[]> {
  if (!isConfigured) return []
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data } = await teamScopedClient(teamCode)
    .from('team_warmups').select('*')
    .eq('team_code', teamCode)
    .gte('warmup_date', cutoff)
    .order('completed_at', { ascending: false })
  return (data ?? []) as TeamWarmupRow[]
}

export async function fetchTeamSessions(teamCode: string): Promise<TeamSessionRow[]> {
  if (!isConfigured) return []
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data } = await teamScopedClient(teamCode)
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
  const { data } = await teamScopedClient(teamCode)
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
  const { error } = await teamScopedClient(teamCode).from('team_player_stats').upsert(
    fullRow, { onConflict: 'team_code,player_name' },
  )
  if (!error) return
  // 失敗時はサイレントに無視（IO節約のためリトライなし）
  if (__DEV__) console.warn('[upsertPlayerStats] upsert failed:', error.message)
}

// ── 自己ベスト更新イベント（コーチ向けフィード用）──────────
// 2026-09-16: team_player_statsは現在値のみでいつ更新されたかの履歴がない。
// PBが実際に変化した瞬間だけ1行記録し、コーチのホーム画面に「◯◯選手が
// 100mで自己ベスト更新！」のフィードを出せるようにする（supabase/team_pb_events_migration.sql参照）。
export interface TeamPbEventRow {
  id:          string
  team_code:   string
  player_name: string
  event:       string
  old_pb:      string
  new_pb:      string
  achieved_at: string
}

export async function recordPbUpdate(
  teamCode: string, playerName: string, event: string, oldPb: string, newPb: string,
): Promise<void> {
  if (!isConfigured) return
  const row = {
    id: `${teamCode}_${playerName}_${Date.now()}`,
    team_code: teamCode, player_name: playerName, event, old_pb: oldPb, new_pb: newPb,
  }
  const { error } = await teamScopedClient(teamCode).from('team_pb_events').insert(row)
  if (error && __DEV__) console.warn('[recordPbUpdate]', error.message)
}

export async function fetchRecentPbUpdates(teamCode: string, limit = 10): Promise<TeamPbEventRow[]> {
  if (!isConfigured) return []
  const { data } = await teamScopedClient(teamCode)
    .from('team_pb_events').select('*')
    .eq('team_code', teamCode)
    .order('achieved_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as TeamPbEventRow[]
}

// ── レース行動予定（選手→コーチへ1枚のデータとして提出）─────
// 2026-09-20: コーチ(みずの)から実際にあった要望「試合当日の行動予定表を選手が
// 作り、コーチに提出できるように」に基づく。ブロックを都度同期するのではなく、
// 選手が「提出する」を押した時点の完成品（ブロック配列＋目標＋意気込み）を
// 1レース＝1行としてまとめて書き込む（supabase/team_race_plans_migration.sql参照）。
export interface RacePlanBlock {
  time:    string
  content: string
}

export interface TeamRacePlanRow {
  id:           string
  team_code:    string
  player_name:  string
  title:        string
  race_date:    string
  event_id:     string
  blocks:       RacePlanBlock[]
  target_time:  string
  splits:       string
  goal:         string
  submitted_at: string
}

export async function submitRacePlan(
  teamCode: string, playerName: string,
  payload: { title: string; raceDate: string; eventId?: string; blocks: RacePlanBlock[]; targetTime: string; splits: string; goal: string },
): Promise<void> {
  if (!isConfigured) return
  const row = {
    id: `${teamCode}_${playerName}_${Date.now()}`,
    team_code: teamCode, player_name: playerName,
    title: payload.title, race_date: payload.raceDate, event_id: payload.eventId || null,
    blocks: payload.blocks, target_time: payload.targetTime, splits: payload.splits, goal: payload.goal,
  }
  const { error } = await teamScopedClient(teamCode).from('team_race_plans').insert(row)
  if (error) throw new Error(error.message)
}

export async function fetchRacePlans(teamCode: string, playerName?: string): Promise<TeamRacePlanRow[]> {
  if (!isConfigured) return []
  let q = teamScopedClient(teamCode).from('team_race_plans').select('*').eq('team_code', teamCode)
  if (playerName) q = q.eq('player_name', playerName)
  const { data } = await q.order('submitted_at', { ascending: false })
  return (data ?? []) as TeamRacePlanRow[]
}

// 2026-09-21: 「登録した大会にも、それぞれの選手のカードが紐づくように」との要望で追加。
// コーチが特定の大会(team_events)を開いたとき、その大会に紐づく全選手の提出済み
// レース行動予定を横断的に見られるようにする。
export async function fetchRacePlansByEvent(teamCode: string, eventId: string): Promise<TeamRacePlanRow[]> {
  if (!isConfigured) return []
  const { data } = await teamScopedClient(teamCode)
    .from('team_race_plans').select('*')
    .eq('team_code', teamCode)
    .eq('event_id', eventId)
    .order('submitted_at', { ascending: false })
  return (data ?? []) as TeamRacePlanRow[]
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
  const { data, error } = await teamScopedClient(teamCode)
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
  const { data, error } = await teamScopedClient(teamCode)
    .from('team_events')
    .insert({ team_code: teamCode, title, event_date: eventDate, event_time: eventTime, location, description, event_type: eventType, created_by: createdBy })
    .select().single()
  if (error) throw new Error(error.message)
  return data as TeamEventRow | null
}

export async function deleteTeamEvent(teamCode: string, id: string): Promise<void> {
  if (!isConfigured) return
  await teamScopedClient(teamCode).from('team_events').delete().eq('id', id)
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
  await teamScopedClient(teamCode).from('team_messages').insert({
    team_code: teamCode,
    content: `[${type.toUpperCase()}] ${content}`,
    author_name: '__system__',
    is_pinned: false,
  })
}

export async function fetchCoachNotifications(teamCode: string): Promise<TeamMessageRow[]> {
  if (!isConfigured) return []
  const { data } = await teamScopedClient(teamCode)
    .from('team_messages').select('*')
    .eq('team_code', teamCode)
    .eq('author_name', '__system__')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
  return (data ?? []) as TeamMessageRow[]
}

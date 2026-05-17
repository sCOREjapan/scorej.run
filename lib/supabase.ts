// lib/supabase.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'

const supabaseUrl     = process.env.EXPO_PUBLIC_SUPABASE_URL     ?? ''
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

const IS_PLACEHOLDER = !supabaseUrl || supabaseUrl === 'placeholder'

// React Native 用 AsyncStorage アダプター
// window.localStorage は React Native では undefined になるため必ず AsyncStorage を使う
const asyncStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try { return await AsyncStorage.getItem(key) } catch { return null }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try { await AsyncStorage.setItem(key, value) } catch {}
  },
  removeItem: async (key: string): Promise<void> => {
    try { await AsyncStorage.removeItem(key) } catch {}
  },
}

// placeholder のときはダミーオブジェクトを返す（クラッシュ防止）
function makeDummyClient(): SupabaseClient {
  const noop = () => ({
    select: () => Promise.resolve({ data: [], error: null }),
    insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    upsert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
    eq: () => ({ gte: () => ({ order: () => Promise.resolve({ data: [], error: null }) }), eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }), order: () => Promise.resolve({ data: [], error: null }) }),
    gte: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
    order: () => Promise.resolve({ data: [], error: null }),
    single: () => Promise.resolve({ data: null, error: null }),
  })
  return {
    from: noop,
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: () => Promise.resolve({ data: null, error: { message: 'dummy' } }),
      signUp: () => Promise.resolve({ data: null, error: { message: 'dummy' } }),
      signInWithOAuth: () => Promise.resolve({ data: null, error: { message: 'dummy' } }),
      signOut: () => Promise.resolve({ error: null }),
    },
  } as unknown as SupabaseClient
}

export const supabase: SupabaseClient = IS_PLACEHOLDER
  ? makeDummyClient()
  : createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // ネイティブでは URL ベースの検出不要
        detectSessionInUrl: Platform.OS === 'web',
        autoRefreshToken: true,
        persistSession: true,
        // OAuth は PKCE フロー（コード横取り攻撃への耐性が高い）
        flowType: 'pkce',
        // ネイティブは AsyncStorage、Web は localStorage
        storage: Platform.OS !== 'web'
          ? asyncStorageAdapter
          : (typeof window !== 'undefined' ? window.localStorage : undefined),
      },
    })

if (IS_PLACEHOLDER) {
  console.warn('[Supabase] EXPO_PUBLIC_SUPABASE_URL が未設定です。ダミーモードで動作します。')
}

// ─────────────────────────────────────────
// トレーニング記録
// ─────────────────────────────────────────
export async function insertSession(session: Omit<import('../types').TrainingSession, 'id' | 'created_at'>) {
  if (IS_PLACEHOLDER) return null
  const { data, error } = await supabase
    .from('training_sessions')
    .insert(session)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getRecentSessions(userId: string, days = 30) {
  if (IS_PLACEHOLDER) return []
  const since = new Date()
  since.setDate(since.getDate() - days)
  const { data, error } = await supabase
    .from('training_sessions')
    .select('*')
    .eq('user_id', userId)
    .gte('session_date', since.toISOString().slice(0, 10))
    .order('session_date', { ascending: false })
  if (error) throw error
  return data
}

// ─────────────────────────────────────────
// 食事記録
// ─────────────────────────────────────────
export async function insertMeal(meal: Omit<import('../types').MealRecord, 'id' | 'created_at'>) {
  if (IS_PLACEHOLDER) return null
  const { data, error } = await supabase
    .from('meals')
    .insert(meal)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getMealsForDate(userId: string, date: string) {
  if (IS_PLACEHOLDER) return []
  const { data, error } = await supabase
    .from('meals')
    .select('*')
    .eq('user_id', userId)
    .eq('meal_date', date)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

// ─────────────────────────────────────────
// 睡眠記録
// ─────────────────────────────────────────
export async function upsertSleep(record: Omit<import('../types').SleepRecord, 'id' | 'created_at'>) {
  if (IS_PLACEHOLDER) return null
  const { data, error } = await supabase
    .from('sleep_records')
    .upsert(record, { onConflict: 'user_id,sleep_date' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getRecentSleep(userId: string, days = 14) {
  if (IS_PLACEHOLDER) return []
  const since = new Date()
  since.setDate(since.getDate() - days)
  const { data, error } = await supabase
    .from('sleep_records')
    .select('*')
    .eq('user_id', userId)
    .gte('sleep_date', since.toISOString().slice(0, 10))
    .order('sleep_date', { ascending: false })
  if (error) throw error
  return data
}

// ─────────────────────────────────────────
// 試合計画
// ─────────────────────────────────────────
export async function saveCompetitionPlan(plan: Omit<import('../types').CompetitionPlan, 'id' | 'created_at'>) {
  if (IS_PLACEHOLDER) return null
  const { data, error } = await supabase
    .from('competition_plans')
    .insert(plan)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getUpcomingCompetitions(userId: string) {
  if (IS_PLACEHOLDER) return []
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('competition_plans')
    .select('*')
    .eq('user_id', userId)
    .gte('competition_date', today)
    .order('competition_date', { ascending: true })
  if (error) throw error
  return data
}

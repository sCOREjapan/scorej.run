// app/(tabs)/team.tsx — チーム機能 v3（Supabase同期 + OneSignal通知）
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Modal, Linking, Dimensions,
  Animated, Easing, ActivityIndicator, Alert, RefreshControl,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
const SCREEN_H = Dimensions.get('window').height
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { BRAND, TEXT } from '../../lib/theme'
import AnimatedSection from '../../components/AnimatedSection'
import { calcInjuryRisk, type InjuryRiskResult } from '../../lib/injuryRisk'
import { calcLevelInfo, RANK_TIERS } from '../../lib/gamification'
import { getCachedWeather } from '../../lib/weather'
import { calcWeatherRiskBonus } from '../../lib/weatherRisk'
import type { TrainingSession, SleepRecord } from '../../types'
import { supabase } from '../../lib/supabase'
import {
  fetchMessages, postMessage, setPinMessage, deleteMessage,
  fetchVideos, submitVideo, markVideoWatched,
  fetchBodyReports, upsertBodyReport, ackBodyReport,
  fetchMembers, registerMember, deleteMember,
  fetchPlayerStats, upsertPlayerStats,
  syncTeamSessions, fetchTeamSessions,
  fetchTeamEvents, addTeamEvent, deleteTeamEvent,
  createTeam, fetchTeamByCode,
  sendCoachNotification,
  type TeamMessageRow, type TeamVideoRow, type BodyReportRow, type TeamMemberRow, type PlayerStatsRow, type TeamSessionRow, type TeamEventRow, type TeamEventType,
} from '../../lib/supabaseTeam'
import { useTheme } from '../../context/ThemeContext'
import { usePurchase } from '../../context/PurchaseContext'
import { useTrainingSessions } from '../../hooks/useTrainingSessions'
import HapticTouch from '../../components/HapticTouch'
import {
  initOneSignal, requestPushPermission, registerUserTags, sendPush,
} from '../../lib/notify'
import PulseView from '../../components/PulseView'
import { streakMilestone } from '../../lib/haptics'

// ── 練習メニュービルダー 型定義 ──────────────────────────
type MenuCategory = 'warm_up' | 'sprint' | 'interval' | 'tempo' | 'drill' | 'strength' | 'cool_down' | 'other'
type MenuIntensity = 'low' | 'medium' | 'high'

interface MenuTemplate {
  id: string
  title: string
  category: MenuCategory
  detail: string
  duration: number        // 分
  intensity: MenuIntensity
  createdAt: string
}

interface TodayPlan {
  id: string
  date: string
  title: string
  items: MenuTemplate[]
  note: string
  sharedAt?: string
}

const MENU_CATEGORY_CFG: Record<MenuCategory, { label: string; emoji: string; color: string }> = {
  warm_up:   { label: 'ウォームアップ', emoji: '🔥', color: '#FF9500' },
  sprint:    { label: 'スプリント',     emoji: '⚡',  color: '#FF3B30' },
  interval:  { label: 'インターバル',   emoji: '🏃',  color: '#E53935' },
  tempo:     { label: 'テンポ走',       emoji: '💨',  color: '#FF6B35' },
  drill:     { label: 'ドリル',         emoji: '🎯',  color: '#AF52DE' },
  strength:  { label: '補強',           emoji: '💪',  color: '#007AFF' },
  cool_down: { label: 'クールダウン',   emoji: '❄️',  color: '#5AC8FA' },
  other:     { label: 'その他',          emoji: '📋',  color: '#8E8E93' },
}
const MENU_INTENSITY_CFG: Record<MenuIntensity, { label: string; color: string }> = {
  low:    { label: '低強度', color: '#34C759' },
  medium: { label: '中強度', color: '#FF9500' },
  high:   { label: '高強度', color: '#FF3B30' },
}

// ── ストレージキー（ローカル設定のみ） ────────────────────
const ROLE_KEY            = 'trackmate_team_role'
const SESSIONS_KEY        = 'trackmate_sessions'
const SETUP_KEY           = 'trackmate_team_setup'
const JOINED_KEY          = 'trackmate_team_joined'
const MENU_LIBRARY_KEY    = 'trackmate_coach_menu_library'
const TODAY_PLAN_KEY      = 'trackmate_coach_today_plan'
const SLEEP_KEY           = 'trackmate_sleep'
const CONDITION_MAP_KEY   = 'trackmate_condition_map'
const RECOVERY_KEY        = 'trackmate_recovery_records'
const STRETCH_RESULT_KEY  = 'trackmate_stretch_result'

type Role = 'coach' | 'player'

// ── 型定義 ────────────────────────────────────────────────
interface TeamSetup  { teamName: string; coachName: string; code: string; createdAt: string }
interface JoinedTeam { code: string; teamName: string; coachName: string; playerName: string; joinedAt: string }
type TeamMessage = TeamMessageRow
type VideoEntry  = TeamVideoRow

// ── 痛み部位リスト ────────────────────────────────────────
const BODY_PARTS = [
  { id: 'head',       label: '頭・首',   side: 'center' },
  { id: 'shoulder_r', label: '右肩',     side: 'right' },
  { id: 'shoulder_l', label: '左肩',     side: 'left' },
  { id: 'elbow_r',    label: '右腕・肘', side: 'right' },
  { id: 'back_upper', label: '背中・胸', side: 'center' },
  { id: 'elbow_l',    label: '左腕・肘', side: 'left' },
  { id: 'back_lower', label: '腰',       side: 'center' },
  { id: 'hip_r',      label: '右股関節', side: 'right' },
  { id: 'hip_l',      label: '左股関節', side: 'left' },
  { id: 'knee_r',     label: '右膝',     side: 'right' },
  { id: 'knee_l',     label: '左膝',     side: 'left' },
  { id: 'ankle_r',    label: '右足首',   side: 'right' },
  { id: 'ankle_l',    label: '左足首',   side: 'left' },
]

// ── デモメンバー（Supabaseにデータがない時のフォールバック）─
type Member = { id: string; name: string; event: string; sessions: TrainingSession[]; lastActive: string; painParts?: string[]; painDetail?: string; ackedByCoach?: boolean }
const DEMO_MEMBERS: Member[] = [
  {
    id: 'demo-tanaka', name: '田中 翼', event: '100m / 200m',
    lastActive: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    painParts: ['knee_r', 'back_lower'],
    sessions: [
      { id:'s1', user_id:'demo-tanaka', session_date: new Date(Date.now()-86400000).toISOString().slice(0,10), session_type:'interval', fatigue_level:8, condition_level:5, distance_m:3000, created_at:'' },
      { id:'s2', user_id:'demo-tanaka', session_date: new Date(Date.now()-172800000).toISOString().slice(0,10), session_type:'interval', fatigue_level:8, condition_level:5, distance_m:4000, created_at:'' },
    ],
  },
  {
    id: 'demo-suzuki', name: '鈴木 愛', event: '5000m',
    lastActive: new Date().toISOString().slice(0, 10),
    sessions: [
      { id:'s3', user_id:'demo-suzuki', session_date: new Date().toISOString().slice(0,10), session_type:'easy', fatigue_level:4, condition_level:8, distance_m:10000, created_at:'' },
    ],
  },
  {
    id: 'demo-sato', name: '佐藤 ひな', event: '400m / 400mH',
    lastActive: new Date(Date.now()-259200000).toISOString().slice(0, 10),
    painParts: ['ankle_l'],
    sessions: [
      { id:'s4', user_id:'demo-sato', session_date: new Date(Date.now()-259200000).toISOString().slice(0,10), session_type:'interval', fatigue_level:10, condition_level:4, distance_m:3200, created_at:'' },
      { id:'s5', user_id:'demo-sato', session_date: new Date(Date.now()-345600000).toISOString().slice(0,10), session_type:'interval', fatigue_level:9, condition_level:4, distance_m:2800, created_at:'' },
    ],
  },
  {
    id: 'demo-ito', name: '伊藤 拓海', event: '1500m',
    lastActive: new Date().toISOString().slice(0, 10),
    sessions: [
      { id:'s6', user_id:'demo-ito', session_date: new Date().toISOString().slice(0,10), session_type:'easy', fatigue_level:2, condition_level:9, distance_m:8000, created_at:'' },
    ],
  },
]

// ── ユーティリティ ────────────────────────────────────────
function generateCode() { return Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6).padEnd(6,'0') }
function formatCode(c: string) { const s = c.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6); return s.length > 3 ? `${s.slice(0,3)}-${s.slice(3)}` : s }
function daysSince(d: string) { const n = Math.floor((Date.now()-new Date(d).getTime())/86400000); return n===0?'今日':n===1?'昨日':`${n}日前` }
function timeAgo(iso: string) { const m = Math.floor((Date.now()-new Date(iso).getTime())/60000); return m<1?'たった今':m<60?`${m}分前`:m<1440?`${Math.floor(m/60)}時間前`:daysSince(iso) }
function daysLeft(iso: string) { return Math.max(0, 7 - Math.floor((Date.now()-new Date(iso).getTime())/86400000)) }
const JP_DAYS = ['日','月','火','水','木','金','土']
function fmtEventDate(d: string) {
  const dt = new Date(d + 'T00:00:00')
  const today = new Date(); today.setHours(0,0,0,0)
  const diff = Math.round((dt.getTime()-today.getTime())/86400000)
  if (diff === 0) return '今日'
  if (diff === 1) return '明日'
  if (diff === -1) return '昨日'
  return `${dt.getMonth()+1}/${dt.getDate()}（${JP_DAYS[dt.getDay()]}）`
}
function isPast(d: string) {
  const dt = new Date(d + 'T00:00:00')
  const today = new Date(); today.setHours(0,0,0,0)
  return dt.getTime() < today.getTime()
}
function isNewEvent(createdAt: string) {
  // 3日以内に追加された予定を "NEW" 扱い
  return Date.now() - new Date(createdAt).getTime() < 3 * 24 * 60 * 60 * 1000
}
const EVENT_CONFIRMED_KEY = 'event_confirmed_ids'
const EVENT_CFG: Record<string, { emoji: string; color: string; label: string }> = {
  practice: { emoji: '🏃', color: '#34C759', label: '練習' },
  race:     { emoji: '🏁', color: BRAND,     label: '試合' },
  rest:     { emoji: '😴', color: '#5856D6', label: '休み' },
  meeting:  { emoji: '💬', color: '#FF9500', label: '集合' },
  other:    { emoji: '📌', color: '#8E8E93', label: 'その他' },
}

// ── 負荷・リスク設定 ─────────────────────────────────────
const RISK_CFG = {
  danger: { color: '#E53935', bg: 'rgba(229,57,53,0.12)', label: '高リスク' },
  high:   { color: '#FF9500', bg: 'rgba(255,149,0,0.12)', label: '要注意' },
  medium: { color: '#6366f1', bg: 'rgba(99,102,241,0.10)', label: '経過観察' },
  low:    { color: '#34C759', bg: 'rgba(52,199,89,0.12)', label: '良好' },
} as const
type RiskCfgKey = keyof typeof RISK_CFG

const LOAD_CFG = {
  danger: { color: '#E53935', label: '危険' },
  high:   { color: '#FF9500', label: '高' },
  medium: { color: '#F5A623', label: '中' },
  low:    { color: '#34C759', label: '低' },
} as const
type LoadCfgKey = keyof typeof LOAD_CFG

const SESSION_LOAD_BASE: Record<string, number> = {
  sprint: 100, interval: 70, tempo: 50, easy: 20,
  long: 15, drill: 80, strength: 120, race: 200, rest: 0,
}
function calcWeeklyLoad(sessions: TrainingSession[]): number {
  const now = Date.now()
  const week = sessions.filter(s => now - new Date(s.session_date).getTime() <= 7 * 86_400_000)
  return Math.round(week.reduce((sum, s) => {
    const w = SESSION_LOAD_BASE[s.session_type] ?? 0
    if (s.session_type === 'sprint' || s.session_type === 'interval') {
      // distance_m をkmに統一してから計算（repsは本数ではなく距離の補助情報として扱う）
      return sum + (s.distance_m ? (s.distance_m / 1000) * (s.reps ?? 1) * w : w)
    }
    if (s.session_type === 'tempo' || s.session_type === 'easy' || s.session_type === 'long') {
      return sum + (s.distance_m ? (s.distance_m / 1000) * w : w)
    }
    return sum + w
  }, 0))
}
function loadCfgKey(score: number): LoadCfgKey {
  if (score >= 2000) return 'danger'
  if (score >= 1200) return 'high'
  if (score >= 600)  return 'medium'
  return 'low'
}
function riskCfgKey(score: number): RiskCfgKey {
  if (score >= 70) return 'danger'
  if (score >= 55) return 'high'
  if (score >= 35) return 'medium'
  return 'low'
}

/** セッションの連続日数を計算 */
function calcStreak(sessions: { session_date: string }[]): number {
  if (!sessions.length) return 0
  const dates = [...new Set(sessions.map(s => s.session_date))].sort((a, b) => b.localeCompare(a))
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  if (dates[0] !== today && dates[0] !== yesterday) return 0
  let streak = 1
  for (let i = 1; i < dates.length; i++) {
    const expected = new Date(new Date(dates[i-1] + 'T00:00:00').getTime() - 86400000).toISOString().slice(0, 10)
    if (dates[i] === expected) streak++
    else break
  }
  return streak
}

const FATIGUE_MAP: Record<number,{emoji:string;label:string;color:string}> = {
  2:{emoji:'😊',label:'楽',color:'#34C759'}, 4:{emoji:'🙂',label:'やや楽',color:'#30D158'},
  6:{emoji:'😐',label:'ふつう',color:'#FF9F0A'}, 8:{emoji:'😰',label:'きつい',color:'#FF6B35'},
  10:{emoji:'🥵',label:'限界',color:'#FF3B30'},
}
function fatigueInfo(v: number) {
  const k = [2,4,6,8,10].reduce((a,b) => Math.abs(b-v)<Math.abs(a-v)?b:a)
  return FATIGUE_MAP[k]??FATIGUE_MAP[6]
}

// ── 共通コンポーネント ────────────────────────────────────
function Avatar({ name, size=40, color=BRAND }: { name:string; size?:number; color?:string }) {
  return (
    <View style={{width:size,height:size,borderRadius:size/2,backgroundColor:color+'22',borderWidth:1.5,borderColor:color+'44',alignItems:'center',justifyContent:'center'}}>
      <Text style={{color,fontSize:size*.38,fontWeight:'800'}}>{name.charAt(0)}</Text>
    </View>
  )
}
const AVATAR_COLORS = ['#FF3B30','#FF9500','#34C759','#007AFF','#AF52DE']
function avatarColor(name: string) { return AVATAR_COLORS[name.charCodeAt(0)%AVATAR_COLORS.length] }

// ─────────────────────────────────────────────────────────
// BodyPartSelector — 痛い箇所セレクター
// ─────────────────────────────────────────────────────────
function BodyPartSelector({ selected, onChange }: { selected: string[]; onChange: (parts: string[]) => void }) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(p=>p!==id) : [...selected, id])
  }
  return (
    <View style={bp.grid}>
      {BODY_PARTS.map(p => {
        const active = selected.includes(p.id)
        return (
          <TouchableOpacity key={p.id} style={[bp.chip, active && bp.chipActive]} onPress={() => toggle(p.id)} activeOpacity={0.75}>
            <Text style={[bp.chipText, { color: active ? '#FF3B30' : '#666' }]}>{p.label}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}
const bp = StyleSheet.create({ // bp = body part
  grid:      { flexDirection:'row', flexWrap:'wrap', gap:8 },
  chip:      { paddingHorizontal:12, paddingVertical:8, borderRadius:20, borderWidth:1, borderColor:'rgba(0,0,0,0.08)', backgroundColor:'#f0f2f5' },
  chipActive:{ borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.08)' },
  chipText:  { fontSize:12, fontWeight:'600' },
})

// 痛み部位バッジ（コーチカード用）
function PainBadges({ parts }: { parts: string[] }) {
  if (!parts.length) return null
  const labels = parts.slice(0,3).map(id => BODY_PARTS.find(p=>p.id===id)?.label??id)
  return (
    <View style={{ flexDirection:'row', flexWrap:'wrap', gap:4, marginTop:4 }}>
      {labels.map(l => (
        <View key={l} style={{ backgroundColor:'rgba(255,59,48,0.12)', borderRadius:6, paddingHorizontal:6, paddingVertical:2, borderWidth:1, borderColor:'#FF3B30'+'30' }}>
          <Text style={{ color:'#FF3B30', fontSize:10, fontWeight:'600' }}>🤕 {l}</Text>
        </View>
      ))}
      {parts.length > 3 && <Text style={{ color:'#666', fontSize:10, alignSelf:'center' }}>+{parts.length-3}</Text>}
    </View>
  )
}

// ─────────────────────────────────────────────────────────
// ConfirmSheet — 全プラットフォーム対応の確認モーダル
// ─────────────────────────────────────────────────────────
function ConfirmSheet({ visible, title, message, confirmLabel, dangerous, onConfirm, onCancel }: {
  visible: boolean
  title: string
  message: string
  confirmLabel: string
  dangerous?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.55)',justifyContent:'center',paddingHorizontal:28}}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onCancel}/>
        <View style={{backgroundColor:'#fff',borderRadius:20,padding:24,gap:16,shadowColor:'#000',shadowOffset:{width:0,height:8},shadowOpacity:0.18,shadowRadius:24,elevation:16}}>
          <View style={{alignItems:'center',gap:8}}>
            <View style={{width:48,height:48,borderRadius:14,backgroundColor:dangerous?'rgba(239,68,68,0.1)':'rgba(22,101,52,0.1)',alignItems:'center',justifyContent:'center'}}>
              <Ionicons name={dangerous?'warning-outline':'help-circle-outline'} size={26} color={dangerous?'#ef4444':BRAND}/>
            </View>
            <Text style={{color:'#111827',fontSize:17,fontWeight:'800',textAlign:'center'}}>{title}</Text>
            <Text style={{color:'#6b7280',fontSize:13,lineHeight:20,textAlign:'center'}}>{message}</Text>
          </View>
          <View style={{flexDirection:'row',gap:10}}>
            <TouchableOpacity
              style={{flex:1,paddingVertical:13,borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',alignItems:'center'}}
              onPress={onCancel} activeOpacity={0.7}
            >
              <Text style={{color:'#6b7280',fontSize:14,fontWeight:'700'}}>キャンセル</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{flex:1,paddingVertical:13,borderRadius:12,backgroundColor:dangerous?'#ef4444':BRAND,alignItems:'center'}}
              onPress={() => { onConfirm(); onCancel() }} activeOpacity={0.85}
            >
              <Text style={{color:'#fff',fontSize:14,fontWeight:'800'}}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────
// VideoSubmitModal — 動画URL送信（選手用・Google Drive対応）
// ─────────────────────────────────────────────────────────
const GDRIVE_URL = 'https://drive.google.com'
const GDRIVE_APP = 'googledrive://'

function VideoSubmitModal({ visible, teamCode, playerName, onClose, onSent }: {
  visible: boolean; teamCode: string; playerName: string; onClose: () => void; onSent: () => void
}) {
  const [url,      setUrl]      = useState('')
  const [desc,     setDesc]     = useState('')
  const [busy,     setBusy]     = useState(false)
  const [step,     setStep]     = useState<'guide'|'input'>('guide')

  // モーダルを開くたびにガイド画面に戻す
  useEffect(() => { if (visible) setStep('guide') }, [visible])

  async function pasteFromClipboard() {
    try {
      const text = await Clipboard.getStringAsync()
      if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
        setUrl(text)
        setStep('input')
        Toast.show({ type: 'success', text1: 'URLを貼り付けました', visibilityTime: 1200 })
      } else {
        Toast.show({ type: 'error', text1: 'URLが見つかりません', text2: 'まずGoogleドライブでリンクをコピーしてください', visibilityTime: 2500 })
      }
    } catch {
      Toast.show({ type: 'error', text1: 'クリップボードの読み取りに失敗しました' })
    }
  }

  async function openGoogleDrive() {
    const canOpenApp = await Linking.canOpenURL(GDRIVE_APP).catch(() => false)
    if (canOpenApp) {
      await Linking.openURL(GDRIVE_APP)
    } else {
      await Linking.openURL(GDRIVE_URL)
    }
  }

  async function submit() {
    if (!url.trim()) { Toast.show({type:'error',text1:'URLを入力してください'}); return }
    setBusy(true)
    try {
      await submitVideo(teamCode, playerName, url.trim(), desc.trim() || '動画を送りました')
      await sendPush(`🎥 ${playerName}`, desc.trim() || '動画を送りました', 'coaches', teamCode)
      Toast.show({type:'success',text1:'動画を送りました ✓',visibilityTime:1800})
      setUrl(''); setDesc(''); onSent(); onClose()
    } catch {
      Toast.show({type:'error',text1:'送信に失敗しました'})
    } finally { setBusy(false) }
  }

  const STEPS = [
    { icon: '📂', title: 'Googleドライブを開く', desc: '下の「ドライブを開く」ボタンをタップ' },
    { icon: '⬆️', title: '動画をアップロード', desc: '＋ボタン → アップロード → 動画を選択' },
    { icon: '🔗', title: '共有リンクをコピー', desc: 'ファイルを長押し → 共有 →「リンクをコピー」' },
    { icon: '📋', title: 'ここに貼り付けて送信', desc: '下の「貼り付けて送る」ボタンをタップ' },
  ]

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
        <View style={vs.overlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1}/>
          <View style={vs.sheet}>
            <View style={{width:36,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.12)',alignSelf:'center',marginBottom:16}}/>

            {/* ヘッダー */}
            <View style={{flexDirection:'row',alignItems:'center',marginBottom:18}}>
              <Text style={{color:TEXT.primary,fontSize:18,fontWeight:'800',flex:1}}>
                {step === 'guide' ? '🎥 動画をコーチに送る' : '🔗 URLを貼り付けて送る'}
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={{top:10,bottom:10,left:10,right:10}}>
                <Ionicons name="close" size={22} color={TEXT.secondary}/>
              </TouchableOpacity>
            </View>

            {step === 'guide' ? (
              /* ── ガイドビュー ── */
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {/* ステップ */}
                <View style={{gap:10,marginBottom:18}}>
                  {STEPS.map((s, i) => (
                    <View key={i} style={{flexDirection:'row',alignItems:'flex-start',gap:12,backgroundColor:'#f8faff',borderRadius:12,padding:12,borderWidth:1,borderColor:'rgba(37,99,235,0.10)'}}>
                      <View style={{width:32,height:32,borderRadius:10,backgroundColor:BRAND+'18',alignItems:'center',justifyContent:'center'}}>
                        <Text style={{fontSize:16}}>{s.icon}</Text>
                      </View>
                      <View style={{flex:1}}>
                        <View style={{flexDirection:'row',alignItems:'center',gap:6,marginBottom:2}}>
                          <View style={{width:18,height:18,borderRadius:9,backgroundColor:BRAND,alignItems:'center',justifyContent:'center'}}>
                            <Text style={{color:'#fff',fontSize:10,fontWeight:'800'}}>{i+1}</Text>
                          </View>
                          <Text style={{color:TEXT.primary,fontSize:13,fontWeight:'800'}}>{s.title}</Text>
                        </View>
                        <Text style={{color:TEXT.secondary,fontSize:12,lineHeight:18}}>{s.desc}</Text>
                      </View>
                    </View>
                  ))}
                </View>

                {/* Googleドライブを開くボタン */}
                <HapticTouch haptic="whoosh"
                  style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,backgroundColor:'#1a73e8',borderRadius:14,paddingVertical:14,marginBottom:10}}
                  onPress={openGoogleDrive} activeOpacity={0.85}>
                  <Text style={{fontSize:20}}>📂</Text>
                  <Text style={{color:'#fff',fontSize:15,fontWeight:'800'}}>Googleドライブを開く</Text>
                  <Ionicons name="open-outline" size={16} color="#fff"/>
                </HapticTouch>

                {/* リンクコピー後：貼り付けて送るボタン */}
                <HapticTouch haptic="save"
                  style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,backgroundColor:BRAND,borderRadius:14,paddingVertical:14,marginBottom:6}}
                  onPress={pasteFromClipboard} activeOpacity={0.85}>
                  <Ionicons name="clipboard-outline" size={18} color="#fff"/>
                  <Text style={{color:'#fff',fontSize:15,fontWeight:'800'}}>コピーしたURLを貼り付けて送る</Text>
                </HapticTouch>

                {/* 手動入力へ */}
                <TouchableOpacity onPress={() => setStep('input')} style={{alignItems:'center',paddingVertical:12}} activeOpacity={0.7}>
                  <Text style={{color:TEXT.hint,fontSize:12}}>URLを手動で入力する場合はこちら</Text>
                </TouchableOpacity>
              </ScrollView>
            ) : (
              /* ── URL入力ビュー ── */
              <>
                <TouchableOpacity onPress={() => setStep('guide')} style={{flexDirection:'row',alignItems:'center',gap:4,marginBottom:14}} activeOpacity={0.7}>
                  <Ionicons name="chevron-back" size={16} color={BRAND}/>
                  <Text style={{color:BRAND,fontSize:13,fontWeight:'700'}}>手順を見る</Text>
                </TouchableOpacity>

                <Text style={vs.label}>動画URL（Google Drive / YouTube）</Text>
                <View style={{flexDirection:'row',gap:8,marginBottom:14}}>
                  <TextInput
                    style={[vs.input,{flex:1}]}
                    value={url} onChangeText={setUrl}
                    placeholder="https://drive.google.com/..."
                    placeholderTextColor="#9ca3af"
                    autoCapitalize="none" keyboardType="url"
                  />
                  <TouchableOpacity
                    style={{width:44,height:44,borderRadius:10,backgroundColor:'#f0f2f5',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'rgba(0,0,0,0.08)'}}
                    onPress={pasteFromClipboard} activeOpacity={0.8}>
                    <Ionicons name="clipboard-outline" size={20} color={BRAND}/>
                  </TouchableOpacity>
                </View>

                <Text style={vs.label}>コーチへのメモ（任意）</Text>
                <TextInput
                  style={[vs.input,{height:72,textAlignVertical:'top',paddingTop:10,marginBottom:16}]}
                  value={desc} onChangeText={setDesc}
                  placeholder="スタートの動作を見てほしいです..."
                  placeholderTextColor="#9ca3af" multiline maxLength={100}
                />

                <HapticTouch haptic="save" style={[vs.btn, busy&&{opacity:0.5}]} onPress={submit} disabled={busy} activeOpacity={0.85}>
                  {busy ? <ActivityIndicator size="small" color="#fff"/> : <Ionicons name="send" size={18} color="#fff"/>}
                  <Text style={{color:'#fff',fontSize:16,fontWeight:'800'}}>{busy?'送信中...':'送る'}</Text>
                </HapticTouch>
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
const vs = StyleSheet.create({ // vs = video submit
  overlay:{ flex:1, backgroundColor:'rgba(0,0,0,0.7)', justifyContent:'flex-end' },
  sheet:  { backgroundColor:'#ffffff', borderTopLeftRadius:24, borderTopRightRadius:24, padding:20, paddingBottom:44, maxHeight: SCREEN_H * 0.88 },
  label:  { color:TEXT.hint, fontSize:11, fontWeight:'700', letterSpacing:0.8, marginBottom:8 },
  input:  { backgroundColor:'#f8f8fa', borderRadius:10, borderWidth:1, borderColor:'rgba(0,0,0,0.10)', color:TEXT.primary, fontSize:14, paddingHorizontal:14, paddingVertical:12, height:44 },
  btn:    { flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, backgroundColor:BRAND, borderRadius:14, paddingVertical:15, marginTop:16 },
})

// ─────────────────────────────────────────────────────────
// CoachPaywallScreen — コーチプラン購入ゲート
// ─────────────────────────────────────────────────────────
const COACH_GREEN = '#166534'
const COACH_FEATURES = [
  '全選手のコンディションを一覧管理',
  '怪我リスクスコアのリアルタイム確認',
  'アナウンス・メッセージ送信',
  '動画レビュー（選手から受信）',
  'チーム予定・カレンダー管理',
  'チームコード発行・メンバー招待',
]

function CoachPaywallScreen({ onBack, onPurchased }: { onBack: () => void; onPurchased: () => void }) {
  const { packages, purchase, restore, tier, applyAccessCode } = usePurchase()
  const [busy,        setBusy]        = useState(false)
  const [showCode,    setShowCode]    = useState(false)
  const [codeInput,   setCodeInput]   = useState('')
  const [codeError,   setCodeError]   = useState('')
  const [codeLoading, setCodeLoading] = useState(false)

  // プラン購入後にtierがcoachになったら自動遷移
  React.useEffect(() => {
    if (tier === 'coach') onPurchased()
  }, [tier, onPurchased])

  async function handleApplyCode() {
    if (!codeInput.trim()) return
    setCodeLoading(true)
    setCodeError('')
    const ok = await applyAccessCode(codeInput.trim())
    setCodeLoading(false)
    if (ok) {
      // tier更新でuseEffectが自動遷移
    } else {
      setCodeError('コードが無効です。もう一度確認してください。')
    }
  }

  async function handlePurchase() {
    // coachパッケージを探す（月額優先）
    const coachPkg = packages.find((p: any) =>
      p?.product?.identifier === 'score_coach_monthly' ||
      p?.identifier === 'score_coach_monthly' ||
      p?.offeringIdentifier === 'coach'
    )
    if (!coachPkg) {
      // パッケージが見つからない場合はデモ購入（開発中フォールバック）
      Toast.show({ type: 'error', text1: 'パッケージが見つかりません', text2: 'App Storeの接続を確認してください', visibilityTime: 3000 })
      return
    }
    setBusy(true)
    const ok = await purchase(coachPkg)
    setBusy(false)
    if (ok) onPurchased()
  }

  async function handleRestore() {
    setBusy(true)
    await restore()
    setBusy(false)
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0D1F13' }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 32, gap: 20 }} showsVerticalScrollIndicator={false}>
          {/* 戻るボタン */}
          <TouchableOpacity onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.6)" />
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>戻る</Text>
          </TouchableOpacity>

          {/* ヘッダー */}
          <View style={{ alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: COACH_GREEN + '44', borderWidth: 1.5, borderColor: COACH_GREEN + '88', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="clipboard" size={32} color="#4ADE80" />
            </View>
            <View style={{ backgroundColor: COACH_GREEN, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>COACH PLAN</Text>
            </View>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'center' }}>
              チームを指導する{'\n'}全機能が使えます
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
              コーチ・監督・顧問の先生向け{'\n'}チーム管理の完全版プランです
            </Text>
          </View>

          {/* 価格 */}
          <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', padding: 20, alignItems: 'center', gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
              <Text style={{ color: '#4ADE80', fontSize: 40, fontWeight: '900', lineHeight: 44 }}>¥2,980</Text>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginBottom: 6 }}>/月</Text>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>年払い ¥29,800/年（¥2,483/月）</Text>
          </View>

          {/* 機能一覧 */}
          <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(74,222,128,0.2)', padding: 16, gap: 10 }}>
            <Text style={{ color: '#4ADE80', fontSize: 12, fontWeight: '800', letterSpacing: 0.8, marginBottom: 2 }}>含まれる機能</Text>
            {COACH_FEATURES.map((f, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: COACH_GREEN + '66', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="checkmark" size={13} color="#4ADE80" />
                </View>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, flex: 1 }}>{f}</Text>
              </View>
            ))}
          </View>

          {/* 購入ボタン */}
          <TouchableOpacity
            style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#16A34A', borderRadius: 16, paddingVertical: 17, marginTop: 4 }, busy && { opacity: 0.5 }]}
            onPress={handlePurchase}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="shield-checkmark" size={20} color="#fff" />
            }
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '900' }}>
              {busy ? '処理中...' : 'コーチプランを開始する'}
            </Text>
          </TouchableOpacity>

          {/* 復元 */}
          <TouchableOpacity onPress={handleRestore} disabled={busy} style={{ alignItems: 'center', paddingVertical: 8 }} activeOpacity={0.7}>
            <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>以前の購入を復元する</Text>
          </TouchableOpacity>

          {/* アクセスコード入力 */}
          {!showCode ? (
            <TouchableOpacity
              onPress={() => setShowCode(true)}
              style={{ alignItems: 'center', paddingVertical: 8 }}
              activeOpacity={0.7}
            >
              <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
                🔑 アクセスコードをお持ちの方
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', padding: 16, gap: 12 }}>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '700' }}>🔑 アクセスコードで認証</Text>
              <TextInput
                style={{
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: codeError ? '#EF4444' : 'rgba(255,255,255,0.2)',
                  color: '#fff',
                  fontSize: 16,
                  fontWeight: '700',
                  letterSpacing: 2,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  textAlign: 'center',
                  textTransform: 'uppercase',
                  ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
                }}
                value={codeInput}
                onChangeText={t => { setCodeInput(t); setCodeError('') }}
                placeholder="XXXX-XXXX-XXXX"
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
              />
              {codeError ? (
                <Text style={{ color: '#EF4444', fontSize: 12, textAlign: 'center' }}>{codeError}</Text>
              ) : null}
              <TouchableOpacity
                style={[{ backgroundColor: '#166534', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }, (codeLoading || !codeInput.trim()) && { opacity: 0.5 }]}
                onPress={handleApplyCode}
                disabled={codeLoading || !codeInput.trim()}
                activeOpacity={0.85}
              >
                {codeLoading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>コードを適用する</Text>
                }
              </TouchableOpacity>
            </View>
          )}

          {/* 注意書き */}
          <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, textAlign: 'center', lineHeight: 16 }}>
            ※ App Storeアカウントに課金されます。サブスクリプションは設定→Apple ID→サブスクリプションからいつでも解約できます。
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

// ─────────────────────────────────────────────────────────
// RoleSelectionScreen
// ─────────────────────────────────────────────────────────
function RoleSelectionScreen({ onSelect }: { onSelect: (role: Role) => void }) {
  const { colors } = useTheme()
  return (
    <View style={{flex:1,backgroundColor:colors.bg}}>
      <SafeAreaView style={{flex:1}}>
        <ScrollView contentContainerStyle={{padding:24,paddingTop:48,gap:16}} showsVerticalScrollIndicator={false}>
          <View style={{alignItems:'center',marginBottom:8}}>
            <Ionicons name="people" size={52} color={BRAND}/>
          </View>
          <Text style={{color:colors.text,fontSize:26,fontWeight:'800',textAlign:'center'}}>チーム機能</Text>
          <Text style={{color:colors.textSec,fontSize:14,lineHeight:22,textAlign:'center',marginBottom:4}}>
            あなたの役割を選択してください
          </Text>
          <TouchableOpacity style={[role_s.card,{backgroundColor:colors.surface,borderColor:colors.border}]} onPress={() => onSelect('coach')} activeOpacity={0.85}>
            <View style={[role_s.icon,{backgroundColor:BRAND+'18'}]}>
              <Ionicons name="clipboard" size={28} color={BRAND}/>
            </View>
            <View style={{flex:1,gap:3}}>
              <Text style={[role_s.title,{color:colors.text}]}>コーチ・監督・先生</Text>
              <Text style={[role_s.desc,{color:colors.textSec}]}>チームを作成して選手を招待。状態の確認・アナウンスができます</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textHint}/>
          </TouchableOpacity>
          <TouchableOpacity style={[role_s.card,{backgroundColor:colors.surface,borderColor:colors.border}]} onPress={() => onSelect('player')} activeOpacity={0.85}>
            <View style={[role_s.icon,{backgroundColor:'#34C75918'}]}>
              <Ionicons name="person-circle" size={28} color="#34C759"/>
            </View>
            <View style={{flex:1,gap:3}}>
              <Text style={[role_s.title,{color:colors.text}]}>選手・アスリート</Text>
              <Text style={[role_s.desc,{color:colors.textSec}]}>コードでチームに参加。状態を報告・動画をコーチに送れます</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textHint}/>
          </TouchableOpacity>
          <Text style={{color:colors.textHint,fontSize:11,textAlign:'center'}}>※ あとから変更できます</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}
const role_s = StyleSheet.create({
  card:  { flexDirection:'row', alignItems:'center', gap:14, borderRadius:16, borderWidth:1, padding:18 },
  icon:  { width:52, height:52, borderRadius:14, alignItems:'center', justifyContent:'center' },
  title: { fontSize:16, fontWeight:'800' },
  desc:  { fontSize:12, lineHeight:17 },
})

// ─────────────────────────────────────────────────────────
// CoachSetupScreen
// ─────────────────────────────────────────────────────────
function CoachSetupScreen({ onCreated, onBack }: { onCreated:(s:TeamSetup)=>void; onBack:()=>void }) {
  const [teamName,  setTeamName]  = useState('')
  const [coachName, setCoachName] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!teamName.trim()||!coachName.trim()) { Toast.show({type:'error',text1:'チーム名とコーチ名を入力してください'}); return }
    setBusy(true)
    try {
      const s: TeamSetup = { teamName:teamName.trim(), coachName:coachName.trim(), code:generateCode(), createdAt:new Date().toISOString() }
      await AsyncStorage.setItem(SETUP_KEY, JSON.stringify(s))
      // Supabase にチームを登録（他デバイスからの参加コード検証に使用）
      await createTeam(s.code, s.teamName, s.coachName)
      onCreated(s)
    } catch {
      Toast.show({type:'error',text1:'チームの作成に失敗しました。再度お試しください'})
      setBusy(false)
    }
  }

  return (
    <View style={{flex:1,backgroundColor:'#f6f6f8'}}>
      <SafeAreaView style={{flex:1}}>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{flex:1}}>
          <ScrollView contentContainerStyle={{padding:24,gap:18}} showsVerticalScrollIndicator={false}>
            <TouchableOpacity onPress={onBack} style={{flexDirection:'row',alignItems:'center',gap:6,alignSelf:'flex-start'}} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={20} color={TEXT.secondary}/>
              <Text style={{color:TEXT.secondary,fontSize:14}}>戻る</Text>
            </TouchableOpacity>
            <View style={{alignItems:'center',gap:8,marginBottom:8}}>
              <View style={{width:60,height:60,borderRadius:16,backgroundColor:BRAND+'18',alignItems:'center',justifyContent:'center'}}>
                <Ionicons name="shield-checkmark" size={30} color={BRAND}/>
              </View>
              <Text style={{color:TEXT.primary,fontSize:22,fontWeight:'800'}}>チームを作成</Text>
              <Text style={{color:TEXT.secondary,fontSize:13,textAlign:'center',lineHeight:20}}>
                作成後に参加コードが発行されます
              </Text>
            </View>
            <View style={{gap:6}}>
              <Text style={su.label}>チーム名</Text>
              <TextInput style={su.input} value={teamName} onChangeText={setTeamName} placeholder="例: ○○高校陸上部" placeholderTextColor="#9ca3af" maxLength={30}/>
            </View>
            <View style={{gap:6}}>
              <Text style={su.label}>コーチ・監督名</Text>
              <TextInput style={su.input} value={coachName} onChangeText={setCoachName} placeholder="例: 山本 太郎" placeholderTextColor="#9ca3af" maxLength={20}/>
            </View>
            <TouchableOpacity style={[su.btn,busy&&{opacity:0.5}]} onPress={create} disabled={busy} activeOpacity={0.85}>
              <Ionicons name="checkmark-circle" size={20} color="#fff"/>
              <Text style={{color:'#fff',fontSize:16,fontWeight:'800'}}>チームを作成する</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  )
}
const su = StyleSheet.create({
  label:{ color:TEXT.hint, fontSize:11, fontWeight:'700', letterSpacing:0.8 },
  input:{ backgroundColor:'#f8f8fa', borderRadius:12, borderWidth:1, borderColor:'rgba(0,0,0,0.10)', color:TEXT.primary, fontSize:15, paddingHorizontal:14, paddingVertical:12 },
  btn:  { flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, backgroundColor:BRAND, borderRadius:14, paddingVertical:15, marginTop:4 },
})

// ─────────────────────────────────────────────────────────
// PlayerJoinScreen
// ─────────────────────────────────────────────────────────
function PlayerJoinScreen({ onJoined, onBack }: { onJoined:(j:JoinedTeam)=>void; onBack:()=>void }) {
  const [code,       setCode]       = useState('')
  const [playerName, setPlayerName] = useState('')
  const [busy, setBusy] = useState(false)

  async function join() {
    const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g,'')
    if (cleaned.length < 6) { Toast.show({type:'error',text1:'6文字のコードを入力してください'}); return }
    if (!playerName.trim())  { Toast.show({type:'error',text1:'名前を入力してください'}); return }
    setBusy(true)
    try {
      // Supabase でコードを検証（存在するチームか確認）
      let teamName = 'チーム', coachName = 'コーチ'
      const serverTeam = await fetchTeamByCode(cleaned)
      if (serverTeam) {
        // Supabase にチームが存在 → その情報を使用
        teamName  = serverTeam.team_name
        coachName = serverTeam.coach_name
      } else {
        // Supabase 未設定 or オフライン → ローカル照合にフォールバック
        const raw = await AsyncStorage.getItem(SETUP_KEY)
        if (raw) {
          try {
            const s: TeamSetup = JSON.parse(raw)
            if (s.code === cleaned) { teamName = s.teamName; coachName = s.coachName }
            else {
              // コードが一致しない + サーバーにもない = 無効なコード
              Toast.show({type:'error',text1:'チームが見つかりません。コードを確認してください'}); setBusy(false); return
            }
          } catch {
            Toast.show({type:'error',text1:'保存データが破損しています。再度お試しください'}); setBusy(false); return
          }
        }
      }
      const j: JoinedTeam = { code:cleaned, teamName, coachName, playerName:playerName.trim(), joinedAt:new Date().toISOString() }
      await AsyncStorage.setItem(JOINED_KEY, JSON.stringify(j))
      // Supabaseにメンバー登録
      await registerMember(cleaned, playerName.trim(), '')
      // コーチに通知
      await sendPush(`👋 新メンバー`, `${playerName.trim()} がチームに参加しました`, 'coaches', cleaned)
      Toast.show({type:'success',text1:`${teamName} に参加しました！`,visibilityTime:2000})
      onJoined(j)
    } catch {
      Toast.show({type:'error',text1:'参加に失敗しました。もう一度お試しください'})
    } finally { setBusy(false) }
  }

  return (
    <View style={{flex:1,backgroundColor:'#f6f6f8'}}>
      <SafeAreaView style={{flex:1}}>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{flex:1}}>
          <ScrollView contentContainerStyle={{padding:24,gap:18}} showsVerticalScrollIndicator={false}>
            <TouchableOpacity onPress={onBack} style={{flexDirection:'row',alignItems:'center',gap:6,alignSelf:'flex-start'}} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={20} color={TEXT.secondary}/>
              <Text style={{color:TEXT.secondary,fontSize:14}}>戻る</Text>
            </TouchableOpacity>
            <View style={{alignItems:'center',gap:8,marginBottom:8}}>
              <View style={{width:60,height:60,borderRadius:16,backgroundColor:'#34C759'+'18',alignItems:'center',justifyContent:'center'}}>
                <Ionicons name="enter-outline" size={30} color="#34C759"/>
              </View>
              <Text style={{color:TEXT.primary,fontSize:22,fontWeight:'800'}}>チームに参加</Text>
              <Text style={{color:TEXT.secondary,fontSize:13,textAlign:'center',lineHeight:20}}>
                コーチから受け取ったコードと{'\n'}あなたの名前を入力してください
              </Text>
            </View>
            <View style={{gap:6}}>
              <Text style={su.label}>参加コード（6文字）</Text>
              <TextInput
                style={[su.input,{fontSize:24,fontWeight:'900',textAlign:'center',letterSpacing:8,paddingVertical:18}]}
                value={code.toUpperCase()}
                onChangeText={v => setCode(v.replace(/[^A-Za-z0-9]/g,'').slice(0,6).toUpperCase())}
                placeholder="ABCDEF"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                keyboardType="ascii-capable"
                maxLength={6}
              />
            </View>
            <View style={{gap:6}}>
              <Text style={su.label}>あなたの名前</Text>
              <TextInput style={su.input} value={playerName} onChangeText={setPlayerName} placeholder="例: 田中 翼" placeholderTextColor="#9ca3af" maxLength={20}/>
            </View>
            <TouchableOpacity
              style={[{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'#34C759',borderRadius:14,paddingVertical:15},(code.length<6||busy)&&{opacity:0.4}]}
              onPress={join}
              disabled={code.length<6||busy}
              activeOpacity={0.85}
            >
              <Ionicons name="enter-outline" size={20} color="#fff"/>
              <Text style={{color:'#fff',fontSize:16,fontWeight:'800'}}>{busy?'参加中...':'チームに参加する'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  )
}

// ─────────────────────────────────────────────────────────
// MiniCalendar — インラインカレンダーピッカー
// ─────────────────────────────────────────────────────────
function MiniCalendar({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const today = new Date()
  const init  = value ? new Date(value + 'T00:00:00') : today
  const [vy, setVy] = useState(init.getFullYear())
  const [vm, setVm] = useState(init.getMonth())

  // カレンダーグリッド構築
  const firstDay    = new Date(vy, vm, 1).getDay()
  const daysInMonth = new Date(vy, vm + 1, 0).getDate()
  const weeks: (number | null)[][] = []
  let week: (number | null)[] = Array(firstDay).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d)
    if (week.length === 7) { weeks.push(week); week = [] }
  }
  if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week) }

  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  const DAY_LABELS = ['日','月','火','水','木','金','土']

  function prevMonth() {
    if (vm === 0) { setVy(y => y - 1); setVm(11) } else setVm(m => m - 1)
  }
  function nextMonth() {
    if (vm === 11) { setVy(y => y + 1); setVm(0) } else setVm(m => m + 1)
  }
  function pick(d: number) {
    onChange(`${vy}-${String(vm+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`)
  }

  return (
    <View style={{backgroundColor:'#f8f8fa',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',padding:12}}>
      {/* ヘッダー */}
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <TouchableOpacity onPress={prevMonth} hitSlop={{top:10,bottom:10,left:10,right:10}}>
          <Ionicons name="chevron-back" size={22} color={TEXT.primary}/>
        </TouchableOpacity>
        <Text style={{color:TEXT.primary,fontSize:15,fontWeight:'800'}}>{vy}年{vm+1}月</Text>
        <TouchableOpacity onPress={nextMonth} hitSlop={{top:10,bottom:10,left:10,right:10}}>
          <Ionicons name="chevron-forward" size={22} color={TEXT.primary}/>
        </TouchableOpacity>
      </View>
      {/* 曜日ヘッダー */}
      <View style={{flexDirection:'row',marginBottom:4}}>
        {DAY_LABELS.map((label, i) => (
          <Text key={label} style={{flex:1,textAlign:'center',fontSize:11,fontWeight:'700',color:i===0?'#ef4444':i===6?'#3b82f6':'#888'}}>{label}</Text>
        ))}
      </View>
      {/* 週行 */}
      {weeks.map((wk, wi) => (
        <View key={wi} style={{flexDirection:'row',marginBottom:2}}>
          {wk.map((d, di) => {
            if (!d) return <View key={di} style={{flex:1}}/>
            const ds = `${vy}-${String(vm+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
            const isSel = ds === value
            const isToday = ds === todayStr
            return (
              <TouchableOpacity key={di} onPress={() => pick(d)} style={{flex:1,alignItems:'center',paddingVertical:3}} activeOpacity={0.7}>
                <View style={{width:32,height:32,borderRadius:16,backgroundColor:isSel?BRAND:isToday?BRAND+'20':'transparent',alignItems:'center',justifyContent:'center'}}>
                  <Text style={{fontSize:13,fontWeight:isSel||isToday?'800':'400',color:isSel?'#fff':isToday?BRAND:di===0?'#ef4444':di===6?'#3b82f6':TEXT.primary}}>{d}</Text>
                </View>
              </TouchableOpacity>
            )
          })}
        </View>
      ))}
    </View>
  )
}

// ─────────────────────────────────────────────────────────
// CoachDashboard — シンプル3セクション
// ─────────────────────────────────────────────────────────
function CoachDashboard({ setup, onSwitchRole, onDeleteTeam, canSwitchRole }: {
  setup: TeamSetup; onSwitchRole: () => void; onDeleteTeam: () => void; canSwitchRole?: boolean
}) {
  const router = useRouter()
  const [loading,     setLoading]     = useState(true)
  const [messages,    setMessages]    = useState<TeamMessage[]>([])
  const [videos,      setVideos]      = useState<VideoEntry[]>([])
  const [members,     setMembers]     = useState<TeamMemberRow[]>([])
  const [bodyReports,     setBodyReports]     = useState<BodyReportRow[]>([])
  const [coachPlayerStats, setCoachPlayerStats] = useState<PlayerStatsRow[]>([])
  const [teamSessionsMap, setTeamSessionsMap] = useState<Record<string, TrainingSession[]>>({})
  const [teamEvents,    setTeamEvents]    = useState<TeamEventRow[]>([])
  const [msgText,       setMsgText]       = useState('')
  const [msgSending,    setMsgSending]    = useState(false)
  const [tab,           setTab]           = useState<'members'|'messages'|'videos'|'calendar'|'menu'>('members')
  const [detailMember,  setDetailMember]  = useState<Member|null>(null)
  const [detailRisk,    setDetailRisk]    = useState<InjuryRiskResult|null>(null)
  const [memberFilter,  setMemberFilter]  = useState<'all'|'danger'|'pain'>('all')
  const [hiddenDemoIds, setHiddenDemoIds] = useState<string[]>([])
  const [showMenu,      setShowMenu]      = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{id:string;name:string;isDemo:boolean}|null>(null)
  const [showEventModal, setShowEventModal] = useState(false)
  const [evTitle,       setEvTitle]       = useState('')
  const [evDate,        setEvDate]        = useState(new Date().toISOString().slice(0,10))
  const [evTime,        setEvTime]        = useState('')
  const [evLocation,    setEvLocation]    = useState('')
  const [evDesc,        setEvDesc]        = useState('')
  const [evType,        setEvType]        = useState<TeamEventType>('practice')

  // ── メニュービルダー state ─────────────────────────────
  const [menuLibrary,    setMenuLibrary]    = useState<MenuTemplate[]>([])
  const [todayPlan,      setTodayPlan]      = useState<TodayPlan|null>(null)
  const [planTitle,      setPlanTitle]      = useState('今日の練習メニュー')
  const [planNote,       setPlanNote]       = useState('')
  const [planItems,      setPlanItems]      = useState<MenuTemplate[]>([])
  const [showMenuForm,   setShowMenuForm]   = useState(false)
  const [editMenuItem,   setEditMenuItem]   = useState<MenuTemplate|null>(null)
  const [menuFormTitle,  setMenuFormTitle]  = useState('')
  const [menuFormCat,    setMenuFormCat]    = useState<MenuCategory>('interval')
  const [menuFormDetail, setMenuFormDetail] = useState('')
  const [menuFormDuration, setMenuFormDuration] = useState('30')
  const [menuFormIntens, setMenuFormIntens] = useState<MenuIntensity>('medium')
  const [aiSuggestion,   setAiSuggestion]   = useState<string>('')
  const [aiSuggItems,    setAiSuggItems]    = useState<Partial<MenuTemplate>[]>([])

  const load = useCallback(async () => {
    try {
      const [msgs, vids, mems, rpts, teamSessions, evts, pStats] = await Promise.all([
        fetchMessages(setup.code),
        fetchVideos(setup.code),
        fetchMembers(setup.code),
        fetchBodyReports(setup.code),
        fetchTeamSessions(setup.code),
        fetchTeamEvents(setup.code),
        fetchPlayerStats(setup.code),
      ])
      setMessages(msgs)
      setVideos(vids)
      setMembers(mems)
      setBodyReports(rpts)
      setTeamEvents(evts)
      setCoachPlayerStats(pStats)
      // セッションをプレイヤー名でマップ化
      const map: Record<string, TrainingSession[]> = {}
      for (const ts of teamSessions) {
        const s: TrainingSession = {
          id: ts.id,
          user_id: ts.player_name,
          session_date: ts.session_date,
          session_type: ts.session_type as any,
          fatigue_level: ts.fatigue_level,
          condition_level: ts.condition_level,
          distance_m: ts.distance_m ?? undefined,
          reps: ts.reps ?? undefined,
          sets: ts.sets ?? undefined,
          created_at: ts.synced_at,
        }
        if (!map[ts.player_name]) map[ts.player_name] = []
        map[ts.player_name].push(s)
      }
      setTeamSessionsMap(map)
    } catch (e) {
      console.error('[CoachDashboard] load error:', e)
    } finally {
      setLoading(false)
    }
  }, [setup.code])

  useEffect(() => { load() }, [load])
  // タブに戻るたびに再ロード（Realtimeの補完）
  useFocusEffect(useCallback(() => { load() }, [load]))
  // 3分ごとに自動ポーリング（Realtime遅延の補完 / Disk IO節約）
  useEffect(() => {
    const t = setInterval(() => { load() }, 3 * 60 * 1000)
    return () => clearInterval(t)
  }, [load])

  // Supabase Realtime — チームデータをリアルタイム同期
  useEffect(() => {
    const ch = supabase.channel(`coach:${setup.code}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_messages',     filter: `team_code=eq.${setup.code}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members',      filter: `team_code=eq.${setup.code}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_body_reports', filter: `team_code=eq.${setup.code}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_videos',       filter: `team_code=eq.${setup.code}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_sessions',     filter: `team_code=eq.${setup.code}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_player_stats', filter: `team_code=eq.${setup.code}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_events',       filter: `team_code=eq.${setup.code}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [setup.code, load])

  // 通知許可 + タグ登録
  useEffect(() => {
    (async () => {
      try {
        await initOneSignal()
        await requestPushPermission()
        await registerUserTags('coach', setup.code)
      } catch {}
    })()
  }, [setup.code])

  async function sendMessage() {
    if (!msgText.trim() || msgSending) return
    setMsgSending(true)
    const content = msgText.trim()
    setMsgText('')   // 先にクリアして2重送信を視覚的にも防ぐ
    try {
      await postMessage(setup.code, content, setup.coachName)
      await sendPush(`📣 ${setup.teamName}`, content, 'players', setup.code)
      await load()
      Toast.show({type:'success',text1:'送信しました',visibilityTime:1400})
    } catch {
      setMsgText(content)  // 失敗したら元に戻す
      Toast.show({type:'error',text1:'送信できませんでした',visibilityTime:2000})
    } finally {
      setMsgSending(false)
    }
  }

  async function togglePin(id: string, current: boolean) {
    await setPinMessage(id, !current)
    setMessages(prev => prev.map(m => m.id===id ? {...m, is_pinned:!current} : m))
    if (!current) {
      const msg = messages.find(m => m.id===id)
      if (msg) await sendPush('📌 重要なお知らせ', msg.content, 'players', setup.code)
    }
  }

  async function deleteMsg(id: string) {
    await deleteMessage(id)
    setMessages(prev => prev.filter(m => m.id!==id))
  }

  function removeMember(id: string, name: string, isDemo: boolean) {
    setPendingDelete({ id, name, isDemo })
  }

  async function execDelete() {
    if (!pendingDelete) return
    const { id, name, isDemo } = pendingDelete
    if (isDemo) {
      setHiddenDemoIds(prev => [...prev, id])
    } else {
      await deleteMember(id)
      setMembers(prev => prev.filter(m => m.id !== id))
    }
    if (detailMember?.id === id) setDetailMember(null)
    Toast.show({ type: 'success', text1: `${name} を削除しました`, visibilityTime: 1600 })
  }

  async function ackPain(playerName: string) {
    await ackBodyReport(setup.code, playerName)
    setBodyReports(prev => prev.map(r =>
      r.player_name === playerName ? { ...r, acked_by_coach: true } : r,
    ))
    // シートを閉じず、detailMemberの状態を即時「確認済み」に更新して表示
    setDetailMember(prev => prev ? { ...prev, ackedByCoach: true } : null)
    Toast.show({ type: 'success', text1: '確認済みにしました ✓', visibilityTime: 1400 })
  }

  async function addEvent() {
    if (!evTitle.trim()) return
    // 状態リセット前に値をキャプチャ（resetしてから非同期処理すると値が消える）
    const title    = evTitle.trim()
    const date     = evDate.trim()
    const time     = evTime.trim()
    const location = evLocation.trim()
    const desc     = evDesc.trim()
    const type     = evType
    try {
      const result = await addTeamEvent(setup.code, title, date, time, location, desc, type, setup.coachName)
      if (!result) throw new Error('イベントデータが取得できませんでした')
      // モーダルを先に閉じてからフォームをリセット
      setShowEventModal(false)
      setEvTitle(''); setEvDate(new Date().toISOString().slice(0,10)); setEvTime(''); setEvLocation(''); setEvDesc(''); setEvType('practice')
      // 表示を即時更新
      setTeamEvents(prev => [...prev, result].sort((a, b) => a.event_date.localeCompare(b.event_date)))
      Toast.show({ type: 'success', text1: '予定を追加しました ✓', visibilityTime: 1800 })
      // バックグラウンドでリロード & 通知（失敗してもUIに影響しない）
      load().catch(console.error)
      sendPush(`📅 ${setup.teamName}`, `新しい予定：${title}（${date}）`, 'players', setup.code)
    } catch (e: any) {
      console.error('[addEvent]', e)
      const msg = e?.message ?? String(e)
      // テーブル未作成の場合はわかりやすいメッセージを出す
      const hint = msg.includes('does not exist')
        ? 'Supabaseでteam_eventsテーブルを作成してください'
        : msg
      Toast.show({ type: 'error', text1: '予定を追加できませんでした', text2: hint, visibilityTime: 4000 })
    }
  }

  async function removeEvent(id: string) {
    await deleteTeamEvent(id)
    setTeamEvents(prev => prev.filter(e => e.id !== id))
  }

  async function markWatched(id: string) {
    await markVideoWatched(id)
    setVideos(prev => prev.map(v => v.id===id ? {...v, watched:true} : v))
  }

  // ── メニュービルダー: ライブラリ読み込み ────────────────
  const loadMenuLibrary = useCallback(async () => {
    const raw = await AsyncStorage.getItem(MENU_LIBRARY_KEY).catch(() => null)
    if (raw) { try { setMenuLibrary(JSON.parse(raw)) } catch {} }
    const planRaw = await AsyncStorage.getItem(TODAY_PLAN_KEY).catch(() => null)
    if (planRaw) {
      try {
        const p: TodayPlan = JSON.parse(planRaw)
        setTodayPlan(p)
        // 今日の日付と一致する場合のみ復元
        if (p.date === new Date().toISOString().slice(0,10)) {
          setPlanTitle(p.title)
          setPlanNote(p.note)
          setPlanItems(p.items)
        }
      } catch {}
    }
  }, [])

  useEffect(() => { if (tab === 'menu') loadMenuLibrary() }, [tab, loadMenuLibrary])

  // ライブラリにメニューを保存
  async function saveMenuToLibrary(item: Omit<MenuTemplate, 'id' | 'createdAt'>) {
    const newItem: MenuTemplate = {
      ...item,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    }
    const next = editMenuItem
      ? menuLibrary.map(m => m.id === editMenuItem.id ? { ...newItem, id: editMenuItem.id, createdAt: editMenuItem.createdAt } : m)
      : [...menuLibrary, newItem]
    setMenuLibrary(next)
    await AsyncStorage.setItem(MENU_LIBRARY_KEY, JSON.stringify(next)).catch(() => {})
    setShowMenuForm(false)
    setEditMenuItem(null)
    resetMenuForm()
    Toast.show({ type: 'success', text1: editMenuItem ? '更新しました ✓' : 'ライブラリに追加しました ✓', visibilityTime: 1400 })
  }

  function resetMenuForm() {
    setMenuFormTitle(''); setMenuFormCat('interval'); setMenuFormDetail('')
    setMenuFormDuration('30'); setMenuFormIntens('medium')
  }

  function openMenuForm(item?: MenuTemplate) {
    if (item) {
      setEditMenuItem(item)
      setMenuFormTitle(item.title); setMenuFormCat(item.category)
      setMenuFormDetail(item.detail); setMenuFormDuration(String(item.duration))
      setMenuFormIntens(item.intensity)
    } else {
      setEditMenuItem(null); resetMenuForm()
    }
    setShowMenuForm(true)
  }

  async function deleteMenuFromLibrary(id: string) {
    const next = menuLibrary.filter(m => m.id !== id)
    setMenuLibrary(next)
    setPlanItems(prev => prev.filter(m => m.id !== id))
    await AsyncStorage.setItem(MENU_LIBRARY_KEY, JSON.stringify(next)).catch(() => {})
    Toast.show({ type: 'success', text1: '削除しました', visibilityTime: 1200 })
  }

  function addToPlan(item: MenuTemplate) {
    if (!planItems.find(m => m.id === item.id)) {
      setPlanItems(prev => [...prev, item])
    }
  }
  function removeFromPlan(id: string) { setPlanItems(prev => prev.filter(m => m.id !== id)) }
  function movePlanItem(index: number, dir: -1 | 1) {
    const next = [...planItems]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setPlanItems(next)
  }

  // 今日のプランを保存してチームに共有
  async function shareMenuToTeam() {
    if (!planTitle.trim() || planItems.length === 0) {
      Toast.show({ type: 'error', text1: 'タイトルとメニューを入力してください', visibilityTime: 2000 })
      return
    }
    const plan: TodayPlan = {
      id: Date.now().toString(),
      date: new Date().toISOString().slice(0, 10),
      title: planTitle.trim(),
      items: planItems,
      note: planNote.trim(),
      sharedAt: new Date().toISOString(),
    }
    await AsyncStorage.setItem(TODAY_PLAN_KEY, JSON.stringify(plan)).catch(() => {})
    setTodayPlan(plan)

    // アナウンスとして送信
    const jp = new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })
    const itemLines = planItems.map((item, i) => {
      const cat = MENU_CATEGORY_CFG[item.category]
      return `${i+1}. ${cat.emoji} ${item.title}（${item.duration}分）`
    }).join('\n')
    const noteText = plan.note ? `\n\n📝 ${plan.note}` : ''
    const message = `📋 ${jp} ${plan.title}\n\n${itemLines}${noteText}\n\n#sCORE`
    try {
      await postMessage(setup.code, message, setup.coachName)
      await sendPush(`📋 ${setup.teamName}`, `${jp} ${plan.title}`, 'players', setup.code)
      Toast.show({ type: 'success', text1: '✅ メニューをチームに共有しました', visibilityTime: 2000 })
      setTab('messages')
    } catch {
      Toast.show({ type: 'error', text1: '共有に失敗しました', visibilityTime: 2000 })
    }
  }

  // ── AI メニュー提案（ルールベース）─────────────────────
  function generateAISuggestion() {
    const avgCond = memberData.length > 0
      ? memberData.reduce((s, m) => s + (m.condToday ?? 6), 0) / memberData.length
      : 6
    const avgFatigue = memberData.length > 0
      ? memberData.reduce((s, m) => s + (m.sessions[0]?.fatigue_level ?? 5), 0) / memberData.length
      : 5
    const highRiskCount = memberData.filter(m => m.risk.riskScore >= 70).length
    const painCount = displayMembers.filter(m => (m.painParts?.length ?? 0) > 0).length

    // 直近の大会までの日数
    const today = new Date().toISOString().slice(0, 10)
    const upcomingRace = teamEvents
      .filter(e => e.event_type === 'race' && e.event_date >= today)
      .sort((a, b) => a.event_date.localeCompare(b.event_date))[0]
    const daysToRace = upcomingRace
      ? Math.round((new Date(upcomingRace.event_date).getTime() - Date.now()) / 86400000)
      : 999

    let suggestion = ''
    let items: Partial<MenuTemplate>[] = []

    if (daysToRace <= 1) {
      suggestion = `🏁 明日は試合「${upcomingRace?.title}」です。今日は調整で軽め。`
      items = [
        { category: 'warm_up', title: '軽めのウォームアップ', detail: 'ジョグ10分 + ドリル', duration: 20, intensity: 'low' },
        { category: 'sprint', title: 'スタート練習', detail: '30m加速走 × 3〜4本', duration: 15, intensity: 'low' },
        { category: 'cool_down', title: 'ストレッチ', detail: '静的ストレッチ15分', duration: 15, intensity: 'low' },
      ]
    } else if (daysToRace <= 4) {
      suggestion = `🏁 試合「${upcomingRace?.title}」まで${daysToRace}日。テーパリング期間。`
      items = [
        { category: 'warm_up', title: 'ウォームアップ', detail: 'ジョグ + ドリルセット', duration: 25, intensity: 'low' },
        { category: 'interval', title: '短めインターバル', detail: '100m × 4本（レースペース）', duration: 20, intensity: 'medium' },
        { category: 'drill', title: 'コーディネーションドリル', detail: 'マーク走・バウンディング', duration: 20, intensity: 'medium' },
        { category: 'cool_down', title: 'クールダウン', detail: 'ジョグ + ストレッチ', duration: 15, intensity: 'low' },
      ]
    } else if (avgCond < 5 || avgFatigue > 7 || highRiskCount >= 2) {
      suggestion = `⚠️ チームの疲労が高め（コンディション${avgCond.toFixed(1)}/10）。回復デーを推奨。`
      items = [
        { category: 'warm_up', title: 'ウォームアップ', detail: 'ウォーキング + 軽いジョグ10分', duration: 15, intensity: 'low' },
        { category: 'drill', title: 'テクニックドリル', detail: 'A・Bスキップ、各3セット', duration: 25, intensity: 'low' },
        { category: 'strength', title: '体幹トレーニング', detail: 'コア安定化種目 × 3セット', duration: 20, intensity: 'low' },
        { category: 'cool_down', title: 'クールダウン + ストレッチ', detail: '静的ストレッチ15分', duration: 15, intensity: 'low' },
      ]
    } else if (avgCond >= 8 && avgFatigue <= 4 && daysToRace > 14) {
      suggestion = `💪 チームのコンディション良好（${avgCond.toFixed(1)}/10）。本日は高強度メニューを推奨。`
      items = [
        { category: 'warm_up', title: 'ウォームアップ', detail: 'ジョグ + 動的ストレッチ + ドリル', duration: 30, intensity: 'medium' },
        { category: 'interval', title: '高強度インターバル', detail: '400m × 5本（85〜90%強度）', duration: 40, intensity: 'high' },
        { category: 'sprint', title: '加速走', detail: '60m加速走 × 4本', duration: 15, intensity: 'high' },
        { category: 'cool_down', title: 'クールダウン', detail: 'ジョグ + ストレッチ', duration: 20, intensity: 'low' },
      ]
    } else {
      suggestion = `📊 チームの平均コンディション${avgCond.toFixed(1)}/10。通常トレーニングを推奨。`
      items = [
        { category: 'warm_up', title: 'ウォームアップ', detail: 'ジョグ + ドリルセット', duration: 25, intensity: 'medium' },
        { category: 'interval', title: 'テンポインターバル', detail: '200m × 6本（78〜82%強度）', duration: 35, intensity: 'medium' },
        { category: 'drill', title: 'ドリル', detail: 'A・Bスキップ + バウンディング', duration: 20, intensity: 'medium' },
        { category: 'cool_down', title: 'クールダウン', detail: 'ジョグ + ストレッチ', duration: 15, intensity: 'low' },
      ]
    }

    if (painCount > 0) {
      suggestion += ` ${painCount}名が痛みを報告中 — 個別対応を検討してください。`
    }
    setAiSuggestion(suggestion)
    setAiSuggItems(items)
  }

  // 実メンバーをDEMO_MEMBERSと同じ型に変換（痛み・セッション・ack状態をマージ）
  // loading中はデモを表示しない（チラつき防止）
  const displayMembers: Member[] = !loading && members.length === 0
    ? DEMO_MEMBERS.filter(m => !hiddenDemoIds.includes(m.id))
    : members.map(m => {
        const rpt = bodyReports.find(r => r.player_name === m.player_name)
        return {
          id: m.id,
          name: m.player_name,
          event: m.event || '',
          lastActive: m.joined_at,
          painParts: rpt?.parts ?? [],
          painDetail: rpt?.detail ?? '',
          ackedByCoach: rpt?.acked_by_coach ?? true,
          sessions: teamSessionsMap[m.player_name] ?? [],
        }
      })

  // メンバーごとの計算済みデータ
  const memberData = displayMembers.map(m => {
    const pStat      = coachPlayerStats.find(s => s.player_name === m.name)
    const hasPainReport = (m.painParts?.length ?? 0) > 0
    // ホーム画面と同じ: 7日間の平均コンディションを使用
    const todayForCalc = new Date()
    const recentCondLevels = Array.from({length: 7}, (_, i) => {
      const d = new Date(todayForCalc); d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      return m.sessions.find(s => s.session_date === key)?.condition_level
    }).filter((v): v is number => v !== undefined)
    const condLevel  = recentCondLevels.length > 0
      ? recentCondLevels.reduce((a, b) => a + b, 0) / recentCondLevels.length
      : (pStat?.last_condition ?? 7)
    const fatigueLevel = m.sessions[0]?.fatigue_level ?? pStat?.last_fatigue ?? 5
    // sessions が空でも最終セッション日から擬似セッションを生成してスコアに寄与させる
    let sessionsForRisk = m.sessions
    if (m.sessions.length === 0 && pStat?.last_session_date) {
      sessionsForRisk = [{
        id: 'proxy', user_id: m.name,
        session_date: pStat.last_session_date,
        session_type: 'easy' as const,
        fatigue_level: fatigueLevel,
        condition_level: condLevel,
        created_at: pStat.updated_at,
      }]
    }
    const risk       = calcInjuryRisk(sessionsForRisk, [], condLevel, hasPainReport)
    const weeklyLoad = calcWeeklyLoad(m.sessions)
    const condToday  = m.sessions[0]?.condition_level ?? (pStat?.last_condition ?? null)
    // セッションがなくてもpStatがあればスコアは表示できる
    const hasRiskData = m.sessions.length > 0 || !!pStat?.last_session_date || !!pStat
    return { ...m, risk, weeklyLoad, condToday, hasRiskData }
  })

  // ソート: 未確認の痛み報告 → リスクスコア降順 → 体調未提出 → 名前
  const sortedMembers = [...memberData].sort((a, b) => {
    const aUnackedPain = (a.painParts?.length ?? 0) > 0 && !a.ackedByCoach
    const bUnackedPain = (b.painParts?.length ?? 0) > 0 && !b.ackedByCoach
    if (aUnackedPain && !bUnackedPain) return -1
    if (!aUnackedPain && bUnackedPain) return 1
    if (b.risk.riskScore !== a.risk.riskScore) return b.risk.riskScore - a.risk.riskScore
    if (!a.condToday && b.condToday) return -1
    if (a.condToday && !b.condToday) return 1
    return a.name.localeCompare(b.name)
  })

  // フィルター適用
  const filteredMembers = sortedMembers.filter(m => {
    if (memberFilter === 'danger')      return m.risk.riskScore >= 70
    if (memberFilter === 'pain')        return (m.painParts?.length ?? 0) > 0 && !m.ackedByCoach
    return true
  })

  const highRiskMembers  = memberData.filter(m => m.risk.riskScore >= 70)
  const submittedCount   = memberData.filter(m => m.condToday !== null).length
  const avgLoad          = memberData.length > 0
    ? memberData.reduce((s, m) => s + m.weeklyLoad, 0) / memberData.length
    : 0
  const unackedPainCount = displayMembers.filter(m => (m.painParts?.length ?? 0) > 0 && !m.ackedByCoach).length
  const newVideos        = videos.filter(v => !v.watched).length

  return (
    <View style={{flex:1,backgroundColor:'#f6f6f8'}}>
      <SafeAreaView style={{flex:1}}>

        {/* ─ ヘッダー ─ */}
        <View style={co.header}>
          <View>
            <Text style={co.title}>{setup.teamName}</Text>
            <View style={{flexDirection:'row',alignItems:'center',gap:6,marginTop:2}}>
              <View style={{backgroundColor:BRAND+'20',borderRadius:6,paddingHorizontal:7,paddingVertical:2}}>
                <Text style={{color:BRAND,fontSize:11,fontWeight:'700'}}>コーチ</Text>
              </View>
              <Text style={{color:'#555',fontSize:11}}>{setup.coachName}</Text>
            </View>
          </View>
          <View style={{flexDirection:'row',gap:8,alignItems:'center'}}>
            <View style={co.codeBox}>
              <Text style={{color:'#555',fontSize:9,fontWeight:'700'}}>参加コード</Text>
              <Text style={{color:BRAND,fontSize:15,fontWeight:'900',letterSpacing:3}}>{formatCode(setup.code)}</Text>
            </View>
            <TouchableOpacity onPress={load} style={co.switchBtn} activeOpacity={0.7}>
              <Ionicons name="refresh-outline" size={15} color={TEXT.secondary}/>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowMenu(true)} style={co.switchBtn} activeOpacity={0.7}>
              <Ionicons name="ellipsis-horizontal" size={15} color={TEXT.secondary}/>
            </TouchableOpacity>
          </View>
        </View>

        {/* ─ タブ ─ */}
        <View style={co.tabsWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={co.tabs}>
          {([
            { key:'members',  label:'メンバー',  badge: unackedPainCount + highRiskMembers.length },
            { key:'menu',     label:'📋 メニュー', badge: 0 },
            { key:'messages', label:'アナウンス', badge: 0 },
            { key:'videos',   label:'動画',      badge: newVideos },
            { key:'calendar', label:'予定',      badge: 0 },
          ] as const).map(t => (
            <HapticTouch haptic="tabSwitch" key={t.key} style={[co.tab, tab===t.key && co.tabActive]} onPress={() => setTab(t.key)} activeOpacity={0.7}>
              <Text style={[co.tabLabel, { color: tab===t.key ? BRAND : '#555' }]}>{t.label}</Text>
              {t.badge > 0 && <View style={co.badge}><Text style={{color:'#fff',fontSize:9,fontWeight:'800'}}>{t.badge}</Text></View>}
            </HapticTouch>
          ))}
        </ScrollView>
        </View>

        {/* ─ コンテンツエリア（flex:1 で常に残りスペースを確保） ─ */}
        <View style={{flex:1}}>

        {/* ローディング中 */}
        {loading && (
          <View style={{alignItems:'center',paddingVertical:60,gap:12}}>
            <Text style={{fontSize:32}}>⏳</Text>
            <Text style={{color:'#9ca3af',fontSize:14}}>データを読み込み中...</Text>
          </View>
        )}

        {/* ─ メンバータブ ─ */}
        {!loading && tab === 'members' && (
        <ScrollView style={{flex:1}} contentContainerStyle={{padding:16,paddingBottom:60,gap:18}} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{gap:14}}>
              {/* セッション未同期バナー（実メンバーのスコアが全員0の場合） */}
              {members.length > 0 && memberData.every(m => m.sessions.length === 0) && (
                <View style={{backgroundColor:'rgba(59,130,246,0.07)',borderLeftWidth:4,borderLeftColor:'#3b82f6',borderRadius:12,borderWidth:1,borderColor:'rgba(59,130,246,0.2)',padding:12,flexDirection:'row',alignItems:'flex-start',gap:10}}>
                  <Text style={{fontSize:16,marginTop:1}}>ℹ️</Text>
                  <View style={{flex:1}}>
                    <Text style={{color:'#3b82f6',fontSize:12,fontWeight:'800',marginBottom:3}}>スコアを反映するには選手の操作が必要です</Text>
                    <Text style={{color:'#555',fontSize:11,lineHeight:17}}>各選手がアプリを開いてチームタブを表示すると、練習データが自動で同期されスコアが表示されます。右上の ↻ ボタンで再取得できます。</Text>
                  </View>
                </View>
              )}
              {/* 要注意バナー：未確認の痛み報告 */}
              {unackedPainCount > 0 && (
                <TouchableOpacity
                  style={{backgroundColor:'rgba(239,68,68,0.08)',borderLeftWidth:4,borderLeftColor:'#EF4444',borderRadius:12,borderWidth:1,borderColor:'rgba(239,68,68,0.25)',padding:12,flexDirection:'row',alignItems:'flex-start',gap:10}}
                  onPress={() => setMemberFilter(memberFilter==='pain'?'all':'pain')}
                  activeOpacity={0.8}
                >
                  <Text style={{fontSize:16,marginTop:1}}>🤕</Text>
                  <View style={{flex:1}}>
                    <Text style={{color:'#EF4444',fontSize:13,fontWeight:'800',marginBottom:2}}>
                      {sortedMembers.filter(m=>(m.painParts?.length??0)>0&&!m.ackedByCoach).slice(0,3).map(m=>m.name.split(' ')[0]).join('・')}
                      {unackedPainCount > 3 ? ` ほか${unackedPainCount-3}名` : ''}が痛みを報告
                    </Text>
                    <Text style={{color:'#888',fontSize:11}}>タップで絞り込み → 詳細確認後「確認済み」を押してください</Text>
                  </View>
                </TouchableOpacity>
              )}
              {/* 高リスクバナー */}
              {highRiskMembers.length > 0 && (
                <TouchableOpacity
                  style={{backgroundColor:'rgba(229,57,53,0.08)',borderLeftWidth:4,borderLeftColor:'#E53935',borderRadius:12,borderWidth:1,borderColor:'rgba(229,57,53,0.25)',padding:12,flexDirection:'row',alignItems:'flex-start',gap:10}}
                  onPress={() => setMemberFilter(memberFilter==='danger'?'all':'danger')}
                  activeOpacity={0.8}
                >
                  <Text style={{fontSize:16,marginTop:1}}>⚠️</Text>
                  <View style={{flex:1}}>
                    <Text style={{color:'#E53935',fontSize:12,fontWeight:'700',marginBottom:2}}>
                      {highRiskMembers.length <= 3
                        ? highRiskMembers.map(m=>m.name.split(' ')[0]).join('・')
                        : `${highRiskMembers[0].name.split(' ')[0]} ほか${highRiskMembers.length-1}名`
                      }の負荷が高リスクです
                    </Text>
                    <Text style={{color:'#888',fontSize:11}}>今日の練習前に状態を確認してください → タップで絞り込み</Text>
                  </View>
                </TouchableOpacity>
              )}

              {/* サマリー横長カード */}
              <View style={{gap:6}}>
                {([
                  { emoji:'🤕', label:'痛み報告', value:`${unackedPainCount}件`,                        color: unackedPainCount>0?'#EF4444':'#34C759',                              filter:'pain' as const },
                  { emoji:'⚠️', label:'高リスク', value:`${highRiskMembers.length}人`,                 color: highRiskMembers.length>0?'#E53935':'#34C759',                         filter:'danger' as const },
                  { emoji:'💪', label:'チーム負荷', value: LOAD_CFG[loadCfgKey(avgLoad)].label,        color: LOAD_CFG[loadCfgKey(avgLoad)].color,                                  filter:'all' as const },
                ] as const).map((item) => {
                  const isActive = memberFilter === item.filter && item.filter !== 'all'
                  return (
                    <TouchableOpacity
                      key={item.label}
                      onPress={() => setMemberFilter(memberFilter===item.filter&&item.filter!=='all'?'all':item.filter)}
                      style={{
                        flexDirection:'row', alignItems:'center', gap:10,
                        backgroundColor: isActive ? item.color+'10' : '#f7f8fa',
                        borderWidth:1,
                        borderColor: isActive ? item.color+'55' : 'rgba(0,0,0,0.07)',
                        borderLeftWidth: isActive ? 3 : 1,
                        borderLeftColor: isActive ? item.color : 'rgba(0,0,0,0.07)',
                        borderRadius:12, paddingVertical:11, paddingHorizontal:14,
                      }}
                      activeOpacity={0.75}
                    >
                      <Text style={{fontSize:17}}>{item.emoji}</Text>
                      <Text style={{flex:1, color:'#555', fontSize:13, fontWeight:'600'}}>{item.label}</Text>
                      <Text style={{color:item.color, fontSize:17, fontWeight:'800'}}>{item.value}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>

              {/* フィルター解除 */}
              {memberFilter !== 'all' && (
                <TouchableOpacity onPress={() => setMemberFilter('all')} style={{alignSelf:'flex-end',borderWidth:1,borderColor:'rgba(0,0,0,0.1)',borderRadius:999,paddingHorizontal:12,paddingVertical:5,backgroundColor:'#f0f2f5'}} activeOpacity={0.7}>
                  <Text style={{color:'#666',fontSize:11,fontWeight:'600'}}>× すべて表示（{memberData.length}人）</Text>
                </TouchableOpacity>
              )}

              {/* メンバーカードリスト */}
              <View style={{gap:10}}>
                {filteredMembers.map((m) => {
                  const rKey      = riskCfgKey(m.risk.riskScore)
                  const lKey      = loadCfgKey(m.weeklyLoad)
                  const rCfg      = RISK_CFG[rKey]
                  const lCfg      = LOAD_CFG[lKey]
                  const lvInfo    = calcLevelInfo(m.sessions.length)
                  const lvTier    = RANK_TIERS.find(t => lvInfo.level >= t.min && lvInfo.level < t.max) ?? RANK_TIERS[0]
                  const isHigh    = m.risk.riskScore >= 70
                  const unackedPain = (m.painParts?.length ?? 0) > 0 && !m.ackedByCoach
                  const ackedPain   = (m.painParts?.length ?? 0) > 0 && m.ackedByCoach

                  return (
                    <HapticTouch
                      haptic="tap"
                      key={m.id}
                      style={[
                        co.memberCard,
                        unackedPain && { borderColor:'rgba(255,149,0,0.5)', backgroundColor:'rgba(255,149,0,0.04)' },
                        !unackedPain && isHigh && { borderColor:'rgba(229,57,53,0.3)', backgroundColor:'rgba(229,57,53,0.03)' },
                      ]}
                      onPress={() => { setDetailMember(m); setDetailRisk(m.risk) }}
                      activeOpacity={0.88}
                    >


                      {/* 未確認の痛み報告バナー */}
                      {unackedPain && (
                        <View style={{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:'rgba(255,149,0,0.1)',borderRadius:8,paddingHorizontal:10,paddingVertical:6,marginBottom:10,borderWidth:1,borderColor:'rgba(239,68,68,0.25)'}}>
                          <Text style={{fontSize:14}}>🤕</Text>
                          <Text style={{color:'#EF4444',fontSize:12,fontWeight:'800',flex:1}}>
                            痛み報告あり — タップして確認
                          </Text>
                          <View style={{backgroundColor:'#EF4444',borderRadius:4,paddingHorizontal:5,paddingVertical:1}}>
                            <Text style={{color:'#fff',fontSize:9,fontWeight:'800'}}>未確認</Text>
                          </View>
                        </View>
                      )}

                      <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
                        <Avatar name={m.name} size={44} color={avatarColor(m.name)}/>

                        <View style={{flex:1,gap:6}}>
                          {/* 名前 + ランク + 種目 */}
                          <View style={{flexDirection:'row',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                            <Text style={{color:TEXT.primary,fontSize:15,fontWeight:'800'}}>{m.name}</Text>
                            <View style={{flexDirection:'row',alignItems:'center',gap:3,backgroundColor:lvTier.color+'20',borderRadius:8,paddingHorizontal:6,paddingVertical:2,borderWidth:1,borderColor:lvTier.color+'40'}}>
                              <Text style={{fontSize:10}}>{lvTier.emoji}</Text>
                              <Text style={{color:lvTier.color,fontSize:10,fontWeight:'800'}}>Lv.{lvInfo.level}</Text>
                            </View>
                            {m.event ? <Text style={{color:TEXT.secondary,fontSize:11}}>{m.event}</Text> : null}
                          </View>

                          {/* 怪我リスクスコア（メイン表示）*/}
                          <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
                            {!(m as any).hasRiskData ? (
                              <View style={{backgroundColor:'#f0f2f5',borderRadius:10,paddingHorizontal:10,paddingVertical:6,flexDirection:'row',alignItems:'center',gap:4}}>
                                <Ionicons name="cloud-offline-outline" size={12} color="#9ca3af"/>
                                <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700'}}>未同期</Text>
                              </View>
                            ) : (
                              <View style={{backgroundColor:rCfg.bg,borderRadius:10,paddingHorizontal:12,paddingVertical:6,flexDirection:'row',alignItems:'center',gap:5}}>
                                <Text style={{color:rCfg.color,fontSize:20,fontWeight:'900',letterSpacing:-0.5}}>{m.risk.riskScore}</Text>
                                <View style={{gap:1}}>
                                  <Text style={{color:rCfg.color,fontSize:10,fontWeight:'800'}}>リスク</Text>
                                  <Text style={{color:rCfg.color,fontSize:9,opacity:0.85}}>{rCfg.label}</Text>
                                </View>
                              </View>
                            )}
                            {/* 確認済み痛み */}
                            {ackedPain && (
                              <View style={{backgroundColor:'rgba(52,199,89,0.1)',borderRadius:8,paddingHorizontal:8,paddingVertical:5,flexDirection:'row',alignItems:'center',gap:3}}>
                                <Ionicons name="checkmark-circle" size={11} color="#34C759"/>
                                <Text style={{color:'#34C759',fontSize:10,fontWeight:'700'}}>痛み確認済</Text>
                              </View>
                            )}
                          </View>

                          {/* リスクバー */}
                          {(m as any).hasRiskData && (
                            <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                              <View style={{flex:1,height:5,borderRadius:3,backgroundColor:'rgba(0,0,0,0.07)',overflow:'hidden'}}>
                                <View style={{width:`${m.risk.riskScore}%`,height:'100%',borderRadius:3,backgroundColor:rCfg.color}}/>
                              </View>
                              <Text style={{color:'#bbb',fontSize:9}}>{m.sessions.length}回</Text>
                            </View>
                          )}
                        </View>

                        {/* 削除ボタン */}
                        <TouchableOpacity
                          onPress={e => { e.stopPropagation(); removeMember(m.id, m.name, m.id.startsWith('demo-')) }}
                          hitSlop={{top:12,bottom:12,left:12,right:12}}
                          style={{padding:4}}
                        >
                          <Ionicons name="trash-outline" size={15} color="#d1d5db"/>
                        </TouchableOpacity>
                      </View>
                    </HapticTouch>
                  )
                })}
                {filteredMembers.length === 0 && (
                  <View style={{alignItems:'center',paddingVertical:40,gap:8}}>
                    <Ionicons name="people-outline" size={36} color="#d1d5db"/>
                    <Text style={{color:'#9ca3af',fontSize:14}}>該当する選手はいません</Text>
                  </View>
                )}
              </View>
            </View>
        </ScrollView>
        )}

        {/* ─ アナウンスタブ ─ */}
        {!loading && tab === 'messages' && (
        <ScrollView style={{flex:1}} contentContainerStyle={{padding:16,paddingBottom:60,gap:18}} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <>
              <View style={co.composeBox}>
                <TextInput
                  style={co.composeInput}
                  value={msgText}
                  onChangeText={setMsgText}
                  placeholder="チームへのメッセージを入力..."
                  placeholderTextColor="#9ca3af"
                  multiline
                  maxLength={300}
                />
                <HapticTouch haptic="save" style={[co.sendBtn,(!msgText.trim()||msgSending)&&{opacity:0.4}]} onPress={sendMessage} disabled={!msgText.trim()||msgSending} activeOpacity={0.8}>
                  {msgSending
                    ? <ActivityIndicator size="small" color="#fff"/>
                    : <Ionicons name="send" size={18} color="#fff"/>
                  }
                </HapticTouch>
              </View>

              {messages.length === 0 ? (
                <View style={{alignItems:'center',padding:32,gap:8}}>
                  <Ionicons name="megaphone-outline" size={36} color="#333"/>
                  <Text style={{color:'#555',fontSize:13}}>まだメッセージはありません</Text>
                </View>
              ) : (
                <View style={{gap:8}}>
                  {messages.map(msg => (
                    <View key={msg.id} style={[co.msgCard, msg.is_pinned&&{borderColor:'#FF9500'+'50',backgroundColor:'rgba(255,149,0,0.06)'}]}>
                      <View style={{flexDirection:'row',alignItems:'center',gap:6,marginBottom:6}}>
                        {msg.is_pinned && <Ionicons name="pin" size={12} color="#FF9500"/>}
                        <Text style={{color:BRAND,fontSize:12,fontWeight:'700',flex:1}}>{msg.author_name}</Text>
                        <Text style={{color:'#555',fontSize:11}}>{timeAgo(msg.created_at)}</Text>
                        <TouchableOpacity onPress={() => togglePin(msg.id, msg.is_pinned)} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                          <Ionicons name={msg.is_pinned?'pin':'pin-outline'} size={14} color={msg.is_pinned?'#FF9500':'#444'}/>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => deleteMsg(msg.id)} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                          <Ionicons name="trash-outline" size={14} color="#FF3B30"/>
                        </TouchableOpacity>
                      </View>
                      <Text style={{color:TEXT.primary,fontSize:14,lineHeight:22}}>{msg.content}</Text>
                    </View>
                  ))}
                </View>
              )}
          </>
        </ScrollView>
        )}

        {/* ─ 動画タブ ─ */}
        {!loading && tab === 'videos' && (
        <ScrollView style={{flex:1}} contentContainerStyle={{padding:16,paddingBottom:60,gap:18}} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <>
              {videos.length === 0 ? (
                <View style={{alignItems:'center',padding:32,gap:8}}>
                  <Ionicons name="videocam-outline" size={36} color="#333"/>
                  <Text style={{color:'#555',fontSize:13}}>まだ動画は届いていません</Text>
                  <Text style={{color:'#444',fontSize:11,textAlign:'center'}}>選手が動画を送ると{'\n'}ここに表示されます</Text>
                </View>
              ) : (
                <View style={{gap:10}}>
                  {videos.map(v => (
                    <View key={v.id} style={[co.videoCard, !v.watched&&{borderColor:BRAND+'40'}]}>
                      <View style={{flexDirection:'row',alignItems:'flex-start',gap:10}}>
                        <View style={{width:44,height:44,borderRadius:12,backgroundColor:BRAND+'18',alignItems:'center',justifyContent:'center'}}>
                          <Ionicons name="play-circle" size={24} color={BRAND}/>
                        </View>
                        <View style={{flex:1,gap:3}}>
                          <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                            <Text style={{color:TEXT.primary,fontSize:14,fontWeight:'700'}}>{v.player_name}</Text>
                            {!v.watched && <View style={{backgroundColor:BRAND,borderRadius:4,paddingHorizontal:5,paddingVertical:1}}><Text style={{color:'#fff',fontSize:9,fontWeight:'800'}}>NEW</Text></View>}
                          </View>
                          <Text style={{color:TEXT.secondary,fontSize:13}}>{v.description}</Text>
                          <View style={{flexDirection:'row',gap:8}}>
                            <Text style={{color:'#555',fontSize:11}}>{timeAgo(v.posted_at)}</Text>
                            <Text style={{color:'#444',fontSize:11}}>あと{daysLeft(v.posted_at)}日</Text>
                          </View>
                        </View>
                      </View>
                      <TouchableOpacity
                        style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,backgroundColor:BRAND+'18',borderRadius:10,paddingVertical:10,marginTop:10,borderWidth:1,borderColor:BRAND+'30'}}
                        onPress={() => { markWatched(v.id); Linking.openURL(v.url) }}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="open-outline" size={15} color={BRAND}/>
                        <Text style={{color:BRAND,fontSize:13,fontWeight:'700'}}>動画を見る</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              <Text style={{color:'#333',fontSize:11,textAlign:'center'}}>動画は投稿から7日後に自動で削除されます</Text>
          </>
        </ScrollView>
        )}

        {/* ─ カレンダータブ ─ */}
        {!loading && tab === 'calendar' && (
        <ScrollView style={{flex:1}} contentContainerStyle={{padding:16,paddingBottom:60,gap:18}} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{gap:10}}>
              {teamEvents.length === 0 ? (
                <View style={{alignItems:'center',padding:20,gap:8}}>
                  <Text style={{fontSize:32}}>📅</Text>
                  <Text style={{color:'#9ca3af',fontSize:14}}>予定はまだありません</Text>
                  <Text style={{color:'#c4c4c4',fontSize:12}}>下のボタンから追加してください</Text>
                </View>
              ) : (
                <ScrollView style={{maxHeight:380}} nestedScrollEnabled showsVerticalScrollIndicator={teamEvents.length>4} contentContainerStyle={{gap:8}}>
                  {teamEvents.map(ev => {
                    const cfg = EVENT_CFG[ev.event_type] ?? EVENT_CFG.other
                    const past = isPast(ev.event_date)
                    return (
                      <View key={ev.id} style={{backgroundColor:'#ffffff',borderRadius:12,borderWidth:1,borderColor: past ? 'rgba(0,0,0,0.06)' : cfg.color+'30',padding:12,opacity: past ? 0.55 : 1,shadowColor:'#000',shadowOffset:{width:0,height:1},shadowOpacity:0.05,shadowRadius:4,elevation:1}}>
                        <View style={{flexDirection:'row',alignItems:'flex-start',gap:10}}>
                          <View style={{width:46,height:46,borderRadius:12,backgroundColor:cfg.color+'18',alignItems:'center',justifyContent:'center'}}>
                            <Text style={{fontSize:22}}>{cfg.emoji}</Text>
                          </View>
                          <View style={{flex:1,gap:3}}>
                            <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                              <View style={{backgroundColor:cfg.color+'20',borderRadius:6,paddingHorizontal:6,paddingVertical:2}}>
                                <Text style={{color:cfg.color,fontSize:10,fontWeight:'800'}}>{cfg.label}</Text>
                              </View>
                              {past && <View style={{backgroundColor:'#6b7280'+'20',borderRadius:6,paddingHorizontal:6,paddingVertical:2}}><Text style={{color:'#6b7280',fontSize:10,fontWeight:'700'}}>終了</Text></View>}
                            </View>
                            <Text style={{color:TEXT.primary,fontSize:15,fontWeight:'800'}}>{ev.title}</Text>
                            <View style={{flexDirection:'row',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                              <View style={{flexDirection:'row',alignItems:'center',gap:4}}>
                                <Ionicons name="calendar-outline" size={12} color="#6b7280"/>
                                <Text style={{color:'#6b7280',fontSize:12,fontWeight:'700'}}>{fmtEventDate(ev.event_date)}</Text>
                              </View>
                              {!!ev.event_time && (
                                <View style={{flexDirection:'row',alignItems:'center',gap:4}}>
                                  <Ionicons name="time-outline" size={12} color="#6b7280"/>
                                  <Text style={{color:'#6b7280',fontSize:12}}>{ev.event_time}</Text>
                                </View>
                              )}
                              {!!ev.location && (
                                <View style={{flexDirection:'row',alignItems:'center',gap:4}}>
                                  <Ionicons name="location-outline" size={12} color="#6b7280"/>
                                  <Text style={{color:'#6b7280',fontSize:12}}>{ev.location}</Text>
                                </View>
                              )}
                            </View>
                            {!!ev.description && (
                              <Text style={{color:'#555',fontSize:13,lineHeight:20,marginTop:4}}>{ev.description}</Text>
                            )}
                          </View>
                          <TouchableOpacity onPress={() => removeEvent(ev.id)} hitSlop={{top:10,bottom:10,left:10,right:10}}>
                            <Ionicons name="trash-outline" size={18} color="#ef4444"/>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )
                  })}
                </ScrollView>
              )}
          </View>
        </ScrollView>
        )}

        {/* ─ メニュービルダータブ ─ */}
        {tab === 'menu' && (
        <ScrollView style={{flex:1}} contentContainerStyle={{padding:16,paddingBottom:60,gap:18}} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{gap:16}}>

              {/* ── AI提案カード ── */}
              <View style={{backgroundColor:'#fff',borderRadius:16,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',overflow:'hidden',shadowColor:'#000',shadowOffset:{width:0,height:4},shadowOpacity:0.07,shadowRadius:12,elevation:4}}>
                <View style={{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:16,paddingTop:14,paddingBottom:10,borderBottomWidth:1,borderBottomColor:'rgba(0,0,0,0.07)'}}>
                  <Text style={{fontSize:18}}>🤖</Text>
                  <Text style={{color:'#111827',fontSize:15,fontWeight:'800',flex:1}}>AIメニュー提案</Text>
                  <TouchableOpacity
                    style={{backgroundColor:BRAND,borderRadius:10,paddingHorizontal:14,paddingVertical:7}}
                    onPress={generateAISuggestion}
                    activeOpacity={0.85}
                  >
                    <Text style={{color:'#fff',fontSize:12,fontWeight:'800'}}>提案を生成</Text>
                  </TouchableOpacity>
                </View>
                <View style={{padding:16,gap:12}}>
                  {aiSuggestion ? (
                    <>
                      <View style={{backgroundColor:'#f0fdf4',borderRadius:12,padding:12,borderWidth:1,borderColor:'rgba(22,101,52,0.15)'}}>
                        <Text style={{color:'#166534',fontSize:13,lineHeight:20,fontWeight:'600'}}>{aiSuggestion}</Text>
                      </View>
                      <View style={{gap:8}}>
                        {aiSuggItems.map((item, i) => {
                          const cat = MENU_CATEGORY_CFG[item.category ?? 'other']
                          const int = MENU_INTENSITY_CFG[item.intensity ?? 'medium']
                          return (
                            <View key={i} style={{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:'#f8f8fa',borderRadius:12,padding:12}}>
                              <Text style={{fontSize:20}}>{cat.emoji}</Text>
                              <View style={{flex:1}}>
                                <Text style={{color:'#111827',fontSize:13,fontWeight:'700'}}>{item.title}</Text>
                                <Text style={{color:'#6b7280',fontSize:11,marginTop:2}}>{item.detail} · {item.duration}分</Text>
                              </View>
                              <View style={{backgroundColor:int.color+'18',borderRadius:8,paddingHorizontal:8,paddingVertical:3}}>
                                <Text style={{color:int.color,fontSize:10,fontWeight:'700'}}>{int.label}</Text>
                              </View>
                              <TouchableOpacity
                                style={{backgroundColor:BRAND+'15',borderRadius:8,paddingHorizontal:10,paddingVertical:6}}
                                onPress={() => {
                                  const full: MenuTemplate = { ...(item as any), id: Date.now().toString() + i, createdAt: new Date().toISOString() }
                                  addToPlan(full)
                                  Toast.show({type:'success',text1:'今日のプランに追加 ✓',visibilityTime:1200})
                                }}
                                activeOpacity={0.8}
                              >
                                <Text style={{color:BRAND,fontSize:11,fontWeight:'800'}}>採用</Text>
                              </TouchableOpacity>
                            </View>
                          )
                        })}
                      </View>
                      <TouchableOpacity
                        style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,backgroundColor:BRAND+'10',borderRadius:12,paddingVertical:10,borderWidth:1,borderColor:BRAND+'30'}}
                        onPress={() => {
                          const items = aiSuggItems.map((item, i): MenuTemplate => ({
                            ...(item as any), id: Date.now().toString() + i, createdAt: new Date().toISOString()
                          }))
                          setPlanItems(items)
                          Toast.show({type:'success',text1:'全提案を今日のプランに採用しました',visibilityTime:1800})
                        }}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="checkmark-done-outline" size={16} color={BRAND}/>
                        <Text style={{color:BRAND,fontSize:13,fontWeight:'800'}}>すべて今日のプランに採用</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <View style={{alignItems:'center',paddingVertical:20,gap:8}}>
                      <Text style={{fontSize:32}}>📊</Text>
                      <Text style={{color:'#6b7280',fontSize:13,textAlign:'center',lineHeight:20}}>
                        チームのコンディション・疲労度・大会までの日数を元に{'\n'}今日の練習メニューを自動提案します
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* ── 今日のプランビルダー ── */}
              <View style={{backgroundColor:'#fff',borderRadius:16,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',overflow:'hidden',shadowColor:'#000',shadowOffset:{width:0,height:4},shadowOpacity:0.07,shadowRadius:12,elevation:4}}>
                <View style={{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:16,paddingTop:14,paddingBottom:10,borderBottomWidth:1,borderBottomColor:'rgba(0,0,0,0.07)'}}>
                  <Text style={{fontSize:18}}>📋</Text>
                  <Text style={{color:'#111827',fontSize:15,fontWeight:'800',flex:1}}>今日のプランを作る</Text>
                </View>
                <View style={{padding:16,gap:14}}>
                  {/* タイトル */}
                  <View style={{gap:6}}>
                    <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>プランタイトル</Text>
                    <TextInput
                      style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:15,paddingHorizontal:14,paddingVertical:12,...(Platform.OS==='web'?{outlineStyle:'none'}as any:{})}}
                      value={planTitle}
                      onChangeText={setPlanTitle}
                      placeholder="例: 午後練 — インターバル中心"
                      placeholderTextColor="#9ca3af"
                      maxLength={40}
                    />
                  </View>

                  {/* 選択済みメニュー */}
                  {planItems.length === 0 ? (
                    <View style={{backgroundColor:'#f8f8fa',borderRadius:12,padding:20,alignItems:'center',borderWidth:1,borderColor:'rgba(0,0,0,0.07)',borderStyle:'dashed'}}>
                      <Text style={{color:'#9ca3af',fontSize:13,textAlign:'center'}}>
                        ライブラリからメニューを選んで追加{'\n'}またはAI提案を採用してください
                      </Text>
                    </View>
                  ) : (
                    <View style={{gap:8}}>
                      {planItems.map((item, i) => {
                        const cat = MENU_CATEGORY_CFG[item.category]
                        return (
                          <View key={item.id + i} style={{flexDirection:'row',alignItems:'center',backgroundColor:'#f8f8fa',borderRadius:12,padding:12,gap:8,borderWidth:1,borderColor:'rgba(0,0,0,0.07)'}}>
                            <View style={{gap:2}}>
                              <TouchableOpacity onPress={() => movePlanItem(i, -1)} disabled={i===0} hitSlop={{top:6,bottom:3,left:10,right:10}}>
                                <Ionicons name="chevron-up" size={16} color={i===0?'#d1d5db':'#6b7280'}/>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => movePlanItem(i, 1)} disabled={i===planItems.length-1} hitSlop={{top:3,bottom:6,left:10,right:10}}>
                                <Ionicons name="chevron-down" size={16} color={i===planItems.length-1?'#d1d5db':'#6b7280'}/>
                              </TouchableOpacity>
                            </View>
                            <Text style={{fontSize:18,width:28,textAlign:'center'}}>{cat.emoji}</Text>
                            <View style={{flex:1}}>
                              <Text style={{color:'#111827',fontSize:13,fontWeight:'700'}}>{item.title}</Text>
                              <Text style={{color:'#6b7280',fontSize:11,marginTop:1}}>{item.duration}分 · {item.detail}</Text>
                            </View>
                            <TouchableOpacity onPress={() => removeFromPlan(item.id)} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                              <Ionicons name="close-circle" size={20} color="#ef4444"/>
                            </TouchableOpacity>
                          </View>
                        )
                      })}
                    </View>
                  )}

                  {/* メモ */}
                  <View style={{gap:6}}>
                    <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>メモ（任意）</Text>
                    <TextInput
                      style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:14,paddingHorizontal:14,paddingVertical:12,minHeight:70,...(Platform.OS==='web'?{outlineStyle:'none'}as any:{})}}
                      value={planNote}
                      onChangeText={setPlanNote}
                      placeholder="選手へのコメント、注意点など"
                      placeholderTextColor="#9ca3af"
                      multiline
                      maxLength={200}
                    />
                  </View>

                  {/* 共有ボタン */}
                  <TouchableOpacity
                    style={[{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:15},planItems.length===0&&{opacity:0.45}]}
                    onPress={shareMenuToTeam}
                    disabled={planItems.length===0}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="share-outline" size={18} color="#fff"/>
                    <Text style={{color:'#fff',fontSize:15,fontWeight:'900'}}>チームに共有する</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* ── メニューライブラリ ── */}
              <View style={{backgroundColor:'#fff',borderRadius:16,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',overflow:'hidden',shadowColor:'#000',shadowOffset:{width:0,height:4},shadowOpacity:0.07,shadowRadius:12,elevation:4}}>
                <View style={{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:16,paddingTop:14,paddingBottom:10,borderBottomWidth:1,borderBottomColor:'rgba(0,0,0,0.07)'}}>
                  <Text style={{fontSize:18}}>📁</Text>
                  <Text style={{color:'#111827',fontSize:15,fontWeight:'800',flex:1}}>メニューライブラリ</Text>
                  <TouchableOpacity
                    style={{backgroundColor:BRAND,borderRadius:10,paddingHorizontal:14,paddingVertical:7,flexDirection:'row',alignItems:'center',gap:4}}
                    onPress={() => openMenuForm()}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="add" size={14} color="#fff"/>
                    <Text style={{color:'#fff',fontSize:12,fontWeight:'800'}}>追加</Text>
                  </TouchableOpacity>
                </View>
                <View style={{padding:16,gap:10}}>
                  {menuLibrary.length === 0 ? (
                    <View style={{alignItems:'center',paddingVertical:24,gap:8}}>
                      <Text style={{fontSize:32}}>📂</Text>
                      <Text style={{color:'#6b7280',fontSize:13,textAlign:'center',lineHeight:20}}>
                        よく使う練習メニューを登録して{'\n'}プラン作成に素早く使えます
                      </Text>
                      <TouchableOpacity
                        style={{backgroundColor:BRAND,borderRadius:12,paddingHorizontal:20,paddingVertical:10,marginTop:4}}
                        onPress={() => openMenuForm()}
                        activeOpacity={0.85}
                      >
                        <Text style={{color:'#fff',fontSize:13,fontWeight:'800'}}>最初のメニューを追加する</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    menuLibrary.map(item => {
                      const cat = MENU_CATEGORY_CFG[item.category]
                      const int = MENU_INTENSITY_CFG[item.intensity]
                      const inPlan = !!planItems.find(m => m.id === item.id)
                      return (
                        <View key={item.id} style={{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:'#f8f8fa',borderRadius:12,padding:12,borderWidth:1,borderColor:'rgba(0,0,0,0.07)'}}>
                          <Text style={{fontSize:22,width:30,textAlign:'center'}}>{cat.emoji}</Text>
                          <View style={{flex:1,gap:3}}>
                            <Text style={{color:'#111827',fontSize:13,fontWeight:'700'}}>{item.title}</Text>
                            <View style={{flexDirection:'row',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                              <View style={{backgroundColor:cat.color+'18',borderRadius:6,paddingHorizontal:7,paddingVertical:2}}>
                                <Text style={{color:cat.color,fontSize:10,fontWeight:'700'}}>{cat.label}</Text>
                              </View>
                              <View style={{backgroundColor:int.color+'18',borderRadius:6,paddingHorizontal:7,paddingVertical:2}}>
                                <Text style={{color:int.color,fontSize:10,fontWeight:'700'}}>{int.label}</Text>
                              </View>
                              <Text style={{color:'#9ca3af',fontSize:10}}>{item.duration}分</Text>
                            </View>
                            {item.detail ? <Text style={{color:'#9ca3af',fontSize:11,marginTop:1}} numberOfLines={1}>{item.detail}</Text> : null}
                          </View>
                          <View style={{gap:6}}>
                            <TouchableOpacity
                              style={{backgroundColor:inPlan?'rgba(52,199,89,0.15)':BRAND+'12',borderRadius:8,paddingHorizontal:10,paddingVertical:7,alignItems:'center'}}
                              onPress={() => { if(inPlan) removeFromPlan(item.id); else addToPlan(item) }}
                              activeOpacity={0.8}
                            >
                              <Text style={{color:inPlan?'#34C759':BRAND,fontSize:11,fontWeight:'800'}}>{inPlan?'追加済':'採用'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={{backgroundColor:'rgba(0,0,0,0.05)',borderRadius:8,paddingHorizontal:10,paddingVertical:7,alignItems:'center'}}
                              onPress={() => openMenuForm(item)}
                              activeOpacity={0.8}
                            >
                              <Text style={{color:'#6b7280',fontSize:11,fontWeight:'700'}}>編集</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )
                    })
                  )}
                </View>
              </View>

          </View>
        </ScrollView>
        )}

        </View>{/* flex:1 コンテンツエリア終了 */}

        {/* 予定追加ボタン（カレンダータブ時のみ下固定表示） */}
        {!loading && tab === 'calendar' && (
          <View style={{paddingHorizontal:16,paddingBottom:Math.max(8,12),paddingTop:8,backgroundColor:'#f6f6f8',borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'rgba(0,0,0,0.08)'}}>
            <HapticTouch
              haptic="whoosh"
              style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:14}}
              onPress={() => setShowEventModal(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="add-circle-outline" size={20} color="#fff"/>
              <Text style={{color:'#fff',fontSize:15,fontWeight:'800'}}>＋ 予定を追加する</Text>
            </HapticTouch>
          </View>
        )}

      </SafeAreaView>

      {/* 予定追加モーダル */}
      <Modal visible={showEventModal} transparent animationType="slide" onRequestClose={() => setShowEventModal(false)}>
        <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
          <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.7)',justifyContent:'flex-end'}}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowEventModal(false)} activeOpacity={1}/>
            <View style={{backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,minHeight:SCREEN_H*0.55,maxHeight:SCREEN_H*0.88}}>
              {/* 固定ヘッダー */}
              <View style={{paddingHorizontal:22,paddingTop:18,paddingBottom:4}}>
                <View style={{width:36,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.12)',alignSelf:'center',marginBottom:14}}/>
                <View style={{flexDirection:'row',alignItems:'center',marginBottom:4}}>
                  <Text style={{color:'#111827',fontSize:18,fontWeight:'800',flex:1}}>📅 予定を追加</Text>
                  <TouchableOpacity onPress={() => setShowEventModal(false)} hitSlop={{top:10,bottom:10,left:10,right:10}}>
                    <Ionicons name="close" size={22} color={TEXT.secondary}/>
                  </TouchableOpacity>
                </View>
              </View>
              {/* スクロール可能なフォーム */}
              <ScrollView contentContainerStyle={{paddingHorizontal:22,paddingBottom:48,gap:14}} showsVerticalScrollIndicator={true} keyboardShouldPersistTaps="handled">

              {/* タイトル */}
              <View style={{gap:6}}>
                <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>タイトル（必須）</Text>
                <TextInput style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:15,paddingHorizontal:14,paddingVertical:12}}
                  value={evTitle} onChangeText={setEvTitle} placeholder="例: 400mインターバル" placeholderTextColor="#9ca3af" maxLength={40}/>
              </View>

              {/* 種別 */}
              <View style={{gap:6}}>
                <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>種別</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>
                  {(Object.entries(EVENT_CFG) as [TeamEventType, typeof EVENT_CFG[string]][]).map(([k, v]) => (
                    <TouchableOpacity key={k} onPress={() => setEvType(k)} activeOpacity={0.8}
                      style={{flexDirection:'row',alignItems:'center',gap:5,paddingHorizontal:12,paddingVertical:8,borderRadius:10,borderWidth:2,borderColor: evType===k ? v.color : 'rgba(0,0,0,0.10)', backgroundColor: evType===k ? v.color+'18' : '#f8f8fa'}}>
                      <Text style={{fontSize:14}}>{v.emoji}</Text>
                      <Text style={{color: evType===k ? v.color : '#666',fontSize:12,fontWeight:'700'}}>{v.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* 日付カレンダー */}
              <View style={{gap:6}}>
                <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
                  <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>日付（必須）</Text>
                  {!!evDate && <Text style={{color:BRAND,fontSize:12,fontWeight:'700'}}>✓ {fmtEventDate(evDate)}</Text>}
                </View>
                <MiniCalendar value={evDate} onChange={setEvDate}/>
              </View>
              {/* 時間 */}
              <View style={{gap:6}}>
                <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>時間（任意）</Text>
                <TextInput style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:14,paddingHorizontal:14,paddingVertical:12}}
                  value={evTime} onChangeText={setEvTime} placeholder="例: 14:00" placeholderTextColor="#9ca3af" maxLength={5}/>
              </View>

              {/* 場所 */}
              <View style={{gap:6}}>
                <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>場所（任意）</Text>
                <TextInput style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:14,paddingHorizontal:14,paddingVertical:11}}
                  value={evLocation} onChangeText={setEvLocation} placeholder="例: 第二グラウンド" placeholderTextColor="#9ca3af" maxLength={40}/>
              </View>

              {/* メモ */}
              <View style={{gap:6}}>
                <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>メモ（任意）</Text>
                <TextInput style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:13,paddingHorizontal:14,paddingVertical:10,minHeight:56,textAlignVertical:'top'}}
                  value={evDesc} onChangeText={setEvDesc} placeholder="備考など..." placeholderTextColor="#9ca3af" multiline maxLength={120}/>
              </View>

              <HapticTouch
                haptic="save"
                style={[{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:15},(!evTitle.trim())&&{opacity:0.4}]}
                onPress={addEvent} disabled={!evTitle.trim()} activeOpacity={0.85}
              >
                <Ionicons name="checkmark-circle" size={20} color="#fff"/>
                <Text style={{color:'#fff',fontSize:16,fontWeight:'800'}}>追加する</Text>
              </HapticTouch>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {detailMember && (
        <MemberDetailSheet
          member={detailMember}
          preCalcRisk={detailRisk}
          onClose={() => { setDetailMember(null); setDetailRisk(null) }}
          onAck={detailMember.ackedByCoach ? undefined : () => ackPain(detailMember.name)}
        />
      )}
      <TeamMenuSheet
        visible={showMenu}
        role="coach"
        canSwitch={canSwitchRole ?? false}
        onSwitchRole={onSwitchRole}
        onDangerAction={onDeleteTeam}
        onClose={() => setShowMenu(false)}
      />
      <ConfirmSheet
        visible={!!pendingDelete}
        title="メンバーを削除"
        message={`${pendingDelete?.name ?? ''} をチームから削除しますか？`}
        confirmLabel="削除する"
        dangerous
        onConfirm={execDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {/* ── メニュー追加・編集モーダル ── */}
      <Modal visible={showMenuForm} transparent animationType="slide" onRequestClose={() => setShowMenuForm(false)}>
        <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
          <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.7)',justifyContent:'flex-end'}}>
            <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowMenuForm(false)} activeOpacity={1}/>
            <View style={{backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,minHeight:SCREEN_H*0.55,maxHeight:SCREEN_H*0.88}}>
              <View style={{paddingHorizontal:22,paddingTop:18,paddingBottom:4}}>
                <View style={{width:36,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.12)',alignSelf:'center',marginBottom:14}}/>
                <View style={{flexDirection:'row',alignItems:'center',marginBottom:4}}>
                  <Text style={{color:'#111827',fontSize:18,fontWeight:'800',flex:1}}>
                    {editMenuItem ? '📝 メニューを編集' : '➕ メニューを追加'}
                  </Text>
                  <TouchableOpacity onPress={() => setShowMenuForm(false)} hitSlop={{top:10,bottom:10,left:10,right:10}}>
                    <Ionicons name="close" size={22} color="#6b7280"/>
                  </TouchableOpacity>
                </View>
              </View>
              <ScrollView contentContainerStyle={{paddingHorizontal:22,paddingBottom:48,gap:16}} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {/* タイトル */}
                <View style={{gap:6}}>
                  <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>メニュー名（必須）</Text>
                  <TextInput
                    style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:15,paddingHorizontal:14,paddingVertical:12,...(Platform.OS==='web'?{outlineStyle:'none'}as any:{})}}
                    value={menuFormTitle} onChangeText={setMenuFormTitle}
                    placeholder="例: 400mインターバル × 5本" placeholderTextColor="#9ca3af" maxLength={50}
                  />
                </View>
                {/* カテゴリー */}
                <View style={{gap:8}}>
                  <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>カテゴリー</Text>
                  <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
                    {(Object.keys(MENU_CATEGORY_CFG) as MenuCategory[]).map(cat => {
                      const cfg = MENU_CATEGORY_CFG[cat]
                      const active = menuFormCat === cat
                      return (
                        <TouchableOpacity key={cat}
                          style={{flexDirection:'row',alignItems:'center',gap:4,paddingHorizontal:12,paddingVertical:7,borderRadius:20,borderWidth:1.5,borderColor:active?cfg.color:'rgba(0,0,0,0.12)',backgroundColor:active?cfg.color+'15':'transparent'}}
                          onPress={() => setMenuFormCat(cat)} activeOpacity={0.75}
                        >
                          <Text style={{fontSize:13}}>{cfg.emoji}</Text>
                          <Text style={{color:active?cfg.color:'#6b7280',fontSize:12,fontWeight:'700'}}>{cfg.label}</Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                </View>
                {/* 詳細 */}
                <View style={{gap:6}}>
                  <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>詳細・説明</Text>
                  <TextInput
                    style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:14,paddingHorizontal:14,paddingVertical:12,minHeight:80,...(Platform.OS==='web'?{outlineStyle:'none'}as any:{})}}
                    value={menuFormDetail} onChangeText={setMenuFormDetail}
                    placeholder="本数・距離・休息時間・注意点など" placeholderTextColor="#9ca3af"
                    multiline maxLength={200}
                  />
                </View>
                {/* 時間 */}
                <View style={{gap:6}}>
                  <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>想定時間（分）</Text>
                  <TextInput
                    style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:15,paddingHorizontal:14,paddingVertical:12,...(Platform.OS==='web'?{outlineStyle:'none'}as any:{})}}
                    value={menuFormDuration} onChangeText={v => setMenuFormDuration(v.replace(/[^0-9]/g,''))}
                    keyboardType="numeric" placeholder="30" placeholderTextColor="#9ca3af"
                  />
                </View>
                {/* 強度 */}
                <View style={{gap:8}}>
                  <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>強度</Text>
                  <View style={{flexDirection:'row',gap:10}}>
                    {(['low','medium','high'] as MenuIntensity[]).map(int => {
                      const cfg = MENU_INTENSITY_CFG[int]
                      const active = menuFormIntens === int
                      return (
                        <TouchableOpacity key={int}
                          style={{flex:1,paddingVertical:10,borderRadius:12,borderWidth:1.5,alignItems:'center',borderColor:active?cfg.color:'rgba(0,0,0,0.12)',backgroundColor:active?cfg.color+'15':'transparent'}}
                          onPress={() => setMenuFormIntens(int)} activeOpacity={0.75}
                        >
                          <Text style={{color:active?cfg.color:'#6b7280',fontSize:13,fontWeight:'800'}}>{cfg.label}</Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                </View>
                {/* 保存ボタン */}
                <TouchableOpacity
                  style={[{backgroundColor:BRAND,borderRadius:14,paddingVertical:15,alignItems:'center',marginTop:4},!menuFormTitle.trim()&&{opacity:0.45}]}
                  onPress={() => {
                    if (!menuFormTitle.trim()) return
                    saveMenuToLibrary({
                      title: menuFormTitle.trim(),
                      category: menuFormCat,
                      detail: menuFormDetail.trim(),
                      duration: parseInt(menuFormDuration) || 30,
                      intensity: menuFormIntens,
                    })
                  }}
                  disabled={!menuFormTitle.trim()}
                  activeOpacity={0.85}
                >
                  <Text style={{color:'#fff',fontSize:15,fontWeight:'900'}}>
                    {editMenuItem ? '更新する' : 'ライブラリに追加する'}
                  </Text>
                </TouchableOpacity>
                {/* 削除ボタン（編集時のみ） */}
                {editMenuItem && (
                  <TouchableOpacity
                    style={{alignItems:'center',paddingVertical:10}}
                    onPress={() => { deleteMenuFromLibrary(editMenuItem.id); setShowMenuForm(false) }}
                    activeOpacity={0.7}
                  >
                    <Text style={{color:'#ef4444',fontSize:13,fontWeight:'700'}}>このメニューを削除する</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  )
}

// ─────────────────────────────────────────────────────────
// MemberDetailSheet — コーチ用詳細シート
// ─────────────────────────────────────────────────────────
function MemberDetailSheet({ member, preCalcRisk, onClose, onAck }: {
  member: Member
  preCalcRisk?: InjuryRiskResult | null
  onClose: () => void
  onAck?: () => void
}) {
  // リスト画面と同じ計算式で算出済みのリスクを優先使用
  const risk        = preCalcRisk ?? calcInjuryRisk(member.sessions, [], member.sessions[0]?.condition_level ?? 6)
  const fat         = fatigueInfo(member.sessions[0]?.fatigue_level ?? 6)
  const rCfg        = RISK_CFG[riskCfgKey(risk.riskScore)]
  const lCfg        = LOAD_CFG[loadCfgKey(calcWeeklyLoad(member.sessions))]
  const hasUnacked  = (member.painParts?.length ?? 0) > 0 && !member.ackedByCoach
  const hasAcked    = (member.painParts?.length ?? 0) > 0 && member.ackedByCoach
  const lvInfo      = calcLevelInfo(member.sessions.length)
  const lvTier      = RANK_TIERS.find(t => lvInfo.level >= t.min && lvInfo.level < t.max) ?? RANK_TIERS[0]

  return (
    <View style={[StyleSheet.absoluteFill,{backgroundColor:'rgba(0,0,0,0.85)',justifyContent:'flex-end'}]}>
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose}/>
      <View style={{backgroundColor:'#ffffff',borderTopLeftRadius:24,borderTopRightRadius:24,paddingBottom:44,borderTopWidth:1,borderColor:'rgba(0,0,0,0.08)',overflow:'hidden'}}>


        <View style={{padding:20}}>
          <View style={{width:36,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.12)',alignSelf:'center',marginBottom:16}}/>

          {/* ヘッダー */}
          <View style={{flexDirection:'row',alignItems:'center',gap:12,marginBottom:16}}>
            <Avatar name={member.name} size={50} color={avatarColor(member.name)}/>
            <View style={{flex:1,gap:4}}>
              <Text style={{color:'#111827',fontSize:19,fontWeight:'800'}}>{member.name}</Text>
              <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                {member.event ? <Text style={{color:TEXT.secondary,fontSize:12}}>{member.event}</Text> : null}
                <View style={{flexDirection:'row',alignItems:'center',gap:3,backgroundColor:lvTier.color+'20',borderRadius:7,paddingHorizontal:6,paddingVertical:2}}>
                  <Text style={{fontSize:10}}>{lvTier.emoji}</Text>
                  <Text style={{color:lvTier.color,fontSize:10,fontWeight:'800'}}>Lv.{lvInfo.level}</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{top:10,bottom:10,left:10,right:10}}>
              <Ionicons name="close" size={22} color={TEXT.secondary}/>
            </TouchableOpacity>
          </View>

          {/* ─ 痛み報告（最優先表示） ─ */}
          {(member.painParts?.length ?? 0) > 0 && (
            <View style={{
              backgroundColor: hasUnacked ? 'rgba(239,68,68,0.06)' : 'rgba(52,199,89,0.06)',
              borderRadius:14, borderWidth:1.5,
              borderColor: hasUnacked ? 'rgba(239,68,68,0.35)' : 'rgba(52,199,89,0.35)',
              padding:14, marginBottom:14,
            }}>
              <View style={{flexDirection:'row',alignItems:'center',gap:8,marginBottom:hasUnacked?10:6}}>
                <Text style={{fontSize:18}}>{hasUnacked ? '🤕' : '✅'}</Text>
                <Text style={{color: hasUnacked ? '#EF4444' : '#34C759', fontSize:14, fontWeight:'800', flex:1}}>
                  {hasUnacked ? '痛み・違和感の報告あり（未確認）' : '痛み報告（確認済み）'}
                </Text>
              </View>
              <PainBadges parts={member.painParts!}/>
              {!!member.painDetail && (
                <View style={{marginTop:10, backgroundColor:'rgba(0,0,0,0.04)', borderRadius:8, padding:10}}>
                  <Text style={{color:'#444', fontSize:12, lineHeight:18}}>📝 {member.painDetail}</Text>
                </View>
              )}
              {hasUnacked && onAck && (
                <TouchableOpacity
                  style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:12,paddingVertical:12,marginTop:12}}
                  onPress={onAck}
                  activeOpacity={0.85}
                >
                  <Ionicons name="checkmark-circle" size={18} color="#fff"/>
                  <Text style={{color:'#fff',fontSize:14,fontWeight:'800'}}>確認済みにする</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ─ ステータス3カラム ─ */}
          {member.sessions.length > 0 ? (
            <>
              <View style={{flexDirection:'row',gap:8,marginBottom:12}}>
                {/* リスク */}
                <View style={{flex:1,alignItems:'center',backgroundColor:rCfg.bg,borderRadius:12,borderWidth:1,borderColor:rCfg.color+'40',paddingVertical:14,gap:3}}>
                  <Text style={{color:rCfg.color,fontSize:28,fontWeight:'900'}}>{risk.riskScore}</Text>
                  <Text style={{color:rCfg.color,fontSize:11,fontWeight:'700'}}>{rCfg.label}</Text>
                  <Text style={{color:'#555',fontSize:10}}>怪我リスク</Text>
                </View>
                {/* 疲労 */}
                <View style={{flex:1,alignItems:'center',backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',paddingVertical:14,gap:3}}>
                  <Text style={{fontSize:28}}>{fat.emoji}</Text>
                  <Text style={{color:fat.color,fontSize:11,fontWeight:'700'}}>{fat.label}</Text>
                  <Text style={{color:'#555',fontSize:10}}>疲労度</Text>
                </View>
                {/* 今週距離 */}
                <View style={{flex:1,alignItems:'center',backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',paddingVertical:14,gap:3}}>
                  <Text style={{color:'#111827',fontSize:22,fontWeight:'800'}}>{risk.weeklyKm}<Text style={{fontSize:10,color:'#888'}}>km</Text></Text>
                  <Text style={{color:'#888',fontSize:10}}>先週{risk.prevWeeklyKm}km</Text>
                  <Text style={{color:'#555',fontSize:10}}>今週距離</Text>
                </View>
              </View>

              {/* 負荷 */}
              <View style={{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:'#f0f2f5',borderRadius:10,padding:10,marginBottom:10}}>
                <View style={{width:8,height:8,borderRadius:4,backgroundColor:lCfg.color}}/>
                <Text style={{color:'#555',fontSize:12}}>週間負荷: <Text style={{color:lCfg.color,fontWeight:'700'}}>{lCfg.label}</Text></Text>
                <View style={{flex:1,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.07)',overflow:'hidden',marginLeft:4}}>
                  <View style={{width:`${Math.min(100,risk.riskScore)}%`,height:'100%',backgroundColor:rCfg.color,borderRadius:2}}/>
                </View>
              </View>

              {risk.reasons.length > 0 && (
                <View style={{backgroundColor:'rgba(255,149,0,0.08)',borderRadius:12,borderWidth:1,borderColor:'rgba(239,68,68,0.25)',padding:12,marginBottom:10}}>
                  <Text style={{color:'#92400e',fontSize:12,fontWeight:'700',marginBottom:6}}>⚠️ 注意ポイント</Text>
                  {risk.reasons.map((r,i) => <Text key={i} style={{color:TEXT.secondary,fontSize:12,lineHeight:19}}>• {r}</Text>)}
                </View>
              )}
            </>
          ) : (
            <View style={{backgroundColor:'#f8f8fa',borderRadius:12,padding:14,marginBottom:10,alignItems:'center',gap:6}}>
              <Ionicons name="fitness-outline" size={24} color="#9ca3af"/>
              <Text style={{color:'#555',fontSize:12}}>まだ練習データが同期されていません</Text>
              <Text style={{color:'#9ca3af',fontSize:11}}>選手が練習を記録すると自動的に表示されます</Text>
            </View>
          )}

          <Text style={{color:'#aaa',fontSize:11,textAlign:'center',marginTop:4}}>
            参加日: {daysSince(member.lastActive)}
          </Text>
        </View>
      </View>
    </View>
  )
}

// ─────────────────────────────────────────────────────────
// TeammateProfileSheet — 選手同士用（ランク・PBのみ）
// ─────────────────────────────────────────────────────────
function TeammateProfileSheet({ member, stats, sessions, onClose }: {
  member: TeamMemberRow
  stats: PlayerStatsRow | undefined
  sessions: TrainingSession[]
  onClose: () => void
}) {
  const lvInfo = calcLevelInfo(stats?.level ?? 1)
  const lvTier = RANK_TIERS.find(t => lvInfo.level >= t.min && lvInfo.level < t.max) ?? RANK_TIERS[0]
  const event  = stats?.event || member.event || ''
  const pb     = stats?.pb_display || ''
  const streak = calcStreak(sessions)
  const goal   = stats?.goal || ''

  return (
    <View style={[StyleSheet.absoluteFill,{backgroundColor:'rgba(0,0,0,0.85)',justifyContent:'flex-end'}]}>
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose}/>
      <View style={{backgroundColor:'#ffffff',borderTopLeftRadius:24,borderTopRightRadius:24,padding:24,paddingBottom:48,borderTopWidth:1,borderColor:'rgba(0,0,0,0.08)'}}>
        <View style={{width:36,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.12)',alignSelf:'center',marginBottom:20}}/>

        {/* ─ プロフィールヘッダー ─ */}
        <View style={{alignItems:'center',gap:10,marginBottom:24}}>
          <Avatar name={member.player_name} size={72} color={avatarColor(member.player_name)}/>
          <Text style={{color:'#111827',fontSize:22,fontWeight:'800'}}>{member.player_name}</Text>
          {event ? <Text style={{color:TEXT.secondary,fontSize:14}}>{event}</Text> : null}
        </View>

        {/* ─ ランク・PBカード ─ */}
        <View style={{flexDirection:'row',gap:12,marginBottom:20}}>
          {/* ランク */}
          <View style={{flex:1,alignItems:'center',backgroundColor:lvTier.color+'12',borderRadius:16,borderWidth:1.5,borderColor:lvTier.color+'40',paddingVertical:20,gap:6}}>
            <Text style={{fontSize:32}}>{lvTier.emoji}</Text>
            <Text style={{color:lvTier.color,fontSize:24,fontWeight:'900'}}>Lv.{lvInfo.level}</Text>
            <Text style={{color:lvTier.color,fontSize:12,fontWeight:'700'}}>{lvTier.title}</Text>
            <Text style={{color:'#888',fontSize:10}}>レベル</Text>
          </View>
          {/* 自己ベスト */}
          <View style={{flex:1,alignItems:'center',backgroundColor:'rgba(255,149,0,0.08)',borderRadius:16,borderWidth:1.5,borderColor:'rgba(239,68,68,0.25)',paddingVertical:20,gap:6}}>
            <Ionicons name="trophy" size={28} color="#FF9500"/>
            {pb ? (
              <>
                <Text style={{color:'#FF9500',fontSize:22,fontWeight:'900'}}>{pb}</Text>
                <Text style={{color:'#888',fontSize:10}}>自己ベスト</Text>
              </>
            ) : (
              <>
                <Text style={{color:'#ccc',fontSize:16,fontWeight:'700'}}>未入力</Text>
                <Text style={{color:'#aaa',fontSize:10}}>自己ベスト</Text>
              </>
            )}
          </View>
        </View>

        {/* ストリーク */}
        {streak > 0 && (
          <PulseView active={streak >= 7} color="#FF6B35" style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'rgba(255,107,53,0.08)',borderRadius:14,borderWidth:1.5,borderColor:'rgba(255,107,53,0.25)',paddingVertical:14,marginBottom:16}}>
            <Text style={{fontSize:28}}>🔥</Text>
            <View style={{gap:2}}>
              <Text style={{color:'#FF6B35',fontSize:26,fontWeight:'900'}}>{streak}日連続中！</Text>
              <Text style={{color:'#888',fontSize:11,textAlign:'center'}}>継続は力なり</Text>
            </View>
          </PulseView>
        )}
        {/* 目標 */}
        {goal ? (
          <View style={{backgroundColor:'rgba(0,122,255,0.06)',borderRadius:12,borderWidth:1,borderColor:'rgba(0,122,255,0.15)',padding:14,marginBottom:16}}>
            <Text style={{color:'#007AFF',fontSize:11,fontWeight:'700',marginBottom:4}}>🎯 目標</Text>
            <Text style={{color:TEXT.primary,fontSize:15,fontWeight:'600'}}>{goal}</Text>
          </View>
        ) : null}

        <Text style={{color:'#aaa',fontSize:11,textAlign:'center'}}>
          参加日: {daysSince(member.joined_at)}
        </Text>
      </View>
    </View>
  )
}

// ─────────────────────────────────────────────────────────
// PlayerDashboard
// ─────────────────────────────────────────────────────────
function PlayerDashboard({ joined, onSwitchRole, onLeaveTeam, canSwitchRole }: {
  joined: JoinedTeam; onSwitchRole: () => void; onLeaveTeam: () => void; canSwitchRole?: boolean
}) {
  const [sessions,          setSessions]          = useState<TrainingSession[]>([])
  const [messages,          setMessages]          = useState<TeamMessage[]>([])
  const [teammates,         setTeammates]         = useState<TeamMemberRow[]>([])
  const [allBodyReports,    setAllBodyReports]    = useState<BodyReportRow[]>([])
  const [teamSessionsMap,   setTeamSessionsMap]   = useState<Record<string, TrainingSession[]>>({})
  const [teamEvents,        setTeamEvents]        = useState<TeamEventRow[]>([])
  const [confirmedEventIds, setConfirmedEventIds] = useState<Set<string>>(new Set())
  const [bodyParts,         setBodyParts]         = useState<string[]>([])
  const [bodyDetail,        setBodyDetail]        = useState('')
  const [showBody,          setShowBody]          = useState(false)
  const [showVideoModal,    setShowVideoModal]    = useState(false)
  const [editBody,          setEditBody]          = useState<string[]>([])
  const [editBodyDetail,    setEditBodyDetail]    = useState('')
  const [showMenu,          setShowMenu]          = useState(false)
  const [showStatsEdit,     setShowStatsEdit]     = useState(false)
  const [playerStats,       setPlayerStats]       = useState<PlayerStatsRow[]>([])
  const [editEvent,         setEditEvent]         = useState('')
  const [editPb,            setEditPb]            = useState('')
  const [editGoal,          setEditGoal]          = useState('')
  const [selectedTeammate,  setSelectedTeammate]  = useState<TeamMemberRow|null>(null)
  const [plLoading,         setPlLoading]         = useState(true)
  const [conditionMap,      setConditionMap]      = useState<Record<string,number>>({})
  const [sleepRecs,         setSleepRecs]         = useState<SleepRecord[]>([])
  const [hasSymptom,        setHasSymptom]        = useState(false)
  const [weatherBonus,      setWeatherBonus]      = useState(0)
  const [stretchReduction,  setStretchReduction]  = useState(0)
  const [plTab,             setPlTab]             = useState<'home'|'members'>('home')
  // ── 欠席報告 ────────────────────────────────────────────
  const [absenceNote,       setAbsenceNote]       = useState('')
  const [absenceSaving,     setAbsenceSaving]     = useState(false)
  const { addSession: addAbsenceSession } = useTrainingSessions()

  const load = useCallback(async () => {
    try {
    const [sr, sleepRaw, condRaw, recovRaw, stretchRaw, msgs, mems, rpts, stats, teamSessions, evts, confirmedRaw] = await Promise.all([
      AsyncStorage.getItem(SESSIONS_KEY),
      AsyncStorage.getItem(SLEEP_KEY),
      AsyncStorage.getItem(CONDITION_MAP_KEY),
      AsyncStorage.getItem(RECOVERY_KEY),
      AsyncStorage.getItem(STRETCH_RESULT_KEY),
      fetchMessages(joined.code),
      fetchMembers(joined.code),
      fetchBodyReports(joined.code),
      fetchPlayerStats(joined.code),
      fetchTeamSessions(joined.code),
      fetchTeamEvents(joined.code),
      AsyncStorage.getItem(EVENT_CONFIRMED_KEY),
    ])
    const loadedSessions: TrainingSession[] = sr ? JSON.parse(sr) : []
    setSessions(loadedSessions)
    setSleepRecs(sleepRaw ? JSON.parse(sleepRaw) : [])
    setConfirmedEventIds(new Set(confirmedRaw ? JSON.parse(confirmedRaw) : []))
    setConditionMap(condRaw ? JSON.parse(condRaw) : {})
    // ホーム画面と完全一致の hasSymptom 計算：回復記録のみ（痛み報告は含めない）
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
      const recovRecs = recovRaw ? (JSON.parse(recovRaw) as Array<{ date: string }>) : []
      setHasSymptom(recovRecs.some(r => r.date >= sevenDaysAgo))
    } catch { setHasSymptom(false) }
    // ホーム画面と同じストレッチ補正（今日分のみ）
    try {
      const today = new Date().toISOString().slice(0, 10)
      if (stretchRaw) {
        const parsed = JSON.parse(stretchRaw)
        setStretchReduction(parsed.date === today ? (parsed.reduction ?? 0) : 0)
      } else {
        setStretchReduction(0)
      }
    } catch { setStretchReduction(0) }
    setMessages(msgs)
    setTeammates(mems.filter(m => m.player_name !== joined.playerName))
    setPlayerStats(stats)
    setAllBodyReports(rpts)
    setTeamEvents(evts)
    // チームメイトのセッションマップ構築
    const map: Record<string, TrainingSession[]> = {}
    for (const ts of teamSessions) {
      const s: TrainingSession = {
        id: ts.id, user_id: ts.player_name,
        session_date: ts.session_date, session_type: ts.session_type as any,
        fatigue_level: ts.fatigue_level, condition_level: ts.condition_level,
        distance_m: ts.distance_m ?? undefined,
        reps: ts.reps ?? undefined, sets: ts.sets ?? undefined,
        created_at: ts.synced_at,
      }
      if (!map[ts.player_name]) map[ts.player_name] = []
      map[ts.player_name].push(s)
    }
    setTeamSessionsMap(map)
    const myReport = rpts.find(r => r.player_name === joined.playerName)
    if (myReport) { setBodyParts(myReport.parts); setBodyDetail(myReport.detail ?? '') }
    // myStat は後続の upsertPlayerStats で参照するためだけに宣言（editは変更しない）
    const myStat = stats.find(s => s.player_name === joined.playerName)
    // 自分のセッションをチームに同期（コーチ・チームメイトが見れるように）
    try {
      await syncTeamSessions(joined.code, joined.playerName, loadedSessions)
    } catch (e) { console.error('[load] syncTeamSessions:', e) }
    // レベル + 最新コンディションを自動同期
    const lvInfo = calcLevelInfo(loadedSessions.length)
    const cutoff30 = new Date(Date.now() - 30*24*60*60*1000).toISOString().slice(0,10)
    const recent30 = loadedSessions.filter(s => s.session_date >= cutoff30)
    const lastSess = loadedSessions[0]
    try {
      const streakVal = calcStreak(loadedSessions)
      await upsertPlayerStats(
        joined.code, joined.playerName, myStat?.event ?? '', myStat?.pb_display ?? '', lvInfo.level,
        lastSess?.condition_level ?? 7, lastSess?.fatigue_level ?? 5,
        lastSess?.session_date ?? '', recent30.length, myStat?.goal ?? '', streakVal,
      )
    } catch { /* DB列未追加時もサイレントに無視 */ }
    } catch (e) {
      console.error('[PlayerDashboard] load error:', e)
    } finally {
      setPlLoading(false)
    }
  }, [joined.code, joined.playerName])

  useEffect(() => { load() }, [load])
  useFocusEffect(useCallback(() => { load() }, [load]))
  // 3分ごとに自動ポーリング（Realtime遅延の補完 / Disk IO節約）
  useEffect(() => {
    const t = setInterval(() => { load() }, 3 * 60 * 1000)
    return () => clearInterval(t)
  }, [load])

  // 予定の確認済みトグル（端末ローカル保存 / コーチへ送信なし）
  const toggleEventConfirm = useCallback(async (eventId: string) => {
    setConfirmedEventIds(prev => {
      const next = new Set(prev)
      if (next.has(eventId)) next.delete(eventId)
      else next.add(eventId)
      // setState 内の副作用は NG → 次の tick で保存
      const toSave = [...next]
      setTimeout(() => {
        AsyncStorage.setItem(EVENT_CONFIRMED_KEY, JSON.stringify(toSave)).catch(() => {})
      }, 0)
      return next
    })
  }, [])

  // Supabase Realtime — コーチのアナウンス・チームメイト情報をリアルタイムで受信
  useEffect(() => {
    const ch = supabase.channel(`player:${joined.code}:${joined.playerName}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_messages',    filter: `team_code=eq.${joined.code}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members',     filter: `team_code=eq.${joined.code}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_player_stats',filter: `team_code=eq.${joined.code}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_sessions',    filter: `team_code=eq.${joined.code}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_body_reports',filter: `team_code=eq.${joined.code}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_events',      filter: `team_code=eq.${joined.code}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [joined.code, joined.playerName, load])

  // 天気ボーナス — キャッシュ付き取得（同ウィンドウ内はAPIを叩かない）
  useEffect(() => {
    getCachedWeather().then(w => {
      if (!w) return
      setWeatherBonus(calcWeatherRiskBonus(w))
    }).catch(() => {})
  }, [])

  // 通知許可 + タグ登録
  useEffect(() => {
    (async () => {
      await initOneSignal()
      await requestPushPermission()
      await registerUserTags('player', joined.code)
    })()
  }, [joined.code])

  async function saveStats() {
    const lvInfo = calcLevelInfo(sessions.length)
    const lastSess = sessions[0]
    const cutoff30 = new Date(Date.now() - 30*24*60*60*1000).toISOString().slice(0,10)
    const recent30 = sessions.filter(s => s.session_date >= cutoff30)
    try {
      await upsertPlayerStats(
        joined.code, joined.playerName, editEvent.trim(), editPb.trim(), lvInfo.level,
        lastSess?.condition_level ?? 7, lastSess?.fatigue_level ?? 5,
        lastSess?.session_date ?? '', recent30.length, editGoal.trim(), calcStreak(sessions),
      )
      setShowStatsEdit(false)
      load().catch(console.error)
      Toast.show({ type: 'success', text1: 'プロフィールを更新しました ✓', visibilityTime: 1600 })
    } catch (e) {
      Toast.show({ type: 'error', text1: '保存できませんでした', text2: String(e), visibilityTime: 2500 })
    }
  }

  async function saveBodyReport() {
    try {
      await upsertBodyReport(joined.code, joined.playerName, editBody, editBodyDetail.trim())
      setBodyParts(editBody)
      setBodyDetail(editBodyDetail.trim())
      setShowBody(false)
      if (editBody.length > 0) {
        const labels = editBody.map(id => BODY_PARTS.find(p => p.id === id)?.label ?? id).join('、')
        const msg = editBodyDetail.trim() ? `${labels}：${editBodyDetail.trim()}` : `痛み報告: ${labels}`
        await sendPush(`🤕 ${joined.playerName}`, msg, 'coaches', joined.code)
      }
      Toast.show({ type: 'success', text1: '痛みの報告を送りました', visibilityTime: 1600 })
    } catch (e) {
      Toast.show({ type: 'error', text1: '送信に失敗しました', text2: String(e), visibilityTime: 3000 })
    }
  }

  const last    = sessions[0]
  const fat     = last ? fatigueInfo(last.fatigue_level) : null
  // ホーム画面と完全一致の計算式（fallback も index.tsx と同じ conditionMap[today] ?? 6）
  const avgCondLv = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10)
    const conditionLevel = conditionMap[todayISO] ?? 6
    const today = new Date()
    const vals = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today); d.setDate(d.getDate() - i)
      return conditionMap[d.toISOString().slice(0, 10)]
    }).filter((v): v is number => v !== undefined)
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : conditionLevel
  }, [conditionMap])
  // ホーム画面と完全一致：base + 天気補正 + ストレッチ補正
  const risk = useMemo(() => {
    const base = calcInjuryRisk(sessions, sleepRecs, avgCondLv, hasSymptom)
    const effective = Math.min(100, Math.max(0, base.riskScore + weatherBonus - stretchReduction))
    return { ...base, riskScore: effective }
  }, [sessions, sleepRecs, avgCondLv, hasSymptom, weatherBonus, stretchReduction])
  const pinned  = messages.filter(m => m.is_pinned)
  const regular = messages.filter(m => !m.is_pinned)

  return (
    <View style={{flex:1,backgroundColor:'#f6f6f8'}}>
      <SafeAreaView style={{flex:1}}>
        {plLoading ? (
          <View style={{flex:1,alignItems:'center',justifyContent:'center',gap:12}}>
            <Text style={{fontSize:32}}>⏳</Text>
            <Text style={{color:'#9ca3af',fontSize:14}}>データを読み込み中...</Text>
          </View>
        ) : (
          <>
            {/* ─ 固定ヘッダー ─ */}
            <View style={{paddingHorizontal:16,paddingTop:12,paddingBottom:10,backgroundColor:'#f6f6f8'}}>
              <View style={{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',marginBottom:10}}>
                <View style={{gap:2}}>
                  <Text style={{color:TEXT.primary,fontSize:20,fontWeight:'800'}}>{joined.teamName}</Text>
                  <View style={{flexDirection:'row',gap:6,alignItems:'center',marginTop:2}}>
                    <View style={{backgroundColor:'#34C759'+'20',borderRadius:6,paddingHorizontal:7,paddingVertical:2}}>
                      <Text style={{color:'#34C759',fontSize:11,fontWeight:'700'}}>選手</Text>
                    </View>
                    <Text style={{color:'#555',fontSize:11}}>{joined.playerName}　コーチ: {joined.coachName}</Text>
                  </View>
                </View>
                <View style={{flexDirection:'row',gap:8,alignItems:'center'}}>
                  <TouchableOpacity onPress={() => load()} style={co.switchBtn} activeOpacity={0.7}>
                    <Ionicons name="refresh-outline" size={15} color={TEXT.secondary}/>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setShowMenu(true)} style={co.switchBtn} activeOpacity={0.7}>
                    <Ionicons name="ellipsis-horizontal" size={15} color={TEXT.secondary}/>
                  </TouchableOpacity>
                </View>
              </View>
              {/* アクションボタン3つ */}
              <View style={{flexDirection:'row',gap:8}}>
                <HapticTouch haptic="whoosh" style={pl.actionBtn} onPress={() => { setEditBody([...bodyParts]); setEditBodyDetail(bodyDetail); setShowBody(true) }} activeOpacity={0.85}>
                  <Ionicons name="body-outline" size={18} color="#FF9500"/>
                  <Text style={{color:TEXT.primary,fontSize:12,fontWeight:'700'}}>痛みを報告</Text>
                  {bodyParts.length > 0 && <View style={{backgroundColor:'#FF9500',borderRadius:8,paddingHorizontal:5,paddingVertical:1}}><Text style={{color:'#fff',fontSize:9,fontWeight:'800'}}>{bodyParts.length}</Text></View>}
                </HapticTouch>
                <HapticTouch haptic="whoosh" style={pl.actionBtn} onPress={() => setShowVideoModal(true)} activeOpacity={0.85}>
                  <Ionicons name="videocam-outline" size={18} color={BRAND}/>
                  <Text style={{color:TEXT.primary,fontSize:12,fontWeight:'700'}}>動画を送る</Text>
                </HapticTouch>
                <HapticTouch
                  haptic="whoosh"
                  style={pl.actionBtn}
                  onPress={() => {
                    // モーダルを開く時点でのstatsを初期値にセット（ポーリングによる上書きを防ぐ）
                    const ms = playerStats.find(s => s.player_name === joined.playerName)
                    setEditEvent(ms?.event ?? '')
                    setEditPb(ms?.pb_display ?? '')
                    setEditGoal(ms?.goal ?? '')
                    setShowStatsEdit(true)
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="person-circle-outline" size={18} color="#AF52DE"/>
                  <Text style={{color:TEXT.primary,fontSize:12,fontWeight:'700'}}>プロフィール</Text>
                </HapticTouch>
              </View>
            </View>

            {/* ─ タブバー ─ */}
            <View style={{flexDirection:'row', backgroundColor:'#fff', borderBottomWidth:1, borderBottomColor:'rgba(0,0,0,0.08)'}}>
              {([
                { key:'home'    as const, label:'ホーム' },
                { key:'members' as const, label:'チームメイト' },
              ]).map(t => (
                <HapticTouch haptic="tabSwitch" key={t.key}
                  style={{flex:1, alignItems:'center', justifyContent:'center', paddingVertical:10, borderBottomWidth:2, borderBottomColor: plTab===t.key ? BRAND : 'transparent'}}
                  onPress={() => setPlTab(t.key)} activeOpacity={0.7}>
                  <Text style={{fontSize:13, fontWeight:'700', color: plTab===t.key ? BRAND : '#888'}}>{t.label}</Text>
                </HapticTouch>
              ))}
            </View>

            {/* ─ ホームタブ ─ display:'none' で常時マウント（アニメーション再実行防止） */}
            <ScrollView
              style={{display: plTab==='home' ? 'flex' : 'none'}}
              contentContainerStyle={{padding:16,paddingBottom:80,gap:18}}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={plLoading}
                  onRefresh={() => { setPlLoading(true); load() }}
                  tintColor="#34C759"
                />
              }
            >

                {/* ピン留めメッセージ */}
                {pinned.length > 0 && (
                  <AnimatedSection delay={0} type="fade-up">
                  <View style={{gap:8}}>
                    <Text style={pl.sectionTitle}>📌 コーチからのお知らせ</Text>
                    {pinned.map(m => (
                      <View key={m.id} style={{backgroundColor:'rgba(255,149,0,0.08)',borderRadius:12,borderWidth:1,borderColor:'rgba(255,149,0,0.4)',padding:14}}>
                        <Text style={{color:'#FF9500',fontSize:11,fontWeight:'700',marginBottom:6}}>📌 {m.author_name} · {timeAgo(m.created_at)}</Text>
                        <Text style={{color:TEXT.primary,fontSize:14,lineHeight:22}}>{m.content}</Text>
                      </View>
                    ))}
                  </View>
                  </AnimatedSection>
                )}

                {/* 通常メッセージ */}
                {regular.length > 0 && (
                  <AnimatedSection delay={60} type="fade-up">
                  <View style={{gap:8}}>
                    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
                      <Text style={pl.sectionTitle}>📣 コーチからのメッセージ</Text>
                      {regular.length > 3 && <Text style={{color:'#9ca3af',fontSize:10}}>{regular.length}件</Text>}
                    </View>
                    <ScrollView style={{maxHeight:228,borderRadius:12}} nestedScrollEnabled showsVerticalScrollIndicator={regular.length > 3} contentContainerStyle={{gap:8}}>
                      {regular.map(m => (
                        <View key={m.id} style={{backgroundColor:'#ffffff',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',padding:14}}>
                          <Text style={{color:BRAND,fontSize:11,fontWeight:'700',marginBottom:6}}>{m.author_name} · {timeAgo(m.created_at)}</Text>
                          <Text style={{color:TEXT.primary,fontSize:14,lineHeight:22}}>{m.content}</Text>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                  </AnimatedSection>
                )}

                {messages.length === 0 && (
                  <AnimatedSection delay={0} type="fade-up">
                  <View style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',padding:20,alignItems:'center',gap:6}}>
                    <Ionicons name="chatbubble-outline" size={26} color="#9ca3af"/>
                    <Text style={{color:'#6b7280',fontSize:13}}>コーチからのメッセージはまだありません</Text>
                  </View>
                  </AnimatedSection>
                )}

                {/* チームカレンダー */}
                <AnimatedSection delay={80} type="fade-up">
                <View style={{gap:8}}>
                  <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
                    <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
                      <Text style={pl.sectionTitle}>📅 チーム予定</Text>
                      {/* 未確認の新着件数バッジ */}
                      {(() => {
                        const unconfirmedNew = teamEvents.filter(e =>
                          !isPast(e.event_date) &&
                          isNewEvent(e.created_at) &&
                          !confirmedEventIds.has(e.id)
                        ).length
                        return unconfirmedNew > 0 ? (
                          <View style={{backgroundColor:'#FF3B30',borderRadius:10,minWidth:18,height:18,alignItems:'center',justifyContent:'center',paddingHorizontal:5}}>
                            <Text style={{color:'#fff',fontSize:10,fontWeight:'800'}}>{unconfirmedNew}</Text>
                          </View>
                        ) : null
                      })()}
                    </View>
                    {teamEvents.length > 0 && <Text style={{color:'#9ca3af',fontSize:11}}>{teamEvents.length}件</Text>}
                  </View>
                  {teamEvents.length === 0 ? (
                    <View style={{backgroundColor:'#ffffff',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',padding:20,alignItems:'center',gap:6}}>
                      <Text style={{fontSize:28}}>📅</Text>
                      <Text style={{color:'#9ca3af',fontSize:13}}>コーチからの予定はまだありません</Text>
                    </View>
                  ) : (
                    <View style={{backgroundColor:'#ffffff',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',overflow:'hidden'}}>
                      <ScrollView
                        style={{maxHeight: 260}}
                        showsVerticalScrollIndicator={false}
                        nestedScrollEnabled
                        bounces={false}
                      >
                        {teamEvents.map((ev, i) => {
                          const cfg      = EVENT_CFG[ev.event_type] ?? EVENT_CFG.other
                          const past     = isPast(ev.event_date)
                          const isNew    = !past && isNewEvent(ev.created_at)
                          const confirmed = confirmedEventIds.has(ev.id)
                          return (
                            <View key={ev.id} style={{
                              borderBottomWidth: i < teamEvents.length-1 ? StyleSheet.hairlineWidth : 0,
                              borderBottomColor:'rgba(0,0,0,0.07)',
                              backgroundColor: isNew && !confirmed ? 'rgba(0,180,216,0.05)' : 'transparent',
                            }}>
                              {/* NEW バッジ帯 */}
                              {isNew && !confirmed && (
                                <View style={{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:14,paddingTop:8,paddingBottom:0}}>
                                  <View style={{backgroundColor:'#FF3B30',borderRadius:4,paddingHorizontal:6,paddingVertical:2}}>
                                    <Text style={{color:'#fff',fontSize:9,fontWeight:'800',letterSpacing:0.5}}>NEW</Text>
                                  </View>
                                  <Text style={{color:'#FF3B30',fontSize:10,fontWeight:'600'}}>新しい予定が追加されました</Text>
                                </View>
                              )}
                              <View style={{
                                flexDirection:'row', alignItems:'center', gap:12,
                                paddingHorizontal:14,
                                paddingTop: isNew && !confirmed ? 6 : 13,
                                paddingBottom:13,
                                opacity: past ? 0.45 : 1,
                              }}>
                                {/* 左: イベントアイコン */}
                                <View style={{
                                  width:40, height:40, borderRadius:12,
                                  backgroundColor: confirmed ? '#f0f2f5' : cfg.color+'18',
                                  alignItems:'center', justifyContent:'center',
                                  borderWidth: confirmed ? 1.5 : 0,
                                  borderColor: confirmed ? '#34C759' : 'transparent',
                                }}>
                                  {confirmed
                                    ? <Ionicons name="checkmark-circle" size={22} color="#34C759"/>
                                    : <Text style={{fontSize:18}}>{cfg.emoji}</Text>
                                  }
                                </View>
                                {/* 中: 内容 */}
                                <View style={{flex:1,gap:2}}>
                                  <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                                    <Text style={{
                                      color: confirmed ? '#9ca3af' : TEXT.primary,
                                      fontSize:14, fontWeight:'700',
                                      textDecorationLine: confirmed ? 'line-through' : 'none',
                                    }}>{ev.title}</Text>
                                    {confirmed && (
                                      <View style={{backgroundColor:'#e8f8ed',borderRadius:4,paddingHorizontal:5,paddingVertical:1}}>
                                        <Text style={{color:'#34C759',fontSize:9,fontWeight:'700'}}>確認済</Text>
                                      </View>
                                    )}
                                  </View>
                                  <View style={{flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                                    <Text style={{color: confirmed ? '#bbb' : cfg.color, fontSize:11,fontWeight:'700'}}>{fmtEventDate(ev.event_date)}</Text>
                                    {!!ev.event_time && <Text style={{color:'#888',fontSize:11}}>{ev.event_time}</Text>}
                                    {!!ev.location && <Text style={{color:'#888',fontSize:11}}>📍{ev.location}</Text>}
                                  </View>
                                  {!!ev.description && <Text style={{color:'#6b7280',fontSize:12,lineHeight:18}}>{ev.description}</Text>}
                                </View>
                                {/* 右: 確認ボタン */}
                                {!past && (
                                  <TouchableOpacity
                                    onPress={() => toggleEventConfirm(ev.id)}
                                    style={{
                                      width:52, height:30, borderRadius:15,
                                      backgroundColor: confirmed ? '#e8f8ed' : BRAND+'22',
                                      borderWidth:1.5,
                                      borderColor: confirmed ? '#34C759' : BRAND,
                                      alignItems:'center', justifyContent:'center',
                                    }}
                                    hitSlop={{top:8,bottom:8,left:8,right:8}}
                                  >
                                    <Text style={{
                                      fontSize:10, fontWeight:'700',
                                      color: confirmed ? '#34C759' : BRAND,
                                    }}>{confirmed ? '確認済' : '確認'}</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            </View>
                          )
                        })}
                      </ScrollView>
                      {/* スクロール可能サイン */}
                      {teamEvents.length > 3 && (
                        <View style={{height:24,backgroundColor:'#ffffff',borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'rgba(0,0,0,0.06)',alignItems:'center',justifyContent:'center'}}>
                          <Ionicons name="chevron-down" size={14} color="#bbb"/>
                        </View>
                      )}
                    </View>
                  )}
                </View>
                </AnimatedSection>

                {/* 今日の欠席報告 */}
                <AnimatedSection delay={100} type="fade-up">
                <View style={{backgroundColor:'#ffffff',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',padding:16,gap:12}}>
                  <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
                    <Text style={{fontSize:18}}>😴</Text>
                    <Text style={{color:TEXT.primary,fontSize:14,fontWeight:'800',flex:1}}>今日の欠席報告</Text>
                  </View>
                  <TextInput
                    style={{backgroundColor:'#f8f8fa',borderRadius:10,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:TEXT.primary,fontSize:13,paddingHorizontal:14,paddingVertical:10,minHeight:52,textAlignVertical:'top'}}
                    value={absenceNote}
                    onChangeText={setAbsenceNote}
                    placeholder="理由・メモを入力（任意）"
                    placeholderTextColor="#9ca3af"
                    multiline
                    maxLength={100}
                  />
                  <HapticTouch
                    haptic="save"
                    style={[{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'#1c1c1e',borderRadius:50,paddingVertical:13},absenceSaving&&{opacity:0.5}]}
                    onPress={async () => {
                      if (absenceSaving) return
                      setAbsenceSaving(true)
                      try {
                        await addAbsenceSession({
                          user_id: 'mock-user-1',
                          session_date: new Date().toISOString().slice(0, 10),
                          session_type: 'rest',
                          fatigue_level: 1,
                          condition_level: 5,
                          notes: `【休み報告】${absenceNote.trim() || '欠席'}`,
                        })
                        try {
                          await sendCoachNotification(
                            joined.code,
                            'absence',
                            joined.playerName,
                            `${joined.playerName}が休みを報告しました${absenceNote.trim() ? `（${absenceNote.trim()}）` : ''}`,
                          )
                        } catch { /* ignore */ }
                        setAbsenceNote('')
                        Toast.show({ type: 'success', text1: '欠席をコーチに報告しました ✓', visibilityTime: 2000 })
                      } catch {
                        Toast.show({ type: 'error', text1: '送信に失敗しました' })
                      } finally {
                        setAbsenceSaving(false)
                      }
                    }}
                    disabled={absenceSaving}
                    activeOpacity={0.85}
                  >
                    <Text style={{color:'#fff',fontSize:14,fontWeight:'800'}}>{absenceSaving ? '送信中...' : '送信する'}</Text>
                  </HapticTouch>
                </View>
                </AnimatedSection>

                {/* マイ コンディション */}
                <AnimatedSection delay={120} type="fade-up">
                <Text style={pl.sectionTitle}>マイ コンディション</Text>
                <View style={{backgroundColor:'#ffffff',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',padding:14}}>
                  <View style={{flexDirection:'row',gap:10,marginBottom:bodyParts.length>0?12:4}}>
                    <View style={{flex:1,alignItems:'center',backgroundColor:'#f0f2f5',borderRadius:10,paddingVertical:12,gap:3}}>
                      <Text style={{fontSize:26}}>{fat?.emoji??'—'}</Text>
                      <Text style={{color:fat?.color??'#888',fontSize:12,fontWeight:'700'}}>{fat?.label??'データなし'}</Text>
                      <Text style={{color:'#555',fontSize:10}}>疲労度</Text>
                    </View>
                    <View style={{flex:1,alignItems:'center',backgroundColor:'#f0f2f5',borderRadius:10,paddingVertical:12,gap:3}}>
                      <Text style={{color:risk.signalColor,fontSize:24,fontWeight:'800'}}>{risk.riskScore}</Text>
                      <Text style={{color:risk.signalColor,fontSize:11,fontWeight:'700'}}>{risk.label}</Text>
                      <Text style={{color:'#555',fontSize:10}}>怪我リスク</Text>
                    </View>
                    <View style={{flex:1,alignItems:'center',backgroundColor: calcStreak(sessions) > 0 ? 'rgba(255,107,53,0.08)' : '#f0f2f5',borderRadius:10,paddingVertical:12,gap:3,borderWidth:1,borderColor: calcStreak(sessions) > 0 ? 'rgba(255,107,53,0.25)' : 'transparent'}}>
                      <Text style={{fontSize:24}}>{calcStreak(sessions) > 0 ? '🔥' : '—'}</Text>
                      <Text style={{color: calcStreak(sessions) > 0 ? '#FF6B35' : '#888',fontSize:12,fontWeight:'800'}}>{calcStreak(sessions) > 0 ? `${calcStreak(sessions)}日` : '0日'}</Text>
                      <Text style={{color:'#555',fontSize:10}}>連続記録</Text>
                    </View>
                  </View>
                  {bodyParts.length > 0 && (
                    <View style={{backgroundColor:'rgba(255,59,48,0.08)',borderRadius:10,padding:10}}>
                      <Text style={{color:'#FF3B30',fontSize:11,fontWeight:'700',marginBottom:6}}>現在の痛み報告</Text>
                      <PainBadges parts={bodyParts}/>
                      {!!bodyDetail && <Text style={{color:'#555',fontSize:12,marginTop:6,lineHeight:18}}>📝 {bodyDetail}</Text>}
                    </View>
                  )}
                </View>
                </AnimatedSection>

              </ScrollView>

            {/* ─ チームメイトタブ ─ display:'none' で常時マウント */}
            <ScrollView
              style={{display: plTab==='members' ? 'flex' : 'none'}}
              contentContainerStyle={{padding:16,paddingBottom:80,gap:14}}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={plLoading}
                  onRefresh={() => { setPlLoading(true); load() }}
                  tintColor="#34C759"
                />
              }
            >
                {teammates.length === 0 ? (
                  <View style={{backgroundColor:'#ffffff',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',padding:32,alignItems:'center',gap:8,marginTop:8}}>
                    <Text style={{fontSize:32}}>👥</Text>
                    <Text style={{color:TEXT.primary,fontSize:15,fontWeight:'700'}}>まだチームメイトがいません</Text>
                    <Text style={{color:'#9ca3af',fontSize:13,textAlign:'center'}}>コーチが他のメンバーを招待すると\nここに表示されます</Text>
                  </View>
                ) : (
                  <AnimatedSection delay={0} type="fade-up">
                  <View style={{backgroundColor:'#ffffff',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',overflow:'hidden'}}>
                    {teammates.map((m, i) => {
                      const stat      = playerStats.find(s => s.player_name === m.player_name)
                      const lvInfo    = calcLevelInfo(stat?.level ?? 1)
                      const lvTier    = RANK_TIERS.find(t => lvInfo.level >= t.min && lvInfo.level < t.max) ?? RANK_TIERS[0]
                      const tmSessions = teamSessionsMap[m.player_name] ?? []
                      // stat.streak が保存済みであればそちらを優先（より正確・リアルタイム）
                      const streak    = stat?.streak ?? calcStreak(tmSessions)
                      const hasPain   = (allBodyReports.find(r => r.player_name === m.player_name)?.parts?.length ?? 0) > 0
                      const event     = stat?.event || m.event || ''
                      const pb        = stat?.pb_display || ''
                      const goal      = stat?.goal || ''
                      return (
                        <HapticTouch
                          haptic="tap"
                          key={m.id}
                          activeOpacity={0.75}
                          onPress={() => setSelectedTeammate(m)}
                          style={{
                            paddingHorizontal:14, paddingVertical:14,
                            borderBottomWidth: i < teammates.length-1 ? StyleSheet.hairlineWidth : 0,
                            borderBottomColor:'rgba(0,0,0,0.07)',
                          }}
                        >
                          {/* 上段: アバター(Lv角バッジ) + 名前+ランク + 連続日数 */}
                          <View style={{flexDirection:'row',alignItems:'center',gap:10,marginBottom:8}}>
                            <View style={{position:'relative'}}>
                              <Avatar name={m.player_name} size={44} color={avatarColor(m.player_name)}/>
                              <View style={{position:'absolute',bottom:-4,right:-4,backgroundColor:lvTier.color,borderRadius:8,paddingHorizontal:4,paddingVertical:1,borderWidth:1.5,borderColor:'#fff'}}>
                                <Text style={{color:'#fff',fontSize:9,fontWeight:'900'}}>Lv{lvInfo.level}</Text>
                              </View>
                            </View>
                            <View style={{flex:1,gap:2}}>
                              <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                                <Text style={{color:TEXT.primary,fontSize:15,fontWeight:'800'}}>{m.player_name}</Text>
                                {hasPain && <Text style={{fontSize:12}}>🤕</Text>}
                              </View>
                              <View style={{flexDirection:'row',alignItems:'center',gap:5}}>
                                <Text style={{fontSize:12}}>{lvTier.emoji}</Text>
                                <Text style={{color:lvTier.color,fontSize:12,fontWeight:'700'}}>{lvTier.title}</Text>
                                {event ? <Text style={{color:'#9ca3af',fontSize:11}}>· {event}</Text> : null}
                              </View>
                            </View>
                            <View style={{alignItems:'flex-end',gap:4}}>
                              {streak > 0 && (
                                <View style={{flexDirection:'row',alignItems:'center',gap:3,backgroundColor:'rgba(255,107,53,0.10)',borderRadius:10,paddingHorizontal:8,paddingVertical:4,borderWidth:1,borderColor:'rgba(255,107,53,0.25)'}}>
                                  <Text style={{fontSize:13}}>🔥</Text>
                                  <Text style={{color:'#FF6B35',fontSize:12,fontWeight:'900'}}>{streak}日連続</Text>
                                </View>
                              )}
                              <Ionicons name="chevron-forward" size={13} color="#d1d5db"/>
                            </View>
                          </View>
                          {/* 下段: PB + 目標 */}
                          <View style={{flexDirection:'row',alignItems:'center',gap:8,marginLeft:54}}>
                            {pb ? (
                              <View style={{flexDirection:'row',alignItems:'center',gap:4,backgroundColor:'rgba(255,149,0,0.10)',borderRadius:8,paddingHorizontal:8,paddingVertical:4,borderWidth:1,borderColor:'rgba(255,149,0,0.25)'}}>
                                <Ionicons name="trophy" size={12} color="#FF9500"/>
                                <Text style={{color:'#FF9500',fontSize:13,fontWeight:'800'}}>{pb}</Text>
                              </View>
                            ) : (
                              <View style={{flexDirection:'row',alignItems:'center',gap:4,backgroundColor:'#f0f2f5',borderRadius:8,paddingHorizontal:8,paddingVertical:4}}>
                                <Ionicons name="trophy-outline" size={12} color="#bbb"/>
                                <Text style={{color:'#bbb',fontSize:12}}>PB未入力</Text>
                              </View>
                            )}
                            {goal ? <Text style={{color:'#6b7280',fontSize:12,flex:1}} numberOfLines={1}>🎯 {goal}</Text> : null}
                          </View>
                        </HapticTouch>
                      )
                    })}
                  </View>
                  </AnimatedSection>
                )}
              </ScrollView>
          </>
        )}
      </SafeAreaView>

      {/* 痛み報告モーダル */}
      <Modal visible={showBody} transparent animationType="slide" onRequestClose={() => setShowBody(false)}>
        <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.8)',justifyContent:'flex-end'}}>
          <View style={{backgroundColor:'#ffffff',borderTopLeftRadius:24,borderTopRightRadius:24,padding:20,paddingBottom:44,borderTopWidth:1,borderColor:'rgba(0,0,0,0.08)'}}>
            <View style={{width:36,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.12)',alignSelf:'center',marginBottom:16}}/>
            <View style={{flexDirection:'row',alignItems:'center',marginBottom:16}}>
              <Text style={{color:'#111827',fontSize:17,fontWeight:'800',flex:1}}>痛みや違和感のある箇所</Text>
              <TouchableOpacity onPress={() => setShowBody(false)} hitSlop={{top:10,bottom:10,left:10,right:10}}>
                <Ionicons name="close" size={22} color={TEXT.secondary}/>
              </TouchableOpacity>
            </View>
            <Text style={{color:'#666',fontSize:12,marginBottom:14}}>
              痛い箇所をタップして選択してください（複数OK）。コーチに伝わります。
            </Text>
            <BodyPartSelector selected={editBody} onChange={setEditBody}/>
            <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8,marginTop:16,marginBottom:6}}>詳細・メモ（任意）</Text>
            <TextInput
              style={{backgroundColor:'#f8f8fa',borderRadius:10,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:TEXT.primary,fontSize:14,paddingHorizontal:14,paddingVertical:10,minHeight:60,textAlignVertical:'top'}}
              value={editBodyDetail}
              onChangeText={setEditBodyDetail}
              placeholder="例: 走ると右膝が痛む、昨日から違和感がある..."
              placeholderTextColor="#9ca3af"
              multiline
              maxLength={120}
            />
            {editBody.length > 0 ? (
              <HapticTouch haptic="save" style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:14,marginTop:14}} onPress={saveBodyReport} activeOpacity={0.85}>
                <Ionicons name="send" size={18} color="#fff"/>
                <Text style={{color:'#fff',fontSize:15,fontWeight:'800'}}>コーチに報告する</Text>
              </HapticTouch>
            ) : (
              <HapticTouch haptic="save" style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'#f0f2f5',borderRadius:14,paddingVertical:14,marginTop:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)'}} onPress={saveBodyReport} activeOpacity={0.85}>
                <Text style={{color:'#888',fontSize:15,fontWeight:'700'}}>痛みなし（クリア）</Text>
              </HapticTouch>
            )}
          </View>
        </View>
      </Modal>

      {/* PB・プロフィール編集モーダル */}
      <Modal visible={showStatsEdit} transparent animationType="slide" onRequestClose={() => setShowStatsEdit(false)}>
        <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
          <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.8)',justifyContent:'flex-end'}}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowStatsEdit(false)} activeOpacity={1}/>
            <View style={{backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,minHeight:SCREEN_H*0.55,maxHeight:SCREEN_H*0.85}}>
              <View style={{paddingHorizontal:22,paddingTop:18,paddingBottom:4}}>
                <View style={{width:36,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.12)',alignSelf:'center'}}/>
                <View style={{flexDirection:'row',alignItems:'center',marginTop:14}}>
                  <Text style={{color:'#111827',fontSize:18,fontWeight:'800',flex:1}}>プロフィール編集</Text>
                  <TouchableOpacity onPress={() => setShowStatsEdit(false)} hitSlop={{top:10,bottom:10,left:10,right:10}}>
                    <Ionicons name="close" size={22} color={TEXT.secondary}/>
                  </TouchableOpacity>
                </View>
                <Text style={{color:'#6b7280',fontSize:12,lineHeight:18,marginTop:8}}>
                  入力するとチームメイトに表示されます。レベルはアプリの練習記録数から自動計算されます。
                </Text>
              </View>
              <ScrollView contentContainerStyle={{paddingHorizontal:22,paddingBottom:48,gap:14}} keyboardShouldPersistTaps="handled">
                {/* 種目 */}
                <View style={{gap:6}}>
                  <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>種目</Text>
                  <TextInput
                    style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:15,paddingHorizontal:14,paddingVertical:12}}
                    value={editEvent} onChangeText={setEditEvent}
                    placeholder="例: 100m, 走り幅跳び" placeholderTextColor="#9ca3af" maxLength={20}
                  />
                </View>
                {/* 自己ベスト */}
                <View style={{gap:6}}>
                  <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>自己ベスト</Text>
                  <TextInput
                    style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:15,paddingHorizontal:14,paddingVertical:12}}
                    value={editPb} onChangeText={setEditPb}
                    placeholder="例: 10.83, 6m42cm" placeholderTextColor="#9ca3af" maxLength={20}
                  />
                </View>
                {/* 目標 */}
                <View style={{gap:6}}>
                  <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>目標</Text>
                  <TextInput
                    style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:15,paddingHorizontal:14,paddingVertical:12}}
                    value={editGoal} onChangeText={setEditGoal}
                    placeholder="例: 都大会入賞、自己ベスト更新" placeholderTextColor="#9ca3af" maxLength={40}
                  />
                </View>
                <HapticTouch
                  haptic="save"
                  style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:15}}
                  onPress={saveStats} activeOpacity={0.85}
                >
                  <Ionicons name="checkmark-circle" size={18} color="#fff"/>
                  <Text style={{color:'#fff',fontSize:16,fontWeight:'800'}}>チームに公開する</Text>
                </HapticTouch>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 動画送信モーダル */}
      <VideoSubmitModal
        visible={showVideoModal}
        teamCode={joined.code}
        playerName={joined.playerName}
        onClose={() => setShowVideoModal(false)}
        onSent={load}
      />

      <TeamMenuSheet
        visible={showMenu}
        role="player"
        canSwitch={canSwitchRole ?? false}
        onSwitchRole={onSwitchRole}
        onDangerAction={onLeaveTeam}
        onClose={() => setShowMenu(false)}
      />

      {/* チームメイト詳細シート */}
      {selectedTeammate && (
        <TeammateProfileSheet
          member={selectedTeammate}
          stats={playerStats.find(s => s.player_name === selectedTeammate.player_name)}
          sessions={teamSessionsMap[selectedTeammate.player_name] ?? []}
          onClose={() => setSelectedTeammate(null)}
        />
      )}
    </View>
  )
}

const co = StyleSheet.create({
  header:     { flexDirection:'row', alignItems:'flex-start', justifyContent:'space-between', padding:18, paddingBottom:8 },
  title:      { color:TEXT.primary, fontSize:20, fontWeight:'800' },
  codeBox:    { backgroundColor:'rgba(229,57,53,0.08)', borderRadius:10, borderWidth:1, borderColor:BRAND+'30', paddingHorizontal:10, paddingVertical:6, alignItems:'center' },
  switchBtn:  { width:34, height:34, borderRadius:10, backgroundColor:'#f0f2f5', borderWidth:1, borderColor:'rgba(0,0,0,0.08)', alignItems:'center', justifyContent:'center' },
  tabsWrapper:    { height:48, overflow:'hidden', backgroundColor:'#ffffff', borderBottomWidth:1, borderBottomColor:'rgba(0,0,0,0.08)' },
  tabs:       { flexDirection:'row', paddingHorizontal:16 },
  tab:        { flexDirection:'row', alignItems:'center', justifyContent:'center', gap:4, paddingVertical:12, paddingHorizontal:12 },
  tabActive:  { backgroundColor: BRAND + '14', borderRadius:8 },
  tabLabel:   { fontSize:13, fontWeight:'700' },
  badge:      { width:16, height:16, borderRadius:8, backgroundColor:'#ef4444', alignItems:'center', justifyContent:'center' },
  alertChip:  { flexDirection:'row', alignItems:'center', gap:5, backgroundColor:'rgba(239,68,68,0.08)', borderRadius:8, borderWidth:1, borderColor:'#ef4444'+'40', paddingHorizontal:10, paddingVertical:6 },
  memberCard: { backgroundColor:'#ffffff', borderRadius:16, borderWidth:1, borderColor:'rgba(0,0,0,0.08)', padding:16, shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.06, shadowRadius:8, elevation:2 },
  composeBox: { flexDirection:'row', gap:10, alignItems:'flex-end', backgroundColor:'#ffffff', borderRadius:14, borderWidth:1, borderColor:'rgba(0,0,0,0.10)', padding:12 },
  composeInput:{ flex:1, color:TEXT.primary, fontSize:14, minHeight:40, maxHeight:100 },
  sendBtn:    { width:42, height:42, borderRadius:12, backgroundColor:BRAND, alignItems:'center', justifyContent:'center' },
  msgCard:    { backgroundColor:'#ffffff', borderRadius:12, borderWidth:1, borderColor:'rgba(0,0,0,0.08)', padding:14, shadowColor:'#000', shadowOffset:{width:0,height:1}, shadowOpacity:0.04, shadowRadius:4, elevation:1 },
  videoCard:  { backgroundColor:'#ffffff', borderRadius:14, borderWidth:1, borderColor:'rgba(0,0,0,0.08)', padding:14, shadowColor:'#000', shadowOffset:{width:0,height:1}, shadowOpacity:0.04, shadowRadius:4, elevation:1 },
})
const pl = StyleSheet.create({
  sectionTitle: { color:TEXT.hint, fontSize:11, fontWeight:'700', letterSpacing:1, marginTop:4 },
  actionBtn:    { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, backgroundColor:'#f0f2f5', borderRadius:14, borderWidth:1, borderColor:'rgba(0,0,0,0.08)', paddingVertical:14 },
})

// ─────────────────────────────────────────────────────────
// TeamMenuSheet — スワップボタンから開くアクションシート
// ─────────────────────────────────────────────────────────
function TeamMenuSheet({ visible, role, canSwitch, onSwitchRole, onDangerAction, onClose }: {
  visible: boolean
  role: 'coach' | 'player'
  canSwitch: boolean
  onSwitchRole: () => void
  onDangerAction: () => void
  onClose: () => void
}) {
  // iOSでは2つのModalを同時に表示できないため、
  // メニューModalを先に閉じてから確認ダイアログを開く
  const [showConfirm, setShowConfirm] = useState(false)

  const dangerLabel   = role === 'coach' ? 'チームを削除' : 'チームを脱退'
  const dangerMessage = role === 'coach'
    ? '参加コードが無効になり、全メンバーのデータが失われます。本当に削除しますか？'
    : 'チームを脱退します。再参加するにはコードが必要です。本当に脱退しますか？'

  function handleDangerPress() {
    // ① まずメニューを閉じる
    onClose()
    // ② Modalの閉じアニメーション（300ms）完了後に確認ダイアログを開く
    setTimeout(() => setShowConfirm(true), 350)
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.6)',justifyContent:'flex-end'}}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose}/>
          <View style={{backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,padding:24,paddingBottom:48,gap:12}}>
            <View style={{width:36,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.12)',alignSelf:'center',marginBottom:4}}/>
            <Text style={{color:'#111827',fontSize:17,fontWeight:'800'}}>チームメニュー</Text>

            {/* ロール切り替えボタンは非表示 */}

            {/* 危険操作 */}
            <TouchableOpacity
              style={{flexDirection:'row',alignItems:'center',gap:14,backgroundColor:'rgba(239,68,68,0.06)',borderRadius:16,padding:16,borderWidth:1,borderColor:'rgba(239,68,68,0.2)'}}
              onPress={handleDangerPress}
              activeOpacity={0.8}
            >
              <View style={{width:44,height:44,borderRadius:13,backgroundColor:'rgba(239,68,68,0.12)',alignItems:'center',justifyContent:'center'}}>
                <Ionicons name={role==='coach'?'trash-outline':'exit-outline'} size={22} color="#ef4444"/>
              </View>
              <View style={{flex:1}}>
                <Text style={{color:'#ef4444',fontSize:15,fontWeight:'700'}}>{dangerLabel}</Text>
                <Text style={{color:'#9ca3af',fontSize:12,marginTop:2}}>
                  {role === 'coach' ? '参加コードが無効になります' : '再参加にはコードが必要です'}
                </Text>
              </View>
            </TouchableOpacity>

            {/* キャンセル */}
            <TouchableOpacity
              style={{alignItems:'center',paddingVertical:15,borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.09)',marginTop:4}}
              onPress={onClose} activeOpacity={0.7}
            >
              <Text style={{color:'#6b7280',fontSize:15,fontWeight:'600'}}>キャンセル</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* メニューModalが閉じてから表示（iOS 2-Modal同時表示禁止対策） */}
      <ConfirmSheet
        visible={showConfirm}
        title={dangerLabel}
        message={dangerMessage}
        confirmLabel={role === 'coach' ? '削除する' : '脱退する'}
        dangerous
        onConfirm={() => { setShowConfirm(false); setTimeout(onDangerAction, 100) }}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  )
}

// ─────────────────────────────────────────────────────────
// TeamScreen（エントリーポイント）
// ─────────────────────────────────────────────────────────
export default function TeamScreen() {
  type State = 'loading'|'select-role'|'coach-paywall'|'coach-setup'|'coach'|'player-join'|'player'
  const [state,  setState]  = useState<State>('loading')
  const [setup,  setSetup]  = useState<TeamSetup|null>(null)
  const [joined, setJoined] = useState<JoinedTeam|null>(null)
  const { tier, isCoach } = usePurchase()
  const fadeY = useRef(new Animated.Value(0)).current

  useFocusEffect(useCallback(() => {
    fadeY.setValue(0)
    const anim = Animated.timing(fadeY, {
      toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, []))

  useEffect(() => {
    async function init() {
      try {
        initOneSignal()
        const [roleRaw, setupRaw, joinedRaw] = await Promise.all([
          AsyncStorage.getItem(ROLE_KEY),
          AsyncStorage.getItem(SETUP_KEY),
          AsyncStorage.getItem(JOINED_KEY),
        ])
        const role = roleRaw as Role|null
        // 保存済みデータは常にメモリにロード（壊れていてもクラッシュしない）
        try { if (setupRaw)  setSetup(JSON.parse(setupRaw)) } catch {}
        try { if (joinedRaw) setJoined(JSON.parse(joinedRaw)) } catch {}

        if (!role) { setState('select-role'); return }
        if (role === 'coach') {
          // サブスクリプションキャッシュでコーチプランを確認
          const subRaw = await AsyncStorage.getItem('trackmate_subscription').catch(() => null)
          let subTier = 'free'
          try { subTier = subRaw ? (JSON.parse(subRaw)?.plan ?? 'free') : 'free' } catch {}
          if (subTier !== 'coach') {
            // プラン未購入または期限切れ → ペイウォールへ
            setState('coach-paywall')
            return
          }
          setState(setupRaw ? 'coach' : 'coach-setup')
        } else {
          setState(joinedRaw ? 'player' : 'player-join')
        }
      } catch {
        setState('select-role')
      }
    }
    init()
  }, [])

  // ロール選択 — コーチはplan検証あり
  async function handleSelectRole(role: Role) {
    if (role === 'coach') {
      // コーチプランを持っていなければペイウォールへ
      if (tier !== 'coach') {
        setState('coach-paywall')
        return
      }
    }
    await AsyncStorage.setItem(ROLE_KEY, role)
    if (role === 'coach')  { setState(setup  ? 'coach'  : 'coach-setup')  }
    else                   { setState(joined ? 'player' : 'player-join') }
  }

  function handleCoachCreated(s: TeamSetup)  { setSetup(s);  setState('coach')  }
  function handlePlayerJoined(j: JoinedTeam) { setJoined(j); setState('player') }

  // ロール切り替え — データは消さない
  async function handleSwitchRole() {
    await AsyncStorage.removeItem(ROLE_KEY)
    setState('select-role')
  }

  // チーム削除（コーチ）
  async function handleDeleteTeam() {
    await AsyncStorage.multiRemove([ROLE_KEY, SETUP_KEY])
    setSetup(null)
    setState('select-role')
  }

  // チーム脱退（選手）
  async function handleLeaveTeam() {
    await AsyncStorage.multiRemove([ROLE_KEY, JOINED_KEY])
    setJoined(null)
    setState('select-role')
  }

  const fadeStyle = { flex: 1, opacity: fadeY, transform: [{ translateY: fadeY.interpolate({ inputRange: [0,1], outputRange: [14,0] }) }] }

  if (state==='loading')          return <View style={{flex:1,backgroundColor:'#0a0a0a'}}/>
  if (state==='select-role')      return <Animated.View style={fadeStyle}><RoleSelectionScreen onSelect={handleSelectRole}/></Animated.View>
  if (state==='coach-paywall')    return <Animated.View style={fadeStyle}><CoachPaywallScreen onBack={() => setState('select-role')} onPurchased={async () => { await AsyncStorage.setItem(ROLE_KEY, 'coach'); setState(setup ? 'coach' : 'coach-setup') }}/></Animated.View>
  if (state==='coach-setup')      return <Animated.View style={fadeStyle}><CoachSetupScreen onCreated={handleCoachCreated} onBack={() => setState('select-role')}/></Animated.View>
  if (state==='coach' && setup)   return <Animated.View style={fadeStyle}><CoachDashboard  setup={setup}   onSwitchRole={handleSwitchRole} onDeleteTeam={handleDeleteTeam}  canSwitchRole={true}/></Animated.View>
  if (state==='player-join')      return <Animated.View style={fadeStyle}><PlayerJoinScreen onJoined={handlePlayerJoined} onBack={() => setState('select-role')}/></Animated.View>
  if (state==='player' && joined) return <Animated.View style={fadeStyle}><PlayerDashboard joined={joined} onSwitchRole={handleSwitchRole} onLeaveTeam={handleLeaveTeam}  canSwitchRole={true}/></Animated.View>
  return <View style={{flex:1,backgroundColor:'#0a0a0a'}}/>
}

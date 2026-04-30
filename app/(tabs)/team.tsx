// app/(tabs)/team.tsx — チーム機能 v3（Supabase同期 + OneSignal通知）
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Modal, Linking, Dimensions,
} from 'react-native'
const SCREEN_H = Dimensions.get('window').height
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { BRAND, TEXT } from '../../lib/theme'
import AnimatedSection from '../../components/AnimatedSection'
import { calcInjuryRisk } from '../../lib/injuryRisk'
import { calcLevelInfo, RANK_TIERS } from '../../lib/gamification'
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
  type TeamMessageRow, type TeamVideoRow, type BodyReportRow, type TeamMemberRow, type PlayerStatsRow, type TeamSessionRow, type TeamEventRow, type TeamEventType,
} from '../../lib/supabaseTeam'
import { useTheme } from '../../context/ThemeContext'
import {
  initOneSignal, requestPushPermission, registerUserTags, sendPush,
} from '../../lib/notify'

// ── ストレージキー（ローカル設定のみ） ────────────────────
const ROLE_KEY          = 'trackmate_team_role'
const SESSIONS_KEY      = 'trackmate_sessions'
const SETUP_KEY         = 'trackmate_team_setup'
const JOINED_KEY        = 'trackmate_team_joined'
const SLEEP_KEY         = 'trackmate_sleep'
const CONDITION_MAP_KEY = 'trackmate_condition_map'

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
  high:   { color: '#FF9500', bg: 'rgba(255,149,0,0.12)', label: '注意' },
  medium: { color: '#F5A623', bg: 'rgba(245,166,35,0.12)', label: '中程度' },
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
      return sum + (s.distance_m ? (s.distance_m / 100) * (s.reps ?? 1) * w : w)
    }
    if (s.session_type === 'tempo' || s.session_type === 'easy' || s.session_type === 'long') {
      return sum + (s.distance_m ? (s.distance_m / 1000) * w : w)
    }
    return sum + w
  }, 0))
}
function loadCfgKey(score: number): LoadCfgKey {
  if (score >= 1000) return 'danger'
  if (score >= 700)  return 'high'
  if (score >= 400)  return 'medium'
  return 'low'
}
function riskCfgKey(score: number): RiskCfgKey {
  if (score >= 70) return 'danger'
  if (score >= 55) return 'high'
  if (score >= 40) return 'medium'
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
// VideoSubmitModal — 動画URL送信（選手用）
// ─────────────────────────────────────────────────────────
function VideoSubmitModal({ visible, teamCode, playerName, onClose, onSent }: {
  visible: boolean; teamCode: string; playerName: string; onClose: () => void; onSent: () => void
}) {
  const [url,  setUrl]  = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)

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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={vs.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={vs.sheet}>
          <View style={{width:36,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.12)',alignSelf:'center',marginBottom:16}}/>
          <View style={{flexDirection:'row',alignItems:'center',marginBottom:20}}>
            <Text style={{color:'#fff',fontSize:18,fontWeight:'800',flex:1}}>動画をコーチに送る</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{top:10,bottom:10,left:10,right:10}}>
              <Ionicons name="close" size={22} color={TEXT.secondary}/>
            </TouchableOpacity>
          </View>

          <Text style={vs.label}>動画のURL（YouTube / Google Drive など）</Text>
          <TextInput style={vs.input} value={url} onChangeText={setUrl} placeholder="https://..." placeholderTextColor="#9ca3af" autoCapitalize="none" keyboardType="url"/>

          <Text style={[vs.label,{marginTop:14}]}>説明（任意）</Text>
          <TextInput style={[vs.input,{height:72,textAlignVertical:'top',paddingTop:10}]} value={desc} onChangeText={setDesc} placeholder="フォームの確認をお願いします..." placeholderTextColor="#9ca3af" multiline maxLength={100}/>

          <View style={{backgroundColor:'#f0f2f5',borderRadius:10,padding:12,marginTop:12}}>
            <Text style={{color:'#6b7280',fontSize:11,lineHeight:18}}>
              💡 YouTubeで「限定公開」にして貼り付けるのがおすすめ。動画は7日後に自動で削除されます。
            </Text>
          </View>

          <TouchableOpacity style={[vs.btn,busy&&{opacity:0.5}]} onPress={submit} disabled={busy} activeOpacity={0.85}>
            <Ionicons name="send" size={18} color="#fff"/>
            <Text style={{color:'#fff',fontSize:16,fontWeight:'800'}}>{busy?'送信中...':'送る'}</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}
const vs = StyleSheet.create({ // vs = video submit
  overlay:{ flex:1, backgroundColor:'rgba(0,0,0,0.8)', justifyContent:'flex-end' },
  sheet:  { backgroundColor:'#ffffff', borderTopLeftRadius:24, borderTopRightRadius:24, padding:20, paddingBottom:44, borderTopWidth:1, borderColor:'rgba(0,0,0,0.08)' },
  label:  { color:TEXT.hint, fontSize:11, fontWeight:'700', letterSpacing:0.8, marginBottom:8 },
  input:  { backgroundColor:'#f8f8fa', borderRadius:10, borderWidth:1, borderColor:'rgba(0,0,0,0.10)', color:TEXT.primary, fontSize:14, paddingHorizontal:14, paddingVertical:12 },
  btn:    { flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, backgroundColor:BRAND, borderRadius:14, paddingVertical:15, marginTop:16 },
})

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
          const s: TeamSetup = JSON.parse(raw)
          if (s.code === cleaned) { teamName = s.teamName; coachName = s.coachName }
          else {
            // コードが一致しない + サーバーにもない = 無効なコード
            Toast.show({type:'error',text1:'チームが見つかりません。コードを確認してください'}); setBusy(false); return
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
                style={[su.input,{fontSize:24,fontWeight:'900',textAlign:'center',letterSpacing:6,paddingVertical:18}]}
                value={formatCode(code)}
                onChangeText={v => setCode(v.replace(/[^A-Za-z0-9]/g,'').slice(0,6))}
                placeholder="ABC-123"
                placeholderTextColor="#9ca3af"
                autoCapitalize="characters"
                maxLength={7}
              />
            </View>
            <View style={{gap:6}}>
              <Text style={su.label}>あなたの名前</Text>
              <TextInput style={su.input} value={playerName} onChangeText={setPlayerName} placeholder="例: 田中 翼" placeholderTextColor="#9ca3af" maxLength={20}/>
            </View>
            <TouchableOpacity
              style={[{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'#34C759',borderRadius:14,paddingVertical:15},(code.replace(/[^A-Za-z0-9]/g,'').length<6||busy)&&{opacity:0.4}]}
              onPress={join}
              disabled={code.replace(/[^A-Za-z0-9]/g,'').length<6||busy}
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
function CoachDashboard({ setup, onSwitchRole, onDeleteTeam }: {
  setup: TeamSetup; onSwitchRole: () => void; onDeleteTeam: () => void
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
  const [tab,           setTab]           = useState<'members'|'messages'|'videos'|'calendar'>('members')
  const [detailMember,  setDetailMember]  = useState<Member|null>(null)
  const [memberFilter,  setMemberFilter]  = useState<'all'|'danger'|'unsubmitted'|'pain'>('all')
  const [hiddenDemoIds, setHiddenDemoIds] = useState<string[]>([])
  const [showMenu,      setShowMenu]      = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{id:string;name:string;isDemo:boolean}|null>(null)
  const [showEventModal, setShowEventModal] = useState(false)
  const [evTitle,       setEvTitle]       = useState('')
  const [evDate,        setEvDate]        = useState('')
  const [evTime,        setEvTime]        = useState('')
  const [evLocation,    setEvLocation]    = useState('')
  const [evDesc,        setEvDesc]        = useState('')
  const [evType,        setEvType]        = useState<TeamEventType>('practice')

  const load = useCallback(async () => {
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
    setLoading(false)
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
  }, [setup.code])

  useEffect(() => { load() }, [load])
  // タブに戻るたびに再ロード（Realtimeの補完）
  useFocusEffect(useCallback(() => { load() }, [load]))

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
      await initOneSignal()
      await requestPushPermission()
      await registerUserTags('coach', setup.code)
    })()
  }, [setup.code])

  async function sendMessage() {
    if (!msgText.trim()) return
    await postMessage(setup.code, msgText.trim(), setup.coachName)
    await sendPush(`📣 ${setup.teamName}`, msgText.trim(), 'players', setup.code)
    setMsgText('')
    await load()
    Toast.show({type:'success',text1:'送信しました',visibilityTime:1400})
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
    Toast.show({ type: 'success', text1: '確認済みにしました ✓', visibilityTime: 1400 })
    setDetailMember(null)
  }

  async function addEvent() {
    if (!evTitle.trim() || !evDate.trim()) return
    // 状態リセット前に値をキャプチャ
    const title    = evTitle.trim()
    const date     = evDate.trim()
    const time     = evTime.trim()
    const location = evLocation.trim()
    const desc     = evDesc.trim()
    const type     = evType
    try {
      const result = await addTeamEvent(setup.code, title, date, time, location, desc, type, setup.coachName)
      setShowEventModal(false)
      setEvTitle(''); setEvDate(''); setEvTime(''); setEvLocation(''); setEvDesc(''); setEvType('practice')
      // 表示を即時更新してからリロード
      setTeamEvents(prev => [...prev, result].sort((a, b) => a.event_date.localeCompare(b.event_date)))
      await load()
      sendPush(`📅 ${setup.teamName}`, `新しい予定：${title}（${date}）`, 'players', setup.code)
      Toast.show({ type: 'success', text1: '予定を追加しました', visibilityTime: 1400 })
    } catch (e) {
      console.error('[addEvent]', e)
      Toast.show({ type: 'error', text1: '追加できませんでした', text2: String(e), visibilityTime: 2500 })
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
    // セッションがない場合はplayer_statsに保存された最終体調を使ってスコアを計算
    const condLevel  = m.sessions[0]?.condition_level ?? pStat?.last_condition ?? 7
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
    return { ...m, risk, weeklyLoad, condToday }
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
    if (memberFilter === 'unsubmitted') return !m.condToday
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
        <View style={co.tabs}>
          {([
            { key:'members',  label:'メンバー',  badge: unackedPainCount + highRiskMembers.length },
            { key:'messages', label:'アナウンス', badge: 0 },
            { key:'videos',   label:'動画',      badge: newVideos },
            { key:'calendar', label:'予定',      badge: 0 },
          ] as const).map(t => (
            <TouchableOpacity key={t.key} style={[co.tab, tab===t.key && co.tabActive]} onPress={() => setTab(t.key)} activeOpacity={0.7}>
              <Text style={[co.tabLabel, { color: tab===t.key ? BRAND : '#555' }]}>{t.label}</Text>
              {t.badge > 0 && <View style={co.badge}><Text style={{color:'#fff',fontSize:9,fontWeight:'800'}}>{t.badge}</Text></View>}
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView contentContainerStyle={{padding:16,paddingBottom:60,gap:18}} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* ローディング中 */}
          {loading && (
            <View style={{alignItems:'center',paddingVertical:60,gap:12}}>
              <Text style={{fontSize:32}}>⏳</Text>
              <Text style={{color:'#9ca3af',fontSize:14}}>データを読み込み中...</Text>
            </View>
          )}

          {/* ═══ メンバータブ ═══ */}
          {!loading && tab === 'members' && (
            <AnimatedSection key="members" delay={0} type="fade-up">
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
                  style={{backgroundColor:'rgba(255,149,0,0.08)',borderLeftWidth:4,borderLeftColor:'#FF9500',borderRadius:12,borderWidth:1,borderColor:'rgba(255,149,0,0.3)',padding:12,flexDirection:'row',alignItems:'flex-start',gap:10}}
                  onPress={() => setMemberFilter(memberFilter==='pain'?'all':'pain')}
                  activeOpacity={0.8}
                >
                  <Text style={{fontSize:16,marginTop:1}}>🤕</Text>
                  <View style={{flex:1}}>
                    <Text style={{color:'#FF9500',fontSize:13,fontWeight:'800',marginBottom:2}}>
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

              {/* サマリー4カラム */}
              <View style={{flexDirection:'row',gap:6}}>
                {[
                  { label:'痛み報告', value:`🤕 ${unackedPainCount}件`, color: unackedPainCount>0?'#FF9500':'#34C759', filter:'pain' as const },
                  { label:'高リスク', value:`⚠️ ${highRiskMembers.length}人`, color: highRiskMembers.length>0?'#E53935':'#34C759', filter:'danger' as const },
                  { label:'未提出',   value:`${memberData.length-submittedCount}人`, color: (memberData.length-submittedCount)>0?'#6b7280':'#34C759', filter:'unsubmitted' as const },
                  { label:'チーム負荷', value: LOAD_CFG[loadCfgKey(avgLoad)].label, color: LOAD_CFG[loadCfgKey(avgLoad)].color, filter:'all' as const },
                ].map((item) => (
                  <TouchableOpacity key={item.label} onPress={() => setMemberFilter(memberFilter===item.filter&&item.filter!=='all'?'all':item.filter)} style={{
                    flex:1, backgroundColor: memberFilter===item.filter&&item.filter!=='all'?item.color+'15':'#f0f2f5',
                    borderWidth:1, borderColor: memberFilter===item.filter&&item.filter!=='all'?item.color+'60':'rgba(0,0,0,0.08)',
                    borderRadius:12, paddingVertical:10, paddingHorizontal:6, alignItems:'center', gap:2,
                  }} activeOpacity={0.8}>
                    <Text style={{color:item.color,fontSize:13,fontWeight:'800'}}>{item.value}</Text>
                    <Text style={{color:'#555',fontSize:9,fontWeight:'600'}}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
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
                    <TouchableOpacity
                      key={m.id}
                      style={[
                        co.memberCard,
                        unackedPain && { borderColor:'rgba(255,149,0,0.5)', backgroundColor:'rgba(255,149,0,0.04)' },
                        !unackedPain && isHigh && { borderColor:'rgba(229,57,53,0.3)', backgroundColor:'rgba(229,57,53,0.03)' },
                      ]}
                      onPress={() => setDetailMember(m)}
                      activeOpacity={0.88}
                    >
                      {/* 負荷カラーバー（上端） */}
                      <View style={{
                        height: unackedPain ? 5 : 4,
                        backgroundColor: unackedPain ? '#FF9500' : lCfg.color,
                        marginHorizontal:-16, marginTop:-16, marginBottom:12,
                        borderTopLeftRadius:14, borderTopRightRadius:14,
                        opacity: unackedPain ? 1 : 0.7,
                      }}/>

                      {/* 未確認の痛み報告バナー */}
                      {unackedPain && (
                        <View style={{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:'rgba(255,149,0,0.1)',borderRadius:8,paddingHorizontal:10,paddingVertical:6,marginBottom:10,borderWidth:1,borderColor:'rgba(255,149,0,0.3)'}}>
                          <Text style={{fontSize:14}}>🤕</Text>
                          <Text style={{color:'#FF9500',fontSize:12,fontWeight:'800',flex:1}}>
                            痛み報告あり — タップして確認
                          </Text>
                          <View style={{backgroundColor:'#FF9500',borderRadius:4,paddingHorizontal:5,paddingVertical:1}}>
                            <Text style={{color:'#fff',fontSize:9,fontWeight:'800'}}>未確認</Text>
                          </View>
                        </View>
                      )}

                      <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
                        <Avatar name={m.name} size={44} color={unackedPain ? '#FF9500' : avatarColor(m.name)}/>

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

                          {/* リスク + 負荷 + 疲労 */}
                          <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                            {/* リスクスコア */}
                            {m.sessions.length === 0 ? (
                              <View style={{backgroundColor:'#f0f2f5',borderRadius:8,paddingHorizontal:8,paddingVertical:4,flexDirection:'row',alignItems:'center',gap:3}}>
                                <Ionicons name="cloud-offline-outline" size={10} color="#9ca3af"/>
                                <Text style={{color:'#9ca3af',fontSize:10,fontWeight:'700'}}>未同期</Text>
                              </View>
                            ) : (
                              <View style={{backgroundColor:rCfg.bg,borderRadius:8,paddingHorizontal:8,paddingVertical:4,flexDirection:'row',alignItems:'center',gap:4}}>
                                <Text style={{color:rCfg.color,fontSize:13,fontWeight:'900'}}>{m.risk.riskScore}</Text>
                                <Text style={{color:rCfg.color,fontSize:10,fontWeight:'700'}}>{rCfg.label}</Text>
                              </View>
                            )}
                            {/* 週間負荷 */}
                            <View style={{backgroundColor:'rgba(0,0,0,0.04)',borderRadius:8,paddingHorizontal:8,paddingVertical:4,flexDirection:'row',alignItems:'center',gap:3}}>
                              <View style={{width:6,height:6,borderRadius:3,backgroundColor:lCfg.color}}/>
                              <Text style={{color:'#555',fontSize:10,fontWeight:'700'}}>{lCfg.label}</Text>
                            </View>
                            {/* 体調 */}
                            {m.condToday ? (
                              <Text style={{fontSize:18}}>{'😫😕😐😊💪'.charAt(Math.round((m.condToday - 2) / 2))}</Text>
                            ) : (
                              <View style={{backgroundColor:'#f0f2f5',borderRadius:6,paddingHorizontal:6,paddingVertical:3}}>
                                <Text style={{color:'#888',fontSize:9,fontWeight:'700'}}>未提出</Text>
                              </View>
                            )}
                            {/* 確認済み痛み */}
                            {ackedPain && (
                              <View style={{backgroundColor:'rgba(52,199,89,0.1)',borderRadius:6,paddingHorizontal:6,paddingVertical:3,flexDirection:'row',alignItems:'center',gap:3}}>
                                <Ionicons name="checkmark-circle" size={10} color="#34C759"/>
                                <Text style={{color:'#34C759',fontSize:9,fontWeight:'700'}}>確認済</Text>
                              </View>
                            )}
                          </View>

                          {/* リスクバー（細め） */}
                          <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                            <View style={{flex:1,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.07)',overflow:'hidden'}}>
                              <View style={{width:`${m.risk.riskScore}%`,height:'100%',borderRadius:2,backgroundColor:rCfg.color}}/>
                            </View>
                            <Text style={{color:'#aaa',fontSize:9}}>{m.sessions.length}回</Text>
                          </View>
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
                    </TouchableOpacity>
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
            </AnimatedSection>
          )}

          {/* ═══ アナウンスタブ ═══ */}
          {!loading && tab === 'messages' && (
            <AnimatedSection key="messages" delay={0} type="fade-up">
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
                <TouchableOpacity style={[co.sendBtn,!msgText.trim()&&{opacity:0.3}]} onPress={sendMessage} disabled={!msgText.trim()} activeOpacity={0.8}>
                  <Ionicons name="send" size={18} color="#fff"/>
                </TouchableOpacity>
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
            </AnimatedSection>
          )}

          {/* ═══ 動画タブ ═══ */}
          {!loading && tab === 'videos' && (
            <AnimatedSection key="videos" delay={0} type="fade-up">
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
            </AnimatedSection>
          )}

          {/* ═══ カレンダータブ ═══ */}
          {!loading && tab === 'calendar' && (
            <AnimatedSection key="calendar" delay={0} type="fade-up">
            <View style={{gap:14}}>
              {/* 追加ボタン */}
              <TouchableOpacity
                style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:14}}
                onPress={() => setShowEventModal(true)}
                activeOpacity={0.85}
              >
                <Ionicons name="add-circle-outline" size={20} color="#fff"/>
                <Text style={{color:'#fff',fontSize:15,fontWeight:'800'}}>予定を追加する</Text>
              </TouchableOpacity>

              {teamEvents.length === 0 ? (
                <View style={{alignItems:'center',padding:40,gap:8}}>
                  <Text style={{fontSize:36}}>📅</Text>
                  <Text style={{color:'#9ca3af',fontSize:14}}>予定はまだありません</Text>
                  <Text style={{color:'#c4c4c4',fontSize:12}}>上のボタンから追加してください</Text>
                </View>
              ) : (
                <View style={{gap:10}}>
                  {teamEvents.map(ev => {
                    const cfg = EVENT_CFG[ev.event_type] ?? EVENT_CFG.other
                    const past = isPast(ev.event_date)
                    return (
                      <View key={ev.id} style={{backgroundColor:'#ffffff',borderRadius:14,borderWidth:1,borderColor: past ? 'rgba(0,0,0,0.06)' : cfg.color+'30',padding:14,opacity: past ? 0.55 : 1,shadowColor:'#000',shadowOffset:{width:0,height:1},shadowOpacity:0.05,shadowRadius:4,elevation:1}}>
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
                </View>
              )}
            </View>
            </AnimatedSection>
          )}

        </ScrollView>
      </SafeAreaView>

      {/* 予定追加モーダル */}
      <Modal visible={showEventModal} transparent animationType="slide" onRequestClose={() => setShowEventModal(false)}>
        <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.7)',justifyContent:'flex-end'}}>
          <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined}>
            <View style={{backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,maxHeight:SCREEN_H*0.88}}>
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
              <ScrollView style={{flex:1}} contentContainerStyle={{paddingHorizontal:22,paddingBottom:48,gap:14}} showsVerticalScrollIndicator={true} keyboardShouldPersistTaps="handled">

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

              <TouchableOpacity
                style={[{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:15},(!evTitle.trim()||!evDate.trim())&&{opacity:0.4}]}
                onPress={addEvent} disabled={!evTitle.trim()||!evDate.trim()} activeOpacity={0.85}
              >
                <Ionicons name="checkmark-circle" size={20} color="#fff"/>
                <Text style={{color:'#fff',fontSize:16,fontWeight:'800'}}>追加する</Text>
              </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {detailMember && (
        <MemberDetailSheet
          member={detailMember}
          onClose={() => setDetailMember(null)}
          onAck={detailMember.ackedByCoach ? undefined : () => ackPain(detailMember.name)}
        />
      )}
      <TeamMenuSheet
        visible={showMenu}
        role="coach"
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
    </View>
  )
}

// ─────────────────────────────────────────────────────────
// MemberDetailSheet — コーチ用詳細シート
// ─────────────────────────────────────────────────────────
function MemberDetailSheet({ member, onClose, onAck }: {
  member: Member
  onClose: () => void
  onAck?: () => void
}) {
  const risk        = calcInjuryRisk(member.sessions, [], member.sessions[0]?.condition_level ?? 6)
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

        {/* 上端カラーバー */}
        <View style={{height:5,backgroundColor:hasUnacked?'#FF9500':rCfg.color}}/>

        <View style={{padding:20}}>
          <View style={{width:36,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.12)',alignSelf:'center',marginBottom:16}}/>

          {/* ヘッダー */}
          <View style={{flexDirection:'row',alignItems:'center',gap:12,marginBottom:16}}>
            <Avatar name={member.name} size={50} color={hasUnacked?'#FF9500':avatarColor(member.name)}/>
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
                <View style={{backgroundColor:'rgba(255,149,0,0.08)',borderRadius:12,borderWidth:1,borderColor:'rgba(255,149,0,0.3)',padding:12,marginBottom:10}}>
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

          {/* ─ 痛み報告 ─ */}
          {(member.painParts?.length ?? 0) > 0 && (
            <View style={{
              backgroundColor: hasUnacked ? 'rgba(255,149,0,0.08)' : 'rgba(52,199,89,0.06)',
              borderRadius:12, borderWidth:1,
              borderColor: hasUnacked ? 'rgba(255,149,0,0.4)' : 'rgba(52,199,89,0.3)',
              padding:12, marginBottom:12,
            }}>
              <View style={{flexDirection:'row',alignItems:'center',gap:6,marginBottom:8}}>
                <Text style={{fontSize:14}}>{hasUnacked ? '🤕' : '✅'}</Text>
                <Text style={{color: hasUnacked?'#FF9500':'#34C759', fontSize:13,fontWeight:'700',flex:1}}>
                  {hasUnacked ? '痛み・違和感の報告（未確認）' : '痛み報告（確認済み）'}
                </Text>
              </View>
              <PainBadges parts={member.painParts!}/>
              {!!member.painDetail && (
                <View style={{marginTop:8,backgroundColor:'rgba(0,0,0,0.04)',borderRadius:8,padding:8}}>
                  <Text style={{color:'#444',fontSize:12,lineHeight:18}}>📝 {member.painDetail}</Text>
                </View>
              )}
            </View>
          )}

          <Text style={{color:'#aaa',fontSize:11,textAlign:'center',marginBottom:hasUnacked?12:0}}>
            参加日: {daysSince(member.lastActive)}
          </Text>

          {/* ─ 確認済みボタン ─ */}
          {hasUnacked && onAck && (
            <TouchableOpacity
              style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:14}}
              onPress={onAck}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-circle" size={20} color="#fff"/>
              <Text style={{color:'#fff',fontSize:15,fontWeight:'800'}}>確認済みにする</Text>
            </TouchableOpacity>
          )}
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
          <View style={{flex:1,alignItems:'center',backgroundColor:'rgba(255,149,0,0.08)',borderRadius:16,borderWidth:1.5,borderColor:'rgba(255,149,0,0.3)',paddingVertical:20,gap:6}}>
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
          <View style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'rgba(255,107,53,0.08)',borderRadius:14,borderWidth:1.5,borderColor:'rgba(255,107,53,0.25)',paddingVertical:14,marginBottom:16}}>
            <Text style={{fontSize:28}}>🔥</Text>
            <View style={{gap:2}}>
              <Text style={{color:'#FF6B35',fontSize:26,fontWeight:'900'}}>{streak}日連続中！</Text>
              <Text style={{color:'#888',fontSize:11,textAlign:'center'}}>継続は力なり</Text>
            </View>
          </View>
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
function PlayerDashboard({ joined, onSwitchRole, onLeaveTeam }: {
  joined: JoinedTeam; onSwitchRole: () => void; onLeaveTeam: () => void
}) {
  const [sessions,          setSessions]          = useState<TrainingSession[]>([])
  const [messages,          setMessages]          = useState<TeamMessage[]>([])
  const [teammates,         setTeammates]         = useState<TeamMemberRow[]>([])
  const [allBodyReports,    setAllBodyReports]    = useState<BodyReportRow[]>([])
  const [teamSessionsMap,   setTeamSessionsMap]   = useState<Record<string, TrainingSession[]>>({})
  const [teamEvents,        setTeamEvents]        = useState<TeamEventRow[]>([])
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
  const [plTab,             setPlTab]             = useState<'home'|'members'>('home')

  const load = useCallback(async () => {
    const [sr, sleepRaw, condRaw, msgs, mems, rpts, stats, teamSessions, evts] = await Promise.all([
      AsyncStorage.getItem(SESSIONS_KEY),
      AsyncStorage.getItem(SLEEP_KEY),
      AsyncStorage.getItem(CONDITION_MAP_KEY),
      fetchMessages(joined.code),
      fetchMembers(joined.code),
      fetchBodyReports(joined.code),
      fetchPlayerStats(joined.code),
      fetchTeamSessions(joined.code),
      fetchTeamEvents(joined.code),
    ])
    const loadedSessions: TrainingSession[] = sr ? JSON.parse(sr) : []
    setSessions(loadedSessions)
    setSleepRecs(sleepRaw ? JSON.parse(sleepRaw) : [])
    setConditionMap(condRaw ? JSON.parse(condRaw) : {})
    setMessages(msgs)
    setTeammates(mems.filter(m => m.player_name !== joined.playerName))
    setPlayerStats(stats)
    setAllBodyReports(rpts)
    setTeamEvents(evts)
    setPlLoading(false)
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
    // 自分のstatsをedit初期値にセット
    const myStat = stats.find(s => s.player_name === joined.playerName)
    if (myStat) { setEditEvent(myStat.event); setEditPb(myStat.pb_display); setEditGoal(myStat.goal ?? '') }
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
      await upsertPlayerStats(
        joined.code, joined.playerName, myStat?.event ?? '', myStat?.pb_display ?? '', lvInfo.level,
        lastSess?.condition_level ?? 7, lastSess?.fatigue_level ?? 5,
        lastSess?.session_date ?? '', recent30.length, myStat?.goal ?? '',
      )
    } catch { /* DB列未追加時もサイレントに無視 */ }
  }, [joined.code, joined.playerName])

  useEffect(() => { load() }, [load])
  // タブに戻るたびに再ロード（Realtimeの補完）
  useFocusEffect(useCallback(() => { load() }, [load]))

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
    await upsertPlayerStats(
      joined.code, joined.playerName, editEvent.trim(), editPb.trim(), lvInfo.level,
      lastSess?.condition_level ?? 7, lastSess?.fatigue_level ?? 5,
      lastSess?.session_date ?? '', recent30.length, editGoal.trim(),
    )
    setShowStatsEdit(false)
    await load()
    Toast.show({ type: 'success', text1: 'プロフィールを更新しました', visibilityTime: 1600 })
  }

  async function saveBodyReport() {
    await upsertBodyReport(joined.code, joined.playerName, editBody, editBodyDetail.trim())
    setBodyParts(editBody); setBodyDetail(editBodyDetail.trim()); setShowBody(false)
    // 痛みがある場合はコーチに通知
    if (editBody.length > 0) {
      const labels = editBody.map(id => BODY_PARTS.find(p=>p.id===id)?.label??id).join('、')
      const msg = editBodyDetail.trim() ? `${labels}：${editBodyDetail.trim()}` : `痛み報告: ${labels}`
      await sendPush(`🤕 ${joined.playerName}`, msg, 'coaches', joined.code)
    }
    Toast.show({type:'success',text1:'痛みの報告を送りました',visibilityTime:1600})
  }

  const last    = sessions[0]
  const fat     = last ? fatigueInfo(last.fatigue_level) : null
  // ホーム画面と同じ計算式でスコアを出す
  const avgCondLv = useMemo(() => {
    const today = new Date()
    const vals = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today); d.setDate(d.getDate() - i)
      return conditionMap[d.toISOString().slice(0, 10)]
    }).filter((v): v is number => v !== undefined)
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : (last?.condition_level ?? 7)
  }, [conditionMap, last])
  const risk    = calcInjuryRisk(sessions, sleepRecs, avgCondLv, bodyParts.length > 0)
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
                <TouchableOpacity onPress={() => setShowMenu(true)} style={co.switchBtn} activeOpacity={0.7}>
                  <Ionicons name="ellipsis-horizontal" size={15} color={TEXT.secondary}/>
                </TouchableOpacity>
              </View>
              {/* アクションボタン3つ */}
              <View style={{flexDirection:'row',gap:8}}>
                <TouchableOpacity style={pl.actionBtn} onPress={() => { setEditBody([...bodyParts]); setEditBodyDetail(bodyDetail); setShowBody(true) }} activeOpacity={0.85}>
                  <Ionicons name="body-outline" size={18} color="#FF9500"/>
                  <Text style={{color:TEXT.primary,fontSize:12,fontWeight:'700'}}>痛みを報告</Text>
                  {bodyParts.length > 0 && <View style={{backgroundColor:'#FF9500',borderRadius:8,paddingHorizontal:5,paddingVertical:1}}><Text style={{color:'#fff',fontSize:9,fontWeight:'800'}}>{bodyParts.length}</Text></View>}
                </TouchableOpacity>
                <TouchableOpacity style={pl.actionBtn} onPress={() => setShowVideoModal(true)} activeOpacity={0.85}>
                  <Ionicons name="videocam-outline" size={18} color={BRAND}/>
                  <Text style={{color:TEXT.primary,fontSize:12,fontWeight:'700'}}>動画を送る</Text>
                </TouchableOpacity>
                <TouchableOpacity style={pl.actionBtn} onPress={() => setShowStatsEdit(true)} activeOpacity={0.85}>
                  <Ionicons name="person-circle-outline" size={18} color="#AF52DE"/>
                  <Text style={{color:TEXT.primary,fontSize:12,fontWeight:'700'}}>プロフィール</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ─ タブバー ─ */}
            <View style={co.tabs}>
              {([
                { key:'home'    as const, label:'ホーム',        badge: (pinned.length + regular.length) > 0 ? 0 : 0 },
                { key:'members' as const, label:'チームメイト',  badge: 0 },
              ]).map(t => (
                <TouchableOpacity key={t.key} style={[co.tab, plTab===t.key && co.tabActive]} onPress={() => setPlTab(t.key)} activeOpacity={0.7}>
                  <Text style={[co.tabLabel, { color: plTab===t.key ? BRAND : '#555' }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ─ ホームタブ ─ */}
            {plTab === 'home' && (
              <ScrollView contentContainerStyle={{padding:16,paddingBottom:80,gap:18}} showsVerticalScrollIndicator={false}>

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
                  <Text style={pl.sectionTitle}>📅 チーム予定</Text>
                  {teamEvents.length === 0 ? (
                    <View style={{backgroundColor:'#ffffff',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',padding:20,alignItems:'center',gap:6}}>
                      <Text style={{fontSize:28}}>📅</Text>
                      <Text style={{color:'#9ca3af',fontSize:13}}>コーチからの予定はまだありません</Text>
                    </View>
                  ) : (
                    <View style={{backgroundColor:'#ffffff',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',overflow:'hidden'}}>
                      {teamEvents.map((ev, i) => {
                        const cfg = EVENT_CFG[ev.event_type] ?? EVENT_CFG.other
                        const past = isPast(ev.event_date)
                        return (
                          <View key={ev.id} style={{
                            flexDirection:'row', alignItems:'center', gap:12,
                            paddingHorizontal:14, paddingVertical:13,
                            borderBottomWidth: i < teamEvents.length-1 ? StyleSheet.hairlineWidth : 0,
                            borderBottomColor:'rgba(0,0,0,0.07)',
                            opacity: past ? 0.5 : 1,
                          }}>
                            <View style={{width:38,height:38,borderRadius:10,backgroundColor:cfg.color+'18',alignItems:'center',justifyContent:'center'}}>
                              <Text style={{fontSize:18}}>{cfg.emoji}</Text>
                            </View>
                            <View style={{flex:1,gap:2}}>
                              <Text style={{color:TEXT.primary,fontSize:14,fontWeight:'700'}}>{ev.title}</Text>
                              <View style={{flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                                <Text style={{color:cfg.color,fontSize:11,fontWeight:'700'}}>{fmtEventDate(ev.event_date)}</Text>
                                {!!ev.event_time && <Text style={{color:'#888',fontSize:11}}>{ev.event_time}</Text>}
                                {!!ev.location && <Text style={{color:'#888',fontSize:11}}>📍{ev.location}</Text>}
                              </View>
                              {!!ev.description && <Text style={{color:'#6b7280',fontSize:12,lineHeight:18}}>{ev.description}</Text>}
                            </View>
                          </View>
                        )
                      })}
                    </View>
                  )}
                </View>
                </AnimatedSection>

                {/* マイ コンディション */}
                <AnimatedSection delay={120} type="fade-up">
                <Text style={pl.sectionTitle}>マイ コンディション</Text>
                <View style={{backgroundColor:'#ffffff',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',padding:14}}>
                  <View style={{flexDirection:'row',gap:10,marginBottom:bodyParts.length>0?12:0}}>
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
            )}

            {/* ─ チームメイトタブ ─ */}
            {plTab === 'members' && (
              <ScrollView contentContainerStyle={{padding:16,paddingBottom:80,gap:14}} showsVerticalScrollIndicator={false}>
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
                      const streak    = calcStreak(tmSessions)
                      const hasPain   = (allBodyReports.find(r => r.player_name === m.player_name)?.parts?.length ?? 0) > 0
                      const event     = stat?.event || m.event || ''
                      const pb        = stat?.pb_display || ''
                      const goal      = stat?.goal || ''
                      return (
                        <TouchableOpacity
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
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                  </AnimatedSection>
                )}
              </ScrollView>
            )}
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
              <TouchableOpacity style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:14,marginTop:14}} onPress={saveBodyReport} activeOpacity={0.85}>
                <Ionicons name="send" size={18} color="#fff"/>
                <Text style={{color:'#fff',fontSize:15,fontWeight:'800'}}>コーチに報告する</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'#f0f2f5',borderRadius:14,paddingVertical:14,marginTop:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)'}} onPress={saveBodyReport} activeOpacity={0.85}>
                <Text style={{color:'#888',fontSize:15,fontWeight:'700'}}>痛みなし（クリア）</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* PB・プロフィール編集モーダル */}
      <Modal visible={showStatsEdit} transparent animationType="slide" onRequestClose={() => setShowStatsEdit(false)}>
        <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.8)',justifyContent:'flex-end'}}>
          <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined}>
            <View style={{backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,maxHeight:SCREEN_H*0.85}}>
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
              <ScrollView style={{flex:1}} contentContainerStyle={{paddingHorizontal:22,paddingBottom:48,gap:14}} keyboardShouldPersistTaps="handled">
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
                <TouchableOpacity
                  style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:15}}
                  onPress={saveStats} activeOpacity={0.85}
                >
                  <Ionicons name="checkmark-circle" size={18} color="#fff"/>
                  <Text style={{color:'#fff',fontSize:16,fontWeight:'800'}}>チームに公開する</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
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
  tabs:       { flexDirection:'row', borderBottomWidth:1, borderColor:'rgba(0,0,0,0.08)', paddingHorizontal:16, backgroundColor:'#ffffff' },
  tab:        { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:5, paddingVertical:12 },
  tabActive:  { borderBottomWidth:2, borderColor:BRAND },
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
function TeamMenuSheet({ visible, role, onSwitchRole, onDangerAction, onClose }: {
  visible: boolean
  role: 'coach' | 'player'
  onSwitchRole: () => void
  onDangerAction: () => void
  onClose: () => void
}) {
  const [showConfirm, setShowConfirm] = useState(false)

  const dangerLabel   = role === 'coach' ? 'チームを削除' : 'チームを脱退'
  const dangerMessage = role === 'coach'
    ? '参加コードが無効になり、全メンバーのデータが失われます。本当に削除しますか？'
    : 'チームを脱退します。再参加するにはコードが必要です。本当に脱退しますか？'

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.6)',justifyContent:'flex-end'}}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose}/>
          <View style={{backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,padding:24,paddingBottom:48,gap:12}}>
            <View style={{width:36,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.12)',alignSelf:'center',marginBottom:4}}/>
            <Text style={{color:'#111827',fontSize:17,fontWeight:'800'}}>チームメニュー</Text>

            {/* ロール切り替え */}
            <TouchableOpacity
              style={{flexDirection:'row',alignItems:'center',gap:14,backgroundColor:'#f0f2f5',borderRadius:16,padding:16}}
              onPress={() => { onClose(); setTimeout(onSwitchRole, 200) }}
              activeOpacity={0.8}
            >
              <View style={{width:44,height:44,borderRadius:13,backgroundColor:BRAND+'18',alignItems:'center',justifyContent:'center'}}>
                <Ionicons name="swap-horizontal-outline" size={22} color={BRAND}/>
              </View>
              <View style={{flex:1}}>
                <Text style={{color:'#111827',fontSize:15,fontWeight:'700'}}>ロールを切り替え</Text>
                <Text style={{color:'#6b7280',fontSize:12,marginTop:2}}>
                  {role === 'coach' ? '選手として参加しているチームへ' : 'コーチとして作成したチームへ'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#9ca3af"/>
            </TouchableOpacity>

            {/* 危険操作 */}
            <TouchableOpacity
              style={{flexDirection:'row',alignItems:'center',gap:14,backgroundColor:'rgba(239,68,68,0.06)',borderRadius:16,padding:16,borderWidth:1,borderColor:'rgba(239,68,68,0.2)'}}
              onPress={() => setShowConfirm(true)}
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

      <ConfirmSheet
        visible={showConfirm}
        title={dangerLabel}
        message={dangerMessage}
        confirmLabel={role === 'coach' ? '削除する' : '脱退する'}
        dangerous
        onConfirm={() => { onClose(); setTimeout(onDangerAction, 100) }}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  )
}

// ─────────────────────────────────────────────────────────
// TeamScreen（エントリーポイント）
// ─────────────────────────────────────────────────────────
export default function TeamScreen() {
  type State = 'loading'|'select-role'|'coach-setup'|'coach'|'player-join'|'player'
  const [state,  setState]  = useState<State>('loading')
  const [setup,  setSetup]  = useState<TeamSetup|null>(null)
  const [joined, setJoined] = useState<JoinedTeam|null>(null)

  useEffect(() => {
    async function init() {
      initOneSignal()
      const [roleRaw, setupRaw, joinedRaw] = await Promise.all([
        AsyncStorage.getItem(ROLE_KEY),
        AsyncStorage.getItem(SETUP_KEY),
        AsyncStorage.getItem(JOINED_KEY),
      ])
      const role = roleRaw as Role|null
      // 保存済みデータは常にメモリにロード
      if (setupRaw)  setSetup(JSON.parse(setupRaw))
      if (joinedRaw) setJoined(JSON.parse(joinedRaw))

      if (!role) { setState('select-role'); return }
      if (role === 'coach') {
        setState(setupRaw ? 'coach' : 'coach-setup')
      } else {
        setState(joinedRaw ? 'player' : 'player-join')
      }
    }
    init()
  }, [])

  // ロール選択 — 既存データがあれば直接ダッシュボードへ
  async function handleSelectRole(role: Role) {
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

  if (state==='loading')          return <View style={{flex:1,backgroundColor:'#f6f6f8'}}/>
  if (state==='select-role')      return <RoleSelectionScreen onSelect={handleSelectRole}/>
  if (state==='coach-setup')      return <CoachSetupScreen onCreated={handleCoachCreated} onBack={() => setState('select-role')}/>
  if (state==='coach' && setup)   return <CoachDashboard  setup={setup}   onSwitchRole={handleSwitchRole} onDeleteTeam={handleDeleteTeam}/>
  if (state==='player-join')      return <PlayerJoinScreen onJoined={handlePlayerJoined} onBack={() => setState('select-role')}/>
  if (state==='player' && joined) return <PlayerDashboard joined={joined} onSwitchRole={handleSwitchRole} onLeaveTeam={handleLeaveTeam}/>
  return <View style={{flex:1,backgroundColor:'#f6f6f8'}}/>
}

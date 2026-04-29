// app/(tabs)/team.tsx — チーム機能 v3（Supabase同期 + OneSignal通知）
import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Modal, Linking, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { BRAND, TEXT } from '../../lib/theme'
import AnimatedSection from '../../components/AnimatedSection'
import { calcInjuryRisk } from '../../lib/injuryRisk'
import { calcLevelInfo, RANK_TIERS } from '../../lib/gamification'
import type { TrainingSession } from '../../types'
import { supabase } from '../../lib/supabase'
import {
  fetchMessages, postMessage, setPinMessage, deleteMessage,
  fetchVideos, submitVideo, markVideoWatched,
  fetchBodyReports, upsertBodyReport,
  fetchMembers, registerMember, deleteMember,
  createTeam, fetchTeamByCode,
  type TeamMessageRow, type TeamVideoRow, type BodyReportRow, type TeamMemberRow,
} from '../../lib/supabaseTeam'
import { useTheme } from '../../context/ThemeContext'
import {
  initOneSignal, requestPushPermission, registerUserTags, sendPush,
} from '../../lib/notify'

// ── ストレージキー（ローカル設定のみ） ────────────────────
const ROLE_KEY     = 'trackmate_team_role'
const SESSIONS_KEY = 'trackmate_sessions'
const SETUP_KEY    = 'trackmate_team_setup'
const JOINED_KEY   = 'trackmate_team_joined'

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
type Member = { id: string; name: string; event: string; sessions: TrainingSession[]; lastActive: string; painParts?: string[] }
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
    <View style={{flex:1,backgroundColor:'#000'}}>
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
    <View style={{flex:1,backgroundColor:'#000'}}>
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
// CoachDashboard — シンプル3セクション
// ─────────────────────────────────────────────────────────
function CoachDashboard({ setup, onSwitchRole, onDeleteTeam }: {
  setup: TeamSetup; onSwitchRole: () => void; onDeleteTeam: () => void
}) {
  const router = useRouter()
  const [messages, setMessages] = useState<TeamMessage[]>([])
  const [videos,   setVideos]   = useState<VideoEntry[]>([])
  const [members,  setMembers]  = useState<TeamMemberRow[]>([])
  const [bodyReports, setBodyReports] = useState<BodyReportRow[]>([])
  const [msgText,       setMsgText]       = useState('')
  const [tab,           setTab]           = useState<'members'|'messages'|'videos'>('members')
  const [detailMember,  setDetailMember]  = useState<Member|null>(null)
  const [memberFilter,  setMemberFilter]  = useState<'all'|'danger'|'unsubmitted'>('all')
  const [hiddenDemoIds, setHiddenDemoIds] = useState<string[]>([])
  const [showMenu,      setShowMenu]      = useState(false)

  const load = useCallback(async () => {
    const [msgs, vids, mems, rpts] = await Promise.all([
      fetchMessages(setup.code),
      fetchVideos(setup.code),
      fetchMembers(setup.code),
      fetchBodyReports(setup.code),
    ])
    setMessages(msgs)
    setVideos(vids)
    setMembers(mems)
    setBodyReports(rpts)
  }, [setup.code])

  useEffect(() => { load() }, [load])

  // Supabase Realtime — チームデータをリアルタイム同期
  useEffect(() => {
    const ch = supabase.channel(`coach:${setup.code}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_messages',     filter: `team_code=eq.${setup.code}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members',      filter: `team_code=eq.${setup.code}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_body_reports', filter: `team_code=eq.${setup.code}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_videos',       filter: `team_code=eq.${setup.code}` }, () => load())
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
    Alert.alert(
      'メンバーを削除',
      `${name} をチームから削除しますか？`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            if (isDemo) {
              setHiddenDemoIds(prev => [...prev, id])
            } else {
              await deleteMember(id)
              setMembers(prev => prev.filter(m => m.id !== id))
            }
            if (detailMember?.id === id) setDetailMember(null)
            Toast.show({ type: 'success', text1: `${name} を削除しました`, visibilityTime: 1600 })
          },
        },
      ],
    )
  }

  async function markWatched(id: string) {
    await markVideoWatched(id)
    setVideos(prev => prev.map(v => v.id===id ? {...v, watched:true} : v))
  }

  // 実メンバーをDEMO_MEMBERSと同じ型に変換（痛みデータをマージ）
  const displayMembers: Member[] = members.length > 0
    ? members.map(m => {
        const rpt = bodyReports.find(r => r.player_name === m.player_name)
        return {
          id: m.id,
          name: m.player_name,
          event: m.event || '',
          lastActive: m.joined_at,
          painParts: rpt?.parts ?? [],
          sessions: [],
        }
      })
    : DEMO_MEMBERS.filter(m => !hiddenDemoIds.includes(m.id))

  // メンバーごとの計算済みデータ
  const memberData = displayMembers.map(m => {
    const risk       = calcInjuryRisk(m.sessions, [], m.sessions[0]?.condition_level ?? 6)
    const weeklyLoad = calcWeeklyLoad(m.sessions)
    const condToday  = m.sessions[0]?.condition_level ?? null
    return { ...m, risk, weeklyLoad, condToday }
  })

  // ソート: リスクスコア降順 → 体調未提出を上に → 名前昇順
  const sortedMembers = [...memberData].sort((a, b) => {
    if (b.risk.riskScore !== a.risk.riskScore) return b.risk.riskScore - a.risk.riskScore
    if (!a.condToday && b.condToday) return -1
    if (a.condToday && !b.condToday) return 1
    return a.name.localeCompare(b.name)
  })

  // フィルター適用
  const filteredMembers = sortedMembers.filter(m => {
    if (memberFilter === 'danger')      return m.risk.riskScore >= 70
    if (memberFilter === 'unsubmitted') return !m.condToday
    return true
  })

  const highRiskMembers = memberData.filter(m => m.risk.riskScore >= 70)
  const submittedCount  = memberData.filter(m => m.condToday !== null).length
  const avgLoad         = memberData.length > 0
    ? memberData.reduce((s, m) => s + m.weeklyLoad, 0) / memberData.length
    : 0
  const hasPain   = displayMembers.filter(m => (m.painParts?.length ?? 0) > 0).length
  const newVideos = videos.filter(v => !v.watched).length

  return (
    <View style={{flex:1,backgroundColor:'#000'}}>
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
            <TouchableOpacity onPress={() => setShowMenu(true)} style={co.switchBtn} activeOpacity={0.7}>
              <Ionicons name="ellipsis-horizontal" size={15} color={TEXT.secondary}/>
            </TouchableOpacity>
          </View>
        </View>

        {/* ─ タブ ─ */}
        <View style={co.tabs}>
          {([
            { key:'members',  label:'メンバー', badge: hasPain+highRiskMembers.length > 0 ? hasPain+highRiskMembers.length : 0 },
            { key:'messages', label:'アナウンス', badge: 0 },
            { key:'videos',   label:'動画', badge: newVideos },
          ] as const).map(t => (
            <TouchableOpacity key={t.key} style={[co.tab, tab===t.key && co.tabActive]} onPress={() => setTab(t.key)} activeOpacity={0.7}>
              <Text style={[co.tabLabel, { color: tab===t.key ? BRAND : '#555' }]}>{t.label}</Text>
              {t.badge > 0 && <View style={co.badge}><Text style={{color:'#fff',fontSize:9,fontWeight:'800'}}>{t.badge}</Text></View>}
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView contentContainerStyle={{padding:16,paddingBottom:40,gap:12}} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* ═══ メンバータブ ═══ */}
          {tab === 'members' && (
            <AnimatedSection key="members" delay={0} type="fade-up">
            <>
              {/* 要注意選手バナー */}
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

              {/* サマリー3カラム */}
              <View style={{flexDirection:'row',gap:8}}>
                {[
                  { label:'体調提出率', value:`${submittedCount}/${memberData.length}人`, filter:'unsubmitted' as const },
                  { label:'高リスク', value:`⚠️ ${highRiskMembers.length}人`, color: highRiskMembers.length>0?'#E53935':'#34C759', filter:'danger' as const },
                  { label:'チーム負荷', value: LOAD_CFG[loadCfgKey(avgLoad)].label, color: LOAD_CFG[loadCfgKey(avgLoad)].color, filter:'all' as const },
                ].map((item) => (
                  <TouchableOpacity key={item.label} onPress={() => setMemberFilter(memberFilter===item.filter&&item.filter!=='all'?'all':item.filter)} style={{
                    flex:1, backgroundColor: memberFilter===item.filter&&item.filter!=='all'?'rgba(229,57,53,0.08)':'#f0f2f5',
                    borderWidth:1, borderColor: memberFilter===item.filter&&item.filter!=='all'?'rgba(229,57,53,0.4)':'rgba(0,0,0,0.08)',
                    borderRadius:12, paddingVertical:12, paddingHorizontal:10, alignItems:'center',
                  }} activeOpacity={0.8}>
                    <Text style={{color:item.color??TEXT.primary,fontSize:14,fontWeight:'800',marginBottom:2}}>{item.value}</Text>
                    <Text style={{color:'#555',fontSize:10}}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* フィルター解除 */}
              {memberFilter !== 'all' && (
                <TouchableOpacity onPress={() => setMemberFilter('all')} style={{alignSelf:'flex-end',borderWidth:1,borderColor:'#333',borderRadius:999,paddingHorizontal:12,paddingVertical:4}} activeOpacity={0.7}>
                  <Text style={{color:'#888',fontSize:11}}>× フィルター解除（全{memberData.length}人）</Text>
                </TouchableOpacity>
              )}

              {/* デモ表示中の案内 */}
              {members.length === 0 && (
                <View style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',padding:14}}>
                  <Text style={{color:'#555',fontSize:12,textAlign:'center'}}>※ デモデータを表示中。選手がコード「{formatCode(setup.code)}」で参加するとここに表示されます</Text>
                </View>
              )}

              {/* メンバーカードリスト */}
              <View style={{gap:10}}>
                {filteredMembers.map((m) => {
                  const rKey    = riskCfgKey(m.risk.riskScore)
                  const lKey    = loadCfgKey(m.weeklyLoad)
                  const rCfg    = RISK_CFG[rKey]
                  const lCfg    = LOAD_CFG[lKey]
                  const lvInfo  = calcLevelInfo(m.sessions.length)
                  const lvTier  = RANK_TIERS.find(t => lvInfo.level >= t.min && lvInfo.level < t.max) ?? RANK_TIERS[0]
                  const isHigh  = m.risk.riskScore >= 70
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={[co.memberCard, isHigh && {borderColor:'rgba(229,57,53,0.25)',backgroundColor:'rgba(229,57,53,0.05)'}]}
                      onPress={() => setDetailMember(m)}
                      activeOpacity={0.85}
                    >
                      {/* 負荷カラーバー（上端） */}
                      <View style={{height:3,backgroundColor:lCfg.color,marginHorizontal:-14,marginTop:-14,marginBottom:10,borderTopLeftRadius:14,borderTopRightRadius:14,opacity:0.8}}/>

                      <View style={{flexDirection:'row',alignItems:'flex-start',gap:10}}>
                        <Avatar name={m.name} size={42} color={avatarColor(m.name)}/>
                        <View style={{flex:1,gap:4}}>
                          {/* 名前行 */}
                          <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
                            <Text style={{color:TEXT.primary,fontSize:15,fontWeight:'800'}}>{m.name}</Text>
                            {m.event ? <Text style={{color:'#555',fontSize:11}}>{m.event}</Text> : null}
                            <TouchableOpacity
                              onPress={e => { e.stopPropagation(); router.push(`/level-roadmap?name=${encodeURIComponent(m.name)}&sessions=${m.sessions.length}` as any) }}
                              style={{flexDirection:'row',alignItems:'center',gap:3,backgroundColor:lvTier.color+'22',borderRadius:10,paddingHorizontal:7,paddingVertical:2,borderWidth:1,borderColor:lvTier.color+'44'}}
                            >
                              <Text style={{fontSize:11}}>{lvTier.emoji}</Text>
                              <Text style={{color:lvTier.color,fontSize:10,fontWeight:'800'}}>Lv.{lvInfo.level}</Text>
                            </TouchableOpacity>
                          </View>

                          {/* リスクバー */}
                          <View style={{gap:4}}>
                            <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
                              <Text style={{color:'#666',fontSize:10}}>怪我リスク</Text>
                              <View style={{backgroundColor:rCfg.bg,borderRadius:999,paddingHorizontal:7,paddingVertical:1}}>
                                <Text style={{color:rCfg.color,fontSize:9,fontWeight:'700'}}>{rCfg.label}</Text>
                              </View>
                            </View>
                            <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
                              <View style={{flex:1,height:5,borderRadius:3,backgroundColor:'rgba(0,0,0,0.08)',overflow:'hidden'}}>
                                <View style={{width:`${m.risk.riskScore}%`,height:'100%',borderRadius:3,backgroundColor:rCfg.color}}/>
                              </View>
                              <Text style={{color:rCfg.color,fontSize:11,fontWeight:'700',minWidth:24}}>{m.risk.riskScore}</Text>
                            </View>
                          </View>

                          {/* 今週の負荷 */}
                          <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
                            <Text style={{color:'#666',fontSize:10}}>今週の負荷</Text>
                            <View style={{flexDirection:'row',alignItems:'center',gap:4}}>
                              <View style={{backgroundColor:lCfg.color+'22',borderRadius:999,paddingHorizontal:7,paddingVertical:1}}>
                                <Text style={{color:lCfg.color,fontSize:9,fontWeight:'700'}}>{lCfg.label}</Text>
                              </View>
                            </View>
                          </View>

                          {(m.painParts?.length ?? 0) > 0 && <PainBadges parts={m.painParts!}/>}
                        </View>

                        {/* 右: 体調バッジ + 最終アクティブ + 削除 */}
                        <View style={{alignItems:'flex-end',gap:4,minWidth:40}}>
                          {m.condToday ? (
                            <Text style={{fontSize:18}}>{'😫😕😐😊💪'.charAt(Math.round((m.condToday - 2) / 2))}</Text>
                          ) : (
                            <View style={{backgroundColor:'#f0f2f5',borderRadius:999,paddingHorizontal:6,paddingVertical:2}}>
                              <Text style={{color:'#888',fontSize:9,fontWeight:'700'}}>未提出</Text>
                            </View>
                          )}
                          <Text style={{color:'#444',fontSize:9}}>{daysSince(m.lastActive)}</Text>
                          <TouchableOpacity
                            onPress={e => { e.stopPropagation(); removeMember(m.id, m.name, m.id.startsWith('demo-')) }}
                            hitSlop={{top:8,bottom:8,left:8,right:8}}
                          >
                            <Ionicons name="trash-outline" size={14} color="#ccc"/>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </TouchableOpacity>
                  )
                })}
                {filteredMembers.length === 0 && (
                  <View style={{alignItems:'center',paddingVertical:32}}>
                    <Text style={{color:'#555',fontSize:14}}>該当する選手はいません</Text>
                  </View>
                )}
              </View>
            </>
            </AnimatedSection>
          )}

          {/* ═══ アナウンスタブ ═══ */}
          {tab === 'messages' && (
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
          {tab === 'videos' && (
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
        </ScrollView>
      </SafeAreaView>

      {detailMember && <MemberDetailSheet member={detailMember} onClose={() => setDetailMember(null)}/>}
      <TeamMenuSheet
        visible={showMenu}
        role="coach"
        onSwitchRole={onSwitchRole}
        onDangerAction={onDeleteTeam}
        onClose={() => setShowMenu(false)}
      />
    </View>
  )
}

// ─────────────────────────────────────────────────────────
// MemberDetailSheet
// ─────────────────────────────────────────────────────────
function MemberDetailSheet({ member, onClose }: { member: Member; onClose: () => void }) {
  const risk = calcInjuryRisk(member.sessions, [], member.sessions[0]?.condition_level ?? 6)
  const fat  = fatigueInfo(member.sessions[0]?.fatigue_level ?? 6)
  return (
    <View style={[StyleSheet.absoluteFill,{backgroundColor:'rgba(0,0,0,0.85)',justifyContent:'flex-end'}]}>
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose}/>
      <View style={{backgroundColor:'#ffffff',borderTopLeftRadius:24,borderTopRightRadius:24,padding:20,paddingBottom:44,borderTopWidth:1,borderColor:'rgba(0,0,0,0.08)'}}>
        <View style={{width:36,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.12)',alignSelf:'center',marginBottom:16}}/>
        <View style={{flexDirection:'row',alignItems:'center',gap:12,marginBottom:18}}>
          <Avatar name={member.name} size={48} color={avatarColor(member.name)}/>
          <View><Text style={{color:'#111827',fontSize:19,fontWeight:'800'}}>{member.name}</Text><Text style={{color:TEXT.secondary,fontSize:13}}>{member.event}</Text></View>
          <TouchableOpacity onPress={onClose} style={{marginLeft:'auto' as any}} hitSlop={{top:10,bottom:10,left:10,right:10}}>
            <Ionicons name="close" size={22} color={TEXT.secondary}/>
          </TouchableOpacity>
        </View>
        {member.sessions.length > 0 ? (
          <>
            <View style={{flexDirection:'row',gap:10,marginBottom:14}}>
              <View style={{flex:1,alignItems:'center',backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',paddingVertical:14,gap:4}}>
                <Text style={{fontSize:26}}>{fat.emoji}</Text>
                <Text style={{color:fat.color,fontSize:12,fontWeight:'700'}}>{fat.label}</Text>
                <Text style={{color:'#555',fontSize:10}}>疲労度</Text>
              </View>
              <View style={{flex:1,alignItems:'center',backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',paddingVertical:14,gap:4}}>
                <Text style={{color:risk.signalColor,fontSize:22,fontWeight:'800'}}>{risk.riskScore}</Text>
                <Text style={{color:risk.signalColor,fontSize:11,fontWeight:'700'}}>{risk.label}</Text>
                <Text style={{color:'#555',fontSize:10}}>怪我リスク</Text>
              </View>
              <View style={{flex:1,alignItems:'center',backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',paddingVertical:14,gap:4}}>
                <Text style={{color:'#111827',fontSize:20,fontWeight:'800'}}>{risk.weeklyKm}<Text style={{fontSize:10,color:'#666'}}>km</Text></Text>
                <Text style={{color:'#666',fontSize:11}}>先週{risk.prevWeeklyKm}km</Text>
                <Text style={{color:'#555',fontSize:10}}>今週距離</Text>
              </View>
            </View>
            {risk.reasons.length > 0 && (
              <View style={{backgroundColor:'rgba(255,149,0,0.08)',borderRadius:12,borderWidth:1,borderColor:'rgba(255,149,0,0.3)',padding:12,marginBottom:10}}>
                <Text style={{color:'#92400e',fontSize:13,fontWeight:'700',marginBottom:8}}>⚠️ 注意ポイント</Text>
                {risk.reasons.map((r,i) => <Text key={i} style={{color:TEXT.secondary,fontSize:12,lineHeight:20}}>• {r}</Text>)}
              </View>
            )}
          </>
        ) : (
          <View style={{backgroundColor:'#f8f8fa',borderRadius:12,padding:14,marginBottom:10,alignItems:'center'}}>
            <Text style={{color:'#555',fontSize:12}}>まだ練習データがありません</Text>
          </View>
        )}
        {(member.painParts?.length ?? 0) > 0 && (
          <View style={{backgroundColor:'rgba(255,59,48,0.08)',borderRadius:12,borderWidth:1,borderColor:'#FF3B30'+'30',padding:12,marginBottom:10}}>
            <Text style={{color:'#FF3B30',fontSize:13,fontWeight:'700',marginBottom:8}}>🤕 痛み・違和感の報告</Text>
            <PainBadges parts={member.painParts!}/>
          </View>
        )}
        <Text style={{color:'#444',fontSize:11,textAlign:'center',marginTop:14}}>参加日: {daysSince(member.lastActive)}</Text>
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
  const [sessions,       setSessions]       = useState<TrainingSession[]>([])
  const [messages,       setMessages]       = useState<TeamMessage[]>([])
  const [teammates,      setTeammates]      = useState<TeamMemberRow[]>([])
  const [bodyParts,      setBodyParts]      = useState<string[]>([])
  const [showBody,       setShowBody]       = useState(false)
  const [showVideoModal, setShowVideoModal] = useState(false)
  const [editBody,       setEditBody]       = useState<string[]>([])
  const [showMenu,       setShowMenu]       = useState(false)

  const load = useCallback(async () => {
    const [sr, msgs, mems, rpts] = await Promise.all([
      AsyncStorage.getItem(SESSIONS_KEY),
      fetchMessages(joined.code),
      fetchMembers(joined.code),
      fetchBodyReports(joined.code),
    ])
    setSessions(sr ? JSON.parse(sr) : [])
    setMessages(msgs)
    setTeammates(mems.filter(m => m.player_name !== joined.playerName))
    const myReport = rpts.find(r => r.player_name === joined.playerName)
    if (myReport) setBodyParts(myReport.parts)
  }, [joined.code, joined.playerName])

  useEffect(() => { load() }, [load])

  // Supabase Realtime — コーチのアナウンスをリアルタイムで受信
  useEffect(() => {
    const ch = supabase.channel(`player:${joined.code}:${joined.playerName}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_messages', filter: `team_code=eq.${joined.code}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members',  filter: `team_code=eq.${joined.code}` }, () => load())
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

  async function saveBodyReport() {
    await upsertBodyReport(joined.code, joined.playerName, editBody)
    setBodyParts(editBody); setShowBody(false)
    // 痛みがある場合はコーチに通知
    if (editBody.length > 0) {
      const labels = editBody.map(id => BODY_PARTS.find(p=>p.id===id)?.label??id).join('、')
      await sendPush(`🤕 ${joined.playerName}`, `痛み報告: ${labels}`, 'coaches', joined.code)
    }
    Toast.show({type:'success',text1:'痛みの報告を送りました',visibilityTime:1600})
  }

  const last    = sessions[0]
  const fat     = last ? fatigueInfo(last.fatigue_level) : null
  const risk    = calcInjuryRisk(sessions, [], last?.condition_level ?? 7)
  const pinned  = messages.filter(m => m.is_pinned)
  const regular = messages.filter(m => !m.is_pinned)

  return (
    <View style={{flex:1,backgroundColor:'#000'}}>
      <SafeAreaView style={{flex:1}}>
        <ScrollView contentContainerStyle={{padding:16,paddingBottom:40,gap:14}} showsVerticalScrollIndicator={false}>

          {/* ヘッダー */}
          <AnimatedSection delay={0} type="fade-up">
          <View style={{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between'}}>
            <View style={{gap:2}}>
              <Text style={{color:'#fff',fontSize:20,fontWeight:'800'}}>{joined.teamName}</Text>
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
          </AnimatedSection>

          {/* アクションボタン2つ */}
          <AnimatedSection delay={60} type="fade-up">
          <View style={{flexDirection:'row',gap:10}}>
            <TouchableOpacity style={pl.actionBtn} onPress={() => { setEditBody([...bodyParts]); setShowBody(true) }} activeOpacity={0.85}>
              <Ionicons name="body-outline" size={20} color="#FF9500"/>
              <Text style={{color:'#fff',fontSize:13,fontWeight:'700'}}>痛みを報告</Text>
              {bodyParts.length > 0 && <View style={{backgroundColor:'#FF9500',borderRadius:8,paddingHorizontal:6,paddingVertical:1}}><Text style={{color:'#fff',fontSize:9,fontWeight:'800'}}>{bodyParts.length}箇所</Text></View>}
            </TouchableOpacity>
            <TouchableOpacity style={pl.actionBtn} onPress={() => setShowVideoModal(true)} activeOpacity={0.85}>
              <Ionicons name="videocam-outline" size={20} color={BRAND}/>
              <Text style={{color:'#fff',fontSize:13,fontWeight:'700'}}>動画を送る</Text>
            </TouchableOpacity>
          </View>
          </AnimatedSection>

          {/* ピン留めメッセージ */}
          {pinned.length > 0 && (
            <AnimatedSection delay={120} type="fade-up">
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
            <AnimatedSection delay={160} type="fade-up">
            <View style={{gap:8}}>
              <Text style={pl.sectionTitle}>📣 コーチからのメッセージ</Text>
              {regular.slice(0,5).map(m => (
                <View key={m.id} style={{backgroundColor:'#ffffff',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',padding:14,shadowColor:'#000',shadowOffset:{width:0,height:1},shadowOpacity:0.05,shadowRadius:4,elevation:1}}>
                  <Text style={{color:BRAND,fontSize:11,fontWeight:'700',marginBottom:6}}>{m.author_name} · {timeAgo(m.created_at)}</Text>
                  <Text style={{color:TEXT.primary,fontSize:14,lineHeight:22}}>{m.content}</Text>
                </View>
              ))}
            </View>
            </AnimatedSection>
          )}

          {messages.length === 0 && (
            <AnimatedSection delay={160} type="fade-up">
            <View style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',padding:20,alignItems:'center',gap:6}}>
              <Ionicons name="chatbubble-outline" size={26} color="#9ca3af"/>
              <Text style={{color:'#6b7280',fontSize:13}}>コーチからのメッセージはまだありません</Text>
            </View>
            </AnimatedSection>
          )}

          {/* 自分のコンディション */}
          <AnimatedSection delay={200} type="fade-up">
          <Text style={pl.sectionTitle}>マイ コンディション</Text>
          <View style={{backgroundColor:'#ffffff',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',padding:14}}>
            <View style={{flexDirection:'row',gap:10,marginBottom:12}}>
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
              </View>
            )}
          </View>
          </AnimatedSection>

          {/* チームメイト一覧 */}
          {teammates.length > 0 && (
            <AnimatedSection delay={260} type="fade-up">
            <>
              <Text style={pl.sectionTitle}>👥 チームメイト</Text>
              <View style={{backgroundColor:'#ffffff',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',overflow:'hidden'}}>
                {teammates.map((m, i) => (
                  <View
                    key={m.id}
                    style={{
                      flexDirection:'row', alignItems:'center', gap:10,
                      paddingHorizontal:14, paddingVertical:12,
                      borderBottomWidth: i < teammates.length-1 ? StyleSheet.hairlineWidth : 0,
                      borderBottomColor:'rgba(0,0,0,0.07)',
                    }}
                  >
                    <Avatar name={m.player_name} size={34} color={avatarColor(m.player_name)}/>
                    <View style={{flex:1}}>
                      <Text style={{color:TEXT.primary,fontSize:14,fontWeight:'700'}}>{m.player_name}</Text>
                      {m.event ? <Text style={{color:TEXT.secondary,fontSize:11}}>{m.event}</Text> : null}
                    </View>
                    <Text style={{color:TEXT.hint,fontSize:11}}>{daysSince(m.joined_at)}</Text>
                  </View>
                ))}
              </View>
            </>
            </AnimatedSection>
          )}

        </ScrollView>
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
            {editBody.length > 0 ? (
              <TouchableOpacity style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:14,marginTop:16}} onPress={saveBodyReport} activeOpacity={0.85}>
                <Ionicons name="send" size={18} color="#fff"/>
                <Text style={{color:'#fff',fontSize:15,fontWeight:'800'}}>コーチに報告する</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'#f0f2f5',borderRadius:14,paddingVertical:14,marginTop:16,borderWidth:1,borderColor:'rgba(0,0,0,0.08)'}} onPress={saveBodyReport} activeOpacity={0.85}>
                <Text style={{color:'#888',fontSize:15,fontWeight:'700'}}>痛みなし（クリア）</Text>
              </TouchableOpacity>
            )}
          </View>
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
    </View>
  )
}

const co = StyleSheet.create({
  header:     { flexDirection:'row', alignItems:'flex-start', justifyContent:'space-between', padding:16, paddingBottom:0 },
  title:      { color:TEXT.primary, fontSize:20, fontWeight:'800' },
  codeBox:    { backgroundColor:'rgba(229,57,53,0.08)', borderRadius:10, borderWidth:1, borderColor:BRAND+'30', paddingHorizontal:10, paddingVertical:6, alignItems:'center' },
  switchBtn:  { width:34, height:34, borderRadius:10, backgroundColor:'#f0f2f5', borderWidth:1, borderColor:'rgba(0,0,0,0.08)', alignItems:'center', justifyContent:'center' },
  tabs:       { flexDirection:'row', borderBottomWidth:1, borderColor:'rgba(0,0,0,0.08)', paddingHorizontal:16, backgroundColor:'#ffffff' },
  tab:        { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:5, paddingVertical:12 },
  tabActive:  { borderBottomWidth:2, borderColor:BRAND },
  tabLabel:   { fontSize:13, fontWeight:'700' },
  badge:      { width:16, height:16, borderRadius:8, backgroundColor:'#ef4444', alignItems:'center', justifyContent:'center' },
  alertChip:  { flexDirection:'row', alignItems:'center', gap:5, backgroundColor:'rgba(239,68,68,0.08)', borderRadius:8, borderWidth:1, borderColor:'#ef4444'+'40', paddingHorizontal:10, paddingVertical:6 },
  memberCard: { backgroundColor:'#ffffff', borderRadius:14, borderWidth:1, borderColor:'rgba(0,0,0,0.08)', padding:14, shadowColor:'#000', shadowOffset:{width:0,height:1}, shadowOpacity:0.05, shadowRadius:4, elevation:1 },
  composeBox: { flexDirection:'row', gap:10, alignItems:'flex-end', backgroundColor:'#ffffff', borderRadius:14, borderWidth:1, borderColor:'rgba(0,0,0,0.10)', padding:12 },
  composeInput:{ flex:1, color:TEXT.primary, fontSize:14, minHeight:40, maxHeight:100 },
  sendBtn:    { width:42, height:42, borderRadius:12, backgroundColor:BRAND, alignItems:'center', justifyContent:'center' },
  msgCard:    { backgroundColor:'#ffffff', borderRadius:12, borderWidth:1, borderColor:'rgba(0,0,0,0.08)', padding:14, shadowColor:'#000', shadowOffset:{width:0,height:1}, shadowOpacity:0.04, shadowRadius:4, elevation:1 },
  videoCard:  { backgroundColor:'#ffffff', borderRadius:14, borderWidth:1, borderColor:'rgba(0,0,0,0.08)', padding:14, shadowColor:'#000', shadowOffset:{width:0,height:1}, shadowOpacity:0.04, shadowRadius:4, elevation:1 },
})
const pl = StyleSheet.create({
  sectionTitle: { color:TEXT.hint, fontSize:11, fontWeight:'700', letterSpacing:1 },
  actionBtn:    { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, backgroundColor:'#f0f2f5', borderRadius:14, borderWidth:1, borderColor:'rgba(0,0,0,0.08)', paddingVertical:14 },
})

// ─────────────────────────────────────────────────────────
// TeamMenuSheet — スワップボタンから開くアクションシート
// ─────────────────────────────────────────────────────────
function TeamMenuSheet({ visible, role, onSwitchRole, onDangerAction, onClose }: {
  visible: boolean
  role: 'coach' | 'player'
  onSwitchRole: () => void
  onDangerAction: () => void   // 削除 or 脱退
  onClose: () => void
}) {
  function confirmDanger() {
    onClose()
    const label = role === 'coach' ? 'チームを削除' : 'チームを脱退'
    const msg   = role === 'coach'
      ? 'チームを削除すると参加コードが無効になります。本当に削除しますか？'
      : 'チームを脱退します。再参加するにはコードが必要です。'
    Alert.alert(label, msg, [
      { text: 'キャンセル', style: 'cancel' },
      { text: role === 'coach' ? '削除する' : '脱退する', style: 'destructive', onPress: onDangerAction },
    ])
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.6)',justifyContent:'flex-end'}}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose}/>
        <View style={{backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,padding:20,paddingBottom:44,gap:10}}>
          <View style={{width:36,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.12)',alignSelf:'center',marginBottom:8}}/>
          <Text style={{color:'#111827',fontSize:16,fontWeight:'800',marginBottom:4}}>チームメニュー</Text>

          {/* ロール切り替え */}
          <TouchableOpacity
            style={{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:'#f0f2f5',borderRadius:14,padding:16}}
            onPress={() => { onClose(); setTimeout(onSwitchRole, 200) }}
            activeOpacity={0.8}
          >
            <View style={{width:40,height:40,borderRadius:12,backgroundColor:BRAND+'18',alignItems:'center',justifyContent:'center'}}>
              <Ionicons name="swap-horizontal-outline" size={20} color={BRAND}/>
            </View>
            <View style={{flex:1}}>
              <Text style={{color:'#111827',fontSize:14,fontWeight:'700'}}>ロールを切り替え</Text>
              <Text style={{color:'#6b7280',fontSize:11,marginTop:1}}>
                {role === 'coach' ? '選手として参加しているチームへ' : 'コーチとして作成したチームへ'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9ca3af"/>
          </TouchableOpacity>

          {/* 危険操作 */}
          <TouchableOpacity
            style={{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:'rgba(239,68,68,0.06)',borderRadius:14,padding:16,borderWidth:1,borderColor:'rgba(239,68,68,0.15)'}}
            onPress={confirmDanger}
            activeOpacity={0.8}
          >
            <View style={{width:40,height:40,borderRadius:12,backgroundColor:'rgba(239,68,68,0.1)',alignItems:'center',justifyContent:'center'}}>
              <Ionicons name={role==='coach'?'trash-outline':'exit-outline'} size={20} color="#ef4444"/>
            </View>
            <View style={{flex:1}}>
              <Text style={{color:'#ef4444',fontSize:14,fontWeight:'700'}}>
                {role === 'coach' ? 'チームを削除' : 'チームを脱退'}
              </Text>
              <Text style={{color:'#9ca3af',fontSize:11,marginTop:1}}>
                {role === 'coach' ? '参加コードが無効になります' : '再参加にはコードが必要です'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* キャンセル */}
          <TouchableOpacity
            style={{alignItems:'center',paddingVertical:14,borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)'}}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={{color:'#6b7280',fontSize:15,fontWeight:'600'}}>キャンセル</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
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

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
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../../context/LanguageContext'
import { narrativeLanguageInstruction } from '../../lib/aiLanguage'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import Svg, { Circle } from 'react-native-svg'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { BRAND, TEXT } from '../../lib/theme'
import AnimatedSection from '../../components/AnimatedSection'
import { calcInjuryRisk, type InjuryRiskResult } from '../../lib/injuryRisk'
import { calcLevelInfo, RANK_TIERS, getTierTitle } from '../../lib/gamification'
import { getEventLabel } from '../../lib/eventLabels'
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
  syncTeamSessions, fetchTeamSessions, clearPlayerPrivateData,
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
import { showNow } from '../../lib/notifications'
import PulseView from '../../components/PulseView'
import { localDateStr, todayLocalISO } from '../../lib/dateLocal'
import { checkAdGate, recordUsage } from '../../lib/adGate'
import { TICKET_COST } from '../../lib/ticketWallet'
import TicketGateModal from '../../components/TicketGateModal'

// ── 練習メニュー（自由文＋よく使うフレーズ） 型定義 ──────
// 2026-08: 旧「ライブラリ(カテゴリ8種×強度3種×フォルダ)+プランビルダー」構成は、
// 最終的にテキスト1本をアナウンスへ投稿するだけの機能に対して入力が重すぎたため撤廃。
// 自由文入力を主役にし、よく使う文言は「ラベル+挿入テキスト」だけの軽いチップに簡素化した。
interface QuickPhrase {
  id: string
  label: string   // チップに表示する短い名前
  text: string    // タップした時にテキストへ挿入される内容
  createdAt: string
}

// AIにメニューを考えてもらう時の「狙い」チップ
function buildAiMenuFocusTags(t: (key: string) => string) {
  return [
    { key: 'sprint',   label: t('team.aiMenuFocusTags.sprint'),   emoji: '⚡' },
    { key: 'interval', label: t('team.aiMenuFocusTags.interval'), emoji: '🏃' },
    { key: 'drill',    label: t('team.aiMenuFocusTags.drill'),    emoji: '🎯' },
    { key: 'strength', label: t('team.aiMenuFocusTags.strength'), emoji: '💪' },
    { key: 'endurance',label: t('team.aiMenuFocusTags.endurance'),emoji: '🏞️' },
  ] as const
}

function buildAiMenuIntensityCfg(t: (key: string) => string) {
  return {
    light:  { label: t('team.aiMenuIntensity.light') },
    normal: { label: t('team.aiMenuIntensity.normal') },
    hard:   { label: t('team.aiMenuIntensity.hard') },
  } as const
}
type AiMenuIntensityKey = 'light' | 'normal' | 'hard'

// ── ストレージキー（ローカル設定のみ） ────────────────────
const ROLE_KEY            = 'trackmate_team_role'
const SESSIONS_KEY        = 'trackmate_sessions'
const SETUP_KEY           = 'trackmate_team_setup'
const JOINED_KEY          = 'trackmate_team_joined'
const MENU_PHRASES_KEY    = 'trackmate_coach_menu_phrases'
const MENU_DRAFT_KEY      = 'trackmate_coach_menu_draft'
const SLEEP_KEY           = 'trackmate_sleep'
const CONDITION_MAP_KEY   = 'trackmate_condition_map'
const RECOVERY_KEY        = 'trackmate_recovery_records'
const STRETCH_RESULT_KEY  = 'trackmate_stretch_result'
const PLAYER_ICON_KEY     = 'score_player_icon'
const SHARE_LEVEL_KEY     = 'trackmate_team_share_level'

// 0=非公開 1=コンディションのみ 2=全データ（デフォルト）
type ShareLevel = 0 | 1 | 2

type Role = 'coach' | 'player'

// ── 型定義 ────────────────────────────────────────────────
interface TeamSetup  { teamName: string; coachName: string; code: string; createdAt: string }
interface JoinedTeam { code: string; teamName: string; coachName: string; playerName: string; joinedAt: string }
type TeamMessage = TeamMessageRow
type VideoEntry  = TeamVideoRow

// ── 痛み部位リスト ────────────────────────────────────────
function buildBodyParts(t: (key: string) => string) {
  return [
    { id: 'head',       label: t('team.bodyParts.head'),       side: 'center' },
    { id: 'shoulder_r', label: t('team.bodyParts.shoulderR'),  side: 'right' },
    { id: 'shoulder_l', label: t('team.bodyParts.shoulderL'),  side: 'left' },
    { id: 'elbow_r',    label: t('team.bodyParts.elbowR'),     side: 'right' },
    { id: 'back_upper', label: t('team.bodyParts.backUpper'),  side: 'center' },
    { id: 'elbow_l',    label: t('team.bodyParts.elbowL'),     side: 'left' },
    { id: 'back_lower', label: t('team.bodyParts.backLower'),  side: 'center' },
    { id: 'hip_r',      label: t('team.bodyParts.hipR'),       side: 'right' },
    { id: 'hip_l',      label: t('team.bodyParts.hipL'),       side: 'left' },
    { id: 'knee_r',     label: t('team.bodyParts.kneeR'),      side: 'right' },
    { id: 'knee_l',     label: t('team.bodyParts.kneeL'),      side: 'left' },
    { id: 'ankle_r',    label: t('team.bodyParts.ankleR'),     side: 'right' },
    { id: 'ankle_l',    label: t('team.bodyParts.ankleL'),     side: 'left' },
  ]
}

// ── デモメンバー（Supabaseにデータがない時のフォールバック）─
type Member = { id: string; name: string; event: string; icon?: string; sessions: TrainingSession[]; lastActive: string; painParts?: string[]; painDetail?: string; ackedByCoach?: boolean }
function buildDemoMembers(t: (key: string) => string): Member[] {
  return [
    {
      id: 'demo-tanaka', name: t('team.demoMembers.tanaka.name'), event: t('team.demoMembers.tanaka.event'),
      lastActive: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      painParts: ['knee_r', 'back_lower'],
      sessions: [
        { id:'s1', user_id:'demo-tanaka', session_date: new Date(Date.now()-86400000).toISOString().slice(0,10), session_type:'interval', fatigue_level:8, condition_level:5, distance_m:3000, created_at:'' },
        { id:'s2', user_id:'demo-tanaka', session_date: new Date(Date.now()-172800000).toISOString().slice(0,10), session_type:'interval', fatigue_level:8, condition_level:5, distance_m:4000, created_at:'' },
      ],
    },
    {
      id: 'demo-suzuki', name: t('team.demoMembers.suzuki.name'), event: t('team.demoMembers.suzuki.event'),
      lastActive: new Date().toISOString().slice(0, 10),
      sessions: [
        { id:'s3', user_id:'demo-suzuki', session_date: new Date().toISOString().slice(0,10), session_type:'easy', fatigue_level:4, condition_level:8, distance_m:10000, created_at:'' },
      ],
    },
    {
      id: 'demo-sato', name: t('team.demoMembers.sato.name'), event: t('team.demoMembers.sato.event'),
      lastActive: new Date(Date.now()-259200000).toISOString().slice(0, 10),
      painParts: ['ankle_l'],
      sessions: [
        { id:'s4', user_id:'demo-sato', session_date: new Date(Date.now()-259200000).toISOString().slice(0,10), session_type:'interval', fatigue_level:10, condition_level:4, distance_m:3200, created_at:'' },
        { id:'s5', user_id:'demo-sato', session_date: new Date(Date.now()-345600000).toISOString().slice(0,10), session_type:'interval', fatigue_level:9, condition_level:4, distance_m:2800, created_at:'' },
      ],
    },
    {
      id: 'demo-ito', name: t('team.demoMembers.ito.name'), event: t('team.demoMembers.ito.event'),
      lastActive: new Date().toISOString().slice(0, 10),
      sessions: [
        { id:'s6', user_id:'demo-ito', session_date: new Date().toISOString().slice(0,10), session_type:'easy', fatigue_level:2, condition_level:9, distance_m:8000, created_at:'' },
      ],
    },
  ]
}

// ── ユーティリティ ────────────────────────────────────────
function generateCode() { return Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6).padEnd(6,'0') }
function formatCode(c: string) { const s = c.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6); return s.length > 3 ? `${s.slice(0,3)}-${s.slice(3)}` : s }
function daysSince(d: string, t: (key: string, opts?: any) => string) { const n = Math.floor((Date.now()-new Date(d).getTime())/86400000); return n===0?t('team.date.today'):n===1?t('team.date.yesterday'):t('team.date.daysAgo', { n }) }
function timeAgo(iso: string, t: (key: string, opts?: any) => string) { const m = Math.floor((Date.now()-new Date(iso).getTime())/60000); return m<1?t('team.date.justNow'):m<60?t('team.date.minutesAgo', { n: m }):m<1440?t('team.date.hoursAgo', { n: Math.floor(m/60) }):daysSince(iso, t) }
function daysLeft(iso: string) { return Math.max(0, 7 - Math.floor((Date.now()-new Date(iso).getTime())/86400000)) }
function fmtEventDate(d: string, t: (key: string, opts?: any) => string, dayNames: string[]) {
  const dt = new Date(d + 'T00:00:00')
  const today = new Date(); today.setHours(0,0,0,0)
  const diff = Math.round((dt.getTime()-today.getTime())/86400000)
  if (diff === 0) return t('team.date.today')
  if (diff === 1) return t('team.date.tomorrow')
  if (diff === -1) return t('team.date.yesterday')
  return `${dt.getMonth()+1}/${dt.getDate()}（${dayNames[dt.getDay()]}）`
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
function buildEventCfg(t: (key: string) => string): Record<string, { emoji: string; color: string; label: string }> {
  return {
    practice: { emoji: '🏃', color: '#34C759', label: t('team.eventCfg.practice') },
    race:     { emoji: '🏁', color: BRAND,     label: t('team.eventCfg.race') },
    rest:     { emoji: '😴', color: '#5856D6', label: t('team.eventCfg.rest') },
    meeting:  { emoji: '💬', color: '#FF9500', label: t('team.eventCfg.meeting') },
    other:    { emoji: '📌', color: '#8E8E93', label: t('team.eventCfg.other') },
  }
}

// ── 負荷・リスク設定 ─────────────────────────────────────
function buildRiskCfg(t: (key: string) => string) {
  return {
    danger: { color: '#E53935', bg: 'rgba(229,57,53,0.12)', label: t('team.riskCfg.danger') },
    high:   { color: '#FF9500', bg: 'rgba(255,149,0,0.12)', label: t('team.riskCfg.high') },
    medium: { color: '#6366f1', bg: 'rgba(99,102,241,0.10)', label: t('team.riskCfg.medium') },
    low:    { color: '#34C759', bg: 'rgba(52,199,89,0.12)', label: t('team.riskCfg.low') },
  } as const
}
type RiskCfgKey = 'danger' | 'high' | 'medium' | 'low'

function buildLoadCfg(t: (key: string) => string) {
  return {
    danger: { color: '#E53935', label: t('team.loadCfg.danger') },
    high:   { color: '#FF9500', label: t('team.loadCfg.high') },
    medium: { color: '#F5A623', label: t('team.loadCfg.medium') },
    low:    { color: '#34C759', label: t('team.loadCfg.low') },
  } as const
}
type LoadCfgKey = 'danger' | 'high' | 'medium' | 'low'

const SESSION_LOAD_BASE: Record<string, number> = {
  sprint: 100, interval: 70, tempo: 50, easy: 20,
  long: 15, drill: 80, strength: 120, race: 200, rest: 0,
}
function calcWeeklyLoad(sessions: TrainingSession[]): number {
  const now = Date.now()
  const week = sessions.filter(s => now - new Date(s.session_date).getTime() <= 7 * 86_400_000)
  return Math.round(week.reduce((sum, s) => {
    const w = SESSION_LOAD_BASE[s.session_type] ?? 0
    // distance_m は本数分を含む合計距離として保存されている（例: 300m×6本 → 1800）ため、
    // ここで reps を掛けると二重計算になる。km換算のみ行う。
    if (s.session_type === 'sprint' || s.session_type === 'interval' || s.session_type === 'tempo' || s.session_type === 'easy' || s.session_type === 'long') {
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
  const today = todayLocalISO()
  const yesterday = localDateStr(new Date(Date.now() - 86400000))
  if (dates[0] !== today && dates[0] !== yesterday) return 0
  let streak = 1
  for (let i = 1; i < dates.length; i++) {
    const expected = localDateStr(new Date(new Date(dates[i-1] + 'T00:00:00').getTime() - 86400000))
    if (dates[i] === expected) streak++
    else break
  }
  return streak
}

function buildFatigueMap(t: (key: string) => string): Record<number,{emoji:string;label:string;color:string}> {
  return {
    2:{emoji:'😊',label:t('team.fatigue.easy'),color:'#34C759'}, 4:{emoji:'🙂',label:t('team.fatigue.slightlyEasy'),color:'#30D158'},
    6:{emoji:'😐',label:t('team.fatigue.normal'),color:'#FF9F0A'}, 8:{emoji:'😰',label:t('team.fatigue.hard'),color:'#FF6B35'},
    10:{emoji:'🥵',label:t('team.fatigue.limit'),color:'#FF3B30'},
  }
}
function fatigueInfo(v: number, t: (key: string) => string) {
  const FATIGUE_MAP = buildFatigueMap(t)
  const k = [2,4,6,8,10].reduce((a,b) => Math.abs(b-v)<Math.abs(a-v)?b:a)
  return FATIGUE_MAP[k]??FATIGUE_MAP[6]
}

// ── 共通コンポーネント ────────────────────────────────────
function Avatar({ name, size=40, color=BRAND, emoji }: { name:string; size?:number; color?:string; emoji?:string }) {
  return (
    <View style={{width:size,height:size,borderRadius:size/2,backgroundColor:color+'22',borderWidth:1.5,borderColor:color+'44',alignItems:'center',justifyContent:'center'}}>
      {emoji
        ? <Text style={{fontSize:size*.52,lineHeight:size*.68}}>{emoji}</Text>
        : <Text style={{color,fontSize:size*.38,fontWeight:'800'}}>{name.charAt(0)}</Text>
      }
    </View>
  )
}
const AVATAR_COLORS = ['#FF3B30','#FF9500','#34C759','#007AFF','#AF52DE']
function avatarColor(name: string) { return AVATAR_COLORS[name.charCodeAt(0)%AVATAR_COLORS.length] }

// リスクスコアを、アバターを囲む細いリングの塗り具合で表す（行全体を着色しない代わりの表現）
function RingAvatar({ name, size=44, color, ringPct }: { name:string; size?:number; color:string; ringPct:number }) {
  const stroke = 2.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(100, ringPct)) / 100
  const innerInset = stroke + 2
  const innerSize = size - innerInset * 2
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size/2} cy={size/2} r={r} stroke="#ececec" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - filled)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`}
        />
      </Svg>
      <View style={{
        position: 'absolute', top: innerInset, left: innerInset, width: innerSize, height: innerSize,
        borderRadius: innerSize / 2, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ color: '#6b7280', fontSize: innerSize * .38, fontWeight: '800' }}>{name.charAt(0)}</Text>
      </View>
    </View>
  )
}

const PLAYER_ICONS = ['🏃','🔥','⚡','🌟','🦁','🐯','🎯','💪','🏆','🥇','🎽','🦅','🌊','🐺','💎','🌙','☀️','🎪','🦊','🐉']

function PlayerIconPicker({ visible, current, onSelect, onClose }: {
  visible: boolean; current: string; onSelect: (emoji: string) => void; onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.5)',justifyContent:'flex-end'}}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose}/>
        <View style={{backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,padding:20,paddingBottom:44,gap:0}}>
          <View style={{width:36,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.12)',alignSelf:'center',marginBottom:16}}/>
          <Text style={{fontSize:16,fontWeight:'800',color:'#111827',marginBottom:16}}>{t('team.playerIconPicker.title')}</Text>
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>
            {PLAYER_ICONS.map(icon => (
              <TouchableOpacity
                key={icon}
                style={{width:52,height:52,borderRadius:14,backgroundColor:current===icon?'rgba(52,199,89,0.15)':'#f3f4f6',alignItems:'center',justifyContent:'center',borderWidth:current===icon?2:0,borderColor:'#34C759'}}
                onPress={() => onSelect(icon)}
                activeOpacity={0.75}
              >
                <Text style={{fontSize:26}}>{icon}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {current !== '' && (
            <TouchableOpacity style={{marginTop:16,alignItems:'center'}} onPress={() => onSelect('')}>
              <Text style={{color:'#9ca3af',fontSize:13}}>{t('team.playerIconPicker.reset')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────
// BodyPartSelector — 痛い箇所セレクター
// ─────────────────────────────────────────────────────────
function BodyPartSelector({ selected, onChange }: { selected: string[]; onChange: (parts: string[]) => void }) {
  const { t } = useTranslation()
  const BODY_PARTS = buildBodyParts(t)
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
  const { t } = useTranslation()
  const BODY_PARTS = buildBodyParts(t)
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
  const { t } = useTranslation()
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
              <Text style={{color:'#6b7280',fontSize:14,fontWeight:'700'}}>{t('team.confirm.cancel')}</Text>
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
  const { t } = useTranslation()
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
        Toast.show({ type: 'success', text1: t('team.videoSubmit.urlPasted'), visibilityTime: 1200 })
      } else {
        Toast.show({ type: 'error', text1: t('team.videoSubmit.urlNotFound'), text2: t('team.videoSubmit.urlNotFoundHint'), visibilityTime: 2500 })
      }
    } catch {
      Toast.show({ type: 'error', text1: t('team.videoSubmit.clipboardReadFailed') })
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
    if (!url.trim()) { Toast.show({type:'error',text1:t('team.videoSubmit.urlRequired')}); return }
    setBusy(true)
    try {
      await submitVideo(teamCode, playerName, url.trim(), desc.trim() || t('team.videoSubmit.defaultDesc'))
      await sendPush(`🎥 ${playerName}`, desc.trim() || t('team.videoSubmit.defaultDesc'), 'coaches', teamCode)
      Toast.show({type:'success',text1:t('team.videoSubmit.sentToast'),visibilityTime:1800})
      setUrl(''); setDesc(''); onSent(); onClose()
    } catch {
      Toast.show({type:'error',text1:t('team.videoSubmit.sendFailed')})
    } finally { setBusy(false) }
  }

  const STEPS = [
    { icon: '📂', title: t('team.videoSubmit.step1Title'), desc: t('team.videoSubmit.step1Desc') },
    { icon: '⬆️', title: t('team.videoSubmit.step2Title'), desc: t('team.videoSubmit.step2Desc') },
    { icon: '🔗', title: t('team.videoSubmit.step3Title'), desc: t('team.videoSubmit.step3Desc') },
    { icon: '📋', title: t('team.videoSubmit.step4Title'), desc: t('team.videoSubmit.step4Desc') },
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
                {step === 'guide' ? t('team.videoSubmit.titleGuide') : t('team.videoSubmit.titleInput')}
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={{top:10,bottom:10,left:10,right:10}} accessibilityLabel={t('team.videoSubmit.close')}>
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
                  <Text style={{color:'#fff',fontSize:15,fontWeight:'800'}}>{t('team.videoSubmit.openDrive')}</Text>
                  <Ionicons name="open-outline" size={16} color="#fff"/>
                </HapticTouch>

                {/* リンクコピー後：貼り付けて送るボタン */}
                <HapticTouch haptic="save"
                  style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,backgroundColor:BRAND,borderRadius:14,paddingVertical:14,marginBottom:6}}
                  onPress={pasteFromClipboard} activeOpacity={0.85}>
                  <Ionicons name="clipboard-outline" size={18} color="#fff"/>
                  <Text style={{color:'#fff',fontSize:15,fontWeight:'800'}}>{t('team.videoSubmit.pasteAndSend')}</Text>
                </HapticTouch>

                {/* 手動入力へ */}
                <TouchableOpacity onPress={() => setStep('input')} style={{alignItems:'center',paddingVertical:12}} activeOpacity={0.7}>
                  <Text style={{color:TEXT.hint,fontSize:12}}>{t('team.videoSubmit.manualInputHint')}</Text>
                </TouchableOpacity>
              </ScrollView>
            ) : (
              /* ── URL入力ビュー ── */
              <>
                <TouchableOpacity onPress={() => setStep('guide')} style={{flexDirection:'row',alignItems:'center',gap:4,marginBottom:14}} activeOpacity={0.7}>
                  <Ionicons name="chevron-back" size={16} color={BRAND}/>
                  <Text style={{color:BRAND,fontSize:13,fontWeight:'700'}}>{t('team.videoSubmit.backToGuide')}</Text>
                </TouchableOpacity>

                <Text style={vs.label}>{t('team.videoSubmit.urlLabel')}</Text>
                <View style={{flexDirection:'row',gap:8,marginBottom:14}}>
                  <TextInput
                    style={[vs.input,{flex:1}]}
                    value={url} onChangeText={setUrl}
                    placeholder={t('team.videoSubmit.urlPlaceholder')}
                    placeholderTextColor="#9ca3af"
                    autoCapitalize="none" keyboardType="url"
                  />
                  <TouchableOpacity
                    style={{width:44,height:44,borderRadius:10,backgroundColor:'#f0f2f5',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'rgba(0,0,0,0.08)'}}
                    onPress={pasteFromClipboard} activeOpacity={0.8} accessibilityLabel={t('team.videoSubmit.pasteFromClipboard')}>
                    <Ionicons name="clipboard-outline" size={20} color={BRAND}/>
                  </TouchableOpacity>
                </View>

                <Text style={vs.label}>{t('team.videoSubmit.noteLabel')}</Text>
                <TextInput
                  style={[vs.input,{height:72,textAlignVertical:'top',paddingTop:10,marginBottom:16}]}
                  value={desc} onChangeText={setDesc}
                  placeholder={t('team.videoSubmit.notePlaceholder')}
                  placeholderTextColor="#9ca3af" multiline maxLength={100}
                />

                <HapticTouch haptic="save" style={[vs.btn, busy&&{opacity:0.5}]} onPress={submit} disabled={busy} activeOpacity={0.85}>
                  {busy ? <ActivityIndicator size="small" color="#fff"/> : <Ionicons name="send" size={18} color="#fff"/>}
                  <Text style={{color:'#fff',fontSize:16,fontWeight:'800'}}>{busy?t('team.videoSubmit.sending'):t('team.videoSubmit.send')}</Text>
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

const COACH_GREEN = '#166534'

// CoachPaywallScreen は削除済み（実機で表示直後にフリーズする不具合のため撤去）。
// コーチ機能は現在ペイウォールなしで利用できる。

// ─────────────────────────────────────────────────────────
// RoleSelectionScreen
// ─────────────────────────────────────────────────────────
function RoleSelectionScreen({ onSelect }: { onSelect: (role: Role) => void }) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  return (
    <View style={{flex:1,backgroundColor:colors.bg}}>
      <SafeAreaView style={{flex:1}}>
        <ScrollView contentContainerStyle={{padding:24,paddingTop:48,gap:16}} showsVerticalScrollIndicator={false}>
          <View style={{alignItems:'center',marginBottom:8}}>
            <Ionicons name="people" size={52} color={BRAND}/>
          </View>
          <Text style={{color:colors.text,fontSize:26,fontWeight:'800',textAlign:'center'}}>{t('team.roleSelection.title')}</Text>
          <Text style={{color:colors.textSec,fontSize:14,lineHeight:22,textAlign:'center',marginBottom:4}}>
            {t('team.roleSelection.subtitle')}
          </Text>
          <TouchableOpacity style={[role_s.card,{backgroundColor:colors.surface,borderColor:colors.border}]} onPress={() => onSelect('coach')} activeOpacity={0.85}>
            <View style={[role_s.icon,{backgroundColor:BRAND+'18'}]}>
              <Ionicons name="clipboard" size={28} color={BRAND}/>
            </View>
            <View style={{flex:1,gap:3}}>
              <Text style={[role_s.title,{color:colors.text}]}>{t('team.roleSelection.coachTitle')}</Text>
              <Text style={[role_s.desc,{color:colors.textSec}]}>{t('team.roleSelection.coachDesc')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textHint}/>
          </TouchableOpacity>
          <TouchableOpacity style={[role_s.card,{backgroundColor:colors.surface,borderColor:colors.border}]} onPress={() => onSelect('player')} activeOpacity={0.85}>
            <View style={[role_s.icon,{backgroundColor:'#34C75918'}]}>
              <Ionicons name="person-circle" size={28} color="#34C759"/>
            </View>
            <View style={{flex:1,gap:3}}>
              <Text style={[role_s.title,{color:colors.text}]}>{t('team.roleSelection.playerTitle')}</Text>
              <Text style={[role_s.desc,{color:colors.textSec}]}>{t('team.roleSelection.playerDesc')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textHint}/>
          </TouchableOpacity>
          <Text style={{color:colors.textHint,fontSize:11,textAlign:'center'}}>{t('team.roleSelection.changeLaterHint')}</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}
const role_s = StyleSheet.create({
  card:  { flexDirection:'row', alignItems:'center', gap:14, borderRadius:21, borderWidth:1, padding:18 },
  icon:  { width:52, height:52, borderRadius:16, alignItems:'center', justifyContent:'center' },
  title: { fontSize:16, fontWeight:'800' },
  desc:  { fontSize:12, lineHeight:17 },
})

// ─────────────────────────────────────────────────────────
// CoachSetupScreen
// ─────────────────────────────────────────────────────────
function CoachSetupScreen({ onCreated, onBack }: { onCreated:(s:TeamSetup)=>void; onBack:()=>void }) {
  const { t } = useTranslation()
  const [teamName,  setTeamName]  = useState('')
  const [coachName, setCoachName] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!teamName.trim()||!coachName.trim()) { Toast.show({type:'error',text1:t('team.coachSetup.missingFields')}); return }
    setBusy(true)
    try {
      const s: TeamSetup = { teamName:teamName.trim(), coachName:coachName.trim(), code:generateCode(), createdAt:new Date().toISOString() }
      await AsyncStorage.setItem(SETUP_KEY, JSON.stringify(s))
      // Supabase にチームを登録（失敗してもローカル作成は進める。
      // ダッシュボードの load() で再登録され自己修復するため）
      await createTeam(s.code, s.teamName, s.coachName).catch(() => {})
      onCreated(s)
    } catch {
      Toast.show({type:'error',text1:t('team.coachSetup.createFailed')})
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
              <Text style={{color:TEXT.secondary,fontSize:14}}>{t('team.coachSetup.back')}</Text>
            </TouchableOpacity>
            <View style={{alignItems:'center',gap:8,marginBottom:8}}>
              <View style={{width:60,height:60,borderRadius:16,backgroundColor:BRAND+'18',alignItems:'center',justifyContent:'center'}}>
                <Ionicons name="shield-checkmark" size={30} color={BRAND}/>
              </View>
              <Text style={{color:TEXT.primary,fontSize:22,fontWeight:'800'}}>{t('team.coachSetup.title')}</Text>
              <Text style={{color:TEXT.secondary,fontSize:13,textAlign:'center',lineHeight:20}}>
                {t('team.coachSetup.subtitle')}
              </Text>
            </View>
            <View style={{gap:6}}>
              <Text style={su.label}>{t('team.coachSetup.teamNameLabel')}</Text>
              <TextInput style={su.input} value={teamName} onChangeText={setTeamName} placeholder={t('team.coachSetup.teamNamePlaceholder')} placeholderTextColor="#9ca3af" maxLength={30}/>
            </View>
            <View style={{gap:6}}>
              <Text style={su.label}>{t('team.coachSetup.coachNameLabel')}</Text>
              <TextInput style={su.input} value={coachName} onChangeText={setCoachName} placeholder={t('team.coachSetup.coachNamePlaceholder')} placeholderTextColor="#9ca3af" maxLength={20}/>
            </View>
            <TouchableOpacity style={[su.btn,busy&&{opacity:0.5}]} onPress={create} disabled={busy} activeOpacity={0.85}>
              <Ionicons name="checkmark-circle" size={20} color="#fff"/>
              <Text style={{color:'#fff',fontSize:16,fontWeight:'800'}}>{t('team.coachSetup.createButton')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  )
}
const su = StyleSheet.create({
  label:{ color:TEXT.hint, fontSize:11, fontWeight:'700', letterSpacing:0.8 },
  input:{ backgroundColor:'#f8f8fa', borderRadius:14, borderWidth:1, borderColor:'rgba(0,0,0,0.10)', color:TEXT.primary, fontSize:15, paddingHorizontal:14, paddingVertical:12 },
  btn:  { flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, backgroundColor:BRAND, borderRadius:21, paddingVertical:15, marginTop:4 },
})

// ─────────────────────────────────────────────────────────
// PlayerJoinScreen
// ─────────────────────────────────────────────────────────
function PlayerJoinScreen({ onJoined, onBack }: { onJoined:(j:JoinedTeam)=>void; onBack:()=>void }) {
  const { t } = useTranslation()
  const [code,       setCode]       = useState('')
  const [playerName, setPlayerName] = useState('')
  const [busy, setBusy] = useState(false)

  async function join() {
    const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g,'')
    if (cleaned.length < 6) { Toast.show({type:'error',text1:t('team.playerJoin.codeError')}); return }
    if (!playerName.trim())  { Toast.show({type:'error',text1:t('team.playerJoin.nameError')}); return }
    setBusy(true)
    try {
      // Supabase でコードを検証（存在するチームか確認）
      let teamName = t('team.playerJoin.defaultTeamName'), coachName = t('team.playerJoin.defaultCoachName')
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
              Toast.show({type:'error',text1:t('team.playerJoin.teamNotFound')}); setBusy(false); return
            }
          } catch {
            Toast.show({type:'error',text1:t('team.playerJoin.corruptData')}); setBusy(false); return
          }
        } else {
          // ローカルにもチーム情報がない = 無効なコード
          Toast.show({type:'error',text1:t('team.playerJoin.teamNotFound')}); setBusy(false); return
        }
      }
      const j: JoinedTeam = { code:cleaned, teamName, coachName, playerName:playerName.trim(), joinedAt:new Date().toISOString() }
      await AsyncStorage.setItem(JOINED_KEY, JSON.stringify(j))
      // Supabaseにメンバー登録（失敗してもUIは進める。load() で自己修復される）
      await registerMember(cleaned, playerName.trim(), '').catch(() => {})
      // コーチに通知（失敗しても参加自体は成功）
      sendPush(t('team.videoSubmit.newMemberTitle'), t('team.videoSubmit.newMemberBody', { name: playerName.trim() }), 'coaches', cleaned).catch(() => {})
      Toast.show({type:'success',text1:t('team.playerJoin.joinedToast', { teamName }),visibilityTime:2000})
      onJoined(j)
    } catch {
      Toast.show({type:'error',text1:t('team.playerJoin.joinFailed')})
    } finally { setBusy(false) }
  }

  return (
    <View style={{flex:1,backgroundColor:'#f6f6f8'}}>
      <SafeAreaView style={{flex:1}}>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{flex:1}}>
          <ScrollView contentContainerStyle={{padding:24,gap:18}} showsVerticalScrollIndicator={false}>
            <TouchableOpacity onPress={onBack} style={{flexDirection:'row',alignItems:'center',gap:6,alignSelf:'flex-start'}} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={20} color={TEXT.secondary}/>
              <Text style={{color:TEXT.secondary,fontSize:14}}>{t('team.playerJoin.back')}</Text>
            </TouchableOpacity>
            <View style={{alignItems:'center',gap:8,marginBottom:8}}>
              <View style={{width:60,height:60,borderRadius:16,backgroundColor:'#34C759'+'18',alignItems:'center',justifyContent:'center'}}>
                <Ionicons name="enter-outline" size={30} color="#34C759"/>
              </View>
              <Text style={{color:TEXT.primary,fontSize:22,fontWeight:'800'}}>{t('team.playerJoin.title')}</Text>
              <Text style={{color:TEXT.secondary,fontSize:13,textAlign:'center',lineHeight:20}}>
                {t('team.playerJoin.subtitle')}
              </Text>
            </View>
            <View style={{gap:6}}>
              <Text style={su.label}>{t('team.playerJoin.codeLabel')}</Text>
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
              <Text style={su.label}>{t('team.playerJoin.nameLabel')}</Text>
              <TextInput style={su.input} value={playerName} onChangeText={setPlayerName} placeholder={t('team.playerJoin.namePlaceholder')} placeholderTextColor="#9ca3af" maxLength={20}/>
            </View>
            <TouchableOpacity
              style={[{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'#34C759',borderRadius:14,paddingVertical:15},(code.length<6||busy)&&{opacity:0.4}]}
              onPress={join}
              disabled={code.length<6||busy}
              activeOpacity={0.85}
            >
              <Ionicons name="enter-outline" size={20} color="#fff"/>
              <Text style={{color:'#fff',fontSize:16,fontWeight:'800'}}>{busy?t('team.playerJoin.joining'):t('team.playerJoin.joinButton')}</Text>
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
  const { t } = useTranslation()
  const { language } = useLanguage()
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
  const DAY_LABELS = t('home.dayNames', { returnObjects: true }) as unknown as string[]

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
        <TouchableOpacity onPress={prevMonth} hitSlop={{top:10,bottom:10,left:10,right:10}} accessibilityLabel={language === 'ja' ? '前の月' : 'Previous month'}>
          <Ionicons name="chevron-back" size={22} color={TEXT.primary}/>
        </TouchableOpacity>
        <Text style={{color:TEXT.primary,fontSize:15,fontWeight:'800'}}>
          {language === 'ja' ? `${vy}年${vm+1}月` : new Date(vy, vm, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </Text>
        <TouchableOpacity onPress={nextMonth} hitSlop={{top:10,bottom:10,left:10,right:10}} accessibilityLabel={language === 'ja' ? '次の月' : 'Next month'}>
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
function CoachDashboard({ setup, isCoach, onSwitchRole, onDeleteTeam, canSwitchRole }: {
  setup: TeamSetup; isCoach: boolean; onSwitchRole: () => void; onDeleteTeam: () => void; canSwitchRole?: boolean
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const DAY_NAMES = t('home.dayNames', { returnObjects: true }) as unknown as string[]
  const EVENT_CFG = buildEventCfg(t)
  const RISK_CFG = buildRiskCfg(t)
  const LOAD_CFG = buildLoadCfg(t)
  const AI_MENU_FOCUS_TAGS = buildAiMenuFocusTags(t)
  const AI_MENU_INTENSITY_CFG = buildAiMenuIntensityCfg(t)
  const DEMO_MEMBERS = buildDemoMembers(t)
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
  const [memberFilter,  setMemberFilter]  = useState<'all'|'danger'|'pain'|'needsAttention'>('all')
  const [hiddenDemoIds, setHiddenDemoIds] = useState<string[]>([])
  const [showMenu,      setShowMenu]      = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{id:string;name:string;isDemo:boolean}|null>(null)
  const [showEventModal, setShowEventModal] = useState(false)
  const [evTitle,       setEvTitle]       = useState('')
  const [evDate,        setEvDate]        = useState(todayLocalISO())
  const [evTime,        setEvTime]        = useState('')
  const [evLocation,    setEvLocation]    = useState('')
  const [evDesc,        setEvDesc]        = useState('')
  const [evType,        setEvType]        = useState<TeamEventType>('practice')
  const [evSubmitting,  setEvSubmitting]  = useState(false)

  // ── メニュー（自由文＋よく使うフレーズ） state ───────────
  const [planText,         setPlanText]         = useState('')
  const [quickPhrases,     setQuickPhrases]     = useState<QuickPhrase[]>([])
  const [showPhraseForm,   setShowPhraseForm]   = useState(false)
  const [phraseFormLabel,  setPhraseFormLabel]  = useState('')
  const [phraseFormText,   setPhraseFormText]   = useState('')
  const [sharingMenu,      setSharingMenu]      = useState(false)
  // AIにメニューを考えてもらうシート
  const [showAiMenuSheet,  setShowAiMenuSheet]  = useState(false)
  const [aiFocusTags,      setAiFocusTags]      = useState<Set<string>>(new Set())
  const [aiIntensity,      setAiIntensity]      = useState<AiMenuIntensityKey>('normal')
  const [aiFreeNote,       setAiFreeNote]       = useState('')
  const [aiGenerating,     setAiGenerating]     = useState(false)
  const [menuTicketGate,   setMenuTicketGate]   = useState<{visible:boolean; cost:number; balance:number}>({visible:false, cost:0, balance:0})

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    try {
      // チームを teams テーブルに再登録（GRANT前に作成して未登録のチームを自己修復）
      // これがないと予定追加・アナウンスが外部キー制約違反で失敗する
      createTeam(setup.code, setup.teamName, setup.coachName).catch(() => {})
      const [msgs, vids, mems, rpts, teamSessions, evts, pStats] = await Promise.all([
        fetchMessages(setup.code),
        fetchVideos(setup.code),
        fetchMembers(setup.code),
        fetchBodyReports(setup.code),
        fetchTeamSessions(setup.code),
        fetchTeamEvents(setup.code),
        fetchPlayerStats(setup.code),
      ])
      if (!mountedRef.current) return
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
      if (__DEV__) console.warn('[CoachDashboard] load error:', e)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [setup.code])

  // タブに戻るたびに再ロード（Realtimeの補完）— useEffect は不要、useFocusEffect で初回も走る
  useFocusEffect(useCallback(() => { load() }, [load]))
  // 3分ごとに自動ポーリング（Realtime遅延の補完 / Disk IO節約）
  useEffect(() => {
    const t = setInterval(() => { load() }, 3 * 60 * 1000)
    return () => clearInterval(t)
  }, [load])

  // Supabase Realtime — チームデータをリアルタイム同期（デバウンス2秒で過剰ロード防止）
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const debouncedLoad = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => { load() }, 2000)
    }
    const ch = supabase.channel(`coach:${setup.code}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_messages',     filter: `team_code=eq.${setup.code}` }, (payload) => {
        debouncedLoad()
        if (payload.eventType === 'INSERT') {
          const row = payload.new as TeamMessageRow
          if (row.author_name === '__system__') {
            const content = row.content ?? ''
            if (content.startsWith('[ABSENCE]'))
              showNow(t('team.coachDashboard.absenceNotifTitle'), content.replace(/^\[ABSENCE\] /, '')).catch(() => {})
            else if (content.startsWith('[VIDEO]'))
              showNow(t('team.coachDashboard.videoArrivedPushTitle'), content.replace(/^\[VIDEO\] /, '')).catch(() => {})
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members',      filter: `team_code=eq.${setup.code}` }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_body_reports', filter: `team_code=eq.${setup.code}` }, (payload) => {
        debouncedLoad()
        if (payload.eventType === 'INSERT') {
          const row = payload.new as BodyReportRow
          showNow(t('team.coachDashboard.painReportPushTitle'), t('team.coachDashboard.painReportPushBody', { name: row.player_name })).catch(() => {})
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_videos',       filter: `team_code=eq.${setup.code}` }, (payload) => {
        debouncedLoad()
        if (payload.eventType === 'INSERT') {
          const row = payload.new as TeamVideoRow
          showNow(t('team.coachDashboard.videoArrivedPushTitle'), t('team.coachDashboard.videoArrivedPushBody', { name: row.player_name })).catch(() => {})
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_sessions',     filter: `team_code=eq.${setup.code}` }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_player_stats', filter: `team_code=eq.${setup.code}` }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_events',       filter: `team_code=eq.${setup.code}` }, debouncedLoad)
      .subscribe()
    return () => { if (debounceTimer) clearTimeout(debounceTimer); supabase.removeChannel(ch) }
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
      Toast.show({type:'success',text1:t('team.coachDashboard.sentToast'),visibilityTime:1400})
    } catch (e: any) {
      setMsgText(content)  // 失敗したら元に戻す
      const errMsg = e?.message ?? String(e)
      const detail = errMsg.includes('row-level security') || errMsg.includes('permission')
        ? t('team.coachDashboard.loginRequired') : errMsg.slice(0, 60)
      Toast.show({type:'error', text1:t('team.coachDashboard.sendFailedTitle'), text2: detail, visibilityTime:3000})
    } finally {
      setMsgSending(false)
    }
  }

  async function togglePin(id: string, current: boolean) {
    await setPinMessage(id, !current)
    setMessages(prev => prev.map(m => m.id===id ? {...m, is_pinned:!current} : m))
    if (!current) {
      const msg = messages.find(m => m.id===id)
      if (msg) await sendPush(t('team.coachDashboard.importantNoticeTitle'), msg.content, 'players', setup.code)
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
    setPendingDelete(null)  // 確認ダイアログを即閉じる（閉じ忘れ防止）
    try {
      if (isDemo) {
        setHiddenDemoIds(prev => [...prev, id])
      } else {
        await deleteMember(id)
        setMembers(prev => prev.filter(m => m.id !== id))
      }
      if (detailMember?.id === id) setDetailMember(null)
      Toast.show({ type: 'success', text1: t('team.coachDashboard.removedToast', { name }), visibilityTime: 1600 })
    } catch (e: any) {
      Toast.show({ type: 'error', text1: t('team.coachDashboard.deleteFailed'), text2: e?.message ?? '', visibilityTime: 3000 })
    }
  }

  async function ackPain(playerName: string) {
    try {
      const { data, error } = await supabase.from('team_body_reports')
        .update({ acked_by_coach: true })
        .eq('team_code', setup.code)
        .eq('player_name', playerName)
        .select()  // 更新された行を返す（0件 = RLSブロック or 行なし）
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) {
        // RLSサイレントブロック or 行が存在しない
        Toast.show({ type: 'error', text1: t('team.coachDashboard.ackFailedTitle'), text2: t('team.coachDashboard.ackFailedMessage'), visibilityTime: 4000 })
        return
      }
      setBodyReports(prev => prev.map(r =>
        r.player_name === playerName ? { ...r, acked_by_coach: true } : r,
      ))
      setDetailMember(prev => prev ? { ...prev, ackedByCoach: true } : null)
      Toast.show({ type: 'success', text1: t('team.coachDashboard.ackedToast'), visibilityTime: 1400 })
    } catch (e: any) {
      Toast.show({ type: 'error', text1: t('team.coachDashboard.ackFailedGeneric'), text2: e?.message ?? String(e), visibilityTime: 3000 })
    }
  }

  async function addEvent() {
    if (!evTitle.trim() || evSubmitting) return
    setEvSubmitting(true)
    // 状態リセット前に値をキャプチャ（resetしてから非同期処理すると値が消える）
    const title    = evTitle.trim()
    const date     = evDate.trim()
    const time     = evTime.trim()
    const location = evLocation.trim()
    const desc     = evDesc.trim()
    const type     = evType
    try {
      // チームが teams テーブルに存在することを保証（外部キー制約違反を防ぐ）
      await createTeam(setup.code, setup.teamName, setup.coachName)
      const result = await addTeamEvent(setup.code, title, date, time, location, desc, type, setup.coachName)
      if (!result) throw new Error('イベントデータが取得できませんでした')
      // モーダルを先に閉じてからフォームをリセット
      setShowEventModal(false)
      setEvTitle(''); setEvDate(todayLocalISO()); setEvTime(''); setEvLocation(''); setEvDesc(''); setEvType('practice')
      // 表示を即時更新
      setTeamEvents(prev => [...prev, result].sort((a, b) => a.event_date.localeCompare(b.event_date)))
      Toast.show({ type: 'success', text1: t('team.coachDashboard.eventAddedToast'), visibilityTime: 1800 })
      // バックグラウンドでリロード & 通知（失敗してもUIに影響しない）
      load().catch(() => {})
      sendPush(t('team.coachDashboard.newEventPushTitle', { teamName: setup.teamName }), t('team.coachDashboard.newEventPushBody', { title, date }), 'players', setup.code)
    } catch (e: any) {
      if (__DEV__) console.warn('[addEvent]', e)  // warnにして赤画面を防ぐ
      const msg = e?.message ?? String(e)
      if (msg.includes('does not exist') || msg.includes('未設定')) {
        Alert.alert(t('team.coachDashboard.dbNotSetTitle'), t('team.coachDashboard.dbNotSetMessage'), [{ text: 'OK' }])
      } else if (msg.includes('foreign key') || msg.includes('team_code_fkey')) {
        Toast.show({ type: 'error', text1: t('team.coachDashboard.teamSyncingTitle'), text2: t('team.coachDashboard.teamSyncingMessage'), visibilityTime: 4000 })
      } else if (msg.includes('row-level security') || msg.includes('RLS') || msg.includes('permission')) {
        Toast.show({ type: 'error', text1: t('team.coachDashboard.permissionErrorTitle'), text2: t('team.coachDashboard.permissionErrorMessage'), visibilityTime: 4000 })
      } else if (msg.includes('violates check constraint')) {
        Toast.show({ type: 'error', text1: t('team.coachDashboard.invalidTypeTitle'), text2: msg, visibilityTime: 4000 })
      } else {
        Toast.show({ type: 'error', text1: t('team.coachDashboard.eventAddFailedTitle'), text2: msg, visibilityTime: 4000 })
      }
    } finally {
      setEvSubmitting(false)
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

  // ── メニュー: よく使うフレーズ・下書きの読み込み ────────
  const loadMenuData = useCallback(async () => {
    const [phrasesRaw, draftRaw] = await Promise.all([
      AsyncStorage.getItem(MENU_PHRASES_KEY).catch(() => null),
      AsyncStorage.getItem(MENU_DRAFT_KEY).catch(() => null),
    ])
    if (phrasesRaw) { try { setQuickPhrases(JSON.parse(phrasesRaw)) } catch {} }
    if (draftRaw) {
      try {
        const d: { date: string; text: string } = JSON.parse(draftRaw)
        // 今日の日付の下書きのみ復元（日をまたいだら空欄から始める）
        if (d.date === todayLocalISO()) setPlanText(d.text)
      } catch {}
    }
  }, [])

  useEffect(() => { if (tab === 'menu') loadMenuData() }, [tab, loadMenuData])

  // 入力のたびに今日の下書きとして自動保存（コーチが離脱しても内容が消えないように）
  useEffect(() => {
    if (tab !== 'menu') return
    const t = setTimeout(() => {
      AsyncStorage.setItem(MENU_DRAFT_KEY, JSON.stringify({ date: todayLocalISO(), text: planText })).catch(() => {})
    }, 400)
    return () => clearTimeout(t)
  }, [planText, tab])

  // フレーズをタップしてテキストへ挿入
  function insertPhrase(text: string) {
    setPlanText(prev => prev.trim().length === 0 ? text : `${prev.replace(/\n+$/, '')}\n${text}`)
  }

  function openPhraseForm() {
    setPhraseFormLabel(''); setPhraseFormText('')
    setShowPhraseForm(true)
  }

  async function savePhrase() {
    if (!phraseFormLabel.trim() || !phraseFormText.trim()) return
    const newPhrase: QuickPhrase = {
      id: Date.now().toString(),
      label: phraseFormLabel.trim(),
      text: phraseFormText.trim(),
      createdAt: new Date().toISOString(),
    }
    const next = [...quickPhrases, newPhrase]
    setQuickPhrases(next)
    await AsyncStorage.setItem(MENU_PHRASES_KEY, JSON.stringify(next)).catch(() => {})
    setShowPhraseForm(false)
    Toast.show({ type: 'success', text1: t('team.coachDashboard.phraseSavedToast'), visibilityTime: 1400 })
  }

  async function deletePhrase(id: string) {
    const next = quickPhrases.filter(p => p.id !== id)
    setQuickPhrases(next)
    await AsyncStorage.setItem(MENU_PHRASES_KEY, JSON.stringify(next)).catch(() => {})
  }

  // 今日の練習をチームに共有（そのままアナウンス投稿になる）
  async function shareMenuToTeam() {
    if (!planText.trim()) {
      Toast.show({ type: 'error', text1: t('team.coachDashboard.aiMenuInputRequired'), visibilityTime: 2000 })
      return
    }
    setSharingMenu(true)
    const dateLabel = language === 'ja'
      ? new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })
      : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', weekday: 'short' })
    const message = `📋 ${t('team.coachDashboard.menuAnnouncePushBody', { date: dateLabel })}\n\n${planText.trim()}\n\n#sCORE`
    try {
      await postMessage(setup.code, message, setup.coachName)
      await sendPush(t('team.coachDashboard.menuAnnouncePushTitle', { teamName: setup.teamName }), t('team.coachDashboard.menuAnnouncePushBody', { date: dateLabel }), 'players', setup.code)
      await AsyncStorage.removeItem(MENU_DRAFT_KEY).catch(() => {})
      setPlanText('')
      Toast.show({ type: 'success', text1: t('team.coachDashboard.aiMenuSharedToast'), visibilityTime: 2000 })
      setTab('messages')
    } catch {
      Toast.show({ type: 'error', text1: t('team.coachDashboard.aiMenuShareFailed'), visibilityTime: 2000 })
    } finally {
      setSharingMenu(false)
    }
  }

  // ── AIにメニューを考えてもらう ───────────────────────────
  function toggleAiFocusTag(key: string) {
    setAiFocusTags(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  async function generateAiMenu() {
    setAiGenerating(true)
    try {
      const focusLabels = AI_MENU_FOCUS_TAGS.filter(t => aiFocusTags.has(t.key)).map(t => t.label)
      const _apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 45000)
      const res = await fetch(`${_apiBase}/api/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          system: 'あなたは日本トップレベルの陸上競技コーチです。チームのコーチ向けに、選手に送る今日の練習メニューを箇条書きテキストで作成します。装飾や見出しは不要で、そのままチームのアナウンスに貼り付けられる簡潔な形式にしてください。各行は「種目名 補足（時間や本数など）」の形にし、番号や記号は付けず改行区切りにしてください。',
          messages: [{
            role: 'user',
            content: `今日の練習メニューを考えてください。\n\n狙い: ${focusLabels.length > 0 ? focusLabels.join('・') : '指定なし（コーチの判断で）'}\n強度: ${AI_MENU_INTENSITY_CFG[aiIntensity].label}\n${aiFreeNote.trim() ? `補足: ${aiFreeNote.trim()}` : ''}\n\nウォームアップ→メイン→クールダウンの流れで、5〜8行程度の練習メニューを箇条書きで出力してください。${narrativeLanguageInstruction(language)}`,
          }],
        }),
      })
      clearTimeout(timeoutId)
      if (!res.ok) throw new Error('生成に失敗しました')
      const data = await res.json()
      const text = (data.content?.[0]?.text ?? '').trim()
      if (!text) throw new Error('生成に失敗しました')
      await recordUsage('workout')
      insertPhrase(text)
      setShowAiMenuSheet(false)
      setAiFocusTags(new Set()); setAiFreeNote(''); setAiIntensity('normal')
      Toast.show({ type: 'success', text1: t('team.coachDashboard.aiMenuAddedToast'), visibilityTime: 2000 })
    } catch {
      Toast.show({ type: 'error', text1: t('team.coachDashboard.aiMenuGenerateFailed'), text2: t('team.coachDashboard.tryAgain'), visibilityTime: 2500 })
    } finally {
      setAiGenerating(false)
    }
  }

  async function handlePressAiMenu() {
    const gate = await checkAdGate('workout')
    if (!gate.allowed) {
      if (gate.needsTicket) {
        setMenuTicketGate({ visible: true, cost: gate.ticketCost, balance: gate.ticketBalance })
      } else {
        Toast.show({ type: 'error', text1: t('team.coachDashboard.dailyLimitReached'), visibilityTime: 2500 })
      }
      return
    }
    setShowAiMenuSheet(true)
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
          icon: m.icon || undefined,
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
      const key = localDateStr(d)
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
    // last_session_date がある場合のみデータあり（非公開選手はlast_session_date=''でfalse）
    const hasRiskData = m.sessions.length > 0 || !!pStat?.last_session_date
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
    if (memberFilter === 'danger')          return m.risk.riskScore >= 70
    if (memberFilter === 'pain')            return (m.painParts?.length ?? 0) > 0 && !m.ackedByCoach
    if (memberFilter === 'needsAttention')  return m.risk.riskScore >= 70 || ((m.painParts?.length ?? 0) > 0 && !m.ackedByCoach)
    return true
  })

  const highRiskMembers  = memberData.filter(m => m.risk.riskScore >= 70)
  const submittedCount   = memberData.filter(m => m.condToday !== null).length
  const avgLoad          = memberData.length > 0
    ? memberData.reduce((s, m) => s + m.weeklyLoad, 0) / memberData.length
    : 0
  const unackedPainCount = displayMembers.filter(m => (m.painParts?.length ?? 0) > 0 && !m.ackedByCoach).length
  const newVideos        = videos.filter(v => !v.watched).length
  // 欠席報告: team_messages の [ABSENCE] プレフィックスのもの（未確認 = まだ削除されていない）
  const absenceMessages  = messages.filter(m => m.author_name === '__system__' && m.content.startsWith('[ABSENCE]'))

  return (
    <View style={{flex:1,backgroundColor:'#f6f6f8'}}>
      <SafeAreaView style={{flex:1}}>

        {/* ─ ヘッダー ─ */}
        <View style={co.header}>
          <View>
            <Text style={co.title}>{setup.teamName}</Text>
            <View style={{flexDirection:'row',alignItems:'center',gap:6,marginTop:2}}>
              <View style={{backgroundColor:BRAND+'20',borderRadius:6,paddingHorizontal:7,paddingVertical:2}}>
                <Text style={{color:BRAND,fontSize:11,fontWeight:'700'}}>{t('team.coachDashboard.role')}</Text>
              </View>
              <Text style={{color:'#555',fontSize:11}}>{setup.coachName}</Text>
            </View>
          </View>
          <View style={{flexDirection:'row',gap:8,alignItems:'center'}}>
            <View style={co.codeBox}>
              <Text style={{color:'#555',fontSize:9,fontWeight:'700'}}>{t('team.coachDashboard.code')}</Text>
              <Text style={{color:BRAND,fontSize:15,fontWeight:'900',letterSpacing:3}}>{formatCode(setup.code)}</Text>
            </View>
            <TouchableOpacity onPress={load} style={co.switchBtn} activeOpacity={0.7} hitSlop={{top:4,bottom:4,left:4,right:4}} accessibilityLabel={t('team.coachDashboard.refresh')}>
              <Ionicons name="refresh-outline" size={15} color={TEXT.secondary}/>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowMenu(true)} style={co.switchBtn} activeOpacity={0.7} hitSlop={{top:4,bottom:4,left:4,right:4}} accessibilityLabel={t('team.coachDashboard.menu')}>
              <Ionicons name="ellipsis-horizontal" size={15} color={TEXT.secondary}/>
            </TouchableOpacity>
          </View>
        </View>

        {/* ─ コンテンツエリア（flex:1 で常に残りスペースを確保） ─ */}
        <View style={{flex:1}}>

        {/* ローディング中 */}
        {loading && (
          <View style={{alignItems:'center',paddingVertical:60,gap:12}}>
            <Text style={{fontSize:32}}>⏳</Text>
            <Text style={{color:'#9ca3af',fontSize:14}}>{t('team.coachDashboard.loading')}</Text>
          </View>
        )}

        {/* ─ メンバータブ ─ */}
        {!loading && tab === 'members' && (
        <ScrollView style={{flex:1}} contentContainerStyle={{padding:16,paddingBottom:96,gap:18}} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{gap:14}}>
              {/* セッション未同期バナー（実メンバーのスコアが全員0の場合） */}
              {members.length > 0 && memberData.every(m => m.sessions.length === 0) && (
                <View style={{backgroundColor:'rgba(59,130,246,0.07)',borderLeftWidth:4,borderLeftColor:'#3b82f6',borderRadius:12,borderWidth:1,borderColor:'rgba(59,130,246,0.2)',padding:12,flexDirection:'row',alignItems:'flex-start',gap:10}}>
                  <Text style={{fontSize:16,marginTop:1}}>ℹ️</Text>
                  <View style={{flex:1}}>
                    <Text style={{color:'#3b82f6',fontSize:12,fontWeight:'800',marginBottom:3}}>{t('team.coachDashboard.syncBannerTitle')}</Text>
                    <Text style={{color:'#555',fontSize:11,lineHeight:17}}>{t('team.coachDashboard.syncBannerBody')}</Text>
                  </View>
                </View>
              )}
              {/* ── サマリータイル（要対応・チーム負荷。色は数字だけに乗せる） ── */}
              <View style={{flexDirection:'row', gap:8}}>
                {(() => {
                  const needsAttention = unackedPainCount + highRiskMembers.length
                  const isActive = memberFilter === 'needsAttention'
                  return (
                    <TouchableOpacity
                      onPress={() => setMemberFilter(isActive ? 'all' : 'needsAttention')}
                      disabled={needsAttention === 0}
                      style={{flex:1, backgroundColor:'#fff', borderWidth: isActive ? 1.5 : 1, borderColor: isActive ? '#E53935' : 'rgba(0,0,0,0.07)', borderRadius:16, paddingVertical:12, paddingHorizontal:14, flexDirection:'row', alignItems:'center', gap:10}}
                      activeOpacity={0.75}
                    >
                      <View style={{width:32,height:32,borderRadius:10,backgroundColor:'rgba(229,57,53,0.1)',alignItems:'center',justifyContent:'center'}}>
                        <Text style={{fontSize:15}}>⚠️</Text>
                      </View>
                      <View>
                        <Text style={{fontSize:10.5,color:'#9ca3af',fontWeight:'600'}}>{t('team.coachDashboard.needsAttention')}</Text>
                        <Text style={{fontSize:19,fontWeight:'900',color: needsAttention > 0 ? '#E53935' : '#34C759',lineHeight:21}}>{t('team.coachDashboard.needsAttentionCount', { n: needsAttention })}</Text>
                      </View>
                    </TouchableOpacity>
                  )
                })()}
                <View style={{flex:1, backgroundColor:'#fff', borderWidth:1, borderColor:'rgba(0,0,0,0.07)', borderRadius:16, paddingVertical:12, paddingHorizontal:14, flexDirection:'row', alignItems:'center', gap:10}}>
                  <View style={{width:32,height:32,borderRadius:10,backgroundColor:'rgba(99,102,241,0.1)',alignItems:'center',justifyContent:'center'}}>
                    <Text style={{fontSize:15}}>💪</Text>
                  </View>
                  <View>
                    <Text style={{fontSize:10.5,color:'#9ca3af',fontWeight:'600'}}>{t('team.coachDashboard.teamLoad')}</Text>
                    <Text style={{fontSize:19,fontWeight:'900',color: LOAD_CFG[loadCfgKey(avgLoad)].color,lineHeight:21}}>{LOAD_CFG[loadCfgKey(avgLoad)].label}</Text>
                  </View>
                </View>
              </View>

              {/* ── 欠席報告（個別に確認済みにする必要があるため一覧のまま維持。装飾は最小限に） ── */}
              {absenceMessages.length > 0 && (
                <View style={{backgroundColor:'#fff', borderRadius:16, borderWidth:1, borderColor:'rgba(0,0,0,0.07)', overflow:'hidden'}}>
                  {absenceMessages.map((msg, idx) => {
                    const body = msg.content.replace(/^\[ABSENCE\]\s*/, '')
                    return (
                      <View key={msg.id} style={{flexDirection:'row',alignItems:'flex-start',gap:10,padding:12,borderTopWidth: idx > 0 ? StyleSheet.hairlineWidth : 0,borderTopColor:'rgba(0,0,0,0.07)'}}>
                        <Text style={{fontSize:15,marginTop:1}}>🙏</Text>
                        <View style={{flex:1,gap:3}}>
                          <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
                            <Text style={{color:'#FF9500',fontSize:11,fontWeight:'800'}}>{t('team.coachDashboard.absenceReport')}</Text>
                            <Text style={{color:'#bbb',fontSize:10}}>{timeAgo(msg.created_at, t)}</Text>
                          </View>
                          <Text style={{color:TEXT.primary,fontSize:13,fontWeight:'600',lineHeight:18}}>{body}</Text>
                          <TouchableOpacity
                            onPress={() => deleteMsg(msg.id)}
                            style={{alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:4,marginTop:2}}
                            activeOpacity={0.7}
                          >
                            <Ionicons name="checkmark-circle-outline" size={13} color="#9ca3af"/>
                            <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700'}}>{t('team.coachDashboard.markConfirmed')}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )
                  })}
                </View>
              )}

              {/* フィルター解除 */}
              {memberFilter !== 'all' && (
                <TouchableOpacity onPress={() => setMemberFilter('all')} style={{alignSelf:'flex-end',borderWidth:1,borderColor:'rgba(0,0,0,0.1)',borderRadius:999,paddingHorizontal:12,paddingVertical:5,backgroundColor:'#f0f2f5'}} activeOpacity={0.7}>
                  <Text style={{color:'#666',fontSize:11,fontWeight:'600'}}>{t('team.coachDashboard.showAll', { n: memberData.length })}</Text>
                </TouchableOpacity>
              )}

              {/* メンバーカードリスト */}
              <View style={{gap:6}}>
                {filteredMembers.map((m) => {
                  const rKey      = riskCfgKey(m.risk.riskScore)
                  const rCfg      = RISK_CFG[rKey]
                  const unackedPain = (m.painParts?.length ?? 0) > 0 && !m.ackedByCoach
                  const ackedPain   = (m.painParts?.length ?? 0) > 0 && m.ackedByCoach
                  const hasData   = 'hasRiskData' in m ? (m as typeof m & {hasRiskData:boolean}).hasRiskData : false
                  // 行全体は着色せず、色はアバターを囲むリングとスコアの数字だけに乗せる
                  const ringColor = unackedPain ? '#EF4444' : hasData ? rCfg.color : '#e5e7eb'

                  return (
                    <HapticTouch
                      haptic="tap"
                      key={m.id}
                      style={[co.memberCard, { backgroundColor: '#fff', borderLeftWidth: 0, padding: 10 }]}
                      onPress={() => { setDetailMember(m); setDetailRisk(m.risk) }}
                      activeOpacity={0.88}
                    >
                      <View style={{flexDirection:'row',alignItems:'center',gap:12}}>
                        {hasData
                          ? <RingAvatar name={m.name} size={40} color={ringColor} ringPct={m.risk.riskScore} />
                          : <Avatar name={m.name} size={40} color={avatarColor(m.name)} emoji={m.icon}/>
                        }

                        <View style={{flex:1,gap:1}}>
                          <Text style={{color:TEXT.primary,fontSize:14,fontWeight:'700'}} numberOfLines={1}>{m.name}</Text>
                          <Text style={{color:TEXT.secondary,fontSize:11}} numberOfLines={1}>{m.event || t('team.coachDashboard.noEventSet')}</Text>
                        </View>

                        {/* スコア（数字自体は控えめに。色の意味はリング側が持つ） */}
                        {!hasData ? (
                          <Text style={{color:'#bbb',fontSize:11,fontWeight:'600'}}>{t('team.coachDashboard.notSynced')}</Text>
                        ) : (
                          <Text style={{color:'#6b7280',fontSize:22,fontWeight:'800'}}>{m.risk.riskScore}</Text>
                        )}

                        {/* 痛みバッジ */}
                        {unackedPain && (
                          <View style={{backgroundColor:'#EF4444',borderRadius:5,paddingHorizontal:5,paddingVertical:2}}>
                            <Text style={{color:'#fff',fontSize:9,fontWeight:'800'}}>{t('team.coachDashboard.unconfirmed')}</Text>
                          </View>
                        )}
                        {ackedPain && <Ionicons name="checkmark-circle" size={13} color="#34C759"/>}

                        {/* 削除ボタン */}
                        <TouchableOpacity
                          onPress={e => { e.stopPropagation?.(); removeMember(m.id, m.name, m.id.startsWith('demo-')) }}
                          hitSlop={{top:12,bottom:12,left:12,right:12}}
                          style={{padding:4}}
                          accessibilityLabel={t('team.coachDashboard.removeMember')}
                        >
                          <Ionicons name="trash-outline" size={14} color="#d1d5db"/>
                        </TouchableOpacity>
                      </View>
                    </HapticTouch>
                  )
                })}
                {filteredMembers.length === 0 && (
                  <View style={{alignItems:'center',paddingVertical:40,gap:8}}>
                    <Ionicons name="people-outline" size={36} color="#d1d5db"/>
                    <Text style={{color:'#9ca3af',fontSize:14}}>{t('team.coachDashboard.noMatchingMembers')}</Text>
                  </View>
                )}
              </View>
            </View>
        </ScrollView>
        )}

        {/* ─ アナウンスタブ ─ */}
        {!loading && tab === 'messages' && (
        <ScrollView style={{flex:1}} contentContainerStyle={{padding:16,paddingBottom:96,gap:18}} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <>
              <View style={co.composeBox}>
                <TextInput
                  style={co.composeInput}
                  value={msgText}
                  onChangeText={setMsgText}
                  placeholder={t('team.coachDashboard.messagePlaceholder')}
                  placeholderTextColor="#9ca3af"
                  multiline
                  maxLength={300}
                />
                <HapticTouch haptic="save" style={[co.sendBtn,(!msgText.trim()||msgSending)&&{opacity:0.4}]} onPress={sendMessage} disabled={!msgText.trim()||msgSending} activeOpacity={0.8} accessibilityLabel={t('team.coachDashboard.send')}>
                  {msgSending
                    ? <ActivityIndicator size="small" color="#fff"/>
                    : <Ionicons name="send" size={18} color="#fff"/>
                  }
                </HapticTouch>
              </View>

              {messages.length === 0 ? (
                <View style={{alignItems:'center',padding:32,gap:8}}>
                  <Ionicons name="megaphone-outline" size={36} color="#333"/>
                  <Text style={{color:'#555',fontSize:13}}>{t('team.coachDashboard.noMessages')}</Text>
                </View>
              ) : (
                <View style={{gap:8}}>
                  {messages.map(msg => {
                    const isSystem = msg.author_name === '__system__'
                    const sysType = isSystem
                      ? msg.content.startsWith('[ABSENCE]') ? 'absence'
                      : msg.content.startsWith('[VIDEO]')   ? 'video'
                      : msg.content.startsWith('[RISK')     ? 'risk'
                      : 'system'
                      : null
                    const sysBody = isSystem ? msg.content.replace(/^\[[A-Z_]+\]\s*/, '') : msg.content
                    const sysIcon = sysType === 'absence' ? '🙏' : sysType === 'video' ? '🎥' : sysType === 'risk' ? '⚠️' : '📢'
                    const sysColor = sysType === 'absence' ? '#FF9500' : sysType === 'video' ? BRAND : sysType === 'risk' ? '#E53935' : '#6b7280'
                    const sysLabel = sysType === 'absence' ? t('team.coachDashboard.systemAbsence') : sysType === 'video' ? t('team.coachDashboard.systemVideo') : sysType === 'risk' ? t('team.coachDashboard.systemRisk') : t('team.coachDashboard.systemNotice')
                    return isSystem ? (
                      <View key={msg.id} style={{flexDirection:'row',alignItems:'flex-start',gap:10,backgroundColor:sysColor+'10',borderRadius:12,borderWidth:1,borderColor:sysColor+'30',padding:12}}>
                        <View style={{width:32,height:32,borderRadius:10,backgroundColor:sysColor+'20',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>
                          <Text style={{fontSize:16}}>{sysIcon}</Text>
                        </View>
                        <View style={{flex:1,gap:2}}>
                          <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                            <Text style={{color:sysColor,fontSize:11,fontWeight:'800'}}>{sysLabel}</Text>
                            <Text style={{color:'#999',fontSize:11}}>{timeAgo(msg.created_at, t)}</Text>
                            <TouchableOpacity onPress={() => deleteMsg(msg.id)} hitSlop={{top:8,bottom:8,left:8,right:8}} style={{marginLeft:'auto'}} accessibilityLabel={t('team.coachDashboard.delete')}>
                              <Ionicons name="close-outline" size={14} color="#ccc"/>
                            </TouchableOpacity>
                          </View>
                          <Text style={{color:TEXT.primary,fontSize:13,lineHeight:20}}>{sysBody}</Text>
                        </View>
                      </View>
                    ) : (
                      <View key={msg.id} style={[co.msgCard, msg.is_pinned&&{borderColor:'#FF9500'+'50',backgroundColor:'rgba(255,149,0,0.06)'}]}>
                        <View style={{flexDirection:'row',alignItems:'center',gap:6,marginBottom:6}}>
                          {msg.is_pinned && <Ionicons name="pin" size={12} color="#FF9500"/>}
                          <Text style={{color:BRAND,fontSize:12,fontWeight:'700',flex:1}}>{msg.author_name}</Text>
                          <Text style={{color:'#555',fontSize:11}}>{timeAgo(msg.created_at, t)}</Text>
                          <TouchableOpacity onPress={() => togglePin(msg.id, msg.is_pinned)} hitSlop={{top:8,bottom:8,left:8,right:8}} accessibilityLabel={msg.is_pinned ? t('team.coachDashboard.unpin') : t('team.coachDashboard.pin')}>
                            <Ionicons name={msg.is_pinned?'pin':'pin-outline'} size={14} color={msg.is_pinned?'#FF9500':'#444'}/>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => deleteMsg(msg.id)} hitSlop={{top:8,bottom:8,left:8,right:8}} accessibilityLabel={t('team.coachDashboard.delete')}>
                            <Ionicons name="trash-outline" size={14} color="#FF3B30"/>
                          </TouchableOpacity>
                        </View>
                        <Text style={{color:TEXT.primary,fontSize:14,lineHeight:22}}>{msg.content}</Text>
                      </View>
                    )
                  })}
                </View>
              )}
          </>
        </ScrollView>
        )}

        {/* ─ 動画タブ ─ */}
        {!loading && tab === 'videos' && (
        <ScrollView style={{flex:1}} contentContainerStyle={{padding:16,paddingBottom:96,gap:18}} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <>
              {videos.length === 0 ? (
                <View style={{alignItems:'center',padding:32,gap:8}}>
                  <Ionicons name="videocam-outline" size={36} color="#333"/>
                  <Text style={{color:'#555',fontSize:13}}>{t('team.coachDashboard.noVideosYet')}</Text>
                  <Text style={{color:'#444',fontSize:11,textAlign:'center'}}>{t('team.coachDashboard.noVideosHint')}</Text>
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
                            <Text style={{color:'#555',fontSize:11}}>{timeAgo(v.posted_at, t)}</Text>
                            <Text style={{color:'#444',fontSize:11}}>{t('team.coachDashboard.videoDaysLeft', { n: daysLeft(v.posted_at) })}</Text>
                          </View>
                        </View>
                      </View>
                      {v.url ? (
                        <TouchableOpacity
                          style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,backgroundColor:BRAND+'18',borderRadius:10,paddingVertical:10,marginTop:10,borderWidth:1,borderColor:BRAND+'30'}}
                          onPress={() => { markWatched(v.id); Linking.openURL(v.url) }}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="open-outline" size={15} color={BRAND}/>
                          <Text style={{color:BRAND,fontSize:13,fontWeight:'700'}}>{t('team.coachDashboard.watchVideo')}</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,backgroundColor:'rgba(0,0,0,0.04)',borderRadius:10,paddingVertical:10,marginTop:10,borderWidth:1,borderColor:'rgba(0,0,0,0.08)'}}
                          onPress={() => markWatched(v.id)}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="checkmark-circle-outline" size={15} color={TEXT.secondary}/>
                          <Text style={{color:TEXT.secondary,fontSize:13,fontWeight:'600'}}>{t('team.coachDashboard.markConfirmed')}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}
              <Text style={{color:'#333',fontSize:11,textAlign:'center'}}>{t('team.coachDashboard.videoAutoDeleteNote')}</Text>
          </>
        </ScrollView>
        )}

        {/* ─ カレンダータブ ─ */}
        {!loading && tab === 'calendar' && (
        <ScrollView style={{flex:1}} contentContainerStyle={{padding:16,paddingBottom:96,gap:18}} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{gap:10}}>
              {teamEvents.length === 0 ? (
                <View style={{alignItems:'center',padding:20,gap:8}}>
                  <Text style={{fontSize:32}}>📅</Text>
                  <Text style={{color:'#9ca3af',fontSize:14}}>{t('team.coachDashboard.noEventsYet')}</Text>
                  <Text style={{color:'#c4c4c4',fontSize:12}}>{t('team.coachDashboard.addEventHint')}</Text>
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
                              {past && <View style={{backgroundColor:'#6b7280'+'20',borderRadius:6,paddingHorizontal:6,paddingVertical:2}}><Text style={{color:'#6b7280',fontSize:10,fontWeight:'700'}}>{t('team.coachDashboard.ended')}</Text></View>}
                            </View>
                            <Text style={{color:TEXT.primary,fontSize:15,fontWeight:'800'}}>{ev.title}</Text>
                            <View style={{flexDirection:'row',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                              <View style={{flexDirection:'row',alignItems:'center',gap:4}}>
                                <Ionicons name="calendar-outline" size={12} color="#6b7280"/>
                                <Text style={{color:'#6b7280',fontSize:12,fontWeight:'700'}}>{fmtEventDate(ev.event_date, t, DAY_NAMES)}</Text>
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
                          <TouchableOpacity onPress={() => removeEvent(ev.id)} hitSlop={{top:10,bottom:10,left:10,right:10}} accessibilityLabel={t('team.coachDashboard.deleteEvent')}>
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
        <ScrollView style={{flex:1}} contentContainerStyle={{padding:16,paddingBottom:96,gap:16}} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* ── 今日の練習を書く ── */}
              <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
                <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.coachDashboard.writeMenuLabel')}</Text>
                <TouchableOpacity
                  onPress={handlePressAiMenu}
                  activeOpacity={0.8}
                  style={{flexDirection:'row',alignItems:'center',gap:4,backgroundColor:'rgba(99,102,241,0.1)',borderRadius:14,paddingHorizontal:10,paddingVertical:5}}
                >
                  <Text style={{fontSize:12}}>🤖</Text>
                  <Text style={{color:'#6366f1',fontSize:11,fontWeight:'800'}}>{t('team.coachDashboard.aiMenuButton')}</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={{backgroundColor:'#fff',borderRadius:16,borderWidth:1.5,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:14,lineHeight:22,paddingHorizontal:14,paddingVertical:14,minHeight:150,textAlignVertical:'top',...(Platform.OS==='web'?{outlineStyle:'none'}as any:{})}}
                value={planText}
                onChangeText={setPlanText}
                placeholder={t('team.coachDashboard.menuPlaceholder')}
                placeholderTextColor="#c1c5cc"
                multiline
              />

              {/* ── よく使うフレーズ ── */}
              <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.coachDashboard.quickPhrasesLabel')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>
                {quickPhrases.map(p => (
                  <HapticTouch
                    haptic="tap"
                    key={p.id}
                    style={{backgroundColor:'#f5f6f8',borderWidth:1,borderColor:'rgba(0,0,0,0.07)',borderRadius:16,paddingHorizontal:14,paddingVertical:9}}
                    onPress={() => insertPhrase(p.text)}
                    onLongPress={() => deletePhrase(p.id)}
                    delayLongPress={500}
                    activeOpacity={0.8}
                  >
                    <Text style={{color:'#444',fontSize:12.5,fontWeight:'700'}}>{p.label}</Text>
                  </HapticTouch>
                ))}
                <TouchableOpacity
                  style={{backgroundColor:'#fff',borderWidth:1,borderStyle:'dashed',borderColor:'rgba(0,0,0,0.15)',borderRadius:16,paddingHorizontal:14,paddingVertical:9}}
                  onPress={openPhraseForm}
                  activeOpacity={0.8}
                >
                  <Text style={{color:'#9ca3af',fontSize:12.5,fontWeight:'700'}}>{t('team.coachDashboard.addPhrase')}</Text>
                </TouchableOpacity>
              </ScrollView>
              {quickPhrases.length === 0 && (
                <Text style={{color:'#c1c5cc',fontSize:11,marginTop:-4}}>{t('team.coachDashboard.quickPhrasesHint')}</Text>
              )}

              {/* ── 共有ボタン ── */}
              <TouchableOpacity
                style={[{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:15,marginTop:4},(planText.trim().length===0||sharingMenu)&&{opacity:0.45}]}
                onPress={shareMenuToTeam}
                disabled={planText.trim().length===0||sharingMenu}
                activeOpacity={0.85}
              >
                {sharingMenu
                  ? <ActivityIndicator size="small" color="#fff"/>
                  : <><Ionicons name="share-outline" size={18} color="#fff"/><Text style={{color:'#fff',fontSize:15,fontWeight:'900'}}>{t('team.coachDashboard.shareToTeam')}</Text></>
                }
              </TouchableOpacity>
              <Text style={{color:'#c1c5cc',fontSize:11,textAlign:'center',marginTop:-6}}>{t('team.coachDashboard.shareToTeamNote')}</Text>

        </ScrollView>
        )}

        </View>{/* flex:1 コンテンツエリア終了 */}

        {/* 予定追加ボタン（カレンダータブ時のみ下固定表示。浮きピルの分だけ上にずらす） */}
        {!loading && tab === 'calendar' && (
          <View style={{paddingHorizontal:16,paddingBottom:78,paddingTop:8,backgroundColor:'#f6f6f8',borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'rgba(0,0,0,0.08)'}}>
            <HapticTouch
              haptic="whoosh"
              style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:14}}
              onPress={() => setShowEventModal(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="add-circle-outline" size={20} color="#fff"/>
              <Text style={{color:'#fff',fontSize:15,fontWeight:'800'}}>{t('team.coachDashboard.addEventFab')}</Text>
            </HapticTouch>
          </View>
        )}

        {/* ─ タブ切り替え（浮きピル。画面下部・親指の届く位置に固定） ─ */}
        <View style={{position:'absolute', left:16, right:16, bottom:14, pointerEvents:'box-none'}}>
          <View style={{flexDirection:'row', gap:2, backgroundColor:'#fff', borderRadius:24, padding:5, shadowColor:'#000', shadowOffset:{width:0,height:6}, shadowOpacity:0.14, shadowRadius:20, elevation:8}}>
            {([
              { key:'members',  label:t('team.coachDashboard.tabMembers'),  badge: unackedPainCount + highRiskMembers.length + absenceMessages.length },
              { key:'menu',     label:t('team.coachDashboard.tabMenu'),     badge: 0 },
              { key:'messages', label:t('team.coachDashboard.tabMessages'), badge: 0 },
              { key:'videos',   label:t('team.coachDashboard.tabVideos'),   badge: newVideos },
              { key:'calendar', label:t('team.coachDashboard.tabCalendar'), badge: 0 },
            ] as const).map(tabItem => (
              <HapticTouch
                haptic="tabSwitch"
                key={tabItem.key}
                style={{flex:1, alignItems:'center', justifyContent:'center', paddingVertical:9, borderRadius:19, backgroundColor: tab===tabItem.key ? BRAND : 'transparent'}}
                onPress={() => setTab(tabItem.key)}
                activeOpacity={0.75}
              >
                <Text style={{fontSize:11.5, fontWeight:'700', color: tab===tabItem.key ? '#fff' : '#8a8f98'}} numberOfLines={1}>{tabItem.label}</Text>
                {tabItem.badge > 0 && (
                  <View style={{position:'absolute', top:2, right:6, minWidth:15, height:15, borderRadius:8, backgroundColor:'#ef4444', alignItems:'center', justifyContent:'center', paddingHorizontal:3}}>
                    <Text style={{color:'#fff', fontSize:8.5, fontWeight:'800'}}>{tabItem.badge}</Text>
                  </View>
                )}
              </HapticTouch>
            ))}
          </View>
        </View>

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
                  <Text style={{color:'#111827',fontSize:18,fontWeight:'800',flex:1}}>{t('team.coachDashboard.addEventModalTitle')}</Text>
                  <TouchableOpacity onPress={() => setShowEventModal(false)} hitSlop={{top:10,bottom:10,left:10,right:10}} accessibilityLabel={t('team.videoSubmit.close')}>
                    <Ionicons name="close" size={22} color={TEXT.secondary}/>
                  </TouchableOpacity>
                </View>
              </View>
              {/* スクロール可能なフォーム */}
              <ScrollView contentContainerStyle={{paddingHorizontal:22,paddingBottom:48,gap:14}} showsVerticalScrollIndicator={true} keyboardShouldPersistTaps="handled">

              {/* タイトル */}
              <View style={{gap:6}}>
                <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.coachDashboard.eventTitleLabel')}</Text>
                <TextInput style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:15,paddingHorizontal:14,paddingVertical:12}}
                  value={evTitle} onChangeText={setEvTitle} placeholder={t('team.coachDashboard.eventTitlePlaceholder')} placeholderTextColor="#9ca3af" maxLength={40}/>
              </View>

              {/* 種別 */}
              <View style={{gap:6}}>
                <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.coachDashboard.eventTypeLabel')}</Text>
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
                  <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.coachDashboard.eventDateLabel')}</Text>
                  {!!evDate && <Text style={{color:BRAND,fontSize:12,fontWeight:'700'}}>✓ {fmtEventDate(evDate, t, DAY_NAMES)}</Text>}
                </View>
                <MiniCalendar value={evDate} onChange={setEvDate}/>
              </View>
              {/* 時間 */}
              <View style={{gap:6}}>
                <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.coachDashboard.eventTimeLabel')}</Text>
                <TextInput style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:14,paddingHorizontal:14,paddingVertical:12}}
                  value={evTime} onChangeText={setEvTime} placeholder={t('team.coachDashboard.eventTimePlaceholder')} placeholderTextColor="#9ca3af" maxLength={5}/>
              </View>

              {/* 場所 */}
              <View style={{gap:6}}>
                <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.coachDashboard.eventLocationLabel')}</Text>
                <TextInput style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:14,paddingHorizontal:14,paddingVertical:11}}
                  value={evLocation} onChangeText={setEvLocation} placeholder={t('team.coachDashboard.eventLocationPlaceholder')} placeholderTextColor="#9ca3af" maxLength={40}/>
              </View>

              {/* メモ */}
              <View style={{gap:6}}>
                <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.coachDashboard.eventMemoLabel')}</Text>
                <TextInput style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:13,paddingHorizontal:14,paddingVertical:10,minHeight:56,textAlignVertical:'top'}}
                  value={evDesc} onChangeText={setEvDesc} placeholder={t('team.coachDashboard.eventMemoPlaceholder')} placeholderTextColor="#9ca3af" multiline maxLength={120}/>
              </View>

              <HapticTouch
                haptic="save"
                style={[{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:15},(!evTitle.trim()||evSubmitting)&&{opacity:0.4}]}
                onPress={addEvent} disabled={!evTitle.trim()||evSubmitting} activeOpacity={0.85}
              >
                {evSubmitting
                  ? <ActivityIndicator size="small" color="#fff"/>
                  : <Ionicons name="checkmark-circle" size={20} color="#fff"/>}
                <Text style={{color:'#fff',fontSize:16,fontWeight:'800'}}>{evSubmitting ? t('team.coachDashboard.adding') : t('team.coachDashboard.add')}</Text>
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
        title={t('team.coachDashboard.removeMemberConfirmTitle')}
        message={t('team.coachDashboard.removeMemberConfirmMessage', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('team.menuSheet.deleteConfirmLabel')}
        dangerous
        onConfirm={execDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {/* ── よく使うフレーズ 保存モーダル ── */}
      <Modal visible={showPhraseForm} transparent animationType="slide" onRequestClose={() => setShowPhraseForm(false)}>
        <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
          <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.6)',justifyContent:'flex-end'}}>
            <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowPhraseForm(false)} activeOpacity={1}/>
            <View style={{backgroundColor:'#fff',borderTopLeftRadius:28,borderTopRightRadius:28,paddingTop:12,paddingHorizontal:20,paddingBottom:44,gap:16}}>
              <View style={{width:40,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.1)',alignSelf:'center',marginBottom:4}}/>
              <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
                <Text style={{color:'#111827',fontSize:18,fontWeight:'800'}}>{t('team.coachDashboard.savePhraseTitle')}</Text>
                <TouchableOpacity onPress={() => setShowPhraseForm(false)} style={{width:32,height:32,borderRadius:16,backgroundColor:'#f0f2f5',alignItems:'center',justifyContent:'center'}} activeOpacity={0.7} hitSlop={{top:8,bottom:8,left:8,right:8}} accessibilityLabel={t('team.videoSubmit.close')}>
                  <Ionicons name="close" size={16} color="#6b7280"/>
                </TouchableOpacity>
              </View>
              <View style={{gap:8}}>
                <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.coachDashboard.phraseNameLabel')}</Text>
                <TextInput
                  style={{backgroundColor:'#f8f8fa',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:16,paddingHorizontal:16,paddingVertical:13,...(Platform.OS==='web'?{outlineStyle:'none'}as any:{})}}
                  value={phraseFormLabel} onChangeText={setPhraseFormLabel}
                  placeholder={t('team.coachDashboard.phraseNamePlaceholder')} placeholderTextColor="#9ca3af"
                  maxLength={20} autoFocus
                />
              </View>
              <View style={{gap:8}}>
                <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.coachDashboard.phraseTextLabel')}</Text>
                <TextInput
                  style={{backgroundColor:'#f8f8fa',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:15,paddingHorizontal:16,paddingVertical:13,minHeight:70,...(Platform.OS==='web'?{outlineStyle:'none'}as any:{})}}
                  value={phraseFormText} onChangeText={setPhraseFormText}
                  placeholder={t('team.coachDashboard.phraseTextPlaceholder')} placeholderTextColor="#9ca3af"
                  multiline maxLength={120}
                />
              </View>
              <TouchableOpacity
                style={[{backgroundColor:BRAND,borderRadius:14,paddingVertical:15,alignItems:'center'},(!phraseFormLabel.trim()||!phraseFormText.trim())&&{opacity:0.45}]}
                onPress={savePhrase} disabled={!phraseFormLabel.trim()||!phraseFormText.trim()} activeOpacity={0.85}
              >
                <Text style={{color:'#fff',fontSize:15,fontWeight:'800'}}>{t('team.coachDashboard.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── 🤖 AIにメニューを考えてもらうシート ── */}
      <Modal visible={showAiMenuSheet} transparent animationType="slide" onRequestClose={() => setShowAiMenuSheet(false)}>
        <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
          <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.6)',justifyContent:'flex-end'}}>
            <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => !aiGenerating && setShowAiMenuSheet(false)} activeOpacity={1}/>
            <View style={{backgroundColor:'#fff',borderTopLeftRadius:28,borderTopRightRadius:28,paddingTop:12,paddingHorizontal:20,paddingBottom:44,gap:16}}>
              <View style={{width:40,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.1)',alignSelf:'center',marginBottom:4}}/>
              <View>
                <Text style={{color:'#111827',fontSize:17,fontWeight:'800'}}>{t('team.coachDashboard.aiMenuSheetTitle')}</Text>
                <Text style={{color:'#6b7280',fontSize:12,marginTop:3}}>{t('team.coachDashboard.aiMenuSheetSubtitle')}</Text>
              </View>

              <View style={{gap:8}}>
                <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.coachDashboard.aiMenuFocusLabel')}</Text>
                <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
                  {AI_MENU_FOCUS_TAGS.map(tag => {
                    const active = aiFocusTags.has(tag.key)
                    return (
                      <TouchableOpacity key={tag.key}
                        style={{flexDirection:'row',alignItems:'center',gap:4,paddingHorizontal:12,paddingVertical:7,borderRadius:20,borderWidth:1.5,borderColor:active?BRAND:'rgba(0,0,0,0.12)',backgroundColor:active?BRAND:'transparent'}}
                        onPress={() => toggleAiFocusTag(tag.key)} activeOpacity={0.75}
                      >
                        <Text style={{fontSize:13}}>{tag.emoji}</Text>
                        <Text style={{color:active?'#fff':'#6b7280',fontSize:12,fontWeight:'700'}}>{tag.label}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </View>

              <View style={{gap:8}}>
                <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.coachDashboard.aiMenuIntensityLabel')}</Text>
                <View style={{flexDirection:'row',gap:8}}>
                  {(Object.keys(AI_MENU_INTENSITY_CFG) as AiMenuIntensityKey[]).map(key => {
                    const active = aiIntensity === key
                    return (
                      <TouchableOpacity key={key}
                        style={{flex:1,paddingVertical:10,borderRadius:12,borderWidth:1.5,alignItems:'center',borderColor:active?BRAND:'rgba(0,0,0,0.12)',backgroundColor:active?BRAND:'transparent'}}
                        onPress={() => setAiIntensity(key)} activeOpacity={0.75}
                      >
                        <Text style={{color:active?'#fff':'#6b7280',fontSize:13,fontWeight:'800'}}>{AI_MENU_INTENSITY_CFG[key].label}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </View>

              <View style={{gap:8}}>
                <Text style={{color:'#9ca3af',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.coachDashboard.aiMenuFreeNoteLabel')}</Text>
                <TextInput
                  style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:13,paddingHorizontal:14,paddingVertical:11,minHeight:50,...(Platform.OS==='web'?{outlineStyle:'none'}as any:{})}}
                  value={aiFreeNote} onChangeText={setAiFreeNote}
                  placeholder={t('team.coachDashboard.aiMenuFreeNotePlaceholder')}
                  placeholderTextColor="#9ca3af"
                  multiline maxLength={150}
                />
              </View>

              <TouchableOpacity
                style={[{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'#6366f1',borderRadius:14,paddingVertical:15,marginTop:4},aiGenerating&&{opacity:0.6}]}
                onPress={generateAiMenu} disabled={aiGenerating} activeOpacity={0.85}
              >
                {aiGenerating ? <ActivityIndicator size="small" color="#fff"/> : (
                  <>
                    <Text style={{fontSize:15}}>🎫</Text>
                    <Text style={{color:'#fff',fontSize:15,fontWeight:'800'}}>{t('team.coachDashboard.aiMenuGenerateButton', { cost: TICKET_COST.workout })}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── チケット不足時のゲート ── */}
      <TicketGateModal
        visible={menuTicketGate.visible}
        feature="workout"
        ticketCost={menuTicketGate.cost}
        ticketBalance={menuTicketGate.balance}
        onClose={() => setMenuTicketGate(g => ({ ...g, visible: false }))}
      />

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
  const { t } = useTranslation()
  const { language } = useLanguage()
  const RISK_CFG = buildRiskCfg(t)
  const LOAD_CFG = buildLoadCfg(t)
  // リスト画面と同じ計算式で算出済みのリスクを優先使用
  const risk        = preCalcRisk ?? calcInjuryRisk(member.sessions, [], member.sessions[0]?.condition_level ?? 6)
  const fat         = fatigueInfo(member.sessions[0]?.fatigue_level ?? 6, t)
  const rCfg        = RISK_CFG[riskCfgKey(risk.riskScore)]
  const lCfg        = LOAD_CFG[loadCfgKey(calcWeeklyLoad(member.sessions))]
  const hasUnacked  = (member.painParts?.length ?? 0) > 0 && !member.ackedByCoach
  const hasAcked    = (member.painParts?.length ?? 0) > 0 && member.ackedByCoach
  const lvInfo      = calcLevelInfo(member.sessions.length, language)
  const lvTier      = RANK_TIERS.find(t => lvInfo.level >= t.min && lvInfo.level < t.max) ?? RANK_TIERS[0]

  return (
    <View style={[StyleSheet.absoluteFill,{backgroundColor:'rgba(0,0,0,0.85)',justifyContent:'flex-end'}]}>
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose}/>
      <View style={{backgroundColor:'#ffffff',borderTopLeftRadius:24,borderTopRightRadius:24,paddingBottom:44,borderTopWidth:1,borderColor:'rgba(0,0,0,0.08)',overflow:'hidden',maxHeight:SCREEN_H*0.88}}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
            <TouchableOpacity onPress={onClose} hitSlop={{top:10,bottom:10,left:10,right:10}} accessibilityLabel={t('team.memberDetail.close')}>
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
                  {hasUnacked ? t('team.memberDetail.painUnacked') : t('team.memberDetail.painAcked')}
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
                  <Text style={{color:'#fff',fontSize:14,fontWeight:'800'}}>{t('team.memberDetail.markConfirmed')}</Text>
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
                  <Text style={{color:'#555',fontSize:10}}>{t('team.memberDetail.injuryRisk')}</Text>
                </View>
                {/* 疲労 */}
                <View style={{flex:1,alignItems:'center',backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',paddingVertical:14,gap:3}}>
                  <Text style={{fontSize:28}}>{fat.emoji}</Text>
                  <Text style={{color:fat.color,fontSize:11,fontWeight:'700'}}>{fat.label}</Text>
                  <Text style={{color:'#555',fontSize:10}}>{t('team.memberDetail.fatigueLevel')}</Text>
                </View>
                {/* 今週距離 */}
                <View style={{flex:1,alignItems:'center',backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',paddingVertical:14,gap:3}}>
                  <Text style={{color:'#111827',fontSize:22,fontWeight:'800'}}>{risk.weeklyKm}<Text style={{fontSize:10,color:'#888'}}>km</Text></Text>
                  <Text style={{color:'#888',fontSize:10}}>{t('team.memberDetail.lastWeek', { km: risk.prevWeeklyKm })}</Text>
                  <Text style={{color:'#555',fontSize:10}}>{t('team.memberDetail.weeklyDistance')}</Text>
                </View>
              </View>

              {/* 負荷 */}
              <View style={{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:'#f0f2f5',borderRadius:10,padding:10,marginBottom:10}}>
                <View style={{width:8,height:8,borderRadius:4,backgroundColor:lCfg.color}}/>
                <Text style={{color:'#555',fontSize:12}}>{t('team.memberDetail.weeklyLoad')} <Text style={{color:lCfg.color,fontWeight:'700'}}>{lCfg.label}</Text></Text>
                <View style={{flex:1,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.07)',overflow:'hidden',marginLeft:4}}>
                  <View style={{width:`${Math.min(100,risk.riskScore)}%`,height:'100%',backgroundColor:rCfg.color,borderRadius:2}}/>
                </View>
              </View>

              {risk.reasons.length > 0 && (
                <View style={{backgroundColor:'rgba(255,149,0,0.08)',borderRadius:12,borderWidth:1,borderColor:'rgba(239,68,68,0.25)',padding:12,marginBottom:10}}>
                  <Text style={{color:'#92400e',fontSize:12,fontWeight:'700',marginBottom:6}}>{t('team.memberDetail.attentionPoints')}</Text>
                  {risk.reasons.map((r,i) => <Text key={i} style={{color:TEXT.secondary,fontSize:12,lineHeight:19}}>• {r}</Text>)}
                </View>
              )}
            </>
          ) : (
            <View style={{backgroundColor:'#f8f8fa',borderRadius:12,padding:14,marginBottom:10,alignItems:'center',gap:6}}>
              <Ionicons name="fitness-outline" size={24} color="#9ca3af"/>
              <Text style={{color:'#555',fontSize:12}}>{t('team.memberDetail.notSyncedTitle')}</Text>
              <Text style={{color:'#9ca3af',fontSize:11}}>{t('team.memberDetail.notSyncedHint')}</Text>
            </View>
          )}

          <Text style={{color:'#aaa',fontSize:11,textAlign:'center',marginTop:4}}>
            {t('team.memberDetail.joinedDate', { date: daysSince(member.lastActive, t) })}
          </Text>
        </View>
        </ScrollView>
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
  const { t } = useTranslation()
  const { language } = useLanguage()
  const lvInfo = calcLevelInfo(stats?.level ?? 1, language)
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
          {event ? <Text style={{color:TEXT.secondary,fontSize:14}}>{getEventLabel(event, language)}</Text> : null}
        </View>

        {/* ─ ランク・PBカード ─ */}
        <View style={{flexDirection:'row',gap:12,marginBottom:20}}>
          {/* ランク */}
          <View style={{flex:1,alignItems:'center',backgroundColor:lvTier.color+'12',borderRadius:16,borderWidth:1.5,borderColor:lvTier.color+'40',paddingVertical:20,gap:6}}>
            <Text style={{fontSize:32}}>{lvTier.emoji}</Text>
            <Text style={{color:lvTier.color,fontSize:24,fontWeight:'900'}}>Lv.{lvInfo.level}</Text>
            <Text style={{color:lvTier.color,fontSize:12,fontWeight:'700'}}>{getTierTitle(lvTier.title, language)}</Text>
            <Text style={{color:'#888',fontSize:10}}>{t('team.teammateProfile.level')}</Text>
          </View>
          {/* 自己ベスト */}
          <View style={{flex:1,alignItems:'center',backgroundColor:'rgba(255,149,0,0.08)',borderRadius:16,borderWidth:1.5,borderColor:'rgba(239,68,68,0.25)',paddingVertical:20,gap:6}}>
            <Ionicons name="trophy" size={28} color="#FF9500"/>
            {pb ? (
              <>
                <Text style={{color:'#FF9500',fontSize:22,fontWeight:'900'}}>{pb}</Text>
                <Text style={{color:'#888',fontSize:10}}>{t('team.teammateProfile.personalBest')}</Text>
              </>
            ) : (
              <>
                <Text style={{color:'#ccc',fontSize:16,fontWeight:'700'}}>{t('team.teammateProfile.notEntered')}</Text>
                <Text style={{color:'#aaa',fontSize:10}}>{t('team.teammateProfile.personalBest')}</Text>
              </>
            )}
          </View>
        </View>

        {/* ストリーク */}
        {streak > 0 && (
          <PulseView active={streak >= 7} color="#FF6B35" style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'rgba(255,107,53,0.08)',borderRadius:14,borderWidth:1.5,borderColor:'rgba(255,107,53,0.25)',paddingVertical:14,marginBottom:16}}>
            <Text style={{fontSize:28}}>🔥</Text>
            <View style={{gap:2}}>
              <Text style={{color:'#FF6B35',fontSize:26,fontWeight:'900'}}>{t('team.teammateProfile.streakDays', { n: streak })}</Text>
              <Text style={{color:'#888',fontSize:11,textAlign:'center'}}>{t('team.teammateProfile.streakSub')}</Text>
            </View>
          </PulseView>
        )}
        {/* 目標 */}
        {goal ? (
          <View style={{backgroundColor:'rgba(0,122,255,0.06)',borderRadius:12,borderWidth:1,borderColor:'rgba(0,122,255,0.15)',padding:14,marginBottom:16}}>
            <Text style={{color:'#007AFF',fontSize:11,fontWeight:'700',marginBottom:4}}>{t('team.teammateProfile.goal')}</Text>
            <Text style={{color:TEXT.primary,fontSize:15,fontWeight:'600'}}>{goal}</Text>
          </View>
        ) : null}

        <Text style={{color:'#aaa',fontSize:11,textAlign:'center'}}>
          {t('team.teammateProfile.joinedDate', { date: daysSince(member.joined_at, t) })}
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
  const { t } = useTranslation()
  const { language } = useLanguage()
  const DAY_NAMES = t('home.dayNames', { returnObjects: true }) as unknown as string[]
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
  const [playerIcon,        setPlayerIcon]        = useState('')
  const [showIconPicker,    setShowIconPicker]    = useState(false)
  const [shareLevel,        setShareLevel]        = useState<ShareLevel>(2)
  const [showShareLevel,    setShowShareLevel]    = useState(false)
  // ── 欠席報告 ────────────────────────────────────────────
  const [absenceNote,       setAbsenceNote]       = useState('')
  const [absenceSaving,     setAbsenceSaving]     = useState(false)
  const { addSession: addAbsenceSession } = useTrainingSessions()

  const plMountedRef = useRef(true)
  useEffect(() => {
    plMountedRef.current = true
    return () => { plMountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    try {
    const [sr, sleepRaw, condRaw, recovRaw, stretchRaw, msgs, mems, rpts, stats, teamSessions, evts, confirmedRaw, iconRaw, shareLvRaw] = await Promise.all([
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
      AsyncStorage.getItem(PLAYER_ICON_KEY),
      AsyncStorage.getItem(SHARE_LEVEL_KEY),
    ])
    if (!plMountedRef.current) return
    let loadedSessions: TrainingSession[] = []
    try { if (sr) loadedSessions = JSON.parse(sr) } catch {}
    setSessions(loadedSessions)
    try { setSleepRecs(sleepRaw ? JSON.parse(sleepRaw) : []) } catch { setSleepRecs([]) }
    try { setConfirmedEventIds(new Set(confirmedRaw ? JSON.parse(confirmedRaw) : [])) } catch { setConfirmedEventIds(new Set()) }
    try { setConditionMap(condRaw ? JSON.parse(condRaw) : {}) } catch { setConditionMap({}) }
    setPlayerIcon(iconRaw ?? '')
    try { setShareLevel((shareLvRaw ? Number(shareLvRaw) : 2) as ShareLevel) } catch { setShareLevel(2) }
    // ホーム画面と完全一致の hasSymptom 計算：回復記録のみ（痛み報告は含めない）
    try {
      const sevenDaysAgo = localDateStr(new Date(Date.now() - 7 * 86400000))
      const recovRecs = recovRaw ? (JSON.parse(recovRaw) as Array<{ date: string }>) : []
      setHasSymptom(recovRecs.some(r => r.date >= sevenDaysAgo))
    } catch { setHasSymptom(false) }
    // ホーム画面と同じストレッチ補正（今日分のみ）
    try {
      const today = todayLocalISO()
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
    // 自分を team_members に再登録（参加時に登録失敗していてもコーチ一覧に出るよう自己修復）
    const myMember = mems.find(m => m.player_name === joined.playerName)
    registerMember(joined.code, joined.playerName, myMember?.event ?? '', iconRaw ?? '').catch(() => {})
    // 自分のセッションをチームに同期（共有レベルによってデータ量を制限）
    const shareLv = (shareLvRaw ? Number(shareLvRaw) : 2) as ShareLevel
    if (shareLv >= 2) {
      syncTeamSessions(joined.code, joined.playerName, loadedSessions).catch(() => {})
    } else if (shareLv === 1) {
      // コンディション・疲労度のみ（距離・本数などは送らない）
      const lite = loadedSessions.map(s => ({...s, distance_m: undefined, reps: undefined, sets: undefined, notes: undefined}))
      syncTeamSessions(joined.code, joined.playerName, lite).catch(() => {})
    }
    // shareLv === 0 は同期しない
    // レベル + 最新コンディションを自動同期
    const lvInfo = calcLevelInfo(loadedSessions.length, language)
    const cutoff30 = localDateStr(new Date(Date.now() - 30*24*60*60*1000))
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
      if (__DEV__) console.warn('[PlayerDashboard] load error:', e)
    } finally {
      if (plMountedRef.current) setPlLoading(false)
    }
  }, [joined.code, joined.playerName])

  // useFocusEffect handles initial load too — no separate useEffect needed
  useFocusEffect(useCallback(() => { load() }, [load]))
  // 3分ごとに自動ポーリング（Realtime遅延の補完 / Disk IO節約）
  useEffect(() => {
    const t = setInterval(() => { load() }, 3 * 60 * 1000)
    return () => clearInterval(t)
  }, [load])

  // shareLevel が変わった瞬間にリアルタイムでSupabaseへ反映
  const isFirstShareLevelMount = useRef(true)
  useEffect(() => {
    if (isFirstShareLevelMount.current) { isFirstShareLevelMount.current = false; return }
    if (shareLevel >= 2) {
      syncTeamSessions(joined.code, joined.playerName, sessions).catch(() => {})
    } else if (shareLevel === 1) {
      const lite = sessions.map(s => ({ ...s, distance_m: undefined, reps: undefined, sets: undefined, notes: undefined }))
      syncTeamSessions(joined.code, joined.playerName, lite).catch(() => {})
    } else {
      clearPlayerPrivateData(joined.code, joined.playerName).catch(() => {})
    }
  }, [shareLevel])

  async function savePlayerIcon(emoji: string) {
    setPlayerIcon(emoji)
    setShowIconPicker(false)
    try { await AsyncStorage.setItem(PLAYER_ICON_KEY, emoji) } catch {}
    // event フィールドを上書きしないよう icon カラムだけ update する
    try {
      await supabase.from('team_members')
        .update({ icon: emoji })
        .eq('id', `${joined.code}_${joined.playerName}`)
    } catch {}
  }

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

  // Supabase Realtime — コーチのアナウンス・チームメイト情報をリアルタイムで受信（デバウンス）
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const debouncedLoad = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => { load() }, 2000)
    }
    const ch = supabase.channel(`player:${joined.code}:${joined.playerName}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_messages',    filter: `team_code=eq.${joined.code}` }, (payload) => {
        debouncedLoad()
        if (payload.eventType === 'INSERT') {
          const row = payload.new as TeamMessageRow
          // コーチからの通常メッセージのみ通知（__system__・自分自身・[ABSENCE]系は除外）
          if (row.author_name !== '__system__' && row.author_name !== joined.playerName && !row.content?.startsWith('[')) {
            const preview = (row.content ?? '').slice(0, 40)
            showNow(t('team.playerDashboard.newMessagePush', { name: row.author_name }), preview).catch(() => {})
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members',     filter: `team_code=eq.${joined.code}` }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_player_stats',filter: `team_code=eq.${joined.code}` }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_sessions',    filter: `team_code=eq.${joined.code}` }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_body_reports',filter: `team_code=eq.${joined.code}` }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_events',      filter: `team_code=eq.${joined.code}` }, (payload) => {
        debouncedLoad()
        if (payload.eventType === 'INSERT') {
          const row = payload.new as TeamEventRow
          const typeEmoji = row.event_type === 'race' ? '🏁' : row.event_type === 'rest' ? '🛌' : '📅'
          showNow(`${typeEmoji} ${t('team.playerDashboard.newEventBadge')}`, t('team.playerDashboard.newEventPush', { date: row.event_date, title: row.title })).catch(() => {})
        }
      })
      .subscribe()
    return () => { if (debounceTimer) clearTimeout(debounceTimer); supabase.removeChannel(ch) }
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
      try {
        await initOneSignal()
        await requestPushPermission()
        await registerUserTags('player', joined.code)
      } catch {}
    })()
  }, [joined.code])

  async function saveStats() {
    const lvInfo = calcLevelInfo(sessions.length, language)
    const lastSess = sessions[0]
    const cutoff30 = localDateStr(new Date(Date.now() - 30*24*60*60*1000))
    const recent30 = sessions.filter(s => s.session_date >= cutoff30)
    try {
      await upsertPlayerStats(
        joined.code, joined.playerName, editEvent.trim(), editPb.trim(), lvInfo.level,
        lastSess?.condition_level ?? 7, lastSess?.fatigue_level ?? 5,
        lastSess?.session_date ?? '', recent30.length, editGoal.trim(), calcStreak(sessions),
      )
      setShowStatsEdit(false)
      load().catch(() => {})
      Toast.show({ type: 'success', text1: t('team.playerDashboard.profileUpdatedToast'), visibilityTime: 1600 })
    } catch (e) {
      Toast.show({ type: 'error', text1: t('team.playerDashboard.saveFailedToast'), text2: String(e), visibilityTime: 2500 })
    }
  }

  async function saveBodyReport() {
    const BODY_PARTS = buildBodyParts(t)
    try {
      await upsertBodyReport(joined.code, joined.playerName, editBody, editBodyDetail.trim())
      setBodyParts(editBody)
      setBodyDetail(editBodyDetail.trim())
      setShowBody(false)
      if (editBody.length > 0) {
        const labels = editBody.map(id => BODY_PARTS.find(p => p.id === id)?.label ?? id).join('、')
        const msg = editBodyDetail.trim() ? t('team.playerDashboard.painReportPushBody', { labels, detail: editBodyDetail.trim() }) : t('team.playerDashboard.painReportPushDefault', { labels })
        await sendPush(`🤕 ${joined.playerName}`, msg, 'coaches', joined.code)
      }
      Toast.show({ type: 'success', text1: t('team.playerDashboard.painReportSentToast'), visibilityTime: 1600 })
    } catch (e) {
      Toast.show({ type: 'error', text1: t('team.playerDashboard.sendFailed'), text2: String(e), visibilityTime: 3000 })
    }
  }

  const EVENT_CFG = buildEventCfg(t)
  const last    = sessions[0]
  const fat     = last ? fatigueInfo(last.fatigue_level, t) : null
  // ホーム画面と完全一致の計算式（fallback も index.tsx と同じ conditionMap[today] ?? 6）
  const avgCondLv = useMemo(() => {
    const todayISO = todayLocalISO()
    const conditionLevel = conditionMap[todayISO] ?? 6
    const today = new Date()
    const vals = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today); d.setDate(d.getDate() - i)
      return conditionMap[localDateStr(d)]
    }).filter((v): v is number => v !== undefined)
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : conditionLevel
  }, [conditionMap])
  // ホーム画面と完全一致：base + 天気補正 + ストレッチ補正
  const risk = useMemo(() => {
    const base = calcInjuryRisk(sessions, sleepRecs, avgCondLv, hasSymptom)
    const effective = Math.min(100, Math.max(0, base.riskScore + weatherBonus - stretchReduction))
    return { ...base, riskScore: effective }
  }, [sessions, sleepRecs, avgCondLv, hasSymptom, weatherBonus, stretchReduction])
  const pinned  = messages.filter(m => m.is_pinned && m.author_name !== '__system__')
  const regular = messages.filter(m => !m.is_pinned && m.author_name !== '__system__')

  return (
    <View style={{flex:1,backgroundColor:'#f6f6f8'}}>
      <SafeAreaView style={{flex:1}}>
        {plLoading ? (
          <View style={{flex:1,alignItems:'center',justifyContent:'center',gap:12}}>
            <Text style={{fontSize:32}}>⏳</Text>
            <Text style={{color:'#9ca3af',fontSize:14}}>{t('team.playerDashboard.loading')}</Text>
          </View>
        ) : (
          <>
            {/* ─ 固定ヘッダー ─ */}
            <View style={{paddingHorizontal:16,paddingTop:12,paddingBottom:10,backgroundColor:'#f6f6f8'}}>
              <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                <View style={{flexDirection:'row',alignItems:'center',gap:10,flex:1}}>
                  {/* タップでアイコン変更 */}
                  <TouchableOpacity onPress={() => setShowIconPicker(true)} activeOpacity={0.8} style={{position:'relative'}} accessibilityLabel={t('team.playerDashboard.changeIcon')}>
                    <Avatar name={joined.playerName} size={44} color={BRAND} emoji={playerIcon||undefined}/>
                    <View style={{position:'absolute',bottom:0,right:0,backgroundColor:'#34C759',borderRadius:5,width:14,height:14,alignItems:'center',justifyContent:'center'}}>
                      <Ionicons name="pencil" size={8} color="#fff"/>
                    </View>
                  </TouchableOpacity>
                  <View style={{gap:2,flex:1}}>
                    <Text style={{color:TEXT.primary,fontSize:18,fontWeight:'800'}} numberOfLines={1}>{joined.teamName}</Text>
                    <View style={{flexDirection:'row',gap:6,alignItems:'center'}}>
                      <View style={{backgroundColor:'#34C759'+'20',borderRadius:6,paddingHorizontal:7,paddingVertical:2}}>
                        <Text style={{color:'#34C759',fontSize:11,fontWeight:'700'}}>{t('team.playerDashboard.player')}</Text>
                      </View>
                      <Text style={{color:'#555',fontSize:11}} numberOfLines={1}>{joined.playerName}</Text>
                    </View>
                  </View>
                </View>
                <View style={{flexDirection:'row',gap:8,alignItems:'center'}}>
                  <TouchableOpacity onPress={() => load()} style={co.switchBtn} activeOpacity={0.7} hitSlop={{top:4,bottom:4,left:4,right:4}} accessibilityLabel={t('team.playerDashboard.refresh')}>
                    <Ionicons name="refresh-outline" size={15} color={TEXT.secondary}/>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setShowMenu(true)} style={co.switchBtn} activeOpacity={0.7} hitSlop={{top:4,bottom:4,left:4,right:4}} accessibilityLabel={t('team.playerDashboard.menu')}>
                    <Ionicons name="ellipsis-horizontal" size={15} color={TEXT.secondary}/>
                  </TouchableOpacity>
                </View>
              </View>
              {/* アクションボタン 2×2グリッド */}
              {(() => {
                const shareLvColor = shareLevel === 0 ? '#9ca3af' : shareLevel === 1 ? '#FF9500' : '#34C759'
                const shareLvIcon  = shareLevel === 0 ? 'lock-closed' : shareLevel === 1 ? 'eye-off' : 'eye'
                const shareLvLabel = shareLevel === 0 ? t('team.playerDashboard.shareLevelPrivate') : shareLevel === 1 ? t('team.playerDashboard.shareLevelPartial') : t('team.playerDashboard.shareLevelFull')
                return (
                  <View style={{gap:8}}>
                    <View style={{flexDirection:'row',gap:8}}>
                      <HapticTouch haptic="whoosh" style={pl.actionBtn} onPress={() => { setEditBody([...bodyParts]); setEditBodyDetail(bodyDetail); setShowBody(true) }} activeOpacity={0.85}>
                        <View style={{width:34,height:34,borderRadius:10,backgroundColor:'rgba(255,149,0,0.12)',alignItems:'center',justifyContent:'center'}}>
                          <Ionicons name="body-outline" size={18} color="#FF9500"/>
                        </View>
                        <View style={{flex:1}}>
                          <Text style={{color:TEXT.primary,fontSize:12,fontWeight:'800'}}>{t('team.playerDashboard.reportPain')}</Text>
                          <Text style={{color:'#9ca3af',fontSize:10,marginTop:1}}>{bodyParts.length > 0 ? t('team.playerDashboard.painCountReporting', { n: bodyParts.length }) : t('team.playerDashboard.noPainReport')}</Text>
                        </View>
                        {bodyParts.length > 0 && <View style={{backgroundColor:'#FF9500',borderRadius:10,width:20,height:20,alignItems:'center',justifyContent:'center'}}><Text style={{color:'#fff',fontSize:10,fontWeight:'800'}}>{bodyParts.length}</Text></View>}
                      </HapticTouch>
                      <HapticTouch haptic="whoosh" style={pl.actionBtn} onPress={() => setShowVideoModal(true)} activeOpacity={0.85}>
                        <View style={{width:34,height:34,borderRadius:10,backgroundColor:BRAND+'18',alignItems:'center',justifyContent:'center'}}>
                          <Ionicons name="videocam-outline" size={18} color={BRAND}/>
                        </View>
                        <View style={{flex:1}}>
                          <Text style={{color:TEXT.primary,fontSize:12,fontWeight:'800'}}>{t('team.playerDashboard.sendVideo')}</Text>
                          <Text style={{color:'#9ca3af',fontSize:10,marginTop:1}}>{t('team.playerDashboard.sendToCoach')}</Text>
                        </View>
                      </HapticTouch>
                    </View>
                    <View style={{flexDirection:'row',gap:8}}>
                      <HapticTouch
                        haptic="whoosh"
                        style={pl.actionBtn}
                        onPress={() => {
                          const ms = playerStats.find(s => s.player_name === joined.playerName)
                          setEditEvent(ms?.event ?? '')
                          setEditPb(ms?.pb_display ?? '')
                          setEditGoal(ms?.goal ?? '')
                          setShowStatsEdit(true)
                        }}
                        activeOpacity={0.85}
                      >
                        <View style={{width:34,height:34,borderRadius:10,backgroundColor:'rgba(175,82,222,0.12)',alignItems:'center',justifyContent:'center'}}>
                          <Ionicons name="person-circle-outline" size={18} color="#AF52DE"/>
                        </View>
                        <View style={{flex:1}}>
                          <Text style={{color:TEXT.primary,fontSize:12,fontWeight:'800'}}>{t('team.playerDashboard.profile')}</Text>
                          <Text style={{color:'#9ca3af',fontSize:10,marginTop:1}}>{t('team.playerDashboard.eventAndPb')}</Text>
                        </View>
                      </HapticTouch>
                      <HapticTouch haptic="whoosh" style={[pl.actionBtn,{borderColor: shareLvColor+'40', backgroundColor: shareLvColor+'08'}]} onPress={() => setShowShareLevel(true)} activeOpacity={0.85}>
                        <View style={{width:34,height:34,borderRadius:10,backgroundColor: shareLvColor+'20',alignItems:'center',justifyContent:'center'}}>
                          <Ionicons name={shareLvIcon as any} size={18} color={shareLvColor}/>
                        </View>
                        <View style={{flex:1}}>
                          <Text style={{color:TEXT.primary,fontSize:12,fontWeight:'800'}}>{t('team.playerDashboard.shareSettings')}</Text>
                          <Text style={{color: shareLvColor,fontSize:10,fontWeight:'700',marginTop:1}}>{shareLvLabel}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={14} color="#ccc"/>
                      </HapticTouch>
                    </View>
                  </View>
                )
              })()}
            </View>

            {/* ─ タブバー ─ */}
            <View style={{flexDirection:'row', backgroundColor:'#fff', borderBottomWidth:1, borderBottomColor:'rgba(0,0,0,0.08)'}}>
              {([
                { key:'home'    as const, label:t('team.playerDashboard.tabHome') },
                { key:'members' as const, label:t('team.playerDashboard.tabMembers') },
              ]).map(tabItem => (
                <HapticTouch haptic="tabSwitch" key={tabItem.key}
                  style={{flex:1, alignItems:'center', justifyContent:'center', paddingVertical:10, borderBottomWidth:2, borderBottomColor: plTab===tabItem.key ? BRAND : 'transparent'}}
                  onPress={() => setPlTab(tabItem.key)} activeOpacity={0.7}>
                  <Text style={{fontSize:13, fontWeight:'700', color: plTab===tabItem.key ? BRAND : '#888'}}>{tabItem.label}</Text>
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
                    <Text style={pl.sectionTitle}>{t('team.playerDashboard.coachAnnouncements')}</Text>
                    {pinned.map(m => (
                      <View key={m.id} style={{backgroundColor:'rgba(255,149,0,0.08)',borderRadius:12,borderWidth:1,borderColor:'rgba(255,149,0,0.4)',padding:14}}>
                        <Text style={{color:'#FF9500',fontSize:11,fontWeight:'700',marginBottom:6}}>📌 {m.author_name} · {timeAgo(m.created_at, t)}</Text>
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
                      <Text style={pl.sectionTitle}>{t('team.playerDashboard.coachMessages')}</Text>
                      {regular.length > 3 && <Text style={{color:'#9ca3af',fontSize:10}}>{t('team.playerDashboard.count', { n: regular.length })}</Text>}
                    </View>
                    <ScrollView style={{maxHeight:228,borderRadius:12}} nestedScrollEnabled showsVerticalScrollIndicator={regular.length > 3} contentContainerStyle={{gap:8}}>
                      {regular.map(m => (
                        <View key={m.id} style={{backgroundColor:'#ffffff',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',padding:14}}>
                          <Text style={{color:BRAND,fontSize:11,fontWeight:'700',marginBottom:6}}>{m.author_name} · {timeAgo(m.created_at, t)}</Text>
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
                    <Text style={{color:'#6b7280',fontSize:13}}>{t('team.playerDashboard.noCoachMessages')}</Text>
                  </View>
                  </AnimatedSection>
                )}

                {/* チームカレンダー */}
                <AnimatedSection delay={80} type="fade-up">
                <View style={{gap:8}}>
                  <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
                    <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
                      <Text style={pl.sectionTitle}>{t('team.playerDashboard.teamSchedule')}</Text>
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
                    {teamEvents.length > 0 && <Text style={{color:'#9ca3af',fontSize:11}}>{t('team.playerDashboard.count', { n: teamEvents.length })}</Text>}
                  </View>
                  {teamEvents.length === 0 ? (
                    <View style={{backgroundColor:'#ffffff',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',padding:20,alignItems:'center',gap:6}}>
                      <Text style={{fontSize:28}}>📅</Text>
                      <Text style={{color:'#9ca3af',fontSize:13}}>{t('team.playerDashboard.noCoachEvents')}</Text>
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
                                  <Text style={{color:'#FF3B30',fontSize:10,fontWeight:'600'}}>{t('team.playerDashboard.newEventBadge')}</Text>
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
                                        <Text style={{color:'#34C759',fontSize:9,fontWeight:'700'}}>{t('team.playerDashboard.confirmed')}</Text>
                                      </View>
                                    )}
                                  </View>
                                  <View style={{flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                                    <Text style={{color: confirmed ? '#bbb' : cfg.color, fontSize:11,fontWeight:'700'}}>{fmtEventDate(ev.event_date, t, DAY_NAMES)}</Text>
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
                                    }}>{confirmed ? t('team.playerDashboard.confirmed') : t('team.playerDashboard.confirm')}</Text>
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
                    <Text style={{color:TEXT.primary,fontSize:14,fontWeight:'800',flex:1}}>{t('team.playerDashboard.todayAbsence')}</Text>
                  </View>
                  <TextInput
                    style={{backgroundColor:'#f8f8fa',borderRadius:10,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:TEXT.primary,fontSize:13,paddingHorizontal:14,paddingVertical:10,minHeight:52,textAlignVertical:'top'}}
                    value={absenceNote}
                    onChangeText={setAbsenceNote}
                    placeholder={t('team.playerDashboard.absencePlaceholder')}
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
                        const _absenceUserId = (await AsyncStorage.getItem('userId').catch(() => null)) ?? 'local'
                        await addAbsenceSession({
                          user_id: _absenceUserId,
                          session_date: todayLocalISO(),
                          session_type: 'rest',
                          fatigue_level: 1,
                          condition_level: 5,
                          notes: t('team.playerDashboard.absenceRecordNote', { note: absenceNote.trim() || t('team.playerDashboard.absenceDefault') }),
                        })
                        try {
                          await sendCoachNotification(
                            joined.code,
                            'absence',
                            joined.playerName,
                            t('team.playerDashboard.absenceReportedPush', { name: joined.playerName }) + (absenceNote.trim() ? `（${absenceNote.trim()}）` : ''),
                          )
                        } catch { /* ignore */ }
                        setAbsenceNote('')
                        Toast.show({ type: 'success', text1: t('team.playerDashboard.absenceSentToast'), visibilityTime: 2000 })
                      } catch {
                        Toast.show({ type: 'error', text1: t('team.playerDashboard.sendFailed') })
                      } finally {
                        setAbsenceSaving(false)
                      }
                    }}
                    disabled={absenceSaving}
                    activeOpacity={0.85}
                  >
                    <Text style={{color:'#fff',fontSize:14,fontWeight:'800'}}>{absenceSaving ? t('team.playerDashboard.sending') : t('team.playerDashboard.sendButton')}</Text>
                  </HapticTouch>
                </View>
                </AnimatedSection>

                {/* マイ コンディション */}
                <AnimatedSection delay={120} type="fade-up">
                <Text style={pl.sectionTitle}>{t('team.playerDashboard.myCondition')}</Text>
                <View style={{backgroundColor:'#ffffff',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',padding:14}}>
                  <View style={{flexDirection:'row',gap:10,marginBottom:bodyParts.length>0?12:4}}>
                    <View style={{flex:1,alignItems:'center',backgroundColor:'#f0f2f5',borderRadius:10,paddingVertical:12,gap:3}}>
                      <Text style={{fontSize:26}}>{fat?.emoji??'—'}</Text>
                      <Text style={{color:fat?.color??'#888',fontSize:12,fontWeight:'700'}}>{fat?.label??t('team.playerDashboard.noData')}</Text>
                      <Text style={{color:'#555',fontSize:10}}>{t('team.memberDetail.fatigueLevel')}</Text>
                    </View>
                    <View style={{flex:1,alignItems:'center',backgroundColor:'#f0f2f5',borderRadius:10,paddingVertical:12,gap:3}}>
                      <Text style={{color:risk.signalColor,fontSize:24,fontWeight:'800'}}>{risk.riskScore}</Text>
                      <Text style={{color:risk.signalColor,fontSize:11,fontWeight:'700'}}>{risk.label}</Text>
                      <Text style={{color:'#555',fontSize:10}}>{t('team.memberDetail.injuryRisk')}</Text>
                    </View>
                    <View style={{flex:1,alignItems:'center',backgroundColor: calcStreak(sessions) > 0 ? 'rgba(255,107,53,0.08)' : '#f0f2f5',borderRadius:10,paddingVertical:12,gap:3,borderWidth:1,borderColor: calcStreak(sessions) > 0 ? 'rgba(255,107,53,0.25)' : 'transparent'}}>
                      <Text style={{fontSize:24}}>{calcStreak(sessions) > 0 ? '🔥' : '—'}</Text>
                      <Text style={{color: calcStreak(sessions) > 0 ? '#FF6B35' : '#888',fontSize:12,fontWeight:'800'}}>{calcStreak(sessions) > 0 ? t('team.playerDashboard.streakDaysUnit', { n: calcStreak(sessions) }) : t('team.playerDashboard.zeroDays')}</Text>
                      <Text style={{color:'#555',fontSize:10}}>{t('team.playerDashboard.consecutiveRecord')}</Text>
                    </View>
                  </View>
                  {bodyParts.length > 0 && (
                    <View style={{backgroundColor:'rgba(255,59,48,0.08)',borderRadius:10,padding:10}}>
                      <Text style={{color:'#FF3B30',fontSize:11,fontWeight:'700',marginBottom:6}}>{t('team.playerDashboard.currentPainReport')}</Text>
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
                    <Text style={{color:TEXT.primary,fontSize:15,fontWeight:'700'}}>{t('team.playerDashboard.noTeammatesYet')}</Text>
                    <Text style={{color:'#9ca3af',fontSize:13,textAlign:'center'}}>{t('team.playerDashboard.noTeammatesHint')}</Text>
                  </View>
                ) : (
                  <AnimatedSection delay={0} type="fade-up">
                  <View style={{backgroundColor:'#ffffff',borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)',overflow:'hidden'}}>
                    {teammates.map((m, i) => {
                      const stat      = playerStats.find(s => s.player_name === m.player_name)
                      const lvInfo    = calcLevelInfo(stat?.level ?? 1, language)
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
                                <Text style={{color:lvTier.color,fontSize:12,fontWeight:'700'}}>{getTierTitle(lvTier.title, language)}</Text>
                                {event ? <Text style={{color:'#9ca3af',fontSize:11}}>· {getEventLabel(event, language)}</Text> : null}
                              </View>
                            </View>
                            <View style={{alignItems:'flex-end',gap:4}}>
                              {streak > 0 && (
                                <View style={{flexDirection:'row',alignItems:'center',gap:3,backgroundColor:'rgba(255,107,53,0.10)',borderRadius:10,paddingHorizontal:8,paddingVertical:4,borderWidth:1,borderColor:'rgba(255,107,53,0.25)'}}>
                                  <Text style={{fontSize:13}}>🔥</Text>
                                  <Text style={{color:'#FF6B35',fontSize:12,fontWeight:'900'}}>{t('team.playerDashboard.streakDaysShort', { n: streak })}</Text>
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
                                <Text style={{color:'#bbb',fontSize:12}}>{t('team.playerDashboard.pbNotEntered')}</Text>
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
              <Text style={{color:'#111827',fontSize:17,fontWeight:'800',flex:1}}>{t('team.playerDashboard.painModalTitle')}</Text>
              <TouchableOpacity onPress={() => setShowBody(false)} hitSlop={{top:10,bottom:10,left:10,right:10}} accessibilityLabel={t('team.memberDetail.close')}>
                <Ionicons name="close" size={22} color={TEXT.secondary}/>
              </TouchableOpacity>
            </View>
            <Text style={{color:'#666',fontSize:12,marginBottom:14}}>
              {t('team.playerDashboard.painModalDesc')}
            </Text>
            <BodyPartSelector selected={editBody} onChange={setEditBody}/>
            <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8,marginTop:16,marginBottom:6}}>{t('team.playerDashboard.detailNoteLabel')}</Text>
            <TextInput
              style={{backgroundColor:'#f8f8fa',borderRadius:10,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:TEXT.primary,fontSize:14,paddingHorizontal:14,paddingVertical:10,minHeight:60,textAlignVertical:'top'}}
              value={editBodyDetail}
              onChangeText={setEditBodyDetail}
              placeholder={t('team.playerDashboard.detailNotePlaceholder')}
              placeholderTextColor="#9ca3af"
              multiline
              maxLength={120}
            />
            {editBody.length > 0 ? (
              <HapticTouch haptic="save" style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:14,marginTop:14}} onPress={saveBodyReport} activeOpacity={0.85}>
                <Ionicons name="send" size={18} color="#fff"/>
                <Text style={{color:'#fff',fontSize:15,fontWeight:'800'}}>{t('team.playerDashboard.reportToCoach')}</Text>
              </HapticTouch>
            ) : (
              <HapticTouch haptic="save" style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'#f0f2f5',borderRadius:14,paddingVertical:14,marginTop:14,borderWidth:1,borderColor:'rgba(0,0,0,0.08)'}} onPress={saveBodyReport} activeOpacity={0.85}>
                <Text style={{color:'#888',fontSize:15,fontWeight:'700'}}>{t('team.playerDashboard.noPainClear')}</Text>
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
                  <Text style={{color:'#111827',fontSize:18,fontWeight:'800',flex:1}}>{t('team.playerDashboard.profileEditTitle')}</Text>
                  <TouchableOpacity onPress={() => setShowStatsEdit(false)} hitSlop={{top:10,bottom:10,left:10,right:10}} accessibilityLabel={t('team.memberDetail.close')}>
                    <Ionicons name="close" size={22} color={TEXT.secondary}/>
                  </TouchableOpacity>
                </View>
                <Text style={{color:'#6b7280',fontSize:12,lineHeight:18,marginTop:8}}>
                  {t('team.playerDashboard.profileEditDesc')}
                </Text>
              </View>
              <ScrollView contentContainerStyle={{paddingHorizontal:22,paddingBottom:48,gap:14}} keyboardShouldPersistTaps="handled">
                {/* 種目 */}
                <View style={{gap:6}}>
                  <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.playerDashboard.eventLabel')}</Text>
                  <TextInput
                    style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:15,paddingHorizontal:14,paddingVertical:12}}
                    value={editEvent} onChangeText={setEditEvent}
                    placeholder={t('team.playerDashboard.eventPlaceholder')} placeholderTextColor="#9ca3af" maxLength={20}
                  />
                </View>
                {/* 自己ベスト */}
                <View style={{gap:6}}>
                  <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.playerDashboard.pbLabel')}</Text>
                  <TextInput
                    style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:15,paddingHorizontal:14,paddingVertical:12}}
                    value={editPb} onChangeText={setEditPb}
                    placeholder={t('team.playerDashboard.pbPlaceholder')} placeholderTextColor="#9ca3af" maxLength={20}
                  />
                </View>
                {/* 目標 */}
                <View style={{gap:6}}>
                  <Text style={{color:TEXT.hint,fontSize:11,fontWeight:'700',letterSpacing:0.8}}>{t('team.playerDashboard.goalLabel')}</Text>
                  <TextInput
                    style={{backgroundColor:'#f8f8fa',borderRadius:12,borderWidth:1,borderColor:'rgba(0,0,0,0.10)',color:'#111827',fontSize:15,paddingHorizontal:14,paddingVertical:12}}
                    value={editGoal} onChangeText={setEditGoal}
                    placeholder={t('team.playerDashboard.goalPlaceholder')} placeholderTextColor="#9ca3af" maxLength={40}
                  />
                </View>
                <HapticTouch
                  haptic="save"
                  style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:BRAND,borderRadius:14,paddingVertical:15}}
                  onPress={saveStats} activeOpacity={0.85}
                >
                  <Ionicons name="checkmark-circle" size={18} color="#fff"/>
                  <Text style={{color:'#fff',fontSize:16,fontWeight:'800'}}>{t('team.playerDashboard.publishToTeam')}</Text>
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

      <ShareLevelModal
        visible={showShareLevel}
        current={shareLevel}
        onChange={lv => setShareLevel(lv)}
        onClose={() => setShowShareLevel(false)}
      />

      <PlayerIconPicker
        visible={showIconPicker}
        current={playerIcon}
        onSelect={savePlayerIcon}
        onClose={() => setShowIconPicker(false)}
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
  header:      { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:14, paddingBottom:12, backgroundColor:'#fff', borderBottomWidth:1, borderBottomColor:'rgba(0,0,0,0.06)' },
  title:       { color:TEXT.primary, fontSize:19, fontWeight:'800' },
  codeBox:     { backgroundColor:BRAND+'0d', borderRadius:14, borderWidth:1.5, borderColor:BRAND+'35', paddingHorizontal:12, paddingVertical:7, alignItems:'center', gap:1 },
  switchBtn:   { width:36, height:36, borderRadius:14, backgroundColor:'#f5f6f8', borderWidth:1, borderColor:'rgba(0,0,0,0.07)', alignItems:'center', justifyContent:'center' },
  alertChip:   { flexDirection:'row', alignItems:'center', gap:5, backgroundColor:'rgba(239,68,68,0.07)', borderRadius:14, borderWidth:1, borderColor:'rgba(239,68,68,0.25)', paddingHorizontal:10, paddingVertical:6 },
  memberCard:  { backgroundColor:'#ffffff', borderRadius:18, borderWidth:1, borderColor:'rgba(0,0,0,0.06)', padding:12, shadowColor:'#000', shadowOffset:{width:0,height:4}, shadowOpacity:0.04, shadowRadius:12, elevation:2 },
  composeBox:  { flexDirection:'row', gap:10, alignItems:'flex-end', backgroundColor:'#ffffff', borderRadius:21, borderWidth:1, borderColor:'rgba(0,0,0,0.09)', padding:12 },
  composeInput:{ flex:1, color:TEXT.primary, fontSize:14, minHeight:40, maxHeight:100 },
  sendBtn:     { width:44, height:44, borderRadius:16, backgroundColor:BRAND, alignItems:'center', justifyContent:'center' },
  msgCard:     { backgroundColor:'#ffffff', borderRadius:18, borderWidth:1, borderColor:'rgba(0,0,0,0.07)', padding:14, shadowColor:'#000', shadowOffset:{width:0,height:4}, shadowOpacity:0.04, shadowRadius:12, elevation:2 },
  videoCard:   { backgroundColor:'#ffffff', borderRadius:18, borderWidth:1, borderColor:'rgba(0,0,0,0.07)', padding:14, shadowColor:'#000', shadowOffset:{width:0,height:4}, shadowOpacity:0.04, shadowRadius:12, elevation:2 },
})
const pl = StyleSheet.create({
  sectionTitle: { color:TEXT.hint, fontSize:11, fontWeight:'700', letterSpacing:1, marginTop:4 },
  actionBtn:    { flex:1, flexDirection:'row', alignItems:'center', gap:10, backgroundColor:'#f5f6f8', borderRadius:18, borderWidth:1, borderColor:'rgba(0,0,0,0.07)', paddingVertical:12, paddingHorizontal:12 },
})

// ─────────────────────────────────────────────────────────
// ShareLevelModal — 選手のデータ共有レベル設定
// ─────────────────────────────────────────────────────────
function buildShareLevelCfg(t: (key: string) => string): { level: ShareLevel; emoji: string; title: string; desc: string; color: string }[] {
  return [
    { level: 2, emoji: '📊', title: t('team.shareLevel.full.title'), desc: t('team.shareLevel.full.desc'), color: BRAND },
    { level: 1, emoji: '💚', title: t('team.shareLevel.partial.title'), desc: t('team.shareLevel.partial.desc'), color: '#FF9500' },
    { level: 0, emoji: '🔒', title: t('team.shareLevel.private.title'), desc: t('team.shareLevel.private.desc'), color: '#9ca3af' },
  ]
}

function ShareLevelModal({ visible, current, onChange, onClose }: {
  visible: boolean; current: ShareLevel; onChange: (lv: ShareLevel) => void; onClose: () => void
}) {
  const { t } = useTranslation()
  const SHARE_LEVEL_CFG = buildShareLevelCfg(t)
  const [selected, setSelected] = useState<ShareLevel>(current)
  useEffect(() => { if (visible) setSelected(current) }, [visible, current])

  async function save() {
    await AsyncStorage.setItem(SHARE_LEVEL_KEY, String(selected)).catch(() => {})
    onChange(selected)
    onClose()
    Toast.show({ type: 'success', text1: t('team.shareLevel.savedToast'), visibilityTime: 1500 })
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.55)',justifyContent:'flex-end'}}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose}/>
        <View style={{backgroundColor:'#fff',borderTopLeftRadius:28,borderTopRightRadius:28,paddingTop:12,paddingHorizontal:20,paddingBottom:48,gap:0}}>
          {/* ドラッグハンドル */}
          <View style={{width:40,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.1)',alignSelf:'center',marginBottom:20}}/>

          {/* ヘッダー */}
          <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
            <Text style={{color:'#111827',fontSize:18,fontWeight:'800'}}>{t('team.shareLevel.title')}</Text>
            <TouchableOpacity onPress={onClose} style={{width:32,height:32,borderRadius:16,backgroundColor:'#f0f2f5',alignItems:'center',justifyContent:'center'}} activeOpacity={0.7} hitSlop={{top:8,bottom:8,left:8,right:8}} accessibilityLabel={t('team.memberDetail.close')}>
              <Ionicons name="close" size={16} color="#6b7280"/>
            </TouchableOpacity>
          </View>
          <Text style={{color:'#9ca3af',fontSize:12,lineHeight:18,marginBottom:18}}>{t('team.shareLevel.desc')}</Text>

          {/* 選択肢 */}
          <View style={{gap:10,marginBottom:20}}>
            {SHARE_LEVEL_CFG.map(cfg => {
              const active = selected === cfg.level
              const isCurrent = current === cfg.level
              return (
                <TouchableOpacity
                  key={cfg.level}
                  style={{
                    flexDirection:'row',alignItems:'center',gap:14,
                    borderRadius:16,borderWidth: active ? 2 : 1.5,
                    borderColor: active ? cfg.color : 'rgba(0,0,0,0.07)',
                    backgroundColor: active ? cfg.color+'0d' : '#fafafa',
                    padding:14,
                  }}
                  onPress={() => setSelected(cfg.level)}
                  activeOpacity={0.78}
                >
                  <View style={{width:46,height:46,borderRadius:14,backgroundColor: active ? cfg.color+'25' : '#f0f2f5',alignItems:'center',justifyContent:'center'}}>
                    <Text style={{fontSize:24}}>{cfg.emoji}</Text>
                  </View>
                  <View style={{flex:1,gap:4}}>
                    <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
                      <Text style={{color: active ? cfg.color : '#111827',fontSize:14,fontWeight:'800'}}>{cfg.title}</Text>
                      {isCurrent && (
                        <View style={{backgroundColor: active ? cfg.color : '#e5e7eb',borderRadius:6,paddingHorizontal:7,paddingVertical:2}}>
                          <Text style={{color: active ? '#fff' : '#6b7280',fontSize:9,fontWeight:'800'}}>{t('team.shareLevel.currentSetting')}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{color:'#9ca3af',fontSize:11,lineHeight:16}}>{cfg.desc}</Text>
                  </View>
                  <View style={{width:24,height:24,borderRadius:12,borderWidth: active ? 0 : 1.5,borderColor:'rgba(0,0,0,0.15)',backgroundColor: active ? cfg.color : 'transparent',alignItems:'center',justifyContent:'center'}}>
                    {active && <Ionicons name="checkmark" size={14} color="#fff"/>}
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* 保存ボタン */}
          <TouchableOpacity
            style={{backgroundColor: selected === current ? '#e5e7eb' : BRAND, borderRadius:16,paddingVertical:16,alignItems:'center'}}
            onPress={selected === current ? onClose : save}
            activeOpacity={0.85}
          >
            <Text style={{color: selected === current ? '#9ca3af' : '#fff',fontSize:15,fontWeight:'800'}}>
              {selected === current ? t('team.shareLevel.noChange') : t('team.shareLevel.saveApply')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

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
  const { t } = useTranslation()
  // iOSでは2つのModalを同時に表示できないため、
  // メニューModalを先に閉じてから確認ダイアログを開く
  const [showConfirm, setShowConfirm] = useState(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const dangerLabel   = role === 'coach' ? t('team.menuSheet.deleteTeam') : t('team.menuSheet.leaveTeam')
  const dangerMessage = role === 'coach'
    ? t('team.menuSheet.deleteTeamConfirmMessage')
    : t('team.menuSheet.leaveTeamConfirmMessage')

  function handleDangerPress() {
    // ① まずメニューを閉じる
    onClose()
    // ② Modalの閉じアニメーション（300ms）完了後に確認ダイアログを開く（アンマウント後は無視）
    setTimeout(() => { if (mountedRef.current) setShowConfirm(true) }, 350)
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.6)',justifyContent:'flex-end'}}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose}/>
          <View style={{backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,padding:24,paddingBottom:48,gap:12}}>
            <View style={{width:36,height:4,borderRadius:2,backgroundColor:'rgba(0,0,0,0.12)',alignSelf:'center',marginBottom:4}}/>
            <Text style={{color:'#111827',fontSize:17,fontWeight:'800'}}>{t('team.menuSheet.title')}</Text>

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
                  {role === 'coach' ? t('team.menuSheet.deleteTeamHint') : t('team.menuSheet.leaveTeamHint')}
                </Text>
              </View>
            </TouchableOpacity>

            {/* キャンセル */}
            <TouchableOpacity
              style={{alignItems:'center',paddingVertical:15,borderRadius:14,borderWidth:1,borderColor:'rgba(0,0,0,0.09)',marginTop:4}}
              onPress={onClose} activeOpacity={0.7}
            >
              <Text style={{color:'#6b7280',fontSize:15,fontWeight:'600'}}>{t('team.menuSheet.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* メニューModalが閉じてから表示（iOS 2-Modal同時表示禁止対策） */}
      <ConfirmSheet
        visible={showConfirm}
        title={dangerLabel}
        message={dangerMessage}
        confirmLabel={role === 'coach' ? t('team.menuSheet.deleteConfirmLabel') : t('team.menuSheet.leaveConfirmLabel')}
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
  type State = 'loading'|'select-role'|'coach-setup'|'coach'|'player-join'|'player'
  const [state,  setState]  = useState<State>('loading')
  const [setup,  setSetup]  = useState<TeamSetup|null>(null)
  const [joined, setJoined] = useState<JoinedTeam|null>(null)
  const fadeY = useRef(new Animated.Value(0)).current
  const { isCoach } = usePurchase()

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
        // 保存済みデータをパース（壊れていたら null 扱い＝セットアップ画面へ戻す）
        // ※ raw の有無ではなくパース成功を基準にしないと、壊れたデータで
        //   state だけ 'coach'/'player' になり setup/joined が null → 真っ黒画面になる
        let parsedSetup:  TeamSetup  | null = null
        let parsedJoined: JoinedTeam | null = null
        try { if (setupRaw)  parsedSetup  = JSON.parse(setupRaw) } catch {}
        try { if (joinedRaw) parsedJoined = JSON.parse(joinedRaw) } catch {}
        if (parsedSetup)  setSetup(parsedSetup)
        if (parsedJoined) setJoined(parsedJoined)

        if (!role) { setState('select-role'); return }
        if (role === 'coach') {
          // サブスク有効確認は PurchaseContext が非同期で完了するため
          // ここでは保存ロールを信頼して遷移し、CoachDashboard 側で isCoach を再確認
          setState(parsedSetup ? 'coach' : 'coach-setup')
        } else {
          setState(parsedJoined ? 'player' : 'player-join')
        }
      } catch {
        setState('select-role')
      }
    }
    init()
  }, [])

  // コーチ機能は「チーム作成 + 実メンバー0人（デモプレビュー）」まで無料で到達できる。
  // 実メンバーが1人でも参加した時点（＝実データが流れ始めた時点）で初めて
  // CoachDashboard 側が課金を要求する（handleSelectRole・ここでの即ペイウォールは行わない）。
  // これにより「役割を選んだ瞬間に価値を体験する前に課金要求される」離脱を防ぐ。

  async function handleSelectRole(role: Role) {
    if (role === 'coach') {
      await AsyncStorage.setItem(ROLE_KEY, role).catch(() => {})
      setState(setup ? 'coach' : 'coach-setup')
    } else {
      await AsyncStorage.setItem(ROLE_KEY, role).catch(() => {})
      setState(joined ? 'player' : 'player-join')
    }
  }

  function handleCoachCreated(s: TeamSetup)  { setSetup(s);  setState('coach')  }
  function handlePlayerJoined(j: JoinedTeam) { setJoined(j); setState('player') }

  // ロール切り替え — データは消さない
  async function handleSwitchRole() {
    await AsyncStorage.removeItem(ROLE_KEY).catch(() => {})
    setState('select-role')
  }

  // チーム削除（コーチ）
  async function handleDeleteTeam() {
    await AsyncStorage.multiRemove([ROLE_KEY, SETUP_KEY]).catch(() => {})
    setSetup(null)
    setState('select-role')
  }

  // チーム脱退（選手）
  async function handleLeaveTeam() {
    if (joined) {
      // Supabase のメンバーテーブルから削除（コーチの画面からも消える）
      await deleteMember(`${joined.code}_${joined.playerName}`).catch(() => {})
    }
    await AsyncStorage.multiRemove([ROLE_KEY, JOINED_KEY]).catch(() => {})
    setJoined(null)
    setState('select-role')
  }

  const fadeStyle = { flex: 1, opacity: fadeY, transform: [{ translateY: fadeY.interpolate({ inputRange: [0,1], outputRange: [14,0] }) }] }

  if (state==='loading')          return <View style={{flex:1,backgroundColor:'#0a0a0a'}}/>
  if (state==='select-role')      return <Animated.View style={fadeStyle}><RoleSelectionScreen onSelect={handleSelectRole}/></Animated.View>
  // coach 状態で setup が無い（壊れたデータ）→ セットアップ画面へフォールバック
  if (state==='coach-setup' || (state==='coach' && !setup))
                                  return <Animated.View style={fadeStyle}><CoachSetupScreen onCreated={handleCoachCreated} onBack={() => setState('select-role')}/></Animated.View>
  if (state==='coach' && setup)   return <Animated.View style={fadeStyle}><CoachDashboard  setup={setup!}  isCoach={isCoach} onSwitchRole={handleSwitchRole} onDeleteTeam={handleDeleteTeam}  canSwitchRole={true}/></Animated.View>
  // player 状態で joined が無い（壊れたデータ）→ 参加画面へフォールバック
  if (state==='player-join' || (state==='player' && !joined))
                                  return <Animated.View style={fadeStyle}><PlayerJoinScreen onJoined={handlePlayerJoined} onBack={() => setState('select-role')}/></Animated.View>
  if (state==='player' && joined) return <Animated.View style={fadeStyle}><PlayerDashboard joined={joined!} onSwitchRole={handleSwitchRole} onLeaveTeam={handleLeaveTeam}  canSwitchRole={true}/></Animated.View>
  return <Animated.View style={fadeStyle}><RoleSelectionScreen onSelect={handleSelectRole}/></Animated.View>
}

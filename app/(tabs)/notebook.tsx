// app/(tabs)/notebook.tsx — 陸上ノート（テーマ対応版）
import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Modal, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'
import { useTheme } from '../../context/ThemeContext'
import { Sounds, unlockAudio } from '../../lib/sounds'
import HapticTouch from '../../components/HapticTouch'
import { useRouter } from 'expo-router'
import { checkAdGate, recordUsage } from '../../lib/adGate'
import { TICKET_COST } from '../../lib/ticketWallet'
import { getAiAuthHeader } from '../../lib/supabase'
import { useFocusEffect } from '@react-navigation/native'
import { parseDistanceAndReps } from '../../lib/parseWorkoutDistance'
import type { TrainingSession } from '../../types'
import { localDateStr, todayLocalISO } from '../../lib/dateLocal'
import { updateSessions } from '../../lib/sessionsStore'
import { addTasks } from '../../lib/tasksStore'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../../context/LanguageContext'
import { getEventLabel } from '../../lib/eventLabels'

const SESSIONS_KEY    = 'trackmate_sessions'

// Hermesの AbortSignal.timeout 非対応に対応したタイムアウト付きfetch
function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return fetch(url, { ...options, signal: AbortSignal.timeout(ms) })
  }
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id))
}

// ── 正規表現フォールバックパーサー ───────────────────────────────
function fallbackParse(text: string, today: string): Record<string, any> {
  const t = text
  let session_type = 'easy'
  // practice-input.tsx の fallbackParse と同一のキーワード判定に統一
  // (旧実装は坂道・タイムトライアル・ハードル・デッド等の一部キーワードが
  // 抜けており、同じ文章でも入力画面によって分類結果が食い違うバグの原因になっていた)
  if (/インターバル|interval|本.*レスト|レスト.*本/i.test(t)) session_type = 'interval'
  else if (/テンポ|ペース走|ビルドアップ|tempo|pace run|build.?up/i.test(t)) session_type = 'tempo'
  else if (/スプリント|全力|100m.*走|ダッシュ|坂道|流し|タイムトライアル|\bTT\b|sprint|hill/i.test(t)) session_type = 'sprint'
  else if (/ロング|長距離|LSD|long run|long jog/i.test(t)) session_type = 'long'
  else if (/ドリル|ハードル|ABCドリル|drill|hurdle/i.test(t)) session_type = 'drill'
  else if (/ウェイト|筋トレ|ジム|スクワット|デッド|weight|gym|squat|strength/i.test(t)) session_type = 'strength'
  else if (/試合|大会|記録会|レース|race|competition|meet/i.test(t)) session_type = 'race'
  else if (/休養|オフ|休み|レスト|\brest\b|day off/i.test(t)) session_type = 'rest'
  else if (/ポイント練習|ポイント練/i.test(t)) session_type = 'interval'

  const eventMatch = t.match(/\b(100m|200m|300m|400m|800m|1000m|1500m|3000m|5000m|10000m|110mH|100mH|300mH|400mH|3000mSC)\b/i)
  const event = eventMatch ? eventMatch[1] : null

  let time_ms: number | null = null
  const timeMatch = t.match(/(\d{1,2}):(\d{2})[.:](\d{1,2})|(\d{1,2})'(\d{2})[.:]?(\d{0,2})|(\d{2,3})[."秒](\d{0,2})/)
  if (timeMatch) {
    if (timeMatch[1]) time_ms = Math.round((parseInt(timeMatch[1])*60 + parseInt(timeMatch[2]) + parseInt(timeMatch[3]||'0')/100)*1000)
    else if (timeMatch[4]) time_ms = Math.round((parseInt(timeMatch[4])*60 + parseInt(timeMatch[5]) + parseInt(timeMatch[6]||'0')/100)*1000)
    else if (timeMatch[7]) time_ms = Math.round((parseInt(timeMatch[7]) + parseInt(timeMatch[8]||'0')/100)*1000)
  }

  const { distance_m, reps } = parseDistanceAndReps(t)

  const fatMatch = t.match(/疲労\s*[：:=]?\s*(\d+)|疲[れ労]\s*(\d+)|fatigue\s*[：:=]?\s*(\d+)/i)
  const fatigue_level = fatMatch ? parseInt(fatMatch[1] ?? fatMatch[2] ?? fatMatch[3]) : 5

  const condMatch = t.match(/体調\s*[：:=]?\s*(\d+)|condition\s*[：:=]?\s*(\d+)/i)
  const condition_level = condMatch ? parseInt(condMatch[1] ?? condMatch[2]) : 6

  return { session_date: today, session_type, event, time_ms, distance_m, reps, fatigue_level, condition_level }
}
const CONDITION_MAP_KEY = 'trackmate_condition_map'
const BRAND           = '#166534'

async function saveImprovementTasks(sessionType: string, fatigue: number, notes: string, t: (key: string) => string) {
  const texts: string[] = []
  if (fatigue >= 8) texts.push(t('notebook.tasks.sleep'))
  if (fatigue >= 6) texts.push(t('notebook.tasks.stretch'))
  if (sessionType === 'interval' || sessionType === 'sprint')
    texts.push(t('notebook.tasks.restDay'))
  if (sessionType === 'long') texts.push(t('notebook.tasks.longRunFuel'))
  if (sessionType === 'race') texts.push(t('notebook.tasks.raceRecovery'))
  if (notes.includes('痛') || notes.includes('違和感') || /\bpain\b|\bsore(ness)?\b|\bhurt(s|ing)?\b/i.test(notes))
    texts.push(t('notebook.tasks.painCheck'))

  if (texts.length === 0) return
  try {
    await addTasks(texts.slice(0, 3))
  } catch { /* ignore */ }
}

const TYPE_COLORS: Record<string, string> = {
  interval: '#f97316', tempo: '#FF9500', easy: '#34C759', long: '#5AC8FA',
  sprint: '#FF3B30', drill: '#AF52DE', strength: '#FF6B35', race: '#FFD700', rest: '#5a5a8a',
}

function fmtTime(ms: number) {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(2)}"`
  return `${Math.floor(s / 60)}'${(s % 60).toFixed(2).padStart(5, '0')}"`
}
function fmtDist(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`
}

const CONDITION_EMOJIS: Record<number,string> = { 2:'😫', 4:'😕', 6:'😐', 8:'😊', 10:'💪' }
function conditionEmoji(v: number) {
  const closest = [2,4,6,8,10].reduce((a,b) => Math.abs(b-v) < Math.abs(a-v) ? b : a)
  return CONDITION_EMOJIS[closest] ?? '😐'
}

// ── ミニカレンダー ──────────────────────────────────────────────
const CAL_TYPE_COLORS: Record<string,string> = {
  interval:'#E53935', tempo:'#FF9500', easy:'#34C759', long:'#5AC8FA',
  sprint:'#FF3B30', drill:'#AF52DE', strength:'#FF6B35', race:'#FFD700', rest:'#94a3b8',
}

const MONTH_NAMES_EN = ['January','February','March','April','May','June','July','August','September','October','November','December']

function MiniCalendar({ sessions, onDayPress }: {
  sessions: TrainingSession[]
  onDayPress?: (date: string) => void
}) {
  const { colors } = useTheme()
  const { language } = useLanguage()
  const now = new Date()
  const [viewYear,  setViewYear]  = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())

  const DOW = language === 'en' ? ['Su','Mo','Tu','We','Th','Fr','Sa'] : ['日','月','火','水','木','金','土']

  // date → first session color
  const dayMap: Record<string, string> = {}
  sessions.forEach(s => {
    if (!dayMap[s.session_date]) {
      dayMap[s.session_date] = CAL_TYPE_COLORS[s.session_type] ?? '#34C759'
    }
  })

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewYear > now.getFullYear() || (viewYear === now.getFullYear() && viewMonth >= now.getMonth())) return
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDow    = new Date(viewYear, viewMonth, 1).getDay()
  const today       = localDateStr(now)
  const canNext     = viewYear < now.getFullYear() || (viewYear === now.getFullYear() && viewMonth < now.getMonth())

  return (
    <View style={[st.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* ヘッダー */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <TouchableOpacity onPress={prevMonth} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={18} color={colors.textSec} />
        </TouchableOpacity>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>
          {language === 'en' ? `${MONTH_NAMES_EN[viewMonth]} ${viewYear}` : `${viewYear}年 ${viewMonth + 1}月`}
        </Text>
        <TouchableOpacity onPress={nextMonth} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ opacity: canNext ? 1 : 0.3 }}>
          <Ionicons name="chevron-forward" size={18} color={colors.textSec} />
        </TouchableOpacity>
      </View>

      {/* 曜日 */}
      <View style={{ flexDirection: 'row', marginBottom: 4 }}>
        {DOW.map((d, i) => (
          <Text key={d} style={{
            flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700',
            color: i === 0 ? '#EF4444' : i === 6 ? '#5AC8FA' : colors.textHint,
          }}>{d}</Text>
        ))}
      </View>

      {/* グリッド */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: firstDow }).map((_, i) => (
          <View key={`e${i}`} style={{ width: `${100/7}%` as any, aspectRatio: 1 }} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day     = i + 1
          const mm      = String(viewMonth + 1).padStart(2, '0')
          const dd      = String(day).padStart(2, '0')
          const dateStr = `${viewYear}-${mm}-${dd}`
          const isToday = dateStr === today
          const color   = dayMap[dateStr]
          const dow     = (firstDow + i) % 7

          return (
            <TouchableOpacity
              key={day}
              style={{ width: `${100/7}%` as any, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}
              onPress={() => color && onDayPress?.(dateStr)}
              activeOpacity={color ? 0.7 : 1}
            >
              {color && (
                <View style={{
                  position: 'absolute',
                  width: 28, height: 28, borderRadius: 14,
                  backgroundColor: color,
                  opacity: 0.35,
                  shadowColor: color,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.9,
                  shadowRadius: 6,
                  elevation: 3,
                }} />
              )}
              <Text style={{
                fontSize: 12,
                fontWeight: isToday ? '900' : color ? '700' : '400',
                color: isToday ? BRAND
                  : color ? colors.text
                  : dow === 0 ? '#EF4444' : dow === 6 ? '#5AC8FA' : colors.text,
                zIndex: 1,
              }}>{day}</Text>
              {isToday && !color && (
                <View style={{ position: 'absolute', bottom: 2, width: 3, height: 3, borderRadius: 1.5, backgroundColor: BRAND }} />
              )}
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

function SessionCard({ session, conditionMap }: { session: TrainingSession; conditionMap: Record<string,number> }) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const typeLabel = t(`notebook.typeLabels.${session.session_type}`, { defaultValue: session.session_type })
  const typeColor = TYPE_COLORS[session.session_type] ?? '#888'
  const cond = session.condition_level ?? conditionMap[session.session_date]
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={() => setExpanded(e => !e)}
      style={[st.sessionCard, { backgroundColor: colors.surface2, borderColor: colors.border }]}
    >
      <View style={[st.typeBar, { backgroundColor: typeColor }]} />
      <View style={st.sessionBody}>
        <View style={st.sessionRow}>
          <Text style={[st.typeLabel, { color: typeColor }]}>{typeLabel}</Text>
          {session.event ? <Text style={[st.eventLabel, { color: colors.textSec }]}>{getEventLabel(session.event, language)}</Text> : null}
          <Text style={[st.dateLabel, { color: colors.textHint }]}>{session.session_date}</Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={13}
            color={colors.textHint}
            style={{ marginLeft: 'auto' as any }}
          />
        </View>
        <View style={st.sessionRow}>
          {session.time_ms   ? <Text style={[st.sessionStat, { color: colors.text }]}>{fmtTime(session.time_ms)}</Text>   : null}
          {session.distance_m? <Text style={[st.sessionStat, { color: colors.text }]}>{fmtDist(session.distance_m)}</Text> : null}
          {session.reps      ? <Text style={[st.sessionStat, { color: colors.text }]}>{t('notebook.sessionCard.reps', { n: session.reps })}</Text> : null}
          <View style={[st.fatiguePill, { backgroundColor: colors.inputBg }]}>
            <Text style={[st.fatigueNum, { color: colors.textSec }]}>{t('notebook.sessionCard.fatigue', { n: session.fatigue_level })}</Text>
          </View>
          {cond != null && (
            <View style={[st.fatiguePill, { backgroundColor: colors.inputBg }]}>
              <Text style={[st.fatigueNum, { color: colors.textSec }]}>{conditionEmoji(cond)} {t('notebook.sessionCard.condition', { n: cond })}</Text>
            </View>
          )}
        </View>
        {session.notes ? (
          <Text style={[st.notesText, { color: colors.textSec }]} numberOfLines={expanded ? undefined : 2}>
            {session.notes}
          </Text>
        ) : null}
        {expanded && (
          <View style={[st.expandedDetail, { borderTopColor: colors.border }]}>
            {session.time_ms    ? <Text style={[st.detailRow, { color: colors.textSec }]}>{t('notebook.sessionCard.detailTime', { v: fmtTime(session.time_ms) })}</Text>    : null}
            {session.distance_m ? <Text style={[st.detailRow, { color: colors.textSec }]}>{t('notebook.sessionCard.detailDistance', { v: fmtDist(session.distance_m) })}</Text>   : null}
            {session.reps       ? <Text style={[st.detailRow, { color: colors.textSec }]}>{t('notebook.sessionCard.detailReps', { n: session.reps })}</Text>                : null}
            {session.event      ? <Text style={[st.detailRow, { color: colors.textSec }]}>{t('notebook.sessionCard.detailEvent', { v: getEventLabel(session.event, language) })}</Text> : null}
            <Text style={[st.detailRow, { color: colors.textSec }]}>{t('notebook.sessionCard.detailFatigue', { n: session.fatigue_level })}</Text>
            {cond != null ? <Text style={[st.detailRow, { color: colors.textSec }]}>{t('notebook.sessionCard.detailCondition', { emoji: conditionEmoji(cond), n: cond })}</Text> : null}
            <Text style={[st.detailRow, { color: colors.textHint, fontSize: 10 }]}>{t('notebook.sessionCard.detailRecordedAt', { v: session.created_at?.slice(0,16).replace('T',' ') ?? '' })}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  )
}

export default function NotebookScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [sessions, setSessions]       = useState<TrainingSession[]>([])
  const [conditionMap, setConditionMap] = useState<Record<string,number>>({})
  const [loading, setLoading]         = useState(true)
  const [modal, setModal]             = useState(false)
  const [freeText, setFreeText]       = useState('')
  const [parsing, setParsing]         = useState(false)
  // setParsing(state)は次のレンダーまで反映されないため、連打防止は同期的なrefで行う
  const parsingRef = useRef(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rawSessions, rawCond] = await AsyncStorage.multiGet([SESSIONS_KEY, CONDITION_MAP_KEY])
      try { if (rawSessions[1]) setSessions(JSON.parse(rawSessions[1])) } catch {}
      try { if (rawCond[1])     setConditionMap(JSON.parse(rawCond[1])) } catch {}
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // 他画面から戻ってきた時にもリロード（manual-log等から保存後）
  useFocusEffect(useCallback(() => { load() }, [load]))

  const weekAgo   = localDateStr(new Date(Date.now() - 7 * 86400000))
  const monthAgo  = localDateStr(new Date(Date.now() - 30 * 86400000))
  const thisWeek  = sessions.filter(s => s.session_date >= weekAgo)
  const thisMonth = sessions.filter(s => s.session_date >= monthAgo)
  const avgFatigue = thisWeek.length > 0
    ? (thisWeek.reduce((a, s) => a + (s.fatigue_level ?? 5), 0) / thisWeek.length).toFixed(1)
    : '—'
  const totalKm = thisMonth.reduce((a, s) => a + (s.distance_m ?? 0), 0) / 1000

  async function handleSave() {
    if (!freeText.trim()) return
    // 二重タップ防止（setParsingは非同期反映なのでrefで同期的に防ぐ。button側のdisabledだけでは連打を防ぎきれない）
    if (parsingRef.current) return
    parsingRef.current = true
    setParsing(true)

    const today = todayLocalISO()

    // ── Step 1: まず正規表現でフォールバック解析 ──────────
    let parsed: Record<string, any> = fallbackParse(freeText, today)
    // 「300×6」のような明示的な掛け算表記は正規表現側の計算の方が確実なため、
    // AIの解析結果で誤って上書きされないよう控えておく
    const explicitMult = parseDistanceAndReps(freeText)

    // ── Step 2: AIでより正確に解析（無料枠/チケットがある時だけ。無ければ正規表現解析のまま保存する） ─
    try {
      const gate = await checkAdGate('notebook_ai')
      if (gate.allowed) {
        const _nb_apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
        const _nb_endpoint = `${_nb_apiBase}/api/analyze`
        const res = await fetchWithTimeout(_nb_endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(await getAiAuthHeader()) },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 500, feature: 'notebook_ai',
            messages: [{ role: 'user', content: `陸上競技の練習記録テキストを正確にJSONに変換してください。今日の日付は${today}です。\n\n入力テキスト:\n"${freeText}"\n\nルール:\n- session_type: interval(本数+レスト), tempo(ペース走), easy(ジョグ/LSD), long(長距離), sprint(全力短距離), drill(ドリル), strength(ウェイト/筋トレ), race(試合/大会), rest(休養)\n- time_ms: タイムをミリ秒整数に変換。「46秒80」→46800, 「1:28.50」→88500。なければnull\n- distance_m: 合計距離をメートル整数に変換。本数(reps)がある場合は「1本あたりの距離 × 本数」の合計値を入れること。例:「300m×6本」「300×6」→ distance_m=1800（300ではない）。「10km」→ distance_m=10000。なければnull\n- reps: 本数の整数。なければnull\n- fatigue_level: 疲労度1〜10の整数（明記なければ雰囲気から推定）\n- condition_level: 体調1〜10の整数（明記なければ6）\n- event: 100m/200m/300m/400m/800m/1000m/1500m/3000m/5000m/10000m/110mH/100mH/300mH/400mH/3000mSC/競歩/走幅跳/三段跳/走高跳/棒高跳/砲丸投/やり投/円盤投/ハンマー投 のいずれか、なければnull\n\nJSONのみ返答:\n{"session_date":"${today}","session_type":"...","event":"...orNull","time_ms":数値orNull,"distance_m":数値orNull,"reps":数値orNull,"fatigue_level":整数,"condition_level":整数}` }],
          }),
        }, 30000)
        if (res.ok) {
          const data = await res.json()
          const rawText = data.content?.[0]?.text ?? ''
          const jsonMatch = rawText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const aiParsed = JSON.parse(jsonMatch[0])
            // 種目・タイム・距離・本数は本文から一意に読み取れる客観的な値のため、
            // 正規表現側が既に検出できていればそちらを優先する（AIの解釈揺れで
            // 「書いた内容と違う結果になる」のを防ぐ）。AIはそれらが未検出の項目の
            // 補完と、文脈判断が要る session_type/fatigue_level/condition_level に使う
            for (const key of ['event', 'time_ms', 'distance_m', 'reps'] as const) {
              if (parsed[key] !== null && parsed[key] !== undefined) delete aiParsed[key]
            }
            parsed = { ...parsed, ...aiParsed }
            // AI解析に成功した場合のみ利用回数・チケットを消費する（失敗時に課金しないため）
            await recordUsage('notebook_ai')
          }
        }
      }
      // gate.allowed=false（チケット不足等）の場合は正規表現解析のまま保存する（記録自体は止めない）
    } catch {
      // AI解析失敗 → fallbackParse の結果をそのまま使う
    }
    // 明示的な「距離×本数」表記があった場合は、AIの解釈に関わらず計算済みの合計距離を優先する
    if (explicitMult.multiplied) {
      parsed.distance_m = explicitMult.distance_m
      parsed.reps = explicitMult.reps
    }

    // ── Step 3: 必ず保存 ──────────────────────────────────
    const toNum = (v: any) => (v !== null && v !== undefined && v !== 'null' && !isNaN(Number(v)) && Number(v) > 0) ? Number(v) : undefined
    try {
      const newSession: TrainingSession = {
        id: `local-${Date.now()}`, user_id: (await AsyncStorage.getItem('userId').catch(() => null)) ?? 'local', created_at: new Date().toISOString(),
        session_date:    parsed.session_date    || today,
        session_type:    parsed.session_type    || 'easy',
        event:           parsed.event && parsed.event !== 'null' && parsed.event !== null ? String(parsed.event) as any : undefined,
        time_ms:         toNum(parsed.time_ms),
        distance_m:      toNum(parsed.distance_m),
        reps:            toNum(parsed.reps),
        fatigue_level:   toNum(parsed.fatigue_level) ?? 5,
        condition_level: toNum(parsed.condition_level) ?? conditionMap[today] ?? 6,
        notes: freeText,
      }
      // 直列化キュー経由で保存（他画面の削除・保存と競合して片方が消えることを防ぐ）
      const next = await updateSessions(current => [newSession, ...current])
      setSessions(next)
      // 改善タスク生成
      saveImprovementTasks(newSession.session_type, newSession.fatigue_level ?? 5, freeText, t)
      Sounds.save()
      setFreeText(''); setModal(false)
      Toast.show({ type: 'success', text1: t('notebook.toastSuccess'), visibilityTime: 1500 })
    } catch {
      Toast.show({ type: 'error', text1: t('notebook.toastError') })
    } finally { parsingRef.current = false; setParsing(false) }
  }

  const iconColor = colors.text

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }}>

        {/* ── ヘッダー ── */}
        <View style={[st.header, { borderBottomColor: colors.border }]}>
          <Text style={[st.headerTitle, { color: colors.text }]}>{t('notebook.title')}</Text>
          <View style={st.headerActions}>
            <HapticTouch
              haptic="whoosh"
              style={[st.iconBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
              onPress={() => router.push('/gps-run')}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('notebook.gpsRun')}
            >
              <Ionicons name="navigate-outline" size={18} color={iconColor} />
            </HapticTouch>
            <HapticTouch
              haptic="whoosh"
              style={[st.iconBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
              onPress={() => router.push('/calendar')}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('notebook.calendar')}
            >
              <Ionicons name="calendar-outline" size={18} color={iconColor} />
            </HapticTouch>
          </View>
        </View>

        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>

          {/* ── 統計バー ── */}
          <View style={[st.statsRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {[
              { num: String(sessions.length), label: t('notebook.stats.total') },
              { num: String(thisWeek.length), label: t('notebook.stats.thisWeek') },
              { num: totalKm > 0 ? `${totalKm.toFixed(0)}km` : '—', label: t('notebook.stats.monthDistance') },
              { num: String(avgFatigue), label: t('notebook.stats.weekFatigue') },
            ].map((item, i) => (
              <View key={i} style={[st.statBox, i > 0 && { borderLeftWidth: 1, borderLeftColor: colors.border }]}>
                <Text style={[st.statNum, { color: colors.text }]}>{item.num}</Text>
                <Text style={[st.statLabel, { color: colors.textHint }]}>{item.label}</Text>
              </View>
            ))}
          </View>

          {/* ── 記録ボタン ── */}
          <HapticTouch haptic="whoosh" style={st.recordBtn} onPress={() => { unlockAudio(); Sounds.whoosh(); setModal(true) }} activeOpacity={0.85}>
            <Ionicons name="add-circle" size={20} color="#fff" />
            <Text style={st.recordBtnText}>{t('notebook.recordButton')}</Text>
          </HapticTouch>

          {/* ── 練習記録（枠組み・スクロール） ── */}
          <View style={[st.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={st.sectionHeader}>
              <Text style={[st.sectionTitle, { color: colors.text }]}>{t('notebook.sectionTitle')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {selectedDate && (
                  <TouchableOpacity
                    onPress={() => setSelectedDate(null)}
                    style={{ backgroundColor: BRAND + '18', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={{ color: BRAND, fontSize: 11, fontWeight: '700' }}>✕ {selectedDate.slice(5).replace('-', '/')}</Text>
                  </TouchableOpacity>
                )}
                <Text style={[st.sectionCount, { color: colors.textHint }]}>{t('notebook.recordCount', { n: sessions.length })}</Text>
              </View>
            </View>
            {loading ? (
              <View style={{ gap: 10 }}>
                {[1,2,3,4,5].map(i => <View key={i} style={{ height: 64, backgroundColor: colors.surface2, borderRadius: 10 }} />)}
              </View>
            ) : sessions.length === 0 ? (
              <View style={st.empty}>
                <Ionicons name="book-outline" size={40} color={colors.textHint} />
                <Text style={[st.emptyText, { color: colors.textSec }]}>{t('notebook.emptyTitle')}</Text>
                <Text style={[st.emptySubText, { color: colors.textHint }]}>{t('notebook.emptySub')}</Text>
              </View>
            ) : (() => {
              const filtered = selectedDate
                ? sessions.filter(s => s.session_date === selectedDate)
                : sessions
              return (
                <ScrollView
                  style={{ maxHeight: 340 }}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={filtered.length > 5}
                  contentContainerStyle={{ gap: 8 }}
                >
                  {filtered.slice(0, 5).map(item => (
                    <SessionCard key={item.id} session={item} conditionMap={conditionMap} />
                  ))}
                  {filtered.length > 5 && filtered.slice(5).map(item => (
                    <SessionCard key={item.id} session={item} conditionMap={conditionMap} />
                  ))}
                </ScrollView>
              )
            })()}
          </View>

          {/* ── ミニカレンダー ── */}
          <MiniCalendar sessions={sessions} onDayPress={setSelectedDate} />
        </ScrollView>

        {/* ── 入力モーダル ── */}
        <Modal visible={modal} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={st.modalContent}>
                <View style={st.modalHeader}>
                  <TouchableOpacity onPress={() => { setModal(false); setFreeText('') }}>
                    <Text style={{ color: colors.textSec, fontSize: 16 }}>{t('notebook.modal.cancel')}</Text>
                  </TouchableOpacity>
                  <Text style={[st.modalTitle, { color: colors.text }]}>{t('notebook.modal.title')}</Text>
                  <View style={{ width: 60 }} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <Text style={{ color: colors.textHint, fontSize: 13, lineHeight: 18, flex: 1, marginRight: 8 }}>
                    {t('notebook.modal.hint')}
                  </Text>
                  <View style={st.ticketBadge}>
                    <Text style={st.ticketBadgeText}>{t('notebook.modal.ticketBadge', { n: TICKET_COST.notebook_ai })}</Text>
                  </View>
                </View>
                <TextInput
                  style={[st.textInput, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.border }]}
                  value={freeText}
                  onChangeText={setFreeText}
                  multiline autoFocus
                  autoCorrect={false}
                  spellCheck={false}
                  placeholder={t('notebook.modal.placeholder')}
                  placeholderTextColor={colors.textHint}
                  textAlignVertical="top"
                />
                <HapticTouch
                  haptic="save"
                  style={[st.saveBtn, (!freeText.trim() || parsing) && { opacity: 0.4 }]}
                  onPress={handleSave} disabled={!freeText.trim() || parsing} activeOpacity={0.8}
                >
                  {parsing
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Ionicons name="sparkles" size={18} color="#fff" /><Text style={st.saveBtnText}>{t('notebook.modal.save')}</Text></>
                  }
                </HapticTouch>
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </Modal>

      </SafeAreaView>
    </View>
  )
}

const st = StyleSheet.create({
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle:   { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconBtn:       { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  scroll:        { padding: 16, gap: 14, paddingBottom: 48 },
  statsRow:      { flexDirection: 'row', borderRadius: 21, borderWidth: 1, overflow: 'hidden' },
  statBox:       { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 3 },
  statNum:       { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel:     { fontSize: 10, fontWeight: '600' },
  recordBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 21, paddingVertical: 16 },
  recordBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  card:          { borderRadius: 21, borderWidth: 1, padding: 16, gap: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle:  { fontSize: 15, fontWeight: '800' },
  sectionCount:  { fontSize: 13 },
  sessionCard:   { flexDirection: 'row', borderRadius: 16, overflow: 'hidden', borderWidth: 1 },
  typeBar:       { width: 4 },
  sessionBody:   { flex: 1, padding: 12, gap: 5 },
  sessionRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  typeLabel:     { fontSize: 12, fontWeight: '800' },
  eventLabel:    { fontSize: 12 },
  dateLabel:     { fontSize: 11, marginLeft: 'auto' as any },
  sessionStat:   { fontSize: 14, fontWeight: '700' },
  fatiguePill:   { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  fatigueNum:    { fontSize: 11 },
  notesText:     { fontSize: 12, lineHeight: 16 },
  expandedDetail:{ marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 3 },
  detailRow:     { fontSize: 12, lineHeight: 18 },
  empty:         { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyText:     { fontSize: 15 },
  emptySubText:  { fontSize: 12, textAlign: 'center' },
  modalContent:  { flex: 1, padding: 20 },
  modalHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle:    { fontSize: 17, fontWeight: '800' },
  textInput:     { flex: 1, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, lineHeight: 26, borderWidth: 1, marginBottom: 16 },
  saveBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND, borderRadius: 21, paddingVertical: 16 },
  saveBtnText:   { color: '#fff', fontSize: 16, fontWeight: '700' },
  ticketBadge:     { backgroundColor: 'rgba(245,158,11,0.14)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)', paddingHorizontal: 8, paddingVertical: 3 },
  ticketBadgeText: { fontSize: 11, fontWeight: '700', color: '#f59e0b' },
})

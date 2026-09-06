import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Animated, Alert,
} from 'react-native'
import { checkAdGate, recordUsage } from '../lib/adGate'
import AdGateModal from '../components/AdGateModal'
import TicketGateModal from '../components/TicketGateModal'
import Toast from 'react-native-toast-message'
import { useAuth } from '../context/AuthContext'
import Svg, {
  Circle, Ellipse, G, Rect,
  Text as SvgText, Image as SvgImage,
} from 'react-native-svg'

const BODY_FRONT = require('../assets/body/body-front.png')
const BODY_BACK  = require('../assets/body/body-back.png')
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter, useNavigation } from 'expo-router'
import { createStorageQueue } from '../lib/storageQueue'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../context/LanguageContext'

/* ─── 型定義 ─────────────────────────────────── */
type Severity = 'mild' | 'moderate' | 'severe'
type RecoveryResult = {
  suspected_condition: string; severity: Severity
  immediate_actions: string[]
  rice_protocol: { rest: string; ice: string; compression: string; elevation: string }
  taping: { purpose: string; method: string; tape_type: string }
  recovery_timeline: {
    phase1: { period: string; description: string }
    phase2: { period: string; description: string }
    phase3: { period: string; description: string }
  }
  exercises: string[]; see_doctor_if: string[]
  training_modification: string; medical_basis: string
}
type SavedRecord = { id: string; date: string; bodyParts: string[]; painLevel: number; result: RecoveryResult }

/* ─── ゾーン定義（複数選択用） ─────────────────── */
// labelは言語依存のためlocales('recovery.zones.<id>')に移し、ZoneDef自体はidのみ持つ
type ZoneDef = {
  id: string
  front?: ZoneShape; back?: ZoneShape
}
type ZoneShape =
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }

// Hermesの AbortSignal.timeout 非対応に対応したタイムアウト付きfetch
function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return fetch(url, { ...options, signal: AbortSignal.timeout(ms) })
  }
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id))
}

// 座標はAI生成イラスト(assets/body/body-front.png・body-back.png、220×370のviewBox基準)に
// 実測でフィットさせている。イラストを差し替えた場合はここも合わせて調整すること。
// 2026-07-29: イラスト差し替え(通常の人体比率)に伴い、シルエットのピクセル解析に基づき全ゾーンを再calibrate。
const ZONES: ZoneDef[] = [
  { id:'head',        front:{type:'circle', cx:110,cy:43,r:20},           back:{type:'circle', cx:110,cy:43,r:20} },
  { id:'neck',        front:{type:'ellipse',cx:110,cy:61,rx:10,ry:6},    back:{type:'ellipse',cx:110,cy:61,rx:10,ry:6} },
  { id:'shoulder_l',  front:{type:'ellipse',cx:79, cy:72, rx:18,ry:16},  back:{type:'ellipse',cx:79, cy:72, rx:18,ry:16} },
  { id:'shoulder_r',  front:{type:'ellipse',cx:142,cy:72, rx:18,ry:16},  back:{type:'ellipse',cx:142,cy:72, rx:18,ry:16} },
  { id:'chest',       front:{type:'ellipse',cx:110,cy:110,rx:40,ry:22} },
  { id:'upper_back',  back:{type:'ellipse', cx:110,cy:110,rx:40,ry:22} },
  { id:'belly',       front:{type:'ellipse',cx:110,cy:168,rx:30,ry:26} },
  { id:'lower_back',  back:{type:'ellipse', cx:110,cy:168,rx:30,ry:26} },
  { id:'upper_arm_l', front:{type:'ellipse',cx:72, cy:96, rx:13,ry:24},  back:{type:'ellipse',cx:72, cy:96, rx:13,ry:24} },
  { id:'upper_arm_r', front:{type:'ellipse',cx:149,cy:96, rx:13,ry:24},  back:{type:'ellipse',cx:149,cy:96, rx:13,ry:24} },
  { id:'elbow_l',     front:{type:'ellipse',cx:64, cy:121,rx:11,ry:10},  back:{type:'ellipse',cx:64, cy:121,rx:11,ry:10} },
  { id:'elbow_r',     front:{type:'ellipse',cx:156,cy:121,rx:11,ry:10},  back:{type:'ellipse',cx:156,cy:121,rx:11,ry:10} },
  { id:'forearm_l',   front:{type:'ellipse',cx:58, cy:145,rx:11,ry:24},  back:{type:'ellipse',cx:58, cy:145,rx:11,ry:24} },
  { id:'forearm_r',   front:{type:'ellipse',cx:163,cy:145,rx:11,ry:24},  back:{type:'ellipse',cx:163,cy:145,rx:11,ry:24} },
  { id:'wrist_l',     front:{type:'ellipse',cx:52, cy:169,rx:9, ry:8},   back:{type:'ellipse',cx:52, cy:169,rx:9, ry:8} },
  { id:'wrist_r',     front:{type:'ellipse',cx:169,cy:169,rx:9, ry:8},   back:{type:'ellipse',cx:169,cy:169,rx:9, ry:8} },
  { id:'hip_l',       front:{type:'ellipse',cx:90, cy:193,rx:16,ry:14},  back:{type:'ellipse',cx:90, cy:193,rx:16,ry:14} },
  { id:'hip_r',       front:{type:'ellipse',cx:130,cy:193,rx:16,ry:14},  back:{type:'ellipse',cx:130,cy:193,rx:16,ry:14} },
  { id:'groin',       front:{type:'ellipse',cx:110,cy:203,rx:12,ry:9} },
  { id:'buttock',     back:{type:'ellipse', cx:110,cy:200,rx:30,ry:16} },
  { id:'quad_l',      front:{type:'ellipse',cx:91, cy:224,rx:15,ry:27} },
  { id:'quad_r',      front:{type:'ellipse',cx:129,cy:224,rx:15,ry:27} },
  { id:'hamstring_l', back:{type:'ellipse', cx:91, cy:224,rx:15,ry:27} },
  { id:'hamstring_r', back:{type:'ellipse', cx:129,cy:224,rx:15,ry:27} },
  { id:'it_band_l',   front:{type:'ellipse',cx:76, cy:224,rx:6, ry:27},  back:{type:'ellipse',cx:76, cy:224,rx:6, ry:27} },
  { id:'it_band_r',   front:{type:'ellipse',cx:144,cy:224,rx:6, ry:27},  back:{type:'ellipse',cx:144,cy:224,rx:6, ry:27} },
  { id:'knee_l',      front:{type:'ellipse',cx:91, cy:253,rx:13,ry:11},  back:{type:'ellipse',cx:91, cy:253,rx:13,ry:11} },
  { id:'knee_r',      front:{type:'ellipse',cx:129,cy:253,rx:13,ry:11},  back:{type:'ellipse',cx:129,cy:253,rx:13,ry:11} },
  { id:'shin_l',      front:{type:'ellipse',cx:82, cy:292,rx:11,ry:32} },
  { id:'shin_r',      front:{type:'ellipse',cx:138,cy:292,rx:11,ry:32} },
  { id:'calf_l',      back:{type:'ellipse', cx:82, cy:292,rx:11,ry:32} },
  { id:'calf_r',      back:{type:'ellipse', cx:138,cy:292,rx:11,ry:32} },
  { id:'achilles_l',  back:{type:'ellipse', cx:77, cy:324,rx:7, ry:10} },
  { id:'achilles_r',  back:{type:'ellipse', cx:143,cy:324,rx:7, ry:10} },
  { id:'ankle_l',     front:{type:'ellipse',cx:77, cy:324,rx:8, ry:8},   back:{type:'ellipse',cx:77, cy:324,rx:8, ry:8} },
  { id:'ankle_r',     front:{type:'ellipse',cx:143,cy:324,rx:8, ry:8},   back:{type:'ellipse',cx:143,cy:324,rx:8, ry:8} },
  { id:'foot_l',      front:{type:'ellipse',cx:75, cy:337,rx:15,ry:8},   back:{type:'ellipse',cx:75, cy:337,rx:15,ry:8} },
  { id:'foot_r',      front:{type:'ellipse',cx:145,cy:337,rx:15,ry:8},   back:{type:'ellipse',cx:145,cy:337,rx:15,ry:8} },
]

// labelはlocales('recovery.painTypes'/'timingOptions'/'durationOptions'/'severity')側に移し、idのみ保持
const PAIN_TYPES     = [{id:'sharp'},{id:'dull'},{id:'burning'},{id:'aching'}]
const TIMING_OPTIONS = [{id:'during'},{id:'after'},{id:'both'},{id:'constant'}]
const DURATION_OPTIONS=[{id:'today'},{id:'3days'},{id:'week'},{id:'month'}]
const SEVERITY_COLOR = { mild:'#34C759', moderate:'#FF9500', severe:'#FF3B30' }
const STORAGE_KEY = 'trackmate_recovery_records'
const RECOVERY_CACHE_KEY = 'trackmate_recovery_ai_cache_v1'
// askAI(分析→保存)と deleteRecord(削除) が同じ history state を基点に非同期で
// 読み書きするため、直列化して lost update を防ぐ
const recoveryStore = createStorageQueue<SavedRecord[]>(STORAGE_KEY, [])

/* ════════════════════════════════════════════ */
export default function RecoveryScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { language } = useLanguage()
  const navigation = useNavigation()
  useEffect(() => { navigation.setOptions({ title: t('recovery.headerTitle') }) }, [navigation, t, language])
  const [bodyParts, setBodyParts] = useState<string[]>([])
  const [painLevel, setPainLevel] = useState(5)
  const [painType,  setPainType]  = useState('')
  const [timing,    setTiming]    = useState('')
  const [duration,  setDuration]  = useState('')
  const [notes,     setNotes]     = useState('')
  const [view,      setView]      = useState<'front'|'back'>('front')
  const [loading,   setLoading]   = useState(false)
  const [result,    setResult]    = useState<RecoveryResult|null>(null)
  const [history,   setHistory]   = useState<SavedRecord[]>([])
  const [tab,       setTab]       = useState<'input'|'result'|'history'>('input')
  const [apiError,  setApiError]  = useState('')
  const { isGuest } = useAuth()
  const [adGateVisible,     setAdGateVisible]     = useState(false)
  const [adGateRemaining,   setAdGateRemaining]   = useState(0)
  const [adGateHardLimited, setAdGateHardLimited] = useState(false)
  const [adGateLimitType,   setAdGateLimitType]   = useState<'none'|'daily'|'monthly'|'total'|'window'>('none')
  const [ticketGateVisible, setTicketGateVisible] = useState(false)
  const [ticketGateCost,    setTicketGateCost]    = useState(0)
  const [ticketGateBalance, setTicketGateBalance] = useState(0)
  const fadeAnim = useRef(new Animated.Value(1)).current
  // AdGate async チェック中の二重タップ防止
  const askingRef = useRef(false)

  const fadeIn = () => {
    fadeAnim.setValue(0)
    Animated.timing(fadeAnim,{toValue:1,duration:260,useNativeDriver:true}).start()
  }

  useEffect(() => {
    recoveryStore.get().then(setHistory).catch(()=>{})
  },[])

  const togglePart = (id: string) => {
    setBodyParts(prev => prev.includes(id) ? prev.filter(p=>p!==id) : [...prev, id])
  }

  /* ── AI相談 ── */
  const askAICore = async (needsTicket = false, ticketCost = 0) => {
    setApiError('')
    setLoading(true)

    const partLabels   = bodyParts.map(id => t(`recovery.zones.${id}`, { defaultValue: id })).join('、')
    const typeLabel    = painType ? t(`recovery.painTypes.${painType}`) : ''
    const timingLabel  = timing ? t(`recovery.timingOptions.${timing}`) : ''
    const durLabel     = duration ? t(`recovery.durationOptions.${duration}`) : t('recovery.durationUnknown')
    const promptLanguageLine = t('recovery.promptLanguageLine')
    const _apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
    const _endpoint = `${_apiBase}/api/analyze`

    // ── 結果キャッシュ: 同一入力なら API を再呼び出しせず保存済み結果を返す（コスト削減） ──
    const _cacheSig = JSON.stringify([[...bodyParts].sort(), painLevel, painType, timing, duration, (notes||'').trim()])
    try {
      const _raw = await AsyncStorage.getItem(RECOVERY_CACHE_KEY)
      if (_raw) {
        const _cache: Array<{ sig: string; result: RecoveryResult }> = JSON.parse(_raw)
        const _hit = _cache.find(c => c.sig === _cacheSig)
        if (_hit) {
          setResult(_hit.result)
          setTab('result'); fadeIn()
          setLoading(false)
          return
        }
      }
    } catch {}

    try {
      const res = await fetchWithTimeout(_endpoint, {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body: JSON.stringify({
          model:'claude-haiku-4-5-20251001', max_tokens:2500,
          messages:[{ role:'user', content:
`あなたは陸上競技に詳しいスポーツトレーナーです。選手の症状をもとに、ケアと回復のアドバイスをしてください。医療診断ではなく、参考情報として提供してください。

部位:${partLabels} / 痛みLv:${painLevel}/10 / 性質:${typeLabel} / タイミング:${timingLabel} / 期間:${durLabel}
追加:${notes||'なし'}

以下JSONのみで返答（他テキスト不要）:
{"suspected_condition":"傷害名","severity":"mild|moderate|severe","immediate_actions":["今すぐすること1","2","3"],"rice_protocol":{"rest":"安静方法","ice":"アイシング方法と時間","compression":"圧迫方法","elevation":"挙上方法"},"taping":{"purpose":"目的","method":"ステップバイステップの貼り方（テープの向き・角度・長さを具体的に）","tape_type":"推奨テープ種類"},"recovery_timeline":{"phase1":{"period":"0〜3日","description":"急性期の対応"},"phase2":{"period":"4〜14日","description":"回復期のリハビリ"},"phase3":{"period":"2〜8週","description":"競技復帰プロセス"}},"exercises":["エクササイズ1（回数・方法）","2","3"],"see_doctor_if":["病院受診サイン1","2","3"],"training_modification":"代替練習と注意点","medical_basis":"医学的根拠の説明"}${promptLanguageLine ? '\n' + promptLanguageLine : ''}`
          }]
        }),
      }, 35000)
      if (!res.ok) {
        // 変数名'errText': useTranslation()のt関数をシャドウイングしないよう明示的に改名
        // (以前ここは const t = await res.text() だった。他の同種ファイルで実際にクラッシュを
        // 引き起こした命名パターンのため、この画面のi18n対応時にあわせて修正)
        const errText = await res.text()
        throw new Error(`HTTP ${res.status}: ${errText.slice(0,120)}`)
      }
      const data  = await res.json()
      const text  = data.content?.[0]?.text ?? ''
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) throw new Error(`JSONなし: ${text.slice(0,80)}`)
      let parsed: RecoveryResult
      try {
        parsed = JSON.parse(match[0])
      } catch {
        throw new Error(`JSON解析失敗（レスポンスが不完全です）: ${text.slice(0, 60)}`)
      }
      setResult(parsed)
      const rec: SavedRecord = {
        id:Date.now().toString(), date:new Date().toLocaleDateString(language === 'en' ? 'en-US' : 'ja-JP'),
        bodyParts, painLevel, result:parsed,
      }
      const upd = await recoveryStore.update(current => [rec, ...current].slice(0, 20))
      setHistory(upd)

      // AI相談に成功した場合のみ利用回数・チケットを消費する（失敗時に課金しないため）
      await recordUsage('recovery')
      if (needsTicket) Toast.show({ type: 'info', text1: t('recovery.ticketUsedToast', { n: ticketCost }), visibilityTime: 1800 })
      // 結果をキャッシュに保存（同一入力の再分析でAPIコストを発生させない）
      try {
        const _raw = await AsyncStorage.getItem(RECOVERY_CACHE_KEY)
        const _cache: Array<{ sig: string; result: RecoveryResult }> = _raw ? JSON.parse(_raw) : []
        const _next = [{ sig: _cacheSig, result: parsed }, ..._cache.filter(c => c.sig !== _cacheSig)].slice(0, 30)
        await AsyncStorage.setItem(RECOVERY_CACHE_KEY, JSON.stringify(_next))
      } catch {}
      setTab('result'); fadeIn()
    } catch(e: unknown) {
      setApiError(t('recovery.errGeneric', { message: e instanceof Error ? e.message : String(e) }))
    } finally { setLoading(false) }
  }

  const deleteRecord = (id: string) => {
    Alert.alert(t('recovery.deleteConfirmTitle'), t('recovery.deleteConfirmBody'), [
      { text: t('recovery.cancel'), style: 'cancel' },
      {
        text: t('recovery.delete'), style: 'destructive',
        onPress: async () => {
          const upd = await recoveryStore.update(current => current.filter(r => r.id !== id))
          setHistory(upd)
        },
      },
    ])
  }

  const askAI = async () => {
    if (askingRef.current) return  // 二重タップ防止
    if (bodyParts.length === 0) { setApiError(t('recovery.errNoBodyPart')); return }
    if (!painType) { setApiError(t('recovery.errNoPainType')); return }
    if (!timing)   { setApiError(t('recovery.errNoTiming')); return }
    // ゲストはログイン必須
    if (isGuest) { setAdGateRemaining(0); setAdGateHardLimited(false); setAdGateLimitType('none'); setAdGateVisible(true); return }
    askingRef.current = true
    try {
      const gate = await checkAdGate('recovery')
      if (!gate.allowed) {
        if (gate.needsTicket) { setTicketGateCost(gate.ticketCost); setTicketGateBalance(gate.ticketBalance); setTicketGateVisible(true) }
        else {
          setAdGateRemaining(gate.remaining)
          setAdGateHardLimited(gate.hardLimited)
          setAdGateLimitType(gate.limitType)
          setAdGateVisible(true)
        }
        return
      }
      await askAICore(gate.needsTicket, gate.ticketCost)
    } finally {
      askingRef.current = false
    }
  }

  /* ════ RENDER ════ */
  return (
    <View style={s.bg}>
      <View style={s.tabBar}>
        {[['input',t('recovery.tabInput')],['result',t('recovery.tabResult')],['history',t('recovery.tabHistory')]].map(([k,l])=>(
          <TouchableOpacity key={k} style={[s.tabItem,tab===k&&s.tabActive]}
            onPress={()=>{setTab(k as any);fadeIn()}}>
            <Text style={[s.tabTxt,tab===k&&s.tabTxtActive]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Animated.View style={{flex:1,opacity:fadeAnim}}>

        {/* ══ 症状入力 ══ */}
        {tab==='input' && (
          <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

            {/* ─ 免責バナー ─ */}
            <View style={s.disclaimerBanner}>
              <Ionicons name="warning-outline" size={15} color="#FF9500" />
              <Text style={s.disclaimerBannerTxt}>
                {t('recovery.disclaimerBanner')}
              </Text>
            </View>

            {/* ─ ボディマップ ─ */}
            <Text style={s.secTitle}>{t('recovery.bodyMapTitle')}
              <Text style={{color:'#E53935',fontSize:12}}>{t('recovery.multiSelectNote')}</Text>
            </Text>

            {/* 選択済みバッジ */}
            {bodyParts.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:8}}>
                {bodyParts.map(id=>{
                  return (
                    <TouchableOpacity key={id} style={s.selectedBadge} onPress={()=>togglePart(id)}>
                      <Text style={s.selectedTxt}>{t(`recovery.zones.${id}`, { defaultValue: id })}</Text>
                      <Ionicons name="close-circle" size={14} color="#E53935" />
                    </TouchableOpacity>
                  )
                })}
                <TouchableOpacity style={s.clearAll} onPress={()=>setBodyParts([])}>
                  <Text style={{color:'#555',fontSize:11}}>{t('recovery.clearAll')}</Text>
                </TouchableOpacity>
              </ScrollView>
            )}

            {/* 前後切替 */}
            <View style={s.viewToggle}>
              <TouchableOpacity style={[s.viewBtn,view==='front'&&s.viewBtnActive]} onPress={()=>setView('front')}>
                <Text style={[s.viewBtnTxt,view==='front'&&s.viewBtnTxtActive]}>{t('recovery.viewFront')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.viewBtn,view==='back'&&s.viewBtnActive]} onPress={()=>setView('back')}>
                <Text style={[s.viewBtnTxt,view==='back'&&s.viewBtnTxtActive]}>{t('recovery.viewBack')}</Text>
              </TouchableOpacity>
            </View>

            {/* ボディマップSVG */}
            <View style={s.svgWrap}>
              <BodyMap view={view} selected={bodyParts} onToggle={togglePart} />
            </View>

            {/* 痛みレベル */}
            <Text style={s.secTitle}>{t('recovery.painLevelTitle')}<Text style={{color:'#E53935'}}>{painLevel}/10</Text></Text>
            <View style={s.levelRow}>
              {[1,2,3,4,5,6,7,8,9,10].map(n=>{
                const col = n<=3?'#34C759':n<=6?'#FF9500':'#FF3B30'
                return (
                  <TouchableOpacity key={n}
                    style={[s.levelBtn,{borderColor:col},painLevel===n&&{backgroundColor:col}]}
                    onPress={()=>setPainLevel(n)}
                    hitSlop={{top:4,bottom:4,left:2,right:2}}
                    accessibilityLabel={t('recovery.painLevelA11y', { n })}>
                    <Text style={[s.levelTxt,painLevel===n&&{color:'#fff',fontWeight:'800'}]}>{n}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={s.secTitle}>{t('recovery.painTypeTitle')}</Text>
            <View style={s.chipRow}>
              {PAIN_TYPES.map(p=>(
                <TouchableOpacity key={p.id} style={[s.chip,painType===p.id&&s.chipActive]} onPress={()=>setPainType(p.id)}>
                  <Text style={[s.chipTxt,painType===p.id&&s.chipTxtActive]}>{t(`recovery.painTypes.${p.id}`)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.secTitle}>{t('recovery.timingTitle')}</Text>
            <View style={s.chipRow}>
              {TIMING_OPTIONS.map(p=>(
                <TouchableOpacity key={p.id} style={[s.chip,timing===p.id&&s.chipActive]} onPress={()=>setTiming(p.id)}>
                  <Text style={[s.chipTxt,timing===p.id&&s.chipTxtActive]}>{t(`recovery.timingOptions.${p.id}`)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.secTitle}>{t('recovery.durationTitle')}</Text>
            <View style={s.chipRow}>
              {DURATION_OPTIONS.map(p=>(
                <TouchableOpacity key={p.id} style={[s.chip,duration===p.id&&s.chipActive]} onPress={()=>setDuration(p.id)}>
                  <Text style={[s.chipTxt,duration===p.id&&s.chipTxtActive]}>{t(`recovery.durationOptions.${p.id}`)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.secTitle}>{t('recovery.notesTitle')}</Text>
            <TextInput style={s.notesInput} value={notes} onChangeText={setNotes}
              placeholder={t('recovery.notesPlaceholder')} placeholderTextColor="#9ca3af"
              multiline numberOfLines={3} />

            {apiError ? (
              <View style={s.errorBox}>
                <Ionicons name="alert-circle" size={14} color="#FF3B30" />
                <Text style={s.errorTxt}>{apiError}</Text>
              </View>
            ) : null}

            <View style={s.disclaimer}>
              <Ionicons name="information-circle-outline" size={13} color="#6b7280" />
              <Text style={s.disclaimerTxt}>{t('recovery.staticDisclaimer')}</Text>
            </View>

            <View style={[s.ticketCostBadge, { backgroundColor: '#16653422', borderColor: '#166534' }]}>
              <Text style={[s.ticketCostBadgeText, { color: '#166534' }]}>{t('recovery.free')}</Text>
            </View>

            <TouchableOpacity style={[s.submitBtn,loading&&{opacity:0.6}]} onPress={askAI} disabled={loading}>
              {loading
                ? <><ActivityIndicator color="#fff"/><Text style={s.submitTxt}>{t('recovery.analyzing')}</Text></>
                : <><Ionicons name="body-outline" size={20} color="#fff"/><Text style={s.submitTxt}>{t('recovery.submitBtn')}</Text></>
              }
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ══ 診断結果 ══ */}
        {tab==='result' && (
          <ScrollView contentContainerStyle={s.content}>
            {!result
              ? <View style={s.empty}><Ionicons name="medkit-outline" size={48} color="#9ca3af"/><Text style={s.emptyTxt}>{t('recovery.emptyResult')}</Text></View>
              : <ResultView result={result} onBack={()=>setTab('input')} />
            }
          </ScrollView>
        )}

        {/* ══ 履歴 ══ */}
        {tab==='history' && (
          <ScrollView contentContainerStyle={s.content}>
            {history.length===0
              ? <View style={s.empty}><Ionicons name="time-outline" size={48} color="#9ca3af"/><Text style={s.emptyTxt}>{t('recovery.emptyHistory')}</Text></View>
              : history.map(rec=>(
                <TouchableOpacity key={rec.id} style={s.histCard}
                  onPress={()=>{setResult(rec.result);setTab('result');fadeIn()}}>
                  <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:4}}>
                    <Text style={s.histDate}>{rec.date}</Text>
                    <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
                      <SevBadge severity={rec.result.severity}/>
                      <TouchableOpacity
                        onPress={(e)=>{e.stopPropagation();deleteRecord(rec.id)}}
                        hitSlop={{top:8,bottom:8,left:8,right:8}}
                        accessibilityLabel={t('recovery.deleteLabel')}
                      >
                        <Ionicons name="trash-outline" size={18} color="#ef4444"/>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <Text style={s.histPart}>📍 {rec.bodyParts.map(id=>t(`recovery.zones.${id}`, { defaultValue: id })).join(' / ')}　Lv.{rec.painLevel}</Text>
                  <Text style={s.histDiag}>{rec.result.suspected_condition}</Text>
                  <Ionicons name="chevron-forward" size={15} color="#9ca3af" style={{position:'absolute',right:12,top:20}}/>
                </TouchableOpacity>
              ))
            }
          </ScrollView>
        )}
      </Animated.View>

      <AdGateModal
        visible={adGateVisible}
        feature="recovery"
        remaining={adGateRemaining}
        hardLimited={adGateHardLimited}
        limitType={adGateLimitType}
        isGuest={isGuest}
        onClose={() => setAdGateVisible(false)}
        onAdWatched={async () => {
          setAdGateVisible(false)
          // 使用記録は askAICore が成功時にのみ行う(ここで先に記録すると二重課金・失敗時課金になる)
          await askAICore()
        }}
        onUpgrade={() => {
          setAdGateVisible(false)
          router.push('/paywall')
        }}
      />

      <TicketGateModal
        visible={ticketGateVisible}
        feature="recovery"
        ticketCost={ticketGateCost}
        ticketBalance={ticketGateBalance}
        onClose={() => setTicketGateVisible(false)}
      />
    </View>
  )
}

/* ─── なめらか人体図 SVG ──────────────────────── */
function BodyMap({ view, selected, onToggle }: {
  view:'front'|'back'; selected:string[]; onToggle:(id:string)=>void
}) {
  const { t } = useTranslation()
  const W=220, H=370
  const DISPLAY_SCALE = 1.4  // タップ判定座標系(220×370)はそのままに、表示サイズだけ拡大する
  // 手首・足首・アキレス腱など小さい部位は、見た目の形はそのままにタップ判定だけ広げる
  // （見た目の選択ハイライトは実寸のまま、別レイヤーの透明な当たり判定を上乗せする）
  // 20pt程度まで広げると密集部位（首・肩・鼠径部など）同士のタップ判定が
  // 大きく重なってしまうため、隣接部位を誤タップしない範囲で控えめに拡大する
  const MIN_HIT_R = 11  // viewBox座標系での最小半径（画面上でおよそ半径15pt = 直径31pt相当）
  const zones = ZONES.filter(z => view==='front' ? !!z.front : !!z.back)
  const getShape = (z: ZoneDef) => view==='front' ? z.front! : z.back!
  const getLabelY = (shape: ZoneShape) => {
    if (shape.type==='circle') return shape.cy - shape.r - 7
    return shape.cy - shape.ry - 7
  }

  return (
    <Svg width={W*DISPLAY_SCALE} height={H*DISPLAY_SCALE} viewBox={`0 0 ${W} ${H}`}>
      {/* 背景（react-native-svg の style prop が効かない環境対策） */}
      <Rect x={0} y={0} width={W} height={H} fill="#f8fafc" rx={14} ry={14} />

      {/* なめらかボディシルエット */}
      <AnatomicalBody view={view} />

      {/* ゾーンオーバーレイ */}
      {zones.map(zone => {
        const shape = getShape(zone)
        const sel   = selected.includes(zone.id)

        return (
          <G key={zone.id} onPress={() => onToggle(zone.id)}>
            {/* 拡大タップ判定（常に透明。見た目のサイズは変えずタップ範囲だけ広げる） */}
            {shape.type==='circle'
              ? (shape.r < MIN_HIT_R && <Circle cx={shape.cx} cy={shape.cy} r={MIN_HIT_R} fill="rgba(0,0,0,0.001)"/>)
              : ((shape.rx < MIN_HIT_R || shape.ry < MIN_HIT_R) &&
                  <Ellipse cx={shape.cx} cy={shape.cy} rx={Math.max(shape.rx,MIN_HIT_R)} ry={Math.max(shape.ry,MIN_HIT_R)} fill="rgba(0,0,0,0.001)"/>)
            }

            {/* 選択時グロー */}
            {sel && shape.type==='circle' && (
              <Circle cx={shape.cx} cy={shape.cy} r={shape.r+7}
                fill="rgba(229,57,53,0.10)" stroke="rgba(229,57,53,0.25)" strokeWidth={2.5}/>
            )}
            {sel && shape.type==='ellipse' && (
              <Ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx+6} ry={shape.ry+6}
                fill="rgba(229,57,53,0.10)" stroke="rgba(229,57,53,0.25)" strokeWidth={2.5}/>
            )}

            {/* タップ領域（ほぼ透明） */}
            {shape.type==='circle'
              ? <Circle cx={shape.cx} cy={shape.cy} r={shape.r}
                  fill={sel ? 'rgba(229,57,53,0.20)' : 'rgba(0,0,0,0.001)'}
                  stroke={sel ? '#E53935' : 'rgba(0,0,0,0)'}
                  strokeWidth={sel ? 1.8 : 0}/>
              : <Ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry}
                  fill={sel ? 'rgba(229,57,53,0.20)' : 'rgba(0,0,0,0.001)'}
                  stroke={sel ? '#E53935' : 'rgba(0,0,0,0)'}
                  strokeWidth={sel ? 1.8 : 0}/>
            }

            {/* 選択ラベル */}
            {sel && (
              <G>
                <Rect x={shape.cx-34} y={getLabelY(shape)-13} width={68} height={15} rx={7}
                  fill="rgba(229,57,53,0.92)"/>
                <SvgText x={shape.cx} y={getLabelY(shape)-1.5}
                  textAnchor="middle" fill="#fff" fontSize={8} fontWeight="bold">
                  {t(`recovery.zones.${zone.id}`, { defaultValue: zone.id })}
                </SvgText>
              </G>
            )}
          </G>
        )
      })}

      {selected.length===0 && (
        <SvgText x={110} y={H-6} textAnchor="middle" fill="rgba(0,0,0,0.28)" fontSize={9}>
          {t('recovery.bodyMapHint')}
        </SvgText>
      )}
    </Svg>
  )
}

/* ─── 人体シルエット（AI生成イラストを既存タップ座標系にフィット） ────── */
function AnatomicalBody({ view }: { view:'front'|'back' }) {
  const W = 220, H = 370
  return (
    <SvgImage
      href={view === 'front' ? BODY_FRONT : BODY_BACK}
      x={0} y={0} width={W} height={H}
      preserveAspectRatio="none"
    />
  )
}


/* ─── 診断結果ビュー ────────────────────────────── */
function ResultView({ result, onBack }: { result:RecoveryResult; onBack:()=>void }) {
  const { t } = useTranslation()
  return (
    <>
      <View style={s.disclaimerBanner}>
        <Ionicons name="warning-outline" size={15} color="#FF9500" />
        <Text style={s.disclaimerBannerTxt}>
          {t('recovery.disclaimerBanner')}
        </Text>
      </View>

      <View style={[s.diagCard,{borderLeftColor:SEVERITY_COLOR[result.severity]}]}>
        <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
          <Text style={{color:'#6b7280',fontSize:11,fontWeight:'800'}}>{t('recovery.suspectedConditionLabel')}</Text>
          <SevBadge severity={result.severity}/>
        </View>
        <Text style={{color:'#111827',fontSize:20,fontWeight:'900'}}>{result.suspected_condition}</Text>
      </View>

      <Sec icon="flash" title={t('recovery.secImmediate')} color="#E53935">
        {result.immediate_actions.map((a,i)=><Bullet key={i} text={a} color="#E53935"/>)}
      </Sec>

      <Sec icon="snow" title={t('recovery.secRice')} color="#4A9FFF">
        {(['rest','ice','compression','elevation'] as const).map(k=>(
          <View key={k} style={s.riceRow}>
            <Text style={s.riceLabel}>
              {t(`recovery.riceLabels.${k}`)}
            </Text>
            <Text style={s.riceVal}>{result.rice_protocol[k]}</Text>
          </View>
        ))}
      </Sec>

      <Sec icon="bandage" title={t('recovery.secTaping')} color="#FF9500">
        <View style={{flexDirection:'row',gap:10,marginBottom:10}}>
          <View style={{flex:1}}>
            <Text style={[s.riceLabel,{color:'#FF9500'}]}>{t('recovery.tapingPurpose')}</Text>
            <Text style={s.riceVal}>{result.taping.purpose}</Text>
          </View>
          <View style={{flex:1}}>
            <Text style={[s.riceLabel,{color:'#FF9500'}]}>{t('recovery.tapingType')}</Text>
            <Text style={s.riceVal}>{result.taping.tape_type}</Text>
          </View>
        </View>
        <Text style={[s.riceLabel,{color:'#6b7280',marginBottom:6}]}>{t('recovery.tapingHow')}</Text>
        <Text style={{color:'#374151',fontSize:13,lineHeight:22}}>{result.taping.method}</Text>
      </Sec>

      <Sec icon="time" title={t('recovery.secTimeline')} color="#34C759">
        {[result.recovery_timeline.phase1,result.recovery_timeline.phase2,result.recovery_timeline.phase3].map((ph,i)=>(
          <View key={i} style={s.tlRow}>
            <View style={[s.tlDot,{backgroundColor:i===0?'#E53935':i===1?'#FF9500':'#34C759'}]}/>
            <View style={{flex:1}}>
              <Text style={{color:'#111827',fontSize:12,fontWeight:'800',marginBottom:3}}>{ph.period}</Text>
              <Text style={{color:'#4b5563',fontSize:13,lineHeight:19}}>{ph.description}</Text>
            </View>
          </View>
        ))}
      </Sec>

      <Sec icon="fitness" title={t('recovery.secExercises')} color="#A855F7">
        {result.exercises.map((e,i)=><Bullet key={i} text={e} color="#A855F7"/>)}
      </Sec>

      <Sec icon="barbell" title={t('recovery.secTrainingMod')} color="#FF9500">
        <Text style={{color:'#374151',fontSize:13,lineHeight:20}}>{result.training_modification}</Text>
      </Sec>

      <Sec icon="alert-circle" title={t('recovery.secSeeDoctor')} color="#FF3B30">
        {result.see_doctor_if.map((e,i)=><Bullet key={i} text={e} color="#FF3B30"/>)}
      </Sec>

      <Sec icon="library" title={t('recovery.secReference')} color="#9ca3af">
        <Text style={{color:'#6b7280',fontSize:12,lineHeight:20,fontStyle:'italic'}}>{result.medical_basis}</Text>
      </Sec>

      <TouchableOpacity style={s.reBtn} onPress={onBack}>
        <Ionicons name="refresh-outline" size={14} color="#6b7280"/>
        <Text style={s.reBtnTxt}>{t('recovery.reBtn')}</Text>
      </TouchableOpacity>
    </>
  )
}

/* ─── 小コンポーネント ─── */
function Sec({icon,title,color,children}:{icon:string;title:string;color:string;children:React.ReactNode}) {
  return (
    <View style={[s.sec,{borderLeftColor:color}]}>
      <View style={s.secHead}>
        <Ionicons name={icon as any} size={15} color={color}/>
        <Text style={[s.secHeadTxt,{color}]}>{title}</Text>
      </View>
      {children}
    </View>
  )
}

function Bullet({text,color}:{text:string;color:string}) {
  return (
    <View style={s.bullet}>
      <View style={[s.bulletDot,{backgroundColor:color}]}/>
      <Text style={s.bulletTxt}>{text}</Text>
    </View>
  )
}

function SevBadge({severity}:{severity:Severity}) {
  const { t } = useTranslation()
  return (
    <View style={[s.sevBadge,{backgroundColor:SEVERITY_COLOR[severity]+'22'}]}>
      <Text style={[s.sevTxt,{color:SEVERITY_COLOR[severity]}]}>{t(`recovery.severity.${severity}`)}</Text>
    </View>
  )
}

/* ─── スタイル ─── */
const s = StyleSheet.create({
  bg:               {flex:1,backgroundColor:'#f6f6f8'},
  tabBar:           {flexDirection:'row',borderBottomWidth:1,borderBottomColor:'rgba(0,0,0,0.08)',backgroundColor:'#fff'},
  tabItem:          {flex:1,paddingVertical:12,alignItems:'center'},
  tabActive:        {borderBottomWidth:2,borderBottomColor:'#166534'},
  tabTxt:           {color:'#6b7280',fontSize:13,fontWeight:'700'},
  tabTxtActive:     {color:'#166534',fontWeight:'800'},
  content:          {padding:16,paddingBottom:60},
  secTitle:         {color:'#111827',fontSize:14,fontWeight:'800',marginTop:20,marginBottom:10},

  selectedBadge:    {flexDirection:'row',alignItems:'center',gap:5,backgroundColor:'rgba(229,57,53,0.08)',
                      paddingHorizontal:10,paddingVertical:5,borderRadius:20,marginRight:6,
                      borderWidth:1,borderColor:'rgba(229,57,53,0.25)'},
  selectedTxt:      {color:'#E53935',fontSize:12,fontWeight:'700'},
  clearAll:         {paddingHorizontal:10,paddingVertical:5,borderRadius:20,
                      backgroundColor:'#e8ecf0',justifyContent:'center'},

  viewToggle:       {flexDirection:'row',alignSelf:'center',backgroundColor:'#dde4ea',
                      borderRadius:20,padding:3,marginBottom:12},
  viewBtn:          {paddingHorizontal:24,paddingVertical:8,borderRadius:18},
  viewBtnActive:    {backgroundColor:'#166534',
                      shadowColor:'#166534',shadowOffset:{width:0,height:2},
                      shadowOpacity:0.3,shadowRadius:6,elevation:3},
  viewBtnTxt:       {color:'#555',fontSize:13,fontWeight:'700'},
  viewBtnTxtActive: {color:'#fff',fontWeight:'800'},
  svgWrap:          {alignSelf:'center',marginBottom:10,borderRadius:12,overflow:'hidden',
                      shadowColor:'#000',shadowOffset:{width:0,height:4},
                      shadowOpacity:0.08,shadowRadius:12,elevation:4},

  levelRow:         {flexDirection:'row',gap:6,flexWrap:'wrap'},
  levelBtn:         {width:29,height:29,borderRadius:15,borderWidth:1.5,
                      alignItems:'center',justifyContent:'center'},
  levelTxt:         {color:'#6b7280',fontSize:11,fontWeight:'700'},

  chipRow:          {flexDirection:'row',flexWrap:'wrap',gap:8},
  chip:             {paddingHorizontal:14,paddingVertical:8,borderRadius:20,
                      backgroundColor:'#f0f2f5',borderWidth:1.5,borderColor:'transparent'},
  chipActive:       {backgroundColor:'rgba(22,101,52,0.10)',borderColor:'#166534'},
  chipTxt:          {color:'#555',fontSize:13},
  chipTxtActive:    {color:'#14532d',fontWeight:'700'},

  notesInput:       {backgroundColor:'#fff',borderRadius:14,padding:14,color:'#111827',
                      fontSize:14,minHeight:72,textAlignVertical:'top',
                      borderWidth:1,borderColor:'rgba(0,0,0,0.12)'},
  errorBox:         {flexDirection:'row',alignItems:'flex-start',gap:6,marginTop:12,padding:12,
                      backgroundColor:'rgba(255,59,48,0.08)',borderRadius:10},
  errorTxt:         {color:'#FF3B30',fontSize:12,lineHeight:18,flex:1},
  disclaimer:       {flexDirection:'row',alignItems:'flex-start',gap:6,marginTop:14,padding:10,
                      backgroundColor:'rgba(0,0,0,0.03)',borderRadius:10},
  disclaimerTxt:    {color:'#6b7280',fontSize:11,lineHeight:16,flex:1},
  disclaimerBanner: {flexDirection:'row',alignItems:'flex-start',gap:8,padding:12,
                      backgroundColor:'rgba(255,149,0,0.08)',borderRadius:10,
                      borderWidth:1,borderColor:'rgba(255,149,0,0.28)',marginBottom:16},
  disclaimerBannerTxt:{color:'#b45309',fontSize:11,lineHeight:17,flex:1},
  ticketCostBadge:  {alignSelf:'center',flexDirection:'row',alignItems:'center',marginTop:14,
                      backgroundColor:'rgba(245,158,11,0.10)',borderRadius:20,
                      paddingHorizontal:12,paddingVertical:5,
                      borderWidth:1,borderColor:'rgba(245,158,11,0.3)'},
  ticketCostBadgeText:{color:'#b45309',fontSize:12,fontWeight:'800'},
  submitBtn:        {flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,
                      backgroundColor:'#1c1c1e',borderRadius:50,paddingVertical:18,marginTop:16,
                      shadowColor:'#000',shadowOffset:{width:0,height:4},
                      shadowOpacity:0.18,shadowRadius:12,elevation:5},
  submitTxt:        {color:'#fff',fontSize:16,fontWeight:'800',letterSpacing:-0.3},

  diagCard:         {backgroundColor:'#fff',borderRadius:21,padding:16,borderLeftWidth:4,marginBottom:12,
                      shadowColor:'#000',shadowOffset:{width:0,height:4},shadowOpacity:0.04,shadowRadius:12,elevation:2},
  sevBadge:         {paddingHorizontal:10,paddingVertical:3,borderRadius:21},
  sevTxt:           {fontSize:11,fontWeight:'800'},
  sec:              {backgroundColor:'#fff',borderRadius:18,padding:14,marginBottom:10,borderLeftWidth:3,
                      shadowColor:'#000',shadowOffset:{width:0,height:1},shadowOpacity:0.05,shadowRadius:4,elevation:1},
  secHead:          {flexDirection:'row',alignItems:'center',gap:6,marginBottom:10},
  secHeadTxt:       {fontSize:13,fontWeight:'800'},
  bullet:           {flexDirection:'row',alignItems:'flex-start',gap:8,marginBottom:6},
  bulletDot:        {width:6,height:6,borderRadius:3,marginTop:6},
  bulletTxt:        {color:'#374151',fontSize:13,lineHeight:20,flex:1},
  riceRow:          {marginBottom:8,paddingBottom:8,borderBottomWidth:1,borderBottomColor:'rgba(0,0,0,0.06)'},
  riceLabel:        {color:'#4A9FFF',fontSize:11,fontWeight:'800',marginBottom:2},
  riceVal:          {color:'#374151',fontSize:13,lineHeight:18},
  tlRow:            {flexDirection:'row',alignItems:'flex-start',gap:12,marginBottom:12},
  tlDot:            {width:10,height:10,borderRadius:5,marginTop:4},
  reBtn:            {flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,padding:16},
  reBtnTxt:         {color:'#6b7280',fontSize:13},
  histCard:         {backgroundColor:'#fff',borderRadius:18,padding:14,marginBottom:10,
                      shadowColor:'#000',shadowOffset:{width:0,height:4},shadowOpacity:0.04,shadowRadius:12,elevation:2},
  histDate:         {color:'#6b7280',fontSize:11},
  histPart:         {color:'#6b7280',fontSize:12,marginBottom:4},
  histDiag:         {color:'#111827',fontSize:15,fontWeight:'700',paddingRight:24},
  empty:            {alignItems:'center',paddingTop:80,gap:12},
  emptyTxt:         {color:'#6b7280',fontSize:14},
})

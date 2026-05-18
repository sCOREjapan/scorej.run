import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Animated,
} from 'react-native'
import { checkAdGate, recordUsage, consumeRewardUse } from '../lib/adGate'
import AdGateModal from '../components/AdGateModal'
import Svg, {
  Circle, Ellipse, Path, G, Line, Rect,
  Text as SvgText,
} from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter } from 'expo-router'

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
type ZoneDef = {
  id: string; label: string
  front?: ZoneShape; back?: ZoneShape
}
type ZoneShape =
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }

const ZONES: ZoneDef[] = [
  { id:'head',        label:'頭・首',              front:{type:'circle', cx:110,cy:28,r:20},           back:{type:'circle', cx:110,cy:28,r:20} },
  { id:'neck',        label:'首・頸部',             front:{type:'ellipse',cx:110,cy:62,rx:11,ry:9},    back:{type:'ellipse',cx:110,cy:62,rx:11,ry:9} },
  { id:'shoulder_l',  label:'左肩',                front:{type:'ellipse',cx:70,cy:85,rx:17,ry:12},    back:{type:'ellipse',cx:70,cy:85,rx:17,ry:12} },
  { id:'shoulder_r',  label:'右肩',                front:{type:'ellipse',cx:150,cy:85,rx:17,ry:12},   back:{type:'ellipse',cx:150,cy:85,rx:17,ry:12} },
  { id:'chest',       label:'胸・肋骨',             front:{type:'ellipse',cx:110,cy:114,rx:26,ry:20} },
  { id:'upper_back',  label:'背中（上）',            back:{type:'ellipse', cx:110,cy:112,rx:26,ry:20} },
  { id:'belly',       label:'腹部',                front:{type:'ellipse',cx:110,cy:158,rx:20,ry:16} },
  { id:'lower_back',  label:'腰・下背部',            back:{type:'ellipse', cx:110,cy:158,rx:20,ry:16} },
  { id:'upper_arm_l', label:'左上腕',              front:{type:'ellipse',cx:53,cy:132,rx:11,ry:26},   back:{type:'ellipse',cx:53,cy:132,rx:11,ry:26} },
  { id:'upper_arm_r', label:'右上腕',              front:{type:'ellipse',cx:167,cy:132,rx:11,ry:26},  back:{type:'ellipse',cx:167,cy:132,rx:11,ry:26} },
  { id:'elbow_l',     label:'左肘',                front:{type:'ellipse',cx:48,cy:174,rx:11,ry:10},   back:{type:'ellipse',cx:48,cy:174,rx:11,ry:10} },
  { id:'elbow_r',     label:'右肘',                front:{type:'ellipse',cx:172,cy:174,rx:11,ry:10},  back:{type:'ellipse',cx:172,cy:174,rx:11,ry:10} },
  { id:'forearm_l',   label:'左前腕',              front:{type:'ellipse',cx:43,cy:205,rx:10,ry:21},   back:{type:'ellipse',cx:43,cy:205,rx:10,ry:21} },
  { id:'forearm_r',   label:'右前腕',              front:{type:'ellipse',cx:177,cy:205,rx:10,ry:21},  back:{type:'ellipse',cx:177,cy:205,rx:10,ry:21} },
  { id:'wrist_l',     label:'左手首',              front:{type:'ellipse',cx:38,cy:234,rx:9,ry:8},     back:{type:'ellipse',cx:38,cy:234,rx:9,ry:8} },
  { id:'wrist_r',     label:'右手首',              front:{type:'ellipse',cx:182,cy:234,rx:9,ry:8},    back:{type:'ellipse',cx:182,cy:234,rx:9,ry:8} },
  { id:'hip_l',       label:'左股関節',             front:{type:'ellipse',cx:87,cy:196,rx:21,ry:16},   back:{type:'ellipse',cx:87,cy:196,rx:21,ry:16} },
  { id:'hip_r',       label:'右股関節',             front:{type:'ellipse',cx:133,cy:196,rx:21,ry:16},  back:{type:'ellipse',cx:133,cy:196,rx:21,ry:16} },
  { id:'groin',       label:'鼠径部・内転筋',        front:{type:'ellipse',cx:110,cy:206,rx:13,ry:11} },
  { id:'buttock',     label:'臀部・お尻',            back:{type:'ellipse', cx:110,cy:202,rx:28,ry:19} },
  { id:'quad_l',      label:'大腿前（左）',           front:{type:'ellipse',cx:85,cy:258,rx:18,ry:34} },
  { id:'quad_r',      label:'大腿前（右）',           front:{type:'ellipse',cx:135,cy:258,rx:18,ry:34} },
  { id:'hamstring_l', label:'ハムストリング（左）',    back:{type:'ellipse', cx:85,cy:256,rx:18,ry:34} },
  { id:'hamstring_r', label:'ハムストリング（右）',    back:{type:'ellipse', cx:135,cy:256,rx:18,ry:34} },
  { id:'it_band_l',   label:'腸脛靭帯（左）',         front:{type:'ellipse',cx:70,cy:266,rx:6,ry:30},   back:{type:'ellipse',cx:70,cy:266,rx:6,ry:30} },
  { id:'it_band_r',   label:'腸脛靭帯（右）',         front:{type:'ellipse',cx:150,cy:266,rx:6,ry:30},  back:{type:'ellipse',cx:150,cy:266,rx:6,ry:30} },
  { id:'knee_l',      label:'左膝',                front:{type:'ellipse',cx:83,cy:310,rx:16,ry:12},   back:{type:'ellipse',cx:83,cy:310,rx:16,ry:12} },
  { id:'knee_r',      label:'右膝',                front:{type:'ellipse',cx:137,cy:310,rx:16,ry:12},  back:{type:'ellipse',cx:137,cy:310,rx:16,ry:12} },
  { id:'shin_l',      label:'すね（左）',             front:{type:'ellipse',cx:82,cy:352,rx:11,ry:28} },
  { id:'shin_r',      label:'すね（右）',             front:{type:'ellipse',cx:138,cy:352,rx:11,ry:28} },
  { id:'calf_l',      label:'ふくらはぎ（左）',        back:{type:'ellipse', cx:82,cy:352,rx:12,ry:28} },
  { id:'calf_r',      label:'ふくらはぎ（右）',        back:{type:'ellipse', cx:138,cy:352,rx:12,ry:28} },
  { id:'achilles_l',  label:'アキレス腱（左）',        back:{type:'ellipse', cx:80,cy:392,rx:7,ry:13} },
  { id:'achilles_r',  label:'アキレス腱（右）',        back:{type:'ellipse', cx:140,cy:392,rx:7,ry:13} },
  { id:'ankle_l',     label:'左足首',              front:{type:'ellipse',cx:81,cy:396,rx:11,ry:9},    back:{type:'ellipse',cx:81,cy:396,rx:11,ry:9} },
  { id:'ankle_r',     label:'右足首',              front:{type:'ellipse',cx:139,cy:396,rx:11,ry:9},   back:{type:'ellipse',cx:139,cy:396,rx:11,ry:9} },
  { id:'foot_l',      label:'左足・足底',            front:{type:'ellipse',cx:77,cy:420,rx:17,ry:9},    back:{type:'ellipse',cx:77,cy:420,rx:17,ry:9} },
  { id:'foot_r',      label:'右足・足底',            front:{type:'ellipse',cx:143,cy:420,rx:17,ry:9},   back:{type:'ellipse',cx:143,cy:420,rx:17,ry:9} },
]

const PAIN_TYPES     = [{id:'sharp',label:'鋭い・刺すような'},{id:'dull',label:'鈍い・重い'},{id:'burning',label:'燃えるような・しびれ'},{id:'aching',label:'じんじん・疼く'}]
const TIMING_OPTIONS = [{id:'during',label:'運動中だけ'},{id:'after',label:'運動後だけ'},{id:'both',label:'運動中も後も'},{id:'constant',label:'常時'}]
const DURATION_OPTIONS=[{id:'today',label:'今日初めて'},{id:'3days',label:'2〜3日前から'},{id:'week',label:'1週間前から'},{id:'month',label:'1ヶ月以上'}]
const SEVERITY_COLOR = { mild:'#34C759', moderate:'#FF9500', severe:'#FF3B30' }
const SEVERITY_LABEL = { mild:'軽度', moderate:'中程度', severe:'重度' }
const STORAGE_KEY = 'trackmate_recovery_records'

/* ════════════════════════════════════════════ */
export default function RecoveryScreen() {
  const router = useRouter()
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
  const [adGateVisible,     setAdGateVisible]     = useState(false)
  const [adGateHardLimited, setAdGateHardLimited] = useState(false)
  const [adGateRewardUses,  setAdGateRewardUses]  = useState(0)
  const fadeAnim = useRef(new Animated.Value(1)).current

  const fadeIn = () => {
    fadeAnim.setValue(0)
    Animated.timing(fadeAnim,{toValue:1,duration:260,useNativeDriver:true}).start()
  }

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(r => { if(r) setHistory(JSON.parse(r)) }).catch(()=>{})
  },[])

  const togglePart = (id: string) => {
    setBodyParts(prev => prev.includes(id) ? prev.filter(p=>p!==id) : [...prev, id])
  }

  /* ── AI相談 ── */
  const askAICore = async () => {
    setApiError('')
    setLoading(true)

    const partLabels   = bodyParts.map(id => ZONES.find(z=>z.id===id)?.label ?? id).join('、')
    const typeLabel    = PAIN_TYPES.find(p=>p.id===painType)?.label ?? ''
    const timingLabel  = TIMING_OPTIONS.find(p=>p.id===timing)?.label ?? ''
    const durLabel     = DURATION_OPTIONS.find(p=>p.id===duration)?.label ?? '不明'
    const _apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '')
    const _endpoint = _apiBase ? `${_apiBase}/api/analyze` : '/api/analyze'

    try {
      const res = await fetch(_endpoint, {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body: JSON.stringify({
          model:'claude-haiku-4-5-20251001', max_tokens:2048,
          messages:[{ role:'user', content:
`あなたは陸上競技に詳しいスポーツトレーナーです。選手の症状をもとに、ケアと回復のアドバイスをしてください。医療診断ではなく、参考情報として提供してください。

部位:${partLabels} / 痛みLv:${painLevel}/10 / 性質:${typeLabel} / タイミング:${timingLabel} / 期間:${durLabel}
追加:${notes||'なし'}

以下JSONのみで返答（他テキスト不要）:
{"suspected_condition":"傷害名","severity":"mild|moderate|severe","immediate_actions":["今すぐすること1","2","3"],"rice_protocol":{"rest":"安静方法","ice":"アイシング方法と時間","compression":"圧迫方法","elevation":"挙上方法"},"taping":{"purpose":"目的","method":"ステップバイステップの貼り方（テープの向き・角度・長さを具体的に）","tape_type":"推奨テープ種類"},"recovery_timeline":{"phase1":{"period":"0〜3日","description":"急性期の対応"},"phase2":{"period":"4〜14日","description":"回復期のリハビリ"},"phase3":{"period":"2〜8週","description":"競技復帰プロセス"}},"exercises":["エクササイズ1（回数・方法）","2","3"],"see_doctor_if":["病院受診サイン1","2","3"],"training_modification":"代替練習と注意点","medical_basis":"医学的根拠の説明"}`
          }]
        })
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`HTTP ${res.status}: ${t.slice(0,120)}`)
      }
      const data  = await res.json()
      const text  = data.content?.[0]?.text ?? ''
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) throw new Error(`JSONなし: ${text.slice(0,80)}`)
      const parsed: RecoveryResult = JSON.parse(match[0])
      setResult(parsed)
      const rec: SavedRecord = {
        id:Date.now().toString(), date:new Date().toLocaleDateString('ja-JP'),
        bodyParts, painLevel, result:parsed,
      }
      const upd = [rec,...history].slice(0,20)
      setHistory(upd)
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(upd))
      setTab('result'); fadeIn()
    } catch(e: unknown) {
      setApiError(`エラー: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setLoading(false) }
  }

  const askAI = async () => {
    if (bodyParts.length === 0) { setApiError('部位をタップして選択してください（複数可）'); return }
    if (!painType) { setApiError('痛みの種類を選択してください'); return }
    if (!timing)   { setApiError('発生タイミングを選択してください'); return }
    const gate = await checkAdGate('recovery')
    if (!gate.allowed) {
      setAdGateRewardUses(gate.rewardUses)
      setAdGateHardLimited(gate.hardLimited)
      setAdGateVisible(true)
      return
    }
    if (gate.remaining === 0 && gate.rewardUses > 0) {
      await consumeRewardUse('recovery')
    } else {
      await recordUsage('recovery')
    }
    await askAICore()
  }

  /* ════ RENDER ════ */
  return (
    <View style={s.bg}>
      <View style={s.tabBar}>
        {[['input','症状入力'],['result','診断結果'],['history','履歴']].map(([k,l])=>(
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
                このアドバイスはAIによる参考情報です。医療診断・治療行為ではありません。{'\n'}
                症状が続く・悪化する場合は必ず医師・専門家にご相談ください。
              </Text>
            </View>

            {/* ─ ボディマップ ─ */}
            <Text style={s.secTitle}>🫀 痛い部位をタップ
              <Text style={{color:'#E53935',fontSize:12}}> （複数選択可）</Text>
            </Text>

            {/* 選択済みバッジ */}
            {bodyParts.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:8}}>
                {bodyParts.map(id=>{
                  const z = ZONES.find(z=>z.id===id)
                  return (
                    <TouchableOpacity key={id} style={s.selectedBadge} onPress={()=>togglePart(id)}>
                      <Text style={s.selectedTxt}>{z?.label}</Text>
                      <Ionicons name="close-circle" size={14} color="#E53935" />
                    </TouchableOpacity>
                  )
                })}
                <TouchableOpacity style={s.clearAll} onPress={()=>setBodyParts([])}>
                  <Text style={{color:'#555',fontSize:11}}>全解除</Text>
                </TouchableOpacity>
              </ScrollView>
            )}

            {/* 前後切替 */}
            <View style={s.viewToggle}>
              <TouchableOpacity style={[s.viewBtn,view==='front'&&s.viewBtnActive]} onPress={()=>setView('front')}>
                <Text style={[s.viewBtnTxt,view==='front'&&s.viewBtnTxtActive]}>前面</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.viewBtn,view==='back'&&s.viewBtnActive]} onPress={()=>setView('back')}>
                <Text style={[s.viewBtnTxt,view==='back'&&s.viewBtnTxtActive]}>背面</Text>
              </TouchableOpacity>
            </View>

            {/* ボディマップSVG */}
            <View style={s.svgWrap}>
              <BodyMap view={view} selected={bodyParts} onToggle={togglePart} />
            </View>

            {/* 痛みレベル */}
            <Text style={s.secTitle}>📊 痛みレベル: <Text style={{color:'#E53935'}}>{painLevel}/10</Text></Text>
            <View style={s.levelRow}>
              {[1,2,3,4,5,6,7,8,9,10].map(n=>{
                const col = n<=3?'#34C759':n<=6?'#FF9500':'#FF3B30'
                return (
                  <TouchableOpacity key={n}
                    style={[s.levelBtn,{borderColor:col},painLevel===n&&{backgroundColor:col}]}
                    onPress={()=>setPainLevel(n)}>
                    <Text style={[s.levelTxt,painLevel===n&&{color:'#fff',fontWeight:'800'}]}>{n}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={s.secTitle}>⚡ 痛みの性質</Text>
            <View style={s.chipRow}>
              {PAIN_TYPES.map(p=>(
                <TouchableOpacity key={p.id} style={[s.chip,painType===p.id&&s.chipActive]} onPress={()=>setPainType(p.id)}>
                  <Text style={[s.chipTxt,painType===p.id&&s.chipTxtActive]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.secTitle}>⏱ 発生タイミング</Text>
            <View style={s.chipRow}>
              {TIMING_OPTIONS.map(p=>(
                <TouchableOpacity key={p.id} style={[s.chip,timing===p.id&&s.chipActive]} onPress={()=>setTiming(p.id)}>
                  <Text style={[s.chipTxt,timing===p.id&&s.chipTxtActive]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.secTitle}>📅 いつから</Text>
            <View style={s.chipRow}>
              {DURATION_OPTIONS.map(p=>(
                <TouchableOpacity key={p.id} style={[s.chip,duration===p.id&&s.chipActive]} onPress={()=>setDuration(p.id)}>
                  <Text style={[s.chipTxt,duration===p.id&&s.chipTxtActive]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.secTitle}>📝 追加メモ（任意）</Text>
            <TextInput style={s.notesInput} value={notes} onChangeText={setNotes}
              placeholder="動作で痛む・過去の怪我など..." placeholderTextColor="#9ca3af"
              multiline numberOfLines={3} />

            {apiError ? (
              <View style={s.errorBox}>
                <Ionicons name="alert-circle" size={14} color="#FF3B30" />
                <Text style={s.errorTxt}>{apiError}</Text>
              </View>
            ) : null}

            <View style={s.disclaimer}>
              <Ionicons name="information-circle-outline" size={13} color="#6b7280" />
              <Text style={s.disclaimerTxt}>AIアドバイスは医師の診断の代替ではありません。重篤な症状は医療機関を受診してください。</Text>
            </View>

            <TouchableOpacity style={[s.submitBtn,loading&&{opacity:0.6}]} onPress={askAI} disabled={loading}>
              {loading
                ? <><ActivityIndicator color="#fff"/><Text style={s.submitTxt}>AIが分析中...</Text></>
                : <><Ionicons name="body-outline" size={20} color="#fff"/><Text style={s.submitTxt}>AIにケアプランを相談する</Text></>
              }
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ══ 診断結果 ══ */}
        {tab==='result' && (
          <ScrollView contentContainerStyle={s.content}>
            {!result
              ? <View style={s.empty}><Ionicons name="medkit-outline" size={48} color="#9ca3af"/><Text style={s.emptyTxt}>症状入力タブから相談してください</Text></View>
              : <ResultView result={result} onBack={()=>setTab('input')} />
            }
          </ScrollView>
        )}

        {/* ══ 履歴 ══ */}
        {tab==='history' && (
          <ScrollView contentContainerStyle={s.content}>
            {history.length===0
              ? <View style={s.empty}><Ionicons name="time-outline" size={48} color="#9ca3af"/><Text style={s.emptyTxt}>相談履歴なし</Text></View>
              : history.map(rec=>(
                <TouchableOpacity key={rec.id} style={s.histCard}
                  onPress={()=>{setResult(rec.result);setTab('result');fadeIn()}}>
                  <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:4}}>
                    <Text style={s.histDate}>{rec.date}</Text>
                    <SevBadge severity={rec.result.severity}/>
                  </View>
                  <Text style={s.histPart}>📍 {rec.bodyParts.map(id=>ZONES.find(z=>z.id===id)?.label??id).join(' / ')}　Lv.{rec.painLevel}</Text>
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
        rewardUses={adGateRewardUses}
        hardLimited={adGateHardLimited}
        onClose={() => setAdGateVisible(false)}
        onAdWatched={async () => {
          setAdGateVisible(false)
          const g = await checkAdGate('recovery')
          if (g.rewardUses > 0) {
            await consumeRewardUse('recovery')
          } else {
            await recordUsage('recovery')
          }
          await askAICore()
        }}
        onUpgrade={() => {
          setAdGateVisible(false)
          router.push('/paywall')
        }}
      />
    </View>
  )
}

/* ─── なめらか人体図 SVG ──────────────────────── */
function BodyMap({ view, selected, onToggle }: {
  view:'front'|'back'; selected:string[]; onToggle:(id:string)=>void
}) {
  const W=220, H=440
  const zones = ZONES.filter(z => view==='front' ? !!z.front : !!z.back)
  const getShape = (z: ZoneDef) => view==='front' ? z.front! : z.back!
  const getLabelY = (shape: ZoneShape) => {
    if (shape.type==='circle') return shape.cy - shape.r - 7
    return shape.cy - shape.ry - 7
  }

  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}
      style={{backgroundColor:'#f8f8f6', borderRadius:12}}>

      {/* なめらかボディシルエット */}
      <AnatomicalBody view={view} />

      {/* ゾーンオーバーレイ */}
      {zones.map(zone => {
        const shape = getShape(zone)
        const sel   = selected.includes(zone.id)

        return (
          <G key={zone.id} onPress={() => onToggle(zone.id)}>
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
                  {zone.label}
                </SvgText>
              </G>
            )}
          </G>
        )
      })}

      {selected.length===0 && (
        <SvgText x={110} y={H-6} textAnchor="middle" fill="rgba(0,0,0,0.28)" fontSize={9}>
          部位をタップして選択（複数可）
        </SvgText>
      )}
    </Svg>
  )
}

/* ─── 解剖学的筋肉図（ライン画スタイル） ────── */
function AnatomicalBody({ view }: { view:'front'|'back' }) {
  const fill   = '#f8f8f6'
  const stroke = '#1a1a1e'
  const sw     = 1.25
  const ml     = '#484848'
  const ms     = 0.8

  // 指1本: (base_cx, base_y) → (tip_cx, tip_y)
  const Finger = ({ bx, by, tx, ty }: {bx:number,by:number,tx:number,ty:number}) => {
    const w = 2.8
    const dx = tx - bx, dy = ty - by
    const len = Math.sqrt(dx*dx+dy*dy)
    const nx = -dy/len*w, ny = dx/len*w
    return (
      <Path
        d={`M${bx+nx},${by+ny} C${bx+nx},${(by+ty)/2} ${tx+nx},${ty-4} ${tx},${ty}
            C${tx-nx},${ty-4} ${bx-nx},${(by+ty)/2} ${bx-nx},${by+ny} Z`}
        fill={fill} stroke={stroke} strokeWidth={sw}/>
    )
  }

  if (view === 'front') {
    return (
      <G>
        {/* ── 頭 ── */}
        <Ellipse cx={110} cy={25} rx={18} ry={22} fill={fill} stroke={stroke} strokeWidth={sw}/>
        <Path d="M108,29 L110,36 L112,29" fill="none" stroke={stroke} strokeWidth={0.7}/>

        {/* ── 首 ── */}
        <Path d="M103,45 C101,53 101,62 102,70 Q110,75 118,70 C119,62 119,53 117,45 Q110,43 103,45Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>

        {/* ── 胴体（肩幅を広く・ウエストくびれ・ヒップ張り）── */}
        <Path d="M102,70
          C92,72 78,76 62,86
          C50,94 42,108 40,124
          C38,140 40,156 46,170
          C50,180 54,192 56,204
          L80,220 L140,220
          C146,204 150,184 154,170
          C160,156 162,140 160,124
          C158,108 150,94 138,86
          C122,76 128,72 118,70Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>

        {/* ── 三角筋（左）── */}
        <Path d="M56,88
          C44,96 34,110 32,126
          C30,140 34,154 40,162
          C48,156 56,142 60,128
          C64,114 62,98 58,90Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>

        {/* ── 三角筋（右）── */}
        <Path d="M164,88
          C176,96 186,110 188,126
          C190,140 186,154 180,162
          C172,156 164,142 160,128
          C156,114 158,98 162,90Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>

        {/* ── 上腕（左）── */}
        <Path d="M32,126
          C26,144 20,164 18,184
          C16,200 16,214 20,226
          L34,228
          C36,216 38,202 40,186
          C42,168 44,148 46,130
          C40,122 36,120 32,126Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>
        {/* 上腕二頭筋 楕円 */}
        <Ellipse cx={28} cy={172} rx={8} ry={20} fill="none" stroke={ml} strokeWidth={ms}/>

        {/* ── 上腕（右）── */}
        <Path d="M188,126
          C194,144 200,164 202,184
          C204,200 204,214 200,226
          L186,228
          C184,216 182,202 180,186
          C178,168 176,148 174,130
          C180,122 184,120 188,126Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>
        <Ellipse cx={192} cy={172} rx={8} ry={20} fill="none" stroke={ml} strokeWidth={ms}/>

        {/* ── 前腕（左）── */}
        <Path d="M20,226
          C16,244 12,262 10,278
          C9,286 9,292 11,298
          L24,300
          C26,288 28,272 32,256
          C34,242 36,228 34,228Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>
        <Path d="M22,230 C18,250 15,272 14,286" fill="none" stroke={ml} strokeWidth={0.65}/>
        <Path d="M27,229 C24,249 21,270 21,284" fill="none" stroke={ml} strokeWidth={0.65}/>

        {/* ── 前腕（右）── */}
        <Path d="M200,226
          C204,244 208,262 210,278
          C211,286 211,292 209,298
          L196,300
          C194,288 192,272 188,256
          C186,242 184,228 186,228Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>
        <Path d="M198,230 C202,250 205,272 206,286" fill="none" stroke={ml} strokeWidth={0.65}/>
        <Path d="M193,229 C196,249 199,270 199,284" fill="none" stroke={ml} strokeWidth={0.65}/>

        {/* ── 手のひら（左）── */}
        <Path d="M11,298 C9,306 8,314 9,320 C10,326 14,328 18,326 L26,324 C28,316 28,308 28,300 L24,300Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>
        {/* 左 指5本 */}
        <Finger bx={11} by={322} tx={9}  ty={342}/>
        <Finger bx={16} by={324} tx={14} ty={346}/>
        <Finger bx={21} by={325} tx={21} ty={348}/>
        <Finger bx={26} by={323} tx={28} ty={344}/>
        {/* 親指（左） */}
        <Path d="M9,308 C5,306 2,302 2,296 C2,290 6,288 10,290 C12,292 12,296 11,300Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>

        {/* ── 手のひら（右）── */}
        <Path d="M209,298 C211,306 212,314 211,320 C210,326 206,328 202,326 L194,324 C192,316 192,308 192,300 L196,300Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>
        {/* 右 指5本 */}
        <Finger bx={209} by={322} tx={211} ty={342}/>
        <Finger bx={204} by={324} tx={206} ty={346}/>
        <Finger bx={199} by={325} tx={199} ty={348}/>
        <Finger bx={194} by={323} tx={192} ty={344}/>
        {/* 親指（右） */}
        <Path d="M211,308 C215,306 218,302 218,296 C218,290 214,288 210,290 C208,292 208,296 209,300Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>

        {/* ── 大胸筋ライン ── */}
        <Path d="M102,72 Q84,78 66,92"    fill="none" stroke={ml} strokeWidth={ms}/>
        <Path d="M118,72 Q136,78 154,92"  fill="none" stroke={ml} strokeWidth={ms}/>
        <Path d="M102,72 Q90,80 82,92 Q78,104 82,116 C88,120 98,116 106,108 L110,102"
          fill="none" stroke={ml} strokeWidth={ms}/>
        <Path d="M118,72 Q130,80 138,92 Q142,104 138,116 C132,120 122,116 114,108 L110,102"
          fill="none" stroke={ml} strokeWidth={ms}/>
        <Line x1={110} y1={72} x2={110} y2={118} stroke={ml} strokeWidth={0.7}/>

        {/* ── 三角筋ライン（前部・中部境界）── */}
        <Path d="M40,124 C44,136 48,148 50,158" fill="none" stroke={ml} strokeWidth={ms}/>
        <Path d="M180,124 C176,136 172,148 170,158" fill="none" stroke={ml} strokeWidth={ms}/>

        {/* ── 前鋸筋 ── */}
        <Path d="M56,130 L50,134" fill="none" stroke={ml} strokeWidth={0.65}/>
        <Path d="M56,140 L49,145" fill="none" stroke={ml} strokeWidth={0.65}/>
        <Path d="M56,150 L50,154" fill="none" stroke={ml} strokeWidth={0.65}/>
        <Path d="M164,130 L170,134" fill="none" stroke={ml} strokeWidth={0.65}/>
        <Path d="M164,140 L171,145" fill="none" stroke={ml} strokeWidth={0.65}/>
        <Path d="M164,150 L170,154" fill="none" stroke={ml} strokeWidth={0.65}/>

        {/* ── 腹直筋 ── */}
        <Line x1={110} y1={120} x2={110} y2={184} stroke={ml} strokeWidth={0.75} strokeDasharray="2,3"/>
        <Path d="M100,130 Q105,128 110,129 Q115,128 120,130" fill="none" stroke={ml} strokeWidth={ms}/>
        <Path d="M98,143 Q104,141 110,142 Q116,141 122,143" fill="none" stroke={ml} strokeWidth={ms}/>
        <Path d="M97,156 Q103,154 110,155 Q117,154 123,156" fill="none" stroke={ml} strokeWidth={ms}/>

        {/* ── 外腹斜筋 ── */}
        <Path d="M56,150 C56,164 56,176 58,188 L76,188" fill="none" stroke={ml} strokeWidth={0.65}/>
        <Path d="M164,150 C164,164 164,176 162,188 L144,188" fill="none" stroke={ml} strokeWidth={0.65}/>

        {/* ── 鼠径部 Vライン ── */}
        <Path d="M58,188 Q70,208 80,214"    fill="none" stroke={ml} strokeWidth={ms}/>
        <Path d="M162,188 Q150,208 140,214" fill="none" stroke={ml} strokeWidth={ms}/>
        <Path d="M98,188 Q104,198 110,200 Q116,198 122,188" fill="none" stroke={ml} strokeWidth={ms}/>
        <Circle cx={110} cy={175} r={2.5} fill="none" stroke={ml} strokeWidth={0.9}/>

        {/* ── 大腿（左）── */}
        <Path d="M80,220
          C70,232 62,254 60,278
          C58,300 60,322 66,340
          L80,348 C88,350 98,348 104,344
          L108,332
          C112,312 111,288 109,264
          C107,242 102,222 96,220Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>
        {/* 外側広筋 */}
        <Path d="M78,226 C70,252 66,278 66,302 C66,320 70,334 74,342" fill="none" stroke={ml} strokeWidth={0.65}/>
        {/* 大腿直筋 */}
        <Path d="M88,222 C86,250 84,278 84,300 C84,320 86,336 90,342" fill="none" stroke={ml} strokeWidth={0.65}/>
        {/* 内側広筋 */}
        <Path d="M101,224 C105,252 106,278 104,302 C102,320 98,334 94,342" fill="none" stroke={ml} strokeWidth={0.65}/>

        {/* ── 大腿（右）── */}
        <Path d="M140,220
          C150,232 158,254 160,278
          C162,300 160,322 154,340
          L140,348 C132,350 122,348 116,344
          L112,332
          C108,312 109,288 111,264
          C113,242 118,222 124,220Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>
        <Path d="M142,226 C150,252 154,278 154,302 C154,320 150,334 146,342" fill="none" stroke={ml} strokeWidth={0.65}/>
        <Path d="M132,222 C134,250 136,278 136,300 C136,320 134,336 130,342" fill="none" stroke={ml} strokeWidth={0.65}/>
        <Path d="M119,224 C115,252 114,278 116,302 C118,320 122,334 126,342" fill="none" stroke={ml} strokeWidth={0.65}/>

        {/* ── 下腿（左）── */}
        <Path d="M66,338
          C62,360 60,382 61,402
          C62,416 67,428 73,432
          L90,432
          C96,430 100,422 101,410
          C102,394 101,370 101,346
          L101,336 L80,346Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>
        {/* 前脛骨筋 */}
        <Path d="M74,342 C72,366 72,390 74,410 C76,422 80,430 84,432" fill="none" stroke={ml} strokeWidth={0.65}/>
        <Line x1={86} y1={344} x2={85} y2={428} stroke={ml} strokeWidth={0.65}/>

        {/* ── 下腿（右）── */}
        <Path d="M154,338
          C158,360 160,382 159,402
          C158,416 153,428 147,432
          L130,432
          C124,430 120,422 119,410
          C118,394 119,370 119,346
          L119,336 L140,346Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>
        <Path d="M146,342 C148,366 148,390 146,410 C144,422 140,430 136,432" fill="none" stroke={ml} strokeWidth={0.65}/>
        <Line x1={134} y1={344} x2={135} y2={428} stroke={ml} strokeWidth={0.65}/>

        {/* ── 足（左）── */}
        <Path d="M61,428 C55,438 51,447 51,452 Q63,456 80,455 Q96,454 102,444 Q103,434 101,428Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>
        {[{x1:54,y1:452,x2:58,y2:439},{x1:63,y1:454,x2:66,y2:441},{x1:72,y1:455,x2:74,y2:442},{x1:81,y1:455,x2:82,y2:443},{x1:89,y1:453,x2:90,y2:441}].map((t,i)=>(
          <Line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={ml} strokeWidth={0.7}/>
        ))}

        {/* ── 足（右）── */}
        <Path d="M159,428 C165,438 169,447 169,452 Q157,456 140,455 Q124,454 118,444 Q117,434 119,428Z"
          fill={fill} stroke={stroke} strokeWidth={sw}/>
        {[{x1:166,y1:452,x2:162,y2:439},{x1:157,y1:454,x2:154,y2:441},{x1:148,y1:455,x2:146,y2:442},{x1:139,y1:455,x2:138,y2:443},{x1:131,y1:453,x2:130,y2:441}].map((t,i)=>(
          <Line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={ml} strokeWidth={0.7}/>
        ))}
      </G>
    )
  }

  // ── 背面 ──
  return (
    <G>
      {/* ── 頭 ── */}
      <Ellipse cx={110} cy={25} rx={18} ry={22} fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* ── 首 ── */}
      <Path d="M103,45 C101,53 101,62 102,70 Q110,75 118,70 C119,62 119,53 117,45 Q110,43 103,45Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* ── 胴体（背面）── */}
      <Path d="M102,70
        C92,72 78,76 62,86
        C50,94 42,108 40,124
        C38,140 40,156 46,170
        C50,180 54,192 56,204
        L80,220 L140,220
        C146,204 150,184 154,170
        C160,156 162,140 160,124
        C158,108 150,94 138,86
        C122,76 128,72 118,70Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* ── 三角筋 後部（左）── */}
      <Path d="M56,88
        C44,96 34,110 32,126
        C30,140 34,154 40,162
        C48,156 56,142 60,128
        C64,114 62,98 58,90Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>
      {/* ── 三角筋 後部（右）── */}
      <Path d="M164,88
        C176,96 186,110 188,126
        C190,140 186,154 180,162
        C172,156 164,142 160,128
        C156,114 158,98 162,90Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* ── 上腕三頭筋（左）── */}
      <Path d="M32,126
        C26,144 20,164 18,184
        C16,200 16,214 20,226
        L34,228
        C36,216 38,202 40,186
        C42,168 44,148 46,130
        C40,122 36,120 32,126Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>
      <Path d="M26,132 C24,152 22,170 22,188 C22,202 24,214 26,222" fill="none" stroke={ml} strokeWidth={ms}/>
      <Path d="M34,130 C32,152 30,170 30,188 C30,202 32,214 34,222" fill="none" stroke={ml} strokeWidth={ms}/>

      {/* ── 上腕三頭筋（右）── */}
      <Path d="M188,126
        C194,144 200,164 202,184
        C204,200 204,214 200,226
        L186,228
        C184,216 182,202 180,186
        C178,168 176,148 174,130
        C180,122 184,120 188,126Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>
      <Path d="M194,132 C196,152 198,170 198,188 C198,202 196,214 194,222" fill="none" stroke={ml} strokeWidth={ms}/>
      <Path d="M186,130 C188,152 190,170 190,188 C190,202 188,214 186,222" fill="none" stroke={ml} strokeWidth={ms}/>

      {/* ── 前腕（左・背面）── */}
      <Path d="M20,226
        C16,244 12,262 10,278
        C9,286 9,292 11,298
        L24,300
        C26,288 28,272 32,256
        C34,242 36,228 34,228Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>
      <Path d="M23,230 C19,250 16,272 15,286" fill="none" stroke={ml} strokeWidth={0.65}/>
      <Path d="M28,229 C25,249 23,270 22,284" fill="none" stroke={ml} strokeWidth={0.65}/>

      {/* ── 前腕（右・背面）── */}
      <Path d="M200,226
        C204,244 208,262 210,278
        C211,286 211,292 209,298
        L196,300
        C194,288 192,272 188,256
        C186,242 184,228 186,228Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>
      <Path d="M197,230 C201,250 204,272 205,286" fill="none" stroke={ml} strokeWidth={0.65}/>
      <Path d="M192,229 C195,249 197,270 198,284" fill="none" stroke={ml} strokeWidth={0.65}/>

      {/* ── 手（左・背面）── */}
      <Path d="M11,298 C9,306 8,314 9,320 C10,326 14,328 18,326 L26,324 C28,316 28,308 28,300 L24,300Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>
      <Finger bx={11} by={322} tx={9}  ty={342}/>
      <Finger bx={16} by={324} tx={14} ty={346}/>
      <Finger bx={21} by={325} tx={21} ty={348}/>
      <Finger bx={26} by={323} tx={28} ty={344}/>
      <Path d="M9,308 C5,306 2,302 2,296 C2,290 6,288 10,290 C12,292 12,296 11,300Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* ── 手（右・背面）── */}
      <Path d="M209,298 C211,306 212,314 211,320 C210,326 206,328 202,326 L194,324 C192,316 192,308 192,300 L196,300Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>
      <Finger bx={209} by={322} tx={211} ty={342}/>
      <Finger bx={204} by={324} tx={206} ty={346}/>
      <Finger bx={199} by={325} tx={199} ty={348}/>
      <Finger bx={194} by={323} tx={192} ty={344}/>
      <Path d="M211,308 C215,306 218,302 218,296 C218,290 214,288 210,290 C208,292 208,296 209,300Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* ── 脊椎ライン ── */}
      <Line x1={110} y1={72} x2={110} y2={204} stroke={ml} strokeWidth={0.85} strokeDasharray="3,4"/>

      {/* ── 僧帽筋 ── */}
      <Path d="M102,72 Q94,82 86,96 Q82,110 88,122 C94,126 102,122 108,114 L110,106 L112,114 C118,122 126,126 132,122 Q138,110 134,96 Q126,82 118,72"
        fill="none" stroke={ml} strokeWidth={ms}/>

      {/* ── 肩甲骨（左）── */}
      <Path d="M76,96 C72,110 72,126 78,136 C84,142 94,140 98,132 C102,122 100,108 94,98Z"
        fill="none" stroke={ml} strokeWidth={ms}/>
      <Line x1={80} y1={100} x2={94} y2={132} stroke={ml} strokeWidth={0.65}/>

      {/* ── 肩甲骨（右）── */}
      <Path d="M144,96 C148,110 148,126 142,136 C136,142 126,140 122,132 C118,122 120,108 126,98Z"
        fill="none" stroke={ml} strokeWidth={ms}/>
      <Line x1={140} y1={100} x2={126} y2={132} stroke={ml} strokeWidth={0.65}/>

      {/* ── 広背筋 ── */}
      <Path d="M78,130 C74,150 74,172 76,190 C78,202 82,210 86,214" fill="none" stroke={ml} strokeWidth={0.65}/>
      <Path d="M142,130 C146,150 146,172 144,190 C142,202 138,210 134,214" fill="none" stroke={ml} strokeWidth={0.65}/>

      {/* ── 大臀筋 ── */}
      <Path d="M80,220
        C68,234 60,254 59,276
        C58,294 62,310 70,320
        C78,316 90,302 97,286
        C104,270 107,250 107,232
        C107,222 104,218 98,218"
        fill="none" stroke={ml} strokeWidth={ms}/>
      <Path d="M140,220
        C152,234 160,254 161,276
        C162,294 158,310 150,320
        C142,316 130,302 123,286
        C116,270 113,250 113,232
        C113,222 116,218 122,218"
        fill="none" stroke={ml} strokeWidth={ms}/>
      <Path d="M110,218 C108,238 108,262 110,284" fill="none" stroke={ml} strokeWidth={0.65}/>

      {/* ── 大腿（左・背面）── */}
      <Path d="M80,220
        C70,232 62,254 60,278
        C58,300 60,322 66,340
        L80,348 C88,350 98,348 104,344
        L108,332
        C112,312 111,288 109,264
        C107,242 102,222 96,220Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>
      {/* ハムストリング ライン */}
      <Path d="M70,226 C68,252 66,278 68,302 C70,320 74,336 78,344" fill="none" stroke={ml} strokeWidth={0.65}/>
      <Path d="M86,222 C84,250 82,278 83,300 C84,318 88,334 92,342" fill="none" stroke={ml} strokeWidth={0.65}/>
      <Path d="M101,224 C104,252 105,278 103,300 C101,318 97,332 93,340" fill="none" stroke={ml} strokeWidth={0.65}/>

      {/* ── 大腿（右・背面）── */}
      <Path d="M140,220
        C150,232 158,254 160,278
        C162,300 160,322 154,340
        L140,348 C132,350 122,348 116,344
        L112,332
        C108,312 109,288 111,264
        C113,242 118,222 124,220Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>
      <Path d="M150,226 C152,252 154,278 152,302 C150,320 146,336 142,344" fill="none" stroke={ml} strokeWidth={0.65}/>
      <Path d="M134,222 C136,250 138,278 137,300 C136,318 132,334 128,342" fill="none" stroke={ml} strokeWidth={0.65}/>
      <Path d="M119,224 C116,252 115,278 117,300 C119,318 123,332 127,340" fill="none" stroke={ml} strokeWidth={0.65}/>

      {/* ── 下腿（左）── */}
      <Path d="M66,338
        C62,360 60,382 61,402
        C62,416 67,428 73,432
        L90,432
        C96,430 100,422 101,410
        C102,394 101,370 101,346
        L101,336 L80,346Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>
      {/* 腓腹筋（2頭） */}
      <Path d="M72,344 C70,368 70,392 72,410 C74,422 78,430 82,432" fill="none" stroke={ml} strokeWidth={0.65}/>
      <Path d="M91,342 C93,366 93,390 91,408 C89,420 86,428 82,432" fill="none" stroke={ml} strokeWidth={0.65}/>
      {/* アキレス腱 */}
      <Line x1={82} y1={430} x2={82} y2={440} stroke={ml} strokeWidth={1.1}/>

      {/* ── 下腿（右）── */}
      <Path d="M154,338
        C158,360 160,382 159,402
        C158,416 153,428 147,432
        L130,432
        C124,430 120,422 119,410
        C118,394 119,370 119,346
        L119,336 L140,346Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>
      <Path d="M148,344 C150,368 150,392 148,410 C146,422 142,430 138,432" fill="none" stroke={ml} strokeWidth={0.65}/>
      <Path d="M129,342 C127,366 127,390 129,408 C131,420 134,428 138,432" fill="none" stroke={ml} strokeWidth={0.65}/>
      <Line x1={138} y1={430} x2={138} y2={440} stroke={ml} strokeWidth={1.1}/>

      {/* ── 足（左・背面）── */}
      <Path d="M61,428 C55,438 51,447 51,452 Q63,456 80,455 Q96,454 102,444 Q103,434 101,428Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>
      {/* ── 足（右・背面）── */}
      <Path d="M159,428 C165,438 169,447 169,452 Q157,456 140,455 Q124,454 118,444 Q117,434 119,428Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>
    </G>
  )
}


/* ─── 診断結果ビュー ────────────────────────────── */
function ResultView({ result, onBack }: { result:RecoveryResult; onBack:()=>void }) {
  return (
    <>
      <View style={s.disclaimerBanner}>
        <Ionicons name="warning-outline" size={15} color="#FF9500" />
        <Text style={s.disclaimerBannerTxt}>
          このアドバイスはAIによる参考情報です。医療診断・治療行為ではありません。{'\n'}
          症状が続く・悪化する場合は必ず医師・専門家にご相談ください。
        </Text>
      </View>

      <View style={[s.diagCard,{borderLeftColor:SEVERITY_COLOR[result.severity]}]}>
        <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
          <Text style={{color:'#6b7280',fontSize:11,fontWeight:'800'}}>疑われる症状</Text>
          <SevBadge severity={result.severity}/>
        </View>
        <Text style={{color:'#111827',fontSize:20,fontWeight:'900'}}>{result.suspected_condition}</Text>
      </View>

      <Sec icon="flash" title="今すぐすべきこと" color="#E53935">
        {result.immediate_actions.map((a,i)=><Bullet key={i} text={a} color="#E53935"/>)}
      </Sec>

      <Sec icon="snow" title="RICE処置" color="#4A9FFF">
        {(['rest','ice','compression','elevation'] as const).map(k=>(
          <View key={k} style={s.riceRow}>
            <Text style={s.riceLabel}>
              {k==='rest'?'Rest（安静）':k==='ice'?'Ice（アイシング）':k==='compression'?'Compression（圧迫）':'Elevation（挙上）'}
            </Text>
            <Text style={s.riceVal}>{result.rice_protocol[k]}</Text>
          </View>
        ))}
      </Sec>

      <Sec icon="bandage" title="テーピング方法" color="#FF9500">
        <View style={{flexDirection:'row',gap:10,marginBottom:10}}>
          <View style={{flex:1}}>
            <Text style={[s.riceLabel,{color:'#FF9500'}]}>目的</Text>
            <Text style={s.riceVal}>{result.taping.purpose}</Text>
          </View>
          <View style={{flex:1}}>
            <Text style={[s.riceLabel,{color:'#FF9500'}]}>テープ種類</Text>
            <Text style={s.riceVal}>{result.taping.tape_type}</Text>
          </View>
        </View>
        <Text style={[s.riceLabel,{color:'#6b7280',marginBottom:6}]}>貼り方（手順）</Text>
        <Text style={{color:'#374151',fontSize:13,lineHeight:22}}>{result.taping.method}</Text>
      </Sec>

      <Sec icon="time" title="回復スケジュール" color="#34C759">
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

      <Sec icon="fitness" title="リハビリエクササイズ" color="#A855F7">
        {result.exercises.map((e,i)=><Bullet key={i} text={e} color="#A855F7"/>)}
      </Sec>

      <Sec icon="barbell" title="練習の修正方法" color="#FF9500">
        <Text style={{color:'#374151',fontSize:13,lineHeight:20}}>{result.training_modification}</Text>
      </Sec>

      <Sec icon="alert-circle" title="病院を受診すべき症状" color="#FF3B30">
        {result.see_doctor_if.map((e,i)=><Bullet key={i} text={e} color="#FF3B30"/>)}
      </Sec>

      <Sec icon="library" title="参考情報" color="#9ca3af">
        <Text style={{color:'#6b7280',fontSize:12,lineHeight:20,fontStyle:'italic'}}>{result.medical_basis}</Text>
      </Sec>

      <TouchableOpacity style={s.reBtn} onPress={onBack}>
        <Ionicons name="refresh-outline" size={14} color="#6b7280"/>
        <Text style={s.reBtnTxt}>別の症状を入力する</Text>
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
  return (
    <View style={[s.sevBadge,{backgroundColor:SEVERITY_COLOR[severity]+'22'}]}>
      <Text style={[s.sevTxt,{color:SEVERITY_COLOR[severity]}]}>{SEVERITY_LABEL[severity]}</Text>
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

  notesInput:       {backgroundColor:'#fff',borderRadius:12,padding:14,color:'#111827',
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
  submitBtn:        {flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,
                      backgroundColor:'#1c1c1e',borderRadius:50,paddingVertical:18,marginTop:16,
                      shadowColor:'#000',shadowOffset:{width:0,height:4},
                      shadowOpacity:0.18,shadowRadius:12,elevation:5},
  submitTxt:        {color:'#fff',fontSize:16,fontWeight:'800',letterSpacing:-0.3},

  diagCard:         {backgroundColor:'#fff',borderRadius:14,padding:16,borderLeftWidth:4,marginBottom:12,
                      shadowColor:'#000',shadowOffset:{width:0,height:2},shadowOpacity:0.06,shadowRadius:8,elevation:2},
  sevBadge:         {paddingHorizontal:10,paddingVertical:3,borderRadius:20},
  sevTxt:           {fontSize:11,fontWeight:'800'},
  sec:              {backgroundColor:'#fff',borderRadius:14,padding:14,marginBottom:10,borderLeftWidth:3,
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
  histCard:         {backgroundColor:'#fff',borderRadius:14,padding:14,marginBottom:10,
                      shadowColor:'#000',shadowOffset:{width:0,height:2},shadowOpacity:0.06,shadowRadius:8,elevation:2},
  histDate:         {color:'#6b7280',fontSize:11},
  histPart:         {color:'#9ca3af',fontSize:12,marginBottom:4},
  histDiag:         {color:'#111827',fontSize:15,fontWeight:'700',paddingRight:24},
  empty:            {alignItems:'center',paddingTop:80,gap:12},
  emptyTxt:         {color:'#6b7280',fontSize:14},
})

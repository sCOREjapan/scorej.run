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
      style={{backgroundColor:'#eef4f9', borderRadius:12}}>

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

/* ─── スリムな解剖学的人体シルエット ────────── */
function AnatomicalBody({ view }: { view:'front'|'back' }) {
  const fill   = '#d2e8f4'
  const stroke = '#5a8faa'
  const sw     = 1.2
  const detail = '#90bcd0'

  return (
    <G>
      {/* 頭 */}
      <Ellipse cx={110} cy={27} rx={17} ry={20}
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* 首 */}
      <Path d="M103,46 L102,66 Q110,71 118,66 L117,46 Q110,43 103,46 Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/*
        胴体：肩幅 ~76px、胸幅 ~86px、ウエスト ~60px、ヒップ ~62px
        従来の 142px から大幅スリム化
      */}
      <Path
        d="M80,78
           C72,86 68,100 68,118
           C68,134 72,148 77,160
           C80,170 80,184 82,196
           L93,204 L127,204
           L138,196
           C140,184 140,170 143,160
           C148,148 152,134 152,118
           C152,100 148,86 140,78
           C130,71 120,70 118,70
           L102,70
           C100,70 90,71 80,78 Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* 前面ディテール */}
      {view === 'front' && (
        <>
          {/* 鎖骨 */}
          <Path d="M103,71 Q90,77 77,84"
            fill="none" stroke={detail} strokeWidth={0.85}/>
          <Path d="M117,71 Q130,77 143,84"
            fill="none" stroke={detail} strokeWidth={0.85}/>
          {/* 正中線（点線） */}
          <Line x1={110} y1={96} x2={110} y2={163}
            stroke={detail} strokeWidth={0.55} strokeDasharray="3,4"/>
          {/* へそ */}
          <Circle cx={110} cy={167} r={2}
            fill="none" stroke={detail} strokeWidth={0.9}/>
        </>
      )}

      {/* 背面ディテール */}
      {view === 'back' && (
        <>
          {/* 脊椎 */}
          <Line x1={110} y1={72} x2={110} y2={198}
            stroke={detail} strokeWidth={0.9} strokeDasharray="2,4"/>
          {/* 肩甲骨 */}
          <Ellipse cx={91} cy={112} rx={12} ry={16}
            fill="none" stroke={detail} strokeWidth={0.8}/>
          <Ellipse cx={129} cy={112} rx={12} ry={16}
            fill="none" stroke={detail} strokeWidth={0.8}/>
        </>
      )}

      {/* 左上腕 — 胴体から 3px 離れ、幅 ~18px */}
      <Path
        d="M67,82
           C58,94 52,116 49,140
           C46,158 45,174 47,188
           L58,190
           C62,178 64,162 67,140
           C70,116 72,96 73,84 Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* 左前腕・手首 */}
      <Path
        d="M47,188
           C43,205 39,222 37,236
           Q43,244 51,242 Q57,240 59,232
           C59,218 61,204 58,190 Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* 右上腕 */}
      <Path
        d="M153,82
           C162,94 168,116 171,140
           C174,158 175,174 173,188
           L162,190
           C158,178 156,162 153,140
           C150,116 148,96 147,84 Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* 右前腕・手首 */}
      <Path
        d="M173,188
           C177,205 181,222 183,236
           Q177,244 169,242 Q163,240 161,232
           C161,218 159,204 162,190 Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* 左大腿 — 幅 ~36px、脚間に明確なギャップ */}
      <Path
        d="M82,202
           C74,210 68,228 66,252
           C64,272 65,292 68,312
           L80,320 C86,322 94,320 100,316
           L104,306
           C107,288 107,268 105,248
           C103,228 99,210 94,200 Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* 左下腿 */}
      <Path
        d="M68,310
           C64,330 63,350 64,370
           C65,386 68,398 72,408
           L87,408
           C92,406 96,400 97,392
           C98,380 97,358 97,334
           L97,308
           C92,315 80,318 73,314 Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* 左足 */}
      <Path
        d="M64,404 C58,418 54,430 54,435
           Q64,439 78,439 Q90,438 96,430
           Q98,420 97,408 Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* 右大腿 */}
      <Path
        d="M138,202
           C146,210 152,228 154,252
           C156,272 155,292 152,312
           L140,320 C134,322 126,320 120,316
           L116,306
           C113,288 113,268 115,248
           C117,228 121,210 126,200 Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* 右下腿 */}
      <Path
        d="M152,310
           C156,330 157,350 156,370
           C155,386 152,398 148,408
           L133,408
           C128,406 124,400 123,392
           C122,380 123,358 123,334
           L123,308
           C128,315 140,318 147,314 Z"
        fill={fill} stroke={stroke} strokeWidth={sw}/>

      {/* 右足 */}
      <Path
        d="M156,404 C162,418 166,430 166,435
           Q156,439 142,439 Q130,438 124,430
           Q122,420 123,408 Z"
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
                      backgroundColor:'#166534',borderRadius:16,paddingVertical:18,marginTop:16},
  submitTxt:        {color:'#fff',fontSize:16,fontWeight:'800'},

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

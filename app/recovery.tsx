import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Animated,
} from 'react-native'
import { checkAdGate, recordUsage, grantRewardUse } from '../lib/adGate'
import AdGateModal from '../components/AdGateModal'
import Svg, {
  Circle, Ellipse, Path, G, Defs,
  Pattern, Line, ClipPath, Rect,
  Text as SvgText, Filter, FeGaussianBlur, FeComposite,
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
  { id:'head',        label:'頭・首',              front:{type:'circle',cx:110,cy:36,r:26},          back:{type:'circle',cx:110,cy:36,r:26} },
  { id:'neck',        label:'首・頸部',             front:{type:'ellipse',cx:110,cy:73,rx:13,ry:10},  back:{type:'ellipse',cx:110,cy:73,rx:13,ry:10} },
  { id:'shoulder_l',  label:'左肩',                front:{type:'ellipse',cx:63,cy:94,rx:20,ry:13},   back:{type:'ellipse',cx:63,cy:94,rx:20,ry:13} },
  { id:'shoulder_r',  label:'右肩',                front:{type:'ellipse',cx:157,cy:94,rx:20,ry:13},  back:{type:'ellipse',cx:157,cy:94,rx:20,ry:13} },
  { id:'chest',       label:'胸・肋骨',             front:{type:'ellipse',cx:110,cy:120,rx:36,ry:25} },
  { id:'upper_back',  label:'背中（上）',            back:{type:'ellipse',cx:110,cy:118,rx:36,ry:25} },
  { id:'belly',       label:'腹部',                front:{type:'ellipse',cx:110,cy:160,rx:26,ry:17} },
  { id:'lower_back',  label:'腰・下背部',            back:{type:'ellipse',cx:110,cy:160,rx:26,ry:18} },
  { id:'upper_arm_l', label:'左上腕',              front:{type:'ellipse',cx:46,cy:130,rx:12,ry:27},  back:{type:'ellipse',cx:46,cy:130,rx:12,ry:27} },
  { id:'upper_arm_r', label:'右上腕',              front:{type:'ellipse',cx:174,cy:130,rx:12,ry:27}, back:{type:'ellipse',cx:174,cy:130,rx:12,ry:27} },
  { id:'elbow_l',     label:'左肘',                front:{type:'ellipse',cx:39,cy:173,rx:11,ry:10},  back:{type:'ellipse',cx:39,cy:173,rx:11,ry:10} },
  { id:'elbow_r',     label:'右肘',                front:{type:'ellipse',cx:181,cy:173,rx:11,ry:10}, back:{type:'ellipse',cx:181,cy:173,rx:11,ry:10} },
  { id:'forearm_l',   label:'左前腕',              front:{type:'ellipse',cx:34,cy:202,rx:10,ry:22},  back:{type:'ellipse',cx:34,cy:202,rx:10,ry:22} },
  { id:'forearm_r',   label:'右前腕',              front:{type:'ellipse',cx:186,cy:202,rx:10,ry:22}, back:{type:'ellipse',cx:186,cy:202,rx:10,ry:22} },
  { id:'wrist_l',     label:'左手首',              front:{type:'ellipse',cx:28,cy:232,rx:9,ry:9},    back:{type:'ellipse',cx:28,cy:232,rx:9,ry:9} },
  { id:'wrist_r',     label:'右手首',              front:{type:'ellipse',cx:192,cy:232,rx:9,ry:9},   back:{type:'ellipse',cx:192,cy:232,rx:9,ry:9} },
  { id:'hip_l',       label:'左股関節',             front:{type:'ellipse',cx:88,cy:200,rx:26,ry:19},  back:{type:'ellipse',cx:88,cy:200,rx:26,ry:19} },
  { id:'hip_r',       label:'右股関節',             front:{type:'ellipse',cx:132,cy:200,rx:26,ry:19}, back:{type:'ellipse',cx:132,cy:200,rx:26,ry:19} },
  { id:'groin',       label:'鼠径部・内転筋',        front:{type:'ellipse',cx:110,cy:208,rx:14,ry:12} },
  { id:'buttock',     label:'臀部・お尻',            back:{type:'ellipse',cx:110,cy:205,rx:34,ry:22} },
  { id:'quad_l',      label:'大腿前（左）',           front:{type:'ellipse',cx:88,cy:258,rx:20,ry:36} },
  { id:'quad_r',      label:'大腿前（右）',           front:{type:'ellipse',cx:132,cy:258,rx:20,ry:36} },
  { id:'hamstring_l', label:'ハムストリング（左）',    back:{type:'ellipse',cx:88,cy:257,rx:20,ry:36} },
  { id:'hamstring_r', label:'ハムストリング（右）',    back:{type:'ellipse',cx:132,cy:257,rx:20,ry:36} },
  { id:'it_band_l',   label:'腸脛靭帯（左）',         front:{type:'ellipse',cx:72,cy:268,rx:7,ry:32},  back:{type:'ellipse',cx:72,cy:268,rx:7,ry:32} },
  { id:'it_band_r',   label:'腸脛靭帯（右）',         front:{type:'ellipse',cx:148,cy:268,rx:7,ry:32}, back:{type:'ellipse',cx:148,cy:268,rx:7,ry:32} },
  { id:'knee_l',      label:'左膝',                front:{type:'ellipse',cx:87,cy:308,rx:17,ry:13},  back:{type:'ellipse',cx:87,cy:308,rx:17,ry:13} },
  { id:'knee_r',      label:'右膝',                front:{type:'ellipse',cx:133,cy:308,rx:17,ry:13}, back:{type:'ellipse',cx:133,cy:308,rx:17,ry:13} },
  { id:'shin_l',      label:'すね（左）',             front:{type:'ellipse',cx:85,cy:352,rx:12,ry:30} },
  { id:'shin_r',      label:'すね（右）',             front:{type:'ellipse',cx:135,cy:352,rx:12,ry:30} },
  { id:'calf_l',      label:'ふくらはぎ（左）',        back:{type:'ellipse',cx:85,cy:352,rx:13,ry:30} },
  { id:'calf_r',      label:'ふくらはぎ（右）',        back:{type:'ellipse',cx:135,cy:352,rx:13,ry:30} },
  { id:'achilles_l',  label:'アキレス腱（左）',        back:{type:'ellipse',cx:83,cy:393,rx:8,ry:14} },
  { id:'achilles_r',  label:'アキレス腱（右）',        back:{type:'ellipse',cx:137,cy:393,rx:8,ry:14} },
  { id:'ankle_l',     label:'左足首',              front:{type:'ellipse',cx:83,cy:396,rx:11,ry:9},   back:{type:'ellipse',cx:83,cy:396,rx:11,ry:9} },
  { id:'ankle_r',     label:'右足首',              front:{type:'ellipse',cx:137,cy:396,rx:11,ry:9},  back:{type:'ellipse',cx:137,cy:396,rx:11,ry:9} },
  { id:'foot_l',      label:'左足・足底',            front:{type:'ellipse',cx:80,cy:418,rx:18,ry:9},   back:{type:'ellipse',cx:80,cy:418,rx:18,ry:9} },
  { id:'foot_r',      label:'右足・足底',            front:{type:'ellipse',cx:140,cy:418,rx:18,ry:9},  back:{type:'ellipse',cx:140,cy:418,rx:18,ry:9} },
]

const PAIN_TYPES     = [{id:'sharp',label:'鋭い・刺すような'},{id:'dull',label:'鈍い・重い'},{id:'burning',label:'燃えるような・しびれ'},{id:'aching',label:'じんじん・疼く'}]
const TIMING_OPTIONS = [{id:'during',label:'運動中だけ'},{id:'after',label:'運動後だけ'},{id:'both',label:'運動中も後も'},{id:'constant',label:'常時'}]
const DURATION_OPTIONS=[{id:'today',label:'今日初めて'},{id:'3days',label:'2〜3日前から'},{id:'week',label:'1週間前から'},{id:'month',label:'1ヶ月以上'}]
const SEVERITY_COLOR = { mild:'#34C759', moderate:'#FF9500', severe:'#FF3B30' }
const SEVERITY_LABEL = { mild:'軽度', moderate:'中程度', severe:'重度' }
const STORAGE_KEY = 'trackmate_recovery_records'

/* ════════════════════════════════════════════ */
export default function RecoveryScreen() {
  const [bodyParts, setBodyParts] = useState<string[]>([])  // ← 複数選択
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

  /* ── AI相談（実際のAPI呼び出し） ── */
  const askAICore = async () => {
    setApiError('')
    setLoading(true)

    const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? ''
    const partLabels   = bodyParts.map(id => ZONES.find(z=>z.id===id)?.label ?? id).join('、')
    const typeLabel    = PAIN_TYPES.find(p=>p.id===painType)?.label ?? ''
    const timingLabel  = TIMING_OPTIONS.find(p=>p.id===timing)?.label ?? ''
    const durLabel     = DURATION_OPTIONS.find(p=>p.id===duration)?.label ?? '不明'

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{
          'x-api-key': apiKey,
          'anthropic-version':'2023-06-01',
          'content-type':'application/json',
          'anthropic-dangerous-direct-browser-access':'true',
        },
        body: JSON.stringify({
          model:'claude-opus-4-5', max_tokens:2048,
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

  /* ── アドゲートチェック付きエントリーポイント ── */
  const askAI = async () => {
    if (bodyParts.length === 0) { setApiError('部位をタップして選択してください（複数可）'); return }
    if (!painType) { setApiError('痛みの種類を選択してください'); return }
    if (!timing)   { setApiError('発生タイミングを選択してください'); return }
    const gate = await checkAdGate('recovery')
    if (gate.hardLimited || gate.needsAd) {
      setAdGateHardLimited(gate.hardLimited)
      setAdGateVisible(true)
      return
    }
    await recordUsage('recovery')
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

            {/* ─ ワイヤーフレームボディマップ ─ */}
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

            {/* ワイヤーフレームSVG */}
            <View style={s.svgWrap}>
              <WireframeBody view={view} selected={bodyParts} onToggle={togglePart} />
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
                    <Text style={[s.levelTxt,painLevel===n&&{color:'#000'}]}>{n}</Text>
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
              placeholder="動作で痛む・過去の怪我など..." placeholderTextColor="#444"
              multiline numberOfLines={3} />

            {apiError ? (
              <View style={s.errorBox}>
                <Ionicons name="alert-circle" size={14} color="#FF3B30" />
                <Text style={s.errorTxt}>{apiError}</Text>
              </View>
            ) : null}

            <View style={s.disclaimer}>
              <Ionicons name="information-circle-outline" size={13} color="#444" />
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
              ? <View style={s.empty}><Ionicons name="medkit-outline" size={48} color="#2a2a2a"/><Text style={s.emptyTxt}>症状入力タブから相談してください</Text></View>
              : <ResultView result={result} onBack={()=>setTab('input')} />
            }
          </ScrollView>
        )}

        {/* ══ 履歴 ══ */}
        {tab==='history' && (
          <ScrollView contentContainerStyle={s.content}>
            {history.length===0
              ? <View style={s.empty}><Ionicons name="time-outline" size={48} color="#2a2a2a"/><Text style={s.emptyTxt}>相談履歴なし</Text></View>
              : history.map(rec=>(
                <TouchableOpacity key={rec.id} style={s.histCard}
                  onPress={()=>{setResult(rec.result);setTab('result');fadeIn()}}>
                  <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:4}}>
                    <Text style={s.histDate}>{rec.date}</Text>
                    <SevBadge severity={rec.result.severity}/>
                  </View>
                  <Text style={s.histPart}>📍 {rec.bodyParts.map(id=>ZONES.find(z=>z.id===id)?.label??id).join(' / ')}　Lv.{rec.painLevel}</Text>
                  <Text style={s.histDiag}>{rec.result.suspected_condition}</Text>
                  <Ionicons name="chevron-forward" size={15} color="#444" style={{position:'absolute',right:12,top:20}}/>
                </TouchableOpacity>
              ))
            }
          </ScrollView>
        )}
      </Animated.View>

      {/* ── 広告ゲートモーダル ── */}
      <AdGateModal
        visible={adGateVisible}
        feature="recovery"
        hardLimited={adGateHardLimited}
        onClose={() => setAdGateVisible(false)}
        onAdWatched={async () => {
          setAdGateVisible(false)
          await grantRewardUse('recovery')
          await recordUsage('recovery')
          await askAICore()
        }}
        onUpgrade={() => {
          setAdGateVisible(false)
          // TODO: プレミアム画面へのナビゲーションを追加
        }}
      />
    </View>
  )
}

/* ─── ワイヤーフレームボディ SVG ──────────────────── */
function WireframeBody({ view, selected, onToggle }: {
  view:'front'|'back'; selected:string[]; onToggle:(id:string)=>void
}) {
  const W=220, H=440

  // 表示するゾーン
  const zones = ZONES.filter(z => view==='front' ? !!z.front : !!z.back)

  // ゾーンのシェイプ取得
  const getShape = (z: ZoneDef) => view==='front' ? z.front! : z.back!

  // ラベル位置
  const getLabelY = (shape: ZoneShape) => {
    if (shape.type==='circle') return shape.cy - shape.r - 7
    return shape.cy - shape.ry - 7
  }

  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{backgroundColor:'#050505'}}>
      <Defs>
        {/* メッシュグリッドパターン */}
        <Pattern id="mesh" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
          <Line x1="10" y1="0" x2="0" y2="0" stroke="rgba(255,255,255,0.10)" strokeWidth="0.4"/>
          <Line x1="0" y1="0" x2="0" y2="10" stroke="rgba(255,255,255,0.10)" strokeWidth="0.4"/>
        </Pattern>
        {/* 選択時のメッシュ（赤） */}
        <Pattern id="meshRed" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
          <Line x1="10" y1="0" x2="0" y2="0" stroke="rgba(229,57,53,0.45)" strokeWidth="0.5"/>
          <Line x1="0" y1="0" x2="0" y2="10" stroke="rgba(229,57,53,0.45)" strokeWidth="0.5"/>
        </Pattern>
      </Defs>

      {/* ── ボディシルエット（ワイヤーフレーム背景） ── */}
      <BodySilhouette view={view} />

      {/* ── 各ゾーン ── */}
      {zones.map(zone => {
        const shape = getShape(zone)
        const sel   = selected.includes(zone.id)
        const meshId = sel ? 'meshRed' : 'mesh'
        const stroke = sel ? '#E53935' : 'rgba(255,255,255,0.28)'
        const sw     = sel ? 1.8 : 0.8
        const glowOpacity = sel ? 0.18 : 0

        return (
          <G key={zone.id} onPress={() => onToggle(zone.id)}>
            {/* グロー効果（選択時） */}
            {sel && shape.type==='circle' && (
              <Circle cx={shape.cx} cy={shape.cy} r={shape.r+6}
                fill="rgba(229,57,53,0.08)" stroke="rgba(229,57,53,0.2)" strokeWidth={3}/>
            )}
            {sel && shape.type==='ellipse' && (
              <Ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx+5} ry={shape.ry+5}
                fill="rgba(229,57,53,0.08)" stroke="rgba(229,57,53,0.2)" strokeWidth={3}/>
            )}

            {/* メインゾーン */}
            {shape.type==='circle'
              ? <Circle cx={shape.cx} cy={shape.cy} r={shape.r}
                  fill={`url(#${meshId})`} stroke={stroke} strokeWidth={sw}/>
              : <Ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry}
                  fill={`url(#${meshId})`} stroke={stroke} strokeWidth={sw}/>
            }

            {/* 選択中のラベル */}
            {sel && (
              <G>
                <Rect
                  x={shape.cx - 32} y={getLabelY(shape) - 12}
                  width={64} height={14} rx={7}
                  fill="rgba(229,57,53,0.85)"
                />
                <SvgText
                  x={shape.cx} y={getLabelY(shape) - 1}
                  textAnchor="middle" fill="#fff"
                  fontSize={8} fontWeight="bold"
                >{zone.label}</SvgText>
              </G>
            )}
          </G>
        )
      })}

      {/* ヒント */}
      {selected.length===0 && (
        <SvgText x={110} y={H-6} textAnchor="middle" fill="rgba(255,255,255,0.18)" fontSize={9}>
          部位をタップして選択（複数可）
        </SvgText>
      )}
    </Svg>
  )
}

/* ─── ボディシルエット（ワイヤーフレーム輪郭） ─── */
function BodySilhouette({ view }: { view:'front'|'back' }) {
  const lc = 'rgba(255,255,255,0.14)'  // line color
  const sw = 0.7

  return (
    <G>
      {/* 頭 */}
      <Circle cx={110} cy={36} r={28} fill="rgba(255,255,255,0.03)" stroke={lc} strokeWidth={sw}/>
      {/* 頭の中央縦線 */}
      <Line x1={110} y1={10} x2={110} y2={62} stroke={lc} strokeWidth={sw*0.6}/>
      {/* 頭の横線3本 */}
      <Line x1={84} y1={28} x2={136} y2={28} stroke={lc} strokeWidth={sw*0.5}/>
      <Line x1={82} y1={38} x2={138} y2={38} stroke={lc} strokeWidth={sw*0.5}/>
      <Line x1={86} y1={50} x2={134} y2={50} stroke={lc} strokeWidth={sw*0.5}/>

      {/* 首 */}
      <Rect x={98} y={64} width={24} height={18} rx={4} fill="none" stroke={lc} strokeWidth={sw}/>

      {/* 胴体アウトライン */}
      <Path
        d="M68,82 Q55,88 48,102 L44,152 L44,192 L68,200 L80,200 L80,186 L140,186 L140,200 L152,200 L176,192 L176,152 L172,102 Q165,88 152,82 L130,78 L90,78 Z"
        fill="rgba(255,255,255,0.03)" stroke={lc} strokeWidth={sw}
      />
      {/* 胴体 縦中線 */}
      <Line x1={110} y1={82} x2={110} y2={200} stroke={lc} strokeWidth={sw*0.5}/>
      {/* 胴体 横線 */}
      {[100,120,140,160,180].map(y=>(
        <Line key={y} x1={view==='front'?50:50} y1={y} x2={170} y2={y} stroke={lc} strokeWidth={sw*0.5}/>
      ))}

      {/* 左腕 */}
      <Path d="M48,100 Q38,108 30,140 L24,175 L30,180 L44,176 L54,144 L60,104 Z"
        fill="rgba(255,255,255,0.03)" stroke={lc} strokeWidth={sw}/>
      <Path d="M24,175 L18,225 L36,230 L44,178 Z"
        fill="rgba(255,255,255,0.03)" stroke={lc} strokeWidth={sw}/>
      {/* 左腕横線 */}
      {[120,145,165,195,215].map(y=>(
        <Line key={y} x1={21+(y-120)*0.06} y1={y} x2={48-(y-120)*0.06} y2={y}
          stroke={lc} strokeWidth={sw*0.45}/>
      ))}

      {/* 右腕 */}
      <Path d="M172,100 Q182,108 190,140 L196,175 L190,180 L176,176 L166,144 L160,104 Z"
        fill="rgba(255,255,255,0.03)" stroke={lc} strokeWidth={sw}/>
      <Path d="M196,175 L202,225 L184,230 L176,178 Z"
        fill="rgba(255,255,255,0.03)" stroke={lc} strokeWidth={sw}/>
      {[120,145,165,195,215].map(y=>(
        <Line key={y} x1={172+(y-120)*0.06} y1={y} x2={199-(y-120)*0.06} y2={y}
          stroke={lc} strokeWidth={sw*0.45}/>
      ))}

      {/* 左脚 */}
      <Path d="M78,200 L68,206 L62,260 L64,308 L82,314 L98,308 L100,260 L96,206 Z"
        fill="rgba(255,255,255,0.03)" stroke={lc} strokeWidth={sw}/>
      <Path d="M64,308 L60,365 L76,370 L90,366 L96,308 Z"
        fill="rgba(255,255,255,0.03)" stroke={lc} strokeWidth={sw}/>
      <Path d="M58,365 L50,428 L90,430 L92,368 Z"
        fill="rgba(255,255,255,0.03)" stroke={lc} strokeWidth={sw}/>
      {[225,250,275,300,330,360,390].map(y=>(
        <Line key={y} x1={62+(y-225)*0.03} y1={y} x2={100-(y-225)*0.03} y2={y}
          stroke={lc} strokeWidth={sw*0.45}/>
      ))}

      {/* 右脚 */}
      <Path d="M142,200 L152,206 L158,260 L156,308 L138,314 L122,308 L120,260 L124,206 Z"
        fill="rgba(255,255,255,0.03)" stroke={lc} strokeWidth={sw}/>
      <Path d="M156,308 L160,365 L144,370 L130,366 L124,308 Z"
        fill="rgba(255,255,255,0.03)" stroke={lc} strokeWidth={sw}/>
      <Path d="M162,365 L170,428 L130,430 L128,368 Z"
        fill="rgba(255,255,255,0.03)" stroke={lc} strokeWidth={sw}/>
      {[225,250,275,300,330,360,390].map(y=>(
        <Line key={y} x1={120+(y-225)*0.03} y1={y} x2={158-(y-225)*0.03} y2={y}
          stroke={lc} strokeWidth={sw*0.45}/>
      ))}
    </G>
  )
}

/* ─── 診断結果ビュー ────────────────────────────── */
function ResultView({ result, onBack }: { result:RecoveryResult; onBack:()=>void }) {
  return (
    <>
      {/* 免責バナー（結果画面） */}
      <View style={s.disclaimerBanner}>
        <Ionicons name="warning-outline" size={15} color="#FF9500" />
        <Text style={s.disclaimerBannerTxt}>
          このアドバイスはAIによる参考情報です。医療診断・治療行為ではありません。{'\n'}
          症状が続く・悪化する場合は必ず医師・専門家にご相談ください。
        </Text>
      </View>

      <View style={[s.diagCard,{borderLeftColor:SEVERITY_COLOR[result.severity]}]}>
        <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
          <Text style={{color:'#888',fontSize:11,fontWeight:'800'}}>疑われる症状</Text>
          <SevBadge severity={result.severity}/>
        </View>
        <Text style={{color:'#fff',fontSize:20,fontWeight:'900'}}>{result.suspected_condition}</Text>
      </View>
      <Sec icon="flash"        title="今すぐすべきこと" color="#E53935">
        {result.immediate_actions.map((a,i)=><Bullet key={i} text={a} color="#E53935"/>)}
      </Sec>
      <Sec icon="snow"         title="RICE処置" color="#4A9FFF">
        {(['rest','ice','compression','elevation'] as const).map(k=>(
          <View key={k} style={s.riceRow}>
            <Text style={s.riceLabel}>{k==='rest'?'Rest（安静）':k==='ice'?'Ice（アイシング）':k==='compression'?'Compression（圧迫）':'Elevation（挙上）'}</Text>
            <Text style={s.riceVal}>{result.rice_protocol[k]}</Text>
          </View>
        ))}
      </Sec>
      <Sec icon="bandage"      title="テーピング方法" color="#FF9500">
        <View style={{flexDirection:'row',gap:10,marginBottom:10}}>
          <View style={{flex:1}}><Text style={[s.riceLabel,{color:'#FF9500'}]}>目的</Text><Text style={s.riceVal}>{result.taping.purpose}</Text></View>
          <View style={{flex:1}}><Text style={[s.riceLabel,{color:'#FF9500'}]}>テープ種類</Text><Text style={s.riceVal}>{result.taping.tape_type}</Text></View>
        </View>
        <Text style={[s.riceLabel,{color:'#888',marginBottom:6}]}>貼り方（手順）</Text>
        <Text style={{color:'#ccc',fontSize:13,lineHeight:22}}>{result.taping.method}</Text>
      </Sec>
      <Sec icon="time"         title="回復スケジュール" color="#34C759">
        {[result.recovery_timeline.phase1,result.recovery_timeline.phase2,result.recovery_timeline.phase3].map((ph,i)=>(
          <View key={i} style={s.tlRow}>
            <View style={[s.tlDot,{backgroundColor:i===0?'#E53935':i===1?'#FF9500':'#34C759'}]}/>
            <View style={{flex:1}}>
              <Text style={{color:'#fff',fontSize:12,fontWeight:'800',marginBottom:3}}>{ph.period}</Text>
              <Text style={{color:'#aaa',fontSize:13,lineHeight:19}}>{ph.description}</Text>
            </View>
          </View>
        ))}
      </Sec>
      <Sec icon="fitness"      title="リハビリエクササイズ" color="#A855F7">
        {result.exercises.map((e,i)=><Bullet key={i} text={e} color="#A855F7"/>)}
      </Sec>
      <Sec icon="barbell"      title="練習の修正方法" color="#FF9500">
        <Text style={{color:'#ccc',fontSize:13,lineHeight:20}}>{result.training_modification}</Text>
      </Sec>
      <Sec icon="alert-circle" title="病院を受診すべき症状" color="#FF3B30">
        {result.see_doctor_if.map((e,i)=><Bullet key={i} text={e} color="#FF3B30"/>)}
      </Sec>
      <Sec icon="library"      title="参考情報" color="#666">
        <Text style={{color:'#777',fontSize:12,lineHeight:20,fontStyle:'italic'}}>{result.medical_basis}</Text>
      </Sec>
      <TouchableOpacity style={s.reBtn} onPress={onBack}>
        <Ionicons name="refresh-outline" size={14} color="#555"/>
        <Text style={s.reBtnTxt}>別の症状を入力する</Text>
      </TouchableOpacity>
    </>
  )
}

/* ─── 小コンポーネント ─── */
function Sec({icon,title,color,children}:{icon:string;title:string;color:string;children:React.ReactNode}) {
  return (
    <View style={[s.sec,{borderLeftColor:color}]}>
      <View style={s.secHead}><Ionicons name={icon as any} size={15} color={color}/><Text style={[s.secHeadTxt,{color}]}>{title}</Text></View>
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
  bg:{flex:1,backgroundColor:'#f6f6f8'},
  tabBar:{flexDirection:'row',borderBottomWidth:1,borderBottomColor:'rgba(255,255,255,0.08)'},
  tabItem:{flex:1,paddingVertical:12,alignItems:'center'},
  tabActive:{borderBottomWidth:2,borderBottomColor:'#E53935'},
  tabTxt:{color:'#555',fontSize:13,fontWeight:'700'},
  tabTxtActive:{color:'#fff'},
  content:{padding:16,paddingBottom:60},
  secTitle:{color:'#fff',fontSize:14,fontWeight:'800',marginTop:20,marginBottom:10},

  selectedBadge:{flexDirection:'row',alignItems:'center',gap:5,backgroundColor:'rgba(229,57,53,0.12)',
    paddingHorizontal:10,paddingVertical:5,borderRadius:20,marginRight:6,borderWidth:1,borderColor:'rgba(229,57,53,0.3)'},
  selectedTxt:{color:'#E53935',fontSize:12,fontWeight:'700'},
  clearAll:{paddingHorizontal:10,paddingVertical:5,borderRadius:20,backgroundColor:'#f0f2f5',justifyContent:'center'},

  viewToggle:{flexDirection:'row',alignSelf:'center',backgroundColor:'#f0f2f5',borderRadius:20,padding:3,marginBottom:10},
  viewBtn:{paddingHorizontal:22,paddingVertical:7,borderRadius:18},
  viewBtnActive:{backgroundColor:'#ffffff'},
  viewBtnTxt:{color:'#555',fontSize:13,fontWeight:'700'},
  viewBtnTxtActive:{color:'#fff'},
  svgWrap:{alignSelf:'center',marginBottom:8,borderRadius:12,overflow:'hidden'},

  levelRow:{flexDirection:'row',gap:6,flexWrap:'wrap'},
  levelBtn:{width:29,height:29,borderRadius:15,borderWidth:1.5,alignItems:'center',justifyContent:'center'},
  levelTxt:{color:'#888',fontSize:11,fontWeight:'700'},

  chipRow:{flexDirection:'row',flexWrap:'wrap',gap:8},
  chip:{paddingHorizontal:14,paddingVertical:8,borderRadius:20,backgroundColor:'#f0f2f5',borderWidth:1.5,borderColor:'transparent'},
  chipActive:{backgroundColor:'rgba(229,57,53,0.12)',borderColor:'#E53935'},
  chipTxt:{color:'#888',fontSize:13},
  chipTxtActive:{color:'#fff'},

  notesInput:{backgroundColor:'#f8f8fa',borderRadius:12,padding:14,color:'#111827',fontSize:14,minHeight:72,textAlignVertical:'top',borderWidth:1,borderColor:'rgba(255,255,255,0.08)'},
  errorBox:{flexDirection:'row',alignItems:'flex-start',gap:6,marginTop:12,padding:12,backgroundColor:'rgba(255,59,48,0.08)',borderRadius:10},
  errorTxt:{color:'#FF3B30',fontSize:12,lineHeight:18,flex:1},
  disclaimer:{flexDirection:'row',alignItems:'flex-start',gap:6,marginTop:14,padding:10,backgroundColor:'rgba(255,255,255,0.03)',borderRadius:10},
  disclaimerTxt:{color:'#444',fontSize:11,lineHeight:16,flex:1},
  disclaimerBanner:{flexDirection:'row',alignItems:'flex-start',gap:8,padding:12,backgroundColor:'rgba(255,149,0,0.1)',borderRadius:10,borderWidth:1,borderColor:'rgba(255,149,0,0.3)',marginBottom:16},
  disclaimerBannerTxt:{color:'#FF9500',fontSize:11,lineHeight:17,flex:1},
  submitBtn:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'#E53935',borderRadius:16,paddingVertical:18,marginTop:16},
  submitTxt:{color:'#fff',fontSize:16,fontWeight:'800'},

  diagCard:{backgroundColor:'#ffffff',borderRadius:14,padding:16,borderLeftWidth:4,marginBottom:12},
  sevBadge:{paddingHorizontal:10,paddingVertical:3,borderRadius:20},
  sevTxt:{fontSize:11,fontWeight:'800'},
  sec:{backgroundColor:'#f8f8fa',borderRadius:14,padding:14,marginBottom:10,borderLeftWidth:3},
  secHead:{flexDirection:'row',alignItems:'center',gap:6,marginBottom:10},
  secHeadTxt:{fontSize:13,fontWeight:'800'},
  bullet:{flexDirection:'row',alignItems:'flex-start',gap:8,marginBottom:6},
  bulletDot:{width:6,height:6,borderRadius:3,marginTop:6},
  bulletTxt:{color:'#ccc',fontSize:13,lineHeight:20,flex:1},
  riceRow:{marginBottom:8,paddingBottom:8,borderBottomWidth:1,borderBottomColor:'rgba(255,255,255,0.05)'},
  riceLabel:{color:'#4A9FFF',fontSize:11,fontWeight:'800',marginBottom:2},
  riceVal:{color:'#ccc',fontSize:13,lineHeight:18},
  tlRow:{flexDirection:'row',alignItems:'flex-start',gap:12,marginBottom:12},
  tlDot:{width:10,height:10,borderRadius:5,marginTop:4},
  reBtn:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,padding:16},
  reBtnTxt:{color:'#444',fontSize:13},
  histCard:{backgroundColor:'#ffffff',borderRadius:14,padding:14,marginBottom:10},
  histDate:{color:'#555',fontSize:11},
  histPart:{color:'#888',fontSize:12,marginBottom:4},
  histDiag:{color:'#fff',fontSize:15,fontWeight:'700',paddingRight:24},
  empty:{alignItems:'center',paddingTop:80,gap:12},
  emptyTxt:{color:'#333',fontSize:14},
})

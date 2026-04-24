// app/auth.tsx — スライド式ログイン画面（縦スクロール対応・アニメーション付き）

import React, { useRef, useState, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, KeyboardAvoidingView,
  Platform, ScrollView, Dimensions, Animated, Easing,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../context/AuthContext'
import { BRAND, TEXT } from '../lib/theme'
import { Sounds, unlockAudio } from '../lib/sounds'

const { width: SW } = Dimensions.get('window')
const RED   = '#E53E3E'
const BLUE  = '#5AC8FA'
const GREEN = '#34C759'
const AMBER = '#FF9500'

// ══════════════════════════════════════════════════════════════
// アニメーションフック
// ══════════════════════════════════════════════════════════════

function useFadeUp(isActive: boolean, delay = 0) {
  const opacity = useRef(new Animated.Value(0)).current
  const ty      = useRef(new Animated.Value(30)).current
  React.useEffect(() => {
    if (isActive) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 560, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.spring(ty,      { toValue: 0, delay, tension: 60, friction: 10, useNativeDriver: true }),
      ]).start()
    } else {
      opacity.setValue(0); ty.setValue(30)
    }
  }, [isActive])
  return { opacity, transform: [{ translateY: ty }] } as any
}

function useFadeX(isActive: boolean, fromX: number, delay = 0) {
  const opacity = useRef(new Animated.Value(0)).current
  const tx      = useRef(new Animated.Value(fromX)).current
  React.useEffect(() => {
    if (isActive) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 560, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.spring(tx,      { toValue: 0, delay, tension: 60, friction: 10, useNativeDriver: true }),
      ]).start()
    } else {
      opacity.setValue(0); tx.setValue(fromX)
    }
  }, [isActive])
  return { opacity, transform: [{ translateX: tx }] } as any
}

function useScaleFade(isActive: boolean, delay = 0) {
  const opacity = useRef(new Animated.Value(0)).current
  const scale   = useRef(new Animated.Value(0.85)).current
  React.useEffect(() => {
    if (isActive) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 500, delay, useNativeDriver: true }),
        Animated.spring(scale,   { toValue: 1, delay, tension: 70, friction: 9, useNativeDriver: true }),
      ]).start()
    } else {
      opacity.setValue(0); scale.setValue(0.85)
    }
  }, [isActive])
  return { opacity, transform: [{ scale }] } as any
}

function useStagger(isActive: boolean, count: number, baseDelay = 0, step = 80) {
  const anims = useRef(Array.from({ length: count }, () => ({
    opacity: new Animated.Value(0),
    ty:      new Animated.Value(22),
  }))).current
  React.useEffect(() => {
    if (isActive) {
      Animated.parallel(anims.map((a, i) =>
        Animated.parallel([
          Animated.timing(a.opacity, { toValue: 1, duration: 480, delay: baseDelay + i * step, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.spring(a.ty,      { toValue: 0, delay: baseDelay + i * step, tension: 65, friction: 10, useNativeDriver: true }),
        ])
      )).start()
    } else {
      anims.forEach(a => { a.opacity.setValue(0); a.ty.setValue(22) })
    }
  }, [isActive])
  return anims.map(a => ({ opacity: a.opacity, transform: [{ translateY: a.ty }] }) as any)
}

function useArrowBounce() {
  const tx = useRef(new Animated.Value(0)).current
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(tx, { toValue: 8, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(tx, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]))
    loop.start(); return () => loop.stop()
  }, [])
  return tx
}

// ══════════════════════════════════════════════════════════════
// データ
// ══════════════════════════════════════════════════════════════

const CHECKLIST = [
  { id: 'a', text: '怪我で大事な試合を棒に振ったことがある' },
  { id: 'b', text: '練習を頑張っているのにタイムが伸びない' },
  { id: 'c', text: '自分の体の状態を数値で把握できていない' },
  { id: 'd', text: '練習日誌をつけても続かない' },
  { id: 'e', text: '疲労が抜けているか毎回わからない' },
  { id: 'f', text: '練習メニューを毎回一から考えるのが面倒' },
]

// ══════════════════════════════════════════════════════════════
// スライド
// ══════════════════════════════════════════════════════════════

function Slide1({ isActive }: { isActive: boolean }) {
  const arrowTx  = useArrowBounce()
  const logo     = useScaleFade(isActive, 0)
  const title    = useFadeUp(isActive, 160)
  const sub      = useFadeUp(isActive, 280)
  const badges   = useStagger(isActive, 3, 380, 110)
  const hint     = useFadeUp(isActive, 680)

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={sl.scrollContent}
      showsVerticalScrollIndicator={false}
      scrollEnabled={false}
    >
      {/* グリッド装飾（軽量・縦線のみ） */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {[...Array(5)].map((_, i) => (
          <View key={i} style={[sl.gridLine, { left: `${(i + 1) * (100 / 6)}%` as any }]} />
        ))}
      </View>

      <View style={sl.heroContent}>
        {/* ロゴ */}
        <Animated.View style={[sl.logoRow, logo]}>
          <View style={sl.logoMark}>
            <Text style={sl.logoS}>S</Text>
          </View>
          <View>
            <Text style={sl.logoName}>sCORE</Text>
            <Text style={sl.logoTagline}>陸上競技パフォーマンス管理</Text>
          </View>
        </Animated.View>

        <Animated.Text style={[sl.heroTitle, title]}>
          {'体のスコアが、\n怪我を防ぎ\nあなたを強くする。'}
        </Animated.Text>

        <Animated.Text style={[sl.heroSub, sub]}>
          {'睡眠・疲労・練習負荷を統合分析し\n今日のベストな練習をAIが導く'}
        </Animated.Text>

        {/* スコアバッジ */}
        <View style={sl.scoreRow}>
          {([
            { label: '睡眠スコア',    val: '87', color: BLUE,  icon: '😴' },
            { label: '疲労度',        val: '42', color: AMBER, icon: '⚡' },
            { label: 'コンディション', val: '91', color: GREEN, icon: '💪' },
          ] as const).map((item, i) => (
            <Animated.View key={item.label} style={[sl.scoreBadge, { borderColor: item.color + '40' }, badges[i]]}>
              <Text style={{ fontSize: 18 }}>{item.icon}</Text>
              <Text style={[sl.scoreVal, { color: item.color }]}>{item.val}</Text>
              <Text style={sl.scoreLabel}>{item.label}</Text>
            </Animated.View>
          ))}
        </View>

        <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }, hint]}>
          <Text style={sl.hintText}>次のページへ</Text>
          <Animated.View style={{ transform: [{ translateX: arrowTx }] }}>
            <Ionicons name="arrow-forward" size={14} color="#444" />
          </Animated.View>
        </Animated.View>
      </View>
    </ScrollView>
  )
}

function Slide2({ isActive }: { isActive: boolean }) {
  const features = [
    { icon: '📊', color: RED,   title: '体のスコアをリアルタイム把握', desc: '睡眠・疲労・練習負荷を統合分析。今日追い込んでいいか、数値でわかる。' },
    { icon: '🤖', color: BLUE,  title: 'AIが今日のメニューを設計',     desc: '練習ライブラリからピックするだけ。AIがプロコーチ級のメニューを組む。' },
    { icon: '⚡', color: AMBER, title: '怪我リスクを事前に検知',        desc: '疲労・睡眠不足・体調悪化を検知し、怪我する前にアラートを出す。' },
    { icon: '🎯', color: GREEN, title: '目標から逆算して管理',          desc: '試合日・目標タイムを設定。AIが逆算してトレーニング計画を作成。' },
  ]
  const header = useFadeUp(isActive, 0)
  const cards  = useStagger(isActive, 4, 180, 100)

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={sl.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={sl.slideInner}>
        <Animated.View style={header}>
          <Text style={sl.tag}>WHAT sCORE DOES</Text>
          <Text style={sl.sectionTitle}>sCOREができること</Text>
          <Text style={sl.sectionSub}>{'ただ記録して終わりじゃない。\n蓄積されたデータが次の練習を変える。'}</Text>
        </Animated.View>
        <View style={{ gap: 12, marginTop: 24 }}>
          {features.map((f, i) => (
            <Animated.View key={f.title} style={[ft.card, { borderLeftColor: f.color, borderColor: f.color + '28' }, cards[i]]}>
              <View style={[ft.iconWrap, { backgroundColor: f.color + '16' }]}>
                <Text style={{ fontSize: 24 }}>{f.icon}</Text>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[ft.title, { color: f.color }]}>{f.title}</Text>
                <Text style={ft.desc}>{f.desc}</Text>
              </View>
            </Animated.View>
          ))}
        </View>
      </View>
    </ScrollView>
  )
}

function Slide3({ isActive }: { isActive: boolean }) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setChecked(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const header = useFadeUp(isActive, 0)
  const items  = useStagger(isActive, CHECKLIST.length, 160, 65)

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={sl.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={sl.slideInner}>
        <Animated.View style={header}>
          <Text style={sl.tag}>DO YOU RELATE?</Text>
          <Text style={sl.sectionTitle}>こんな経験、ありませんか？</Text>
          <Text style={sl.sectionSub}>当てはまるものを選んでください</Text>
        </Animated.View>
        <View style={{ gap: 10, marginTop: 22 }}>
          {CHECKLIST.map((item, i) => {
            const on = checked.has(item.id)
            return (
              <Animated.View key={item.id} style={items[i]}>
                <TouchableOpacity
                  style={[ck.row, on && ck.rowActive]}
                  onPress={() => toggle(item.id)}
                  activeOpacity={0.75}
                >
                  <View style={[ck.box, on && ck.boxActive]}>
                    {on && <Ionicons name="checkmark" size={12} color="#fff" />}
                  </View>
                  <Text style={[ck.text, on && { color: '#f5f5f5' }]}>{item.text}</Text>
                  {on && <Ionicons name="checkmark-circle" size={16} color={RED} />}
                </TouchableOpacity>
              </Animated.View>
            )
          })}
        </View>
        {checked.size > 0 && (
          <View style={ck.resultCard}>
            <Text style={ck.resultNum}>{checked.size}</Text>
            <View style={{ flex: 1 }}>
              <Text style={ck.resultTitle}>つ当てはまりました</Text>
              <Text style={ck.resultSub}>sCOREはその全てを解決するために作られています。</Text>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  )
}

function Slide4({ isActive }: { isActive: boolean }) {
  const before = ['手書きノートに記録', 'データがバラバラ', '怪我の原因が後からしかわからない', 'メニューを毎回考える', '体の状態は感覚頼み']
  const after  = ['全記録が自動で統合', 'スコアで状態を一目把握', '怪我リスクを事前に検知', 'AIが30秒でメニュー作成', 'データが次の練習の武器に']
  const header  = useFadeUp(isActive, 0)
  const leftCol = useFadeX(isActive, -50, 220)
  const rightCol= useFadeX(isActive,  50, 360)

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={sl.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={sl.slideInner}>
        <Animated.View style={header}>
          <Text style={sl.tag}>BEFORE & AFTER</Text>
          <Text style={sl.sectionTitle}>管理の質が、結果を変える</Text>
          <Text style={[sl.sectionSub, { marginBottom: 24 }]}>同じ努力なら、管理している選手が勝つ。</Text>
        </Animated.View>
        <View style={cp.wrap}>
          <Animated.View style={[cp.col, leftCol]}>
            <View style={cp.head}>
              <Ionicons name="close-circle" size={14} color="#555" />
              <Text style={cp.headLabel}>従来の方法</Text>
            </View>
            {before.map((t, i) => (
              <View key={i} style={[cp.row, i > 0 && cp.rowBorder]}>
                <Text style={cp.iconBad}>✗</Text>
                <Text style={cp.textOld}>{t}</Text>
              </View>
            ))}
          </Animated.View>
          <Animated.View style={[cp.col, cp.colGood, rightCol]}>
            <View style={[cp.head, cp.headGood]}>
              <Ionicons name="checkmark-circle" size={14} color={RED} />
              <Text style={[cp.headLabel, { color: RED }]}>sCORE</Text>
            </View>
            {after.map((t, i) => (
              <View key={i} style={[cp.row, i > 0 && cp.rowBorder]}>
                <Text style={cp.iconGood}>✓</Text>
                <Text style={cp.textNew}>{t}</Text>
              </View>
            ))}
          </Animated.View>
        </View>
      </View>
    </ScrollView>
  )
}

function Slide5({ isActive }: { isActive: boolean }) {
  const header = useFadeUp(isActive, 0)
  const card   = useScaleFade(isActive, 240)

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={sl.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={sl.slideInner}>
        <Animated.View style={header}>
          <Text style={sl.tag}>FROM THE DEVELOPER</Text>
          <Text style={sl.sectionTitle}>開発者からのメッセージ</Text>
        </Animated.View>
        <Animated.View style={[dv.card, card]}>
          <View style={dv.accent} />
          <View style={{ flex: 1, gap: 0 }}>
            <Text style={dv.openQuote}>"</Text>
            <Text style={dv.msg}>
              {'陸上競技を続けてきた中で、何度も怪我に悩まされました。\n\n疲労が抜けているのか、今日追い込んでいいのか、毎回感覚で判断するしかなかった。そして何度も「やりすぎ」で離脱しました。\n\nあの時、自分の体の状態をちゃんと数値で見ることができていたら。怪我をする前にサインに気づけていたら。\n\nその後悔から、sCOREは生まれました。\n\n同じ思いをする選手を、一人でも減らしたい。全力で練習できる選手を、一人でも増やしたい。\n\nスタートラインに立ち続けることが、最強の戦略だと信じています。'}
            </Text>
            <View style={dv.sigRow}>
              <View style={dv.sigLine} />
              <Text style={dv.sig}>sCORE 開発者</Text>
            </View>
          </View>
        </Animated.View>
      </View>
    </ScrollView>
  )
}

function Slide6({ isActive }: { isActive: boolean }) {
  const { signInWithGoogle, signUpWithEmail, continueAsGuest } = useAuth()
  const [googleLoading, setGoogleLoading] = useState(false)
  const [showSignup, setShowSignup] = useState(false)
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading]   = useState(false)

  const handleGoogle = () => {
    unlockAudio(); Sounds.pop()
    setGoogleLoading(true)
    signInWithGoogle().finally(() => setGoogleLoading(false))
  }
  const handleSignup = async () => {
    if (!email.trim() || password.length < 6) return
    unlockAudio(); Sounds.pop()
    setLoading(true)
    try { await signUpWithEmail(email.trim(), password) }
    finally { setLoading(false) }
  }

  const header  = useFadeUp(isActive, 0)
  const google  = useFadeUp(isActive, 180)
  const divider = useFadeUp(isActive, 300)
  const emailBtn= useFadeUp(isActive, 390)
  const guest   = useFadeUp(isActive, 500)

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={sl.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={[sl.slideInner, { alignItems: 'center' }]}>

          <Animated.View style={[{ width: '100%', alignItems: 'center', marginBottom: 32 }, header]}>
            <View style={lg.logoSmall}>
              <Text style={lg.logoSmallS}>S</Text>
            </View>
            <Text style={sl.tag}>GET STARTED</Text>
            <Text style={[sl.sectionTitle, { textAlign: 'center', fontSize: 28 }]}>無料で始める</Text>
            <Text style={[sl.sectionSub, { textAlign: 'center' }]}>登録無料・クレジットカード不要</Text>
          </Animated.View>

          {/* Google */}
          <Animated.View style={[{ width: '100%' }, google]}>
            <TouchableOpacity style={lg.googleBtn} onPress={handleGoogle} disabled={googleLoading} activeOpacity={0.85}>
              {googleLoading ? <ActivityIndicator color="#111" size="small" /> : (
                <>
                  <View style={lg.gIconWrap}><Text style={lg.gIconText}>G</Text></View>
                  <Text style={lg.googleText}>Google でログイン</Text>
                </>
              )}
            </TouchableOpacity>
          </Animated.View>

          <Animated.View style={[lg.divRow, divider]}>
            <View style={lg.divLine} /><Text style={lg.divText}>または</Text><View style={lg.divLine} />
          </Animated.View>

          <Animated.View style={[{ width: '100%' }, emailBtn]}>
            {!showSignup ? (
              <TouchableOpacity style={lg.emailBtn} onPress={() => { setShowSignup(true); Sounds.tap() }} activeOpacity={0.7}>
                <Ionicons name="person-add-outline" size={17} color={BRAND} />
                <Text style={lg.emailBtnText}>メールで新規アカウント作成</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ gap: 10 }}>
                <Text style={lg.signupTitle}>新規アカウント作成</Text>
                <View style={lg.inputWrap}>
                  <Ionicons name="mail-outline" size={16} color={TEXT.hint} />
                  <TextInput style={lg.input} placeholder="メールアドレス" placeholderTextColor={TEXT.hint} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
                </View>
                <View style={lg.inputWrap}>
                  <Ionicons name="lock-closed-outline" size={16} color={TEXT.hint} />
                  <TextInput style={[lg.input, { flex: 1 }]} placeholder="パスワード（6文字以上）" placeholderTextColor={TEXT.hint} value={password} onChangeText={setPassword} secureTextEntry={!showPass} autoCapitalize="none" />
                  <TouchableOpacity onPress={() => setShowPass(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={TEXT.hint} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={[lg.primaryBtn, (!email.trim() || password.length < 6) && { opacity: 0.4 }]} onPress={handleSignup} disabled={loading || !email.trim() || password.length < 6} activeOpacity={0.85}>
                  {loading ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="person-add" size={16} color="#fff" /><Text style={lg.primaryBtnText}>アカウント作成</Text></>}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowSignup(false)} style={{ alignItems: 'center', paddingVertical: 6 }}>
                  <Text style={{ color: TEXT.hint, fontSize: 13 }}>キャンセル</Text>
                </TouchableOpacity>
              </View>
            )}
          </Animated.View>

          <Animated.View style={[{ width: '100%' }, guest]}>
            <TouchableOpacity style={lg.guestBtn} onPress={() => { unlockAudio(); Sounds.tap(); continueAsGuest() }} activeOpacity={0.7}>
              <Ionicons name="person-outline" size={16} color={TEXT.hint} />
              <Text style={lg.guestText}>ゲストとして続ける</Text>
            </TouchableOpacity>
            <Text style={lg.footer}>ログインすることで利用規約とプライバシーポリシーに同意したことになります</Text>
          </Animated.View>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ══════════════════════════════════════════════════════════════
// カスタムページャー
// ══════════════════════════════════════════════════════════════

type SlideProps = { isActive: boolean }
const SLIDES: Array<(p: SlideProps) => React.ReactElement> = [Slide1, Slide2, Slide3, Slide4, Slide5, Slide6]
const TOTAL = SLIDES.length

export default function AuthScreen() {
  const [page, setPage] = useState(0)
  const translateX = useRef(new Animated.Value(0)).current
  const touchStartX = useRef(0)

  const goTo = useCallback((idx: number) => {
    const target = Math.max(0, Math.min(TOTAL - 1, idx))
    Animated.spring(translateX, {
      toValue: -target * SW,
      tension: 80, friction: 16,
      useNativeDriver: true,
    }).start()
    setPage(target)
  }, [])

  const handleTouchStart = (e: any) => {
    touchStartX.current = e.nativeEvent.pageX
  }
  const handleTouchEnd = (e: any) => {
    const diff = touchStartX.current - e.nativeEvent.pageX
    if (diff > 50 && page < TOTAL - 1) goTo(page + 1)
    else if (diff < -50 && page > 0)    goTo(page - 1)
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#050505' }}>
      {/* スライドコンテナ（overflow:hidden） */}
      <View
        style={{ flex: 1, overflow: 'hidden' }}
        onStartShouldSetResponder={() => true}
        onResponderGrant={handleTouchStart}
        onResponderRelease={handleTouchEnd}
      >
        <Animated.View style={{
          flexDirection: 'row',
          width: SW * TOTAL,
          flex: 1,
          transform: [{ translateX }],
        }}>
          {SLIDES.map((SlideComp, i) => (
            <View key={i} style={{ width: SW, flex: 1 }}>
              <SlideComp isActive={page === i} />
            </View>
          ))}
        </Animated.View>
      </View>

      {/* ナビゲーションバー */}
      <View style={nav.bar}>
        {/* ドット */}
        <View style={nav.dotsRow}>
          {SLIDES.map((_, i) => (
            <TouchableOpacity key={i} onPress={() => goTo(i)} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
              <Animated.View style={[nav.dot, i === page && nav.dotActive]} />
            </TouchableOpacity>
          ))}
        </View>

        {/* ボタン行 */}
        <View style={nav.btnRow}>
          {page > 0 ? (
            <TouchableOpacity style={nav.backBtn} onPress={() => goTo(page - 1)} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={16} color="rgba(255,255,255,0.6)" />
              <Text style={nav.backText}>戻る</Text>
            </TouchableOpacity>
          ) : <View style={{ flex: 1 }} />}

          {page < TOTAL - 1 && (
            <TouchableOpacity
              style={nav.nextBtn}
              onPress={() => { Sounds.tap(); goTo(page + 1) }}
              activeOpacity={0.85}
            >
              <Text style={nav.nextText}>{page === TOTAL - 2 ? 'ログイン画面へ' : '次へ'}</Text>
              <Ionicons name="chevron-forward" size={16} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  )
}

// ══════════════════════════════════════════════════════════════
// スタイル
// ══════════════════════════════════════════════════════════════

const sl = StyleSheet.create({
  scrollContent: { flexGrow: 1, minHeight: '100%' as any },
  heroContent:   { flex: 1, padding: 28, paddingTop: 80, paddingBottom: 16, justifyContent: 'flex-end' },
  slideInner:    { padding: 26, paddingTop: 64, paddingBottom: 24 },

  gridLine:   { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.03)' },

  logoRow:    { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 36 },
  logoMark:   { width: 56, height: 56, borderRadius: 16, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  logoS:      { color: '#fff', fontSize: 30, fontWeight: '900' },
  logoName:   { color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: -1 },
  logoTagline:{ color: '#555', fontSize: 10, fontWeight: '600', letterSpacing: 1.5 },

  heroTitle:  { color: '#fff', fontSize: 38, fontWeight: '900', letterSpacing: -1.5, lineHeight: 48, marginBottom: 18 },
  heroSub:    { color: '#666', fontSize: 14, lineHeight: 23, marginBottom: 36 },

  scoreRow:   { flexDirection: 'row', gap: 10, marginBottom: 20 },
  scoreBadge: { flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, borderWidth: 1,
    padding: 14, alignItems: 'center', gap: 4 },
  scoreVal:   { fontSize: 24, fontWeight: '900' },
  scoreLabel: { color: '#555', fontSize: 9, fontWeight: '700', textAlign: 'center', letterSpacing: 0.3 },

  hintText:   { color: '#3a3a3a', fontSize: 12 },

  tag:         { color: '#444', fontSize: 10, fontWeight: '800', letterSpacing: 2.5, marginBottom: 10 },
  sectionTitle:{ color: '#fff', fontSize: 27, fontWeight: '900', letterSpacing: -0.8, marginBottom: 10 },
  sectionSub:  { color: '#666', fontSize: 14, lineHeight: 22 },
})

const ft = StyleSheet.create({
  card:    { flexDirection: 'row', alignItems: 'flex-start', gap: 14, backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16, borderWidth: 1, borderLeftWidth: 3, padding: 16 },
  iconWrap:{ width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title:   { fontSize: 13, fontWeight: '800', marginBottom: 5 },
  desc:    { color: '#777', fontSize: 12, lineHeight: 18 },
})

const ck = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)', padding: 16 },
  rowActive: { borderColor: RED + '50', backgroundColor: 'rgba(229,62,62,0.06)' },
  box:       { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#333',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  boxActive: { backgroundColor: RED, borderColor: RED },
  text:      { flex: 1, color: '#777', fontSize: 14, lineHeight: 20 },
  resultCard:{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18,
    backgroundColor: 'rgba(229,62,62,0.1)', borderRadius: 16, borderWidth: 1,
    borderColor: RED + '40', padding: 18 },
  resultNum: { fontSize: 48, fontWeight: '900', color: RED, lineHeight: 52 },
  resultTitle:{ color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 4 },
  resultSub:  { color: '#aaa', fontSize: 12, lineHeight: 18 },
})

const cp = StyleSheet.create({
  wrap:     { flexDirection: 'row', gap: 10 },
  col:      { flex: 1, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 16, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  colGood:  { borderColor: RED + '40', backgroundColor: 'rgba(229,62,62,0.04)' },
  head:     { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12,
    backgroundColor: 'rgba(255,255,255,0.04)', justifyContent: 'center' },
  headGood: { backgroundColor: 'rgba(229,62,62,0.1)' },
  headLabel:{ color: '#888', fontSize: 12, fontWeight: '800' },
  row:      { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10 },
  rowBorder:{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.04)' },
  iconBad:  { color: '#444', fontSize: 12, marginTop: 1 },
  iconGood: { color: GREEN, fontSize: 12, marginTop: 1 },
  textOld:  { flex: 1, color: '#4a4a4a', fontSize: 11, lineHeight: 17 },
  textNew:  { flex: 1, color: '#e0e0e0', fontSize: 11, lineHeight: 17 },
})

const dv = StyleSheet.create({
  card:     { flexDirection: 'row', gap: 16, backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', padding: 22, marginTop: 20 },
  accent:   { width: 3, borderRadius: 2, backgroundColor: RED, flexShrink: 0 },
  openQuote:{ color: RED, fontSize: 52, fontWeight: '900', lineHeight: 44, marginBottom: 8 },
  msg:      { color: '#999', fontSize: 14, lineHeight: 26 },
  sigRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
  sigLine:  { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  sig:      { color: '#444', fontSize: 12, fontStyle: 'italic' },
})

const lg = StyleSheet.create({
  logoSmall:   { width: 56, height: 56, borderRadius: 16, backgroundColor: RED,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  logoSmallS:  { color: '#fff', fontSize: 28, fontWeight: '900' },

  googleBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 18, paddingVertical: 18, marginBottom: 0 },
  gIconWrap:   { width: 24, height: 24, borderRadius: 12, backgroundColor: '#4285F4',
    alignItems: 'center', justifyContent: 'center' },
  gIconText:   { fontSize: 13, fontWeight: '900', color: '#fff' },
  googleText:  { color: '#111', fontSize: 16, fontWeight: '800' },

  divRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16, width: '100%' },
  divLine:     { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.12)' },
  divText:     { color: '#444', fontSize: 12 },

  emailBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderWidth: 1, borderColor: BRAND + '80', borderRadius: 18, paddingVertical: 17 },
  emailBtnText:{ color: BRAND, fontSize: 15, fontWeight: '700' },

  signupTitle: { color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
  inputWrap:   { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)', gap: 10 },
  input:       { flex: 1, color: '#fff', fontSize: 15, outlineStyle: 'none' as any },
  primaryBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: BRAND, borderRadius: 16, paddingVertical: 17 },
  primaryBtnText:{ color: '#fff', fontSize: 15, fontWeight: '800' },

  guestBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 18 },
  guestText:   { color: '#444', fontSize: 14 },
  footer:      { color: '#333', fontSize: 10, textAlign: 'center', lineHeight: 16, paddingBottom: 8 },
})

const nav = StyleSheet.create({
  bar:      { paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 36 : 22, paddingTop: 14,
    backgroundColor: 'rgba(5,5,5,0.92)', borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)' },
  dotsRow:  { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 14 },
  dot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: '#282828' },
  dotActive:{ backgroundColor: RED, width: 22 },
  btnRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  backText: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '600' },
  nextBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: RED,
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 24 },
  nextText: { color: '#fff', fontWeight: '900', fontSize: 14 },
})

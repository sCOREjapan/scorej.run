import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Modal, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import HapticTouch from '../components/HapticTouch'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { BG_GRADIENT, TEXT, BRAND, NEON } from '../lib/theme'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Toast from 'react-native-toast-message'

// ── キー ─────────────────────────────────────────────────
const LIBRARY_KEY  = 'trackmate_exercise_library'
const HISTORY_KEY  = 'trackmate_ai_menus'

// Hermesの AbortSignal.timeout 非対応に対応したタイムアウト付きfetch
function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return fetch(url, { ...options, signal: AbortSignal.timeout(ms) })
  }
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id))
}

// ── 型 ───────────────────────────────────────────────────
export interface LibraryFolder {
  id: string
  name: string
  color: string
  icon: string
  items: string[]   // 種目名（テキスト）
  created_at: string
}

export interface AIGeneratedMenu {
  id: string
  intent: string
  result: string
  created_at: string
}

export interface PickedItem {
  text: string
  folderName: string
  folderColor: string
  folderId: string
}

// ── フォルダカラー選択肢 ─────────────────────────────────
const FOLDER_COLORS = [
  '#E53935', '#FF9800', '#4CAF50', '#2196F3',
  '#9C27B0', '#00BCD4', '#FF5722', '#607D8B',
]
const FOLDER_ICONS = [
  'flash', 'walk', 'body', 'barbell',
  'fitness', 'bicycle', 'stopwatch', 'heart',
]

// ── uid ──────────────────────────────────────────────────
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2,7)}` }

// ── FolderCard ───────────────────────────────────────────
function FolderCard({
  folder,
  onPress,
  onEdit,
}: {
  folder: LibraryFolder
  onPress: () => void
  onEdit: () => void
}) {
  return (
    <HapticTouch haptic="tap" onPress={onPress} activeOpacity={0.8} style={fc.card}>
      <View style={[fc.iconWrap, { backgroundColor: folder.color + '22' }]}>
        <Ionicons name={folder.icon as any} size={22} color={folder.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={fc.name}>{folder.name}</Text>
        <Text style={fc.count}>{folder.items.length}種目</Text>
      </View>
      <TouchableOpacity onPress={onEdit} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="ellipsis-horizontal" size={18} color="#555" />
      </TouchableOpacity>
    </HapticTouch>
  )
}
const fc = StyleSheet.create({
  card:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#ffffff', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  name:     { color: TEXT.primary, fontSize: 15, fontWeight: '700' },
  count:    { color: TEXT.secondary, fontSize: 12, marginTop: 2 },
})

// ── ItemRow ──────────────────────────────────────────────
function ItemRow({
  text,
  index,
  total,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  text: string
  index: number
  total: number
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  return (
    <View style={ir.row}>
      {/* 並び替えボタン */}
      <View style={ir.sortBtns}>
        <TouchableOpacity
          onPress={onMoveUp}
          disabled={index === 0}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={[ir.sortBtn, index === 0 && { opacity: 0.2 }]}
        >
          <Ionicons name="chevron-up" size={14} color="#aaa" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onMoveDown}
          disabled={index === total - 1}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={[ir.sortBtn, index === total - 1 && { opacity: 0.2 }]}
        >
          <Ionicons name="chevron-down" size={14} color="#aaa" />
        </TouchableOpacity>
      </View>
      <View style={ir.dot} />
      <Text style={ir.text}>{text}</Text>
      <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close-circle" size={18} color="#444" />
      </TouchableOpacity>
    </View>
  )
}
const ir = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  sortBtns: { flexDirection: 'column', alignItems: 'center', gap: 0 },
  sortBtn:  { padding: 2 },
  dot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: BRAND },
  text:     { flex: 1, color: '#fff', fontSize: 14 },  // kept white — ItemRow renders inside dark modal
})

// ── メイン ───────────────────────────────────────────────
export default function WorkoutMenuScreen() {
  const [tab, setTab] = useState<'library' | 'history'>('library')
  const [folders, setFolders] = useState<LibraryFolder[]>([])
  const [history, setHistory] = useState<AIGeneratedMenu[]>([])

  // ピックAIモーダル
  const [pickModal, setPickModal] = useState(false)
  const [pickedItems, setPickedItems] = useState<PickedItem[]>([])
  const [pickIntent, setPickIntent] = useState('')
  const [expandedFolders, setExpandedFolders] = useState<string[]>([])
  const [pickStep, setPickStep] = useState<'select' | 'generate'>('select')
  const [pickLoading, setPickLoading] = useState(false)
  const [pickResult, setPickResult] = useState('')

  // フォルダ編集モーダル
  const [folderModal, setFolderModal] = useState(false)
  const [editFolder, setEditFolder] = useState<LibraryFolder | null>(null)
  const [folderName, setFolderName] = useState('')
  const [folderColor, setFolderColor] = useState(FOLDER_COLORS[0])
  const [folderIcon, setFolderIcon] = useState(FOLDER_ICONS[0])

  // フォルダ詳細モーダル
  const [detailModal, setDetailModal] = useState(false)
  const [detailFolder, setDetailFolder] = useState<LibraryFolder | null>(null)
  const [newItemText, setNewItemText] = useState('')

  // AI生成モーダル
  const [aiModal, setAiModal] = useState(false)
  const [aiIntent, setAiIntent] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState('')
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([])

  // 履歴詳細モーダル
  const [histModal, setHistModal] = useState(false)
  const [histItem, setHistItem] = useState<AIGeneratedMenu | null>(null)

  const load = useCallback(async () => {
    const [f, h] = await AsyncStorage.multiGet([LIBRARY_KEY, HISTORY_KEY]).catch(() => [[], []] as any)
    try { if (f[1]) setFolders(JSON.parse(f[1])) } catch {}  // データ破損でも履歴を読み込む
    try { if (h[1]) setHistory(JSON.parse(h[1])) } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  async function saveFolders(next: LibraryFolder[]) {
    setFolders(next)
    await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(next)).catch(() => {})
  }

  // ── フォルダ保存 ──────────────────────────────────────
  function openAddFolder() {
    setEditFolder(null)
    setFolderName('')
    setFolderColor(FOLDER_COLORS[0])
    setFolderIcon(FOLDER_ICONS[0])
    setFolderModal(true)
  }

  function openEditFolder(f: LibraryFolder) {
    setEditFolder(f)
    setFolderName(f.name)
    setFolderColor(f.color)
    setFolderIcon(f.icon)
    setFolderModal(true)
  }

  async function handleSaveFolder() {
    if (!folderName.trim()) return
    if (editFolder) {
      const next = folders.map(f => f.id === editFolder.id
        ? { ...f, name: folderName.trim(), color: folderColor, icon: folderIcon }
        : f)
      await saveFolders(next)
      if (detailFolder?.id === editFolder.id) {
        setDetailFolder(next.find(f => f.id === editFolder.id) ?? null)
      }
    } else {
      const newF: LibraryFolder = {
        id: uid(), name: folderName.trim(), color: folderColor,
        icon: folderIcon, items: [], created_at: new Date().toISOString(),
      }
      await saveFolders([...folders, newF])
    }
    setFolderModal(false)
  }

  async function handleDeleteFolder(id: string) {
    const next = folders.filter(f => f.id !== id)
    await saveFolders(next)
    setFolderModal(false)
  }

  // ── 種目追加 ──────────────────────────────────────────
  async function handleAddItem() {
    if (!newItemText.trim() || !detailFolder) return
    const updated: LibraryFolder = { ...detailFolder, items: [...detailFolder.items, newItemText.trim()] }
    const next = folders.map(f => f.id === detailFolder.id ? updated : f)
    setDetailFolder(updated)
    setNewItemText('')
    await saveFolders(next)
  }

  async function handleRemoveItem(idx: number) {
    if (!detailFolder) return
    const items = detailFolder.items.filter((_, i) => i !== idx)
    const updated: LibraryFolder = { ...detailFolder, items }
    const next = folders.map(f => f.id === detailFolder.id ? updated : f)
    setDetailFolder(updated)
    await saveFolders(next)
  }

  async function handleMoveItem(idx: number, dir: 'up' | 'down') {
    if (!detailFolder) return
    const items = [...detailFolder.items]
    const target = dir === 'up' ? idx - 1 : idx + 1
    if (target < 0 || target >= items.length) return
    ;[items[idx], items[target]] = [items[target], items[idx]]
    const updated: LibraryFolder = { ...detailFolder, items }
    const next = folders.map(f => f.id === detailFolder.id ? updated : f)
    setDetailFolder(updated)
    await saveFolders(next)
  }

  // ── ピックAI ──────────────────────────────────────────
  function openPicker() {
    setPickedItems([])
    setPickIntent('')
    setPickResult('')
    setExpandedFolders(folders.length > 0 ? [folders[0].id] : [])
    setPickStep('select')
    setPickModal(true)
  }

  function togglePickItem(folder: LibraryFolder, item: string) {
    setPickedItems(prev => {
      const exists = prev.some(p => p.folderId === folder.id && p.text === item)
      if (exists) return prev.filter(p => !(p.folderId === folder.id && p.text === item))
      return [...prev, { text: item, folderName: folder.name, folderColor: folder.color, folderId: folder.id }]
    })
  }

  function toggleExpandFolder(id: string) {
    setExpandedFolders(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handleGenerateFromPicked() {
    if (pickedItems.length === 0) return
    setPickLoading(true)
    setPickResult('')
    try {
      const _apiBase1 = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '')
      const _endpoint1 = _apiBase1 ? `${_apiBase1}/api/analyze` : '/api/analyze'

      const libraryText = pickedItems.map(p => `・${p.text}（${p.folderName}）`).join('\n')

      const systemPrompt1 = `あなたは日本トップレベルの陸上競技コーチです。国体・インターハイ・実業団選手の指導経験があり、科学的トレーニング理論（ピリオダイゼーション・超回復・ATP-PC系/乳酸系/有酸素系のエネルギー供給）を実践に落とし込んだメニュー設計が得意です。

メニュー設計の原則：
- ウォームアップは「体温上昇→関節可動域→神経系活性化」の順で段階的に
- メインは目的（スピード/持久/筋力/技術）を明確にしてセット数・本数・休憩を具体的に
- クールダウンはメインの強度に応じた適切な長さで、翌日に向けたリカバリーを意識
- セット間の休憩時間は必ず記載（例：「レスト3分」）
- 総練習時間の目安を書く
- 「なぜこの構成なのか」の理由をコーチとして簡潔に語る`

      const prompt = `選手が以下の種目をピックアップしました。これらをメインに組み込んだ、今日の完全な練習メニューを作ってください。

【ピックアップ種目】
${libraryText}

【選手の今日のイメージ・意図】
${pickIntent.trim() || '特に指定なし（コーチの判断で最適なメニューを）'}

━━━━━━━━━━━━━━━━━━━━━

以下の形式で、プロコーチとして詳細なメニューを作成してください：

📋 **今日のメニュー**
（目的・テーマを1行で）
（推定所要時間：〇〇分）

**🔥 ウォームアップ（〇分）**
1. （種目）×（時間/距離/回数）
2. ...
※ 各種目の目的を一言添える

**⚡ メイン練習（〇分）**
（ピックアップ種目を必ず中心に構成）
1. （種目）（セット数）×（本数/距離）— レスト（時間）
   → 目標ペース/強度：（具体的に）
2. ...

**🌊 クールダウン（〇分）**
1. （種目）×（時間）
2. ...

**💬 コーチから**
（このメニューの意図・今日のポイント・選手への熱いメッセージを3〜5文で。「なぜこの構成か」を含める）`

      {
        const res = await fetchWithTimeout(_endpoint1, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: 1500,
            system: systemPrompt1,
            messages: [{ role: 'user', content: prompt }],
          }),
        }, 45000)
        if (res.ok) {
          const data = await res.json()
          const text = data.content?.[0]?.text ?? 'メニューを生成できませんでした'
          setPickResult(text)
          const entry: AIGeneratedMenu = {
            id: uid(),
            intent: `[ピック] ${pickedItems.map(p => p.text).join('・')}` + (pickIntent.trim() ? ` / ${pickIntent.trim()}` : ''),
            result: text,
            created_at: new Date().toISOString(),
          }
          const next = [entry, ...history].slice(0, 30)
          setHistory(next)
          await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)).catch(() => {})
        } else {
          setPickResult('APIエラーが発生しました。しばらくしてから再試行してください。')
        }
      }
    } catch {
      setPickResult('生成に失敗しました。もう一度お試しください。')
    } finally {
      setPickLoading(false)
    }
  }

  // ── AI生成 ────────────────────────────────────────────
  function openAI() {
    setAiIntent('')
    setAiResult('')
    setSelectedFolderIds(folders.map(f => f.id))
    setAiModal(true)
  }

  async function handleGenerate() {
    if (!aiIntent.trim()) return
    setAiLoading(true)
    setAiResult('')
    try {
      const _apiBase2 = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '')
      const _endpoint2 = _apiBase2 ? `${_apiBase2}/api/analyze` : '/api/analyze'
      const useFolders = folders.filter(f => selectedFolderIds.includes(f.id) && f.items.length > 0)

      const libraryText = useFolders.map(f =>
        `【${f.name}】\n${f.items.map(item => `・${item}`).join('\n')}`
      ).join('\n\n')

      const systemPrompt2 = `あなたは日本トップレベルの陸上競技コーチです。国体・インターハイ・実業団選手の指導経験があり、科学的トレーニング理論（ピリオダイゼーション・超回復・ATP-PC系/乳酸系/有酸素系のエネルギー供給）を実践に落とし込んだメニュー設計が得意です。

メニュー設計の原則：
- ウォームアップは「体温上昇→関節可動域→神経系活性化」の順で段階的に
- メインは目的（スピード/持久/筋力/技術）を明確にしてセット数・本数・休憩を具体的に
- クールダウンはメインの強度に応じた適切な長さで、翌日に向けたリカバリーを意識
- セット間の休憩時間は必ず記載
- 総練習時間の目安を書く
- 選手の意図・要望に応えながら、科学的に正しい負荷設計をする
- ライブラリにある種目を最大限活用し、不足する場合は理由とともに補完種目を提案する`

      const prompt = `選手からのリクエスト：「${aiIntent.trim()}」

【選手の練習ライブラリ】
${libraryText || '（まだライブラリに種目が登録されていません）'}

━━━━━━━━━━━━━━━━━━━━━

このリクエストと選手のライブラリを踏まえて、今日の完全な練習メニューを作ってください。

📋 **今日のメニュー**
（テーマ・目的を1行で）
（推定所要時間：〇〇分）

**🔥 ウォームアップ（〇分）**
1. （種目）×（時間/距離/回数） — （目的）
2. ...

**⚡ メイン練習（〇分）**
1. （種目）（セット数）×（本数/距離）— レスト（時間）
   → 強度/目標：（具体的に）
2. ...

**🌊 クールダウン（〇分）**
1. （種目）×（時間）
2. ...

**💬 コーチから**
（選手のリクエストを受けてどんな意図でこのメニューを設計したか。今日のポイントと注意点。最後に選手への一言。計4〜6文で熱く語る）`

      {
        const res = await fetchWithTimeout(_endpoint2, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: 1500,
            system: systemPrompt2,
            messages: [{ role: 'user', content: prompt }],
          }),
        }, 45000)
        if (res.ok) {
          const data = await res.json()
          const text = data.content?.[0]?.text ?? 'メニューを生成できませんでした'
          setAiResult(text)
          // 履歴保存
          const entry: AIGeneratedMenu = {
            id: uid(), intent: aiIntent.trim(), result: text,
            created_at: new Date().toISOString(),
          }
          const next = [entry, ...history].slice(0, 30)
          setHistory(next)
          await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)).catch(() => {})
        } else {
          setAiResult('APIエラーが発生しました。しばらくしてから再試行してください。')
        }
      }
    } catch {
      setAiResult('生成に失敗しました。もう一度お試しください。')
    } finally {
      setAiLoading(false)
    }
  }

  const todayStr = new Date().toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' })

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient colors={BG_GRADIENT} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={s.safe}>

        {/* ── タブ ── */}
        <View style={s.tabBar}>
          {([['library', '📁 ライブラリ'], ['history', '🤖 AI生成履歴']] as const).map(([key, label]) => (
            <HapticTouch
              haptic="tabSwitch"
              key={key}
              onPress={() => setTab(key)}
              style={[s.tabBtn, tab === key && s.tabBtnActive]}
              activeOpacity={0.8}
            >
              <Text style={[s.tabText, tab === key && s.tabTextActive]}>{label}</Text>
            </HapticTouch>
          ))}
        </View>

        {tab === 'library' ? (
          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

            {/* 手動ピッカーボタン */}
            <HapticTouch haptic="whoosh" style={s.manualBtn} onPress={openPicker} activeOpacity={0.85}>
              <View style={s.manualBtnIcon}>
                <Text style={{ fontSize: 24 }}>📋</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.manualBtnTitle}>種目をピックしてAI生成</Text>
                <Text style={s.manualBtnSub}>使いたい種目を選んでAIにメニューを作ってもらう</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={NEON.green} />
            </HapticTouch>

            {/* AI生成ボタン */}
            <HapticTouch haptic="whoosh" style={s.aiBtn} onPress={openAI} activeOpacity={0.85}>
              <View style={s.aiBtnIcon}>
                <Text style={{ fontSize: 24 }}>🤖</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.aiBtnTitle}>AIで今日のメニューを作る</Text>
                <Text style={s.aiBtnSub}>練習のイメージを伝えるだけ</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={NEON.blue} />
            </HapticTouch>

            {/* フォルダ一覧 */}
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>練習ライブラリ</Text>
              <HapticTouch haptic="whoosh" onPress={openAddFolder} style={s.addFolderBtn} activeOpacity={0.8}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>フォルダ追加</Text>
              </HapticTouch>
            </View>

            {folders.length === 0 ? (
              <HapticTouch haptic="whoosh" onPress={openAddFolder} style={s.emptyCard} activeOpacity={0.8}>
                <Text style={{ fontSize: 32, marginBottom: 8 }}>📁</Text>
                <Text style={{ color: '#888', fontSize: 14 }}>フォルダを作って種目を登録しよう</Text>
                <Text style={{ color: '#555', fontSize: 12, marginTop: 4 }}>例：ドリルメニュー、ランメニュー</Text>
              </HapticTouch>
            ) : (
              <View style={{ gap: 10 }}>
                {folders.map(f => (
                  <FolderCard
                    key={f.id}
                    folder={f}
                    onPress={() => { setDetailFolder(f); setDetailModal(true) }}
                    onEdit={() => openEditFolder(f)}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            {history.length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={{ fontSize: 32, marginBottom: 8 }}>🤖</Text>
                <Text style={{ color: '#888', fontSize: 14 }}>まだAI生成履歴がありません</Text>
              </View>
            ) : (
              history.map(h => (
                <HapticTouch
                  haptic="tap"
                  key={h.id}
                  style={s.histCard}
                  onPress={() => { setHistItem(h); setHistModal(true) }}
                  activeOpacity={0.8}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Text style={{ fontSize: 12 }}>{h.intent.startsWith('[ピック]') ? '📋' : '🤖'}</Text>
                    <Text style={s.histDate}>{new Date(h.created_at).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' })}</Text>
                    <View style={{ backgroundColor: h.intent.startsWith('[ピック]') ? 'rgba(52,199,89,0.12)' : 'rgba(90,200,250,0.12)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ color: h.intent.startsWith('[ピック]') ? '#34C759' : '#5AC8FA', fontSize: 10, fontWeight: '700' }}>
                        {h.intent.startsWith('[ピック]') ? 'ピック生成' : 'AI生成'}
                      </Text>
                    </View>
                  </View>
                  <Text style={s.histIntent} numberOfLines={2}>「{h.intent.replace('[ピック] ', '')}」</Text>
                  <Text style={s.histPreview} numberOfLines={2}>{h.result}</Text>
                </HapticTouch>
              ))
            )}
          </ScrollView>
        )}

      </SafeAreaView>

      {/* ── フォルダ作成/編集モーダル ── */}
      <Modal visible={folderModal} transparent animationType="slide" onRequestClose={() => setFolderModal(false)}>
        <View style={m.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
            <View style={m.sheet}>
              <View style={m.sheetHeader}>
                <Text style={m.sheetTitle}>{editFolder ? 'フォルダを編集' : 'フォルダを作成'}</Text>
                <TouchableOpacity onPress={() => setFolderModal(false)}>
                  <Ionicons name="close" size={22} color="#888" />
                </TouchableOpacity>
              </View>

              <Text style={m.label}>フォルダ名</Text>
              <TextInput
                value={folderName}
                onChangeText={setFolderName}
                placeholder="例：ドリルメニュー"
                placeholderTextColor="#445577"
                style={m.input}
              />

              <Text style={m.label}>カラー</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                {FOLDER_COLORS.map(c => (
                  <TouchableOpacity key={c} onPress={() => setFolderColor(c)} activeOpacity={0.8}>
                    <View style={[m.colorDot, { backgroundColor: c }, folderColor === c && m.colorDotSelected]} />
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={m.label}>アイコン</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
                {FOLDER_ICONS.map(icon => (
                  <TouchableOpacity
                    key={icon}
                    onPress={() => setFolderIcon(icon)}
                    style={[m.iconBtn, { borderColor: folderIcon === icon ? folderColor : 'rgba(255,255,255,0.1)' }]}
                    activeOpacity={0.8}
                  >
                    <Ionicons name={icon as any} size={18} color={folderIcon === icon ? folderColor : '#666'} />
                  </TouchableOpacity>
                ))}
              </View>

              <HapticTouch
                haptic="save"
                style={[m.saveBtn, !folderName.trim() && { opacity: 0.4 }]}
                onPress={handleSaveFolder}
                disabled={!folderName.trim()}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#1c1c1e', fontWeight: '800', fontSize: 15, letterSpacing: -0.3 }}>保存</Text>
              </HapticTouch>

              {editFolder && (
                <TouchableOpacity
                  style={m.deleteBtn}
                  onPress={() => handleDeleteFolder(editFolder.id)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="trash-outline" size={15} color="#FF3B30" />
                  <Text style={{ color: '#FF3B30', fontSize: 13, fontWeight: '700' }}>フォルダを削除</Text>
                </TouchableOpacity>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── フォルダ詳細モーダル ── */}
      <Modal visible={detailModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetailModal(false)}>
        <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
          <SafeAreaView style={{ flex: 1 }}>
            {detailFolder && (
              <>
                <View style={m.sheetHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={[fc.iconWrap, { backgroundColor: detailFolder.color + '22', width: 36, height: 36 }]}>
                      <Ionicons name={detailFolder.icon as any} size={18} color={detailFolder.color} />
                    </View>
                    <Text style={[m.sheetTitle, { fontSize: 17 }]}>{detailFolder.name}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setDetailModal(false)}>
                    <Ionicons name="close" size={22} color="#888" />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
                  {/* 種目追加 */}
                  <View style={d.addRow}>
                    <TextInput
                      value={newItemText}
                      onChangeText={setNewItemText}
                      placeholder="種目を追加（例：2ステップ）"
                      placeholderTextColor="#445577"
                      style={[m.input, { flex: 1, marginBottom: 0 }]}
                      onSubmitEditing={handleAddItem}
                      returnKeyType="done"
                    />
                    <TouchableOpacity
                      onPress={handleAddItem}
                      disabled={!newItemText.trim()}
                      style={[d.addBtn, { backgroundColor: detailFolder.color }, !newItemText.trim() && { opacity: 0.4 }]}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="add" size={20} color="#fff" />
                    </TouchableOpacity>
                  </View>

                  {detailFolder.items.length === 0 ? (
                    <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                      <Text style={{ color: '#555', fontSize: 14 }}>種目を追加してください</Text>
                    </View>
                  ) : (
                    <View style={{ marginTop: 16 }}>
                      {detailFolder.items.map((item, idx) => (
                        <ItemRow
                          key={idx}
                          text={item}
                          index={idx}
                          total={detailFolder.items.length}
                          onRemove={() => handleRemoveItem(idx)}
                          onMoveUp={() => handleMoveItem(idx, 'up')}
                          onMoveDown={() => handleMoveItem(idx, 'down')}
                        />
                      ))}
                    </View>
                  )}
                </ScrollView>
              </>
            )}
          </SafeAreaView>
        </View>
      </Modal>

      {/* ── AI生成モーダル ── */}
      <Modal visible={aiModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAiModal(false)}>
        <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
          <SafeAreaView style={{ flex: 1 }}>
            <View style={m.sheetHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 22 }}>🤖</Text>
                <Text style={[m.sheetTitle, { fontSize: 17 }]}>AIメニュー生成</Text>
              </View>
              <TouchableOpacity onPress={() => setAiModal(false)}>
                <Ionicons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>

            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">

                {/* 使用するフォルダ選択 */}
                {folders.length > 0 && (
                  <>
                    <Text style={m.label}>使用するライブラリ</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                      {folders.map(f => {
                        const selected = selectedFolderIds.includes(f.id)
                        return (
                          <TouchableOpacity
                            key={f.id}
                            onPress={() => setSelectedFolderIds(prev =>
                              selected ? prev.filter(id => id !== f.id) : [...prev, f.id]
                            )}
                            style={{
                              flexDirection: 'row', alignItems: 'center', gap: 6,
                              paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
                              borderWidth: 1.5,
                              backgroundColor: selected ? f.color + '22' : 'transparent',
                              borderColor: selected ? f.color : 'rgba(255,255,255,0.1)',
                            }}
                            activeOpacity={0.8}
                          >
                            <Ionicons name={f.icon as any} size={13} color={selected ? f.color : '#666'} />
                            <Text style={{ color: selected ? f.color : '#666', fontSize: 13, fontWeight: '700' }}>{f.name}</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  </>
                )}

                {/* 今日のイメージ入力 */}
                <Text style={m.label}>今日の練習イメージを伝える</Text>
                <TextInput
                  value={aiIntent}
                  onChangeText={setAiIntent}
                  placeholder={`例：トレ期も終盤に近づき、少しずつスピード練習に移行していきたい。明日は完全休養にする。`}
                  placeholderTextColor="#445577"
                  style={[m.input, { height: 100, textAlignVertical: 'top' }]}
                  multiline
                />

                <HapticTouch
                  haptic="whoosh"
                  style={[ai.genBtn, (!aiIntent.trim() || aiLoading) && { opacity: 0.4 }]}
                  onPress={handleGenerate}
                  disabled={!aiIntent.trim() || aiLoading}
                  activeOpacity={0.85}
                >
                  {aiLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={{ fontSize: 18 }}>🤖</Text>
                  )}
                  <Text style={ai.genBtnText}>{aiLoading ? 'メニュー生成中...' : 'メニューを生成する'}</Text>
                </HapticTouch>

                {/* 結果表示 */}
                {aiResult !== '' && (
                  <View style={ai.resultCard}>
                    {aiResult.split('\n').map((line, i) => {
                      const isBold = /^[📋💬【】🔥⚡]/.test(line) || line.startsWith('---')
                      if (line === '---') return <View key={i} style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 8 }} />
                      return (
                        <Text key={i} style={[
                          ai.resultText,
                          isBold && { color: '#fff', fontWeight: '700', fontSize: 14, marginTop: 10 },
                        ]}>
                          {line}
                        </Text>
                      )
                    })}
                    <TouchableOpacity
                      style={[ai.regenBtn]}
                      onPress={handleGenerate}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="refresh" size={14} color={NEON.blue} />
                      <Text style={{ color: NEON.blue, fontSize: 13, fontWeight: '700' }}>再生成</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </ScrollView>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </View>
      </Modal>

      {/* ── 手動ピッカーモーダル ── */}
      <Modal visible={pickModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPickModal(false)}>
        <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
          <SafeAreaView style={{ flex: 1 }}>
            <View style={m.sheetHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 22 }}>📋</Text>
                <Text style={[m.sheetTitle, { fontSize: 17 }]}>
                  {pickStep === 'select' ? '種目をピックする' : 'AIでメニューを生成'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setPickModal(false)}>
                <Ionicons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>

            {pickStep === 'select' ? (
              <>
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
                  {folders.length === 0 ? (
                    <View style={s.emptyCard}>
                      <Text style={{ fontSize: 32, marginBottom: 8 }}>📁</Text>
                      <Text style={{ color: '#888', fontSize: 14 }}>先にライブラリにフォルダを作成してください</Text>
                    </View>
                  ) : (
                    folders.map(folder => {
                      const isExpanded = expandedFolders.includes(folder.id)
                      const pickedCount = pickedItems.filter(p => p.folderId === folder.id).length
                      return (
                        <View key={folder.id} style={pk.folderWrap}>
                          <TouchableOpacity
                            style={[pk.folderHeader, { borderColor: pickedCount > 0 ? folder.color + '66' : 'rgba(255,255,255,0.08)' }]}
                            onPress={() => toggleExpandFolder(folder.id)}
                            activeOpacity={0.8}
                          >
                            <View style={[fc.iconWrap, { backgroundColor: folder.color + '22', width: 36, height: 36 }]}>
                              <Ionicons name={folder.icon as any} size={16} color={folder.color} />
                            </View>
                            <Text style={pk.folderName}>{folder.name}</Text>
                            {pickedCount > 0 && (
                              <View style={[pk.badge, { backgroundColor: folder.color }]}>
                                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{pickedCount}</Text>
                              </View>
                            )}
                            <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#555" />
                          </TouchableOpacity>

                          {isExpanded && (
                            <View style={pk.itemList}>
                              {folder.items.length === 0 ? (
                                <Text style={{ color: '#555', fontSize: 13, padding: 12 }}>種目がありません</Text>
                              ) : (
                                folder.items.map((item, idx) => {
                                  const picked = pickedItems.some(p => p.folderId === folder.id && p.text === item)
                                  return (
                                    <TouchableOpacity
                                      key={idx}
                                      style={[pk.itemRow, picked && { backgroundColor: folder.color + '18' }]}
                                      onPress={() => togglePickItem(folder, item)}
                                      activeOpacity={0.7}
                                    >
                                      <View style={[pk.checkbox, picked && { backgroundColor: folder.color, borderColor: folder.color }]}>
                                        {picked && <Ionicons name="checkmark" size={12} color="#fff" />}
                                      </View>
                                      <Text style={[pk.itemText, picked && { color: '#fff' }]}>{item}</Text>
                                    </TouchableOpacity>
                                  )
                                })
                              )}
                            </View>
                          )}
                        </View>
                      )
                    })
                  )}
                </ScrollView>

                {/* 下部バー */}
                <View style={pk.bottomBar}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#888', fontSize: 12 }}>選択中</Text>
                    <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>{pickedItems.length}種目</Text>
                  </View>
                  <HapticTouch
                    haptic="whoosh"
                    style={[pk.nextBtn, pickedItems.length === 0 && { opacity: 0.4 }]}
                    onPress={() => { setPickResult(''); setPickStep('generate') }}
                    disabled={pickedItems.length === 0}
                    activeOpacity={0.85}
                  >
                    <Text style={{ color: '#1c1c1e', fontWeight: '800', fontSize: 15, letterSpacing: -0.3 }}>次へ</Text>
                    <Ionicons name="chevron-forward" size={16} color="#1c1c1e" />
                  </HapticTouch>
                </View>
              </>
            ) : (
              <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">

                  {/* ピック種目サマリ */}
                  <Text style={m.label}>ピックした種目 ({pickedItems.length})</Text>
                  <View style={pk.confirmList}>
                    {pickedItems.map((p, idx) => (
                      <View key={idx} style={pk.confirmRow}>
                        <View style={[pk.folderTag, { backgroundColor: p.folderColor + '22', borderColor: p.folderColor + '55' }]}>
                          <Text style={{ color: p.folderColor, fontSize: 11, fontWeight: '700' }}>{p.folderName}</Text>
                        </View>
                        <Text style={pk.confirmText}>{p.text}</Text>
                        <TouchableOpacity onPress={() => setPickedItems(prev => prev.filter((_, i) => i !== idx))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="close-circle" size={18} color="#444" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>

                  {/* 意図入力 */}
                  <Text style={[m.label, { marginTop: 16 }]}>今日の練習イメージ（任意）</Text>
                  <TextInput
                    value={pickIntent}
                    onChangeText={setPickIntent}
                    placeholder="例：スピード移行期。強度高めで。"
                    placeholderTextColor="#445577"
                    style={[m.input, { height: 80, textAlignVertical: 'top' }]}
                    multiline
                  />

                  {/* 生成ボタン */}
                  <HapticTouch
                    haptic="whoosh"
                    style={[ai.genBtn, (pickedItems.length === 0 || pickLoading) && { opacity: 0.4 }]}
                    onPress={handleGenerateFromPicked}
                    disabled={pickedItems.length === 0 || pickLoading}
                    activeOpacity={0.85}
                  >
                    {pickLoading
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={{ fontSize: 18 }}>🤖</Text>
                    }
                    <Text style={ai.genBtnText}>{pickLoading ? 'メニュー生成中...' : 'このピック内容でAI生成'}</Text>
                  </HapticTouch>

                  {/* 結果 */}
                  {pickResult !== '' && (
                    <View style={ai.resultCard}>
                      {pickResult.split('\n').map((line, i) => {
                        const isBold = /^[📋💬【】🔥⚡]/.test(line) || line.startsWith('---')
                        if (line === '---') return <View key={i} style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 8 }} />
                        return (
                          <Text key={i} style={[ai.resultText, isBold && { color: '#fff', fontWeight: '700', fontSize: 14, marginTop: 10 }]}>
                            {line}
                          </Text>
                        )
                      })}
                      <TouchableOpacity style={ai.regenBtn} onPress={handleGenerateFromPicked} activeOpacity={0.8}>
                        <Ionicons name="refresh" size={14} color={NEON.blue} />
                        <Text style={{ color: NEON.blue, fontSize: 13, fontWeight: '700' }}>再生成</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </ScrollView>

                <View style={pk.bottomBar}>
                  <TouchableOpacity onPress={() => setPickStep('select')} style={pk.backBtn} activeOpacity={0.8}>
                    <Ionicons name="chevron-back" size={16} color="#888" />
                    <Text style={{ color: '#888', fontWeight: '700' }}>種目を選び直す</Text>
                  </TouchableOpacity>
                </View>
              </KeyboardAvoidingView>
            )}
          </SafeAreaView>
        </View>
      </Modal>

      {/* ── 履歴詳細モーダル ── */}
      <Modal visible={histModal} transparent animationType="slide" onRequestClose={() => setHistModal(false)}>
        <View style={m.overlay}>
          <View style={[m.sheet, { maxHeight: '85%' }]}>
            <View style={m.sheetHeader}>
              <Text style={m.sheetTitle}>生成メニュー</Text>
              <TouchableOpacity onPress={() => setHistModal(false)}>
                <Ionicons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>
            {histItem && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <Text style={{ color: '#888', fontSize: 11 }}>{new Date(histItem.created_at).toLocaleString('ja-JP')}</Text>
                  <Text style={{ color: '#ccc', fontSize: 13, marginTop: 4 }}>「{histItem.intent}」</Text>
                </View>
                {histItem.result.split('\n').map((line, i) => {
                  const isBold = /^[📋💬【】🔥⚡]/.test(line)
                  if (line === '---') return <View key={i} style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 8 }} />
                  return (
                    <Text key={i} style={[ai.resultText, isBold && { color: '#fff', fontWeight: '700', fontSize: 14, marginTop: 10 }]}>
                      {line}
                    </Text>
                  )
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  )
}

// ── スタイル ──────────────────────────────────────────────
const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: 'transparent' },
  tabBar:     { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6, gap: 8 },
  tabBtn:     { flex: 1, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', backgroundColor: '#f0f2f5', alignItems: 'center' },
  tabBtnActive:{ backgroundColor: BRAND, borderColor: BRAND },
  tabText:    { color: TEXT.secondary, fontSize: 13, fontWeight: '700' },
  tabTextActive:{ color: '#fff' },
  content:    { padding: 16, gap: 12, paddingBottom: 60 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle:  { color: TEXT.primary, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  addFolderBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BRAND, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  emptyCard:  { backgroundColor: '#f0f2f5', borderRadius: 16, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', borderStyle: 'dashed' },
  manualBtn:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(52,199,89,0.08)', borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(52,199,89,0.3)', padding: 16 },
  manualBtnIcon:  { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(52,199,89,0.12)', alignItems: 'center', justifyContent: 'center' },
  manualBtnTitle: { color: TEXT.primary, fontSize: 15, fontWeight: '800' },
  manualBtnSub:   { color: '#34C759', fontSize: 12, marginTop: 2 },
  aiBtn:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(90,200,250,0.08)', borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(90,200,250,0.3)', padding: 16 },
  aiBtnIcon:  { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(90,200,250,0.12)', alignItems: 'center', justifyContent: 'center' },
  aiBtnTitle: { color: TEXT.primary, fontSize: 15, fontWeight: '800' },
  aiBtnSub:   { color: '#5AC8FA', fontSize: 12, marginTop: 2 },
  histCard:   { backgroundColor: '#ffffff', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 14, gap: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  histDate:   { color: TEXT.hint, fontSize: 11 },
  histIntent: { color: TEXT.secondary, fontSize: 13, fontStyle: 'italic' },
  histPreview:{ color: TEXT.hint, fontSize: 12 },
})

const m = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: '#161616', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  sheetTitle:  { color: '#fff', fontSize: 16, fontWeight: '800' },
  label:       { color: '#888', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  input:       { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 14, borderWidth: 1, borderColor: 'rgba(74,159,255,0.25)', marginBottom: 14 },
  colorDot:    { width: 28, height: 28, borderRadius: 14 },
  colorDotSelected: { borderWidth: 2.5, borderColor: '#fff', transform: [{ scale: 1.15 }] },
  iconBtn:     { width: 40, height: 40, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  saveBtn:     { backgroundColor: '#ffffff', borderRadius: 50, paddingVertical: 15, alignItems: 'center', marginBottom: 10 },
  deleteBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
})

const d = StyleSheet.create({
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
})

const pk = StyleSheet.create({
  folderWrap:   { marginBottom: 10 },
  folderHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, borderWidth: 1, padding: 12 },
  folderName:   { flex: 1, color: '#fff', fontSize: 14, fontWeight: '700' },
  badge:        { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  itemList:     { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, marginTop: 4, overflow: 'hidden' },
  itemRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.05)' },
  checkbox:     { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#333', alignItems: 'center', justifyContent: 'center' },
  itemText:     { flex: 1, color: '#aaa', fontSize: 14 },
  bottomBar:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)', backgroundColor: '#0a0a0a' },
  nextBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#ffffff', borderRadius: 50, paddingHorizontal: 24, paddingVertical: 13 },
  backBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  confirmList:  { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 8 },
  confirmRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.06)' },
  folderTag:    { borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  confirmText:  { flex: 1, color: '#ddd', fontSize: 14 },
})

const ai = StyleSheet.create({
  genBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: BRAND, borderRadius: 14, paddingVertical: 16, marginBottom: 20 },
  genBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  resultCard: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 16, gap: 2 },
  resultText: { color: '#bbb', fontSize: 13, lineHeight: 22 },
  regenBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(90,200,250,0.3)', borderRadius: 10, paddingVertical: 10, marginTop: 16 },
})

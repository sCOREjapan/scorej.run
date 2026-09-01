import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Modal, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import HapticTouch from '../components/HapticTouch'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { BG_GRADIENT, TEXT, BRAND, NEON, DIVIDER } from '../lib/theme'
import { Ionicons } from '@expo/vector-icons'
import Toast from 'react-native-toast-message'
import { checkAdGate, recordUsage } from '../lib/adGate'
import { TICKET_COST } from '../lib/ticketWallet'
import { getAiAuthHeader } from '../lib/supabase'
import AdGateModal from '../components/AdGateModal'
import TicketGateModal from '../components/TicketGateModal'
import { useAuth } from '../context/AuthContext'
import { useRouter, useNavigation } from 'expo-router'
import { createStorageQueue } from '../lib/storageQueue'
import AIMenuResultCard from '../components/AIMenuResultCard'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../context/LanguageContext'
import { narrativeLanguageInstruction } from '../lib/aiLanguage'

// ── キー ─────────────────────────────────────────────────
const LIBRARY_KEY  = 'trackmate_exercise_library'
const HISTORY_KEY  = 'trackmate_ai_menus'
// ピック生成/フリー入力生成(どちらも最大45秒かかるAI呼び出し)が同時に走ると
// 互いの history state を基点に書き戻して片方の結果が消えるため直列化する
const historyStore = createStorageQueue<AIGeneratedMenu[]>(HISTORY_KEY, [])
// フォルダ作成/種目追加を連続で行うと、React state のコミット前に次の書き込みが
// 古い folders を基点に上書きして片方が消えるため同様に直列化する
const libraryStore = createStorageQueue<LibraryFolder[]>(LIBRARY_KEY, [])

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
  'flash',     // スプリント
  'sync',      // インターバル
  'walk',      // テンポ走
  'leaf',      // ジョグ
  'map',       // ロング走
  'construct', // ドリル
  'barbell',   // ウェイト
  'trophy',    // 試合
  'moon',      // 休養
  'fitness',   // その他
  'heart',     // その他
  'stopwatch', // その他
]

// ── uid ──────────────────────────────────────────────────
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2,7)}` }

// ── FolderCard ───────────────────────────────────────────
function FolderCard({
  folder,
  onPress,
  onEdit,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  folder: LibraryFolder
  onPress: () => void
  onEdit: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  isFirst: boolean
  isLast: boolean
}) {
  const { t } = useTranslation()
  return (
    <HapticTouch haptic="tap" onPress={onPress} activeOpacity={0.8} style={fc.card}>
      {/* 並び替えボタン（フォルダ一覧内の表示順） */}
      <View style={fc.sortBtns}>
        <TouchableOpacity
          onPress={onMoveUp}
          disabled={isFirst}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={[fc.sortBtn, isFirst && { opacity: 0.2 }]}
          accessibilityLabel={t('workoutMenu.a11y.moveUp')}
        >
          <Ionicons name="chevron-up" size={14} color={TEXT.secondary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onMoveDown}
          disabled={isLast}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={[fc.sortBtn, isLast && { opacity: 0.2 }]}
          accessibilityLabel={t('workoutMenu.a11y.moveDown')}
        >
          <Ionicons name="chevron-down" size={14} color={TEXT.secondary} />
        </TouchableOpacity>
      </View>
      <View style={[fc.iconWrap, { backgroundColor: folder.color + '22' }]}>
        <Ionicons name={folder.icon as any} size={22} color={folder.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={fc.name}>{folder.name}</Text>
        <Text style={fc.count}>{t('workoutMenu.folderCard.itemCount', { n: folder.items.length })}</Text>
      </View>
      <TouchableOpacity onPress={onEdit} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('workoutMenu.a11y.edit')}>
        <Ionicons name="ellipsis-horizontal" size={18} color={TEXT.secondary} />
      </TouchableOpacity>
    </HapticTouch>
  )
}
const fc = StyleSheet.create({
  card:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#ffffff', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  sortBtns: { flexDirection: 'column', alignItems: 'center', gap: 4 },
  sortBtn:  { padding: 2 },
  iconWrap: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  name:     { color: TEXT.primary, fontSize: 15, fontWeight: '700' },
  count:    { color: TEXT.secondary, fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
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
  const { t } = useTranslation()
  return (
    <View style={ir.row}>
      {/* 並び替えボタン */}
      <View style={ir.sortBtns}>
        <TouchableOpacity
          onPress={onMoveUp}
          disabled={index === 0}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={[ir.sortBtn, index === 0 && { opacity: 0.2 }]}
          accessibilityLabel={t('workoutMenu.a11y.moveUp')}
        >
          <Ionicons name="chevron-up" size={14} color={TEXT.secondary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onMoveDown}
          disabled={index === total - 1}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={[ir.sortBtn, index === total - 1 && { opacity: 0.2 }]}
          accessibilityLabel={t('workoutMenu.a11y.moveDown')}
        >
          <Ionicons name="chevron-down" size={14} color={TEXT.secondary} />
        </TouchableOpacity>
      </View>
      <View style={ir.dot} />
      <Text style={ir.text}>{text}</Text>
      <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={t('workoutMenu.a11y.delete')}>
        <Ionicons name="close-circle" size={18} color="#444" />
      </TouchableOpacity>
    </View>
  )
}
const ir = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: DIVIDER },
  sortBtns: { flexDirection: 'column', alignItems: 'center', gap: 4 },
  sortBtn:  { padding: 2 },
  dot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: BRAND },
  text:     { flex: 1, color: TEXT.primary, fontSize: 14 },
})

// ── メイン ───────────────────────────────────────────────
export default function WorkoutMenuScreen() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const navigation = useNavigation()
  useEffect(() => { navigation.setOptions({ title: t('workoutMenu.headerTitle') }) }, [navigation, t, language])
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

  // AdGate
  const { isGuest } = useAuth()
  const router = useRouter()
  // AdGate async チェック中の二重タップ防止
  const pickCallRef   = React.useRef(false)
  const intentCallRef = React.useRef(false)
  const [adGateVisible,     setAdGateVisible]     = useState(false)
  const [adGateRemaining,   setAdGateRemaining]   = useState(0)
  const [adGateHardLimited, setAdGateHardLimited] = useState(false)
  const [adGateLimitType,   setAdGateLimitType]   = useState<'none'|'daily'|'monthly'|'total'|'window'>('none')
  const [adGatePendingFn,   setAdGatePendingFn]   = useState<'pick' | 'intent' | null>(null)
  const [ticketGateVisible, setTicketGateVisible] = useState(false)
  const [ticketGateCost,    setTicketGateCost]    = useState(0)
  const [ticketGateBalance, setTicketGateBalance] = useState(0)

  const load = useCallback(async () => {
    const [lib, hist] = await Promise.all([
      libraryStore.get().catch(() => []),
      historyStore.get().catch(() => []),
    ])
    setFolders(lib)
    setHistory(hist)
  }, [])

  useEffect(() => { load() }, [load])

  // 常に AsyncStorage から読み直した最新値を基点に更新する（React state は
  // 連続操作時にコミットが間に合わず、古い folders を書き戻して他の変更を
  // 消してしまうため使わない）
  async function saveFolders(updater: (current: LibraryFolder[]) => LibraryFolder[]) {
    const next = await libraryStore.update(updater)
    setFolders(next)
    return next
  }

  // フォルダの表示順を1つ上/下に入れ替える
  function moveFolder(index: number, direction: -1 | 1) {
    saveFolders(current => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
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
      const editId = editFolder.id
      const next = await saveFolders(current => current.map(f => f.id === editId
        ? { ...f, name: folderName.trim(), color: folderColor, icon: folderIcon }
        : f))
      if (detailFolder?.id === editId) {
        setDetailFolder(next.find(f => f.id === editId) ?? null)
      }
    } else {
      const newF: LibraryFolder = {
        id: uid(), name: folderName.trim(), color: folderColor,
        icon: folderIcon, items: [], created_at: new Date().toISOString(),
      }
      await saveFolders(current => [...current, newF])
    }
    setFolderModal(false)
  }

  async function handleDeleteFolder(id: string) {
    await saveFolders(current => current.filter(f => f.id !== id))
    setFolderModal(false)
  }

  // ── 種目追加 ──────────────────────────────────────────
  async function handleAddItem() {
    if (!newItemText.trim() || !detailFolder) return
    const folderId = detailFolder.id
    const text = newItemText.trim()
    setNewItemText('')
    const next = await saveFolders(current => current.map(f =>
      f.id === folderId ? { ...f, items: [...f.items, text] } : f))
    const updated = next.find(f => f.id === folderId)
    if (updated) setDetailFolder(updated)
  }

  async function handleRemoveItem(idx: number) {
    if (!detailFolder) return
    const folderId = detailFolder.id
    const next = await saveFolders(current => current.map(f =>
      f.id === folderId ? { ...f, items: f.items.filter((_, i) => i !== idx) } : f))
    const updated = next.find(f => f.id === folderId)
    if (updated) setDetailFolder(updated)
  }

  async function handleMoveItem(idx: number, dir: 'up' | 'down') {
    if (!detailFolder) return
    const folderId = detailFolder.id
    const next = await saveFolders(current => current.map(f => {
      if (f.id !== folderId) return f
      const items = [...f.items]
      const target = dir === 'up' ? idx - 1 : idx + 1
      if (target < 0 || target >= items.length) return f
      ;[items[idx], items[target]] = [items[target], items[idx]]
      return { ...f, items }
    }))
    const updated = next.find(f => f.id === folderId)
    if (updated) setDetailFolder(updated)
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

  // ── 広告視聴後に呼ばれるコア生成（ゲートチェック・使用記録なし）──
  async function generateFromPickedCore(needsTicket = false, ticketCost = 0) {
    setPickLoading(true)
    setPickResult('')
    try {
      const _apiBase1 = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
      const _endpoint1 = `${_apiBase1}/api/analyze`

      const libraryText = pickedItems.map(p => `・${p.text}（${p.folderName}）`).join('\n')

      // メニューのセクション見出しはプロンプト内に固定文言として埋め込まれ、AIはそのまま
      // 出力に含める。narrativeLanguageInstructionは「自由記述の文章」だけを英語化する指示
      // なので、この見出し自体は英語設定でも日本語のまま返ってきてしまっていた
      // （2026-08-30発見・修正）。見出しも言語に応じて出し分ける
      const H1 = language === 'en'
        ? { menu: "📋 **Today's Menu**", warmup: '**🔥 Warm-up (~__ min)**', main: '**⚡ Main Set (~__ min)**', cooldown: '**🌊 Cool-down (~__ min)**', coach: '**💬 From your coach**' }
        : { menu: '📋 **今日のメニュー**', warmup: '**🔥 ウォームアップ（〇分）**', main: '**⚡ メイン練習（〇分）**', cooldown: '**🌊 クールダウン（〇分）**', coach: '**💬 コーチから**' }

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

${H1.menu}
（目的・テーマを1行で）
（推定所要時間：〇〇分）

${H1.warmup}
1. （種目）×（時間/距離/回数）
2. ...
※ 各種目の目的を一言添える

${H1.main}
（ピックアップ種目を必ず中心に構成）
1. （種目）（セット数）×（本数/距離）— レスト（時間）
   → 目標ペース/強度：（具体的に）
2. ...

${H1.cooldown}
1. （種目）×（時間）
2. ...

${H1.coach}
（このメニューの意図・今日のポイント・選手への熱いメッセージを3〜5文で。「なぜこの構成か」を含める）` + narrativeLanguageInstruction(language)

      {
        const res = await fetchWithTimeout(_endpoint1, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(await getAiAuthHeader()) },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1500,
            feature: 'workout',
            system: systemPrompt1,
            messages: [{ role: 'user', content: prompt }],
          }),
        }, 45000)
        if (res.ok) {
          const data = await res.json()
          const text = data.content?.[0]?.text
          if (text && text.trim().length > 0) {
            setPickResult(text)
            // 履歴保存に失敗しても、生成済みの結果表示は消さない
            try {
              const entry: AIGeneratedMenu = {
                id: uid(),
                intent: `[ピック] ${pickedItems.map(p => p.text).join('・')}` + (pickIntent.trim() ? ` / ${pickIntent.trim()}` : ''),
                result: text,
                created_at: new Date().toISOString(),
              }
              const next = await historyStore.update(current => [entry, ...current].slice(0, 30))
              setHistory(next)
            } catch { /* 結果は表示済みなので握りつぶす */ }
            // 生成に成功した場合のみ利用回数・チケットを消費する（失敗時に課金しないため）
            await recordUsage('workout')
            if (needsTicket) Toast.show({ type: 'info', text1: t('workoutMenu.toast.ticketUsed', { n: ticketCost }), visibilityTime: 1800 })
          } else {
            setPickResult(t('workoutMenu.toast.emptyResult'))
          }
        } else {
          setPickResult(t('workoutMenu.toast.apiError'))
        }
      }
    } catch {
      setPickResult(t('workoutMenu.toast.genericFail'))
    } finally {
      setPickLoading(false)
    }
  }

  async function handleGenerateFromPicked() {
    if (pickCallRef.current) return  // 二重タップ防止
    if (pickedItems.length === 0) return
    // ゲストはログイン必須
    if (isGuest) { setAdGateRemaining(0); setAdGateHardLimited(false); setAdGateLimitType('none'); setAdGatePendingFn('pick'); setAdGateVisible(true); return }
    pickCallRef.current = true
    try {
      const gate = await checkAdGate('workout')
      if (!gate.allowed) {
        if (gate.needsTicket) { setTicketGateCost(gate.ticketCost); setTicketGateBalance(gate.ticketBalance); setTicketGateVisible(true) }
        else {
          setAdGateRemaining(gate.remaining)
          setAdGateHardLimited(gate.hardLimited)
          setAdGateLimitType(gate.limitType)
          setAdGatePendingFn('pick')
          setAdGateVisible(true)
        }
        return
      }
      generateFromPickedCore(gate.needsTicket, gate.ticketCost)
    } finally {
      pickCallRef.current = false
    }
  }

  // ── AI生成 ────────────────────────────────────────────
  function openAI() {
    setAiIntent('')
    setAiResult('')
    setSelectedFolderIds(folders.map(f => f.id))
    setAiModal(true)
  }

  async function generateCore(needsTicket = false, ticketCost = 0) {
    setAiLoading(true)
    setAiResult('')
    try {
      const _apiBase2 = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')
      const _endpoint2 = `${_apiBase2}/api/analyze`
      const useFolders = folders.filter(f => selectedFolderIds.includes(f.id) && f.items.length > 0)

      const libraryText = useFolders.map(f =>
        `【${f.name}】\n${f.items.map(item => `・${item}`).join('\n')}`
      ).join('\n\n')

      // H1と同じ理由(セクション見出しは自由記述扱いされず日本語のまま返ってきていたバグ)で
      // ここでも見出しを言語に応じて出し分ける
      const H2 = language === 'en'
        ? { menu: "📋 **Today's Menu**", warmup: '**🔥 Warm-up (~__ min)**', main: '**⚡ Main Set (~__ min)**', cooldown: '**🌊 Cool-down (~__ min)**', coach: '**💬 From your coach**' }
        : { menu: '📋 **今日のメニュー**', warmup: '**🔥 ウォームアップ（〇分）**', main: '**⚡ メイン練習（〇分）**', cooldown: '**🌊 クールダウン（〇分）**', coach: '**💬 コーチから**' }

      const systemPrompt2 = `あなたは日本トップレベルの陸上競技コーチです。国体・インターハイ・実業団選手の指導経験があり、科学的トレーニング理論（ピリオダイゼーション・超回復・ATP-PC系/乳酸系/有酸素系のエネルギー供給）を実践に落とし込んだメニュー設計が得意です。

メニュー設計の原則：
- ウォームアップは「体温上昇→関節可動域→神経系活性化」の順で段階的に
- メインは目的（スピード/持久/筋力/技術）を明確にしてセット数・本数・休憩を具体的に
- クールダウンはメインの強度に応じた適切な長さで、翌日に向けたリカバリーを意識
- セット間の休憩時間は必ず記載
- 総練習時間の目安を書く
- 選手の意図・要望に応えながら、科学的に正しい負荷設計をする
- ライブラリにある種目を最大限活用し、不足する場合は理由とともに補完種目を提案する`

      const prompt = `選手からのリクエスト：「${aiIntent.trim() || '特に指定なし（コーチの判断で最適なメニューを）'}」

【選手の練習ライブラリ】
${libraryText || '（まだライブラリに種目が登録されていません）'}

━━━━━━━━━━━━━━━━━━━━━

このリクエストと選手のライブラリを踏まえて、今日の完全な練習メニューを作ってください。

${H2.menu}
（テーマ・目的を1行で）
（推定所要時間：〇〇分）

${H2.warmup}
1. （種目）×（時間/距離/回数） — （目的）
2. ...

${H2.main}
1. （種目）（セット数）×（本数/距離）— レスト（時間）
   → 強度/目標：（具体的に）
2. ...

${H2.cooldown}
1. （種目）×（時間）
2. ...

${H2.coach}
（選手のリクエストを受けてどんな意図でこのメニューを設計したか。今日のポイントと注意点。最後に選手への一言。計4〜6文で熱く語る）` + narrativeLanguageInstruction(language)

      {
        const res = await fetchWithTimeout(_endpoint2, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(await getAiAuthHeader()) },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1500,
            feature: 'workout',
            system: systemPrompt2,
            messages: [{ role: 'user', content: prompt }],
          }),
        }, 45000)
        if (res.ok) {
          const data = await res.json()
          const text = data.content?.[0]?.text
          if (text && text.trim().length > 0) {
            setAiResult(text)
            // 履歴保存に失敗しても、生成済みの結果表示は消さない
            try {
              const entry: AIGeneratedMenu = {
                id: uid(), intent: aiIntent.trim(), result: text,
                created_at: new Date().toISOString(),
              }
              const next = await historyStore.update(current => [entry, ...current].slice(0, 30))
              setHistory(next)
            } catch { /* 結果は表示済みなので握りつぶす */ }
            // 生成に成功した場合のみ利用回数・チケットを消費する（失敗時に課金しないため）
            await recordUsage('workout')
            if (needsTicket) Toast.show({ type: 'info', text1: t('workoutMenu.toast.ticketUsed', { n: ticketCost }), visibilityTime: 1800 })
          } else {
            setAiResult(t('workoutMenu.toast.emptyResult'))
          }
        } else {
          setAiResult(t('workoutMenu.toast.apiError'))
        }
      }
    } catch {
      setAiResult(t('workoutMenu.toast.genericFail'))
    } finally {
      setAiLoading(false)
    }
  }

  async function handleGenerate() {
    if (intentCallRef.current) return  // 二重タップ防止
    if (!aiIntent.trim()) return
    // ゲストはログイン必須
    if (isGuest) { setAdGateRemaining(0); setAdGateHardLimited(false); setAdGateLimitType('none'); setAdGatePendingFn('intent'); setAdGateVisible(true); return }
    intentCallRef.current = true
    try {
      const gate = await checkAdGate('workout')
      if (!gate.allowed) {
        if (gate.needsTicket) { setTicketGateCost(gate.ticketCost); setTicketGateBalance(gate.ticketBalance); setTicketGateVisible(true) }
        else {
          setAdGateRemaining(gate.remaining)
          setAdGateHardLimited(gate.hardLimited)
          setAdGateLimitType(gate.limitType)
          setAdGatePendingFn('intent')
          setAdGateVisible(true)
        }
        return
      }
      generateCore(gate.needsTicket, gate.ticketCost)
    } finally {
      intentCallRef.current = false
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient colors={BG_GRADIENT} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={s.safe}>

        {/* ── タブ ── */}
        <View style={s.tabBar}>
          {([
            ['library', t('workoutMenu.tabs.library'), 'folder-outline'],
            ['history', t('workoutMenu.tabs.history'), 'sparkles-outline'],
          ] as const).map(([key, label, icon]) => (
            <HapticTouch
              haptic="tabSwitch"
              key={key}
              onPress={() => setTab(key)}
              style={[s.tabBtn, tab === key && s.tabBtnActive]}
              activeOpacity={0.8}
            >
              <Ionicons name={icon} size={14} color={tab === key ? '#fff' : TEXT.secondary} />
              <Text style={[s.tabText, tab === key && s.tabTextActive]}>{label}</Text>
            </HapticTouch>
          ))}
        </View>

        {tab === 'library' ? (
          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

            {/* メニュー作成セクション */}
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>{t('workoutMenu.library.createTitle')}</Text>
            </View>
            <Text style={s.sectionLead}>{t('workoutMenu.library.createLead')}</Text>

            {/* AIおまかせ生成（デフォルト・低ハードル） */}
            <HapticTouch haptic="whoosh" style={s.aiBtn} onPress={openAI} activeOpacity={0.85}>
              <View style={s.aiBtnIcon}>
                <Ionicons name="sparkles" size={22} color={BRAND} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.aiBtnTitle}>{t('workoutMenu.library.aiTitle')}</Text>
                <Text style={s.aiBtnSub}>{t('workoutMenu.library.aiSub')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={BRAND} />
            </HapticTouch>

            {/* 種目指定生成 */}
            <HapticTouch haptic="whoosh" style={s.manualBtn} onPress={openPicker} activeOpacity={0.85}>
              <View style={s.manualBtnIcon}>
                <Ionicons name="list-outline" size={22} color={TEXT.secondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.manualBtnTitle}>{t('workoutMenu.library.manualTitle')}</Text>
                <Text style={s.manualBtnSub}>{t('workoutMenu.library.manualSub')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={TEXT.hint} />
            </HapticTouch>

            {/* フォルダ一覧 */}
            <View style={[s.sectionHeader, { marginTop: 8 }]}>
              <Text style={s.sectionTitle}>{t('workoutMenu.library.libraryTitle')}</Text>
              <HapticTouch haptic="whoosh" onPress={openAddFolder} style={s.addFolderBtn} activeOpacity={0.8}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{t('workoutMenu.library.addFolder')}</Text>
              </HapticTouch>
            </View>
            <Text style={s.sectionLead}>{t('workoutMenu.library.libraryLead')}</Text>

            {folders.length === 0 ? (
              <HapticTouch haptic="whoosh" onPress={openAddFolder} style={s.emptyCard} activeOpacity={0.8}>
                <Ionicons name="folder-outline" size={32} color={TEXT.hint} style={{ marginBottom: 8 }} />
                <Text style={{ color: '#888', fontSize: 14 }}>{t('workoutMenu.library.emptyTitle')}</Text>
                <Text style={{ color: '#555', fontSize: 12, marginTop: 4 }}>{t('workoutMenu.library.emptyHint')}</Text>
              </HapticTouch>
            ) : (
              <View style={{ gap: 10 }}>
                {folders.map((f, i) => (
                  <FolderCard
                    key={f.id}
                    folder={f}
                    onPress={() => { setDetailFolder(f); setDetailModal(true) }}
                    onEdit={() => openEditFolder(f)}
                    onMoveUp={() => moveFolder(i, -1)}
                    onMoveDown={() => moveFolder(i, 1)}
                    isFirst={i === 0}
                    isLast={i === folders.length - 1}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            {history.length === 0 ? (
              <View style={s.emptyCard}>
                <Ionicons name="sparkles-outline" size={32} color={TEXT.hint} style={{ marginBottom: 8 }} />
                <Text style={{ color: '#888', fontSize: 14 }}>{t('workoutMenu.history.emptyTitle')}</Text>
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
                    <Ionicons name={h.intent.startsWith('[ピック]') ? 'list-outline' : 'sparkles-outline'} size={12} color={TEXT.secondary} />
                    <Text style={s.histDate}>{new Date(h.created_at).toLocaleDateString(language === 'ja' ? 'ja-JP' : 'en-US', { month: 'short', day: 'numeric', weekday: 'short' })}</Text>
                    <View style={{ backgroundColor: '#f0f2f5', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ color: TEXT.secondary, fontSize: 10, fontWeight: '700' }}>
                        {h.intent.startsWith('[ピック]') ? t('workoutMenu.history.pickBadge') : t('workoutMenu.history.aiBadge')}
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
                <Text style={m.sheetTitle}>{editFolder ? t('workoutMenu.folderModal.editTitle') : t('workoutMenu.folderModal.addTitle')}</Text>
                <TouchableOpacity onPress={() => setFolderModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('workoutMenu.a11y.close')}>
                  <Ionicons name="close" size={22} color="#888" />
                </TouchableOpacity>
              </View>

              <Text style={m.label}>{t('workoutMenu.folderModal.nameLabel')}</Text>
              <TextInput
                value={folderName}
                onChangeText={setFolderName}
                placeholder={t('workoutMenu.folderModal.namePlaceholder')}
                placeholderTextColor={TEXT.hint}
                style={m.input}
              />

              <Text style={m.label}>{t('workoutMenu.folderModal.colorLabel')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                {FOLDER_COLORS.map(c => (
                  <TouchableOpacity key={c} onPress={() => setFolderColor(c)} activeOpacity={0.8} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <View style={[m.colorDot, { backgroundColor: c }, folderColor === c && m.colorDotSelected]} />
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={m.label}>{t('workoutMenu.folderModal.iconLabel')}</Text>
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
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: -0.3 }}>{t('common.save')}</Text>
              </HapticTouch>

              {editFolder && (
                <TouchableOpacity
                  style={m.deleteBtn}
                  onPress={() => handleDeleteFolder(editFolder.id)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="trash-outline" size={15} color="#FF3B30" />
                  <Text style={{ color: '#FF3B30', fontSize: 13, fontWeight: '700' }}>{t('workoutMenu.folderModal.delete')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── フォルダ詳細モーダル ── */}
      <Modal visible={detailModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetailModal(false)}>
        <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
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
                  <TouchableOpacity onPress={() => setDetailModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('workoutMenu.a11y.close')}>
                    <Ionicons name="close" size={22} color="#888" />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
                  {/* 種目追加 */}
                  <View style={d.addRow}>
                    <TextInput
                      value={newItemText}
                      onChangeText={setNewItemText}
                      placeholder={t('workoutMenu.detailModal.itemPlaceholder')}
                      placeholderTextColor={TEXT.hint}
                      style={[m.input, { flex: 1, marginBottom: 0 }]}
                      onSubmitEditing={handleAddItem}
                      returnKeyType="done"
                    />
                    <TouchableOpacity
                      onPress={handleAddItem}
                      disabled={!newItemText.trim()}
                      style={[d.addBtn, { backgroundColor: detailFolder.color }, !newItemText.trim() && { opacity: 0.4 }]}
                      activeOpacity={0.8}
                      accessibilityLabel={t('workoutMenu.a11y.addItem')}
                    >
                      <Ionicons name="add" size={20} color="#fff" />
                    </TouchableOpacity>
                  </View>

                  {detailFolder.items.length === 0 ? (
                    <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                      <Text style={{ color: TEXT.secondary, fontSize: 14 }}>{t('workoutMenu.detailModal.emptyItems')}</Text>
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
        <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
          <SafeAreaView style={{ flex: 1 }}>
            <View style={m.sheetHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="sparkles" size={19} color={BRAND} />
                <Text style={[m.sheetTitle, { fontSize: 17 }]}>{t('workoutMenu.aiModal.title')}</Text>
              </View>
              <TouchableOpacity onPress={() => setAiModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('workoutMenu.a11y.close')}>
                <Ionicons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>

            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">

                {/* 使用するフォルダ選択 */}
                {folders.length > 0 && (
                  <>
                    <Text style={m.label}>{t('workoutMenu.aiModal.useLibraryLabel')}</Text>
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
                              backgroundColor: selected ? f.color + '1a' : '#ffffff',
                              borderColor: selected ? f.color : 'rgba(0,0,0,0.08)',
                            }}
                            activeOpacity={0.8}
                          >
                            <Ionicons name={f.icon as any} size={13} color={selected ? f.color : TEXT.secondary} />
                            <Text style={{ color: selected ? f.color : TEXT.secondary, fontSize: 13, fontWeight: '700' }}>{f.name}</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  </>
                )}

                {/* 今日のイメージ入力 */}
                <Text style={m.label}>{t('workoutMenu.aiModal.intentLabel')}</Text>
                <TextInput
                  value={aiIntent}
                  onChangeText={setAiIntent}
                  placeholder={t('workoutMenu.aiModal.intentPlaceholder')}
                  placeholderTextColor={TEXT.hint}
                  style={[m.input, { height: 100, textAlignVertical: 'top' }]}
                  multiline
                />

                <HapticTouch
                  haptic="whoosh"
                  style={[ai.genBtn, aiLoading && { opacity: 0.4 }]}
                  onPress={handleGenerate}
                  disabled={aiLoading}
                  activeOpacity={0.85}
                >
                  {aiLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="sparkles" size={17} color="#fff" />
                  )}
                  <Text style={ai.genBtnText}>{aiLoading ? t('workoutMenu.aiModal.generating') : t('workoutMenu.aiModal.generate')}</Text>
                  {!aiLoading && (
                    <View style={ai.genBtnBadge}><Text style={ai.genBtnBadgeText}>{t('workoutMenu.aiModal.ticketCost', { n: TICKET_COST.workout })}</Text></View>
                  )}
                </HapticTouch>

                {/* 結果表示 */}
                {aiResult !== '' && (
                  <AIMenuResultCard text={aiResult} loading={aiLoading} onRegenerate={handleGenerate} />
                )}
              </ScrollView>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </View>
      </Modal>

      {/* ── 手動ピッカーモーダル ── */}
      <Modal visible={pickModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPickModal(false)}>
        <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
          <SafeAreaView style={{ flex: 1 }}>
            <View style={m.sheetHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="list-outline" size={19} color={TEXT.secondary} />
                <Text style={[m.sheetTitle, { fontSize: 17 }]}>
                  {pickStep === 'select' ? t('workoutMenu.pickerModal.selectTitle') : t('workoutMenu.pickerModal.generateTitle')}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setPickModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('workoutMenu.a11y.close')}>
                <Ionicons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>

            {pickStep === 'select' ? (
              <>
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
                  {folders.length === 0 ? (
                    <View style={s.emptyCard}>
                      <Ionicons name="folder-outline" size={32} color={TEXT.hint} style={{ marginBottom: 8 }} />
                      <Text style={{ color: '#888', fontSize: 14 }}>{t('workoutMenu.pickerModal.noFoldersTitle')}</Text>
                    </View>
                  ) : (
                    folders.map(folder => {
                      const isExpanded = expandedFolders.includes(folder.id)
                      const pickedCount = pickedItems.filter(p => p.folderId === folder.id).length
                      return (
                        <View key={folder.id} style={pk.folderWrap}>
                          <TouchableOpacity
                            style={[pk.folderHeader, { borderColor: pickedCount > 0 ? folder.color + '66' : 'rgba(0,0,0,0.08)' }]}
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
                                <Text style={{ color: '#555', fontSize: 13, padding: 12 }}>{t('workoutMenu.pickerModal.noItems')}</Text>
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
                                      <Text style={[pk.itemText, picked && { color: TEXT.primary, fontWeight: '700' }]}>{item}</Text>
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
                    <Text style={{ color: TEXT.secondary, fontSize: 12 }}>{t('workoutMenu.pickerModal.selectedLabel')}</Text>
                    <Text style={{ color: TEXT.primary, fontSize: 14, fontWeight: '800' }}>{t('workoutMenu.pickerModal.selectedCount', { n: pickedItems.length })}</Text>
                  </View>
                  <HapticTouch
                    haptic="whoosh"
                    style={[pk.nextBtn, pickedItems.length === 0 && { opacity: 0.4 }]}
                    onPress={() => { setPickResult(''); setPickStep('generate') }}
                    disabled={pickedItems.length === 0}
                    activeOpacity={0.85}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: -0.3 }}>{t('workoutMenu.pickerModal.next')}</Text>
                    <Ionicons name="chevron-forward" size={16} color="#fff" />
                  </HapticTouch>
                </View>
              </>
            ) : (
              <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">

                  {/* ピック種目サマリ */}
                  <Text style={m.label}>{t('workoutMenu.pickerModal.pickedSummary', { n: pickedItems.length })}</Text>
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
                  <Text style={[m.label, { marginTop: 16 }]}>{t('workoutMenu.pickerModal.intentLabel')}</Text>
                  <TextInput
                    value={pickIntent}
                    onChangeText={setPickIntent}
                    placeholder={t('workoutMenu.pickerModal.intentPlaceholder')}
                    placeholderTextColor={TEXT.hint}
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
                      : <Ionicons name="sparkles" size={17} color="#fff" />
                    }
                    <Text style={ai.genBtnText}>{pickLoading ? t('workoutMenu.pickerModal.generating') : t('workoutMenu.pickerModal.generateWithPick')}</Text>
                    {!pickLoading && (
                      <View style={ai.genBtnBadge}><Text style={ai.genBtnBadgeText}>{t('workoutMenu.aiModal.ticketCost', { n: TICKET_COST.workout })}</Text></View>
                    )}
                  </HapticTouch>

                  {/* 結果 */}
                  {pickResult !== '' && (
                    <AIMenuResultCard text={pickResult} loading={pickLoading} onRegenerate={handleGenerateFromPicked} />
                  )}
                </ScrollView>

                <View style={pk.bottomBar}>
                  <TouchableOpacity onPress={() => setPickStep('select')} style={pk.backBtn} activeOpacity={0.8}>
                    <Ionicons name="chevron-back" size={16} color="#888" />
                    <Text style={{ color: '#888', fontWeight: '700' }}>{t('workoutMenu.pickerModal.backToSelect')}</Text>
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
              <Text style={m.sheetTitle}>{t('workoutMenu.histDetailModal.title')}</Text>
              <TouchableOpacity onPress={() => setHistModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('workoutMenu.a11y.close')}>
                <Ionicons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>
            {histItem && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={{ backgroundColor: '#f0f2f5', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <Text style={{ color: TEXT.secondary, fontSize: 11 }}>{new Date(histItem.created_at).toLocaleString(language === 'ja' ? 'ja-JP' : 'en-US')}</Text>
                  <Text style={{ color: TEXT.primary, fontSize: 13, marginTop: 4 }}>「{histItem.intent}」</Text>
                </View>
                <AIMenuResultCard text={histItem.result} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <AdGateModal
        visible={adGateVisible}
        feature="workout"
        remaining={adGateRemaining}
        hardLimited={adGateHardLimited}
        limitType={adGateLimitType}
        isGuest={isGuest}
        onClose={() => { setAdGateVisible(false); setAdGatePendingFn(null) }}
        onAdWatched={async () => {
          setAdGateVisible(false)
          // 使用記録は generateFromPickedCore/generateCore が生成成功時にのみ行う(ここで先に記録すると二重課金・失敗時課金になる)
          const pending = adGatePendingFn
          setAdGatePendingFn(null)
          if (pending === 'pick') { generateFromPickedCore() }
          else if (pending === 'intent') { generateCore() }
        }}
        onUpgrade={() => {
          setAdGateVisible(false)
          setAdGatePendingFn(null)
          router.push('/paywall')
        }}
      />

      <TicketGateModal
        visible={ticketGateVisible}
        feature="workout"
        ticketCost={ticketGateCost}
        ticketBalance={ticketGateBalance}
        onClose={() => setTicketGateVisible(false)}
      />
    </View>
  )
}

// ── スタイル ──────────────────────────────────────────────
const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: 'transparent' },
  tabBar:     { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 8 },
  tabBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', backgroundColor: '#ffffff' },
  tabBtnActive:{ backgroundColor: BRAND, borderColor: BRAND },
  tabText:    { color: TEXT.primary, fontSize: 13, fontWeight: '700' },
  tabTextActive:{ color: '#fff' },
  content:    { padding: 16, gap: 12, paddingBottom: 60 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle:  { color: TEXT.primary, fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  sectionLead:   { color: TEXT.secondary, fontSize: 12.5, marginTop: -4, lineHeight: 18 },
  addFolderBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BRAND, borderRadius: 21, paddingHorizontal: 12, paddingVertical: 6 },
  emptyCard:  { backgroundColor: '#ffffff', borderRadius: 21, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', borderStyle: 'dashed' },
  // 単色アクセント方針：主要選択肢(AIおまかせ)だけブランドカラーのアイコン背景で
  // 目立たせ、副次選択肢(種目指定)はニュートラルにして視覚的な優先順位をつける
  manualBtn:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#ffffff', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16 },
  manualBtnIcon:  { width: 48, height: 48, borderRadius: 14, backgroundColor: '#f0f2f5', alignItems: 'center', justifyContent: 'center' },
  manualBtnTitle: { color: TEXT.primary, fontSize: 15, fontWeight: '700' },
  manualBtnSub:   { color: TEXT.secondary, fontSize: 12, marginTop: 2 },
  aiBtn:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#ffffff', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  aiBtnIcon:  { width: 48, height: 48, borderRadius: 14, backgroundColor: BRAND + '14', alignItems: 'center', justifyContent: 'center' },
  aiBtnTitle: { color: TEXT.primary, fontSize: 15, fontWeight: '700' },
  aiBtnSub:   { color: TEXT.secondary, fontSize: 12, marginTop: 2 },
  histCard:   { backgroundColor: '#ffffff', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', padding: 16, gap: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  histDate:   { color: TEXT.secondary, fontSize: 11 },
  histIntent: { color: TEXT.primary, fontSize: 13, fontStyle: 'italic' },
  histPreview:{ color: TEXT.secondary, fontSize: 12 },
})

const m = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: DIVIDER },
  sheetTitle:  { color: TEXT.primary, fontSize: 16, fontWeight: '800' },
  label:       { color: TEXT.secondary, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  input:       { backgroundColor: '#f0f2f5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: TEXT.primary, fontSize: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', marginBottom: 14 },
  colorDot:    { width: 28, height: 28, borderRadius: 14 },
  colorDotSelected: { borderWidth: 2.5, borderColor: '#1c1c1e', transform: [{ scale: 1.15 }] },
  iconBtn:     { width: 40, height: 40, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f2f5' },
  saveBtn:     { backgroundColor: '#1c1c1e', borderRadius: 50, paddingVertical: 15, alignItems: 'center', marginBottom: 10 },
  deleteBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
})

const d = StyleSheet.create({
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
})

const pk = StyleSheet.create({
  folderWrap:   { marginBottom: 10 },
  folderHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#ffffff', borderRadius: 14, borderWidth: 1, padding: 12 },
  folderName:   { flex: 1, color: TEXT.primary, fontSize: 14, fontWeight: '700' },
  badge:        { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  itemList:     { backgroundColor: '#f0f2f5', borderRadius: 12, marginTop: 4, overflow: 'hidden' },
  itemRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.06)' },
  checkbox:     { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#c7c7cc', alignItems: 'center', justifyContent: 'center' },
  itemText:     { flex: 1, color: TEXT.secondary, fontSize: 14 },
  bottomBar:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: DIVIDER, backgroundColor: '#f6f6f8' },
  nextBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1c1c1e', borderRadius: 50, paddingHorizontal: 24, paddingVertical: 13 },
  backBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  confirmList:  { backgroundColor: '#ffffff', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', padding: 8 },
  confirmRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.05)' },
  folderTag:    { borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  confirmText:  { flex: 1, color: TEXT.primary, fontSize: 14 },
})

const ai = StyleSheet.create({
  // ボタン背景色そのままの発光シャドウ（AIっぽさの一因）をやめ、他カードと同じ
  // ニュートラルな影に統一
  genBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: BRAND, borderRadius: 14, paddingVertical: 16, marginBottom: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2 },
  genBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  genBtnBadge:     { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  genBtnBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
})

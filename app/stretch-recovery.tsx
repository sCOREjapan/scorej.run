// app/stretch-recovery.tsx — ストレッチリカバリー機能
// フロー: 部位選択 → ストレッチ実施 → 完了
// シンプル・ユニバーサルデザイン方針: イラスト/説明文なし、大きな文字、少ない要素

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, TextInput, KeyboardAvoidingView, Platform, PanResponder,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Svg, { Circle } from 'react-native-svg'
import * as Haptics from 'expo-haptics'
import { Sounds, unlockAudio } from '../lib/sounds'
import { todayLocalISO } from '../lib/dateLocal'
import { updateStretchResult } from '../lib/stretchResultStore'

const CUSTOM_PARTS_KEY     = 'trackmate_stretch_custom_parts'
const PART_ORDER_KEY       = 'trackmate_stretch_part_order'
const HIDDEN_PARTS_KEY     = 'trackmate_stretch_hidden_parts'
const MAX_DAILY_REDUCTION  = 20

// ── 部位データ ───────────────────────────────────────────────
const BODY_PARTS = [
  { id: 'shoulder_neck',  name: '肩・首',         icon: '🙆', bilateral: true  },
  { id: 'chest_scapula',  name: '胸・肩甲骨',     icon: '🫁', bilateral: true  },
  { id: 'lower_back',     name: '腰・背中',       icon: '🔙', bilateral: false },
  { id: 'core',           name: '体幹・腹斜筋',   icon: '🧘', bilateral: true  },
  { id: 'hip',            name: '股関節',         icon: '🔄', bilateral: true  },
  { id: 'glutes',         name: 'お尻',           icon: '🍑', bilateral: true  },
  { id: 'adductor',       name: '内転筋',         icon: '🦵', bilateral: true  },
  { id: 'quad',           name: '太もも前面',     icon: '🦿', bilateral: true  },
  { id: 'hamstring',      name: 'ハムストリング', icon: '🦵', bilateral: true  },
  { id: 'calf_achilles',  name: 'ふくらはぎ',     icon: '👟', bilateral: true  },
  { id: 'ankle',          name: '足首',           icon: '🦶', bilateral: true  },
  { id: 'wrist_forearm',  name: '手首・前腕',     icon: '💪', bilateral: true  },
] as const

interface BodyPart {
  id: string
  name: string
  icon: string
  bilateral: boolean
}

type PartId = string
type Side   = 'left' | 'right' | null

// ── ロジック ─────────────────────────────────────────────────
function getRecommendedParts(riskScore: number): PartId[] {
  if (riskScore >= 70) return ['hamstring', 'hip', 'calf_achilles', 'lower_back']
  if (riskScore >= 40) return ['hamstring', 'hip']
  return []
}

// 実際に伸ばした秒数に比例して減少量を決める（15秒につき1pt、最低2pt、1日上限20pt）
function calcRecoveryReduction(totalSeconds: number, skippedCount: number): number {
  const base = Math.max(2, Math.min(MAX_DAILY_REDUCTION, Math.round(totalSeconds / 15)))
  return Math.max(base - skippedCount, 1)
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}分${s}秒` : `${s}秒`
}

// 1日の上限を考慮して実際に適用される減少量を返す
async function saveResult(reduction: number): Promise<{ applied: number; capped: boolean }> {
  const today = todayLocalISO()
  try {
    let applied = 0
    await updateStretchResult(current => {
      const prevTotal = current.date === today ? current.reduction ?? 0 : 0
      const newTotal  = Math.min(MAX_DAILY_REDUCTION, prevTotal + reduction)
      applied = newTotal - prevTotal
      return { date: today, reduction: newTotal, showBanner: applied > 0, lastReduction: applied }
    })
    return { applied, capped: applied < reduction }
  } catch {
    return { applied: 0, capped: false }
  }
}

// ── 円形タイマー ──────────────────────────────────────────────
function CircularTimer({ progress, seconds, color }: {
  progress: number
  seconds: number
  color:    string
}) {
  const r             = 78
  const circumference = 2 * Math.PI * r
  const dashOffset    = circumference * (1 - progress)

  return (
    <View style={{ width: 180, height: 180, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={180} height={180} viewBox="0 0 180 180" style={{ position: 'absolute' }}>
        <Circle cx={90} cy={90} r={r} fill="none" stroke="#e5e7eb" strokeWidth={10} />
        <Circle
          cx={90} cy={90} r={r}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          rotation={-90}
          origin="90, 90"
        />
      </Svg>
      <Text style={{ color: '#111827', fontSize: 60, fontWeight: '900', lineHeight: 64 }}>
        {seconds.toString().padStart(2, '0')}
      </Text>
    </View>
  )
}

// ── 並び替え可能リスト（ドラッグ&ドロップ・削除） ──────────────────
const REORDER_ROW_H = 60

function ReorderRow({
  part, translateY, active, onDragStart, onDragMove, onDragEnd, onDelete,
}: {
  part:        BodyPart
  translateY:  number
  active:      boolean
  onDragStart: () => void
  onDragMove:  (dy: number) => void
  onDragEnd:   () => void
  onDelete:    () => void
}) {
  const onDragStartRef = useRef(onDragStart)
  const onDragMoveRef  = useRef(onDragMove)
  const onDragEndRef   = useRef(onDragEnd)
  onDragStartRef.current = onDragStart
  onDragMoveRef.current  = onDragMove
  onDragEndRef.current   = onDragEnd

  const responder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => onDragStartRef.current(),
      onPanResponderMove: (_, g) => onDragMoveRef.current(g.dy),
      onPanResponderRelease: () => onDragEndRef.current(),
      onPanResponderTerminate: () => onDragEndRef.current(),
    })
  ).current

  return (
    <View
      style={[
        rl.row,
        active && rl.rowActive,
        { transform: [{ translateY }], zIndex: active ? 10 : 1 },
      ]}
    >
      <View {...responder.panHandlers} style={rl.handle} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="reorder-three" size={22} color="#bbb" />
      </View>
      <Text style={{ fontSize: 22, marginRight: 10 }}>{part.icon}</Text>
      <Text style={rl.rowName}>{part.name}</Text>
      <TouchableOpacity onPress={onDelete} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="削除">
        <Ionicons name="trash-outline" size={18} color="#C8102E" />
      </TouchableOpacity>
    </View>
  )
}

function ReorderableList({
  parts, onReorder, onDelete, onDragActiveChange,
}: {
  parts:              BodyPart[]
  onReorder:          (ids: string[]) => void
  onDelete:           (id: string) => void
  onDragActiveChange?: (active: boolean) => void
}) {
  const [order, setOrder] = useState<string[]>(parts.map(p => p.id))
  const orderRef = useRef(order)
  orderRef.current = order
  const byId = Object.fromEntries(parts.map(p => [p.id, p]))
  const partsKey = parts.map(p => p.id).join(',')

  useEffect(() => {
    setOrder(prev => {
      const ids = parts.map(p => p.id)
      const kept  = prev.filter(id => ids.includes(id))
      const added = ids.filter(id => !kept.includes(id))
      return [...kept, ...added]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partsKey])

  const [dragId, setDragId] = useState<string | null>(null)
  const [dragDy, setDragDy] = useState(0)
  const startIndexRef = useRef(0)
  const committedRef   = useRef(0)

  function startDrag(id: string) {
    setDragId(id)
    setDragDy(0)
    startIndexRef.current = orderRef.current.indexOf(id)
    committedRef.current = 0
    onDragActiveChange?.(true)
  }

  function moveDrag(id: string, dy: number) {
    setDragDy(dy)
    const rawTarget = startIndexRef.current + Math.round(dy / REORDER_ROW_H)
    const target = Math.max(0, Math.min(orderRef.current.length - 1, rawTarget))
    const committed = target - startIndexRef.current
    if (committed !== committedRef.current) {
      const cur = [...orderRef.current]
      const from = cur.indexOf(id)
      cur.splice(from, 1)
      cur.splice(target, 0, id)
      committedRef.current = committed
      setOrder(cur)
    }
  }

  function endDrag() {
    setDragId(null)
    setDragDy(0)
    onDragActiveChange?.(false)
    onReorder(orderRef.current)
  }

  return (
    <View style={{ marginBottom: 20 }}>
      {order.map(id => {
        const part = byId[id]
        if (!part) return null
        const isDragging = dragId === id
        const liveOffset  = isDragging ? dragDy - committedRef.current * REORDER_ROW_H : 0
        return (
          <ReorderRow
            key={id}
            part={part}
            translateY={liveOffset}
            active={isDragging}
            onDragStart={() => startDrag(id)}
            onDragMove={(dy) => moveDrag(id, dy)}
            onDragEnd={endDrag}
            onDelete={() => onDelete(id)}
          />
        )
      })}
    </View>
  )
}

const rl = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    height: REORDER_ROW_H, paddingHorizontal: 14,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
    marginBottom: 8,
  },
  rowActive: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 10, elevation: 6,
  },
  handle:  { padding: 4 },
  rowName: { flex: 1, fontSize: 15, fontWeight: '700', color: '#111827' },
})

// ══════════════════════════════════════════════════════════════
// 画面1: 部位選択
// ══════════════════════════════════════════════════════════════
function PartSelectScreen({
  selected,
  recommended,
  parts,
  onToggle,
  onStart,
  onAddCustom,
  onReorder,
  onDeletePart,
}: {
  selected:     Set<PartId>
  recommended:  PartId[]
  parts:        BodyPart[]
  onToggle:     (id: PartId) => void
  onStart:      () => void
  onAddCustom:  (name: string) => void
  onReorder:    (ids: string[]) => void
  onDeletePart: (id: string) => void
}) {
  const [adding, setAdding]         = useState(false)
  const [customName, setCustomName] = useState('')
  const [editMode, setEditMode]     = useState(false)
  const [dragging, setDragging]     = useState(false)
  const allParts = parts

  const submitCustom = () => {
    if (!customName.trim()) return
    onAddCustom(customName.trim())
    setCustomName('')
    setAdding(false)
  }

  return (
    <ScrollView contentContainerStyle={ps.content} showsVerticalScrollIndicator={false} scrollEnabled={!dragging}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <Text style={[ps.title, { marginBottom: 0 }]}>どこを伸ばしますか？</Text>
        <TouchableOpacity onPress={() => setEditMode(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name={editMode ? 'checkmark' : 'swap-vertical'} size={16} color="#666" />
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#666' }}>{editMode ? '完了' : '並び替え'}</Text>
        </TouchableOpacity>
      </View>

      {editMode ? (
        <ReorderableList parts={allParts} onReorder={onReorder} onDelete={onDeletePart} onDragActiveChange={setDragging} />
      ) : (
      <View style={ps.grid}>
        {allParts.map(part => {
          const isSelected  = selected.has(part.id)
          const isRecommend = recommended.includes(part.id)
          return (
            <TouchableOpacity
              key={part.id}
              style={[ps.card, isSelected && ps.cardSelected]}
              onPress={() => onToggle(part.id)}
              activeOpacity={0.75}
            >
              {isRecommend && (
                <View style={ps.badge}>
                  <Text style={ps.badgeText}>おすすめ</Text>
                </View>
              )}
              <Text style={{ fontSize: 32, marginBottom: 8 }}>{part.icon}</Text>
              <Text style={[ps.partName, isSelected && { color: '#C8102E' }]}>{part.name}</Text>
            </TouchableOpacity>
          )
        })}

        {adding ? (
          <View style={[ps.card, { paddingVertical: 14, justifyContent: 'center' }]}>
            <TextInput
              value={customName}
              onChangeText={setCustomName}
              placeholder="部位名を入力"
              placeholderTextColor="#ccc"
              autoFocus
              onSubmitEditing={submitCustom}
              style={{ fontSize: 15, fontWeight: '700', color: '#111827', textAlign: 'center', paddingVertical: 4 }}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, justifyContent: 'center' }}>
              <TouchableOpacity onPress={() => { setAdding(false); setCustomName('') }}>
                <Text style={{ color: '#999', fontWeight: '700', fontSize: 13 }}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitCustom}>
                <Text style={{ color: '#C8102E', fontWeight: '800', fontSize: 13 }}>追加</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={[ps.card, { borderStyle: 'dashed', justifyContent: 'center' }]}
            onPress={() => setAdding(true)}
            activeOpacity={0.75}
          >
            <Ionicons name="add-circle-outline" size={28} color="#999" style={{ marginBottom: 8 }} />
            <Text style={[ps.partName, { color: '#999' }]}>自分で追加</Text>
          </TouchableOpacity>
        )}
      </View>
      )}

      <TouchableOpacity
        style={[ps.startBtn, selected.size === 0 && { opacity: 0.35 }]}
        onPress={onStart}
        disabled={selected.size === 0}
        activeOpacity={0.85}
      >
        <Text style={ps.startBtnText}>{selected.size}部位を始める</Text>
        <Ionicons name="arrow-forward" size={20} color="#fff" />
      </TouchableOpacity>
    </ScrollView>
  )
}

const ps = StyleSheet.create({
  content:       { padding: 20, paddingBottom: 40 },
  title:         { color: '#111827', fontSize: 24, fontWeight: '900', marginBottom: 24 },
  grid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 28 },
  card:          {
    width: '47%', backgroundColor: '#ffffff',
    borderRadius: 18, borderWidth: 2, borderColor: 'rgba(0,0,0,0.08)',
    paddingVertical: 22, alignItems: 'center', position: 'relative',
  },
  cardSelected: {
    borderColor: '#C8102E',
    backgroundColor: 'rgba(200,16,46,0.05)',
  },
  badge:         {
    position: 'absolute', top: 10, right: 10,
    backgroundColor: '#f59e0b', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  badgeText:     { color: '#fff', fontSize: 10, fontWeight: '900' },
  partName:      { color: '#111827', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  startBtn:      {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#C8102E', borderRadius: 50, paddingVertical: 19,
  },
  startBtnText:  { color: '#fff', fontSize: 17, fontWeight: '900' },
})

// ══════════════════════════════════════════════════════════════
// 画面2: ストレッチ実施
// ══════════════════════════════════════════════════════════════
const TIME_OPTIONS = [0, 25, 30, 45, 60]

function StretchScreen({
  parts,
  secondsPerStretch,
  onComplete,
  onSkip,
  onBack,
  onChangeSeconds,
}: {
  parts:             BodyPart[]
  secondsPerStretch: number
  onComplete:        (totalSec: number, skipped: number) => void
  onSkip:            (partId: PartId) => void
  onBack:            () => void
  onChangeSeconds:   (s: number) => void
}) {
  const [currentIndex,    setCurrentIndex]    = useState(0)
  const [secondsLeft,     setSecondsLeft]     = useState(secondsPerStretch > 0 ? secondsPerStretch : 0)
  const [isPaused,        setIsPaused]        = useState(false)
  const [isStarted,       setIsStarted]       = useState(false)
  const [skipped,         setSkipped]         = useState<Set<PartId>>(new Set())
  const [totalSpent,      setTotalSpent]      = useState(0)
  const [showTimePicker,  setShowTimePicker]  = useState(false)
  const [side,            setSide]            = useState<Side>(() => parts[0]?.bilateral ? 'left' : null)
  const [leftElapsed,     setLeftElapsed]     = useState(0)

  const part     = parts[currentIndex]
  const isLast   = currentIndex === parts.length - 1
  const isManual = secondsPerStretch === 0

  // 手動モード用: 現在の部位/サイドに入った時刻（実際に伸ばした時間を計測するため）
  const manualEnterRef = useRef<number>(Date.now())

  // ── 部位変更時リセット ─────────────────────────────────────
  useEffect(() => {
    const p = parts[currentIndex]
    setSide(p?.bilateral ? 'left' : null)
    setLeftElapsed(0)
    setSecondsLeft(secondsPerStretch > 0 ? secondsPerStretch : 0)
    setIsStarted(false)
    setIsPaused(false)
    manualEnterRef.current = Date.now()
  }, [currentIndex])

  // ── 秒数変更時リセット ────────────────────────────────────
  useEffect(() => {
    setSecondsLeft(secondsPerStretch > 0 ? secondsPerStretch : 0)
    setIsStarted(false)
    setIsPaused(false)
  }, [secondsPerStretch])

  // ── 左→右切り替え時リセット ───────────────────────────────
  const prevSideRef = useRef<Side>(null)
  useEffect(() => {
    if (side === 'right' && prevSideRef.current === 'left') {
      setSecondsLeft(secondsPerStretch > 0 ? secondsPerStretch : 0)
      setIsStarted(false)
      setIsPaused(false)
      manualEnterRef.current = Date.now()
    }
    prevSideRef.current = side
  }, [side])

  // ── カウントダウン ────────────────────────────────────────
  useEffect(() => {
    if (isManual || !isStarted || isPaused) return

    if (secondsLeft <= 0) {
      if (side === 'left') {
        // 左側タイマー終了 → 右側へ切り替え
        Sounds.ding()
        setLeftElapsed(secondsPerStretch)
        const t = setTimeout(() => setSide('right'), 700)
        return () => clearTimeout(t)
      } else {
        // 右側 or 片側 → 完了
        Sounds.save()
        const elapsed = side === 'right'
          ? leftElapsed + secondsPerStretch
          : secondsPerStretch
        const t = setTimeout(() => advanceNext(false, elapsed), 700)
        return () => clearTimeout(t)
      }
    }

    if (secondsLeft > 0 && secondsLeft <= 5) {
      Sounds.tap()
    }
    const timer = setInterval(() => setSecondsLeft(s => s - 1), 1000)
    return () => clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, isPaused, isStarted, side, isManual])

  // 手動モードで実際に経過した秒数
  function manualElapsedSeconds(): number {
    return Math.max(0, Math.round((Date.now() - manualEnterRef.current) / 1000))
  }

  // ── 次の部位へ進む ────────────────────────────────────────
  function advanceNext(wasSkipped: boolean, overrideElapsed?: number) {
    const elapsed = wasSkipped
      ? 0
      : (overrideElapsed ?? (secondsPerStretch > 0 ? secondsPerStretch - secondsLeft : 0))

    if (!wasSkipped) {
      setTotalSpent(t => t + elapsed)
    } else {
      setSkipped(prev => new Set([...prev, part.id]))
      onSkip(part.id)
    }
    if (isLast) {
      const total        = wasSkipped ? totalSpent : totalSpent + elapsed
      const skippedCount = wasSkipped ? skipped.size + 1 : skipped.size
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      onComplete(total, skippedCount)
    } else {
      setCurrentIndex(i => i + 1)
    }
  }

  // ── 完了ボタン（早期終了 or 手動モード）─────────────────────
  function handleComplete() {
    if (side === 'left') {
      // 左側完了 → 右側へ切り替え
      Sounds.ding()
      const elapsed = isManual ? manualElapsedSeconds() : secondsPerStretch - secondsLeft
      setLeftElapsed(elapsed)
      setSide('right')
    } else {
      // 右側 or 片側完了
      Sounds.save()
      const elapsed = isManual
        ? leftElapsed + manualElapsedSeconds()
        : side === 'right'
          ? leftElapsed + (secondsPerStretch - secondsLeft)
          : secondsPerStretch - secondsLeft
      advanceNext(false, elapsed)
    }
  }

  function handleBack() {
    if (currentIndex > 0) {
      setCurrentIndex(i => i - 1)
    } else {
      onBack()
    }
  }

  const progress   = secondsPerStretch > 0 ? 1 - secondsLeft / secondsPerStretch : 0
  const timerColor =
    secondsLeft > 20 ? '#C8102E' :
    secondsLeft > 10 ? '#F5A623' : '#34C759'

  const completeLabel = side === 'left' ? '左完了 →' : '完了'

  if (!part) return null

  return (
    <View style={{ flex: 1 }}>
      {/* 進捗 */}
      <View style={ss.progressRow}>
        <Text style={ss.progressText}>{currentIndex + 1}/{parts.length}</Text>
        <TouchableOpacity
          style={ss.timeBadge}
          onPress={() => setShowTimePicker(v => !v)}
          activeOpacity={0.7}
        >
          <Text style={ss.timeBadgeText}>
            {isManual ? '⏱ 自由' : `⏱ ${secondsPerStretch}秒`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 秒数選択シート */}
      {showTimePicker && (
        <View style={ss.timePicker}>
          {TIME_OPTIONS.map(t => (
            <TouchableOpacity
              key={t}
              style={[ss.timeOpt, t === secondsPerStretch && ss.timeOptActive]}
              onPress={() => { onChangeSeconds(t); setShowTimePicker(false) }}
              activeOpacity={0.7}
            >
              <Text style={[ss.timeOptText, t === secondsPerStretch && { color: '#C8102E' }]}>
                {t === 0 ? '自由' : `${t}秒`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ScrollView contentContainerStyle={ss.content} showsVerticalScrollIndicator={false}>
        {/* 部位名 */}
        <Text style={ss.partIcon}>{part.icon}</Text>
        <Text style={ss.partName}>{part.name}</Text>

        {/* 左右インジケーター（bilateral のみ） */}
        {side !== null && (
          <View style={ss.sideIndicator}>
            <View style={[ss.sideStep, side === 'left' && ss.sideStepActive]}>
              <Text style={[ss.sideStepText, side === 'left' && { color: '#fff' }]}>左</Text>
            </View>
            <Ionicons name="arrow-forward" size={14} color="#c4b5b5" style={{ marginHorizontal: 4 }} />
            <View style={[ss.sideStep, side === 'right' && ss.sideStepActive]}>
              <Text style={[ss.sideStepText, side === 'right' && { color: '#fff' }]}>右</Text>
            </View>
          </View>
        )}

        {/* タイマー or 手動表示 */}
        {!isManual ? (
          <View style={{ alignItems: 'center', marginVertical: 28 }}>
            <CircularTimer
              progress={progress}
              seconds={secondsLeft}
              color={timerColor}
            />
          </View>
        ) : (
          <View style={{ alignItems: 'center', marginVertical: 28 }}>
            <Ionicons name="timer-outline" size={64} color="#d1d5db" />
            <Text style={ss.manualHint}>終わったら「完了」を押してください</Text>
          </View>
        )}

        {/* ── スタート前（タイマーモード）── */}
        {!isStarted && !isManual && (
          <View style={ss.btnRow}>
            <TouchableOpacity style={ss.subBtn} onPress={handleBack} activeOpacity={0.7} accessibilityLabel="戻る">
              <Ionicons name="arrow-back" size={20} color="#9ca3af" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[ss.mainBtn, { backgroundColor: '#C8102E' }]}
              onPress={() => {
                unlockAudio()
                setIsStarted(true)
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="play" size={20} color="#fff" />
              <Text style={ss.mainBtnText}>
                {side === 'left' ? '左スタート' : side === 'right' ? '右スタート' : 'スタート'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={ss.subBtn} onPress={() => advanceNext(true)} activeOpacity={0.7}>
              <Text style={ss.skipText}>スキップ</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 手動モード（タイマーなし）── */}
        {isManual && (
          <View style={ss.btnRow}>
            <TouchableOpacity style={ss.subBtn} onPress={handleBack} activeOpacity={0.7} accessibilityLabel="戻る">
              <Ionicons name="arrow-back" size={20} color="#9ca3af" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[ss.mainBtn, { backgroundColor: '#C8102E' }]}
              onPress={handleComplete}
              activeOpacity={0.85}
            >
              <Ionicons name={side === 'left' ? 'arrow-forward' : 'checkmark'} size={20} color="#fff" />
              <Text style={ss.mainBtnText}>{completeLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ss.subBtn} onPress={() => advanceNext(true)} activeOpacity={0.7}>
              <Text style={ss.skipText}>スキップ</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 実施中（タイマーモード）── */}
        {isStarted && !isManual && (
          <View style={ss.btnRow}>
            <TouchableOpacity style={ss.subBtn} onPress={handleBack} activeOpacity={0.7} accessibilityLabel="戻る">
              <Ionicons name="arrow-back" size={20} color="#9ca3af" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[ss.mainBtn, isPaused ? { backgroundColor: '#34C759' } : { backgroundColor: '#555' }]}
              onPress={() => setIsPaused(v => !v)}
              activeOpacity={0.85}
            >
              <Ionicons name={isPaused ? 'play' : 'pause'} size={18} color="#fff" />
              <Text style={ss.mainBtnText}>{isPaused ? '再開' : '一時停止'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[ss.subBtn2, { backgroundColor: '#C8102E' }]}
              onPress={handleComplete}
              activeOpacity={0.85}
              accessibilityLabel={completeLabel}
            >
              <Ionicons name={side === 'left' ? 'arrow-forward' : 'checkmark'} size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  )
}

const ss = StyleSheet.create({
  progressRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12,
  },
  progressText:  { color: '#6b7280', fontSize: 14, fontWeight: '700' },
  timeBadge:     {
    backgroundColor: '#f0f2f5', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
    paddingHorizontal: 10, paddingVertical: 5,
  },
  timeBadgeText: { color: '#6b7280', fontSize: 13, fontWeight: '700' },
  timePicker:    {
    flexDirection: 'row', justifyContent: 'center', gap: 8,
    paddingHorizontal: 20, paddingBottom: 10,
  },
  timeOpt:       {
    flex: 1, backgroundColor: '#ffffff',
    borderRadius: 10, paddingVertical: 12, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
  },
  timeOptActive: { backgroundColor: 'rgba(200,16,46,0.06)', borderWidth: 1.5, borderColor: '#C8102E' },
  timeOptText:   { color: '#6b7280', fontSize: 14, fontWeight: '700' },
  content:       { padding: 20, paddingBottom: 40, alignItems: 'center' },
  partIcon:      { fontSize: 48, marginBottom: 8 },
  partName:      { color: '#111827', fontSize: 26, fontWeight: '900', textAlign: 'center' },
  manualHint:    { color: '#6b7280', fontSize: 14, fontWeight: '600', marginTop: 12, textAlign: 'center' },
  // 左右インジケーター
  sideIndicator: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 14,
  },
  sideStep: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.10)',
  },
  sideStepActive: {
    backgroundColor: '#C8102E',
    borderColor: '#C8102E',
  },
  sideStepText: {
    color: '#9ca3af', fontSize: 14, fontWeight: '900',
  },
  // ボタン
  btnRow:        {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    width: '100%', marginTop: 8,
  },
  mainBtn:       {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 16, paddingVertical: 18,
  },
  mainBtnText:   { color: '#fff', fontSize: 16, fontWeight: '900' },
  subBtn:        {
    width: 52, height: 52, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.10)',
    borderRadius: 16, backgroundColor: '#ffffff',
  },
  subBtn2:       {
    width: 52, height: 52, alignItems: 'center', justifyContent: 'center',
    borderRadius: 16,
  },
  skipText:      { color: '#6b7280', fontSize: 10, fontWeight: '700' },
})

// ══════════════════════════════════════════════════════════════
// 画面3: 完了
// ══════════════════════════════════════════════════════════════
function CompleteScreen({
  riskBefore,
  applied,
  capped,
  completedParts,
  totalSeconds,
  onHome,
}: {
  riskBefore:     number
  applied:        number
  capped:         boolean
  completedParts: number
  totalSeconds:   number
  onHome:         () => void
}) {
  const riskAfter = Math.max(0, riskBefore - applied)

  return (
    <ScrollView contentContainerStyle={cs.content} showsVerticalScrollIndicator={false}>
      <View style={cs.card}>
        <Ionicons name="checkmark-circle" size={56} color="#34C759" style={{ marginBottom: 8 }} />
        <Text style={cs.title}>お疲れさまでした</Text>

        <View style={cs.statsRow}>
          <View style={cs.stat}>
            <Text style={cs.statNum}>{completedParts}</Text>
            <Text style={cs.statLabel}>部位</Text>
          </View>
          <View style={cs.divider} />
          <View style={cs.stat}>
            <Text style={cs.statNum}>{fmtTime(totalSeconds)}</Text>
            <Text style={cs.statLabel}>合計時間</Text>
          </View>
        </View>

        <Text style={cs.riskLabel}>怪我リスクスコア</Text>
        <View style={cs.riskRow}>
          <Text style={cs.riskBefore}>{riskBefore}</Text>
          <Ionicons name="arrow-forward" size={22} color="#888" style={{ marginHorizontal: 10 }} />
          <Text style={cs.riskAfter}>{riskAfter}</Text>
        </View>
        {applied > 0 ? (
          <Text style={cs.riskDelta}>-{applied}ポイント</Text>
        ) : (
          <Text style={cs.riskCapped}>本日の減少上限に達しています</Text>
        )}
        {applied > 0 && capped && (
          <Text style={cs.riskCapped}>(本日の上限に近づいています)</Text>
        )}
      </View>

      <TouchableOpacity style={cs.homeBtn} onPress={onHome} activeOpacity={0.85}>
        <Text style={cs.homeBtnText}>ホームに戻る</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const cs = StyleSheet.create({
  content:    { padding: 24, paddingBottom: 60, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  card:       {
    width: '100%', backgroundColor: '#ffffff',
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
    padding: 28, alignItems: 'center', marginBottom: 24,
  },
  title:      { color: '#111827', fontSize: 22, fontWeight: '900', marginBottom: 20 },
  statsRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 24, gap: 20 },
  stat:       { alignItems: 'center', gap: 4 },
  statNum:    { color: '#111827', fontSize: 24, fontWeight: '900' },
  statLabel:  { color: '#9ca3af', fontSize: 11 },
  divider:    { width: 1, height: 36, backgroundColor: 'rgba(0,0,0,0.08)' },
  riskLabel:  { color: '#9ca3af', fontSize: 11, fontWeight: '700', marginBottom: 8, letterSpacing: 1 },
  riskRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  riskBefore: { color: '#ef4444', fontSize: 40, fontWeight: '900' },
  riskAfter:  { color: '#22c55e', fontSize: 40, fontWeight: '900' },
  riskDelta:  { color: '#22c55e', fontSize: 15, fontWeight: '800' },
  riskCapped: { color: '#6b7280', fontSize: 12, fontWeight: '600', marginTop: 2 },
  homeBtn:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#1c1c1e', borderRadius: 50,
    paddingVertical: 18, width: '100%',
  },
  homeBtnText:{ color: '#fff', fontSize: 16, fontWeight: '900' },
})

// ══════════════════════════════════════════════════════════════
// メインスクリーン
// ══════════════════════════════════════════════════════════════
type Phase = 'select' | 'stretch' | 'complete'

export default function StretchRecoveryScreen() {
  const router = useRouter()
  const { riskScore: riskScoreStr } = useLocalSearchParams<{ riskScore: string }>()
  const riskScore = parseInt(riskScoreStr ?? '50', 10)

  const recommended = getRecommendedParts(riskScore)
  const [selected, setSelected] = useState<Set<PartId>>(new Set(recommended))
  const [phase, setPhase]       = useState<Phase>('select')
  const [secondsPerStretch, setSecondsPerStretch] = useState(30)
  const [skippedParts, setSkippedParts] = useState<PartId[]>([])
  const [result, setResult] = useState<{ totalSec: number; applied: number; capped: boolean } | null>(null)
  const [customParts, setCustomParts] = useState<BodyPart[]>([])
  const [hiddenIds,   setHiddenIds]   = useState<Set<string>>(new Set())
  const [partOrder,   setPartOrder]   = useState<string[]>(BODY_PARTS.map(p => p.id))

  useEffect(() => {
    (async () => {
      try {
        const [customRaw, hiddenRaw, orderRaw] = await Promise.all([
          AsyncStorage.getItem(CUSTOM_PARTS_KEY),
          AsyncStorage.getItem(HIDDEN_PARTS_KEY),
          AsyncStorage.getItem(PART_ORDER_KEY),
        ])
        const custom = customRaw ? JSON.parse(customRaw) as BodyPart[] : []
        const hidden = hiddenRaw ? new Set<string>(JSON.parse(hiddenRaw)) : new Set<string>()
        setCustomParts(custom)
        setHiddenIds(hidden)
        const allIds = [...BODY_PARTS.map(p => p.id), ...custom.map(p => p.id)]
        if (orderRaw) {
          const saved = JSON.parse(orderRaw) as string[]
          const kept  = saved.filter(id => allIds.includes(id))
          const added = allIds.filter(id => !kept.includes(id))
          setPartOrder([...kept, ...added])
        } else {
          setPartOrder(allIds)
        }
      } catch {}
    })()
  }, [])

  const partsById: Record<string, BodyPart> = Object.fromEntries(
    [...BODY_PARTS, ...customParts].map(p => [p.id, p])
  )
  const visibleParts = partOrder.filter(id => !hiddenIds.has(id)).map(id => partsById[id]).filter(Boolean)

  function addCustomPart(name: string) {
    const part: BodyPart = { id: `custom_${Date.now()}`, name, icon: '✨', bilateral: false }
    const next = [...customParts, part]
    setCustomParts(next)
    AsyncStorage.setItem(CUSTOM_PARTS_KEY, JSON.stringify(next)).catch(() => {})
    const nextOrder = [...partOrder, part.id]
    setPartOrder(nextOrder)
    AsyncStorage.setItem(PART_ORDER_KEY, JSON.stringify(nextOrder)).catch(() => {})
  }

  function reorderParts(ids: string[]) {
    // 非表示分を末尾に維持しつつ、可視部位の並びだけ更新
    const hiddenTail = partOrder.filter(id => hiddenIds.has(id))
    const next = [...ids, ...hiddenTail]
    setPartOrder(next)
    AsyncStorage.setItem(PART_ORDER_KEY, JSON.stringify(next)).catch(() => {})
  }

  function deletePart(id: string) {
    const isCustom = customParts.some(p => p.id === id)
    if (isCustom) {
      const nextCustom = customParts.filter(p => p.id !== id)
      setCustomParts(nextCustom)
      AsyncStorage.setItem(CUSTOM_PARTS_KEY, JSON.stringify(nextCustom)).catch(() => {})
      const nextOrder = partOrder.filter(pid => pid !== id)
      setPartOrder(nextOrder)
      AsyncStorage.setItem(PART_ORDER_KEY, JSON.stringify(nextOrder)).catch(() => {})
    } else {
      const nextHidden = new Set(hiddenIds)
      nextHidden.add(id)
      setHiddenIds(nextHidden)
      AsyncStorage.setItem(HIDDEN_PARTS_KEY, JSON.stringify([...nextHidden])).catch(() => {})
    }
    setSelected(prev => {
      const n = new Set(prev)
      n.delete(id)
      return n
    })
  }

  const selectedParts = visibleParts.filter(p => selected.has(p.id))

  function togglePart(id: PartId) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleStart() {
    setSkippedParts([])
    setResult(null)
    setPhase('stretch')
  }

  async function handleStretchComplete(totalSec: number, skippedCount: number) {
    const reduction = calcRecoveryReduction(totalSec, skippedCount)
    const { applied, capped } = await saveResult(reduction)
    setResult({ totalSec, applied, capped })
    setPhase('complete')
  }

  function handleHome() {
    router.replace('/(tabs)')
  }

  const titleMap: Record<Phase, string> = {
    select:   'ストレッチを始めよう',
    stretch:  '',
    complete: '',
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f6f8' }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* ヘッダー */}
        <View style={ms.header}>
          <TouchableOpacity
            onPress={() => phase === 'select' ? router.back() : setPhase('select')}
            style={ms.backBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="戻る"
          >
            <Ionicons name="chevron-back" size={22} color="#6b7280" />
          </TouchableOpacity>
          <Text style={ms.headerTitle}>{titleMap[phase] || ''}</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* コンテンツ */}
        {phase === 'select' && (
          <PartSelectScreen
            selected={selected}
            recommended={recommended}
            parts={visibleParts}
            onToggle={togglePart}
            onStart={handleStart}
            onAddCustom={addCustomPart}
            onReorder={reorderParts}
            onDeletePart={deletePart}
          />
        )}

        {phase === 'stretch' && (
          <StretchScreen
            parts={selectedParts}
            secondsPerStretch={secondsPerStretch}
            onComplete={(total, skipped) => handleStretchComplete(total, skipped)}
            onSkip={(id) => setSkippedParts(prev => [...prev, id])}
            onBack={() => setPhase('select')}
            onChangeSeconds={setSecondsPerStretch}
          />
        )}

        {phase === 'complete' && result && (
          <CompleteScreen
            riskBefore={riskScore}
            applied={result.applied}
            capped={result.capped}
            completedParts={selectedParts.length - skippedParts.length}
            totalSeconds={result.totalSec}
            onHome={handleHome}
          />
        )}
      </SafeAreaView>
    </View>
  )
}

const ms = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
    backgroundColor: '#ffffff',
  },
  backBtn:     { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#111827', fontSize: 16, fontWeight: '800' },
})

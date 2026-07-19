import React, { useEffect, useRef } from 'react'
import { Animated, Dimensions, StyleSheet, Text, View } from 'react-native'
import { G, Line, Path, Svg, Text as SvgText } from 'react-native-svg'
import type { ChartDataPoint } from '../types'

interface Props {
  data: ChartDataPoint[]
  title: string
  color?: string
  unit?: string
  isLoading?: boolean
  /** 表示する最大データ点数（既定7）。全期間表示など、より長い期間を見せたい画面用 */
  maxPoints?: number
  /** X軸ラベルに年を含める（複数年をまたぐ全期間表示向け） */
  showYear?: boolean
}

const SCREEN_WIDTH = Dimensions.get('window').width
const CHART_WIDTH = SCREEN_WIDTH - 64   // カード padding 分
const CHART_HEIGHT = 160
const PAD = { top: 12, bottom: 32, left: 44, right: 12 }
const INNER_W = CHART_WIDTH - PAD.left - PAD.right
const INNER_H = CHART_HEIGHT - PAD.top - PAD.bottom

// ─── スケルトン ───────────────────────────────────────────────────────
function SkeletonRect() {
  const opacity = useRef(new Animated.Value(0.3)).current
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [opacity])
  return <Animated.View style={[styles.skeleton, { opacity }]} />
}

// ─── 日付フォーマット ──────────────────────────────────────────────────
function fmtDate(dateStr: string, showYear = false): string {
  const d = new Date(dateStr)
  if (showYear) return `${d.getFullYear()}/${d.getMonth() + 1}`
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}`
}

// ─── Y 軸ティック（最大4本）────────────────────────────────────────────
function yTicks(min: number, max: number): number[] {
  const range = max - min || 1
  const step = Math.ceil(range / 3 / 10) * 10 || Math.ceil(range / 3) || 1
  const start = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step; v += step) {
    if (ticks.length >= 5) break
    ticks.push(v)
  }
  return ticks
}

// ─── SVG 折れ線グラフ ─────────────────────────────────────────────────
function LineChart({ points, color }: { points: { x: number; y: number }[]; color: string }) {
  if (points.length < 2) return null

  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ')

  return (
    <>
      {/* グリッドドット */}
      {points.map((p, i) => (
        <G key={i}>
          <Line
            x1={p.x} y1={0} x2={p.x} y2={INNER_H}
            stroke="#1e1e1e" strokeWidth={1} strokeDasharray="3,3"
          />
        </G>
      ))}
      {/* 折れ線 */}
      <Path d={d} stroke={color} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {/* データポイント */}
      {points.map((p, i) => (
        <G key={`dot-${i}`}>
          <Line x1={p.x} y1={p.y} x2={p.x} y2={p.y} stroke={color} strokeWidth={6} strokeLinecap="round" />
          <Line x1={p.x} y1={p.y} x2={p.x} y2={p.y} stroke="#000" strokeWidth={2.5} strokeLinecap="round" />
        </G>
      ))}
    </>
  )
}

// ─── メインコンポーネント ─────────────────────────────────────────────
const TrainingChart: React.FC<Props> = ({
  data,
  title,
  color = '#E53E3E',
  unit = '',
  isLoading = false,
  maxPoints = 7,
  showYear = false,
}) => {
  const chartData = data.slice(-maxPoints)

  const values = chartData.map(p => p.value)
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)
  const range = maxVal - minVal || 1

  // ピクセル座標に変換
  const pts = chartData.map((p, i) => ({
    x: chartData.length === 1 ? INNER_W / 2 : (i / (chartData.length - 1)) * INNER_W,
    y: INNER_H - ((p.value - minVal) / range) * INNER_H,
  }))

  const ticks = yTicks(minVal, maxVal)

  return (
    <View>
      {/* タイトル */}
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>

      {isLoading ? (
        <SkeletonRect />
      ) : chartData.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>データがありません</Text>
        </View>
      ) : (
        <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
          <G x={PAD.left} y={PAD.top}>

            {/* Y軸グリッド & ラベル */}
            {ticks.map(v => {
              const py = INNER_H - ((v - minVal) / range) * INNER_H
              if (py < -2 || py > INNER_H + 2) return null
              return (
                <G key={v}>
                  <Line x1={0} y1={py} x2={INNER_W} y2={py} stroke="#2a2a2a" strokeWidth={1} />
                  <SvgText
                    x={-6} y={py + 4}
                    fontSize={10} fill="#666" textAnchor="end"
                  >
                    {Number.isInteger(v) ? v : v.toFixed(1)}
                  </SvgText>
                </G>
              )
            })}

            {/* X軸ベースライン */}
            <Line x1={0} y1={INNER_H} x2={INNER_W} y2={INNER_H} stroke="#2a2a2a" strokeWidth={1} />

            {/* X軸ラベル */}
            {chartData.map((p, i) => {
              const px = chartData.length === 1 ? INNER_W / 2 : (i / (chartData.length - 1)) * INNER_W
              const show = chartData.length <= 4 || i % Math.ceil(chartData.length / 4) === 0 || i === chartData.length - 1
              if (!show) return null
              return (
                <SvgText
                  key={i}
                  x={px} y={INNER_H + 18}
                  fontSize={10} fill="#666" textAnchor="middle"
                >
                  {fmtDate(p.date, showYear)}
                </SvgText>
              )
            })}

            {/* 折れ線 */}
            <LineChart points={pts} color={color} />

            {/* 最新値バッジ */}
            {pts.length > 0 && (
              <SvgText
                x={pts[pts.length - 1].x}
                y={pts[pts.length - 1].y - 10}
                fontSize={11} fill={color} textAnchor="middle" fontWeight="bold"
              >
                {values[values.length - 1]}
              </SvgText>
            )}
          </G>
        </Svg>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
    gap: 6,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  unit: {
    color: '#666',
    fontSize: 12,
  },
  skeleton: {
    height: CHART_HEIGHT,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
  },
  empty: {
    height: CHART_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#555',
    fontSize: 14,
  },
})

export default TrainingChart

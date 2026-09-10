// components/TypewriterText.tsx — 1文字ずつ表示するタイピング風アニメーション
// CountUpText.tsx と同じ思想（軽量・自己完結・triggerKeyで再実行）。
import React, { useEffect, useState } from 'react'
import { Text, TextStyle } from 'react-native'

interface TypewriterTextProps {
  text: string
  speed?: number        // 1文字あたりms（デフォルト26）
  delay?: number        // 開始までの待ちms（デフォルト0）
  style?: TextStyle
  triggerKey?: any       // この値が変わるとアニメ再実行
}

export default function TypewriterText({ text, speed = 26, delay = 0, style, triggerKey }: TypewriterTextProps) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const chars = Array.from(text)
    setCount(0)
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    function step(i: number) {
      if (cancelled) return
      setCount(i)
      if (i < chars.length) timer = setTimeout(() => step(i + 1), speed)
    }

    const startTimer = setTimeout(() => step(1), delay)
    return () => { cancelled = true; clearTimeout(startTimer); clearTimeout(timer) }
  }, [text, triggerKey, speed, delay])

  const visible = Array.from(text).slice(0, count).join('')
  return <Text style={style}>{visible}</Text>
}

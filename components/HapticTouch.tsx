// components/HapticTouch.tsx
// TouchableOpacity の drop-in 代替 — 全ボタンに自動でハプティクス+効果音
import React, { useCallback } from 'react'
import { TouchableOpacity, TouchableOpacityProps, GestureResponderEvent } from 'react-native'
import { Sounds } from '../lib/sounds'

export type HapticStyle =
  | 'tap'       // 汎用タップ（デフォルト）
  | 'pop'       // セレクト・切り替え
  | 'whoosh'    // モーダル・ページ遷移
  | 'save'      // 保存・完了
  | 'delete'    // 削除
  | 'tabSwitch' // タブ切り替え
  | 'toggleOn'  // トグルON
  | 'toggleOff' // トグルOFF
  | 'ding'      // カウント完了

interface HapticTouchProps extends TouchableOpacityProps {
  haptic?: HapticStyle
}

const HapticTouch = React.memo(function HapticTouch({
  onPress,
  haptic = 'tap',
  ...rest
}: HapticTouchProps) {
  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      Sounds[haptic]?.()
      onPress?.(e)
    },
    [onPress, haptic],
  )

  return (
    <TouchableOpacity
      {...rest}
      onPress={onPress ? handlePress : undefined}
    />
  )
})

export default HapticTouch

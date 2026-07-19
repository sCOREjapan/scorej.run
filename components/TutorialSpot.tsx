// components/TutorialSpot.tsx — チュートリアルでハイライトしたい要素をラップするだけ
import React, { useCallback, useRef } from 'react'
import { View, type ViewProps } from 'react-native'
import { useTutorial } from '../lib/tutorialContext'
import { type TutorialSpotKey } from '../lib/tutorial'

interface Props extends ViewProps {
  spotKey: TutorialSpotKey
  children: React.ReactNode
  padding?: number
}

export default function TutorialSpot({ spotKey, children, padding = 8, style, ...rest }: Props) {
  const ref = useRef<View>(null)
  const { registerSpot } = useTutorial()

  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width === 0 && height === 0) return
      registerSpot(spotKey, {
        x: x - padding,
        y: y - padding,
        width:  width  + padding * 2,
        height: height + padding * 2,
      })
    })
  }, [spotKey, padding, registerSpot])

  return (
    <View ref={ref} onLayout={onLayout} style={style} collapsable={false} {...rest}>
      {children}
    </View>
  )
}

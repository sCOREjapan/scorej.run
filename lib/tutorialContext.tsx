// lib/tutorialContext.tsx — チュートリアル状態管理
import React, { createContext, useCallback, useContext, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { type TutorialStepId, type TutorialSpotKey, TUTORIAL_ORDER } from './tutorial'

const TUTORIAL_DONE_KEY = 'trackmate_tutorial_done'

interface SpotRect { x: number; y: number; width: number; height: number }

interface TutorialContextValue {
  active: boolean
  stepId: TutorialStepId | null
  spots: Map<TutorialSpotKey, SpotRect>
  registerSpot: (key: TutorialSpotKey, rect: SpotRect) => void
  startTutorial: () => void
  nextStep: () => void
  skipTutorial: () => void
  // モーダルが閉じたとき condition_modal ステップを自動進行させるために使う
  onConditionModalClose: () => void
}

const Ctx = createContext<TutorialContextValue>({
  active: false,
  stepId: null,
  spots: new Map(),
  registerSpot: () => {},
  startTutorial: () => {},
  nextStep: () => {},
  skipTutorial: () => {},
  onConditionModalClose: () => {},
})

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const [active,  setActive]  = useState(false)
  const [stepId,  setStepId]  = useState<TutorialStepId | null>(null)
  const spots = useRef(new Map<TutorialSpotKey, SpotRect>()).current

  const advance = useCallback((id: TutorialStepId) => {
    const idx   = TUTORIAL_ORDER.indexOf(id)
    const next  = TUTORIAL_ORDER[idx + 1] ?? null
    if (!next) {
      setActive(false)
      setStepId(null)
      AsyncStorage.setItem(TUTORIAL_DONE_KEY, '1').catch(() => {})
    } else {
      setStepId(next)
    }
  }, [])

  const startTutorial = useCallback(() => {
    setStepId('welcome')
    setActive(true)
  }, [])

  const nextStep = useCallback(() => {
    if (!stepId) return
    advance(stepId)
  }, [stepId, advance])

  const skipTutorial = useCallback(() => {
    setActive(false)
    setStepId(null)
    AsyncStorage.setItem(TUTORIAL_DONE_KEY, '1').catch(() => {})
  }, [])

  const registerSpot = useCallback((key: TutorialSpotKey, rect: SpotRect) => {
    spots.set(key, rect)
  }, [spots])

  // QuickConditionModal が閉じた = 保存完了とみなして進行
  const onConditionModalClose = useCallback(() => {
    if (stepId === 'condition_modal') advance('condition_modal')
  }, [stepId, advance])

  return (
    <Ctx.Provider value={{ active, stepId, spots, registerSpot, startTutorial, nextStep, skipTutorial, onConditionModalClose }}>
      {children}
    </Ctx.Provider>
  )
}

export function useTutorial() { return useContext(Ctx) }

export async function isTutorialDone(): Promise<boolean> {
  const v = await AsyncStorage.getItem(TUTORIAL_DONE_KEY).catch(() => null)
  return v === '1'
}

// lib/usePaywall.ts
// ペイウォールロジックを一括管理するカスタムフック
// 使い方: const { paywallProps, checkFeature } = usePaywall('ai-diagnosis')
import { useState, useCallback, useRef } from 'react'
import { checkAdGate, recordUsage } from './adGate'

interface PaywallState {
  visible: boolean
  remaining: number
  featureName: string
}

interface UsePaywallResult {
  paywallProps: {
    visible: boolean
    remaining: number
    featureName: string
    onClose: () => void
    onUpgrade: () => void
    onWatchAd?: () => void
  }
  // checkFeature: gateを通過したらonAllowedを実行
  checkFeature: (userId: string, onAllowed: () => void | Promise<void>) => Promise<void>
  closePaywall: () => void
}

export function usePaywall(
  featureKey: string,
  featureName: string = 'この機能',
  onUpgrade?: () => void
): UsePaywallResult {
  const [state, setState] = useState<PaywallState>({
    visible: false,
    remaining: 0,
    featureName,
  })

  // 残り1回警告の後に実行する pending action を保持
  const pendingAction = useRef<(() => void | Promise<void>) | null>(null)

  const closePaywall = useCallback(() => {
    setState(s => ({ ...s, visible: false }))
    pendingAction.current = null
  }, [])

  const checkFeature = useCallback(async (
    userId: string,
    onAllowed: () => void | Promise<void>
  ) => {
    if (!userId || userId.startsWith('guest_') || userId === 'guest') {
      // ゲストはAI機能使用不可 — LoginGate側で処理されるが念のため
      return
    }

    const result = await checkAdGate(featureKey as any)
    const remaining: number = (result as any).remaining ?? 0

    if (remaining === 0) {
      // 使い切り → ソフトペイウォール表示
      setState({ visible: true, remaining: 0, featureName })
      return
    }

    if (remaining === 1) {
      // 残り1回 → 警告を表示しつつ実行は許可
      pendingAction.current = onAllowed
      setState({ visible: true, remaining: 1, featureName })
      await recordUsage(featureKey as any)
      await onAllowed()
      return
    }

    // 十分な残り回数 → そのまま実行
    await recordUsage(featureKey as any)
    await onAllowed()
  }, [featureKey, featureName])

  const handleUpgrade = useCallback(() => {
    setState(s => ({ ...s, visible: false }))
    if (onUpgrade) onUpgrade()
    // TODO: プレミアム購入画面へ遷移
    // router.push('/premium')
  }, [onUpgrade])

  return {
    paywallProps: {
      visible: state.visible,
      remaining: state.remaining,
      featureName: state.featureName,
      onClose: closePaywall,
      onUpgrade: handleUpgrade,
    },
    checkFeature,
    closePaywall,
  }
}

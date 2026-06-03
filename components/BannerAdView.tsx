// components/BannerAdView.tsx
// Webでは何も表示しない。ネイティブのみBannerAdをレンダリングする。
import React from 'react'
import { Platform, View } from 'react-native'

interface Props {
  onLoaded?:  () => void
  onFailed?:  () => void
}

// Expo Go 判定（ネイティブモジュール不在環境）
let _isExpoGo = false
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Constants = require('expo-constants').default
  _isExpoGo = Constants?.appOwnership === 'expo'
    || Constants?.executionEnvironment === 'storeClient'
} catch {}

export default function BannerAdView({ onLoaded, onFailed }: Props) {
  // Web/Expo Go ではAdMob ネイティブモジュールが存在しないためスキップ
  if (Platform.OS === 'web' || _isExpoGo) return null

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BannerAd, BannerAdSize } = require('react-native-google-mobile-ads')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getBannerUnitId } = require('../lib/admob')

    return (
      <BannerAd
        unitId={getBannerUnitId()}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdLoaded={(_dimensions: any) => onLoaded?.()}
        onAdFailedToLoad={(error: any) => {
          console.warn('[BannerAd] failed to load:', error)
          onFailed?.()
        }}
      />
    )
  } catch {
    return <View />
  }
}

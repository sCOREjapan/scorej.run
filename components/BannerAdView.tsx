// components/BannerAdView.tsx
// Webでは何も表示しない。ネイティブのみBannerAdをレンダリングする。
import React from 'react'
import { Platform, View } from 'react-native'

interface Props {
  onLoaded?:  () => void
  onFailed?:  () => void
}

export default function BannerAdView({ onLoaded, onFailed }: Props) {
  // Web環境ではgoogle-mobile-adsが存在しないため何も表示しない
  if (Platform.OS === 'web') return null

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
        onAdLoaded={onLoaded}
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

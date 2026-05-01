/**
 * AdBanner.tsx — バナー広告コンポーネント
 *
 * - プレミアムユーザーには表示しない
 * - Web では表示しない（AdMob は native のみ）
 * - Expo Go など AdMob が使えない環境ではフォールバック表示
 */

import React, { useState, useEffect } from 'react'
import { View, Text, Platform, StyleSheet } from 'react-native'
import { isPremium } from '../lib/subscription'
import { getBannerUnitId } from '../lib/admob'

// BannerAd は native のみ存在する → 動的 require
function tryGetBannerAd() {
  if (Platform.OS === 'web') return null
  try {
    const lib = require('react-native-google-mobile-ads')
    return { BannerAd: lib.BannerAd, BannerAdSize: lib.BannerAdSize }
  } catch {
    return null
  }
}

export default function AdBanner() {
  const [premium, setPremium] = useState(true) // 初期値 true = 非表示（ちらつき防止）
  const [adFailed, setAdFailed] = useState(false)

  useEffect(() => {
    isPremium().then(p => setPremium(p))
  }, [])

  // プレミアムユーザー or Web は何も表示しない
  if (premium || Platform.OS === 'web') return null

  const nativeAds = tryGetBannerAd()

  // AdMob モジュールが使えない環境（Expo Go等）は何も表示しない
  if (!nativeAds || adFailed) return null

  const { BannerAd, BannerAdSize } = nativeAds

  return (
    <View style={styles.wrapper}>
      <BannerAd
        unitId={getBannerUnitId()}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdFailedToLoad={() => setAdFailed(true)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    paddingBottom: 2,
  },
})

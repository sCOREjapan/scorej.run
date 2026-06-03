// app/coupon.tsx — クーポン機能は廃止（App Store ガイドライン 3.1.1 のため）
// ルートは残すが即ホームへリダイレクト
import React, { useEffect } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'

export default function CouponScreen() {
  const router = useRouter()
  useEffect(() => { router.replace('/(tabs)') }, [])
  return <View />
}

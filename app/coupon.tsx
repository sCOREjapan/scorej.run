// app/coupon.tsx — クーポン機能廃止（ルートは残すが空ページ）
import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useEffect } from 'react'

export default function CouponScreen() {
  const router = useRouter()
  useEffect(() => { router.replace('/(tabs)') }, [])
  return <View />
}

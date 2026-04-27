import React, { useRef, useState } from 'react'
import { Animated, TouchableOpacity, Platform, View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native'
import { Tabs, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Sounds, unlockAudio } from '../../lib/sounds'
import { triggerHomeScroll } from '../../lib/homeScroll'
import { BRAND } from '../../lib/theme'
import { triggerQuickLog } from '../../lib/quickLogEvent'

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']

function tabIcon(name: IoniconsName, focusedName: IoniconsName) {
  return ({ color, focused }: { color: string; focused: boolean }) => (
    <Ionicons name={focused ? focusedName : name} size={24} color={color} />
  )
}

function AnimatedTabButton({ children, onPress, accessibilityState, style }: any) {
  const scale = useRef(new Animated.Value(1)).current
  const handlePress = () => {
    unlockAudio()
    if (Platform.OS === 'web') Sounds.tabSwitch()
    Animated.sequence([
      Animated.spring(scale, { toValue: 0.80, useNativeDriver: true, tension: 500, friction: 8 }),
      Animated.spring(scale, { toValue: 1,    useNativeDriver: true, tension: 180, friction: 6 }),
    ]).start()
    onPress?.()
  }
  return (
    <TouchableOpacity
      onPress={handlePress}
      style={[{ flex: 1, alignItems: 'center', justifyContent: 'center' }, style]}
      activeOpacity={1}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {children}
      </Animated.View>
    </TouchableOpacity>
  )
}

// ── ラジアルFABアイテム定義（4種類のログ入力）──
const RADIAL_ITEMS = [
  { icon: '🏃', label: '練習記録', angle: -150, route: '/practice-input', action: 'practice' },
  { icon: '⏱️', label: 'タイム記録', angle: -110, route: '/timer',          action: 'timer'    },
  { icon: '😴', label: '睡眠記録', angle: -70,  route: '/(tabs)/sleep',    action: 'sleep'    },
  { icon: '🍽️', label: '食事記録', angle: -30,  route: '/(tabs)/nutrition',action: 'nutrition'},
] as const

const RADIUS = 110   // アイテム円の重なりを防ぐ十分な半径

function RadialFAB({ bottomOffset }: { bottomOffset: number }) {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const [open, setOpen] = useState(false)
  const anim   = useRef(new Animated.Value(0)).current
  const rotate = useRef(new Animated.Value(0)).current

  // FABボタンの中心座標（絶対位置）
  const fabCenterX = width / 2          // 画面中央
  const fabCenterY = bottomOffset + 35  // タブバー上端 + FABの半分

  function toggle() {
    unlockAudio()
    Sounds.whoosh()
    const toValue = open ? 0 : 1
    setOpen(!open)
    Animated.parallel([
      Animated.spring(anim,   { toValue, useNativeDriver: false, tension: 200, friction: 10 }),
      Animated.spring(rotate, { toValue, useNativeDriver: true,  tension: 200, friction: 10 }),
    ]).start()
  }

  function handleItem(action: string, route: string | null) {
    toggle()
    setTimeout(() => {
      if (route) router.push(route as any)
    }, 120)
  }

  const spin = rotate.interpolate({ inputRange: [0,1], outputRange: ['0deg','45deg'] })

  return (
    <>
      {/* オーバーレイ（背景タップで閉じる） */}
      {open && (
        <Pressable
          onPress={toggle}
          style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 90 }]}
        />
      )}

      {/* ラジアルアイテム（各アイテムをFAB中心から left/bottom で直接配置） */}
      {RADIAL_ITEMS.map((item) => {
        const rad = (item.angle * Math.PI) / 180
        const targetX = Math.cos(rad) * RADIUS   // FAB中心からの水平オフセット
        const targetY = Math.sin(rad) * RADIUS   // FAB中心からの垂直オフセット（負=上）

        const ITEM_W   = 72
        const baseLeft = fabCenterX - ITEM_W / 2
        const baseBottom = fabCenterY - 26   // 26 = アイテム円の半径

        const left   = anim.interpolate({ inputRange: [0,1], outputRange: [baseLeft, baseLeft + targetX] })
        const bottom = anim.interpolate({ inputRange: [0,1], outputRange: [baseBottom, baseBottom + (-targetY)] })
        const opacity = anim.interpolate({ inputRange: [0,0.4,1], outputRange: [0,0,1] })
        const scale   = anim.interpolate({ inputRange: [0,1], outputRange: [0.4,1] })

        return (
          <Animated.View
            key={item.label}
            style={[
              fab.itemWrap,
              { left, bottom, width: ITEM_W, zIndex: 95 },
              { opacity, transform: [{ scale }] },
            ]}
          >
            <TouchableOpacity onPress={() => handleItem(item.action, item.route)} style={fab.item} activeOpacity={0.85}>
              <Text style={{ fontSize: 20 }}>{item.icon}</Text>
            </TouchableOpacity>
            <Text style={fab.itemLabel} numberOfLines={1}>{item.label}</Text>
          </Animated.View>
        )
      })}

      {/* 中央FABボタン */}
      <TouchableOpacity
        onPress={toggle}
        style={[fab.btn, { bottom: bottomOffset + 8, left: fabCenterX - 27, zIndex: 100 }]}
        activeOpacity={0.9}
      >
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <Ionicons name="add" size={28} color="#fff" />
        </Animated.View>
      </TouchableOpacity>
    </>
  )
}

function HomeButton({ bottomOffset }: { bottomOffset: number }) {
  const router = useRouter()
  return (
    <TouchableOpacity
      onPress={() => { unlockAudio(); Sounds.tap(); router.push('/(tabs)/' as any) }}
      style={[fab.homeBtn, { bottom: bottomOffset + 8 }]}
      activeOpacity={0.85}
    >
      <Ionicons name="home" size={22} color="#6b7280" />
    </TouchableOpacity>
  )
}

const fab = StyleSheet.create({
  btn: {
    position: 'absolute',
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: BRAND, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 10,
  },
  itemWrap: {
    position: 'absolute',
    alignItems: 'center',
    gap: 3,
  },
  item: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#ffffff',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.10)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 8, elevation: 6,
  },
  homeBtn: {
    position: 'absolute',
    left: 20,
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: '#ffffff',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.10)',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 100,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 8, elevation: 8,
  },
  itemLabel: {
    color: '#111827', fontSize: 9, fontWeight: '700',
  },
})

// ── メインレイアウト ─────────────────────────────────────
export default function TabLayout() {
  const insets = useSafeAreaInsets()
  const fabBottomOffset = Math.max(insets.bottom, 16)

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          tabBarStyle: { display: 'none' },
          headerStyle: { backgroundColor: '#ffffff' },
          headerTintColor: '#111827',
          headerTitleStyle: { color: '#111827', fontWeight: '800', letterSpacing: -0.3 },
        }}
      >
        {/* ── 左端: ホーム ── */}
        <Tabs.Screen
          name="index"
          listeners={({ navigation }) => ({
            tabPress: () => { if (navigation.isFocused()) triggerHomeScroll() },
          })}
          options={{
            title: 'ホーム',
            tabBarIcon: tabIcon('home-outline', 'home'),
            headerShown: false,
          }}
        />

        {/* ── 左中: チーム ── */}
        <Tabs.Screen
          name="team"
          options={{
            title: 'チーム',
            tabBarIcon: tabIcon('people-outline', 'people'),
            headerShown: false,
          }}
        />

        {/* ── 右中: 進捗 ── */}
        <Tabs.Screen
          name="records"
          options={{
            title: '進捗',
            tabBarIcon: tabIcon('stats-chart-outline', 'stats-chart'),
            headerShown: false,
          }}
        />

        {/* ── 右端: 設定 ── */}
        <Tabs.Screen
          name="mypage"
          options={{
            title: '設定',
            tabBarIcon: tabIcon('person-circle-outline', 'person-circle'),
            headerShown: false,
          }}
        />

        {/* ── 非表示タブ（ルートとしては有効） ── */}
        {(['notebook','calendar','competition','sleep','nutrition'] as const).map(name => (
          <Tabs.Screen
            key={name}
            name={name}
            options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' }, headerShown: false }}
          />
        ))}
      </Tabs>

      {/* ── ホームボタン（左下） ── */}
      <HomeButton bottomOffset={fabBottomOffset} />

      {/* ── ラジアルFAB（全タブ共通オーバーレイ） ── */}
      <RadialFAB bottomOffset={fabBottomOffset} />
    </View>
  )
}

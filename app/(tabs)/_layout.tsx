import React, { useRef, useState, useEffect } from 'react'
import { Animated, TouchableOpacity, Platform, View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native'
import { Tabs, useRouter, usePathname } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Sounds, unlockAudio } from '../../lib/sounds'
import { triggerHomeScroll } from '../../lib/homeScroll'
import { BRAND } from '../../lib/theme'
import { triggerQuickLog } from '../../lib/quickLogEvent'
import { initNotificationsOnFirstLaunch } from '../../lib/notifications'

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

// ── W3スタイル カスタムタブバー ────────────────────────
type TabItem = {
  route: string
  label: string
  icon: React.ComponentProps<typeof Ionicons>['name']
  iconFocused: React.ComponentProps<typeof Ionicons>['name']
  action?: 'home-scroll' | 'quick-log'
}

const TAB_ITEMS: TabItem[] = [
  { route: '/(tabs)/',        label: 'ホーム', icon: 'home-outline',        iconFocused: 'home',        action: 'home-scroll' },
  { route: '/(tabs)/records', label: '記録',   icon: 'stats-chart-outline', iconFocused: 'stats-chart' },
  { route: '/(tabs)/team',    label: 'チーム', icon: 'people-outline',      iconFocused: 'people'      },
  { route: '/(tabs)/mypage',  label: '設定',   icon: 'person-outline',      iconFocused: 'person'      },
]

function CustomTabBar({ bottomInset }: { bottomInset: number }) {
  const router   = useRouter()
  const pathname = usePathname()

  function isActive(route: string) {
    if (route === '/(tabs)/') return pathname === '/' || pathname === '/(tabs)' || pathname === '/(tabs)/'
    return pathname.startsWith(route.replace('/(tabs)', ''))
  }

  return (
    <View style={[tb.container, { paddingBottom: Math.max(bottomInset, 8) }]}>
      {TAB_ITEMS.map(tab => {
        const active = tab.route ? isActive(tab.route) : false
        return (
          <TouchableOpacity
            key={tab.label}
            style={tb.item}
            activeOpacity={0.7}
            onPress={() => {
              unlockAudio()
              Sounds.tap()
              if (tab.action === 'home-scroll') {
                if (active) { triggerHomeScroll(); return }
                router.push('/(tabs)/' as any)
              } else if (tab.action === 'quick-log') {
                triggerQuickLog()
              } else if (tab.route) {
                router.push(tab.route as any)
              }
            }}
          >
            <View style={[tb.iconWrap, active && tb.iconWrapActive]}>
              <Ionicons
                name={active ? tab.iconFocused : tab.icon}
                size={22}
                color={active ? '#fff' : '#9ca3af'}
              />
            </View>
            <Text style={[tb.label, active && tb.labelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const tb = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  item:          { flex: 1, alignItems: 'center', gap: 3 },
  iconWrap:      { width: 40, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconWrapActive:{ backgroundColor: BRAND },
  label:         { fontSize: 10, fontWeight: '600', color: '#9ca3af' },
  labelActive:   { color: BRAND, fontWeight: '700' },
})

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
  const insets   = useSafeAreaInsets()
  const pathname = usePathname()
  const fabBottomOffset = Math.max(insets.bottom, 16) + 56  // タブバー高さ分オフセット
  const hideFab  = pathname === '/team' || pathname === '/(tabs)/team'

  // 初回起動時に通知 → 位置情報の順で許可ダイアログを表示
  useEffect(() => {
    const run = async () => {
      // 1) 通知許可（2秒後に表示）
      await initNotificationsOnFirstLaunch().catch(() => {})

      // 2) 位置情報許可（通知ダイアログ後、間を置いて表示）
      const LOC_ASKED_KEY = 'score_location_asked'
      if (typeof window === 'undefined') return
      if (typeof navigator === 'undefined' || !navigator.geolocation) return
      const alreadyAsked = localStorage.getItem(LOC_ASKED_KEY)
      if (alreadyAsked) return

      // geolocation の許可状態を確認
      if (navigator.permissions) {
        try {
          const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
          if (status.state !== 'prompt') return  // 既に決まっていれば聞かない
        } catch {}
      }

      // 通知ダイアログとの間に 1.5 秒空ける
      await new Promise(r => setTimeout(r, 1500))
      localStorage.setItem(LOC_ASKED_KEY, '1')

      // iOS ネイティブの位置情報許可ダイアログを表示
      navigator.geolocation.getCurrentPosition(
        () => {},   // 許可された
        () => {},   // 拒否された（どちらでも OK）
        { enableHighAccuracy: false, timeout: 10000 }
      )
    }
    run()
  }, [])

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
        <Tabs.Screen name="index"       options={{ headerShown: false }} />
        <Tabs.Screen name="team"        options={{ headerShown: false }} />
        <Tabs.Screen name="records"     options={{ headerShown: false }} />
        <Tabs.Screen name="mypage"      options={{ headerShown: false }} />
        {(['notebook','calendar','competition','sleep','nutrition'] as const).map(name => (
          <Tabs.Screen key={name} name={name} options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' }, headerShown: false }} />
        ))}
      </Tabs>

      {/* ── W3 カスタムタブバー ── */}
      <CustomTabBar bottomInset={insets.bottom} />

      {/* ── ラジアルFAB（チーム画面では非表示） ── */}
      {!hideFab && <RadialFAB bottomOffset={fabBottomOffset} />}
    </View>
  )
}

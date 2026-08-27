import React, { useRef, useState, useEffect } from 'react'
import { Animated, TouchableOpacity, Platform, View, Text, StyleSheet, Pressable, useWindowDimensions, Modal, Linking } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import BannerAdView from '../../components/BannerAdView'
import { usePurchase } from '../../context/PurchaseContext'
import { Tabs, useRouter, usePathname } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Sounds, unlockAudio, preloadNativeSounds, loadSoundPrefs } from '../../lib/sounds'
import { triggerHomeScroll } from '../../lib/homeScroll'
import { BRAND } from '../../lib/theme'
import { triggerQuickLog } from '../../lib/quickLogEvent'
import { initNotificationsOnFirstLaunch } from '../../lib/notifications'
import { todayLocalISO } from '../../lib/dateLocal'
import { getTicketBalance } from '../../lib/ticketWallet'

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
const RADIAL_ITEMS: { icon: IoniconsName; label: string; angle: number; route: string; action: string }[] = [
  { icon: 'barbell-outline',  label: '練習記録', angle: -150, route: '/practice-input', action: 'practice' },
  { icon: 'stopwatch-outline',label: 'タイム記録', angle: -110, route: '/timer',          action: 'timer'    },
  { icon: 'moon-outline',     label: '睡眠記録', angle: -70,  route: '/(tabs)/sleep',    action: 'sleep'    },
  { icon: 'medkit-outline',   label: 'リカバリー', angle: -30,  route: '/recovery',        action: 'recovery' },
]

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
              <Ionicons name={item.icon} size={22} color={BRAND} />
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

function CustomTabBar({ bottomInset, ticketBalance }: { bottomInset: number; ticketBalance: number | null }) {
  const router   = useRouter()
  const pathname = usePathname()

  function isActive(route: string) {
    if (route === '/(tabs)/') return pathname === '/' || pathname === '/(tabs)' || pathname === '/(tabs)/'
    return pathname.startsWith(route.replace('/(tabs)', ''))
  }

  return (
    <View style={[tb.container, { paddingBottom: Math.max(bottomInset, 8) }]}>
      {ticketBalance !== null && (
        <TouchableOpacity
          style={tb.ticketBadge}
          onPress={() => { unlockAudio(); Sounds.tap(); router.push('/tickets' as any) }}
          activeOpacity={0.8}
        >
          <Text style={tb.ticketBadgeText}>🎫 {ticketBalance}</Text>
        </TouchableOpacity>
      )}
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
  ticketBadge: {
    position: 'absolute', top: -11, right: 14, zIndex: 10,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#ffffff', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 4,
  },
  ticketBadgeText: { fontSize: 11, fontWeight: '800', color: '#f59e0b' },
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
    borderWidth: 3, borderColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 12,
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
  itemLabel: {
    color: '#ffffff', fontSize: 9, fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
})

const BANNER_H = 72   // バナー広告の高さ見込み（適応バナー高さ+余白。FABが広告に重ならないようクリアランス確保）

// ── メインレイアウト ─────────────────────────────────────
export default function TabLayout() {
  const insets   = useSafeAreaInsets()
  const pathname = usePathname()
  const { isNoad, isCoach } = usePurchase()
  const showBanner = !isNoad   // 広告なしプラン以上はバナー非表示

  // ── タブバーのチケット残高バッジ（コーチプランは無制限のため非表示） ──
  // 以前は5秒間隔のポーリングに加え、タブ切り替え(pathname変化)のたびにも即座に
  // 再実行していたため、サーバー同期側に不具合があった際の被害が短時間で
  // 桁違いに拡大する一因になっていた（2026-08-27）。残高はチケットを実際に
  // 消費/付与する操作の直後にだけ変わるものなので、この画面滞在中は
  // 緩やかな間隔の背景更新だけで十分。タブ切り替えのたびの即時再実行はやめる。
  const [ticketBalance, setTicketBalance] = useState<number | null>(null)
  useEffect(() => {
    if (isCoach) { setTicketBalance(null); return }
    let cancelled = false
    const refresh = () => { getTicketBalance().then(n => { if (!cancelled) setTicketBalance(n) }).catch(() => {}) }
    refresh()
    const interval = setInterval(refresh, 30000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [isCoach])
  const [bannerLoaded, setBannerLoaded] = useState(false)
  // バナー表示中はFABをその分上にずらす
  // バナー表示中は常にその分FABを上にずらす（読み込み状態に依存させない＝広告に重ねない）
  const fabBottomOffset = Math.max(insets.bottom, 16) + 56 + (showBanner ? BANNER_H : 0)
  const hideFab  = pathname === '/team' || pathname === '/(tabs)/team'

  // ── アップデート案内モーダル（1.5週間に1回表示・App Storeへ誘導） ──
  const UPDATE_PROMO_KEY = 'score_update_promo_last_shown'
  const UPDATE_PROMO_INTERVAL_MS = 1.5 * 7 * 24 * 60 * 60 * 1000
  const APP_STORE_URL = 'https://apps.apple.com/jp/app/score/id6766394981'
  const [showUpdate, setShowUpdate] = useState(false)
  useEffect(() => {
    if (Platform.OS !== 'ios') return  // App Store誘導はiOSのみ
    AsyncStorage.getItem(UPDATE_PROMO_KEY)
      .then(v => {
        if (!v) { setShowUpdate(true); return }
        const last = new Date(v + 'T00:00:00').getTime()
        if (Date.now() - last >= UPDATE_PROMO_INTERVAL_MS) setShowUpdate(true)
      })
      .catch(() => {})
  }, [])
  const dismissUpdate = () => {
    AsyncStorage.setItem(UPDATE_PROMO_KEY, todayLocalISO()).catch(() => {})
    setShowUpdate(false)
  }
  const openAppStore = () => {
    Linking.openURL(APP_STORE_URL).catch(() => {})
    dismissUpdate()
  }

  // 初回起動時に通知 → 位置情報の順で許可ダイアログを表示
  useEffect(() => {
    const run = async () => {
      // 0) 効果音/バイブのON-OFF設定を読み込み → ネイティブ効果音を事前生成
      await loadSoundPrefs().catch(() => {})
      preloadNativeSounds().catch(() => {})

      // 1) 通知許可（2秒後に表示）
      await initNotificationsOnFirstLaunch().catch(() => {})

      // 2) 位置情報許可（通知ダイアログ後、間を置いて表示）
      // Web専用: native では expo-location (lib/weather.ts) が担当するので不要
      const LOC_ASKED_KEY = 'score_location_asked'
      if (Platform.OS !== 'web') return   // native は expo-location が処理
      if (typeof window === 'undefined') return
      if (typeof navigator === 'undefined' || !navigator.geolocation) return
      const alreadyAsked = typeof localStorage !== 'undefined' ? localStorage.getItem(LOC_ASKED_KEY) : '1'
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
      if (typeof localStorage !== 'undefined') localStorage.setItem(LOC_ASKED_KEY, '1')

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

      {/* ── バナー広告（タブバー直上、フリープランのみ・ネイティブのみ） ── */}
      {showBanner && (
        <BannerAdView
          onLoaded={() => setBannerLoaded(true)}
          onFailed={() => setBannerLoaded(false)}
        />
      )}

      {/* ── W3 カスタムタブバー ── */}
      <CustomTabBar bottomInset={insets.bottom} ticketBalance={ticketBalance} />

      {/* ── ラジアルFAB（チーム画面では非表示） ── */}
      {!hideFab && <RadialFAB bottomOffset={fabBottomOffset} />}

      {/* ── アップデート案内モーダル（1回だけ） ── */}
      <Modal visible={showUpdate} transparent animationType="fade" onRequestClose={dismissUpdate}>
        <View style={upd.overlay}>
          <View style={upd.card}>
            <Text style={upd.emoji}>🎉</Text>
            <Text style={upd.title}>アップデートがあります！</Text>
            <Text style={upd.body}>
              新機能・改善が追加されました。{'\n'}App Storeで最新版に更新してください。
            </Text>
            <TouchableOpacity style={upd.primaryBtn} onPress={openAppStore} activeOpacity={0.85}>
              <Text style={upd.primaryTxt}>App Storeを開く</Text>
            </TouchableOpacity>
            <TouchableOpacity style={upd.laterBtn} onPress={dismissUpdate} activeOpacity={0.7}>
              <Text style={upd.laterTxt}>あとで</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const upd = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  card:    { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 20, padding: 28, alignItems: 'center' },
  emoji:   { fontSize: 40, marginBottom: 8 },
  title:   { fontSize: 19, fontWeight: '800', color: '#111827', marginBottom: 10, textAlign: 'center' },
  body:    { fontSize: 14, color: '#6b7280', lineHeight: 21, textAlign: 'center', marginBottom: 22 },
  primaryBtn: { backgroundColor: BRAND, borderRadius: 14, paddingVertical: 14, alignItems: 'center', alignSelf: 'stretch' },
  primaryTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  laterBtn:   { paddingVertical: 12, alignItems: 'center', alignSelf: 'stretch', marginTop: 4 },
  laterTxt:   { color: '#9ca3af', fontSize: 14, fontWeight: '600' },
})

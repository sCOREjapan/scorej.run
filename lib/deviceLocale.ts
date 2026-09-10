// lib/deviceLocale.ts — 端末の言語設定を取得する（追加ネイティブ依存なし）
// expo-localizationを新規導入するとネイティブ再ビルドが必要になるため、
// React Native標準のNativeModulesから直接読む昔ながらの手法を使う。
import { NativeModules, Platform } from 'react-native'

export function getDeviceLocale(): string {
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings
      return settings?.AppleLocale || settings?.AppleLanguages?.[0] || 'en'
    }
    if (Platform.OS === 'android') {
      return NativeModules.I18nManager?.localeIdentifier || 'en'
    }
  } catch { /* noop */ }
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language
  return 'en'
}

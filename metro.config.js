// metro.config.js
// Expo SDK 54 — カスタム Metro 設定
// iOS 26 beta Hermes クラッシュ回避のためのポリフィル注入

const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)

// getPolyfills: 全モジュールのロード前に実行されるファイルを追加
// 標準の RN ポリフィルに続いて polyfills.js を実行する
const defaultGetPolyfills = config.serializer?.getPolyfills ?? (() => [])

config.serializer = {
  ...(config.serializer ?? {}),
  getPolyfills: function (options) {
    const defaults =
      typeof defaultGetPolyfills === 'function'
        ? defaultGetPolyfills(options)
        : []
    return [
      ...defaults,
      path.join(__dirname, 'polyfills.js'),
    ]
  },
}

module.exports = config

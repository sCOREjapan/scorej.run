// app.config.js
// react-native-purchases の config plugin は EAS (native) ビルド時のみ有効にする。
// web export 時に plugin 解決エラーが起きてビルドが失敗するため。
const IS_EAS = !!process.env.EAS_BUILD

module.exports = {
  expo: {
    name: 'sCORE',
    slug: 'score',
    version: '18',
    extra: {
      eas: { projectId: '17151d64-68e8-4831-b3a2-0bead72fa41e' },
      googleWebClientId: '918711129795-hskjq09k6e8gumt71ptmgkjepskmktf2.apps.googleusercontent.com',
      googleIosClientId: '918711129795-5lt5a8v4ud03iu2lg35olfits8rc78dg.apps.googleusercontent.com',
    },
    owner: 'score.japan',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    // image必須(Android): 未指定だとsplashscreen_logo drawableが生成されずgradleビルドが失敗する
    splash: { image: './assets/icon.png', resizeMode: 'contain', backgroundColor: '#0a0a0a' },
    ios: {
      supportsTablet: true,
      requiresFullScreen: true,
      bundleIdentifier: 'com.scorejapan.score',
      usesAppleSignIn: true,
      buildNumber: '39',
      infoPlist: {
        CFBundleURLTypes: [
          {
            CFBundleURLSchemes: [
              'com.googleusercontent.apps.918711129795-5lt5a8v4ud03iu2lg35olfits8rc78dg'
            ]
          }
        ],
        // iOS 14+ でのパーソナライズ広告に必要（ATT: App Tracking Transparency）
        NSUserTrackingUsageDescription:
          'パーソナライズされた広告を表示するために広告識別子を使用します。',
        // iOS 14+ でローカルネットワーク上の端末(開発時のMetroサーバー等)に接続するために必須。
        // これが無いと許可ダイアログ自体が出ず、"Local network prohibited"エラーで
        // 永久に接続がブロックされる（2026-08-27、Xcode実機デバッグ時に発覚）。
        NSLocalNetworkUsageDescription:
          '開発中のデバッグサーバーに接続するために使用します',
      }
    },
    android: {
      adaptiveIcon: { backgroundColor: '#0a0a0a' },
      package: 'com.scorejapan.score',
      versionCode: 7,
      googleServicesFile: './google-services.json',
    },
    plugins: [
      'expo-router',
      'expo-apple-authentication',
      // AdMob — 本番 App ID（変更すると起動クラッシュするため注意）
      // 形式: ca-app-pub-XXXXXXXX~YYYYYYYYYY
      ['react-native-google-mobile-ads', {
        iosAppId:     'ca-app-pub-6225795381877305~3874907264',
        androidAppId: 'ca-app-pub-6225795381877305~6309498919',
      }],
      ['expo-location', {
        locationAlwaysAndWhenInUsePermission: '天気情報と怪我リスク計算のために現在地を使用します',
        locationWhenInUsePermission: '天気情報と怪我リスク計算のために現在地を使用します',
      }],
      ['expo-camera', { cameraPermission: 'フォーム分析のためカメラを使用します' }],
      ['expo-image-picker', { photosPermission: '食事・動画を記録するために写真ライブラリを使用します' }],
      ['expo-notifications', {
        icon: './assets/icon.png',
        color: '#166534',
        sounds: [],
      }],
      ['expo-media-library', {
        photosPermission: 'シェアカードをカメラロールに保存するために写真ライブラリへのアクセスが必要です',
        savePhotosPermission: 'シェアカードをカメラロールに保存するために写真ライブラリへのアクセスが必要です',
        isAccessMediaLocationEnabled: false,
      }],
      // react-native-purchases: config plugin 不要（ios/Podfile で直接リンク済み）
    ],
    scheme: 'score',
    web: { bundler: 'metro', output: 'static', favicon: './assets/icon.png' },
    // react-native-purchases の autolinking 除外(iOS限定)は react-native.config.js に移動
    // (旧: ここでの exclude はプラットフォーム共通に効いてしまい、Android ビルドが壊れていた)
  },
}

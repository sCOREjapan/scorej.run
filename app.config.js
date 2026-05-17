// app.config.js
// react-native-purchases の config plugin は EAS (native) ビルド時のみ有効にする。
// web export 時に plugin 解決エラーが起きてビルドが失敗するため。
const IS_EAS = !!process.env.EAS_BUILD

module.exports = {
  expo: {
    name: 'sCORE',
    slug: 'score',
    version: '1.0.0',
    extra: {
      eas: { projectId: '17151d64-68e8-4831-b3a2-0bead72fa41e' },
      googleWebClientId: '918711129795-hskjq09k6e8gumt71ptmgkjepskmktf2.apps.googleusercontent.com',
      googleIosClientId: '918711129795-5lt5a8v4ud03iu2lg35olfits8rc78dg.apps.googleusercontent.com',
    },
    owner: 'score.japan',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    splash: { resizeMode: 'contain', backgroundColor: '#0a0a0a' },
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.scorejapan.score',
      usesAppleSignIn: true,
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
      }
    },
    android: { adaptiveIcon: { backgroundColor: '#0a0a0a' }, package: 'com.scorejapan.score' },
    plugins: [
      'expo-router',
      'expo-apple-authentication',
      // AdMob — App IDはAdMobダッシュボード > アプリ > [アプリ名] > アプリの設定 で確認
      // TODO: 下記の ADMOB_APP_ID_IOS / ANDROID を実際のApp IDに差し替える
      // 形式: ca-app-pub-XXXXXXXX~YYYYYYYYYY  (スラッシュではなくチルダ~)
      ['react-native-google-mobile-ads', {
        iosAppId:     'ca-app-pub-6225795381877305~3874907264',  // ✅ 本番 iOS App ID
        androidAppId: 'ca-app-pub-6225795381877305~6309498919',  // ✅ 本番 Android App ID
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
      // react-native-purchases: EAS (native) ビルド時のみ追加（web export では不要）
      ...(IS_EAS ? [['react-native-purchases', {}]] : []),
    ],
    scheme: 'score',
    web: { bundler: 'metro', output: 'static', favicon: './assets/icon.png' },
  },
}

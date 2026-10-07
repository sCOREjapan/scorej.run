// app.config.js
// react-native-purchases の config plugin は EAS (native) ビルド時のみ有効にする。
// web export 時に plugin 解決エラーが起きてビルドが失敗するため。
const IS_EAS = !!process.env.EAS_BUILD

module.exports = {
  expo: {
    name: 'sCORE',
    slug: 'score',
    version: '23',
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
      buildNumber: '70',
      appleTeamId: '4B5NK8DR67',
      entitlements: {
        'com.apple.security.application-groups': ['group.com.scorejapan.score'],
      },
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
      // 2026-10-07: 11→12。Google Play の「写真と動画の権限に関するポリシー」違反の是正版
      // (READ_MEDIA_IMAGES/READ_MEDIA_VIDEO を削除)を、製品版・テストの全トラックへ出し直すため。
      versionCode: 12,
      googleServicesFile: './google-services.json',
      // 写真・動画は Android のシステム写真選択ツール(権限不要)で選び、シェアカードは共有シートで
      // 保存するため、これらの権限は不要。ライブラリ(expo-media-library 等)のマニフェストに
      // 含まれていても最終的なマニフェストから確実に取り除く(lib/mediaPermissions.ts 参照)。
      blockedPermissions: [
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_MEDIA_AUDIO',
        'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
        // 広い保存領域の権限も不要（写真選択はシステムの選択ツール、保存は共有シート）。次の審査で
        // 再指摘されないよう、あわせて外す。
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ],
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
        // 2026-09-30: 実装はrequestForegroundPermissionsAsync()のみを使用し、
        // バックグラウンド位置情報(requestBackgroundPermissionsAsync)は一切呼んでいない
        // （プライバシーポリシー第9条2項もその旨を明記）。実際には機能しない「常に許可」を
        // Info.plistに含めると不要な誤解を招くため、使用中のみの許可だけを設定する。
        locationWhenInUsePermission: '天気情報と怪我リスク計算のために現在地を使用します',
      }],
      ['expo-camera', { cameraPermission: 'フォーム分析・食事記録の写真撮影のためカメラを使用します' }],
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
      '@bacons/apple-targets',
    ],
    scheme: 'score',
    web: { bundler: 'metro', output: 'static', favicon: './assets/icon.png' },
    // react-native-purchases の autolinking 除外(iOS限定)は react-native.config.js に移動
    // (旧: ここでの exclude はプラットフォーム共通に効いてしまい、Android ビルドが壊れていた)
  },
}

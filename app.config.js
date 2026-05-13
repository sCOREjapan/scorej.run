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
      infoPlist: {
        CFBundleURLTypes: [
          {
            CFBundleURLSchemes: [
              'com.googleusercontent.apps.918711129795-5lt5a8v4ud03iu2lg35olfits8rc78dg'
            ]
          }
        ]
      }
    },
    android: { adaptiveIcon: { backgroundColor: '#0a0a0a' }, package: 'com.scorejapan.score' },
    plugins: [
      'expo-router',
      // AdMob — App IDはAdMobダッシュボード > アプリ > [アプリ名] > アプリの設定 で確認
      // TODO: 下記の ADMOB_APP_ID_IOS / ANDROID を実際のApp IDに差し替える
      // 形式: ca-app-pub-XXXXXXXX~YYYYYYYYYY  (スラッシュではなくチルダ~)
      ['react-native-google-mobile-ads', {
        // AdMobアカウントが承認されたら本番IDに差し替える:
        // iosAppId: 'ca-app-pub-6225795381877305~3874907264',
        // androidAppId: 'ca-app-pub-6225795381877305~6309498919',
        androidAppId: 'ca-app-pub-3940256099942544~3347511713',  // Google テストApp ID
        iosAppId:     'ca-app-pub-3940256099942544~1458002511',  // Google テストApp ID
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
    ],
    scheme: 'score',
    web: { bundler: 'metro', output: 'static', favicon: './assets/icon.png' },
  },
}

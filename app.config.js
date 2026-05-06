// app.config.js
// react-native-purchases の config plugin は EAS (native) ビルド時のみ有効にする。
// web export 時に plugin 解決エラーが起きてビルドが失敗するため。
const IS_EAS = !!process.env.EAS_BUILD

module.exports = {
  expo: {
    name: 'sCORE',
    slug: 'score',
    version: '1.0.0',
    extra: { eas: { projectId: '17151d64-68e8-4831-b3a2-0bead72fa41e' } },
    owner: 'score.japan',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    splash: { resizeMode: 'contain', backgroundColor: '#0a0a0a' },
    ios: { supportsTablet: false, bundleIdentifier: 'com.scorejapan.score' },
    android: { adaptiveIcon: { backgroundColor: '#0a0a0a' }, package: 'com.scorejapan.score' },
    plugins: [
      'expo-router',
      // ネイティブSDKは web export では plugin 解決エラーになるため EAS 時のみ
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

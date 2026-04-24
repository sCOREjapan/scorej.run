import { ScrollViewStyleReset } from 'expo-router/html'
import type { PropsWithChildren } from 'react'

// ビルド時に埋め込む（EXPO_PUBLIC_ は公開OK）
const ONESIGNAL_APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? ''

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/* ── PWA / iPhone ホーム画面対応 ── */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="sCORE" />
        <meta name="theme-color" content="#E53935" />
        <link rel="manifest" href="/manifest.json" />
        {/* Apple タッチアイコン（assets/icon.png を public/ にコピーすると使える） */}
        <link rel="apple-touch-icon" href="/favicon.ico" />

        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: `
          @font-face {
            font-family: 'Ionicons';
            src: url('https://unpkg.com/@expo/vector-icons@15.0.3/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf') format('truetype');
            font-display: block;
          }
          @font-face {
            font-family: 'MaterialIcons';
            src: url('https://unpkg.com/@expo/vector-icons@15.0.3/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf') format('truetype');
            font-display: block;
          }
          * { box-sizing: border-box; }
          body { overflow: hidden; }
        `}} />

        {/* ── OneSignal プッシュ通知 SDK ── */}
        {ONESIGNAL_APP_ID ? (
          <script dangerouslySetInnerHTML={{ __html:
            `window.__ONESIGNAL_APP_ID__="${ONESIGNAL_APP_ID}";`
          }} />
        ) : null}
        <script src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js" defer />
      </head>
      <body>{children}</body>
    </html>
  )
}

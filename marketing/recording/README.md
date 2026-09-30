# sCORE SNS素材 録画スクリプト

sCOREアプリ(Expo Web版)をPlaywrightで自動操作し、SNS投稿用の画面録画(mp4 + サムネイルPNG)を作るスクリプト。

## 前提

- `marketing/recording/` 配下で `npm install` 済み(Playwright本体)
- `npx playwright install chromium` でブラウザ本体を導入済み
- `ffmpeg` がPATH上にあること(`brew install ffmpeg`)
- リポジトリルート(`trackmate/`)で **`EXPO_PUBLIC_RECORDING_DEMO=1 npx expo start --web`** を起動しておくこと
  (このモードの時だけ、実AI呼び出し・チケット/広告ゲート・料金表示が全てダミーに置き換わる。詳細は `lib/recordingDemo.ts` とそれを参照している `app/video-analysis.tsx` / `app/(tabs)/competition.tsx` を参照)

## 使い方

```bash
cd marketing/recording
RECORD_BASE_URL=http://localhost:8901 npm run record
```

`out/` 配下に以下が出力される:
- `rec_home.mp4` / `rec_home.png`
- `rec_practice_input.mp4` / `rec_practice_input.png`
- `rec_video_review.mp4` / `rec_video_review.png`
- `rec_meet_countdown.mp4` / `rec_meet_countdown.png`

## デモデータについて

- 選手名・チーム名はすべて架空(「陸上 太郎」等)
- 体重・体調・怪我リスクの具体的な数値が映る画面は録画対象に含めていない
- 価格・チケット消費・PROプラン表示は `EXPO_PUBLIC_RECORDING_DEMO=1` 時にすべて非表示化される(該当箇所は各ファイルの`RECORDING_DEMO`分岐を参照)
- 本番のSupabase DB・実際のAI APIには一切書き込み/問い合わせをしない(ローカルのlocalStorage/AsyncStorageのみで完結)
- `assets/demo_practice.mp4` は実際の練習映像ではなく、動画分析機能を実演するための**プレースホルダー動画**(testsrc2パターン)。本番でSNSに出す際は、本人の許諾を得た実際の練習動画に差し替えることを推奨

## 再撮影する場合

- 画面のUI文言が変わった場合、このスクリプト内のテキストセレクタ(`getByText(...)`)がマッチしなくなる可能性がある。その場合は対象画面の `locales/ja.json` の該当キーを確認して修正すること
- `state/storage.json` は初回セットアップ(同意・オンボーディング完了状態)のキャッシュ。UIの仕様が変わって様子がおかしい場合は削除してから再実行する

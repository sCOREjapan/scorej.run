# TrackMate — アプリ概要（完全版）

## 1. アプリの目的とコンセプト

**TrackMate** は陸上競技選手のための総合パフォーマンス管理アプリ。練習の記録・分析、チームコミュニケーション、怪我予防リスク計算、AI診断を一元化し、「練習→記録→分析→改善」のサイクルを効率化する。競合調査（メシトラ等）をもとに設計された、陸上特化型の練習ログアプリ。

---

## 2. 技術スタック

| 項目 | 内容 |
|---|---|
| フレームワーク | React Native + Expo SDK 54 |
| ルーティング | expo-router v6（ファイルベース） |
| バックエンド | Supabase（PostgreSQL + Auth + Realtime） |
| ローカル永続化 | AsyncStorage |
| AI機能 | Anthropic Claude API（claude-sonnet） |
| 通知 | OneSignal（プッシュ通知）+ Web Notification API |
| アニメーション | React Native Animated API |
| アイコン | @expo/vector-icons（Ionicons） |
| UI補助 | expo-linear-gradient, react-native-safe-area-context |
| デプロイ | Vercel（Webビルド） |

---

## 3. 画面構成（ルーティング）

### タブナビゲーション（`app/(tabs)/`）

```
ホーム      → app/(tabs)/index.tsx     （デフォルト表示）
チーム      → app/(tabs)/team.tsx
進捗        → app/(tabs)/records.tsx
設定        → app/(tabs)/mypage.tsx
```

**非表示タブ（ルートとして有効）:**
- `notebook`, `calendar`, `competition`, `sleep`, `nutrition`

### スタックナビゲーション（`app/`）

| ファイル | 画面 |
|---|---|
| `auth.tsx` | ログイン・新規登録・ゲストログイン |
| `onboarding.tsx` | 初回セットアップ（名前・種目入力） |
| `settings.tsx` | アカウント・通知・データ設定 |
| `manual-log.tsx` | 手動練習記録入力 |
| `timer.tsx` | タイム計測（ストップウォッチ） |
| `workout-menu.tsx` | メニュー練習入力 |
| `calendar.tsx` | カレンダー全表示 |
| `ai-diagnosis.tsx` | AI週次診断 |
| `video-analysis.tsx` | フォーム動画分析 |
| `warmup.tsx` | ウォームアップ補助 |
| `recovery.tsx` | リカバリー管理 |
| `level-roadmap.tsx` | レベルロードマップ |
| `share-card.tsx` | PB記録シェアカード生成 |
| `session-detail.tsx` | 練習セッション詳細 |
| `team-invite.tsx` | チーム招待 |
| `coach-view.tsx` | コーチ専用ビュー |
| `ranking.tsx` | ランキング（廃止） |
| `gps-run.tsx` | GPSランニング（実験的） |
| `privacy.tsx` / `terms.tsx` | プライバシー・利用規約 |

---

## 4. 各画面の詳細機能

### 4-1. ホーム（`index.tsx`）

**週間日付バー**
- 過去7日間を横スクロールで表示
- 日付タップで「その日の練習記録・体調」を切り替え表示
- 体調カラードット（緑≥8 / 黄≥6 / 赤<6）を各日に表示
- 今日はハイライト表示

**怪我リスクスコア**
- `lib/injuryRisk.ts` の `calcInjuryRisk()` が以下ファクターから 0〜100 のリスクスコアを算出
  - 練習負荷（直近のセッション数・距離）
  - 疲労蓄積（TSB = Training Stress Balance）
  - 体調スコア
  - 睡眠時間
  - 直近疲労度
- スコア色：🟢 低リスク / 🟡 中リスク / 🔴 高リスク
- 推奨メッセージと各ファクターのバー表示

**体調入力**
- 😫😕😐😊💪 の5段階で選択
- `trackmate_condition_map`（日付→スコアのJSON）に保存
- 選択日ごとに独立した値を管理

**クイックリンク**
- リカバリー / フォーム分析 / 食事記録 / カレンダーへの2×2グリッドナビゲーション

**AIコーチカード**
- 体調・練習・睡眠データから総合分析（`/ai-diagnosis`へ遷移）

**今日の練習一覧**
- 選択日の練習セッションをリスト表示
- PR（個人最高記録）バッジ（amber色）を自動検出・表示

**レベルバッジ**
- `lib/gamification.ts` の `calcLevelInfo()` がセッション数からLv計算
- Lv1 ビギナー → Lv10 レジェンドまでのランク制

---

### 4-2. チーム（`team.tsx`）

**2ロール制**
- **コーチ**：チーム作成・招待コード発行・メンバー管理（削除可能）・動画投稿・ピン留め
- **選手**：招待コードでジョイン・身体レポート送信・動画視聴・メッセージ送信

**主要機能**
- Supabase Realtime によるリアルタイムチャット（`teamMessages`テーブル）
- コーチによるメッセージピン留め
- チーム内動画共有・視聴管理（`teamVideos`テーブル）
- 身体レポート（痛み部位マップ）送信（`bodyReports`テーブル）
- OneSignal プッシュ通知連携

**デモデータ**
- 初期表示のメンバーには「デモ」バッジを表示し、実際の選手と区別

---

### 4-3. 進捗（`records.tsx`）

**3タブ構成:**

#### タブ1: 練習履歴
- 期間セレクター：**14日間 / 1ヶ月 / 1年**
- サマリーカード：総練習数 / 選択期間の練習数 / 累計距離
- バーチャート：日別（14日・1ヶ月）または週集計（1年）
- 種目別内訳：インターバル・テンポ走・ジョグ等のパーセンテージ棒グラフ
- 練習一覧：選択期間のセッションリスト（最大30件）
- 全カードに `AnimatedSection`（fade-up）アニメーション

#### タブ2: タイム記録
- **「タイムを入力する」大ボタン**（赤・横長・視認性高）でモーダル入力
- PBサマリー：種目別自己ベスト一覧
- タイム推移グラフ（`TrainingChart` コンポーネント）
- 種目フィルター
- 記録一覧（PB/SBバッジ付き）
- 記録削除・シェアカード生成

#### タブ3: 体調・睡眠
- 体調推移バーチャート（直近14日）
- 直近の体調スコア表示
- 睡眠時間推移バーチャート

---

### 4-4. 設定（`mypage.tsx`）

**プロフィール**
- 名前・主競技・学年を表示・編集（`/settings`へ遷移）

**機能グリッド（2列）**
- タイム記録 / 栄養管理 / 睡眠記録 / 試合計画 / チーム / AI診断 / カレンダー詳細 / 設定

**通知設定**
- 怪我予防リマインダー Switch
- ON時：朝7時リスク確認通知 / 夜20時練習記録リマインダー / 夜22時睡眠記録リマインダー
- ネイティブ（Notification API非対応）環境でも保存・復元対応

---

### 4-5. 手動入力（`manual-log.tsx`）

**セッションタイプ選択（9種）**
- インターバル / テンポ走 / ジョグ / ロング走 / スプリント / ドリル / ウェイト / 試合 / 休養

**種目選択（19種）**
- 100m〜マラソン・フィールド種目

**日付選択**
- 過去8日分のチップ形式（今日は「今日」表示）

**タイム入力**（分/秒/CS）
**本数・距離入力**（セッションタイプに応じて表示）
**疲労度選択**（😵😓😐💪🔥 の5段階）

保存先：`trackmate_sessions`（AsyncStorage）

---

### 4-6. タイム計測（`timer.tsx`）

- ストップウォッチ（67ms間隔・~15fps更新）
- 開始 / 一時停止 / 再開 / リセット
- ラップ記録（スプリットボタン）
- 最速ラップをハイライト表示（赤色）
- **保存先：`trackmate_sessions`**（練習記録として保存）
- 種目選択モーダル（100m・200m・400m等）

---

## 5. データモデル

### TrainingSession（`trackmate_sessions`）
```typescript
{
  id: string
  user_id: string
  session_date: string        // YYYY-MM-DD
  session_type: string        // sprint / interval / tempo / easy / long / drill / strength / race / rest
  event?: AthleticsEvent      // 100m, 200m, ...
  time_ms?: number            // タイム（ミリ秒）
  distance_m?: number         // 距離（メートル）
  reps?: number               // 本数
  sets?: number               // セット数
  rest_sec?: number           // レスト（秒）
  fatigue_level?: number      // 2/4/6/8/10
  condition_level?: number    // 体調スコア
  notes?: string
  created_at: string
}
```

### RaceRecord（`trackmate_race_records`）
```typescript
{
  id: string
  event: AthleticsEvent
  result_display: string      // "10.85" / "1:23.45"
  result_ms?: number
  result_cm?: number          // フィールド種目
  race_date: string
  venue?: string
  competition_name?: string
  wind_ms?: number
  is_pb: boolean
  is_sb: boolean
  notes?: string
}
```

### conditionMap（`trackmate_condition_map`）
```json
{ "2026-04-15": 8, "2026-04-14": 6, ... }
```

### SleepRecord（`trackmate_sleep`）
```typescript
{ date: string; hours?: number; duration_min?: number }
```

---

## 6. ライブラリ構成（`lib/`）

| ファイル | 役割 |
|---|---|
| `theme.ts` | カラー定数（BRAND=#E53935 赤, BG_GRADIENT, TEXT, NEON等） |
| `injuryRisk.ts` | 怪我リスクスコア算出ロジック |
| `gamification.ts` | レベル・ランク計算（Lv1〜10、RANK_TIERS） |
| `sounds.ts` | UI効果音（tap / whoosh / save / pb / error等） |
| `notifications.ts` | Web Notification API ラッパー（スケジューリング） |
| `notify.ts` | OneSignal プッシュ通知（チーム機能用） |
| `quickLogEvent.ts` | グローバルFAB→QuickLogModal のイベントブリッジ |
| `homeScroll.ts` | ホームタブ再タップ時のスクロールトップイベント |
| `supabase.ts` | Supabaseクライアント初期化 |
| `supabaseTeam.ts` | チーム機能のSupabase操作（CRUD） |
| `export.ts` | CSV/JSONエクスポート |
| `storage.ts` | AsyncStorageラッパー |
| `fatigue.ts` | 疲労計算ユーティリティ |
| `weather.ts` | 天気情報取得 |
| `subscription.ts` | サブスクリプション管理 |
| `adGate.ts` | 広告ゲート制御 |
| `claude.ts` | Claude API呼び出し |

---

## 7. グローバルFAB（ラジアルメニュー）

タブバー中央に常時表示。タップで4つのアクションが扇形に展開（角度 -150°〜-30°、半径110px）。

| アイコン | ラベル | 動作 |
|---|---|---|
| 🤖 | AI入力 | ホームへ遷移後 QuickLogModal を起動 |
| ✏️ | 手動入力 | `/manual-log` へ遷移 |
| 📋 | メニュー | `/workout-menu` へ遷移 |
| ⏱ | タイム入力 | `/(tabs)/records`（タイム記録タブ）へ遷移 |

---

## 8. 認証フロー

1. `app/auth.tsx`：Google OAuth / メール登録 / **ゲストとして続ける**
2. 初回：`app/onboarding.tsx` で名前・種目・目標を設定
3. セッション情報は Supabase Auth で管理
4. ゲスト時はローカルのみで動作（AsyncStorage）

---

## 9. カラーパレット

```typescript
BRAND      = '#E53935'   // 赤（ブランドカラー）
BG_GRADIENT = ['#000000', '#0A0A14']  // 背景グラデーション
SURFACE    = '#1a1a1a'   // カード背景
SURFACE2   = '#252525'   // セカンダリ面
TEXT.primary   = '#FFFFFF'
TEXT.secondary = '#8E8E93'
TEXT.hint      = '#3A3A3C'
NEON.green  = '#34C759'
NEON.blue   = '#4A9FFF'
NEON.amber  = '#F5A623'   // 日付バー選択色
NEON.purple = '#AF52DE'
```

---

## 10. 今後の実装予定（Pending）

- **チーム機能強化**：コーチによるメンバー削除（Supabase）、デモデータのバッジ表示
- **Apple Health連携**：HealthKit経由での睡眠・心拍データ自動取込み
- **スクリーンタイム連携**：iOS制限のため代替手段を検討
- **複数種目選択**：プロフィール・手動入力でのマルチセレクト
- **ダークモード専用化**：ライトモード削除によるUI統一

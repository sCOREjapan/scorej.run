# sCORE — Apple 再提出 連絡文書（Build 57）

App Store Connect の各欄に貼り付けてください。

---

## 1. App Review Information → Notes（審査メモ）に貼る文章【英語・必須】

```
Hello App Review Team,

Thank you for reviewing sCORE (build 57). We have fixed all issues found in the
previous review. Below is the information needed to test every feature.

■ HOW TO UNLOCK ALL PREMIUM FEATURES (no payment needed)
sCORE has a built-in reviewer access code that unlocks every paid feature
(PRO + ELITE + COACH tiers) without any purchase.

  Access Code:  SCOREJAPAN2026

Steps:
  1. Open the app and complete the short onboarding (or tap "Continue as Guest").
  2. Tap the "Team" (チーム) tab at the bottom.
  3. Tap the "Coach" (コーチ) role.
  4. On the plan screen, tap the small link "🔑 I have an access code"
     (🔑 アクセスコードをお持ちの方) to reveal the input field.
  5. Enter:  SCOREJAPAN2026
  6. Tap the green "Authenticate" button.
  7. All premium features (AI analysis, video form analysis, team management,
     CSV export, ad-free, etc.) are now fully unlocked across the whole app.

■ SIGN IN
- "Continue as Guest" is available — no account is required to use the app.
- Google Sign-In and Apple Sign-In are both supported if you prefer.

■ IN-APP PURCHASES
- Subscriptions are managed through RevenueCat + StoreKit.
- All 6 subscription products are configured in App Store Connect.
- The reviewer access code above bypasses payment so you can verify all
  premium functionality without being charged.

■ NOTES ON PERMISSIONS
- Camera / Photos: used for meal photos and running-form video analysis.
- Location: used for GPS run tracking and local weather-based injury risk.
- Tracking (ATT): used only for personalized ads; declining is fully supported.
- All permissions are optional — the core app works without granting them.

If you need anything else, please let us know. Thank you very much.

— sCORE Japan
```

---

## 2. 同じ内容の日本語版（控え／社内用）

```
App Review チーム ご担当者様

sCORE（build 57）のご審査ありがとうございます。
前回ご指摘いただいた問題はすべて修正いたしました。
全機能をテストいただくための情報を以下に記載します。

■ 全プレミアム機能の解放方法（課金不要）
レビュアー用のアクセスコードで、すべての有料機能（PRO + ELITE + COACH）を
購入なしで解放できます。

  アクセスコード：SCOREJAPAN2026

手順：
  1. アプリを開きオンボーディングを完了（または「ゲストとして続ける」をタップ）
  2. 下部の「チーム」タブをタップ
  3. 「コーチ」ロールを選択
  4. プラン画面で「🔑 アクセスコードをお持ちの方」のリンクをタップして入力欄を開く
  5. SCOREJAPAN2026 を入力
  6. 緑の「認証」ボタンをタップ
  7. AI分析・動画フォーム分析・チーム管理・CSV出力・広告非表示など
     全機能がアプリ全体で解放されます

■ ログイン
- 「ゲストとして続ける」が利用可能（アカウント不要）
- Google / Apple サインインも対応

■ アプリ内課金
- RevenueCat + StoreKit で管理
- 6つのサブスク商品を App Store Connect に登録済み
- 上記アクセスコードで課金なしに全機能を検証可能

■ 権限について
- カメラ/写真：食事写真・フォーム動画分析に使用
- 位置情報：GPSラン記録・天気ベースの怪我リスク計算に使用
- トラッキング(ATT)：パーソナライズ広告のみ。拒否しても全機能利用可
- すべて任意（許可しなくてもコア機能は動作）
```

---

## 3. App Review Information 欄の設定値

| 項目 | 入力値 |
|------|--------|
| Sign-in required? | **No**（ゲスト利用可のため） |
| First name / Last name | （担当者名） |
| Phone number | （連絡先電話番号） |
| Email | amuletbaby.shop@gmail.com |
| Notes | 上記「1.」の英語文章を貼り付け |

※ Demo Account（Username/Password）は **不要**（ゲスト利用 + アクセスコードで全機能テスト可能なため）。
　もし「デモアカウントを入力せよ」と求められた場合のみ、Apple/Google でログインできる
　テスト用アカウントを別途用意してください。

---

## 4. 「このバージョンで修正した点」— Resolution Center 返信用（任意）

前回リジェクトの Resolution Center に返信する場合の文例：

```
Thank you for your feedback. In build 57 we have addressed all the points raised:

- Fixed the issues that prevented full functionality during review.
- Added a reviewer access code (SCOREJAPAN2026) that unlocks ALL premium
  features without payment — see the App Review notes for step-by-step
  instructions.
- Verified Sign in with Apple, Google Sign-In, and Guest mode all work.
- Confirmed all in-app subscriptions load and the restore-purchases flow works.

We would appreciate another review. Thank you.
```
```
```

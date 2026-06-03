# sCORE — Apple 再提出 連絡文書（Build 58）

前回（build 57）のリジェクト 2件への対応版。

- Guideline 3.1.1（クーポンで有料機能を解放）→ **クーポン/アクセスコード機能を完全削除**
- Guideline 2.1（プラン購入ボタンのエラー / ログインエラー）→ 対応済み

---

## ⚠️ 提出前に必ずやること（App Store Connect・最重要）

**App内課金プロダクトが「メタデータが不足」のままだと、審査でプランが読み込めず
また 2.1 で落ちます。** 提出前に必ず：

1. App Store Connect →「アプリ内課金」/「サブスクリプション」で、6つのプロダクト
   （`score_pro_monthly` / `score_pro_annual` / `score_elite_monthly` /
   `score_elite_annual` / `score_coach_monthly` / `score_coach_annual`）の
   **メタデータ（表示名・説明・価格・スクショ）を全て埋めて「審査準備完了」にする**
2. バージョン提出画面で、**これらのサブスクリプションをこのバージョンと一緒に提出**
   （新規アプリは初回IAPを binary と同時に審査に出す必要があります）
3. Sandbox テスト用アカウントを1つ作成
   （ユーザとアクセス →「Sandbox」→ テスター を追加）

これをやらないと「プランを選ぶ」が読み込み中のままになります。

---

## 1. App Review → Notes（審査メモ）に貼る文章【英語・必須】

```
Hello App Review Team,

Thank you for the detailed feedback on build 57. We have resolved both issues in
build 58.

■ Guideline 3.1.1 (Coupon codes) — FIXED
We have completely removed the coupon-code and access-code features that unlocked
paid functionality. All premium tiers (PRO / ELITE / COACH) are now unlocked
exclusively through In-App Purchase via the App Store. There is no longer any
non-IAP unlock mechanism anywhere in the app.

■ Guideline 2.1 (Bugs) — FIXED
1. "Select a plan" button error: this happened because our subscription products
   were still in "Missing Metadata" state and could not load. We have completed
   all subscription metadata and submitted the products together with this build.
   The paywall now also shows a clear loading state instead of an error while
   products are being fetched.
2. Sign-in errors: we hardened the Apple and Google sign-in flows. In addition,
   the app is FULLY usable WITHOUT signing in — please use "Continue as Guest".

■ HOW TO REVIEW (no account or payment required)
  1. Launch the app and finish the short onboarding.
  2. On the sign-in screen, tap "Continue as Guest" (the bordered button at the
     bottom). This gives full access to the entire app — no account needed.
  3. To verify In-App Purchases, open any premium feature (e.g. the paywall) and
     purchase using your Sandbox tester account (sandbox purchases are free).
  4. "Restore Purchases" is available on the paywall.

■ PERMISSIONS (all optional)
- Camera / Photos: meal photos and running-form video analysis.
- Location: GPS run tracking and local weather-based injury-risk.
- Tracking (ATT): personalized ads only; declining is fully supported.
The core app works without granting any of these.

Thank you very much for your time. Please let us know if anything else is needed.

— sCORE Japan
```

---

## 2. Resolution Center への返信文【英語・任意だが推奨】

Apple のメッセージスレッドにそのまま返信すると、レビュアーに直接届きます。

```
Thank you for the feedback. Build 58 addresses both points:

- Guideline 3.1.1: We removed ALL coupon/access-code unlocks. Premium features
  are now unlocked only through In-App Purchase. No non-IAP unlock remains.

- Guideline 2.1: The "Select a plan" error was caused by subscription products
  in "Missing Metadata" state; we have completed the metadata and are submitting
  the IAPs together with this build, and the paywall now shows a loading state
  instead of an error. For sign-in, the app is fully usable via "Continue as
  Guest" (no account needed), and we hardened the Apple/Google flows.

We would appreciate another review. Thank you.
```

---

## 3. App Review Information 欄の設定値

| 項目 | 入力値 |
|------|--------|
| サインインが必要ですか? | **いいえ（No）** — ゲストで全機能利用可 |
| First / Last name | （担当者名） |
| Phone number | （連絡先電話） |
| Email | amuletbaby.shop@gmail.com |
| Notes | 上記「1.」の英語文章 |
| Demo Account | **不要**（ゲスト利用のため空欄でOK） |

---

## 4. 今回 build 58 で直した点（社内メモ）

- **3.1.1**：`PurchaseContext` から applyCoupon / applyAccessCode / ACCESS_CODE_MAP /
  TRIAL_COUPON_SET / isTrial 等を全削除。coupon.tsx は無効化。設定・ペイウォール・
  コーチペイウォールのコード入力UIを削除。→ 課金は IAP のみ。
- **2.1 バグ1**：ペイウォールのCTAを、プラン未ロード時は「プランを準備中...」の
  ローディング表示にして、タップでエラーが出ないようにした。
- **2.1 バグ2**：「ゲストとして続ける」を枠付きの目立つボタンに変更。
  Apple/Google ログインは前ビルドで dedupe 修正済み。

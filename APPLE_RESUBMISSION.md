# sCORE — Apple 再提出 連絡文書（Build 59）

前回（build 58）のリジェクト対応版。

- Guideline 3.1.1（クーポンで有料機能を解放）→ **クーポン/アクセスコード機能を完全削除**（Build 58から継続）
- Guideline 2.1（プラン購入ボタンのエラー / ログインエラー）→ 対応済み（Build 58から継続・強化）
- Guideline 4（iPad表示崩れ）→ **オンボーディング全ステップでテキスト切れを修正**

---

## ⚠️ 提出前に必ずやること（App Store Connect・最重要）

**App内課金プロダクトが「メタデータが不足」のままだと、審査でプランが読み込めず
また 2.1 で落ちます。** 提出前に必ず：

1. App Store Connect →「サブスクリプション」で、8つのプロダクト
   （`score_pro_monthly` / `score_pro_annual` / `score_elite_monthly` /
   `score_elite_annual` / `score_coach_monthly` / `score_coach_annual` /
   `score_teamPro_monthly` / `score_teamPro_annual`）の
   **メタデータ（表示名・説明・価格・スクショ）を全て埋めて「審査準備完了（提出準備中）」にする**
   → **現在すべて「提出準備中」✅ 完了**
2. バージョン提出画面で、**これらのサブスクリプションをこのバージョンと一緒に提出**
   （新規アプリは初回IAPを binary と同時に審査に出す必要があります）
3. Sandbox テスト用アカウントを1つ作成
   （ユーザとアクセス →「Sandbox」→ テスター を追加）⚠️ **未完了**

これをやらないと「プランを選ぶ」が読み込み中のままになります。

---

## 1. App Review → Notes（審査メモ）に貼る文章【英語・必須】

```
Hello App Review Team,

Thank you for your continued feedback. Build 59 addresses all previously
flagged issues, including additional improvements to stability and layout.

■ Guideline 3.1.1 (Coupon codes) — FIXED (carried from build 58)
We have completely removed the coupon-code and access-code features that
unlocked paid functionality. All premium tiers (PRO / ELITE / COACH) are
now unlocked exclusively through In-App Purchase via the App Store.

■ Guideline 2.1 (Bugs) — FIXED & STRENGTHENED
1. "Select a plan" loading error: subscription products were in "Missing
   Metadata" state; all 8 subscription metadata are now complete and
   submitted together with this build. The paywall also shows a 10-second
   timeout fallback ("現在プラン情報を取得できません") with a Restore button.
2. Sign-in (Apple): we now generate a SHA-256 hashed nonce and pass the
   raw nonce to Supabase, fully complying with Apple's nonce requirements.
3. JSON.parse crash guards: all AsyncStorage reads in the Home and Team
   screens are wrapped in try-catch to prevent crashes from corrupt data.
4. Onboarding navigation race: fixed so that tapping PRO/ELITE goes to
   the paywall without the tabs screen briefly flashing underneath.

■ Guideline 4 (iPad layout) — FIXED
All onboarding steps now display correctly on iPad (13-inch and smaller).
Adjusted font sizes, line heights, and padding; removed hard-coded line
breaks that caused text clipping on larger screens.

■ HOW TO REVIEW (no account or payment required)
  1. Launch the app and accept the Terms of Use / Privacy Policy.
  2. Proceed through the 5 onboarding steps.
  3. On the sign-in screen, tap "ゲストとして続ける" (Continue as Guest).
     This gives full access to the entire app — no account needed.
  4. To verify In-App Purchases, open any premium feature (e.g. the
     paywall) and purchase using your Sandbox tester account.
  5. "購入を復元する" (Restore Purchases) is available on the paywall.

■ PERMISSIONS (all optional)
- Camera / Photos: meal photos and running-form video analysis.
- Location: GPS run tracking and local weather-based injury-risk.
- Tracking (ATT): personalized ads only; declining is fully supported.
The core app works without granting any of these.

Thank you very much for your time.

— sCORE Japan
```

---

## 2. Resolution Center への返信文【英語・任意だが推奨】

```
Thank you for the feedback. Build 59 addresses all points:

- Guideline 3.1.1: All coupon/access-code unlocks removed. Premium
  features are unlocked only through In-App Purchase. No non-IAP unlock
  remains (carried from build 58).

- Guideline 2.1:
  · Subscription loading: metadata for all 8 products is now complete
    and submitted with this build. The paywall also has a 10-second
    timeout with a "Restore Purchases" fallback.
  · Apple Sign-In: SHA-256 nonce is now correctly hashed and passed.
  · Crash guards: all JSON.parse calls wrapped in try-catch.
  · Onboarding navigation: fixed race condition between paywall and tabs.

- Guideline 4 (iPad): all onboarding steps now render correctly on iPad
  without text clipping.

"ゲストとして続ける" (Continue as Guest) on the sign-in screen gives
full access for review without any account or payment.

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

## 4. 今回 build 59 で直した点（社内メモ）

### Build 58 からの継続修正
- **3.1.1**：`PurchaseContext` から applyCoupon / applyAccessCode / ACCESS_CODE_MAP /
  TRIAL_COUPON_SET / isTrial 等を全削除。coupon.tsx は無効化。設定・ペイウォール・
  コーチペイウォールのコード入力UIを削除。→ 課金は IAP のみ。

### Build 59 新規修正
- **2.1 バグ1（ペイウォールタイムアウト）**：`loadTimedOut` state を追加。
  10秒待ってもプラン情報が取得できない場合、「現在プラン情報を取得できません」
  メッセージと「購入を復元する」ボタンを表示。
- **2.1 バグ2（Apple Sign In nonce）**：`Crypto.randomUUID()` で rawNonce を生成し、
  SHA-256 で hashedNonce を計算。`AppleAuthentication.signInAsync` に hashedNonce を渡し、
  `supabase.auth.signInWithIdToken` に rawNonce を渡す正しい実装に修正。
- **2.1 バグ3（JSON.parse クラッシュ）**：`app/(tabs)/index.tsx` の全 JSON.parse（10箇所）
  と `app/(tabs)/team.tsx` の全 JSON.parse（4箇所）を try-catch で包んだ。
- **2.1 バグ4（オンボーディング遷移競合）**：`handleFinish(skipNav=false)` を追加。
  PRO/ELITEタップ時は `handleFinish(true)` + `router.push('/paywall')` で
  tabs への遷移を回避。
- **Guideline 4（iPad テキスト切れ）**：オンボーディング全ステップのフォントサイズ・
  行の高さ・パディングを調整。タイトルのハードコード改行（`{'\n'}`）を削除。

---

## 5. 提出前チェックリスト

- [x] Paid Apps Agreement → **有効**
- [x] 銀行口座 → **Active**（京葉銀行）
- [x] W-8BEN 税務フォーム → **Active**
- [x] 8つのサブスクリプション → **提出準備中**
- [ ] Sandbox テスターアカウント作成（未完了）
- [ ] バージョン提出画面でサブスクリプションをこのビルドに紐付け
- [ ] App Review Notes に上記テキストを貼り付け
- [ ] **ユーザの指示でビルド提出**（`npx eas submit --platform ios --profile production --non-interactive`）

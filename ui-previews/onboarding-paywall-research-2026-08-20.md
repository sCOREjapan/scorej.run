# sCORE インストール→課金フロー調査レポート

**作成日:** 2026-08-20　**対象:** app install → onboarding → paywall → 初回課金
**現状:** Free→Paid転換率 約0.12%（業界平均1〜3%の1/10以下）
**読了目安:** 10分／実行目安:** 数週間

---

## TL;DR（3行）

1. **オンボーディング〜チュートリアルの間、価格・プラン・チケット制度への言及がゼロ**。ペイウォールは全て「機能を使おうとして弾かれた」瞬間にしか出ない受動型（reactive-only）。install直後の意欲ピークを完全に使い捨てている。
2. **無料トライアルが存在しない**（コード上・legal文言上ともに確認）。チケット制の複雑さ（3プラン×2周期×2種チケットパック）も選択過多を招いている可能性が高い。
3. **自社アナリティクスの購入ファネルが計測できていない**（`trackUpgrade`は呼び出し箇所ゼロ、`trackPaywallView`も主要な詰まりポイントである`TicketGateModal`・`paywall.tsx`本体では未計測）。今どこで離脱しているか、自分たちのログからは分からない状態。

---

## PART 1 — 現状フローの実測マップ

### ステップ0: 起動・同意
- `app/_layout.tsx` の `AuthGate`（453-634行）が全ルーティングを制御。
- 未同意なら `ConsentModal`（`app/_layout.tsx:103-260`）が最優先で全画面上に表示（619-621行）。利用規約・プライバシーポリシーへの同意が必須。

### ステップ1: オンボーディング誘導（認証より先）
- `app/_layout.tsx:567-572` — 未認証・未オンボーディングのユーザーは**まず**`/onboarding`へ。コード内コメント（567-568行）に明記: 「サインアップの壁を見せる前に、種目選択などで価値を体験してもらう」。これは意図的な設計で、方向性としては正しい（Duolingo/Noomと同じ「先に投資させてから壁を見せる」型）。

### ステップ2: イントロカルーセル（`app/onboarding.tsx`, phase='intro'）
5枚のマーケティングスライド、`IntroCarousel`（323-385行）:
1. `IntroSlide1`（135-182行）— ヒーロー訴求文 + ダミーのスコアバッジ（睡眠87・疲労42・コンディション91、固定値）
2. `IntroSlide2`（184-216行）— 機能4カード
3. `IntroSlide3`（218-258行）— 「こんな経験ありませんか」共感チェックリスト（126-131行に定義）。**ユーザーがチェックした内容は`useState`のローカルstateのみで、どこにも保存・後段で再利用されていない**（220行 `useState<Set<string>>`、画面を離れると消える）
4. `IntroSlide4`（260-292行）— Before/After比較
5. `IntroSlide5`（294-318行）— 開発者本人の怪我体験ストーリー（306-314行）。差別化訴求（怪我予防）として質は高い。

### ステップ3: プロフィール入力クエスト（phase='quiz', 4ステップ）
- Step1（782-799行）名前入力　/　Step2（801-807行）種目カテゴリ　/　Step3（809-815行）メイン種目　/　Step4（817-908行）競技歴・年齢・都道府県・自己ベスト（すべてスキップ可、881行）
- 進捗バー付き、離脱率は低めに設計されている（スキップ可・必須項目は名前のみ）

### ステップ4: 「プラン生成」演出（phase='processing', 700-723行）
- `PROCESSING_ITEMS`（466行）:「きみのデータを分析中...」「怪我リスクを計算中...」「AIプランを生成中...」を`setTimeout`で順に表示するだけの**固定尺アニメーション**（624-637行）。実際のAI呼び出しも、実データに基づく怪我リスク計算も一切発生していない。

### ステップ5: リビール（phase='reveal', 726-760行）
- 「〇〇さん専用プランができました」+ 種目・レベル・「次の目標: 自己ベスト更新」（固定文言、750行）を表示。**Step3で集めた「怪我で試合を棒に振った」等の共感データも、Step4の自己ベストも、ここでの"パーソナライズ"には反映されていない**。

### ステップ6: `handleFinish()`（644-688行）
- プロフィール保存 → `setOnboarded()` → **`grantStarterTicketsIfNeeded()`（681行、無料チケット10枚を無言で付与）** → 未認証なら`/auth`、認証済みなら`/(tabs)`+800ms後に`startTutorial()`。
- チケット10枚付与は**ユーザーに一切明示されない**（トースト等の通知なし）。

### ステップ7: ログイン（`app/auth.tsx`）
- クエスト完了**後**に配置（コミットメント効果を狙った意図的順序、良い設計）。Google/Apple/ゲスト継続の3択。「登録無料・クレジットカード不要」（67行）。

### ステップ8: ホーム画面ツアー（`components/TutorialSlides.tsx`, 8スライド）
- 「サクッと入力」「怪我リスクチェック」「ストレッチ」「試合計画」「練習メニュー」「シェア」を紹介（28-83行）。**8スライド全てにチケット・無料枠・プランへの言及が一つもない**（grep確認済み）。ユーザーは自分が「無料チケット10枚」を持っていることも、AI機能が有料資源を消費することも、この時点では知らない。

### ステップ9: 初回の壁（実利用中、機能ごとに分散）
- `lib/adGate.ts` の`checkAdGate()`（144-202行）がゲート判定。AI機能はすべて共通チケットプールを消費（`lib/ticketWallet.ts:26-30`）: 動画分析2枚・AIメニュー2枚・食事分析1枚・食事コーチ2枚 等。
- 怪我系機能（`recovery`, `injury_recovery`）のみ2026-08よりチケット不要・無料開放（`lib/adGate.ts:48-53`、1日2回上限）— 差別化ポジション（怪我予防）を守る意図的設計、良い判断。
- 残高不足時 → `components/TicketGateModal.tsx` 表示。選択肢は「広告視聴+1枚（1日10回上限）」「チケット購入」「チケット月額プランへ」の3択（87-121行）。**割引・限定オファー・トライアルの提示は一切なし**。
- 日次/月次の絶対上限（コスト超過防止、`lib/adGate.ts:57-60,78`）に達した場合は`components/AdGateModal.tsx`が別UIで表示（116-146行）。

### ステップ10: ペイウォール本体（`app/paywall.tsx`）
- 3プラン同時表示: noad ¥480/月・ticket_monthly ¥1,280/月（「おすすめ」バッジ）・coach ¥1,980/月（44-77行）。noadとcoachのみ年額トグルあり、ticket_monthly（おすすめプラン）には年額オプションがない（非対称）。
- リード文（164-165行）:「怪我リスクチェックはずっと無料」+「AIによるフォーム診断・回復プランは無料チケットでスタート」。
- **無料トライアルの記載なし**（法的文言251-257行は自動更新の説明のみ。コード全体を`grep`しても`trial`関連の実装ゼロ）。
- 社会的証明（レビュー数・利用者数・「今週◯人が登録」等）・緊急性訴求（カウントダウン・期間限定）は一切なし。

### 見つかった実害バグ: プラン説明の矛盾
- `components/NoadUpsellModal.tsx:89` は広告なしプラン（noad）を「**全機能の回数制限が解除される**」と説明。
- しかし`app/paywall.tsx:51`はnoadプランについて明示的に「**AI機能はチケット制のまま**（無料10枚＋購入分）」と説明。
- 2026-08-06のチケット制カットオーバー後に新規加入したnoadユーザーは、AI機能は引き続きチケット制（`lib/adGate.ts:135`, `isLegacyUnlimitedNoad`は旧加入者のみ対象）。**この不一致は「AI使い放題だと思ってnoadに課金したら制限されていた」という失望・返金請求・低評価レビューに直結しうる**実装ミスであり、最優先で直すべき事実誤認。

### 計測の穴（診断の前提が崩れている）
- `lib/analytics.ts:111` の `trackUpgrade`（`upgrade_complete`イベント）は**コードベース全体で呼び出し箇所が0件**（grep確認済み）。
- `trackPaywallView`（`upgrade_view`）は`components/AdGateModal.tsx:62`からのみ呼ばれており、主要な詰まりポイントである`TicketGateModal.tsx`および`app/paywall.tsx`本体からは一度も呼ばれていない（`app/video-analysis.tsx`での実装確認済み: `TicketGateModal`は1677/2424行で表示されるが、その前後に`trackPaywallView`呼び出しなし）。
- つまり「ペイウォールを何人が見て、何人が閉じて、何人が買ったか」を自社ログから正確に追えない。RevenueCat側のダッシュボードで購入自体は追えるはずだが、**どの画面・どの機能から来た購入か**の紐付けが自社イベントでは取れていない。

---

## PART 2 — 外部ベストプラクティス調査

### (a) 価値実証→課金提示の順序

- **Duolingo**: ユーザーの学習目的を最初の3画面で選ばせ、パーソナライズの心理的契約を作る。ペイウォールは**初回レッスン完了後**に出す。パーソナライズにより無料→有料転換率を約4%→9%超に伸ばしたとされる。[Tasu.ai: Duolingo's Onboarding Flow](https://tasu.ai/library/duolingo) / [Appcues: Duolingo onboarding](https://goodux.appcues.com/blog/duolingo-user-onboarding)
- **Headspace**: 3分間の実際のガイド瞑想を体験させ、その**直後**にペイウォール（「効果を感じた瞬間」に合わせる設計）。[Airbridge: App Onboarding Before Paywall](https://www.airbridge.io/en/blog/5-steps-app-onboarding-before-the-paywall)
- **Noom**: 最大100画面超の質問フローで課金前に相当な時間投資をさせ、ペイウォール見出しにユーザー自身が入力した目標体重等を反映（「あなた専用の健康プランができました」）。クイズ完了者の**10%超**が有料転換（業界中央値2.7%と対比）。[Web2App World: Noom Funnel Breakdown](https://web2appworld.com/breakdowns/noom/) / [RevenueCat: Noom teardown](https://www.revenuecat.com/blog/growth/web-to-app-onboarding-funnel)

→ **sCOREとの比較**: sCOREの「processing」演出は本物のAI/データ処理を伴わない固定尺アニメーションで、「reveal」画面もStep3で集めた共感データやStep4の自己ベストを一切反映しない。Noom/Headspaceが示す"本物の価値を先に見せる"という核心部分が、演出はあるが中身がない状態になっている。

### (b) ペイウォールの出し方・タイミング

- ソフトペイウォール（価格を最初は見せず、体験させてから）とハードペイウォール（即決を迫る）の使い分け: **即効性のある体験（瞑想など）はハード寄り、フィットネス/習慣系のような漸進的価値はソフト寄りが良い**とされる。健康・フィットネス・生産性系アプリはソフトペイウォールの方が総購読者数で2〜3倍多いという分析がある一方、アップフロント（インストール直後）のペイウォールは中央値14日トライアル転換率約12%、コンテンツ後提示は約2%という対照データもある（アプリカテゴリ・チャネルにより差が大きい点に注意）。[RocketShip HQ: paywall timing](https://www.rocketshiphq.com/optimize-app-paywall-higher-conversion/) / [ContextSDK: Right Time to Show a Paywall](https://contextsdk.com/blogposts/the-right-time-to-show-a-paywall-how-smart-timing-increases-subscription-conversions)
- 複数ページ構成のオンボーディング型ペイウォールは単一ページ型より**37%高い転換率**（9.07%→12.41%、4000万件超のペイウォール表示データ分析）。[Superwall: Multi-page onboarding paywalls](https://superwall.com/blog/new-postmulti-page-onboarding-paywalls-convert-37-better-than-single-page-heres-why)
- インストール当日にトライアル開始の**82%**が発生する＝インストール直後が最も意欲が高い瞬間で、先延ばしにするほど意欲が減衰するという指摘。[dev.to: Paywall Timing Paradox](https://dev.to/paywallpro/the-paywall-timing-paradox-why-showing-your-price-upfront-can-5x-your-conversions-4alc)

→ **sCOREとの比較**: sCOREはオンボーディング〜チュートリアル完了までペイウォール露出が完全にゼロで、初回の価格提示は数セッション後（チケット枯渇時）まで先延ばしされている。上記の複数の研究と逆方向。

### (c) 無料トライアル構造

- Headspaceは月額プランに7日間、年額プランに14日間の無料トライアル。「7日間無料トライアル、その後月額$12.99。いつでもキャンセル可」という明快な文言で摩擦を減らす。[How Headspace Grows](https://www.howtheygrow.co/p/how-headspace-grows-the-monk-who)
- RevenueCatの分析: 17〜32日間の長めのトライアルは約**42.5%**が有料転換、4日未満の短いトライアルは約25.5%。ヘルス&フィットネスカテゴリはトライアル転換率が全カテゴリ中最高水準（中央値35%前後）。[RevenueCat: State of Subscription Apps 2026](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026/) / [businessofapps.com: Trial Benchmarks](https://www.businessofapps.com/data/app-subscription-trial-benchmarks/)
- ハードペイウォール（即課金）の35日転換率中央値10.7% vs フリーミアム2.1%、という対照データもあり、**トライアル/フリーミアム設計は一様に「弱い」わけではなく、設計次第で結果が大きく変わる**点は留意（出典間で数値の前提・母集団が異なるため単純比較は避けるべき）。[dev.to: Global Subscription App Conversion Benchmarks](https://dev.to/paywallpro/global-subscription-app-conversion-benchmarks-3c75)

→ **sCOREとの比較**: sCOREにはトライアルが存在しない（コード上確認済み）。ヘルス&フィットネス圏は特にトライアルとの相性が良いとされるカテゴリであり、ここが未着手なのは大きい。

### (d) パーソナライズ・コミットメントデバイス

- Whoopは「WHOOPにどう導いてほしいか」等5〜7問でユーザーを分類し、その後のガイダンスを分岐させる。5〜7問は許容範囲、各回答が明確にプランに反映されることが前提。[uxcam.com: Great User Onboarding](https://uxcam.com/blog/10-apps-with-great-user-onboarding/)
- Duolingoは「目標に応じてペイウォールの訴求軸を変える」（ショップ経由→ハート無制限訴求、広告経由→広告非表示訴求）などコンテキスト別ペイウォールを使う。[X post via Adapty summary](https://adapty.io/blog/how-to-personalize-onboarding-and-paywalls-in-your-mobile-app/)

→ **sCOREとの比較**: Step3の共感チェックリスト（怪我経験など）は集めているのに一切再利用されていない。ここに「あなたが選んだ『怪我で試合を棒に振った』という悩みを、sCOREのAI分析が解決します」のような、後段の壁・ペイウォールでの再利用余地がそのまま眠っている。

### (e) 価格ページの選択肢設計

- 3段階の価格プランは2段階より約1.4倍の転換率、4段階以上はそれより悪化するという分析（Price Intelligently系の分析）。[Evelance: Psychology Behind Pricing Tiers](https://evelance.io/blog/psychology-behind-pricing-tiers-that-sell/)
- アンカリング効果（高い参照価格を先に見せて中間プランを「妥当」に感じさせる）は複数の追試で再現性が比較的高い一方、「おとり（decoy）プラン」が中間プランの選択率を直接押し上げるという主張は**追試で再現性が低い**という指摘もあり、鵜呑みにしないほうがよい。[Atticus Li: The Decoy Effect Doesn't Replicate](https://atticusli.com/replication-crisis/decoy-effect-asymmetric-dominance/)
- RevenueCatの推奨: 年額プランをデフォルト表示にし、月額は「他のプランを見る」の奥に隠すことで年額契約が15〜20%増加した事例。月額価格を年額プランのアンカーとして併記する（「年払いで月あたり¥400」のような表現）と収益改善に寄与しやすい。[RevenueCat: essential guide to mobile paywalls](https://www.revenuecat.com/blog/growth/guide-to-mobile-paywalls-subscription-apps)

→ **sCOREとの比較**: 3プラン構成自体は研究上「最適な段数」の範囲内。ただし「おすすめ」プランに年額オプションがない非対称設計、チケット単発パック（2種）を含めると実質的な選択肢は多く、**壁に当たった瞬間（＝一番急いでいる瞬間）にフルの3段比較を見せる**設計は、コンテキストと合っていない可能性が高い。

### (f) 競合traqqerについて（確認できた事実・できなかった事実を分離）

**確認できた事実**（App Store掲載情報より）:
- traqqerの無料プランはAI機能（動画分析＋AIメニュー生成、合算）が**月3回まで**というシンプルな1本のキャップ。sCOREのような「チケット/コスト別配点/日次上限/月次上限/ストリーク/ミッション」という多層構造ではない。
- プレミアムプランは月額¥480（年額¥4,800）でAI機能が無制限になる、という**1段プラン**。sCOREの3段（¥480/¥1,280/¥1,980）より意思決定コストが低い設計。
- 単発チケットも存在（¥120単発／¥840・10枚パック）。
- オンボーディングでは「まず1回練習を記録してみよう」という**低摩擦な最初の一歩**を促す導線がある、との記載。
[App Store: traqqer](https://apps.apple.com/jp/app/traqqer-%E9%99%B8%E4%B8%8Aai%E3%82%B3%E3%83%BC%E3%83%81-%E7%B7%B4%E7%BF%92%E8%A8%98%E9%8C%B2/id6450506984)

**確認できなかった事実（推測で埋めない）**:
- traqqerの実際の転換率・LTV・トライアル有無・ペイウォールの正確な画面文言や表示タイミングは、App Store公開情報からは分からない。「もっとうまくやっている」という体感的評判はあるが、定量データの裏付けは今回の調査範囲では取得できなかった。
- 上記の「無料枠3回/月」情報はApp Store説明文ベースであり、実機で実際のフロー・画面遷移までは検証していない（御社側で実機確認することを推奨）。

---

## PART 3 — 優先度付き改善提案（Quick Win → 中規模投資の順）

### 1. 【最優先・最速】プラン説明の事実矛盾を修正する
- **該当箇所**: `components/NoadUpsellModal.tsx:89`「全機能の回数制限が解除される」を、`app/paywall.tsx:51`の正しい説明（noadはAIチケット制のまま）に合わせて修正。
- **根拠**: Headspace/Calmが評価される理由の一つが「7日間無料、その後¥◯◯、いつでもキャンセル可」という**明快さ**そのもの。逆に自社アプリ内で矛盾した説明をしていると、課金直後の失望・返金請求・低評価レビューという形で悪影響が出る（一般的なペイウォール透明性のベストプラクティスからの帰結）。
- **効果**: 直接の転換率改善ではなく、誤課金による返金・低評価という「漏れ」を止める防御的施策。実装工数は最小（数行）。

### 2. 【最優先・最速】購入ファネルの計測を直す
- **該当箇所**: `lib/analytics.ts:111`の`trackUpgrade`を実際の購入成功時（`app/paywall.tsx`の`handlePurchase`成功パス、`app/tickets.tsx`の`handlePurchase`成功パス）で呼び出す。`trackPaywallView`を`components/TicketGateModal.tsx`表示時と`app/paywall.tsx`のマウント時にも追加する（現状`components/AdGateModal.tsx:62`のみ）。
- **根拠**: 一般的なグロース手法（A/Bテスト・CRO）の大前提は「まず計測できていること」。以下の提案3〜9のどれが効いたかを判定するためにも、この計測の穴を埋めるのが実質的に最優先。
- **効果**: 直接コンバージョンは上げないが、**これがないと他の全ての施策の効果測定ができない**。工数は小さい（既存関数の呼び出し追加のみ）。

### 3. 【Quick Win】チュートリアルにチケット制度を1枚追加する
- **該当箇所**: `components/TutorialSlides.tsx`の`SLIDES`配列（28-83行、現在8枚）に、「🎫 無料AIチケット10枚をプレゼント！動画分析・AIメニュー作成などに使えます。ログイン継続や広告視聴でも増やせます」という説明スライドを1枚追加。
- **根拠**: Duolingoのハート制のように、**リソースが有限であることを事前に知らせておく**のは「ゲーム的な資源管理」として好意的に受け取られやすい（一方、予告なく壁にぶつかると「機能制限された」という否定的な体験になりやすい）。現状`grantStarterTicketsIfNeeded()`（`app/onboarding.tsx:681`）はユーザーに一切通知せず10枚を付与しており、後で`TicketGateModal`に初めて出会ったときの「え、チケットって何？」という認知コストが転換の妨げになっている可能性が高い。
- **効果**: 中程度。壁での離脱感情を和らげる効果が主。工数は小さい（スライド1枚追加）。

### 4. 【Quick Win〜中】オンボーディング直後にソフトペイウォールを1枚挟む
- **該当箇所**: `app/onboarding.tsx`の`handleFinish()`（644-688行）と`/(tabs)`遷移の間、または`app/auth.tsx`ログイン完了直後に、価格を強要しない「見るだけOK」なペイウォール画面を1回だけ挿入。
- **根拠**: 複数ページ構成のオンボーディング型ペイウォールは単一ページ型より37%高い転換率（[Superwall](https://superwall.com/blog/new-postmulti-page-onboarding-paywalls-convert-37-better-than-single-page-heres-why)）。インストール当日が最もトライアル開始の集中する瞬間（82%）で、先延ばしにするほど意欲が減衰する（[dev.to](https://dev.to/paywallpro/the-paywall-timing-paradox-why-showing-your-price-upfront-can-5x-your-conversions-4alc)）。DuolingoもNoomも「最初の価値提示の直後」にペイウォールを見せている。現状sCOREはオンボーディング〜チュートリアル完了まで一切ペイウォールに触れず、初回露出が数セッション後のチケット枯渇時まで先延ばしされている。
- **注意点（正直に）**: フィットネス/習慣系アプリは「すぐ体験させてから」のソフトペイウォールの方が総購読者数で有利という分析もあり（[RocketShip HQ](https://www.rocketshiphq.com/optimize-app-paywall-higher-conversion/)）、sCOREのように継続利用が前提のアプリでは「インストール直後にハードに課金を迫る」のではなく、**閉じられる・スキップできるソフトな1枚**として設計すべき。A/Bテストで実際に離脱率が悪化しないか検証を推奨。
- **効果**: 中〜大。工数は中程度（新規画面1枚、既存のpaywall.tsxのUIを流用可能）。

### 5. 【中規模】ticket_monthlyプランに無料トライアルを設定する
- **該当箇所**: App Store Connect / Google Play Console側の商品設定（`lib/purchaseService.ts:14`の`ticket_monthly`商品）にトライアル期間を追加。`app/paywall.tsx`の該当プランカードとlegal文言（250-257行）に「7日間無料、その後¥1,280/月」等の明記を追加。
- **根拠**: ヘルス&フィットネスはトライアル転換率が全カテゴリ最高水準（中央値35%前後）。17〜32日の長めトライアルは4日未満より転換率が高い傾向（42.5% vs 25.5%）（[RevenueCat](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026/)）。現状sCOREにはコード上・文言上ともにトライアルが一切存在しない。
- **注意点（正直に）**: 「ハードペイウォール（即課金）の方がトライアルより高転換率」という対照データも存在する（[dev.to](https://dev.to/paywallpro/global-subscription-app-conversion-benchmarks-3c75)）ため、トライアル導入が万能とは限らない。ただし0.12%という現状値は業界最低水準に近く、**まだ試していない主要レバーの一つ**として着手優先度は高い。
- **効果**: 大（未検証のレバーの中で最も裏付けが厚い）。工数は中（ストア側設定＋UI文言更新＋Apple審査再申請が必要）。

### 6. 【中規模】ペイウォールをコンテキストに応じて単純化する
- **該当箇所**: `components/TicketGateModal.tsx`の「チケット月額プランで毎月100枚」ボタン（116-121行）が`router.push('/paywall?plan=ticket_monthly')`に遷移した際、`app/paywall.tsx`側で該当プランのみを強調表示し、他2プランは「他のプランを見る」の折りたたみに格納する（現状は`initialPlan`をpre-selectするだけで3プラン全て並列表示、94行）。
- **根拠**: 3段階プランは2段階の約1.4倍の転換率という分析がある一方、選択肢が多いほど決定麻痺が起きるという研究（ジャムの実験: 6種類提示時30%購入 vs 24種類提示時3%購入）は広く支持されている。特に「壁に当たって急いでいる瞬間」に3プラン×年額トグルの比較検討を強いるのは文脈として重い。RevenueCatは年額をデフォルト表示にして月額を隠すことで15〜20%の年額契約増を報告（[RevenueCat](https://www.revenuecat.com/blog/growth/guide-to-mobile-paywalls-subscription-apps)）。
- **効果**: 中。工数は小〜中（既存`paywall.tsx`に折りたたみUIを追加）。

### 7. 【中規模】「reveal」画面を本物のパーソナライズにする
- **該当箇所**: `app/onboarding.tsx`のphase='processing'（700-723行）とphase='reveal'（726-760行）。固定文言「次の目標: 自己ベスト更新」（750行）を、Step3の共感チェックリスト（`IntroSlide3`, 218-258行、現状ローカルstateのみで破棄）とStep4の自己ベスト・年齢を使った**実際の初回怪我リスクスコア**（既存の`lib/injuryRisk.ts`の`calcInjuryRisk`をベースに、簡易入力からでも概算値を出す）に置き換える。
- **根拠**: Headspaceは3分間の本物の瞑想体験の直後にペイウォールを出す。Noomはユーザー自身が入力した目標体重をペイウォール見出しに反映し、業界平均の3倍超の転換率を得ている。「本物の一次体験→パーソナライズされた結果の提示」が転換の核。現状sCOREの「AIプランを生成中...」は完全に固定尺アニメーションで、実データも実AIも介在しない**見せかけの体験**になっている。差別化ポジションである「怪我予防」を、まさにこの一番注目される瞬間で実演できていない。
- **効果**: 大（ただし効果測定には提案2の計測修正が前提）。工数は中〜大（`calcInjuryRisk`の簡易入力対応、UI改修）。

### 8. 【中〜大規模】Step3の共感データをペイウォール・ゲート文言に再利用する
- **該当箇所**: `IntroSlide3`（`app/onboarding.tsx:218-258`）のチェック結果をプロフィールに保存し、`components/TicketGateModal.tsx`や`app/paywall.tsx`のコピーで「あなたが選んだ『練習を頑張っているのにタイムが伸びない』という悩みを解決するAI機能です」のように再利用する。
- **根拠**: Duolingoはコンテキスト別（ショップ経由/広告経由）にペイウォールの訴求軸を変える。Headspace/Noomは「ユーザー自身の言葉・目標を画面に反映すると転換率が上がる」という一貫した知見がある。現状sCOREは共感データを**集めるだけ集めて誰も見ない**状態になっている。
- **効果**: 中（正直に言うと、この項目については具体的な数値効果を示す一次資料までは確認できておらず、上記(a)(d)の一般原則からの類推）。工数は中（データ保存経路の追加＋各ゲート画面でのコピー分岐）。

### 9. 【継続的取り組み】A/Bテストの実施体制を作る
- **該当箇所**: 提案2の計測基盤が整った後、`app/paywall.tsx`のコピー・プラン提示順・トライアル有無などをRevenueCatのExperimentsやカスタムのフラグ分岐でテストする。
- **根拠**: 「最良のチームは執拗にテスト・実験・最適化を続けている」というのがペイウォール改善の一貫した知見（[RevenueCat: essential guide](https://www.revenuecat.com/blog/growth/guide-to-mobile-paywalls-subscription-apps)）。0.12%という現状値からは、単発の改修より継続的な検証サイクルの方が長期的な伸びしろが大きい。
- **効果**: 長期的に最大。ただし前提として計測基盤（提案2）が必須。

---

## 実行優先順位まとめ

| # | 施策 | 効果 | 工数 | 前提条件 |
|---|---|---|---|---|
| 1 | noad矛盾コピー修正 | 防御的（返金・低評価防止） | 極小 | なし |
| 2 | 購入ファネル計測修正 | 診断能力そのもの | 小 | なし |
| 3 | チュートリアルにチケット説明追加 | 中 | 小 | なし |
| 4 | オンボーディング直後にソフトペイウォール | 中〜大 | 中 | 2が先にあると効果測定可 |
| 5 | ticket_monthlyに無料トライアル | 大 | 中（ストア再申請含む） | なし |
| 6 | ペイウォールのコンテキスト別単純化 | 中 | 小〜中 | なし |
| 7 | reveal画面を本物のパーソナライズに | 大 | 中〜大 | 2が先にあると効果測定可 |
| 8 | 共感データの再利用 | 中（未検証） | 中 | 7と合わせて実施が効率的 |
| 9 | A/Bテスト体制構築 | 長期的に最大 | 継続 | 2が必須前提 |

**最初の1週間でやるなら**: #1（矛盾修正）→ #2（計測修正）→ #3（チュートリアル1枚追加）。ここまでは合計でも実装工数は小さく、#2により以降の施策の効果が初めて正しく測れるようになる。

---

## 調査の限界（正直な申告）

- traqqerの**実際の**転換率・トライアル有無・ペイウォール画面文言は、App Store公開情報以上のことは確認できていない。実機インストールでの検証を推奨。
- 各社の公開されている転換率数値（Duolingo 9%超、Noom 10%超等）は出典元の算出方法（分母が何か＝MAU全体かクイズ完了者か等）が異なり、単純にsCOREの0.12%と横並び比較できる数値ではない。あくまで「どの方向に伸びしろがあるか」の参考値として扱うこと。
- 「おとり（decoy）プラン効果」など、追試で再現性が低いとされる古典的マーケティング通説も一部の出典で言及されていたため、本レポートでは再現性への懸念がある論点は明記した。
- 本レポートはコードの静的読解に基づく。実機での実際のタップ挙動・アニメーション時間・実際のユーザーの離脱ポイントは別途、行動ログ（提案2実装後）や実機テストでの検証が必要。

# sCORE マスコットキャラクター — 画像生成＆実装指示

## 背景・目的

sCORE（陸上競技パフォーマンス管理アプリ、bundle: `com.scorejapan.score`）にオリジナルマスコットキャラクターを導入する。目的は主に2つ:

1. **怪我リスクスコア（0〜100の数値）を、キャラの表情変化で直感的に伝える**（数字だけだと感情移入しづらいため）
2. **ストレッチガイド機能で、各部位のストレッチのやり方をキャラが実演する**

ブランドカラー: ディープグリーン `#166534`（メイン）、ミントグリーン `#A7EE9C`（アクセント・グロー用）。

デザイン済みのキャラクター案が既にあり（添付画像参照）、白いカプセル型の丸ロボット、黒い艶やかな楕円バイザー顔、頭に小さな緑の葉、胸に光る緑の丸エンブレム（"SCORE"の文字入り）というデザインで確定している。以下はこのキャラクターの追加カット・実装先を指示するドキュメント。

---

## 1. キャラクター基本設定（全プロンプト共通・固定）

新しいカットを生成する際は、必ず以下を各プロンプトの先頭に含めること（表記ゆれ防止のため一言一句そのまま流用可）:

```
A cute 3D-rendered mascot robot character for a track-and-field sports app
called "sCORE". Round soft white/cream pill-shaped body, no visible neck.
Large oval glossy black visor face with two simple glowing white
almond-shaped eyes and a small curved smile line (no other facial
features). One small mint-green sprout leaf grows from the top of the
head like an antenna, gently curved. Stubby rounded mitten-like arms and
legs with no visible fingers or joints. A circular glowing emerald-green
"power core" emblem is embedded in the center of the chest, with the word
"SCORE" printed in small dark-green sans-serif letters just below it.
Material: smooth glossy ceramic/plastic toy-like surface with soft
ambient occlusion and a subtle rim light. Color palette: white/cream body,
deep forest green (#166534) and soft mint green (#A7EE9C) glowing accents.
Style: soft Pixar/Illumination-style 3D render, warm studio lighting,
shallow depth of field, clean and friendly, no text/logos other than
"SCORE". Consistent character design, same proportions every time.
```

---

## 2. 静止画生成プロンプト

### 2.1 既存6カット（統一感の基準・再掲）

| # | 用途 | 実装先候補 |
|---|---|---|
| ① | AIコーチ機能 | `app/(tabs)/index.tsx` AIアドバイスカード周辺 |
| ② | アプリ起動時/オンボーディング | `app/onboarding.tsx` |
| ③ | ストレッチ機能（総合） | `app/stretch-recovery.tsx` トップ |
| ④ | 自己ベスト更新時 | `components/PracticeShareCard.tsx` 周辺・トースト |
| ⑤ | 高リスク通知時 | `app/(tabs)/index.tsx` `ScoreOverviewCard`（怪我リスクカード） |
| ⑥ | アプリアイコン | `assets/icon.png` |

プロンプト本文は既に生成済みの画像と一致しているためここでは省略（別途共有済みの画像を正とする）。

### 2.2 新規：ストレッチガイド12部位

**実装先**: `app/stretch-recovery.tsx`、body part定義は `locales/ja.json` の `stretchRecovery.bodyParts`（12キー: `calf_achilles` / `adductor` / `ankle` / `chest_scapula` / `core` / `glutes` / `hamstring` / `hip` / `lower_back` / `quad` / `shoulder_neck` / `wrist_forearm`）。

土台プロンプト（`<POSE>` を下表の値に差し替えて12枚生成）:

```
[1章の基本設定プロンプトをここに挿入] The character demonstrates a stretch
with textbook-correct form: <POSE>. Calm focused expression, mouth in a
small neutral smile. A floating green UI card beside it shows the
stretch name in Japanese and a circular countdown timer icon. Soft
blurred green field background, warm natural light. Square 1:1,
character centered-left, card on the right, consistent camera angle and
lighting across all 12 variants so they read as one instructional set.
```

| ファイル名(推奨) | 部位キー | 日本語名 | `<POSE>` |
|---|---|---|---|
| stretch_calf_achilles.png | calf_achilles | ふくらはぎ | standing in a lunge facing a low wall, both hands pressed against it, back leg straight with heel flat on the ground, front knee bent |
| stretch_adductor.png | adductor | 内転筋 | seated on the ground, soles of both feet pressed together, knees dropped outward, gently leaning forward |
| stretch_ankle.png | ankle | 足首 | seated, one ankle resting on the opposite knee, using both hands to gently rotate the raised foot |
| stretch_chest_scapula.png | chest_scapula | 胸・肩甲骨 | standing, both arms pulled behind the back and clasped together, chest opened forward, shoulder blades squeezed together |
| stretch_core.png | core | 体幹・腹斜筋 | standing with feet apart, one arm raised overhead, torso leaning sideways in a gentle side-bend |
| stretch_glutes.png | glutes | お尻 | lying on the back, one ankle crossed over the opposite knee, both hands pulling the supporting thigh toward the chest |
| stretch_hamstring.png | hamstring | ハムストリング | seated, one leg extended straight forward, both hands reaching toward the toes, back straight |
| stretch_hip.png | hip | 股関節 | in a low lunge position, front knee bent at 90 degrees, back knee resting on the ground, hips pressed gently forward |
| stretch_lower_back.png | lower_back | 腰・背中 | on hands and knees, back arched upward like a cat, chin tucked toward the chest |
| stretch_quad.png | quad | 太もも前面 | standing on one leg, holding the opposite ankle behind the back with one hand, knees together, balancing calmly |
| stretch_shoulder_neck.png | shoulder_neck | 肩・首 | standing, head tilted gently to one side, one hand resting lightly on the side of the head, opposite shoulder relaxed down |
| stretch_wrist_forearm.png | wrist_forearm | 手首・前腕 | standing, one arm extended forward with palm facing out, using the opposite hand to gently pull the fingers back |

**実装メモ**: `stretch-recovery.tsx` は現状イラストを使わず部位名テキストのみで一覧表示している（要コード確認）。12枚を `assets/illustrations/stretches/` に配置し、`bodyParts` の各キーとファイル名をマッピングするオブジェクトを追加し、種目選択画面・実施画面の両方に表示する変更が必要。

### 2.3 その他の配置候補（優先度: 中）

**空データ画面**（練習記録がまだない時。実装先: `app/(tabs)/index.tsx` 等の空状態）
```
[基本設定] The character sits cross-legged on the ground looking slightly
upward with a curious, expectant expression, one hand shading its eyes
as if looking out for something on the horizon. Empty green running
track stretching into the distance, soft morning light. Plenty of
negative space above/around for UI text. Square 1:1.
```

**プッシュ通知アイコン**（実装先: `lib/notifications.ts` 通知ペイロード）
```
[基本設定] Extreme close-up of just the character's head, centered,
gently waving one small arm up near its face, friendly inviting
expression. Simple flat mint-green circular background, no scene/props,
designed to read clearly at very small sizes. 1:1 square, character
fills 80% of frame.
```

**ストリーク演出**（実装先: ホーム画面の継続日数表示）
```
[基本設定] The character stands proudly next to a floating row of 7 small
glowing green flame icons in a horizontal streak counter, pointing at
them with one hand, cheerful confident expression. Soft green track
background. Square 1:1, character on the left, streak counter UI element
on the right.
```

---

## 3. 動画（アニメーション）生成プロンプト

image-to-video系ツール向け。ソース画像は2章の該当静止画を使用。

**待機ループ**（スプラッシュ/ローディング。3〜4秒ループ）
```
The character gently breathes in and out, its chest slowly rising and
falling, the green chest emblem softly pulsing brighter and dimmer in
sync. The small leaf on its head sways very slightly as if in a light
breeze. Eyes blink once naturally halfway through. Subtle, slow, calm
looping motion, camera static.
```

**オンボーディング：メーターが溜まる演出**（4〜5秒。実装先: `app/onboarding.tsx` の `RiskMeterCTA`）
```
The character's chest emblem gradually glows brighter and pulses faster
as if charging up with energy, small green light particles rising around
its body. Near the end, it takes a determined step forward, fists
lightly clenched, ready to run. Camera stays static, soft ambient
particles increase in density toward the end.
```

**自己ベスト更新（お祝い）**（2〜3秒）
```
The character jumps up once with joy, cape flowing upward, both fists
pumping into the air, green confetti bursts and scatters outward from
the jump, landing back down with a small bounce and a wide happy smile.
Energetic, bouncy easing, camera has a very slight upward push-in.
```

**高リスク警告**（2〜3秒）
```
The character's chest emblem flashes from green to a brief amber-red
pulse twice, cape flutters as if a light wind picks up, the character
takes one step forward and raises one arm in a cautionary gesture, small
alarmed motion-lines appear briefly above its head then fade. Camera
static, slightly urgent pacing.
```

**ストレッチ実演**（12部位共通テンプレート。4〜5秒ループ）
```
The character slowly and smoothly moves from a neutral standing pose
into the stretch position shown, holding the final position with a
gentle breathing motion for the remainder of the clip. Slow, controlled,
demonstrative pacing suitable for a tutorial loop, no sudden movements.
Camera static, soft ambient lighting, holds the stretch pose for at
least 3 seconds.
```

---

## 4. 実装タスク一覧（Codex向け）

画像・動画アセットが揃った後にコード側で必要な作業:

1. `assets/illustrations/mascot/` 配下にキャラクター静止画一式を配置
2. `assets/illustrations/stretches/` 配下にストレッチ12部位の画像を配置し、`locales/*.json` の `stretchRecovery.bodyParts` の12キーとファイル名を対応させるマップを `lib/` か `app/stretch-recovery.tsx` 内に追加
3. `app/(tabs)/index.tsx` の `ScoreOverviewCard`（怪我リスクカード）に、`riskScore` の帯（low/caution/warning/high、既存の `buildRiskCfg` 関数の分岐と同じ閾値）に応じてキャラ画像を切り替える表示を追加
4. `app/onboarding.tsx` の `RiskMeterCTA` 内、メーターが溜まる演出に合わせてキャラのアニメーション動画（またはLottie変換したもの）を差し込む
5. PB更新時のシェアカード（`components/PracticeShareCard.tsx`）・トースト表示にお祝いカットを追加
6. 型チェック（`npx tsc --noEmit`）を通すこと

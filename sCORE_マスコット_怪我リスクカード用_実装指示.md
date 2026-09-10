# sCORE マスコットキャラクター — 怪我リスクスコアカード配置分

## 背景

`app/(tabs)/index.tsx` の怪我リスクスコアカード（`buildRiskCfg` / `RiskRing`）に、リスク帯に応じて表情が変わるマスコットキャラクターを配置する。実際のスコア閾値・カラーはコード上で以下の4段階に確定している（この通りに作ること。憶測で段階数を変えない）:

| 段階 | スコア範囲 | カラーコード |
|---|---|---|
| low（低リスク） | 0〜24 | `#166534`（BRAND、深緑） |
| caution（注意） | 25〜49 | `#f59e0b`（アンバー） |
| warning（警戒） | 50〜74 | `#f97316`（オレンジ） |
| high（高リスク） | 75〜100 | `#E53935`（ALERT、赤） |

## キャラクター基本設定（固定・毎回のプロンプト先頭に挿入）

```
A cute 3D-rendered mascot robot character for a track-and-field sports app
called "sCORE". Round soft white/cream pill-shaped body, no visible neck.
Large oval glossy black visor face with two simple glowing white
almond-shaped eyes and a small curved smile line (no other facial
features). One small mint-green sprout leaf grows from the top of the
head like an antenna, gently curved. Stubby rounded mitten-like arms and
legs with no visible fingers or joints. A circular glowing emblem is
embedded in the center of the chest, with the word "SCORE" printed in
small dark sans-serif letters just below it. Material: smooth glossy
ceramic/plastic toy-like surface with soft ambient occlusion and a
subtle rim light. Style: soft Pixar/Illumination-style 3D render, warm
studio lighting, shallow depth of field, clean and friendly, no
text/logos other than "SCORE". Consistent character design, same
proportions every time, front-facing bust shot only (head + upper body,
no legs), centered composition, isolated on a single flat solid
chroma-key green background (#00FF00), no shadows cast on the
background, even studio lighting on the subject only.
```

> ⚠️ **背景は「透過」ではなく「単色グリーンバック」で生成すること。** ほとんどの画像生成モデルはプロンプトで
> "transparent background" と指定してもアルファチャンネルを理解できず、実際には白や淡色の背景が乗ってしまう。
> 確実に透過PNGにするには、①単色（グリーンバック）で生成 → ②背景除去ツール（remove.bg / rembg / Photoshopの
> 被写体を選択、など）で切り抜く、の2段階が必要。単色は白でも良いが、キャラクター自体が白系の配色なので、
> 誤って本体まで削れないよう**キャラクターの色と被らないグリーン(#00FF00)を背景色に指定している**。

## 4段階の表情差分プロンプト

`<CHEST_COLOR>` はそのバンドのカラーコードで置き換える。

**① low（低リスク・0〜24）**
```
[基本設定, chest emblem glowing <CHEST_COLOR>=#166534] Relaxed, cheerful
expression, eyes in a happy relaxed curve, wide warm smile, one small
arm raised in a friendly wave. Chest emblem glows steadily bright and calm.
```

**② caution（注意・25〜49）**
```
[基本設定, chest emblem glowing <CHEST_COLOR>=#f59e0b] Neutral-attentive
expression, eyes slightly narrowed as if paying closer attention, mouth
in a small flat line (not smiling, not worried). Chest emblem glows
amber, steady, no flashing.
```

**③ warning（警戒・50〜74）**
```
[基本設定, chest emblem glowing <CHEST_COLOR>=#f97316] Slightly concerned
expression, eyebrrow area of the visor subtly furrowed (implied through
shading, no separate eyebrows), mouth flattened into a small worried
line, one hand touching the side of its own head as if uneasy. Chest
emblem glows orange, pulsing softly.
```

**④ high（高リスク・75〜100）**
```
[基本設定, chest emblem glowing <CHEST_COLOR>=#E53935] Clearly worried
expression, eyes narrowed and slightly tilted inward conveying concern,
small sweat-drop detail beside the head, both hands raised slightly in a
cautioning "stop/wait" gesture. Chest emblem glows red, pulsing more
noticeably than the other variants.
```

## 画像仕様

- 各1枚、正方形
- **生成時点ではグリーンバック(#00FF00)のPNG/JPG**（上記の理由により、透過は生成後の別工程で行う）
- 4枚を通して**カメラアングル・キャラクターのサイズ・構図を完全に統一**すること（表情差分としてクロスフェード/切り替え表示するため、位置がズレると違和感が出る）
- ファイル名（背景除去後の最終ファイル）: `mascot_risk_low.png` / `mascot_risk_caution.png` / `mascot_risk_warning.png` / `mascot_risk_high.png`
- 配置先: `assets/illustrations/mascot/`

## 背景透過の手順

1. 上記4枚をグリーンバックで生成する
2. 背景除去ツールで透過PNG化する（以下いずれか）
   - remove.bg（https://www.remove.bg/ja、無料枠あり、ブラウザでアップロードするだけ）
   - Photoshop / Affinity Photoの「被写体を選択」→背景削除
   - コマンドライン派なら `rembg` (`pip install rembg` → `rembg i input.png output.png`)
3. 透過後、`assets/illustrations/mascot/` に配置

**生成した4枚の画像をこちらに渡してもらえれば、背景除去はこちらで実行して透過済みファイルとして返すこともできます。**

## 実装指示（Codex向け）

1. 画像4枚を `assets/illustrations/mascot/` に配置
2. `app/(tabs)/index.tsx` の `buildRiskCfg()` が返す各段階オブジェクトに `mascotImage` フィールドを追加し、対応する画像をマッピングする
3. `RiskRing` コンポーネント、または呼び出し元のカード内に `<Image>` でキャラクターを表示。`effectiveRiskScore` から `buildRiskCfg(t).find(c => effectiveRiskScore <= c.max)` で該当バンドを取得し、その `mascotImage` を出し分ける（1920〜1921行目付近の既存ロジックと同じ判定を再利用する）
4. スコアが変化してバンドが切り替わる瞬間は、`Animated.Value` でのクロスフェード（`useNativeDriver: true`、200〜300ms）を入れて突然切り替わらないようにする
5. 型チェック（`npx tsc --noEmit`）を通すこと

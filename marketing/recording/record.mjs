// marketing/recording/record.mjs — sCORE SNS素材のスクリーン録画スクリプト
// 使い方はREADME.md参照。Expo Web(EXPO_PUBLIC_RECORDING_DEMO=1)が起動済みであること。
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RECORD_BASE_URL || 'http://localhost:8902'
const OUT_DIR = path.join(__dirname, 'out')
const DEMO_VIDEO_PATH = path.join(__dirname, 'assets', 'demo_practice.mp4')
const VIEWPORT = { width: 1080, height: 1920 }

fs.mkdirSync(OUT_DIR, { recursive: true })

// ── 初回セットアップ状態をlocalStorageに直接投入し、同意画面・オンボーディングUIを
//    毎回操作しなくても済むようにする（実際のAsyncStorageキー名はcontext/AuthContext.tsx・
//    app/_layout.tsxのソースを確認して一致させている）───────────────────────
function seedStorage() {
  localStorage.setItem('tm_onboarded', 'true')
  localStorage.setItem('tm_coach_mode', 'false')
  localStorage.setItem('userId', 'guest_demo_rec')
  localStorage.setItem('score_terms_accepted_v1', new Date().toISOString())
  // ヘッドレスChromiumのロケールがjaでないと言語選択モーダルが毎回出てしまうため、
  // 既に日本語を選択済みの状態にしておく(context/LanguageContext.tsxのLANGUAGE_KEY)
  localStorage.setItem('score_language_v1', 'ja')
}

// ── タップ位置に丸い波紋を出す演出（録画のタップ位置可視化用） ──────────────
function installRipple() {
  if (window.__rippleInstalled) return
  window.__rippleInstalled = true
  const style = document.createElement('style')
  style.textContent = `
    .__rec_ripple { position: fixed; z-index: 999999; pointer-events: none;
      width: 64px; height: 64px; margin-left: -32px; margin-top: -32px;
      border-radius: 50%; background: rgba(22,101,52,0.30); border: 3px solid rgba(22,101,52,0.85);
      transform: scale(0.25); opacity: 1; transition: transform 480ms cubic-bezier(.2,.8,.2,1), opacity 480ms ease-out; }
  `
  document.head.appendChild(style)
  function ripple(x, y) {
    const el = document.createElement('div')
    el.className = '__rec_ripple'
    el.style.left = x + 'px'
    el.style.top = y + 'px'
    document.body.appendChild(el)
    requestAnimationFrame(() => { el.style.transform = 'scale(1)'; el.style.opacity = '0' })
    setTimeout(() => el.remove(), 520)
  }
  window.addEventListener('pointerdown', e => ripple(e.clientX, e.clientY), true)
}

async function newRecordedContext(browser) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: OUT_DIR, size: VIEWPORT },
  })
  await context.addInitScript(seedStorage)
  await context.addInitScript(installRipple)
  const page = await context.newPage()
  return { context, page }
}

/** クリック(タップ)を、waitForで要素を待ってから実行する共通ヘルパー */
async function tapText(page, text, opts = {}) {
  const { exact = true, timeout = 20000 } = opts
  const loc = page.getByText(text, { exact }).first()
  await loc.waitFor({ state: 'visible', timeout })
  // react-native-webのレイヤー構造上、見た目には無関係な兄弟divがpointer-eventsを
  // 奪っていることがあるため、実タップと同じ挙動に寄せてforceで押す
  await loc.click({ force: true })
}

// recordVideo有効時、main threadがバンドル実行で長時間ブロックされていると
// document.body.innerTextは正しい値を返す一方で実際の画面はまだ塗られておらず、
// そのタイミングを開始点にすると真っ黒なクリップになってしまう。
// スクリーンショットの実バイト数（≒実際に描画された内容量）で「本当に描画された」ことを確認する。
async function waitForVisiblePaint(page, { timeout = 30000, minBytes = 15000 } = {}) {
  const start = Date.now()
  let lastLen = 0
  while (Date.now() - start < timeout) {
    const buf = await page.screenshot({ type: 'jpeg', quality: 40 }).catch(() => null)
    lastLen = buf ? buf.length : 0
    if (lastLen > minBytes) return
    await page.waitForTimeout(300)
  }
  console.warn(`waitForVisiblePaint: timed out (last screenshot bytes=${lastLen})`)
}

async function dismissLineBannerIfAny(page) {
  const later = page.getByText('あとで', { exact: true }).first()
  if (await later.isVisible().catch(() => false)) {
    await later.click({ force: true, timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(400)
  }
}

/** 画面下部に常時出る言語選択オーバーレイ(言語を選択/Select your language)を閉じる */
async function selectJapaneseIfShown(page) {
  const ja = page.getByText('日本語', { exact: true }).first()
  if (await ja.isVisible().catch(() => false)) {
    await ja.click({ force: true, timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(400)
  }
}

async function waitHomeReady(page) {
  console.log('  [waitHomeReady] waiting for initial content...')
  await page.waitForFunction(() => {
    const t = document.body.innerText
    return t.includes('クイックアクセス') || t.includes('LINEコミュニティ') || t.includes('今日まだ入力していないこと')
  }, undefined, { timeout: 90000 })
  console.log('  [waitHomeReady] initial content found, dismissing LINE banner if any...')
  await dismissLineBannerIfAny(page)
  console.log('  [waitHomeReady] waiting for クイックアクセス...')
  await page.waitForFunction(() => document.body.innerText.includes('クイックアクセス'), undefined, { timeout: 60000 })
  // 告知バナーは表示が数秒遅れて出ることがあるため、少し待って念のためもう一度確認する
  await page.waitForTimeout(1500)
  await dismissLineBannerIfAny(page)
  console.log('  [waitHomeReady] done')
}

/** 録画動画をffmpegでH.264 30fps mp4化し、指定秒数だけ切り出す。先頭フレームもPNG書き出し */
function finalizeClip(rawPath, outBaseName, { startSec, endSec }) {
  const mp4Path = path.join(OUT_DIR, `${outBaseName}.mp4`)
  const pngPath = path.join(OUT_DIR, `${outBaseName}.png`)
  const duration = Math.max(endSec - startSec, 1)
  execFileSync('ffmpeg', [
    '-y', '-ss', String(Math.max(startSec, 0)), '-i', rawPath, '-t', String(duration),
    '-vf', 'fps=30,scale=1080:1920:flags=lanczos',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-an', mp4Path,
  ], { stdio: 'inherit' })
  // 先頭フレームはスプラッシュ等の遷移が残っていることがあるため、少し進んだ位置から書き出す
  const thumbAt = Math.min(0.6, duration / 3)
  execFileSync('ffmpeg', ['-y', '-ss', String(thumbAt), '-i', mp4Path, '-frames:v', '1', pngPath], { stdio: 'inherit' })
  console.log(`✓ ${outBaseName}.mp4 / .png (${duration.toFixed(1)}s)`)
}

async function finish(context, page, outBaseName, t0, tStart, tEnd) {
  const video = page.video()
  await context.close() // これでビデオファイルが確定する
  const rawPath = await video.path()
  finalizeClip(rawPath, outBaseName, {
    startSec: (tStart - t0) / 1000 + 0.15,
    endSec: (tEnd - t0) / 1000 + 0.3,
  })
  fs.rmSync(rawPath, { force: true })
}

// ══════════════════════════════════════════════════════════════
// シナリオ1: home — ホームを開き、ゆっくりスクロールしてクイックアクセスを見せる
// ══════════════════════════════════════════════════════════════
async function recordHome(browser) {
  const { context, page } = await newRecordedContext(browser)
  const t0 = Date.now()
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 90000 })
  await selectJapaneseIfShown(page)
  await waitHomeReady(page)
  await waitForVisiblePaint(page)
  const tStart = Date.now()

  // ゆっくり下にスクロール
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, 140)
    await page.waitForTimeout(280)
  }
  await page.waitForTimeout(800)
  const tEnd = Date.now()

  await finish(context, page, 'rec_home', t0, tStart, tEnd)
}

// ══════════════════════════════════════════════════════════════
// シナリオ2: practice_input — 「サクッと入力」で練習を1件記録
// ══════════════════════════════════════════════════════════════
async function recordPracticeInput(browser) {
  const { context, page } = await newRecordedContext(browser)
  const t0 = Date.now()
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 90000 })
  await selectJapaneseIfShown(page)
  await waitHomeReady(page)
  await waitForVisiblePaint(page)
  const tStart = Date.now()

  await tapText(page, '今日の練習を記録しよう')
  await page.waitForFunction(() => document.body.innerText.includes('練習内容を自由に入力してください'), undefined, { timeout: 10000 })
  await page.waitForTimeout(400)

  const input = page.locator('textarea, input[type="text"]').first()
  await input.click({ force: true })
  await page.waitForTimeout(200)
  await page.keyboard.type('5000mのペース走を20分で走った。かなりきつかった。', { delay: 45 })
  await page.waitForTimeout(700)

  await tapText(page, '記録する')
  await page.waitForFunction(() => document.body.innerText.includes('練習を記録しました'), undefined, { timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const tEnd = Date.now()

  await finish(context, page, 'rec_practice_input', t0, tStart, tEnd)
}

// ══════════════════════════════════════════════════════════════
// シナリオ3: video_review — 動画分析を開き、フォームを見返す（スロー再生・一時停止）
// ══════════════════════════════════════════════════════════════
async function recordVideoReview(browser) {
  const { context, page } = await newRecordedContext(browser)
  const t0 = Date.now()
  // 静的エクスポートの/video-analysis.htmlへ直接遷移するとハイドレーション不整合で
  // ルーティングが崩れるため、home→「フォーム分析」ボタンのアプリ内遷移で開く
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 90000 })
  await selectJapaneseIfShown(page)
  await waitHomeReady(page)
  await tapText(page, 'フォーム分析')
  await page.waitForFunction(() => document.body.innerText.includes('動画を選ぶ'), undefined, { timeout: 30000 })
  await waitForVisiblePaint(page)
  const tStart = Date.now()

  await page.locator('input[type="file"]').setInputFiles(DEMO_VIDEO_PATH)
  await page.waitForFunction(() => document.body.innerText.includes('AIで分析スタート'), undefined, { timeout: 10000 })
  await page.waitForTimeout(400)

  await tapText(page, 'AIで分析スタート 🚀')
  await page.waitForFunction(() => document.body.innerText.includes('再生') || document.body.innerText.includes('一時停止'), undefined, { timeout: 15000 })
  await page.waitForTimeout(500)

  // 再生 → 少し見せる → 0.5倍速 → スローで見せる → 一時停止
  await tapText(page, '再生', { exact: false })
  await page.waitForTimeout(1600)
  const halfRate = page.getByText('0.5x', { exact: true }).first()
  if (await halfRate.isVisible().catch(() => false)) await halfRate.click({ force: true })
  await page.waitForTimeout(2400)
  const pauseBtn = page.getByText('一時停止', { exact: false }).first()
  if (await pauseBtn.isVisible().catch(() => false)) await pauseBtn.click({ force: true })
  await page.waitForTimeout(800)
  const tEnd = Date.now()

  await finish(context, page, 'rec_video_review', t0, tStart, tEnd)
}

// ══════════════════════════════════════════════════════════════
// シナリオ4: meet_countdown — 大会を登録し、カウントダウンが表示されるまで
// ══════════════════════════════════════════════════════════════
async function recordMeetCountdown(browser) {
  const { context, page } = await newRecordedContext(browser)
  const t0 = Date.now()
  // 静的エクスポートの/(tabs)/competition.htmlへ直接遷移するとハイドレーション不整合で
  // ルーティングが崩れるため、home→「カウントダウン」ミニカードのアプリ内遷移で開く
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 90000 })
  await selectJapaneseIfShown(page)
  await waitHomeReady(page)
  // LINEコミュニティ等の告知バナーは表示に数秒遅れることがあるため、少し待ってから再度確認する
  await page.waitForTimeout(1500)
  await dismissLineBannerIfAny(page)
  await tapText(page, 'カウントダウン')
  await page.waitForTimeout(800)
  await dismissLineBannerIfAny(page)
  await waitForVisiblePaint(page)
  const tStart = Date.now()

  // ① プラン選択モーダルの「試合を登録する」→ 試合計画タブ(空状態)へ
  await tapText(page, '試合を登録する')
  await page.waitForTimeout(800)
  await dismissLineBannerIfAny(page)
  // ② 空状態の「試合を登録する」→ 実際の登録フォームを開く
  await page.waitForFunction(() => document.body.innerText.includes('試合を登録しよう'), undefined, { timeout: 10000 })
  await tapText(page, '試合を登録する')
  await page.waitForFunction(() => document.body.innerText.includes('試合名'), undefined, { timeout: 10000 })
  await page.waitForTimeout(400)

  const nameInput = page.getByPlaceholder('例: 春季陸上競技大会').first()
  await nameInput.click({ force: true })
  await page.keyboard.type('新人歓迎記録会', { delay: 60 })
  await page.waitForTimeout(400)

  // 試合日はネイティブ<input type="date">。2週間後の未来日を明示的にセットする
  const future = new Date(Date.now() + 14 * 86400000)
  const dateStr = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`
  const dateInput = page.locator('input[type="date"]').first()
  await dateInput.fill(dateStr)
  await page.waitForTimeout(400)

  await tapText(page, 'AIで計画を作成する', { exact: false })
  await page.waitForFunction(() => document.body.innerText.includes('日後'), undefined, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const tEnd = Date.now()

  await finish(context, page, 'rec_meet_countdown', t0, tStart, tEnd)
}

const SCENARIOS = {
  home: recordHome,
  practice_input: recordPracticeInput,
  video_review: recordVideoReview,
  meet_countdown: recordMeetCountdown,
}

async function main() {
  const only = process.argv[2]
  const browser = await chromium.launch()
  try {
    const names = only ? [only] : Object.keys(SCENARIOS)
    for (const name of names) {
      console.log(`\n=== recording: ${name} ===`)
      await SCENARIOS[name](browser)
    }
  } finally {
    await browser.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })

// lib/sounds.ts — Web Audio API サウンドエンジン（爽快系リデザイン）
// ブラウザのみ動作。ネイティブはハプティクス代替。

let audioCtx: AudioContext | null = null
let unlocked = false

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
  if (!Ctx) return null  // React Native (iOS/Android) には AudioContext がない
  if (!audioCtx) {
    audioCtx = new Ctx()
  }
  return audioCtx
}

export function unlockAudio() {
  const c = getCtx()
  if (!c) return
  if (c.state === 'suspended') c.resume()
  unlocked = true
}

// ── 基本プリミティブ ──────────────────────────────────────────

/** 明るいサイン波ピン音。freq→freqEnd へピッチ変化、dur 秒で減衰 */
function ping(
  freq: number,
  dur: number,
  vol = 0.45,
  delay = 0,
  freqEnd?: number,
) {
  const c = getCtx()
  if (!c || !unlocked) return
  const t = c.currentTime + delay

  // メイン
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(freq, t)
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(vol, t + 0.004)       // 4ms 瞬間アタック
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur) // 滑らか減衰
  o.connect(g); g.connect(c.destination)
  o.start(t); o.stop(t + dur + 0.01)

  // 2倍音（明るさ・厚み）
  const o2 = c.createOscillator()
  const g2 = c.createGain()
  o2.type = 'sine'
  o2.frequency.setValueAtTime(freq * 2, t)
  if (freqEnd) o2.frequency.exponentialRampToValueAtTime(freqEnd * 2, t + dur * 0.5)
  g2.gain.setValueAtTime(0, t)
  g2.gain.linearRampToValueAtTime(vol * 0.28, t + 0.003)
  g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.55)
  o2.connect(g2); g2.connect(c.destination)
  o2.start(t); o2.stop(t + dur * 0.6)
}

/** 高域ノイズクリック — 「カチッ」というトランジェント感 */
function click(vol = 0.30, delay = 0, hiFreq = 3500) {
  const c = getCtx()
  if (!c || !unlocked) return
  const t = c.currentTime + delay
  const size = Math.floor(c.sampleRate * 0.010)
  const buf = c.createBuffer(1, size, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < size; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / size)
  const src = c.createBufferSource()
  src.buffer = buf
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'; bp.frequency.value = hiFreq; bp.Q.value = 1.2
  const g = c.createGain()
  g.gain.setValueAtTime(vol, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.010)
  src.connect(bp); bp.connect(g); g.connect(c.destination)
  src.start(t); src.stop(t + 0.012)
}

/** 短いホワイトノイズ（スウッシュ感） */
function swoosh(dur: number, vol = 0.18, delay = 0, cutoff = 800) {
  const c = getCtx()
  if (!c || !unlocked) return
  const t = c.currentTime + delay
  const size = Math.floor(c.sampleRate * dur)
  const buf = c.createBuffer(1, size, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buf
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'; hp.frequency.value = cutoff
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'; lp.frequency.value = cutoff * 3
  const g = c.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(vol, t + dur * 0.15)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(c.destination)
  src.start(t); src.stop(t + dur + 0.01)
}

// ── サウンドライブラリ ─────────────────────────────────────────
export const Sounds = {

  /** 汎用タップ — ガラスを軽くはじく「ティン」 */
  tap: () => {
    click(0.32, 0, 4000)
    ping(720, 0.13, 0.38)
  },

  /** セレクト / ポップ — 「ポン」と弾む */
  pop: () => {
    click(0.28, 0, 3200)
    ping(600, 0.18, 0.42, 0, 260)
  },

  /** ナビ / モーダル開く — 「シュッ」と軽快 */
  whoosh: () => {
    swoosh(0.22, 0.22, 0, 600)
    ping(520, 0.20, 0.35, 0.04, 780)
  },

  /** 保存完了 — ド・ミ・ソ チャイム（明るい達成感） */
  save: () => {
    // C5 = 523Hz, E5 = 659Hz, G5 = 784Hz
    click(0.20, 0.00, 4500)
    ping(523, 0.30, 0.48, 0.00)
    ping(659, 0.28, 0.44, 0.10)
    ping(784, 0.38, 0.50, 0.20)
  },

  /** 削除 — 「ポン↓」と落ちる */
  delete: () => {
    click(0.25, 0, 2800)
    ping(500, 0.25, 0.40, 0, 200)
  },

  /** エラー / 警告 — 「ブッ」と不協和 */
  error: () => {
    ping(320, 0.10, 0.38, 0.00)
    ping(300, 0.12, 0.35, 0.05)   // わずかにずれた不協和音
    ping(280, 0.14, 0.30, 0.12)
  },

  /** PB 達成 — 明るい5音ファンファーレ */
  pb: () => {
    const notes = [523, 659, 784, 1047, 1319] // C E G C E (オクターブ上)
    notes.forEach((f, i) => {
      click(0.18, i * 0.10, 4000 + i * 200)
      ping(f, 0.40, 0.44 + i * 0.02, i * 0.10)
    })
  },

  /** タブ切り替え — 「ティック」 */
  tabSwitch: () => {
    click(0.22, 0, 5000)
    ping(900, 0.09, 0.28)
  },

  /** トグル ON — 「ポン↑」明るく上がる */
  toggleOn: () => {
    click(0.24, 0, 3800)
    ping(440, 0.16, 0.40, 0, 660)
  },

  /** トグル OFF — 「ポン↓」落ち着く */
  toggleOff: () => {
    click(0.20, 0, 3200)
    ping(660, 0.16, 0.38, 0, 380)
  },

  /** カメラシャッター — 「カシャ」 */
  shutter: () => {
    click(0.40, 0, 6000)
    swoosh(0.06, 0.30, 0.001, 1200)
    ping(400, 0.15, 0.28, 0.01, 180)
  },

  /** カウント完了 — 「チーン」ベル */
  ding: () => {
    click(0.20, 0, 5500)
    ping(880, 0.50, 0.52)
    ping(1760, 0.35, 0.22, 0.01)  // オクターブ上で輝き
  },

  /**
   * スプラッシュ専用 — ズーン（深いバス）
   * unlocked チェックなし、resume() を試みる
   */
  splashBoom: () => {
    const c = getCtx()
    if (!c) return
    const play = () => {
      const now = c.currentTime
      // メインバス: 80Hz → 26Hz
      const o1 = c.createOscillator(), g1 = c.createGain()
      o1.type = 'sine'
      o1.frequency.setValueAtTime(80, now)
      o1.frequency.exponentialRampToValueAtTime(26, now + 0.75)
      g1.gain.setValueAtTime(0, now)
      g1.gain.linearRampToValueAtTime(0.90, now + 0.025)
      g1.gain.exponentialRampToValueAtTime(0.001, now + 0.90)
      o1.connect(g1); g1.connect(c.destination)
      o1.start(now); o1.stop(now + 0.95)
      // サブハーモニクス
      const o2 = c.createOscillator(), g2 = c.createGain()
      o2.type = 'sine'
      o2.frequency.setValueAtTime(160, now)
      o2.frequency.exponentialRampToValueAtTime(55, now + 0.50)
      g2.gain.setValueAtTime(0, now)
      g2.gain.linearRampToValueAtTime(0.38, now + 0.02)
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.62)
      o2.connect(g2); g2.connect(c.destination)
      o2.start(now); o2.stop(now + 0.65)
      // アタックノイズ
      const bufSize = Math.floor(c.sampleRate * 0.04)
      const buf = c.createBuffer(1, bufSize, c.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize)
      const src = c.createBufferSource()
      src.buffer = buf
      const filt = c.createBiquadFilter()
      filt.type = 'lowpass'; filt.frequency.value = 200
      const gn = c.createGain()
      gn.gain.setValueAtTime(0.55, now)
      gn.gain.exponentialRampToValueAtTime(0.001, now + 0.04)
      src.connect(filt); filt.connect(gn); gn.connect(c.destination)
      src.start(now); src.stop(now + 0.06)
    }
    if (c.state === 'suspended') { c.resume().then(play).catch(() => {}) }
    else { play() }
  },
}

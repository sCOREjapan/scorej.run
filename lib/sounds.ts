// lib/sounds.ts — サウンドエンジン（Web: Web Audio API / Native: expo-av + WAV合成）
import { Platform } from 'react-native'
import * as Haptics from 'expo-haptics'

// ── Web Audio API（Web のみ） ──────────────────────────────────────
let audioCtx: AudioContext | null = null
let unlocked = false

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
  if (!Ctx) return null
  if (!audioCtx) audioCtx = new Ctx()
  return audioCtx
}

export function unlockAudio() {
  const c = getCtx()
  if (!c) return
  if (c.state === 'suspended') c.resume()
  unlocked = true
}

function ping(freq: number, dur: number, vol = 0.45, delay = 0, freqEnd?: number) {
  const c = getCtx()
  if (!c || !unlocked) return
  const t = c.currentTime + delay
  const o = c.createOscillator(); const g = c.createGain()
  o.type = 'sine'; o.frequency.setValueAtTime(freq, t)
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur)
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.01)
  const o2 = c.createOscillator(); const g2 = c.createGain()
  o2.type = 'sine'; o2.frequency.setValueAtTime(freq * 2, t)
  if (freqEnd) o2.frequency.exponentialRampToValueAtTime(freqEnd * 2, t + dur * 0.5)
  g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(vol * 0.28, t + 0.003)
  g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.55)
  o2.connect(g2); g2.connect(c.destination); o2.start(t); o2.stop(t + dur * 0.6)
}

function click(vol = 0.30, delay = 0, hiFreq = 3500) {
  const c = getCtx()
  if (!c || !unlocked) return
  const t = c.currentTime + delay
  const size = Math.floor(c.sampleRate * 0.010)
  const buf = c.createBuffer(1, size, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < size; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / size)
  const src = c.createBufferSource(); src.buffer = buf
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = hiFreq; bp.Q.value = 1.2
  const g = c.createGain()
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.010)
  src.connect(bp); bp.connect(g); g.connect(c.destination); src.start(t); src.stop(t + 0.012)
}

function swoosh(dur: number, vol = 0.18, delay = 0, cutoff = 800) {
  const c = getCtx()
  if (!c || !unlocked) return
  const t = c.currentTime + delay
  const size = Math.floor(c.sampleRate * dur)
  const buf = c.createBuffer(1, size, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1
  const src = c.createBufferSource(); src.buffer = buf
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = cutoff
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff * 3
  const g = c.createGain()
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.15)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(c.destination); src.start(t); src.stop(t + dur + 0.01)
}

// ── ネイティブ WAV 合成 ───────────────────────────────────────────
// expo-av + expo-file-system を使って動的に WAV を生成して再生する

type NativeSoundDef = {
  tones: { freq: number; startMs: number; durMs: number; vol: number; sweep?: number }[]
  noise?: boolean   // ホワイトノイズ成分を追加
  totalMs: number
}

// WAV バイト列を生成（22050Hz, 16bit, mono）
function buildWAV(def: NativeSoundDef): Uint8Array {
  const SR = 22050
  const totalSamples = Math.floor(SR * def.totalMs / 1000)
  const pcm = new Float32Array(totalSamples)

  for (const tone of def.tones) {
    const startSample = Math.floor(SR * tone.startMs / 1000)
    const toneSamples = Math.floor(SR * tone.durMs / 1000)
    for (let i = 0; i < toneSamples; i++) {
      const t = i / SR
      const frac = i / toneSamples
      const freq = tone.sweep ? tone.freq + (tone.sweep - tone.freq) * frac : tone.freq
      const env = Math.max(0, 1 - frac)   // linear decay
      const sample = Math.sin(2 * Math.PI * freq * t) * tone.vol * env
      if (startSample + i < totalSamples) pcm[startSample + i] += sample
    }
  }

  if (def.noise) {
    for (let i = 0; i < totalSamples; i++) {
      const frac = i / totalSamples
      pcm[i] += (Math.random() * 2 - 1) * 0.15 * Math.max(0, 1 - frac)
    }
  }

  // クリッピング & 16bit 変換
  const dataSize = totalSamples * 2
  const header = new Uint8Array(44)
  const wStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) header[o + i] = s.charCodeAt(i) }
  const w16 = (o: number, v: number) => { header[o] = v & 0xFF; header[o+1] = (v >> 8) & 0xFF }
  const w32 = (o: number, v: number) => { header[o] = v & 0xFF; header[o+1] = (v>>8)&0xFF; header[o+2] = (v>>16)&0xFF; header[o+3] = (v>>24)&0xFF }
  wStr(0, 'RIFF'); w32(4, 36 + dataSize); wStr(8, 'WAVE'); wStr(12, 'fmt ')
  w32(16, 16); w16(20, 1); w16(22, 1); w32(24, SR); w32(28, SR * 2); w16(32, 2); w16(34, 16)
  wStr(36, 'data'); w32(40, dataSize)

  const out = new Uint8Array(44 + dataSize)
  out.set(header)
  for (let i = 0; i < totalSamples; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767)))
    out[44 + i * 2] = v & 0xFF
    out[44 + i * 2 + 1] = (v >> 8) & 0xFF
  }
  return out
}

function uint8ToBase64(buf: Uint8Array): string {
  let s = ''
  // チャンク処理でスタックオーバーフロー防止
  const CHUNK = 8192
  for (let i = 0; i < buf.length; i += CHUNK) {
    s += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  }
  return (globalThis as any).btoa(s)
}

// サウンド定義 ─────────────────────────────────────────────────────
const NATIVE_SOUND_DEFS: Record<string, NativeSoundDef> = {
  tap: {
    totalMs: 120,
    tones: [{ freq: 720, startMs: 0, durMs: 120, vol: 0.45 }],
  },
  pop: {
    totalMs: 180,
    tones: [{ freq: 600, startMs: 0, durMs: 180, vol: 0.42, sweep: 260 }],
  },
  whoosh: {
    totalMs: 200,
    noise: true,
    tones: [{ freq: 520, startMs: 30, durMs: 170, vol: 0.32, sweep: 780 }],
  },
  save: {
    totalMs: 420,
    tones: [
      { freq: 523, startMs: 0,   durMs: 300, vol: 0.46 },  // C5
      { freq: 659, startMs: 100, durMs: 280, vol: 0.42 },  // E5
      { freq: 784, startMs: 200, durMs: 260, vol: 0.48 },  // G5
    ],
  },
  delete: {
    totalMs: 220,
    tones: [{ freq: 500, startMs: 0, durMs: 220, vol: 0.40, sweep: 200 }],
  },
  tabSwitch: {
    totalMs: 90,
    tones: [{ freq: 900, startMs: 0, durMs: 90, vol: 0.32 }],
  },
  toggleOn: {
    totalMs: 160,
    tones: [{ freq: 440, startMs: 0, durMs: 160, vol: 0.40, sweep: 660 }],
  },
  toggleOff: {
    totalMs: 160,
    tones: [{ freq: 660, startMs: 0, durMs: 160, vol: 0.38, sweep: 380 }],
  },
  ding: {
    totalMs: 500,
    tones: [
      { freq: 880,  startMs: 0, durMs: 500, vol: 0.50 },
      { freq: 1760, startMs: 5, durMs: 200, vol: 0.28 },
    ],
  },
  pb: {
    totalMs: 550,
    tones: [
      { freq: 523,  startMs: 0,   durMs: 350, vol: 0.42 },
      { freq: 659,  startMs: 100, durMs: 320, vol: 0.42 },
      { freq: 784,  startMs: 200, durMs: 300, vol: 0.44 },
      { freq: 1047, startMs: 300, durMs: 280, vol: 0.46 },
      { freq: 1319, startMs: 400, durMs: 260, vol: 0.48 },
    ],
  },
  error: {
    totalMs: 280,
    tones: [
      { freq: 320, startMs: 0,   durMs: 200, vol: 0.38 },
      { freq: 290, startMs: 60,  durMs: 180, vol: 0.35 },
      { freq: 260, startMs: 130, durMs: 160, vol: 0.32 },
    ],
  },
}

// expo-av / expo-file-system の遅延インポートキャッシュ
let _Audio: typeof import('expo-av').Audio | null = null
let _FS: typeof import('expo-file-system/legacy') | null = null
let _audioReady = false

async function initNativeAudio() {
  if (_audioReady) return
  try {
    const av = await import('expo-av')
    _Audio = av.Audio
    await _Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    })
    _FS = await import('expo-file-system/legacy') as any
    _audioReady = true
  } catch {}
}

// 生成済みサウンドキャッシュ（key → Sound オブジェクト）
const _soundCache = new Map<string, import('expo-av').Audio.Sound>()

async function playNativeSound(key: string) {
  try {
    if (!_audioReady) await initNativeAudio()
    if (!_Audio || !_FS) return
    const def = NATIVE_SOUND_DEFS[key]
    if (!def) return

    if (!_soundCache.has(key)) {
      const wav = buildWAV(def)
      const path = (_FS as any).cacheDirectory + `score_sfx_${key}.wav`
      await (_FS as any).writeAsStringAsync(path, uint8ToBase64(wav), { encoding: 'base64' })
      const { sound } = await _Audio.Sound.createAsync({ uri: path }, { shouldPlay: false })
      _soundCache.set(key, sound)
    }
    const sound = _soundCache.get(key)!
    await sound.setPositionAsync(0)
    await sound.playAsync()
  } catch {
    // サイレント失敗（ハプティクスは別途動いている）
  }
}

// アプリ起動時に呼び出して全サウンドをプリロード
export async function preloadNativeSounds() {
  if (Platform.OS === 'web') return
  await initNativeAudio()
  // よく使うサウンドを事前生成してキャッシュ
  for (const key of ['tap', 'pop', 'whoosh', 'save', 'delete', 'tabSwitch', 'toggleOn', 'toggleOff', 'ding']) {
    await playNativeSound(key).catch(() => {})
    await new Promise(r => setTimeout(r, 10))  // 負荷分散
  }
}

// ── ハプティクスショートカット ──────────────────────────────────
const H = {
  light:   () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  medium:  () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  heavy:   () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}),
  select:  () => Haptics.selectionAsync().catch(() => {}),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
  error:   () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}),
}

// ── サウンドライブラリ ────────────────────────────────────────────
export const Sounds = {

  tap: () => {
    if (Platform.OS !== 'web') { H.select(); playNativeSound('tap'); return }
    click(0.32, 0, 4000); ping(720, 0.13, 0.38)
  },

  pop: () => {
    if (Platform.OS !== 'web') { H.light(); playNativeSound('pop'); return }
    click(0.28, 0, 3200); ping(600, 0.18, 0.42, 0, 260)
  },

  whoosh: () => {
    if (Platform.OS !== 'web') { H.medium(); playNativeSound('whoosh'); return }
    swoosh(0.22, 0.22, 0, 600); ping(520, 0.20, 0.35, 0.04, 780)
  },

  save: () => {
    if (Platform.OS !== 'web') { H.success(); playNativeSound('save'); return }
    click(0.20, 0.00, 4500); ping(523, 0.30, 0.48, 0.00); ping(659, 0.28, 0.44, 0.10); ping(784, 0.38, 0.50, 0.20)
  },

  delete: () => {
    if (Platform.OS !== 'web') { H.warning(); playNativeSound('delete'); return }
    click(0.25, 0, 2800); ping(500, 0.25, 0.40, 0, 200)
  },

  error: () => {
    if (Platform.OS !== 'web') { H.error(); playNativeSound('error'); return }
    ping(320, 0.10, 0.38, 0.00); ping(300, 0.12, 0.35, 0.05); ping(280, 0.14, 0.30, 0.12)
  },

  pb: () => {
    if (Platform.OS !== 'web') { H.success(); playNativeSound('pb'); return }
    const notes = [523, 659, 784, 1047, 1319]
    notes.forEach((f, i) => { click(0.18, i * 0.10, 4000 + i * 200); ping(f, 0.40, 0.44 + i * 0.02, i * 0.10) })
  },

  tabSwitch: () => {
    if (Platform.OS !== 'web') { H.select(); playNativeSound('tabSwitch'); return }
    click(0.22, 0, 5000); ping(900, 0.09, 0.28)
  },

  toggleOn: () => {
    if (Platform.OS !== 'web') { H.light(); playNativeSound('toggleOn'); return }
    click(0.24, 0, 3800); ping(440, 0.16, 0.40, 0, 660)
  },

  toggleOff: () => {
    if (Platform.OS !== 'web') { H.light(); playNativeSound('toggleOff'); return }
    click(0.20, 0, 3200); ping(660, 0.16, 0.38, 0, 380)
  },

  shutter: () => {
    if (Platform.OS !== 'web') { H.medium(); playNativeSound('pop'); return }
    click(0.40, 0, 6000); swoosh(0.06, 0.30, 0.001, 1200); ping(400, 0.15, 0.28, 0.01, 180)
  },

  ding: () => {
    if (Platform.OS !== 'web') { H.success(); playNativeSound('ding'); return }
    click(0.20, 0, 5500); ping(880, 0.50, 0.52); ping(1760, 0.35, 0.22, 0.01)
  },

  splashBoom: () => {
    if (Platform.OS !== 'web') { H.heavy(); return }
    const c = getCtx()
    if (!c) return
    const play = () => {
      const now = c.currentTime
      const o1 = c.createOscillator(), g1 = c.createGain()
      o1.type = 'sine'; o1.frequency.setValueAtTime(80, now); o1.frequency.exponentialRampToValueAtTime(26, now + 0.75)
      g1.gain.setValueAtTime(0, now); g1.gain.linearRampToValueAtTime(0.90, now + 0.025); g1.gain.exponentialRampToValueAtTime(0.001, now + 0.90)
      o1.connect(g1); g1.connect(c.destination); o1.start(now); o1.stop(now + 0.95)
      const o2 = c.createOscillator(), g2 = c.createGain()
      o2.type = 'sine'; o2.frequency.setValueAtTime(160, now); o2.frequency.exponentialRampToValueAtTime(55, now + 0.50)
      g2.gain.setValueAtTime(0, now); g2.gain.linearRampToValueAtTime(0.38, now + 0.02); g2.gain.exponentialRampToValueAtTime(0.001, now + 0.62)
      o2.connect(g2); g2.connect(c.destination); o2.start(now); o2.stop(now + 0.65)
      const bufSize = Math.floor(c.sampleRate * 0.04)
      const buf = c.createBuffer(1, bufSize, c.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize)
      const src = c.createBufferSource(); src.buffer = buf
      const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 200
      const gn = c.createGain(); gn.gain.setValueAtTime(0.55, now); gn.gain.exponentialRampToValueAtTime(0.001, now + 0.04)
      src.connect(filt); filt.connect(gn); gn.connect(c.destination); src.start(now); src.stop(now + 0.06)
    }
    if (c.state === 'suspended') { c.resume().then(play).catch(() => {}) } else { play() }
  },
}

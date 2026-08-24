// lib/sounds.ts — サウンドエンジン（Web: Web Audio API / Native: expo-av + WAV合成）
import { Platform } from 'react-native'
import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'

// ── 効果音 / バイブレーション ON-OFF 設定 ─────────────────────────
const SOUND_PREF_KEY   = 'score_sound_enabled'
const HAPTIC_PREF_KEY  = 'score_haptics_enabled'
let _soundEnabled  = true
let _hapticsEnabled = true

/** アプリ起動時に1回呼ぶ。保存済みの設定を読み込む */
export async function loadSoundPrefs(): Promise<void> {
  try {
    const [s, h] = await Promise.all([
      AsyncStorage.getItem(SOUND_PREF_KEY),
      AsyncStorage.getItem(HAPTIC_PREF_KEY),
    ])
    _soundEnabled   = s === null ? true : s === '1'
    _hapticsEnabled = h === null ? true : h === '1'
  } catch {}
}
export function isSoundEnabled():   boolean { return _soundEnabled }
export function isHapticsEnabled(): boolean { return _hapticsEnabled }
export async function setSoundEnabled(v: boolean): Promise<void> {
  _soundEnabled = v
  await AsyncStorage.setItem(SOUND_PREF_KEY, v ? '1' : '0').catch(() => {})
}
export async function setHapticsEnabled(v: boolean): Promise<void> {
  _hapticsEnabled = v
  await AsyncStorage.setItem(HAPTIC_PREF_KEY, v ? '1' : '0').catch(() => {})
}

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
  if (!_soundEnabled) return
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
  if (!_soundEnabled) return
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
  if (!_soundEnabled) return
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
  // スプレッド演算子は引数が多いとHermesでスタックオーバーフローするため1文字ずつ連結
  for (let i = 0; i < buf.length; i++) {
    s += String.fromCharCode(buf[i])
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
  // ── スターター（On your marks / Set / 号砲）・トレーニングタイマー専用 ──
  // これらは意味の違いを聞き分ける必要があるため、他の効果音と違いタブ切り替え音への
  // 統一はせず、個別の音を鳴らす（Sounds オブジェクトとは別の再生経路）。
  starterMarks: {
    totalMs: 160,
    tones: [{ freq: 880, startMs: 0, durMs: 160, vol: 0.55 }],
  },
  starterSet: {
    totalMs: 160,
    tones: [{ freq: 1175, startMs: 0, durMs: 160, vol: 0.55 }],
  },
  starterGun: {
    totalMs: 180,
    noise: true,
    tones: [{ freq: 110, startMs: 0, durMs: 150, vol: 0.6 }],
  },
  timerBeep: {
    totalMs: 140,
    tones: [{ freq: 1000, startMs: 0, durMs: 140, vol: 0.5 }],
  },
  timerEnd: {
    totalMs: 480,
    tones: [
      { freq: 784,  startMs: 0,   durMs: 220, vol: 0.5 },
      { freq: 988,  startMs: 140, durMs: 220, vol: 0.5 },
      { freq: 1319, startMs: 280, durMs: 260, vol: 0.55 },
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
  if (!_soundEnabled) return
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

// サウンドをキャッシュに登録するだけ（再生しない）
async function cacheNativeSound(key: string) {
  try {
    if (!_audioReady) await initNativeAudio()
    if (!_Audio || !_FS) return
    const def = NATIVE_SOUND_DEFS[key]
    if (!def || _soundCache.has(key)) return
    const wav = buildWAV(def)
    const path = (_FS as any).cacheDirectory + `score_sfx_${key}.wav`
    await (_FS as any).writeAsStringAsync(path, uint8ToBase64(wav), { encoding: 'base64' })
    const { sound } = await _Audio.Sound.createAsync({ uri: path }, { shouldPlay: false })
    _soundCache.set(key, sound)
  } catch {}
}

// アプリ起動時に呼び出してサウンドをプリロード（再生はしない）
// 全効果音が tabSwitch 音に統一されているため、これだけ事前生成すればよい
export async function preloadNativeSounds() {
  if (Platform.OS === 'web') return
  await initNativeAudio()
  await cacheNativeSound('tabSwitch').catch(() => {})
}

// ── 差し替え用の実音声（mp3）。バンドルされているものはこちらを優先して使う ──
// require() はMetroが静的解析するため呼び出し箇所を直接書く必要がある（変数化不可）。
// 未対応（まだファイルが無い）キューは undefined のままWAV合成にフォールバックする。
const CUSTOM_SOUND_ASSETS: Record<string, any> = {
  starterMarks: require('../assets/sounds/starter-marks.mp3'),
  starterSet:   require('../assets/sounds/starter-set.mp3'),
  starterGun:   require('../assets/sounds/starter-gun.mp3'),
}

const _bundledSoundCache = new Map<string, import('expo-av').Audio.Sound>()

async function playBundledSound(key: string): Promise<boolean> {
  const asset = CUSTOM_SOUND_ASSETS[key]
  if (!asset || !_soundEnabled) return false
  try {
    if (!_audioReady) await initNativeAudio()
    if (!_Audio) return false
    if (!_bundledSoundCache.has(key)) {
      const { sound } = await _Audio.Sound.createAsync(asset, { shouldPlay: false })
      _bundledSoundCache.set(key, sound)
    }
    const sound = _bundledSoundCache.get(key)!
    await sound.setPositionAsync(0)
    await sound.playAsync()
    return true
  } catch {
    return false
  }
}

async function cacheBundledSound(key: string) {
  const asset = CUSTOM_SOUND_ASSETS[key]
  if (!asset || _bundledSoundCache.has(key)) return
  try {
    if (!_audioReady) await initNativeAudio()
    if (!_Audio) return
    const { sound } = await _Audio.Sound.createAsync(asset, { shouldPlay: false })
    _bundledSoundCache.set(key, sound)
  } catch {}
}

// スターター／トレーニングタイマー画面に入った時点で呼ぶ。
// シーケンス進行中に初回生成の遅延が起きないよう事前にWAV/mp3をキャッシュしておく。
export async function preloadStarterSounds() {
  if (Platform.OS === 'web') return
  await initNativeAudio()
  await Promise.all([
    cacheBundledSound('starterMarks'),
    cacheBundledSound('starterSet'),
    cacheBundledSound('starterGun'),
    cacheNativeSound('starterMarks'),
    cacheNativeSound('starterSet'),
    cacheNativeSound('starterGun'),
    cacheNativeSound('timerBeep'),
    cacheNativeSound('timerEnd'),
  ])
}

// ── ハプティクスショートカット ──────────────────────────────────
const H = {
  light:   () => { if (!_hapticsEnabled) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}) },
  medium:  () => { if (!_hapticsEnabled) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}) },
  heavy:   () => { if (!_hapticsEnabled) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}) },
  select:  () => { if (!_hapticsEnabled) return; Haptics.selectionAsync().catch(() => {}) },
  success: () => { if (!_hapticsEnabled) return; Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}) },
  warning: () => { if (!_hapticsEnabled) return; Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}) },
  error:   () => { if (!_hapticsEnabled) return; Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}) },
}

// タブ切り替え音そのもの（全効果音の共通実体）
function playTabSwitchTone() {
  if (Platform.OS !== 'web') { playNativeSound('tabSwitch'); return }
  click(0.22, 0, 5000); ping(900, 0.09, 0.28)
}

// ── サウンドライブラリ ────────────────────────────────────────────
// 全アクションの効果音を「タブ切り替え音」に統一。ハプティクス（振動）だけは
// アクションごとの意味を残すため従来どおり出し分ける。
export const Sounds = {

  tap:        () => { H.select();  playTabSwitchTone() },
  pop:        () => { H.light();   playTabSwitchTone() },
  whoosh:     () => { H.medium();  playTabSwitchTone() },
  save:       () => { H.success(); playTabSwitchTone() },
  delete:     () => { H.warning(); playTabSwitchTone() },
  error:      () => { H.error();   playTabSwitchTone() },
  pb:         () => { H.success(); playTabSwitchTone() },
  tabSwitch:  () => { H.select();  playTabSwitchTone() },
  toggleOn:   () => { H.light();   playTabSwitchTone() },
  toggleOff:  () => { H.light();   playTabSwitchTone() },
  shutter:    () => { H.medium();  playTabSwitchTone() },
  ding:       () => { H.success(); playTabSwitchTone() },
  splashBoom: () => { H.heavy();   playTabSwitchTone() },
}

// ── スターター・トレーニングタイマー専用サウンド（意味を持つ音のため個別再生） ──
// 実音声(mp3)が用意されている場合はそちらを優先し、無ければ合成音にフォールバックする。
export function playStarterMarksCue() {
  H.light()
  if (Platform.OS !== 'web') {
    playBundledSound('starterMarks').then(ok => { if (!ok) playNativeSound('starterMarks') })
    return
  }
  ping(880, 0.16, 0.5)
}
export function playStarterSetCue() {
  H.light()
  if (Platform.OS !== 'web') {
    playBundledSound('starterSet').then(ok => { if (!ok) playNativeSound('starterSet') })
    return
  }
  ping(1175, 0.16, 0.5)
}
export function playStarterGunCue() {
  H.heavy()
  if (Platform.OS !== 'web') {
    playBundledSound('starterGun').then(ok => { if (!ok) playNativeSound('starterGun') })
    return
  }
  click(0.6, 0, 1800); ping(110, 0.15, 0.5)
}
export function playTimerBeep() {
  H.light()
  if (Platform.OS !== 'web') { playNativeSound('timerBeep'); return }
  ping(1000, 0.14, 0.45)
}
export function playTimerEnd() {
  H.success()
  if (Platform.OS !== 'web') { playNativeSound('timerEnd'); return }
  ping(784, 0.22, 0.45); ping(988, 0.22, 0.45, 0.14); ping(1319, 0.26, 0.5, 0.28)
}

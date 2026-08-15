// 手続き生成のみ。音声ファイルは1つも読み込まない（初回ロード0秒のため）。
import { clamp, rnd } from './util.js';

let ctx = null, master = null, musicGain = null, sfxGain = null, noiseBuf = null;
let muted = false, started = false;

export function audioInit() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  sfxGain = ctx.createGain(); sfxGain.gain.value = 0.55; sfxGain.connect(master);
  musicGain = ctx.createGain(); musicGain.gain.value = 0.0; musicGain.connect(master);

  // 白色ノイズのバッファ（打撃・爆発用）
  const len = ctx.sampleRate * 1.2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

/** iOS/Android はユーザー操作の中でしか鳴らせない */
export function audioResume() {
  audioInit();
  if (ctx && ctx.state === 'suspended') ctx.resume();
  started = true;
}

export function audioMuted(v) {
  if (v !== undefined) { muted = v; if (master) master.gain.value = muted ? 0 : 0.9; }
  return muted;
}

const now = () => ctx.currentTime;

function tone({ f = 440, f2 = null, t = 0.12, type = 'sine', g = 0.3, delay = 0, attack = 0.004, dest = null }) {
  if (!ctx || muted) return;
  const t0 = now() + delay;
  const o = ctx.createOscillator();
  const gn = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t0 + t);
  gn.gain.setValueAtTime(0.0001, t0);
  gn.gain.exponentialRampToValueAtTime(g, t0 + attack);
  gn.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
  o.connect(gn); gn.connect(dest || sfxGain);
  o.start(t0); o.stop(t0 + t + 0.02);
}

function noise({ t = 0.2, g = 0.3, delay = 0, lp = 1200, hp = 120, q = 1 }) {
  if (!ctx || muted) return;
  const t0 = now() + delay;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = lp; bp.Q.value = q;
  const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = hp;
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(g, t0);
  gn.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
  s.connect(hpf); hpf.connect(bp); bp.connect(gn); gn.connect(sfxGain);
  s.start(t0); s.stop(t0 + t + 0.02);
}

// --- 効果音 --------------------------------------------------------------

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];
const hz = semi => 220 * Math.pow(2, semi / 12);

/** 輪を閉じた瞬間。連鎖数で音階が駆け上がる。 */
export function sfxStitch(chain, size) {
  if (!ctx) return;
  const step = Math.min(chain - 1, PENTA.length - 3);
  const base = PENTA[step];
  tone({ f: hz(base + 24), f2: hz(base + 31), t: 0.16, type: 'triangle', g: 0.26 });
  tone({ f: hz(base + 31), t: 0.34, type: 'sine', g: 0.16, delay: 0.03 });
  tone({ f: hz(base + 36), t: 0.5, type: 'sine', g: 0.09, delay: 0.06 });
  noise({ t: 0.18, g: 0.1 + size * 0.12, lp: 5000, hp: 900 });
  if (chain >= 4) tone({ f: hz(base + 12), t: 0.6, type: 'sawtooth', g: 0.05, delay: 0.02 });
}

/** 何も囲めなかった輪。手応えだけ返す。 */
export function sfxEmpty() {
  tone({ f: 520, f2: 700, t: 0.07, type: 'sine', g: 0.045 });
}

export function sfxKill(n) {
  noise({ t: 0.07, g: clamp(0.03 + n * 0.006, 0.03, 0.14), lp: 2600, hp: 300 });
}

export function sfxHurt() {
  tone({ f: 180, f2: 42, t: 0.32, type: 'sawtooth', g: 0.3 });
  noise({ t: 0.3, g: 0.32, lp: 500 });
}

export function sfxPick() {
  tone({ f: rnd(1500, 2100), t: 0.05, type: 'sine', g: 0.05 });
}

export function sfxLevel() {
  [0, 4, 7, 12].forEach((s, i) => tone({ f: hz(24 + s), t: 0.7, type: 'triangle', g: 0.13, delay: i * 0.055 }));
}

export function sfxUnravel() {
  tone({ f: 900, f2: 60, t: 0.9, type: 'sawtooth', g: 0.22 });
  tone({ f: 55, t: 1.2, type: 'sine', g: 0.3 });
  noise({ t: 1.0, g: 0.4, lp: 7000, hp: 60 });
}

export function sfxBoss() {
  tone({ f: 70, f2: 34, t: 1.8, type: 'sawtooth', g: 0.3 });
  tone({ f: 104, f2: 51, t: 1.6, type: 'square', g: 0.1 });
  noise({ t: 1.6, g: 0.22, lp: 320 });
}

export function sfxUI() { tone({ f: 880, t: 0.05, type: 'square', g: 0.06 }); }
export function sfxSelect() {
  tone({ f: 660, t: 0.08, type: 'triangle', g: 0.12 });
  tone({ f: 990, t: 0.16, type: 'sine', g: 0.09, delay: 0.05 });
}

// --- BGM: 極小シーケンサ ---------------------------------------------------
// 8ステップのベース＋間引いたアルペジオ。緊張度 intensity(0..1) で密度と明度が上がる。
let seqTimer = 0, step = 0, intensity = 0, playing = false;
const BASS = [0, 0, 3, 0, 5, 3, -2, 0];

export function musicStart() {
  if (!ctx) return;
  playing = true; step = 0; seqTimer = 0;
  musicGain.gain.cancelScheduledValues(now());
  musicGain.gain.setTargetAtTime(0.28, now(), 1.2);
}

export function musicStop() {
  if (!ctx) return;
  playing = false;
  musicGain.gain.setTargetAtTime(0.0, now(), 0.5);
}

export function musicIntensity(v) { intensity = clamp(v, 0, 1); }

export function musicTick(dt) {
  if (!playing || !ctx || muted) return;
  const bpm = 96 + intensity * 34;
  const spb = 60 / bpm / 2;                 // 8分音符
  seqTimer -= dt;
  if (seqTimer > 0) return;
  seqTimer += spb;

  const s = step % 8;
  const root = BASS[s] - 12;
  tone({ f: hz(root), t: spb * 1.7, type: 'triangle', g: 0.2, dest: musicGain });
  if (s % 4 === 0) tone({ f: hz(root + 7), t: spb * 2.4, type: 'sine', g: 0.09, dest: musicGain });

  // 高音のきらめきは緊張度が上がるほど頻繁に
  if (Math.random() < 0.18 + intensity * 0.4) {
    const n = PENTA[(Math.random() * 8) | 0] + 24;
    tone({ f: hz(n), t: 0.22, type: 'sine', g: 0.07, dest: musicGain });
  }
  if (intensity > 0.55 && s % 2 === 1) {
    noise({ t: 0.05, g: 0.04, lp: 8000, hp: 4000 });
  }
  step++;
}

export const audioReady = () => started;

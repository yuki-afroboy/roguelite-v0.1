// 演出層。ゲームロジックからは切り離し、消えても進行に影響しないものだけを置く。
import { TAU, rnd, clamp, easeOut } from './util.js';

const MAX_P = 900;
const parts = [];
const rings = [];
const flashes = [];
const pops = [];

let shakeMag = 0, shakeX = 0, shakeY = 0;
let stopTimer = 0;
let flashAlpha = 0, flashCol = '255,255,255';

for (let i = 0; i < MAX_P; i++) parts.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, l: 0, ml: 1, s: 2, c: '255,255,255', d: 2.4, glow: 1 });
let cursor = 0;

function alloc() {
  for (let i = 0; i < MAX_P; i++) {
    const p = parts[cursor];
    cursor = (cursor + 1) % MAX_P;
    if (!p.on) return p;
  }
  return parts[cursor]; // 溢れたら最古を潰す
}

export function fxBurst(x, y, n, col, opt = {}) {
  const spd = opt.spd ?? 190, size = opt.size ?? 2.6, life = opt.life ?? 0.5;
  for (let i = 0; i < n; i++) {
    const p = alloc();
    const a = opt.dir !== undefined ? opt.dir + rnd(-opt.spread, opt.spread) : rnd(TAU);
    const v = spd * rnd(0.25, 1);
    p.on = true; p.x = x + rnd(-3, 3); p.y = y + rnd(-3, 3);
    p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v;
    p.l = p.ml = life * rnd(0.6, 1.35);
    p.s = size * rnd(0.6, 1.5); p.c = col; p.d = opt.drag ?? 2.6; p.glow = opt.glow ?? 1;
  }
}

/** 上昇する光の粒。縫い落とした獣の魂。 */
export function fxSoul(x, y, col = '255,217,138') {
  const p = alloc();
  p.on = true; p.x = x; p.y = y;
  p.vx = rnd(-26, 26); p.vy = rnd(-90, -40);
  p.l = p.ml = rnd(0.5, 1.1); p.s = rnd(1.2, 2.4); p.c = col; p.d = 0.7; p.glow = 1;
}

export function fxRing(x, y, r0, r1, life, col, w = 3) {
  rings.push({ x, y, r0, r1, l: life, ml: life, c: col, w });
}

/** 閉じた輪そのものを光らせる */
export function fxStitchFlash(flat, col, life = 0.42) {
  flashes.push({ flat, l: life, ml: life, c: col });
}

export function fxPop(x, y, text, col = '255,255,255', size = 15) {
  pops.push({ x, y, text, c: col, s: size, l: 0.85, ml: 0.85 });
}

export function fxShake(m) { shakeMag = Math.max(shakeMag, m); }
export function fxHitStop(t) { stopTimer = Math.max(stopTimer, t); }
export function fxScreenFlash(a, col = '255,255,255') { flashAlpha = Math.max(flashAlpha, a); flashCol = col; }

export function fxConsumeStop(dt) {
  if (stopTimer <= 0) return 0;
  const used = Math.min(stopTimer, dt);
  stopTimer -= used;
  return used;
}
export const fxStopped = () => stopTimer > 0;

export function fxClear() {
  for (const p of parts) p.on = false;
  rings.length = 0; flashes.length = 0; pops.length = 0;
  shakeMag = 0; stopTimer = 0; flashAlpha = 0;
}

export function fxUpdate(dt) {
  for (let i = 0; i < MAX_P; i++) {
    const p = parts[i];
    if (!p.on) continue;
    p.l -= dt;
    if (p.l <= 0) { p.on = false; continue; }
    const k = Math.exp(-p.d * dt);
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= k; p.vy *= k;
  }
  for (let i = rings.length - 1; i >= 0; i--) { rings[i].l -= dt; if (rings[i].l <= 0) rings.splice(i, 1); }
  for (let i = flashes.length - 1; i >= 0; i--) { flashes[i].l -= dt; if (flashes[i].l <= 0) flashes.splice(i, 1); }
  for (let i = pops.length - 1; i >= 0; i--) {
    const q = pops[i]; q.l -= dt; q.y -= 46 * dt;
    if (q.l <= 0) pops.splice(i, 1);
  }

  shakeMag *= Math.exp(-9 * dt);
  if (shakeMag < 0.15) shakeMag = 0;
  shakeX = rnd(-shakeMag, shakeMag);
  shakeY = rnd(-shakeMag, shakeMag);

  flashAlpha *= Math.exp(-7 * dt);
  if (flashAlpha < 0.004) flashAlpha = 0;
}

// 粒子は毎フレーム数百個。rgba 文字列を都度作るとGCが走るので16段階に量子化して使い回す。
const styleCache = new Map();
function styleFor(col, alpha) {
  const step = alpha <= 0 ? 0 : alpha >= 1 ? 16 : (alpha * 16) | 0;
  const key = col + step;
  let s = styleCache.get(key);
  if (s === undefined) { s = `rgba(${col},${(step / 16).toFixed(3)})`; styleCache.set(key, s); }
  return s;
}

export const fxShakeX = () => shakeX;
export const fxShakeY = () => shakeY;

/** カメラ変換が掛かった状態で呼ぶ（ワールド座標） */
export function fxDrawWorld(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (const f of flashes) {
    const t = f.l / f.ml;
    const flat = f.flat;
    ctx.beginPath();
    ctx.moveTo(flat[0], flat[1]);
    for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
    ctx.closePath();
    ctx.fillStyle = `rgba(${f.c},${0.17 * t * t})`;
    ctx.fill();
    ctx.lineWidth = 2 + 11 * (1 - t);
    ctx.strokeStyle = `rgba(${f.c},${0.85 * t})`;
    ctx.stroke();
  }

  for (const r of rings) {
    const t = 1 - r.l / r.ml;
    const rr = r.r0 + (r.r1 - r.r0) * easeOut(t);
    ctx.beginPath();
    ctx.arc(r.x, r.y, rr, 0, TAU);
    ctx.lineWidth = r.w * (1 - t * 0.75);
    ctx.strokeStyle = `rgba(${r.c},${0.9 * (1 - t)})`;
    ctx.stroke();
  }

  for (let i = 0; i < MAX_P; i++) {
    const p = parts[i];
    if (!p.on) continue;
    const t = p.l / p.ml;
    const a = clamp(t * 1.4, 0, 1) * p.glow;
    const s = p.s * (0.35 + t * 0.65);
    ctx.fillStyle = styleFor(p.c, a);
    ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
  }
  ctx.restore();
}

/** ワールド座標だが加算しない文字表示 */
export function fxDrawPops(ctx) {
  ctx.save();
  ctx.textAlign = 'center';
  for (const q of pops) {
    const t = q.l / q.ml;
    const sc = t > 0.8 ? 1 + (t - 0.8) * 2.2 : 1;
    ctx.globalAlpha = clamp(t * 1.6, 0, 1);
    ctx.font = `900 ${q.s * sc}px "Hiragino Kaku Gothic ProN",system-ui,sans-serif`;
    ctx.fillStyle = `rgb(${q.c})`;
    ctx.shadowColor = `rgba(${q.c},.9)`; ctx.shadowBlur = 12;
    ctx.fillText(q.text, q.x, q.y);
  }
  ctx.restore();
}

/** 画面座標での白フラッシュ */
export function fxDrawOverlay(ctx, w, h) {
  if (flashAlpha <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(${flashCol},${flashAlpha})`;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

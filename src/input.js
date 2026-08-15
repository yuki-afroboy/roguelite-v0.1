// 片手操作の要。画面のどこを押さえても、そこが仮想スティックの原点になる。
import { clamp } from './util.js';

const TAP_MS = 190;      // これ以下 & ほぼ動いていなければ「叩いた」
const TAP_SLOP = 15;     // px
const DEAD = 6;          // px
const RANGE = 58;        // ここまで倒せば最大速度

export const input = {
  active: false,
  dx: 0, dy: 0,          // 正規化された方向（長さ 0..1）
  ox: 0, oy: 0,          // スティック原点（CSS px）
  px: 0, py: 0,          // 現在の指の位置
  onTap: null,           // () => void
};

let downT = 0, moved = 0, pid = null;

function local(e) { return { x: e.clientX, y: e.clientY }; }

function down(e) {
  // UI（ボタン等）の上なら操作を奪わない
  if (e.target && e.target.closest && e.target.closest('.on')) return;
  if (pid !== null) return;
  pid = e.pointerId ?? 0;
  const p = local(e);
  input.active = true;
  input.ox = input.px = p.x;
  input.oy = input.py = p.y;
  input.dx = input.dy = 0;
  downT = performance.now();
  moved = 0;
  e.preventDefault();
}

function move(e) {
  if (!input.active || (e.pointerId ?? 0) !== pid) return;
  const p = local(e);
  input.px = p.x; input.py = p.y;
  let vx = p.x - input.ox, vy = p.y - input.oy;
  const len = Math.hypot(vx, vy);
  moved = Math.max(moved, len);

  if (len < DEAD) { input.dx = input.dy = 0; return; }

  // 指を大きく動かしたら原点を引きずる（親指の可動域が狭くても取り回せる）
  if (len > RANGE) {
    const pull = len - RANGE;
    input.ox += (vx / len) * pull;
    input.oy += (vy / len) * pull;
    vx = p.x - input.ox; vy = p.y - input.oy;
  }
  const l2 = Math.hypot(vx, vy);
  const mag = clamp((l2 - DEAD) / (RANGE - DEAD), 0, 1);
  input.dx = (vx / (l2 || 1)) * mag;
  input.dy = (vy / (l2 || 1)) * mag;
  e.preventDefault();
}

function up(e) {
  if ((e.pointerId ?? 0) !== pid) return;
  const dur = performance.now() - downT;
  if (dur < TAP_MS && moved < TAP_SLOP && input.onTap) input.onTap();
  pid = null;
  input.active = false;
  input.dx = input.dy = 0;
}

export function inputInit(target = window) {
  target.addEventListener('pointerdown', down, { passive: false });
  target.addEventListener('pointermove', move, { passive: false });
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
  window.addEventListener('contextmenu', e => e.preventDefault());
  // 指を離さずタブが切り替わった等の保険
  window.addEventListener('blur', () => { pid = null; input.active = false; input.dx = input.dy = 0; });
}

export function inputReset() { pid = null; input.active = false; input.dx = input.dy = 0; }

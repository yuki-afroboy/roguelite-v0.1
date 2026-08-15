// 縫夜 -NUIYO- / 数学・幾何・小物
// 依存なし。ここだけは徹底的に軽く保つこと（毎フレーム数百回叩かれる）。

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

// フレームレート非依存の指数補間
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const easeOut = t => 1 - Math.pow(1 - t, 3);
export const easeIn = t => t * t * t;

// --- 乱数 ---------------------------------------------------------------
export const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = arr => arr[(Math.random() * arr.length) | 0];
export const chance = p => Math.random() < p;

/** 重み付き抽選。items は {w:number} を持つ配列。 */
export function pickWeighted(items) {
  let total = 0;
  for (const it of items) total += it.w;
  let r = Math.random() * total;
  for (const it of items) { r -= it.w; if (r <= 0) return it; }
  return items[items.length - 1];
}

// --- 幾何 ---------------------------------------------------------------

/**
 * 線分 AB と CD の交点。交わらなければ null。
 * 端点の共有（連続する糸の節）は t/u の開区間判定で自然に弾かれる。
 */
export function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const r1 = bx - ax, r2 = by - ay;
  const s1 = dx - cx, s2 = dy - cy;
  const den = r1 * s2 - r2 * s1;
  if (den === 0) return null;              // 平行
  const qpx = cx - ax, qpy = cy - ay;
  const t = (qpx * s2 - qpy * s1) / den;
  const u = (qpx * r2 - qpy * r1) / den;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { x: ax + t * r1, y: ay + t * r2, t, u };
}

/** 符号付き面積の2倍。多角形は [x0,y0,x1,y1,...] のフラット配列。 */
export function polyArea2(flat) {
  let a = 0;
  for (let i = 0, n = flat.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += flat[i] * flat[j + 1] - flat[j] * flat[i + 1];
  }
  return a;
}

/** 点が多角形の内側か（レイキャスト法）。flat は [x,y,...]。 */
export function pointInPoly(flat, px, py) {
  let inside = false;
  const n = flat.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const yi = flat[i + 1], yj = flat[j + 1];
    if ((yi > py) !== (yj > py)) {
      const xi = flat[i], xj = flat[j];
      if (px < xi + ((py - yi) / (yj - yi)) * (xj - xi)) inside = !inside;
    }
  }
  return inside;
}

/** flat 多角形の外接矩形 */
export function polyBounds(flat) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i], y = flat[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

/** 点と線分の距離の2乗 */
export function pointSegDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return dist2(px, py, ax + dx * t, ay + dy * t);
}

// --- 小物 ---------------------------------------------------------------
export const fmtTime = s => {
  s = Math.max(0, s | 0);
  return `${String((s / 60) | 0).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const fmtNum = n => Math.round(n).toLocaleString('en-US');

export function store(key, val) {
  try {
    if (val === undefined) { const r = localStorage.getItem('nuiyo.' + key); return r === null ? null : JSON.parse(r); }
    localStorage.setItem('nuiyo.' + key, JSON.stringify(val));
  } catch { /* プライベートモード等。保存できなくても遊べる */ }
  return null;
}

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* 非対応端末 */ }
}

// ===== 本作の核 =====
// プレイヤーの軌跡そのものが武器。糸が自分自身と交差して輪が閉じた瞬間、
// その内側にいた獣は「縫い落とされる」。
// ここでは「等間隔リサンプリング」「自己交差検出」「輪の切り出し」だけを担う。
import { segIntersect, polyArea2, pointSegDist2, TAU, clamp, lerp } from './util.js';

const SPACING = 7;          // 節の間隔(px)。糸の長さ = maxPts * SPACING
const MIN_AREA = 950;       // これ未満の輪は「よれ」として無視（誤爆防止）
const SKIP = 2;             // 直近の節との交差は無視
const SNAP_DEFAULT = 24;    // 「あと少しで閉じる」を閉じたことにする距離
                            // 装備で変わるため this.snap で持つ（判定式は不変）

export class Thread {
  constructor() {
    this.p = [];            // [x0,y0,x1,y1,...] ワールド座標
    this.maxPts = 74;
    this.hot = 9;           // 先端の何節が「熱を持つ」か（接触ダメージ）
    this.age = 0;
    this.hx = 0; this.hy = 0; // 針そのものの位置（節と節の間を埋める）
    this.snap = SNAP_DEFAULT;
  }

  reset(x, y) { this.p.length = 0; this.p.push(x, y); this.hx = x; this.hy = y; }

  get count() { return this.p.length >> 1; }
  get fill() { return clamp(this.count / this.maxPts, 0, 1); }

  /**
   * 現在地まで糸を伸ばす。等間隔に節を打ちながら、節ごとに自己交差を調べる。
   * @returns {null|{flat:number[],area:number,cut:number}} 閉じた輪
   */
  extend(x, y) {
    const p = this.p;
    this.hx = x; this.hy = y;
    if (p.length === 0) { p.push(x, y); return null; }

    let guard = 24;         // 1フレームで打てる節の上限（ワープ対策）
    while (guard-- > 0) {
      const lx = p[p.length - 2], ly = p[p.length - 1];
      const dx = x - lx, dy = y - ly;
      const d = Math.hypot(dx, dy);
      if (d < SPACING) break;

      const nx = lx + (dx / d) * SPACING;
      const ny = ly + (dy / d) * SPACING;
      p.push(nx, ny);
      while (p.length > this.maxPts * 2) p.splice(0, 2);

      const loop = this._findLoop();
      if (loop) return loop;
    }
    return null;
  }

  /**
   * 最新の節が作った線分と、過去の線分との交わりを探す。最も古い交わり＝最大の輪。
   *
   * 厳密な交差だけを見ると、指で大きく回り込んで「あと数ピクセルで閉じる」場合に
   * 何も起きず、操作が死んだように感じられる。そこで SNAP 距離まで近づいたら
   * 触れたものとして扱う。輪ゲームとしての手触りはここで決まる。
   */
  _findLoop() {
    const p = this.p, n = p.length;
    if (n < 10) return null;
    const ax = p[n - 4], ay = p[n - 3], bx = p[n - 2], by = p[n - 1];
    const last = n - 4 - SKIP * 2;
    const snap2 = this.snap * this.snap;

    for (let i = 0; i < last; i += 2) {
      const cx = p[i], cy = p[i + 1], dx = p[i + 2], dy = p[i + 3];
      let X, Y;

      const hit = segIntersect(ax, ay, bx, by, cx, cy, dx, dy);
      if (hit) {
        X = hit.x; Y = hit.y;
      } else {
        if (pointSegDist2(bx, by, cx, cy, dx, dy) > snap2) continue;
        // 線分上の最近点へ寄せて、そこで閉じたことにする
        const ex = dx - cx, ey = dy - cy;
        const len2 = ex * ex + ey * ey;
        let t = len2 ? ((bx - cx) * ex + (by - cy) * ey) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        X = cx + ex * t; Y = cy + ey * t;
      }

      const flat = [X, Y];
      for (let k = i + 2; k < n; k += 2) flat.push(p[k], p[k + 1]);
      const area = Math.abs(polyArea2(flat)) * 0.5;
      if (area < MIN_AREA) continue;      // よれは無視して更に古い交わりを探す

      // 輪になった部分は糸から切り離される（＝大きく囲むほど糸を食う）
      this.p = p.slice(0, i + 2);
      this.p.push(X, Y);
      return { flat, area, cut: i };
    }
    return null;
  }

  /** 先端の熱を持つ区間に点が触れているか（半径 r 内） */
  touchesHot(x, y, r) {
    const p = this.p, n = p.length;
    const r2 = r * r;
    const hdx = this.hx - x, hdy = this.hy - y;
    if (hdx * hdx + hdy * hdy < r2) return true;
    const from = Math.max(0, n - this.hot * 2);
    for (let i = from; i < n; i += 2) {
      const dx = p[i] - x, dy = p[i + 1] - y;
      if (dx * dx + dy * dy < r2) return true;
    }
    return false;
  }

  /**
   * 「いま輪を閉じるとしたら、どこで、どれだけ囲えるか」を返す。
   *
   * 計測で分かった最悪の失敗は、大きく回り込みすぎて糸が届かず、
   * 何の反応も返らないまま死ぬこと（3回試して輪ゼロ・キルゼロ）。
   * 閉じられる相手が視界にあることを常時見せて、この無言状態を消す。
   */
  previewClose(range = 130) {
    const p = this.p, n = p.length;
    if (n < 10) return null;
    const hx = this.hx, hy = this.hy;
    const last = n - 4 - SKIP * 2;
    const r2 = range * range;

    for (let i = 0; i < last; i += 2) {
      const cx = p[i], cy = p[i + 1], dx = p[i + 2], dy = p[i + 3];
      if (pointSegDist2(hx, hy, cx, cy, dx, dy) > r2) continue;

      const ex = dx - cx, ey = dy - cy;
      const len2 = ex * ex + ey * ey;
      let t = len2 ? ((hx - cx) * ex + (hy - cy) * ey) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const X = cx + ex * t, Y = cy + ey * t;

      const flat = [X, Y];
      for (let k = i + 2; k < n; k += 2) flat.push(p[k], p[k + 1]);
      flat.push(hx, hy);
      const area = Math.abs(polyArea2(flat)) * 0.5;
      if (area < MIN_AREA) continue;

      const d = Math.sqrt(pointSegDist2(hx, hy, cx, cy, dx, dy));
      // 0=遠い 1=触れる寸前。これがそのまま表示の濃さになる
      return { flat, area, x: X, y: Y, near: clamp(1 - (d - this.snap) / (range - this.snap), 0, 1) };
    }
    return null;
  }

  update(dt) { this.age += dt; }

  /**
   * 糸を描く。1本のパスを 8 区画に割って色と太さを変え、
   * 尾（冷えた藍）→ 先端（灼けた金）のグラデーションを安価に作る。
   */
  draw(ctx, boost = 0) {
    const p = this.p, n = p.length >> 1;
    if (n < 2) return;

    const CH = 8;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let pass = 0; pass < 2; pass++) {
      const glow = pass === 0;
      for (let c = 0; c < CH; c++) {
        let i0 = Math.floor((c / CH) * (n - 1));
        let i1 = Math.floor(((c + 1) / CH) * (n - 1));
        if (i1 <= i0) continue;
        const t = (c + 0.5) / CH;                    // 0=尾 1=先端

        ctx.beginPath();
        ctx.moveTo(p[i0 * 2], p[i0 * 2 + 1]);
        for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(p[i * 2], p[i * 2 + 1]);
        if (c === CH - 1) ctx.lineTo(this.hx, this.hy);   // 節と針の隙間を埋める

        const r = Math.round(lerp(70, 255, t * t));
        const g = Math.round(lerp(170, 205, t));
        const b = Math.round(lerp(255, 95, t * t));
        const w = lerp(1.5, 3.8, t) + boost * 1.4;
        if (glow) {
          ctx.lineWidth = w * 3.4;
          ctx.strokeStyle = `rgba(${r},${g},${b},${0.04 + t * 0.055})`;
        } else {
          ctx.lineWidth = w;
          ctx.strokeStyle = `rgba(${r},${g},${b},${0.34 + t * 0.5})`;
        }
        ctx.stroke();
      }
    }

    // 針先の輝点
    const hx = this.hx, hy = this.hy;
    const gr = ctx.createRadialGradient(hx, hy, 0, hx, hy, 22 + boost * 10);
    gr.addColorStop(0, 'rgba(255,240,200,.85)');
    gr.addColorStop(.45, 'rgba(255,190,90,.25)');
    gr.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(hx, hy, 22 + boost * 10, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

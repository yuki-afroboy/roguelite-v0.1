// 獣（綻び）とその描画。スプライトは起動時に一度だけ焼き、以後は drawImage のみ。
import { TAU, rnd, rndInt, clamp, damp, dist2, pick } from './util.js';
import { fxBurst, fxSoul, fxRing, fxShake } from './fx.js';

// --- 種別定義 -------------------------------------------------------------
// 速度はプレイヤー(約216px/s)の 4〜6 割。追い付かれはしないが、
// 走れば必ず背後に尾を引いて群れが繋がる ── その尾を巻き取るのがこのゲームの気持ち良さ。
export const KIND = {
  hotsure: { k: '綻', hp: 7, r: 11, spd: 78, col: [157, 140, 255], xp: 1, sc: 10, ai: 'chase', stand: 42 },
  shitsu: { k: '疾', hp: 5, r: 9.5, spd: 94, col: [125, 240, 255], xp: 1, sc: 14, ai: 'dash' },
  retsu: { k: '裂', hp: 16, r: 15, spd: 76, col: [255, 138, 208], xp: 2, sc: 24, ai: 'chase', split: 2, stand: 48 },
  kake: { k: '欠', hp: 4, r: 7, spd: 124, col: [255, 176, 224], xp: 1, sc: 6, ai: 'chase', stand: 30 },
  toga: { k: '咎', hp: 14, r: 13, spd: 58, col: [255, 107, 107], xp: 3, sc: 32, ai: 'ranged' },
  yoroi: { k: '鎧', hp: 92, r: 19, spd: 52, col: [255, 196, 107], xp: 6, sc: 70, ai: 'chase', armor: 0.45, stand: 54 },
};

// 同時に跳びかかれる獣の数。群れの厚みと被弾率を切り離すための上限。
const LUNGE_LIMIT = 3;

// --- スプライト焼き付け ----------------------------------------------------
const sprites = new Map();

function bakeBlob(r, col, variant, armored) {
  const pad = Math.ceil(r * 1.05);   // 滲みが太いと画面全体が霞むので控えめに
  const S = Math.ceil((r + pad) * 2);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2, cy = S / 2;
  const [R, G, B] = col;

  // 外周の滲み
  const gr = g.createRadialGradient(cx, cy, r * 0.4, cx, cy, r + pad);
  gr.addColorStop(0, `rgba(${R},${G},${B},.30)`);
  gr.addColorStop(.4, `rgba(${R},${G},${B},.09)`);
  gr.addColorStop(1, `rgba(${R},${G},${B},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);

  // 不定形の体
  const lobes = 3 + (variant % 3);
  const seed = variant * 2.3;
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * TAU;
    const wob = 1 + 0.19 * Math.sin(a * lobes + seed) + 0.09 * Math.sin(a * (lobes + 3) - seed * 2);
    const rr = r * wob;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();

  const body = g.createRadialGradient(cx - r * .3, cy - r * .35, r * .1, cx, cy, r * 1.25);
  body.addColorStop(0, `rgba(${(R * .34) | 0},${(G * .34) | 0},${(B * .34) | 0},1)`);
  body.addColorStop(1, 'rgba(6,5,14,1)');
  g.fillStyle = body; g.fill();

  g.lineWidth = armored ? 2.8 : 1.7;
  g.strokeStyle = `rgba(${R},${G},${B},${armored ? .95 : .78})`;
  g.stroke();

  if (armored) {  // 鎧の裂け目
    g.lineWidth = 1;
    g.strokeStyle = `rgba(${R},${G},${B},.45)`;
    for (let i = 0; i < 3; i++) {
      const a = seed + i * 2.1;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r * .2, cy + Math.sin(a) * r * .2);
      g.lineTo(cx + Math.cos(a) * r * .95, cy + Math.sin(a) * r * .95);
      g.stroke();
    }
  }

  // 眼
  const eo = r * 0.34, ex = cx + r * 0.32;
  for (const sy of [-1, 1]) {
    const y = cy + sy * eo;
    const eg = g.createRadialGradient(ex, y, 0, ex, y, r * 0.46);
    eg.addColorStop(0, 'rgba(255,255,255,1)');
    eg.addColorStop(.3, `rgba(${R},${G},${B},.9)`);
    eg.addColorStop(1, `rgba(${R},${G},${B},0)`);
    g.fillStyle = eg;
    g.beginPath(); g.arc(ex, y, r * 0.46, 0, TAU); g.fill();
  }
  return { c, S, off: S / 2 };
}

export function bakeSprites() {
  for (const [name, d] of Object.entries(KIND)) {
    const arr = [];
    for (let v = 0; v < 3; v++) arr.push(bakeBlob(d.r, d.col, v, !!d.armor));
    sprites.set(name, arr);
  }
  // 被弾フラッシュ用の白抜き
  for (const [name, d] of Object.entries(KIND)) {
    const arr = [];
    for (let v = 0; v < 3; v++) arr.push(bakeBlob(d.r, [255, 255, 255], v, !!d.armor));
    sprites.set(name + '!', arr);
  }
}

// --- 空間グリッド ----------------------------------------------------------
export class Grid {
  constructor(cell = 64) { this.cell = cell; this.m = new Map(); }
  clear() { this.m.clear(); }
  key(cx, cy) { return cx * 73856093 ^ cy * 19349663; }
  insert(i, x, y) {
    const c = this.cell;
    const k = this.key(Math.floor(x / c), Math.floor(y / c));
    let a = this.m.get(k);
    if (!a) { a = []; this.m.set(k, a); }
    a.push(i);
  }
  /** 矩形に触れるセルの中身を out に集める */
  query(x0, y0, x1, y1, out) {
    const c = this.cell;
    const cx0 = Math.floor(x0 / c), cy0 = Math.floor(y0 / c);
    const cx1 = Math.floor(x1 / c), cy1 = Math.floor(y1 / c);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const a = this.m.get(this.key(cx, cy));
        if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
      }
    }
    return out;
  }
}

// --- 獣の群れ --------------------------------------------------------------
export class Swarm {
  constructor(cap = 700) {
    this.cap = cap;
    this.a = [];
    for (let i = 0; i < cap; i++) {
      this.a.push({
        on: false, x: 0, y: 0, vx: 0, vy: 0, hp: 1, mhp: 1, r: 10, kind: 'hotsure',
        spd: 40, t: 0, cd: 0, flash: 0, v: 0, rot: 0, spin: 0, sc: 1, elite: false,
        frozen: 0, hitId: 0, lunge: 0,
      });
    }
    this.alive = 0;
    this.grid = new Grid(70);
    this._q = [];
  }

  clear() { for (const e of this.a) e.on = false; this.alive = 0; }

  spawn(kind, x, y, hpMul = 1, elite = false) {
    if (this.alive >= this.cap) return null;
    for (let i = 0; i < this.cap; i++) {
      const e = this.a[i];
      if (e.on) continue;
      const d = KIND[kind];
      e.on = true; e.kind = kind; e.x = x; e.y = y;
      e.vx = e.vy = 0;
      e.sc = elite ? 1.42 : rnd(0.92, 1.08);
      e.r = d.r * e.sc;
      e.mhp = e.hp = d.hp * hpMul * (elite ? 4.2 : 1);
      e.spd = d.spd * (elite ? 0.82 : rnd(0.9, 1.12));
      e.t = rnd(TAU); e.cd = rnd(0.4, 2.2); e.flash = 0;
      e.v = rndInt(0, 2); e.rot = rnd(TAU); e.spin = rnd(-0.5, 0.5);
      e.elite = elite; e.frozen = 0; e.hitId = 0; e.lunge = 0;
      this.alive++;
      return e;
    }
    return null;
  }

  update(dt, G) {
    const px = G.player.x, py = G.player.y;
    const grid = this.grid;
    grid.clear();
    const a = this.a;

    let lunging = 0;
    for (let i = 0; i < this.cap; i++) {
      const e = a[i];
      if (!e.on) continue;
      grid.insert(i, e.x, e.y);
      if (e.lunge > 0) lunging++;
    }

    const lure = G.stats.lure;
    for (let i = 0; i < this.cap; i++) {
      const e = a[i];
      if (!e.on) continue;
      const d = KIND[e.kind];
      e.t += dt;
      e.flash = Math.max(0, e.flash - dt * 5);
      e.rot += e.spin * dt;

      if (e.frozen > 0) { e.frozen -= dt; e.x += e.vx * dt * 0.1; e.y += e.vy * dt * 0.1; continue; }

      let dx = px - e.x, dy = py - e.y;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl; dy /= dl;

      let ax = 0, ay = 0;
      const spd = e.spd * (1 + lure * 0.15) * G.slowFactorFor(e);

      if (d.ai === 'dash') {
        // 突進の前に溜めを置く。溜め中は膨れて見えるので（draw 側）、
        // 「来る」ことが読めてから来る。予告なしの突進は夜3以降で被弾の
        // 3〜6割を占めていたため、避けられる形に変えた。
        e.cd -= dt;
        if (e.lunge > 0) {
          e.lunge -= dt;
          e.vx = damp(e.vx, 0, 8, dt); e.vy = damp(e.vy, 0, 8, dt);
          if (e.lunge <= 0) { e.vx = dx * spd * 1.9; e.vy = dy * spd * 1.9; }
        } else if (e.cd <= 0) {
          e.cd = rnd(1.5, 2.3); e.lunge = 0.3;
        } else {
          e.vx = damp(e.vx, dx * spd * 0.7, 3.2, dt);
          e.vy = damp(e.vy, dy * spd * 0.7, 3.2, dt);
        }
      } else if (d.ai === 'ranged') {
        const want = 200;
        const push = dl > want ? 1 : -1.15;
        const sway = Math.sin(e.t * 1.1) * 0.55;
        ax = (dx * push - dy * sway) * spd;
        ay = (dy * push + dx * sway) * spd;
        e.vx = damp(e.vx, ax, 4, dt); e.vy = damp(e.vy, ay, 4, dt);
        e.cd -= dt;
        if (e.cd <= 0 && dl < 460) {
          e.cd = rnd(2.9, 4.1);
          G.bullets.spawn(e.x, e.y, dx * 118, dy * 118, 8, [255, 107, 107]);
        }
      } else {
        // 獣は間合いを取らない。常にこちらへ押し寄せる。
        //
        // 「触れているだけでは痛くない」を入れたとき、一緒に後退挙動も
        // 入れてしまい、近づくと逃げていく＝手応えのない群れになっていた。
        // 削られない仕組みは接触判定側（下の hurtPlayer 分岐）だけで足りるので、
        // 動きは素直に「寄ってくる」へ戻す。痛いのは跳びかかった一瞬だけ。
        const stand = d.stand || 0;
        if (stand > 0) {
          e.cd -= dt;
          if (e.cd <= 0) {
            if (lunging < LUNGE_LIMIT) { e.cd = rnd(2.2, 3.8); e.lunge = 0.5; lunging++; }
            else e.cd = 0.25;                    // 順番待ち
          }
          if (e.lunge > 0) e.lunge -= dt;
        }
        const sway = Math.sin(e.t * 1.6 + e.v) * 0.28;
        const surge = e.lunge > 0 ? 1.55 : 1;      // 跳びかかりは速い＝見て分かる
        ax = (dx - dy * sway) * spd * surge;
        ay = (dy + dx * sway) * spd * surge;
        e.vx = damp(e.vx, ax, 5, dt); e.vy = damp(e.vy, ay, 5, dt);
      }

      // 分離（密になり過ぎると輪の快感が濁るので、軽く押し合う）
      if (((i + G.frame) & 1) === 0) {
        const q = this._q; q.length = 0;
        grid.query(e.x - 26, e.y - 26, e.x + 26, e.y + 26, q);
        let sx = 0, sy = 0, cnt = 0;
        for (let j = 0; j < q.length; j++) {
          const o = a[q[j]];
          if (o === e || !o.on) continue;
          const ox = e.x - o.x, oy = e.y - o.y;
          const d2 = ox * ox + oy * oy;
          const rr = (e.r + o.r) * 0.92;
          if (d2 < rr * rr && d2 > 0.01) {
            const inv = 1 / Math.sqrt(d2);
            sx += ox * inv; sy += oy * inv; cnt++;
            if (cnt > 5) break;
          }
        }
        if (cnt) { e.vx += sx * 42 * dt * 2; e.vy += sy * 42 * dt * 2; }
      }

      e.x += e.vx * dt; e.y += e.vy * dt;

      // 遠く離れすぎた個体は回収（画面外で無限に彷徨わせない）
      if (dist2(e.x, e.y, px, py) > 1700 * 1700) { e.on = false; this.alive--; continue; }

      // 接触。
      //
      // 「囲む」には必ず群れの中へ戻る必要があり、群れは常にこちらへ寄ってくる。
      // つまり回り込む動線上には必ず体が置かれる ── これは間合いを調整しても
      // 消えない、機構そのものが持つ幾何。実測でも被弾の 100% が基本種だった。
      // そこで基本種の「ただ触れているだけ」は痛くせず、押しのけて通す。
      // 針は布を裂かずに分けて進む、という筋も通る。
      // 痛いのは跳びかかってきた個体・精鋭・専門種だけ。
      const rr = e.r * 0.78 + G.player.r * 0.8;
      if (dist2(e.x, e.y, px, py) < rr * rr) {
        if (!d.stand || e.lunge > 0 || e.elite) {
          G.hurtPlayer(e);
        } else {
          // 重なりを解くだけ。速度には触らない。
          //
          // ここを速度への加算にすると、接触している間ずっと毎フレーム
          // 足され続け、減衰と釣り合う定常速度が敵自身の速度の十数倍に達する。
          // 結果、獣が針から猛烈に弾き飛ばされ「近づくと逃げる」ように見えていた。
          // 位置をずらすだけなら、押し合いへし合いしながら寄り続ける。
          const ox = e.x - px, oy = e.y - py;
          const od = Math.hypot(ox, oy) || 1;
          const overlap = rr - od;
          if (overlap > 0) {
            e.x += (ox / od) * overlap;
            e.y += (oy / od) * overlap;
          }
        }
      }

      // 針先の熱
      if (G.stats.needle > 0 && G.thread.touchesHot(e.x, e.y, e.r + 7)) {
        this.damage(e, G.stats.needle * dt, G, false);
      }
    }
  }

  damage(e, amount, G, byLoop) {
    if (!e.on) return 0;
    const d = KIND[e.kind];
    let amt = amount;
    if (d.armor && !G.stats.pierce) amt *= (1 - d.armor);
    e.hp -= amt;
    e.flash = 1;
    if (e.hp <= 0) { this.kill(e, G, byLoop); return 1; }
    return 0;
  }

  kill(e, G, byLoop) {
    if (!e.on) return;
    const d = KIND[e.kind];
    e.on = false; this.alive--;
    const col = `${d.col[0]},${d.col[1]},${d.col[2]}`;
    fxBurst(e.x, e.y, e.elite ? 20 : 7, col, { spd: 150 + e.r * 6, size: 2 + e.r * .1, life: .42 });
    fxSoul(e.x, e.y);
    if (e.elite) { fxRing(e.x, e.y, e.r, e.r * 5, .5, col, 4); fxShake(5); }

    G.onKill(e, d, byLoop);

    if (d.split && !e.elite) {
      for (let i = 0; i < d.split; i++) {
        const a = rnd(TAU);
        const c = this.spawn('kake', e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 14, G.hpMul);
        if (c) { c.vx = Math.cos(a) * 150; c.vy = Math.sin(a) * 150; }
      }
    }
  }

  /**
   * 数百体を毎フレーム描くので save/restore と rotate は使わず、
   * 行列を直接差し替える（カメラ平行移動 + 回転 + 拡縮を1回で書き込む）。
   */
  draw(ctx, view, ox, oy, dpr) {
    const a = this.a;
    for (let i = 0; i < this.cap; i++) {
      const e = a[i];
      if (!e.on) continue;
      if (e.x < view.x0 || e.x > view.x1 || e.y < view.y0 || e.y > view.y1) continue;
      const sp = sprites.get(e.flash > 0.35 ? e.kind + '!' : e.kind)[e.v];
      const s = e.sc * (1 + Math.sin(e.t * 5 + e.v) * 0.035 + (e.lunge > 0 ? 0.16 : 0)) * dpr;
      const ang = Math.atan2(e.vy, e.vx);
      const co = Math.cos(ang) * s, si = Math.sin(ang) * s;
      ctx.setTransform(co, si, -si, co, (e.x + ox) * dpr, (e.y + oy) * dpr);
      ctx.drawImage(sp.c, -sp.off, -sp.off);
    }
    ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
  }
}

// --- 敵弾 -----------------------------------------------------------------
export class Bullets {
  constructor(cap = 220) {
    this.a = [];
    for (let i = 0; i < cap; i++) this.a.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, r: 6, t: 0, c: [255, 107, 107] });
    this.cap = cap;
  }
  clear() { for (const b of this.a) b.on = false; }
  spawn(x, y, vx, vy, r, c) {
    for (let i = 0; i < this.cap; i++) {
      const b = this.a[i];
      if (b.on) continue;
      b.on = true; b.x = x; b.y = y; b.vx = vx; b.vy = vy; b.r = r; b.t = 0; b.c = c;
      return b;
    }
    return null;
  }
  update(dt, G) {
    const px = G.player.x, py = G.player.y;
    for (let i = 0; i < this.cap; i++) {
      const b = this.a[i];
      if (!b.on) continue;
      const sf = G.slowFactorFor(b);
      b.t += dt;
      b.x += b.vx * dt * sf; b.y += b.vy * dt * sf;
      if (b.t > 7 || dist2(b.x, b.y, px, py) > 1400 * 1400) { b.on = false; continue; }
      const rr = b.r + G.player.r;
      if (dist2(b.x, b.y, px, py) < rr * rr) { G.hurtPlayer(b); b.on = false; continue; }
      // 糸で弾を払える（縫い手の妙味）
      if (G.thread.touchesHot(b.x, b.y, b.r + 6)) {
        b.on = false;
        fxBurst(b.x, b.y, 5, `${b.c[0]},${b.c[1]},${b.c[2]}`, { spd: 110, life: .3 });
      }
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.a) {
      if (!b.on) continue;
      const c = b.c;
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 2.6);
      g.addColorStop(0, `rgba(255,255,255,.95)`);
      g.addColorStop(.35, `rgba(${c[0]},${c[1]},${c[2]},.75)`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2.6, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

// --- 落ちるもの（光・光糸・霧の露） -----------------------------------------
// kind 0=光(その場の経験値) 1=光糸(持ち帰る通貨) 2=霧の露(章素材)
// 拾った瞬間に「今回のための光」か「持ち帰れるもの」か分かることが要件なので、
// 色だけでなく形も変えている。光=菱形、光糸=糸巻き、露=雫。
export const MOTE_XP = 0, MOTE_LUMEN = 1, MOTE_DEW = 2;

export class Motes {
  constructor(cap = 900) {
    this.a = [];
    for (let i = 0; i < cap; i++) {
      this.a.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, v: 1, t: 0, pull: false, kind: 0 });
    }
    this.cap = cap;
  }
  clear() { for (const m of this.a) m.on = false; }
  spawn(x, y, v, kind = MOTE_XP) {
    for (let i = 0; i < this.cap; i++) {
      const m = this.a[i];
      if (m.on) continue;
      const a = rnd(TAU), s = rnd(40, 120);
      m.on = true; m.x = x; m.y = y; m.vx = Math.cos(a) * s; m.vy = Math.sin(a) * s;
      m.v = v; m.t = 0; m.pull = false; m.kind = kind;
      return;
    }
  }
  update(dt, G) {
    const px = G.player.x, py = G.player.y;
    const R = G.stats.magnet, R2 = R * R;
    for (let i = 0; i < this.cap; i++) {
      const m = this.a[i];
      if (!m.on) continue;
      m.t += dt;
      const d2 = dist2(m.x, m.y, px, py);
      // 持ち帰れるものは少し広く吸い寄せる（取り逃しが報酬の減少に直結するため）
      const rr = m.kind === MOTE_XP ? R2 : R2 * 1.6;
      if (!m.pull && (d2 < rr || G.magnetAll)) m.pull = true;
      if (m.pull) {
        const d = Math.sqrt(d2) || 1;
        const s = clamp(760 - d * 0.5, 220, 900);
        m.vx = damp(m.vx, ((px - m.x) / d) * s, 9, dt);
        m.vy = damp(m.vy, ((py - m.y) / d) * s, 9, dt);
        if (d2 < 380) { m.on = false; G.collect(m.v, m.kind); continue; }
      } else {
        m.vx *= Math.exp(-4 * dt); m.vy *= Math.exp(-4 * dt);
      }
      m.x += m.vx * dt; m.y += m.vy * dt;
    }
  }
  draw(ctx, view) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 光：菱形。数が多いので1パスにまとめる
    let started = false;
    for (const m of this.a) {
      if (!m.on || m.kind !== MOTE_XP) continue;
      if (m.x < view.x0 || m.x > view.x1 || m.y < view.y0 || m.y > view.y1) continue;
      if (!started) { ctx.beginPath(); started = true; }
      const s = 2.3 + Math.sin(m.t * 7) * 0.5;
      ctx.moveTo(m.x, m.y - s * 2); ctx.lineTo(m.x + s, m.y);
      ctx.lineTo(m.x, m.y + s * 2); ctx.lineTo(m.x - s, m.y);
      ctx.closePath();
    }
    if (started) { ctx.fillStyle = 'rgba(125,240,255,.9)'; ctx.fill(); }

    // 光糸：金の糸巻き。回りながら瞬く
    for (const m of this.a) {
      if (!m.on || m.kind !== MOTE_LUMEN) continue;
      if (m.x < view.x0 || m.x > view.x1 || m.y < view.y0 || m.y > view.y1) continue;
      const r = 4.4 + Math.sin(m.t * 5) * 0.6;
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, r * 3);
      g.addColorStop(0, 'rgba(255,240,190,.95)');
      g.addColorStop(.4, 'rgba(255,200,100,.5)');
      g.addColorStop(1, 'rgba(255,170,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(m.x, m.y, r * 3, 0, TAU); ctx.fill();
      ctx.save();
      ctx.translate(m.x, m.y); ctx.rotate(m.t * 2.2);
      ctx.strokeStyle = 'rgba(255,236,180,.95)'; ctx.lineWidth = 1.7;
      ctx.strokeRect(-r * .72, -r * .72, r * 1.44, r * 1.44);
      ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
      ctx.restore();
    }

    // 霧の露：淡い雫
    for (const m of this.a) {
      if (!m.on || m.kind !== MOTE_DEW) continue;
      if (m.x < view.x0 || m.x > view.x1 || m.y < view.y0 || m.y > view.y1) continue;
      const r = 4 + Math.sin(m.t * 4) * 0.7;
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, r * 3.2);
      g.addColorStop(0, 'rgba(255,255,255,.95)');
      g.addColorStop(.35, 'rgba(190,230,255,.6)');
      g.addColorStop(1, 'rgba(150,200,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(m.x, m.y, r * 3.2, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.beginPath();
      ctx.moveTo(m.x, m.y - r * 1.5); ctx.lineTo(m.x + r * .8, m.y + r * .6);
      ctx.lineTo(m.x, m.y + r * 1.2); ctx.lineTo(m.x - r * .8, m.y + r * .6);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
}

// --- 織主（ボス） -----------------------------------------------------------
export class Boss {
  constructor() { this.on = false; }

  spawn(x, y, hp, final, name) {
    this.on = true; this.final = final;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.r = final ? 74 : 58;
    this.hp = this.mhp = hp;
    this.t = 0; this.cd = 3.2; this.cd2 = 6; this.rot = 0; this.flash = 0;
    this.spiral = 0; this.frozen = 0;
    this.name = name || '織主';
  }

  get phase() { const f = this.hp / this.mhp; return f < 0.32 ? 2 : f < 0.66 ? 1 : 0; }

  update(dt, G) {
    if (!this.on) return;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.rot += dt * (0.35 + this.phase * 0.3);
    const sf = G.slowFactorFor(this);
    if (this.frozen > 0) { this.frozen -= dt; return; }

    const px = G.player.x, py = G.player.y;
    let dx = px - this.x, dy = py - this.y;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const spd = (34 + this.phase * 16) * (this.final ? 1.15 : 1) * sf;
    this.vx = damp(this.vx, dx * spd, 2, dt);
    this.vy = damp(this.vy, dy * spd, 2, dt);
    this.x += this.vx * dt; this.y += this.vy * dt;

    // 放射弾
    this.cd -= dt * sf;
    if (this.cd <= 0) {
      this.cd = 3.4 - this.phase * 0.85;
      const n = 10 + this.phase * 6 + (this.final ? 6 : 0);
      const off = rnd(TAU);
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * TAU;
        G.bullets.spawn(this.x + Math.cos(a) * this.r, this.y + Math.sin(a) * this.r,
          Math.cos(a) * 135, Math.sin(a) * 135, 8, [255, 150, 90]);
      }
      fxRing(this.x, this.y, this.r, this.r * 2.2, .45, '255,150,90', 5);
    }

    // 第2形態以降：渦を巻く弾幕と眷属
    if (this.phase >= 1) {
      this.spiral += dt;
      if (this.spiral > 0.16) {
        this.spiral = 0;
        const a = this.t * 2.7;
        for (const s of [0, Math.PI]) {
          G.bullets.spawn(this.x, this.y, Math.cos(a + s) * 118, Math.sin(a + s) * 118, 6, [255, 107, 160]);
        }
      }
      this.cd2 -= dt * sf;
      if (this.cd2 <= 0) {
        this.cd2 = this.final ? 5.5 : 8;
        for (let i = 0; i < (this.final ? 12 : 7); i++) {
          const a = rnd(TAU), d = this.r + rnd(30, 90);
          G.swarm.spawn(pick(['hotsure', 'shitsu']), this.x + Math.cos(a) * d, this.y + Math.sin(a) * d, G.hpMul);
        }
        fxRing(this.x, this.y, this.r, this.r * 3, .6, '200,140,255', 3);
      }
    }

    const rr = this.r * 0.82 + G.player.r;
    if (dist2(this.x, this.y, px, py) < rr * rr) G.hurtPlayer(this, 1);
  }

  damage(amount, G) {
    if (!this.on) return;
    this.hp -= amount;
    this.flash = 1;
    if (this.hp <= 0) {
      this.on = false;
      G.onBossDown(this);
    }
  }

  draw(ctx) {
    if (!this.on) return;
    const { x, y, r } = this;
    const ph = this.phase;
    const base = this.final ? [255, 120, 190] : [255, 160, 90];
    const [R, G2, B] = this.flash > .4 ? [255, 255, 255] : base;

    ctx.save();
    ctx.translate(x, y);

    // 外周の輪（回る糸車）
    ctx.globalCompositeOperation = 'lighter';
    for (let ring = 0; ring < 2; ring++) {
      const rr = r * (1.25 + ring * 0.34);
      const n = 12 + ring * 6;
      const rot = this.rot * (ring ? -0.7 : 1);
      ctx.strokeStyle = `rgba(${R},${G2},${B},${.5 - ring * .22})`;
      ctx.lineWidth = 3 - ring;
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * TAU;
        ctx.beginPath();
        ctx.arc(0, 0, rr, a, a + TAU / n * 0.5);
        ctx.stroke();
      }
    }
    const gl = ctx.createRadialGradient(0, 0, r * .3, 0, 0, r * 2.1);
    gl.addColorStop(0, `rgba(${R},${G2},${B},.4)`);
    gl.addColorStop(1, `rgba(${R},${G2},${B},0)`);
    ctx.fillStyle = gl;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.1, 0, TAU); ctx.fill();

    // 本体
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * TAU;
      const w = 1 + 0.13 * Math.sin(a * 5 + this.t * 1.4) + 0.06 * Math.sin(a * 9 - this.t);
      const rr = r * w;
      const px2 = Math.cos(a) * rr, py2 = Math.sin(a) * rr;
      i ? ctx.lineTo(px2, py2) : ctx.moveTo(px2, py2);
    }
    ctx.closePath();
    const bg = ctx.createRadialGradient(-r * .3, -r * .3, r * .1, 0, 0, r * 1.2);
    bg.addColorStop(0, `rgba(${(R * .3) | 0},${(G2 * .3) | 0},${(B * .3) | 0},1)`);
    bg.addColorStop(1, 'rgba(5,4,12,1)');
    ctx.fillStyle = bg; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = `rgba(${R},${G2},${B},.9)`; ctx.stroke();

    // 眼
    ctx.globalCompositeOperation = 'lighter';
    const eyes = 1 + ph;
    for (let i = 0; i < eyes; i++) {
      const a = eyes === 1 ? 0 : -0.6 + (i / (eyes - 1)) * 1.2;
      const ex = Math.cos(a) * r * .42, ey = Math.sin(a) * r * .42;
      const eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, r * .3);
      eg.addColorStop(0, 'rgba(255,255,255,1)');
      eg.addColorStop(.35, `rgba(${R},${G2},${B},.9)`);
      eg.addColorStop(1, `rgba(${R},${G2},${B},0)`);
      ctx.fillStyle = eg;
      ctx.beginPath(); ctx.arc(ex, ey, r * .3, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

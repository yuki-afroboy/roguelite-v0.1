// ゲーム本体。状態・進行・描画の統合。
import {
  TAU, clamp, lerp, damp, rnd, chance, pickWeighted,
  pointInPoly, polyBounds, dist2, store, vibrate,
} from './util.js';
import { input } from './input.js';
import { Thread } from './thread.js';
import { Swarm, Bullets, Motes, Boss, bakeSprites, MOTE_XP, MOTE_LUMEN, MOTE_DEW } from './entities.js';
import { baseStats, drawCards } from './upgrades.js';
import { nightById, nightSpawnPlan } from './nights.js';
import { applyMeta } from './meta.js';
import {
  fxUpdate, fxDrawWorld, fxDrawPops, fxDrawOverlay, fxBurst, fxRing, fxPop,
  fxStitchFlash, fxShake, fxHitStop, fxScreenFlash, fxShakeX, fxShakeY,
  fxClear, fxConsumeStop,
} from './fx.js';
import {
  sfxStitch, sfxEmpty, sfxHurt, sfxPick, sfxLumen, sfxLevel, sfxUnravel, sfxBoss,
  musicIntensity, musicTick, musicStart, musicStop,
} from './audio.js';

export const RUN_TIME = 600;      // 旧単位。夜ごとの制限時間は night.dur

const STATE = { RUN: 'run', LEVEL: 'level', OVER: 'over', PAUSE: 'pause' };

export class Game {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = 360; this.h = 720;
    this.thread = new Thread();
    this.swarm = new Swarm(680);
    this.bullets = new Bullets(260);
    this.motes = new Motes(900);
    this.boss = new Boss();
    this.player = { x: 0, y: 0, r: 9, hp: 5, inv: 0, ang: -Math.PI / 2, vx: 0, vy: 0 };
    this.state = STATE.OVER;
    this.frame = 0;
    this.night = nightById(1);
    // main.js が差し込むフック
    this.onLevelUp = null; this.onEnd = null; this.onToast = null;
    bakeSprites();
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w; this.h = h;
    this.cv.width = Math.round(w * this.dpr);
    this.cv.height = Math.round(h * this.dpr);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
    this._vig = null;
  }

  // ======================================================================
  /**
   * 夜へ挑む。恒久強化と装備はここで一度だけ stats に乗る。
   * @param {number} nightId
   * @param {object} save  meta.js のセーブ。省略時は素の状態
   */
  start(nightId, save) {
    const night = nightById(nightId);
    this.night = night;

    const st = baseStats();
    if (save) applyMeta(st, save);
    this.stats = st;
    this.levels = {};

    this.t = 0;
    this.frame = 0;
    this.state = STATE.RUN;
    this.player.x = 0; this.player.y = 0;
    this.player.hp = st.maxHp;
    this.player.inv = 1.2;
    this.player.vx = this.player.vy = 0;
    this.cam = { x: 0, y: 0 };

    this.thread.maxPts = st.threadPts;
    this.thread.snap = st.snap;
    this.thread.reset(0, 0);

    this.swarm.clear(); this.bullets.clear(); this.motes.clear();
    this.boss.on = false;
    fxClear();

    this.xp = 0; this.lv = 1; this.xpNeed = this.needFor(1);
    this.chain = 0; this.chainT = 0;
    this.gauge = clamp(st.startGauge, 0, 0.9);
    this.unravelT = 0; this.magnetAll = false;
    this.enemyTS = 1;

    this.kills = 0; this.score = 0; this.maxChain = 0; this.bestLoop = 0; this.stitches = 0;
    this.lumen = 0; this.dew = 0;                 // 拾った分だけ持ち帰る
    this.burns = []; this.echoes = []; this.shocks = []; this.shockId = 1;
    this.spawnAcc = 0; this.surgeT = 26; this.surge = 0;
    this.bossSpawned = false; this.result = null; this.winT = 0;
    this.tutorial = 0;

    musicStart(); musicIntensity(0);
    this.toast(night.teach, 3.2);
  }

  /**
   * タイトル背景。見えない縫い手が延々と輪を閉じ続ける。
   * 説明を読む前に「軌跡が閉じると光る」ことが目に入る、という導線。
   */
  enterTitle() {
    this.state = STATE.OVER;
    this.t = 0; this.frame = 0;
    this.cam = { x: 0, y: 0 };
    this.chain = 0; this.unravelT = 0; this.gauge = 0;
    this.burns = []; this.echoes = []; this.shocks = [];
    this.swarm.clear(); this.bullets.clear(); this.motes.clear();
    this.boss.on = false;
    this.player.hp = 0; this.player.inv = 0;
    this.thread.maxPts = 96;
    this.thread.reset(0, 0);
    fxClear();
  }

  titleTick(dt) {
    this.t += dt; this.frame++;
    const a = this.t * 0.5;
    const x = Math.cos(a) * 155 + Math.cos(a * 2.7 + 1.1) * 62;
    const y = Math.sin(a * 1.35) * 205 + Math.sin(a * 0.63) * 58;
    const p = this.player;
    p.ang = Math.atan2(y - p.y, x - p.x);
    p.x = x; p.y = y;
    const loop = this.thread.extend(x, y);
    if (loop) {
      const b = polyBounds(loop.flat);
      fxStitchFlash(loop.flat, '160,235,255', 0.55);
      fxRing(b.cx, b.cy, 4, Math.max(b.w, b.h) * 0.5, 0.6, '125,240,255', 2);
    }
    this.cam.x = damp(this.cam.x, x * 0.25, 1.6, dt);
    this.cam.y = damp(this.cam.y, y * 0.25, 1.6, dt);
    fxUpdate(dt);
  }

  // 夜ごとに目標Lvへ着地させる。短い夜で札が増えすぎないよう xpScale で伸縮する
  needFor(lv) { return Math.floor((9 + lv * 6 + lv * lv * 0.12) * this.night.xpScale); }

  get hpMul() { return this.night.baseHp * (1 + this.t * this.night.ramp); }
  get timeLeft() { return Math.max(0, this.night.dur - this.t); }
  get chainMult() { return 1 + Math.max(0, this.chain - 1) * 0.5; }

  slowFactorFor() { return this.enemyTS; }

  toast(msg, t = 2.4) { this.onToast?.(msg, t); }

  // ======================================================================
  update(dtRaw) {
    if (this.state !== STATE.RUN) { musicTick(dtRaw); fxUpdate(dtRaw); return; }

    // ヒットストップ：演出だけ進めて世界は止める
    const stopped = fxConsumeStop(dtRaw);
    let dt = dtRaw - stopped;
    fxUpdate(dtRaw);
    musicTick(dtRaw);
    if (dt <= 0) return;
    dt = Math.min(dt, 1 / 30);

    this.frame++;
    this.t += dt;

    // 解き放ちの余韻：世界だけが緩む
    if (this.unravelT > 0) {
      this.unravelT -= dt;
      this.enemyTS = lerp(0.22, 1, clamp(1 - this.unravelT / 1.7, 0, 1) ** 2);
      this.magnetAll = true;
      if (this.unravelT <= 0) { this.enemyTS = 1; this.magnetAll = false; }
    }

    this.updatePlayer(dt);
    this.thread.update(dt);

    this.director(dt);
    this.swarm.update(dt, this);
    this.boss.update(dt, this);
    this.bullets.update(dt, this);
    this.motes.update(dt, this);
    this.updateFields(dt);

    // 連鎖は一気に0へ落とさず1段ずつ冷ます。
    // 途切れた瞬間に全部失う仕様は、指一本で遊ぶ相手には厳し過ぎる。
    if (this.chainT > 0) {
      this.chainT -= dt;
      if (this.chainT <= 0 && this.chain > 0) {
        this.chain--;
        this.chainT = this.chain > 0 ? this.stats.chainWindow * 0.7 : 0;
      }
    }

    // 緊張度（BGMの密度）
    const dens = clamp(this.swarm.alive / 160, 0, 1);
    musicIntensity(clamp(this.t / this.night.dur * 0.6 + dens * 0.4 + (this.boss.on ? 0.3 : 0), 0, 1));

    if (this.winT > 0) {
      this.winT -= dt;
      if (this.winT <= 0) { this.finish(true); return; }
    }
    if (this.player.hp <= 0) { this.finish(false); return; }

    // 制限時間。織主のいる夜は「倒せば突破」、いない夜は「生き延びれば突破」
    if (this.t >= this.night.dur) {
      this.finish(!this.night.boss);
    }
  }

  updatePlayer(dt) {
    const p = this.player, st = this.stats;
    p.inv = Math.max(0, p.inv - dt);

    const tx = input.dx * st.speed, ty = input.dy * st.speed;
    p.vx = damp(p.vx, tx, 14, dt);
    p.vy = damp(p.vy, ty, 14, dt);
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.vx || p.vy) {
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 8) p.ang = Math.atan2(p.vy, p.vx);
    }

    // 糸を伸ばし、閉じたら縫う
    this.thread.maxPts = st.threadPts;
    const loop = this.thread.extend(p.x, p.y);
    if (loop) this.stitch(loop, 1, false);

    // カメラ：進行方向へわずかに先行させる
    const look = 44;
    const tx2 = p.x + (p.vx / st.speed) * look;
    const ty2 = p.y + (p.vy / st.speed) * look;
    this.cam.x = damp(this.cam.x, tx2, 7, dt);
    this.cam.y = damp(this.cam.y, ty2, 7, dt);

    // 導入の言葉。ここは「輪をまだ一度も閉じていない人」を最優先で拾う。
    // 計測では、大きく回りすぎた人が最後まで一度も閉じられずに死んでいた。
    if (this.stitches === 0) {
      if (this.tutorial === 0 && this.t > 11) {
        this.tutorial = 0.5;
        this.toast('自分の糸に触れると、輪が閉じる', 3.4);
      } else if (this.tutorial === 0.5 && this.t > 24) {
        this.tutorial = 0.6;
        this.toast('小さく回れ。糸の届く範囲で', 3.4);
      }
    } else if (this.tutorial < 1) {
      this.tutorial = 1;
      this.toast('輪の内側は、すべて縫い落ちる', 3.0);
    } else if (this.tutorial === 1 && this.stitches >= 6) {
      this.tutorial = 2;
      this.toast('続けて閉じれば 連鎖 が乗る', 2.8);
    }
  }

  // ---- 核：輪を閉じた瞬間の処理 --------------------------------------
  stitch(loop, mul, isEcho) {
    const st = this.stats;
    const { flat, area } = loop;
    const b = polyBounds(flat);

    if (!isEcho) this.stitches++;

    const areaBonus = 1 + Math.min(area / 26000, 3.2) * st.areaScale;
    const dmg = st.dmg * areaBonus * this.chainMult * mul;

    const q = [];
    this.swarm.grid.query(b.x0, b.y0, b.x1, b.y1, q);
    let killed = 0, hit = 0;
    const arr = this.swarm.a;
    for (let i = 0; i < q.length; i++) {
      const e = arr[q[i]];
      if (!e.on) continue;
      if (!pointInPoly(flat, e.x, e.y)) continue;
      hit++;
      killed += this.swarm.damage(e, dmg, this, true);
      if (e.on && st.doubleStitch) {
        for (let d = 0; d < st.doubleStitch; d++) {
          if (!e.on) break;
          killed += this.swarm.damage(e, dmg * 0.6, this, true);
        }
      }
      if (e.on && st.freeze > 0) e.frozen = Math.max(e.frozen || 0, st.freeze);
    }

    if (this.boss.on && pointInPoly(flat, this.boss.x, this.boss.y)) {
      this.boss.damage(dmg * 1.25, this);
      hit++;
      fxRing(this.boss.x, this.boss.y, this.boss.r * .5, this.boss.r * 1.9, .35, '255,255,255', 4);
    }

    // 双環：針を中心にもう一つの輪が生まれる
    if (st.twin > 0 && !isEcho) {
      const tr = 100 + st.twin * 34, tr2 = tr * tr;
      const px = this.player.x, py = this.player.y;
      const q2 = [];
      this.swarm.grid.query(px - tr, py - tr, px + tr, py + tr, q2);
      for (let i = 0; i < q2.length; i++) {
        const e = arr[q2[i]];
        if (!e.on || dist2(e.x, e.y, px, py) > tr2) continue;
        hit++;
        killed += this.swarm.damage(e, dmg * 0.6, this, true);
      }
      if (this.boss.on && dist2(this.boss.x, this.boss.y, px, py) < tr2) this.boss.damage(dmg * 0.6, this);
      fxRing(px, py, tr * 0.25, tr, .34, '160,235,255', 3);
    }

    // 連鎖
    if (hit > 0 && !isEcho) {
      this.chain = Math.min(this.chain + 1, st.chainMax);
      this.chainT = st.chainWindow;
      this.maxChain = Math.max(this.maxChain, this.chain);
    }
    this.bestLoop = Math.max(this.bestLoop, killed);

    // 得点
    const gained = Math.round(killed * 12 * this.chainMult * (1 + areaBonus * 0.12));
    this.score += gained;

    // 演出
    const col = this.chain >= 5 ? '255,248,220' : this.chain >= 3 ? '255,196,96' : '255,214,140';
    fxStitchFlash(flat, col, 0.36 + Math.min(killed, 20) * 0.006);
    if (killed > 0) {
      fxShake(clamp(2.4 + killed * 0.55, 2.4, 17));
      fxScreenFlash(clamp(0.04 + killed * 0.008, 0.04, 0.2), col);
      if (killed >= 5) {
        fxHitStop(clamp(0.035 + killed * 0.0032, 0.035, 0.13));
        vibrate(clamp(10 + killed, 10, 45));
      }
      if (killed >= 3) fxPop(b.cx, b.cy, `${killed}`, col, 15 + Math.min(killed, 26));
      sfxStitch(Math.max(1, this.chain), clamp(killed / 22, 0, 1));
      this.gauge = clamp(this.gauge + killed * 0.009 * st.unravelGain, 0, 1);

      // 縫った直後は針が身を守る。
      // 「囲む」には獣の隣にいる必要があり、獣は触れると痛い ── つまり
      // 上手く遊ぶほど削られる、という矛盾が構造的にあった（計測では
      // 30秒で40〜80体倒す操作をしても22秒で死んでいた）。
      // 核の動作そのものに安全を紐付けて、この矛盾を解く。
      if (!isEcho) {
        this.player.inv = Math.max(this.player.inv, clamp(0.45 + killed * 0.025, 0.45, 1.1));
      }
    } else {
      sfxEmpty();   // 空振りは控えめに。輪を閉じた手応えだけは返す
    }

    // 波紋
    if (st.wave > 0 && !isEcho) {
      this.shocks.push({
        id: this.shockId++, x: b.cx, y: b.cy,
        r: Math.max(b.w, b.h) * 0.5, max: Math.max(b.w, b.h) * 0.5 + 210 * st.wave,
        t: 0, life: 0.5, dmg: dmg * 0.45 * st.wave,
      });
      fxRing(b.cx, b.cy, Math.max(b.w, b.h) * .5, Math.max(b.w, b.h) * .5 + 210 * st.wave, .5, col, 5);
    }
    // 灼痕
    if (st.burn > 0 && !isEcho) {
      this.burns.push({ flat, b, t: st.burn, max: st.burn, dps: dmg * 0.5, tick: 0 });
      if (this.burns.length > 8) this.burns.shift();
    }
    // 残響
    if (st.echo > 0 && !isEcho) {
      for (let i = 0; i < st.echo; i++) {
        this.echoes.push({ flat, area, delay: 0.5 + i * 0.32, mul: 0.7 });
      }
    }
  }

  updateFields(dt) {
    const arr = this.swarm.a;

    for (let i = this.echoes.length - 1; i >= 0; i--) {
      const e = this.echoes[i];
      e.delay -= dt;
      if (e.delay <= 0) {
        this.echoes.splice(i, 1);
        this.stitch({ flat: e.flat, area: e.area }, e.mul, true);
      }
    }

    for (let i = this.burns.length - 1; i >= 0; i--) {
      const z = this.burns[i];
      z.t -= dt; z.tick -= dt;
      if (z.t <= 0) { this.burns.splice(i, 1); continue; }
      if (z.tick <= 0) {
        z.tick = 0.16;
        const q = [];
        this.swarm.grid.query(z.b.x0, z.b.y0, z.b.x1, z.b.y1, q);
        for (let k = 0; k < q.length; k++) {
          const e = arr[q[k]];
          if (!e.on) continue;
          if (pointInPoly(z.flat, e.x, e.y)) this.swarm.damage(e, z.dps * 0.16, this, true);
        }
        if (this.boss.on && pointInPoly(z.flat, this.boss.x, this.boss.y)) this.boss.damage(z.dps * 0.16, this);
        if (chance(0.6)) fxBurst(lerp(z.b.x0, z.b.x1, Math.random()), lerp(z.b.y0, z.b.y1, Math.random()), 1, '255,170,70', { spd: 30, life: .5, size: 2 });
      }
    }

    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      s.t += dt;
      const k = clamp(s.t / s.life, 0, 1);
      const r = lerp(s.r, s.max, 1 - Math.pow(1 - k, 3));
      const q = [];
      this.swarm.grid.query(s.x - r - 24, s.y - r - 24, s.x + r + 24, s.y + r + 24, q);
      for (let j = 0; j < q.length; j++) {
        const e = arr[q[j]];
        if (!e.on || e.hitId === s.id) continue;
        const d = Math.sqrt(dist2(e.x, e.y, s.x, s.y));
        if (d < r + e.r && d > r - 40) { e.hitId = s.id; this.swarm.damage(e, s.dmg, this, true); }
      }
      if (k >= 1) this.shocks.splice(i, 1);
    }
  }

  // ---- 進行管理 --------------------------------------------------------
  director(dt) {
    const t = this.t, n = this.night;

    if (n.boss && !this.bossSpawned && t >= n.dur * n.boss.at) {
      this.bossSpawned = true;
      this.spawnBoss(n.boss.hp * n.baseHp, n.boss.name);
    }

    // 湧きの脈：20秒強ごとに一気に押し寄せる
    this.surgeT -= dt;
    if (this.surgeT <= 0) { this.surgeT = rnd(19, 25); this.surge = 4.5; }
    if (this.surge > 0) this.surge -= dt;

    // 「1秒に何体」ではなく「同時に何体いてほしいか」を夜が決める。
    // 総キル数はほぼ ceil（毎秒の上限）で決まるので、上位の夜ほど厚くしてある。
    let target = n.dens.base + t * n.dens.growth;
    if (this.surge > 0) target *= 1.5;
    if (this.boss.on) target = Math.min(target, n.dens.cap * 0.55);
    target = Math.min(target, n.dens.cap);

    const ceiling = n.ceil.base + t * n.ceil.growth;
    const rate = clamp((target - this.swarm.alive) * 0.5, 0, ceiling);

    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      this.spawnOne();
    }
  }

  spawnOne() {
    const r = Math.max(this.w, this.h) * 0.56 + rnd(40, 150);
    const a = rnd(TAU);
    const x = this.cam.x + Math.cos(a) * r;
    const y = this.cam.y + Math.sin(a) * r;
    const kind = pickWeighted(nightSpawnPlan(this.night, this.t)).kind;
    const elite = this.t > this.night.dur * 0.45 && chance(0.02);
    this.swarm.spawn(kind, x, y, this.hpMul, elite);
  }

  spawnBoss(hp, name) {
    const a = rnd(TAU), r = Math.hypot(this.w, this.h) * 0.42;
    this.boss.spawn(this.cam.x + Math.cos(a) * r, this.cam.y + Math.sin(a) * r, hp, true, name);
    sfxBoss();
    fxScreenFlash(0.35, '255,120,90');
    fxShake(16);
    vibrate([40, 60, 90]);
    this.toast(name + ' ─ 夜の縫い目を断て', 3.4);
  }

  onBossDown(boss) {
    fxScreenFlash(0.7, '255,220,180');
    fxShake(26);
    fxHitStop(0.2);
    for (let i = 0; i < 5; i++) fxRing(boss.x, boss.y, boss.r * (0.4 + i * .3), boss.r * (4 + i * 2), .8 + i * .16, '255,190,120', 6 - i);
    fxBurst(boss.x, boss.y, 90, '255,200,140', { spd: 520, life: 1.1, size: 4 });
    vibrate([60, 40, 120]);
    this.score += 4000;
    // 織主は光糸を多く落とす。倒した価値が持ち帰るものに直結する
    for (let i = 0; i < 30; i++) this.motes.spawn(boss.x + rnd(-70, 70), boss.y + rnd(-70, 70), 3, MOTE_LUMEN);
    for (let i = 0; i < 6; i++) this.motes.spawn(boss.x + rnd(-50, 50), boss.y + rnd(-50, 50), 1, MOTE_DEW);
    for (let i = 0; i < 30; i++) this.motes.spawn(boss.x + rnd(-60, 60), boss.y + rnd(-60, 60), 4, MOTE_XP);
    this.toast('夜が明ける', 4);
    this.winT = 2.2;                       // 落ちたものを拾う間を置いてから結果へ
  }

  // ---- プレイヤー被弾 --------------------------------------------------
  hurtPlayer(src, dmg = 1) {
    const p = this.player;
    if (p.inv > 0 || this.state !== STATE.RUN) return;
    p.hp -= dmg;
    p.inv = this.stats.iframe;
    this.chain = 0; this.chainT = 0;
    // 糸が乱れる：手元の糸を半分失う
    const keep = Math.max(2, (this.thread.p.length >> 1) >> 1) * 2;
    this.thread.p = this.thread.p.slice(this.thread.p.length - keep);
    // ひるみ：触れた瞬間に周囲の獣を押し退ける。
    // これが無いと群れの中で連続被弾し、立て直す隙が生まれない。
    const q = [];
    this.swarm.grid.query(p.x - 110, p.y - 110, p.x + 110, p.y + 110, q);
    for (let i = 0; i < q.length; i++) {
      const e = this.swarm.a[q[i]];
      if (!e.on) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 110 || d < 0.01) continue;
      const k = (1 - d / 110) * 760 * this.stats.flinch;
      e.vx += (dx / d) * k; e.vy += (dy / d) * k;
      e.frozen = Math.max(e.frozen, 0.36);   // 押した直後に戻られると隙にならない
    }

    sfxHurt();
    fxScreenFlash(0.3, '255,60,90');
    fxShake(13);
    fxBurst(p.x, p.y, 24, '255,80,110', { spd: 260, life: .5, size: 3 });
    fxRing(p.x, p.y, 8, 150, .45, '255,80,110', 4);
    vibrate([25, 30, 25]);
    if (p.hp <= 0) { p.hp = 0; }
  }

  onKill(e, d, byLoop) {
    this.kills++;
    this.score += d.sc * (e.elite ? 5 : 1);

    // 光（その場の経験値）── 拾うとレベルが上がる。持ち帰らない
    const n = Math.min(d.xp * (e.elite ? 6 : 1), 6);
    for (let i = 0; i < n; i++) this.motes.spawn(e.x, e.y, e.elite ? 3 : 1, MOTE_XP);

    // 光糸（持ち帰る通貨）── 毎回は落ちない。落ちたときに価値が伝わるように。
    // 落ちる率は夜ごと（nights.js）。上位の夜ほど1体あたりは減らし、
    // 総キル数の差がそのまま8倍の収入差にならないようにしている。
    if (e.elite) this.motes.spawn(e.x, e.y, 4, MOTE_LUMEN);
    else if (chance(this.night.lumenRate)) this.motes.spawn(e.x, e.y, 1, MOTE_LUMEN);

    // 霧の露（章素材）── 装備を編むための素材
    if (this.night.dewRate > 0 && chance(this.night.dewRate)) this.motes.spawn(e.x, e.y, 1, MOTE_DEW);

    if (!byLoop) this.gauge = clamp(this.gauge + 0.002, 0, 1);
  }

  collect(v, kind) {
    if (kind === MOTE_LUMEN) { this.lumen += v; sfxLumen(); return; }
    if (kind === MOTE_DEW) { this.dew += v; sfxLumen(); return; }
    this.xp += v * this.stats.moteMul;
    if (this.frame % 3 === 0) sfxPick();
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.lv++;
      this.xpNeed = this.needFor(this.lv);
      this.levelUp();
    }
  }

  levelUp() {
    sfxLevel();
    fxScreenFlash(0.22, '125,240,255');
    fxRing(this.player.x, this.player.y, 10, 220, .7, '125,240,255', 4);
    this.state = STATE.LEVEL;
    this.onLevelUp?.(drawCards(this.levels, 3));
  }

  applyCard(card) {
    this.levels[card.id] = (this.levels[card.id] || 0) + 1;
    card.apply(this.stats);

    // 糸を編み直すたび、綻びも1つ繕われる。
    // 10分の運びに対して回復手段が皆無で、6回被弾した時点で終わっていた
    // （計測では全モデルが6回被弾＝40〜60秒で死亡）。成長と回復を同じ動作に束ねる。
    const before = this.player.hp;
    this.player.hp = Math.min(this.stats.maxHp, this.player.hp + 1);
    if (card.id === 'hp') this.player.hp = this.stats.maxHp;
    if (this.stats.heal) {
      this.player.hp = Math.min(this.stats.maxHp, this.player.hp + this.stats.heal);
      this.stats.heal = 0;
    }
    if (this.player.hp > before) {
      fxRing(this.player.x, this.player.y, 10, 130, .55, '255,120,150', 3);
      fxBurst(this.player.x, this.player.y, 14, '255,140,170', { spd: 150, life: .6, size: 2.4 });
    }
    this.thread.maxPts = this.stats.threadPts;
    this.state = STATE.RUN;
  }

  // ---- 解き放ち --------------------------------------------------------
  tryUnravel() {
    if (this.state !== STATE.RUN || this.gauge < 1) return false;
    this.gauge = 0;
    this.unravelT = 1.7;
    this.enemyTS = 0.22;
    this.chain = this.stats.chainMax;
    this.chainT = this.stats.chainWindow + 1.7;
    sfxUnravel();
    fxScreenFlash(0.55, '200,240,255');
    fxShake(20);
    fxHitStop(0.11);
    vibrate([50, 30, 70]);

    const px = this.player.x, py = this.player.y;
    const Rad = Math.hypot(this.w, this.h) * 0.58;
    for (let i = 0; i < 4; i++) fxRing(px, py, 20, Rad * (0.6 + i * 0.16), .55 + i * .16, i % 2 ? '255,217,138' : '125,240,255', 6 - i);

    const dmg = this.stats.dmg * 7;
    const q = [];
    this.swarm.grid.query(px - Rad, py - Rad, px + Rad, py + Rad, q);
    const arr = this.swarm.a;
    let killed = 0;
    for (let i = 0; i < q.length; i++) {
      const e = arr[q[i]];
      if (!e.on) continue;
      if (dist2(e.x, e.y, px, py) > Rad * Rad) continue;
      killed += this.swarm.damage(e, dmg, this, true);
    }
    if (this.boss.on && dist2(this.boss.x, this.boss.y, px, py) < Rad * Rad) this.boss.damage(dmg * 1.4, this);
    this.bullets.clear();
    this.score += killed * 18;
    this.toast('解 ─ 夜が緩む', 1.6);
    return true;
  }

  // ---- 終了 ------------------------------------------------------------
  finish(win) {
    if (this.state === STATE.OVER) return;
    this.state = STATE.OVER;
    musicStop();
    const survived = Math.min(this.t, this.night.dur);
    const total = Math.round(this.score + survived * 6 + this.maxChain * 260 + (win ? 6000 : 0));
    this.result = {
      win, nightId: this.night.id, nightName: this.night.name,
      score: total, kills: this.kills, time: survived, dur: this.night.dur,
      maxChain: this.maxChain, bestLoop: this.bestLoop, lv: this.lv,
      stitches: this.stitches,
      lumen: this.lumen, dew: this.dew,     // 拾った分。勝敗によらず持ち帰る
    };
    fxScreenFlash(win ? 0.8 : 0.4, win ? '255,230,180' : '255,60,90');
    this.onEnd?.(this.result);
  }

  pause(v) {
    if (v && this.state === STATE.RUN) this.state = STATE.PAUSE;
    else if (!v && this.state === STATE.PAUSE) this.state = STATE.RUN;
  }
  get running() { return this.state === STATE.RUN; }
  get over() { return this.state === STATE.OVER; }

  // ======================================================================
  // 描画
  // ======================================================================
  render() {
    const ctx = this.ctx, w = this.w, h = this.h;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // 夜
    ctx.fillStyle = '#07060f';
    ctx.fillRect(0, 0, w, h);

    if (!this.cam) return;

    const ox = w / 2 - this.cam.x + fxShakeX();
    const oy = h / 2 - this.cam.y + fxShakeY();
    const view = { x0: this.cam.x - w / 2 - 60, y0: this.cam.y - h / 2 - 60, x1: this.cam.x + w / 2 + 60, y1: this.cam.y + h / 2 + 60 };

    ctx.save();
    ctx.translate(ox, oy);

    this.drawWeave(ctx, view);
    this.drawBurns(ctx);
    this.drawClosePreview(ctx);
    this.motes.draw(ctx, view);
    this.swarm.draw(ctx, view, ox, oy, this.dpr);
    this.boss.draw(ctx);
    this.bullets.draw(ctx);
    this.thread.draw(ctx, this.chain >= 3 ? 0.5 : 0);
    this.drawPlayer(ctx);
    fxDrawWorld(ctx);
    fxDrawPops(ctx);

    ctx.restore();

    this.drawVignette(ctx, w, h);
    if (this.unravelT > 0) this.drawUnravelVeil(ctx, w, h);
    fxDrawOverlay(ctx, w, h);
    if (this.boss.on && this.state !== STATE.OVER) this.drawBossBar(ctx, w, h);
  }

  /** 背景：夜という布の織り目 */
  drawWeave(ctx, v) {
    const C = 74;
    const x0 = Math.floor(v.x0 / C) * C, y0 = Math.floor(v.y0 / C) * C;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120,140,255,.052)';
    ctx.beginPath();
    for (let x = x0; x < v.x1 + C; x += C) { ctx.moveTo(x, v.y0); ctx.lineTo(x, v.y1); }
    for (let y = y0; y < v.y1 + C; y += C) { ctx.moveTo(v.x0, y); ctx.lineTo(v.x1, y); }
    ctx.stroke();

    // 綻びの気配（ゆっくり明滅する結び目）
    ctx.globalCompositeOperation = 'lighter';
    const T = this.t;
    for (let y = y0; y < v.y1 + C; y += C * 3) {
      for (let x = x0; x < v.x1 + C; x += C * 3) {
        const s = Math.sin(x * 0.013 + y * 0.017);
        const a = 0.05 + 0.05 * Math.sin(T * 0.9 + s * 6);
        ctx.fillStyle = `rgba(140,120,255,${a})`;
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }
    ctx.restore();
  }

  /**
   * 閉じかけの輪を先読みして描く。
   * 「針を自分の糸に近づけると何かが起きる」を、文章ではなく画面で教える部分。
   * 近づくほど濃くなるので、届かない大回りをしている人にも距離感が伝わる。
   */
  drawClosePreview(ctx) {
    if (this.state !== STATE.RUN) return;
    const pv = this.thread.previewClose();
    this._preview = pv;
    if (!pv) return;

    const f = pv.flat;
    const a = pv.near;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 囲われる領域。遠いうちは塗らない（見えないものに塗り潰しの負荷は払わない）
    if (a > 0.12) {
      ctx.beginPath();
      ctx.moveTo(f[0], f[1]);
      for (let i = 2; i < f.length; i += 2) ctx.lineTo(f[i], f[i + 1]);
      ctx.closePath();
      ctx.fillStyle = `rgba(255,214,140,${a * 0.06})`;
      ctx.fill();
    }

    // 閉じ口（針 → 触れる先）
    ctx.setLineDash([5, 7]);
    ctx.lineDashOffset = -this.t * 42;
    ctx.lineWidth = 1 + a * 1.6;
    ctx.strokeStyle = `rgba(255,228,170,${0.18 + a * 0.62})`;
    ctx.beginPath();
    ctx.moveTo(this.thread.hx, this.thread.hy);
    ctx.lineTo(pv.x, pv.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 触れる寸前だけ、閉じ口に光点を置く
    if (a > 0.55) {
      const r = 4 + a * 5;
      const g = ctx.createRadialGradient(pv.x, pv.y, 0, pv.x, pv.y, r * 2.4);
      g.addColorStop(0, `rgba(255,255,235,${a})`);
      g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(pv.x, pv.y, r * 2.4, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawBurns(ctx) {
    if (!this.burns.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const z of this.burns) {
      const k = z.t / z.max;
      const f = z.flat;
      ctx.beginPath();
      ctx.moveTo(f[0], f[1]);
      for (let i = 2; i < f.length; i += 2) ctx.lineTo(f[i], f[i + 1]);
      ctx.closePath();
      ctx.fillStyle = `rgba(255,140,50,${0.1 * k + 0.04 * Math.sin(this.t * 18)})`;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(255,190,90,${0.4 * k})`;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPlayer(ctx) {
    const p = this.player;
    const blink = p.inv > 0 && (this.frame % 8) < 4;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.ang);
    ctx.globalCompositeOperation = 'lighter';

    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
    g.addColorStop(0, blink ? 'rgba(255,120,150,.7)' : 'rgba(255,240,210,.55)');
    g.addColorStop(.5, 'rgba(255,190,110,.16)');
    g.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.fill();

    // 針
    ctx.beginPath();
    ctx.moveTo(15, 0); ctx.lineTo(-3, 6.5); ctx.lineTo(-9, 0); ctx.lineTo(-3, -6.5);
    ctx.closePath();
    ctx.fillStyle = blink ? 'rgba(255,150,170,.95)' : 'rgba(255,252,240,.98)';
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(255,215,140,.9)';
    ctx.stroke();
    ctx.restore();
  }

  drawVignette(ctx, w, h) {
    if (!this._vig || this._vw !== w || this._vh !== h) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.78);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,.72)');
      this._vig = g; this._vw = w; this._vh = h;
    }
    ctx.fillStyle = this._vig;
    ctx.fillRect(0, 0, w, h);

    // 被弾時の血の縁
    const p = this.player;
    if (p.inv > 0.2 && p.hp <= 2) {
      const a = 0.14 + 0.1 * Math.sin(this.t * 9);
      const g2 = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
      g2.addColorStop(0, 'rgba(255,0,60,0)');
      g2.addColorStop(1, `rgba(255,0,60,${a})`);
      ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);
    } else if (p.hp === 1) {
      const a = 0.1 + 0.07 * Math.sin(this.t * 5);
      const g2 = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.7);
      g2.addColorStop(0, 'rgba(255,0,60,0)');
      g2.addColorStop(1, `rgba(255,0,60,${a})`);
      ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);
    }
  }

  drawUnravelVeil(ctx, w, h) {
    const k = clamp(this.unravelT / 1.7, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(90,160,255,${0.07 * k})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  drawBossBar(ctx, w, h) {
    const b = this.boss;
    const bw = Math.min(w - 48, 380), x = (w - bw) / 2, y = 84;
    ctx.save();
    ctx.fillStyle = 'rgba(10,8,20,.75)';
    ctx.fillRect(x - 2, y - 2, bw + 4, 10);
    const f = clamp(b.hp / b.mhp, 0, 1);
    const g = ctx.createLinearGradient(x, 0, x + bw, 0);
    g.addColorStop(0, b.final ? '#ff5aa0' : '#ff8a4d');
    g.addColorStop(1, '#ffd98a');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, bw * f, 6);
    ctx.font = '700 10px "Hiragino Kaku Gothic ProN",system-ui,sans-serif';
    ctx.fillStyle = 'rgba(255,220,190,.85)';
    ctx.textAlign = 'center';
    ctx.fillText(b.name, w / 2, y - 7);
    ctx.restore();
  }
}

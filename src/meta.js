// ステージ外の恒久成長。保存・通貨・織機・装備。
//
// 設計の背骨：恒久強化で買えるのは「生存」と「可能性」、そして
// 「腕への見返り倍率」。火力(dmg)は上限 +25% までに抑え、それ単体では
// 硬い相手を一縫で落とせない水準に置く（面積と連鎖を組み合わせて初めて届く）。
//
// 敵の密度を上げるノードは意図的に置いていない。
// 自分を鍛えたら敵が増えるのは成長感と噛み合わないため、密度は夜（難易度側）の管轄。

const KEY = 'nuiyo.save';
const VERSION = 1;

function blank() {
  return {
    v: VERSION,
    lumen: 0,          // 光糸：汎用通貨
    cores: 0,          // 綻び核：Rank解放の鍵
    dew: 0,            // 霧の露：章素材。装備を編む
    loom: {},          // ノードid -> 取得段数
    gear: { needle: 'plain', thread: 'plain', ring: 'plain' },
    owned: ['needle.plain', 'thread.plain', 'ring.plain'],
    nights: {},        // 夜id -> { cleared, bestScore, bestKills }
    unlocked: 1,       // 解放済みの最大の夜
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const s = JSON.parse(raw);
    if (!s || s.v !== VERSION) return blank();   // 読めない形は初期値へ戻す
    const b = blank();
    return { ...b, ...s, loom: { ...s.loom }, gear: { ...b.gear, ...s.gear }, nights: { ...s.nights } };
  } catch { return blank(); }
}

export function writeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 保存できなくても遊べる */ }
}

export function resetSave() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
  return blank();
}

// --- 織機 -----------------------------------------------------------------
// 段階ごとの価格。Rank が上がるほど重くなる
export const RANK_COST = [70, 150, 280, 460, 700];
// Rank の解放段階。0 は最初から、1 以降は綻び核で開く
export const TIER_OF_RANK = [0, 0, 1, 1, 2];
export const TIER_CORES = [0, 2, 6];

export const LOOM = [
  // 糸 ── 何が可能になるか
  { id: 'threadLen', br: '糸', g: '長', n: '長糸', max: 5, step: 0.06,
    d: r => `糸の長さ +${(r * 6)}%`, apply: (s, r) => { s.threadPts = Math.round(s.threadPts * (1 + r * 0.06)); } },
  { id: 'snap', br: '糸', g: '寄', n: '閉じ寄せ', max: 3, step: 3,
    d: r => `輪が閉じる距離 +${r * 3}px`, apply: (s, r) => { s.snap += r * 3; } },

  // 針 ── 生存
  { id: 'maxHp', br: '針', g: '殻', n: '堅殻', max: 4, step: 3,
    d: r => `最大HP +${r * 3}`, apply: (s, r) => { s.maxHp += r * 3; } },
  { id: 'iframe', br: '針', g: '軽', n: '軽身', max: 3, step: 0.12,
    d: r => `被弾後の無敵 +${(r * 0.12).toFixed(2)}秒`, apply: (s, r) => { s.iframe += r * 0.12; } },
  { id: 'speed', br: '針', g: '疾', n: '疾走', max: 3, step: 0.03,
    d: r => `移動速度 +${r * 3}%`, apply: (s, r) => { s.speed *= (1 + r * 0.03); } },

  // 環 ── 腕への見返り
  { id: 'areaScale', br: '環', g: '輪', n: '大輪', max: 4, step: 0.12,
    d: r => `面積による威力補正 +${(r * 0.12).toFixed(2)}`, apply: (s, r) => { s.areaScale += r * 0.12; } },
  { id: 'chainWin', br: '環', g: '環', n: '連環', max: 3, step: 0.3,
    d: r => `連鎖の猶予 +${(r * 0.3).toFixed(1)}秒`, apply: (s, r) => { s.chainWindow += r * 0.3; } },
  { id: 'chainMax', br: '環', g: '重', n: '重連', max: 2, step: 2,
    d: r => `連鎖の上限 +${r * 2}`, apply: (s, r) => { s.chainMax += r * 2; } },
  { id: 'dmg', br: '環', g: '鋭', n: '鋭刃', max: 5, step: 0.05,
    d: r => `縫撃の威力 +${r * 5}%`, apply: (s, r) => { s.dmg *= (1 + r * 0.05); } },
  { id: 'unravel', br: '環', g: '解', n: '解放', max: 3, step: 0.12,
    d: r => `「解」を +${r * 12}% 溜めた状態で始まる`, apply: (s, r) => { s.startGauge += r * 0.12; } },
  { id: 'mote', br: '環', g: '穫', n: '収穫', max: 3, step: 0.10,
    d: r => `光の実り +${r * 10}%`, apply: (s, r) => { s.moteMul *= (1 + r * 0.10); } },
  { id: 'magnet', br: '環', g: '引', n: '引寄', max: 3, step: 0.20,
    d: r => `光を集める範囲 +${r * 20}%`, apply: (s, r) => { s.magnet *= (1 + r * 0.20); } },
];

export const loomRank = (save, id) => save.loom[id] || 0;

/** 綻び核の所持数で、いま何段目まで開けられるか */
export function unlockedTier(save) {
  let t = 0;
  for (let i = 0; i < TIER_CORES.length; i++) if (save.cores >= TIER_CORES[i]) t = i;
  return t;
}

/** 次の1段を買えるか。買えない理由も返す */
export function canBuy(save, node) {
  const r = loomRank(save, node.id);
  if (r >= node.max) return { ok: false, why: 'max' };
  if (TIER_OF_RANK[r] > unlockedTier(save)) return { ok: false, why: 'locked', needCores: TIER_CORES[TIER_OF_RANK[r]] };
  const cost = RANK_COST[r];
  if (save.lumen < cost) return { ok: false, why: 'poor', cost };
  return { ok: true, cost };
}

export function buyNode(save, node) {
  const c = canBuy(save, node);
  if (!c.ok) return false;
  save.lumen -= c.cost;
  save.loom[node.id] = loomRank(save, node.id) + 1;
  writeSave(save);
  return true;
}

// --- 装備 -----------------------------------------------------------------
// すべて既存の stats フラグに乗る。数値の棒ではなく「縫い方」を変える。
export const GEAR = {
  needle: [
    { id: 'plain', n: '常針', g: '常', d: '癖のない針', cost: 0, night: 0, apply: () => {} },
    { id: 'burn', n: '灼針', g: '灼', d: '針先が灼く（+18/秒）。ただし、ひるみで押し退けられなくなる',
      cost: 10, night: 3, apply: s => { s.needle += 18; s.flinch = 0.35; } },
    { id: 'swift', n: '疾針', g: '疾', d: '移動速度 +12% / 最大HP −4',
      cost: 10, night: 2, apply: s => { s.speed *= 1.12; s.maxHp -= 4; } },
  ],
  thread: [
    { id: 'plain', n: '常糸', g: '常', d: '癖のない糸', cost: 0, night: 0, apply: () => {} },
    { id: 'haze', n: '霞糸', g: '霞', d: '糸の長さ −25% / 閉じる距離 2.5倍。小さく速い輪を続けて閉じる',
      cost: 12, night: 2, apply: s => { s.threadPts = Math.round(s.threadPts * 0.75); s.snap = Math.round(s.snap * 2.5); } },
    { id: 'rope', n: '大縄', g: '縄', d: '糸の長さ +35% / 移動速度 −8%。一度に大きく巻き取る',
      cost: 12, night: 3, apply: s => { s.threadPts = Math.round(s.threadPts * 1.35); s.speed *= 0.92; } },
  ],
  ring: [
    { id: 'plain', n: '常環', g: '常', d: '癖のない環', cost: 0, night: 0, apply: () => {} },
    { id: 'twin', n: '双環', g: '双', d: '縫った瞬間、自分の周りにも輪が生まれる',
      cost: 14, night: 4, apply: s => { s.twin += 1; } },
    { id: 'echo', n: '響環', g: '響', d: '0.5秒後、同じ輪がもう一度縫われる',
      cost: 14, night: 4, apply: s => { s.echo += 1; } },
  ],
};

export const SLOTS = [
  { key: 'needle', n: '針', d: '移動と接触' },
  { key: 'thread', n: '糸', d: '長さと閉じ方' },
  { key: 'ring', n: '環', d: '閉じた瞬間' },
];

export const gearItem = (slot, id) => GEAR[slot].find(x => x.id === id) || GEAR[slot][0];
export const gearOwned = (save, slot, id) => save.owned.includes(slot + '.' + id);

export function canCraft(save, slot, item) {
  if (gearOwned(save, slot, item.id)) return { ok: false, why: 'owned' };
  if ((save.nights[item.night] || {}).cleared !== true) return { ok: false, why: 'night', night: item.night };
  if (save.dew < item.cost) return { ok: false, why: 'poor', cost: item.cost };
  return { ok: true, cost: item.cost };
}

export function craftGear(save, slot, item) {
  const c = canCraft(save, slot, item);
  if (!c.ok) return false;
  save.dew -= c.cost;
  save.owned.push(slot + '.' + item.id);
  writeSave(save);
  return true;
}

export function equipGear(save, slot, id) {
  if (!gearOwned(save, slot, id)) return false;
  save.gear[slot] = id;
  writeSave(save);
  return true;
}

// --- 適用 -----------------------------------------------------------------
/** 走り出す直前の stats に、恒久強化と装備を乗せる */
export function applyMeta(stats, save) {
  for (const node of LOOM) {
    const r = loomRank(save, node.id);
    if (r > 0) node.apply(stats, r);
  }
  for (const s of SLOTS) gearItem(s.key, save.gear[s.key]).apply(stats);
  stats.maxHp = Math.max(1, stats.maxHp);
  stats.threadPts = Math.max(30, stats.threadPts);
  return stats;
}

// --- 走り終えたあとの精算 ---------------------------------------------------
/**
 * 拾ったものは勝敗に関わらず持ち帰る。踏破報酬はクリア時のみ。
 * 綻び核と次の夜の解放は初回クリアのみ。
 */
export function settle(save, night, result) {
  const rec = save.nights[night.id] || { cleared: false, bestScore: 0, bestKills: 0 };
  const first = result.win && !rec.cleared;

  const gained = { lumen: result.lumen, dew: result.dew, clear: 0, cores: 0, unlocked: 0, first };

  save.lumen += result.lumen;
  save.dew += result.dew;

  if (result.win) {
    gained.clear = night.reward.clear;
    save.lumen += night.reward.clear;
    if (first) {
      gained.cores = night.reward.firstCores;
      save.cores += night.reward.firstCores;
      const next = night.id + 1;
      if (next > save.unlocked) { save.unlocked = next; gained.unlocked = next; }
    } else if (night.reward.firstCores > 0) {
      gained.cores = 1;                 // 織主の再撃破は1個
      save.cores += 1;
    }
    rec.cleared = true;
  }

  rec.bestScore = Math.max(rec.bestScore, Math.round(result.score));
  rec.bestKills = Math.max(rec.bestKills, result.kills);
  save.nights[night.id] = rec;
  writeSave(save);
  return gained;
}

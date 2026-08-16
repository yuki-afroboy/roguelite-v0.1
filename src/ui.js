// DOM 側の表示。Canvas に載せると潰れる文字情報だけをこちらで持つ。
import { clamp, fmtTime, fmtNum, pick } from './util.js';
import { RARITY_NAME } from './upgrades.js';
import { sfxUI, sfxSelect } from './audio.js';
import { NIGHTS } from './nights.js';
import {
  LOOM, SLOTS, GEAR, RANK_COST, TIER_OF_RANK, TIER_CORES,
  loomRank, canBuy, unlockedTier, gearItem, gearOwned, canCraft,
} from './meta.js';

export const byId = id => document.getElementById(id);

const el = {};
let toastT = 0;
let heartN = 0;

export function initUI() {
  for (const id of ['hud', 'hearts', 'clock', 'purse', 'hudLumen', 'hudDew', 'chain', 'unravel', 'toast',
    'lvnum', 'killnum', 'lvfill', 'title', 'help', 'levelup', 'cards', 'luTitle',
    'result', 'rank', 'verdict', 'rNight', 'loot', 'unlockBox', 'stats', 'paused',
    'base', 'basePurse', 'baseSub', 'nightsel', 'nsPurse', 'nightList',
    'loom', 'loomPurse', 'loomBody', 'loomHint', 'gear', 'gearPurse', 'gearBody',
    'bestLine']) el[id] = byId(id);
}

export function show(name, v) { el[name]?.classList.toggle('hide', !v); }

// --- 通貨表示 --------------------------------------------------------------
function purseHTML(save) {
  return `<div class="coin lum">${fmtNum(save.lumen)}<i>光糸</i></div>
          <div class="coin core">${save.cores}<i>綻び核</i></div>
          <div class="coin dew">${save.dew}<i>霧の露</i></div>`;
}
function paintPurse(save) {
  for (const k of ['basePurse', 'nsPurse', 'loomPurse', 'gearPurse']) {
    if (el[k]) el[k].innerHTML = purseHTML(save);
  }
}

// --- HUD -------------------------------------------------------------------
export function buildHearts(n) {
  el.hearts.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'heart';
    el.hearts.appendChild(d);
  }
  heartN = n;
}

let lastLumen = -1, lastDew = -1, lastKills = -1, lastLv = -1, lastSec = -1, lastChain = 0;

export function updateHUD(G, dt) {
  if (heartN !== G.stats.maxHp) buildHearts(G.stats.maxHp);
  const hs = el.hearts.children;
  for (let i = 0; i < hs.length; i++) hs[i].classList.toggle('off', i >= G.player.hp);

  // 残り時間。夜には終わりがあることを常に見せる
  const left = Math.ceil(G.timeLeft);
  if (left !== lastSec) {
    lastSec = left;
    el.clock.firstChild.textContent = fmtTime(left);
    el.clock.classList.toggle('urgent', left <= 20);
  }

  // 光糸は「持ち帰るもの」なので、得点ではなくこれを常時見せる
  if (G.lumen !== lastLumen) { lastLumen = G.lumen; el.hudLumen.textContent = fmtNum(G.lumen); }
  if (G.dew !== lastDew) {
    lastDew = G.dew;
    el.hudDew.textContent = `露 ${G.dew}`;
    el.hudDew.classList.toggle('hide', G.dew === 0);
  }
  if (G.kills !== lastKills) { lastKills = G.kills; el.killnum.textContent = `${G.kills} 縫`; }
  if (G.lv !== lastLv) { lastLv = G.lv; el.lvnum.textContent = G.lv; }
  el.lvfill.style.width = clamp(G.xp / G.xpNeed, 0, 1) * 100 + '%';

  if (G.chain > lastChain && G.chain >= 2) {
    el.chain.innerHTML = `${G.chain}<b>連鎖</b>`;
    el.chain.classList.remove('pop');
    void el.chain.offsetWidth;
    el.chain.classList.add('pop');
  }
  lastChain = G.chain;

  const deg = clamp(G.gauge, 0, 1) * 360;
  el.unravel.style.background =
    `conic-gradient(from -90deg, #ffd98a 0deg ${deg}deg, rgba(255,255,255,.08) ${deg}deg 360deg)`;
  el.unravel.classList.toggle('ready', G.gauge >= 1);

  if (toastT > 0) { toastT -= dt; if (toastT <= 0) el.toast.classList.remove('show'); }
}

export function toast(msg, t = 2.4) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  toastT = t;
}

export function resetHUD() {
  lastLumen = -1; lastDew = -1; lastKills = -1; lastLv = -1; lastSec = -1; lastChain = 0;
  el.chain.classList.remove('pop');
  el.toast.classList.remove('show');
  el.hudDew.classList.add('hide');
  heartN = 0;
}

export function setBestLine(save) {
  const cleared = Object.values(save.nights).filter(n => n.cleared).length;
  el.bestLine.textContent = cleared ? `突破した夜 ${cleared} / ${NIGHTS.length}` : '';
}

// --- 拠点 ------------------------------------------------------------------
export function renderBase(save) {
  paintPurse(save);
  const cleared = Object.values(save.nights).filter(n => n.cleared).length;
  el.baseSub.textContent = `突破 ${cleared} / ${NIGHTS.length}`;
  const next = NIGHTS.find(n => n.id === save.unlocked) || NIGHTS[NIGHTS.length - 1];
  byId('goNightsSub').textContent = `次は「${next.name}」`;

  const bought = LOOM.reduce((a, n) => a + loomRank(save, n.id), 0);
  const total = LOOM.reduce((a, n) => a + n.max, 0);
  const affordable = LOOM.some(n => canBuy(save, n).ok);
  byId('goLoomSub').innerHTML = `鍛えた数 ${bought} / ${total}` +
    (affordable ? ' <span style="color:#ffd98a">・いま開ける</span>' : '');

  byId('goGearSub').textContent = SLOTS.map(s => gearItem(s.key, save.gear[s.key]).n).join(' ・ ');
}

// --- 夜選択 ----------------------------------------------------------------
export function renderNights(save, onPick) {
  paintPurse(save);
  el.nightList.innerHTML = '';
  for (const n of NIGHTS) {
    const rec = save.nights[n.id] || {};
    const locked = n.id > save.unlocked;
    const d = document.createElement('div');
    d.className = 'night' + (locked ? ' locked' : '') + (n.boss ? ' boss' : '') + (locked ? '' : ' on');
    d.innerHTML =
      `<div class="no">${n.id}</div>
       <div class="tx">
         <div class="tt">${n.name}${n.boss ? ' <span style="color:#ff9d4d;font-size:11px">織主</span>' : ''}</div>
         <div class="dd">${locked ? '前の夜を突破すると開く' : n.sub}</div>
       </div>
       <div class="meta">${fmtTime(n.dur)}<br>${rec.cleared
         ? `<span class="ok">踏破 +${n.reward.clear}</span>`
         : '未突破'}</div>`;
    if (!locked) d.addEventListener('click', () => { sfxSelect(); onPick(n); });
    el.nightList.appendChild(d);
  }
}

// --- 織機 ------------------------------------------------------------------
const BRANCH_DESC = {
  '糸': '何が可能になるか ── 長さと閉じ方',
  '針': '生き延びる力 ── 耐久と身のこなし',
  '環': '上手さへの見返り ── 面積・連鎖・実り',
};

export function renderLoom(save, onBuy) {
  paintPurse(save);
  el.loomBody.innerHTML = '';
  for (const br of ['糸', '針', '環']) {
    const wrap = document.createElement('div');
    wrap.className = 'branch';
    wrap.innerHTML = `<h3>${br}</h3><div class="bd">${BRANCH_DESC[br]}</div><div class="nodes"></div>`;
    const list = wrap.querySelector('.nodes');

    for (const node of LOOM.filter(n => n.br === br)) {
      const r = loomRank(save, node.id);
      const c = canBuy(save, node);
      const d = document.createElement('div');
      d.className = 'node';

      let pips = '';
      for (let i = 0; i < node.max; i++) {
        const locked = TIER_OF_RANK[i] > unlockedTier(save);
        pips += `<div class="pip ${i < r ? 'on' : locked ? 'tier' : ''}"></div>`;
      }

      let btn;
      if (c.ok) btn = `<button class="buy on" data-id="${node.id}">${c.cost}</button>`;
      else if (c.why === 'max') btn = `<button class="buy max">極</button>`;
      else if (c.why === 'locked') btn = `<button class="buy lock">核 ${c.needCores}</button>`;
      else btn = `<button class="buy no">${c.cost}</button>`;

      d.innerHTML =
        `<div class="g">${node.g}</div>
         <div class="tx">
           <div class="tt">${node.n} <span style="color:#5d5786;font-size:11px">${r}/${node.max}</span></div>
           <div class="dd">${node.d(r + 1 > node.max ? node.max : r + 1)}</div>
           <div class="pips">${pips}</div>
         </div>${btn}`;

      const b = d.querySelector('.buy.on');
      if (b) b.addEventListener('click', () => onBuy(node));
      list.appendChild(d);
    }
    el.loomBody.appendChild(wrap);
  }

  const tier = unlockedTier(save);
  const nextTier = TIER_CORES[tier + 1];
  el.loomHint.textContent = nextTier === undefined
    ? 'すべての段が開いている'
    : `綻び核 ${nextTier} 個で、次の段が開く（いま ${save.cores} 個）`;
}

// --- 装備 ------------------------------------------------------------------
export function renderGear(save, onEquip, onCraft) {
  paintPurse(save);
  el.gearBody.innerHTML = '';
  for (const slot of SLOTS) {
    const wrap = document.createElement('div');
    wrap.className = 'slot';
    wrap.innerHTML = `<h3>${slot.n}</h3><div class="sd">${slot.d}</div><div class="gears"></div>`;
    const list = wrap.querySelector('.gears');

    for (const item of GEAR[slot.key]) {
      const owned = gearOwned(save, slot.key, item.id);
      const equipped = save.gear[slot.key] === item.id;
      const cc = owned ? null : canCraft(save, slot.key, item);
      const d = document.createElement('div');
      d.className = 'gear' + (equipped ? ' equipped' : '') +
        (!owned && cc && !cc.ok && cc.why === 'night' ? ' locked' : '') +
        (!owned ? ' craft' : '') + ' on';

      let st;
      if (equipped) st = '装備中';
      else if (owned) st = '外す→着ける';
      else if (cc.why === 'night') st = `夜${cc.night}を突破`;
      else st = `露 ${item.cost}`;

      d.innerHTML =
        `<div class="g">${item.g}</div>
         <div class="tx"><div class="tt">${item.n}</div><div class="dd">${item.d}</div></div>
         <div class="st">${st}</div>`;

      d.addEventListener('click', () => {
        if (owned) { if (!equipped) { sfxSelect(); onEquip(slot.key, item.id); } }
        else if (cc.ok) { sfxSelect(); onCraft(slot.key, item); }
        else sfxUI();
      });
      list.appendChild(d);
    }
    el.gearBody.appendChild(wrap);
  }
}

// --- レベルアップ -----------------------------------------------------------
export function showCards(cards, levels, onPick) {
  el.cards.innerHTML = '';
  el.luTitle.textContent = '糸 を 編 む';
  cards.forEach(c => {
    const lv = levels[c.id] || 0;
    const d = document.createElement('div');
    d.className = `card on r${c.r}`;
    d.innerHTML =
      `<div class="glyph">${c.g}</div>
       <div class="tx">
         <div class="tt">${c.n}</div>
         <div class="dd">${c.d(lv + 1)}</div>
         <div class="lvl">${RARITY_NAME[c.r]} ・ ${lv > 0 ? `所持 ${lv} → ${lv + 1}` : '新'}</div>
       </div>`;
    d.addEventListener('click', () => { sfxSelect(); onPick(c); }, { once: true });
    el.cards.appendChild(d);
  });
  show('levelup', true);
}

// --- 結果 -------------------------------------------------------------------
const WIN_FLAVOR = ['夜 明 け', '突 破'];
const LOSE_FLAVOR = ['綻 び', '力 尽 き'];

function rankOf(score, dur) {
  const perMin = score / Math.max(dur / 60, 0.5);
  if (perMin >= 9000) return 'S+';
  if (perMin >= 6500) return 'S';
  if (perMin >= 4500) return 'A';
  if (perMin >= 3000) return 'B';
  if (perMin >= 1600) return 'C';
  return 'D';
}

export function showResult(r, gained) {
  el.rank.textContent = rankOf(r.score, r.dur);
  el.verdict.textContent = r.win ? pick(WIN_FLAVOR) : pick(LOSE_FLAVOR);
  el.rNight.textContent = `夜 ${r.nightId} ・ ${r.nightName}`;

  const rows = [];
  rows.push(`<div class="lrow lum"><span>拾った光糸</span><b>+${fmtNum(gained.lumen)}</b></div>`);
  if (gained.dew > 0) rows.push(`<div class="lrow dew"><span>霧の露</span><b>+${gained.dew}</b></div>`);
  rows.push(`<div class="lrow lum${r.win ? '' : ' miss'}"><span>踏破の報い</span><b>${r.win ? '+' + fmtNum(gained.clear) : '—'}</b></div>`);
  if (gained.cores > 0) {
    rows.push(`<div class="lrow core"><span>綻び核</span><b>+${gained.cores}</b></div>`);
  } else if (r.nightId === 5) {
    rows.push(`<div class="lrow core miss"><span>綻び核</span><b>—</b></div>`);
  }
  el.loot.innerHTML = rows.join('');

  el.unlockBox.innerHTML = gained.unlocked
    ? `<div class="unlock">夜 ${gained.unlocked} が開いた</div>`
    : (r.win ? '' : `<div class="unlock" style="color:var(--dim);border-color:#ffffff18;background:#ffffff06">拾ったものは持ち帰った。もう一度挑める</div>`);

  const st = [
    ['縫い落とした獣', fmtNum(r.kills)],
    ['一縫の最多', `${r.bestLoop} 体`],
    ['最大連鎖', `${r.maxChain} 連`],
    ['閉じた輪', fmtNum(r.stitches)],
    ['到達', `LV ${r.lv}`],
    ['生存', fmtTime(r.time)],
    ['得点', fmtNum(r.score)],
  ];
  el.stats.innerHTML = st.map(([k, v]) =>
    `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
  show('result', true);
}

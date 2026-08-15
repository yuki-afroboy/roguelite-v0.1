// DOM 側の表示。Canvas に載せると潰れる文字情報だけをこちらで持つ。
import { clamp, fmtTime, fmtNum, pick, store } from './util.js';
import { STYLES, RARITY_NAME } from './upgrades.js';
import { sfxUI, sfxSelect } from './audio.js';
import { RUN_TIME } from './game.js';

export const byId = id => document.getElementById(id);

const el = {};
let toastT = 0;
let heartN = 0;

export function initUI() {
  for (const id of ['hud', 'hearts', 'clock', 'score', 'chain', 'unravel', 'toast',
    'lvnum', 'killnum', 'lvfill', 'title', 'help', 'levelup', 'cards', 'luTitle',
    'result', 'rank', 'verdict', 'flavor', 'stats', 'paused', 'styles', 'bestLine']) el[id] = byId(id);
  renderStyles();
  refreshBest();
}

export function show(name, v) {
  el[name]?.classList.toggle('hide', !v);
}

// --- 型セレクト ------------------------------------------------------------
let styleId = 'swift';
export const getStyle = () => styleId;

function renderStyles() {
  el.styles.innerHTML = '';
  for (const s of STYLES) {
    const d = document.createElement('div');
    d.className = 'style on' + (s.id === styleId ? ' sel' : '');
    d.innerHTML = `<div class="g">${s.g}</div><div class="n">${s.n}</div><div class="d">${s.d}</div>`;
    d.addEventListener('click', () => {
      styleId = s.id; sfxUI();
      [...el.styles.children].forEach(c => c.classList.remove('sel'));
      d.classList.add('sel');
    });
    el.styles.appendChild(d);
  }
}

export function refreshBest() {
  const b = store('best') || 0;
  el.bestLine.textContent = b ? `最高記録 ${fmtNum(b)}` : '';
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

let lastChain = 0, lastScore = -1, lastKills = -1, lastLv = -1, lastSec = -1;

export function updateHUD(G, dt) {
  if (heartN !== G.stats.maxHp) buildHearts(G.stats.maxHp);
  const hs = el.hearts.children;
  for (let i = 0; i < hs.length; i++) hs[i].classList.toggle('off', i >= G.player.hp);

  const sec = Math.min(G.t, RUN_TIME) | 0;
  if (sec !== lastSec) {
    lastSec = sec;
    el.clock.firstChild.textContent = fmtTime(sec);
  }
  const sc = Math.round(G.score);
  if (sc !== lastScore) { lastScore = sc; el.score.firstChild.textContent = fmtNum(sc); }
  if (G.kills !== lastKills) { lastKills = G.kills; el.killnum.textContent = `${G.kills} 縫`; }
  if (G.lv !== lastLv) { lastLv = G.lv; el.lvnum.textContent = G.lv; }
  el.lvfill.style.width = clamp(G.xp / G.xpNeed, 0, 1) * 100 + '%';

  // 連鎖
  if (G.chain > lastChain && G.chain >= 2) {
    el.chain.innerHTML = `${G.chain}<b>連鎖</b>`;
    el.chain.classList.remove('pop');
    void el.chain.offsetWidth;
    el.chain.classList.add('pop');
  }
  lastChain = G.chain;

  // 解
  const deg = clamp(G.gauge, 0, 1) * 360;
  el.unravel.style.background =
    `conic-gradient(from -90deg, #ffd98a 0deg ${deg}deg, rgba(255,255,255,.08) ${deg}deg 360deg)`;
  el.unravel.classList.toggle('ready', G.gauge >= 1);

  if (toastT > 0) {
    toastT -= dt;
    if (toastT <= 0) el.toast.classList.remove('show');
  }
}

export function toast(msg, t = 2.4) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  toastT = t;
}

export function resetHUD() {
  lastChain = 0; lastScore = -1; lastKills = -1; lastLv = -1; lastSec = -1;
  el.chain.classList.remove('pop');
  el.toast.classList.remove('show');
  heartN = 0;
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
const WIN_FLAVOR = [
  '獣の主は解け、夜は縫い合わされた。\n朝が、少しだけ早く来る。',
  '最後のひと針が、闇の縫い目を断った。\n糸は、まだ光っている。',
];
const LOSE_FLAVOR = [
  '指先の光が消える。\n夜は、まだ綻んだままだ。',
  '糸は切れた。\nだが、縫い方は覚えた。',
  '闇に呑まれる。\n次はもっと大きく囲め。',
];

function rankOf(s) {
  if (s >= 110000) return ['S+', '#fff'];
  if (s >= 70000) return ['S', '#ffd98a'];
  if (s >= 46000) return ['A', '#ffd98a'];
  if (s >= 29000) return ['B', '#c08cff'];
  if (s >= 15000) return ['C', '#7df0ff'];
  return ['D', '#8a83ad'];
}

export function showResult(r) {
  const [rk] = rankOf(r.score);
  el.rank.textContent = rk;
  el.verdict.textContent = r.win ? '夜 明 け' : '綻 び';
  el.flavor.textContent = (r.win ? pick(WIN_FLAVOR) : pick(LOSE_FLAVOR));

  const rows = [
    ['縫い落とした獣', fmtNum(r.kills), false],
    ['最大連鎖', `${r.maxChain} 連`, false],
    ['一縫の最多', `${r.bestLoop} 体`, false],
    ['閉じた輪', fmtNum(r.stitches), false],
    ['到達', `LV ${r.lv} ・ ${r.style}`, false],
    ['生存', fmtTime(r.time), false],
    ['得点', fmtNum(r.score), true],
  ];
  el.stats.innerHTML = rows.map(([k, v, hi]) =>
    `<div class="stat${hi ? ' hi' : ''}"><span>${k}</span><b>${v}${hi && r.isBest ? '<span class="newbest">最高</span>' : ''}</b></div>`
  ).join('');
  show('result', true);
  refreshBest();
}

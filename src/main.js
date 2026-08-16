// 起動と束ね役。画面遷移とセーブの持ち回りはここに集約する。
import { Game } from './game.js';
import { inputInit, inputReset, input } from './input.js';
import {
  byId, initUI, show, resetHUD, buildHearts, showCards, showResult,
  toast, updateHUD, setBestLine, renderBase, renderNights, renderLoom, renderGear,
} from './ui.js';
import {
  loadSave, resetSave, settle, buyNode, equipGear, craftGear,
  LOOM, canBuy, loomRank,
} from './meta.js';
import { audioResume, audioMuted, musicStop, sfxUI } from './audio.js';

const cv = byId('stage');
const game = new Game(cv);

let save = loadSave();
let scene = 'title';          // title | help | base | nightsel | loom | gear | play | result
let currentNight = null;

initUI();
inputInit(window);

const SCREENS = ['title', 'help', 'base', 'nightsel', 'loom', 'gear', 'result', 'paused', 'levelup'];
function only(name) {
  for (const s of SCREENS) show(s, s === name);
  show('hud', name === null);
}

// --- 画面 ------------------------------------------------------------------
function toTitle() {
  scene = 'title'; musicStop(); game.enterTitle();
  only('title'); setBestLine(save);
}
function toBase() {
  scene = 'base'; musicStop(); game.enterTitle();
  renderBase(save); only('base');
}
function toNights() {
  scene = 'nightsel';
  renderNights(save, n => startNight(n.id));
  only('nightsel');
}
function toLoom() {
  scene = 'loom';
  const rerender = () => renderLoom(save, node => {
    if (buyNode(save, node)) { sfxUI(); rerender(); }
  });
  rerender();
  only('loom');
}
function toGear() {
  scene = 'gear';
  const rerender = () => renderGear(save,
    (slot, id) => { equipGear(save, slot, id); rerender(); },
    (slot, item) => { craftGear(save, slot, item); rerender(); });
  rerender();
  only('gear');
}

function startNight(id) {
  audioResume();
  currentNight = id;
  scene = 'play';
  only(null);
  resetHUD();
  inputReset();
  game.start(id, save);
  buildHearts(game.stats.maxHp);
}

// --- ゲームからのフック ------------------------------------------------------
game.onLevelUp = cards => {
  showCards(cards, game.levels, card => { show('levelup', false); game.applyCard(card); });
};

game.onEnd = result => {
  scene = 'result';
  show('hud', false);
  const gained = settle(save, game.night, result);
  setTimeout(() => { showResult(result, gained); }, 620);
};

game.onToast = (m, t) => toast(m, t);

input.onTap = () => { if (scene === 'play' && game.running) game.tryUnravel(); };

// --- ボタン ----------------------------------------------------------------
byId('startBtn').addEventListener('click', () => { audioResume(); sfxUI(); toBase(); });
byId('howBtn').addEventListener('click', () => { audioResume(); sfxUI(); scene = 'help'; only('help'); });
byId('helpBack').addEventListener('click', () => { sfxUI(); toTitle(); });
byId('baseHelp').addEventListener('click', () => { sfxUI(); scene = 'help'; only('help'); });
byId('baseTitle').addEventListener('click', () => { sfxUI(); toTitle(); });

byId('goNights').addEventListener('click', () => { sfxUI(); toNights(); });
byId('goLoom').addEventListener('click', () => { sfxUI(); toLoom(); });
byId('goGear').addEventListener('click', () => { sfxUI(); toGear(); });
byId('nsBack').addEventListener('click', () => { sfxUI(); toBase(); });
byId('loomBack').addEventListener('click', () => { sfxUI(); toBase(); });
byId('gearBack').addEventListener('click', () => { sfxUI(); toBase(); });

byId('toBaseBtn').addEventListener('click', () => { sfxUI(); toBase(); });
byId('againBtn').addEventListener('click', () => { sfxUI(); startNight(currentNight); });

byId('resumeBtn').addEventListener('click', () => { sfxUI(); show('paused', false); show('hud', true); game.pause(false); });
byId('quitBtn').addEventListener('click', () => { sfxUI(); show('paused', false); game.finish(false); });
byId('pause').addEventListener('click', () => {
  if (scene !== 'play' || !game.running) return;
  sfxUI(); game.pause(true); show('paused', true); inputReset();
});

let wipeT = 0;
byId('wipeBtn').addEventListener('pointerdown', () => { wipeT = Date.now(); });
byId('wipeBtn').addEventListener('click', () => {
  if (Date.now() - wipeT < 900) { toast('長押しで初期化', 2); return; }
  save = resetSave(); sfxUI(); toBase();
});

const muteBtn = byId('muteBtn');
muteBtn.addEventListener('click', () => {
  audioResume();
  const m = !audioMuted();
  audioMuted(m);
  muteBtn.textContent = m ? '♪ OFF' : '♪ ON';
});

window.addEventListener('resize', () => game.resize());
window.addEventListener('orientationchange', () => setTimeout(() => game.resize(), 120));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && scene === 'play' && game.running) {
    game.pause(true); show('paused', true); inputReset();
  }
});

// --- ループ ----------------------------------------------------------------
let last = performance.now();
let fpsAcc = 0, fpsN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;          // タブ復帰時の大ジャンプを潰す
  if (dt <= 0) return;

  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) { window.__fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

  if (scene === 'play') {
    game.update(dt);
    game.render();
    if (!game.over) updateHUD(game, dt);
  } else {
    game.titleTick(dt);
    game.render();
  }
}

toTitle();
requestAnimationFrame(frame);

window.__G = game;          // 調整・計測用の窓口
window.__input = input;
window.__save = () => save;
window.__meta = { loadSave, settle, buyNode, canBuy, loomRank, LOOM };  // 計測用

// 何かの拍子に音が止まった端末向けの保険
window.addEventListener('pointerdown', () => audioResume(), { once: true });

// 起動と束ね役。
import { Game } from './game.js';
import { inputInit, inputReset, input } from './input.js';
import {
  byId, initUI, show, getStyle, resetHUD, buildHearts,
  showCards, showResult, toast, updateHUD, refreshBest,
} from './ui.js';
import { audioResume, audioMuted, musicStop, sfxUI } from './audio.js';

const cv = document.getElementById('stage');
const game = new Game(cv);

initUI();
inputInit(window);

// --- 画面遷移 --------------------------------------------------------------
let scene = 'title';   // title | help | play

function toTitle() {
  scene = 'title';
  musicStop();
  game.enterTitle();
  show('title', true); show('help', false); show('result', false);
  show('levelup', false); show('paused', false); show('hud', false);
  refreshBest();
}

function startRun() {
  audioResume();
  scene = 'play';
  show('title', false); show('help', false); show('result', false);
  show('levelup', false); show('paused', false); show('hud', true);
  resetHUD();
  inputReset();
  game.start(getStyle());
  buildHearts(game.stats.maxHp);
}

game.onLevelUp = cards => {
  showCards(cards, game.levels, card => {
    show('levelup', false);
    game.applyCard(card);
  });
};

game.onEnd = result => {
  show('hud', false);
  setTimeout(() => showResult(result), 620);
};

game.onToast = (m, t) => toast(m, t);

input.onTap = () => { if (scene === 'play' && game.running) game.tryUnravel(); };

// --- ボタン ----------------------------------------------------------------
byId('startBtn').addEventListener('click', () => { sfxUI(); startRun(); });
byId('howBtn').addEventListener('click', () => { audioResume(); sfxUI(); show('title', false); show('help', true); });
byId('helpBack').addEventListener('click', () => { sfxUI(); show('help', false); show('title', true); });
byId('againBtn').addEventListener('click', () => { sfxUI(); startRun(); });
byId('titleBtn').addEventListener('click', () => { sfxUI(); toTitle(); });
byId('resumeBtn').addEventListener('click', () => { sfxUI(); show('paused', false); game.pause(false); });
byId('quitBtn').addEventListener('click', () => { sfxUI(); show('paused', false); game.finish(false); });
byId('pause').addEventListener('click', () => {
  if (scene !== 'play' || !game.running) return;
  sfxUI(); game.pause(true); show('paused', true); inputReset();
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

game.enterTitle();
requestAnimationFrame(frame);

window.__G = game;          // 調整・計測用の窓口
window.__input = input;

// 何かの拍子に音が止まった端末向けの保険
window.addEventListener('pointerdown', () => audioResume(), { once: true });

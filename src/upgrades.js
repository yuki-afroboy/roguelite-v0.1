// 成長カード。数値強化と、輪の意味そのものを変えるフラグ系を混ぜる。
import { pickWeighted, pick } from './util.js';

/** 一戦ごとの初期値 */
export function baseStats() {
  return {
    speed: 240,        // px/s
    threadPts: 130,    // 節の数。糸の実長 = maxPts * 7px ≒ 910px
                       // （閉じられる円の半径の上限 ≒ 実長 / 2π）
    dmg: 15,           // 縫撃の基礎威力
    areaScale: 1,      // 面積ボーナス倍率
    magnet: 96,        // 光の吸引半径
    chainWindow: 3.4,  // 連鎖の猶予(秒)
    chainMax: 6,
    maxHp: 8,
    iframe: 1.6,
    needle: 0,         // 針先の接触DPS
    lure: 0,           // 敵を寄せる度合い
    pierce: false,     // 鎧無視
    burn: 0,           // 閉じた領域が燃える秒数
    wave: 0,           // 縫閉時の衝撃波の威力倍率
    echo: 0,           // 残響の回数
    freeze: 0,         // 縫閉時に敵を止める秒数
    unravelGain: 1,
    moteMul: 1,
    doubleStitch: 0,   // 領域内への追撃回数
    twin: 0,           // 縫閉時、自分の周りにも輪が生まれる
    snap: 24,          // 輪が閉じたことにする距離(px)。装備「霞糸」が触る
    startGauge: 0,     // 「解」の初期充填
    flinch: 1,         // 被弾時に敵を押し退ける強さの倍率
  };
}

/** 開始時に選ぶ「縫い型」 */
export const STYLES = [
  {
    id: 'swift', g: '疾', n: '疾 型', d: '速いが糸は短い',
    apply: s => { s.speed *= 1.16; s.threadPts = Math.round(s.threadPts * 0.86); },
  },
  {
    id: 'long', g: '長', n: '長 型', d: '糸は長いが鈍い',
    apply: s => { s.threadPts = Math.round(s.threadPts * 1.34); s.speed *= 0.92; },
  },
  {
    id: 'keen', g: '鋭', n: '鋭 型', d: '鋭いが脆い',
    apply: s => { s.dmg *= 1.45; s.maxHp -= 2; s.needle = 6; },
  },
];

const R = { COMMON: 0, RARE: 1, EPIC: 2 };

export const CARDS = [
  { id: 'len', g: '糸', n: '長糸', r: R.COMMON, max: 6, w: 10,
    d: l => `糸の長さ +18%（現在 ${l}/6）`,
    apply: s => { s.threadPts = Math.round(s.threadPts * 1.18); } },

  { id: 'spd', g: '疾', n: '疾走', r: R.COMMON, max: 5, w: 10,
    d: () => '移動速度 +9%',
    apply: s => { s.speed *= 1.09; } },

  { id: 'dmg', g: '鋭', n: '鋭刃', r: R.COMMON, max: 6, w: 10,
    d: () => '縫撃の威力 +24%',
    apply: s => { s.dmg *= 1.24; } },

  { id: 'mag', g: '引', n: '引寄', r: R.COMMON, max: 4, w: 8,
    d: () => '光を集める範囲 +45%',
    apply: s => { s.magnet *= 1.45; } },

  { id: 'chain', g: '環', n: '連環', r: R.RARE, max: 4, w: 6,
    d: () => '連鎖の猶予 +0.55秒 / 上限 +2',
    apply: s => { s.chainWindow += 0.55; s.chainMax += 2; } },

  { id: 'hp', g: '殻', n: '堅殻', r: R.COMMON, max: 4, w: 7,
    d: () => '最大HP +1（全快する）',
    apply: s => { s.maxHp += 1; } },

  { id: 'area', g: '輪', n: '大輪', r: R.RARE, max: 4, w: 6,
    d: () => '広く囲むほどの威力補正 +55%',
    apply: s => { s.areaScale += 0.55; } },

  { id: 'needle', g: '熱', n: '針熱', r: R.COMMON, max: 5, w: 8,
    d: () => '糸の先端が触れた獣を灼く（+10/秒）',
    apply: s => { s.needle += 10; } },

  { id: 'burn', g: '灼', n: '灼痕', r: R.RARE, max: 3, w: 5,
    d: () => '縫った領域が1.6秒燃え続ける',
    apply: s => { s.burn += 1.6; } },

  { id: 'wave', g: '波', n: '波紋', r: R.RARE, max: 3, w: 5,
    d: () => '輪を閉じると外側へ衝撃波が走る',
    apply: s => { s.wave += 1; } },

  { id: 'echo', g: '響', n: '残響', r: R.EPIC, max: 2, w: 2.2,
    d: () => '0.5秒後、同じ輪がもう一度縫われる',
    apply: s => { s.echo += 1; } },

  { id: 'lure', g: '誘', n: '誘蛾', r: R.RARE, max: 3, w: 5,
    d: () => '獣が僅かに逸り、群れが密になる',
    apply: s => { s.lure += 1; } },

  { id: 'freeze', g: '停', n: '停時', r: R.RARE, max: 3, w: 4.5,
    d: () => '縫閉時、領域内の生き残りを0.7秒止める',
    apply: s => { s.freeze += 0.7; } },

  { id: 'pierce', g: '貫', n: '貫穿', r: R.EPIC, max: 1, w: 2,
    d: () => '鎧を無視して縫い抜く',
    apply: s => { s.pierce = true; } },

  { id: 'double', g: '重', n: '二重縫', r: R.EPIC, max: 2, w: 2.2,
    d: () => '領域内へ追撃が1回増える（威力60%）',
    apply: s => { s.doubleStitch += 1; } },

  { id: 'twin', g: '双', n: '双環', r: R.RARE, max: 3, w: 4.5,
    d: l => `縫った瞬間、自分の周り(半径${100 + l * 34})にも輪が生まれる`,
    apply: s => { s.twin += 1; } },

  { id: 'unrav', g: '解', n: '解放', r: R.COMMON, max: 4, w: 7,
    d: () => '「解」の溜まりが +45% 速くなる',
    apply: s => { s.unravelGain += 0.45; } },

  { id: 'mote', g: '穫', n: '収穫', r: R.COMMON, max: 4, w: 7,
    d: () => '光の実りが +28%',
    apply: s => { s.moteMul *= 1.28; } },

  { id: 'iframe', g: '軽', n: '軽身', r: R.COMMON, max: 3, w: 6,
    d: () => '被弾後の無敵 +0.45秒',
    apply: s => { s.iframe += 0.45; } },
];

export const RARITY_NAME = ['常', '稀', '極'];

/**
 * 取り切ったあとに配る繰り返し可能な札。
 * これが無いと上限を無視した札が配られ、上限そのものが意味を失う。
 */
export const FILLERS = [
  { id: 'patch', g: '繕', n: '繕い', r: R.COMMON, max: Infinity, w: 1,
    d: () => 'HP を1回復し、縫撃の威力 +6%',
    apply: s => { s.dmg *= 1.06; s.heal = (s.heal || 0) + 1; } },
  { id: 'gleam', g: '灯', n: '灯し', r: R.COMMON, max: Infinity, w: 1,
    d: () => '移動速度 +3% / 糸の長さ +4%',
    apply: s => { s.speed *= 1.03; s.threadPts = Math.round(s.threadPts * 1.04); } },
];

/** 手札を3枚配る。取り切った札は除外し、足りなければ繰り返し札で埋める。 */
export function drawCards(levels, n = 3) {
  const bag = CARDS.filter(c => (levels[c.id] || 0) < c.max);
  const out = [];
  while (out.length < n && bag.length) {
    const c = pickWeighted(bag);
    out.push(c);
    bag.splice(bag.indexOf(c), 1);
  }
  const fill = FILLERS.slice();
  while (out.length < n) out.push(fill.length ? fill.shift() : pick(FILLERS));
  return out;
}

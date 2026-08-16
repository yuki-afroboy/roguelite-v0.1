// 夜（ステージ）の定義。難度はここだけで決まる。
//
// 以前は難度が game.js の中の経過時間ハードコード（t > 50 / 135 / 205…）で
// 作られていたため、夜を短く切ると敵種が半分も出なかった。
// 敵構成・敵HP・湧き密度・レベル曲線をすべて夜の側へ移してある。

/**
 * dens  : 同時に何体いてほしいか。base + t*growth（cap で頭打ち）
 * ceil  : 1秒あたり何体まで湧かせてよいか。base + t*growth
 *         ── 総キル数はほぼこの上限で決まる（計測済み）ので、
 *            「上位の夜ほど多く倒せる」はここで作る
 * kinds : 種ごとの登場時刻と重み。w = w0 + (t - at) * wg
 * xpScale: レベル曲線の伸縮。夜ごとに目標Lvへ着地させるための係数
 */
export const NIGHTS = [
  {
    id: 1, name: '初めの綻び', sub: 'まず、囲む',
    dur: 150, baseHp: 1.00, ramp: 0.0016, targetLv: 6, xpScale: 4.3, lumenRate: 0.22, dewRate: 0,
    // 実機で「1種類・低密度の2分半は退屈」と分かったので、
    // 群れを厚くし、後半に疾を出して手触りを変える。
    dens: { base: 30, growth: 0.30, cap: 88 },
    ceil: { base: 2.6, growth: 0.052 },
    kinds: [
      { k: 'hotsure', at: 0, w0: 10, wg: 0 },
      { k: 'shitsu', at: 95, w0: 1.5, wg: 0.010 },
    ],
    boss: null,
    reward: { clear: 70, firstCores: 0 },
    teach: '走れば群れが尾を引く。その尾を巻き取れ',
  },
  {
    id: 2, name: '群れる夜', sub: '大きく囲む',
    dur: 210, baseHp: 1.08, ramp: 0.0016, targetLv: 8, xpScale: 5.2, lumenRate: 0.24, dewRate: 0.007,
    dens: { base: 32, growth: 0.34, cap: 105 },
    ceil: { base: 2.1, growth: 0.042 },
    kinds: [
      { k: 'hotsure', at: 0, w0: 10, wg: 0 },
      { k: 'shitsu', at: 48, w0: 3, wg: 0.010 },
    ],
    boss: null,
    reward: { clear: 105, firstCores: 0 },
    teach: '広く囲むほど、深く縫える',
  },
  {
    id: 3, name: '裂ける夜', sub: '二度縫う',
    dur: 225, baseHp: 1.20, ramp: 0.0017, targetLv: 10, xpScale: 8.0, lumenRate: 0.13, dewRate: 0.005,
    dens: { base: 34, growth: 0.36, cap: 120 },
    ceil: { base: 2.4, growth: 0.046 },
    kinds: [
      { k: 'hotsure', at: 0, w0: 9, wg: 0 },
      { k: 'shitsu', at: 20, w0: 5, wg: 0.014 },
      { k: 'retsu', at: 70, w0: 2.4, wg: 0.011 },
    ],
    boss: null,
    reward: { clear: 150, firstCores: 0 },
    teach: '裂は分かれる。二度目を見越して縫え',
  },
  {
    id: 4, name: '間合いの夜', sub: '弾を払う',
    dur: 240, baseHp: 1.32, ramp: 0.0018, targetLv: 12, xpScale: 9.4, lumenRate: 0.12, dewRate: 0.004,
    dens: { base: 29, growth: 0.28, cap: 105 },
    ceil: { base: 2.7, growth: 0.050 },
    kinds: [
      { k: 'hotsure', at: 0, w0: 8, wg: 0 },
      { k: 'shitsu', at: 15, w0: 5, wg: 0.012 },
      { k: 'retsu', at: 55, w0: 3, wg: 0.010 },
      { k: 'toga', at: 95, w0: 1.1, wg: 0.005 },
      { k: 'yoroi', at: 150, w0: 0.7, wg: 0.004 },
    ],
    boss: null,
    reward: { clear: 205, firstCores: 0 },
    teach: '飛んでくるものは、糸の先で払える',
  },
  {
    id: 5, name: '織主・綻', sub: '硬い相手を崩す',
    dur: 300, baseHp: 1.45, ramp: 0.0019, targetLv: 15, xpScale: 4.3, lumenRate: 0.17, dewRate: 0.005,
    dens: { base: 30, growth: 0.30, cap: 112 },
    ceil: { base: 3.0, growth: 0.056 },
    kinds: [
      { k: 'hotsure', at: 0, w0: 8, wg: 0 },
      { k: 'shitsu', at: 10, w0: 5, wg: 0.011 },
      { k: 'retsu', at: 45, w0: 3, wg: 0.009 },
      { k: 'toga', at: 75, w0: 1.2, wg: 0.005 },
      { k: 'yoroi', at: 70, w0: 1.6, wg: 0.007 },
    ],
    // 制限時間の 45% 地点で出現。倒しても夜は続き、時間まで生き延びれば突破
    boss: { at: 0.45, hp: 2300, name: '織主・綻', final: true },
    reward: { clear: 300, firstCores: 2 },
    teach: '鎧と織主は、一縫では落ちない',
  },
];

export const nightById = id => NIGHTS.find(n => n.id === id) || NIGHTS[0];

/** その夜で出る種の重み表を、経過時間から作る */
export function nightSpawnPlan(night, t) {
  const w = [];
  for (const k of night.kinds) {
    if (t < k.at) continue;
    w.push({ kind: k.k, w: Math.max(0.2, k.w0 + (t - k.at) * k.wg) });
  }
  if (!w.length) w.push({ kind: 'hotsure', w: 1 });
  return w;
}

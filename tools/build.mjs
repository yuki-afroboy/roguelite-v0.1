// src/*.js を 1 枚の HTML に畳む。依存なし・バンドラなし。
//
// これが成立するのは、ソース側で次の書き方だけを使うと決めているから：
//   - import は `import { a, b } from './x.js';` のみ（default import は使わない）
//   - export は `export function|class|const|let` の前置のみ（`export { ... }` は使わない）
//   - モジュール間で識別子は衝突させない
// 破った場合はここで検出して落とす。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 依存順（下ほど上に依存する）
const ORDER = [
  'util.js', 'audio.js', 'input.js', 'fx.js', 'thread.js',
  'entities.js', 'upgrades.js', 'nights.js', 'meta.js', 'game.js', 'ui.js', 'main.js',
];

const IMPORT_RE = /^[ \t]*import\s+[\s\S]*?from\s+['"][^'"]*['"];?[ \t]*$/gm;
const BAD_RE = /^[ \t]*export\s*\{|^[ \t]*export\s+default\b|^[ \t]*import\s+(?:\*|[A-Za-z_$])/m;

const seen = new Map();
const chunks = [];

for (const name of ORDER) {
  const path = resolve(root, 'src', name);
  let code = readFileSync(path, 'utf8');

  const bad = code.match(BAD_RE);
  if (bad) throw new Error(`${name}: この束ね方が扱えない構文です → ${bad[0].trim()}`);

  code = code.replace(IMPORT_RE, '').replace(/^[ \t]*export[ \t]+/gm, '');

  // 識別子の重複を検出（後勝ちで壊れるのを防ぐ）
  for (const m of code.matchAll(/^(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm)) {
    const prev = seen.get(m[1]);
    if (prev) throw new Error(`識別子 "${m[1]}" が ${prev} と ${name} で衝突しています`);
    seen.set(m[1], name);
  }
  chunks.push(`/* ===== src/${name} ===== */\n${code.trim()}\n`);
}

const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const bundled = html.replace(
  /<script type="module" src="\.\/src\/main\.js"><\/script>/,
  `<script>\n(() => {\n'use strict';\n${chunks.join('\n')}\n})();\n</script>`
);
if (bundled === html) throw new Error('index.html の script タグを差し替えられませんでした');

mkdirSync(resolve(root, 'dist'), { recursive: true });
const out = resolve(root, 'dist', 'nuiyo.html');
writeFileSync(out, bundled);
console.log(`dist/nuiyo.html  ${(Buffer.byteLength(bundled) / 1024).toFixed(1)} KB  (${ORDER.length} modules)`);

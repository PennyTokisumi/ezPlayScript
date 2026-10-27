'use strict';

/**
 * 面板 cep/com.ezplayscript.panel/src/ 是根 src/ 的**生成物**（npm run sync）。
 * 这条测试防止它再次像 v1.1.1 那样悄悄漂移（当时面板修了多行台词、根目录没修）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DST = path.join(ROOT, 'cep', 'com.ezplayscript.panel', 'src');
const EXCLUDE = new Set(['cli.js']);
const EXTS = new Set(['.js', '.ps1']);

function walk(dir, base = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? path.join(base, ent.name) : ent.name;
    if (ent.isDirectory()) out.push(...walk(path.join(dir, ent.name), rel));
    else if (EXTS.has(path.extname(ent.name).toLowerCase())) out.push(rel);
  }
  return out;
}

const wanted = walk(SRC).filter((rel) => !EXCLUDE.has(rel)).sort();

test('面板 src/ 文件清单与根一致', () => {
  assert.deepEqual(walk(DST).sort(), wanted, '清单不一致，跑 npm run sync');
});

for (const rel of wanted) {
  test(`面板 src/${rel} 与根逐字节一致`, () => {
    const a = fs.readFileSync(path.join(SRC, rel));
    const b = fs.readFileSync(path.join(DST, rel));
    assert.equal(Buffer.compare(a, b), 0, `内容漂移，跑 npm run sync：${rel}`);
  });
}

test('面板不再自己内联解析/裁切逻辑（全部走共享管线）', () => {
  const main = fs.readFileSync(path.join(ROOT, 'cep', 'com.ezplayscript.panel', 'js', 'main.js'), 'utf8');
  assert.doesNotMatch(main, /dlgCand/, '旧的内联选行逻辑应已删除');
  assert.doesNotMatch(main, /require\(.*parse\/ocrfix/, '不应在面板里自己调 fixOcr');
  assert.doesNotMatch(main, /colorkey=0x/, '滤镜/裁切参数属于 ocr/regions.js，不该留在面板里');
  assert.doesNotMatch(main, /execFileSync\('ffmpeg'/, '面板不该自己调 ffmpeg');
  assert.match(main, /analyzeFrame/, '单帧识别必须走共享的 analyzeFrame');
});

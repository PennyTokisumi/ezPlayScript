'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseArgs, frameKey, listFrames } = require('../src/cli');

function tmpDirWith(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ezps-cli-'));
  for (const n of names) fs.writeFileSync(path.join(dir, n), '');
  return dir;
}

function names(dir) {
  return listFrames(dir).map((p) => path.basename(p));
}

test('frameKey：基名子序记 0，排在 -2/-3 之前', () => {
  assert.deepEqual(frameKey('ep03_sc059.png').slice(0, 3), [3, 59, 0]);
  assert.deepEqual(frameKey('ep03_sc059-2.png').slice(0, 3), [3, 59, 2]);
  assert.deepEqual(frameKey('ep01_SC015a.png').slice(0, 3), [1, 15, 0]);
});

test('frameKey：认不出编号的排到最后', () => {
  assert.deepEqual(frameKey('随便什么.png').slice(0, 3), [Infinity, Infinity, Infinity]);
});

test('排序：不能靠文件名直接排（"-"(0x2D) < "."(0x2E) 会把基名排到 -2 之后）', () => {
  const dir = tmpDirWith(['ep03_sc059.png', 'ep03_sc059-2.png', 'ep03_sc059-3.png', 'ep03_sc009.png']);

  // 朴素排序的反例，证明这个坑真实存在
  const naive = ['ep03_sc059.png', 'ep03_sc059-2.png', 'ep03_sc059-3.png', 'ep03_sc009.png'].sort();
  assert.deepEqual(naive, ['ep03_sc009.png', 'ep03_sc059-2.png', 'ep03_sc059-3.png', 'ep03_sc059.png']);

  assert.deepEqual(names(dir), ['ep03_sc009.png', 'ep03_sc059.png', 'ep03_sc059-2.png', 'ep03_sc059-3.png']);
});

test('listFrames：跳过 _ 和 . 开头的诊断图/中间产物', () => {
  const dir = tmpDirWith([
    'ep02_sc050.png',
    '_diag.jpg',          // 诊断图 → 跳过（否则会重复识别、台词叠加）
    '_crop6x.jpg',        // 4x/6x 放大的中间图 → 跳过（超大，OCR 会失败）
    'ep02_sc050_crop.png', // 后缀形式不跳过，与 _ 前缀约定区分
    'notes.txt',          // 非图片 → 跳过
  ]);
  const got = names(dir);
  // 这两个排序键相同（同 ep/sc/子序），最终顺序由 localeCompare 决定，
  // 不同机器的 ICU 可能不同 → 只断言集合，不锁顺序
  assert.deepEqual(got.slice().sort(), ['ep02_sc050.png', 'ep02_sc050_crop.png']);
  assert.ok(!got.some((n) => /^[_.]/.test(n)), '不应包含 _ / . 开头的文件');
});

test('listFrames：只认图片扩展名（大小写不敏感）', () => {
  const dir = tmpDirWith(['a.PNG', 'b.JpEg', 'c.bmp', 'd.tif', 'e.gif', 'f.webp']);
  assert.deepEqual(names(dir), ['a.PNG', 'b.JpEg', 'c.bmp', 'd.tif']);
});

test('parseArgs：默认值', () => {
  const a = parseArgs(['pic']);
  assert.equal(a._[0], 'pic');
  assert.equal(a.out, '台本.txt');
  assert.equal(a.scale, 3);
  assert.equal(a.sep, '  ');
  assert.equal(a.repeatShot, true);
  assert.equal(a.splitSpeakers, true);
});

test('parseArgs：--merge-shot / --no-split-speakers 是「关掉默认」的开关', () => {
  const a = parseArgs(['pic', '--merge-shot', '--no-split-speakers']);
  assert.equal(a.repeatShot, false, '留空对齐 = 不重复镜号');
  assert.equal(a.splitSpeakers, false);
});

test('parseArgs：带值的参数', () => {
  const a = parseArgs(['pic', '-o', 'x.docx', '--sep', ' | ', '--joiner', ' / ', '--scale', '4', '--dump', 'd.json']);
  assert.equal(a.out, 'x.docx');
  assert.equal(a.sep, ' | ');
  assert.equal(a.joiner, ' / ');
  assert.equal(a.scale, 4);
  assert.equal(a.dump, 'd.json');
});

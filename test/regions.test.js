'use strict';

/**
 * 两段式取图的回归测试（夹具是区域 OCR 的原始输出，见 fixtures/shot-and-dialogue-*.json）。
 * 三件事钉在这儿：整帧读不到的小标签、被认成点号的冒号、冒号被吞掉之后的跨帧补全。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractShot, extractDialogue } = require('../src/parse/parse');
const { repairRoles } = require('../src/pipeline');

const A = require('./fixtures/shot-and-dialogue-a.json');
const B = require('./fixtures/shot-and-dialogue-b.json');

function parse(f) {
  const shot = extractShot([f.shotRegion]);
  const dlg = extractDialogue(f.dialogueRegion.lines, f.dialogueRegion.height, { yMin: 0 });
  return { shotNo: shot.shotNo, role: dlg.role, line: dlg.line, warnings: dlg.warnings };
}

test('样例 A：左上裁切能读出小标签 SC002', () => {
  assert.equal(parse(A).shotNo, '002');
});

test('样例 A：OCR 把半角冒号认成「.」也要拆出角色', () => {
  const p = parse(A);
  assert.equal(p.role, '小白AI');
  assert.equal(p.line, '不辛苦，能帮到你就超开心了！');
  assert.deepEqual(p.warnings, []);
});

test('样例 B：长句小字 —— 镜号仍然对', () => {
  assert.equal(parse(B).shotNo, '001');
});

test('样例 B：偏旁拆分被纠正（夕卜→外）', () => {
  const line = parse(B).line;
  assert.match(line, /以外/);
  assert.doesNotMatch(line, /夕卜/);
});

test('样例 B：省略号碎片归一成 ……，落单的引号被吃掉', () => {
  const line = parse(B).line;
  assert.match(line, /前五十……及/);
  assert.doesNotMatch(line, /“/);
});

test('样例 B：冒号被吃成「上」→ 不硬猜角色，整段保留并告警', () => {
  const p = parse(B);
  assert.equal(p.role, null);
  assert.ok(p.line.startsWith('小白A上'), '整段保留为台词，不丢字');
  assert.match(p.warnings.join(), /无冒号/);
});

test('跨帧补全：拿样例 A 的已知角色名，救回样例 B 被吞掉的冒号', () => {
  const frames = [
    { shotNo: '002', role: '小白AI', line: '不辛苦', warnings: [] },
    { shotNo: '001', role: null, line: parse(B).line, warnings: ['无冒号，按续行处理（说话人待继承/人工）'] },
  ];
  repairRoles(frames);
  assert.equal(frames[1].role, '小白AI');
  assert.equal(frames[1].line, '已抓取片单前十，前五十……及一百名以外的候选片单');
  assert.match(frames[1].warnings.join(), /已知角色名补全/);
  assert.doesNotMatch(frames[1].warnings.join(), /无冒号/, '补全后应去掉过期的「无冒号」告警');
});

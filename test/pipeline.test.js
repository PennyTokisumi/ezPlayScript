'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRows } = require('../src/pipeline');
const { mergeRows, expandSpeakers } = require('../src/merge/merge');

/** 一组覆盖「继承 / 合并 / 换人 / 换镜号」的连续帧（按抓取顺序） */
function seq() {
  return [
    { shotNo: '010', role: '老周', line: '第一句' },
    { shotNo: '010', role: null, line: '续行无说话人' },
    { shotNo: '010', role: '老周', line: '第二句' },
    { shotNo: '010', role: '小胖&老周', line: '异口同声' },
    { shotNo: '011', role: '老周', line: '换个镜号' },
  ];
}

test('说话人继承：续行从同镜号上一帧继承，并带告警', () => {
  const rows = buildRows(seq());
  assert.equal(rows[0].role, '老周');
  assert.equal(rows[0].line, '第一句续行无说话人第二句');
  assert.deepEqual(rows[0].warnings, ['说话人继承自上一帧']);
});

test('继承：不同镜号不继承', () => {
  const rows = buildRows([
    { shotNo: '010', role: '老周', line: '甲' },
    { shotNo: '011', role: null, line: '乙' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].role, null);
  assert.equal(rows[1].line, '乙');
});

test('合并：同镜号同角色才拼，换人必断行', () => {
  const rows = buildRows(seq());
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => [r.shotNo, r.role, r.line]),
    [
      ['010', '老周', '第一句续行无说话人第二句'],
      ['010', '小胖', '异口同声'],
      ['010', '老周', '异口同声'],
      ['011', '老周', '换个镜号'],
    ]);
});

test('拆分：多说话人在合并之后展开，每人一行、台词复制', () => {
  const rows = buildRows([{ shotNo: '001', role: '小胖&老周', line: '一起上' }]);
  assert.deepEqual(rows.map((r) => [r.role, r.line]), [['小胖', '一起上'], ['老周', '一起上']]);
});

test('拆分：关闭后保留原角色串', () => {
  const rows = buildRows([{ shotNo: '001', role: '小胖&老周', line: '一起上' }],
    { splitSpeakers: false });
  assert.deepEqual(rows.map((r) => r.role), ['小胖&老周']);
});

test('拆分：全角＆也认；只有一段时不改写原串（留给人工改）', () => {
  assert.deepEqual(expandSpeakers([{ role: '甲＆乙', line: '词' }]).map((r) => r.role), ['甲', '乙']);
  assert.deepEqual(expandSpeakers([{ role: '甲&&', line: '词' }]).map((r) => r.role), ['甲&&']);
});

test('joiner 生效（默认直接相连）', () => {
  assert.equal(buildRows(seq())[0].line, '第一句续行无说话人第二句');
  assert.equal(buildRows(seq(), { joiner: ' / ' })[0].line, '第一句 / 续行无说话人 / 第二句');
});

test('mergeRows 不原地改输入（buildRows 要先复制）', () => {
  const frames = [{ shotNo: '010', role: '老周', line: '甲' }];
  mergeRows(frames);
  assert.equal(frames[0].line, '甲');
});

test('合并：镜号为 null 的帧不参与合并（避免把两段无名台词糊一起）', () => {
  const rows = buildRows([
    { shotNo: null, role: '老周', line: '甲' },
    { shotNo: null, role: '老周', line: '乙' },
  ]);
  assert.equal(rows.length, 2);
});

// ───────────── 角色补全（说话人不含标点 → 可用同片角色名反推）─────────────

test('角色补全：冒号被吞成别的字时，用同片已知角色名在行首近似匹配', () => {
  // 实测：`小白AI:` → `小白A上`，同片另一帧有干净的 `小白AI`
  const rows = buildRows([
    { shotNo: '002', role: '小白AI', line: '不辛苦' },
    { shotNo: '001', role: null, line: '小白A上已抓取片单前十，前五十' },
  ]);
  const r = rows.find((x) => x.shotNo === '001');
  assert.equal(r.role, '小白AI');
  assert.equal(r.line, '已抓取片单前十，前五十');
  assert.match(r.warnings.join(), /已知角色名补全/);
});

test('角色补全：普通续行不能被错认成角色', () => {
  const rows = buildRows([
    { shotNo: '010', role: '老周', line: '甲' },
    { shotNo: '010', role: null, line: '还有三天' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, '老周');
  assert.equal(rows[0].line, '甲还有三天');
});

test('角色补全：切完不剩内容就放弃（不做无意义的拆）', () => {
  const rows = buildRows([
    { shotNo: '001', role: '阿澄', line: '甲' },
    { shotNo: '002', role: null, line: '阿澄' },
  ]);
  assert.equal(rows.find((x) => x.shotNo === '002').role, null);
});

test('角色补全：没有已知角色时不做任何猜测', () => {
  const rows = buildRows([{ shotNo: '001', role: null, line: '小白A上已抓取片单' }]);
  assert.equal(rows[0].role, null);
  assert.equal(rows[0].line, '小白A上已抓取片单');
});

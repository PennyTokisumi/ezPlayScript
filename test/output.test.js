'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { toText } = require('../src/output/text');

const rows = [
  { shotNo: '010', role: '老周', line: '第一句' },
  { shotNo: '010', role: '小胖', line: '第二句' },
  { shotNo: '011', role: '老周', line: '换镜号' },
];

test('默认：每行都写镜号，两空格分隔，CRLF 结尾', () => {
  assert.equal(toText(rows), '010  老周  第一句\r\n010  小胖  第二句\r\n011  老周  换镜号\r\n');
});

test('repeatShot=false：续行留空并对齐到最宽镜号', () => {
  const lines = toText(rows, { repeatShot: false, eol: '\n' }).split('\n');
  assert.deepEqual(lines.slice(0, 3), [
    '010  老周  第一句',
    '     小胖  第二句',   // 空 3 格 = 镜号宽 3，列才对得齐
    '011  老周  换镜号',
  ]);
});

test('repeatShot=false：镜号宽度不一样时补到最宽的那个', () => {
  const r = [
    { shotNo: '015a', role: 'A', line: 'x' },
    { shotNo: '015a', role: 'B', line: 'y' },
  ];
  const lines = toText(r, { repeatShot: false, eol: '\n' }).split('\n');
  assert.equal(lines[1], '      B  y');   // 4 格
});

test('sep 可换（制表符）', () => {
  assert.equal(toText([{ shotNo: '001', role: 'A', line: 'B' }], { sep: '\t' }), '001\tA\tB\r\n');
});

test('eol:"" 是合法值（单行输出），不能被默认值吃掉', () => {
  assert.equal(toText([{ shotNo: '001', role: 'A', line: 'B' }], { eol: '' }), '001  A  B');
});

test('eol 可换 LF（面板预览用）', () => {
  assert.equal(toText([{ shotNo: '001', role: 'A', line: 'B' }], { eol: '\n' }), '001  A  B\n');
});

test('空角色/空台词不产生 undefined 字样', () => {
  assert.equal(toText([{ shotNo: null, role: null, line: null }], { eol: '' }), ' '.repeat(4));
});

test('空行数组输出空串', () => {
  assert.equal(toText([]), '');
});

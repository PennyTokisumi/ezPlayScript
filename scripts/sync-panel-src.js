#!/usr/bin/env node
'use strict';

/**
 * 把根 src/ 同步进 CEP 面板（cep/com.ezplayscript.panel/src/）。
 *
 * 为什么还要副本：面板会被整个文件夹拷到
 *   C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\
 * 安装，那里够不到项目根的 src/，所以必须自带一份。副本是**生成物**，不要手改。
 *
 * 用法：
 *   node scripts/sync-panel-src.js           写入（同步 + 删掉多余文件）
 *   node scripts/sync-panel-src.js --check   只检查，漂移则 exit 1（CI/提交前用）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DST = path.join(ROOT, 'cep', 'com.ezplayscript.panel', 'src');

// 只同步面板运行期需要的模块；cli.js 是命令行入口，面板用不到
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
const existing = fs.existsSync(DST) ? walk(DST).sort() : [];

const check = process.argv.includes('--check');
const missing = [];
const stale = existing.filter((rel) => !wanted.includes(rel));
const drift = [];

for (const rel of wanted) {
  const a = fs.readFileSync(path.join(SRC, rel));
  const target = path.join(DST, rel);
  if (!fs.existsSync(target)) { missing.push(rel); if (!check) { write(target, a); } continue; }
  const b = fs.readFileSync(target);
  if (Buffer.compare(a, b) !== 0) { drift.push(rel); if (!check) write(target, a); }
}

if (!check) {
  for (const rel of stale) fs.unlinkSync(path.join(DST, rel));
}

function write(target, buf) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
}

const bad = missing.length + drift.length + stale.length;
if (check) {
  if (bad) {
    console.error('✗ 面板 src/ 与根 src/ 不一致：');
    for (const r of missing) console.error(`    缺少  ${r}`);
    for (const r of drift) console.error(`    内容不同  ${r}`);
    for (const r of stale) console.error(`    多余  ${r}`);
    console.error('\n  跑 `npm run sync` 重新生成（副本是生成物，勿手改）。');
    process.exit(1);
  }
  console.log(`✓ 面板 src/ 与根 src/ 一致（${wanted.length} 个文件）`);
} else {
  console.log(`✓ 已同步 ${wanted.length} 个文件 → cep/com.ezplayscript.panel/src/`);
  if (missing.length) console.log(`    新增 ${missing.length}: ${missing.join(', ')}`);
  if (drift.length) console.log(`    更新 ${drift.length}: ${drift.join(', ')}`);
  if (stale.length) console.log(`    删除 ${stale.length}: ${stale.join(', ')}`);
}

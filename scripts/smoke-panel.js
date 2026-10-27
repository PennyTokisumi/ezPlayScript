#!/usr/bin/env node
'use strict';

/**
 * 面板冒烟测试：不用开 Premiere，直接在 Node 里模拟 CEP 环境加载 js/main.js，
 * 往「桌面/.ezCapture」丢分镜帧，看它是否自己走完：
 *   监听 → 两段式取图 → 填表 → 预览 → 删掉源图
 *
 * 覆盖的是真正的面板代码路径（main.js 一行没改地被加载），不是复刻的副本。
 *
 * 用法：
 *   node scripts/smoke-panel.js                       # 自动取 pic/ 下第一帧
 *   node scripts/smoke-panel.js <图片> [镜号] [角色] [台词]
 *   node scripts/smoke-panel.js <目录>                # 整目录一起丢进去（可验证跨帧角色补全）
 *
 * 带期望值时逐项断言；不带时只做结构化断言（出几行、镜号形状、台词非空、源图被删）。
 * 需要 ffmpeg + Windows 中文 OCR。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..');
const PANEL = path.join(ROOT, 'cep', 'com.ezplayscript.panel');
const MAIN = path.join(PANEL, 'js', 'main.js');
const IMG = /\.(png|jpg|jpeg|bmp)$/i;

function resolveInputs() {
  const arg = process.argv[2];
  if (!arg) {
    const dir = path.join(ROOT, 'pic');
    if (!fs.existsSync(dir)) return [];
    const hit = fs.readdirSync(dir).find((f) => IMG.test(f) && !/^[_.]/.test(f));
    return hit ? [path.join(dir, hit)] : [];
  }
  const abs = path.resolve(arg);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isDirectory()) {
    return fs.readdirSync(abs).filter((f) => IMG.test(f) && !/^[_.]/.test(f))
      .sort().map((f) => path.join(abs, f));
  }
  return [abs];
}

const inputs = resolveInputs();
if (!inputs.length) {
  console.log('跳过：找不到测试帧（放一张到 pic/ 或把路径作为参数传入）');
  process.exit(0);
}

// —— 模拟 CEP 的 DOM ——
function makeEl(id) {
  const el = {
    id,
    textContent: '',
    className: '',
    value: '',
    checked: id === 'optSplit',   // 与 index.html 的默认勾选保持一致
    title: '',
    contentEditable: 'false',
    children: [],
    style: {},
    scrollTop: 0,
    scrollHeight: 100,
    appendChild(child) { el.children.push(child); return child; },
    addEventListener() {},
  };
  // 真 DOM 里 innerHTML='' 会清空子节点，桩也必须照做（renderTable 靠它清表）
  let inner = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return inner; },
    set(v) { inner = v; if (v === '') el.children.length = 0; },
  });
  return el;
}

const els = {};
for (const id of ['status', 'frameBody', 'frameTable', 'preview', 'outDir', 'optSplit',
  'optMergeShot', 'colorSwatch', 'colorHex', 'btnCapture', 'btnExportTxt',
  'btnExportDocx', 'btnClear', 'btnBrowse']) {
  els[id] = makeEl(id);
}

const document = {
  getElementById: (id) => els[id] || (els[id] = makeEl(id)),
  createElement: (tag) => makeEl(tag),
};

// 面板默认监听「桌面/.ezCapture」，这里用 EZPS_CAPTURE_DIR 指到沙箱，
// 不碰真实桌面（否则冒烟会在用户桌面上建目录、甚至删文件）
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ezps-smoke-'));
const capDir = path.join(tmpHome, '.ezCapture');
fs.mkdirSync(capDir, { recursive: true });
const copied = [];
for (const src of inputs) {
  const dst = path.join(capDir, path.basename(src));
  fs.copyFileSync(src, dst);
  copied.push(dst);
}

process.env.EZPS_CAPTURE_DIR = capDir;
const savedHome = process.env.USERPROFILE;
process.env.USERPROFILE = tmpHome;

const sandbox = {
  window: { location: { href: 'file:///' + path.join(PANEL, 'index.html').replace(/\\/g, '/') } },
  document,
  require: createRequire(MAIN),
  console, process, Buffer,
  setTimeout, clearTimeout, setInterval, clearInterval,
};
sandbox.globalThis = sandbox;

console.log('加载面板 main.js …');
console.log(`  投放 ${inputs.length} 帧`);
console.log(`  抓帧目录(沙箱): ${capDir}\n`);

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(MAIN, 'utf8'), sandbox, { filename: MAIN });

// —— 等监听器 + 逐帧 OCR 跑完 ——
const DEADLINE = Date.now() + 20000 + inputs.length * 8000;
const tick = setInterval(() => {
  const got = els.frameBody.children.length;
  if (got < inputs.length && Date.now() < DEADLINE) return;
  clearInterval(tick);

  let code = 0;
  const rows = els.frameBody.children.map((tr) => tr.children.map((td) => td.textContent));
  console.log('抓取记录表:');
  if (!rows.length) { console.log('  （空 —— 面板没有识别到任何帧）'); code = 1; }
  for (const r of rows) console.log('  [' + r.join(' | ') + ']');

  console.log('\n台本预览:');
  console.log(String(els.preview.value).replace(/\n+$/, '').split('\n').map((l) => '  [' + l + ']').join('\n'));
  console.log('\n状态栏:', JSON.stringify(els.status.textContent));

  const first = rows[0] || [];
  const expShot = process.argv[3];
  const expRole = process.argv[4];
  const expLine = process.argv[5];

  const checks = [
    [`出了 ${inputs.length} 行`, rows.length === inputs.length],
    ['每行都有镜号', rows.every((r) => /^\d{1,4}[a-dA-D]?$/.test(r[0] || ''))],
    ['每行都有台词', rows.every((r) => String(r[2] || '').length > 0)],
    ['预览里能看到内容', String(els.preview.value).trim().length > 0],
    ['源图都被删掉了（缓存图用完即删）', copied.every((p) => !fs.existsSync(p))],
  ];
  if (expShot) checks.push([`首行镜号 == ${expShot}`, first[0] === expShot]);
  if (expRole) checks.push([`首行角色 == ${expRole}`, first[1] === expRole]);
  if (expLine) checks.push([`首行台词 == ${expLine}`, first[2] === expLine]);

  console.log('\n断言:');
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    if (!ok) code = 1;
  }

  try { process.env.USERPROFILE = savedHome || ''; } catch (_) {}
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${code === 0 ? '✓ 面板冒烟通过' : '✗ 面板冒烟失败'}`);
  process.exit(code);
}, 400);

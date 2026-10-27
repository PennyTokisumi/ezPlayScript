'use strict';

/* ezPlayScript by Toki33 — PR 面板主逻辑。
 * 依赖 PR 面板已启用 Node（manifest --enable-nodejs）。 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// 从 HTML 页面路径推导扩展根目录（最稳，不依赖 __dirname 或 CEP API 偏差）
var EXTDIR = decodeURI(window.location.href.replace(/\/[^\/]*$/, ''));
// 去掉 Windows file:// 前缀
if (/^file:\/\/\//.test(EXTDIR)) EXTDIR = EXTDIR.replace(/^file:\/\/\//, '');
else EXTDIR = EXTDIR.replace(/^file:\/\//, '');
const SRCDIR = path.join(EXTDIR, 'src');

const { analyzeFrame, buildRows, repairRoles } = require(path.join(SRCDIR, 'pipeline'));
const { toText } = require(path.join(SRCDIR, 'output/text'));
const { writeDocx } = require(path.join(SRCDIR, 'docx/docx'));
const { ffmpegAvailable } = require(path.join(SRCDIR, 'ocr/regions'));

/**
 * 字幕字色。
 * 留空（默认）= 走灰度取台词：实测字符准确率更高，且不假设字幕一定是白色。
 * 填 #RRGGBB = 走「抠掉该颜色再把 alpha 当灰度」，适合彩色字幕或灰度读不出来的片子。
 */
let pickedColor = '';

/** 抓取到的逐帧记录（按点击顺序）。每项：{shotNo, role, line, warnings} */
let frames = [];

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function setStatus(msg, kind) {
  statusEl.textContent = msg || '';
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

function currentOpts() {
  return {
    splitSpeakers: $('optSplit').checked,
    repeatShot: !$('optMergeShot').checked,
  };
}

/**
 * 解析「桌面」真实路径。
 *
 * 不能简单用 ~/Desktop：开了 OneDrive 备份的机器，桌面会被重定向到
 * `%USERPROFILE%\OneDrive\桌面`，那时「桌面」上的文件夹面板根本看不到。
 * 所以先问 .NET 的 SpecialFolder（它会跟随重定向），再按常见位置回退。
 */
function resolveDesktop() {
  try {
    var out = require('child_process').execFileSync('powershell.exe',
      ['-NoProfile', '-Command',
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')"],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim();
    if (out && fs.existsSync(out)) return out;
  } catch (_) { /* 拿不到就往下回退 */ }

  var home = os.homedir();
  var cands = [
    path.join(home, 'Desktop'),
    path.join(home, 'OneDrive', 'Desktop'),
    path.join(home, 'OneDrive', '桌面'),
  ];
  for (var i = 0; i < cands.length; i++) {
    if (fs.existsSync(cands[i])) return cands[i];
  }
  return path.join(home, 'Desktop');
}

var DESKTOP = resolveDesktop();

// —— 文件夹监听（轮询 .ezCapture/ 新文件）——
// EZPS_CAPTURE_DIR 可覆盖（换机器排查/自定义落盘位置/自动化测试都用得上）
var CAPDIR = process.env.EZPS_CAPTURE_DIR || path.join(DESKTOP, '.ezCapture');
var _watchTimer = null;
var _knownFiles = {}; // 记录已处理文件名 → 避免重复 OCR

function scanCaptureDir() {
  try {
    var files = fs.readdirSync(CAPDIR);
  } catch (e) { return; }
  files.forEach(function (f) {
    if (_knownFiles[f]) return;
    _knownFiles[f] = true;
    if (!/\.(png|jpg|jpeg|bmp)$/i.test(f)) return;
    var fp = path.join(CAPDIR, f);
    setStatus('识别中…');
    setTimeout(function () {
      try {
        // 单张帧 → 一条台本记录：左上裁切取镜号、底部裁切取台词（见 src/ocr/regions.js），
        // 两处都读不到才回退整帧 OCR。这里不再有任何解析/裁切逻辑，全部走共享管线。
        var parsed = analyzeFrame(fp, { color: pickedColor });
        frames.push(parsed);
        // 跨帧补全缺失的角色（冒号被吞的那类）。跑在表格渲染前，
        // 这样「表格里看到的」和「预览里导出的」是同一份数据。
        repairRoles(frames);
        renderTable();
        updatePreview();
        try { fs.unlinkSync(fp); } catch (_) {}
        delete _knownFiles[f];
        var flag = parsed.warnings.length ? ' ⚠ ' + parsed.warnings.join('; ') : '';
        setStatus((parsed.shotNo || '??') + ' / ' + (parsed.role || '—') + flag,
          parsed.warnings.length ? 'warn' : 'ok');
      } catch (e) {
        setStatus('OCR 失败：' + e.message, 'err');
        // 不删 _knownFiles —— 避免无限重试同一张图
      }
    }, 100); // 等文件写完
  });
}

function startWatch() {
  if (_watchTimer) clearInterval(_watchTimer);
  _watchTimer = setInterval(scanCaptureDir, 600);
}

// —— 抓取：PR 2023 无法通过脚本触发导出帧。打开 .capture 文件夹，
//   用户用 Ctrl+Shift+E 导出帧存入即可自动 OCR。——
function capture() {
  try { fs.mkdirSync(CAPDIR); } catch (_) {}
  startWatch();
  // 用 Explorer 打开 .capture 文件夹
  try { require('child_process').exec('explorer "' + CAPDIR + '"'); } catch (_) {}
  setStatus('监听中… Ctrl+Shift+E 导出帧 → 存到桌面 .ezCapture → 自动识别', 'ok');
}

// —— 渲染抓取记录表（可编辑）——
function renderTable() {
  const body = $('frameBody');
  body.innerHTML = '';
  frames.forEach(function (f, idx) {
    const tr = document.createElement('tr');
    if (f.warnings && f.warnings.length) tr.className = 'warn';
    tr.title = (f.warnings && f.warnings.length) ? f.warnings.join('；') : '';

    tr.appendChild(editableCell(f.shotNo || '', 'shot', idx, 'shotNo'));
    tr.appendChild(editableCell(f.role || '', 'role', idx, 'role'));
    tr.appendChild(editableCell(f.line || '', 'line', idx, 'line'));

    const del = document.createElement('td');
    del.className = 'del';
    del.textContent = '✕';
    del.onclick = function () { frames.splice(idx, 1); renderTable(); updatePreview(); };
    tr.appendChild(del);

    body.appendChild(tr);
  });
  // 自动滚到底部
  $('frameTable').scrollTop = $('frameTable').scrollHeight;
}

function editableCell(value, cls, idx, field) {
  const td = document.createElement('td');
  td.className = cls;
  td.contentEditable = 'true';
  td.textContent = value;
  td.addEventListener('input', function () {
    frames[idx][field] = td.textContent;
    updatePreview();
  });
  return td;
}

// —— 行序：按镜号排序，同镜号保持捕获顺序（补帧时不会因不相邻导致未合并）——
// 预览和两个导出都必须走这里，否则「看到的不等于导出的」。
function orderFrames() {
  var wrapped = frames.map(function (f, i) { return { f: f, i: i }; });
  wrapped.sort(function (a, b) {
    var na = parseInt(a.f.shotNo, 10), nb = parseInt(b.f.shotNo, 10);
    if (isNaN(na) && isNaN(nb)) return a.i - b.i;
    if (isNaN(na)) return 1;
    if (isNaN(nb)) return -1;
    return na - nb || a.i - b.i;
  });
  return wrapped.map(function (w) { return w.f; });
}

// —— 台本预览（跑一遍继承+合并+拆分）——
function updatePreview() {
  try {
    var opts = currentOpts();
    var rows = buildRows(orderFrames(), opts);
    $('preview').value = toText(rows, { repeatShot: opts.repeatShot, eol: '\n' });
    $('preview').scrollTop = $('preview').scrollHeight;
  } catch (e) {
    $('preview').value = '预览出错：' + e.message;
  }
}

// —— 导出路径 ——
function getOutDir() {
  var raw = $('outDir').value.trim();
  return raw || DESKTOP;
}

function browseOutDir() {
  // 简单方案：弹 prompt 让你粘贴/输入。未来可换 CEP 原生文件对话框。
  var cur = getOutDir();
  var input = prompt('输出目录：', cur);
  if (input) $('outDir').value = input;
}

// —— 导出 ——
function exportTxt() {
  try {
    var rows = buildRows(orderFrames(), currentOpts());
    var out = path.join(getOutDir(), '台本.txt');
    fs.writeFileSync(out, toText(rows, { repeatShot: currentOpts().repeatShot }), 'utf8');
    setStatus('已导出：' + out, 'ok');
  } catch (e) { setStatus('导出失败：' + e.message, 'err'); }
}

function exportDocx() {
  try {
    var rows = buildRows(orderFrames(), currentOpts());
    var out = path.join(getOutDir(), '台本.docx');
    writeDocx(rows, out).then(function () {
      setStatus('已导出：' + out, 'ok');
    }).catch(function (e) { setStatus('导出失败：' + e.message, 'err'); });
  } catch (e) { setStatus('导出失败：' + e.message, 'err'); }
}

function clearAll() {
  if (frames.length && !confirm('清空所有抓取记录？')) return;
  frames = [];
  renderTable();
  updatePreview();
  setStatus('已清空');
}

// —— 绑定 ——
$('btnCapture').onclick = capture;
$('btnExportTxt').onclick = exportTxt;
$('btnExportDocx').onclick = exportDocx;
$('btnClear').onclick = clearAll;
$('btnBrowse').onclick = browseOutDir;
$('optSplit').onchange = updatePreview;
$('optMergeShot').onchange = updatePreview;

// 色块初始
$('colorSwatch').style.background = '';

// hex 手动输入才切到「抠色」；清空则回到灰度自动
$('colorHex').oninput = function () {
  var v = this.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
    pickedColor = v;
    $('colorSwatch').style.background = v;
  } else if (!v) {
    pickedColor = '';
    $('colorSwatch').style.background = '';
  }
};

/** 路径太长塞不进状态栏，从左截断。 */
function shortPath(p) {
  var s = String(p);
  return s.length > 34 ? '…' + s.slice(-33) : s;
}

// —— 启动：面板即开即监听 .ezCapture 文件夹 ——
(function init() {
  $('outDir').value = DESKTOP;
  $('btnCapture').title = '打开抓帧文件夹：' + CAPDIR;
  try { fs.mkdirSync(CAPDIR); } catch (_) {}

  var ffOk = ffmpegAvailable();
  // OCR 引擎有没有中文包，决定这个面板能不能用，启动就探一次
  var ocrProbe = { ok: true, msg: '' };
  try {
    require('child_process').execFileSync('powershell.exe',
      ['-NoProfile', '-Command',
        "[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null; " +
        'if ([Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language("zh-Hans-CN")))) { exit 0 } else { exit 3 }'],
      { stdio: 'ignore', windowsHide: true, timeout: 8000 });
  } catch (e) {
    ocrProbe = {
      ok: false,
      msg: ' ⚠ 中文OCR不可用（需在 设置›时间和语言›语言 里安装「中文(简体)」的 OCR/手写 组件）',
    };
  }

  startWatch();
  var msg = 'ezPlayScript v1.2 · 抓帧目录 ' + shortPath(CAPDIR)
    + (ffOk ? '' : ' ⚠ ffmpeg 未找到')
    + ocrProbe.msg;
  setStatus(msg, ffOk && ocrProbe.ok ? 'ok' : 'warn');
})();

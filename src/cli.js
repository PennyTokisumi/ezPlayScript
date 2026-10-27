#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { analyzeFrame, buildRows } = require('./pipeline');
const { writeDocx } = require('./docx/docx');
const { writeText } = require('./output/text');

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff']);

function parseArgs(argv) {
  const args = { _: [], out: '台本.txt', engine: 'win', lang: 'zh-Hans-CN', joiner: '', dump: null, scale: 3, sep: '  ', repeatShot: true, splitSpeakers: true, color: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') args.out = argv[++i];
    else if (a === '--engine') args.engine = argv[++i];
    else if (a === '--lang') args.lang = argv[++i];
    else if (a === '--joiner') args.joiner = argv[++i];
    else if (a === '--scale') args.scale = Number(argv[++i]);
    else if (a === '--sep') args.sep = argv[++i];
    else if (a === '--color') args.color = argv[++i];
    else if (a === '--merge-shot') args.repeatShot = false;   // 同镜号续行留空对齐
    else if (a === '--no-split-speakers') args.splitSpeakers = false;
    else if (a === '--dump') args.dump = argv[++i] || 'frames.json';
    else if (a === '--title') args.title = argv[++i];
    else args._.push(a);
  }
  return args;
}

// 解析文件名为排序键 [集, 镜号, 子序]：ep31_sc059.png=[31,59,0]，ep31_sc059-2.png=[31,59,2]。
// 关键：基名(无后缀)子序记 0，排在 -2/-3 之前，保证同镜号的时间顺序正确。
function frameKey(name) {
  const m = name.match(/ep(\d+)[_-]?sc(\d+)(?:-(\d+))?/i);
  if (!m) return [Infinity, Infinity, Infinity, name];
  return [parseInt(m[1], 10), parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : 0, name];
}

function listFrames(dir) {
  return fs.readdirSync(dir)
    .filter((f) => IMG_EXT.has(path.extname(f).toLowerCase()))
    // 约定：`_` / `.` 开头的是诊断图与中间产物（_diag.jpg、_crop6x.jpg、_full.png…），
    // 不参与识别——否则它们会当成额外的帧，把同镜号台词重复合并（问题大爷问题大爷）。
    .filter((f) => !/^[_.]/.test(f))
    .sort((a, b) => {
      const ka = frameKey(a);
      const kb = frameKey(b);
      return (ka[0] - kb[0]) || (ka[1] - kb[1]) || (ka[2] - kb[2]) ||
        String(ka[3]).localeCompare(String(kb[3]), undefined, { numeric: true });
    })
    .map((f) => path.join(dir, f));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];
  if (!input) {
    console.error(
      '用法: node src/cli.js <帧目录|单张图片> [-o 台本.txt|.docx] [--color #RRGGBB] [--joiner ""] ' +
      '[--sep "  "] [--merge-shot] [--no-split-speakers] [--scale 3] [--dump frames.json]');
    process.exit(1);
  }

  const stat = fs.statSync(input);
  const files = stat.isDirectory() ? listFrames(input) : [input];
  if (files.length === 0) {
    console.error(`目录内没有图片: ${input}`);
    process.exit(1);
  }

  console.log(`\n发现 ${files.length} 帧，开始识别（引擎=${args.engine}）…\n`);

  const frames = [];
  for (const file of files) {
    const t0 = Date.now();
    try {
      // 两段式取图：左上裁切取镜号、底部裁切取台词，读不到才回退整帧
      const parsed = analyzeFrame(file, {
        engine: args.engine, lang: args.lang, scale: args.scale, color: args.color,
      });
      const ms = Date.now() - t0;
      frames.push(parsed);
      const flag = parsed.warnings.length ? `  ⚠ ${parsed.warnings.join('；')}` : '';
      console.log(
        `  [${String(parsed.shotNo ?? '??').padStart(3)}] ${(parsed.role ?? '—').padEnd(6)}｜${parsed.line ?? '（空）'}` +
        `   (${ms}ms)${flag}`
      );
    } catch (e) {
      console.log(`  ✗ ${path.basename(file)} 识别失败: ${e.message}`);
      frames.push({ file: path.basename(file), shotNo: null, role: null, line: null, warnings: [`OCR异常: ${e.message}`] });
    }
  }

  // 说话人继承 + 合并 + 多说话人拆分（与 PR 面板共用同一管线）
  const rows = buildRows(frames, { joiner: args.joiner, splitSpeakers: args.splitSpeakers });

  console.log(`\n合并后 ${rows.length} 行台本：`);
  for (const r of rows) {
    const warn = r.warnings && r.warnings.length ? `  ⚠ ${r.warnings.join('；')}` : '';
    console.log(`  ${String(r.shotNo ?? '??').padStart(3)} | ${(r.role ?? '—').padEnd(6)} | ${r.line}${warn}`);
  }

  if (args.dump) {
    fs.writeFileSync(args.dump, JSON.stringify({ frames, rows }, null, 2), 'utf8');
    console.log(`\n中间数据已写出: ${args.dump}`);
  }

  const outPath = path.resolve(args.out);
  const ext = path.extname(outPath).toLowerCase();
  if (ext === '.docx') {
    await writeDocx(rows, outPath, { title: args.title });
  } else {
    writeText(rows, outPath, { sep: args.sep, repeatShot: args.repeatShot });
  }

  // 以「合并后的行」为准统计——帧级告警可能在补全角色后已经失效
  const warned = rows.filter((r) => r.warnings && r.warnings.length).length;
  console.log(`\n✅ 台本已生成: ${outPath}`);
  console.log(`   共 ${frames.length} 帧 → ${rows.length} 行；其中 ${warned} 行有告警需人工复核。\n`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

// 导出纯函数供测试使用（main 不再在 require 时自动执行）
module.exports = { parseArgs, frameKey, listFrames };

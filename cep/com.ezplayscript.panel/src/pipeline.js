'use strict';

const path = require('path');

const { ocr } = require('./ocr/ocr');
const { readShotRegion, readDialogueRegion } = require('./ocr/regions');
const { extractShot, extractDialogue, ROLE_SHAPE } = require('./parse/parse');
const { mergeRows, expandSpeakers } = require('./merge/merge');

/** 两个等长字符串是否只差一个字符（角色名的 OCR 容错匹配）。 */
function withinOneChar(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && ++diff > 1) return false;
  }
  return diff <= 1;
}

/**
 * 「冒号被吞掉」的补救。
 *
 * 说话人里不会有标点（业务约定），所以可以拿同片别的帧已经认准的角色名，
 * 到「没拆出角色」的那行的开头做**等长近似匹配**（差 ≤1 字），把被认坏的分隔符切掉。
 *
 * 实测：`小白AI:` 被 OCR 读成 `小白A上`，拿同片另一帧的 `小白AI` 一比对就能还原，
 * 台词从「已抓取片单…」开始，而不是整行都塞进台词。
 *
 * 只在 role 为空时动手，并留下告警——让人工知道这行是补出来的。
 */
function repairRoles(frames) {
  const counts = new Map();
  for (const f of frames) {
    if (f.role && f.line) counts.set(f.role, (counts.get(f.role) || 0) + 1);
  }
  // 长角色优先，避免「阿澄」把「阿澄助手」的前缀抢走
  const known = [...counts.keys()]
    .filter((r) => r.length >= 2 && ROLE_SHAPE.test(r))
    .sort((a, b) => b.length - a.length);
  if (!known.length) return frames;

  for (const f of frames) {
    if (f.role || !f.line) continue;
    for (const role of known) {
      const n = role.length;
      if (f.line.length <= n) continue;
      const head = f.line.slice(0, n);
      if (!ROLE_SHAPE.test(head) || !withinOneChar(head, role)) continue;
      const rest = f.line.slice(n).replace(/^[，。？！…]+/, '');
      if (!rest) continue;                     // 切完没剩下内容 → 不算
      f.role = role;
      f.line = rest;
      // 「无冒号，按续行处理」是拆不出来时的判断，现在补上了，别留着误导人
      f.warnings = f.warnings.filter((w) => !/无冒号/.test(w));
      f.warnings.push(`角色按同片已知角色名补全（原文缺分隔符：${head}≈${role}）`);
      break;
    }
  }
  return frames;
}

/**
 * 从「按抓取/时间顺序排列的逐帧解析结果」构建最终台本行。
 * CLI 与 PR 面板共用，保证两端行为一致。
 *
 * 步骤：说话人继承（续行从同镜号上一帧继承）→ 相邻合并 → 多说话人拆分。
 *
 * @param {Array<{shotNo:string|null, role:string|null, line:string|null, warnings?:string[]}>} frames
 * @param {{joiner?:string, splitSpeakers?:boolean}} [opts]
 * @returns {Array<{shotNo:string|null, role:string|null, line:string, warnings:string[]}>}
 */
function buildRows(frames, opts = {}) {
  const f = repairRoles(frames.map((x) => ({
    ...x,
    warnings: x.warnings ? [...x.warnings] : [],
  })));

  // 说话人继承：续行(无说话人)从同镜号上一帧继承角色
  for (let i = 1; i < f.length; i++) {
    if (!f[i].role && f[i].line && f[i - 1].role && f[i - 1].shotNo === f[i].shotNo) {
      f[i].role = f[i - 1].role;
      f[i].warnings.push('说话人继承自上一帧');
    }
  }

  let rows = mergeRows(f, { joiner: opts.joiner || '' });
  if (opts.splitSpeakers !== false) rows = expandSpeakers(rows);
  return rows;
}

function safeCall(fn, ...args) {
  try { return fn(...args); } catch (_) { return null; }
}

/**
 * 单张分镜帧 → 一条台本记录。**两段式取图**（实测见 docs/DESIGN.md）：
 *   ① 左上 12%x6% 裁切、放大 6 倍 → 只取镜号
 *      标签只有二十来像素高，整帧 OCR 会漏；裁出来放大才读得到。
 *   ② 底部 25% 裁切、灰度、bicubic 4 倍 → 台词
 *      整帧放不大（OCR 输入长边上限约 10000px），裁掉无用区域才腾得出倍率。
 *   ③ 两处都读不到时，才懒加载整帧 OCR 兜底（老片标签更宽，只有整帧读得到）。
 *
 * 整帧 OCR 是最贵的一步（约 650ms），所以只在需要时才跑。
 *
 * @param {string} imagePath
 * @param {{lang?:string, color?:string, scale?:number, engine?:string}} [opts]
 *   color：字幕字色 #RRGGBB，给了就走「抠色」取台词，不给走灰度（默认，更稳）
 *   scale：整帧兜底 OCR 的放大倍数（默认 3）
 * @returns {{file:string, shotNo:string|null, role:string|null, line:string|null,
 *            warnings:string[], raw:object}}
 */
function analyzeFrame(imagePath, opts = {}) {
  const lang = opts.lang || 'zh-Hans-CN';
  const scale = opts.scale != null ? opts.scale : 3;
  let full = null;
  const getFull = () => {
    if (!full) full = ocr(imagePath, { scale, lang, engine: opts.engine });
    return full;
  };

  // —— ① 镜号 ——
  const shotSources = [];
  const shotRegion = safeCall(readShotRegion, imagePath);
  if (shotRegion) shotSources.push(shotRegion);
  let shot = extractShot(shotSources);
  if (!shot.shotNo) {
    shotSources.push(getFull());
    shot = extractShot(shotSources);
  }

  // —— ② 台词 ——
  const dlgRegion = safeCall(readDialogueRegion, imagePath, { color: opts.color });
  let dlg = dlgRegion
    ? extractDialogue(dlgRegion.lines || [], dlgRegion.height || 1080, { yMin: 0 })
    : { role: null, line: null, warnings: ['未识别到台词（目标区域无文本）'], raw: undefined };
  if (!dlg.line) {
    const f = getFull();
    dlg = extractDialogue(f.lines || [], f.height || 1080, {});
  }

  return {
    file: path.basename(imagePath),
    shotNo: shot.shotNo,
    role: dlg.role,
    line: dlg.line,
    warnings: [...shot.warnings, ...dlg.warnings],
    raw: {
      shot: shot.raw,
      dialogue: dlg.raw,
      usedRegions: {
        shot: !!shotRegion,
        dialogue: !!dlgRegion,
        fullFrame: !!full,
      },
    },
  };
}

module.exports = { buildRows, analyzeFrame, repairRoles };

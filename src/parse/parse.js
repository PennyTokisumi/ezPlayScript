'use strict';

const { fixOcr, normalizeRole, normalizeLine } = require('./ocrfix');

/**
 * 把「OCR 行」按特征+方位归类成一条台本记录。
 *
 * 画面布局（实测 1920x1080，甲片 与 乙片 两套片子）：
 *   - 说明：……            顶部、以「说明」开头          → 丢弃
 *   - Sc001 / ep01_SC002  左上（x≈0、贴顶）              → 镜号（使用者重排过的正确编号）
 *   - Sc-1 / Sc_002       右上（x≈85%）                  → 丢弃（分镜师原编号）
 *   - 老周：正在执行擦地任务！ 底部黑条、含冒号、非「说明」  → 角色 + 台词
 *
 * 三件要一起用（CLI 与 PR 面板共用，不要在别处复制实现）：
 *   extractShot(sources)          多路取镜号（整帧 + 左上裁切区）
 *   extractDialogue(lines, H, o)  取角色 + 台词
 *   parseFrame(ocr, opts)         两者拼起来（只有一个 OCR 结果时用这个）
 */

/** 去掉 OCR 在字符间插入的空白（中文/标签都无有意义空格）。 */
function stripSpaces(s) {
  return (s || '').replace(/\s+/g, '');
}

/**
 * 镜号正则：SC 后跟数字+可选尾字母（「ep01_SC015a」→「015a」）。
 * 容忍 SC 与数字间夹一个分隔符（_ - 一 空格）。
 * 注意：只在 SC 上下文里把「一」当分隔符，绝不全局替换「一」（台词里「一」是常用字）。
 */
const SHOT_RE = /S\s*C[_\-一]?(\d{1,4}[a-dA-D]?)/i;

/** 真冒号（含 OCR 常输出的比例号 ∶）。 */
const COLON_RE = /[：:∶]/;
/** 点号——OCR 常把半角冒号认成 . ．·，只有前面像角色名时才当冒号（见 splitRoleLine）。 */
const DOT_RE = /[.．·]/;
/** 「像角色名」的形状：1~8 个字，纯中英文数字/&。 */
const ROLE_SHAPE = /^[\u4e00-\u9fffA-Za-z0-9&＆]{1,8}$/;

/**
 * 从一行文本里抽取镜号（SC 后面的数字+可选尾字母），保留前导零。
 * 「ep01_SC002」→「002」；「ep01_SC015a」→「015a」。
 */
function extractShotNo(text) {
  const m = stripSpaces(text).match(SHOT_RE);
  return m ? m[1] : null;
}

/** 判断某行是不是「说明」注释行。 */
function isDescription(cleaned) {
  return /^说明[:：]/.test(cleaned);
}

/**
 * 把「角色：台词」拆开。拆不开返回 null。
 *
 * 主分隔符是真冒号 `： : ∶`。
 * 副分隔符是 `. ． ·`——但**只有在点号前面那截看着像角色名时**才当冒号：
 * 半角冒号很容易被 OCR 读成点（实测 `小白AI:不辛苦` → `小白AI.不辛苦`），
 * 而省略号碎片（`前十、前五十．及`）前面那截含标点、不像角色名，不会被误切。
 *
 * @returns {null|{role:string, line:string}}
 */
function splitRoleLine(text) {
  const t = text || '';
  const m = t.match(/^(.*?)([：:∶])([\s\S]*)$/);
  if (m) return { role: m[1], line: m[3] };

  const d = t.match(/^(.*?)([.．·])([\s\S]*)$/);
  if (d) {
    const head = d[1].trim();
    if (head && ROLE_SHAPE.test(head)) return { role: d[1], line: d[3] };
  }
  return null;
}

/**
 * 抽镜号。**支持多路 OCR 结果**：整帧那一路能读到宽标签（甲片 的 `a_sc050` 宽 14%），
 * 左上裁切那一路能读到小标签（乙片 的 `Sc001` 在全帧里根本出不来）。
 * 两路候选合并后再统一排序，单靠任何一路都会漏。
 *
 * 排序依据（实测定的优先级）：
 *   ① y 小的优先——重排标签贴画面最上沿（y≈0.8%），分镜师原编号在它下面（y≈15%）；
 *   ② x 小的优先——标签在 x≈0；
 *   ③ 带 ep 前缀的优先——只在前两条打平时兜底（OCR 也可能把 e 认成别的字符，不能当主判据）。
 *
 * @param {Array<{lines:Array, width?:number, height?:number}>} sources 可给多个 OCR 结果
 * @returns {{shotNo:string|null, warnings:string[], raw?:object}}
 */
function extractShot(sources) {
  const warnings = [];
  const cands = [];

  for (const s of sources || []) {
    if (!s || !Array.isArray(s.lines)) continue;
    const W = s.width || 1920;
    const H = s.height || 1080;
    // 这块 OCR 来自整帧还是某块裁切？裁切的话把坐标还原成帧比例再判断方位
    const reg = s.region || { x: 0, y: 0, w: 1, h: 1 };
    for (const l of s.lines) {
      const clean = stripSpaces(l.text);
      if (!SHOT_RE.test(clean)) continue;
      const xr = reg.x + ((l.x || 0) / W) * reg.w;
      const yr = reg.y + ((l.y || 0) / H) * reg.h;
      const endInCrop = ((l.x || 0) + (l.w || 0)) / W;   // 在图内（裁切图坐标系）的右缘
      if (xr >= 0.5 || yr >= 0.45) continue;   // 只要左上：排除右上的分镜师原编号
      if (endInCrop >= 0.98) continue;         // 文字顶到图边 → 这截被裁断了，编号不完整
      cands.push({ text: l.text, clean, xr, yr, ep: /ep/i.test(clean) ? 0 : 1 });
    }
  }

  cands.sort((a, b) => a.yr - b.yr || a.xr - b.xr || a.ep - b.ep);

  const hit = cands[0] || null;
  const shotNo = hit ? extractShotNo(hit.clean) : null;
  if (!shotNo) warnings.push('未识别到镜号（左上 SC 标签）');

  return {
    shotNo,
    warnings,
    raw: hit ? { text: hit.text, x: Math.round(hit.xr * 1000), y: Math.round(hit.yr * 1000), src: hit.clean } : undefined,
  };
}

/**
 * 抽「角色 + 台词」。
 *
 * 算法（三步）：
 *   ① 按 y 聚成「文字行」：同一视觉行常被 OCR 拆成多个框（「小胖孑：」+「我在门口等。」
 *      或「小北：问题」+「大爷」），必须按 x 拼接，否则丢台词。
 *   ② 选锚点行：**最低的能拆出角色/台词的行**（= 台词起点）。拆不出则取最低行
 *      （续行帧：整段当台词，说话人待继承）。
 *   ③ 从锚点向上下扩折行续句：间隔在 blockGap 内、且自己拆不出角色/台词的行（= 折行续句）。
 *
 * 早先版本「只取最低的那一个 y 带」，折行台词（…… 之类把一句拆到两个 y）会丢掉上半句；
 * 也不能按「行里有没有冒号」过滤，那会把无冒号的续行（如「大爷」）丢掉。
 *
 * @param {Array<{text:string,x:number,y:number,w?:number,h?:number}>} lines
 * @param {number} H 画布高
 * @param {{yMin?:number, bandTol?:number, blockGap?:number}} [opts]
 *   yMin：只考虑 y 大于 H*yMin 的行（默认 0.5=下半）；裁切图已只剩台词区时传 0 关闭。
 *   bandTol：同一文字行的 y 容差（默认 3%H）。
 *   blockGap：折行续句相对锚点行的最大间隔（默认 8%H）。
 */
function extractDialogue(lines, H, opts = {}) {
  const yMin = opts.yMin != null ? opts.yMin : 0.5;
  const bandTol = opts.bandTol != null ? opts.bandTol : 0.03;
  const blockGap = opts.blockGap != null ? opts.blockGap : 0.08;
  const warnings = [];

  const usable = (lines || [])
    .map((l) => ({ text: l.text, x: l.x, y: l.y, clean: stripSpaces(l.text) }))
    .filter((l) => l.clean.length > 0)
    .filter((l) => !isDescription(l.clean))
    .filter((l) => !(yMin > 0 && l.y <= H * yMin))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  if (!usable.length) {
    warnings.push('未识别到台词（目标区域无文本）');
    return { role: null, line: null, warnings, raw: undefined };
  }

  // ① 按 y 聚成文字行
  const tol = H * bandTol;
  const bands = [];
  for (const b of usable) {
    const last = bands[bands.length - 1];
    if (last && b.y - last.y <= tol) last.boxes.push(b);
    else bands.push({ y: b.y, boxes: [b] });
  }
  for (const b of bands) {
    b.boxes.sort((p, q) => p.x - q.x);
    b.text = b.boxes.map((x) => x.clean).join('');
    b.split = splitRoleLine(b.text);
  }

  // ② 锚点：最低的能拆出角色/台词的行；都拆不出就取最低行
  let anchor = null;
  for (let i = bands.length - 1; i >= 0; i--) {
    if (bands[i].split) { anchor = bands[i]; break; }
  }
  if (!anchor) anchor = bands[bands.length - 1];

  // ③ 向上下扩折行续句
  const gap = H * blockGap;
  const start = bands.indexOf(anchor);
  let lo = start;
  let hi = start;
  while (lo > 0 && !bands[lo - 1].split && anchor.y - bands[lo - 1].y <= gap) lo--;
  while (hi < bands.length - 1 && !bands[hi + 1].split && bands[hi + 1].y - anchor.y <= gap) hi++;

  const block = bands.slice(lo, hi + 1);
  const dialogueText = block.map((b) => b.text).join('');

  // 同帧里还有别的能拆出角色/台词的行没被取 → 可能是另一句台词，不能静默丢掉
  const left = bands.filter((b) => b.split && block.indexOf(b) < 0);
  if (left.length) {
    warnings.push(`同帧另有 ${left.length} 行台词未取（多说话人？需人工核对）`);
  }

  const parts = splitRoleLine(dialogueText);
  let role = null;
  let line = null;
  if (parts) {
    role = normalizeRole(fixOcr(parts.role)) || null;
    line = normalizeLine(fixOcr(parts.line));
    if (!role) warnings.push('说话人为空（冒号前未识别，需继承/人工）');
    if (!line) warnings.push('台词为空（冒号后未识别）');
  } else {
    // 拆不出角色：多半是续行，整段都是台词，说话人待继承
    role = null;
    line = normalizeLine(fixOcr(dialogueText));
    warnings.push('无冒号，按续行处理（说话人待继承/人工）');
  }

  return {
    role,
    line,
    warnings,
    raw: {
      text: block.map((b) => b.boxes.map((x) => x.text).join(' ')).join(' | '),
      boxes: block.reduce((n, b) => n + b.boxes.length, 0),
      bands: block.length,
    },
  };
}

/**
 * @param {{file:string,width:number,height:number,lines:Array<{text:string,x:number,y:number,w:number,h:number}>}} ocr
 * @param {{yMin?:number, bandTol?:number, blockGap?:number}} [opts] 透传给 extractDialogue
 * @returns {{file:string, shotNo:string|null, role:string|null, line:string|null,
 *            warnings:string[], raw:{shot?:object, dialogue?:object}}}
 */
function parseFrame(ocr, opts = {}) {
  const W = ocr.width || 1920;
  const H = ocr.height || 1080;
  const lines = ocr.lines || [];

  const shot = extractShot([{ lines, width: W, height: H }]);
  const dlg = extractDialogue(lines, H, opts);

  return {
    file: ocr.file,
    shotNo: shot.shotNo,
    role: dlg.role,
    line: dlg.line,
    warnings: [...shot.warnings, ...dlg.warnings],
    raw: {
      shot: shot.raw,
      dialogue: dlg.raw,
    },
  };
}

module.exports = {
  parseFrame,
  extractShot,
  extractDialogue,
  extractShotNo,
  splitRoleLine,
  stripSpaces,
  isDescription,
  SHOT_RE,
  COLON_RE,
  DOT_RE,
  ROLE_SHAPE,
};

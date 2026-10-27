'use strict';

const fs = require('fs');

/**
 * 把合并后的台本行输出成纯文本（不生成表格）：每行 `镜号<sep>角色<sep>台词`，行间换行。
 *
 * @param {Array<{shotNo:string|null, role:string|null, line:string}>} rows
 * @param {{sep?:string, repeatShot?:boolean, eol?:string}} [opts]
 *   sep：列分隔（默认两个空格）
 *   repeatShot：同镜号的续行是否重复镜号；false 时续行镜号留空**并对齐到最宽镜号**
 *   eol：换行符（默认 \r\n，Windows 文本；传 '' 表示不换行）
 * @returns {string}
 */
function toText(rows, opts = {}) {
  const sep = opts.sep != null ? opts.sep : '  ';
  const repeatShot = opts.repeatShot !== false;
  // 注意用 != null 而不是 ||：eol:'' 是合法值（单行输出），不能被默认值吃掉
  const eol = opts.eol != null ? opts.eol : '\r\n';

  if (!rows.length) return '';

  // 留空对齐：空镜号补到最宽镜号的宽度，否则续行列会整体左移（"  小胖" 而不是 "     小胖"）
  const blankShot = repeatShot
    ? ''
    : ' '.repeat(rows.reduce((n, r) => Math.max(n, (r.shotNo || '').length), 0));

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const same = i > 0 && rows[i - 1].shotNo === r.shotNo && r.shotNo != null;
    const shot = (!repeatShot && same) ? blankShot : (r.shotNo || '');
    out.push([shot, r.role || '', r.line || ''].join(sep));
  }
  return out.join(eol) + (eol ? eol : '');
}

function writeText(rows, outPath, opts = {}) {
  fs.writeFileSync(outPath, toText(rows, opts), 'utf8');
  return outPath;
}

module.exports = { toText, writeText };

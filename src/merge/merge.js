'use strict';

/**
 * 相邻合并：同一镜号内、同一角色**连续**说话 → 台词拼接、不换行；
 * 中间换了别的角色（相邻行不同角色）→ 另起一行。
 *
 * 因为「中间有别人说话」时，紧邻的上一条就是那个别人，镜号/角色不同 → 自然另起新行。
 *
 * @param {Array<{shotNo:string|null, role:string|null, line:string|null, file?:string, warnings?:string[]}>} frames
 *        已按拍摄/抓取顺序排列
 * @param {{joiner?:string}} [opts] joiner：合并时的连接符，默认直接相连（''）
 * @returns {Array<{shotNo:string|null, role:string|null, line:string, files:string[], warnings:string[]}>}
 */
function mergeRows(frames, opts = {}) {
  const joiner = opts.joiner != null ? opts.joiner : '';
  const rows = [];

  for (const f of frames) {
    const prev = rows[rows.length - 1];
    const canMerge =
      prev &&
      f.shotNo != null &&
      f.role != null &&
      prev.shotNo === f.shotNo &&
      prev.role === f.role;

    if (canMerge) {
      prev.line = [prev.line, f.line || ''].filter(Boolean).join(joiner);
      if (f.file) prev.files.push(f.file);
      if (f.warnings && f.warnings.length) prev.warnings.push(...f.warnings);
    } else {
      rows.push({
        shotNo: f.shotNo,
        role: f.role,
        line: f.line || '',
        files: f.file ? [f.file] : [],
        warnings: f.warnings ? [...f.warnings] : [],
      });
    }
  }

  return rows;
}

module.exports = { mergeRows, expandSpeakers };

/**
 * 多说话人展开：角色形如「小胖&老周」时，拆成每人一行、台词各自复制。
 * 必须在 mergeRows **之后**调用（先合并同角色连续台词，再按人拆行），
 * 否则会打断相邻合并的判断。
 *
 * @param {Array<{shotNo:string|null, role:string|null, line:string, files?:string[], warnings?:string[]}>} rows
 * @param {{separators?:RegExp}} [opts] separators：拆分符（默认 & ＆）
 * @returns {Array} 展开后的行（结构同输入）
 */
function expandSpeakers(rows, opts = {}) {
  const sep = opts.separators || /[&＆]/;
  const out = [];
  for (const r of rows) {
    const parts = (r.role || '').split(sep).map((s) => s.trim()).filter(Boolean);
    if (parts.length <= 1) {
      out.push(r);
    } else {
      for (const role of parts) {
        out.push({
          shotNo: r.shotNo,
          role,
          line: r.line,
          files: r.files ? [...r.files] : [],
          warnings: r.warnings ? [...r.warnings] : [],
        });
      }
    }
  }
  return out;
}

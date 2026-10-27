'use strict';

/**
 * 三列表格 docx 输出（镜号 / 角色 / 台词），格式对齐仓库里的 example.docx。
 *
 * 注意：`docx` 这个第三方依赖是**按需加载**的，不在文件顶部 require。
 * 原因：从仓库 clone 下来时 node_modules 是空的（不入库），如果加载期就 require('docx')，
 * 面板会在 require 阶段整个崩掉、连 txt 导出都用不了。
 * 现在没装依赖也能开面板、能导 txt，只有真的点「导出 docx」时才会报一条可操作的错误。
 */

const fs = require('fs');

const FONT = '宋体';
const SIZE = 20; // 半磅 → 10pt，与 example 一致

let lib = null;

function loadDocx() {
  if (lib) return lib;
  try {
    lib = require('docx');
  } catch (e) {
    throw new Error(
      '缺少 docx 依赖，无法导出 docx。请先在项目根和 cep/com.ezplayscript.panel 下各跑一次 ' +
      '`npm ci`（或直接 `npm run setup`），再重启面板。原始信息：' + e.message);
  }
  return lib;
}

function borders() {
  const { BorderStyle } = loadDocx();
  const thin = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  return { top: thin, bottom: thin, left: thin, right: thin };
}

function cellText(text, { align, bold = false } = {}) {
  const { Paragraph, TextRun, AlignmentType } = loadDocx();
  return new Paragraph({
    alignment: align || AlignmentType.CENTER,
    children: [new TextRun({ text: text == null ? '' : String(text), font: FONT, size: SIZE, bold })],
  });
}

function headerRow() {
  const { TableCell, TableRow } = loadDocx();
  const b = borders();
  const mk = (t) => new TableCell({ borders: b, children: [cellText(t, { bold: true })] });
  return new TableRow({ tableHeader: true, children: [mk('镜号'), mk('角色'), mk('台词')] });
}

/**
 * @param {Array<{shotNo:string|null, role:string|null, line:string}>} rows 已合并的台本行（按顺序）
 * @param {string} outPath 输出 .docx 路径
 * @param {{title?:string}} [opts]
 */
async function writeDocx(rows, outPath, opts = {}) {
  const { Document, Packer, Table, TableCell, TableRow, Paragraph, TextRun,
    WidthType, VerticalMergeType, AlignmentType } = loadDocx();
  const b = borders();

  // 连续相同镜号分组，用于纵向合并「镜号」列
  const tableRows = [headerRow()];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const samePrev = i > 0 && rows[i - 1].shotNo === r.shotNo && r.shotNo != null;

    const shotCell = new TableCell({
      borders: b,
      verticalMerge: samePrev ? VerticalMergeType.CONTINUE : VerticalMergeType.RESTART,
      children: [cellText(samePrev ? '' : (r.shotNo || ''))],
    });
    const roleCell = new TableCell({ borders: b, children: [cellText(r.role || '')] });
    const lineCell = new TableCell({
      borders: b,
      children: [cellText(r.line || '', { align: AlignmentType.LEFT })],
    });

    tableRows.push(new TableRow({ children: [shotCell, roleCell, lineCell] }));
  }

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [1400, 1600, 6000],
    rows: tableRows,
  });

  const children = [];
  if (opts.title) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: opts.title, font: FONT, size: 32, bold: true })],
    }));
  }
  children.push(table);

  const doc = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buf);
  return outPath;
}

module.exports = { writeDocx };

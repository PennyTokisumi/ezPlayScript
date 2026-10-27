'use strict';

/**
 * OCR 文本的纠错与规整。
 *
 * 台本最终一定有人工校对，所以这里的策略是「**宁可整齐，不要花**」：
 *   - 角色：只允许中文/英文/数字（+ 多说话人的 &）。标点一律不要。
 *   - 台词：只保留 ，。？！… 五种标点。
 *     OCR 认出的其它符号（、《》“”~·∶；： 等）要么映射成最接近的逗号，要么直接丢掉。
 *
 * 偏旁拆分（`亻壬`→任）是另一回事，那会破坏**内容**，必须逐条精确替换。
 */

/**
 * OCR 偏旁拆分纠错表。
 * Windows OCR 有时把左右/上下结构的汉字拆成偏旁分开输出（如「任」→「亻壬」）。
 * 这些偏旁序列在正常中文里几乎不会独立成词，因此做精确替换是安全的。表可随用随补。
 */
const SEQUENCE_FIXES = [
  ['亻十', '什'],
  ['亻壬', '任'],
  ['氵吉', '洁'],
  ['至刂', '到'],
  ['亻尔', '你'],
  ['纟工', '红'],
  ['讠青', '请'],
  ['忄青', '情'],
  ['日月', '明'],   // 谨慎：仅在明显拆分场景；如误伤可从表中移除
  // v1.2.0：乙片 实测补充（粗体小字，左右结构常被拆）
  ['夕卜', '外'],
  ['川页', '顺'],
];

// 单字规范化：繁体/异体 → 简体（zh-Hans 语境下安全）
const CHAR_FIXES = [
  ['務', '务'],
];

/** 只做偏旁/异体纠错，不动标点。 */
function fixOcr(text) {
  if (!text) return text;
  let s = text;
  for (const [bad, good] of SEQUENCE_FIXES) s = s.split(bad).join(good);
  for (const [bad, good] of CHAR_FIXES) s = s.split(bad).join(good);
  return s;
}

// ───────────────────────── 标点 ─────────────────────────

/** 连续 2 个以上的点号/中点/引号/省略号 → 省略号碎片，统一成 …… */
const ELLIPSIS_RUN = /[.．·・…“”"'‘’]{2,}/g;

/**
 * 把落单的 “ / ” 换成 ……，成对的保持原样。
 * 实测 `前十、前五十“及一百名` 里的引号就是省略号被认成的。
 */
function repairQuotes(text) {
  const chars = Array.from(text);
  const open = [];
  const stray = new Set();
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '“') open.push(i);
    else if (chars[i] === '”') {
      if (open.length) open.pop();
      else stray.add(i);
    }
  }
  for (const i of open) stray.add(i);
  if (!stray.size) return text;
  return chars.map((c, i) => (stray.has(i) ? '……' : c)).join('');
}

/** 只做省略号归一化（原文里其它标点保持原样）。 */
function normalizePunct(text) {
  if (!text) return text;
  return repairQuotes(text).replace(ELLIPSIS_RUN, '……');
}

// ───────────────────────── 角色 / 台词 规整 ─────────────────────────

/**
 * 台词白名单：汉字、英文、数字，以及 ，。？！…《》 这几种标点。
 * 业务约定（乙片 实测校准）：正文标点只有 逗号/句号/问号/叹号/省略号 + **书名号**；
 * 其余符号（引号、括号、《》以外的书名类符号、`~`、`·` 等）都当 OCR 认坏的，丢掉。
 */
const LINE_KEEP = /[\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9，。？！…《》]/g;

/** 这些符号在台词里都是「认错的标点」，统一成逗号（换成句号更离谱）。 */
const TO_COMMA = /[、；;:：∶~～—–－·・]/g;

/**
 * 角色规整：只留中文/英文/数字，以及多说话人分隔符 &。
 * 例：`小白A《` → `小白A`；`阿澄：` → `阿澄`；`小胖 & 老周` → `小胖&老周`
 */
function normalizeRole(text) {
  if (!text) return '';
  return (text || '')
    .replace(/[＆]/g, '&')
    .replace(/[^\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9&]/g, '')
    .trim();
}

/**
 * 台词规整：把标点收进「，。？！…《》」，其余符号丢掉。
 *
 * 顺序很重要：
 *   ① 先把《…》整段挖出来占位——书名号里是**标题原文**，不参与下面的标点收敛
 *      （《黑神话：悟空》里的冒号要是被转成逗号，标题就毁了）
 *   ② 省略号碎片先合并（`.．·` 的连续串 → ……），否则下面单点号会被误判成句号
 *   ③ 单个 `. ．` → 。
 *   ④ 半角标点 → 全角
 *   ⑤ 其它符号（、；：~ 等）→ ，
 *   ⑥ 白名单外的字符直接丢弃
 *   ⑦ 合并重复标点、去掉行首行尾的逗号，最后把书名号整段还原
 */
const TITLE_SPAN = /《[^》]*》/g;

function normalizeLine(text) {
  if (!text) return '';
  const titles = [];
  let s = String(text).replace(TITLE_SPAN, (m) => {
    titles.push(m);
    return `《${titles.length - 1}》`;   // 占位符本身在字符白名单里，能活到最后
  });

  s = repairQuotes(s);
  s = s.replace(ELLIPSIS_RUN, '……');
  s = s.replace(/[.．]/g, '。');
  s = s.replace(/,/g, '，').replace(/\?/g, '？').replace(/!/g, '！');
  s = s.replace(TO_COMMA, '，');
  s = (s.match(LINE_KEEP) || []).join('');
  s = s.replace(/，{2,}/g, '，').replace(/。{2,}/g, '。');
  // 中文标准省略号是 ……（两个 …）；单个 … 也补成 ……
  s = s.replace(/…+/g, '……');
  s = s.replace(/[，、]+$/g, '').replace(/^[，]+/g, '');

  if (titles.length) {
    s = s.replace(/《(\d+)》/g, (m, i) => (titles[Number(i)] !== undefined ? titles[Number(i)] : m));
  }
  return s.trim();
}

module.exports = {
  fixOcr,
  normalizePunct,
  normalizeRole,
  normalizeLine,
  repairQuotes,
  SEQUENCE_FIXES,
  CHAR_FIXES,
};

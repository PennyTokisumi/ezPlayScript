'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseFrame, extractShot, extractDialogue, extractShotNo, splitRoleLine,
  stripSpaces, isDescription,
} = require('../src/parse/parse');
const { fixOcr, normalizePunct, normalizeRole, normalizeLine } = require('../src/parse/ocrfix');

const FULL = require('./fixtures/full-frame.json');
const CROP = require('./fixtures/panel-crop.json');

/** 造一个画布 */
function canvas(lines, W = 3000, H = 3000, extra = {}) {
  return { file: 'x.png', width: W, height: H, lines, ...extra };
}

// ───────────────────────── 镜号 ─────────────────────────

test('镜号：真实帧 —— e 被认成 ℃、_ 被认成一，仍能取到 050', () => {
  assert.equal(extractShotNo('℃ p 27 一 s c 050'), '050');
});

test('镜号：保留前导零与尾字母', () => {
  assert.equal(extractShotNo('ep01_SC002'), '002');
  assert.equal(extractShotNo('ep01_SC015a'), '015a');
  assert.equal(extractShotNo('EP027-SC048-4'), '048');
});

test('镜号：不在 SC 上下文里把「一」当分隔符', () => {
  assert.equal(extractShotNo('他一个人走了'), null);
  assert.equal(extractShotNo('ep01一sc013'), '013');
});

test('镜号：整帧那一路 —— 只认左上标签，不认右上的分镜师原编号', () => {
  const s = extractShot([FULL]);
  assert.equal(s.shotNo, '050');
  assert.deepEqual(s.warnings, []);
});

test('镜号：原编号即使被读成整行也抢不过标签（带 EP 也不能优先）', () => {
  const src = canvas([
    { text: 'ep02_sc050', x: 13, y: 25, w: 300 },
    { text: 'MX-EP002-SC048-4', x: 584, y: 482, w: 500 },
  ], 5760, 3240);
  assert.equal(extractShot([src]).shotNo, '050');
});

test('镜号：多路合并 —— 整帧读不到的小标签，靠左上裁切那一路补上（实测样例）', () => {
  // 整帧里只有一个"无 SC"的乱码行（实测就是这样），裁切区里有 SC001
  const full = canvas([{ text: '刷 屏', x: 20, y: 30, w: 100 }], 5760, 3240);
  const region = canvas([{ text: 'SC001', x: 0, y: 40, w: 200 }], 1382, 389,
    { region: { x: 0, y: 0, w: 0.12, h: 0.06 } });

  assert.equal(extractShot([full]).shotNo, null, '单靠整帧读不到');
  assert.equal(extractShot([region]).shotNo, '001', '单靠裁切区能读到');
  assert.equal(extractShot([full, region]).shotNo, '001', '两路合并后取到');
});

test('镜号：贴到图边（被裁断）的候选丢弃，避免截出半个编号', () => {
  // 模拟「ep02_sc050」被 12% 裁切切成「ep02_sc0」并顶到右缘
  const cut = canvas([{ text: 'ep02_sc0', x: 0, y: 40, w: 1375 }], 1382, 389,
    { region: { x: 0, y: 0, w: 0.12, h: 0.06 } });
  assert.equal(extractShot([cut]).shotNo, null);
});

test('镜号：裁切区坐标会还原成帧坐标再判断方位', () => {
  // 这块裁切在整帧右侧 → 还原后 xr≈0.85，必须被「只要左上」剔除
  const right = canvas([{ text: 'Sc-1', x: 10, y: 40, w: 200 }], 1382, 389,
    { region: { x: 0.8, y: 0.1, w: 0.12, h: 0.06 } });
  assert.equal(extractShot([right]).shotNo, null);
});

test('镜号：没有候选时给告警', () => {
  const s = extractShot([canvas([{ text: '无关文本', x: 10, y: 10, w: 50 }], 1920, 1080)]);
  assert.equal(s.shotNo, null);
  assert.equal(s.warnings.length, 1);
  assert.match(s.warnings[0], /未识别到镜号/);
});

// ───────────────────────── 角色/台词分隔 ─────────────────────────

test('拆角色：真冒号（全角/半角/比例号）', () => {
  assert.deepEqual(splitRoleLine('阿澄：希望顺利'), { role: '阿澄', line: '希望顺利' });
  assert.deepEqual(splitRoleLine('阿澄:希望顺利'), { role: '阿澄', line: '希望顺利' });
  assert.deepEqual(splitRoleLine('阿澄∶希望顺利'), { role: '阿澄', line: '希望顺利' });
});

test('拆角色：OCR 把半角冒号认成点号时，前面像角色名才当冒号', () => {
  // 实测：`小白AI:不辛苦` 被读成 `小白AI.不辛苦`
  assert.deepEqual(splitRoleLine('小白AI.不辛苦'), { role: '小白AI', line: '不辛苦' });
  assert.deepEqual(splitRoleLine('阿澄．希望顺利'), { role: '阿澄', line: '希望顺利' });
});

test('拆角色：省略号碎片里的点号不能被误当冒号', () => {
  // 前面那截含标点，不像角色名 → 不拆
  assert.equal(splitRoleLine('前十、前五十．及一百名'), null);
  assert.equal(splitRoleLine('已抓取片单前十、前五十·及'), null);
});

test('拆角色：整段没有分隔符就返回 null（当续行）', () => {
  assert.equal(splitRoleLine('小白A上已抓取片单前十'), null);
  assert.equal(splitRoleLine('（叹气）'), null);
});

// ───────────────────────── 台词 ─────────────────────────

test('台词：真实帧 —— 同一 y 的两框必须拼接，不能只看带冒号的那个', () => {
  const d = extractDialogue(FULL.lines, FULL.height);
  assert.equal(d.role, '小北');
  assert.equal(d.line, '今天几点');
  assert.deepEqual(d.warnings, []);
});

test('台词：回归 —— 面板裁切通道（yMin:0）不得丢掉无冒号的续行「几点」', () => {
  const d = extractDialogue(CROP.lines, CROP.height, { yMin: 0 });
  assert.equal(d.role, '小北');
  assert.equal(d.line, '今天，几点', '续行必须拼上（逗号是 OCR 把省略号认成的，保留原样）');
  assert.ok(d.line.includes('几点'), '不能丢字');
});

test('台词：折行续句（跨 y 且超过 3% 带容差）仍要拼上', () => {
  const c = canvas([
    { text: '老 周 ： 我 一 定 要', x: 900, y: 2400 },
    { text: '拿 到 冠 军', x: 900, y: 2560 },
  ]);
  const d = extractDialogue(c.lines, c.height);
  assert.equal(d.role, '老周');
  assert.equal(d.line, '我一定要拿到冠军');
});

test('台词：续行帧（整帧无冒号）→ 整段当台词，角色留空待继承并告警', () => {
  const d = extractDialogue(canvas([{ text: '还 有 三 天', x: 900, y: 2500 }]).lines, 3000);
  assert.equal(d.role, null);
  assert.equal(d.line, '还有三天');
  assert.match(d.warnings.join(), /无冒号/);
});

test('台词：「说明：」行永远不参与', () => {
  const d = extractDialogue(canvas([
    { text: '说 明 ： 夜 里 的 街', x: 100, y: 2490 },
    { text: '老 周 ： 走 吧', x: 900, y: 2600 },
  ]).lines, 3000);
  assert.equal(d.role, '老周');
  assert.equal(d.line, '走吧');
});

test('台词：不被上一句污染 —— 能拆出角色的行不并入当前块，但要告警', () => {
  const d = extractDialogue(canvas([
    { text: '小 北 ： 上 面 这 句', x: 900, y: 2300 },
    { text: '老 周 ： 下 面 这 句', x: 900, y: 2600 },
  ]).lines, 3000);
  assert.equal(d.role, '老周');
  assert.equal(d.line, '下面这句');
  assert.match(d.warnings.join(), /另有 1 行台词未取/);
});

test('台词：yMin 关掉时整张图都算台词区（裁切图场景）', () => {
  const c = canvas([{ text: '老 周 ： 顶 部', x: 100, y: 5 }], 3000, 1000);
  assert.equal(extractDialogue(c.lines, c.height).line, null);
  assert.equal(extractDialogue(c.lines, c.height, { yMin: 0 }).line, '顶部');
});

test('台词：区域内没字时给告警而不是崩', () => {
  const d = extractDialogue([], 1080);
  assert.equal(d.line, null);
  assert.match(d.warnings.join(), /未识别到台词/);
});

test('台词：实测样例 —— 点号当冒号 + 偏旁纠错 + 标点收敛', () => {
  const c = canvas([
    { text: '小 白 AI. 不 辛 苦 ． 能 帮 到 你 就 超 开 心 了 ！', x: 100, y: 500 },
  ], 1000, 1000);
  const d = extractDialogue(c.lines, c.height, { yMin: 0 });
  assert.equal(d.role, '小白AI');
  assert.equal(d.line, '不辛苦。能帮到你就超开心了！');
});

// ───────────────────────── 纠错/标点 ─────────────────────────

test('ocrfix：偏旁拆分', () => {
  assert.equal(fixOcr('夕卜'), '外');
  assert.equal(fixOcr('川页利'), '顺利');
  assert.equal(fixOcr('以夕卜的'), '以外的');
});

test('ocrfix：省略号碎片合并成 ……', () => {
  assert.equal(normalizePunct('前十．“．及一百名'), '前十……及一百名');
  assert.equal(normalizePunct('潜在片单...'), '潜在片单……');
  assert.equal(normalizePunct('潜在片单……'), '潜在片单……');
});

test('ocrfix：句读和成对引号不动（可能是真的）', () => {
  assert.equal(normalizePunct('前十、前五十：及'), '前十、前五十：及');
  assert.equal(normalizePunct('他说“走吧”'), '他说“走吧”');
  assert.equal(normalizePunct('今天，几点'), '今天，几点');
});

test('ocrfix：落单的引号就是被认坏的省略号', () => {
  assert.equal(normalizePunct('前十、前五十“及一百名'), '前十、前五十……及一百名');
  assert.equal(normalizePunct('搜“'), '搜……');
  assert.equal(normalizePunct('“走吧”他说'), '“走吧”他说');
});

// ───────────────────── 角色/台词规整（业务约定）─────────────────────

test('角色规整：只留中文/英文/数字，标点全去掉', () => {
  assert.equal(normalizeRole('小白A《'), '小白A');
  assert.equal(normalizeRole('阿澄：'), '阿澄');
  assert.equal(normalizeRole('《小北》'), '小北');
  assert.equal(normalizeRole(' 小胖 ＆ 老周 '), '小胖&老周', '多说话人分隔符要留着');
  assert.equal(normalizeRole('——'), '');
});

test('台词规整：标点只留 ，。？！…《》', () => {
  assert.equal(normalizeLine('希望顺利转正,小白你要加油哦~等我'), '希望顺利转正，小白你要加油哦，等我');
  assert.equal(normalizeLine('前十、前五十'), '前十，前五十', '顿号收敛成逗号');
  assert.equal(normalizeLine('真的吗?太好了!'), '真的吗？太好了！');
  assert.equal(normalizeLine('潜在片单...'), '潜在片单……');
  assert.equal(normalizeLine('他说“走吧”'), '他说走吧', '引号属于「奇怪符号」，直接无视');
  assert.equal(normalizeLine('（叹气）好吧'), '叹气好吧');
});

test('台词规整：书名号是正文内容，必须原样保留', () => {
  assert.equal(normalizeLine('看了《新闻联播》吗'), '看了《新闻联播》吗');
  assert.equal(normalizeLine('《王者荣耀》'), '《王者荣耀》');
  assert.equal(normalizeLine('《黑神话：悟空》上线了'), '《黑神话：悟空》上线了', '书名号内部的冒号是标题原文，不能收敛');
  assert.equal(normalizeLine('《蜘蛛侠·平行宇宙》'), '《蜘蛛侠·平行宇宙》');
  assert.equal(normalizeLine('《王者荣耀》,真香~'), '《王者荣耀》，真香', '书名号外面的标点照常收敛');
});

test('台词规整：合并重复标点、去掉行首行尾逗号', () => {
  assert.equal(normalizeLine('哦，，等我'), '哦，等我');
  assert.equal(normalizeLine('，开头'), '开头');
  assert.equal(normalizeLine('结尾、'), '结尾');
  assert.equal(normalizeLine('单个…也补成……'), '单个……也补成……');
});

// ───────────────────────── 整帧 ─────────────────────────

test('parseFrame：真实帧端到端 == 仓库里的 台本.txt 那一行', () => {
  const f = parseFrame(FULL);
  assert.equal(f.shotNo, '050');
  assert.equal(f.role, '小北');
  assert.equal(f.line, '今天几点');
  assert.deepEqual(f.warnings, []);
  assert.ok(f.raw.shot && f.raw.dialogue, 'raw 诊断信息要保留');
});

test('parseFrame：台词告警与镜号告警会一起回传', () => {
  const f = parseFrame(canvas([{ text: '还 有 三 天', x: 900, y: 2500 }]));
  assert.equal(f.shotNo, null);
  assert.equal(f.role, null);
  assert.match(f.warnings.join(), /未识别到镜号/);
  assert.match(f.warnings.join(), /无冒号/);
});

// ───────────────────────── 小工具 ─────────────────────────

test('stripSpaces 去光所有空白', () => {
  assert.equal(stripSpaces(' 小 北 ： 今 天 \n'), '小北：今天');
});

test('isDescription 只认「说明：」开头（必须带冒号）', () => {
  assert.equal(isDescription('说明：夜里'), true);
  assert.equal(isDescription('说明:夜里'), true);
  assert.equal(isDescription('说明性文字'), false, '没有冒号的不是注释行');
  assert.equal(isDescription('小北：说明'), false);
});

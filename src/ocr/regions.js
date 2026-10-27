'use strict';

/**
 * 按区域取图再 OCR —— 镜号和台词的识别精度几乎全由这一步决定。
 *
 * 为什么必须裁切（实测，见 docs/DESIGN.md「两段式取图」）：
 *   - 镜号标签极小（1920x1080 上约 22px 高），整帧 OCR 直接漏掉；
 *     把它所在的左上角单独裁出来再放大 6 倍，5/6 帧能稳定读出 `SC001`。
 *   - 台词条只占画面底部，整帧放大受 OCR 最大边长限制（≈10000px）放不大；
 *     只裁底部 25% 就能放到 4 倍，字符准确率从「整帧 3 倍」的不可用提升到 ~90%。
 *
 * 需要 ffmpeg（面板本来就依赖它）。ffmpeg 缺失时 readShotRegion/readDialogueRegion
 * 返回 null，调用方退回整帧 OCR。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { ocr } = require('./ocr');

/** 左上镜号区：宽 12% 高 6%。实测 12% 是甜点——乙片 的说明文字从 7% 起，
 *  再宽就会把说明卷进来把标签挤掉；而 甲片 的标签宽 14%，靠整帧那一路兜住。 */
const SHOT_VF = 'crop=iw*0.12:ih*0.06:0:0,scale=iw*6:ih*6:flags=lanczos';

/** 底部台词区：底 25%，灰度 + 提对比，bicubic 4 倍。
 *  实测平均字符准确率 90.6%（灰度）/ 84.2%（原来的白字抠色），且不假设字幕是白色。 */
const DIALOGUE_CROP = 'crop=iw:ih*0.25:0:ih*0.75,scale=iw*4:ih*4:flags=bicubic';
const DIALOGUE_GRAY = 'format=gray,eq=contrast=1.5,';
const DIALOGUE_KEY = (hex) =>
  'colorkey=0x' + String(hex).replace('#', '') + ':similarity=0.5:blend=0.1,alphaextract,';

let _ffmpeg = null;

/** ffmpeg 是否可用（结果缓存，一次进程只探一次） */
function ffmpegAvailable() {
  if (_ffmpeg !== null) return _ffmpeg;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
    _ffmpeg = true;
  } catch (_) {
    _ffmpeg = false;
  }
  return _ffmpeg;
}

let _seq = 0;

/** 用 ffmpeg 生成一张区域图到临时目录（不放回到抓帧目录，避免被监听器当成新帧）。 */
function renderRegion(imagePath, vf) {
  const out = path.join(os.tmpdir(), `psreg_${process.pid}_${Date.now()}_${_seq++}.png`);
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', imagePath, '-vf', vf, out],
      { stdio: 'ignore', windowsHide: true, timeout: 60000 });
    return out;
  } catch (e) {
    try { fs.unlinkSync(out); } catch (_) { /* ignore */ }
    return null;
  }
}

/**
 * 读左上镜号区。
 * @param {string} imagePath
 * @returns {null|{file:string,width:number,height:number,lines:Array}} 与 ocr() 同构
 */
function readShotRegion(imagePath) {
  if (!ffmpegAvailable()) return null;
  const tmp = renderRegion(imagePath, SHOT_VF);
  if (!tmp) return null;
  try {
    const r = ocr(tmp, { scale: 1 });
    // region：这块裁切在整帧里的位置（比例），供 extractShot 还原成帧坐标
    return { ...r, region: { x: 0, y: 0, w: 0.12, h: 0.06 } };
  } catch (_) {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}

/**
 * 读底部台词区。
 * @param {string} imagePath
 * @param {{color?:string, contrast?:number}} [opts]
 *   color：字幕字色（#RRGGBB）。不给就用灰度（实测更稳，且不假设字是白的）；
 *          给了才用「抠该颜色 + alphaextract」把字反相成白底黑字。
 * @returns {null|{file:string,width:number,height:number,lines:Array}}
 */
function readDialogueRegion(imagePath, opts = {}) {
  if (!ffmpegAvailable()) return null;
  const head = opts.color ? DIALOGUE_KEY(opts.color) : DIALOGUE_GRAY;
  const tmp = renderRegion(imagePath, head + DIALOGUE_CROP);
  if (!tmp) return null;
  try {
    const r = ocr(tmp, { scale: 1 });
    return { ...r, region: { x: 0, y: 0.75, w: 1, h: 0.25 } };
  } catch (_) {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}

module.exports = {
  readShotRegion,
  readDialogueRegion,
  ffmpegAvailable,
  SHOT_VF,
  DIALOGUE_CROP,
};

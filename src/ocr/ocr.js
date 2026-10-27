'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PS1 = path.join(__dirname, 'win_ocr.ps1');

/**
 * 一行 OCR 结果
 * @typedef {{ text: string, x: number, y: number, w: number, h: number }} OcrLine
 * @typedef {{ file: string, width: number, height: number, lines: OcrLine[] }} OcrResult
 */

/**
 * Windows 自带 OCR 引擎（Windows.Media.Ocr）。本地、离线、免费。
 * @param {string} imagePath
 * @param {{ lang?: string, scale?: number }} [opts] scale：OCR 前放大倍数（默认 3，显著减少偏旁拆分错误）
 * @returns {OcrResult}
 */
function winOcr(imagePath, opts = {}) {
  const lang = opts.lang || 'zh-Hans-CN';
  const scale = opts.scale != null ? opts.scale : 3;
  const abs = path.resolve(imagePath);
  if (!fs.existsSync(abs)) throw new Error(`图片不存在: ${abs}`);

  const tmp = path.join(os.tmpdir(), `psocr_${process.pid}_${Date.now()}.json`);
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1,
        '-Path', abs, '-Out', tmp, '-Lang', lang, '-Scale', String(scale)],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, timeout: 60000 }
    );
    const raw = fs.readFileSync(tmp, 'utf8').replace(/^﻿/, '');
    const data = JSON.parse(raw);
    if (data.error) {
      // 换机器时最常见的两种失败，直接说人话，别把 WinRT 的英文原文甩给用户
      if (/no OCR engine/i.test(data.error)) {
        throw new Error(
          `Windows OCR 没有可用的「${lang}」引擎。请到 设置 › 时间和语言 › 语言和区域，` +
          `安装「中文(简体)」并在其语言选项里勾选「光学字符识别」，然后重启面板。` +
          `（原始信息：${data.error}）`);
      }
      throw new Error(`OCR 失败: ${data.error}`);
    }
    return data;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}

/**
 * 云端引擎占位——将来接百度/腾讯等，签名保持与 winOcr 一致，返回同样的 OcrResult。
 */
function cloudOcr(/* imagePath, opts */) {
  throw new Error('云端 OCR 尚未实现（架构已预留，M1 只用本地引擎）');
}

const ENGINES = { win: winOcr, cloud: cloudOcr };

/**
 * 统一入口，按 engine 名切换。
 * @param {string} imagePath
 * @param {{ engine?: 'win'|'cloud', lang?: string }} [opts]
 * @returns {OcrResult}
 */
function ocr(imagePath, opts = {}) {
  const engine = ENGINES[opts.engine || 'win'];
  if (!engine) throw new Error(`未知 OCR 引擎: ${opts.engine}`);
  return engine(imagePath, opts);
}

module.exports = { ocr, winOcr, cloudOcr };

# PR 面板安装（Premiere Pro 2023+ / CEP 11）

面板 `cep/com.ezplayscript.panel/` 已自包含（内置 `src/` 管线 + `node_modules/`），**无需依赖外部项目**。

> ⚠ 面板里的 `src/` 是根 `src/` 的**生成物**（安装到 `CEP/extensions/` 后够不到项目根，所以必须自带一份）。
> **不要手改** `cep/com.ezplayscript.panel/src/` —— 改根 `src/`，然后：
> ```bash
> npm run sync          # 根 src/ → 面板 src/
> npm run sync:check    # 只检查有没有漂移（不一致则 exit 1）
> ```
> `npm test` 里也有一条测试盯着这件事。
>
> **换机器 / 换 PR 版本之前先看 [COMPATIBILITY.md](./COMPATIBILITY.md)**：支持 Windows 10/11 + PR 2022 及以上，
> 换机必须准备中文 OCR 语言包、ffmpeg、PlayerDebugMode，且分发要用真拷贝（`mklink /J` 只适合开发机）。

## 安装

### 0) 如果是从 GitHub clone 的
`node_modules` 不入库，克隆下来**必须先装依赖**，否则面板缺 `docx` 会在加载时崩：

```powershell
npm run setup     # 等价于在根和 cep/com.ezplayscript.panel 下各跑一次 npm ci
```

装完 `cep/com.ezplayscript.panel/node_modules` 应该约 9 MB。
（`docx` 是懒加载的：没装也能开面板、能导 txt，只有导出 docx 时才提示装依赖。）

### 1) 开启未签名扩展调试
`regedit` 新建字符串值（CSXS 9/10/11 都设）：
```
HKEY_CURRENT_USER\Software\Adobe\CSXS.11  →  PlayerDebugMode (字符串) = 1
HKEY_CURRENT_USER\Software\Adobe\CSXS.10  →  PlayerDebugMode (字符串) = 1
HKEY_CURRENT_USER\Software\Adobe\CSXS.9   →  PlayerDebugMode (字符串) = 1
```
或存为 `debug.reg` 双击导入：
```reg
Windows Registry Editor Version 5.00
[HKEY_CURRENT_USER\Software\Adobe\CSXS.11]
"PlayerDebugMode"="1"
[HKEY_CURRENT_USER\Software\Adobe\CSXS.10]
"PlayerDebugMode"="1"
[HKEY_CURRENT_USER\Software\Adobe\CSXS.9]
"PlayerDebugMode"="1"
```

### 2) 安装面板
将 `cep/com.ezplayscript.panel/` 整个文件夹复制到：
```
C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\
```
（开发时可用 `mklink /J` 目录联接，改代码即时生效）

### 3) 确认系统依赖
- **ffmpeg**：需自行安装并加入系统 PATH（https://ffmpeg.org/download.html）
  - **v1.2 起 CLI 和面板都需要它**：镜号/台词是「先裁区域再放大」识别的，裁切交给 ffmpeg。
  - 没有 ffmpeg 时 `readShotRegion/readDialogueRegion` 返回 null，会**退回整帧 OCR**——
    能跑，但镜号和小字准确率会明显下降（实测镜号命中 5/6 → 2/6）。
- **Windows OCR**：Win10+ 默认含 `zh-Hans-CN`；若提示 OCR 失败，检查「设置 › 语言 › 中文(简体)」语言包是否安装

## 使用
1. 重启 PR → 窗口 › 扩展 › **ezPlayScript**
2. 播放头拖到目标帧 → Ctrl+Shift+E 导出帧 → 保存到**桌面 `.ezCapture` 文件夹**
3. 面板自动检测 → OCR → 追加一行
4. 表格可编辑镜号/角色/台词；下方实时预览
5. 导出 txt / docx（默认输出到桌面）

## 依赖
- Premiere Pro 2023+（CEP 11，含 Node）
- Windows 10+（自带中文 OCR + PowerShell）
- ffmpeg（需安装并加入 PATH）

## 调试
面板出错时浏览器打开 http://localhost:8088（端口见 `.debug`）可用 Chrome DevTools 调试 JS。

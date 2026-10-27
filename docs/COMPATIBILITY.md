# 运行环境与兼容性

> 结论：**只支持 Windows 10/11 + Premiere Pro 2022 (22.0) 及以上**。换成别的机器能跑，但下面 5 项硬依赖缺一不可。

## 一、硬性依赖

| 依赖 | 要求 | 缺失后果 | 本机实测 |
|---|---|---|---|
| 操作系统 | **Windows 10 1809+ / 11** | macOS / Linux 完全不可用（见第二节） | Windows（`%USERPROFILE%` = C:\Users\Shi） |
| 中文 OCR 语言包 | `Windows.Media.Ocr` 的 `zh-Hans-CN` | 所有帧 OCR 失败；面板启动时会在状态栏告警 | 已装：`en-US` + `zh-Hans-CN` |
| ffmpeg | 在系统 PATH 里 | **静默降级**成整帧 OCR：镜号命中 5/6 → 2/6，小字准确率明显下降 | 2026-06-29 gyan build |
| Premiere Pro | `22.0` 及以上（manifest `<Host Version="[22.0,99.9]">`） | 菜单里看不到面板 | 2023 (23.5) 与 2026 (26.0) 都装在本机 |
| 未签名扩展开关 | `PlayerDebugMode=1`（CSXS.9 / 10 / 11 / 12），或改用签名的 `.zxp` | 面板不出现 | 四档注册表键都已设 |

## 二、为什么只能是 Windows

- OCR 走 Windows 自带的 `Windows.Media.Ocr`（WinRT），由 `powershell.exe`（Windows PowerShell 5.1）调起。
  macOS 上的 `pwsh` 没有 WinRT 投影，`Windows.Media.Ocr` 整套 API 不存在。
- 裁切/放大走 ffmpeg 滤镜链（`crop` / `scale` / `colorkey` / `alphaextract`）。
- 路径与编码按 Windows 习惯写（`%USERPROFILE%`、`powershell.exe`、GBK/UTF-8 混用场景）。

要在 Mac 上用，等于换 OCR 引擎（Tesseract/Vision）+ 重做取图链路，不是改配置能解决的。

## 三、Premiere Pro × CEP 对照

`CEPHtmlEngine.exe` 的版本号就是该 PR 支持的 CEP 版本。

| Premiere Pro | 版本号 | CEP | 能否用本面板 | 依据 |
|---|---|---|---|---|
| 2022 | 22.x | 11 | ✅ | manifest 下限 |
| 2023 | 23.x | 11 | ✅ | **本机实测 CEPHtmlEngine 11.5.3** |
| 2024 | 24.x | 12 | ✅（未实测） | manifest 上限 99.9 |
| 2025 | 25.x | 12 | ✅（未实测） | 同上 |
| 2026 | 26.x | 12 | ✅ | **本机实测 CEPHtmlEngine 12.0.1** |
| 2021 | 15.x | 10 | ❌ | manifest 下限 22.0；且 `docx@9` 的 UMD 里用了可选链 `?.`，CEP 10 的 Node 12 会语法报错 |
| 2020 及更早 | 14.x- | 9 | ❌ | 同上 |

同一台机器装多个 PR 版本时，扩展目录是共享的，`manifest` 的版本范围会同时覆盖——本机 2023 和 2026 装同一份面板没问题。

**扩展依赖的运行时**：`RequiredRuntime CSXS 9.0` 是下限，CEP 11/12 都满足；CEF 参数已带 `--enable-nodejs` 与 `--mixed-context`（CEP 11+ 里面板需要 Node 才能 `require`）。

## 四、换一台机器的安装清单

1. **ffmpeg**：装好并加入 PATH，`ffmpeg -version` 能出东西
2. **中文 OCR**：设置 › 时间和语言 › 语言和区域 → 添加「中文(简体)」，并在其语言选项里勾选**光学字符识别**
3. **PlayerDebugMode**：导入 `debug.reg`（见 [INSTALL_PANEL.md](./INSTALL_PANEL.md)），CSXS.9~12 都设 1
4. **拷贝**：把整个 `com.ezplayscript.panel`（约 9.1 MB，其中 node_modules 9.08 MB）复制到
   `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`
   - 开发机才用 `mklink /J` 目录联接；**分发一律真拷贝**（联接指向本机路径，换机即失效）
5. **重启 PR** → 窗口 › 扩展 › ezPlayScript
6. **看状态栏**：正常显示 `ezPlayScript v1.2 · 抓帧目录 …\.ezCapture`。
   出现 `⚠ ffmpeg 未找到` 或 `⚠ 中文OCR不可用` 就按提示补依赖

## 五、已知坑（都已在代码里处理）

| 坑 | 处理 |
|---|---|
| 桌面被 OneDrive 重定向（`%USERPROFILE%\OneDrive\桌面`），面板监听的目录用户根本看不到 | `resolveDesktop()` 用 .NET `[Environment]::GetFolderPath('Desktop')` 取真实桌面（会跟随重定向），再按 `Desktop`/`OneDrive\Desktop`/`OneDrive\桌面` 回退 |
| 想换抓帧目录 | 环境变量 `EZPS_CAPTURE_DIR` 直接覆盖 |
| Windows OCR 输入长边上限 | 实测 `MaxImageDimension = 10000`。所以台词裁切只能 4x（1920×4=7680），**6x 会 11520px 直接失败** |
| 放大倍数越大越好？ | 不是。实测同一帧 `-Scale` 1/2/3 分别得到 7 / **0** / 6 行，2x 直接读不出东西。现有 3（整帧兜底）/4（台词）/6（镜号）是实测调出来的，别随手改 |
| OCR 语言包缺失时报英文原文 | 已改成中文提示，直接告诉要去哪装 |
| 面板表格与预览不一致 | `repairRoles` 在渲染表格前跑，两者是同一份数据 |

## 六、本机实测记录（2026-10-27）

```
Premiere Pro 2023   23.5    CEPHtmlEngine 11.5.3
Premiere Pro 2026   26.0    CEPHtmlEngine 12.0.1
CSXS.9/10/11/12     PlayerDebugMode = 1
Windows OCR         en-US, zh-Hans-CN；zh-Hans 引擎可用；MaxImageDimension 10000
ffmpeg              2026-06-29 git-de6bcf5c05-full_build-www.gyan.dev
Desktop             未重定向（C:\Users\Shi\Desktop）
扩展安装方式        Junction → E:\Agent\Project\playscript\cep\com.ezplayscript.panel
```

## 七、没有验证到的部分

- **没有在 PR 里真正点开面板逐帧跑过**（本机是目录联接安装，可以人工验）。上面的结论来自：
  解析 manifest、实测两个 PR 版本的 `CEPHtmlEngine` 版本号、逐项探针（OCR 语言包 / 引擎上限 / ffmpeg / 桌面路径），
  以及用 Node 模拟 CEP 环境把 `main.js` 完整跑一遍（`npm run smoke`）。
- **PR 2024 / 2025 没在本机实测**（只装了 2023 和 2026），但它们都在 manifest 的版本范围内，CEP 12 与 2026 一致。
- 多语言系统（例如日语/繁体 Windows）下的行为没测；OCR 只认 `zh-Hans-CN`，其余语言界面不影响。

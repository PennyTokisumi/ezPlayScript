# ezPlayScript

从**烧录了字幕的分镜成片**里提取台本的 Premiere Pro 面板 + 命令行工具。
抓一帧 → OCR → 直接得到 `镜号  角色  台词`。

```
001  小北    今天的拍摄计划排到几点？
002  阿澄    下午三点，先把这组镜头走完……
004  小北    那中午前把《夜航》的分镜发我。
```

分镜师用别的软件加字幕，拿不到源工程；镜号又被重新排过 —— 只能从画面像素里把
「左上镜号 / 底部说话人+台词」读出来。所以最终形态是 PR 面板：时间线上逐帧定位、
`Ctrl+Shift+E` 导出帧，面板自动识别并追加一行。

## 精度

五帧真实分镜实测：镜号 **5/5**、角色 **5/5**、内容字（中/英/数字）**100%**、
含标点 96.2%（差异全是标点口径），约 950ms/帧。

## 环境

- **Windows 10/11** —— 不支持 macOS（用的是系统自带 WinRT OCR）
- **Premiere Pro 2022 及以上**
- 中文 OCR 语言包、ffmpeg 在 PATH 里、`PlayerDebugMode=1`

完整矩阵与换机清单：[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)

## 安装

```powershell
npm run setup     # 根 + cep/com.ezplayscript.panel 各装一次依赖

# 允许未签名扩展：导入 debug.reg（内容见 docs/INSTALL_PANEL.md）
# 拷贝整个面板目录（约 9 MB，含 node_modules；分发要真拷贝，mklink /J 只适合开发机）
Copy-Item -Recurse cep\com.ezplayscript.panel `
  "C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\"
```

重启 PR → 窗口 › 扩展 › **ezPlayScript**。

## 用法

**面板**：播放头拖到目标帧 → `Ctrl+Shift+E` 导出帧 → 存到桌面 `.ezCapture` →
面板自动识别、追加一行（源图用完即删）。表格可直接改，下方实时预览，导出 txt / docx。

**命令行**（批量跑帧目录）：

```bash
node src/cli.js <帧目录|单图> -o 台本.txt [--merge-shot] [--sep "  "] [--color #RRGGBB]
```

输出 `镜号  角色  台词`（两空格分隔，CRLF）；`-o *.docx` 出三列表格。

## 开发

```bash
npm test            # 80 项：解析 / 合并 / 输出 / CLI / 面板与源一致 / 真实帧回归
npm run sync        # 根 src/ → 面板 src/（面板里那份是生成物，勿手改）
npm run sync:check  # 只检查漂移
npm run smoke       # 不开 PR 也能验面板：模拟 CEP 环境跑真 main.js 全流程
```

## 文档

| | |
|---|---|
| [docs/DESIGN.md](docs/DESIGN.md) | 设计存档：画面布局、解析规则、两段式取图 |
| [docs/INSTALL_PANEL.md](docs/INSTALL_PANEL.md) | 面板安装与调试 |
| [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | 环境要求、PR×CEP 版本对照、换机清单 |

## 已知限制

- 仅 Windows（WinRT OCR），需要中文 OCR 语言包
- 句末的 `……` 偶尔会整个丢失（OCR 没输出，代码侧救不回来）
- 顿号 `、` 会收敛成逗号 `，`（按「正文只用 ，。？！…《》」的口径）
- 台本必定有人工校对环节：低置信的行会标 ⚠，宁可告警也不静默丢字

## 许可

暂未声明许可证。测试用真实分镜帧不入库（版权原因）。

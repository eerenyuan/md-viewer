# MD Viewer

轻量级 Markdown + Excalidraw 只读查看器。双击任意文件即可打开，无需 vault / 仓库配置。

## 功能

- **GitHub 标准渲染**：markdown-it + github-markdown-css，表格、任务列表、删除线等 GFM 语法与 GitHub 视觉一致
- **Mermaid 图表**：` ```mermaid ` 代码块自动渲染（懒加载 + 缓存），渲染视图与 live preview 一致
- **KaTeX 数学公式**：`$...$` 行内与 `$$...$$` 块级
- **TOC 侧栏 + 标题锚点**：中文标题生成 GitHub 风格锚点；右侧目录面板显示当前章节高亮（宽屏默认开启，可记忆开关）
- **导出 PDF**：`Ctrl+P` 或工具栏 🖨 按钮，A4 分页排版，自动隐藏界面元素、白底输出
- **Live Preview 编辑（CodeMirror 6 自研）**：`Ctrl+E` 或工具栏进入编辑——非活动块渲染成 HTML，光标所在块露出 markdown 源码（Obsidian 同款体验）；`Ctrl+S` 写回文件，未保存退出需二次确认
- **代码高亮**：highlight.js（github / github-dark 双主题，跟随系统深浅色）
- **Excalidraw 查看/编辑**：支持 `.excalidraw`、`.excalidraw.json`、Obsidian 的 `.excalidraw.md`（明文与 LZ-string 压缩格式均可解析）；点击「✏️ 编辑」可修改并写回原文件（压缩格式保持 Obsidian 兼容）
- **Excalidraw 嵌入 Markdown**：md 中的 `![[xxx.excalidraw]]`（Obsidian wiki 语法，支持无扩展名与 `|宽度` 参数）和 `![](xxx.excalidraw)`（标准图片语法）都会内联渲染为 SVG
- **主题切换**：右上角按钮三态循环（跟随系统 / 亮 / 暗），全局生效并记忆偏好
- **文件监听**：文件被外部程序（编辑器 / AI）修改后自动刷新
- **单实例多文件**：已开窗口时双击新文件，在原窗口打开并置前
- **本地图片**：md 内相对路径图片通过 `local-file://` 安全协议加载（contextIsolation + sandbox 开启）
- **拖拽打开**：把文件拖进窗口即可查看

## 开发

```bash
npm install          # 安装依赖（Electron 二进制走 npmmirror 镜像）
npm start            # 构建 + 启动
npm run typecheck    # 类型检查
npm run dist         # 打包 Windows 安装包（release/ 目录）
```

## 安装与设为默认打开方式

1. 运行 `release/MD Viewer Setup x.x.x.exe`（一键安装到用户目录，无需管理员权限）
2. 任一 `.md` 文件上右键 → **打开方式** → **选择其他应用** → 选 **MD Viewer** → 勾选 **始终**
3. `.excalidraw` 同理（已注册为独立文件类型 "Excalidraw Scene"）

多 tab：双击新文件在现有窗口开新标签；`Ctrl+Tab` 切换（+Shift 反向）、`Ctrl+W` 或中键关闭当前标签。

调试端口截图 / DOM 断言脚本见 `scripts/screenshot.mjs`、`scripts/verify.mjs`。

## Roadmap

- [ ] 最近文件 Ctrl+P 快速打开 / 查看模式页内搜索
- [ ] Ctrl+滚轮缩放字号 / 窗口置顶
- [ ] md 相对链接与 `[[wiki]]` 链接跳转
- [ ] 多标签页

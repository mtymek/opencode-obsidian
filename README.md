# OpenCode Obsidian 插件

[English](#english) | **中文**

---

在 Obsidian 中嵌入 [OpenCode](https://opencode.ai) AI 助手，让你的笔记拥有 AI 能力：

<img src="./assets/opencode_in_obsidian.png" alt="OpenCode 嵌入 Obsidian" />

**使用场景：**
- 总结和提炼长文内容
- 起草、编辑和优化你的写作
- 查询和探索你的知识库
- 生成大纲和结构化笔记

本插件直接嵌入 OpenCode 的 Web 视图。通常类似插件会使用 ACP 协议，但本项目的目标是——无需自行实现（和维护）自定义聊天 UI，直接在 Obsidian 中获得 OpenCode 的完整功能。

_注意：插件作者与 OpenCode 或 Obsidian 无隶属关系，这是第三方软件。_

---

## ✨ 增强功能（本 Fork 新增）

在原项目基础上新增了以下功能：

### 🔄 多会话标签页

- 支持同时打开多个 AI 会话，通过标签栏快速切换
- 每个会话独立 iframe，切换时完整保留模型选择、滚动位置、输入内容等所有状态
- 右键标签可关闭会话，支持配置最大会话数

### 💾 会话持久化

- 会话信息（ID、URL、活动标签）自动保存
- Obsidian 重启后自动恢复所有会话
- 如果保存的会话已失效，自动创建新会话

### 🌐 中英文设置界面

- 设置页面支持中文/英文切换
- 语言选择器位于设置页顶部，切换即时生效
- 可通过 `src/settings/i18n.ts` 轻松扩展更多语言

### 📡 实时会话状态指示

- AI 处理请求时，左侧 Ribbon 图标自动变色并闪烁
- 标签栏实时显示每个会话的状态：空闲 / 处理中（脉冲动画）/ 重试中（红色警告）
- 每 5 秒轮询 OpenCode API 获取最新状态

---

## 环境要求

- 仅支持桌面端（使用 Node.js 子进程）
- 已安装 [OpenCode CLI](https://opencode.ai)
- 已安装 [Bun](https://bun.sh)

## 安装

### 普通用户（BRAT 安装 — 推荐）

通过 [BRAT](https://github.com/TfTHacker/obsidian42-brat)（Beta Reviewer's Auto-update Tool）安装最便捷：

1. 在 Obsidian 社区插件中安装 BRAT 插件
2. 打开 BRAT 设置，点击 "Add Beta plugin"
3. 输入：`nthforsth/opencode-obsidian`
4. 点击 "Add Plugin" — BRAT 会自动安装最新版本
5. 在 Obsidian 设置 > 社区插件中启用 OpenCode 插件

BRAT 会自动检查更新，有新版本时通知你。

### 开发者

如果你想参与开发：

1. 克隆到你的 vault 根目录下的 `.obsidian/plugins/obsidian-opencode`：
   ```bash
   git clone https://github.com/nthforsth/opencode-obsidian.git .obsidian/plugins/obsidian-opencode
   ```
2. 安装依赖并构建：
   ```bash
   bun install && bun run build
   ```
3. 在 Obsidian 设置 > 社区插件中启用
4. 在工作区根目录添加 `AGENTS.md` 来引导 AI 助手

## 使用

- 点击左侧 Ribbon 栏的终端图标
- 或使用快捷键 `Cmd/Ctrl+Shift+O` 切换面板
- 打开面板后服务自动启动

## 设置

<img src="./assets/plugin_settings.png" alt="插件设置" />

### 自定义命令模式

当你需要更多控制（如添加额外 CLI 参数、使用自定义脚本、或通过容器运行 OpenCode）时，启用 "Use custom command"。

使用自定义命令时：

- **主机名和端口必须匹配**上方的 Port 和 Hostname 设置
- **必须包含 `--cors app://obsidian.md`** 以允许 Obsidian 嵌入 OpenCode 界面

示例：
```bash
opencode serve --port 14096 --hostname 127.0.0.1 --cors app://obsidian.md
```

其他设置（端口、主机名、自动启动、视图位置、上下文注入）均可在设置界面中直接配置。

### 上下文注入（实验性）

本插件可自动向运行中的 OpenCode 实例注入上下文：已打开笔记的列表和当前选中的文本。

目前该功能仍在开发中，存在一些限制——从 OpenCode 界面创建新会话时不会生效。

## Windows 故障排除

如果已安装 opencode 但提示 "Executable not found at 'opencode'"：

1. 找到 opencode.cmd 路径：
   ```
   where opencode.cmd
   ```

2. 在插件设置中配置完整路径：
   ```
   C:\Users\{username}\AppData\Roaming\npm\opencode.cmd
   ```

这是因为 Electron/Obsidian 在 Windows 上不会完全继承 PATH。

---

<a id="english"></a>

# OpenCode Plugin for Obsidian

**English** | [中文](#opencode-obsidian-插件)

---

Give your notes AI capability by embedding [OpenCode](https://opencode.ai) AI assistant directly in Obsidian:

<img src="./assets/opencode_in_obsidian.png" alt="OpenCode embedded in Obsidian" />

**Use cases:**
- Summarize and distill long-form content
- Draft, edit, and refine your writing
- Query and explore your knowledge base
- Generate outlines and structured notes

This plugin uses OpenCode's web view that can be embedded directly into the Obsidian window. Usually similar plugins would use the ACP protocol, but the goal of this project is to get the full power of OpenCode in Obsidian without having to implement (and maintain) a custom chat UI.

_Note: plugin author is not affiliated with OpenCode or Obsidian — this is 3rd party software._

---

## ✨ Enhanced Features (This Fork)

Built on top of the original project with the following additions:

### 🔄 Multi-Session Tabs

- Open multiple AI sessions simultaneously with a tab bar for quick switching
- Each session has its own iframe — model selection, scroll position, input content, and all JS state are preserved across tab switches
- Right-click a tab to close it; configurable max session limit

### 💾 Session Persistence

- Session info (ID, URL, active tab) is automatically saved
- All sessions are restored when Obsidian restarts
- Graceful fallback: creates a new session if saved data is stale

### 🌐 Chinese/English Settings UI

- Settings page supports Chinese/English toggle
- Language selector at the top of settings; changes apply instantly
- Easy to extend with more languages via `src/settings/i18n.ts`

### 📡 Real-Time Session Status Indicator

- Ribbon icon automatically changes color and pulses when AI is processing
- Tab bar shows per-session status in real time: idle / busy (pulse animation) / retry (red alert)
- Polls OpenCode API every 5 seconds for latest status

---

## Requirements

- Desktop only (uses Node.js child processes)
- [OpenCode CLI](https://opencode.ai) installed
- [Bun](https://bun.sh) installed

## Installation

### For Users (BRAT — Recommended)

The easiest way to install is via [BRAT](https://github.com/TfTHacker/obsidian42-brat) (Beta Reviewer's Auto-update Tool):

1. Install the BRAT plugin from Obsidian Community Plugins
2. Open BRAT settings and click "Add Beta plugin"
3. Enter: `nthforsth/opencode-obsidian`
4. Click "Add Plugin" — BRAT will install the latest release automatically
5. Enable the OpenCode plugin in Obsidian Settings > Community Plugins

BRAT will automatically check for updates and notify you when new versions are available.

### For Developers

If you want to contribute or develop:

1. Clone to `.obsidian/plugins/obsidian-opencode` under your vault root:
   ```bash
   git clone https://github.com/nthforsth/opencode-obsidian.git .obsidian/plugins/obsidian-opencode
   ```
2. Install dependencies and build:
   ```bash
   bun install && bun run build
   ```
3. Enable in Obsidian Settings > Community Plugins
4. Add `AGENTS.md` to your workspace root to guide the AI assistant

## Usage

- Click the terminal icon in the left ribbon, or
- Press `Cmd/Ctrl+Shift+O` to toggle the panel
- Server starts automatically when you open the panel

## Settings

<img src="./assets/plugin_settings.png" alt="Plugin Settings" />

### Custom Command Mode

Enable "Use custom command" when you need more control over how OpenCode starts — for example, to add extra CLI flags, use a custom wrapper script, or run OpenCode through a container.

When using custom command:

- **Hostname and port must match** the values set in the Port and Hostname fields above
- **You must include `--cors app://obsidian.md`** to allow Obsidian to embed the OpenCode interface

Example:
```bash
opencode serve --port 14096 --hostname 127.0.0.1 --cors app://obsidian.md
```

Other settings (port, hostname, auto-start, view location, context injection) are available through the settings UI.

### Context Injection (Experimental)

This plugin can automatically inject context into the running OpenCode instance: list of open notes and currently selected text.

This is a work-in-progress feature with some limitations — it won't work when creating new sessions from the OpenCode interface.

## Windows Troubleshooting

If you see "Executable not found at 'opencode'" despite opencode being installed:

1. Find your opencode.cmd path:
   ```
   where opencode.cmd
   ```

2. Configure the full path in plugin settings:
   ```
   C:\Users\{username}\AppData\Roaming\npm\opencode.cmd
   ```

This is due to Electron/Obsidian not fully inheriting PATH on Windows.

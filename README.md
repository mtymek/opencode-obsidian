# OpenCode plugin for Obsidian

> ⚠️ **已知问题（重要）**
> 
> 在 Windows 上使用 WSL 时，**同时在 Obsidian 中启动 OpenCode 和在 WSL 中启动 OpenCode 会导致 OpenCode 数据库损坏**。
> 
> **请避免同时运行两个实例！** 如果需要在 WSL 中使用 OpenCode，请先关闭 Obsidian 中的 OpenCode 面板，反之亦然。
>
> 本插件已解决 WSL 上的 OpenCode 作为插件嵌入到 Windows 上的 Obsidian 中无法正常使用的问题，但上述并发问题仍需注意。

---

Give your notes AI capability by embedding Opencode [OpenCode](https://opencode.ai) AI assistant directly in Obsidian:

<img src="./assets/opencode_in_obsidian.png" alt="OpenCode embeded in Obsidian" />

**Use cases:**
- Summarize and distill long-form content
- Draft, edit, and refine your writing
- Query and explore your knowledge base
- Generate outlines and structured notes

This plugin uses OpenCode's web view that can be embedded directly into Obsidian window. Usually similar plugins would use the ACP protocol, but I want to see how how much is possible without having to implement (and manage) a custom chat UI - I want the full power of OpenCode in my Obsidian.

_Note: plugin author is not afiliated with OpenCode or Obsidian - this is a 3rd party software._

## Requirements

- Desktop only (uses Node.js child processes)
- [OpenCode CLI](https://opencode.ai) installed 
- [Bun](https://bun.sh) installed

## Installation

### For Users (BRAT - Recommended for Beta Testing)

The easiest way to install this plugin during beta is via [BRAT](https://github.com/TfTHacker/obsidian42-brat) (Beta Reviewer's Auto-update Tool):

1. Install the BRAT plugin from Obsidian Community Plugins
2. Open BRAT settings and click "Add Beta plugin"
3. Enter: `mtymek/opencode-obsidian`
4. Click "Add Plugin" - BRAT will install the latest release automatically
5. Enable the OpenCode plugin in Obsidian Settings > Community Plugins

BRAT will automatically check for updates and notify you when new versions are available.

### For Developers

If you want to contribute or develop the plugin:

1. Clone to `.obsidian/plugins/obsidian-opencode` subdirectory under your vault's root:
   ```bash
   git clone https://github.com/mtymek/opencode-obsidian.git .obsidian/plugins/obsidian-opencode
   ```
2. Install dependencies and build:
   ```bash
   bun install && bun run build
   ```
3. Enable in Obsidian Settings > Community Plugins
4. Add AGENTS.md to your workspace root to guide the AI assistant

## Usage

- Click the terminal icon in the ribbon, or
- `Cmd/Ctrl+Shift+O` to toggle the panel
- Server starts automatically when you open the panel


## Settings

### Custom Command Mode

Enable "Use custom command" when you need more control over how OpenCode starts—for example, to add extra CLI flags, use a custom wrapper script, or run OpenCode through a container or virtual environment.

When using custom command:

- **Hostname and port must match** the values set in the Port and Hostname fields above
- You **must include `--cors app://obsidian.md`** to allow Obsidian to embed the OpenCode interface

Example:
```bash
opencode serve --port 14096 --hostname 127.0.0.1 --cors app://obsidian.md
```

Other settings (port, hostname, auto-start, view location, context injection) are available through the settings UI and are self-explanatory.

### Context injection (experimental)

This plugin can automatically inject context to the running OC instance: list of open notes and currently selected text.

Currently, this is work-in-progress feature with some limitations - it won't work when creating new session from OC interface.

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


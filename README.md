# OpenCode plugin for Obsidian


Give your notes AI capability by embedding Opencode [OpenCode](https://opencode.ai) AI assistant directly in Obsidian:

<img src="./assets/opencode_in_obsidian.png" alt="OpenCode embeded in Obsidian" />

**Use cases:**
- Summarize and distill long-form content
- Draft, edit, and refine your writing
- Query and explore your knowledge base
- Generate outlines and structured notes

_Note: plugin author is not afiliated with OpenCode or Obsidian - this is a 3rd party software._

## Requirements

- Desktop only (uses Node.js child processes)
- [OpenCode CLI](https://opencode.ai) installed 
- [Bun](https://bun.sh) installed

## Development

1. Clone to `.obsidian/plugins/obsidian-opencode` subdirectory under your vault's root
2. Run `bun install && bun run build`
3. Enable in Obsidian Settings > Community plugins
4. Add AGENTS.md to the workspace root, use it to explain the structure

## Usage

- Click the terminal icon in the ribbon, or
- `Cmd/Ctrl+Shift+O` to toggle the panel
- Server starts automatically when you open the panel

### Commands

| Command | Description |
|---------|-------------|
| Toggle OpenCode panel | Show/hide sidebar |
| Start OpenCode server | Manual start |
| Stop OpenCode server | Manual stop |

## Settings

<img src="./assets/plugin_settings.png" alt="Available plugin settings" />


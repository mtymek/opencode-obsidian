export type Language = "en" | "zh";

const translations: Record<Language, Record<string, string>> = {
  en: {
    // Page titles
    "settings.title": "OpenCode Settings",
    "section.server": "Server Configuration",
    "section.behavior": "Behavior",
    "section.context": "Workspace Context",
    "section.sessions": "Sessions",
    "section.status": "Server Status",
    "section.language": "Language",

    // Server config
    "port.name": "Port",
    "port.desc": "Port number for the OpenCode web server",
    "hostname.name": "Hostname",
    "hostname.desc": "Hostname to bind the server to (usually 127.0.0.1)",
    "useCustomCommand.name": "Use custom command",
    "useCustomCommand.desc": "Enable to use a custom shell command instead of the executable path",
    "customCommand.name": "Custom command",
    "customCommand.desc": "Custom shell command to start OpenCode.",
    "execPath.name": "OpenCode executable path",
    "projectDir.name": "Project directory",
    "projectDir.desc": "Override the starting directory for OpenCode. Leave empty to use the vault root.",
    "learnMore": "Learn more",
    "autodetect": "Autodetect",

    // Behavior
    "autoStart.name": "Auto-start server",
    "autoStart.desc": "Automatically start the OpenCode server when Obsidian opens (not recommended for faster startup)",
    "viewLocation.name": "Default view location",
    "viewLocation.desc": "Where to open the OpenCode panel: sidebar opens in the right panel, main opens as a tab in the editor area",
    "viewLocation.sidebar": "Sidebar",
    "viewLocation.main": "Main window",

    // Context
    "injectContext.name": "Inject workspace context",
    "injectContext.desc": "Includes open note paths and selected text in OpenCode when the view is focused",
    "maxNotes.name": "Max notes in context",
    "maxNotes.desc": "Limit how many open notes are included",
    "maxSelection.name": "Max selection length",
    "maxSelection.desc": "Truncate selected text to avoid oversized context",

    // Sessions
    "maxSessions.name": "Maximum sessions",
    "maxSessions.desc": "Maximum number of simultaneous OpenCode sessions you can open",

    // Language
    "language.name": "Display language",
    "language.desc": "Language for the settings page",

    // Status
    "status.label": "Status: ",
    "status.stopped": "Stopped",
    "status.starting": "Starting...",
    "status.running": "Running",
    "status.error": "Error",
    "url.label": "URL: ",
    "btn.start": "Start Server",
    "btn.stop": "Stop Server",
    "btn.restart": "Restart Server",
    "status.waiting": "Please wait...",
  },
  zh: {
    // Page titles
    "settings.title": "OpenCode 设置",
    "section.server": "服务配置",
    "section.behavior": "行为",
    "section.context": "工作区上下文",
    "section.sessions": "会话管理",
    "section.status": "服务状态",
    "section.language": "语言",

    // Server config
    "port.name": "端口",
    "port.desc": "OpenCode Web 服务的端口号",
    "hostname.name": "主机名",
    "hostname.desc": "服务绑定的主机名（通常为 127.0.0.1）",
    "useCustomCommand.name": "使用自定义命令",
    "useCustomCommand.desc": "启用后将使用自定义 shell 命令启动，而非可执行文件路径",
    "customCommand.name": "自定义命令",
    "customCommand.desc": "用于启动 OpenCode 的自定义 shell 命令。",
    "execPath.name": "OpenCode 可执行文件路径",
    "projectDir.name": "项目目录",
    "projectDir.desc": "覆盖 OpenCode 的启动目录。留空则使用 Vault 根目录。",
    "learnMore": "了解更多",
    "autodetect": "自动检测",

    // Behavior
    "autoStart.name": "自动启动服务",
    "autoStart.desc": "Obsidian 启动时自动启动 OpenCode 服务（不推荐，会影响启动速度）",
    "viewLocation.name": "默认面板位置",
    "viewLocation.desc": "OpenCode 面板的打开位置：侧边栏在右侧面板打开，主窗口作为标签页在编辑区域打开",
    "viewLocation.sidebar": "侧边栏",
    "viewLocation.main": "主窗口",

    // Context
    "injectContext.name": "注入工作区上下文",
    "injectContext.desc": "当视图获得焦点时，自动将打开的笔记路径和选中文本注入 OpenCode",
    "maxNotes.name": "上下文中的最大笔记数",
    "maxNotes.desc": "限制包含的打开笔记数量",
    "maxSelection.name": "选中文本最大长度",
    "maxSelection.desc": "截断选中文本以避免上下文过大",

    // Sessions
    "maxSessions.name": "最大会话数",
    "maxSessions.desc": "可以同时打开的 OpenCode 会话数量上限",

    // Language
    "language.name": "显示语言",
    "language.desc": "设置页面的显示语言",

    // Status
    "status.label": "状态：",
    "status.stopped": "已停止",
    "status.starting": "启动中...",
    "status.running": "运行中",
    "status.error": "错误",
    "url.label": "地址：",
    "btn.start": "启动服务",
    "btn.stop": "停止服务",
    "btn.restart": "重启服务",
    "status.waiting": "请稍候...",
  },
};

export function t(key: string, lang: Language): string {
  return translations[lang]?.[key] ?? translations.en[key] ?? key;
}

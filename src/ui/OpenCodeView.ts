import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { OPENCODE_VIEW_TYPE } from "../types";
import { OPENCODE_ICON_NAME } from "../icons";
import { OpenCodeClient, SessionInfo } from "../client/OpenCodeClient";
import type OpenCodePlugin from "../main";
import type { ServerState } from "../server/types";

interface SessionTab {
  id: string;
  sessionId: string | null;
  iframeUrl: string | null;
  isBusy: boolean;
}

export class OpenCodeView extends ItemView {
  plugin: OpenCodePlugin;
  private iframePool = new Map<string, HTMLIFrameElement>();
  private iframeContainerEl: HTMLElement | null = null;
  private currentState: ServerState = "stopped";
  private unsubscribeStateChange: (() => void) | null = null;

  client: OpenCodeClient;

  private sessions: SessionTab[] = [];
  private activeIndex = 0;
  private nextId = 1;
  private tabBarEl: HTMLElement | null = null;
  private historyPanelEl: HTMLElement | null = null;
  private sessionStatuses: Record<string, { type: string }> = {};

  constructor(leaf: WorkspaceLeaf, plugin: OpenCodePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.client = new OpenCodeClient(
      plugin.getApiBaseUrl(),
      plugin.getServerUrl(),
      plugin.getProjectDirectory()
    );
  }

  getViewType(): string { return OPENCODE_VIEW_TYPE; }
  getDisplayText(): string { return "OpenCodian"; }
  getIcon(): string { return OPENCODE_ICON_NAME; }

  getActiveSessionId(): string | null {
    return this.sessions[this.activeIndex]?.sessionId ?? null;
  }
  getAllSessionTabs(): SessionTab[] { return this.sessions; }
  getActiveSessionIndex(): number { return this.activeIndex; }

  /** Called by main.ts to push real-time session status updates. */
  updateSessionStatuses(statuses: Record<string, { type: string }>): void {
    this.sessionStatuses = statuses;
    this.buildTabBar();
  }

  // ── Lifecycle ──

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("opencode-container");

    this.unsubscribeStateChange = this.plugin.onServerStateChange((s: ServerState) => {
      this.currentState = s;
      this.updateView();
    });

    this.currentState = this.plugin.getServerState();
    this.updateView();
    if (this.currentState === "stopped") this.plugin.startServer();
  }

  async onClose(): Promise<void> {
    this.unsubscribeStateChange?.();
    this.unsubscribeStateChange = null;
    this.iframePool.forEach((iframe) => iframe.remove());
    this.iframePool.clear();
    this.iframeContainerEl = null;
  }

  // ── State rendering ──

  private updateView(): void {
    switch (this.currentState) {
      case "stopped": this.renderStopped(); break;
      case "starting": this.renderStarting(); break;
      case "running": this.renderRunning(); break;
      case "error": this.renderError(); break;
    }
  }

  // ── Tab management ──

  switchToTab(index: number): void {
    if (index < 0 || index >= this.sessions.length || index === this.activeIndex) return;
    this.activeIndex = index;
    this.buildTabBar();
    this.switchIframe();
    this.persistTabs();
  }

  async addSession(): Promise<void> {
    if (this.sessions.length >= this.plugin.settings.maxSessions) return;
    const tab: SessionTab = { id: String(this.nextId++), sessionId: null, iframeUrl: null, isBusy: true };
    this.sessions.push(tab);
    this.activeIndex = this.sessions.length - 1;
    this.buildTabBar();

    try {
      const sid = await this.client.createSession();
      if (sid) {
        tab.sessionId = sid;
        tab.iframeUrl = this.client.getSessionUrl(sid);
      }
    } finally {
      tab.isBusy = false;
      this.buildTabBar();
    }
    if (tab.iframeUrl) {
      const iframe = this.createIframe(tab.iframeUrl);
      this.iframePool.set(tab.id, iframe);
      this.iframeContainerEl?.appendChild(iframe);
      this.switchIframe();
      this.persistTabs();
    }
  }

  closeTab(index: number): void {
    if (index < 0 || index >= this.sessions.length || this.sessions.length <= 1) return;
    if (this.sessions[index].isBusy) return;
    const removed = this.sessions[index];
    const iframe = this.iframePool.get(removed.id);
    iframe?.remove();
    this.iframePool.delete(removed.id);
    this.sessions.splice(index, 1);
    if (index <= this.activeIndex) this.activeIndex = Math.max(0, this.activeIndex - 1);
    this.buildTabBar();
    this.switchIframe();
    this.persistTabs();
  }

  private switchIframe(): void {
    const activeTab = this.sessions[this.activeIndex];
    this.iframePool.forEach((iframe, tabId) => {
      iframe.style.display = (activeTab && tabId === activeTab.id) ? "flex" : "none";
    });
  }

  private createIframe(url: string): HTMLIFrameElement {
    const iframe = document.createElement("iframe");
    iframe.className = "opencode-iframe";
    iframe.setAttribute("src", url);
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("allow", "clipboard-read; clipboard-write");
    iframe.addEventListener("error", () => console.error("[OpenCode] iframe error"));
    return iframe;
  }

  // ── Render helpers ──

  private renderStopped(): void {
    this.contentEl.empty();
    const c = this.contentEl.createDiv({ cls: "opencode-status-container" });
    setIcon(c.createDiv({ cls: "opencode-status-icon" }), "power-off");
    c.createEl("h3", { text: "OpenCode is stopped" });
    c.createEl("p", { text: "Start the server.", cls: "opencode-status-message" });
    const btn = c.createEl("button", { text: "Start OpenCode", cls: "mod-cta" });
    btn.addEventListener("click", () => this.plugin.startServer());
  }

  private renderStarting(): void {
    this.contentEl.empty();
    const c = this.contentEl.createDiv({ cls: "opencode-status-container" });
    const l = c.createDiv({ cls: "opencode-loading" });
    l.createDiv({ cls: "opencode-spinner" });
    c.createEl("h3", { text: "Starting OpenCode..." });
  }

  private renderRunning(): void {
    this.contentEl.empty();
    this.iframePool.clear();
    this.iframeContainerEl = null;
    this.buildTabBar();

    // Create iframe container
    this.iframeContainerEl = this.contentEl.createDiv({ cls: "opencode-iframe-container" });

    // Try to restore previously saved tabs, otherwise create a new one
    this.restoreTabs();
  }

  private async ensureTab(): Promise<void> {
    if (this.sessions.length > 0) return;

    const tab: SessionTab = { id: String(this.nextId++), sessionId: null, iframeUrl: null, isBusy: true };
    this.sessions.push(tab);
    this.activeIndex = 0;
    this.buildTabBar();

    try {
      const sid = await this.client.createSession();
      if (sid) {
        tab.sessionId = sid;
        tab.iframeUrl = this.client.getSessionUrl(sid);
      }
    } finally {
      tab.isBusy = false;
      this.buildTabBar();
    }
    if (tab.iframeUrl) {
      const iframe = this.createIframe(tab.iframeUrl);
      this.iframePool.set(tab.id, iframe);
      this.iframeContainerEl?.appendChild(iframe);
      this.switchIframe();
      this.persistTabs();
    }
  }

  // ── Persistence ──

  private persistTabs(): void {
    void this.plugin.saveSessionTabs(this.sessions, this.activeIndex);
  }

  private async restoreTabs(): Promise<void> {
    const saved = await this.plugin.loadSessionTabs();
    if (!saved || saved.tabs.length === 0) {
      this.ensureTab();
      return;
    }

    // Restore tabs from saved session IDs
    for (const savedTab of saved.tabs) {
      const tab: SessionTab = {
        id: String(this.nextId++),
        sessionId: savedTab.sessionId,
        iframeUrl: savedTab.iframeUrl,
        isBusy: false,
      };
      this.sessions.push(tab);
      if (tab.iframeUrl) {
        const iframe = this.createIframe(tab.iframeUrl);
        this.iframePool.set(tab.id, iframe);
        this.iframeContainerEl?.appendChild(iframe);
      }
    }

    this.activeIndex = saved.activeIndex;
    this.buildTabBar();
    this.switchIframe();
  }

  private renderError(): void {
    this.contentEl.empty();
    const c = this.contentEl.createDiv({ cls: "opencode-status-container opencode-error" });
    setIcon(c.createDiv({ cls: "opencode-status-icon" }), "alert-circle");
    c.createEl("h3", { text: "Failed to start OpenCode" });
    const err = this.plugin.getLastError();
    c.createEl("p", { text: err ?? "Unknown error", cls: "opencode-status-message" });
    const bg = c.createDiv({ cls: "opencode-button-group" });
    const retry = bg.createEl("button", { text: "Retry", cls: "mod-cta" });
    retry.addEventListener("click", () => this.plugin.startServer());
  }

  // ── Tab bar ──

  private buildTabBar(): void {
    this.contentEl.querySelector(".opencode-tab-bar")?.remove();
    this.tabBarEl = null;

    const bar = document.createElement("div");
    bar.className = "opencode-tab-bar";
    this.contentEl.prepend(bar);
    this.tabBarEl = bar;

    if (this.sessions.length < this.plugin.settings.maxSessions) {
      const addBtn = document.createElement("button");
      addBtn.className = "opencode-tab opencode-tab-add";
      addBtn.setAttribute("aria-label", "New session");
      setIcon(addBtn, "plus");
      addBtn.addEventListener("click", () => void this.addSession());
      bar.appendChild(addBtn);
    }

    if (this.sessions.length > 1) {
      this.sessions.forEach((tab, idx) => {
        const el = document.createElement("button");
        el.className = "opencode-tab";
        if (idx === this.activeIndex) el.classList.add("opencode-tab-active");
        if (tab.isBusy) {
          el.classList.add("opencode-tab-busy");
        } else if (tab.sessionId && this.sessionStatuses[tab.sessionId]?.type === "busy") {
          el.classList.add("opencode-tab-busy");
        } else if (tab.sessionId && this.sessionStatuses[tab.sessionId]?.type === "retry") {
          el.classList.add("opencode-tab-attention");
        }
        el.setAttribute("aria-label", `Session ${idx + 1}`);

        const label = document.createElement("span");
        label.className = "opencode-tab-label";
        label.textContent = `${idx + 1}`;
        el.appendChild(label);

        el.addEventListener("click", () => this.switchToTab(idx));
        el.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          if (!tab.isBusy && this.sessions.length > 1) this.closeTab(idx);
        });
        bar.appendChild(el);
      });
    }

    // History button (always visible when server is running)
    const historyBtn = document.createElement("button");
    historyBtn.className = "opencode-history-btn";
    historyBtn.setAttribute("aria-label", "Session history");
    setIcon(historyBtn, "clock");
    historyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleHistoryPanel();
    });
    bar.appendChild(historyBtn);
  }

  // ── History panel ──

  private toggleHistoryPanel(): void {
    if (this.historyPanelEl) {
      this.hideHistoryPanel();
    } else {
      void this.showHistoryPanel();
    }
  }

  private hideHistoryPanel(): void {
    this.historyPanelEl?.remove();
    this.historyPanelEl = null;
  }

  private async showHistoryPanel(): Promise<void> {
    this.hideHistoryPanel();

    if (!this.tabBarEl) return;

    // Create panel container
    const panel = document.createElement("div");
    panel.className = "opencode-history-panel";

    // Header
    const header = panel.createDiv({ cls: "opencode-history-header" });
    header.createEl("span", { text: "历史会话" });
    const closeBtn = header.createEl("button", { cls: "opencode-history-close" });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", () => this.hideHistoryPanel());

    // Loading state
    const listEl = panel.createDiv({ cls: "opencode-history-list" });
    listEl.createDiv({ cls: "opencode-history-loading", text: "加载中..." });

    // Footer placeholder
    const footer = panel.createDiv({ cls: "opencode-history-footer" });

    // Append to contentEl (NOT tabBarEl — overflow-x: auto clips absolute children)
    // Position relative to the container so the panel sits just below the tab bar
    this.contentEl.appendChild(panel);
    this.historyPanelEl = panel;

    // Close on outside click
    const onOutsideClick = (e: MouseEvent) => {
      if (!panel.contains(e.target as Node)) {
        this.hideHistoryPanel();
        document.removeEventListener("click", onOutsideClick);
      }
    };
    setTimeout(() => document.addEventListener("click", onOutsideClick), 0);

    // Fetch sessions
    const sessions = await this.client.listSessions();
    if (!this.historyPanelEl) return; // Panel was closed during fetch

    listEl.empty();

    if (!sessions || sessions.length === 0) {
      listEl.createDiv({ cls: "opencode-history-empty", text: "暂无历史会话" });
      footer.createDiv({ cls: "opencode-history-count" });
      return;
    }

    // Sort by updated time (most recent first)
    sessions.sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0));

    // Get currently open session IDs
    const openIds = new Set(this.sessions.map((t) => t.sessionId).filter(Boolean));

    // Render items
    for (const session of sessions) {
      const item = listEl.createDiv({ cls: "opencode-history-item" });
      if (openIds.has(session.id)) {
        item.classList.add("opencode-history-item-active");
      }

      const title = item.createDiv({ cls: "opencode-history-item-title" });
      title.textContent = session.title || session.slug || "Untitled";

      const time = item.createDiv({ cls: "opencode-history-item-time" });
      time.textContent = this.formatRelativeTime(session.time?.updated ?? session.time?.created ?? 0);

      item.addEventListener("click", () => {
        this.hideHistoryPanel();
        void this.loadSession(session.id);
      });
    }

    // Footer: count + clean button
    const activeCount = sessions.filter((s) => openIds.has(s.id)).length;
    footer.createDiv({ cls: "opencode-history-count", text: `${sessions.length} 个会话` });

    const cleanableCount = sessions.filter((s) => !openIds.has(s.id)).length;
    if (cleanableCount > 0) {
      const cleanBtn = footer.createEl("button", { text: `清理 ${cleanableCount} 个旧会话` });
      cleanBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.cleanOldSessions(sessions, openIds);
      });
    }
  }

  /** Load an existing session into a new tab. */
  private async loadSession(sessionId: string): Promise<void> {
    if (this.sessions.length >= this.plugin.settings.maxSessions) {
      // Replace current tab instead
      this.closeTab(this.activeIndex);
    }

    const iframeUrl = this.client.getSessionUrl(sessionId);
    const tab: SessionTab = {
      id: String(this.nextId++),
      sessionId,
      iframeUrl,
      isBusy: false,
    };
    this.sessions.push(tab);
    this.activeIndex = this.sessions.length - 1;

    const iframe = this.createIframe(iframeUrl);
    this.iframePool.set(tab.id, iframe);
    this.iframeContainerEl?.appendChild(iframe);

    this.buildTabBar();
    this.switchIframe();
    this.persistTabs();
  }

  /** Delete old sessions that are not currently open. */
  private async cleanOldSessions(sessions: SessionInfo[], openIds: Set<string | null>): Promise<void> {
    const toDelete = sessions.filter((s) => !openIds.has(s.id));
    let deleted = 0;
    for (const session of toDelete) {
      const ok = await this.client.deleteSession(session.id);
      if (ok) deleted++;
    }
    console.log(`[OpenCode] Cleaned ${deleted}/${toDelete.length} old sessions`);
    this.hideHistoryPanel();
    // Re-open to show updated list
    void this.showHistoryPanel();
  }

  private formatRelativeTime(ts: number): string {
    if (!ts) return "";
    const now = Date.now();
    const diff = now - ts;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}天前`;
    const date = new Date(ts);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
}

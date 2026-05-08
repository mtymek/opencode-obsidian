import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { OPENCODE_VIEW_TYPE } from "../types";
import { OPENCODE_ICON_NAME } from "../icons";
import { OpenCodeClient } from "../client/OpenCodeClient";
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
        if (tab.isBusy) el.classList.add("opencode-tab-busy");
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
  }
}

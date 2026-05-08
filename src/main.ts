import { Plugin, WorkspaceLeaf, Notice, EventRef, MarkdownView } from "obsidian";
import { OpenCodeSettings, DEFAULT_SETTINGS, OPENCODE_VIEW_TYPE } from "./types";
import { OpenCodeView } from "./ui/OpenCodeView";
import { ViewManager } from "./ui/ViewManager";
import { OpenCodeSettingTab } from "./settings/SettingsTab";
import { ServerManager, ServerState } from "./server/ServerManager";
import { registerOpenCodeIcons, OPENCODE_ICON_NAME } from "./icons";
import { ContextManager } from "./context/ContextManager";
import { ExecutableResolver } from "./server/ExecutableResolver";

export default class OpenCodePlugin extends Plugin {
  settings: OpenCodeSettings = DEFAULT_SETTINGS;
  private processManager: ServerManager;
  private stateChangeCallbacks: Array<(state: ServerState) => void> = [];
  private contextManager: ContextManager;
  private viewManager: ViewManager;
  private ribbonIconEl: HTMLElement | null = null;
  private statusPollTimer: ReturnType<typeof setInterval> | null = null;

  async onload(): Promise<void> {
    console.log("Loading OpenCode plugin");

    registerOpenCodeIcons();

    await this.loadSettings();
    await this.attemptAutodetect();

    const projectDirectory = this.getProjectDirectory();

    this.processManager = new ServerManager(this.settings, projectDirectory);
    this.processManager.on("stateChange", (state: ServerState) => {
      this.notifyStateChange(state);
    });

    this.processManager.on("projectDirectoryChanged", async (newDirectory: string) => {
      this.settings.projectDirectory = newDirectory;
      await this.saveData(this.settings);
      this.refreshViewUrls();
      if (this.getServerState() === "running") {
        await this.stopServer();
        await this.startServer();
      }
    });

    this.contextManager = new ContextManager({
      app: this.app,
      settings: this.settings,
      getServerState: () => this.getServerState(),
      registerEvent: (ref) => this.registerEvent(ref),
    });

    this.viewManager = new ViewManager({
      app: this.app,
      settings: this.settings,
      contextManager: this.contextManager,
      getServerState: () => this.getServerState(),
    });

    console.log("[OpenCode] Configured with project directory:", projectDirectory);

    this.registerView(
      OPENCODE_VIEW_TYPE,
      (leaf) => new OpenCodeView(leaf, this)
    );

    this.addSettingTab(new OpenCodeSettingTab(
      this.app,
      this,
      this.settings,
      this.processManager,
      () => this.saveSettings()
    ));

    this.ribbonIconEl = this.addRibbonIcon(OPENCODE_ICON_NAME, "OpenCode", () => {
      void this.viewManager.activateView();
    });

    this.addCommand({
      id: "toggle-opencode-view",
      name: "Toggle OpenCode panel",
      callback: () => void this.viewManager.toggleView(),
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "o" }],
    });

    this.addCommand({
      id: "start-opencode-server",
      name: "Start OpenCode server",
      callback: () => this.startServer(),
    });

    this.addCommand({
      id: "stop-opencode-server",
      name: "Stop OpenCode server",
      callback: () => this.stopServer(),
    });

    this.addCommand({
      id: "new-opencode-session",
      name: "New OpenCode session",
      callback: () => void this.openNewSession(),
    });

    if (this.settings.autoStart) {
      this.app.workspace.onLayoutReady(async () => {
        await this.startServer();
      });
    }

    this.contextManager.updateSettings(this.settings);
    this.processManager.on("stateChange", (state: ServerState) => {
      if (state === "running") {
        void this.contextManager.handleServerRunning();
        this.startStatusPolling();
      } else if (state === "stopped" || state === "error") {
        this.stopStatusPolling();
        this.updateRibbonBusyState(false);
      }
    });

    this.registerCleanupHandlers();
    console.log("OpenCode plugin loaded");
  }

  async onunload(): Promise<void> {
    this.stopStatusPolling();
    this.contextManager.destroy();
    await this.stopServer();
    this.app.workspace.detachLeavesOfType(OPENCODE_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  private async attemptAutodetect(): Promise<void> {
    if (this.settings.opencodePath || this.settings.useCustomCommand) return;
    console.log("[OpenCode] Attempting to autodetect opencode executable...");
    const detectedPath = ExecutableResolver.resolve("opencode");
    if (detectedPath && detectedPath !== "opencode") {
      console.log("[OpenCode] Autodetected opencode at:", detectedPath);
      this.settings.opencodePath = detectedPath;
      await this.saveData(this.settings);
      new Notice(`OpenCode executable found at ${detectedPath}`);
    } else {
      console.log("[OpenCode] Could not autodetect opencode executable");
      new Notice("Could not find opencode. Please check Settings");
    }
  }

  async saveSettings(): Promise<void> {
    const oldSettings = { ...this.settings };
    await this.saveData(this.settings);
    this.processManager.updateSettings(this.settings);
    this.refreshViewUrls();
    this.contextManager.updateSettings(this.settings);
    this.viewManager.updateSettings(this.settings);
  }

  async startServer(): Promise<boolean> {
    const success = await this.processManager.start();
    if (success) {
      new Notice("OpenCode server started");
      await this.initializeProjectOnServer();
    } else {
      const error = this.processManager.getLastError();
      if (error) {
        new Notice(`OpenCode failed to start: ${error}`, 10000);
      } else {
        new Notice("OpenCode failed to start. Check Settings for details.", 5000);
      }
    }
    return success;
  }

  async stopServer(): Promise<void> {
    await this.processManager.stop();
    new Notice("OpenCode server stopped");
  }

  getServerState(): ServerState {
    return this.processManager.getState() ?? "stopped";
  }

  getLastError(): string | null {
    return this.processManager.getLastError() ?? null;
  }

  getServerUrl(): string {
    return this.processManager.getUrl();
  }

  getApiBaseUrl(): string {
    return `http://${this.settings.hostname}:${this.settings.port}`;
  }

  /** Persist current session tabs so they survive Obsidian restarts */
  async saveSessionTabs(tabs: { sessionId: string | null; iframeUrl: string | null }[], activeIndex: number): Promise<void> {
    const data: Record<string, unknown> = (await this.loadData()) ?? {};
    data._tabs = tabs.map(t => ({ sessionId: t.sessionId, iframeUrl: t.iframeUrl }));
    data._activeTabIndex = activeIndex;
    await this.saveData(data);
  }

  /** Load previously saved session tabs */
  async loadSessionTabs(): Promise<{ tabs: { sessionId: string; iframeUrl: string }[]; activeIndex: number } | null> {
    const data = await this.loadData() as Record<string, unknown> | null;
    if (!data?._tabs || !Array.isArray(data._tabs)) return null;
    const tabs = (data._tabs as Array<unknown>).filter(
      (t: any): t is { sessionId: string; iframeUrl: string } =>
        t && typeof t === "object" && typeof t.sessionId === "string" && typeof t.iframeUrl === "string"
    );
    if (tabs.length === 0) return null;
    const activeIndex = typeof data._activeTabIndex === "number"
      ? Math.min(data._activeTabIndex as number, tabs.length - 1)
      : 0;
    return { tabs, activeIndex };
  }

  async openNewSession(): Promise<void> {
    const view = this.viewManager.getView();
    if (view) await view.addSession();
  }

  onServerStateChange(callback: (state: ServerState) => void): () => void {
    this.stateChangeCallbacks.push(callback);
    return () => {
      const index = this.stateChangeCallbacks.indexOf(callback);
      if (index > -1) this.stateChangeCallbacks.splice(index, 1);
    };
  }

  private notifyStateChange(state: ServerState): void {
    for (const cb of this.stateChangeCallbacks) cb(state);
  }

  /** Update the single view's client URLs when server config changes */
  private refreshViewUrls(): void {
    const view = this.viewManager.getView();
    if (!view) return;
    view.client.updateBaseUrl(
      this.getApiBaseUrl(),
      this.getServerUrl(),
      this.getProjectDirectory()
    );
  }

  private async initializeProjectOnServer(): Promise<void> {
    try {
      const url = `${this.getApiBaseUrl()}/session?directory=${encodeURIComponent(this.getProjectDirectory())}`;
      const response = await fetch(url, {
        method: "GET",
        headers: { "x-opencode-directory": this.getProjectDirectory() },
      });
      if (!response.ok) {
        console.warn("[OpenCode] Project initialization failed:", response.status);
      }
    } catch (error) {
      console.error("[OpenCode] Project initialization error:", error);
    }
  }

  refreshContextForView(view: OpenCodeView): void {
    void this.contextManager.refreshContextForView(view);
  }

  getProjectDirectory(): string {
    if (this.settings.projectDirectory) {
      return this.settings.projectDirectory;
    }
    const adapter = this.app.vault.adapter as any;
    return adapter.basePath || "";
  }

  // ── Session status polling ──

  private startStatusPolling(): void {
    this.stopStatusPolling();
    this.statusPollTimer = setInterval(() => void this.pollSessionStatus(), 5000);
    void this.pollSessionStatus();
  }

  private stopStatusPolling(): void {
    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
    }
  }

  private async pollSessionStatus(): Promise<void> {
    if (this.getServerState() !== "running") return;
    try {
      const view = this.viewManager.getView();
      if (!view) return;
      const statuses = await view.client.getSessionStatus();
      if (!statuses) return;

      const isBusy = Object.values(statuses).some(
        (s) => s.type === "busy" || s.type === "retry"
      );
      this.updateRibbonBusyState(isBusy);

      // Push status to view for tab bar updates
      view.updateSessionStatuses(statuses);
    } catch {
      // Silently ignore polling errors
    }
  }

  private updateRibbonBusyState(isBusy: boolean): void {
    if (!this.ribbonIconEl) return;
    if (isBusy) {
      this.ribbonIconEl.classList.add("opencode-ribbon-busy");
    } else {
      this.ribbonIconEl.classList.remove("opencode-ribbon-busy");
    }
  }

  private registerCleanupHandlers(): void {
    this.registerEvent(
      this.app.workspace.on("quit", () => {
        console.log("[OpenCode] Obsidian quitting - performing sync cleanup");
        this.stopServer();
      })
    );
  }
}

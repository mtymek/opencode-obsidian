import { Plugin, WorkspaceLeaf, Notice, EventRef, MarkdownView } from "obsidian";
import { OpenCodeSettings, DEFAULT_SETTINGS, OPENCODE_VIEW_TYPE } from "./types";
import { OpenCodeView } from "./ui/OpenCodeView";
import { ViewManager } from "./ui/ViewManager";
import { OpenCodeSettingTab } from "./settings/SettingsTab";
import { ServerManager, ServerState } from "./server/ServerManager";
import { registerOpenCodeIcons, OPENCODE_ICON_NAME } from "./icons";
import { OpenCodeClient } from "./client/OpenCodeClient";
import { ContextManager } from "./context/ContextManager";
import { ExecutableResolver } from "./server/ExecutableResolver";

export default class OpenCodePlugin extends Plugin {
  settings: OpenCodeSettings = DEFAULT_SETTINGS;
  private processManager: ServerManager;
  private stateChangeCallbacks: Array<(state: ServerState) => void> = [];
  private openCodeClient: OpenCodeClient;
  private contextManager: ContextManager;
  private viewManager: ViewManager;
  private cachedIframeUrl: string | null = null;
  private lastBaseUrl: string | null = null;

  async onload(): Promise<void> {
    console.log("Loading OpenCode plugin");

    registerOpenCodeIcons();

    await this.loadSettings();
    this.cachedIframeUrl = this.settings.lastSessionUrl || null;

    // Attempt autodetect if opencodePath is empty and not using custom command
    await this.attemptAutodetect();

    const projectDirectory = this.getProjectDirectory();

    this.processManager = new ServerManager(this.settings, projectDirectory);
    this.processManager.on("stateChange", (state: ServerState) => {
      this.notifyStateChange(state);
    });

    // Listen for project directory changes and coordinate response
    this.processManager.on("projectDirectoryChanged", async (newDirectory: string) => {
      this.settings.projectDirectory = newDirectory;
      await this.saveData(this.settings);
      this.refreshClientState();
      if (this.getServerState() === "running") {
        await this.stopServer();
        await this.startServer();
      }
    });

    this.openCodeClient = new OpenCodeClient(
      this.getApiBaseUrl(),
      this.getServerUrl(),
      projectDirectory
    );
    this.lastBaseUrl = this.getServerUrl();

    this.contextManager = new ContextManager({
      app: this.app,
      settings: this.settings,
      client: this.openCodeClient,
      getServerState: () => this.getServerState(),
      getCachedIframeUrl: () => this.cachedIframeUrl,
      setCachedIframeUrl: (url) => this.setCachedIframeUrl(url),
      registerEvent: (ref) => this.registerEvent(ref),
    });

    this.viewManager = new ViewManager({
      app: this.app,
      settings: this.settings,
      client: this.openCodeClient,
      contextManager: this.contextManager,
      getCachedIframeUrl: () => this.cachedIframeUrl,
      setCachedIframeUrl: (url) => this.setCachedIframeUrl(url),
      getServerState: () => this.getServerState(),
    });

    console.log(
      "[OpenCode] Configured with project directory:",
      projectDirectory
    );

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

    this.addRibbonIcon(OPENCODE_ICON_NAME, "OpenCode", () => {
      void this.viewManager.activateView();
    });

    this.addCommand({
      id: "toggle-opencode-view",
      name: "Toggle OpenCode panel",
      callback: () => {
        void this.viewManager.toggleView();
      },
      hotkeys: [
        {
          modifiers: ["Mod", "Shift"],
          key: "o",
        },
      ],
    });

    this.addCommand({
      id: "start-opencode-server",
      name: "Start OpenCode server",
      callback: () => {
        this.startServer();
      },
    });

    this.addCommand({
      id: "stop-opencode-server",
      name: "Stop OpenCode server",
      callback: () => {
        this.stopServer();
      },
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
      }
    });

    this.registerCleanupHandlers();

    console.log("OpenCode plugin loaded");
  }

  async onunload(): Promise<void> {
    this.contextManager.destroy();
    await this.stopServer();
    this.app.workspace.detachLeavesOfType(OPENCODE_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  /**
   * Attempt to autodetect opencode executable on startup
   * Triggers when opencodePath is empty and useCustomCommand is false
   */
  private async attemptAutodetect(): Promise<void> {
    // Only autodetect if path is empty and not using custom command mode
    if (this.settings.opencodePath || this.settings.useCustomCommand) {
      return;
    }

    console.log("[OpenCode] Attempting to autodetect opencode executable...");

    const detectedPath = ExecutableResolver.resolve("opencode");
    
    // Check if a different path was found (not the fallback)
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
    await this.saveData(this.settings);
    this.processManager.updateSettings(this.settings);
    this.refreshClientState();
    this.contextManager.updateSettings(this.settings);
    this.viewManager.updateSettings(this.settings);
  }

  async startServer(): Promise<boolean> {
    const success = await this.processManager.start();
    if (success) {
      new Notice("OpenCode server started");
      const initialized = await this.openCodeClient.initializeProject();
      if (!initialized) {
        console.warn("[OpenCode] Failed to initialize project on server");
      }
    } else {
      const error = this.processManager.getLastError();
      if (error) {
        new Notice(`OpenCode failed to start: ${error}`, 10000); // Show for 10 seconds
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

  getStoredIframeUrl(): string | null {
    return this.cachedIframeUrl;
  }

  setCachedIframeUrl(url: string | null): void {
    this.cachedIframeUrl = url;
    const lastSessionUrl = url ?? "";
    if (this.settings.lastSessionUrl !== lastSessionUrl) {
      this.settings.lastSessionUrl = lastSessionUrl;
      void this.saveData(this.settings);
    }
  }

  onServerStateChange(callback: (state: ServerState) => void): () => void {
    this.stateChangeCallbacks.push(callback);
    return () => {
      const index = this.stateChangeCallbacks.indexOf(callback);
      if (index > -1) {
        this.stateChangeCallbacks.splice(index, 1);
      }
    };
  }

  private notifyStateChange(state: ServerState): void {
    for (const callback of this.stateChangeCallbacks) {
      callback(state);
    }
  }

  private refreshClientState(): void {
    const nextUiBaseUrl = this.getServerUrl();
    const nextApiBaseUrl = this.getApiBaseUrl();
    const projectDirectory = this.getProjectDirectory();
    this.openCodeClient.updateBaseUrl(nextApiBaseUrl, nextUiBaseUrl, projectDirectory);

    if (this.lastBaseUrl && this.lastBaseUrl !== nextUiBaseUrl) {
      this.setCachedIframeUrl(null);
    }

    this.lastBaseUrl = nextUiBaseUrl;
  }

  refreshContextForView(view: OpenCodeView): void {
    void this.contextManager.refreshContextForView(view);
  }

  async ensureSessionUrl(view: OpenCodeView): Promise<void> {
    await this.viewManager.ensureSessionUrl(view);
  }

  getProjectDirectory(): string {
    if (this.settings.projectDirectory) {
      console.log("[OpenCode] Using project directory from settings:", this.settings.projectDirectory);
      return this.settings.projectDirectory;
    }
    const adapter = this.app.vault.adapter as any;
    const vaultPath = adapter.basePath || "";
    if (!vaultPath) {
      console.warn("[OpenCode] Warning: Could not determine vault path");
    }
    console.log("[OpenCode] Using vault path as project directory:", vaultPath);
    return vaultPath;
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

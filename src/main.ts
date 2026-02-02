import { Plugin, WorkspaceLeaf, Notice, EventRef, MarkdownView } from "obsidian";
import { OpenCodeSettings, DEFAULT_SETTINGS, OPENCODE_VIEW_TYPE } from "./types";
import { OpenCodeView } from "./OpenCodeView";
import { OpenCodeSettingTab } from "./SettingsTab";
import { ProcessManager, ProcessState } from "./ProcessManager";
import { registerOpenCodeIcons, OPENCODE_ICON_NAME } from "./icons";
import { OpenCodeClient } from "./OpenCodeClient";
import { WorkspaceContext } from "./WorkspaceContext";

export default class OpenCodePlugin extends Plugin {
  settings: OpenCodeSettings = DEFAULT_SETTINGS;
  private processManager: ProcessManager; 
  private stateChangeCallbacks: Array<(state: ProcessState) => void> = [];
  private openCodeClient: OpenCodeClient;
  private workspaceContext: WorkspaceContext;
  private cachedIframeUrl: string | null = null;
  private lastBaseUrl: string | null = null;
  private contextEventRefs: EventRef[] = [];
  private contextRefreshTimer: number | null = null;

  async onload(): Promise<void> {
    console.log("Loading OpenCode plugin");

    registerOpenCodeIcons();

    await this.loadSettings();

    const projectDirectory = this.getProjectDirectory();

    this.processManager = new ProcessManager(
      this.settings,
      projectDirectory,
      (state) => this.notifyStateChange(state)
    );

    this.openCodeClient = new OpenCodeClient(this.getApiBaseUrl(), this.getServerUrl(), projectDirectory);
    this.workspaceContext = new WorkspaceContext(this.app);
    this.lastBaseUrl = this.getServerUrl();

    console.log("[OpenCode] Configured with project directory:", projectDirectory);

    this.registerView(OPENCODE_VIEW_TYPE, (leaf) => new OpenCodeView(leaf, this));
    this.addSettingTab(new OpenCodeSettingTab(this.app, this));

    this.addRibbonIcon(OPENCODE_ICON_NAME, "OpenCode", () => {
      this.activateView();
    });

    this.addCommand({
      id: "toggle-opencode-view",
      name: "Toggle OpenCode panel",
      callback: () => {
        this.toggleView();
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

    this.updateContextListeners();
    this.onProcessStateChange((state) => {
      if (state === "running") {
        void this.handleServerRunning();
      }
    });

    // Register cleanup handlers for when Obsidian quits
    this.registerCleanupHandlers();

    console.log("OpenCode plugin loaded");
  }

  async onunload(): Promise<void> {
    await this.stopServer();
    this.app.workspace.detachLeavesOfType(OPENCODE_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.processManager.updateSettings(this.settings);
    this.refreshClientState();
    this.updateContextListeners();
  }

  // Update project directory and restart server if running
  async updateProjectDirectory(directory: string): Promise<void> {
    this.settings.projectDirectory = directory;
    await this.saveData(this.settings);

    this.processManager.updateProjectDirectory(this.getProjectDirectory());
    this.refreshClientState();

    if (this.getProcessState() === "running") {
      this.stopServer();
      await this.startServer();
    }
  }

  private getExistingLeaf(): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(OPENCODE_VIEW_TYPE);
    return leaves.length > 0 ? leaves[0] : null;
  }

  async activateView(): Promise<void> {
    const existingLeaf = this.getExistingLeaf();

    if (existingLeaf) {
      this.app.workspace.revealLeaf(existingLeaf);
      return;
    }

    // Create new leaf based on defaultViewLocation setting
    let leaf: WorkspaceLeaf | null = null;
    if (this.settings.defaultViewLocation === "main") {
      leaf = this.app.workspace.getLeaf("tab");
    } else {
      leaf = this.app.workspace.getRightLeaf(false);
    }

    if (leaf) {
      await leaf.setViewState({
        type: OPENCODE_VIEW_TYPE,
        active: true,
      });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async toggleView(): Promise<void> {
    const existingLeaf = this.getExistingLeaf();

    if (existingLeaf) {
      // Check if the view is in the sidebar or main area
      const isInSidebar = existingLeaf.getRoot() === this.app.workspace.rightSplit;

      if (isInSidebar) {
        // For sidebar views, check if sidebar is collapsed
        const rightSplit = this.app.workspace.rightSplit;
        if (rightSplit && !rightSplit.collapsed) {
          existingLeaf.detach();
        } else {
          this.app.workspace.revealLeaf(existingLeaf);
        }
      } else {
        // For main area views, just detach (close the tab)
        existingLeaf.detach();
      }
    } else {
      await this.activateView();
    }
  }

  async startServer(): Promise<boolean> {
    const success = await this.processManager.start();
    if (success) {
      new Notice("OpenCode server started");
    }
    return success;
  }

  async stopServer(): Promise<void> {
    await this.processManager.stop();
    new Notice("OpenCode server stopped");
  }

  getProcessState(): ProcessState {
    return this.processManager?.getState() ?? "stopped";
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
  }

  async ensureSessionUrl(view: OpenCodeView): Promise<void> {
    if (this.getProcessState() !== "running") {
      return;
    }

    const existingUrl = this.cachedIframeUrl ?? view.getIframeUrl();
    if (existingUrl && this.openCodeClient.resolveSessionId(existingUrl)) {
      this.cachedIframeUrl = existingUrl;
      return;
    }

    const sessionId = await this.openCodeClient.createSession();
    if (!sessionId) {
      return;
    }

    const sessionUrl = this.openCodeClient.getSessionUrl(sessionId);
    this.cachedIframeUrl = sessionUrl;
    view.setIframeUrl(sessionUrl);

    if (this.app.workspace.activeLeaf === view.leaf) {
      await this.updateOpenCodeContext(view.leaf);
    }
  }

  refreshContextForView(view: OpenCodeView): void {
    if (!this.settings.injectWorkspaceContext) {
      return;
    }

    void this.updateOpenCodeContext(view.leaf);
  }

  onProcessStateChange(callback: (state: ProcessState) => void): () => void {
    this.stateChangeCallbacks.push(callback);
    return () => {
      const index = this.stateChangeCallbacks.indexOf(callback);
      if (index > -1) {
        this.stateChangeCallbacks.splice(index, 1);
      }
    };
  }

  private notifyStateChange(state: ProcessState): void {
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
      this.cachedIframeUrl = null;
    }

    this.lastBaseUrl = nextUiBaseUrl;
  }

  private updateContextListeners(): void {
    if (!this.settings.injectWorkspaceContext) {
      this.clearContextListeners();
      return;
    }

    if (this.contextEventRefs.length > 0) {
      return;
    }

    const activeLeafRef = this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view instanceof MarkdownView) {
        this.workspaceContext.trackViewSelection(leaf.view);
      }
      this.scheduleContextRefresh(0);
    });
    const fileOpenRef = this.app.workspace.on("file-open", () => {
      this.scheduleContextRefresh();
    });
    const fileCloseRef = (this.app.workspace as any).on("file-close", () => {
      this.scheduleContextRefresh();
    });
    const layoutChangeRef = this.app.workspace.on("layout-change", () => {
      this.scheduleContextRefresh();
    });
    const editorChangeRef = this.app.workspace.on("editor-change", (_editor, view) => {
      if (view instanceof MarkdownView) {
        this.workspaceContext.trackViewSelection(view);
      }
      this.scheduleContextRefresh(500);
    });
    const selectionChangeRef = (this.app.workspace as any).on(
      "editor-selection-change",
      (_editor: unknown, view: unknown) => {
        if (view instanceof MarkdownView) {
          this.workspaceContext.trackViewSelection(view);
        }
        this.scheduleContextRefresh(200);
      }
    );

    this.contextEventRefs = [
      activeLeafRef,
      fileOpenRef,
      fileCloseRef,
      layoutChangeRef,
      editorChangeRef,
      selectionChangeRef,
    ];
    this.contextEventRefs.forEach((ref) => this.registerEvent(ref));
  }

  private clearContextListeners(): void {
    for (const ref of this.contextEventRefs) {
      this.app.workspace.offref(ref);
    }
    this.contextEventRefs = [];
    if (this.contextRefreshTimer !== null) {
      window.clearTimeout(this.contextRefreshTimer);
      this.contextRefreshTimer = null;
    }
  }

  private scheduleContextRefresh(delayMs: number = 300): void {
    const leaf = this.getOpenCodeLeafForRefresh();
    if (!leaf) {
      return;
    }

    if (this.contextRefreshTimer !== null) {
      window.clearTimeout(this.contextRefreshTimer);
    }

    this.contextRefreshTimer = window.setTimeout(() => {
      this.contextRefreshTimer = null;
      void this.updateOpenCodeContext(leaf);
    }, delayMs);
  }

  private getOpenCodeLeafForRefresh(): WorkspaceLeaf | null {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf?.view.getViewType() === OPENCODE_VIEW_TYPE) {
      return activeLeaf;
    }

    return this.getVisibleSidebarOpenCodeLeaf();
  }

  private getVisibleSidebarOpenCodeLeaf(): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(OPENCODE_VIEW_TYPE);
    if (leaves.length === 0) {
      return null;
    }

    const rightSplit = this.app.workspace.rightSplit;
    if (!rightSplit || rightSplit.collapsed) {
      return null;
    }

    const leaf = leaves[0];
    return leaf.getRoot() === rightSplit ? leaf : null;
  }

  private async handleServerRunning(): Promise<void> {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf?.view.getViewType() === OPENCODE_VIEW_TYPE) {
      await this.updateOpenCodeContext(activeLeaf);
    }
  }

  private async updateOpenCodeContext(leaf: WorkspaceLeaf): Promise<void> {
    if (!this.settings.injectWorkspaceContext) {
      return;
    }

    if (this.getProcessState() !== "running") {
      return;
    }

    const view = leaf.view instanceof OpenCodeView ? leaf.view : null;
    const iframeUrl = this.cachedIframeUrl ?? view?.getIframeUrl();
    if (!iframeUrl) {
      return;
    }

    const sessionId = this.openCodeClient.resolveSessionId(iframeUrl);
    if (!sessionId) {
      return;
    }

    this.cachedIframeUrl = iframeUrl;

    const { contextText } = this.workspaceContext.gatherContext(
      this.settings.maxNotesInContext,
      this.settings.maxSelectionLength
    );

    await this.openCodeClient.updateContext({
      sessionId,
      contextText,
    });
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

import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { OPENCODE_VIEW_TYPE } from "../types";
import { OPENCODE_ICON_NAME } from "../icons";
import type OpenCodePlugin from "../main";
import type { ServerState } from "../server/types";

export class OpenCodeView extends ItemView {
  plugin: OpenCodePlugin;
  private iframeEl: HTMLIFrameElement | null = null;
  private currentState: ServerState = "stopped";
  private unsubscribeStateChange: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: OpenCodePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return OPENCODE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "OpenCode";
  }

  getIcon(): string {
    return OPENCODE_ICON_NAME;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("opencode-container");

    // Subscribe to state changes
    this.unsubscribeStateChange = this.plugin.onServerStateChange((state: ServerState) => {
      this.currentState = state;
      this.updateView();
    });

    // Initial render
    this.currentState = this.plugin.getServerState();
    this.updateView();

    // Start server if not running (lazy start) - don't await to avoid blocking view open
    if (this.currentState === "stopped") {
      this.plugin.startServer();
    }
  }

  async onClose(): Promise<void> {
    // Unsubscribe from state changes to prevent memory leak
    if (this.unsubscribeStateChange) {
      this.unsubscribeStateChange();
      this.unsubscribeStateChange = null;
    }
    
    // Clean up iframe
    if (this.iframeEl) {
      const iframeUrl = this.iframeEl.src;
      if (iframeUrl.includes("/session/")) {
        this.plugin.setCachedIframeUrl(iframeUrl);
      }
      this.iframeEl.src = "about:blank";
      this.iframeEl = null;
    }
  }

  private updateView(): void {
    switch (this.currentState) {
      case "stopped":
        this.renderStoppedState();
        break;
      case "starting":
        this.renderStartingState();
        break;
      case "running":
        this.renderRunningState();
        break;
      case "error":
        this.renderErrorState();
        break;
    }
  }

  private renderStoppedState(): void {
    this.contentEl.empty();

    const statusContainer = this.contentEl.createDiv({
      cls: "opencode-status-container",
    });

    const iconEl = statusContainer.createDiv({ cls: "opencode-status-icon" });
    setIcon(iconEl, "power-off");

    statusContainer.createEl("h3", { text: "OpenCode is stopped" });
    statusContainer.createEl("p", {
      text: "Click the button below to start the OpenCode server.",
      cls: "opencode-status-message",
    });

    const startButton = statusContainer.createEl("button", {
      text: "Start OpenCode",
      cls: "mod-cta",
    });
    startButton.addEventListener("click", () => {
      this.plugin.startServer();
    });
  }

  private renderStartingState(): void {
    this.contentEl.empty();

    const statusContainer = this.contentEl.createDiv({
      cls: "opencode-status-container",
    });

    const loadingEl = statusContainer.createDiv({ cls: "opencode-loading" });
    loadingEl.createDiv({ cls: "opencode-spinner" });

    statusContainer.createEl("h3", { text: "Starting OpenCode..." });
    statusContainer.createEl("p", {
      text: "Please wait while the server starts up.",
      cls: "opencode-status-message",
    });
  }

  private renderRunningState(): void {
    this.contentEl.empty();

    const headerEl = this.contentEl.createDiv({ cls: "opencode-header" });

    const titleSection = headerEl.createDiv({ cls: "opencode-header-title" });
    const iconEl = titleSection.createSpan();
    setIcon(iconEl, OPENCODE_ICON_NAME);
    titleSection.createSpan({ text: "OpenCode" });

    const actionsEl = headerEl.createDiv({ cls: "opencode-header-actions" });

    const reloadButton = actionsEl.createEl("button", {
      attr: { "aria-label": "Reload" },
    });
    setIcon(reloadButton, "refresh-cw");
    reloadButton.addEventListener("click", () => {
      this.reloadIframe();
    });

    const stopButton = actionsEl.createEl("button", {
      attr: { "aria-label": "Stop server" },
    });
    setIcon(stopButton, "square");
    stopButton.addEventListener("click", () => {
      this.plugin.stopServer();
    });

    const iframeContainer = this.contentEl.createDiv({
      cls: "opencode-iframe-container",
    });

    const iframeUrl = this.plugin.getStoredIframeUrl() ?? this.plugin.getServerUrl();
    console.log("[OpenCode] Loading iframe with URL:", iframeUrl);

    this.iframeEl = iframeContainer.createEl("iframe", {
      cls: "opencode-iframe",
      attr: {
        src: iframeUrl,
        frameborder: "0",
        allow: "clipboard-read; clipboard-write",
      },
    });

    this.iframeEl.addEventListener("error", () => {
      console.error("Failed to load OpenCode iframe");
    });

    this.iframeEl.addEventListener("focus", () => {
      this.plugin.refreshContextForView(this);
    });

    this.iframeEl.addEventListener("pointerdown", () => {
      this.plugin.refreshContextForView(this);
    });

    void this.plugin.ensureSessionUrl(this);
  }

  getIframeUrl(): string | null {
    return this.iframeEl?.src ?? null;
  }

  setIframeUrl(url: string): void {
    if (this.iframeEl && this.iframeEl.src !== url) {
      this.iframeEl.src = url;
    }
  }

  private renderErrorState(): void {
    this.contentEl.empty();

    const statusContainer = this.contentEl.createDiv({
      cls: "opencode-status-container opencode-error",
    });

    const iconEl = statusContainer.createDiv({ cls: "opencode-status-icon" });
    setIcon(iconEl, "alert-circle");

    statusContainer.createEl("h3", { text: "Failed to start OpenCode" });
    
    const errorMessage = this.plugin.getLastError();
    if (errorMessage) {
      statusContainer.createEl("p", {
        text: errorMessage,
        cls: "opencode-status-message opencode-error-message",
      });
    } else {
      statusContainer.createEl("p", {
        text: "There was an error starting the OpenCode server.",
        cls: "opencode-status-message",
      });
    }

    const buttonContainer = statusContainer.createDiv({
      cls: "opencode-button-group",
    });

    const retryButton = buttonContainer.createEl("button", {
      text: "Retry",
      cls: "mod-cta",
    });
    retryButton.addEventListener("click", () => {
      this.plugin.startServer();
    });

    const settingsButton = buttonContainer.createEl("button", {
      text: "Open Settings",
    });
    settingsButton.addEventListener("click", () => {
      (this.app as any).setting.open();
      (this.app as any).setting.openTabById("obsidian-opencode");
    });
  }

  private reloadIframe(): void {
    if (this.iframeEl) {
      const src = this.iframeEl.src;
      this.iframeEl.src = "about:blank";
      setTimeout(() => {
        if (this.iframeEl) {
          this.iframeEl.src = src;
        }
      }, 100);
    }
  }
}

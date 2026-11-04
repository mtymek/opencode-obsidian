import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { OPENCODE_VIEW_TYPE } from "../types";
import { OPENCODE_ICON_NAME } from "../icons";
import type OpenCodePlugin from "../main";
import type { ServerState } from "../server/types";
import {
  buildCredentialSeedScript,
  isWebviewSupported,
  type OpenCodeEmbedElement,
} from "./embed";

/** How long to wait for the webview to boot before falling back to an iframe. */
const WEBVIEW_READY_TIMEOUT_MS = 10000;

export class OpenCodeView extends ItemView {
  plugin: OpenCodePlugin;
  private embedEl: OpenCodeEmbedElement | HTMLIFrameElement | null = null;
  private embedKind: "webview" | "iframe" | null = null;
  private embedReady = false;
  private seedReloaded = false;
  private readyWatchdog: number | null = null;
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

    this.clearWatchdog();

    // Clean up embed element
    if (this.embedEl) {
      const embedUrl = this.getIframeUrl();
      if (embedUrl && embedUrl.includes("/session/")) {
        this.plugin.setCachedIframeUrl(embedUrl);
      }
      this.embedEl.setAttribute("src", "about:blank");
      this.embedEl.detach();
      this.embedEl = null;
      this.embedKind = null;
    }

    this.embedReady = false;
    this.seedReloaded = false;
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
    this.embedReady = false;
    this.seedReloaded = false;

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
      this.reloadEmbed();
    });

    const stopButton = actionsEl.createEl("button", {
      attr: { "aria-label": "Stop server" },
    });
    setIcon(stopButton, "square");
    stopButton.addEventListener("click", () => {
      this.plugin.stopServer();
    });

    const embedContainer = this.contentEl.createDiv({
      cls: "opencode-iframe-container",
    });

    const serverUrl = this.plugin.getServerUrl();
    const startUrl = this.plugin.getStoredIframeUrl() ?? serverUrl;
    console.log("[OpenCode] Loading UI with URL:", startUrl);

    if (isWebviewSupported()) {
      this.mountWebview(embedContainer, startUrl, serverUrl);
    } else {
      this.mountIframe(embedContainer, startUrl, serverUrl, false);
    }
  }

  /**
   * Mount the OpenCode web app in an Electron <webview>.
   *
   * The app is served from 127.0.0.1 and is cross-origin to app://obsidian.md,
   * which means its localStorage can only be written from inside the guest
   * process - that is what <webview>.executeJavaScript is for.
   */
  private mountWebview(
    container: HTMLElement,
    startUrl: string,
    serverUrl: string
  ): void {
    const webview = document.createElement("webview") as OpenCodeEmbedElement;
    webview.addClass("opencode-webview");
    webview.setAttribute("src", startUrl);
    webview.setAttribute("allowpopups", "true");
    container.appendChild(webview);

    this.embedEl = webview;
    this.embedKind = "webview";

    webview.addEventListener("dom-ready", () => {
      this.embedReady = true;
      this.clearWatchdog();
      void this.handleWebviewReady(webview, serverUrl);
    });

    webview.addEventListener("did-fail-load", (event: Event) => {
      const detail = event as unknown as { errorDescription?: string };
      console.error("[OpenCode] Webview failed to load:", detail.errorDescription);
    });

    webview.addEventListener("focus", () => {
      this.plugin.refreshContextForView(this);
    });

    webview.addEventListener("pointerdown", () => {
      this.plugin.refreshContextForView(this);
    });

    this.readyWatchdog = window.setTimeout(() => {
      if (this.embedReady || this.embedEl !== webview) {
        return;
      }
      console.warn("[OpenCode] Webview did not become ready, falling back to iframe");
      webview.detach();
      container.empty();
      this.mountIframe(container, startUrl, serverUrl, true);
    }, WEBVIEW_READY_TIMEOUT_MS);
  }

  /**
   * Runs on every dom-ready. Seeds the server credential into the web app's
   * storage (the app keeps its server list there and authenticates API calls
   * with the stored password), reloading once so the value is picked up during
   * startup, then navigates to the session for this vault.
   */
  private async handleWebviewReady(
    webview: OpenCodeEmbedElement,
    serverUrl: string
  ): Promise<void> {
    const password = this.plugin.getServerPassword();

    if (password && !this.seedReloaded) {
      try {
        const changed = await webview.executeJavaScript(
          buildCredentialSeedScript(serverUrl, password)
        );
        if (this.embedEl !== webview) {
          return;
        }
        if (changed === true) {
          this.seedReloaded = true;
          this.embedReady = false;
          webview.reload();
          return;
        }
      } catch (error) {
        console.warn("[OpenCode] Failed to seed server credentials", error);
      }
    }

    void this.plugin.ensureSessionUrl(this);
  }

  private mountIframe(
    container: HTMLElement,
    startUrl: string,
    _serverUrl: string,
    afterFallback: boolean
  ): void {
    const notice = container.createDiv({ cls: "opencode-notice" });
    notice.setText(
      afterFallback
        ? "Electron webview unavailable - OpenCode must be connected manually: run `opencode pair`, then paste the pairing link into the embedded window."
        : "OpenCode 2 needs a pairing link: run `opencode pair`, then paste it into the window below."
    );

    const frame = container.createEl("iframe", {
      cls: "opencode-iframe",
      attr: {
        src: startUrl,
        frameborder: "0",
        allow: "clipboard-read; clipboard-write",
      },
    });

    this.embedEl = frame;
    this.embedKind = "iframe";

    frame.addEventListener("focus", () => {
      this.plugin.refreshContextForView(this);
    });

    frame.addEventListener("pointerdown", () => {
      this.plugin.refreshContextForView(this);
    });

    void this.plugin.ensureSessionUrl(this);
  }

  getIframeUrl(): string | null {
    return this.embedEl?.getAttribute("src") ?? null;
  }

  setIframeUrl(url: string): void {
    if (!this.embedEl) {
      return;
    }
    if (this.getIframeUrl() !== url) {
      this.embedEl.setAttribute("src", url);
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

  private reloadEmbed(): void {
    const embed = this.embedEl;
    if (!embed) {
      return;
    }

    if (this.embedKind === "webview") {
      this.embedReady = false;
      this.seedReloaded = false;
      (embed as OpenCodeEmbedElement).reload();
      return;
    }

    const src = embed.getAttribute("src") ?? "";
    embed.setAttribute("src", "about:blank");
    setTimeout(() => {
      if (this.embedEl === embed) {
        embed.setAttribute("src", src);
      }
    }, 100);
  }

  private clearWatchdog(): void {
    if (this.readyWatchdog !== null) {
      window.clearTimeout(this.readyWatchdog);
      this.readyWatchdog = null;
    }
  }
}

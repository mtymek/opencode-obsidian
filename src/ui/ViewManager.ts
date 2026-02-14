import { App, WorkspaceLeaf } from "obsidian";
import { OPENCODE_VIEW_TYPE, OpenCodeSettings } from "../types";
import { OpenCodeView } from "./OpenCodeView";
import { OpenCodeClient } from "../client/OpenCodeClient";
import { ContextManager } from "../context/ContextManager";
import { ServerState } from "../server/types";

type ViewManagerDeps = {
  app: App;
  settings: OpenCodeSettings;
  client: OpenCodeClient;
  contextManager: ContextManager;
  getCachedIframeUrl: () => string | null;
  setCachedIframeUrl: (url: string | null) => void;
  getServerState: () => ServerState;
};

export class ViewManager {
  private app: App;
  private settings: OpenCodeSettings;
  private client: OpenCodeClient;
  private contextManager: ContextManager;
  private getCachedIframeUrl: () => string | null;
  private setCachedIframeUrl: (url: string | null) => void;
  private getServerState: () => string;

  constructor(deps: ViewManagerDeps) {
    this.app = deps.app;
    this.settings = deps.settings;
    this.client = deps.client;
    this.contextManager = deps.contextManager;
    this.getCachedIframeUrl = deps.getCachedIframeUrl;
    this.setCachedIframeUrl = deps.setCachedIframeUrl;
    this.getServerState = deps.getServerState;
  }

  updateSettings(settings: OpenCodeSettings): void {
    this.settings = settings;
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

  async ensureSessionUrl(view: OpenCodeView): Promise<void> {
    if (this.getServerState() !== "running") {
      return;
    }

    const cachedUrl = this.getCachedIframeUrl();
    const existingUrl = cachedUrl ?? view.getIframeUrl();
    if (existingUrl && this.client.resolveSessionId(existingUrl)) {
      this.setCachedIframeUrl(existingUrl);
      return;
    }

    const sessionId = await this.client.createSession();
    if (!sessionId) {
      return;
    }

    const sessionUrl = this.client.getSessionUrl(sessionId);
    this.setCachedIframeUrl(sessionUrl);
    view.setIframeUrl(sessionUrl);

    if (this.app.workspace.activeLeaf === view.leaf) {
      await this.contextManager.refreshContextForView(view);
    }
  }
}

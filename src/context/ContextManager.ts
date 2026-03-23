import { App, EventRef, MarkdownView, WorkspaceLeaf } from "obsidian";
import { OpenCodeSettings, OPENCODE_VIEW_TYPE } from "../types";
import { OpenCodeClient } from "../client/OpenCodeClient";
import { WorkspaceContext } from "./WorkspaceContext";
import { OpenCodeView } from "../ui/OpenCodeView";
import { ServerState } from "../server/types";

type ContextManagerDeps = {
  app: App;
  settings: OpenCodeSettings;
  client: OpenCodeClient;
  getServerState: () => ServerState;
  getCachedIframeUrl: () => string | null;
  setCachedIframeUrl: (url: string | null) => void;
  registerEvent: (ref: EventRef) => void;
};

export class ContextManager {
  private app: App;
  private settings: OpenCodeSettings;
  private client: OpenCodeClient;
  private workspaceContext: WorkspaceContext;
  private getServerState: () => ServerState;
  private getCachedIframeUrl: () => string | null;
  private setCachedIframeUrl: (url: string | null) => void;
  private registerEvent: (ref: EventRef) => void;

  private contextEventRefs: EventRef[] = [];
  private contextRefreshTimer: number | null = null;
  private refreshInFlight = false;
  private pendingLeaf: WorkspaceLeaf | null = null;
  private lastContextKey: string | null = null;

  constructor(deps: ContextManagerDeps) {
    this.app = deps.app;
    this.settings = deps.settings;
    this.client = deps.client;
    this.workspaceContext = new WorkspaceContext(this.app);
    this.getServerState = deps.getServerState;
    this.getCachedIframeUrl = deps.getCachedIframeUrl;
    this.setCachedIframeUrl = deps.setCachedIframeUrl;
    this.registerEvent = deps.registerEvent;
  }

  updateSettings(settings: OpenCodeSettings): void {
    const injectWorkspaceContextChanged =
      this.settings.injectWorkspaceContext !== settings.injectWorkspaceContext;

    this.settings = settings;

    if (injectWorkspaceContextChanged && !settings.injectWorkspaceContext) {
      this.lastContextKey = null;
      this.client.resetTracking();
    }

    this.updateListeners();
  }

  private updateListeners(): void {
    if (!this.settings.injectWorkspaceContext) {
      this.clearListeners();
      return;
    }

    if (this.contextEventRefs.length > 0) {
      return;
    }

    const activeLeafRef = this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view instanceof MarkdownView) {
        this.workspaceContext.trackViewSelection(leaf.view);
      }
      this.scheduleRefresh(0);
    });
    const fileOpenRef = this.app.workspace.on("file-open", () => {
      this.scheduleRefresh();
    });
    const fileCloseRef = (this.app.workspace as any).on("file-close", () => {
      this.scheduleRefresh();
    });
    const layoutChangeRef = this.app.workspace.on("layout-change", () => {
      this.scheduleRefresh();
    });
    const editorChangeRef = this.app.workspace.on(
      "editor-change",
      (_editor, view) => {
        if (view instanceof MarkdownView) {
          this.workspaceContext.trackViewSelection(view);
        }
        this.scheduleRefresh(500);
      }
    );
    const selectionChangeRef = (this.app.workspace as any).on(
      "editor-selection-change",
      (_editor: unknown, view: unknown) => {
        if (view instanceof MarkdownView) {
          this.workspaceContext.trackViewSelection(view);
        }
        this.scheduleRefresh(200);
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

  private clearListeners(): void {
    for (const ref of this.contextEventRefs) {
      this.app.workspace.offref(ref);
    }
    this.contextEventRefs = [];
    this.pendingLeaf = null;
    this.refreshInFlight = false;
    if (this.contextRefreshTimer !== null) {
      window.clearTimeout(this.contextRefreshTimer);
      this.contextRefreshTimer = null;
    }
  }

  private scheduleRefresh(delayMs: number = 300): void {
    const leaf = this.getLeafForRefresh();
    if (!leaf) {
      return;
    }

    if (this.contextRefreshTimer !== null) {
      window.clearTimeout(this.contextRefreshTimer);
    }

    this.contextRefreshTimer = window.setTimeout(() => {
      this.contextRefreshTimer = null;
      void this.refreshContext(leaf);
    }, delayMs);
  }

  private getLeafForRefresh(): WorkspaceLeaf | null {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf?.view.getViewType() === OPENCODE_VIEW_TYPE) {
      return activeLeaf;
    }

    return this.getVisibleLeaf();
  }

  private getVisibleLeaf(): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(OPENCODE_VIEW_TYPE);
    if (leaves.length === 0) {
      return null;
    }

    for (const leaf of leaves) {
      const root = leaf.getRoot();
      if (root !== this.app.workspace.rightSplit) {
        return leaf;
      }
    }

    const rightSplit = this.app.workspace.rightSplit;
    if (!rightSplit || rightSplit.collapsed) {
      return null;
    }

    return leaves.find((leaf) => leaf.getRoot() === rightSplit) ?? null;
  }

  async handleServerRunning(): Promise<void> {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf?.view.getViewType() === OPENCODE_VIEW_TYPE) {
      await this.refreshContext(activeLeaf);
      return;
    }

    const visibleLeaf = this.getVisibleLeaf();
    if (visibleLeaf) {
      await this.refreshContext(visibleLeaf);
    }
  }

  async refreshContextForView(_view: OpenCodeView): Promise<void> {
    if (!this.settings.injectWorkspaceContext) {
      return;
    }

    const leaf = this.getLeafForRefresh();
    if (!leaf) {
      return;
    }

    await this.refreshContext(leaf);
  }

  private async refreshContext(leaf: WorkspaceLeaf): Promise<void> {
    if (!this.settings.injectWorkspaceContext) {
      return;
    }

    if (this.getServerState() !== "running") {
      return;
    }

    if (this.refreshInFlight) {
      this.pendingLeaf = leaf;
      return;
    }

    this.refreshInFlight = true;

    try {
      const view = leaf.view instanceof OpenCodeView ? leaf.view : null;
      const iframeUrl = this.getCachedIframeUrl() ?? view?.getIframeUrl();
      if (!iframeUrl) {
        return;
      }

      const sessionId = this.client.resolveSessionId(iframeUrl);
      if (!sessionId) {
        return;
      }

      this.setCachedIframeUrl(iframeUrl);

      const { contextText } = this.workspaceContext.gatherContext(
        this.settings.maxNotesInContext,
        this.settings.maxSelectionLength
      );

      const nextContextKey = `${sessionId}::${contextText ?? ""}`;
      if (nextContextKey === this.lastContextKey) {
        return;
      }

      await this.client.updateContext({
        sessionId,
        contextText,
      });

      this.lastContextKey = nextContextKey;
    } finally {
      this.refreshInFlight = false;
      const pendingLeaf = this.pendingLeaf;
      this.pendingLeaf = null;
      if (pendingLeaf) {
        void this.refreshContext(pendingLeaf);
      }
    }
  }

  destroy(): void {
    this.clearListeners();
  }
}

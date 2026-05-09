import { App, EventRef, MarkdownView, WorkspaceLeaf } from "obsidian";
import { OpenCodeSettings, OPENCODE_VIEW_TYPE } from "../types";
import { WorkspaceContext } from "./WorkspaceContext";
import { OpenCodeView } from "../ui/OpenCodeView";
import { ServerState } from "../server/types";

type ContextManagerDeps = {
  app: App;
  settings: OpenCodeSettings;
  getServerState: () => ServerState;
  registerEvent: (ref: EventRef) => void;
};

export class ContextManager {
  private app: App;
  private settings: OpenCodeSettings;
  private workspaceContext: WorkspaceContext;
  private getServerState: () => ServerState;
  private registerEvent: (ref: EventRef) => void;

  private contextEventRefs: EventRef[] = [];
  private contextRefreshTimer: number | null = null;

  constructor(deps: ContextManagerDeps) {
    this.app = deps.app;
    this.settings = deps.settings;
    this.workspaceContext = new WorkspaceContext(this.app);
    this.getServerState = deps.getServerState;
    this.registerEvent = deps.registerEvent;
  }

  updateSettings(settings: OpenCodeSettings): void {
    this.settings = settings;
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
    if (this.contextRefreshTimer !== null) {
      window.clearTimeout(this.contextRefreshTimer);
      this.contextRefreshTimer = null;
    }
  }

  /** Find the leaf that should receive context injection */
  private getTargetLeaf(): WorkspaceLeaf | null {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf?.view.getViewType() === OPENCODE_VIEW_TYPE) {
      return activeLeaf;
    }

    // Fallback: find a visible sidebar leaf
    const leaves = this.app.workspace.getLeavesOfType(OPENCODE_VIEW_TYPE);
    if (leaves.length === 0) return null;

    const rightSplit = this.app.workspace.rightSplit;
    if (rightSplit && !rightSplit.collapsed) {
      const sidebarLeaf = leaves.find(l => l.getRoot() === rightSplit);
      if (sidebarLeaf) return sidebarLeaf;
    }

    return leaves[0];
  }

  /** Inject workspace context into the given view's active session */
  private async injectContextForView(view: OpenCodeView): Promise<void> {
    if (!this.settings.injectWorkspaceContext) return;
    if (this.getServerState() !== "running") return;

    const sessionId = view.getActiveSessionId();
    if (!sessionId) return;

    const { contextText } = this.workspaceContext.gatherContext(
      this.settings.maxNotesInContext,
      this.settings.maxSelectionLength
    );

    await view.client.updateContext({ sessionId, contextText });
  }

  private scheduleRefresh(delayMs: number = 300): void {
    const leaf = this.getTargetLeaf();
    if (!leaf) return;
    if (!(leaf.view instanceof OpenCodeView)) return;

    if (this.contextRefreshTimer !== null) {
      window.clearTimeout(this.contextRefreshTimer);
    }

    this.contextRefreshTimer = window.setTimeout(() => {
      this.contextRefreshTimer = null;
      void this.injectContextForView(leaf.view as OpenCodeView);
    }, delayMs);
  }

  async handleServerRunning(): Promise<void> {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf?.view instanceof OpenCodeView) {
      await this.injectContextForView(activeLeaf.view);
    }
  }

  async refreshContextForView(view: OpenCodeView): Promise<void> {
    if (!this.settings.injectWorkspaceContext) return;
    await this.injectContextForView(view);
  }

  destroy(): void {
    this.clearListeners();
  }
}

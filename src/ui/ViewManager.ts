import { App, WorkspaceLeaf } from "obsidian";
import { OPENCODE_VIEW_TYPE, OpenCodeSettings } from "../types";
import { OpenCodeView } from "./OpenCodeView";
import { ContextManager } from "../context/ContextManager";
import { ServerState } from "../server/types";

type ViewManagerDeps = {
  app: App;
  settings: OpenCodeSettings;
  contextManager: ContextManager;
  getServerState: () => ServerState;
};

export class ViewManager {
  private app: App;
  private settings: OpenCodeSettings;
  private contextManager: ContextManager;
  private getServerState: () => string;

  constructor(deps: ViewManagerDeps) {
    this.app = deps.app;
    this.settings = deps.settings;
    this.contextManager = deps.contextManager;
    this.getServerState = deps.getServerState;
  }

  updateSettings(settings: OpenCodeSettings): void {
    this.settings = settings;
  }

  /** Get the single OpenCode view instance, if it exists */
  getView(): OpenCodeView | null {
    const leaves = this.app.workspace.getLeavesOfType(OPENCODE_VIEW_TYPE);
    if (leaves.length === 0) return null;
    const view = leaves[0].view;
    return view instanceof OpenCodeView ? view : null;
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
      const isInSidebar = existingLeaf.getRoot() === this.app.workspace.rightSplit;

      if (isInSidebar) {
        const rightSplit = this.app.workspace.rightSplit;
        if (rightSplit && !rightSplit.collapsed) {
          existingLeaf.detach();
        } else {
          this.app.workspace.revealLeaf(existingLeaf);
        }
      } else {
        existingLeaf.detach();
      }
    } else {
      await this.activateView();
    }
  }
}

import { App, MarkdownView } from "obsidian";

type SelectedTextContext = {
  text: string;
  sourcePath: string;
};

type WorkspaceContextSnapshot = {
  openNotePaths: string[];
  selection: SelectedTextContext | null;
  contextText: string | null;
};

export class WorkspaceContext {
  private app: App;
  private lastSelection: { text: string; sourcePath: string } | null = null;
  private lastMarkdownView: MarkdownView | null = null;

  constructor(app: App) {
    this.app = app;
  }

  trackViewSelection(view: MarkdownView | null): void {
    if (view) {
      this.lastMarkdownView = view;
    }

    const sourcePath = view?.file?.path;
    const selection = view?.editor?.getSelection() ?? "";

    if (sourcePath && selection.trim()) {
      this.lastSelection = {
        text: selection,
        sourcePath,
      };
    }
  }

  gatherContext(maxNotes: number, maxSelectionLength: number): WorkspaceContextSnapshot {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    const paths = new Set<string>();

    for (const leaf of leaves) {
      const view = leaf.view as MarkdownView;
      const path = view.file?.path;
      if (path) {
        paths.add(path);
      }
    }

    const openNotePaths = Array.from(paths).slice(0, Math.max(0, maxNotes));
    const view = this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.lastMarkdownView;

    this.trackViewSelection(view);

    const sourcePath = view?.file?.path;
    const selection = view?.editor?.getSelection() ?? "";
    let selectionContext: SelectedTextContext | null = null;

    if (sourcePath && selection.trim()) {
      selectionContext = {
        text: selection,
        sourcePath,
      };
      this.lastSelection = selectionContext;
    } else if (this.lastSelection) {
      selectionContext = this.lastSelection;
    }

    if (selectionContext && selectionContext.text.length > maxSelectionLength) {
      selectionContext = {
        ...selectionContext,
        text: selectionContext.text.slice(0, maxSelectionLength) + "... [truncated]",
      };
    }

    let contextText: string | null = null;
    if (openNotePaths.length > 0 || selectionContext) {
      const lines: string[] = ["<obsidian-context>"];

      if (openNotePaths.length > 0) {
        lines.push("Currently open notes in Obsidian:");
        for (const path of openNotePaths) {
          lines.push(`- ${path}`);
        }
      }

      if (selectionContext) {
        lines.push("");
        lines.push(`Selected text (from ${selectionContext.sourcePath}):`);
        lines.push('"""');
        lines.push(selectionContext.text);
        lines.push('"""');
      }

      lines.push("</obsidian-context>");
      contextText = lines.join("\n");
    }

    return {
      openNotePaths,
      selection: selectionContext,
      contextText,
    };
  }
}

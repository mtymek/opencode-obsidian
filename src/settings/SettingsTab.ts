import { App, Plugin, PluginSettingTab, Setting, Notice } from "obsidian";
import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { OpenCodeSettings, ViewLocation } from "../types";
import { ServerManager } from "../server/ServerManager";

function expandTilde(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return path.replace("~", homedir());
  }
  return path;
}

export class OpenCodeSettingTab extends PluginSettingTab {
  private validateTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    app: App,
    plugin: Plugin,
    private settings: OpenCodeSettings,
    private serverManager: ServerManager,
    private onSettingsChange: () => Promise<void>
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "OpenCode Settings" });
    containerEl.createEl("h3", { text: "Server Configuration" });

    new Setting(containerEl)
      .setName("Port")
      .setDesc("Port number for the OpenCode web server")
      .addText((text) =>
        text
          .setPlaceholder("14096")
          .setValue(this.settings.port.toString())
          .onChange(async (value) => {
            const port = parseInt(value, 10);
            if (!isNaN(port) && port > 0 && port < 65536) {
              this.settings.port = port;
              await this.onSettingsChange();
            }
          })
      );

    new Setting(containerEl)
      .setName("Hostname")
      .setDesc("Hostname to bind the server to (usually 127.0.0.1)")
      .addText((text) =>
        text
          .setPlaceholder("127.0.0.1")
          .setValue(this.settings.hostname)
          .onChange(async (value) => {
            this.settings.hostname = value || "127.0.0.1";
            await this.onSettingsChange();
          })
      );

    new Setting(containerEl)
      .setName("OpenCode path")
      .setDesc(
        "Path to the OpenCode executable. Leave as 'opencode' if it's in your PATH."
      )
      .addText((text) =>
        text
          .setPlaceholder("opencode")
          .setValue(this.settings.opencodePath)
          .onChange(async (value) => {
            this.settings.opencodePath = value || "opencode";
            await this.onSettingsChange();
          })
      );

    new Setting(containerEl)
      .setName("Project directory")
      .setDesc(
        "Override the starting directory for OpenCode. Leave empty to use the vault root. Supports ~ for home directory."
      )
      .addText((text) =>
        text
          .setPlaceholder("/path/to/project or ~/project")
          .setValue(this.settings.projectDirectory)
          .onChange((value) => {
            // Debounce validation to avoid spamming notices on every keypress
            if (this.validateTimeout) {
              clearTimeout(this.validateTimeout);
            }
            this.validateTimeout = setTimeout(async () => {
              await this.validateAndSetProjectDirectory(value);
            }, 500);
          })
      );

    containerEl.createEl("h3", { text: "Behavior" });

    new Setting(containerEl)
      .setName("Auto-start server")
      .setDesc(
        "Automatically start the OpenCode server when Obsidian opens (not recommended for faster startup)"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.autoStart)
          .onChange(async (value) => {
            this.settings.autoStart = value;
            await this.onSettingsChange();
          })
      );

    new Setting(containerEl)
      .setName("Default view location")
      .setDesc(
        "Where to open the OpenCode panel: sidebar opens in the right panel, main opens as a tab in the editor area"
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("sidebar", "Sidebar")
          .addOption("main", "Main window")
          .setValue(this.settings.defaultViewLocation)
          .onChange(async (value) => {
            this.settings.defaultViewLocation = value as ViewLocation;
            await this.onSettingsChange();
          })
      );

    containerEl.createEl("h3", { text: "Workspace Context" });

    new Setting(containerEl)
      .setName("Inject workspace context")
      .setDesc(
        "Includes open note paths and selected text in OpenCode when the view is focused"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.injectWorkspaceContext)
          .onChange(async (value) => {
            this.settings.injectWorkspaceContext = value;
            await this.onSettingsChange();
          })
      );

    new Setting(containerEl)
      .setName("Max notes in context")
      .setDesc("Limit how many open notes are included")
      .addSlider((slider) =>
        slider
          .setLimits(1, 50, 1)
          .setValue(this.settings.maxNotesInContext)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.settings.maxNotesInContext = value;
            await this.onSettingsChange();
          })
      );

    new Setting(containerEl)
      .setName("Max selection length")
      .setDesc("Truncate selected text to avoid oversized context")
      .addSlider((slider) =>
        slider
          .setLimits(500, 5000, 100)
          .setValue(this.settings.maxSelectionLength)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.settings.maxSelectionLength = value;
            await this.onSettingsChange();
          })
      );

    containerEl.createEl("h3", { text: "Server Status" });

    const statusContainer = containerEl.createDiv({ cls: "opencode-settings-status" });
    this.renderServerStatus(statusContainer);
  }

  private async validateAndSetProjectDirectory(value: string): Promise<void> {
    const trimmed = value.trim();

    // Empty value is valid - means use vault root
    if (!trimmed) {
      this.serverManager.updateProjectDirectory("");
      await this.onSettingsChange();
      return;
    }

    // Validate absolute path (supports ~, /, and Windows drive letters)
    if (!trimmed.startsWith("/") && !trimmed.startsWith("~") && !trimmed.match(/^[A-Za-z]:\\/)) {
      new Notice("Project directory must be an absolute path (or start with ~)");
      return;
    }

    const expanded = expandTilde(trimmed);

    try {
      if (!existsSync(expanded)) {
        new Notice("Project directory does not exist");
        return;
      }
      const stat = statSync(expanded);
      if (!stat.isDirectory()) {
        new Notice("Project directory path is not a directory");
        return;
      }
    } catch (error) {
      new Notice(`Failed to validate path: ${(error as Error).message}`);
      return;
    }

    this.serverManager.updateProjectDirectory(expanded);
    await this.onSettingsChange();
  }

  private renderServerStatus(container: HTMLElement): void {
    container.empty();

    const state = this.serverManager.getState();
    const statusText = {
      stopped: "Stopped",
      starting: "Starting...",
      running: "Running",
      error: "Error",
    };

    const statusClass = {
      stopped: "status-stopped",
      starting: "status-starting",
      running: "status-running",
      error: "status-error",
    };

    const statusEl = container.createDiv({ cls: "opencode-status-line" });
    statusEl.createSpan({ text: "Status: " });
    statusEl.createSpan({
      text: statusText[state],
      cls: `opencode-status-badge ${statusClass[state]}`,
    });

    if (state === "running") {
      const urlEl = container.createDiv({ cls: "opencode-status-line" });
      urlEl.createSpan({ text: "URL: " });
      const serverUrl = this.serverManager.getUrl();
      const linkEl = urlEl.createEl("a", {
        text: serverUrl,
        href: serverUrl,
      });
      linkEl.addEventListener("click", (e) => {
        e.preventDefault();
        window.open(serverUrl, "_blank");
      });
    }

    const buttonContainer = container.createDiv({ cls: "opencode-settings-buttons" });

    if (state === "stopped" || state === "error") {
      const startButton = buttonContainer.createEl("button", {
        text: "Start Server",
        cls: "mod-cta",
      });
      startButton.addEventListener("click", async () => {
        await this.serverManager.start();
        this.renderServerStatus(container);
      });
    }

    if (state === "running") {
      const stopButton = buttonContainer.createEl("button", {
        text: "Stop Server",
      });
      stopButton.addEventListener("click", () => {
        this.serverManager.stop();
        this.renderServerStatus(container);
      });

      const restartButton = buttonContainer.createEl("button", {
        text: "Restart Server",
        cls: "mod-warning",
      });
      restartButton.addEventListener("click", async () => {
        this.serverManager.stop();
        await this.serverManager.start();
        this.renderServerStatus(container);
      });
    }

    if (state === "starting") {
      buttonContainer.createSpan({
        text: "Please wait...",
        cls: "opencode-status-waiting",
      });
    }
  }
}

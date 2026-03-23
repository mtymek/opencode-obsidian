import { App, Plugin, PluginSettingTab, Setting, Notice } from "obsidian";
import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { OpenCodeSettings, ViewLocation } from "../types";
import { ServerManager, ServerState } from "../server/ServerManager";
import { ExecutableResolver } from "../server/ExecutableResolver";

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
  private statusContainer: HTMLElement | null = null;
  private handleServerStateChange = (): void => {
    if (this.statusContainer) {
      this.renderServerStatus(this.statusContainer);
    }
  };

  constructor(
    app: App,
    plugin: Plugin,
    private settings: OpenCodeSettings,
    private serverManager: ServerManager,
    private onSettingsChange: () => Promise<void>
  ) {
    super(app, plugin);
    this.serverManager.on("stateChange", this.handleServerStateChange);
  }

  hide(): void {
    this.statusContainer = null;
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
              this.renderServerStatusIfAvailable();
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
            this.renderServerStatusIfAvailable();
          })
      );

    new Setting(containerEl)
      .setName("Startup timeout")
      .setDesc("How long to wait for OpenCode to become healthy before reporting a startup failure")
      .addSlider((slider) =>
        slider
          .setLimits(5, 120, 5)
          .setValue(Math.round(this.settings.startupTimeout / 1000))
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.settings.startupTimeout = value * 1000;
            await this.onSettingsChange();
          })
      );

    const customCmdSetting = new Setting(containerEl)
      .setName("Use custom command")
      .setDesc("Enable to use a custom shell command instead of the executable path")
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.useCustomCommand)
          .onChange(async (value) => {
            this.settings.useCustomCommand = value;
            await this.onSettingsChange();
            this.display();
          })
      );

    const descEl = customCmdSetting.descEl;
    descEl.createEl("br");
    const linkEl = descEl.createEl("a", {
      text: "Learn more",
      href: "https://github.com/mtymek/opencode-obsidian#custom-command-mode",
    });
    linkEl.addEventListener("click", (e) => {
      e.preventDefault();
      window.open(linkEl.href, "_blank");
    });

    if (this.settings.useCustomCommand) {
      new Setting(containerEl)
        .setName("Custom command")
        .setDesc("Custom shell command to start OpenCode.")
        .addTextArea((text) => {
          text
            .setPlaceholder("opencode serve --port 14096 --hostname 127.0.0.1 --cors app://obsidian.md")
            .setValue(this.settings.customCommand)
            .onChange(async (value) => {
              this.settings.customCommand = value;
              await this.onSettingsChange();
            });
          text.inputEl.rows = 3;
          text.inputEl.style.width = "100%";
          return text;
        });
    } else {
      const pathSetting = new Setting(containerEl)
        .setName("OpenCode executable path")
        .setDesc("Use a full path if Obsidian cannot find the CLI from your shell environment.")
        .addText((text) =>
          text
            .setPlaceholder("opencode")
            .setValue(this.settings.opencodePath)
            .onChange(async (value) => {
              this.settings.opencodePath = value;
              await this.onSettingsChange();
            })
        );

      pathSetting.addButton((button) => {
        button.setButtonText("Autodetect").onClick(async () => {
          const detectedPath = ExecutableResolver.resolve("opencode");
          if (detectedPath && detectedPath !== "opencode") {
            this.settings.opencodePath = detectedPath;
            await this.onSettingsChange();
            this.display();
            new Notice(`OpenCode executable found at ${detectedPath}`);
          } else {
            new Notice("Could not find opencode. Please check your installation.");
          }
        });
      });
    }

    new Setting(containerEl)
      .setName("Project directory")
      .setDesc(
        "Override the starting directory for OpenCode. Leave empty to use the vault root."
      )
      .addText((text) =>
        text
          .setPlaceholder("/path/to/project or ~/project")
          .setValue(this.settings.projectDirectory)
          .onChange((value) => {
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

    this.statusContainer = containerEl.createDiv({ cls: "opencode-settings-status" });
    this.renderServerStatus(this.statusContainer);
  }

  private renderServerStatusIfAvailable(): void {
    if (this.statusContainer) {
      this.renderServerStatus(this.statusContainer);
    }
  }

  private async validateAndSetProjectDirectory(value: string): Promise<void> {
    const trimmed = value.trim();

    if (!trimmed) {
      this.settings.projectDirectory = "";
      this.serverManager.updateProjectDirectory("");
      await this.onSettingsChange();
      this.renderServerStatusIfAvailable();
      return;
    }

    if (
      !trimmed.startsWith("/") &&
      !trimmed.startsWith("~") &&
      !trimmed.match(/^[A-Za-z]:\\/)
    ) {
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

    this.settings.projectDirectory = expanded;
    this.serverManager.updateProjectDirectory(expanded);
    await this.onSettingsChange();
    this.renderServerStatusIfAvailable();
  }

  private renderServerStatus(container: HTMLElement): void {
    container.empty();

    const state = this.serverManager.getState();
    const statusText: Record<ServerState, string> = {
      stopped: "Stopped",
      starting: "Starting...",
      running: "Running",
      error: "Error",
    };

    const statusClass: Record<ServerState, string> = {
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

    const projectDirectoryEl = container.createDiv({ cls: "opencode-status-line" });
    projectDirectoryEl.createSpan({ text: "Project: " });
    projectDirectoryEl.createSpan({
      text: this.settings.projectDirectory || "Vault root",
    });

    if (state === "error") {
      const errorMsg = this.serverManager.getLastError();
      if (errorMsg) {
        const errorEl = container.createDiv({ cls: "opencode-error-details" });
        errorEl.createEl("div", {
          text: errorMsg,
          cls: "opencode-error-text",
        });
      }
    }

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
        startButton.disabled = true;
        await this.serverManager.start();
        this.renderServerStatus(container);
      });
    }

    if (state === "running") {
      const stopButton = buttonContainer.createEl("button", {
        text: "Stop Server",
      });
      stopButton.addEventListener("click", async () => {
        stopButton.disabled = true;
        await this.serverManager.stop();
        this.renderServerStatus(container);
      });

      const restartButton = buttonContainer.createEl("button", {
        text: "Restart Server",
        cls: "mod-warning",
      });
      restartButton.addEventListener("click", async () => {
        restartButton.disabled = true;
        await this.serverManager.stop();
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

import { App, Plugin, PluginSettingTab, Setting, Notice } from "obsidian";
import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { OpenCodeSettings, ViewLocation } from "../types";
import { ServerManager } from "../server/ServerManager";
import { ExecutableResolver } from "../server/ExecutableResolver";
import { t, Language } from "./i18n";

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

  private lang(): Language {
    return this.settings.language ?? "en";
  }

  display(): void {
    const { containerEl } = this;
    const lg = this.lang();
    containerEl.empty();
    containerEl.createEl("h2", { text: t("settings.title", lg) });
    containerEl.createEl("h3", { text: t("section.language", lg) });

    new Setting(containerEl)
      .setName(t("language.name", lg))
      .setDesc(t("language.desc", lg))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("en", "English")
          .addOption("zh", "中文")
          .setValue(this.settings.language)
          .onChange(async (value) => {
            this.settings.language = value as Language;
            await this.onSettingsChange();
            this.display();
          })
      );

    containerEl.createEl("h3", { text: t("section.server", lg) });

    new Setting(containerEl)
      .setName(t("port.name", lg))
      .setDesc(t("port.desc", lg))
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
      .setName(t("hostname.name", lg))
      .setDesc(t("hostname.desc", lg))
      .addText((text) =>
        text
          .setPlaceholder("127.0.0.1")
          .setValue(this.settings.hostname)
          .onChange(async (value) => {
            this.settings.hostname = value || "127.0.0.1";
            await this.onSettingsChange();
          })
      );

    const customCmdSetting = new Setting(containerEl)
      .setName(t("useCustomCommand.name", lg))
      .setDesc(t("useCustomCommand.desc", lg))
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
      text: t("learnMore", lg),
      href: "https://github.com/mtymek/opencode-obsidian#custom-command-mode"
    });
    linkEl.addEventListener("click", (e) => {
      e.preventDefault();
      window.open(linkEl.href, "_blank");
    });

    if (this.settings.useCustomCommand) {
      new Setting(containerEl)
        .setName(t("customCommand.name", lg))
        .setDesc(t("customCommand.desc", lg))
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
        .setName(t("execPath.name", lg))
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
        button
          .setButtonText(t("autodetect", lg))
          .onClick(async () => {
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
      .setName(t("projectDir.name", lg))
      .setDesc(t("projectDir.desc", lg))
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

    containerEl.createEl("h3", { text: t("section.behavior", lg) });

    new Setting(containerEl)
      .setName(t("autoStart.name", lg))
      .setDesc(t("autoStart.desc", lg))
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.autoStart)
          .onChange(async (value) => {
            this.settings.autoStart = value;
            await this.onSettingsChange();
          })
      );

    new Setting(containerEl)
      .setName(t("viewLocation.name", lg))
      .setDesc(t("viewLocation.desc", lg))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("sidebar", t("viewLocation.sidebar", lg))
          .addOption("main", t("viewLocation.main", lg))
          .setValue(this.settings.defaultViewLocation)
          .onChange(async (value) => {
            this.settings.defaultViewLocation = value as ViewLocation;
            await this.onSettingsChange();
          })
      );

    containerEl.createEl("h3", { text: t("section.context", lg) });

    new Setting(containerEl)
      .setName(t("injectContext.name", lg))
      .setDesc(t("injectContext.desc", lg))
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.injectWorkspaceContext)
          .onChange(async (value) => {
            this.settings.injectWorkspaceContext = value;
            await this.onSettingsChange();
          })
      );

    new Setting(containerEl)
      .setName(t("maxNotes.name", lg))
      .setDesc(t("maxNotes.desc", lg))
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
      .setName(t("maxSelection.name", lg))
      .setDesc(t("maxSelection.desc", lg))
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

    containerEl.createEl("h3", { text: t("section.sessions", lg) });

    new Setting(containerEl)
      .setName(t("maxSessions.name", lg))
      .setDesc(t("maxSessions.desc", lg))
      .addSlider((slider) =>
        slider
          .setLimits(1, 20, 1)
          .setValue(this.settings.maxSessions)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.settings.maxSessions = value;
            await this.onSettingsChange();
          })
      );

    containerEl.createEl("h3", { text: t("section.status", lg) });

    const statusContainer = containerEl.createDiv({ cls: "opencode-settings-status" });
    this.renderServerStatus(statusContainer);
  }

  private async validateAndSetProjectDirectory(value: string): Promise<void> {
    const trimmed = value.trim();

    if (!trimmed) {
      this.serverManager.updateProjectDirectory("");
      await this.onSettingsChange();
      return;
    }

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
    const lg = this.lang();

    const state = this.serverManager.getState();
    const statusText: Record<string, string> = {
      stopped: t("status.stopped", lg),
      starting: t("status.starting", lg),
      running: t("status.running", lg),
      error: t("status.error", lg),
    };

    const statusClass = {
      stopped: "status-stopped",
      starting: "status-starting",
      running: "status-running",
      error: "status-error",
    };

    const statusEl = container.createDiv({ cls: "opencode-status-line" });
    statusEl.createSpan({ text: t("status.label", lg) });
    statusEl.createSpan({
      text: statusText[state] ?? state,
      cls: `opencode-status-badge ${statusClass[state]}`,
    });

    if (state === "error") {
      const errorMsg = this.serverManager.getLastError();
      if (errorMsg) {
        const errorEl = container.createDiv({ cls: "opencode-error-details" });
        errorEl.createEl("div", {
          text: errorMsg,
          cls: "opencode-error-text"
        });
      }
    }

    if (state === "running") {
      const urlEl = container.createDiv({ cls: "opencode-status-line" });
      urlEl.createSpan({ text: t("url.label", lg) });
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
        text: t("btn.start", lg),
        cls: "mod-cta",
      });
      startButton.addEventListener("click", async () => {
        await this.serverManager.start();
        this.renderServerStatus(container);
      });
    }

    if (state === "running") {
      const stopButton = buttonContainer.createEl("button", {
        text: t("btn.stop", lg),
      });
      stopButton.addEventListener("click", () => {
        this.serverManager.stop();
        this.renderServerStatus(container);
      });

      const restartButton = buttonContainer.createEl("button", {
        text: t("btn.restart", lg),
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
        text: t("status.waiting", lg),
        cls: "opencode-status-waiting",
      });
    }
  }
}

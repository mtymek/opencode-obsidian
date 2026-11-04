import { ChildProcess, SpawnOptions } from "child_process";
import { EventEmitter } from "events";
import { createHash } from "crypto";
import { OpenCodeSettings } from "../types";
import { ServerState } from "./types";
import { OpenCodeProcess } from "./process/OpenCodeProcess";
import { WindowsProcess } from "./process/WindowsProcess";
import { PosixProcess } from "./process/PosixProcess";
import { ExecutableResolver } from "./ExecutableResolver";
import { buildAuthHeader, normalizeServerUrl } from "../lib/serverUrl";
import { httpRequestJson } from "../lib/http";

export type { ServerState } from "./types";

/** Health probe outcome: authenticated, rejected, or nothing listening. */
type HealthStatus = "ok" | "unauthorized" | "down";

export class ServerManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private state: ServerState = "stopped";
  private lastError: string | null = null;
  private earlyExitCode: number | null = null;
  private settings: OpenCodeSettings;
  private projectDirectory: string;
  private processImpl: OpenCodeProcess;

  constructor(settings: OpenCodeSettings, projectDirectory: string) {
    super();
    this.settings = settings;
    this.projectDirectory = projectDirectory;
    this.processImpl =
      process.platform === "win32" ? new WindowsProcess() : new PosixProcess();
  }

  updateSettings(settings: OpenCodeSettings): void {
    this.settings = settings;
  }

  updateProjectDirectory(directory: string): void {
    this.projectDirectory = directory;
    this.emit("projectDirectoryChanged", directory);
  }

  getState(): ServerState {
    return this.state;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * OpenCode 2 serves one web app per server and no longer encodes the project
   * directory in the URL; the directory is selected by the session instead.
   */
  getUrl(): string {
    return normalizeServerUrl(`http://${this.settings.hostname}:${this.settings.port}`);
  }

  /**
   * Password handed to the server via OPENCODE_SERVER_PASSWORD.
   *
   * It is derived from host and port so that a server left over from a previous
   * Obsidian session still accepts our credentials instead of failing with 401
   * "port already in use". Derived from port/host only (not the vault path) so
   * switching the project directory does not invalidate a running server.
   */
  getPassword(): string {
    return createHash("sha256")
      .update(`obsidian-opencode:${this.settings.hostname}:${this.settings.port}`)
      .digest("hex")
      .slice(0, 32);
  }

  getAuthHeader(): string {
    return buildAuthHeader(this.getPassword());
  }

  async start(): Promise<boolean> {
    if (this.state === "running" || this.state === "starting") {
      return true;
    }

    this.setState("starting");
    this.lastError = null;
    this.earlyExitCode = null;

    if (!this.projectDirectory) {
      return this.setError("Project directory (vault) not configured");
    }

    // Determine execution mode and resolve executable path
    let executablePath: string;
    let spawnOptions: SpawnOptions;

    if (this.settings.useCustomCommand) {
      // Custom command mode: use custom command directly with shell
      executablePath = this.settings.customCommand;
      spawnOptions = {
        cwd: this.projectDirectory,
        env: this.buildEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      };
    } else {
      // Path mode: resolve executable and verify
      executablePath = ExecutableResolver.resolve(this.settings.opencodePath);

      // Pre-flight check: verify executable exists (only for path mode)
      const commandError = await this.processImpl.verifyCommand(executablePath);
      if (commandError) {
        return this.setError(commandError);
      }

      spawnOptions = {
        cwd: this.projectDirectory,
        env: this.buildEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      };
    }

    const health = await this.checkServerHealth();
    if (health === "ok") {
      console.log("[OpenCode] Server already running on port", this.settings.port);
      this.setState("running");
      return true;
    }
    if (health === "unauthorized") {
      return this.setError(
        `Port ${this.settings.port} is already used by an OpenCode server that rejects this plugin's password. Stop that server (or change the port in the plugin settings) and retry.`
      );
    }

    console.log("[OpenCode] Starting server:", {
      mode: this.settings.useCustomCommand ? "custom" : "path",
      command: executablePath,
      port: this.settings.port,
      hostname: this.settings.hostname,
      cwd: this.projectDirectory,
      projectDirectory: this.projectDirectory,
    });

    if (this.settings.useCustomCommand) {
      // Custom command mode: spawn with shell, no args appended
      this.process = this.processImpl.start(
        executablePath,
        [], // User controls all arguments in custom command
        spawnOptions
      );
    } else {
      // Path mode: spawn with default arguments
      this.process = this.processImpl.start(
        executablePath,
        [
          "serve",
          "--port",
          this.settings.port.toString(),
          "--hostname",
          this.settings.hostname,
          "--cors",
          "app://obsidian.md",
        ],
        spawnOptions
      );
    }

    console.log("[OpenCode] Process spawned with PID:", this.process.pid);

    this.process.stdout?.on("data", (data) => {
      console.log("[OpenCode]", data.toString().trim());
    });

    this.process.stderr?.on("data", (data) => {
      console.error("[OpenCode Error]", data.toString().trim());
    });

    this.process.on("exit", (code, signal) => {
      console.log(
        `[OpenCode] Process exited with code ${code}, signal ${signal}`
      );
      this.process = null;

      if (this.state === "starting" && code !== null && code !== 0) {
        this.earlyExitCode = code;
      }

      if (this.state === "running") {
        this.setState("stopped");
      }
    });

    this.process.on("error", (err: NodeJS.ErrnoException) => {
      console.error("[OpenCode] Failed to start process:", err);
      this.process = null;

      if (err.code === "ENOENT") {
        const command = this.settings.useCustomCommand
          ? this.settings.customCommand
          : this.settings.opencodePath;
        this.setError(`Executable not found: '${command}'`);
      } else {
        this.setError(`Failed to start: ${err.message}`);
      }
    });

    const ready = await this.waitForServerOrExit(this.settings.startupTimeout);
    if (ready) {
      this.setState("running");
      return true;
    }

    if (this.state === "error") {
      return false;
    }

    await this.stop();
    if (this.earlyExitCode !== null) {
      return this.setError(
        `Process exited unexpectedly (exit code ${this.earlyExitCode})`
      );
    }
    if (!this.process) {
      return this.setError("Process exited before server became ready");
    }
    return this.setError("Server failed to start within timeout");
  }

  async stop(): Promise<void> {
    if (!this.process) {
      this.setState("stopped");
      return;
    }

    const proc = this.process;

    this.setState("stopped");
    this.process = null;

    await this.processImpl.stop(proc);
  }

  private buildEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      NODE_USE_SYSTEM_CA: "1",
      // OpenCode 2 prints a random password unless one is supplied. Supplying a
      // stable one keeps the embedded web UI authenticated across restarts.
      OPENCODE_SERVER_PASSWORD: this.getPassword(),
    };
  }

  private setState(state: ServerState): void {
    this.state = state;
    this.emit("stateChange", state);
  }

  private setError(message: string): false {
    this.lastError = message;
    console.error("[OpenCode Error]", message);
    this.setState("error");
    return false;
  }

  /**
   * OpenCode 2 exposes its API under /api. A request without valid credentials
   * returns 401 - which distinguishes "server we may talk to" from "some other
   * server squatting on our port".
   */
  private async checkServerHealth(): Promise<HealthStatus> {
    try {
      // node:http, not fetch: renderer fetch is CORS-blocked against the server.
      const response = await httpRequestJson("GET", `${this.getUrl()}/api/info`, {
        headers: { Authorization: this.getAuthHeader() },
        timeoutMs: 2000,
      });
      if (response.ok) {
        return "ok";
      }
      if (response.status === 401) {
        return "unauthorized";
      }
      return "down";
    } catch {
      return "down";
    }
  }

  private async waitForServerOrExit(timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 500;

    while (Date.now() - startTime < timeoutMs) {
      if (!this.process) {
        console.log("[OpenCode] Process exited before server became ready");
        return false;
      }

      if ((await this.checkServerHealth()) === "ok") {
        return true;
      }
      await this.sleep(pollInterval);
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

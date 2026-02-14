import { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { OpenCodeSettings } from "../types";
import { ServerState } from "./types";
import { OpenCodeProcess } from "./process/OpenCodeProcess";
import { WindowsProcess } from "./process/WindowsProcess";
import { PosixProcess } from "./process/PosixProcess";

export type { ServerState } from "./types";

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

  getUrl(): string {
    const encodedPath = btoa(this.projectDirectory);
    return `http://${this.settings.hostname}:${this.settings.port}/${encodedPath}`;
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

    // Pre-flight check: verify executable exists
    const commandError = await this.processImpl.verifyCommand(this.settings.opencodePath);
    if (commandError) {
      return this.setError(commandError);
    }

    if (await this.checkServerHealth()) {
      console.log(
        "[OpenCode] Server already running on port",
        this.settings.port
      );
      this.setState("running");
      return true;
    }

    console.log("[OpenCode] Starting server:", {
      opencodePath: this.settings.opencodePath,
      port: this.settings.port,
      hostname: this.settings.hostname,
      cwd: this.projectDirectory,
      projectDirectory: this.projectDirectory,
    });

    this.process = this.processImpl.start(
      this.settings.opencodePath,
      [
        "serve",
        "--port",
        this.settings.port.toString(),
        "--hostname",
        this.settings.hostname,
        "--cors",
        "app://obsidian.md",
      ],
      {
        cwd: this.projectDirectory,
        env: { ...process.env, NODE_USE_SYSTEM_CA: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

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
        this.setError(
          `Executable not found at '${this.settings.opencodePath}'`
        );
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

  private async checkServerHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getUrl()}/global/health`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
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

      if (await this.checkServerHealth()) {
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

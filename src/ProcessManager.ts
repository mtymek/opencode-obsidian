import { spawn, ChildProcess } from "child_process";
import { OpenCodeSettings } from "./types";

export type ProcessState = "stopped" | "starting" | "running" | "error";

export class ProcessManager {
  private process: ChildProcess | null = null;
  private state: ProcessState = "stopped";
  private lastError: string | null = null;
  private earlyExitCode: number | null = null;
  private settings: OpenCodeSettings;
  private projectDirectory: string;
  private onStateChange: (state: ProcessState) => void;

  constructor(
    settings: OpenCodeSettings,
    projectDirectory: string,
    onStateChange: (state: ProcessState) => void
  ) {
    this.settings = settings;
    this.projectDirectory = projectDirectory;
    this.onStateChange = onStateChange;
  }

  updateSettings(settings: OpenCodeSettings): void {
    this.settings = settings;
  }

  updateProjectDirectory(directory: string): void {
    this.projectDirectory = directory;
  }

  getState(): ProcessState {
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

    if (await this.checkServerHealth()) {
      console.log("[OpenCode] Server already running on port", this.settings.port);
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

    this.process = spawn(
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
        detached: false,
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
      console.log(`[OpenCode] Process exited with code ${code}, signal ${signal}`);
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
        this.setError(`Executable not found at '${this.settings.opencodePath}'`);
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

    this.stop();
    if (this.earlyExitCode !== null) {
      return this.setError(`Process exited unexpectedly (exit code ${this.earlyExitCode})`);
    }
    if (!this.process) {
      return this.setError("Process exited before server became ready");
    }
    return this.setError("Server failed to start within timeout");
  }

  stop(): void {
    if (!this.process) {
      this.setState("stopped");
      return;
    }

    const proc = this.process;
    console.log("[OpenCode] Stopping process with PID:", proc.pid);

    this.setState("stopped");
    this.process = null;

    proc.kill("SIGTERM");

    // Force kill after 2 seconds if still running
    setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        console.log("[OpenCode] Process still running, sending SIGKILL");
        proc.kill("SIGKILL");
      }
    }, 2000);
  }

  private setState(state: ProcessState): void {
    this.state = state;
    this.onStateChange(state);
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

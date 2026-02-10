import { spawn, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { OpenCodeSettings } from "./types";

export type ProcessState = "stopped" | "starting" | "running" | "error";

const LINUX_USER_BIN_PATHS = [
  ".local/bin",
  ".opencode/bin",
  ".bun/bin",
  ".npm-global/bin",
  ".nvm/versions/node/*/bin",
];

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

    const executablePath = this.findOpenCodeExecutable();

    console.log("[OpenCode] Starting server:", {
      opencodePath: executablePath,
      port: this.settings.port,
      hostname: this.settings.hostname,
      cwd: this.projectDirectory,
      projectDirectory: this.projectDirectory,
    });

    this.process = spawn(
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
      {
        cwd: this.projectDirectory,
        env: { ...process.env, NODE_USE_SYSTEM_CA: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
        windowsHide: true,
        detached: (process.platform !== "win32"),
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

    await this.stop();
    if (this.earlyExitCode !== null) {
      return this.setError(`Process exited unexpectedly (exit code ${this.earlyExitCode})`);
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

    const pid = this.process.pid;
    const proc = this.process;
    
    if (!pid) {
      console.log("[OpenCode] No PID available, cleaning up state");
      this.setState("stopped");
      this.process = null;
      return;
    }
    
    console.log("[OpenCode] Stopping server process tree, PID:", pid);

    this.setState("stopped");
    this.process = null;

    await this.killProcessTree(pid, "SIGTERM");

    const gracefulExited = await this.waitForProcessExit(proc, 2000);

    if (gracefulExited) {
      console.log("[OpenCode] Server stopped gracefully");
      return;
    }

    console.log("[OpenCode] Process didn't exit gracefully, sending SIGKILL");

    await this.killProcessTree(pid, "SIGKILL");

    // Step 4: Wait for force kill (up to 3 more seconds)
    const forceExited = await this.waitForProcessExit(proc, 3000);

    if (forceExited) {
      console.log("[OpenCode] Server stopped with SIGKILL");
    } else {
      console.error("[OpenCode] Failed to stop server within timeout");
    }
  }

  private async killProcessTree(pid: number, signal: "SIGTERM" | "SIGKILL"): Promise<void> {
    const platform = process.platform;

    if (platform === "win32") {
      // Windows: Use taskkill with /T flag to kill process tree
      await this.execAsync(`taskkill /T /F /PID ${pid}`);
      return;
    }

    // Unix: Try process group kill (negative PID)
    process.kill(-pid, signal);
    return;
  }

  private async waitForProcessExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      return true; // Already exited
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);

      const onExit = () => {
        cleanup();
        resolve(true);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        proc.off("exit", onExit);
        proc.off("error", onExit);
      };

      proc.once("exit", onExit);
      proc.once("error", onExit);
    });
  }

  private execAsync(command: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const { exec } = require("child_process");
      exec(command, (error: Error | null) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
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

  private findOpenCodeExecutable(): string {
    const configuredPath = this.settings.opencodePath;

    if (existsSync(configuredPath)) {
      return configuredPath;
    }

    const baseName = configuredPath.split("/").pop() || configuredPath;
    const homeDir = homedir();
    const currentPlatform = platform();

    const searchPaths: string[] = [];

    if (currentPlatform === "linux" || currentPlatform === "darwin") {
      for (const relativePath of LINUX_USER_BIN_PATHS) {
        if (relativePath.includes("*")) {
          continue;
        }
        searchPaths.push(join(homeDir, relativePath));
      }

      searchPaths.push("/usr/local/bin");
      searchPaths.push("/usr/bin");
    }

    for (const searchPath of searchPaths) {
      const fullPath = join(searchPath, baseName);
      if (existsSync(fullPath)) {
        console.log("[OpenCode] Found executable at:", fullPath);
        return fullPath;
      }
    }

    console.log("[OpenCode] Executable not found in common paths, using configured:", configuredPath);
    return configuredPath;
  }
}

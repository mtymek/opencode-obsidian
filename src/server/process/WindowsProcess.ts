import { ChildProcess, spawn, SpawnOptions } from "child_process";
import { OpenCodeProcess } from "./OpenCodeProcess";

export class WindowsProcess implements OpenCodeProcess {
  // Static state to track the current process for cleanup
  private static currentProcess: ChildProcess | null = null;
  private static cleanupHandlerRegistered = false;

  start(
    command: string,
    args: string[],
    options: SpawnOptions
  ): ChildProcess {
    const process = spawn(command, args, {
      ...options,
      shell: true,
      windowsHide: true,
    });

    // Store process for cleanup
    WindowsProcess.currentProcess = process;
    WindowsProcess.registerCleanupHandler();

    return process;
  }

  async stop(process: ChildProcess): Promise<void> {
    const pid = process.pid;
    if (!pid) {
      WindowsProcess.currentProcess = null;
      return;
    }

    console.log("[OpenCode] Stopping server process tree, PID:", pid);

    // Use /T flag to kill the entire process tree (cmd.exe -> node.exe -> opencode.exe)
    // This is more reliable than manually finding child processes
    try {
      await this.execAsync(`taskkill /F /T /PID ${pid}`);
    } catch {
      // Process tree may already be gone; try individual kill as fallback
      try {
        await this.execAsync(`taskkill /F /PID ${pid}`);
      } catch {
        // Parent may already be gone
      }
    }

    // Clear stored process
    WindowsProcess.currentProcess = null;

    // Wait for process to exit
    await this.waitForExit(process, 5000);
  }

  private static registerCleanupHandler(): void {
    if (WindowsProcess.cleanupHandlerRegistered) {
      return;
    }

    // Register beforeunload handler for window close cleanup
    // Skip in CI/test environments to avoid interfering with test lifecycle
    if (typeof window !== "undefined" && !process.env.CI) {
      window.addEventListener("beforeunload", () => {
        if (WindowsProcess.currentProcess?.pid) {
          WindowsProcess.killProcessSync(WindowsProcess.currentProcess.pid);
        }
      });
      WindowsProcess.cleanupHandlerRegistered = true;
    }
  }

  private static killProcessSync(pid: number): void {
    try {
      const { execSync } = require("child_process");

      // Kill entire process tree synchronously (for beforeunload handler)
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
      } catch {
        // Fallback: kill just the parent
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
        } catch {
          // Process may already be gone
        }
      }
    } catch {
      // Process may already be gone
    }
  }

  /** Find the PID of the process listening on a given port. Returns null if not found. */
  static async findPidOnPort(port: number): Promise<number | null> {
    try {
      const { execSync } = require("child_process");
      const output = execSync(
        `powershell -Command "(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess"`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
      );
      const pid = parseInt(output.trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /** Kill a process by PID (entire process tree). Returns true if killed. */
  static async killPid(pid: number): Promise<boolean> {
    try {
      const { execSync } = require("child_process");
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  /** Check if a process with the given PID actually exists. */
  static async processExists(pid: number): Promise<boolean> {
    try {
      const { execSync } = require("child_process");
      execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      // tasklist always exits 0; check if the PID appears in output
      const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      return output.includes(pid.toString());
    } catch {
      return false;
    }
  }

  /** Find an available TCP port starting from `startPort`. */
  static async findAvailablePort(startPort: number): Promise<number> {
    const { execSync } = require("child_process");
    for (let port = startPort; port < startPort + 100; port++) {
      try {
        const output = execSync(
          `powershell -Command "(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess"`,
          { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
        );
        const pid = parseInt(output.trim(), 10);
        if (isNaN(pid)) return port; // No listener on this port
      } catch {
        return port; // Get-NetTCPConnection throws when no connections found
      }
    }
    return startPort; // Fallback
  }

  async verifyCommand(command: string): Promise<string | null> {
    // Use 'where' command to check if executable exists in PATH
    try {
      await this.execAsync(`where "${command}"`);
      return null;
    } catch {
      return `Executable not found at '${command}'. Check Settings → OpenCode path, or click "Autodetect"`;
    }
  }

  private async waitForExit(
    process: ChildProcess,
    timeoutMs: number
  ): Promise<void> {
    if (process.exitCode !== null || process.signalCode !== null) {
      return; // Already exited
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);

      const onExit = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        clearTimeout(timeout);
        process.off("exit", onExit);
        process.off("error", onExit);
      };

      process.once("exit", onExit);
      process.once("error", onExit);
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
}

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

    // Method 1: Find and kill child processes (actual node.exe) using PowerShell
    // This is necessary because shell: true spawns cmd.exe -> node.exe, and
    // killing cmd.exe leaves node.exe orphaned
    try {
      const { execSync } = require("child_process");
      const output = execSync(
        `powershell -Command "Get-CimInstance Win32_Process -Filter \\"ParentProcessId=${pid}\\" | Select-Object ProcessId"`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
      );

      const lines = output.split("\n").slice(3); // Skip headers
      for (const line of lines) {
        const childPid = line.trim();
        if (childPid && !isNaN(parseInt(childPid))) {
          try {
            execSync(`taskkill /F /PID ${childPid}`, { stdio: "ignore" });
          } catch {
            // Child may already be gone
          }
        }
      }
    } catch {
      // PowerShell lookup failed, continue to other methods
    }

    // Method 2: Kill the parent process (cmd.exe)
    try {
      await this.execAsync(`taskkill /F /PID ${pid}`);
    } catch {
      // Parent may already be gone
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

      // Method 1: Kill child processes using PowerShell
      try {
        const output = execSync(
          `powershell -Command "Get-CimInstance Win32_Process -Filter \\"ParentProcessId=${pid}\\" | Select-Object ProcessId"`,
          { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
        );

        const lines = output.split("\n").slice(3);
        for (const line of lines) {
          const childPid = line.trim();
          if (childPid && !isNaN(parseInt(childPid))) {
            try {
              execSync(`taskkill /F /PID ${childPid}`, { stdio: "ignore" });
            } catch {
              // Child may already be gone
            }
          }
        }
      } catch {
        // PowerShell lookup failed
      }

      // Method 2: Kill parent process
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
      } catch {
        // Parent may already be gone
      }
    } catch {
      // Process may already be gone
    }
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

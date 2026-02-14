import { ChildProcess, spawn, SpawnOptions } from "child_process";
import { OpenCodeProcess } from "./OpenCodeProcess";

export class PosixProcess implements OpenCodeProcess {
  start(
    command: string,
    args: string[],
    options: SpawnOptions
  ): ChildProcess {
    return spawn(command, args, {
      ...options,
      detached: true, // Creates a new process group
    });
  }

  async stop(process: ChildProcess): Promise<void> {
    const pid = process.pid;
    if (!pid) {
      return;
    }

    console.log("[OpenCode] Stopping server process tree, PID:", pid);

    // Try graceful termination first
    await this.killProcessGroup(pid, "SIGTERM");
    const gracefulExited = await this.waitForExit(process, 2000);

    if (gracefulExited) {
      console.log("[OpenCode] Server stopped gracefully");
      return;
    }

    console.log("[OpenCode] Process didn't exit gracefully, sending SIGKILL");

    // Force kill
    await this.killProcessGroup(pid, "SIGKILL");
    const forceExited = await this.waitForExit(process, 3000);

    if (forceExited) {
      console.log("[OpenCode] Server stopped with SIGKILL");
    } else {
      console.error("[OpenCode] Failed to stop server within timeout");
    }
  }

  async verifyCommand(command: string): Promise<string | null> {
    // Check if command is absolute path - verify it exists and is executable
    if (command.startsWith('/') || command.startsWith('./')) {
      try {
        const fs = require('fs');
        fs.accessSync(command, fs.constants.X_OK);
        return null;
      } catch {
        return `Executable not found at '${command}'`;
      }
    }
    // For non-absolute paths, let spawn handle it (will fire ENOENT if not found)
    return null;
  }

  private async killProcessGroup(
    pid: number,
    signal: "SIGTERM" | "SIGKILL"
  ): Promise<void> {
    try {
      // Negative PID kills the entire process group
      process.kill(-pid, signal);
    } catch (error) {
      // Process may already be gone
      console.log(`[OpenCode] Signal ${signal} failed (process may already be gone)`);
    }
  }

  private async waitForExit(
    process: ChildProcess,
    timeoutMs: number
  ): Promise<boolean> {
    if (process.exitCode !== null || process.signalCode !== null) {
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
        process.off("exit", onExit);
        process.off("error", onExit);
      };

      process.once("exit", onExit);
      process.once("error", onExit);
    });
  }
}

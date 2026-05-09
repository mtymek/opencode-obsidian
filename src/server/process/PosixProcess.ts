import { ChildProcess, spawn, SpawnOptions } from "child_process";
import { existsSync } from "fs";
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

  /** Find the PID of the process listening on a given port. Returns null if not found. */
  static async findPidOnPort(port: number): Promise<number | null> {
    try {
      const { execSync } = require("child_process");
      const output = execSync(`lsof -iTCP:${port} -sTCP:LISTEN -t`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      const pid = parseInt(output.trim().split("\n")[0], 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /** Kill a process by PID (entire process group). Returns true if killed. */
  static async killPid(pid: number): Promise<boolean> {
    try {
      process.kill(-pid, "SIGKILL");
      return true;
    } catch {
      try {
        process.kill(pid, "SIGKILL");
        return true;
      } catch {
        return false;
      }
    }
  }

  async verifyCommand(command: string): Promise<string | null> {
    // Check if command is absolute path - verify it exists and is executable
    if (command.startsWith('/') || command.startsWith('./')) {
      const fs = require('fs');
      try {
        fs.accessSync(command, fs.constants.X_OK);
        return null;
      } catch (err: any) {
        // Check if file exists but isn't executable
        if (existsSync(command)) {
          return `'${command}' exists but is not executable. Run: chmod +x ${command}`;
        }
        return `Executable not found at '${command}'. Check Settings → OpenCode path, or click "Autodetect"`;
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

import { ChildProcess, SpawnOptions } from "child_process";

export interface OpenCodeProcess {
  /** Start the process. Returns a handle to listen for events. */
  start(
    command: string,
    args: string[],
    options: SpawnOptions
  ): ChildProcess;

  /** Stop the process gracefully, then forcefully if needed.
   *  Resolves when process has exited.
   *  Handles all PID/process tree logic internally. */
  stop(process: ChildProcess): Promise<void>;

  /** Verify that command exists and is executable. Returns error message or null if OK. */
  verifyCommand(command: string): Promise<string | null>;
}

import { existsSync, readdirSync } from "fs";
import { homedir, platform } from "os";
import { join, basename, isAbsolute } from "path";
import { execSync } from "child_process";

/**
 * Resolves the opencode executable path across different platforms.
 * Follows the search algorithm:
 * 1. If configured path is absolute and exists, return it directly
 * 2. Check the current PATH using which/where
 * 3. Extract basename from configured path
 * 4. Search platform-specific locations for that basename
 * 5. If found, return full path; if not found, return configured path as fallback
 */
export class ExecutableResolver {
  /**
   * Resolve the executable path based on configuration and platform
   * @param configuredPath The path configured in settings (e.g., "opencode" or "/path/to/opencode")
   * @returns The resolved full path or the configured path as fallback
   */
  static resolve(configuredPath: string): string {
    if (isAbsolute(configuredPath) && existsSync(configuredPath)) {
      return configuredPath;
    }

    const execName = basename(configuredPath) || configuredPath;
    const pathMatch = this.resolveFromPath(execName);
    if (pathMatch) {
      console.log("[OpenCode] Found executable in PATH:", pathMatch);
      return pathMatch;
    }

    const searchDirs = this.getSearchDirectories();

    for (const dir of searchDirs) {
      const fullPath = join(dir, execName);
      if (existsSync(fullPath)) {
        console.log("[OpenCode] Found executable at:", fullPath);
        return fullPath;
      }

      if (platform() === "win32") {
        const cmdPath = `${fullPath}.cmd`;
        if (existsSync(cmdPath)) {
          console.log("[OpenCode] Found executable at:", cmdPath);
          return cmdPath;
        }
      }
    }

    console.log("[OpenCode] Executable not found in common paths, using configured:", configuredPath);
    return configuredPath;
  }

  static resolveFromPath(execName: string): string | null {
    try {
      const command = platform() === "win32" ? "where" : "which";
      const result = execSync(`${command} "${execName}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      const path = result.trim().split("\n")[0];
      if (path && existsSync(path)) {
        return path;
      }
    } catch {
      // Command not found in PATH.
    }
    return null;
  }

  private static getSearchDirectories(): string[] {
    const currentPlatform = platform();
    const homeDir = homedir();
    const searchDirs = new Set<string>();

    if (currentPlatform === "linux" || currentPlatform === "darwin") {
      [
        join(homeDir, ".local", "bin"),
        join(homeDir, ".opencode", "bin"),
        join(homeDir, ".bun", "bin"),
        join(homeDir, ".npm-global", "bin"),
        ...this.expandNvmDirectories(homeDir),
        "/usr/local/bin",
        "/usr/bin",
      ].forEach((dir) => searchDirs.add(dir));

      if (currentPlatform === "darwin") {
        searchDirs.add("/opt/homebrew/bin");
      }
    } else if (currentPlatform === "win32") {
      const localAppData = process.env.LOCALAPPDATA || join(homeDir, "AppData", "Local");
      const userProfile = process.env.USERPROFILE || homeDir;

      [
        join(localAppData, "opencode", "bin"),
        join(userProfile, ".bun", "bin"),
        join(userProfile, ".local", "bin"),
        join(userProfile, "AppData", "Roaming", "npm"),
      ].forEach((dir) => searchDirs.add(dir));
    }

    return [...searchDirs];
  }

  private static expandNvmDirectories(homeDir: string): string[] {
    const nvmBaseDir = join(homeDir, ".nvm", "versions", "node");
    const nvmDirs: string[] = [];

    try {
      if (existsSync(nvmBaseDir)) {
        const versions = readdirSync(nvmBaseDir, { withFileTypes: true });
        for (const version of versions) {
          if (version.isDirectory()) {
            nvmDirs.push(join(nvmBaseDir, version.name, "bin"));
          }
        }
      }
    } catch {
      // nvm directory doesn't exist or is not accessible
    }

    return nvmDirs;
  }
}

import { existsSync } from "fs";
import { homedir, platform } from "os";
import { join, basename, isAbsolute } from "path";
import { execSync } from "child_process";

/**
 * Resolves the opencode executable path across different platforms.
 * Follows the search algorithm:
 * 1. If configured path is absolute and exists, return it directly
 * 2. Extract basename from configured path
 * 3. Search platform-specific locations for that basename
 * 4. If found, return full path; if not found, return configured path as fallback
 */
export class ExecutableResolver {
  /**
   * Resolve the executable path based on configuration and platform
   * @param configuredPath The path configured in settings (e.g., "opencode" or "/path/to/opencode")
   * @returns The resolved full path or the configured path as fallback
   */
  static resolve(configuredPath: string): string {
    // If configured path is absolute and exists, use it directly
    if (isAbsolute(configuredPath) && existsSync(configuredPath)) {
      return configuredPath;
    }

    // Extract basename (e.g., "opencode" from "/path/to/opencode" or just "opencode")
    const execName = basename(configuredPath) || configuredPath;
    
    // Get search directories for current platform
    const searchDirs = this.getSearchDirectories();
    
    // Search for executable in platform directories
    for (const dir of searchDirs) {
      const fullPath = join(dir, execName);
      if (existsSync(fullPath)) {
        console.log("[OpenCode] Found executable at:", fullPath);
        return fullPath;
      }
    }

    // Fallback: return configured path (let spawn fail naturally if not found)
    console.log("[OpenCode] Executable not found in common paths, using configured:", configuredPath);
    return configuredPath;
  }

  /**
   * Check if executable exists in PATH
   * @param execName Name of executable to search for
   * @returns Full path if found in PATH, null otherwise
   */
  static resolveFromPath(execName: string): string | null {
    try {
      // Use 'which' on Unix systems, 'where' on Windows
      const command = platform() === "win32" ? "where" : "which";
      const result = execSync(`${command} "${execName}"`, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
      const path = result.trim().split("\n")[0];
      if (path && existsSync(path)) {
        return path;
      }
    } catch {
      // Command not found in PATH
    }
    return null;
  }

  /**
   * Get platform-specific directories to search for executables
   */
  static getSearchDirectories(): string[] {
    const currentPlatform = platform();
    const homeDir = homedir();
    const searchDirs: string[] = [];

    if (currentPlatform === "linux" || currentPlatform === "darwin") {
      // User directories
      searchDirs.push(
        join(homeDir, ".local", "bin"),
        join(homeDir, ".opencode", "bin"),
        join(homeDir, ".bun", "bin"),
        join(homeDir, ".npm-global", "bin")
      );

      // nvm directories (expand wildcard)
      const nvmDirs = this.expandNvmDirectories(homeDir);
      searchDirs.push(...nvmDirs);

      // System directories
      searchDirs.push("/usr/local/bin", "/usr/bin");

      // macOS-specific directories
      if (currentPlatform === "darwin") {
        searchDirs.push("/opt/homebrew/bin");
      }
    } else if (currentPlatform === "win32") {
      // Windows directories with environment variable expansion
      const localAppData = process.env.LOCALAPPDATA || join(homeDir, "AppData", "Local");
      const userProfile = process.env.USERPROFILE || homeDir;

      searchDirs.push(
        join(localAppData, "opencode", "bin"),
        join(userProfile, ".bun", "bin"),
        join(userProfile, ".local", "bin")
      );
    }

    return searchDirs;
  }

  /**
   * Expand nvm wildcard directories
   * Searches ~/.nvm/versions/node/ for installed versions
   */
  private static expandNvmDirectories(homeDir: string): string[] {
    const nvmBaseDir = join(homeDir, ".nvm", "versions", "node");
    const nvmDirs: string[] = [];

    try {
      if (existsSync(nvmBaseDir)) {
        const { readdirSync } = require("fs");
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

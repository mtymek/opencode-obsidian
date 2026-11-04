import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { ServerManager, ServerState } from "../src/server/ServerManager";
import { OpenCodeSettings } from "../src/types";

// Test configuration
const TEST_PORT_BASE = 15000;
const TEST_TIMEOUT_MS = 10000; // 10 seconds for server startup in tests
const PROJECT_DIR = process.cwd();

let currentPort = TEST_PORT_BASE;

function getNextPort(): number {
  return currentPort++;
}

function createTestSettings(port: number): OpenCodeSettings {
  return {
    port,
    hostname: "127.0.0.1",
    autoStart: false,
    opencodePath: "opencode",
    projectDirectory: "",
    startupTimeout: process.platform === "win32" ? 15000 : TEST_TIMEOUT_MS,
    defaultViewLocation: "sidebar",
    injectWorkspaceContext: true,
    maxNotesInContext: 20,
    maxSelectionLength: 2000,
    customCommand: "",
    useCustomCommand: false,
  };
}

// Track current manager for cleanup
let currentManager: ServerManager | null = null;

// Verify opencode binary is available before running tests
beforeAll(async () => {
  const proc = Bun.spawn(["opencode", "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(
      "opencode binary not found or not executable. " +
        "Please ensure 'opencode' is installed and available in PATH."
    );
  }
});

// Cleanup after each test
afterEach(async () => {
  if (currentManager) {
    await currentManager.stop();
    // Give process time to fully terminate
    await new Promise((resolve) => setTimeout(resolve, 500));
    currentManager = null;
  }
});

describe("ServerManager", () => {
  describe("happy path", () => {
     test("starts server and transitions to running state", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);
       const stateHistory: ServerState[] = [];

       currentManager = new ServerManager(settings, PROJECT_DIR);
       currentManager.on("stateChange", (state: ServerState) => {
         stateHistory.push(state);
       });

      expect(currentManager.getState()).toBe("stopped");

      const success = await currentManager.start();

      expect(success).toBe(true);
      expect(currentManager.getState()).toBe("running");
      expect(stateHistory).toContain("starting");
      expect(stateHistory).toContain("running");
    }, 30000); // Increased timeout for database migration on first run

     test("reports the plain server URL (v2 has no project path segment)", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);

       currentManager = new ServerManager(settings, PROJECT_DIR);

      expect(currentManager.getUrl()).toBe(`http://127.0.0.1:${port}`);
    });

     test("derives a stable password for the server", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);

       const first = new ServerManager(settings, PROJECT_DIR);
       const second = new ServerManager(settings, PROJECT_DIR);

       // Same host/port must yield the same password so a server left over from
       // a previous session still accepts our credentials.
       expect(first.getPassword()).toBe(second.getPassword());
       expect(first.getPassword().length).toBeGreaterThan(0);

       const other = new ServerManager({ ...settings, port: port + 1 }, PROJECT_DIR);
       expect(other.getPassword()).not.toBe(first.getPassword());
     });

     test("stops server gracefully and transitions to stopped state", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);
       const stateHistory: ServerState[] = [];

       currentManager = new ServerManager(settings, PROJECT_DIR);
       currentManager.on("stateChange", (state: ServerState) => {
         stateHistory.push(state);
       });

      await currentManager.start();
      expect(currentManager.getState()).toBe("running");

      await currentManager.stop();

      expect(currentManager.getState()).toBe("stopped");
      expect(stateHistory).toContain("stopped");
    });

     test("state callbacks fire in correct order: starting -> running", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);
       const stateHistory: ServerState[] = [];

       currentManager = new ServerManager(settings, PROJECT_DIR);
       currentManager.on("stateChange", (state: ServerState) => {
         stateHistory.push(state);
       });

      await currentManager.start();

      // Verify order: first starting, then running
      const startingIndex = stateHistory.indexOf("starting");
      const runningIndex = stateHistory.indexOf("running");

      expect(startingIndex).toBeGreaterThanOrEqual(0);
      expect(runningIndex).toBeGreaterThan(startingIndex);
    });

     test("can restart after stop", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);

       currentManager = new ServerManager(settings, PROJECT_DIR);

      // First start
      const firstStart = await currentManager.start();
      expect(firstStart).toBe(true);
      expect(currentManager.getState()).toBe("running");

      // Stop
      await currentManager.stop();
      expect(currentManager.getState()).toBe("stopped");

      // Wait for process to fully terminate
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Restart
      const secondStart = await currentManager.start();
      expect(secondStart).toBe(true);
      expect(currentManager.getState()).toBe("running");
    });

     test("returns true immediately if already running", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);

       currentManager = new ServerManager(settings, PROJECT_DIR);

      // First start
      await currentManager.start();
      expect(currentManager.getState()).toBe("running");

      // Second start should return true immediately without state changes
      const stateHistory: ServerState[] = [];
      const onStateChange = (state: ServerState) => {
        stateHistory.push(state);
      };
      currentManager.on("stateChange", onStateChange);

      const result = await currentManager.start();

      expect(result).toBe(true);
      expect(currentManager.getState()).toBe("running");
      // Should not have triggered any state changes
      expect(stateHistory).toEqual([]);
    });

     test("health check endpoint is accessible when running", async () => {
       const port = getNextPort();
       const settings = createTestSettings(port);

       currentManager = new ServerManager(settings, PROJECT_DIR);

      await currentManager.start();

      // Verify we can hit the API with the credentials we handed to the server
      const url = currentManager.getUrl();

      const response = await fetch(`${url}/api/info`, {
        headers: { Authorization: currentManager.getAuthHeader() },
        signal: AbortSignal.timeout(2000),
      });

      expect(response.ok).toBe(true);
    });
  });

  describe("async stop behavior", () => {
    test("stop returns immediately when no process", async () => {
      const port = getNextPort();
      const settings = createTestSettings(port);
      const stateHistory: ServerState[] = [];

      currentManager = new ServerManager(settings, PROJECT_DIR);
      currentManager.on("stateChange", (state: ServerState) => {
        stateHistory.push(state);
      });

      // Stop without starting - should not throw and set state
      await currentManager.stop();

      expect(currentManager.getState()).toBe("stopped");
    });

    test("stop completes within timeout when process exits quickly", async () => {
      const port = getNextPort();
      const settings = createTestSettings(port);

      currentManager = new ServerManager(settings, PROJECT_DIR);

      await currentManager.start();
      expect(currentManager.getState()).toBe("running");

      // Stop should complete within 5 seconds (2s SIGTERM wait + 3s SIGKILL wait)
      const stopStart = Date.now();
      await currentManager.stop();
      const stopDuration = Date.now() - stopStart;

      expect(currentManager.getState()).toBe("stopped");
      // Should complete well before 5 second timeout
      expect(stopDuration).toBeLessThan(6000);
    });

    test("process is fully terminated after stop completes", async () => {
      const port = getNextPort();
      const settings = createTestSettings(port);

      currentManager = new ServerManager(settings, PROJECT_DIR);

      await currentManager.start();

      const url = currentManager.getUrl();
      
      await currentManager.stop();

      // Wait a bit then verify server is not accessible
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        const response = await fetch(`${url}/global/health`, {
          signal: AbortSignal.timeout(1000),
        });
        // If we get here, server is still running - test should fail
        expect(response.ok).toBe(false);
      } catch (e) {
        // Expected - server should not be accessible
        expect(e).toBeDefined();
      }
    });
  });

  describe("error handling", () => {
    test("handles double stop gracefully", async () => {
      const port = getNextPort();
      const settings = createTestSettings(port);

      currentManager = new ServerManager(settings, PROJECT_DIR);

      await currentManager.start();
      expect(currentManager.getState()).toBe("running");

      // First stop
      await currentManager.stop();
      expect(currentManager.getState()).toBe("stopped");

      // Second stop should not throw
      await currentManager.stop();
      expect(currentManager.getState()).toBe("stopped");
    });
  });

  describe("Unicode path support", () => {
    // OpenCode 2 no longer encodes the project directory in the URL, so a
    // non-Latin1 vault path must simply not leak into it (issue #28 regression).
    test("getUrl is independent of the project directory (Chinese)", () => {
      const settings = createTestSettings(getNextPort());
      const manager = new ServerManager(settings, "C:/用户/Notes");

      expect(manager.getUrl()).toBe(`http://127.0.0.1:${settings.port}`);
    });

    test("getUrl is independent of the project directory (Japanese)", () => {
      const settings = createTestSettings(getNextPort());
      const manager = new ServerManager(settings, "/home/ユーザー/ノート");

      expect(manager.getUrl()).toBe(`http://127.0.0.1:${settings.port}`);
    });

    test("getUrl is independent of the project directory (emoji)", () => {
      const settings = createTestSettings(getNextPort());
      const manager = new ServerManager(settings, "/home/user/📁Notes");

      expect(manager.getUrl()).toBe(`http://127.0.0.1:${settings.port}`);
    });
  });
});

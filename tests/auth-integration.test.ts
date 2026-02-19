import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { ServerManager } from "../src/server/ServerManager";
import { OpenCodeSettings } from "../src/types";

const TEST_PORT_BASE = 16000;
const TEST_TIMEOUT_MS = 10000;
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

let currentManager: ServerManager | null = null;

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

afterEach(async () => {
  if (currentManager) {
    await currentManager.stop();
    await new Promise((resolve) => setTimeout(resolve, 500));
    currentManager = null;
  }
});

describe("Authentication Integration", () => {
  describe("server with password", () => {
    test("rejects unauthenticated health check with 401", async () => {
      const port = getNextPort();
      const settings = createTestSettings(port);
      const password = "test-secret-password-xyz";

      currentManager = new ServerManager(settings, PROJECT_DIR, password);
      await currentManager.start();

      const url = currentManager.getUrl();
      const healthUrl = `${url}/global/health`;

      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(2000),
      });

      expect(response.status).toBe(401);
    });

    test("accepts authenticated health check with 200", async () => {
      const port = getNextPort();
      const settings = createTestSettings(port);
      const password = "test-secret-password-abc";

      currentManager = new ServerManager(settings, PROJECT_DIR, password);
      await currentManager.start();

      const url = currentManager.getUrl();
      const healthUrl = `${url}/global/health`;
      const authHeader = `Basic ${btoa(`opencode:${password}`)}`;

      const response = await fetch(healthUrl, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(2000),
      });

      expect(response.ok).toBe(true);
    });

    test("rejects request with wrong password", async () => {
      const port = getNextPort();
      const settings = createTestSettings(port);
      const correctPassword = "correct-password-123";
      const wrongPassword = "wrong-password-456";

      currentManager = new ServerManager(settings, PROJECT_DIR, correctPassword);
      await currentManager.start();

      const url = currentManager.getUrl();
      const healthUrl = `${url}/global/health`;
      const authHeader = `Basic ${btoa(`opencode:${wrongPassword}`)}`;

      const response = await fetch(healthUrl, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(2000),
      });

      expect(response.status).toBe(401);
    });

    test("server without password accepts unauthenticated requests", async () => {
      const port = getNextPort();
      const settings = createTestSettings(port);

      currentManager = new ServerManager(settings, PROJECT_DIR);
      await currentManager.start();

      const url = currentManager.getUrl();
      const healthUrl = `${url}/global/health`;

      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(2000),
      });

      expect(response.ok).toBe(true);
    });
  });

  describe("password regeneration", () => {
    test("setPassword changes the auth credentials", async () => {
      const port1 = getNextPort();
      const settings1 = createTestSettings(port1);
      const initialPassword = "initial-password-aaa";
      const newPassword = "new-password-bbb";

      currentManager = new ServerManager(settings1, PROJECT_DIR, initialPassword);
      await currentManager.start();

      const healthUrl1 = `${currentManager.getUrl()}/global/health`;

      const initialAuthHeader = `Basic ${btoa(`opencode:${initialPassword}`)}`;
      const response1 = await fetch(healthUrl1, {
        headers: { Authorization: initialAuthHeader },
        signal: AbortSignal.timeout(2000),
      });
      expect(response1.ok).toBe(true);

      await currentManager.stop();
      await new Promise((resolve) => setTimeout(resolve, 500));
      currentManager = null;

      const port2 = getNextPort();
      const settings2 = createTestSettings(port2);
      currentManager = new ServerManager(settings2, PROJECT_DIR, newPassword);
      await currentManager.start();

      const healthUrl2 = `${currentManager.getUrl()}/global/health`;

      const oldAuthHeader = `Basic ${btoa(`opencode:${initialPassword}`)}`;
      const response2 = await fetch(healthUrl2, {
        headers: { Authorization: oldAuthHeader },
        signal: AbortSignal.timeout(2000),
      });
      expect(response2.status).toBe(401);

      const newAuthHeader = `Basic ${btoa(`opencode:${newPassword}`)}`;
      const response3 = await fetch(healthUrl2, {
        headers: { Authorization: newAuthHeader },
        signal: AbortSignal.timeout(2000),
      });
      expect(response3.ok).toBe(true);
    });
  });
});

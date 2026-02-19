import { describe, test, expect, beforeEach } from "bun:test";
import { PasswordManager } from "../../src/security/PasswordManager";
import { App } from "obsidian";

interface MockSecretStorage {
  secrets: Map<string, string>;
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
  listSecrets(): string[];
}

function createMockSecretStorage(): MockSecretStorage {
  const secrets = new Map<string, string>();
  return {
    secrets,
    getSecret(id: string): string | null {
      return secrets.get(id) ?? null;
    },
    setSecret(id: string, secret: string): void {
      secrets.set(id, secret);
    },
    listSecrets(): string[] {
      return Array.from(secrets.keys());
    },
  };
}

function createMockApp(secretStorage: MockSecretStorage): App {
  return {
    secretStorage,
  } as unknown as App;
}

describe("PasswordManager", () => {
  let mockStorage: MockSecretStorage;
  let mockApp: App;

  beforeEach(() => {
    mockStorage = createMockSecretStorage();
    mockApp = createMockApp(mockStorage);
  });

  describe("generatePassword", () => {
    test("returns 32-character string", () => {
      const password = PasswordManager.generatePassword();
      expect(password.length).toBe(32);
    });

    test("returns base64url encoded string (alphanumeric, -, _)", () => {
      const password = PasswordManager.generatePassword();
      expect(password).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    test("produces different values on each call", () => {
      const passwords = new Set<string>();
      for (let i = 0; i < 10; i++) {
        passwords.add(PasswordManager.generatePassword());
      }
      expect(passwords.size).toBe(10);
    });
  });

  describe("loadPassword", () => {
    test("returns null when password not set", () => {
      const result = PasswordManager.loadPassword(mockApp);
      expect(result).toBeNull();
    });

    test("returns stored password when set", () => {
      const testPassword = "test-password-123";
      mockStorage.setSecret("opencode-server-password", testPassword);

      const result = PasswordManager.loadPassword(mockApp);
      expect(result).toBe(testPassword);
    });
  });

  describe("storePassword", () => {
    test("stores password in SecretStorage", () => {
      const testPassword = "stored-password-xyz";

      PasswordManager.storePassword(mockApp, testPassword);

      expect(mockStorage.secrets.get("opencode-server-password")).toBe(testPassword);
    });

    test("overwrites existing password", () => {
      const firstPassword = "first-password";
      const secondPassword = "second-password";

      PasswordManager.storePassword(mockApp, firstPassword);
      PasswordManager.storePassword(mockApp, secondPassword);

      expect(mockStorage.secrets.get("opencode-server-password")).toBe(secondPassword);
    });
  });

  describe("getOrCreatePassword", () => {
    test("returns existing password if already set", () => {
      const existingPassword = "existing-password-abc";
      mockStorage.setSecret("opencode-server-password", existingPassword);

      const result = PasswordManager.getOrCreatePassword(mockApp);
      expect(result).toBe(existingPassword);
    });

    test("generates and stores new password if not set", () => {
      const result = PasswordManager.getOrCreatePassword(mockApp);

      expect(result.length).toBe(32);
      expect(result).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(mockStorage.secrets.get("opencode-server-password")).toBe(result);
    });

    test("is deterministic - returns same password on repeated calls", () => {
      const first = PasswordManager.getOrCreatePassword(mockApp);
      const second = PasswordManager.getOrCreatePassword(mockApp);

      expect(first).toBe(second);
    });
  });

  describe("regeneratePassword", () => {
    test("always generates new password", () => {
      const first = PasswordManager.regeneratePassword(mockApp);
      const second = PasswordManager.regeneratePassword(mockApp);

      expect(first).not.toBe(second);
    });

    test("stores the new password", () => {
      const newPassword = PasswordManager.regeneratePassword(mockApp);

      expect(mockStorage.secrets.get("opencode-server-password")).toBe(newPassword);
    });

    test("overwrites existing password with new one", () => {
      mockStorage.setSecret("opencode-server-password", "old-password");
      const newPassword = PasswordManager.regeneratePassword(mockApp);
      
      expect(newPassword).not.toBe("old-password");
      expect(mockStorage.secrets.get("opencode-server-password")).toBe(newPassword);
    });

    test("returns valid 32-char base64url string", () => {
      const password = PasswordManager.regeneratePassword(mockApp);
      
      expect(password.length).toBe(32);
      expect(password).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });
});

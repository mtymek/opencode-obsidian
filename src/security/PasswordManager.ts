import { randomBytes } from "crypto";
import { App } from "obsidian";

const SECRET_KEY = "opencode-server-password";
const PASSWORD_BYTES = 24; // 24 bytes = 32 chars in base64url

/**
 * SecretStorage interface for type safety.
 * Obsidian's SecretStorage provides secure credential storage.
 */
interface SecretStorage {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
  listSecrets(): string[];
}

/**
 * Get SecretStorage from App instance.
 * Uses type assertion as SecretStorage may not be in older type definitions.
 */
function getSecretStorage(app: App): SecretStorage {
  return (app as unknown as { secretStorage: SecretStorage }).secretStorage;
}

/**
 * Utility class for managing the server authentication password.
 * Uses Obsidian's SecretStorage for secure persistence and
 * Node.js crypto for cryptographically secure random generation.
 */
export class PasswordManager {
  /**
   * Generates a cryptographically secure random password.
   * @returns 32-character base64url encoded string
   */
  static generatePassword(): string {
    return randomBytes(PASSWORD_BYTES).toString("base64url");
  }

  /**
   * Loads the stored password from SecretStorage.
   * @param app - Obsidian App instance
   * @returns The stored password or null if not set
   */
  static loadPassword(app: App): string | null {
    return getSecretStorage(app).getSecret(SECRET_KEY);
  }

  /**
   * Stores a password in SecretStorage.
   * @param app - Obsidian App instance
   * @param password - The password to store
   */
  static storePassword(app: App, password: string): void {
    getSecretStorage(app).setSecret(SECRET_KEY, password);
  }

  /**
   * Gets the existing password or creates and stores a new one.
   * @param app - Obsidian App instance
   * @returns The password (existing or newly generated)
   */
  static getOrCreatePassword(app: App): string {
    const existing = this.loadPassword(app);
    if (existing) {
      return existing;
    }

    const password = this.generatePassword();
    this.storePassword(app, password);
    return password;
  }

  /**
   * Regenerates and stores a new password, replacing any existing one.
   * @param app - Obsidian App instance
   * @returns The newly generated password
   */
  static regeneratePassword(app: App): string {
    const password = this.generatePassword();
    this.storePassword(app, password);
    return password;
  }
}

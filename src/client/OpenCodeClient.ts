import {
  buildAuthHeader,
  buildSessionUrl,
  normalizeServerUrl,
  resolveSessionId,
} from "../lib/serverUrl";
import { httpRequestJson, type HttpResponse } from "../lib/http";

type OpenCodeSession = {
  id?: string;
};

type OpenCodeResponse<T> = T | { data?: T } | { message?: T } | null;

/**
 * Thin client for the OpenCode 2.x HTTP API (`/api/*`), used for the things the
 * plugin needs outside the embedded web UI: resolving the project for the vault
 * directory, creating a session to open, and injecting workspace context.
 */
export class OpenCodeClient {
  private apiBaseUrl: string;
  private uiBaseUrl: string;
  private projectDirectory: string;
  private password = "";
  private trackedSessionId: string | null = null;
  private lastContextText: string | null = null;

  constructor(apiBaseUrl: string, uiBaseUrl: string, projectDirectory: string) {
    this.apiBaseUrl = normalizeServerUrl(apiBaseUrl);
    this.uiBaseUrl = normalizeServerUrl(uiBaseUrl);
    this.projectDirectory = projectDirectory;
  }

  updateBaseUrl(apiBaseUrl: string, uiBaseUrl: string, projectDirectory: string): void {
    const nextApiUrl = normalizeServerUrl(apiBaseUrl);
    const nextUiUrl = normalizeServerUrl(uiBaseUrl);
    if (
      nextApiUrl !== this.apiBaseUrl ||
      nextUiUrl !== this.uiBaseUrl ||
      projectDirectory !== this.projectDirectory
    ) {
      this.apiBaseUrl = nextApiUrl;
      this.uiBaseUrl = nextUiUrl;
      this.projectDirectory = projectDirectory;
      this.resetTracking();
    }
  }

  setPassword(password: string): void {
    if (password !== this.password) {
      this.password = password;
      this.resetTracking();
    }
  }

  resetTracking(): void {
    this.trackedSessionId = null;
    this.lastContextText = null;
  }

  getApiBaseUrl(): string {
    return this.apiBaseUrl;
  }

  /** Make sure the server knows the vault directory as a project. */
  async initializeProject(): Promise<boolean> {
    try {
      const response = await this.request(
        "GET",
        `/api/location?location[directory]=${encodeURIComponent(this.projectDirectory)}`
      );

      if (response.ok) {
        console.log("[OpenCode] Project initialized:", this.projectDirectory);
        return true;
      }

      console.warn("[OpenCode] Project initialization failed:", response.status);
      return false;
    } catch (error) {
      console.error("[OpenCode] Project initialization error:", error);
      return false;
    }
  }

  getSessionUrl(sessionId: string): string {
    return buildSessionUrl(this.uiBaseUrl, sessionId);
  }

  resolveSessionId(embedUrl: string): string | null {
    return resolveSessionId(embedUrl);
  }

  async createSession(): Promise<string | null> {
    const result = await this.json<OpenCodeSession>("POST", "/api/session", {
      title: "Obsidian",
      location: { directory: this.projectDirectory },
    });
    const session = this.unwrap<OpenCodeSession>(result);
    return session?.id ?? null;
  }

  /**
   * Attach the current workspace context to the session.
   *
   * v1 stored this as a hidden message part and patched it in place. v2 has no
   * part update endpoint; synthetic input is durable instead, so a new message is
   * only added when the context actually changed.
   */
  async updateContext(params: {
    sessionId: string;
    contextText: string | null;
  }): Promise<void> {
    const { sessionId, contextText } = params;

    if (this.trackedSessionId !== sessionId) {
      this.resetTracking();
      this.trackedSessionId = sessionId;
    }

    if (!contextText || contextText === this.lastContextText) {
      return;
    }

    const response = await this.request("POST", `/api/session/${sessionId}/synthetic`, {
      text: contextText,
      resume: false,
    });

    if (!response.ok) {
      console.warn("[OpenCode] Context injection failed:", response.status);
      return;
    }

    this.lastContextText = contextText;
    console.log("[OpenCode] Injected context message");
  }

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<HttpResponse> {
    // node:http instead of fetch: the renderer's fetch is CORS-blocked against
    // the OpenCode server (its preflight carries no allow-origin header).
    return httpRequestJson(method, `${this.apiBaseUrl}${path}`, {
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: 15000,
    });
  }

  private async json<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<OpenCodeResponse<T>> {
    try {
      const response = await this.request(method, path, body);

      if (!response.ok) {
        console.error("[OpenCode] API request failed", { path, status: response.status });
        return null;
      }

      const text = response.body;
      if (!text) {
        return null;
      }
      return JSON.parse(text) as OpenCodeResponse<T>;
    } catch (error) {
      console.error("[OpenCode] API request error", error);
      return null;
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.password) {
      headers.Authorization = buildAuthHeader(this.password);
    }
    return headers;
  }

  private unwrap<T>(result: OpenCodeResponse<T>): T | null {
    if (!result) {
      return null;
    }
    if (typeof result === "object") {
      const payload = result as { data?: T; message?: T };
      if (payload.data) {
        return payload.data;
      }
      if (payload.message) {
        return payload.message;
      }
    }
    return result as T;
  }
}

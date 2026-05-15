type OpenCodePart = {
  id: string;
  messageID: string;
  sessionID: string;
  type: string;
  text?: string;
  ignored?: boolean;
  synthetic?: boolean;
  metadata?: Record<string, unknown>;
  time?: {
    start: number;
    end?: number;
  };
};

type OpenCodeMessageInfo = {
  id: string;
  sessionID: string;
};

type OpenCodeMessageWithParts = {
  info: OpenCodeMessageInfo;
  parts: OpenCodePart[];
};

type OpenCodeSession = {
  id?: string;
  time?: {
    created?: number;
    updated?: number;
  };
  created?: number;
  updated?: number;
  createdAt?: string | number;
  updatedAt?: string | number;
};

type OpenCodeResponse<T> = T | { data?: T } | { message?: T } | null;

export class OpenCodeClient {
  private apiBaseUrl: string;
  private uiBaseUrl: string;
  private projectDirectory: string;
  private trackedSessionId: string | null = null;
  private lastPart: OpenCodePart | null = null;

  constructor(apiBaseUrl: string, uiBaseUrl: string, projectDirectory: string) {
    this.apiBaseUrl = this.normalizeBaseUrl(apiBaseUrl);
    this.uiBaseUrl = this.normalizeBaseUrl(uiBaseUrl);
    this.projectDirectory = projectDirectory;
  }

  updateBaseUrl(apiBaseUrl: string, uiBaseUrl: string, projectDirectory: string): void {
    const nextApiUrl = this.normalizeBaseUrl(apiBaseUrl);
    const nextUiUrl = this.normalizeBaseUrl(uiBaseUrl);
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

  resetTracking(): void {
    this.trackedSessionId = null;
    this.lastPart = null;
  }

  async initializeProject(): Promise<boolean> {
    try {
      const url = `${this.apiBaseUrl}/session?directory=${encodeURIComponent(this.projectDirectory)}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "x-opencode-directory": this.projectDirectory,
        },
      });

      if (response.ok) {
        console.log("[OpenCode] Project initialized:", this.projectDirectory);
        return true;
      } else {
        console.warn("[OpenCode] Project initialization failed:", response.status);
        return false;
      }
    } catch (error) {
      console.error("[OpenCode] Project initialization error:", error);
      return false;
    }
  }

  getSessionUrl(sessionId: string): string {
    return `${this.uiBaseUrl}/session/${sessionId}`;
  }

  resolveSessionId(iframeUrl: string): string | null {
    const match = iframeUrl.match(/\/session\/([^/?#]+)/);
    return match?.[1] ?? null;
  }

  async createSession(): Promise<string | null> {
    const result = await this.request<OpenCodeSession>("POST", "/session", {
      title: "Obsidian",
    });
    const session = this.unwrap(result);
    return session?.id ?? null;
  }

  async getLatestSessionId(): Promise<string | null> {
    const result = await this.request<OpenCodeSession[]>(
      "GET",
      `/session?directory=${encodeURIComponent(this.projectDirectory)}`
    );
    const sessions = this.unwrap(result);
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return null;
    }

    const latestSession = sessions.reduce((latest, session) => {
      return this.getSessionTimestamp(session) > this.getSessionTimestamp(latest)
        ? session
        : latest;
    });

    return latestSession.id ?? null;
  }

  async updateContext(params: {
    sessionId: string;
    contextText: string | null;
  }): Promise<void> {
    const { sessionId, contextText } = params;

    if (this.trackedSessionId && this.trackedSessionId !== sessionId) {
      this.resetTracking();
    }
    this.trackedSessionId = sessionId;

    if (!contextText) {
      await this.ignorePreviousPart();
      return;
    }

    if (this.lastPart) {
      const updated = await this.updatePart(this.lastPart, { text: contextText });
      if (updated) {
        return;
      }
      await this.ignorePreviousPart();
    }

    const message = await this.sendPrompt(sessionId, contextText);
    if (message?.info?.id) {
      this.lastPart = message.parts?.[0] ?? null;
    }
  }

  private async sendPrompt(sessionId: string, contextText: string): Promise<OpenCodeMessageWithParts | null> {
    const result = await this.request<OpenCodeMessageWithParts>(
      "POST",
      `/session/${sessionId}/message`,
      {
        noReply: true,
        parts: [{ type: "text", text: contextText }],
      }
    );

    console.log("[OpenCode] Injected context message");
    console.log(contextText)

    const message = this.unwrap(result);
    if (!message) {
      console.error("[OpenCode] Failed to inject context message");
    }
    return message;
  }

  private async updatePart(part: OpenCodePart, updates: { text?: string; ignored?: boolean }): Promise<boolean> {
    const result = await this.request<OpenCodePart>(
      "PATCH",
      `/session/${part.sessionID}/message/${part.messageID}/part/${part.id}`,
      {
        ...part,
        ...updates,
      }
    );
    const updated = this.unwrap(result);
    if (updated) {
      this.lastPart = updated;
      return true;
    }
    return false;
  }

  private async ignorePreviousPart(): Promise<boolean> {
    if (!this.lastPart) {
      return false;
    }

    const ignored = await this.updatePart(this.lastPart, { ignored: true });
    if (!ignored) {
      return false;
    }

    this.lastPart = null;
    return true;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<OpenCodeResponse<T>> {
    try {
      const url = `${this.apiBaseUrl}${path}`;
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": this.projectDirectory,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        console.error("[OpenCode] API request failed", {
          path,
          status: response.status,
        });
        return null;
      }

      const json = await response
        .json()
        .catch(() => null);
      return json as OpenCodeResponse<T>;
    } catch (error) {
      console.error("[OpenCode] API request error", error);
      return null;
    }
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

  private getSessionTimestamp(session: OpenCodeSession): number {
    return Math.max(
      this.toTimestamp(session.time?.updated),
      this.toTimestamp(session.updated),
      this.toTimestamp(session.updatedAt),
      this.toTimestamp(session.time?.created),
      this.toTimestamp(session.created),
      this.toTimestamp(session.createdAt)
    );
  }

  private toTimestamp(value: string | number | undefined): number {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const timestamp = Date.parse(value);
      return Number.isNaN(timestamp) ? 0 : timestamp;
    }
    return 0;
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, "");
  }
}

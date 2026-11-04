/**
 * URL and auth helpers for the OpenCode 2.x server.
 *
 * OpenCode 2 dropped the per-project URL scheme (`http://host:port/<base64dir>`)
 * in favour of a single web app whose routes are:
 *
 *   /                                    home / project picker
 *   /server/<serverKey>/session/<id>     one session
 *
 * where <serverKey> is the base64url encoding of the server URL. The server also
 * requires HTTP Basic authentication (user "opencode", password printed by
 * `opencode serve` or taken from OPENCODE_SERVER_PASSWORD).
 */

const AUTH_USERNAME = "opencode";

/** localStorage key the web app uses to persist known servers. */
export const STORAGE_KEY_SERVER = "opencode.global.dat:server";

/** Strip trailing slashes so a server URL can be joined safely. */
export function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

/** Encode a server URL the way the OpenCode web app expects in a session route. */
export function encodeServerKey(serverUrl: string): string {
  return Buffer.from(normalizeServerUrl(serverUrl), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** URL to load in the webview: the app entry point for this server. */
export function buildUiUrl(serverUrl: string): string {
  return normalizeServerUrl(serverUrl);
}

/** URL of a specific session inside the web app. */
export function buildSessionUrl(serverUrl: string, sessionId: string): string {
  return `${normalizeServerUrl(serverUrl)}/server/${encodeServerKey(
    serverUrl
  )}/session/${sessionId}`;
}

/** HTTP Basic header value for the OpenCode server API. */
export function buildAuthHeader(password: string): string {
  return `Basic ${Buffer.from(`${AUTH_USERNAME}:${password}`, "utf8").toString(
    "base64"
  )}`;
}

/** True when the given URL is a session URL of the form /server/<key>/session/<id>. */
export function resolveSessionId(url: string): string | null {
  const match = url.match(/\/session\/([^/?#]+)/);
  return match?.[1] ?? null;
}

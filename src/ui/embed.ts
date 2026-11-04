import { STORAGE_KEY_SERVER, normalizeServerUrl } from "../lib/serverUrl";

/**
 * Electron <webview> element as used by Obsidian (webviewTag is enabled in the
 * main window). Only the members we rely on are typed.
 */
export interface OpenCodeEmbedElement extends HTMLElement {
  executeJavaScript(code: string): Promise<unknown>;
  reload(): void;
}

/**
 * `<webview>` is the only way to run script inside the embedded page: the
 * OpenCode web app is served from 127.0.0.1 and is therefore cross-origin to
 * `app://obsidian.md`, so an <iframe> can neither read nor write its storage.
 */
export function isWebviewSupported(): boolean {
  const probe = document.createElement("webview") as unknown as OpenCodeEmbedElement;
  return (
    typeof probe.executeJavaScript === "function" && typeof probe.reload === "function"
  );
}

/**
 * Script that writes the server credential into the OpenCode web app storage.
 *
 * The app keeps its server list in localStorage and authenticates API calls
 * with the password stored there, so seeding this entry is enough to skip the
 * "Connect to a server" screen. Pairing links are not an alternative here: the
 * session cookie they set is SameSite=Lax and is never sent from inside an
 * embedded frame.
 *
 * Returns true when a value changed; the caller reloads once so the app picks
 * it up during startup. The second pass finds a matching value and returns
 * false, so no reload loop is possible.
 */
export function buildCredentialSeedScript(serverUrl: string, password: string): string {
  const url = normalizeServerUrl(serverUrl);

  return `(function () {
  var key = ${JSON.stringify(STORAGE_KEY_SERVER)};
  var url = ${JSON.stringify(url)};
  var password = ${JSON.stringify(password)};

  var stored = null;
  try {
    stored = window.localStorage.getItem(key);
  } catch (error) {
    return false;
  }

  var state = null;
  try {
    state = stored ? JSON.parse(stored) : null;
  } catch (error) {
    state = null;
  }

  if (!state || typeof state !== "object") {
    state = {};
  }
  if (!Array.isArray(state.list)) {
    state.list = [];
  }
  // Match the shape the app itself writes (it normalises and drops unknown
  // keys on startup, so inventing fields risks the whole entry being reset).
  if (!state.hidden) {
    state.hidden = {};
  }
  if (!state.projects) {
    state.projects = {};
  }
  if (!state.lastProjectID) {
    state.lastProjectID = {};
  }
  if (!state.usedProjectIDs) {
    state.usedProjectIDs = {};
  }
  if (!state.hostnames) {
    state.hostnames = {};
  }

  var entry = null;
  for (var i = 0; i < state.list.length; i += 1) {
    var candidate = state.list[i];
    if (
      candidate &&
      candidate.type === "http" &&
      candidate.http &&
      candidate.http.url === url
    ) {
      entry = candidate;
      break;
    }
  }

  if (entry && entry.http.password === password) {
    return false;
  }

  if (entry) {
    entry.http.password = password;
  } else {
    state.list.push({ type: "http", http: { url: url, password: password } });
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch (error) {
    return false;
  }

  return true;
})();`;
}

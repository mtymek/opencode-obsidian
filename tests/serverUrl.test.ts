import { describe, test, expect } from "bun:test";
import {
  buildAuthHeader,
  buildSessionUrl,
  buildUiUrl,
  encodeServerKey,
  normalizeServerUrl,
  resolveSessionId,
} from "../src/lib/serverUrl";

describe("serverUrl", () => {
  test("normalizes trailing slashes", () => {
    expect(normalizeServerUrl("http://127.0.0.1:14096/")).toBe("http://127.0.0.1:14096");
    expect(normalizeServerUrl("http://127.0.0.1:14096")).toBe("http://127.0.0.1:14096");
  });

  test("builds the plain UI url without a project path segment", () => {
    expect(buildUiUrl("http://127.0.0.1:14096/")).toBe("http://127.0.0.1:14096");
  });

  test("encodes the server key as base64url without padding", () => {
    expect(encodeServerKey("http://127.0.0.1:14099")).toBe(
      "aHR0cDovLzEyNy4wLjAuMToxNDA5OQ"
    );
  });

  test("builds a v2 session url", () => {
    expect(buildSessionUrl("http://127.0.0.1:14099/", "ses_abc")).toBe(
      "http://127.0.0.1:14099/server/aHR0cDovLzEyNy4wLjAuMToxNDA5OQ/session/ses_abc"
    );
  });

  test("builds a basic auth header for the opencode user", () => {
    expect(buildAuthHeader("secret")).toBe(`Basic ${Buffer.from("opencode:secret").toString("base64")}`);
  });

  test("extracts the session id from a session url", () => {
    expect(resolveSessionId("http://127.0.0.1:14099/server/abc/session/ses_123")).toBe(
      "ses_123"
    );
    expect(resolveSessionId("http://127.0.0.1:14099/")).toBeNull();
  });
});

import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { URL } from "url";

export interface HttpResponse {
  status: number;
  ok: boolean;
  body: string;
}

/**
 * Minimal HTTP client on top of node:http.
 *
 * Obsidian plugins run in the renderer, where `fetch` to the OpenCode server is
 * subject to CORS: any request carrying an Authorization header is preflighted,
 * and the shared service answers that preflight without
 * `access-control-allow-origin` - the browser then blocks the request. Node's
 * http module has no such restriction, so all plugin-side API calls go through
 * here. The embedded webview is unaffected (same origin).
 */
export function httpRequestJson(
  method: string,
  url: string,
  options: { headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}
): Promise<HttpResponse> {
  const target = new URL(url);
  const requestFn = target.protocol === "https:" ? httpsRequest : httpRequest;
  const timeoutMs = options.timeoutMs ?? 10000;
  const payload = options.body;
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (payload !== undefined) {
    headers["Content-Length"] = Buffer.byteLength(payload).toString();
  }

  return new Promise((resolve, reject) => {
    const req = requestFn(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request to ${url} timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

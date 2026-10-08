import http from "node:http";
import https from "node:https";
import { getCorrelationId } from "../correlation/correlation-context";

export type HttpTransportErrorKind = "connect_timeout" | "response_timeout" | "network";

/**
 * The call never produced an HTTP response. A response with any status, including 5xx, is not a
 * transport error: it comes back as an HttpResponse and the caller decides.
 */
export class HttpTransportError extends Error {
  constructor(
    readonly kind: HttpTransportErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "HttpTransportError";
  }
}

export interface HttpClientOptions {
  /** TCP connect. Default 500 ms (contracts/conventions.md). A TLS handshake counts as response time. */
  connectTimeoutMs?: number;
  /** From connected to the whole response read. Default 2000 ms. */
  responseTimeoutMs?: number;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  /** Sent as JSON when present. */
  body?: unknown;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  /** Parsed JSON (including problem+json); the raw text for other types; undefined when empty. */
  body: T | undefined;
}

const JSON_CONTENT = /^application\/(problem\+)?json\b/i;

/**
 * Outgoing HTTP with the agreed timeouts. Forwards X-Correlation-Id from the request context unless
 * the caller sets it. Authorization is the caller's: see ServiceAuthClient.
 */
export class HttpClient {
  private readonly connectTimeoutMs: number;
  private readonly responseTimeoutMs: number;

  constructor(options: HttpClientOptions = {}) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? 500;
    this.responseTimeoutMs = options.responseTimeoutMs ?? 2000;
  }

  request<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>> {
    const url = new URL(request.url);
    const headers: Record<string, string> = { Accept: "application/json", ...request.headers };
    const correlationId = getCorrelationId();
    if (correlationId && !hasHeader(headers, "x-correlation-id")) headers["X-Correlation-Id"] = correlationId;
    const payload = request.body === undefined ? undefined : Buffer.from(JSON.stringify(request.body));
    if (payload) {
      headers["Content-Type"] ??= "application/json";
      headers["Content-Length"] = String(payload.length);
    }

    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      let settled = false;
      const finish = (error: HttpTransportError | null, response?: HttpResponse<T>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          outgoing.destroy();
          reject(error);
        } else {
          resolve(response!);
        }
      };
      const arm = (kind: HttpTransportErrorKind, ms: number): void => {
        clearTimeout(timer);
        timer = setTimeout(
          () => finish(new HttpTransportError(kind, `${kind} after ${ms} ms: ${request.method} ${url.host}`)),
          ms,
        );
      };

      const transport = url.protocol === "https:" ? https : http;
      const outgoing = transport.request(url, { method: request.method, headers }, (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("error", (error) => finish(new HttpTransportError("network", error.message)));
        incoming.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const contentType = String(incoming.headers["content-type"] ?? "");
          let body: unknown = text === "" ? undefined : text;
          if (text !== "" && JSON_CONTENT.test(contentType)) {
            try {
              body = JSON.parse(text);
            } catch {
              finish(new HttpTransportError("network", `invalid JSON from ${url.host}`));
              return;
            }
          }
          finish(null, {
            status: incoming.statusCode ?? 0,
            headers: flatten(incoming.headers),
            body: body as T,
          });
        });
      });

      outgoing.on("error", (error) => finish(new HttpTransportError("network", error.message)));
      outgoing.on("socket", (socket) => {
        // A kept-alive socket is already connected: only the response timeout applies.
        if (!socket.connecting) return arm("response_timeout", this.responseTimeoutMs);
        arm("connect_timeout", this.connectTimeoutMs);
        socket.once("connect", () => arm("response_timeout", this.responseTimeoutMs));
      });
      outgoing.end(payload);
    });
  }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

function flatten(headers: http.IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) result[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}

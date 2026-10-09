import { Injectable } from "@nestjs/common";
import { DomainError, StructuredLogger, getCorrelationId } from "@aforo/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ServiceIdentityService } from "../auth/service-identity.service";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What a logic service answers. Anything else did not come from it: in the cloud, Google's front end
// answers an IAM rejection with an HTML 403 page.
const JSON_CONTENT = /^application\/(problem\+)?json\b/i;
const HTML_CONTENT = /^text\/html\b/i;

/** Set by SessionAuthGuard on a request whose bearer token was valid. */
export type AuthenticatedRequest = FastifyRequest & { user?: { sub: string; email: string }; rawBody?: Buffer };

export interface UpstreamTarget {
  /** For logs: `<name>.upstream_failed`, `<name>.unexpected_answer`. */
  name: string;
  baseUrl: string;
  /** ID-token audience: `aforo-<service>` for Cloud Run services, the URL for a function. */
  audience: string;
  timeoutMs: number;
}

export interface UpstreamCall {
  method: "GET" | "POST";
  /** Rebuilt by the caller from a fixed operation and validated ids, never copied from the request. */
  path: string;
  /** The browser's query string, only where the contract has query parameters. */
  query?: string;
  headers: Record<string, string>;
  body?: Buffer;
  /** The mock's checkout pages: a 200 HTML page and a 302 back to the web are legitimate answers. */
  browserPages?: boolean;
}

export function uuidParam(name: string, value: string): string {
  if (!UUID.test(value)) {
    throw new DomainError("VALIDATION_ERROR", "Request does not match the schema", [
      { field: name, message: `${name} must be a UUID` },
    ]);
  }
  return value;
}

/** The headers every forwarded call carries: correlation, and the validated user when there is one. */
export function baseHeaders(request: AuthenticatedRequest, { withUser }: { withUser: boolean }): Record<string, string> {
  const headers: Record<string, string> = {};
  const correlationId = getCorrelationId();
  if (correlationId) headers["X-Correlation-Id"] = correlationId;
  if (withUser) {
    const user = request.user;
    if (!user) throw new DomainError("UNAUTHENTICATED");
    headers["X-User-Id"] = user.sub;
    headers["X-User-Email"] = user.email;
  }
  return headers;
}

/** Copies one request header when the browser sent it (Idempotency-Key, X-Queue-Pass, X-Signature). */
export function copyHeader(request: FastifyRequest, headers: Record<string, string>, name: string): void {
  const value = request.headers[name.toLowerCase()];
  if (typeof value === "string") headers[name] = value;
}

/**
 * One call to a private service for the Orders, Inventory and mock routes. Like the Catalog and
 * queue proxies it is not a generic proxy: callers rebuild the path. The answer passes through
 * (status, body, Content-Type, Idempotent-Replayed, and Location for the checkout redirect); an
 * answer the service could not have given, a timeout or a failed ID token become 500 INTERNAL.
 */
@Injectable()
export class UpstreamService {
  private readonly logger = new StructuredLogger(process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "gateway");

  constructor(private readonly identity: ServiceIdentityService) {}

  async forward(target: UpstreamTarget, call: UpstreamCall, reply: FastifyReply): Promise<void> {
    const headers: Record<string, string> = { Accept: call.browserPages ? "text/html, application/json" : "application/json", ...call.headers };
    try {
      const authorization = await this.identity.authorizationFor(target.audience);
      if (authorization) headers.Authorization = authorization;
    } catch (error) {
      this.logger.write("ERROR", `${target.name}.identity_token_failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DomainError("INTERNAL", `${target.name} service unavailable`);
    }

    let upstream: Response;
    try {
      upstream = await fetch(`${target.baseUrl}${call.path}${call.query ?? ""}`, {
        method: call.method,
        headers,
        body: call.body,
        redirect: "manual",
        signal: AbortSignal.timeout(target.timeoutMs),
      });
    } catch (error) {
      this.logger.write("ERROR", `${target.name}.upstream_failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DomainError("INTERNAL", `${target.name} service unavailable`);
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    const location = upstream.headers.get("location");
    if (call.browserPages && upstream.status === 302 && location) {
      await upstream.body?.cancel().catch(() => undefined);
      reply.status(302).header("location", location).header("cache-control", "no-store").send();
      return;
    }
    // A non-JSON success is legitimate only if its body turns out empty: Orders answers a handled
    // webhook with a bare 200, which Express labels text/html, and turning that into a 500 makes
    // Cloud Tasks retry it. Google's front end never answers an IAM rejection with a 2xx.
    const browserPage = call.browserPages === true && upstream.status === 200 && HTML_CONTENT.test(contentType);
    const maybeEmptySuccess =
      !JSON_CONTENT.test(contentType) && !browserPage && upstream.status >= 200 && upstream.status < 300;
    const legitimate = JSON_CONTENT.test(contentType) || browserPage || maybeEmptySuccess;
    if (!legitimate) {
      await upstream.body?.cancel().catch(() => undefined);
      this.logger.write("ERROR", `${target.name}.unexpected_answer`, { status: upstream.status, contentType });
      throw new DomainError("INTERNAL", `${target.name} service unavailable`);
    }

    let body: Buffer;
    try {
      body = Buffer.from(await upstream.arrayBuffer());
    } catch (error) {
      this.logger.write("ERROR", `${target.name}.upstream_failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DomainError("INTERNAL", `${target.name} service unavailable`);
    }
    if (maybeEmptySuccess && body.length > 0) {
      this.logger.write("ERROR", `${target.name}.unexpected_answer`, { status: upstream.status, contentType });
      throw new DomainError("INTERNAL", `${target.name} service unavailable`);
    }
    reply.status(upstream.status);
    if (maybeEmptySuccess) {
      // No body and no type: the text/html label described nothing, and Fastify would label an
      // empty Buffer application/octet-stream.
      reply.send();
      return;
    }
    reply.header("content-type", contentType);
    const replayed = upstream.headers.get("idempotent-replayed");
    if (replayed) reply.header("idempotent-replayed", replayed);
    if (call.browserPages) reply.header("cache-control", "no-store");
    reply.send(body);
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { DomainError, StructuredLogger, getCorrelationId } from "@aforo/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ServiceIdentityService } from "../auth/service-identity.service";
import type { GatewayConfig } from "../config/gateway-config";

type CatalogOperation = "list" | "detail" | "create" | "configureRules" | "publish";
type AuthenticatedRequest = FastifyRequest & { user?: { sub: string; email: string } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JSON_CONTENT = /^application\/(problem\+)?json\b/i;
const UPSTREAM_TIMEOUT_MS = 2500;
const CATALOG_AUDIENCE = "aforo-catalog";

@Injectable()
export class CatalogProxyService {
  private readonly logger = new StructuredLogger(process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "gateway");

  constructor(
    @Inject("GATEWAY_CONFIG") private readonly config: GatewayConfig,
    private readonly identity: ServiceIdentityService,
  ) {}

  async forward(
    operation: CatalogOperation,
    eventId: string | null,
    request: AuthenticatedRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (eventId !== null && !UUID.test(eventId)) {
      throw new DomainError("VALIDATION_ERROR", "Request does not match the schema", [
        { field: "eventId", message: "eventId must be a UUID" },
      ]);
    }

    const isPublic = operation === "list" || operation === "detail";
    const user = request.user;
    if (!isPublic && !user) throw new DomainError("UNAUTHENTICATED");

    const headers: Record<string, string> = { Accept: "application/json" };
    const correlationId = getCorrelationId();
    if (correlationId) headers["X-Correlation-Id"] = correlationId;
    if (user && !isPublic) {
      headers["X-User-Id"] = user.sub;
      headers["X-User-Email"] = user.email;
    }
    if (!isPublic && typeof request.headers["idempotency-key"] === "string") {
      headers["Idempotency-Key"] = request.headers["idempotency-key"];
    }

    const path = operation === "list" || operation === "create"
      ? "/api/v1/events"
      : operation === "detail"
        ? `/api/v1/events/${eventId}`
        : operation === "configureRules"
          ? `/api/v1/events/${eventId}/sales-rules`
          : `/api/v1/events/${eventId}/publish`;
    const query = operation === "list" ? new URL(request.raw.url ?? "", "http://gateway").search : "";
    const method = operation === "create" || operation === "publish" ? "POST" : operation === "configureRules" ? "PUT" : "GET";
    const body = (operation === "create" || operation === "configureRules") && request.body !== undefined
      ? JSON.stringify(request.body)
      : undefined;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    try {
      const authorization = await this.identity.authorizationFor(CATALOG_AUDIENCE);
      if (authorization) headers.Authorization = authorization;
    } catch (error) {
      this.logger.write("ERROR", "catalog.identity_token_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DomainError("INTERNAL", "catalog service unavailable");
    }

    let upstream: Response;
    try {
      upstream = await fetch(`${this.config.catalogUrl}${path}${query}`, {
        method, headers, body, redirect: "manual", signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      const contentType = upstream.headers.get("content-type") ?? "";
      if (!JSON_CONTENT.test(contentType)) {
        await upstream.body?.cancel().catch(() => undefined);
        this.logger.write("ERROR", "catalog.unexpected_answer", { status: upstream.status, contentType });
        throw new DomainError("INTERNAL", "catalog service unavailable");
      }
      const response = Buffer.from(await upstream.arrayBuffer());
      reply.status(upstream.status).header("content-type", contentType);
      const replayed = upstream.headers.get("idempotent-replayed");
      if (replayed) reply.header("idempotent-replayed", replayed);
      reply.send(response);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      this.logger.write("ERROR", "catalog.upstream_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DomainError("INTERNAL", "catalog service unavailable");
    }
  }
}

import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DomainError } from "@aforo/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { GatewayConfig } from "../config/gateway-config";
import { RateLimitService } from "./rate-limit.service";

const RATE_LIMIT_SCOPE = "aforo:rate-limit-scope";

/** Puts a route under the quota of `scope`. Only "queue" exists today (RATE_LIMIT_QUEUE_PER_MIN). */
export const RateLimited = (scope: "queue") => SetMetadata(RATE_LIMIT_SCOPE, scope);

/**
 * Registered as a global guard BEFORE the session guard, so a request with no or a forged token also
 * spends quota: otherwise the quota would not protect the endpoint from someone trying tokens.
 * `request.ip` is the client address Fastify derives under `trustProxy` (see main.ts).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
    @Inject("GATEWAY_CONFIG") private readonly config: GatewayConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.getAllAndOverride<"queue" | undefined>(RATE_LIMIT_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!scope) return true;

    const http = context.switchToHttp();
    const result = await this.limiter.hit(scope, http.getRequest<FastifyRequest>().ip, this.config.rateLimitQueuePerMinute);
    if (result.allowed) return true;

    // Set before throwing: the problem+json filter sends through the same reply and keeps its headers.
    http.getResponse<FastifyReply>().header("Retry-After", String(result.retryAfterSeconds));
    throw new DomainError("RATE_LIMITED");
  }
}

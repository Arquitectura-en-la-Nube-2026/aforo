import { Controller, Get, Inject, Param, Post, Req, Res } from "@nestjs/common";
import { Public } from "@aforo/common/nest";
import type { FastifyReply } from "fastify";
import type { GatewayConfig } from "../config/gateway-config";
import {
  baseHeaders,
  copyHeader,
  uuidParam,
  UpstreamService,
  type AuthenticatedRequest,
  type UpstreamTarget,
} from "../upstream/upstream.service";

// A payment intent waits for Orders' own E-06 policy toward the mock: up to 3 attempts of 0.5 s
// connect + 2 s response, plus backoff (infra/envs/dev/services.tf), about 8 s. The Gateway must
// outlast it, or the 503 PAYMENT_UNAVAILABLE of the demo would become a 500 here.
const ORDERS_TIMEOUT_MS = 10_000;

/** The Orders routes of the public route map, including the mock's signed webhook. */
@Controller("api/v1")
export class OrdersProxyController {
  private readonly target: UpstreamTarget;

  constructor(
    @Inject("GATEWAY_CONFIG") config: GatewayConfig,
    private readonly upstream: UpstreamService,
  ) {
    this.target = { name: "orders", baseUrl: config.ordersUrl, audience: "aforo-orders", timeoutMs: ORDERS_TIMEOUT_MS };
  }

  @Post("orders")
  create(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.upstream.forward(this.target, { method: "POST", path: "/api/v1/orders", ...this.write(request) }, reply);
  }

  @Get("orders")
  list(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply): Promise<void> {
    const query = new URL(request.raw.url ?? "", "http://gateway").search;
    return this.upstream.forward(
      this.target,
      { method: "GET", path: "/api/v1/orders", query, headers: baseHeaders(request, { withUser: true }) },
      reply,
    );
  }

  @Get("orders/:orderId")
  detail(@Param("orderId") orderId: string, @Req() request: AuthenticatedRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.upstream.forward(
      this.target,
      {
        method: "GET",
        path: `/api/v1/orders/${uuidParam("orderId", orderId)}`,
        headers: baseHeaders(request, { withUser: true }),
      },
      reply,
    );
  }

  @Post("orders/:orderId/payment-intents")
  paymentIntent(
    @Param("orderId") orderId: string,
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const path = `/api/v1/orders/${uuidParam("orderId", orderId)}/payment-intents`;
    return this.upstream.forward(this.target, { method: "POST", path, ...this.write(request) }, reply);
  }

  /**
   * Sent by the mock (Cloud Tasks), not by a browser: no session. Orders checks the HMAC over the
   * exact bytes, so the raw body is forwarded untouched, never a re-serialized JSON.
   */
  @Public()
  @Post("payments/webhook")
  webhook(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply): Promise<void> {
    const headers = baseHeaders(request, { withUser: false });
    copyHeader(request, headers, "X-Signature");
    copyHeader(request, headers, "Content-Type");
    return this.upstream.forward(
      this.target,
      { method: "POST", path: "/api/v1/payments/webhook", headers, body: request.rawBody ?? Buffer.alloc(0) },
      reply,
    );
  }

  /** A buyer's change: validated user, Idempotency-Key, the pass (logged by Orders, never verified, D-07). */
  private write(request: AuthenticatedRequest): { headers: Record<string, string>; body?: Buffer } {
    const headers = baseHeaders(request, { withUser: true });
    copyHeader(request, headers, "Idempotency-Key");
    copyHeader(request, headers, "X-Queue-Pass");
    if (!request.rawBody) return { headers };
    headers["Content-Type"] = "application/json";
    return { headers, body: request.rawBody };
  }
}

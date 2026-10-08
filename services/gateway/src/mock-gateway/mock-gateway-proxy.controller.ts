import { Controller, Get, Inject, Param, Req, Res } from "@nestjs/common";
import { DomainError } from "@aforo/common";
import { Public } from "@aforo/common/nest";
import type { FastifyReply } from "fastify";
import type { GatewayConfig } from "../config/gateway-config";
import {
  baseHeaders,
  uuidParam,
  UpstreamService,
  type AuthenticatedRequest,
  type UpstreamTarget,
} from "../upstream/upstream.service";

// A browser page load on a function that may be cold and that enqueues a Cloud Task on "complete".
const MOCK_TIMEOUT_MS = 10_000;
const OUTCOMES = ["APPROVED", "DECLINED"];

/**
 * GET /mock-gateway/** of the route map, narrowed to the two pages the mock serves to the browser
 * (contracts/openapi/mock-payment-gateway.yaml). Its /payments and /webhook-dispatch stay private:
 * they are not GET, and this controller only builds the checkout paths.
 */
@Controller("mock-gateway/checkout")
export class MockGatewayProxyController {
  private readonly target: UpstreamTarget;

  constructor(
    @Inject("GATEWAY_CONFIG") config: GatewayConfig,
    private readonly upstream: UpstreamService,
  ) {
    // A function has no custom audience: its ID token is for its own URL (as Orders does).
    this.target = {
      name: "mock_payment_gateway",
      baseUrl: config.mockPaymentGatewayUrl,
      audience: config.mockPaymentGatewayUrl,
      timeoutMs: MOCK_TIMEOUT_MS,
    };
  }

  @Public()
  @Get(":paymentId")
  page(@Param("paymentId") paymentId: string, @Req() request: AuthenticatedRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.upstream.forward(
      this.target,
      {
        method: "GET",
        path: `/checkout/${uuidParam("paymentId", paymentId)}`,
        headers: baseHeaders(request, { withUser: false }),
        browserPages: true,
      },
      reply,
    );
  }

  @Public()
  @Get(":paymentId/complete")
  complete(@Param("paymentId") paymentId: string, @Req() request: AuthenticatedRequest, @Res() reply: FastifyReply): Promise<void> {
    const outcome = (request.query as Record<string, unknown>).outcome;
    if (typeof outcome !== "string" || !OUTCOMES.includes(outcome)) {
      throw new DomainError("VALIDATION_ERROR", "Request does not match the schema", [
        { field: "outcome", message: "outcome must be APPROVED or DECLINED" },
      ]);
    }
    return this.upstream.forward(
      this.target,
      {
        method: "GET",
        path: `/checkout/${uuidParam("paymentId", paymentId)}/complete`,
        query: `?outcome=${outcome}`,
        headers: baseHeaders(request, { withUser: false }),
        browserPages: true,
      },
      reply,
    );
  }
}

import { Controller, Get, Inject, Param, Req, Res } from "@nestjs/common";
import { Public } from "@aforo/common/nest";
import type { FastifyReply } from "fastify";
import type { GatewayConfig } from "../config/gateway-config";
import { baseHeaders, uuidParam, UpstreamService, type AuthenticatedRequest } from "../upstream/upstream.service";

// contracts/conventions.md: connect 0.5 s + response 2 s.
const INVENTORY_TIMEOUT_MS = 2500;

/** GET /api/v1/events/{eventId}/availability belongs to Inventory, not Catalog. Public. */
@Controller("api/v1/events")
export class AvailabilityProxyController {
  constructor(
    @Inject("GATEWAY_CONFIG") private readonly config: GatewayConfig,
    private readonly upstream: UpstreamService,
  ) {}

  @Public()
  @Get(":eventId/availability")
  availability(@Param("eventId") eventId: string, @Req() request: AuthenticatedRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.upstream.forward(
      { name: "inventory", baseUrl: this.config.inventoryUrl, audience: "aforo-inventory", timeoutMs: INVENTORY_TIMEOUT_MS },
      {
        method: "GET",
        path: `/api/v1/events/${uuidParam("eventId", eventId)}/availability`,
        headers: baseHeaders(request, { withUser: false }),
      },
      reply,
    );
  }
}

import { Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { RateLimited } from "../rate-limit/rate-limit.guard";
import { QueueProxyService } from "./queue-proxy.service";

/** Public queue routes (README route map). The session token is required: SessionAuthGuard is global. */
@Controller("api/v1/queue")
@RateLimited("queue")
export class QueueProxyController {
  constructor(private readonly proxy: QueueProxyService) {}

  @Post(":eventId/join")
  join(@Param("eventId") eventId: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.proxy.forward("join", eventId, request, reply);
  }

  @Get(":eventId/status")
  status(@Param("eventId") eventId: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.proxy.forward("status", eventId, request, reply);
  }

  @Get(":eventId/stream")
  stream(@Param("eventId") eventId: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.proxy.forward("stream", eventId, request, reply);
  }
}

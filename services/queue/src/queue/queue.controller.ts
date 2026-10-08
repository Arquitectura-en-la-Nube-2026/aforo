import { Controller, Get, Param, Post, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { QueueService } from "./queue.service";
import { QueueStreamService } from "./queue-stream.service";
import type { QueueStatus } from "./queue-status";
import { UserId } from "./user-id.decorator";

@Controller("api/v1/queue/:eventId")
export class QueueController {
  constructor(
    private readonly queue: QueueService,
    private readonly streams: QueueStreamService,
  ) {}

  @Post("join")
  join(@Param("eventId") eventId: string, @UserId() userId: string): Promise<QueueStatus> {
    return this.queue.join(eventId, userId);
  }

  @Get("status")
  status(@Param("eventId") eventId: string, @UserId() userId: string): Promise<QueueStatus> {
    return this.queue.status(eventId, userId);
  }

  @Get("stream")
  async stream(@Param("eventId") eventId: string, @UserId() userId: string, @Res() reply: FastifyReply): Promise<void> {
    await this.streams.stream(eventId, userId, reply);
  }
}

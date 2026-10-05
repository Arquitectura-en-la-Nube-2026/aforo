import { Inject, Injectable } from "@nestjs/common";
import { DomainError } from "@aforo/common";
import type { QueueConfig } from "../config/queue-config";
import { ProjectionService } from "../messaging/projection.service";
import { QUEUE_CONFIG, RedisService } from "../redis/redis.service";
import { admittedKey, queueKey } from "./queue-scripts";
import { admittedStatus, scoreFor, waitingStatus, type QueueStatus } from "./queue-status";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The path parameter must be a UUID (contract: EventId); anything else breaks the schema, so 422. */
export function assertEventId(eventId: string): void {
  if (!UUID.test(eventId)) {
    throw new DomainError("VALIDATION_ERROR", "Request does not match the schema", [
      { field: "eventId", message: "eventId must be a UUID" },
    ]);
  }
}

export function isUserId(value: string | undefined): value is string {
  return value !== undefined && UUID.test(value);
}

@Injectable()
export class QueueService {
  constructor(
    @Inject(QUEUE_CONFIG) private readonly config: QueueConfig,
    private readonly store: RedisService,
    private readonly projection: ProjectionService,
  ) {}

  /**
   * Joins the queue, or returns the existing position or pass (re-joining is naturally idempotent).
   * 404 when the event has no projection yet; 409 SALE_NOT_OPEN outside the sale window, except that a
   * buyer who already holds a pass gets it back. The atomic part lives in JOIN_LUA.
   */
  async join(eventId: string, userId: string, now = Date.now()): Promise<QueueStatus> {
    assertEventId(eventId);
    const event = await this.projection.get(eventId);
    if (!event) throw new DomainError("NOT_FOUND", "Unknown event");

    const open = now >= event.salesOpensAtMs && now < event.salesClosesAtMs;
    const score = scoreFor(now, event.salesOpensAtMs, event.openingWindowSeconds);
    const reply = await this.store.redis.queueJoin(
      queueKey(eventId),
      admittedKey(eventId, userId),
      userId,
      score,
      open ? "1" : "0",
    );

    if (reply[0] === "NOT_OPEN") throw new DomainError("SALE_NOT_OPEN");
    return reply[0] === "ADMITTED" ? admittedStatus(eventId, reply[1]) : waitingStatus(eventId, reply[1], this.config);
  }

  /** Current position or pass. 404 when the buyer is neither queued nor admitted (never joined, or the pass expired). */
  async status(eventId: string, userId: string): Promise<QueueStatus> {
    assertEventId(eventId);
    const reply = await this.store.redis.queueStatus(queueKey(eventId), admittedKey(eventId, userId), userId);
    if (reply[0] === "NONE") throw new DomainError("NOT_FOUND", "Not in the queue for this event");
    return reply[0] === "ADMITTED" ? admittedStatus(eventId, reply[1]) : waitingStatus(eventId, reply[1], this.config);
  }
}

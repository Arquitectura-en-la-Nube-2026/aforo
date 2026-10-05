import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import {
  consumeOnce,
  parsePushEnvelope,
  type EventPublishedData,
  type SalesRulesConfiguredData,
} from "@aforo/common";
import { ProjectionService } from "./projection.service";
import { RedisInboxStore } from "./redis-inbox.store";

/**
 * Pub/Sub push endpoints (POST /internal/v1/events/{subscription-name}). Invalid body, envelope or
 * payload answers 400 so the message dead-letters; a duplicate answers 204 without touching the
 * projection; any other failure (Redis down) answers 5xx so Pub/Sub retries.
 */
@Controller("internal/v1/events")
export class EventsController {
  constructor(
    private readonly projection: ProjectionService,
    private readonly inbox: RedisInboxStore,
  ) {}

  @Post("queue-event-published")
  @HttpCode(204)
  async onEventPublished(@Body() body: unknown): Promise<void> {
    const envelope = parsePushEnvelope<EventPublishedData>(body, "EventPublished");
    await consumeOnce(this.inbox, envelope.messageId, () => this.projection.applyEventPublished(envelope.data, envelope.occurredAt));
  }

  @Post("queue-sales-rules")
  @HttpCode(204)
  async onSalesRulesConfigured(@Body() body: unknown): Promise<void> {
    const envelope = parsePushEnvelope<SalesRulesConfiguredData>(body, "SalesRulesConfigured");
    await consumeOnce(this.inbox, envelope.messageId, () => this.projection.applySalesRules(envelope.data, envelope.occurredAt));
  }
}

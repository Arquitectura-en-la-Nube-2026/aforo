import { Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import type { EventEnvelope, EventPublishedData, SalesRulesConfiguredData } from "@aforo/common";
import { PushEnvelope } from "@aforo/common/nest";
import { uuidParam } from "../reservations/validation";
import { ProjectionService, type Availability } from "./projection.service";

/** Public through the Gateway: GET /api/v1/events/{eventId}/availability. */
@Controller("api/v1/events")
export class AvailabilityController {
  constructor(private readonly projection: ProjectionService) {}

  @Get(":eventId/availability")
  availability(@Param("eventId") eventId: string): Promise<Availability> {
    return this.projection.availability(uuidParam("eventId", eventId));
  }
}

/**
 * Pub/Sub push (POST /internal/v1/events/{subscription}). An invalid message answers 400 and
 * dead-letters; a duplicate answers 204 without touching the projection; a DB failure answers
 * 5xx so Pub/Sub retries.
 */
@Controller("internal/v1/events")
export class ProjectionEventsController {
  constructor(private readonly projection: ProjectionService) {}

  @Post("inventory-event-published")
  @HttpCode(204)
  async onEventPublished(@PushEnvelope("EventPublished") envelope: EventEnvelope<EventPublishedData>): Promise<void> {
    await this.projection.applyEventPublished(envelope);
  }

  @Post("inventory-sales-rules")
  @HttpCode(204)
  async onSalesRules(
    @PushEnvelope("SalesRulesConfigured") envelope: EventEnvelope<SalesRulesConfiguredData>,
  ): Promise<void> {
    await this.projection.applySalesRules(envelope);
  }
}

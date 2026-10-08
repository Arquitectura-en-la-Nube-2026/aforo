import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DomainError, OutboxPublisher } from "@aforo/common";
import type { CatalogConfig } from "../config/catalog-config";
import { CATALOG_CONFIG, DbService } from "../db/db.service";
import { listEvents, loadEvent, type Event } from "./event.view";
import { emitFacts } from "./facts";
import type { ListQuery, NewEvent, SalesRules } from "./validation";

export interface EventPage {
  items: Event[];
  page: number;
  size: number;
  total: number;
}

/**
 * The owner of events (docs/architecture/state-machines.md, "Event (catalog)"): DRAFT, rules,
 * PUBLISHED. Each change locks the event row, so a rules change and a publish of the same event
 * serialize and the outbox gets the facts in the order they happened.
 */
@Injectable()
export class EventsService {
  constructor(
    private readonly db: DbService,
    private readonly publisher: OutboxPublisher,
    @Inject(CATALOG_CONFIG) private readonly config: CatalogConfig,
  ) {}

  async list(query: ListQuery): Promise<EventPage> {
    const { items, total } = await listEvents(this.db, query);
    return { items, page: query.page, size: query.size, total };
  }

  async get(eventId: string): Promise<Event> {
    const event = await loadEvent(this.db, eventId);
    if (!event) throw new DomainError("NOT_FOUND", "Event not found");
    return event;
  }

  /** RF-01: a DRAFT with its sectors. Nothing is emitted until it is published. */
  async create(input: NewEvent, createdBy: string): Promise<Event> {
    const eventId = randomUUID();
    return this.db.tx(async (q) => {
      await q.query(
        `INSERT INTO event (id, name, venue, starts_at, sales_opens_at, sales_closes_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [eventId, input.name, input.venue, input.startsAt, input.salesOpensAt, input.salesClosesAt, createdBy],
      );
      for (const [position, sector] of input.sectors.entries()) {
        await q.query(
          `INSERT INTO sector (event_id, id, position, name, capacity, price_cents) VALUES ($1, $2, $3, $4, $5, $6)`,
          [eventId, randomUUID(), position, sector.name, sector.capacity, sector.priceCents],
        );
      }
      return (await loadEvent(q, eventId)) as Event;
    });
  }

  /** RF-03: on a published event the new rules are emitted as SalesRulesConfigured. */
  async configureRules(eventId: string, rules: SalesRules): Promise<Event> {
    let emitted = false;
    const event = await this.db.tx(async (q) => {
      const current = await loadEvent(q, eventId, { forUpdate: true });
      if (!current) throw new DomainError("NOT_FOUND", "Event not found");
      await q.query(
        `INSERT INTO sales_rules (event_id, max_tickets_per_person, reservation_ttl_seconds, opening_window_seconds)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (event_id) DO UPDATE SET max_tickets_per_person = EXCLUDED.max_tickets_per_person,
           reservation_ttl_seconds = EXCLUDED.reservation_ttl_seconds,
           opening_window_seconds = EXCLUDED.opening_window_seconds, updated_at = now()`,
        [eventId, rules.maxTicketsPerPerson, rules.reservationTtlSeconds, rules.openingWindowSeconds],
      );
      await q.query("UPDATE event SET updated_at = now() WHERE id = $1", [eventId]);
      const updated = (await loadEvent(q, eventId)) as Event;
      if (updated.status === "PUBLISHED") {
        await emitFacts(q, this.config, updated, { eventPublished: false, salesRulesConfigured: true });
        emitted = true;
      }
      return updated;
    });
    if (emitted) await this.flush();
    return event;
  }

  /**
   * RF-02: DRAFT -> PUBLISHED as a conditional update, writing EventPublished and
   * SalesRulesConfigured in the same transaction. Without rules it is 422. Publishing an event that
   * is already PUBLISHED changes nothing and emits nothing: it answers the event as it is.
   */
  async publish(eventId: string): Promise<Event> {
    let emitted = false;
    const event = await this.db.tx(async (q) => {
      const current = await loadEvent(q, eventId, { forUpdate: true });
      if (!current) throw new DomainError("NOT_FOUND", "Event not found");
      if (!current.salesRules) {
        throw new DomainError("VALIDATION_ERROR", "Sales rules must be configured before publishing", [
          { field: "salesRules", message: "configure the sales rules first (PUT /sales-rules)" },
        ]);
      }
      const moved = await q.query(
        "UPDATE event SET status = 'PUBLISHED', updated_at = now() WHERE id = $1 AND status = 'DRAFT'",
        [eventId],
      );
      if (moved.rowCount === 0) return current;
      const published = (await loadEvent(q, eventId)) as Event;
      await emitFacts(q, this.config, published, { eventPublished: true, salesRulesConfigured: true });
      emitted = true;
      return published;
    });
    if (emitted) await this.flush();
    return event;
  }

  /** Committed already: a failed publish stays in the outbox and housekeeping retries it (ADR-0002). */
  private async flush(): Promise<void> {
    await this.publisher.flush().catch(() => undefined);
  }
}

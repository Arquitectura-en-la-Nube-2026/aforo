import { Injectable } from "@nestjs/common";
import {
  consumeOnce,
  DomainError,
  type EventEnvelope,
  type EventPublishedData,
  type InboxResult,
  type SalesRulesConfiguredData,
} from "@aforo/common";
import { DbService } from "../db/db.service";
import { PgInboxStore } from "../messaging/stores";

export interface Availability {
  eventId: string;
  sectors: Array<{
    sectorId: string;
    name: string;
    capacity: number;
    available: number;
    priceCents: number;
    currency: "COP";
  }>;
}

/**
 * Inventory's own copy of what it needs from Catalog, built from the bus: Catalog is never called.
 * The two facts can arrive in any order, so each one writes only its own columns; a fact older
 * than the last one of its kind applied is skipped. Re-emitting a fact (the seed does, on
 * `make redis-up`) never resets availability: sectors are inserted once, then only renamed or
 * re-priced.
 */
@Injectable()
export class ProjectionService {
  private readonly eventPublishedInbox: PgInboxStore;
  private readonly salesRulesInbox: PgInboxStore;

  constructor(private readonly db: DbService) {
    this.eventPublishedInbox = new PgInboxStore(db, "inventory-event-published");
    this.salesRulesInbox = new PgInboxStore(db, "inventory-sales-rules");
  }

  applyEventPublished(envelope: EventEnvelope<EventPublishedData>): Promise<InboxResult> {
    const { data, occurredAt } = envelope;
    return consumeOnce(this.eventPublishedInbox, envelope.messageId, async ({ q }) => {
      const upserted = await q.query(
        `INSERT INTO event_projection (event_id, name, sales_opens_at, sales_closes_at, published_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (event_id) DO UPDATE SET
           name = EXCLUDED.name, sales_opens_at = EXCLUDED.sales_opens_at,
           sales_closes_at = EXCLUDED.sales_closes_at, published_at = EXCLUDED.published_at
         WHERE event_projection.published_at IS NULL OR event_projection.published_at <= EXCLUDED.published_at`,
        [data.eventId, data.name, data.salesOpensAt, data.salesClosesAt, occurredAt],
      );
      if (upserted.rowCount === 0) return; // an older EventPublished than the one applied
      for (const sector of data.sectors) {
        await q.query(
          `INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents, currency)
           VALUES ($1, $2, $3, $4, $4, $5, $6)
           ON CONFLICT (event_id, sector_id) DO UPDATE SET name = EXCLUDED.name, price_cents = EXCLUDED.price_cents`,
          [data.eventId, sector.sectorId, sector.name, sector.capacity, sector.priceCents, sector.currency],
        );
      }
    });
  }

  applySalesRules(envelope: EventEnvelope<SalesRulesConfiguredData>): Promise<InboxResult> {
    const { data, occurredAt } = envelope;
    return consumeOnce(this.salesRulesInbox, envelope.messageId, async ({ q }) => {
      await q.query(
        `INSERT INTO event_projection (event_id, max_tickets_per_person, reservation_ttl_seconds, rules_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (event_id) DO UPDATE SET
           max_tickets_per_person = EXCLUDED.max_tickets_per_person,
           reservation_ttl_seconds = EXCLUDED.reservation_ttl_seconds, rules_at = EXCLUDED.rules_at
         WHERE event_projection.rules_at IS NULL OR event_projection.rules_at <= EXCLUDED.rules_at`,
        [data.eventId, data.maxTicketsPerPerson, data.reservationTtlSeconds, occurredAt],
      );
    });
  }

  /** Public availability. 404 until EventPublished has been projected. */
  async availability(eventId: string): Promise<Availability> {
    const event = await this.db.query(
      "SELECT 1 FROM event_projection WHERE event_id = $1 AND published_at IS NOT NULL",
      [eventId],
    );
    if (event.rowCount === 0) throw new DomainError("NOT_FOUND", "Event not found");
    const { rows } = await this.db.query<{
      sector_id: string;
      name: string;
      capacity: number;
      available: number;
      price_cents: string;
    }>(
      `SELECT sector_id, name, capacity, available, price_cents FROM sector_availability
       WHERE event_id = $1 ORDER BY name, sector_id`,
      [eventId],
    );
    return {
      eventId,
      sectors: rows.map((row) => ({
        sectorId: row.sector_id,
        name: row.name,
        capacity: row.capacity,
        available: row.available,
        priceCents: Number(row.price_cents),
        currency: "COP",
      })),
    };
  }
}

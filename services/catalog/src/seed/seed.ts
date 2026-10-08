import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { OutboxPublisher, PubSubRestTransport, runWithCorrelation, StructuredLogger } from "@aforo/common";
import { loadCatalogConfig, type CatalogConfig } from "../config/catalog-config";
import type { Queryable } from "../db/db.service";
import { loadEvent, type Event } from "../events/event.view";
import { emitFacts } from "../events/facts";
import { PgOutboxStore } from "../messaging/stores";
import { SEED_EVENTS, type SeedEvent } from "./seed-data";

const SEED_USER = "seed";

/** Brings one event to exactly the seed's values, PUBLISHED. Upserts only: safe to repeat. */
async function upsertEvent(q: Queryable, seed: SeedEvent): Promise<void> {
  await q.query(
    `INSERT INTO event (id, name, venue, starts_at, sales_opens_at, sales_closes_at, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'PUBLISHED', $7)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, venue = EXCLUDED.venue,
       starts_at = EXCLUDED.starts_at, sales_opens_at = EXCLUDED.sales_opens_at,
       sales_closes_at = EXCLUDED.sales_closes_at, status = 'PUBLISHED', updated_at = now()`,
    [seed.id, seed.name, seed.venue, seed.startsAt, seed.salesOpensAt, seed.salesClosesAt, SEED_USER],
  );
  for (const [position, sector] of seed.sectors.entries()) {
    await q.query(
      `INSERT INTO sector (event_id, id, position, name, capacity, price_cents) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (event_id, id) DO UPDATE SET position = EXCLUDED.position, name = EXCLUDED.name,
         capacity = EXCLUDED.capacity, price_cents = EXCLUDED.price_cents`,
      [seed.id, sector.id, position, sector.name, sector.capacity, sector.priceCents],
    );
  }
  await q.query(
    `INSERT INTO sales_rules (event_id, max_tickets_per_person, reservation_ttl_seconds, opening_window_seconds)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (event_id) DO UPDATE SET max_tickets_per_person = EXCLUDED.max_tickets_per_person,
       reservation_ttl_seconds = EXCLUDED.reservation_ttl_seconds,
       opening_window_seconds = EXCLUDED.opening_window_seconds, updated_at = now()`,
    [seed.id, seed.rules.maxTicketsPerPerson, seed.rules.reservationTtlSeconds, seed.rules.openingWindowSeconds],
  );
}

/**
 * One transaction: every seed event upserted and both facts of each written to the outbox, even
 * when nothing changed. That re-emission is the point (ADR-0001): a fresh Memorystore gets the
 * queue projection back, and Inventory re-applies its upserts (name and price only: it never
 * resets capacity or availability).
 */
export async function seed(db: Pool, topics: CatalogConfig): Promise<Event[]> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const events: Event[] = [];
    for (const definition of SEED_EVENTS) {
      await upsertEvent(client, definition);
      const event = (await loadEvent(client, definition.id)) as Event;
      await emitFacts(client, topics, event, { eventPublished: true, salesRulesConfigured: true });
      events.push(event);
    }
    await client.query("COMMIT");
    return events;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * `npm run seed` (Cloud Run job aforo-catalog-seed in dev, with the service's env). Needs
 * DATABASE_URL, GCP_PROJECT_ID and the topics. If the flush fails the rows are committed anyway
 * and housekeeping publishes them within a minute, so the run still succeeds, with a warning.
 */
async function main(): Promise<void> {
  const config = loadCatalogConfig();
  const logger = new StructuredLogger("catalog-seed");
  const db = new Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 10_000 });
  const correlationId = randomUUID();
  try {
    await runWithCorrelation({ correlationId }, async () => {
      const events = await seed(db, config);
      logger.write("INFO", "seed.applied", {
        event: "seed_applied",
        correlationId,
        events: events.map((e) => ({ id: e.id, name: e.name, saleState: e.saleState })),
      });
      const publisher = new OutboxPublisher(new PgOutboxStore(db), new PubSubRestTransport({ projectId: config.gcpProjectId }));
      try {
        const published = await publisher.flush();
        logger.write("INFO", "seed.published", { event: "seed_published", correlationId, published });
      } catch (error) {
        logger.write("WARNING", "seed.publish_deferred", {
          event: "seed_publish_deferred",
          correlationId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ severity: "CRITICAL", message: "seed_failed", error: message })}\n`);
    process.exit(1);
  });
}

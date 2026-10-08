import type { Queryable } from "../db/db.service";
import type { EventStatus, SalesRules } from "./validation";

export type SaleState = "SCHEDULED" | "OPEN" | "CLOSED";

export interface Sector {
  id: string;
  name: string;
  capacity: number;
  priceCents: number;
  currency: "COP";
}

/** Event in contracts/openapi/catalog.yaml. */
export interface Event {
  id: string;
  name: string;
  venue: string;
  startsAt: string;
  status: EventStatus;
  salesOpensAt: string;
  salesClosesAt: string;
  saleState: SaleState;
  salesRules: SalesRules | null;
  sectors: Sector[];
}

/**
 * The only place a sale is decided open (README "Rules"): server clock, open at salesOpensAt
 * inclusive, closed at salesClosesAt inclusive. The frontend never compares dates itself.
 */
export function saleStateAt(nowMs: number, opensAt: Date, closesAt: Date): SaleState {
  if (nowMs < opensAt.getTime()) return "SCHEDULED";
  if (nowMs < closesAt.getTime()) return "OPEN";
  return "CLOSED";
}

/** ISO-8601 UTC, without milliseconds when they are zero ("2026-10-01T15:00:00Z"). */
export function iso(date: Date): string {
  return date.toISOString().replace(".000Z", "Z");
}

interface EventRow {
  id: string;
  name: string;
  venue: string;
  starts_at: Date;
  status: EventStatus;
  sales_opens_at: Date;
  sales_closes_at: Date;
}

const EVENT_COLUMNS = "id, name, venue, starts_at, status, sales_opens_at, sales_closes_at";

/** Loads events with their sectors and rules, in the order of `rows`. */
async function assemble(q: Queryable, rows: EventRow[], nowMs: number): Promise<Event[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const sectors = await q.query<{
    event_id: string;
    id: string;
    name: string;
    capacity: number;
    price_cents: string;
    currency: "COP";
  }>(
    `SELECT event_id, id, name, capacity, price_cents, currency FROM sector
     WHERE event_id = ANY($1::uuid[]) ORDER BY event_id, position`,
    [ids],
  );
  const rules = await q.query<{
    event_id: string;
    max_tickets_per_person: number;
    reservation_ttl_seconds: number;
    opening_window_seconds: number;
  }>(
    `SELECT event_id, max_tickets_per_person, reservation_ttl_seconds, opening_window_seconds
     FROM sales_rules WHERE event_id = ANY($1::uuid[])`,
    [ids],
  );
  return rows.map((row) => {
    const rule = rules.rows.find((r) => r.event_id === row.id);
    return {
      id: row.id,
      name: row.name,
      venue: row.venue,
      startsAt: iso(row.starts_at),
      status: row.status,
      salesOpensAt: iso(row.sales_opens_at),
      salesClosesAt: iso(row.sales_closes_at),
      saleState: saleStateAt(nowMs, row.sales_opens_at, row.sales_closes_at),
      salesRules: rule
        ? {
            maxTicketsPerPerson: rule.max_tickets_per_person,
            reservationTtlSeconds: rule.reservation_ttl_seconds,
            openingWindowSeconds: rule.opening_window_seconds,
          }
        : null,
      sectors: sectors.rows
        .filter((s) => s.event_id === row.id)
        .map((s) => ({
          id: s.id,
          name: s.name,
          capacity: s.capacity,
          priceCents: Number(s.price_cents),
          currency: s.currency,
        })),
    };
  });
}

/** One event, or null. `forUpdate` locks its row until the transaction ends. */
export async function loadEvent(q: Queryable, id: string, options: { forUpdate?: boolean } = {}): Promise<Event | null> {
  const { rows } = await q.query<EventRow>(
    `SELECT ${EVENT_COLUMNS} FROM event WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`,
    [id],
  );
  const [event] = await assemble(q, rows, Date.now());
  return event ?? null;
}

/** A page of events, soonest first (ties by id, so pages never overlap). */
export async function listEvents(
  q: Queryable,
  query: { status?: EventStatus; page: number; size: number },
): Promise<{ items: Event[]; total: number }> {
  const filter = query.status ? "WHERE status = $3" : "";
  const params: unknown[] = [query.size, query.page * query.size];
  if (query.status) params.push(query.status);
  const { rows } = await q.query<EventRow>(
    `SELECT ${EVENT_COLUMNS} FROM event ${filter} ORDER BY starts_at, id LIMIT $1 OFFSET $2`,
    params,
  );
  const count = await q.query<{ total: string }>(
    `SELECT count(*) AS total FROM event ${query.status ? "WHERE status = $1" : ""}`,
    query.status ? [query.status] : [],
  );
  return { items: await assemble(q, rows, Date.now()), total: Number(count.rows[0].total) };
}

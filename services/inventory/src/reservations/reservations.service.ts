import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  buildEnvelope,
  DomainError,
  getCorrelationId,
  OutboxPublisher,
  StructuredLogger,
  type ReservationExpiredData,
} from "@aforo/common";
import type { InventoryConfig } from "../config/inventory-config";
import { DbService, INVENTORY_CONFIG, type Queryable } from "../db/db.service";
import { addToOutbox } from "../messaging/stores";
import { EXPIRY_SCHEDULER, type ExpiryScheduler } from "./expiry-scheduler";

export type ReservationStatus = "ACTIVE" | "CONFIRMED" | "EXPIRED" | "RELEASED";

export interface CreateReservation {
  eventId: string;
  sectorId: string;
  quantity: number;
  buyerId: string;
}

/** contracts/openapi/inventory.yaml, Reservation. */
export interface Reservation {
  reservationId: string;
  status: ReservationStatus;
  expiresAt: string;
  unitPriceCents: number;
  totalCents: number;
  currency: "COP";
}

export interface ReservationTransition {
  reservationId: string;
  status: ReservationStatus;
}

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pg = error as { code?: string; constraint?: string };
  return pg?.code === UNIQUE_VIOLATION && pg.constraint === constraint;
}

/**
 * The owner of availability. Every transition is a conditional update on one row
 * (docs/architecture/state-machines.md): whoever changes the row wins, everyone else reads the
 * final state. The sector counter row serializes the reservations of a sector (E-02).
 */
@Injectable()
export class ReservationsService {
  private readonly logger = new StructuredLogger(process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "inventory");

  constructor(
    private readonly db: DbService,
    private readonly publisher: OutboxPublisher,
    @Inject(EXPIRY_SCHEDULER) private readonly scheduler: ExpiryScheduler,
    @Inject(INVENTORY_CONFIG) private readonly config: InventoryConfig,
  ) {}

  /**
   * One local transaction, in the contract's order: decrement (SOLD_OUT), insert
   * (ACTIVE_RESERVATION_EXISTS), per-person limit (LIMIT_EXCEEDED). Any rejection rolls the
   * transaction back, so nothing is decremented. The expiry task is enqueued after the commit;
   * if that is lost, the housekeeping sweep expires the reservation within a minute (ADR-0003).
   */
  async reserve(input: CreateReservation): Promise<Reservation> {
    const reservationId = randomUUID();
    const reservation = await this.db.tx(async (q) => {
      const rules = await q.query<{ max_tickets_per_person: number; reservation_ttl_seconds: number }>(
        `SELECT max_tickets_per_person, reservation_ttl_seconds FROM event_projection
         WHERE event_id = $1 AND published_at IS NOT NULL AND rules_at IS NOT NULL`,
        [input.eventId],
      );
      // Not projected yet (or only half of it): the contract's 404, never a call to Catalog.
      if (rules.rowCount === 0) throw new DomainError("NOT_FOUND", "Event not found");
      const { max_tickets_per_person: maxPerPerson, reservation_ttl_seconds: ttlSeconds } = rules.rows[0];

      const decremented = await q.query<{ price_cents: string }>(
        `UPDATE sector_availability SET available = available - $3, version = version + 1
         WHERE event_id = $1 AND sector_id = $2 AND available >= $3
         RETURNING price_cents`,
        [input.eventId, input.sectorId, input.quantity],
      );
      if (decremented.rowCount === 0) {
        const exists = await q.query("SELECT 1 FROM sector_availability WHERE event_id = $1 AND sector_id = $2", [
          input.eventId,
          input.sectorId,
        ]);
        if (exists.rowCount === 0) throw new DomainError("NOT_FOUND", "Sector not found");
        throw new DomainError("SOLD_OUT", `Fewer than ${input.quantity} seats left in this sector`);
      }
      const unitPriceCents = Number(decremented.rows[0].price_cents);

      let inserted;
      try {
        inserted = await q.query<{ expires_at: Date }>(
          `INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents, total_cents, status, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', now() + make_interval(secs => $8))
           RETURNING expires_at`,
          [
            reservationId,
            input.eventId,
            input.sectorId,
            input.buyerId,
            input.quantity,
            unitPriceCents,
            unitPriceCents * input.quantity,
            ttlSeconds,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error, "reservation_one_active")) throw new DomainError("ACTIVE_RESERVATION_EXISTS");
        throw error;
      }

      const total = await q.query<{ confirmed: number }>(
        "SELECT confirmed FROM buyer_event_total WHERE event_id = $1 AND buyer_id = $2",
        [input.eventId, input.buyerId],
      );
      const confirmed = total.rows[0]?.confirmed ?? 0;
      if (confirmed + input.quantity > maxPerPerson) {
        throw new DomainError(
          "LIMIT_EXCEEDED",
          `At most ${maxPerPerson} tickets per person; ${confirmed} already confirmed`,
        );
      }

      return {
        reservationId,
        status: "ACTIVE" as const,
        expiresAt: inserted.rows[0].expires_at.toISOString(),
        unitPriceCents,
        totalCents: unitPriceCents * input.quantity,
        currency: "COP" as const,
      };
    });

    try {
      await this.scheduler.schedule(reservationId, new Date(reservation.expiresAt), getCorrelationId() ?? randomUUID());
    } catch (error) {
      this.logger.write("WARNING", "expiry.schedule_failed", {
        event: "expiry_schedule_failed",
        correlationId: getCorrelationId(),
        reservationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return reservation;
  }

  /** ACTIVE → CONFIRMED and the buyer's total grows. If expire won the race, returns EXPIRED. */
  async confirm(reservationId: string): Promise<ReservationTransition> {
    const status = await this.db.tx(async (q) => {
      const changed = await q.query<{ event_id: string; buyer_id: string; quantity: number }>(
        `UPDATE reservation SET status = 'CONFIRMED', updated_at = now()
         WHERE id = $1 AND status = 'ACTIVE'
         RETURNING event_id, buyer_id, quantity`,
        [reservationId],
      );
      if (changed.rowCount === 0) return this.currentStatus(q, reservationId);
      const { event_id: eventId, buyer_id: buyerId, quantity } = changed.rows[0];
      await q.query(
        `INSERT INTO buyer_event_total (event_id, buyer_id, confirmed) VALUES ($1, $2, $3)
         ON CONFLICT (event_id, buyer_id) DO UPDATE SET confirmed = buyer_event_total.confirmed + EXCLUDED.confirmed`,
        [eventId, buyerId, quantity],
      );
      return "CONFIRMED" as const;
    });
    return { reservationId, status };
  }

  /** ACTIVE → RELEASED, seats back. Idempotent: a repeat returns the current status. */
  async release(reservationId: string): Promise<ReservationTransition> {
    const status = await this.db.tx(async (q) => {
      const changed = await q.query<{ event_id: string; sector_id: string; quantity: number }>(
        `UPDATE reservation SET status = 'RELEASED', updated_at = now()
         WHERE id = $1 AND status = 'ACTIVE'
         RETURNING event_id, sector_id, quantity`,
        [reservationId],
      );
      if (changed.rowCount === 0) return this.currentStatus(q, reservationId);
      await this.restoreSeats(q, changed.rows[0]);
      return "RELEASED" as const;
    });
    return { reservationId, status };
  }

  /**
   * ACTIVE → EXPIRED only once the expiry instant has passed (ADR-0003): seats back and
   * ReservationExpired in the outbox, same transaction. Early or repeated calls return the current
   * status with 200, so Cloud Tasks does not retry. The sweep passes flush=false and lets
   * housekeeping flush once.
   */
  async expire(reservationId: string, flush = true): Promise<ReservationTransition> {
    let expired = false;
    const status = await this.db.tx(async (q) => {
      const changed = await q.query<{
        event_id: string;
        sector_id: string;
        buyer_id: string;
        quantity: number;
        updated_at: Date;
      }>(
        `UPDATE reservation SET status = 'EXPIRED', updated_at = now()
         WHERE id = $1 AND status = 'ACTIVE' AND expires_at <= now()
         RETURNING event_id, sector_id, buyer_id, quantity, updated_at`,
        [reservationId],
      );
      if (changed.rowCount === 0) return this.currentStatus(q, reservationId);
      const row = changed.rows[0];
      await this.restoreSeats(q, row);
      const data: ReservationExpiredData = {
        reservationId,
        eventId: row.event_id,
        sectorId: row.sector_id,
        buyerId: row.buyer_id,
        quantity: row.quantity,
        expiredAt: row.updated_at.toISOString(),
      };
      await addToOutbox(
        q,
        row.event_id,
        this.config.topicReservationExpired,
        buildEnvelope({ type: "ReservationExpired", producer: "inventory", data }),
      );
      expired = true;
      return "EXPIRED" as const;
    });
    if (expired && flush) {
      // Committed: a failed publish stays in the outbox for housekeeping, the expiry still stands.
      await this.publisher.flush().catch(() => undefined);
    }
    return { reservationId, status };
  }

  /** Reservations whose expiry instant has passed but are still ACTIVE (a lost or late task). */
  async overdue(limit: number): Promise<string[]> {
    const { rows } = await this.db.query<{ id: string }>(
      "SELECT id FROM reservation WHERE status = 'ACTIVE' AND expires_at <= now() ORDER BY expires_at LIMIT $1",
      [limit],
    );
    return rows.map((row) => row.id);
  }

  private async restoreSeats(
    q: Queryable,
    row: { event_id: string; sector_id: string; quantity: number },
  ): Promise<void> {
    await q.query(
      `UPDATE sector_availability SET available = available + $3, version = version + 1
       WHERE event_id = $1 AND sector_id = $2`,
      [row.event_id, row.sector_id, row.quantity],
    );
  }

  private async currentStatus(q: Queryable, reservationId: string): Promise<ReservationStatus> {
    const { rows } = await q.query<{ status: ReservationStatus }>("SELECT status FROM reservation WHERE id = $1", [
      reservationId,
    ]);
    if (rows.length === 0) throw new DomainError("NOT_FOUND", "Reservation not found");
    return rows[0].status;
  }
}

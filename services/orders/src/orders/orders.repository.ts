import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../db/db.service';

export type OrderStatus = 'PENDING_PAYMENT' | 'PAID' | 'EXPIRED' | 'REFUND_PENDING';

export interface OrderRow {
  id: string;
  buyerId: string;
  eventId: string;
  sectorId: string;
  quantity: number;
  reservationId: string;
  reservationExpiresAt: Date;
  unitPriceCents: number;
  totalCents: number;
  status: OrderStatus;
  paidAt: Date | null;
  createdAt: Date;
}

export interface NewOrder {
  id: string;
  buyerId: string;
  eventId: string;
  sectorId: string;
  quantity: number;
  reservationId: string;
  reservationExpiresAt: string;
  unitPriceCents: number;
  totalCents: number;
}

const map = (r: any): OrderRow => ({
  id: r.id,
  buyerId: r.buyer_id,
  eventId: r.event_id,
  sectorId: r.sector_id,
  quantity: r.quantity,
  reservationId: r.reservation_id,
  reservationExpiresAt: r.reservation_expires_at,
  unitPriceCents: Number(r.unit_price_cents),
  totalCents: Number(r.total_cents),
  status: r.status,
  paidAt: r.paid_at,
  createdAt: r.created_at,
});

/** Every state change is a conditional update (docs/architecture/state-machines.md). */
@Injectable()
export class OrdersRepository {
  constructor(private readonly db: DbService) {}

  /** Idempotent on reservation_id: a retry of the same reservation returns the existing order. */
  async insert(o: NewOrder): Promise<OrderRow> {
    await this.db.query(
      `INSERT INTO "order" (id, buyer_id, event_id, sector_id, quantity, reservation_id,
                            reservation_expires_at, unit_price_cents, total_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (reservation_id) DO NOTHING`,
      [o.id, o.buyerId, o.eventId, o.sectorId, o.quantity, o.reservationId, o.reservationExpiresAt, o.unitPriceCents, o.totalCents],
    );
    const res = await this.db.query('SELECT * FROM "order" WHERE reservation_id = $1', [o.reservationId]);
    return map(res.rows[0]);
  }

  async findById(id: string, q: Queryable = this.db): Promise<OrderRow | null> {
    const res = await q.query('SELECT * FROM "order" WHERE id = $1', [id]);
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  async findByIdForBuyer(id: string, buyerId: string): Promise<OrderRow | null> {
    const res = await this.db.query('SELECT * FROM "order" WHERE id = $1 AND buyer_id = $2', [id, buyerId]);
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  async listByBuyer(buyerId: string, page: number, size: number): Promise<{ rows: OrderRow[]; total: number }> {
    const [rows, count] = await Promise.all([
      this.db.query('SELECT * FROM "order" WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [buyerId, size, page * size]),
      this.db.query('SELECT count(*)::int AS total FROM "order" WHERE buyer_id = $1', [buyerId]),
    ]);
    return { rows: rows.rows.map(map), total: count.rows[0].total };
  }

  /** PENDING_PAYMENT -> PAID. Returns the updated row, or null when the order was not pending. */
  async markPaid(q: Queryable, id: string): Promise<OrderRow | null> {
    const res = await q.query(
      `UPDATE "order" SET status = 'PAID', paid_at = now() WHERE id = $1 AND status = 'PENDING_PAYMENT' RETURNING *`,
      [id],
    );
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  /** PENDING_PAYMENT | EXPIRED -> REFUND_PENDING (approved payment whose reservation expired). */
  async markRefundPending(q: Queryable, id: string): Promise<boolean> {
    const res = await q.query(
      `UPDATE "order" SET status = 'REFUND_PENDING' WHERE id = $1 AND status IN ('PENDING_PAYMENT', 'EXPIRED')`,
      [id],
    );
    return res.rowCount === 1;
  }

  /** PENDING_PAYMENT -> EXPIRED (ReservationExpired received). */
  async expireByReservation(q: Queryable, reservationId: string): Promise<boolean> {
    const res = await q.query(
      `UPDATE "order" SET status = 'EXPIRED' WHERE reservation_id = $1 AND status = 'PENDING_PAYMENT'`,
      [reservationId],
    );
    return res.rowCount === 1;
  }
}

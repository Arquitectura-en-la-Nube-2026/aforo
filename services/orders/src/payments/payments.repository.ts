import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../db/db.service';

export interface PaymentRow {
  id: string;
  orderId: string;
  status: 'CREATED' | 'APPROVED' | 'DECLINED' | 'REFUNDED';
  amountCents: number;
  checkoutUrl: string;
  expiresAt: Date;
  refundId: string | null;
}

const map = (r: any): PaymentRow => ({
  id: r.id,
  orderId: r.order_id,
  status: r.status,
  amountCents: Number(r.amount_cents),
  checkoutUrl: r.checkout_url,
  expiresAt: r.expires_at,
  refundId: r.refund_id,
});

@Injectable()
export class PaymentsRepository {
  constructor(private readonly db: DbService) {}

  async insertIfAbsent(p: {
    id: string;
    orderId: string;
    amountCents: number;
    checkoutUrl: string;
    expiresAt: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO payment (id, order_id, amount_cents, checkout_url, expires_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [p.id, p.orderId, p.amountCents, p.checkoutUrl, p.expiresAt],
    );
  }

  async findById(id: string, q: Queryable = this.db): Promise<PaymentRow | null> {
    const res = await q.query('SELECT * FROM payment WHERE id = $1', [id]);
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  /** Conditional transition; returns false when the payment was not in `from`. */
  async transition(
    q: Queryable,
    id: string,
    from: PaymentRow['status'],
    to: 'APPROVED' | 'DECLINED',
  ): Promise<boolean> {
    const res = await q.query('UPDATE payment SET status = $3 WHERE id = $1 AND status = $2', [id, from, to]);
    return res.rowCount === 1;
  }

  async markRefunded(id: string, refundId: string): Promise<boolean> {
    const res = await this.db.query(
      `UPDATE payment SET status = 'REFUNDED', refund_id = $2 WHERE id = $1 AND status = 'APPROVED'`,
      [id, refundId],
    );
    return res.rowCount === 1;
  }

  /** Approved payments of REFUND_PENDING orders that still have no refund id (housekeeping). */
  async findPendingRefunds(limit: number): Promise<PaymentRow[]> {
    const res = await this.db.query(
      `SELECT p.* FROM payment p JOIN "order" o ON o.id = p.order_id
       WHERE o.status = 'REFUND_PENDING' AND p.status = 'APPROVED' AND p.refund_id IS NULL
       ORDER BY p.updated_at LIMIT $1`,
      [limit],
    );
    return res.rows.map(map);
  }
}

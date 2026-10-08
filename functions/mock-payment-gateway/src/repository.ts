export type PaymentStatus = 'CREATED' | 'APPROVED' | 'DECLINED' | 'REFUNDED';

export interface PaymentRecord {
  paymentId: string;
  orderId: string;
  status: PaymentStatus;
  amountCents: number;
  currency: 'COP';
  returnUrl: string;
  checkoutUrl: string;
  expiresAt: string;
  createdAt: string;
  refundId?: string;
}

export type RefundResult =
  | { kind: 'refunded'; payment: PaymentRecord; replayed: boolean }
  | { kind: 'not_found' }
  | { kind: 'conflict'; status: PaymentStatus };

/** Payment state lives in a managed store; the function keeps nothing between invocations. */
export interface PaymentRepository {
  /** Atomic create-if-absent. `created: false` returns the existing record (idempotent replay). */
  create(payment: PaymentRecord): Promise<{ payment: PaymentRecord; created: boolean }>;
  get(paymentId: string): Promise<PaymentRecord | null>;
  /** Conditional CREATED -> APPROVED | DECLINED. Returns the record in its final state. */
  complete(paymentId: string, outcome: 'APPROVED' | 'DECLINED'): Promise<PaymentRecord | null>;
  /** Conditional APPROVED -> REFUNDED; repeating it returns the same refund. */
  refund(paymentId: string, refundId: string): Promise<RefundResult>;
}

export class InMemoryPaymentRepository implements PaymentRepository {
  readonly payments = new Map<string, PaymentRecord>();

  async create(payment: PaymentRecord) {
    const existing = this.payments.get(payment.paymentId);
    if (existing) return { payment: existing, created: false };
    this.payments.set(payment.paymentId, payment);
    return { payment, created: true };
  }

  async get(paymentId: string) {
    return this.payments.get(paymentId) ?? null;
  }

  async complete(paymentId: string, outcome: 'APPROVED' | 'DECLINED') {
    const p = this.payments.get(paymentId);
    if (!p) return null;
    if (p.status === 'CREATED') p.status = outcome;
    return p;
  }

  async refund(paymentId: string, refundId: string): Promise<RefundResult> {
    const p = this.payments.get(paymentId);
    if (!p) return { kind: 'not_found' };
    if (p.status === 'REFUNDED') return { kind: 'refunded', payment: p, replayed: true };
    if (p.status !== 'APPROVED') return { kind: 'conflict', status: p.status };
    p.status = 'REFUNDED';
    p.refundId = refundId;
    return { kind: 'refunded', payment: p, replayed: false };
  }
}

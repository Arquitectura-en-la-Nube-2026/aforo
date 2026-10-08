import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway';
import { PaymentsRepository } from './payments.repository';

/** UUID v4-shaped id derived from a seed: the contract requires a UUID Idempotency-Key, and retries must reuse it. */
export function refundKey(paymentId: string): string {
  const h = createHash('sha256').update(`refund:${paymentId}`).digest();
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Refund of an approved payment whose reservation expired. The key is stable: `refundKey(paymentId)`. */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly payments: PaymentsRepository,
  ) {}

  /** Never throws: on failure the order stays REFUND_PENDING and housekeeping retries. */
  async request(paymentId: string, correlationId: string): Promise<boolean> {
    const refundId = refundKey(paymentId);
    try {
      await this.gateway.refundPayment(paymentId, { idempotencyKey: refundId, correlationId });
      await this.payments.markRefunded(paymentId, refundId);
      return true;
    } catch (err) {
      this.logger.warn({ event: 'refund_failed', paymentId, reason: (err as Error).message });
      return false;
    }
  }
}

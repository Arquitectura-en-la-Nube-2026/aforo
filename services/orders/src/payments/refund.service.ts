import { Inject, Injectable, Logger } from '@nestjs/common';
import { PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway';
import { PaymentsRepository } from './payments.repository';

/** Refund of an approved payment whose reservation expired. The key is stable: `refund-<paymentId>`. */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly payments: PaymentsRepository,
  ) {}

  /** Never throws: on failure the order stays REFUND_PENDING and housekeeping retries. */
  async request(paymentId: string, correlationId: string): Promise<boolean> {
    const refundId = `refund-${paymentId}`;
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

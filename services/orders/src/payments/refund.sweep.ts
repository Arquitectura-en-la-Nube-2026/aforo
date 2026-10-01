import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { HousekeepingSweep } from '../common';
import { PaymentsRepository } from './payments.repository';
import { RefundService } from './refund.service';

/** Housekeeping sweep: retry refunds of REFUND_PENDING orders that have no refund id yet. */
@Injectable()
export class RefundSweep implements HousekeepingSweep {
  readonly name = 'refund-pending';

  constructor(
    private readonly payments: PaymentsRepository,
    private readonly refunds: RefundService,
  ) {}

  async run(): Promise<void> {
    for (const payment of await this.payments.findPendingRefunds(20)) {
      await this.refunds.request(payment.id, randomUUID());
    }
  }
}

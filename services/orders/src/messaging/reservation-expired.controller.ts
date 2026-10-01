import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { PubSubPushGuard, PushEnvelope } from '../common';
import type { EventEnvelope } from '../common';
import { DbService } from '../db/db.service';
import { OrdersRepository } from '../orders/orders.repository';
import { InboxRepository } from './repositories';

interface ReservationExpiredData {
  reservationId: string;
}

/** Pub/Sub push for `orders-reservation-expired`: PENDING_PAYMENT -> EXPIRED, deduped by messageId. */
@Controller('internal/v1/events')
export class ReservationExpiredController {
  constructor(
    private readonly db: DbService,
    private readonly inbox: InboxRepository,
    private readonly orders: OrdersRepository,
  ) {}

  @Post('orders-reservation-expired')
  @HttpCode(204)
  @UseGuards(PubSubPushGuard)
  async onReservationExpired(@PushEnvelope() envelope: EventEnvelope<ReservationExpiredData>): Promise<void> {
    await this.db.tx(async (q) => {
      if (!(await this.inbox.claim(q, envelope.messageId, 'orders-reservation-expired'))) return;
      await this.orders.expireByReservation(q, envelope.data.reservationId);
    });
  }
}

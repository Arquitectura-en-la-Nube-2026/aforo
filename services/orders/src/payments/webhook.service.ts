import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError, OutboxPublisher, buildEnvelope } from '../common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { DbService } from '../db/db.service';
import { InventoryClient } from '../inventory-client/inventory.client';
import { InboxRepository, OutboxRepository } from '../messaging/repositories';
import { OrdersRepository } from '../orders/orders.repository';
import { PaymentNotificationDto } from './webhook.dto';
import { PaymentsRepository } from './payments.repository';
import { RefundService } from './refund.service';

const INBOX_SOURCE = 'payment-webhook';

/**
 * Processes a payment notification synchronously (ADR-0002). Steps 3-4 are safe to repeat: confirm
 * is idempotent (key = notificationId), the inbox claim and every transition are conditional.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly inbox: InboxRepository,
    private readonly outbox: OutboxRepository,
    private readonly orders: OrdersRepository,
    private readonly payments: PaymentsRepository,
    private readonly inventory: InventoryClient,
    private readonly refunds: RefundService,
    private readonly publisher: OutboxPublisher,
  ) {}

  async handle(n: PaymentNotificationDto, correlationId: string): Promise<void> {
    if (await this.inbox.exists(n.notificationId)) return;

    const payment = await this.payments.findById(n.paymentId);
    const order = payment && payment.orderId === n.orderId ? await this.orders.findById(n.orderId) : null;
    if (!payment || !order) throw new DomainError('NOT_FOUND', 'Unknown payment or order');

    if (n.status === 'DECLINED') {
      await this.db.tx(async (q) => {
        if (!(await this.inbox.claim(q, n.notificationId, INBOX_SOURCE))) return;
        await this.payments.transition(q, payment.id, 'CREATED', 'DECLINED');
      });
      return;
    }

    const confirmation = await this.inventory.confirmReservation(order.reservationId, {
      idempotencyKey: n.notificationId,
      correlationId,
    });

    let refundNeeded = false;
    let published = false;
    await this.db.tx(async (q) => {
      if (!(await this.inbox.claim(q, n.notificationId, INBOX_SOURCE))) return;
      await this.payments.transition(q, payment.id, 'CREATED', 'APPROVED');

      if (confirmation.status === 'CONFIRMED') {
        const paid = await this.orders.markPaid(q, order.id);
        if (!paid) return;
        await this.outbox.add(
          q,
          this.config.topicOrderPaid,
          buildEnvelope({
            type: 'OrderPaid',
            producer: 'orders',
            correlationId,
            data: {
              orderId: paid.id,
              reservationId: paid.reservationId,
              paymentId: payment.id,
              eventId: paid.eventId,
              sectorId: paid.sectorId,
              buyerId: paid.buyerId,
              quantity: paid.quantity,
              totalCents: paid.totalCents,
              currency: 'COP',
              paidAt: paid.paidAt!.toISOString(),
            },
          }),
        );
        published = true;
      } else {
        // The reservation expired before the approval: money was taken, refund it (never reactivate).
        refundNeeded = await this.orders.markRefundPending(q, order.id);
      }
    });

    if (published) await this.publisher.flush().catch((err) => this.logger.warn({ event: 'outbox_flush_failed', reason: err.message }));
    if (refundNeeded) await this.refunds.request(payment.id, correlationId);
  }
}

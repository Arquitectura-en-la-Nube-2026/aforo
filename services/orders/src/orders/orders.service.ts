import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomainError, getCorrelationId } from '../common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { InventoryClient } from '../inventory-client/inventory.client';
import { PAYMENT_GATEWAY, PaymentGateway } from '../payments/payment-gateway';
import { PaymentsRepository } from '../payments/payments.repository';
import { OrderRow, OrdersRepository } from './orders.repository';

export const toOrderCreated = (o: OrderRow) => ({
  orderId: o.id,
  status: o.status,
  reservationId: o.reservationId,
  expiresAt: o.reservationExpiresAt.toISOString(),
  unitPriceCents: o.unitPriceCents,
  totalCents: o.totalCents,
  currency: 'COP' as const,
});

export const toOrder = (o: OrderRow) => ({
  ...toOrderCreated(o),
  eventId: o.eventId,
  sectorId: o.sectorId,
  quantity: o.quantity,
  createdAt: o.createdAt.toISOString(),
  paidAt: o.paidAt ? o.paidAt.toISOString() : null,
});

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly orders: OrdersRepository,
    private readonly payments: PaymentsRepository,
    private readonly inventory: InventoryClient,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  /**
   * Saga step 1: reserve in Inventory, then persist the order. If Inventory rejects, no order is
   * created and its code propagates. The key is forwarded, so a retry after a crash between the
   * two steps gets the same reservation and the insert is idempotent on reservation_id.
   */
  async createOrder(
    buyerId: string,
    dto: { eventId: string; sectorId: string; quantity: number },
    idempotencyKey: string,
    queuePass?: string,
  ) {
    const correlationId = getCorrelationId() ?? randomUUID();
    if (queuePass) this.logger.log({ event: 'queue_pass_received', queuePass });

    const reservation = await this.inventory.createReservation(
      { ...dto, buyerId },
      { idempotencyKey, correlationId, buyerId },
    );
    const order = await this.orders.insert({
      id: randomUUID(),
      buyerId,
      ...dto,
      reservationId: reservation.reservationId,
      reservationExpiresAt: reservation.expiresAt,
      unitPriceCents: reservation.unitPriceCents,
      totalCents: reservation.totalCents,
    });
    return toOrderCreated(order);
  }

  async createPaymentIntent(buyerId: string, orderId: string, idempotencyKey: string, queuePass?: string) {
    const correlationId = getCorrelationId() ?? randomUUID();
    if (queuePass) this.logger.log({ event: 'queue_pass_received', queuePass });

    const order = await this.getOwned(buyerId, orderId);
    if (order.status !== 'PENDING_PAYMENT' || order.reservationExpiresAt.getTime() <= Date.now()) {
      throw new DomainError('RESERVATION_EXPIRED', 'The order is no longer awaiting payment');
    }

    const payment = await this.gateway.createPayment(
      {
        orderId: order.id,
        amountCents: order.totalCents,
        currency: 'COP',
        returnUrl: `${this.config.frontendOrigin}/orders/${order.id}`,
      },
      { idempotencyKey, correlationId },
    );
    await this.payments.insertIfAbsent({
      id: payment.paymentId,
      orderId: order.id,
      amountCents: payment.amountCents,
      checkoutUrl: payment.checkoutUrl,
      expiresAt: payment.expiresAt,
    });
    return { paymentId: payment.paymentId, checkoutUrl: payment.checkoutUrl, expiresAt: payment.expiresAt };
  }

  async getOrder(buyerId: string, orderId: string) {
    return toOrder(await this.getOwned(buyerId, orderId));
  }

  async listOrders(buyerId: string, page: number, size: number) {
    const { rows, total } = await this.orders.listByBuyer(buyerId, page, size);
    return { items: rows.map(toOrder), page, size, total };
  }

  private async getOwned(buyerId: string, orderId: string): Promise<OrderRow> {
    const order = await this.orders.findByIdForBuyer(orderId, buyerId);
    if (!order) throw new DomainError('NOT_FOUND', 'Order not found');
    return order;
  }
}

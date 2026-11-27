// Test doubles for the 9 constructor dependencies of WebhookService (component C4).
// Every dependency is a jest.fn() with a happy-path default, so a case only overrides what it is
// about and can verify interactions (toHaveBeenCalled / not.toHaveBeenCalled) on any of them.
import { WebhookService } from '../../../src/payments/webhook.service';
import type { PaymentNotificationDto } from '../../../src/payments/webhook.dto';

export const IDS = {
  notification: 'aaaaaaaa-0000-4000-8000-000000000001',
  payment: 'bbbbbbbb-0000-4000-8000-000000000001',
  order: 'cccccccc-0000-4000-8000-000000000001',
  reservation: 'dddddddd-0000-4000-8000-000000000001',
  event: 'eeeeeeee-0000-4000-8000-000000000001',
  sector: 'ffffffff-0000-4000-8000-000000000001',
  buyer: '99999999-0000-4000-8000-000000000001',
} as const;

export const CORRELATION_ID = '12345678-0000-4000-8000-000000000001';
export const TOPIC_ORDER_PAID = 'order-paid-topic';
export const PAID_AT = new Date('2026-10-01T15:05:00Z');

export function notification(overrides: Partial<PaymentNotificationDto> = {}): PaymentNotificationDto {
  return {
    notificationId: IDS.notification,
    paymentId: IDS.payment,
    orderId: IDS.order,
    status: 'APPROVED',
    occurredAt: '2026-10-01T15:04:59Z',
    ...overrides,
  };
}

export interface PaymentRowFake {
  id: string;
  orderId: string;
  status: string;
}

export const paymentRow = (): PaymentRowFake => ({ id: IDS.payment, orderId: IDS.order, status: 'CREATED' });

export interface OrderRowFake {
  id: string;
  reservationId: string;
  eventId: string;
  sectorId: string;
  buyerId: string;
  quantity: number;
  totalCents: number;
  status: string;
  paidAt: Date | null;
}

export const orderRow = (overrides: Partial<OrderRowFake> = {}): OrderRowFake => ({
  id: IDS.order,
  reservationId: IDS.reservation,
  eventId: IDS.event,
  sectorId: IDS.sector,
  buyerId: IDS.buyer,
  quantity: 2,
  totalCents: 300_000,
  status: 'PENDING_PAYMENT',
  paidAt: null,
  ...overrides,
});

export function makeDeps() {
  /** The transaction handle the fake DbService passes to its callback. */
  const tx = { name: 'fake-tx' };
  return {
    tx,
    config: { topicOrderPaid: TOPIC_ORDER_PAID },
    db: { tx: jest.fn(async (fn: (q: unknown) => Promise<unknown>) => fn(tx)) },
    inbox: {
      exists: jest.fn(async (_id: string) => false),
      claim: jest.fn(async (_q: unknown, _id: string, _source: string) => true),
    },
    outbox: { add: jest.fn(async (_q: unknown, _topic: string, _envelope: unknown) => undefined) },
    orders: {
      findById: jest.fn(async (_id: string) => orderRow()),
      markPaid: jest.fn(async (_q: unknown, _id: string): Promise<OrderRowFake | null> => orderRow({ status: 'PAID', paidAt: PAID_AT })),
      markRefundPending: jest.fn(async (_q: unknown, _id: string) => true),
    },
    payments: {
      findById: jest.fn(async (_id: string): Promise<PaymentRowFake | null> => paymentRow()),
      transition: jest.fn(async (_q: unknown, _id: string, _from: string, _to: string) => true),
    },
    inventory: {
      confirmReservation: jest.fn(async (_id: string, _ctx: unknown) => ({
        reservationId: IDS.reservation,
        status: 'CONFIRMED' as string,
      })),
    },
    refunds: { request: jest.fn(async (_paymentId: string, _correlationId: string) => undefined) },
    publisher: { flush: jest.fn(async () => undefined) },
  };
}

export type WebhookDeps = ReturnType<typeof makeDeps>;

export function makeService(deps: WebhookDeps): WebhookService {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return new WebhookService(
    deps.config as any,
    deps.db as any,
    deps.inbox as any,
    deps.outbox as any,
    deps.orders as any,
    deps.payments as any,
    deps.inventory as any,
    deps.refunds as any,
    deps.publisher as any,
  );
}

/** Every jest.fn() of the doubles except inbox.exists, for "touches nothing" checks. */
export function allMocksExceptInboxExists(deps: WebhookDeps): jest.Mock[] {
  return [
    deps.db.tx,
    deps.inbox.claim,
    deps.outbox.add,
    deps.orders.findById,
    deps.orders.markPaid,
    deps.orders.markRefundPending,
    deps.payments.findById,
    deps.payments.transition,
    deps.inventory.confirmReservation,
    deps.refunds.request,
    deps.publisher.flush,
  ];
}

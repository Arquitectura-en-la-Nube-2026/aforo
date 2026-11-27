// C4 — payment webhook processing: WebhookService.handle (+ verifySignature).
// WebhookService is built by hand with test doubles for its 9 dependencies (helpers/webhook-deps.ts):
// each case overrides only what it is about. One behavior per case; every name starts with its ID.
// Known product defects are written with the EXPECTED result and marked test.failing (// DEFECT).
import { Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { DomainError } from '../../src/common';
import { verifySignature } from '../../src/payments/webhook-signature';
import { WebhookService } from '../../src/payments/webhook.service';
import {
  CORRELATION_ID,
  IDS,
  PAID_AT,
  TOPIC_ORDER_PAID,
  allMocksExceptInboxExists,
  makeDeps,
  makeService,
  notification,
  paymentRow,
  type WebhookDeps,
} from './helpers/webhook-deps';

const INBOX_SOURCE = 'payment-webhook';

describe('C4 WebhookService.handle', () => {
  let deps: WebhookDeps;
  let service: WebhookService;

  beforeEach(() => {
    deps = makeDeps();
    service = makeService(deps);
  });

  afterEach(() => jest.restoreAllMocks());

  it('TC-C4-01 a duplicate notification (already in the inbox) touches no other dependency', async () => {
    deps.inbox.exists.mockResolvedValue(true);

    await service.handle(notification({ status: 'APPROVED' }), CORRELATION_ID);

    expect(deps.inbox.exists).toHaveBeenCalledWith(IDS.notification);
    for (const mock of allMocksExceptInboxExists(deps)) expect(mock).not.toHaveBeenCalled();
  });

  it('TC-C4-02 APPROVED + reservation CONFIRMED marks the order paid, adds OrderPaid to the outbox and flushes', async () => {
    await service.handle(notification({ status: 'APPROVED' }), CORRELATION_ID);

    expect(deps.inventory.confirmReservation).toHaveBeenCalledWith(IDS.reservation, {
      idempotencyKey: IDS.notification,
      correlationId: CORRELATION_ID,
    });
    expect(deps.inbox.claim).toHaveBeenCalledWith(deps.tx, IDS.notification, INBOX_SOURCE);
    expect(deps.payments.transition).toHaveBeenCalledWith(deps.tx, IDS.payment, 'CREATED', 'APPROVED');
    expect(deps.orders.markPaid).toHaveBeenCalledWith(deps.tx, IDS.order);
    expect(deps.outbox.add).toHaveBeenCalledTimes(1);
    expect(deps.outbox.add).toHaveBeenCalledWith(
      deps.tx,
      TOPIC_ORDER_PAID,
      expect.objectContaining({
        type: 'OrderPaid',
        producer: 'orders',
        correlationId: CORRELATION_ID,
        data: {
          orderId: IDS.order,
          reservationId: IDS.reservation,
          paymentId: IDS.payment,
          eventId: IDS.event,
          sectorId: IDS.sector,
          buyerId: IDS.buyer,
          quantity: 2,
          totalCents: 300_000,
          currency: 'COP',
          paidAt: PAID_AT.toISOString(),
        },
      }),
    );
    expect(deps.publisher.flush).toHaveBeenCalledTimes(1);
    expect(deps.orders.markRefundPending).not.toHaveBeenCalled();
    expect(deps.refunds.request).not.toHaveBeenCalled();
  });

  it.each([
    { scenario: 'the payment is unknown', payment: null },
    { scenario: 'the payment belongs to another order', payment: { ...paymentRow(), orderId: 'cccccccc-0000-4000-8000-000000000999' } },
  ])('TC-C4-03 rejects NOT_FOUND and opens no transaction when $scenario', async ({ payment }) => {
    deps.payments.findById.mockResolvedValue(payment);

    const error = await service.handle(notification(), CORRELATION_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('NOT_FOUND');
    expect((error as DomainError).message).toBe('Unknown payment or order');
    expect(deps.payments.findById).toHaveBeenCalledWith(IDS.payment);
    expect(deps.orders.findById).not.toHaveBeenCalled();
    expect(deps.db.tx).not.toHaveBeenCalled();
    expect(deps.inventory.confirmReservation).not.toHaveBeenCalled();
  });

  it('TC-C4-05 DECLINED moves the payment CREATED -> DECLINED without calling Inventory or touching the order', async () => {
    await service.handle(notification({ status: 'DECLINED' }), CORRELATION_ID);

    expect(deps.inbox.claim).toHaveBeenCalledWith(deps.tx, IDS.notification, INBOX_SOURCE);
    expect(deps.payments.transition).toHaveBeenCalledTimes(1);
    expect(deps.payments.transition).toHaveBeenCalledWith(deps.tx, IDS.payment, 'CREATED', 'DECLINED');
    expect(deps.inventory.confirmReservation).not.toHaveBeenCalled();
    expect(deps.orders.markPaid).not.toHaveBeenCalled();
    expect(deps.orders.markRefundPending).not.toHaveBeenCalled();
    expect(deps.outbox.add).not.toHaveBeenCalled();
    expect(deps.publisher.flush).not.toHaveBeenCalled();
    expect(deps.refunds.request).not.toHaveBeenCalled();
  });

  it('TC-C4-06 APPROVED with the reservation EXPIRED moves the order to REFUND_PENDING and requests the refund, no OrderPaid', async () => {
    deps.inventory.confirmReservation.mockResolvedValue({ reservationId: IDS.reservation, status: 'EXPIRED' });

    await service.handle(notification({ status: 'APPROVED' }), CORRELATION_ID);

    expect(deps.payments.transition).toHaveBeenCalledWith(deps.tx, IDS.payment, 'CREATED', 'APPROVED');
    expect(deps.orders.markRefundPending).toHaveBeenCalledWith(deps.tx, IDS.order);
    expect(deps.refunds.request).toHaveBeenCalledTimes(1);
    expect(deps.refunds.request).toHaveBeenCalledWith(IDS.payment, CORRELATION_ID);
    expect(deps.orders.markPaid).not.toHaveBeenCalled();
    expect(deps.outbox.add).not.toHaveBeenCalled();
    expect(deps.publisher.flush).not.toHaveBeenCalled();
  });

  it('TC-C4-07 an Inventory failure propagates and nothing is claimed or written', async () => {
    const failure = new Error('inventory unavailable');
    deps.inventory.confirmReservation.mockRejectedValue(failure);

    await expect(service.handle(notification({ status: 'APPROVED' }), CORRELATION_ID)).rejects.toBe(failure);

    expect(deps.db.tx).not.toHaveBeenCalled();
    expect(deps.inbox.claim).not.toHaveBeenCalled();
    expect(deps.payments.transition).not.toHaveBeenCalled();
    expect(deps.refunds.request).not.toHaveBeenCalled();
  });

  // Spec gap: the contract does not define what happens when the order is no longer PENDING_PAYMENT
  // (markPaid matches no row) after the reservation was confirmed. Design expectation: no event, no refund.
  it('TC-C4-09 when markPaid finds no pending order there is no OrderPaid, no flush and no refund', async () => {
    deps.orders.markPaid.mockResolvedValue(null);

    await service.handle(notification({ status: 'APPROVED' }), CORRELATION_ID);

    expect(deps.orders.markPaid).toHaveBeenCalledWith(deps.tx, IDS.order);
    expect(deps.outbox.add).not.toHaveBeenCalled();
    expect(deps.publisher.flush).not.toHaveBeenCalled();
    expect(deps.orders.markRefundPending).not.toHaveBeenCalled();
    expect(deps.refunds.request).not.toHaveBeenCalled();
  });

  it('TC-C4-10 a failing outbox flush does not fail the webhook and logs outbox_flush_failed', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    deps.publisher.flush.mockRejectedValue(new Error('pubsub down'));

    await expect(service.handle(notification({ status: 'APPROVED' }), CORRELATION_ID)).resolves.toBeUndefined();

    expect(deps.outbox.add).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ event: 'outbox_flush_failed', reason: 'pubsub down' });
  });

  // DEFECT: expected the order NOT to be marked PAID (nor OrderPaid written) when the payment is no longer
  // CREATED (e.g. already DECLINED: payments.transition -> false); observed markPaid and outbox.add are
  // called anyway, because handle ignores the result of payments.transition.
  test.failing('TC-C4-11 APPROVED for a payment that is no longer CREATED does not mark the order PAID', async () => {
    deps.payments.transition.mockResolvedValue(false);

    await service.handle(notification({ status: 'APPROVED' }), CORRELATION_ID);

    expect(deps.orders.markPaid).not.toHaveBeenCalled();
    expect(deps.outbox.add).not.toHaveBeenCalled();
  });
});

describe('C4 verifySignature', () => {
  const SECRET = 'webhook-test-secret';
  const BODY = Buffer.from('{"notificationId":"aaaaaaaa-0000-4000-8000-000000000001","status":"APPROVED"}');
  const validHex = createHmac('sha256', SECRET).update(BODY).digest('hex');

  it('TC-C4-14 the HMAC-SHA256 of the raw body with the shared secret is accepted', () => {
    expect(verifySignature(BODY, `sha256=${validHex}`, SECRET)).toBe(true);
  });

  it.each([
    { scenario: 'there is no raw body', body: undefined, header: `sha256=${validHex}` },
    { scenario: 'there is no X-Signature header', body: BODY, header: undefined },
    { scenario: 'the scheme is not sha256= (sha512= with the right digest)', body: BODY, header: `sha512=${validHex}` },
    { scenario: 'the digest was tampered with (same length)', body: BODY, header: `sha256=${validHex.slice(0, -2)}00` },
    { scenario: 'the digest is truncated', body: BODY, header: `sha256=${validHex.slice(0, 32)}` },
    { scenario: 'the digest was computed with another secret', body: BODY, header: `sha256=${createHmac('sha256', 'other').update(BODY).digest('hex')}` },
  ])('TC-C4-15 the signature is rejected (false, no exception) when $scenario', ({ body, header }) => {
    expect(verifySignature(body, header, SECRET)).toBe(false);
  });

  // DEFECT: expected false for a header with characters after the 64 hex digits; observed true, because
  // Buffer.from(hex, 'hex') stops at the first non-hex character and the 32 decoded bytes still match.
  test.failing('TC-C4-13 a valid signature followed by non-hex characters is rejected', () => {
    expect(verifySignature(BODY, `sha256=${validHex}zz`, SECRET)).toBe(false);
  });
});

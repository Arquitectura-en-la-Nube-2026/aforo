// C4 — payment webhook processing: WebhookService.handle (+ verifySignature).
// WebhookService is built by hand with test doubles for its 9 dependencies (helpers/webhook-deps.ts).
// Template: copy a case, give it the next TC-C4-nn ID, test one behavior per case.
import { WebhookService } from '../../src/payments/webhook.service';
import {
  CORRELATION_ID,
  IDS,
  TOPIC_ORDER_PAID,
  allMocksExceptInboxExists,
  makeDeps,
  makeService,
  notification,
  type WebhookDeps,
} from './helpers/webhook-deps';

describe('C4 WebhookService.handle', () => {
  let deps: WebhookDeps;
  let service: WebhookService;

  beforeEach(() => {
    deps = makeDeps();
    service = makeService(deps);
  });

  it('TC-C4-01 a duplicate notification (already in the inbox) touches no other dependency', async () => {
    deps.inbox.exists.mockResolvedValue(true);

    await service.handle(notification({ status: 'APPROVED' }), CORRELATION_ID);

    expect(deps.inbox.exists).toHaveBeenCalledWith(IDS.notification);
    for (const mock of allMocksExceptInboxExists(deps)) expect(mock).not.toHaveBeenCalled();
  });

  it('TC-C4-02 APPROVED + reservation CONFIRMED marks the order paid, adds OrderPaid to the outbox and flushes', async () => {
    await service.handle(notification({ status: 'APPROVED' }), CORRELATION_ID);

    expect(deps.orders.markPaid).toHaveBeenCalledWith(deps.tx, IDS.order);
    expect(deps.outbox.add).toHaveBeenCalledTimes(1);
    expect(deps.outbox.add).toHaveBeenCalledWith(
      deps.tx,
      TOPIC_ORDER_PAID,
      expect.objectContaining({ type: 'OrderPaid', producer: 'orders', correlationId: CORRELATION_ID }),
    );
    expect(deps.publisher.flush).toHaveBeenCalledTimes(1);
    expect(deps.refunds.request).not.toHaveBeenCalled();
  });
});

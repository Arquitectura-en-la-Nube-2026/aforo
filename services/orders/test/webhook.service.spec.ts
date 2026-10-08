import { WebhookService } from '../src/payments/webhook.service';

const N = { notificationId: 'n1', paymentId: 'p1', orderId: 'o1', occurredAt: '2026-10-01T00:00:00Z' };
const order = { id: 'o1', reservationId: 'r1', eventId: 'e', sectorId: 's', buyerId: 'b', quantity: 2, totalCents: 10, paidAt: new Date('2026-10-01T00:00:01Z') };

function setup(opts: { confirm?: string; claimed?: boolean; known?: boolean } = {}) {
  const calls: string[] = [];
  const q = {};
  const db = { tx: async (fn: any) => fn(q) };
  const inbox = {
    exists: async () => opts.known ?? false,
    claim: async () => (calls.push('claim'), opts.claimed ?? true),
  };
  const outbox = { add: jest.fn(async (..._a: unknown[]) => void calls.push('outbox')) };
  const orders = {
    findById: async () => ({ ...order, status: 'PENDING_PAYMENT' }),
    markPaid: jest.fn(async () => (calls.push('markPaid'), order)),
    markRefundPending: jest.fn(async () => (calls.push('markRefundPending'), true)),
  };
  const payments = {
    findById: async () => ({ id: 'p1', orderId: 'o1' }),
    transition: jest.fn(async (_q: unknown, _id: string, from: string, to: string) => void calls.push(`payment ${from}>${to}`)),
  };
  const inventory = { confirmReservation: jest.fn(async (..._a: unknown[]) => (calls.push('confirm'), { reservationId: 'r1', status: opts.confirm ?? 'CONFIRMED' })) };
  const refunds = { request: jest.fn(async () => void calls.push('refund')) };
  const publisher = { flush: jest.fn(async () => void calls.push('flush')) };
  const svc = new WebhookService({ topicOrderPaid: 'topic' } as any, db as any, inbox as any, outbox as any, orders as any, payments as any, inventory as any, refunds as any, publisher as any);
  return { svc, calls, outbox, inventory, refunds, orders };
}

describe('payment webhook saga', () => {
  it('APPROVED + CONFIRMED: marks PAID, writes OrderPaid to the outbox in the tx, then flushes', async () => {
    const { svc, calls, outbox } = setup();
    await svc.handle({ ...N, status: 'APPROVED' }, 'corr');
    expect(calls).toEqual(['confirm', 'claim', 'payment CREATED>APPROVED', 'markPaid', 'outbox', 'flush']);
    const envelope = (outbox.add.mock.calls[0] as any)[2];
    expect(envelope).toMatchObject({ type: 'OrderPaid', producer: 'orders', correlationId: 'corr' });
    expect(envelope.data).toMatchObject({ orderId: 'o1', paymentId: 'p1', currency: 'COP', totalCents: 10 });
  });

  it('APPROVED + EXPIRED: moves to REFUND_PENDING and requests the refund after the commit, no OrderPaid', async () => {
    const { svc, calls, outbox } = setup({ confirm: 'EXPIRED' });
    await svc.handle({ ...N, status: 'APPROVED' }, 'corr');
    expect(calls).toEqual(['confirm', 'claim', 'payment CREATED>APPROVED', 'markRefundPending', 'refund']);
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('confirms with Idempotency-Key = notificationId', async () => {
    const { svc, inventory } = setup();
    await svc.handle({ ...N, status: 'APPROVED' }, 'corr');
    expect(inventory.confirmReservation).toHaveBeenCalledWith('r1', { idempotencyKey: 'n1', correlationId: 'corr' });
  });

  it('a notification already in the inbox does nothing', async () => {
    const { svc, calls } = setup({ known: true });
    await svc.handle({ ...N, status: 'APPROVED' }, 'corr');
    expect(calls).toEqual([]);
  });

  it('losing the inbox claim race applies no transition and writes no outbox row', async () => {
    const { svc, calls } = setup({ claimed: false });
    await svc.handle({ ...N, status: 'APPROVED' }, 'corr');
    expect(calls).toEqual(['confirm', 'claim']);
  });

  it('DECLINED: payment CREATED>DECLINED, the order stays pending and Inventory is not called', async () => {
    const { svc, calls, inventory } = setup();
    await svc.handle({ ...N, status: 'DECLINED' }, 'corr');
    expect(calls).toEqual(['claim', 'payment CREATED>DECLINED']);
    expect(inventory.confirmReservation).not.toHaveBeenCalled();
  });

  it('propagates an Inventory failure so the webhook answers non-2xx and Cloud Tasks retries', async () => {
    const { svc, inventory } = setup();
    inventory.confirmReservation.mockRejectedValueOnce(new Error('inventory down'));
    await expect(svc.handle({ ...N, status: 'APPROVED' }, 'corr')).rejects.toThrow('inventory down');
  });
});

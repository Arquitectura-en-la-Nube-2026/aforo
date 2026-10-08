import { randomUUID } from 'node:crypto';
import { HealthService } from '@aforo/common/nest';
import { DbService } from '../src/db/db.service';
import { IdempotencyKeyRepository, InboxRepository, OutboxRepository } from '../src/messaging/repositories';
import { OrdersRepository } from '../src/orders/orders.repository';
import { PaymentsRepository } from '../src/payments/payments.repository';

/**
 * Runs against a migrated Postgres. Opt-in:
 *   TEST_DATABASE_URL=postgres://orders:test@127.0.0.1:55432/orders npm test
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb('repositories (real Postgres)', () => {
  const db = new DbService({ databaseUrl: url, dbPoolMax: 2 } as any, new HealthService());
  const orders = new OrdersRepository(db);
  const payments = new PaymentsRepository(db);
  const inbox = new InboxRepository(db);
  const outbox = new OutboxRepository(db);
  const idempotency = new IdempotencyKeyRepository(db);

  afterAll(() => db.onApplicationShutdown());

  const newOrder = (overrides: Partial<Parameters<OrdersRepository['insert']>[0]> = {}) => ({
    id: randomUUID(),
    buyerId: randomUUID(),
    eventId: randomUUID(),
    sectorId: randomUUID(),
    quantity: 2,
    reservationId: randomUUID(),
    reservationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    unitPriceCents: 18_000_000,
    totalCents: 36_000_000,
    ...overrides,
  });

  it('insert is idempotent on reservation_id and returns the existing order', async () => {
    const o = newOrder();
    const first = await orders.insert(o);
    const second = await orders.insert({ ...o, id: randomUUID() });
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({ status: 'PENDING_PAYMENT', totalCents: 36_000_000, paidAt: null });
  });

  it('markPaid wins once; a second attempt, or a late expiry, updates nothing', async () => {
    const o = await orders.insert(newOrder());
    const paid = await orders.markPaid(db, o.id);
    expect(paid).toMatchObject({ status: 'PAID' });
    expect(paid!.paidAt).toBeInstanceOf(Date);
    expect(await orders.markPaid(db, o.id)).toBeNull();
    expect(await orders.expireByReservation(db, o.reservationId)).toBe(false);
    expect(await orders.markRefundPending(db, o.id)).toBe(false);
  });

  it('EXPIRED orders can move to REFUND_PENDING (late approval) but never to PAID', async () => {
    const o = await orders.insert(newOrder());
    expect(await orders.expireByReservation(db, o.reservationId)).toBe(true);
    expect(await orders.markPaid(db, o.id)).toBeNull();
    expect(await orders.markRefundPending(db, o.id)).toBe(true);
    expect((await orders.findById(o.id))!.status).toBe('REFUND_PENDING');
  });

  it('lists only the buyer orders, newest first, with a total', async () => {
    const buyerId = randomUUID();
    const a = await orders.insert(newOrder({ buyerId }));
    const b = await orders.insert(newOrder({ buyerId }));
    await orders.insert(newOrder());
    const page = await orders.listByBuyer(buyerId, 0, 1);
    expect(page.total).toBe(2);
    expect(page.rows.map((r) => r.id)).toEqual([b.id]);
    expect((await orders.listByBuyer(buyerId, 1, 1)).rows.map((r) => r.id)).toEqual([a.id]);
    expect(await orders.findByIdForBuyer(a.id, randomUUID())).toBeNull();
  });

  it('payment transitions are conditional and refunds are found by the housekeeping sweep', async () => {
    const o = await orders.insert(newOrder());
    const paymentId = randomUUID();
    const p = { id: paymentId, orderId: o.id, amountCents: 36_000_000, checkoutUrl: 'http://x', expiresAt: new Date().toISOString() };
    await payments.insertIfAbsent(p);
    await payments.insertIfAbsent(p);
    expect(await payments.transition(db, paymentId, 'CREATED', 'APPROVED')).toBe(true);
    expect(await payments.transition(db, paymentId, 'CREATED', 'APPROVED')).toBe(false);
    expect(await payments.transition(db, paymentId, 'CREATED', 'DECLINED')).toBe(false);

    await orders.expireByReservation(db, o.reservationId);
    await orders.markRefundPending(db, o.id);
    expect((await payments.findPendingRefunds(1000)).map((r) => r.id)).toContain(paymentId);
    expect(await payments.markRefunded(paymentId, `refund-${paymentId}`)).toBe(true);
    expect(await payments.markRefunded(paymentId, `refund-${paymentId}`)).toBe(false);
    expect((await payments.findPendingRefunds(1000)).map((r) => r.id)).not.toContain(paymentId);
  });

  it('inbox claim is true once; a rolled-back transaction leaves no inbox row or outbox row', async () => {
    const messageId = randomUUID();
    await db.tx(async (q) => expect(await inbox.claim(q, messageId, 't')).toBe(true));
    await db.tx(async (q) => expect(await inbox.claim(q, messageId, 't')).toBe(false));
    expect(await inbox.exists(messageId)).toBe(true);

    const rolledBack = randomUUID();
    const eventId = randomUUID();
    await expect(
      db.tx(async (q) => {
        await inbox.claim(q, rolledBack, 't');
        await outbox.add(q, 'topic', { messageId: eventId, type: 'OrderPaid', version: 1, occurredAt: '', correlationId: randomUUID(), producer: 'orders', data: {} } as any);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await inbox.exists(rolledBack)).toBe(false);
    expect((await outbox.findPending(10_000)).map((m) => m.id)).not.toContain(eventId);
  });

  it('outbox rows are pending until marked published', async () => {
    const id = randomUUID();
    const correlationId = randomUUID();
    await db.tx((q) =>
      outbox.add(q, 'aforo.orders.order-paid', { messageId: id, type: 'OrderPaid', version: 1, occurredAt: '', correlationId, producer: 'orders', data: { a: 1 } } as any),
    );
    const pending = (await outbox.findPending(10_000)).find((m) => m.id === id);
    expect(pending).toMatchObject({ topic: 'aforo.orders.order-paid', type: 'OrderPaid', correlationId });
    expect((pending!.payload as any).data).toEqual({ a: 1 });
    await outbox.markPublished(id);
    expect((await outbox.findPending(10_000)).map((m) => m.id)).not.toContain(id);
  });

  it('stores and returns an idempotency record, ignoring a duplicate save', async () => {
    const key = randomUUID();
    const record = { key, requestHash: 'abc', statusCode: 201, responseBody: { orderId: 'x' } };
    await idempotency.save(record);
    await idempotency.save({ ...record, statusCode: 500 });
    expect(await idempotency.find(key)).toEqual(record);
    expect(await idempotency.find(randomUUID())).toBeNull();
  });
});

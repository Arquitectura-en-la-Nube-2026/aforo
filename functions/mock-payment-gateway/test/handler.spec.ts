import { Config } from '../src/config';
import { Deps, HttpRequest, handle } from '../src/handler';
import { InMemoryPaymentRepository } from '../src/repository';
import { PaymentNotification } from '../src/scheduler';
import { sign } from '../src/util';

const KEY = '7b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const ORDER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const baseConfig: Config = {
  logLevel: 'info',
  gcpProjectId: 'p',
  gcpRegion: 'r',
  publicBaseUrl: 'http://gw/mock-gateway',
  ordersWebhookUrl: 'http://orders/api/v1/payments/webhook',
  webhookSecret: 's3cret',
  webhookDelaySeconds: 2,
  tasksQueue: 'payment-webhooks',
  selfUrl: 'http://self',
  tasksInvokerServiceAccount: 'sa',
  faultMode: 'none',
  faultDelayMs: 5000,
  dispatchTimeoutMs: 1000,
};

function setup(overrides: Partial<Config> = {}, fetchImpl?: typeof fetch) {
  const repo = new InMemoryPaymentRepository();
  const scheduled: PaymentNotification[] = [];
  const sleeps: number[] = [];
  const logs: Record<string, unknown>[] = [];
  const deps: Deps = {
    config: { ...baseConfig, ...overrides },
    repo,
    scheduler: { schedule: async (n) => void scheduled.push(n) },
    logger: { log: (e) => void logs.push(e) },
    fetch: fetchImpl ?? (async () => new Response(null, { status: 200 })),
    sleep: async (ms) => void sleeps.push(ms),
    now: () => new Date('2026-10-01T15:00:00Z'),
  };
  const call = (req: Partial<HttpRequest> & { method: string; path: string }) =>
    handle({ query: {}, headers: {}, rawBody: '', ...req }, deps);
  return { call, repo, scheduled, sleeps, logs, deps };
}

const createBody = JSON.stringify({ orderId: ORDER, amountCents: 36000000, currency: 'COP', returnUrl: 'http://app/orders/1' });
const create = (call: ReturnType<typeof setup>['call'], key = KEY, rawBody = createBody) =>
  call({ method: 'POST', path: '/payments', headers: { 'idempotency-key': key }, rawBody });

describe('POST /payments', () => {
  it('creates a CREATED payment with a checkoutUrl under PUBLIC_BASE_URL', async () => {
    const { call } = setup();
    const res = await create(call);
    const body = JSON.parse(res.body!);
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ orderId: ORDER, status: 'CREATED', amountCents: 36000000, currency: 'COP' });
    expect(body.checkoutUrl).toBe(`http://gw/mock-gateway/checkout/${body.paymentId}`);
    expect(body.expiresAt).toBe('2026-10-01T15:15:00.000Z');
  });

  it('returns the same status and body with Idempotent-Replayed on a repeated Idempotency-Key', async () => {
    const { call } = setup();
    const first = await create(call);
    const second = await create(call);
    expect(second.status).toBe(first.status);
    expect(second.body).toBe(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
  });

  it('answers 409 IDEMPOTENCY_CONFLICT when the key is reused with a different body', async () => {
    const { call } = setup();
    await create(call);
    const res = await create(call, KEY, JSON.stringify({ ...JSON.parse(createBody), amountCents: 1 }));
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body!)).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('answers 422 VALIDATION_ERROR as problem+json for an invalid body or key', async () => {
    const { call } = setup();
    const bad = await create(call, KEY, JSON.stringify({ orderId: 'x' }));
    expect(bad.status).toBe(422);
    expect(bad.headers['content-type']).toBe('application/problem+json');
    expect((await create(call, 'not-a-uuid')).status).toBe(422);
  });

  it('FAULT_MODE=error answers 503 problem+json without creating anything', async () => {
    const { call, repo } = setup({ faultMode: 'error' });
    const res = await create(call);
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toBe('application/problem+json');
    expect(repo.payments.size).toBe(0);
  });

  it('FAULT_MODE=timeout sleeps FAULT_DELAY_MS before answering', async () => {
    const { call, sleeps } = setup({ faultMode: 'timeout', faultDelayMs: 4321 });
    const res = await create(call);
    expect(sleeps).toEqual([4321]);
    expect(res.status).toBe(201);
  });

  it('applies the fault mode only to POST /payments', async () => {
    const { call } = setup({ faultMode: 'error' });
    expect((await call({ method: 'GET', path: `/checkout/${ORDER}` })).status).toBe(404);
  });
});

async function approvedPayment(ctx: ReturnType<typeof setup>) {
  const { paymentId } = JSON.parse((await create(ctx.call)).body!);
  await ctx.call({ method: 'GET', path: `/checkout/${paymentId}/complete`, query: { outcome: 'APPROVED' } });
  return paymentId as string;
}

describe('checkout', () => {
  it('serves an HTML page with Pay and Decline links', async () => {
    const ctx = setup();
    const { paymentId } = JSON.parse((await create(ctx.call)).body!);
    const res = await ctx.call({ method: 'GET', path: `/checkout/${paymentId}` });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain(`/checkout/${paymentId}/complete?outcome=APPROVED`);
    expect(res.body).toContain(`/checkout/${paymentId}/complete?outcome=DECLINED`);
    expect(res.body).toContain('Pay');
    expect(res.body).toContain('Decline');
  });

  it('404 problem+json for an unknown payment', async () => {
    const res = await setup().call({ method: 'GET', path: `/checkout/${ORDER}` });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body!)).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('complete enqueues one notification (delay is Cloud Tasks, not a sleep) and redirects to the order', async () => {
    const ctx = setup();
    const { paymentId } = JSON.parse((await create(ctx.call)).body!);
    const res = await ctx.call({ method: 'GET', path: `/checkout/${paymentId}/complete`, query: { outcome: 'APPROVED' } });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://app/orders/1');
    expect(ctx.scheduled).toHaveLength(1);
    expect(ctx.scheduled[0]).toMatchObject({ paymentId, orderId: ORDER, status: 'APPROVED' });
    expect(ctx.sleeps).toEqual([]);
  });

  it('pressing the button twice produces the same notificationId (Cloud Tasks dedup by task name)', async () => {
    const ctx = setup();
    const { paymentId } = JSON.parse((await create(ctx.call)).body!);
    const req = { method: 'GET', path: `/checkout/${paymentId}/complete`, query: { outcome: 'DECLINED' } };
    await ctx.call(req);
    await ctx.call(req);
    expect(ctx.scheduled).toHaveLength(2);
    expect(ctx.scheduled[0].notificationId).toBe(ctx.scheduled[1].notificationId);
  });

  it('a later click cannot flip a completed payment', async () => {
    const ctx = setup();
    const paymentId = await approvedPayment(ctx);
    await ctx.call({ method: 'GET', path: `/checkout/${paymentId}/complete`, query: { outcome: 'DECLINED' } });
    expect(ctx.scheduled.map((n) => n.status)).toEqual(['APPROVED', 'APPROVED']);
  });

  it('answers 503 when the task cannot be enqueued', async () => {
    const ctx = setup();
    ctx.deps.scheduler = { schedule: async () => Promise.reject(new Error('tasks down')) };
    const { paymentId } = JSON.parse((await create(ctx.call)).body!);
    const res = await ctx.call({ method: 'GET', path: `/checkout/${paymentId}/complete`, query: { outcome: 'APPROVED' } });
    expect(res.status).toBe(503);
  });

  it('422 for an invalid outcome', async () => {
    const ctx = setup();
    const { paymentId } = JSON.parse((await create(ctx.call)).body!);
    const res = await ctx.call({ method: 'GET', path: `/checkout/${paymentId}/complete`, query: { outcome: 'MAYBE' } });
    expect(res.status).toBe(422);
  });
});

describe('POST /payments/{id}/refunds', () => {
  const refund = (ctx: ReturnType<typeof setup>, id: string) =>
    ctx.call({ method: 'POST', path: `/payments/${id}/refunds`, headers: { 'idempotency-key': 'refund-key' } });

  it('refunds an APPROVED payment and replays idempotently', async () => {
    const ctx = setup();
    const id = await approvedPayment(ctx);
    const first = await refund(ctx, id);
    expect(first.status).toBe(201);
    expect(JSON.parse(first.body!).status).toBe('REFUNDED');
    const second = await refund(ctx, id);
    expect(second.status).toBe(201);
    expect(second.body).toBe(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
  });

  it('409 when the payment is not APPROVED, 404 when unknown', async () => {
    const ctx = setup();
    const { paymentId } = JSON.parse((await create(ctx.call)).body!);
    expect((await refund(ctx, paymentId)).status).toBe(409);
    expect((await refund(ctx, ORDER)).status).toBe(404);
  });
});

describe('POST /webhook-dispatch', () => {
  const notification = JSON.stringify({
    notificationId: KEY, paymentId: ORDER, orderId: ORDER, status: 'APPROVED', occurredAt: '2026-10-01T15:00:02Z',
  });

  it('signs the raw body with HMAC-SHA256 and posts it to Orders, answering 204', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const ctx = setup({}, async (url, init) => (seen.push({ url: String(url), init: init! }), new Response(null, { status: 200 })));
    const res = await ctx.call({ method: 'POST', path: '/webhook-dispatch', rawBody: notification });
    expect(res.status).toBe(204);
    expect(seen[0].url).toBe('http://orders/api/v1/payments/webhook');
    expect(seen[0].init.body).toBe(notification);
    expect((seen[0].init.headers as Record<string, string>)['x-signature']).toBe(sign(notification, 's3cret'));
  });

  it('answers non-2xx when Orders does, so Cloud Tasks retries', async () => {
    const ctx = setup({}, async () => new Response(null, { status: 503 }));
    expect((await ctx.call({ method: 'POST', path: '/webhook-dispatch', rawBody: notification })).status).toBe(502);
  });

  it('answers non-2xx when Orders is unreachable', async () => {
    const ctx = setup({}, async () => Promise.reject(new Error('ECONNREFUSED')));
    expect((await ctx.call({ method: 'POST', path: '/webhook-dispatch', rawBody: notification })).status).toBe(502);
  });
});

describe('observability', () => {
  it('logs one JSON-able line per request with correlationId, route, status and latencyMs', async () => {
    const ctx = setup();
    await create(ctx.call);
    const line = ctx.logs.at(-1)!;
    expect(line).toMatchObject({ route: 'POST /payments', status: 201 });
    expect(typeof line.correlationId).toBe('string');
    expect(typeof line.latencyMs).toBe('number');
  });
});

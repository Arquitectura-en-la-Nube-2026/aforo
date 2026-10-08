import { randomUUID } from 'node:crypto';
import { alreadyCompletedPage, checkoutPage, errorPage } from './checkout-html';
import { Config } from './config';
import { PaymentRecord, PaymentRepository } from './repository';
import { PaymentNotification, WebhookScheduler } from './scheduler';
import { UUID_V4, deterministicUuid, sign } from './util';

export interface HttpRequest {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  rawBody: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body?: string;
}

export interface Deps {
  config: Config;
  repo: PaymentRepository;
  scheduler: WebhookScheduler;
  logger: { log(entry: Record<string, unknown>): void };
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

type ErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'IDEMPOTENCY_CONFLICT' | 'INTERNAL';

const TITLES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Validation failed',
  NOT_FOUND: 'Resource not found',
  IDEMPOTENCY_CONFLICT: 'Idempotency key reused with a different request',
  INTERNAL: 'Internal error',
};

const CHECKOUT_TTL_MS = 15 * 60 * 1000;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse => ({
  status,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const html = (status: number, body: string): HttpResponse => ({
  status,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  body,
});

function problem(status: number, code: ErrorCode, detail: string, correlationId: string): HttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/problem+json' },
    body: JSON.stringify({
      type: `https://aforo.dev/errors/${code.toLowerCase().replace(/_/g, '-')}`,
      title: TITLES[code],
      status,
      code,
      detail,
      correlationId,
    }),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function validateCreatePayment(body: unknown): string | null {
  if (!isObject(body)) return 'body must be a JSON object';
  const allowed = new Set(['orderId', 'amountCents', 'currency', 'returnUrl']);
  if (Object.keys(body).some((k) => !allowed.has(k))) return 'unknown properties are not allowed';
  if (typeof body.orderId !== 'string' || !UUID_V4.test(body.orderId)) return 'orderId must be a UUID v4';
  if (!Number.isInteger(body.amountCents) || (body.amountCents as number) < 0) return 'amountCents must be an integer >= 0';
  if (body.currency !== 'COP') return 'currency must be COP';
  if (typeof body.returnUrl !== 'string' || !URL.canParse(body.returnUrl)) return 'returnUrl must be a URL';
  return null;
}

const view = (p: PaymentRecord) => ({
  paymentId: p.paymentId,
  orderId: p.orderId,
  status: p.status,
  amountCents: p.amountCents,
  currency: p.currency,
  checkoutUrl: p.checkoutUrl,
  expiresAt: p.expiresAt,
});

async function route(req: HttpRequest, deps: Deps, correlationId: string): Promise<{ route: string; res: HttpResponse }> {
  const { config, repo } = deps;
  const segments = req.path.replace(/\/+$/, '').split('/').filter(Boolean);
  const [a, b, c] = segments;
  const idempotencyKey = req.headers['idempotency-key'];

  if (req.method === 'POST' && segments.length === 1 && a === 'payments') {
    // Fault injection (D-18) applies to payment creation only, before anything else.
    if (config.faultMode === 'error') {
      return { route: 'POST /payments', res: problem(503, 'INTERNAL', 'Injected fault (FAULT_MODE=error)', correlationId) };
    }
    if (config.faultMode === 'timeout') await deps.sleep(config.faultDelayMs);

    const r = 'POST /payments';
    if (!idempotencyKey || !UUID_V4.test(idempotencyKey)) {
      return { route: r, res: problem(422, 'VALIDATION_ERROR', 'Idempotency-Key header must be a UUID v4', correlationId) };
    }
    const body = parseJson(req.rawBody);
    const invalid = validateCreatePayment(body);
    if (invalid) return { route: r, res: problem(422, 'VALIDATION_ERROR', invalid, correlationId) };
    const input = body as { orderId: string; amountCents: number; currency: 'COP'; returnUrl: string };

    const paymentId = deterministicUuid(`payment:${idempotencyKey}`);
    const now = deps.now();
    const { payment, created } = await repo.create({
      paymentId,
      orderId: input.orderId,
      status: 'CREATED',
      amountCents: input.amountCents,
      currency: 'COP',
      returnUrl: input.returnUrl,
      checkoutUrl: `${config.publicBaseUrl}/checkout/${paymentId}`,
      expiresAt: new Date(now.getTime() + CHECKOUT_TTL_MS).toISOString(),
      createdAt: now.toISOString(),
    });
    if (!created && (payment.orderId !== input.orderId || payment.amountCents !== input.amountCents)) {
      return { route: r, res: problem(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was used with a different body', correlationId) };
    }
    return { route: r, res: json(201, view(payment), created ? {} : { 'idempotent-replayed': 'true' }) };
  }

  if (req.method === 'POST' && segments.length === 3 && a === 'payments' && c === 'refunds') {
    const r = 'POST /payments/{paymentId}/refunds';
    if (!UUID_V4.test(b)) return { route: r, res: problem(404, 'NOT_FOUND', 'Payment not found', correlationId) };
    if (!idempotencyKey) {
      return { route: r, res: problem(422, 'VALIDATION_ERROR', 'Idempotency-Key header is required', correlationId) };
    }
    const result = await repo.refund(b, `refund-${b}`);
    if (result.kind === 'not_found') return { route: r, res: problem(404, 'NOT_FOUND', 'Payment not found', correlationId) };
    if (result.kind === 'conflict') {
      return { route: r, res: problem(409, 'IDEMPOTENCY_CONFLICT', `Only APPROVED payments can be refunded (current: ${result.status})`, correlationId) };
    }
    return { route: r, res: json(201, view(result.payment), result.replayed ? { 'idempotent-replayed': 'true' } : {}) };
  }

  if (req.method === 'GET' && segments.length === 2 && a === 'checkout') {
    const r = 'GET /checkout/{paymentId}';
    const payment = UUID_V4.test(b) ? await repo.get(b) : null;
    if (!payment) return { route: r, res: problem(404, 'NOT_FOUND', 'Payment not found', correlationId) };
    if (payment.status !== 'CREATED') return { route: r, res: html(200, alreadyCompletedPage(payment.status)) };
    return { route: r, res: html(200, checkoutPage({ ...payment, publicBaseUrl: config.publicBaseUrl })) };
  }

  if (req.method === 'GET' && segments.length === 3 && a === 'checkout' && c === 'complete') {
    const r = 'GET /checkout/{paymentId}/complete';
    const outcome = req.query.outcome;
    if (outcome !== 'APPROVED' && outcome !== 'DECLINED') {
      return { route: r, res: problem(422, 'VALIDATION_ERROR', 'outcome must be APPROVED or DECLINED', correlationId) };
    }
    const payment = UUID_V4.test(b) ? await repo.complete(b, outcome) : null;
    if (!payment) return { route: r, res: problem(404, 'NOT_FOUND', 'Payment not found', correlationId) };

    if (payment.status === 'APPROVED' || payment.status === 'DECLINED') {
      // The task is enqueued inside this request (never "respond now, schedule later"); the task
      // name is deterministic, so pressing the button twice yields a single notification.
      const notification: PaymentNotification = {
        notificationId: deterministicUuid(`notification:${payment.paymentId}:${payment.status}`),
        paymentId: payment.paymentId,
        orderId: payment.orderId,
        status: payment.status,
        occurredAt: deps.now().toISOString(),
      };
      try {
        await deps.scheduler.schedule(notification, correlationId);
      } catch (err) {
        deps.logger.log({ severity: 'ERROR', event: 'webhook_enqueue_failed', correlationId, reason: (err as Error).message });
        return { route: r, res: html(503, errorPage('The payment result could not be scheduled.')) };
      }
    }
    return { route: r, res: { status: 302, headers: { location: payment.returnUrl } } };
  }

  if (req.method === 'POST' && segments.length === 1 && a === 'webhook-dispatch') {
    const r = 'POST /webhook-dispatch';
    const body = parseJson(req.rawBody);
    if (!isObject(body) || typeof body.notificationId !== 'string' || typeof body.paymentId !== 'string') {
      return { route: r, res: problem(422, 'VALIDATION_ERROR', 'body must be a payment notification', correlationId) };
    }
    // Sign and forward the exact bytes received: Orders verifies the HMAC over its raw body.
    try {
      const response = await deps.fetch(config.ordersWebhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-signature': sign(req.rawBody, config.webhookSecret),
          'x-correlation-id': correlationId,
        },
        body: req.rawBody,
        signal: AbortSignal.timeout(config.dispatchTimeoutMs),
      });
      if (response.ok) return { route: r, res: { status: 204, headers: {} } };
      deps.logger.log({ severity: 'WARNING', event: 'webhook_rejected', correlationId, ordersStatus: response.status });
    } catch (err) {
      deps.logger.log({ severity: 'WARNING', event: 'webhook_delivery_failed', correlationId, reason: (err as Error).message });
    }
    // Non-2xx makes Cloud Tasks retry the notification.
    return { route: r, res: problem(502, 'INTERNAL', 'Orders did not accept the notification', correlationId) };
  }

  return { route: `${req.method} ${req.path}`, res: problem(404, 'NOT_FOUND', 'Route not found', correlationId) };
}

/** Pure request handler: no framework, everything finishes before the response is returned. */
export async function handle(req: HttpRequest, deps: Deps): Promise<HttpResponse> {
  const started = Date.now();
  const correlationId = req.headers['x-correlation-id'] || randomUUID();
  let routeName = `${req.method} ${req.path}`;
  let res: HttpResponse;
  try {
    const out = await route(req, deps, correlationId);
    routeName = out.route;
    res = out.res;
  } catch (err) {
    deps.logger.log({ severity: 'ERROR', event: 'unhandled_error', correlationId, reason: (err as Error).message });
    res = problem(500, 'INTERNAL', 'Unexpected error', correlationId);
  }
  res.headers['x-correlation-id'] = correlationId;
  deps.logger.log({
    severity: res.status >= 500 ? 'ERROR' : 'INFO',
    correlationId,
    route: routeName,
    status: res.status,
    latencyMs: Date.now() - started,
  });
  return res;
}

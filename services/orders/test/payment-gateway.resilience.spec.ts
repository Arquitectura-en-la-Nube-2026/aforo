import { DomainError, HttpTransportError } from '../src/common';
import { AppConfig } from '../src/config/config';
import { HttpPaymentGateway } from '../src/payments/http-payment-gateway';
import { buildResilience } from '../src/payments/resilience';

const cfg: AppConfig['resilience'] = {
  failureThreshold: 5,
  resetTimeoutMs: 200,
  retryMaxAttempts: 3,
  retryBaseDelayMs: 1,
  retryMaxDelayMs: 2,
};
const ctx = { idempotencyKey: 'k', correlationId: 'c' };
const request = { orderId: 'o', amountCents: 100, currency: 'COP' as const, returnUrl: 'http://x' };
const payment = { paymentId: 'p', orderId: 'o', status: 'CREATED', amountCents: 100, currency: 'COP', checkoutUrl: 'u', expiresAt: 'e' };

function setup(handler: () => Promise<{ status: number; body?: unknown }>) {
  const logs: Record<string, unknown>[] = [];
  const http = { request: jest.fn((..._args: any[]) => handler()) };
  const gateway = new HttpPaymentGateway('http://gw', http as any, async () => ({}), buildResilience(cfg, { log: (e) => logs.push(e) }));
  return { http, gateway, logs };
}

const expectUnavailable = (p: Promise<unknown>) =>
  expect(p).rejects.toMatchObject({ code: 'PAYMENT_UNAVAILABLE' });

describe('payment gateway adapter (E-06)', () => {
  it('returns the payment and forwards Idempotency-Key and X-Correlation-Id', async () => {
    const { gateway, http } = setup(async () => ({ status: 201, body: payment }));
    await expect(gateway.createPayment(request, ctx)).resolves.toEqual(payment);
    expect(http.request.mock.calls[0][0].headers).toMatchObject({ 'idempotency-key': 'k', 'x-correlation-id': 'c' });
  });

  it('retries transport failures up to 3 attempts, then answers PAYMENT_UNAVAILABLE', async () => {
    const { gateway, http } = setup(async () => {
      throw new HttpTransportError('response_timeout', 'slow');
    });
    await expectUnavailable(gateway.createPayment(request, ctx));
    expect(http.request).toHaveBeenCalledTimes(3);
  });

  it('recovers when a retry succeeds', async () => {
    let n = 0;
    const { gateway, http } = setup(async () => (++n < 3 ? { status: 503 } : { status: 201, body: payment }));
    await expect(gateway.createPayment(request, ctx)).resolves.toEqual(payment);
    expect(http.request).toHaveBeenCalledTimes(3);
  });

  it('does not retry nor count a 4xx answer against the breaker', async () => {
    const { gateway, http } = setup(async () => ({ status: 422, body: { detail: 'bad' } }));
    for (let i = 0; i < 8; i++) await expect(gateway.createPayment(request, ctx)).rejects.toBeInstanceOf(DomainError);
    expect(http.request).toHaveBeenCalledTimes(8);
  });

  it('opens after 5 consecutive failures, fails fast, and logs event=circuit_state', async () => {
    const { gateway, http, logs } = setup(async () => ({ status: 503 }));
    await expectUnavailable(gateway.createPayment(request, ctx)); // 3 attempts
    await expectUnavailable(gateway.createPayment(request, ctx)); // 2 more -> opens
    expect(http.request).toHaveBeenCalledTimes(5);
    expect(logs).toContainEqual(expect.objectContaining({ event: 'circuit_state', from: 'CLOSED', to: 'OPEN' }));

    const started = Date.now();
    await expectUnavailable(gateway.createPayment(request, ctx));
    expect(Date.now() - started).toBeLessThan(50);
    expect(http.request).toHaveBeenCalledTimes(5);
  });

  it('goes half-open after the reset timeout and closes on success', async () => {
    let healthy = false;
    const { gateway, logs } = setup(async () => (healthy ? { status: 201, body: payment } : { status: 503 }));
    await expectUnavailable(gateway.createPayment(request, ctx));
    await expectUnavailable(gateway.createPayment(request, ctx));
    healthy = true;
    await new Promise((r) => setTimeout(r, cfg.resetTimeoutMs + 50));
    await expect(gateway.createPayment(request, ctx)).resolves.toEqual(payment);
    const transitions = logs.filter((l) => l.event === 'circuit_state').map((l) => `${l.from}>${l.to}`);
    expect(transitions).toEqual(['CLOSED>OPEN', 'OPEN>HALF_OPEN', 'HALF_OPEN>CLOSED']);
  });
});

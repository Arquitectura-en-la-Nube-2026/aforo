// C5 — payment gateway circuit breaker + retry: buildResilience (src/payments/resilience.ts).
// The component is exercised directly with a stub operation (not through HttpPaymentGateway).
// Time is fake (jest fake timers) and the backoff jitter is pinned with a Math.random spy.
// Template: copy a case, give it the next TC-C5-nn ID, test one behavior per case.
import { BrokenCircuitError, CircuitState } from 'cockatiel';
import type { AppConfig } from '../../src/config/config';
import { GatewayRejectedError, GatewayUnavailableError, buildResilience } from '../../src/payments/resilience';

const cfg: AppConfig['resilience'] = {
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
  retryMaxAttempts: 3,
  retryBaseDelayMs: 200,
  retryMaxDelayMs: 5_000,
};

function setup(config = cfg) {
  const logs: Record<string, unknown>[] = [];
  const resilience = buildResilience(config, { log: (entry) => logs.push(entry) });
  return { ...resilience, logs };
}

/** Starts `promise`, drives every pending fake timer (backoff delays) and returns its rejection. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  const settled = promise.then(
    () => {
      throw new Error('expected a rejection, the call resolved');
    },
    (err: unknown) => err,
  );
  await jest.runAllTimersAsync();
  return settled;
}

/** Starts `promise`, drives every pending fake timer (backoff delays) and returns its value. */
async function resolutionOf<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then((value) => value);
  await jest.runAllTimersAsync();
  return settled;
}

/** Opens the breaker: one call whose 3 attempts all fail with GatewayUnavailableError (threshold 3). */
async function openBreaker(policy: ReturnType<typeof setup>['policy']): Promise<void> {
  const failing = jest.fn(async () => {
    throw new GatewayUnavailableError('503');
  });
  await rejectionOf(policy.execute(failing));
}

/** The `circuit_state` transitions logged so far, in order. */
function transitions(logs: Record<string, unknown>[]) {
  return logs
    .filter((entry) => entry.event === 'circuit_state')
    .map(({ severity, from, to }) => ({ severity, from, to }));
}

describe('C5 buildResilience', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-01T15:00:00Z') });
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('TC-C5-01 after failureThreshold GatewayUnavailableError failures the breaker opens and the next call fails at once', async () => {
    const { policy, breaker, logs } = setup();
    const operation = jest.fn(async () => {
      throw new GatewayUnavailableError('503');
    });

    expect(await rejectionOf(policy.execute(operation))).toBeInstanceOf(GatewayUnavailableError);
    expect(operation).toHaveBeenCalledTimes(3); // retryMaxAttempts = 3 total attempts = threshold
    expect(breaker.state).toBe(CircuitState.Open);
    expect(logs).toContainEqual(expect.objectContaining({ event: 'circuit_state', from: 'CLOSED', to: 'OPEN' }));

    operation.mockClear();
    expect(await rejectionOf(policy.execute(operation))).toBeInstanceOf(BrokenCircuitError);
    expect(operation).not.toHaveBeenCalled();
  });

  it('TC-C5-02 a GatewayRejectedError (4xx) is not retried and does not trip the breaker', async () => {
    const { policy, breaker } = setup();
    const operation = jest.fn(async () => {
      throw new GatewayRejectedError(422, { detail: 'bad request' });
    });

    expect(await rejectionOf(policy.execute(operation))).toBeInstanceOf(GatewayRejectedError);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(breaker.state).toBe(CircuitState.Closed);
  });

  it('TC-C5-03 after resetTimeoutMs a successful probe closes the breaker (OPEN -> HALF_OPEN -> CLOSED)', async () => {
    const { policy, breaker, logs } = setup();
    await openBreaker(policy);
    expect(breaker.state).toBe(CircuitState.Open);

    await jest.advanceTimersByTimeAsync(cfg.resetTimeoutMs);
    const operation = jest.fn(async () => 'paid');

    expect(await resolutionOf(policy.execute(operation))).toBe('paid');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(breaker.state).toBe(CircuitState.Closed);
    expect(transitions(logs)).toEqual([
      { severity: 'WARNING', from: 'CLOSED', to: 'OPEN' },
      { severity: 'INFO', from: 'OPEN', to: 'HALF_OPEN' },
      { severity: 'INFO', from: 'HALF_OPEN', to: 'CLOSED' },
    ]);
  });

  it('TC-C5-04 a failed probe in HALF_OPEN opens the breaker again', async () => {
    const { policy, breaker, logs } = setup();
    await openBreaker(policy);

    await jest.advanceTimersByTimeAsync(cfg.resetTimeoutMs);
    const operation = jest.fn(async () => {
      throw new GatewayUnavailableError('503');
    });

    // The probe fails and reopens the circuit; the retry that follows hits the open circuit and stops.
    expect(await rejectionOf(policy.execute(operation))).toBeInstanceOf(BrokenCircuitError);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(breaker.state).toBe(CircuitState.Open);
    expect(transitions(logs)).toEqual([
      { severity: 'WARNING', from: 'CLOSED', to: 'OPEN' },
      { severity: 'INFO', from: 'OPEN', to: 'HALF_OPEN' },
      { severity: 'WARNING', from: 'HALF_OPEN', to: 'OPEN' },
    ]);
  });

  it('TC-C5-06 failureThreshold - 1 consecutive failures leave the breaker CLOSED', async () => {
    const { policy, breaker, logs } = setup({ ...cfg, failureThreshold: 3, retryMaxAttempts: 2 });
    const operation = jest.fn(async () => {
      throw new GatewayUnavailableError('503');
    });

    expect(await rejectionOf(policy.execute(operation))).toBeInstanceOf(GatewayUnavailableError);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(breaker.state).toBe(CircuitState.Closed);
    expect(transitions(logs)).toEqual([]);
  });

  it('TC-C5-07 with retryMaxAttempts 3 two failures then a success return the result after 3 calls', async () => {
    const { policy, breaker, logs } = setup({ ...cfg, retryMaxAttempts: 3 });
    const operation = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new GatewayUnavailableError('503'))
      .mockRejectedValueOnce(new GatewayUnavailableError('503'))
      .mockResolvedValueOnce('paid');

    expect(await resolutionOf(policy.execute(operation))).toBe('paid');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(breaker.state).toBe(CircuitState.Closed);
    expect(logs.filter((entry) => entry.event === 'payment_retry')).toHaveLength(2);
  });

  it('TC-C5-08 with retryMaxAttempts 1 a failure is not retried and GatewayUnavailableError propagates', async () => {
    const { policy, breaker, logs } = setup({ ...cfg, retryMaxAttempts: 1 });
    const operation = jest.fn(async () => {
      throw new GatewayUnavailableError('503');
    });

    expect(await rejectionOf(policy.execute(operation))).toBeInstanceOf(GatewayUnavailableError);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(breaker.state).toBe(CircuitState.Closed);
    expect(logs.filter((entry) => entry.event === 'payment_retry')).toHaveLength(0);
  });
});

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
});

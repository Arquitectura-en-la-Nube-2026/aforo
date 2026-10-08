import {
  CircuitBreakerPolicy,
  CircuitState,
  ConsecutiveBreaker,
  ExponentialBackoff,
  IPolicy,
  circuitBreaker,
  handleType,
  retry,
  wrap,
} from 'cockatiel';
import { AppConfig } from '../config/config';

/** The gateway is unreachable, too slow or answered 5xx: counts against the breaker and is retried. */
export class GatewayUnavailableError extends Error {}

/** The gateway answered a 4xx: a real answer, never retried and never trips the breaker. */
export class GatewayRejectedError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`payment gateway rejected the call with ${status}`);
  }
}

export interface ResilienceLogger {
  log(entry: Record<string, unknown>): void;
}

const STATE_NAME: Record<CircuitState, string> = {
  [CircuitState.Closed]: 'CLOSED',
  [CircuitState.Open]: 'OPEN',
  [CircuitState.HalfOpen]: 'HALF_OPEN',
  [CircuitState.Isolated]: 'ISOLATED',
};

export interface Resilience {
  policy: IPolicy;
  breaker: CircuitBreakerPolicy;
}

/**
 * E-06 / D-18: retry (outer) -> circuit breaker (inner). Timeouts live in the HTTP client.
 * Retry only handles GatewayUnavailableError; an open circuit (BrokenCircuitError) fails at once.
 * `retryMaxAttempts` counts total attempts, cockatiel counts retries after the first.
 */
export function buildResilience(cfg: AppConfig['resilience'], logger: ResilienceLogger): Resilience {
  const breaker = circuitBreaker(handleType(GatewayUnavailableError), {
    halfOpenAfter: cfg.resetTimeoutMs,
    breaker: new ConsecutiveBreaker(cfg.failureThreshold),
  });
  let previous = CircuitState.Closed;
  breaker.onStateChange((state) => {
    logger.log({
      severity: state === CircuitState.Open ? 'WARNING' : 'INFO',
      event: 'circuit_state',
      circuit: 'payment-gateway',
      from: STATE_NAME[previous],
      to: STATE_NAME[state],
    });
    previous = state;
  });

  const retryPolicy = retry(handleType(GatewayUnavailableError), {
    maxAttempts: Math.max(cfg.retryMaxAttempts - 1, 0),
    backoff: new ExponentialBackoff({ initialDelay: cfg.retryBaseDelayMs, maxDelay: cfg.retryMaxDelayMs }),
  });
  retryPolicy.onRetry(({ attempt, delay }) =>
    logger.log({ severity: 'WARNING', event: 'payment_retry', attempt, delayMs: delay }),
  );

  return { policy: wrap(retryPolicy, breaker), breaker };
}

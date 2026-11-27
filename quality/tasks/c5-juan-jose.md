# C5 — Gateway circuit breaker + retry · Juan José

**Code under test:** `services/orders/src/payments/resilience.ts` (`buildResilience`).
**Tests go in:** `services/orders/test/p1/c5-resilience.test.ts` (TC-C5-01..02 already there, with fake timers
and a `Math.random` spy — keep that setup).
**Branch:** `quality/c5-juan-jose` · **Runner:** Jest

Test `buildResilience` **directly** with a stub operation (a `jest.fn` that throws
`GatewayUnavailableError` / `GatewayRejectedError` or resolves). Never through `HttpPaymentGateway`.
Advance time with `jest.advanceTimersByTimeAsync`; read the state from `breaker.state` and the logger spy.

## Missing cases
| ID | Condition | Inputs | Expected |
|---|---|---|---|
| TC-C5-03 | OPEN → HALF_OPEN → CLOSED | open it; advance `resetTimeoutMs`; operation succeeds | result returned; state CLOSED; logs OPEN→HALF_OPEN→CLOSED |
| TC-C5-04 | Probe fails in HALF_OPEN | open it; advance `resetTimeoutMs`; operation fails | state OPEN again |
| TC-C5-06 | `failureThreshold − 1` failures | threshold 3, 2 failures | state still CLOSED |
| TC-C5-07 | Retry then success | `retryMaxAttempts 3`; fails twice, then resolves | 3 calls; result returned |
| TC-C5-08 | `retryMaxAttempts = 1` | operation fails | 1 call; `GatewayUnavailableError` propagates |

Count calls on the stub (`toHaveBeenCalledTimes`) — that is the oracle for retries.

## Run
`npm run test:p1:c5 --workspace=@aforo/orders` → verdicts + branch coverage of `resilience.ts`
(`quality/reports/c5/coverage/`). With only the template it is 50% (1/2): the log severity ternary
(`WARNING` on open / `INFO` otherwise) never takes the `INFO` side. TC-C5-03 should cover it.

## Report (doc team-E-p1)
- **Section 8, row C5:** branch % (n/m) and what is not executed and why.
- **Section 9:** anything unexpected; "hard to test" note on time-dependent behavior if relevant.

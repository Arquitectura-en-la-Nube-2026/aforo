# E-06 · Payment gateway resilience (circuit breaker)

**Target (Delivery 3):** when the payment gateway fails, checkout degrades to a clear
`503 PAYMENT_UNAVAILABLE`; after 5 consecutive failures the circuit opens and calls fail in
≤ 50 ms instead of waiting on timeouts; when the gateway comes back, the circuit half-opens and
closes, and payment works again without a deploy.

**When:** Fri Oct 9, 2026, 03:28–03:33 UTC (Thu Oct 8, 22:28 Bogotá).
**Deployed:** orders `aforo-orders-00006-sk7` (`a44ee7e`), gateway and web `6e69b9f`.
**How:** [e06.cjs](e06.cjs) through the public gateway, one buyer and one order (General × 1).
Raw output in [run.log](run.log).

Orders' policy (`services/orders/src/payments/resilience.ts`, D-18): retry (3 attempts,
exponential backoff from 200 ms) around a consecutive-failure breaker (threshold 5, half-open
after 30 s); 2 s response timeout per attempt.

## Result

| Target | Observed |
| ------ | -------- |
| Fault → `503 PAYMENT_UNAVAILABLE` | ✅ every call while the mock timed out |
| Circuit opens after 5 failures | ✅ `CLOSED → OPEN` at 03:29:06.414, on the 5th failed attempt (3 of call #1 + 2 of call #2) |
| Open → fail fast ≤ 50 ms | ✅ **~10 ms in orders** (9.5–10.3 ms request latency); ~200 ms seen from Bogotá incl. network |
| Recovers without a deploy | ✅ `OPEN → HALF_OPEN → CLOSED` at 03:32:36, payment intent `201` with a checkout URL |

### Trip (`make fault MODE=timeout`)

| UTC | Call | Answer | Seen by the client | In orders |
| --- | ---- | ------ | -----------------: | --------: |
| 03:29:01 | #1 | 503 `PAYMENT_UNAVAILABLE` | 6 706 ms | 6.51 s (3 attempts × 2 s + backoff) |
| 03:29:06 | #2 | 503 `PAYMENT_UNAVAILABLE` | 4 786 ms | 4.48 s (circuit opens on attempt 2) |
| 03:29:06 | #3 | 503 `PAYMENT_UNAVAILABLE` | 303 ms | **9.7 ms** |
| 03:29:07 | #4 | 503 `PAYMENT_UNAVAILABLE` | 197 ms | **10.1 ms** |
| 03:29:07 | #5 | 503 `PAYMENT_UNAVAILABLE` | 200 ms | **9.5 ms** |
| 03:29:07 | #6 | 503 `PAYMENT_UNAVAILABLE` | 198 ms | **9.9 ms** |

### Recover (`make fault MODE=none`, rolled out 03:31:24)

| UTC | What happened |
| --- | ------------- |
| 03:32:00.936 | Call #1: `OPEN → HALF_OPEN`, one probe goes to the mock |
| 03:32:02.941 | The probe hits the mock's **new revision on a cold instance** (2.8 s); orders' 2 s timeout fires: `HALF_OPEN → OPEN` for another 30 s |
| 03:32:08–30 | Calls #2–#6: 503 in ~10 ms each (open) |
| 03:32:36.078 | Call #7: `OPEN → HALF_OPEN`, probe answers in 0.12 s |
| 03:32:36.276 | `HALF_OPEN → CLOSED`; payment intent `201` |

The failed probe is the breaker doing its job: half-open lets exactly one call test the
dependency and re-opens on failure. **For the live demo**, after `make fault MODE=none` open the
mock once (or wait ~30 s) before paying, so the probe does not land on a cold start.

Side effect worth knowing: the timed-out probe still created a payment in the mock (`201` after
2.8 s). Orders never saw it, so nothing points to it and no webhook moves the order; it is the
"gateway did the work but we timed out" case that idempotency keys and the webhook-as-truth
design (ADR-03) are there for.

## Log queries

Circuit transitions and retries:

```
resource.type="cloud_run_revision"
resource.labels.service_name="aforo-orders"
jsonPayload.event=("circuit_state" OR "payment_retry")
timestamp>="2026-10-09T03:28:00Z" timestamp<="2026-10-09T03:33:00Z"
```

Fast failures (request latency in orders):

```
resource.type="cloud_run_revision"
resource.labels.service_name="aforo-orders"
httpRequest.requestUrl=~"payment-intents"
timestamp>="2026-10-09T03:28:00Z" timestamp<="2026-10-09T03:33:00Z"
```

One call end to end: `jsonPayload.correlationId="5c09a1cf-cdd0-4d4b-b04a-f6d8f3802ddd"` (the
call that opened the circuit).

## Rerun

```bash
make fault MODE=timeout          # ~1 min
node e06.cjs trip                # new buyer + order, 6 payment intents
make fault MODE=none             # ~1 min; then warm the mock or wait 30 s
node e06.cjs recover             # same order, every 5 s until 201
```

# "Fails well" (acceptance script)

**When:** Fri Oct 9, 2026, 13:32 UTC, except the duplicate webhook (Oct 9, 00:39 UTC).
**How:** [fails-well.cjs](fails-well.cjs) through the public gateway; raw output in [run.log](run.log).
Event "Festival Estéreo 2026". Every rejection is `application/problem+json` with its agreed `code`.

| Case | Request | Answer | Nothing changed? |
| ---- | ------- | ------ | ---------------- |
| More tickets than remain | User A takes 4 of 6 "Palco"; user B asks for 4 | **`409 SOLD_OUT`** "Fewer than 4 seats left in this sector" | ✅ Palco stays at 2 |
| More than the per-person maximum | User C asks for 5 "General" | **`409 LIMIT_EXCEEDED`** "At most 4 tickets per person; 0 already confirmed" | ✅ General stays at 196 |
| Same order twice | User D, `POST /orders` ×2 with key `0d777c3c-…` | `201` then **`201` + `Idempotent-Replayed: true`**, same `orderId` `b4a02df8-…` | ✅ General 196 → 195: one reservation, not two |
| Same webhook twice | Same signed notification delivered 5× (below) | `200` ×5 | ✅ one `PAID` transition, **one `OrderPaid`** |
| Expiry | — | see [reliability-expiry](../reliability-expiry/) | ✅ |

## Same webhook, five times

On Oct 9 at 00:39 UTC (first happy-path run) the gateway bug fixed in `#39` turned orders' `200`
into a `500` for the mock, so Cloud Tasks delivered the **same notification five times**. Orders'
log for `correlationId b521c06b-3d63-48aa-a3f4-cedfb1da7034`:

| UTC | `POST /api/v1/payments/webhook` | Effect |
| --- | ------------------------------- | ------ |
| 00:39:27.700 | `200`, 291 ms | Order → `PAID`; `outbox_flushed published: 1` (`OrderPaid`) |
| 00:39:28.301 | `200`, 5 ms | inbox hit: nothing applied, nothing published |
| 00:39:29.378 | `200`, 4 ms | same |
| 00:39:30.297 | `200`, 4 ms | same |
| 00:39:31.300 | `200`, 4 ms | same |

Not staged: a real retry storm the idempotent consumer absorbed. The signature makes a hand-made
duplicate impossible without the mock's secret, which is the point.

Query:

```
resource.type="cloud_run_revision"
resource.labels.service_name="aforo-orders"
(jsonPayload.route="/api/v1/payments/webhook" OR jsonPayload.event="outbox_flushed")
timestamp>="2026-10-09T00:39:00Z" timestamp<="2026-10-09T00:40:00Z"
```

## Log queries for the others

`jsonPayload.correlationId="44f64403-4777-4dd2-bc42-62be0607ce77"` (SOLD_OUT) ·
`jsonPayload.correlationId="a70a70b0-aea5-487a-8d27-2ac4aa8f8fb0"` (LIMIT_EXCEEDED).

# e2e — Acceptance tests

> Owner: Julián · Status: not started

Automates the acceptance script in [docs/plan/acceptance.md](../docs/plan/acceptance.md) against
the deployed `dev` environment (base URL = Gateway).

## Scenarios

| File (suggested) | Covers |
| ---------------- | ------ |
| `happy-path.spec.ts` | Steps 1–10: login → paid order, correlation ID present |
| `sold-out.spec.ts` | `409 SOLD_OUT`, nothing decremented |
| `limit-exceeded.spec.ts` | `409 LIMIT_EXCEEDED` |
| `reservation-expiry.spec.ts` | Reservation expires, availability restored, order `EXPIRED` (use a seeded event with a short TTL) |
| `idempotency.spec.ts` | Same `Idempotency-Key` on `POST /orders` → same order |
| `duplicate-webhook.spec.ts` | Same webhook twice → no change, one `OrderPaid` |

Suggested tooling: Playwright (UI + API in one runner). The concurrency test of Inventory is **not**
here; it lives in `services/inventory/test/concurrency/`.

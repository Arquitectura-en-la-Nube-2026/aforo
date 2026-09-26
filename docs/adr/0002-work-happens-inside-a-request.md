# 0002 · All work happens inside a request

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** Julián (Platform)
- **Affects:** `services/*`, `packages/common` (outbox), `infra/` (Cloud Scheduler), `contracts/`

## Context

Cloud Run bills and allocates CPU per request by default: between requests the CPU is throttled
to almost zero and an idle instance may be shut down at any moment. Three planned mechanisms
relied on work running outside a request:

1. The outbox publisher polling every second in each producer (catalog, inventory, orders).
2. The Orders webhook answering `200` "immediately" and processing afterwards.
3. The queue admission job ticking every few seconds, which would also run once **per
   instance**, multiplying the admission rate.

With request-based CPU, (1) and (2) stall or are lost when the instance idles or scales to zero.
Keeping CPU always allocated on every service would fix it but costs money while idle (E-07)
and hides the problem instead of solving it.

## Decision

**No service does work after its response or on its own timer**, with one exception (`queue`).

- **Outbox: flush after commit + housekeeping.** A request that commits outbox rows calls
  `OutboxPublisher.flush()` (from `@aforo/common`) **after the commit and before responding**.
  Publishing still reads only committed outbox rows, so the pattern is intact. Rows that were
  not published (crash, Pub/Sub error) are picked up by **housekeeping**.
- **Housekeeping endpoint.** Each Postgres service (catalog, inventory, orders) exposes
  `POST /internal/v1/housekeeping`. One Cloud Scheduler job per service calls it every minute
  with an OIDC token. It flushes pending outbox rows and runs the service's own sweeps
  (inventory: expire overdue reservations, [ADR-0003](0003-reservation-expiry-safety-net.md);
  orders: retry refunds that were not requested). It is idempotent and safe to call twice.
  Three jobs fit in the Cloud Scheduler free tier; they are paused when the environment is off.
- **Webhook processed synchronously.** Orders validates the signature, returns `200` at once if
  `notificationId` is already in `inbox`, otherwise calls Inventory `confirm` (idempotent), then
  in **one transaction** inserts the `inbox` row, applies the order/payment transition and writes
  the outbox row; it flushes and answers `200`. Any failure answers non-2xx, and the mock's
  `/webhook-dispatch` propagates it so **Cloud Tasks retries** the notification. At-least-once
  delivery without background work.
- **Queue is the exception.** It already needs CPU always allocated for SSE, so its admission
  job may run in-process. Each tick takes a Redis lock
  `SET admission:{eventId}:{tick} 1 NX EX <2 × interval>` where
  `tick = floor(now / ADMISSION_INTERVAL_SECONDS)`; only the instance that wins the lock admits.

## Consequences

- Events usually reach Pub/Sub within the request that caused them; the worst case is one
  minute late (next housekeeping). Nothing in the acceptance script depends on sub-minute
  delivery of a *failed* publish.
- Requests that write outbox rows are a few tens of milliseconds slower (one Pub/Sub publish).
- The webhook answers after processing (≈ a few hundred ms) instead of "immediately" as in
  Entrega 2 §3.3. The gateway can retry, so the observable guarantee is the same; the saga
  stays correct because `confirm` is idempotent and the effect and the inbox row commit together.
- `@aforo/common` exposes `flush()` and a housekeeping helper instead of a poller;
  `OUTBOX_POLL_INTERVAL_MS` disappears.
- Only `queue` pays for always-allocated CPU, and only while an instance is alive.
